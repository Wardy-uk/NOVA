import type { JiraRestClient } from './jira-client.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { adfText } from './frt-safety-net-adf.js';
import { query, execute } from './database.js';

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

/**
 * Placeholders, substituted by `renderAck`: {name} {key} {summary} {owner_line}.
 * Blank lines become separate paragraphs in the posted comment.
 *
 * A first reply that names nothing the customer wrote is barely a reply — it reads as a
 * form letter, which is how the first version of this landed. So it names them, quotes the
 * subject back, gives the ticket reference and says who has it.
 *
 * Deliberately no promised time. The golden rules want one, but this fires precisely when
 * nobody has picked the ticket up, so any interval quoted here would be invented and
 * probably missed — worse than saying nothing. Set `frt_safety_net_customer_ack` to add one
 * if there is a commitment the desk can actually keep.
 */
const DEFAULT_CUSTOMER_ACK =
  'Hi {name},\n\n'
  + 'Thanks for getting in touch about "{summary}". This is an automated acknowledgement to '
  + 'confirm your request has reached the Nurtur support team and is logged as {key}.\n\n'
  + '{owner_line}\n\n'
  + 'If anything changes or becomes more urgent in the meantime, reply to this ticket and it '
  + 'will come straight back to us.';

const DEFAULT_INTERNAL_ACK =
  'Automated acknowledgement: this ticket was raised by an internal system and has been logged '
  + 'for the team to action. No response is required from the sender.';

export type FrtSafetyNetMode = 'off' | 'dry_run' | 'live';

/** First name for the greeting. Jira gives us either a display name ("Abigail Brown") or,
 *  for email-raised tickets, a bare address. "Hi there" is the honest fallback — better a
 *  neutral greeting than "Hi barnita@address-properties.co.uk". */
function greetingName(displayName: string, email: string): string {
  const name = (displayName || '').trim();
  if (name && !name.includes('@')) {
    const first = name.split(/\s+/)[0];
    if (first && first.length > 1) return first;
  }
  void email;
  return 'there';
}

/** Blank-line-separated text into an ADF doc. `addComment` puts the whole string in one
 *  paragraph, which collapses the newlines and renders the ack as a wall of text. */
function textToAdf(text: string): object {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim().replace(/\s*\n\s*/g, ' ')).filter(Boolean);
  return {
    type: 'doc',
    version: 1,
    content: paragraphs.map(p => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })),
  };
}

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

/** Writes a real first reply that engages with what the customer actually asked.
 *  Injected rather than imported so the safety net keeps no dependency on the agent. */
export type GenericFirstReplyFn = (opts: {
  ticketKey: string;
  summary: string;
  description: string;
  reporterName: string;
  assigneeName: string;
}) => Promise<string>;

export class FrtSafetyNet {
  constructor(
    private jiraClient: JiraRestClient,
    private settings: SettingsQueries,
    /** Optional. Without it the safety net posts the static template, exactly as before. */
    private generateReply?: GenericFirstReplyFn,
  ) {}

