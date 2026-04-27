import sql from 'mssql';
import type { SettingsQueries } from '../db/settings-store.js';
import type { LlmService } from './llm-service.js';
import type { JiraRestClient } from './jira-client.js';
import { QaTicketResultSchema, type QaTicketResult } from './qa-schemas.js';
import { loadPrompt } from './prompt-loader.js';
import type { PipelineMonitor, PipelineTarget } from './pipeline-monitor.js';
import { tableSuffix } from './pipeline-monitor.js';
import { executeAndGetId } from './database.js';

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

  async scoreRecentlyResolved(lookbackHours: number = 24): Promise<QaTicketResult[]> {
    const started = new Date();
    let rowsAffected = 0;
    try {
      const since = new Date(Date.now() - lookbackHours * 3600000)
        .toISOString().replace('T', ' ').slice(0, 19);

      const jql = `project = ${this.jiraProject} AND status IN (Done, Closed, Resolved) AND resolved >= "${since}" ORDER BY resolved DESC`;
      const result = await this.jiraClient.searchJql(jql, [
        'summary', 'description', 'issuetype', 'priority', 'status',
        'resolution', 'assignee', 'reporter', 'comment', 'created', 'resolutiondate',
      ], 50);
      const issues = result?.issues ?? [];

      if (issues.length === 0) {
        await this.monitor?.logRun({
          pipeline_name: 'qa-scoring', started_at: started, completed_at: new Date(),
          status: 'success', rows_affected: 0, error_message: null,
          duration_ms: Date.now() - started.getTime(),
        });
        return [];
      }

      const alreadyScored = await this.getAlreadyScored(issues.map(i => i.key));
      const toScore = issues.filter(i => !alreadyScored.has(i.key));

      if (toScore.length === 0) {
        console.log(`[qa-pipeline] All ${issues.length} resolved tickets already scored`);
        await this.monitor?.logRun({
          pipeline_name: 'qa-scoring', started_at: started, completed_at: new Date(),
          status: 'success', rows_affected: 0, error_message: null,
          duration_ms: Date.now() - started.getTime(),
        });
        return [];
      }

      const results: QaTicketResult[] = [];

      for (const issue of toScore) {
        try {
          const qaResult = await this.scoreSingle(issue);
          if (qaResult) {
            await this.saveQaResult(issue, qaResult);
            results.push(qaResult);
            rowsAffected++;
          }
        } catch (err) {
          console.warn(`[qa-pipeline] Failed to score ${issue.key}:`, err instanceof Error ? err.message : err);
        }
      }

      console.log(`[qa-pipeline] Scored ${results.length}/${toScore.length} → ${this.s || 'live'}`);

      await this.monitor?.logRun({
        pipeline_name: 'qa-scoring', started_at: started, completed_at: new Date(),
        status: 'success', rows_affected: rowsAffected, error_message: null,
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
    const description = this.extractText(fields.description);
    const assignee = fields.assignee?.displayName ?? 'Unassigned';

    const comments = fields.comment?.comments ?? [];
    const thread = comments.slice(-15).map((c: any) => {
      const body = this.extractText(c.body);
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

  private async getAlreadyScored(ticketKeys: string[]): Promise<Set<string>> {
    if (ticketKeys.length === 0) return new Set();
    try {
      const p = await getKpiPool(this.settings);
      const s = this.s;
      const keyList = ticketKeys.map(k => `'${k.replace(/'/g, "''")}'`).join(',');
      const result = await p.request().query(
        `SELECT DISTINCT issueKey FROM dbo.jira_qa_results${s} WHERE issueKey IN (${keyList}) AND CreatedAt >= DATEADD(day, -1, GETDATE())`,
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

    const request = p.request();
    request.input('issueKey', sql.NVarChar, issue.key);
    request.input('assigneeName', sql.NVarChar, assignee);
    request.input('qaType', sql.NVarChar, 'resolved');
    request.input('overallScore', sql.Float, qa.overallScore);
    request.input('accuracyScore', sql.Float, qa.accuracyScore);
    request.input('clarityScore', sql.Float, qa.clarityScore);
    request.input('toneScore', sql.Float, qa.toneScore);
    request.input('grade', sql.NVarChar, qa.grade);
    request.input('isConcerning', sql.Bit, qa.isConcerning ? 1 : 0);
    request.input('severity', sql.NVarChar, qa.severity ?? null);
    request.input('category', sql.NVarChar, qa.category);

    await request.query(`
      INSERT INTO dbo.jira_qa_results${s}
        (issueKey, assigneeName, qaType, overallScore, accuracyScore, clarityScore, toneScore,
         grade, isConcerning, severity, category, CreatedAt)
      VALUES
        (@issueKey, @assigneeName, @qaType, @overallScore, @accuracyScore, @clarityScore, @toneScore,
         @grade, @isConcerning, @severity, @category, GETUTCDATE())
    `);

    const grRequest = p.request();
    grRequest.input('issueKey', sql.NVarChar, issue.key);
    grRequest.input('overallScore', sql.Float, qa.overallScore);
    const gr = qa.goldenRules;
    grRequest.input('rule1Score', sql.Float, gr.ownership);
    grRequest.input('rule2Score', sql.Float, gr.nextAction);
    grRequest.input('rule3Score', sql.Float, gr.timeframe);
    grRequest.input('rule1Pass', sql.Bit, gr.ownership >= 2 ? 1 : 0);
    grRequest.input('rule2Pass', sql.Bit, gr.nextAction >= 2 ? 1 : 0);
    grRequest.input('rule3Pass', sql.Bit, gr.timeframe >= 2 ? 1 : 0);
    grRequest.input('summary', sql.NVarChar, qa.summary.slice(0, 2000));
    grRequest.input('assignee', sql.NVarChar, assignee);

    await grRequest.query(`
      INSERT INTO dbo.Jira_QA_GoldenRules${s}
        (IssueKey, OverallScore, Rule1Score, Rule2Score, Rule3Score,
         rule1Pass, rule2Pass, rule3Pass, Summary, Assignee, CreatedAt)
      VALUES
        (@issueKey, @overallScore, @rule1Score, @rule2Score, @rule3Score,
         @rule1Pass, @rule2Pass, @rule3Pass, @summary, @assignee, GETUTCDATE())
    `);

    try {
      const goldenRuleScores = JSON.stringify({
        ownership: gr.ownership,
        nextAction: gr.nextAction,
        timeframe: gr.timeframe,
        overall: qa.overallScore,
        feedback: qa.summary.slice(0, 500),
        strengths: [],
        improvements: [],
      });
      const nudgeType = qa.isConcerning ? 'golden_rules' : null;
      const message = qa.isConcerning ? `QA concern on ${issue.key}: ${qa.summary.slice(0, 200)}` : null;

      await executeAndGetId(`
        INSERT INTO agent_coaching (ticket_id, agent_user_id, nudge_type, golden_rule_scores, message, delivered, delivery_method)
        VALUES (?, 0, ?, ?, ?, 0, 'qa_pipeline')
      `, [issue.key, nudgeType, goldenRuleScores, message]);
    } catch (err) {
      console.warn(`[qa-pipeline] Coaching bridge failed for ${issue.key}:`, err instanceof Error ? err.message : err);
    }
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
