import type { SettingsQueries } from '../db/settings-store.js';
import type { JiraRestClient, JiraComment } from './jira-client.js';
import type { Observer } from './observer.js';
import type { LlmService } from './llm-service.js';
import type { AgentShadowMode } from './agent-types.js';
import { ChaseResultSchema, type ChaseResult } from './chase-schema.js';
import { loadPrompt } from './prompt-loader.js';
import { buildResolveFields } from '../utils/jira-resolve-fields.js';
import { prepareTicketForClose } from './close-ticket-helper.js';
import { Actor } from './actor.js';
import { businessDaysBetween, addBusinessDays } from '../utils/business-hours.js';
import { extractText } from './shared/adf-utils.js';

const QUICK_RESOLVE_TRANSITION_ID = '17';
const CF_CURRENT_TIER = 'customfield_12981';
const EXCLUDED_TIERS = new Set(['Development', 'Tier 3']);

export interface StaleSweepResult {
  scanned: number;
  chased: number;
  closed: number;
  skipped: number;
}

interface SweepOpts {
  now: Date;
  firstWd: number;
  intervalWd: number;
  closeWd: number;
  maxChases: number;
  resolution: string;
  excludeLabels: string[];
  shadow: boolean;
}

/**
 * Unified stale-ticket lifecycle: finds tickets sitting in a "waiting on the requestor"
 * status with no customer reply, chases up to N times (counting human *or* NOVA chases),
 * then auto-closes after the configured window. Supersedes the old `runChaseSweep` and the
 * lifecycle-manager stale→chase→close branches. JQL-driven so it covers EVERY waiting ticket,
 * not just ones NOVA already tracks. See agent_work/ba/stale-ticket-autoclose-spec.md.
 */
export class StaleLifecycleService {
  constructor(
    private settings: SettingsQueries,
    private jiraClient: JiraRestClient,
    private observer: Observer,
    private llmService: LlmService | null,
  ) {}

  private getNum(key: string, fallback: number): number {
    const v = this.settings.get(key);
    if (!v) return fallback;
    const n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }

  private getStr(key: string, fallback: string): string {
    const v = this.settings.get(key);
    return v && v.trim() ? v : fallback;
  }

  private csv(key: string, fallback: string): string[] {
    return this.getStr(key, fallback).split(',').map(s => s.trim()).filter(Boolean);
  }

  async sweep(shadowMode: AgentShadowMode): Promise<StaleSweepResult> {
    const result: StaleSweepResult = { scanned: 0, chased: 0, closed: 0, skipped: 0 };
    if (this.settings.get('stale_autoclose_enabled') === 'false') return result;

    const statusIds = this.csv('stale_autoclose_waiting_status_ids', '11768');
    const projects = this.csv('stale_autoclose_projects', 'NT');
    if (!statusIds.length || !projects.length) return result;

    const opts: SweepOpts = {
      now: new Date(),
      firstWd: this.getNum('stale_chase_first_wd', 2),
      intervalWd: this.getNum('stale_chase_interval_wd', 2),
      closeWd: this.getNum('stale_close_wd', 5),
      maxChases: this.getNum('stale_chase_max', 2),
      resolution: this.getStr('stale_autoclose_resolution', 'Request Cancelled / Withdrawn'),
      excludeLabels: this.csv('stale_autoclose_exclude_labels', 'nova-no-autoclose').map(l => l.toLowerCase()),
      shadow: shadowMode === 'full_shadow',
    };

    const batchMax = this.getNum('stale_batch_max', 60);
    // Oldest-updated first so the stalest tickets are handled within the batch cap.
    const jql = `project IN (${projects.join(',')}) AND status IN (${statusIds.join(',')}) ORDER BY updated ASC`;

    let issues: Array<{ key: string; id: string; fields: Record<string, any> }>;
    try {
      const search = await this.jiraClient.searchJqlAll(
        jql,
        ['summary', 'status', 'priority', 'assignee', 'reporter', 'created', 'labels', CF_CURRENT_TIER],
        batchMax,
      );
      issues = search.issues as any;
    } catch (err) {
      console.warn('[stale-lifecycle] candidate search failed:', err instanceof Error ? err.message : err);
      return result;
    }

    for (const issue of issues.slice(0, batchMax)) {
      result.scanned++;
      try {
        const outcome = await this.evaluateTicket(issue, opts);
        if (outcome === 'chased') result.chased++;
        else if (outcome === 'closed') result.closed++;
        else result.skipped++;
      } catch (err) {
        console.warn(`[stale-lifecycle] ${issue.key} failed:`, err instanceof Error ? err.message : err);
        result.skipped++;
      }
    }

    if (result.chased || result.closed) {
      console.log(`[stale-lifecycle] scanned ${result.scanned}, chased ${result.chased}, closed ${result.closed}, skipped ${result.skipped}${opts.shadow ? ' [SHADOW]' : ''}`);
    }
    return result;
  }

