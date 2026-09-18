import type { JiraRestClient } from './jira-client.js';
import type { SettingsQueries } from '../db/settings-store.js';

/**
 * First Reply Time safety net.
 *
 * NT's "First Reply Time" SLA (metric 76 / customfield_14046) has a 30-minute goal on the
 * "Nurtur Working Hours" calendar (Mon-Fri 09:00-17:30 Europe/London, UK bank holidays) and
 * exactly one stop condition: `Comment: For Customers`. There are no pause conditions. So a
 * ticket can be triaged, assigned, worked and fixed and STILL breach, because an internal note
 * does not stop the clock.
 *
 * Over 19 Aug - 18 Sep 2026 that produced 391 breaches on 3,116 NT tickets (12.5%):
 *   - 34% were internal/machine-raised tickets nobody was ever going to "reply" to (abuse
 *     reports, the daily MWU Live Morning Report, the daily Failed Jobs ticket, DKIM and
 *     alerting feeds) - the SLA goal JQL is a bare `project = NT` with no exclusions;
 *   - 85% of the genuine breaches still met their Resolution SLA, i.e. the work was done on
 *     time and the customer simply was not told inside 30 minutes.
 *
 * This job closes both gaps with one mechanism: shortly before (or after) the FRT deadline,
 * post the customer-facing acknowledgement that nothing else has posted yet.
 *
 * Two properties make this safe and cheap:
 *
 *  1. `"First Reply Time" = running()` means the cycle is live and un-stopped which - given the
 *     only stop condition is a customer-facing comment - is exactly "nobody has replied to the
 *     customer yet". We never talk over a human or over the AI agent's own reply.
 *  2. Posting the acknowledgement stops the cycle, so the ticket drops out of the candidate
 *     query. The sweep is therefore self-idempotent and needs no ack log or dedup table.
 *
 * Jira does the working-calendar arithmetic via `remaining()`, so nothing here reimplements the
 * SLA calendar. Note `< remaining("10m")` also matches already-breached tickets (remaining goes
 * negative), which is what a safety net wants - it stops the bleeding on those too.
 */

/** Reporters whose tickets are raised by a machine, not a person. These get the terse
 *  internal-system acknowledgement rather than the customer one. Overridable via
 *  `frt_safety_net_internal_reporters` (comma-separated, matched case-insensitively as
 *  substrings of the reporter's email address or display name). */
const DEFAULT_INTERNAL_REPORTERS = [
  'trigger@briefyourmarket.com',
  'info@briefyourmarket.com',
  'failedjobsalerting@briefyourmarket.com',
  'pmta-dkim-service@',
  'ragreportnotifications@nurtur.tech',
  'n8n@nurtur.tech',
  'nova-jira',
];

const DEFAULT_CUSTOMER_ACK =
  'Thanks for getting in touch. This is an automated acknowledgement to confirm your request '
  + 'has reached our support team and is in the queue. An agent will review it and come back to '
  + 'you with an update or next steps. If anything changes or becomes more urgent in the '
  + 'meantime, reply to this ticket and it will come straight back to us.';

const DEFAULT_INTERNAL_ACK =
  'Automated acknowledgement: this ticket was raised by an internal system and has been logged '
  + 'for the team to action. No response is required from the sender.';

export type FrtSafetyNetMode = 'off' | 'dry_run' | 'live';

export interface FrtAckCandidate {
  key: string;
  summary: string;
  reporter: string;
  machineRaised: boolean;
  /** Working milliseconds left on the FRT clock; negative once breached. */
  remainingMs: number | null;
  /** False when the SLA calendar has the clock parked (outside 09:00-17:30, weekend, bank holiday). */
  withinCalendarHours: boolean;
}

export interface FrtSweepResult {
  mode: FrtSafetyNetMode;
  scanned: number;
  acknowledged: number;
  skipped: number;
  failed: number;
  candidates: FrtAckCandidate[];
}

export class FrtSafetyNet {
  constructor(
    private jiraClient: JiraRestClient,
    private settings: SettingsQueries,
  ) {}

  getMode(): FrtSafetyNetMode {
    const raw = (this.settings.get('frt_safety_net_mode') || 'dry_run').trim().toLowerCase();
    if (raw === 'off' || raw === 'live') return raw;
    return 'dry_run';
  }

