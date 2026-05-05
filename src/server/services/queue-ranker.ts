import { JiraCacheQueries, type CachedIssue, type CachedComment } from './jira-cache-queries.js';
import { createWorkingDayClock, type WorkingDayClock } from '../../shared/utils/workingDayClock.js';
import { onEventWritten } from './agent-events.js';
import { query } from './database.js';
import type { FileSettingsQueries } from '../db/settings-store.js';

export type TicketBand = 'NOW' | 'NEXT' | 'DEFERRED' | 'HYGIENE' | 'WAITING';

export interface NextAction {
  state: 'action_ready' | 'waiting' | 'stalled' | 'no_context';
  headline: string;
  body: string;
  primaryAction: { label: string; jiraTransition: string | null };
  generatedAt: string;
}

export interface TicketFields {
  summary: string | null;
  status: string | null;
  statusCategory: string | null;
  priority: string | null;
  tier: string | null;
  product: string | null;
  tldr: string | null;
  agentSummary: string | null;
  escalationReason: string | null;
  reporter: string | null;
  assignee: string | null;
  updated: string | null;
  created: string | null;
  slaBreachTime: string | null;
  slaBreached: boolean;
  agentNextUpdate: string | null;
}

export interface RankedTicket {
  ticketKey: string;
  score: number;
  band: TicketBand;
  rankReason: string;
  fields: TicketFields;
  nextAction?: NextAction;
}

export interface QueueResult {
  agentId: string;
  computedAt: string;
  tickets: RankedTicket[];
}

interface RankingWeights {
  sla_breach_imminent: number;
  next_update_elapsed: number;
  customer_reply_no_response: number;
  last_comment_stale: number;
  ai_action_ready: number;
  ai_stalled: number;
  hygiene_flagged: number;
  ai_waiting: number;
}

const DEFAULT_WEIGHTS: RankingWeights = {
  sla_breach_imminent: 100,
  next_update_elapsed: 95,
  customer_reply_no_response: 80,
  last_comment_stale: 70,
  ai_action_ready: 50,
  ai_stalled: 60,
  hygiene_flagged: 40,
  ai_waiting: 10,
};

interface CacheEntry {
  result: QueueResult;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 200;

export class QueueRanker {
  private cache = new Map<string, CacheEntry>();
  private jiraCache: JiraCacheQueries;
  private settings: FileSettingsQueries;
  private clock: WorkingDayClock;
  private weights: RankingWeights;

  constructor(
    jiraCache: JiraCacheQueries,
    settings: FileSettingsQueries,
    bankHolidays: string[] = [],
  ) {
    this.jiraCache = jiraCache;
    this.settings = settings;
    this.clock = createWorkingDayClock({}, bankHolidays);
    this.weights = this.loadWeights();

    onEventWritten((agentId) => {
      this.cache.delete(agentId);
    });
  }

  private loadWeights(): RankingWeights {
    try {
      const raw = this.settings.get('my_tickets.ranking_weights');
      if (raw) return { ...DEFAULT_WEIGHTS, ...JSON.parse(raw) };
    } catch { /* use defaults */ }
    return { ...DEFAULT_WEIGHTS };
  }

  async computeQueue(agentId: string, agentEmail: string): Promise<QueueResult> {
    const cached = this.cache.get(agentId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.result;
    }

    const issues = await this.jiraCache.getByAssignee(agentEmail, ['NT']);

    // Load deferred ticket keys
    const deferredRows = await query<{ ticket_key: string; reason: string; resurface_at: Date }>(
      `SELECT ticket_key, reason, resurface_at FROM ticket_defers
       WHERE agent_id = ? AND resolved_at IS NULL`,
      [agentId],
    );
    const deferredKeys = new Set(deferredRows.map(r => r.ticket_key));

    // Load hygiene-flagged tickets
    const hygieneRows = await query<{ ticket_key: string }>(
      `SELECT DISTINCT ticket_key FROM agent_events
       WHERE agent_id = ? AND event_type = 'hygiene_flagged'
         AND created_at >= CAST(SYSUTCDATETIME() AS DATE)
         AND ticket_key IS NOT NULL`,
      [agentId],
    );
    const hygieneKeys = new Set(hygieneRows.map(r => r.ticket_key));

    const ranked: RankedTicket[] = [];
    const w = this.weights;

    for (const issue of issues) {
      if (deferredKeys.has(issue.issue_key)) continue;

      const signals = await this.computeSignals(issue, w);
      const totalScore = signals.reduce((sum, s) => sum + s.score, 0);

      const topSignal = signals.sort((a, b) => b.score - a.score)[0];
      const rankReason = topSignal?.reason ?? 'No signals';

      let band: TicketBand = totalScore > 0 ? 'NEXT' : 'WAITING';
      if (hygieneKeys.has(issue.issue_key)) band = 'HYGIENE';

      ranked.push({
        ticketKey: issue.issue_key,
        score: totalScore,
        band,
        rankReason,
        fields: issueToFields(issue),
      });
    }

    // Add deferred tickets — look up fields from the full issues list
    const issueByKey = new Map(issues.map(i => [i.issue_key, i]));
    for (const d of deferredRows) {
      const issue = issueByKey.get(d.ticket_key);
      ranked.push({
        ticketKey: d.ticket_key,
        score: 0,
        band: 'DEFERRED',
        rankReason: `Deferred: ${d.reason}`,
        fields: issue ? issueToFields(issue) : emptyFields(),
      });
    }

    // Sort by score descending, then by ticket age as tiebreaker
    ranked.sort((a, b) => {
      if (a.band === 'DEFERRED' || a.band === 'HYGIENE' || a.band === 'WAITING') return 1;
      if (b.band === 'DEFERRED' || b.band === 'HYGIENE' || b.band === 'WAITING') return -1;
      return b.score - a.score;
    });

    // Top scorer becomes NOW
    if (ranked.length > 0 && ranked[0].band === 'NEXT') {
      ranked[0].band = 'NOW';
    }

    const result: QueueResult = {
      agentId,
      computedAt: new Date().toISOString(),
      tickets: ranked,
    };

    // Cache with LRU eviction
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(agentId, { result, expiresAt: Date.now() + CACHE_TTL_MS });

    return result;
  }