  private async evaluateTicket(
    issue: { key: string; id: string; fields: Record<string, any> },
    opts: SweepOpts,
  ): Promise<'chased' | 'closed' | 'skip'> {
    const ticketKey = issue.key;
    const f = issue.fields;
    const currentStatusName: string = f.status?.name ?? '';
    const reporterAccountId: string | undefined = f.reporter?.accountId;
    const reporterEmail: string | undefined = f.reporter?.emailAddress;

    // T0 = when the ticket last entered its current (waiting) status. We only process tickets
    // already in a waiting status, so the latest transition INTO the current status is the clock start.
    const t0 = await this.findWaitingStart(ticketKey, currentStatusName, f.created);
    if (!t0) return 'skip';

    const comments = await this.jiraClient.getComments(ticketKey, 50);

    // A customer reply after T0 means they're not silent — abort the whole flow (no chase, no close).
    const customerReplied = comments.some(c =>
      this.commentAfter(c, t0) && this.isCustomer(c, reporterAccountId, reporterEmail),
    );
    if (customerReplied) return 'skip';

    // Chases since T0 = outward (public) support comments — counts whether a human OR NOVA sent them.
    const supportChases = comments.filter(c =>
      this.commentAfter(c, t0) && c.jsdPublic !== false && !this.isCustomer(c, reporterAccountId, reporterEmail),
    );
    const chaseCount = supportChases.length;
    const lastTouch = chaseCount
      ? new Date(Math.max(...supportChases.map(c => Date.parse(c.created))))
      : t0;

    const silentBd = businessDaysBetween(t0, opts.now);
    const sinceTouchBd = businessDaysBetween(lastTouch, opts.now);
    const excluded = this.isExcluded(f, opts.excludeLabels);

    // Close: window elapsed, not excluded, at least one chase/warning already went out (so we
    // never close a ticket the customer was never chased about), and a grace day has passed
    // since the last chase so they had a chance to respond.
    if (!excluded && silentBd >= opts.closeWd && chaseCount >= 1 && sinceTouchBd >= 1) {
      await this.closeTicket(ticketKey, issue, opts, silentBd);
      return 'closed';
    }

    // Chase: under the cap, the first-chase delay has passed, and nothing chased it recently
    // (so we don't stack on a human who just chased). Mark as final — i.e. include the close
    // warning — when it's the last allowed chase OR the ticket is already past the close window
    // (a never-chased backlog ticket must still get a warning before it can close next cycle).
    if (chaseCount < opts.maxChases && silentBd >= opts.firstWd && sinceTouchBd >= opts.intervalWd) {
      const isFinal = chaseCount + 1 >= opts.maxChases || silentBd >= opts.closeWd;
      await this.sendChase(ticketKey, issue, opts, silentBd, isFinal);
      return 'chased';
    }

    return 'skip';
  }

  /** Most recent changelog transition INTO `statusName`; falls back to issue creation date. */
  private async findWaitingStart(ticketKey: string, statusName: string, createdIso?: string): Promise<Date | null> {
    try {
      const log = await this.jiraClient.getChangelog(ticketKey, 100);
      let latest: number | null = null;
      for (const entry of log) {
        const movedIntoWaiting = entry.items?.some(it => it.field === 'status' && it.toString === statusName);
        if (movedIntoWaiting) {
          const ts = Date.parse(entry.created);
          if (!isNaN(ts) && (latest === null || ts > latest)) latest = ts;
        }
      }
      if (latest !== null) return new Date(latest);
    } catch (err) {
      console.warn(`[stale-lifecycle] changelog fetch failed for ${ticketKey}:`, err instanceof Error ? err.message : err);
    }
    const created = createdIso ? Date.parse(createdIso) : NaN;
    return isNaN(created) ? null : new Date(created);
  }

