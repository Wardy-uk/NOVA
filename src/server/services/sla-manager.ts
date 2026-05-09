import { query, queryOne, executeAndGetId } from './database.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { QueueMonitor } from './queue-monitor.js';
import type { AssignmentEngine } from './assignment-engine.js';
import type { JiraRestClient, JiraIssue } from './jira-client.js';

export interface SlaProjection {
  ticketKey: string;
  summary: string;
  assignee: string | null;
  slaType: string;
  minutesRemaining: number;
  breachTime: string;
  interventionStatus: string | null;
}

interface InterventionThresholds {
  warn_120: boolean;
  assign_60: boolean;
  nudge_30: boolean;
  escalate_15: boolean;
}

export class SlaManager {
  constructor(
    private settings: SettingsQueries,
    private jiraClient: JiraRestClient,
    private assignmentEngine: AssignmentEngine,
  ) {}

  async runProactiveCheck(openIssues: JiraIssue[]): Promise<{
    projections: SlaProjection[];
    interventions: number;
  }> {
    const thresholds = this.getThresholds();
    const projections = this.projectBreaches(openIssues);
    let interventionCount = 0;

    for (const proj of projections) {
      const alreadyHandled = await this.wasRecentlyIntervened(proj.ticketKey, proj.minutesRemaining);
      if (alreadyHandled) continue;

      if (proj.minutesRemaining <= 15 && thresholds.escalate_15) {
        await this.intervene(proj, 'escalate_lead');
        interventionCount++;
      } else if (proj.minutesRemaining <= 30 && thresholds.nudge_30) {
        await this.intervene(proj, 'nudge_agent');
        interventionCount++;
      } else if (proj.minutesRemaining <= 60 && thresholds.assign_60) {
        await this.intervene(proj, 'auto_assign');
        interventionCount++;
      } else if (proj.minutesRemaining <= 120 && thresholds.warn_120) {
        await this.intervene(proj, 'log_warning');
        interventionCount++;
      }
    }

    return { projections, interventions: interventionCount };
  }

  private projectBreaches(issues: JiraIssue[]): SlaProjection[] {
    const projections: SlaProjection[] = [];
    const now = new Date();

    for (const issue of issues) {
      const slaField = issue.fields.customfield_10010 as any;
      if (!slaField) continue;

      const slaItems = Array.isArray(slaField) ? slaField : [slaField];

      for (const item of slaItems) {
        const ongoing = item?.ongoingCycle;
        if (!ongoing?.breachTime?.epochMillis) continue;

        const breachTime = ongoing.breachTime.epochMillis;
        const remaining = breachTime - now.getTime();
        if (remaining <= 0 || remaining > 120 * 60 * 1000) continue;

        const name = ((item?.name ?? item?.id ?? '') as string).toLowerCase();
        let slaType = 'resolution';
        if (name.includes('first') || name.includes('response')) slaType = 'first_response';
        else if (name.includes('update') || name.includes('next')) slaType = 'next_update';

        projections.push({
          ticketKey: issue.key,
          summary: (issue.fields.summary as string) ?? '',
          assignee: (issue.fields.assignee as any)?.displayName ?? null,
          slaType,
          minutesRemaining: Math.round(remaining / 60000),
          breachTime: new Date(breachTime).toISOString(),
          interventionStatus: null,
        });
      }
    }

    return projections.sort((a, b) => a.minutesRemaining - b.minutesRemaining);
  }

