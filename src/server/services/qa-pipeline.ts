import sql from 'mssql';
import type { SettingsQueries } from '../db/settings-store.js';
import { TokenBudgetExceededError, type LlmService } from './llm-service.js';
import type { JiraRestClient } from './jira-client.js';
import { QaTicketResultSchema, qaOverallOf, qaGradeOf, type QaTicketResult } from './qa-schemas.js';
import { loadPrompt } from './prompt-loader.js';
import type { PipelineMonitor, PipelineTarget } from './pipeline-monitor.js';
import { tableSuffix } from './pipeline-monitor.js';
import { extractText } from './shared/adf-utils.js';
import { execute } from './database.js';
import { logError } from './error-log.js';

// Assignees that are not human agents — their closes belong to the AI-learning
// pipeline, not agent QA. Mirrors BOT_PATTERNS in gr-pipeline.ts.
const BOT_ASSIGNEES = ['nova', 'automation', 'nurtur support', 'jira service', 'servicedesk', 'bot'];


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

export class QaPipeline {
  constructor(
    private settings: SettingsQueries,
    private llmService: LlmService,
    private jiraClient: JiraRestClient,
    private jiraProject: string = 'NT',
    private monitor?: PipelineMonitor,
  ) {}

  private get target(): PipelineTarget {
    const val = this.settings.get('qa_pipeline_target');
    return val === 'live' ? 'live' : 'uat';
  }

  private get s(): string {
    return tableSuffix(this.target);
  }

  async scoreRecentlyResolved(lookbackHours: number = 24, opts: { force?: boolean } = {}): Promise<QaTicketResult[]> {
    const started = new Date();
    let rowsAffected = 0;
    let failed = 0;
    try {
      // Match on the status TRANSITION, not `resolved`. NOVA's own closes and other
      // automated transitions never set resolutiondate — 232 of 241 tickets missed in
      // the 7 days to 2026-07-31 were missing for exactly this reason, and the gap fell
      // unevenly across agents (13%-100% coverage), making per-agent QA non-comparable.
      const days = Math.max(1, Math.ceil(lookbackHours / 24));
      const jql = `project = ${this.jiraProject} AND status CHANGED TO ("Done", "Closed", "Resolved") DURING (-${days}d, now()) ORDER BY updated DESC`;
      console.log(`[qa-pipeline] Searching: ${jql.slice(0, 160)} → target=${this.target}`);
      const result = await this.jiraClient.searchJqlAll(jql, [
        'summary', 'description', 'issuetype', 'priority', 'status',
        'resolution', 'assignee', 'reporter', 'comment', 'created', 'resolutiondate',
      ], 2000);
      const issues = result?.issues ?? [];
      console.log(`[qa-pipeline] Jira returned ${issues.length} tickets closed in the last ${days}d`);

      if (issues.length === 0) {
        await this.monitor?.logRun({
          pipeline_name: 'qa-scoring', started_at: started, completed_at: new Date(),
          status: 'success', rows_affected: 0, error_message: null,
          duration_ms: Date.now() - started.getTime(),
        });
        return [];
      }

      // Agent QA only covers human-worked tickets. NOVA's own closes are scored by the
      // AI-learning pipeline, not here — counting them as agent work skews the team stats.
      const humanIssues = issues.filter(i => !this.isBotAssignee((i.fields as any)?.assignee?.displayName));
      const skippedBot = issues.length - humanIssues.length;

      const alreadyScored = opts.force ? new Set<string>() : await this.getAlreadyScored(humanIssues.map(i => i.key));
      const toScore = humanIssues.filter(i => !alreadyScored.has(i.key));

      console.log(`[qa-pipeline] ${issues.length} closed → ${humanIssues.length} human-worked (${skippedBot} bot/unassigned) → ${toScore.length} to score, ${alreadyScored.size} already scored${opts.force ? ' [FORCE]' : ''}`);

      if (toScore.length === 0) {
        await this.monitor?.logRun({
          pipeline_name: 'qa-scoring', started_at: started, completed_at: new Date(),
          status: 'success', rows_affected: 0, error_message: null,
          duration_ms: Date.now() - started.getTime(),
        });
        return [];
      }

      const results: QaTicketResult[] = [];
      let budgetStopped = false;

      for (const issue of toScore) {
        try {
          if (this.isChatTicket(issue)) {
            await this.saveExcludedResult(issue);
            rowsAffected++;
            continue;
          }
          const qaResult = await this.scoreSingle(issue);
          if (qaResult) {
            await this.saveQaResult(issue, qaResult);
            results.push(qaResult);
            rowsAffected++;
          } else {
            failed++;
            await logError('qa-pipeline', new Error('scoreSingle returned no result'), { entityRef: issue.key });
          }
        } catch (err) {
          // The daily token budget is spent — every remaining ticket in this run
          // would throw the same error before reaching a provider. Stop here
          // rather than walking the rest of the list: that turned one budget cap
          // into ~3,400 identical error_log rows a week and buried real failures.
          if (err instanceof TokenBudgetExceededError) {
            budgetStopped = true;
            break;
          }
          // Was a console.warn only, so silent gaps in coverage looked like full coverage.
          failed++;
          await logError('qa-pipeline', err, { entityRef: issue.key, context: { stage: 'scoreSingle' } });
        }
      }

      const unscored = budgetStopped ? toScore.length - results.length : 0;
      const coveragePct = toScore.length > 0 ? Math.round(results.length / toScore.length * 100) : 100;
      console.log(`[qa-pipeline] Scored ${results.length}/${toScore.length} (${coveragePct}% coverage, ${failed} failed)${budgetStopped ? `, STOPPED on daily token budget — ${unscored} ticket(s) left unscored` : ''} → ${this.s || 'live'}`);

      // One row per run when the budget stops us, not one per ticket. Without it
      // the cap is invisible: a short run looks identical to full coverage.
      if (budgetStopped) {
        await logError('qa-pipeline', new Error(`Daily token budget spent — ${unscored} ticket(s) left unscored this run`), {
          context: { stage: 'budget', scored: results.length, unscored, toScore: toScore.length },
        });
      }

      await this.monitor?.logRun({
        pipeline_name: 'qa-scoring', started_at: started, completed_at: new Date(),
        status: failed > 0 || budgetStopped ? 'error' : 'success', rows_affected: rowsAffected,
        error_message: budgetStopped
          ? `Daily token budget spent — ${unscored} ticket(s) unscored${failed > 0 ? `, ${failed} failed` : ''}`
          : failed > 0 ? `${failed} ticket(s) failed to score` : null,
        duration_ms: Date.now() - started.getTime(),
      });
      return results;
    } catch (err) {
      console.error('[qa-pipeline] Scoring failed:', err instanceof Error ? err.message : err);
      await this.monitor?.logRun({
        pipeline_name: 'qa-scoring', started_at: started, completed_at: new Date(),
        status: 'error', rows_affected: rowsAffected, error_message: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - started.getTime(),
      });
      return [];
    }
  }

