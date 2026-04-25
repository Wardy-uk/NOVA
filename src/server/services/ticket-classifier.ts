import type { LlmService } from './llm-service.js';
import type { JiraRestClient } from './jira-client.js';
import { ClassificationResultSchema, TrendAnalysisResultSchema, type ClassificationResult, type TrendAnalysisResult } from './classification-schema.js';
import { loadPrompt } from './prompt-loader.js';
import { query, queryOne, executeAndGetId } from './database.js';

export class TicketClassifier {
  constructor(
    private llmService: LlmService,
    private jiraClient: JiraRestClient,
    private jiraProject: string = 'NT',
  ) {}

  async classifyResolved(lookbackHours: number = 24): Promise<ClassificationResult[]> {
    const since = new Date(Date.now() - lookbackHours * 3600000).toISOString().replace('T', ' ').slice(0, 19);

    const jql = `project = ${this.jiraProject} AND status IN (Done, Closed, Resolved) AND resolved >= "${since}" ORDER BY resolved DESC`;
    const result = await this.jiraClient.searchJql(jql, [
      'summary', 'description', 'issuetype', 'priority', 'status',
      'resolution', 'labels', 'assignee', 'reporter', 'comment',
    ], 50);
    const issues = result?.issues ?? [];

    if (issues.length === 0) return [];

    const alreadyClassified = await this.getAlreadyClassified(issues.map((i: any) => i.key));
    const toClassify = issues.filter((i: any) => !alreadyClassified.has(i.key));

    if (toClassify.length === 0) return [];

    const results: ClassificationResult[] = [];

    for (const issue of toClassify) {
      try {
        const result = await this.classifySingle(issue);
        if (result) {
          await this.saveClassification(issue.key, 'resolved', result);
          results.push(result);
        }
      } catch (err) {
        console.warn(`[Classifier] Failed to classify ${issue.key}:`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`[Classifier] Classified ${results.length}/${toClassify.length} resolved tickets`);
    return results;
  }

  async classifySingle(issue: any): Promise<ClassificationResult | null> {
    const fields = issue.fields ?? issue;
    const summary = fields.summary ?? '';
    const description = typeof fields.description === 'string'
      ? fields.description
      : fields.description?.content?.map((b: any) => b.content?.map((c: any) => c.text).join('')).join('\n') ?? '';

    const comments = fields.comment?.comments ?? [];
    const lastComments = comments.slice(-5).map((c: any) => {
      const body = typeof c.body === 'string' ? c.body : c.body?.content?.map((b: any) => b.content?.map((t: any) => t.text).join('')).join('\n') ?? '';
      return `[${c.author?.displayName}]: ${body.slice(0, 500)}`;
    }).join('\n\n');

    const prompt = loadPrompt('classify', {
      ticket_key: issue.key ?? '',
      summary,
      description: description.slice(0, 3000),
      resolution: fields.resolution?.name ?? 'Unknown',
      priority: fields.priority?.name ?? 'Unknown',
      request_type: fields.issuetype?.name ?? 'Unknown',
      labels: (fields.labels ?? []).join(', ') || 'None',
      conversation_thread: lastComments.slice(0, 4000) || 'No comments',
    });

    const result = await this.llmService.call<ClassificationResult>(
      prompt,
      `Classify this resolved support ticket.\n\nTicket: ${issue.key} — ${summary}`,
      ClassificationResultSchema,
      { temperature: 0.1, ticketId: issue.key, callType: 'classification' },
    );

    return result.data;
  }

  async runTrendAnalysis(days: number = 7): Promise<TrendAnalysisResult | null> {
    const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const prevStart = new Date(Date.now() - days * 2 * 86400000).toISOString().slice(0, 10);

    const current = await query<any>(`
      SELECT category, COUNT(*) as cnt
      FROM ticket_classifications
      WHERE created_at >= ? AND classification_type = 'resolved'
      GROUP BY category
      ORDER BY cnt DESC
    `, [startDate]);

    const previous = await query<any>(`
      SELECT category, COUNT(*) as cnt
      FROM ticket_classifications
      WHERE created_at >= ? AND created_at < ? AND classification_type = 'resolved'
      GROUP BY category
    `, [prevStart, startDate]);

    if (current.length === 0) return null;

    const prevMap = new Map(previous.map((r: any) => [r.category, r.cnt]));
    const categoryStats = current.map((r: any) => {
      const prev = prevMap.get(r.category) ?? 0;
      const change = prev > 0 ? Math.round(((r.cnt - prev) / prev) * 100) : 100;
      return `${r.category}: ${r.cnt} tickets (${change > 0 ? '+' : ''}${change}% vs previous ${days} days)`;
    }).join('\n');

    const topIssues = await query<any>(`
      SELECT TOP 10 category, sub_category, software_area, problem_type, COUNT(*) as cnt
      FROM ticket_classifications
      WHERE created_at >= ? AND classification_type = 'resolved'
      GROUP BY category, sub_category, software_area, problem_type
      ORDER BY cnt DESC
    `, [startDate]);

    const issueDetails = topIssues.map((r: any) =>
      `${r.category} > ${r.sub_category} (${r.software_area ?? 'N/A'}) — ${r.problem_type}: ${r.cnt} tickets`
    ).join('\n');

    const prompt = loadPrompt('trend-analysis', {
      period: `${days} days (${startDate} to ${new Date().toISOString().slice(0, 10)})`,
      category_stats: categoryStats || 'No data',
      top_issues: issueDetails || 'No data',
      total_tickets: String(current.reduce((s: number, r: any) => s + r.cnt, 0)),
    });

    const result = await this.llmService.call<TrendAnalysisResult>(
      prompt,
      'Analyse ticket trends for the service desk.',
      TrendAnalysisResultSchema,
      { temperature: 0.3, callType: 'trend_analysis' },
    );

    if (result.data) {
      await this.saveTrendSnapshot(result.data, current, prevMap, days);
    }

    return result.data;
  }

  async getClassifications(ticketKey?: string, limit: number = 50): Promise<any[]> {
    if (ticketKey) {
      return query(`SELECT * FROM ticket_classifications WHERE ticket_key = ? ORDER BY created_at DESC`, [ticketKey]);
    }
    return query(`SELECT * FROM ticket_classifications ORDER BY created_at DESC OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY`, [limit]);
  }

  async getCategoryBreakdown(days: number = 30): Promise<any[]> {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    return query(`
      SELECT category, sub_category, problem_type, COUNT(*) as count,
             AVG(confidence) as avg_confidence
      FROM ticket_classifications
      WHERE created_at >= ? AND classification_type = 'resolved'
      GROUP BY category, sub_category, problem_type
      ORDER BY count DESC
    `, [since]);
  }

  async getTrendSnapshots(days: number = 30): Promise<any[]> {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    return query(`
      SELECT * FROM ticket_trend_snapshots
      WHERE snapshot_date >= ?
      ORDER BY snapshot_date DESC, ticket_count DESC
    `, [since]);
  }

  private async getAlreadyClassified(ticketKeys: string[]): Promise<Set<string>> {
    if (ticketKeys.length === 0) return new Set();
    const placeholders = ticketKeys.map(() => '?').join(',');
    const rows = await query<any>(
      `SELECT DISTINCT ticket_key FROM ticket_classifications WHERE ticket_key IN (${placeholders}) AND classification_type = 'resolved'`,
      ticketKeys,
    );
    return new Set(rows.map((r: any) => r.ticket_key));
  }

  private async saveClassification(ticketKey: string, type: string, result: ClassificationResult): Promise<void> {
    await executeAndGetId(`
      INSERT INTO ticket_classifications (ticket_key, classification_type, category, sub_category, software_area, problem_type, root_cause, confidence, provider, model, ticket_type, impact, urgency, priority_matrix)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [ticketKey, type, result.category, result.sub_category, result.software_area, result.problem_type, result.root_cause, result.confidence, null, null, result.ticket_type ?? null, result.impact ?? null, result.urgency ?? null, result.priority_matrix ?? null]);
  }

  private async saveTrendSnapshot(result: TrendAnalysisResult, current: any[], prevMap: Map<string, number>, days: number): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    for (const cat of result.categories) {
      await executeAndGetId(`
        INSERT INTO ticket_trend_snapshots (snapshot_date, category, ticket_count, trend_direction, narrative)
        VALUES (?, ?, ?, ?, ?)
      `, [today, cat.category, cat.count, cat.trend, result.narrative?.slice(0, 4000) ?? null]);
    }
  }
}
