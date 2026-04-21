import type { JiraRestClient, JiraIssue } from './jira-client.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { query, executeAndGetId } from './database.js';
import type {
  QueueHealth,
  SlaRiskTicket,
  UnassignedTicket,
  VolumeSpike,
  CapacityWarning,
} from './agent-types.js';

const SLA_BREACH_THRESHOLD_MIN = 30;
const UNASSIGNED_STALE_MIN = 15;
const CAPACITY_THRESHOLD = 10;
const VOLUME_SIGMA_THRESHOLD = 2;

const DEFAULT_FIELDS = [
  'summary', 'status', 'priority', 'assignee', 'reporter',
  'created', 'updated', 'customfield_10010', // SLA
];

export class QueueMonitor {
  private jiraClient: JiraRestClient;
  private settings: SettingsQueries;

  constructor(jiraClient: JiraRestClient, settings: SettingsQueries) {
    this.jiraClient = jiraClient;
    this.settings = settings;
  }

  async analyse(openIssues: JiraIssue[]): Promise<QueueHealth> {
    const now = new Date();
    const slaBreachImminent = this.detectSlaRisk(openIssues, now);
    const unassignedStale = this.detectUnassigned(openIssues, now);
    const volumeSpike = await this.detectVolumeSpike(openIssues.length, now);
    const capacityWarning = this.detectCapacityWarning(openIssues);

    await this.recordSnapshot(openIssues, slaBreachImminent.length, unassignedStale.length, now);

    return {
      timestamp: now.toISOString(),
      totalOpen: openIssues.length,
      slaBreachImminent,
      unassignedStale,
      volumeSpike,
      capacityWarning,
    };
  }

  private detectSlaRisk(issues: JiraIssue[], now: Date): SlaRiskTicket[] {
    const thresholdMin = this.getNumber('agent_sla_breach_threshold_min', SLA_BREACH_THRESHOLD_MIN);
    const thresholdMs = thresholdMin * 60 * 1000;
    const results: SlaRiskTicket[] = [];

    for (const issue of issues) {
      const slaField = issue.fields.customfield_10010 as any;
      if (!slaField) continue;

      const slaEntries = this.extractSlaEntries(slaField);
      for (const entry of slaEntries) {
        const remaining = entry.breachTime - now.getTime();
        if (remaining > 0 && remaining < thresholdMs) {
          results.push({
            ticketKey: issue.key,
            summary: (issue.fields.summary as string) ?? '',
            assignee: (issue.fields.assignee as any)?.displayName ?? null,
            slaType: entry.slaType,
            minutesRemaining: Math.round(remaining / 60000),
            breachTime: new Date(entry.breachTime).toISOString(),
          });
        }
      }
    }

    return results.sort((a, b) => a.minutesRemaining - b.minutesRemaining);
  }

  private extractSlaEntries(slaField: any): Array<{ slaType: SlaRiskTicket['slaType']; breachTime: number }> {
    const entries: Array<{ slaType: SlaRiskTicket['slaType']; breachTime: number }> = [];

    // JSM SLA field can be an array of SLA objects or a single object
    const slaItems = Array.isArray(slaField) ? slaField : [slaField];

    for (const item of slaItems) {
      const ongoing = item?.ongoingCycle;
      if (!ongoing?.breachTime?.epochMillis) continue;

      const breachTime = ongoing.breachTime.epochMillis;
      const name = ((item?.name ?? item?.id ?? '') as string).toLowerCase();

      let slaType: SlaRiskTicket['slaType'] = 'resolution';
      if (name.includes('first') || name.includes('response')) slaType = 'first_response';
      else if (name.includes('update') || name.includes('next')) slaType = 'next_update';

      entries.push({ slaType, breachTime });
    }

    return entries;
  }

  private detectUnassigned(issues: JiraIssue[], now: Date): UnassignedTicket[] {
    const thresholdMin = this.getNumber('agent_unassigned_stale_min', UNASSIGNED_STALE_MIN);
    const thresholdMs = thresholdMin * 60 * 1000;
    const results: UnassignedTicket[] = [];

    for (const issue of issues) {
      const assignee = (issue.fields.assignee as any)?.displayName;
      if (assignee) continue;

      const created = new Date((issue.fields.created as string) ?? '');
      const ageMs = now.getTime() - created.getTime();
      if (ageMs < thresholdMs) continue;

      results.push({
        ticketKey: issue.key,
        summary: (issue.fields.summary as string) ?? '',
        priority: (issue.fields.priority as any)?.name ?? 'Medium',
        ageMinutes: Math.round(ageMs / 60000),
        created: (issue.fields.created as string) ?? '',
      });
    }

    return results.sort((a, b) => b.ageMinutes - a.ageMinutes).slice(0, 20);
  }

  async detectVolumeSpike(currentOpen: number, now: Date): Promise<VolumeSpike | null> {
    const hour = now.getUTCHours();
    const dow = now.getUTCDay();

    const rows = await query<{ total_open: number }>(
      `SELECT total_open FROM agent_queue_snapshots
       WHERE snapshot_hour = ? AND snapshot_dow = ?
       ORDER BY created_at DESC
       OFFSET 0 ROWS FETCH NEXT 30 ROWS ONLY`,
      [hour, dow],
    );

    if (rows.length < 5) return null; // not enough history

    const values = rows.map(r => r.total_open);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - avg) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return null;

    const sigmaAbove = (currentOpen - avg) / stdDev;
    const threshold = this.getNumber('agent_volume_sigma_threshold', VOLUME_SIGMA_THRESHOLD);

    if (sigmaAbove >= threshold) {
      return {
        currentHourCount: currentOpen,
        averageForSlot: Math.round(avg * 10) / 10,
        stdDevForSlot: Math.round(stdDev * 10) / 10,
        sigmaAbove: Math.round(sigmaAbove * 100) / 100,
      };
    }

    return null;
  }

  private detectCapacityWarning(issues: JiraIssue[]): CapacityWarning | null {
    const threshold = this.getNumber('agent_capacity_threshold', CAPACITY_THRESHOLD);

    // Count unique assignees (as a proxy for available agents)
    const assignees = new Set<string>();
    for (const issue of issues) {
      const assignee = (issue.fields.assignee as any)?.accountId;
      if (assignee) assignees.add(assignee);
    }

    const availableAgents = Math.max(assignees.size, 1);
    const ticketsPerAgent = issues.length / availableAgents;

    if (ticketsPerAgent > threshold) {
      return {
        totalOpen: issues.length,
        availableAgents,
        ticketsPerAgent: Math.round(ticketsPerAgent * 10) / 10,
        threshold,
      };
    }

    return null;
  }

  private async recordSnapshot(
    issues: JiraIssue[],
    slaAtRisk: number,
    unassigned: number,
    now: Date,
  ): Promise<void> {
    try {
      // Count tickets created in the last hour
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const createdThisHour = issues.filter(i => {
        const created = new Date((i.fields.created as string) ?? '');
        return created.getTime() > oneHourAgo.getTime();
      }).length;

      await executeAndGetId(
        `INSERT INTO agent_queue_snapshots
           (snapshot_hour, snapshot_dow, total_open, total_created, sla_at_risk, unassigned)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [now.getUTCHours(), now.getUTCDay(), issues.length, createdThisHour, slaAtRisk, unassigned],
      );
    } catch (err) {
      console.warn('[queue-monitor] Failed to record snapshot:', err instanceof Error ? err.message : err);
    }
  }

  private getNumber(key: string, fallback: number): number {
    const val = this.settings.get(key);
    if (!val) return fallback;
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? fallback : parsed;
  }
}