  private async computeSignals(
    issue: CachedIssue,
    w: RankingWeights,
  ): Promise<Array<{ signal: string; score: number; reason: string }>> {
    const signals: Array<{ signal: string; score: number; reason: string }> = [];
    const now = new Date();

    // 1. SLA breach imminent
    if (issue.sla_breach_time) {
      const breachAt = new Date(issue.sla_breach_time);
      const hoursUntilBreach = this.clock.workingHoursBetween(now, breachAt);
      if (hoursUntilBreach <= 2 && hoursUntilBreach > 0) {
        signals.push({
          signal: 'sla_breach_imminent',
          score: w.sla_breach_imminent,
          reason: `SLA breach in ${Math.round(hoursUntilBreach * 10) / 10}h`,
        });
      } else if (hoursUntilBreach <= 0) {
        signals.push({
          signal: 'sla_breach_imminent',
          score: w.sla_breach_imminent + 20,
          reason: 'SLA already breached',
        });
      }
    }

    // 2. Agent Next Update commitment elapsed
    if (issue.agent_next_update) {
      const nextUpdate = new Date(issue.agent_next_update);
      if (nextUpdate.getTime() <= now.getTime()) {
        const hoursOverdue = this.clock.workingHoursBetween(nextUpdate, now);
        signals.push({
          signal: 'next_update_elapsed',
          score: w.next_update_elapsed,
          reason: `Agent Next Update ${Math.round(hoursOverdue * 10) / 10}h overdue`,
        });
      }
    }

    // 3 & 4. Comment-based signals
    const comments = await this.jiraCache.getComments(issue.issue_key, 5);
    if (comments.length > 0) {
      const latestComment = comments[0]; // Already ordered DESC
      const isCustomerComment = this.isCustomerComment(latestComment, issue);

      if (isCustomerComment) {
        // Customer reply received, no agent response
        signals.push({
          signal: 'customer_reply_no_response',
          score: w.customer_reply_no_response,
          reason: 'Customer waiting for response',
        });
      } else if (!issue.agent_next_update) {
        // Check stale — last customer-facing comment ≥2 working days (only if no Agent Next Update set)
        const latestAgentComment = comments.find(c => !this.isCustomerComment(c, issue));
        if (latestAgentComment) {
          const commentDate = new Date(latestAgentComment.jira_created);
          const hoursSince = this.clock.workingHoursBetween(commentDate, now);
          if (hoursSince >= 16) { // 2 working days = 16 working hours
            signals.push({
              signal: 'last_comment_stale',
              score: w.last_comment_stale,
              reason: `No update in ${Math.round(hoursSince / 8)}d ${Math.round(hoursSince % 8)}h`,
            });
          }
        }
      }
    }

    return signals;
  }

  private isCustomerComment(comment: CachedComment, issue: CachedIssue): boolean {
    if (!comment.author_email) return false;
    return comment.author_email !== issue.assignee_email
      && comment.is_public;
  }
}

function issueToFields(issue: CachedIssue): TicketFields {
  return {
    summary: issue.summary,
    status: issue.status_name,
    statusCategory: issue.status_category,
    priority: issue.priority_name,
    tier: issue.current_tier,
    product: issue.nurtur_product,
    tldr: issue.tldr_text,
    agentSummary: issue.agent_summary_text,
    escalationReason: issue.escalation_reason_text,
    reporter: issue.reporter_display,
    assignee: issue.assignee_display,
    updated: issue.jira_updated?.toISOString() ?? null,
    created: issue.jira_created?.toISOString() ?? null,
    slaBreachTime: issue.sla_breach_time?.toISOString() ?? null,
    slaBreached: issue.sla_breached,
    agentNextUpdate: issue.agent_next_update?.toISOString() ?? null,
  };
}

function emptyFields(): TicketFields {
  return {
    summary: null, status: null, statusCategory: null, priority: null,
    tier: null, product: null, tldr: null, agentSummary: null,
    escalationReason: null, reporter: null, assignee: null,
    updated: null, created: null, slaBreachTime: null, slaBreached: false,
    agentNextUpdate: null,
  };
}