  private list(key: string, fallback: string[]): string[] {
    const raw = this.settings.get(key);
    if (!raw) return fallback;
    const parsed = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    return parsed.length > 0 ? parsed : fallback;
  }

  private thresholdMinutes(): number {
    const parsed = parseInt(this.settings.get('frt_safety_net_threshold_minutes') || '', 10);
    // Below ~2 minutes the sweep cannot win the race against its own interval; above the 30m
    // goal it would acknowledge tickets the team still has plenty of time to answer properly.
    return !isNaN(parsed) && parsed >= 2 && parsed <= 30 ? parsed : 10;
  }

  private isMachineRaised(reporter: string): boolean {
    const needle = reporter.toLowerCase();
    return this.list('frt_safety_net_internal_reporters', DEFAULT_INTERNAL_REPORTERS)
      .some(pattern => needle.includes(pattern));
  }

  /** Reporters we must never email - e.g. a mailbox that would re-ingest our reply and create a
   *  fresh ticket. Their clock is left running deliberately; empty by default. */
  private isDenied(reporter: string): boolean {
    const raw = this.settings.get('frt_safety_net_reporter_denylist');
    if (!raw) return false;
    const needle = reporter.toLowerCase();
    return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      .some(pattern => needle.includes(pattern));
  }

  private maxPerSweep(): number {
    const parsed = parseInt(this.settings.get('frt_safety_net_max_per_sweep') || '', 10);
    return !isNaN(parsed) && parsed > 0 ? parsed : 25;
  }

  private maxAgeDays(): number {
    const parsed = parseInt(this.settings.get('frt_safety_net_max_age_days') || '', 10);
    return !isNaN(parsed) && parsed >= 1 ? parsed : 2;
  }

  private buildJql(): string {
    const projects = this.list('frt_safety_net_projects', ['nt']).map(p => p.toUpperCase());
    const scope = projects.length === 1 ? `project = ${projects[0]}` : `project IN (${projects.join(', ')})`;
    const field = '"First Reply Time"';
    // `= running()` -> live, un-stopped cycle -> no customer-facing comment exists yet.
    // `< remaining("Nm")` -> within N working minutes of the goal, or already past it.
    //
    // `statusCategory != Done` is load-bearing, not tidiness. FRT stops ONLY on a customer-facing
    // comment, and resolving a ticket is not one — so every NT ticket ever closed without a public
    // reply (silently actioned, or closed as spam) still reads as `running()` forever. On
    // 18 Sep 2026 that was 3,342 matches; with this clause, 9. Without it the sweep would post a
    // "an agent will come back to you" acknowledgement on thousands of long-dead tickets, many of
    // them inbound spam and no-reply addresses.
    //
    // The age cap is the second belt: a safety net should catch today's deadline, never resurrect
    // a backlog that built up while it was switched off.
    return `${scope} AND ${field} = running() AND ${field} < remaining("${this.thresholdMinutes()}m")`
      + ` AND statusCategory != Done AND created >= -${this.maxAgeDays()}d`;
  }

  async run(): Promise<FrtSweepResult> {
    const mode = this.getMode();
    const result: FrtSweepResult = { mode, scanned: 0, acknowledged: 0, skipped: 0, failed: 0, candidates: [] };
    if (mode === 'off') return result;

    const search = await this.jiraClient.searchJqlAll(
      this.buildJql(),
      ['summary', 'reporter', 'created', 'customfield_14046'],
      200,
    );
    const issues = search?.issues ?? [];
    result.scanned = issues.length;

    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i];
      const fields = (issue.fields ?? {}) as Record<string, unknown>;
      const reporterField = fields.reporter as { emailAddress?: string; displayName?: string } | null;
      const reporter = reporterField?.emailAddress || reporterField?.displayName || '';
      const summary = String(fields.summary ?? '');
      const machineRaised = this.isMachineRaised(reporter);

      const cycle = readOngoingCycle(fields.customfield_14046);
      const candidate: FrtAckCandidate = {
        key: issue.key,
        summary,
        reporter,
        machineRaised,
        remainingMs: cycle.remainingMs,
        withinCalendarHours: cycle.withinCalendarHours,
      };
      result.candidates.push(candidate);

