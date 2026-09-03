import sql from 'mssql';
import { z } from 'zod';
import type { SettingsQueries } from '../db/settings-store.js';
import type { LlmService } from './llm-service.js';
import type { JiraRestClient } from './jira-client.js';
import { loadPrompt } from './prompt-loader.js';
import type { PipelineMonitor, PipelineTarget } from './pipeline-monitor.js';
import { tableSuffix } from './pipeline-monitor.js';
import { extractText } from './shared/adf-utils.js';
import type { CoachingEngine } from './coach.js';
import { CommentReviewSchema, overallOf } from './comment-review.js';

let pool: sql.ConnectionPool | null = null;

async function getKpiPool(settings: SettingsQueries): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;

  const all = settings.getAll();
  const server = all.kpi_sql_server;
  const database = all.kpi_sql_database;
  const user = all.kpi_sql_user;
  const password = all.kpi_sql_password;

  if (!server || !database || !user || !password) {
    throw new Error('KPI SQL Server not configured');
  }

  pool = await new sql.ConnectionPool({
    server, database, user, password,
    options: { encrypt: true, trustServerCertificate: true },
    requestTimeout: 30000,
  }).connect();

  return pool;
}

// NOVA posts public comments under "NOVA-Jira" — its own replies must not be
// QA'd as if they were an agent's, or they land in the team's Golden Rules stats.
const BOT_PATTERNS = ['nurtur', 'automation', 'jira service', 'servicedesk', 'bot', 'nova-jira'];

// Resolution comments are excluded structurally — see the statusCategory check in
// scoreRecentComments. The old approach matched ten hard-coded English closure phrases,
// which was both easy to evade and prone to firing on a mid-ticket comment that happened
// to say "this is now resolved".

// Schema lives in comment-review.ts so the Golden-Rules rubric is defined once.
const GrResultSchema = CommentReviewSchema;
type GrResult = z.infer<typeof GrResultSchema>;

export class GrPipeline {
  private coachingEngine: CoachingEngine | null = null;

  constructor(
    private settings: SettingsQueries,
    private llmService: LlmService,
    private jiraClient: JiraRestClient,
    private jiraProject: string = 'NT',
    private monitor?: PipelineMonitor,
  ) {}

  setCoachingEngine(engine: CoachingEngine): void { this.coachingEngine = engine; }

  private get target(): PipelineTarget {
    const val = this.settings.get('qa_pipeline_target');
    return val === 'live' ? 'live' : 'uat';
  }

  private get s(): string {
    return tableSuffix(this.target);
  }

