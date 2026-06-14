import { z } from 'zod';
import type { LlmService } from './llm-service.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { query, execute, executeAndGetId } from './database.js';

export interface CrossFunctionalSignal {
  id: number;
  signal_type: string;
  component: string | null;
  title: string | null;
  detail: string | null;
  ticket_count: number | null;
  customer_count: number | null;
  trend: string | null;
  recommendation: string | null;
  period_start: string | null;
  period_end: string | null;
  generated_at: string;
}

const InsightSchema = z.object({
  title: z.string(),
  recommendation: z.string(),
  trend: z.enum(['increasing', 'decreasing', 'stable']),
});

const FeatureClusterSchema = z.object({
  clusters: z.array(z.object({
    theme: z.string(),
    ticket_count: z.number(),
    summary: z.string(),
  })),
});

export class CrossFunctionalIntelligence {
  constructor(
    private llm: LlmService,
    private settings: SettingsQueries,
  ) {}

  async generateMonthlyReport(): Promise<number> {
    const project = this.settings.get('agent_jira_project') ?? 'NT';
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    // Format from local calendar components — toISOString() shifts to the previous day
    // under positive-offset timezones (e.g. BST), which mislabels the period start.
    const fmtDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const periodStartStr = fmtDate(monthStart);
    const periodEndStr = fmtDate(now);

    let signalCount = 0;

    // 1. Bug impact analysis — top components by ticket volume
    const componentStats = await query<{
      component: string; ticket_count: number; customer_count: number;
    }>(
      `SELECT
         COALESCE(nurtur_product, 'Unknown') AS component,
         COUNT(*) AS ticket_count,
         COUNT(DISTINCT reporter_email) AS customer_count
       FROM jira_issue_cache
       WHERE project_key = ? AND jira_created >= ?
         AND status_category = 'Done'
       GROUP BY COALESCE(nurtur_product, 'Unknown')
       HAVING COUNT(*) >= 3
       ORDER BY ticket_count DESC`,
      [project, monthStart],
    );

    // Previous month for trend comparison
    const prevStats = await query<{ component: string; ticket_count: number }>(
      `SELECT
         COALESCE(nurtur_product, 'Unknown') AS component,
         COUNT(*) AS ticket_count
       FROM jira_issue_cache
       WHERE project_key = ? AND jira_created >= ? AND jira_created < ?
       GROUP BY COALESCE(nurtur_product, 'Unknown')`,
      [project, prevMonthStart, monthStart],
    );
    const prevMap = new Map(prevStats.map(r => [r.component, r.ticket_count]));

    const totalThisMonth = componentStats.reduce((s, c) => s + c.ticket_count, 0);

    // Take top 10 components
    for (const comp of componentStats.slice(0, 10)) {
      const prevCount = prevMap.get(comp.component) ?? 0;
      const pctOfTotal = totalThisMonth > 0 ? (comp.ticket_count / totalThisMonth * 100).toFixed(0) : '0';
      const changeVsPrev = prevCount > 0
        ? `${((comp.ticket_count - prevCount) / prevCount * 100).toFixed(0)}% vs last month`
        : 'no prior data';

      try {
        const insight = await this.llm.call(
          `You are a product/dev team advisor. Generate a concise insight about ticket volume for a component.`,
          `Component: ${comp.component}
This month: ${comp.ticket_count} tickets (${pctOfTotal}% of total), ${comp.customer_count} unique reporters
Change: ${changeVsPrev}
Previous month: ${prevCount} tickets

Provide a title, recommendation for dev/product, and whether the trend is increasing/decreasing/stable.`,
          InsightSchema,
          { callType: 'cross_functional', tier: 'cheap', temperature: 0.3 },
        );

        await executeAndGetId(
          `INSERT INTO agent_cross_functional_signals
           (signal_type, component, title, detail, ticket_count, customer_count, trend, recommendation, period_start, period_end)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            'bug_impact', comp.component, insight.data.title,
            `${comp.ticket_count} tickets (${pctOfTotal}% of total), ${comp.customer_count} unique reporters. ${changeVsPrev}.`,
            comp.ticket_count, comp.customer_count, insight.data.trend,
            insight.data.recommendation, periodStartStr, periodEndStr,
          ],
        );
        signalCount++;
      } catch {
        console.warn(`[cross-functional] Failed to generate insight for ${comp.component}`);
      }
    }

    // 2. Feature request aggregation
    const featureRequests = await query<{ summary: string; ticket_key: string; reporter_email: string }>(
      `SELECT summary, issue_key AS ticket_key, reporter_email
       FROM jira_issue_cache
       WHERE project_key = ? AND jira_created >= ?
         AND (request_type LIKE '%feature%' OR request_type LIKE '%enhancement%'
              OR labels LIKE '%feature-request%' OR issuetype_name = 'Enhancement')
       ORDER BY jira_created DESC`,
      [project, monthStart],
    );

    if (featureRequests.length >= 3) {
      try {
        const clusterResult = await this.llm.call(
          `You are a product analyst. Cluster these feature requests by theme.`,
          `Feature requests this month:
${featureRequests.map((fr, i) => `${i + 1}. ${fr.summary}`).join('\n')}

Group these into thematic clusters. For each cluster, provide: theme name, count of tickets, and a brief summary.`,
          FeatureClusterSchema,
          { callType: 'cross_functional', tier: 'cheap', temperature: 0.2 },
        );

        for (const cluster of clusterResult.data.clusters) {
          await executeAndGetId(
            `INSERT INTO agent_cross_functional_signals
             (signal_type, title, detail, ticket_count, customer_count, trend, recommendation, period_start, period_end)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              'feature_demand', cluster.theme, cluster.summary,
              cluster.ticket_count,
              new Set(featureRequests.map(fr => fr.reporter_email)).size,
              'stable', `${cluster.ticket_count} requests for "${cluster.theme}" this month`,
              periodStartStr, periodEndStr,
            ],
          );
          signalCount++;
        }
      } catch {
        console.warn('[cross-functional] Failed to cluster feature requests');
      }
    }

    // 3. Recurring issue detection
    const recurring = await query<{
      component: string; request_type: string; ticket_count: number;
    }>(
      `SELECT
         COALESCE(nurtur_product, 'Unknown') AS component,
         COALESCE(request_type, 'Unknown') AS request_type,
         COUNT(*) AS ticket_count
       FROM jira_issue_cache
       WHERE project_key = ? AND jira_created >= ?
       GROUP BY COALESCE(nurtur_product, 'Unknown'), COALESCE(request_type, 'Unknown')
       HAVING COUNT(*) >= 5
       ORDER BY ticket_count DESC`,
      [project, monthStart],
    );

    for (const rec of recurring.slice(0, 5)) {
      await executeAndGetId(
        `INSERT INTO agent_cross_functional_signals
         (signal_type, component, title, detail, ticket_count, period_start, period_end)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          'recurring_issue', rec.component,
          `Recurring: ${rec.component} / ${rec.request_type}`,
          `${rec.ticket_count} tickets for ${rec.component} with request type ${rec.request_type} this month`,
          rec.ticket_count, periodStartStr, periodEndStr,
        ],
      );
      signalCount++;
    }

    return signalCount;
  }

  async getSignals(signalType?: string, limit: number = 50): Promise<CrossFunctionalSignal[]> {
    if (signalType) {
      return query<CrossFunctionalSignal>(
        `SELECT TOP (?) * FROM agent_cross_functional_signals
         WHERE signal_type = ? ORDER BY generated_at DESC`,
        [limit, signalType],
      );
    }
    return query<CrossFunctionalSignal>(
      `SELECT TOP (?) * FROM agent_cross_functional_signals ORDER BY generated_at DESC`,
      [limit],
    );
  }

  async getLatestReport(): Promise<{
    bug_impact: CrossFunctionalSignal[];
    feature_demand: CrossFunctionalSignal[];
    recurring_issues: CrossFunctionalSignal[];
    period: { start: string | null; end: string | null };
  }> {
    const latest = await query<{ period_start: string; period_end: string }>(
      `SELECT TOP 1 period_start, period_end FROM agent_cross_functional_signals ORDER BY generated_at DESC`,
    );
    const period = latest[0] ?? { period_start: null, period_end: null };

    const [bugImpact, featureDemand, recurring] = await Promise.all([
      this.getSignals('bug_impact', 10),
      this.getSignals('feature_demand', 10),
      this.getSignals('recurring_issue', 5),
    ]);

    return {
      bug_impact: bugImpact,
      feature_demand: featureDemand,
      recurring_issues: recurring,
      period: { start: period.period_start, end: period.period_end },
    };
  }

  async exportMarkdown(): Promise<string> {
    const report = await this.getLatestReport();
    const lines: string[] = [
      `# Cross-Functional Intelligence Report`,
      `Period: ${report.period.start ?? '?'} to ${report.period.end ?? '?'}`,
      '',
      '## Bug Impact Analysis',
      '',
    ];

    for (const sig of report.bug_impact) {
      lines.push(`### ${sig.title ?? sig.component}`);
      lines.push(`- **Tickets:** ${sig.ticket_count} | **Customers affected:** ${sig.customer_count} | **Trend:** ${sig.trend}`);
      lines.push(`- ${sig.detail}`);
      if (sig.recommendation) lines.push(`- **Recommendation:** ${sig.recommendation}`);
      lines.push('');
    }

    lines.push('## Feature Demand');
    lines.push('');
    for (const sig of report.feature_demand) {
      lines.push(`### ${sig.title}`);
      lines.push(`- **Requests:** ${sig.ticket_count}`);
      lines.push(`- ${sig.detail}`);
      lines.push('');
    }

    lines.push('## Recurring Issues');
    lines.push('');
    for (const sig of report.recurring_issues) {
      lines.push(`- **${sig.title}:** ${sig.ticket_count} tickets — ${sig.detail}`);
    }

    return lines.join('\n');
  }

  // Gap 7: Actionable workflow methods

  async assignOwner(signalId: number, owner: string): Promise<void> {
    await execute(
      `UPDATE agent_cross_functional_signals SET owner = ?, status = CASE WHEN status = 'new' THEN 'acknowledged' ELSE status END WHERE id = ?`,
      [owner, signalId],
    );
  }

  async updateStatus(signalId: number, status: string, outcome?: string): Promise<void> {
    const now = status === 'resolved' ? `, actioned_at = GETUTCDATE()` : '';
    const outcomeUpdate = outcome ? `, outcome = ?` : '';
    const params: unknown[] = outcome ? [status, outcome, signalId] : [status, signalId];
    await execute(
      `UPDATE agent_cross_functional_signals SET status = ?${outcomeUpdate}${now} WHERE id = ?`,
      params,
    );
  }

  async dismiss(signalId: number, reason: string): Promise<void> {
    await execute(
      `UPDATE agent_cross_functional_signals SET status = 'dismissed', outcome = ? WHERE id = ?`,
      [reason, signalId],
    );
  }

  async createJiraTicket(signalId: number, jiraClient: any, projectKey: string): Promise<string | null> {
    const signals = await query<CrossFunctionalSignal>(
      `SELECT * FROM agent_cross_functional_signals WHERE id = ?`,
      [signalId],
    );
    const signal = signals[0];
    if (!signal) return null;

    try {
      const result = await jiraClient.createIssue({
        projectKey,
        issueType: 'Task',
        summary: `[Intelligence] ${signal.title}`,
        description: `Cross-functional intelligence signal:\n\n${signal.detail}\n\nTickets affected: ${signal.ticket_count}\nCustomers affected: ${signal.customer_count}\nTrend: ${signal.trend}\n\nRecommendation: ${signal.recommendation}`,
      });
      const ticketKey = result?.key;
      if (ticketKey) {
        await execute(
          `UPDATE agent_cross_functional_signals SET jira_ticket_key = ?, status = 'in_progress' WHERE id = ?`,
          [ticketKey, signalId],
        );
      }
      return ticketKey ?? null;
    } catch (err) {
      console.error('[cross-func] Failed to create Jira ticket:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  async recordVolumeAfter(signalId: number, volumeAfter: number): Promise<void> {
    await execute(
      `UPDATE agent_cross_functional_signals SET volume_after = ? WHERE id = ?`,
      [volumeAfter, signalId],
    );
  }

  async getSignalById(id: number): Promise<CrossFunctionalSignal | null> {
    const rows = await query<CrossFunctionalSignal>(
      `SELECT * FROM agent_cross_functional_signals WHERE id = ?`,
      [id],
    );
    return rows[0] ?? null;
  }
}