      // `remaining()` keeps matching outside the SLA calendar because the clock is parked, not
      // spent: a ticket raised at 17:25 still reads "5m left" at 22:00 and all night. Acking it
      // then would email the customer out of hours for a deadline that is not actually near.
      // Jira's own withinCalendarHours flag is the exact test for "the clock is ticking now".
      if (!candidate.withinCalendarHours) {
        result.skipped++;
        continue;
      }

      if (this.isDenied(reporter)) {
        console.log(`[frt-safety-net] SKIP ${issue.key} - reporter "${reporter}" is on the denylist`);
        result.skipped++;
        continue;
      }

      const ackText = machineRaised
        ? (this.settings.get('frt_safety_net_internal_ack') || DEFAULT_INTERNAL_ACK)
        : (this.settings.get('frt_safety_net_customer_ack') || DEFAULT_CUSTOMER_ACK);

      if (mode === 'dry_run') {
        console.log(
          `[frt-safety-net] [DRY RUN] would acknowledge ${issue.key}`
          + ` (${machineRaised ? 'internal system' : 'customer'}, reporter=${reporter || 'unknown'},`
          + ` remaining=${formatRemaining(candidate.remainingMs)}) - ${summary.slice(0, 60)}`,
        );
        result.skipped++;
        continue;
      }

      // Blast guard: a misconfigured threshold or a sudden backlog must never turn into hundreds
      // of customer emails in one sweep. The remainder is picked up on the next run.
      if (result.acknowledged >= this.maxPerSweep()) {
        console.warn(
          `[frt-safety-net] Hit the per-sweep cap of ${this.maxPerSweep()} acknowledgements —`
          + ` leaving ${issues.length - i} candidate(s) for the next run. If this recurs, something`
          + ` upstream is wrong: investigate before raising frt_safety_net_max_per_sweep.`,
        );
        result.skipped++;
        continue;
      }

      try {
        // Customer-facing: this is the comment that stops the First Reply Time clock.
        await this.jiraClient.addComment(issue.key, ackText, { internal: false });
        // Internal note so the agent picking the ticket up knows the ack was automated and that
        // the customer has NOT yet had a real answer.
        await this.jiraClient.addComment(
          issue.key,
          'NOVA posted an automated first-reply acknowledgement because the First Reply Time SLA '
          + 'was about to breach with no customer-facing reply on the ticket. This stops the SLA '
          + 'clock only - the customer still needs a real response.',
          { internal: true },
        );
        result.acknowledged++;
        console.log(
          `[frt-safety-net] Acknowledged ${issue.key}`
          + ` (${machineRaised ? 'internal system' : 'customer'}, remaining=${formatRemaining(candidate.remainingMs)})`,
        );
      } catch (err) {
        result.failed++;
        console.error(
          `[frt-safety-net] Failed to acknowledge ${issue.key}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (result.scanned > 0) {
      console.log(
        `[frt-safety-net] Sweep complete (${mode}): scanned=${result.scanned}`
        + ` acknowledged=${result.acknowledged} skipped=${result.skipped} failed=${result.failed}`,
      );
    }
    return result;
  }
}

/** Pull the live cycle's state out of the cf14046 SLA payload. `remainingMs` goes negative once
 *  breached. `withinCalendarHours` defaults to true so a missing flag fails open to acknowledging
 *  rather than silently letting the SLA breach. */
function readOngoingCycle(raw: unknown): { remainingMs: number | null; withinCalendarHours: boolean } {
  const cycle = (raw as {
    ongoingCycle?: { remainingTime?: { millis?: number }; withinCalendarHours?: boolean };
  } | null | undefined)?.ongoingCycle;
  const millis = cycle?.remainingTime?.millis;
  return {
    remainingMs: typeof millis === 'number' ? millis : null,
    withinCalendarHours: cycle?.withinCalendarHours !== false,
  };
}

function formatRemaining(ms: number | null): string {
  if (ms === null) return 'unknown';
  const mins = Math.round(ms / 60000);
  return mins < 0 ? `breached by ${Math.abs(mins)}m` : `${mins}m`;
}