  /**
   * A written reply for a human-raised ticket, falling back to the static template.
   *
   * The safety net's original virtue was being cheap and deterministic — one JQL, one comment
   * post, no LLM — and that is why it held up on a day when everything else was saturated. An
   * LLM call at the deadline puts a failure mode in the one place that must not fail, so it is
   * strictly best-effort: short timeout, any error or slow response falls straight through to
   * the template. Cost is bounded by the sweep only ever seeing a handful of tickets at once.
   */
  private async buildCustomerReply(
    template: string,
    ctx: { name: string; key: string; summary: string; ownerLine: string; description: string; reporterName: string; assigneeName: string },
  ): Promise<{ text: string; generated: boolean }> {
    const staticText = this.renderAck(template, ctx);
    if (!this.generateReply || this.settings.get('frt_safety_net_generate_reply') === 'false') {
      return { text: staticText, generated: false };
    }

    const timeoutMs = parseInt(this.settings.get('frt_safety_net_generate_timeout_ms') || '', 10) || 20_000;
    try {
      const reply = await Promise.race([
        this.generateReply({
          ticketKey: ctx.key,
          summary: ctx.summary,
          description: ctx.description,
          reporterName: ctx.reporterName,
          assigneeName: ctx.assigneeName,
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), timeoutMs)),
      ]);
      const trimmed = (reply || '').trim();
      if (trimmed.length > 20) return { text: trimmed, generated: true };
      console.warn(`[frt-safety-net] Generated reply for ${ctx.key} was too short — using the template`);
    } catch (err) {
      console.warn(`[frt-safety-net] Reply generation failed for ${ctx.key}, using the template:`, err instanceof Error ? err.message : err);
    }
    return { text: staticText, generated: false };
  }

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

  /** Substitute placeholders into an ack template. Applied to the configured override too,
   *  so the wording can be tuned in settings without losing the personalisation. A template
   *  with no placeholders simply comes back unchanged. */
  private renderAck(template: string, ctx: { name: string; key: string; summary: string; ownerLine: string }): string {
    return template
      .replace(/\{name\}/g, ctx.name)
      .replace(/\{key\}/g, ctx.key)
      .replace(/\{summary\}/g, ctx.summary)
      .replace(/\{owner_line\}/g, ctx.ownerLine);
  }

  private maxPerSweep(): number {
    const parsed = parseInt(this.settings.get('frt_safety_net_max_per_sweep') || '', 10);
    return !isNaN(parsed) && parsed > 0 ? parsed : 25;
  }

  private maxAgeDays(): number {
    const parsed = parseInt(this.settings.get('frt_safety_net_max_age_days') || '', 10);
    return !isNaN(parsed) && parsed >= 1 ? parsed : 2;
  }

  /**
   * Tickets already acknowledged, so we never post twice.
   *
   * The original design needed no ack log: posting stops the FRT clock, so the ticket drops
   * out of the candidate query on its own. That is true right up until the stop condition
   * does not fire — and on 18 Sep 2026 NT-31702 and NT-31587 were each acknowledged NINE
   * times, once every sweep. Both are raised BY the NOVA service account, so NOVA was
   * replying to its own ticket and Jira never recorded a `Comment: For Customers`. The clock
   * kept running, the ticket stayed a candidate, and the sweep posted again three minutes
   * later, indefinitely.
   *
   * Self-idempotency via someone else's side effect is not idempotency. This records the fact
   * directly. Failures here are logged and ignored: an ack log that breaks must never stop
   * the safety net acknowledging a customer.
   */
  private async ensureAckTable(): Promise<void> {
    try {
      await execute(`IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'frt_ack_log')
        CREATE TABLE dbo.frt_ack_log (
          ticket_key VARCHAR(50) NOT NULL PRIMARY KEY,
          acked_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
          machine_raised BIT NOT NULL DEFAULT 0
        );`, []);
    } catch (err) {
      console.warn('[frt-safety-net] Could not ensure ack log table:', err instanceof Error ? err.message : err);
    }
  }

  private async loadAckedKeys(): Promise<Set<string>> {
    try {
      const rows = await query<{ ticket_key: string }>('SELECT ticket_key FROM frt_ack_log', []);
      return new Set(rows.map(r => r.ticket_key));
    } catch (err) {
      console.warn('[frt-safety-net] Could not read ack log:', err instanceof Error ? err.message : err);
      return new Set();
    }
  }

  private async recordAck(ticketKey: string, machineRaised: boolean): Promise<void> {
    try {
      await execute(
        `IF NOT EXISTS (SELECT 1 FROM frt_ack_log WHERE ticket_key = ?)
           INSERT INTO frt_ack_log (ticket_key, machine_raised) VALUES (?, ?)`,
        [ticketKey, ticketKey, machineRaised ? 1 : 0],
      );
    } catch (err) {
      console.warn(`[frt-safety-net] Could not record ack for ${ticketKey}:`, err instanceof Error ? err.message : err);
    }
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

    await this.ensureAckTable();
    const alreadyAcked = await this.loadAckedKeys();

    const search = await this.jiraClient.searchJqlAll(
      this.buildJql(),
      ['summary', 'reporter', 'created', 'assignee', 'description', 'customfield_14046'],
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
      const assigneeName = (fields.assignee as { displayName?: string } | null)?.displayName ?? '';
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

      // Never acknowledge the same ticket twice, whatever the SLA clock says.
      if (alreadyAcked.has(issue.key)) {
        result.skipped++;
        continue;
      }

      if (this.isDenied(reporter)) {
        console.log(`[frt-safety-net] SKIP ${issue.key} - reporter "${reporter}" is on the denylist`);
        result.skipped++;
        continue;
      }

      // Naming the assignee only when there is one: the sweep fires on plenty of tickets
      // nobody owns yet, and "X is looking after this" would be a lie on those.
      const ownerLine = assigneeName
        ? `${assigneeName} is looking after this for you and will be in touch with an update or next steps.`
        : 'It is with our support team now, and the agent who picks it up will come back to you with an update or next steps.';

      const ackCtx = {
        name: greetingName(reporterField?.displayName ?? '', reporterField?.emailAddress ?? ''),
        key: issue.key,
        summary,
        ownerLine,
        description: adfText(fields.description),
        reporterName: reporterField?.displayName || reporterField?.emailAddress || 'there',
        assigneeName: assigneeName || 'the Customer Care team',
      };

      // Machine-raised tickets get the terse template — there is no person to write to, and
      // spending an LLM call to tell an alerting mailbox we received its alert is waste.
      // A human gets a written reply that engages with what they actually asked.
      let ackText: string;
      let generated = false;
      if (machineRaised) {
        ackText = this.renderAck(this.settings.get('frt_safety_net_internal_ack') || DEFAULT_INTERNAL_ACK, ackCtx);
      } else {
        const built = await this.buildCustomerReply(
          this.settings.get('frt_safety_net_customer_ack') || DEFAULT_CUSTOMER_ACK,
          ackCtx,
        );
        ackText = built.text;
        generated = built.generated;
      }

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
        await this.jiraClient.addCommentAdf(issue.key, textToAdf(ackText), { internal: false });
        // Internal note so the agent picking the ticket up knows the ack was automated and that
        // the customer has NOT yet had a real answer.
        await this.jiraClient.addComment(
          issue.key,
          'NOVA posted an automated first-reply acknowledgement because the First Reply Time SLA '
          + 'was about to breach with no customer-facing reply on the ticket. This stops the SLA '
          + 'clock only - the customer still needs a real response.',
          { internal: true },
        );
        // Label it so the SLA can be reported honestly. Stopping the FRT clock makes the SLA
        // read as MET, so every ack quietly converts a breach into a pass — if this fires
        // routinely the FRT figure goes green precisely when the reply pipeline is broken,
        // and the number that should be raising the alarm is the one hiding it. The label
        // makes these separable in JQL, so the SLA goal can exclude them
        // (`AND labels != nova-frt-autoack`) and reporting can count them on their own.
        // Best-effort: a failed label must never undo an acknowledgement already posted.
        const ackLabel = this.settings.get('frt_safety_net_label') ?? 'nova-frt-autoack';
        if (ackLabel) {
          try {
            await this.jiraClient.addLabel(issue.key, ackLabel);
          } catch (err) {
            console.warn(`[frt-safety-net] Could not label ${issue.key} with "${ackLabel}":`, err instanceof Error ? err.message : err);
          }
        }

        await this.recordAck(issue.key, machineRaised);
        alreadyAcked.add(issue.key);
        result.acknowledged++;
        console.log(
          `[frt-safety-net] Acknowledged ${issue.key}`
          + ` (${machineRaised ? 'internal system' : generated ? 'customer, written reply' : 'customer, TEMPLATE fallback'},`
          + ` remaining=${formatRemaining(candidate.remainingMs)})`,
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

    // Fire rate is the health signal, not the breach count. This net exists to catch the
    // occasional miss; a sweep acknowledging several real customers means the reply pipeline
    // is not replying, and because each ack stops the SLA clock the FRT figure will look
    // BETTER the worse things get. Say so plainly rather than leaving a healthy-looking
    // "acknowledged=N" summary as the only trace.
    const customerAcks = result.candidates.filter(c => !c.machineRaised).length;
    const alarmAt = parseInt(this.settings.get('frt_safety_net_alarm_threshold') || '', 10) || 3;
    if (mode === 'live' && result.acknowledged > 0 && customerAcks >= alarmAt) {
      console.warn(
        `[frt-safety-net] ${customerAcks} customer ticket(s) needed an automated first reply in a single sweep.`
        + ' The safety net is carrying the desk, not backstopping it — FRT will still read as met.'
        + ' Check agent tick times and whether triage is posting replies.',
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
