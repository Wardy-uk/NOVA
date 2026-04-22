import type { SettingsQueries } from '../db/settings-store.js';
import type { JiraRestClient } from './jira-client.js';
import { execute, query, executeAndGetId } from './database.js';

interface AbuseReport {
  reporterEmail: string;
  reporterName: string;
  accountName?: string;
  category: string;
  description: string;
  evidenceUrls?: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export class AbuseReportProcessor {
  constructor(
    private settings: SettingsQueries,
    private jiraClient: JiraRestClient,
  ) {}

  async processReport(report: AbuseReport): Promise<{ reportId: number; jiraKey: string | null }> {
    const reportId = await executeAndGetId(
      `INSERT INTO abuse_reports
        (reporter_email, reporter_name, account_name, category, description, evidence_urls, severity, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open', GETUTCDATE())`,
      [
        report.reporterEmail, report.reporterName, report.accountName ?? null,
        report.category, report.description,
        report.evidenceUrls ? JSON.stringify(report.evidenceUrls) : null,
        report.severity,
      ]
    );

    let jiraKey: string | null = null;

    if (report.severity === 'high' || report.severity === 'critical') {
      const project = this.settings.get('abuse_jira_project') ?? 'NT';
      const result = await this.jiraClient.createIssue({
        fields: {
          project: { key: project },
          summary: `Abuse Report: ${report.category} — ${report.accountName ?? report.reporterName}`,
          description: `**Reporter:** ${report.reporterName} (${report.reporterEmail})\n**Account:** ${report.accountName ?? 'N/A'}\n**Category:** ${report.category}\n**Severity:** ${report.severity}\n\n${report.description}\n\n_Auto-created by NOVA abuse report processor._`,
          issuetype: { name: 'Task' },
          priority: { name: report.severity === 'critical' ? 'Highest' : 'High' },
        },
      });

      if (result?.key) {
        jiraKey = result.key;
        await execute(
          `UPDATE abuse_reports SET jira_key = ?, status = 'escalated' WHERE id = ?`,
          [jiraKey, reportId]
        );
      }
    }

    const webhookUrl = this.settings.get('teams_webhook_url');
    if (webhookUrl && (report.severity === 'high' || report.severity === 'critical')) {
      await this.notifyTeams(webhookUrl, report, jiraKey);
    }

    console.log(`[abuse-report] Processed report #${reportId} (${report.severity}) — Jira: ${jiraKey ?? 'not escalated'}`);
    return { reportId, jiraKey };
  }

  async getReports(status?: string, limit: number = 50): Promise<any[]> {
    const where = status ? 'WHERE status = ?' : '';
    const params = status ? [status, limit] : [limit];
    return query(
      `SELECT TOP (?) * FROM abuse_reports ${where} ORDER BY created_at DESC`,
      status ? [limit, status] : [limit]
    );
  }

  private async notifyTeams(webhookUrl: string, report: AbuseReport, jiraKey: string | null): Promise<void> {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          '@type': 'MessageCard',
          themeColor: report.severity === 'critical' ? 'FF0000' : 'FF8800',
          title: `Abuse Report: ${report.category}`,
          text: `**Severity:** ${report.severity}\n**Account:** ${report.accountName ?? 'N/A'}\n**Reporter:** ${report.reporterName}\n${jiraKey ? `**Jira:** ${jiraKey}` : ''}`,
        }),
      });
    } catch { /* best-effort */ }
  }
}
