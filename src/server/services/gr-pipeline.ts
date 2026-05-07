import sql from 'mssql';
import { z } from 'zod';
import type { SettingsQueries } from '../db/settings-store.js';
import type { LlmService } from './llm-service.js';
import type { JiraRestClient } from './jira-client.js';
import { loadPrompt } from './prompt-loader.js';
import type { PipelineMonitor, PipelineTarget } from './pipeline-monitor.js';
import { tableSuffix } from './pipeline-monitor.js';

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

const BOT_PATTERNS = ['nurtur', 'automation', 'jira service', 'servicedesk', 'bot'];

const GrResultSchema = z.object({
  issueKey: z.string(),
  commentId: z.string(),
  overallScore: z.number().min(1).max(3),
  rule1Score: z.number().min(1).max(3),
  rule2Score: z.number().min(1).max(3),
  rule3Score: z.number().min(1).max(3),
  summary: z.string(),
  suggestedRewrite: z.string(),
});
type GrResult = z.infer<typeof GrResultSchema>;

export class GrPipeline {
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
      const agentKeys = await this.getAgentKeys(p);

      for (const issue of issues) {
        const fields = issue.fields as any;
        const comments = fields.comment?.comments ?? [];
        const assignee = fields.assignee?.displayName ?? 'Unassigned';
        const priority = fields.priority?.name ?? 'Unknown';
        const issueType = fields.issuetype?.name ?? 'Unknown';

        for (const comment of comments) {
          try {
            if (!this.isEligibleComment(comment, windowStart, windowEnd, agentKeys)) continue;

            const alreadyScored = await this.isAlreadyScored(p, s, issue.key, comment.id);
            if (alreadyScored) continue;

            const commentBody = this.extractText(comment.body);
            if (!commentBody.trim()) continue;

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
            rowsAffected++;
          } catch (err) {
            console.warn(`[gr-pipeline] Failed to score ${issue.key}/${comment.id}:`, err instanceof Error ? err.message : err);
          }
        }
      }

      console.log(`[gr-pipeline] Scored ${rowsAffected} comments from ${issues.length} issues → ${s || 'live'}`);
      await this.logRun(started, 'success', rowsAffected);
      return rowsAffected;
    } catch (err) {
      console.error('[gr-pipeline] Scoring failed:', err instanceof Error ? err.message : err);
      await this.logRun(started, 'error', rowsAffected, err instanceof Error ? err.message : String(err));
      return rowsAffected;
    }
  }

  private isEligibleComment(
    comment: any,
    windowStart: Date,
    windowEnd: Date,
    agentKeys: Set<string>,
  ): boolean {
    if (!comment.id) return false;

    const created = comment.created ? new Date(comment.created) : null;
    if (!created || created < windowStart || created >= windowEnd) return false;

    if (comment.jsdPublic === false) return false;

    const authorType = comment.author?.accountType;
    if (authorType === 'customer') return false;

    const displayName = (comment.author?.displayName ?? '').toLowerCase();
    if (BOT_PATTERNS.some(pat => displayName.includes(pat))) return false;

    const accountId = comment.author?.accountId ?? '';
    if (!accountId) return false;
    const encodedId = accountId.replace(/:/g, '%3A');
    if (!agentKeys.has(accountId) && !agentKeys.has(encodedId)) return false;

    return true;
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

  private async getAgentKeys(p: sql.ConnectionPool): Promise<Set<string>> {
    try {
      const result = await p.request().query(`SELECT AgentKey FROM dbo.Agent WHERE IsActive = 1`);
      const keys = new Set<string>();
      for (const row of result.recordset) {
        if (row.AgentKey) {
          keys.add(row.AgentKey);
          keys.add(row.AgentKey.replace(/:/g, '%3A'));
        }
      }
      return keys;
    } catch {
      return new Set();
    }
  }

  private async lookupAgentEmail(p: sql.ConnectionPool, accountId: string | undefined): Promise<string | null> {
    if (!accountId) return null;
    try {
      const encodedId = accountId.replace(/:/g, '%3A');
      const result = await p.request()
        .input('key1', sql.NVarChar, accountId)
        .input('key2', sql.NVarChar, encodedId)
        .query(`SELECT TOP 1 AgentKey FROM dbo.Agent WHERE AgentKey IN (@key1, @key2)`);
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
    request.input('overallScore', sql.Float, Math.min(r.rule1Score, r.rule2Score, r.rule3Score));
    request.input('rule1Score', sql.Float, r.rule1Score);
    request.input('rule2Score', sql.Float, r.rule2Score);
    request.input('rule3Score', sql.Float, r.rule3Score);
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
    request.input('rule3Pass', sql.Bit, r.rule3Score >= data.passThreshold ? 1 : 0);
    request.input('commentTimestamp', sql.DateTime, data.commentTimestamp);

    await request.query(`
      INSERT INTO dbo.Jira_QA_GoldenRules${suffix} (
        IssueKey, CommentId, OverallScore, Rule1Score, Rule2Score, Rule3Score,
        Summary, SuggestedRewrite, Assignee, Updater, CommentBody,
        agentEmail, ticketPriority, ticketType,
        rule1Pass, rule2Pass, rule3Pass,
        commentTimestamp, processedAt, CreatedAt
      ) VALUES (
        @issueKey, @commentId, @overallScore, @rule1Score, @rule2Score, @rule3Score,
        @summary, @suggestedRewrite, @assignee, @updater, @commentBody,
        @agentEmail, @ticketPriority, @ticketType,
        @rule1Pass, @rule2Pass, @rule3Pass,
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

  private extractText(adf: any): string {
    if (!adf) return '';
    if (typeof adf === 'string') return adf;
    if (adf.content) {
      return adf.content.map((block: any) =>
        block.content?.map((node: any) => node.text ?? '').join('') ?? ''
      ).join('\n');
    }
    return '';
  }
}