  async scoreRecentComments(windowMinutes: number = 1440): Promise<number> {
    const started = new Date();
    let rowsAffected = 0;
    try {
      const windowEnd = new Date();
      const windowStart = new Date(windowEnd.getTime() - windowMinutes * 60000);
      const startStr = windowStart.toISOString().replace('T', ' ').slice(0, 16);
      const endStr = windowEnd.toISOString().replace('T', ' ').slice(0, 16);

      const jql = `project = ${this.jiraProject} AND updated >= "${startStr}" AND updated < "${endStr}" ORDER BY updated ASC`;
      console.log(`[gr-pipeline] JQL: ${jql} → target=${this.target}`);
      const result = await this.jiraClient.searchJqlAll(jql, [
        'summary', 'priority', 'issuetype', 'assignee', 'comment', 'status',
      ], 500);
      const issues = result?.issues ?? [];
      console.log(`[gr-pipeline] Jira returned ${issues.length} tickets`);

      if (issues.length === 0) {
        await this.logRun(started, 'success', 0);
        return 0;
      }
      console.log(`[gr-pipeline] ${issues.length} tickets to scan for comments`);

      const p = await getKpiPool(this.settings);
      const s = this.s;

      const passThreshold = await this.getPassThreshold(p, s);
      const agentLookup = await this.getAgentKeys(p);
      console.log(`[gr-pipeline] Loaded ${agentLookup.keys.size} agent keys, ${agentLookup.displayNames.size} display names`);

      let skippedNoId = 0, skippedDate = 0, skippedInternal = 0, skippedCustomer = 0, skippedBot = 0, skippedNotAgent = 0, skippedAlready = 0, skippedEmpty = 0, skippedResolved = 0, skippedNotLatest = 0, eligible = 0;
      const scoredAgentNames = new Set<string>();

      for (const issue of issues) {
        const fields = issue.fields as any;
        const comments = fields.comment?.comments ?? [];
        const assignee = fields.assignee?.displayName ?? 'Unassigned';
        const priority = fields.priority?.name ?? 'Unknown';
        const issueType = fields.issuetype?.name ?? 'Unknown';

        // A comment on a resolved ticket is the resolution itself. Golden Rules measure
        // in-flight communication — ownership, next action, timeframe — none of which
        // apply to "this is now closed". QA owns the quality of the closure.
        if (fields.status?.statusCategory?.key === 'done') {
          skippedResolved += comments.length;
          continue;
        }

        // Score only the most recent public agent comment on the ticket. Scoring every
        // comment in the window over-weighted chatty tickets and repeatedly re-graded
        // the same conversation; a newer comment gets its own score on a later run.
        const eligibleComments: any[] = [];
        for (const comment of comments) {
          const filterResult = this.classifyComment(comment, windowStart, windowEnd, agentLookup);
          if (filterResult === 'no_id') { skippedNoId++; continue; }
          if (filterResult === 'date') { skippedDate++; continue; }
          if (filterResult === 'internal') { skippedInternal++; continue; }
          if (filterResult === 'customer') { skippedCustomer++; continue; }
          if (filterResult === 'bot') { skippedBot++; continue; }
          if (filterResult === 'not_agent') {
            if (skippedNotAgent < 3) {
              const accountId = comment.author?.accountId ?? '';
              const dispName = comment.author?.displayName ?? '';
              console.log(`[gr-pipeline] Agent key miss: accountId="${accountId}", displayName="${dispName}", keys sample: [${[...agentLookup.keys].slice(0, 3).join(', ')}]`);
            }
            skippedNotAgent++;
            continue;
          }
          if (!extractText(comment.body).trim()) { skippedEmpty++; continue; }
          eligibleComments.push(comment);
        }

        if (eligibleComments.length === 0) continue;
        eligibleComments.sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());
        const latest = eligibleComments[eligibleComments.length - 1];
        skippedNotLatest += eligibleComments.length - 1;

        const comment = latest;
        try {
          const commentBody = extractText(comment.body);

          const alreadyScored = await this.isAlreadyScored(p, s, issue.key, comment.id);
          if (alreadyScored) { skippedAlready++; continue; }

          const agentEmail = await this.lookupAgentEmail(p, comment.author?.accountId);

          const grResult = await this.scoreComment(issue.key, comment.id, commentBody, priority, issueType);
          if (!grResult) continue;

          await this.saveResult(p, s, {
            issueKey: issue.key,
            commentId: comment.id,
            result: grResult,
            assignee,
            updater: comment.author?.displayName ?? 'Unknown',
            commentBody,
            agentEmail,
            priority,
            issueType,
            commentTimestamp: comment.created ? new Date(comment.created) : new Date(),
            passThreshold,
          });
          eligible++;
          rowsAffected++;
          const scoredAgentName = comment.author?.displayName;
          if (scoredAgentName) scoredAgentNames.add(scoredAgentName);
        } catch (err) {
          console.warn(`[gr-pipeline] Failed to score ${issue.key}/${comment.id}:`, err instanceof Error ? err.message : err);
        }
      }

      const totalComments = skippedNoId + skippedDate + skippedInternal + skippedCustomer + skippedBot + skippedNotAgent + skippedAlready + skippedEmpty + skippedResolved + skippedNotLatest + eligible;
      console.log(`[gr-pipeline] Comment filter stats: ${totalComments} total, ${eligible} eligible, skipped: noId=${skippedNoId} date=${skippedDate} internal=${skippedInternal} customer=${skippedCustomer} bot=${skippedBot} notAgent=${skippedNotAgent} already=${skippedAlready} empty=${skippedEmpty} resolvedTicket=${skippedResolved} notLatest=${skippedNotLatest}`);
      console.log(`[gr-pipeline] Coverage: ${eligible + skippedAlready} latest-comment candidates — ${eligible} newly scored, ${skippedAlready} already scored on a previous run`);
      console.log(`[gr-pipeline] Scored ${rowsAffected} comments from ${issues.length} issues → ${s || 'live'}`);

      if (this.coachingEngine && scoredAgentNames.size > 0) {
        console.log(`[gr-pipeline] Triggering coaching synthesis for ${scoredAgentNames.size} agents: ${[...scoredAgentNames].join(', ')}`);
        try {
          const synthesised = await this.coachingEngine.synthesiseForAgents([...scoredAgentNames]);
          console.log(`[gr-pipeline] Coaching synthesis complete: ${synthesised}/${scoredAgentNames.size} agents`);
        } catch (err) {
          console.warn(`[gr-pipeline] Coaching synthesis failed:`, err instanceof Error ? err.message : err);
        }
      }

      await this.logRun(started, 'success', rowsAffected);
      return rowsAffected;
    } catch (err) {
      console.error('[gr-pipeline] Scoring failed:', err instanceof Error ? err.message : err);
      await this.logRun(started, 'error', rowsAffected, err instanceof Error ? err.message : String(err));
      return rowsAffected;
    }
  }

  private classifyComment(
    comment: any,
    windowStart: Date,
    windowEnd: Date,
    agentLookup: { keys: Set<string>; displayNames: Set<string> },
  ): 'eligible' | 'no_id' | 'date' | 'internal' | 'customer' | 'bot' | 'not_agent' {
    if (!comment.id) return 'no_id';

    const created = comment.created ? new Date(comment.created) : null;
    if (!created || created < windowStart || created >= windowEnd) return 'date';

    if (comment.jsdPublic === false) return 'internal';

    const authorType = comment.author?.accountType;
    if (authorType === 'customer') return 'customer';

    const displayName = (comment.author?.displayName ?? '').toLowerCase();
    if (BOT_PATTERNS.some(pat => displayName.includes(pat))) return 'bot';

    const accountId = comment.author?.accountId ?? '';
    if (!accountId) return 'no_id';
    const encodedId = accountId.replace(/:/g, '%3A');
    const decodedId = accountId.replace(/%3A/gi, ':');
    if (agentLookup.keys.has(accountId) || agentLookup.keys.has(encodedId) || agentLookup.keys.has(decodedId)) return 'eligible';
    if (displayName && agentLookup.displayNames.has(displayName)) return 'eligible';

    return 'not_agent';
  }

  /**
   * Widen the score columns and allow rule 3 to be null.
   *
   * OverallScore and the rule scores were TINYINT NOT NULL, which silently truncated a
   * mean of 2.33 to 2 and left no way to record "this rule does not apply". Idempotent
   * and safe to re-run, matching the ALTER-guarded pattern used elsewhere for KPI tables.
   */
  async ensureScoreColumns(): Promise<void> {
    try {
      const p = await getKpiPool(this.settings);
      for (const tbl of ['Jira_QA_GoldenRules', 'Jira_QA_GoldenRulesUAT']) {
        await p.request().query(`
          IF OBJECT_ID('dbo.${tbl}') IS NOT NULL BEGIN
            IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
                       WHERE c.object_id = OBJECT_ID('dbo.${tbl}') AND c.name = 'OverallScore' AND t.name = 'tinyint')
              ALTER TABLE dbo.${tbl} ALTER COLUMN OverallScore DECIMAL(4,2) NOT NULL;
            IF EXISTS (SELECT 1 FROM sys.columns c
                       WHERE c.object_id = OBJECT_ID('dbo.${tbl}') AND c.name = 'Rule3Score' AND c.is_nullable = 0)
              ALTER TABLE dbo.${tbl} ALTER COLUMN Rule3Score TINYINT NULL;
            IF COL_LENGTH('${tbl}', 'rule3NotApplicableReason') IS NULL
              ALTER TABLE dbo.${tbl} ADD rule3NotApplicableReason NVARCHAR(300) NULL;
          END
        `);
      }
      console.log('[gr-pipeline] Score columns ensured (OverallScore DECIMAL, Rule3Score nullable)');
    } catch (err) {
      console.warn('[gr-pipeline] ensureScoreColumns failed (may need a manual ALTER):', err instanceof Error ? err.message : err);
    }
  }

  private async getPassThreshold(p: sql.ConnectionPool, suffix: string): Promise<number> {
    try {
      const configTable = `QA_Config${suffix}`;
      const result = await p.request()
        .input('key', sql.NVarChar, 'layer1_pass_threshold')
        .query(`SELECT ConfigValue FROM dbo.${configTable} WHERE ConfigKey = @key`);
      const val = result.recordset[0]?.ConfigValue;
      return val ? parseInt(val, 10) : 2;
    } catch {
      return 2;
    }
  }

  private async getAgentKeys(p: sql.ConnectionPool): Promise<{ keys: Set<string>; displayNames: Set<string> }> {
    try {
      const result = await p.request().query(
        `SELECT AgentKey, AgentName, AgentSurname, AccountId FROM dbo.Agent WHERE IsActive = 1`,
      );
      const keys = new Set<string>();
      const displayNames = new Set<string>();
      for (const row of result.recordset) {
        // Comments carry the Jira accountId (e.g. "712020:uuid"); match against AccountId.
        if (row.AccountId) {
          keys.add(row.AccountId);
          keys.add(row.AccountId.replace(/:/g, '%3A'));
        }
        // Fallback match by display name, built from AgentName + AgentSurname.
        const fullName = [row.AgentName, row.AgentSurname].filter(Boolean).join(' ').trim();
        if (fullName) {
          displayNames.add(fullName.toLowerCase());
        }
      }
      const sampleKeys = [...keys].slice(0, 5);
      const sampleRow = result.recordset[0];
      console.log(`[gr-pipeline] Agent lookup: ${result.recordset.length} active agents, ${keys.size} keys, ${displayNames.size} names. Sample keys: [${sampleKeys.join(', ')}]. Columns present: AccountId=${!!sampleRow?.AccountId}, AgentName=${!!sampleRow?.AgentName}`);
      return { keys, displayNames };
    } catch (err) {
      console.warn('[gr-pipeline] getAgentKeys failed:', err instanceof Error ? err.message : err);
      return { keys: new Set(), displayNames: new Set() };
    }
  }

  private async lookupAgentEmail(p: sql.ConnectionPool, accountId: string | undefined): Promise<string | null> {
    if (!accountId) return null;
    try {
      const encodedId = accountId.replace(/:/g, '%3A');
      const result = await p.request()
        .input('key1', sql.NVarChar, accountId)
        .input('key2', sql.NVarChar, encodedId)
        .query(`SELECT TOP 1 AgentKey FROM dbo.Agent WHERE AccountId IN (@key1, @key2)`);
      return result.recordset[0]?.AgentKey ?? null;
    } catch {
      return null;
    }
  }

  private async isAlreadyScored(p: sql.ConnectionPool, suffix: string, issueKey: string, commentId: string): Promise<boolean> {
    try {
      const result = await p.request()
        .input('issueKey', sql.NVarChar, issueKey)
        .input('commentId', sql.NVarChar, commentId)
        .query(`SELECT 1 FROM dbo.Jira_QA_GoldenRules${suffix} WHERE IssueKey = @issueKey AND CommentId = @commentId`);
      return result.recordset.length > 0;
    } catch {
      return false;
    }
  }

  private async scoreComment(
    issueKey: string,
    commentId: string,
    commentBody: string,
    priority: string,
    issueType: string,
  ): Promise<GrResult | null> {
    const prompt = loadPrompt('gr-comment');
    const input = JSON.stringify({
      issueKey,
      commentId,
      commentBody: commentBody.slice(0, 3000),
      ticketPriority: priority,
      ticketType: issueType,
      passThreshold: 2,
    });

    const result = await this.llmService.call<GrResult>(
      prompt,
      input,
      GrResultSchema,
      { temperature: 0.1, ticketId: issueKey, callType: 'gr_comment_scoring' },
    );

    return result.data;
  }

  private async saveResult(
    p: sql.ConnectionPool,
    suffix: string,
    data: {
      issueKey: string;
      commentId: string;
      result: GrResult;
      assignee: string;
      updater: string;
      commentBody: string;
      agentEmail: string | null;
      priority: string;
      issueType: string;
      commentTimestamp: Date;
      passThreshold: number;
    },
  ): Promise<void> {
    const r = data.result;
    const request = p.request();
    request.input('issueKey', sql.NVarChar(50), data.issueKey);
    request.input('commentId', sql.NVarChar(50), data.commentId);
    request.input('overallScore', sql.Float, overallOf(r));
    request.input('rule1Score', sql.Float, r.rule1Score);
    request.input('rule2Score', sql.Float, r.rule2Score);
    request.input('rule3Score', sql.Float, r.rule3Score);   // null when the rule does not apply
    request.input('rule3Reason', sql.NVarChar(300), r.rule3NotApplicableReason?.slice(0, 300) ?? null);
    request.input('summary', sql.NVarChar(2000), r.summary.slice(0, 2000));
    request.input('suggestedRewrite', sql.NVarChar(2000), r.suggestedRewrite.slice(0, 2000));
    request.input('assignee', sql.NVarChar(200), data.assignee);
    request.input('updater', sql.NVarChar(200), data.updater);
    request.input('commentBody', sql.NVarChar(sql.MAX), data.commentBody);
    request.input('agentEmail', sql.NVarChar(200), data.agentEmail);
    request.input('ticketPriority', sql.NVarChar(50), data.priority);
    request.input('ticketType', sql.NVarChar(50), data.issueType);
    request.input('rule1Pass', sql.Bit, r.rule1Score >= data.passThreshold ? 1 : 0);
    request.input('rule2Pass', sql.Bit, r.rule2Score >= data.passThreshold ? 1 : 0);
    // null, not 0 — "did not apply" is not the same as "failed".
    request.input('rule3Pass', sql.Bit, r.rule3Score == null ? null : (r.rule3Score >= data.passThreshold ? 1 : 0));
    request.input('commentTimestamp', sql.DateTime, data.commentTimestamp);

    await request.query(`
      INSERT INTO dbo.Jira_QA_GoldenRules${suffix} (
        IssueKey, CommentId, OverallScore, Rule1Score, Rule2Score, Rule3Score,
        Summary, SuggestedRewrite, Assignee, Updater, CommentBody,
        agentEmail, ticketPriority, ticketType,
        rule1Pass, rule2Pass, rule3Pass, rule3NotApplicableReason,
        commentTimestamp, processedAt, CreatedAt
      ) VALUES (
        @issueKey, @commentId, @overallScore, @rule1Score, @rule2Score, @rule3Score,
        @summary, @suggestedRewrite, @assignee, @updater, @commentBody,
        @agentEmail, @ticketPriority, @ticketType,
        @rule1Pass, @rule2Pass, @rule3Pass, @rule3Reason,
        @commentTimestamp, SYSUTCDATETIME(), @commentTimestamp
      )
    `);
  }

  private async logRun(started: Date, status: 'success' | 'error', rowsAffected: number, errorMessage?: string): Promise<void> {
    await this.monitor?.logRun({
      pipeline_name: 'gr-comment-scoring',
      started_at: started,
      completed_at: new Date(),
      status,
      rows_affected: rowsAffected,
      error_message: errorMessage ?? null,
      duration_ms: Date.now() - started.getTime(),
    });
  }

}