  async scoreSingle(issue: any): Promise<QaTicketResult | null> {
    const fields = issue.fields as any ?? issue;
    const summary = fields.summary ?? '';
    const description = extractText(fields.description);
    const assignee = fields.assignee?.displayName ?? 'Unassigned';

    const comments = fields.comment?.comments ?? [];
    const thread = comments.slice(-15).map((c: any) => {
      const body = extractText(c.body);
      const isInternal = c.properties?.some((p: any) =>
        p.key === 'sd.public.comment' && p.value?.internal === true
      ) ?? false;
      return `[${c.created ?? ''}] ${c.author?.displayName ?? 'Unknown'}${isInternal ? ' (internal)' : ''}:\n${body.slice(0, 500)}`;
    }).join('\n\n---\n\n');

    const prompt = loadPrompt('qa-ticket', {
      ticket_key: issue.key ?? '',
      summary,
      description: description.slice(0, 3000),
      priority: fields.priority?.name ?? 'Unknown',
      request_type: fields.issuetype?.name ?? 'Unknown',
      assignee,
      created: fields.created ?? 'Unknown',
      resolved: fields.resolutiondate ?? 'Unknown',
      resolution: fields.resolution?.name ?? 'Unknown',
      conversation_thread: thread.slice(0, 6000) || 'No comments',
    });

    const result = await this.llmService.call<QaTicketResult>(
      prompt,
      `Score this resolved ticket for QA.\n\nTicket: ${issue.key} — ${summary}`,
      QaTicketResultSchema,
      { temperature: 0.1, ticketId: issue.key, callType: 'qa_scoring' },
    );

    return result.data;
  }