  private async intervene(proj: SlaProjection, type: string): Promise<void> {
    let detail = '';

    switch (type) {
      case 'log_warning':
        detail = `SLA breach warning: ${proj.minutesRemaining} minutes remaining (${proj.slaType})`;
        await this.logAlert(proj.ticketKey, 'warning', detail);
        break;

      case 'auto_assign':
        if (!proj.assignee) {
          try {
            const result = await this.assignmentEngine.assignToJira(proj.ticketKey);
            detail = result
              ? `Auto-assigned to ${result.agent.display_name} (SLA at ${proj.minutesRemaining}min)`
              : `No agents available for auto-assignment (SLA at ${proj.minutesRemaining}min)`;
          } catch (err) {
            detail = `Auto-assignment failed: ${err instanceof Error ? err.message : err}`;
          }
        } else {
          detail = `Already assigned to ${proj.assignee}, skipping auto-assign`;
        }
        break;

      case 'nudge_agent':
        if (proj.assignee) {
          try {
            await this.jiraClient.addComment(
              proj.ticketKey,
              `⚠️ SLA breach in ${proj.minutesRemaining} minutes — please action or reassign`,
              { internal: true },
            );
            detail = `Nudge posted for ${proj.assignee} (${proj.minutesRemaining}min to breach)`;
          } catch (err) {
            detail = `Nudge failed: ${err instanceof Error ? err.message : err}`;
          }
        } else {
          try {
            const result = await this.assignmentEngine.assignToJira(proj.ticketKey);
            detail = result
              ? `Unassigned at 30min — auto-assigned to ${result.agent.display_name}`
              : `Unassigned at 30min — no agents available`;
          } catch {
            detail = 'Assignment attempt failed';
          }
        }
        break;

      case 'escalate_lead':
        detail = `Critical SLA breach in ${proj.minutesRemaining}min — escalating to team lead`;
        await this.logAlert(proj.ticketKey, 'critical', detail);
        try {
          await this.jiraClient.addComment(
            proj.ticketKey,
            `🚨 SLA breach imminent (${proj.minutesRemaining}min). Escalating to team lead for immediate action.`,
            { internal: true },
          );
        } catch {}
        break;
    }

    await this.recordIntervention(proj.ticketKey, proj.slaType, proj.minutesRemaining, type, detail);
    proj.interventionStatus = type;
  }

  private async recordIntervention(
    ticketKey: string, slaType: string, minutesRemaining: number,
    interventionType: string, detail: string,
  ): Promise<void> {
    await executeAndGetId(
      `INSERT INTO agent_sla_interventions (ticket_key, sla_type, minutes_remaining, intervention_type, detail)
       VALUES (?, ?, ?, ?, ?)`,
      [ticketKey, slaType, minutesRemaining, interventionType, detail],
    );
  }

  private async wasRecentlyIntervened(ticketKey: string, currentMinutes: number): Promise<boolean> {
    const recent = await queryOne<{ intervention_type: string; minutes_remaining: number }>(
      `SELECT TOP 1 intervention_type, minutes_remaining FROM agent_sla_interventions
       WHERE ticket_key = ? AND created_at >= DATEADD(hour, -2, GETUTCDATE())
       ORDER BY created_at DESC`,
      [ticketKey],
    );
    if (!recent) return false;

    const tierMap: Record<string, number> = { log_warning: 120, auto_assign: 60, nudge_agent: 30, escalate_lead: 15 };
    const currentTier = currentMinutes <= 15 ? 'escalate_lead' :
                        currentMinutes <= 30 ? 'nudge_agent' :
                        currentMinutes <= 60 ? 'auto_assign' : 'log_warning';
    return (tierMap[recent.intervention_type] ?? 999) <= (tierMap[currentTier] ?? 999);
  }

  private async logAlert(ticketKey: string, severity: string, detail: string): Promise<void> {
    await executeAndGetId(
      `INSERT INTO agent_alerts (alert_type, severity, title, detail, ticket_key)
       VALUES ('sla_intervention', ?, ?, ?, ?)`,
      [severity, `SLA intervention: ${ticketKey}`, detail, ticketKey],
    );
  }

  async getInterventionStats(days: number = 30): Promise<{
    total: number; by_type: Record<string, number>; breaches_prevented: number;
  }> {
    const rows = await query<{ intervention_type: string; cnt: number }>(
      `SELECT intervention_type, COUNT(*) as cnt FROM agent_sla_interventions
       WHERE created_at >= DATEADD(day, -?, GETUTCDATE())
       GROUP BY intervention_type`,
      [days],
    );

    const byType: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byType[r.intervention_type] = r.cnt;
      total += r.cnt;
    }

    const prevented = await queryOne<{ cnt: number }>(
      `SELECT COUNT(DISTINCT si.ticket_key) as cnt
       FROM agent_sla_interventions si
       INNER JOIN jira_issue_cache jic ON si.ticket_key = jic.issue_key
       WHERE si.created_at >= DATEADD(day, -?, GETUTCDATE())
         AND jic.status_name IN ('Done', 'Resolved', 'Closed')`,
      [days],
    );

    return { total, by_type: byType, breaches_prevented: prevented?.cnt ?? 0 };
  }

  private getThresholds(): InterventionThresholds {
    return {
      warn_120: this.settings.get('agent_sla_intervention_120') !== 'false',
      assign_60: this.settings.get('agent_sla_intervention_60') !== 'false',
      nudge_30: this.settings.get('agent_sla_intervention_30') !== 'false',
      escalate_15: this.settings.get('agent_sla_intervention_15') !== 'false',
    };
  }
}
