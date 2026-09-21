import type { JiraRestClient } from './jira-client.js';
import type { OpenIssueSummary } from './jira-cache-queries.js';
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

// DEFAULT_FIELDS used to sit here, listing customfield_10010 as "SLA". Nothing read it, and
// the id was wrong anyway — this instance uses 14046/14048. Removed rather than corrected: an
// unused constant naming a field that does not exist is how the next person gets misled.

const MIN_SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export class QueueMonitor {
  private jiraClient: JiraRestClient;
  private settings: SettingsQueries;
  private lastSnapshotAt = 0;

  constructor(jiraClient: JiraRestClient, settings: SettingsQueries) {
    this.jiraClient = jiraClient;
    this.settings = settings;
  }

  /**
   * Takes the cache's narrow open-issue rows, not a JiraIssue.
   *
   * It used to take JiraIssue[] and read everything off `issue.fields`. On 19 Sep 2026 the
   * perceiver was narrowed to four columns for IO reasons and still mapped them into
   * JiraIssues — which meant `fields` was `{}` for every ticket, and this class went on
   * reading it without complaint. `total_created` fell to 0 for every hour from that day, and
   * `unassigned` pinned at exactly 20, because a missing `created` makes `ageMs` NaN, `NaN <
   * threshold` is false, and so every open ticket was reported as a stale unassigned one, up
   * to the `.slice(0, 20)` cap. `strict: false` meant the compiler said nothing.
   *
   * Typed to what the cache actually returns, so a narrowing like that is now a build error
   * rather than a column of plausible zeroes.
   */
  async analyse(openIssues: OpenIssueSummary[]): Promise<QueueHealth> {
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

  private detectSlaRisk(issues: OpenIssueSummary[], now: Date): SlaRiskTicket[] {
    const thresholdMin = this.getNumber('agent_sla_breach_threshold_min', SLA_BREACH_THRESHOLD_MIN);
    const thresholdMs = thresholdMin * 60 * 1000;
    const results: SlaRiskTicket[] = [];

    // Both breach clocks come off the cache, extracted at sync time: sla_breach_time from
    // cf14048 (Resolution) and sla_frt_breach_time from cf14046 (First Reply). This used to
    // dig SLA cycle objects out of `issue.fields` with the wrong customfield id — 10010, which
    // does not exist here — so every issue hit a `continue` and sla_at_risk recorded 0 on all
    // 4,006 rows. Reading the pre-extracted columns fixes the id problem permanently and keeps
    // this off fields_json, which is most of jira_issue_cache's 395MB.
    const clocks: Array<{ at: Date | null; type: SlaRiskTicket['slaType'] }> = [];
    for (const issue of issues) {
      clocks.length = 0;
      clocks.push({ at: issue.sla_frt_breach_time, type: 'first_response' });
      clocks.push({ at: issue.sla_breach_time, type: 'resolution' });

      for (const clock of clocks) {
        if (!clock.at) continue;
        const remaining = new Date(clock.at).getTime() - now.getTime();
        if (remaining > 0 && remaining < thresholdMs) {
          results.push({
            ticketKey: issue.issue_key,
            summary: issue.summary ?? '',
            assignee: issue.assignee_display ?? null,
            slaType: clock.type,
            minutesRemaining: Math.round(remaining / 60000),
            breachTime: new Date(clock.at).toISOString(),
          });
        }
      }
    }

    return results.sort((a, b) => a.minutesRemaining - b.minutesRemaining);
  }

  // extractSlaEntries parsed JSM SLA cycle objects out of fields_json. detectSlaRisk now reads
  // the breach times the sync already extracted into columns, so nothing calls it. The
  // 'next_update' SLA type it could return is not one NT has configured.

  private detectUnassigned(issues: OpenIssueSummary[], now: Date): UnassignedTicket[] {
    const thresholdMin = this.getNumber('agent_unassigned_stale_min', UNASSIGNED_STALE_MIN);
    const thresholdMs = thresholdMin * 60 * 1000;
    const results: UnassignedTicket[] = [];

    for (const issue of issues) {
      if (issue.assignee_display) continue;

      // Guard the date explicitly. When `created` was missing, `ageMs` came out NaN, `NaN <
      // thresholdMs` is false, and so every open ticket fell through to be reported as stale —
      // which is how this pinned at the .slice(0, 20) cap for three days. A ticket whose
      // creation date we cannot read is not evidence that it is stale.
      const created = issue.jira_created ? new Date(issue.jira_created) : null;
      if (!created || Number.isNaN(created.getTime())) continue;
      const ageMs = now.getTime() - created.getTime();
      if (ageMs < thresholdMs) continue;

      results.push({
        ticketKey: issue.issue_key,
        summary: issue.summary ?? '',
        priority: issue.priority_name ?? 'Medium',
        ageMinutes: Math.round(ageMs / 60000),
        created: created.toISOString(),
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

  private detectCapacityWarning(issues: OpenIssueSummary[]): CapacityWarning | null {
    const threshold = this.getNumber('agent_capacity_threshold', CAPACITY_THRESHOLD);

    // Count unique assignees (as a proxy for available agents)
    // Display name rather than accountId: the narrow cache row does not carry the id, and for
    // counting distinct people the name is the same answer.
    const assignees = new Set<string>();
    for (const issue of issues) {
      if (issue.assignee_display) assignees.add(issue.assignee_display);
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
    issues: OpenIssueSummary[],
    slaAtRisk: number,
    unassigned: number,
    now: Date,
  ): Promise<void> {
    if (now.getTime() - this.lastSnapshotAt < MIN_SNAPSHOT_INTERVAL_MS) return;
    try {
      this.lastSnapshotAt = now.getTime();
      // Count tickets created in the last hour
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const createdThisHour = issues.filter(i => {
        if (!i.jira_created) return false;
        return new Date(i.jira_created).getTime() > oneHourAgo.getTime();
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