  async getQaResults(limit: number = 50): Promise<any[]> {
    try {
      const p = await getKpiPool(this.settings);
      const s = this.s;
      const request = p.request();
      request.input('limit', sql.Int, limit);
      const result = await request.query(`
        SELECT TOP (@limit) *
        FROM dbo.jira_qa_results${s}
        ORDER BY CreatedAt DESC
      `);
      return result.recordset;
    } catch { return []; }
  }

  private isBotAssignee(displayName: string | undefined): boolean {
    if (!displayName) return true; // Unassigned — no agent to attribute the score to.
    const lower = displayName.toLowerCase();
    return BOT_ASSIGNEES.some(pat => lower.includes(pat));
  }

  private isChatTicket(issue: any): boolean {
    const fields = issue.fields as any;
    const cf13482 = fields.customfield_13482;
    let requestType = '';
    if (typeof cf13482 === 'string') requestType = cf13482;
    else if (cf13482?.value) requestType = cf13482.value;
    else if (cf13482?.name) requestType = cf13482.name;
    if (!requestType) {
      requestType = fields.customfield_12800?.requestType?.name ?? '';
    }
    return requestType.toLowerCase() === 'chat';
  }

  private async saveExcludedResult(issue: any): Promise<void> {
    const p = await getKpiPool(this.settings);
    const s = this.s;
    const fields = issue.fields as any;
    const assignee = fields.assignee?.displayName ?? 'Unassigned';

    const request = p.request();
    request.input('issueKey', sql.NVarChar, issue.key);
    request.input('assigneeName', sql.NVarChar, assignee);
    request.input('statusName', sql.NVarChar(100), (fields.status?.name ?? '').slice(0, 100));
    request.input('ticketSummary', sql.NVarChar(500), (fields.summary ?? '').slice(0, 500));
    request.input('ticketType', sql.NVarChar(50), (fields.issuetype?.name ?? '').slice(0, 50));
    request.input('ticketPriority', sql.NVarChar(50), (fields.priority?.name ?? '').slice(0, 50));

    await request.query(`
      INSERT INTO dbo.jira_qa_results${s}
        (issueKey, assigneeName, statusName, summary, qaType, overallScore,
         accuracyScore, clarityScore, toneScore, closureScore,
         grade, isConcerning, severity, category,
         ticketType, ticketPriority, processedAt, CreatedAt)
      VALUES
        (@issueKey, @assigneeName, @statusName, @ticketSummary, 'excluded', 0,
         0, 0, 0, 0,
         'EXCLUDED', 0, NULL, 'Chat',
         @ticketType, @ticketPriority, SYSUTCDATETIME(), GETUTCDATE())
    `);
  }

  private async getAlreadyScored(ticketKeys: string[]): Promise<Set<string>> {
    if (ticketKeys.length === 0) return new Set();
    try {
      const p = await getKpiPool(this.settings);
      const s = this.s;
      const keyList = ticketKeys.map(k => `'${k.replace(/'/g, "''")}'`).join(',');
      const result = await p.request().query(
        // 30 days, not 1 — a 1-day window let multi-day backfills re-insert rows for
        // tickets already scored, which is how duplicate issueKeys accumulated.
        // Use opts.force on scoreRecentlyResolved to deliberately re-score.
        `SELECT DISTINCT issueKey FROM dbo.jira_qa_results${s} WHERE issueKey IN (${keyList}) AND qaType IN ('resolved', 'excluded', 'ticket_full') AND CreatedAt >= DATEADD(day, -30, GETDATE())`,
      );
      return new Set(result.recordset.map((r: any) => r.issueKey));
    } catch {
      return new Set();
    }
  }