  private commentAfter(c: JiraComment, t0: Date): boolean {
    const ts = Date.parse(c.created);
    return !isNaN(ts) && ts > t0.getTime();
  }

  private isCustomer(c: JiraComment, reporterAccountId?: string, reporterEmail?: string): boolean {
    const a = c.author;
    if (!a) return false;
    if (a.accountType === 'customer') return true;
    if (reporterAccountId && a.accountId === reporterAccountId) return true;
    if (reporterEmail && a.emailAddress && a.emailAddress.toLowerCase() === reporterEmail.toLowerCase()) return true;
    return false;
  }

  private isExcluded(f: Record<string, any>, excludeLabels: string[]): boolean {
    const labels: string[] = Array.isArray(f.labels) ? f.labels : [];
    if (labels.some(l => excludeLabels.includes(String(l).toLowerCase()))) return true;
    const tier = f[CF_CURRENT_TIER]?.value as string | undefined;
    if (tier && EXCLUDED_TIERS.has(tier)) return true;
    return false;
  }

  private async sendChase(
    ticketKey: string,
    issue: { key: string; id: string; fields: Record<string, any> },
    opts: SweepOpts,
    silentBd: number,
    isFinal: boolean,
  ): Promise<void> {
    const f = issue.fields;
    const closeDate = addBusinessDays(opts.now, Math.max(1, opts.closeWd - silentBd));
    const closeDateLabel = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long',
    }).format(closeDate);

    const draft = await this.buildChaseText(ticketKey, f, silentBd, isFinal, closeDateLabel);

    const decisionId = await this.observer.logDecision({
      ticketId: issue.id,
      ticketKey,
      eventType: 'stale',
      action: 'chase',
      confidence: 1.0,
      reasoning: `No customer reply for ${silentBd} working day(s); chase ${isFinal ? '(final, with close warning)' : ''} via unified stale lifecycle`,
      approvalRequired: false,
      shadowMode: opts.shadow,
      inputs: { summary: f.summary ?? '', status: f.status?.name ?? '', silentBusinessDays: silentBd, isFinal },
      output: { recommended_action: 'chase', draft_response: draft },
    });

    if (!opts.shadow) {
      if (draft && !Actor.looksLikeStructuredPayload(draft)) {
        await this.jiraClient.addComment(ticketKey, draft, { internal: false });
      } else if (draft) {
        console.error(`[stale-lifecycle] BLOCKED chase on ${ticketKey}: draft looks like structured data`);
      }
      await this.jiraClient.addComment(
        ticketKey,
        `\u{1F916} NOVA stale lifecycle — chase ${isFinal ? '2 (final, close warning)' : '1'} sent after ${silentBd} working day(s) of no customer reply.`,
        { internal: true },
      ).catch(() => { /* best effort */ });
    }

    await this.observer.logOutcome(decisionId, {
      success: true,
      action: 'chase',
      ticketKey,
      detail: opts.shadow ? `[SHADOW] Would chase (${silentBd}wd silent)` : `Chase ${isFinal ? '(final)' : ''} sent`,
    });
  }

  private async buildChaseText(
    ticketKey: string,
    f: Record<string, any>,
    silentBd: number,
    isFinal: boolean,
    closeDateLabel: string,
  ): Promise<string> {
    const warning = isFinal
      ? `\n\nIf we don't hear back by ${closeDateLabel} we'll close this ticket. You can always reply to reopen it or raise a new one.`
      : '';

    if (!this.llmService) {
      return `Hi,\n\nWe're following up on ${ticketKey} — "${f.summary ?? ''}". We haven't heard back and want to make sure this is sorted for you. Could you let us know if you still need help?${warning}\n\nThanks,\nNurtur Support`;
    }

    try {
      const issue = await this.jiraClient.getIssue(ticketKey, ['description', 'comment']);
      const fd = issue?.fields ?? {};
      const comments = (fd.comment as any)?.comments as Array<{ author?: { displayName?: string }; body?: unknown; created?: string }> | undefined;
      const thread = (comments ?? []).slice(-5)
        .map(c => `[${c.created ?? ''}] ${c.author?.displayName ?? 'Unknown'}:\n${extractText(c.body).slice(0, 300)}`)
        .join('\n\n---\n\n');

      const systemPrompt = loadPrompt('chase', {
        ticket_key: ticketKey,
        summary: (f.summary as string) ?? ticketKey,
        description: extractText(fd.description).slice(0, 500),
        priority: f.priority?.name ?? 'Medium',
        reporter: f.reporter?.displayName ?? 'Unknown',
        organisation: (f.reporter?.emailAddress as string | undefined)?.split('@')[1] ?? 'Unknown',
        status: f.status?.name ?? 'Waiting On Requestor',
        days_waiting: String(silentBd),
        conversation_thread: thread || '(no comments)',
      });

      const res = await this.llmService.call<ChaseResult>(
        systemPrompt,
        'Draft a contextual follow-up message for this stale ticket.',
        ChaseResultSchema,
        { ticketId: ticketKey, callType: 'chase', temperature: 0.3 },
      );
      return res.data.draft_response + warning;
    } catch (err) {
      console.warn(`[stale-lifecycle] LLM chase draft failed for ${ticketKey}, using fallback:`, err instanceof Error ? err.message : err);
      return `Hi,\n\nWe're following up on ${ticketKey} — "${f.summary ?? ''}". Could you let us know if you still need help with this?${warning}\n\nThanks,\nNurtur Support`;
    }
  }

  private async closeTicket(
    ticketKey: string,
    issue: { key: string; id: string; fields: Record<string, any> },
    opts: SweepOpts,
    silentBd: number,
  ): Promise<void> {
    const f = issue.fields;
    const publicMsg = `We haven't heard back on this ticket for over ${silentBd} working days, so we're closing it. If you still need help, just reply to reopen it or raise a new ticket. Thanks, Nurtur Support.`;

    const decisionId = await this.observer.logDecision({
      ticketId: issue.id,
      ticketKey,
      eventType: 'stale',
      action: 'transition',
      confidence: 1.0,
      reasoning: `No customer reply for ${silentBd} working days — auto-close (${opts.resolution}) via unified stale lifecycle`,
      approvalRequired: false,
      shadowMode: opts.shadow,
      inputs: { summary: f.summary ?? '', status: f.status?.name ?? '', silentBusinessDays: silentBd },
      output: { recommended_action: 'close', resolution: opts.resolution },
    });

    try {
      if (!opts.shadow) {
        await this.jiraClient.addComment(ticketKey, publicMsg, { internal: false }).catch(() => { /* best effort */ });
        await this.jiraClient.addComment(
          ticketKey,
          `\u{1F916} NOVA stale lifecycle — auto-closed after ${silentBd} working days of no customer reply (${opts.resolution}).`,
          { internal: true },
        ).catch(() => { /* best effort */ });

        await prepareTicketForClose(this.jiraClient, this.settings, {
          ticketKey,
          requestTypeOverride: 'Emailed request',
        });
        const { fields, comment } = buildResolveFields({
          tldr: `No customer response for ${silentBd}+ working days — auto-closed by NOVA stale lifecycle`,
          resolution: opts.resolution,
          comment: publicMsg,
        });
        await this.jiraClient.transitionIssue(ticketKey, QUICK_RESOLVE_TRANSITION_ID, { fields, comment });
      }

      await this.observer.logOutcome(decisionId, {
        success: true,
        action: 'transition',
        ticketKey,
        detail: opts.shadow ? `[SHADOW] Would auto-close (${silentBd}wd silent)` : `Auto-closed (${opts.resolution})`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.observer.logOutcome(decisionId, { success: false, action: 'transition', ticketKey, detail: `Auto-close failed: ${msg}`, error: msg });
      console.warn(`[stale-lifecycle] auto-close failed for ${ticketKey}:`, msg);
    }
  }
}