  private async saveQaResult(issue: any, qa: QaTicketResult): Promise<void> {
    const p = await getKpiPool(this.settings);
    const s = this.s;
    const fields = issue.fields as any;
    const assignee = fields.assignee?.displayName ?? 'Unassigned';

    // Grade is derived from the weighted score, never taken from the LLM — the two
    // used to disagree on ~11% of tickets.
    const computedScore = qaOverallOf(qa);
    const computedGrade = qaGradeOf(computedScore);

    const resolutionChecksJson = JSON.stringify(qa.resolutionChecks ?? {});

    const request = p.request();
    request.input('issueKey', sql.NVarChar, issue.key);
    request.input('assigneeName', sql.NVarChar, assignee);
    request.input('statusName', sql.NVarChar(100), (fields.status?.name ?? '').slice(0, 100));
    request.input('ticketSummary', sql.NVarChar(500), (fields.summary ?? '').slice(0, 500));
    request.input('qaType', sql.NVarChar, 'resolved');
    request.input('overallScore', sql.Float, computedScore);
    request.input('accuracyScore', sql.Float, qa.accuracyScore);
    request.input('clarityScore', sql.Float, qa.clarityScore);
    request.input('toneScore', sql.Float, qa.toneScore);
    request.input('closureScore', sql.Float, qa.closureScore);
    request.input('grade', sql.NVarChar, computedGrade);
    request.input('isConcerning', sql.Bit, qa.isConcerning ? 1 : 0);
    // severity column is INT (1=low, 2=medium, 3=high); map the LLM's string label.
    const severityMap: Record<string, number> = { low: 1, medium: 2, high: 3 };
    request.input('severity', sql.Int, qa.severity ? (severityMap[qa.severity] ?? null) : null);
    request.input('category', sql.NVarChar, qa.category);
    request.input('issues', sql.NVarChar(2000), (qa.issues ?? '').slice(0, 2000));
    request.input('coachingPoints', sql.NVarChar(2000), null);
    request.input('suggestedReply', sql.NVarChar(2000), null);
    request.input('customerSentiment', sql.NVarChar(20), qa.customerSentiment ?? 'neutral');
    request.input('ticketType', sql.NVarChar(50), (fields.issuetype?.name ?? '').slice(0, 50));
    request.input('ticketPriority', sql.NVarChar(50), (fields.priority?.name ?? '').slice(0, 50));
    request.input('resolutionChecks', sql.NVarChar(sql.MAX), resolutionChecksJson);

    await request.query(`
      INSERT INTO dbo.jira_qa_results${s}
        (issueKey, assigneeName, statusName, summary, qaType, overallScore,
         accuracyScore, clarityScore, toneScore, closureScore,
         grade, isConcerning, severity, category,
         issues, coachingPoints, suggestedReply, customerSentiment,
         ticketType, ticketPriority, resolutionChecks, processedAt, CreatedAt)
      VALUES
        (@issueKey, @assigneeName, @statusName, @ticketSummary, @qaType, @overallScore,
         @accuracyScore, @clarityScore, @toneScore, @closureScore,
         @grade, @isConcerning, @severity, @category,
         @issues, @coachingPoints, @suggestedReply, @customerSentiment,
         @ticketType, @ticketPriority, @resolutionChecks, SYSUTCDATETIME(), GETUTCDATE())
    `);

    await this.writeResolutionDecision(issue, qa, assignee);
  }

  private async writeResolutionDecision(issue: any, qa: QaTicketResult, assignee: string): Promise<void> {
    const rc = qa.resolutionChecks;
    if (!rc) return;

    const checks = [
      { name: 'Clarity', ...rc.clarity },
      { name: 'Customer communication', ...rc.customerCommunication },
      { name: 'Completeness', ...rc.completeness },
      { name: 'Resolution type', ...rc.resolutionTypeMatch },
    ];
    const failedChecks = checks.filter(c => !c.passed);
    const allPassed = failedChecks.length === 0;

    const internalNote = allPassed
      ? `🤖 Resolution Review — All checks passed.\n\n` +
        checks.map(c => `✅ ${c.name}: ${c.detail}`).join('\n')
      : `🤖 Resolution Review — ${failedChecks.length} check(s) failed\n\n` +
        checks.map(c => `${c.passed ? '✅' : '❌'} ${c.name}: ${c.detail}`).join('\n') +
        `\n\n@${assignee} — please review and update the resolution notes on this ticket.`;

    try {
      await execute(
        `INSERT INTO agent_decisions
          (ticket_id, event_type, action, confidence, reasoning, approval_required, shadow_mode, inputs, output)
         VALUES (?, 'resolution_review', ?, 1.0, 'QA pipeline resolution check', 0, 0, ?, ?)`,
        [
          issue.key,
          allPassed ? 'no_action' : 'comment',
          JSON.stringify({ assignee, checks: qa.resolutionChecks }),
          JSON.stringify({ overall_pass: allPassed, failed_checks: failedChecks.map(c => c.name), internal_note: internalNote }),
        ],
      );
    } catch (err) {
      console.warn(`[qa-pipeline] Failed to write resolution decision for ${issue.key}:`, err instanceof Error ? err.message : err);
    }
  }

}
