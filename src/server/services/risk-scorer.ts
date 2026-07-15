import { query, queryOne, execute, executeAndGetId } from './database.js';
import type { SettingsQueries } from '../db/settings-store.js';

export interface RiskFactor {
  id: string;
  label: string;
  score: number;
  detail?: string;
}

export interface FlaggedTicket {
  id: number;
  ticket_key: string;
  risk_score: number;
  risk_factors: RiskFactor[];
  summary: string | null;
  assignee: string | null;
  reporter: string | null;
  priority: string | null;
  flagged_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  status: 'pending' | 'reviewed' | 'dismissed';
  last_notified_score: number;
  ticket_status: string | null;
  sla_breach_at: string | null;
  sla_breached: boolean;
  last_customer_comment: string | null;
  last_customer_comment_at: string | null;
  last_agent_comment: string | null;
  last_agent_comment_at: string | null;
  conversation_json: string | null;
  dismiss_reason: string | null;
  current_tier: string | null;
  project_key: string | null;
}

// ── "Nick — look at this" grouping ──────────────────────────────────────────
// Buckets a flagged ticket by its single highest-scoring risk factor so the
// calm board can group by *why* rather than dumping one flat list.

export interface LookAtThisTicket {
  ticket_key: string;
  risk_score: number;
  summary: string | null;
  assignee: string | null;
  priority: string | null;
  ticket_status: string | null;
  current_tier: string | null;
  project_key: string | null;
  flagged_at: string;
  sla_breached: boolean;
  sla_breach_at: string | null;
  category: string;      // 'legal' | 'angry' | 'sla' | 'stuck'
  why: string;           // headline reason (top factor label)
  reasons: string[];     // all factor labels, highest first
}

export interface LookAtThisGroup {
  key: string;
  label: string;
  emoji: string;
  count: number;
  tickets: LookAtThisTicket[];
}

export interface LookAtThisResult {
  total: number;
  groups: LookAtThisGroup[];
  generatedAt: string;
}

// Which board bucket each risk-factor id belongs to. Factors not listed
// (priority_severe, repeat_reporter) only contribute score, never define the bucket.
const FACTOR_CATEGORY: Record<string, string> = {
  escalation_strong: 'legal',
  sentiment_angry: 'angry',
  sentiment_frustrated: 'angry',
  escalation_moderate: 'angry',
  sla_breached: 'sla',
  sla_imminent: 'sla',
  agent_inactive: 'stuck',
  bounced: 'stuck',
  many_hands: 'stuck',
  stale_jira: 'stuck',
  parked_too_long: 'stuck',
  untriaged: 'stuck',
  unassigned: 'stuck',
  age_activity: 'stuck',
};

// Display order + presentation. Legal first (rarest, highest stakes), then the
// human-judgement buckets, then operational.
const CATEGORY_META: { key: string; label: string; emoji: string }[] = [
  { key: 'legal', label: 'Legal / formal', emoji: '⚖️' },
  { key: 'angry', label: 'Angry / frustrated', emoji: '😤' },
  { key: 'sla', label: 'SLA risk', emoji: '⏰' },
  { key: 'stuck', label: 'Stuck / stalled', emoji: '🌀' },
];

function categoriseTicket(ticket: FlaggedTicket): { category: string; why: string; reasons: string[] } {
  const factors = [...(ticket.risk_factors ?? [])].sort((a, b) => b.score - a.score);
  // The bucket is defined by the highest-scoring factor that maps to a category.
  const defining = factors.find((f) => FACTOR_CATEGORY[f.id]);
  const category = defining ? FACTOR_CATEGORY[defining.id] : 'stuck';
  const why = defining?.label ?? factors[0]?.label ?? 'Flagged for review';
  return { category, why, reasons: factors.map((f) => f.label) };
}

export function groupFlaggedByReason(tickets: FlaggedTicket[], minScore = 0): LookAtThisResult {
  const qualifying = tickets.filter((t) => t.risk_score >= minScore);
  const byKey = new Map<string, LookAtThisTicket[]>();
  for (const meta of CATEGORY_META) byKey.set(meta.key, []);

  for (const t of qualifying) {
    const { category, why, reasons } = categoriseTicket(t);
    byKey.get(category)!.push({
      ticket_key: t.ticket_key,
      risk_score: t.risk_score,
      summary: t.summary,
      assignee: t.assignee,
      priority: t.priority,
      ticket_status: t.ticket_status,
      current_tier: t.current_tier,
      project_key: t.project_key,
      flagged_at: t.flagged_at,
      sla_breached: t.sla_breached,
      sla_breach_at: t.sla_breach_at,
      category,
      why,
      reasons,
    });
  }

  const groups: LookAtThisGroup[] = CATEGORY_META
    .map((meta) => {
      const list = (byKey.get(meta.key) ?? []).sort((a, b) => b.risk_score - a.risk_score);
      return { key: meta.key, label: meta.label, emoji: meta.emoji, count: list.length, tickets: list };
    })
    .filter((g) => g.count > 0);

  return { total: qualifying.length, groups, generatedAt: new Date().toISOString() };
}

interface TicketRiskInput {
  issueKey: string;
  summary: string | null;
  assignee: string | null;
  assigneeAccountId: string | null;
  reporter: string | null;
  reporterAccountId: string | null;
  priority: string | null;
  jiraCreated: Date | null;
  slaBreachTime: Date | null;
  slaBreached: boolean;
  commentCount: number;
  lastCustomerReplyAt: Date | null;
  lastAgentActionAt: Date | null;
  sentimentScore: number | null;
  reassignCount: number;
  uniqueInternalCommenters: number;
  hasStrongEscalation: boolean;
  hasModerateEscalation: boolean;
  reporterOpenTicketCount: number;
  statusName: string | null;
  jiraUpdated: Date | null;
  descriptionText: string | null;
}

const STRONG_ESCALATION = /\b(formal\s+complaint|lawyer|solicitor|legal\s+action|trading\s+standards|ombudsman|ICO|GDPR\s+breach|data\s+protection)\b/i;
const MODERATE_ESCALATION = /\b(escalat|unacceptable|disgraceful|ridiculous|appalling|demand|threatening)\b/i;

export class RiskScorer {
  private settings: SettingsQueries;

  constructor(settings: SettingsQueries) {
    this.settings = settings;
  }

  async runStartupCleanup(): Promise<void> {
    const guard2 = this.settings.get('agent_retune_v2_applied');
    if (!guard2) {
      console.log('[risk] Running one-time retune v2 stale flag dismissal...');
      await execute(
        `UPDATE agent_flagged_tickets
         SET status = 'dismissed', reviewed_by = 'system-retune', reviewed_at = GETUTCDATE()
         WHERE status = 'pending'`,
      );
      console.log('[risk] Dismissed all pending flagged tickets for retune v2');
      this.settings.set('agent_retune_v2_applied', 'true');
    }

    const guard3 = this.settings.get('agent_retune_v3_applied');
    if (!guard3) {
      console.log('[risk] Running one-time retune v3 — flushing old-model flags...');
      await execute(
        `UPDATE agent_flagged_tickets
         SET status = 'dismissed', reviewed_by = 'system-retune-v3', reviewed_at = GETUTCDATE()
         WHERE status = 'pending'`,
      );
      console.log('[risk] Dismissed all pending flagged tickets for retune v3');
      this.settings.set('agent_retune_v3_applied', 'true');
    }
  }

  private getThreshold(): number {
    const val = this.settings.get('agent_risk_threshold');
    return val ? parseInt(val, 10) || 60 : 60;
  }

  scoreTicket(input: TicketRiskInput): { score: number; factors: RiskFactor[] } {
    const factors: RiskFactor[] = [];
    const now = Date.now();

    // 1. Sentiment deterioration — higher weight for strong negative
    if (input.sentimentScore !== null) {
      if (input.sentimentScore <= -0.7) {
        factors.push({ id: 'sentiment_angry', label: 'Angry customer', score: 30, detail: `Sentiment: ${input.sentimentScore.toFixed(2)}` });
      } else if (input.sentimentScore <= -0.3) {
        factors.push({ id: 'sentiment_frustrated', label: 'Frustrated customer', score: 15, detail: `Sentiment: ${input.sentimentScore.toFixed(2)}` });
      }
    }

    // 2. Escalation language — tiered scoring
    if (input.hasStrongEscalation) {
      factors.push({ id: 'escalation_strong', label: 'Legal/formal escalation', score: 35 });
    } else if (input.hasModerateEscalation) {
      factors.push({ id: 'escalation_moderate', label: 'Customer frustration', score: 15 });
    }

    // 3. Age + activity — tiered thresholds, lower bar for very old tickets
    if (input.jiraCreated) {
      const ageDays = (now - input.jiraCreated.getTime()) / 86_400_000;
      if (ageDays >= 7 && input.commentCount >= 15) {
        factors.push({ id: 'age_activity', label: `${Math.round(ageDays)}d old, ${input.commentCount} comments`, score: 20 });
      } else if (ageDays >= 5 && input.commentCount >= 10) {
        factors.push({ id: 'age_activity', label: `${Math.round(ageDays)}d old, ${input.commentCount} comments`, score: 15 });
      } else if (ageDays >= 10 && input.commentCount >= 5) {
        factors.push({ id: 'age_activity', label: `${Math.round(ageDays)}d old, ${input.commentCount} comments`, score: 10 });
      } else if (ageDays >= 30 && input.commentCount >= 2) {
        factors.push({ id: 'age_activity', label: `${Math.round(ageDays)}d old, ${input.commentCount} comments`, score: 10 });
      }
    }

    // 4. Bounce detection
    if (input.reassignCount >= 3) {
      factors.push({ id: 'bounced', label: `Bounced ${input.reassignCount}x`, score: 20 });
    }
    if (input.uniqueInternalCommenters >= 6) {
      factors.push({ id: 'many_hands', label: `${input.uniqueInternalCommenters} internal commenters`, score: 15 });
    }

    // 5. Agent inaction — with fallback for pre-agent tickets
    if (input.lastCustomerReplyAt && input.lastAgentActionAt) {
      const customerWaitHours = (now - input.lastCustomerReplyAt.getTime()) / 3_600_000;
      const agentLastHours = (now - input.lastAgentActionAt.getTime()) / 3_600_000;
      if (customerWaitHours > 24 && agentLastHours > 24) {
        const hours = Math.round(agentLastHours);
        factors.push({ id: 'agent_inactive', label: `Agent inactive ${hours}h`, score: hours >= 48 ? 25 : 15 });
      }
    } else if (input.lastCustomerReplyAt && !input.lastAgentActionAt) {
      const customerWaitHours = (now - input.lastCustomerReplyAt.getTime()) / 3_600_000;
      if (customerWaitHours > 24) {
        factors.push({ id: 'agent_inactive', label: `No agent reply in ${Math.round(customerWaitHours)}h`, score: 20 });
      }
    } else if (!input.lastCustomerReplyAt && !input.lastAgentActionAt && input.jiraUpdated) {
      const staleDays = (now - input.jiraUpdated.getTime()) / 86_400_000;
      if (staleDays >= 14) {
        factors.push({ id: 'agent_inactive', label: `No agent data, last Jira update ${Math.round(staleDays)}d ago`, score: 10 });
      }
    }

    // 6. SLA breach
    if (input.slaBreached) {
      factors.push({ id: 'sla_breached', label: 'SLA breached', score: 30 });
    } else if (input.slaBreachTime) {
      const minutesToBreach = (input.slaBreachTime.getTime() - now) / 60_000;
      if (minutesToBreach > 0 && minutesToBreach <= 30) {
        factors.push({ id: 'sla_imminent', label: `SLA breach in ${Math.round(minutesToBreach)}min`, score: 20 });
      }
    }

    // 7. Customer importance — repeat reporter
    if (input.reporterOpenTicketCount >= 5) {
      factors.push({ id: 'repeat_reporter', label: `Reporter has ${input.reporterOpenTicketCount} open tickets`, score: 10 });
    }

    // 8. Unassigned ticket — severity scales with age
    if (!input.assignee || input.assignee.trim() === '') {
      if (input.jiraCreated) {
        const ageDays = (now - input.jiraCreated.getTime()) / 86_400_000;
        if (ageDays >= 30) {
          factors.push({ id: 'unassigned', label: `Unassigned for ${Math.round(ageDays)}d`, score: 30 });
        } else if (ageDays >= 14) {
          factors.push({ id: 'unassigned', label: `Unassigned for ${Math.round(ageDays)}d`, score: 20 });
        } else if (ageDays >= 3) {
          factors.push({ id: 'unassigned', label: `Unassigned for ${Math.round(ageDays)}d`, score: 10 });
        }
      } else {
        factors.push({ id: 'unassigned', label: 'Unassigned (unknown age)', score: 15 });
      }
    }

    // 9. Stale in Jira — no updates from anyone
    if (input.jiraUpdated) {
      const staleDays = (now - input.jiraUpdated.getTime()) / 86_400_000;
      const waitingStatuses = ['waiting on customer', 'waiting for customer', 'waiting on requestor', 'pending customer'];
      const isWaiting = input.statusName && waitingStatuses.includes(input.statusName.toLowerCase());
      if (!isWaiting) {
        if (staleDays >= 60) {
          factors.push({ id: 'stale_jira', label: `No Jira update in ${Math.round(staleDays)}d`, score: 25 });
        } else if (staleDays >= 30) {
          factors.push({ id: 'stale_jira', label: `No Jira update in ${Math.round(staleDays)}d`, score: 15 });
        } else if (staleDays >= 14) {
          factors.push({ id: 'stale_jira', label: `No Jira update in ${Math.round(staleDays)}d`, score: 10 });
        }
      }
    }

    // 10. Untriaged — ticket still in Open/New status
    if (input.statusName) {
      const openStatuses = ['open', 'new', 'to do', 'backlog'];
      if (openStatuses.includes(input.statusName.toLowerCase()) && input.jiraCreated) {
        const ageDays = (now - input.jiraCreated.getTime()) / 86_400_000;
        if (ageDays >= 14) {
          factors.push({ id: 'untriaged', label: `Still "${input.statusName}" after ${Math.round(ageDays)}d`, score: 20 });
        } else if (ageDays >= 3) {
          factors.push({ id: 'untriaged', label: `Still "${input.statusName}" after ${Math.round(ageDays)}d`, score: 10 });
        }
      }
    }

    // 11. Priority severity — Critical/Blocker tickets need attention
    if (input.priority) {
      const p = input.priority.toLowerCase();
      if (p === 'blocker' || p === 'highest') {
        factors.push({ id: 'priority_severe', label: `Priority: ${input.priority}`, score: 25 });
      } else if (p === 'critical' || p === 'high') {
        factors.push({ id: 'priority_severe', label: `Priority: ${input.priority}`, score: 15 });
      }
    }

    // 12. Parked too long — stuck in waiting/customer status
    if (input.statusName && input.jiraUpdated) {
      const waitingStatuses = ['waiting on customer', 'waiting for customer', 'waiting on requestor', 'pending customer'];
      if (waitingStatuses.includes(input.statusName.toLowerCase())) {
        const parkedDays = (now - input.jiraUpdated.getTime()) / 86_400_000;
        if (parkedDays >= 30) {
          factors.push({ id: 'parked_too_long', label: `Parked in "${input.statusName}" for ${Math.round(parkedDays)}d`, score: 15 });
        }
      }
    }

    const score = Math.min(100, factors.reduce((s, f) => s + f.score, 0));
    return { score, factors };
  }

  async getScoreDistribution(projects: string[]): Promise<{ bucket: string; count: number }[]> {
    const projectPlaceholders = projects.map(() => '?').join(',');
    const rows = await query<{ bucket: string; cnt: number }>(
      `SELECT
         CASE
           WHEN risk_score >= 90 THEN '90-100'
           WHEN risk_score >= 80 THEN '80-89'
           WHEN risk_score >= 70 THEN '70-79'
           WHEN risk_score >= 60 THEN '60-69'
           WHEN risk_score >= 50 THEN '50-59'
           WHEN risk_score >= 40 THEN '40-49'
           WHEN risk_score >= 30 THEN '30-39'
           ELSE '0-29'
         END AS bucket,
         COUNT(*) AS cnt
       FROM agent_flagged_tickets
       WHERE status != 'dismissed'
       GROUP BY
         CASE
           WHEN risk_score >= 90 THEN '90-100'
           WHEN risk_score >= 80 THEN '80-89'
           WHEN risk_score >= 70 THEN '70-79'
           WHEN risk_score >= 60 THEN '60-69'
           WHEN risk_score >= 50 THEN '50-59'
           WHEN risk_score >= 40 THEN '40-49'
           WHEN risk_score >= 30 THEN '30-39'
           ELSE '0-29'
         END
       ORDER BY bucket DESC`,
      [],
    );
    return rows.map(r => ({ bucket: r.bucket, count: r.cnt }));
  }

  async runRiskSweep(projects: string[]): Promise<{ flagged: number; notified: number }> {
    const threshold = this.getThreshold();
    const projectPlaceholders = projects.map(() => '?').join(',');

    // Get all open tickets from cache with enrichment data
    const tickets = await query<{
      issue_key: string; summary: string; assignee_display: string; assignee_account_id: string;
      reporter_display: string; reporter_account_id: string; priority_name: string;
      jira_created: string; sla_breach_time: string | null; sla_breached: number;
      status_name: string; jira_updated: string; description_text: string | null;
    }>(
      `SELECT issue_key, summary, assignee_display, assignee_account_id,
              reporter_display, reporter_account_id, priority_name,
              jira_created, sla_breach_time, sla_breached,
              status_name, jira_updated, description_text
       FROM jira_issue_cache
       WHERE project_key IN (${projectPlaceholders}) AND status_category != 'done'`,
      projects,
    );

    if (tickets.length === 0) return { flagged: 0, notified: 0 };

    const ticketKeys = tickets.map(t => t.issue_key);
    const keyPlaceholders = ticketKeys.map(() => '?').join(',');

    // Batch fetch enrichment data
    const [stateRows, sentimentRows, commentStats, reassignCounts, reporterCounts] = await Promise.all([
      query<{ ticket_id: string; comment_count: number; last_customer_reply_at: string | null; last_agent_action_at: string | null }>(
        `SELECT ticket_id, comment_count, last_customer_reply_at, last_agent_action_at
         FROM agent_ticket_state WHERE ticket_id IN (${keyPlaceholders})`, ticketKeys,
      ),
      query<{ issue_key: string; sentiment_score: number }>(
        `SELECT issue_key, sentiment_score FROM problem_ticket_alerts
         WHERE issue_key IN (${keyPlaceholders}) AND sentiment_score IS NOT NULL AND resolved_at IS NULL`, ticketKeys,
      ),
      query<{ issue_key: string; unique_authors: number; has_strong_escalation: number; has_moderate_escalation: number; total_comments: number }>(
        `SELECT issue_key,
                COUNT(DISTINCT author_account_id) as unique_authors,
                MAX(CASE WHEN body_text LIKE '%formal complaint%' OR body_text LIKE '%lawyer%'
                         OR body_text LIKE '%solicitor%' OR body_text LIKE '%legal action%'
                         OR body_text LIKE '%trading standards%' OR body_text LIKE '%ombudsman%'
                         OR body_text LIKE '%ICO%' OR body_text LIKE '%GDPR breach%'
                         OR body_text LIKE '%data protection%'
                    THEN 1 ELSE 0 END) as has_strong_escalation,
                MAX(CASE WHEN body_text LIKE '%escalat%' OR body_text LIKE '%unacceptable%'
                         OR body_text LIKE '%disgraceful%' OR body_text LIKE '%ridiculous%'
                         OR body_text LIKE '%appalling%' OR body_text LIKE '%threatening%'
                    THEN 1 ELSE 0 END) as has_moderate_escalation,
                COUNT(*) as total_comments
         FROM jira_comment_cache
         WHERE issue_key IN (${keyPlaceholders}) AND is_public = 1
         GROUP BY issue_key`, ticketKeys,
      ),
      query<{ ticket_id: string; reassigns: number }>(
        `SELECT ticket_id, COUNT(*) as reassigns FROM agent_decisions
         WHERE ticket_id IN (${keyPlaceholders}) AND action = 'assign'
         GROUP BY ticket_id`, ticketKeys,
      ),
      query<{ reporter_account_id: string; open_count: number }>(
        `SELECT reporter_account_id, COUNT(*) as open_count FROM jira_issue_cache
         WHERE reporter_account_id IS NOT NULL AND status_category != 'done'
         GROUP BY reporter_account_id HAVING COUNT(*) >= 5`, [],
      ),
    ]);

    const stateMap = new Map(stateRows.map(r => [r.ticket_id, r]));
    const sentimentMap = new Map(sentimentRows.map(r => [r.issue_key, r.sentiment_score]));
    const commentMap = new Map(commentStats.map(r => [r.issue_key, r]));
    const reassignMap = new Map(reassignCounts.map(r => [r.ticket_id, r.reassigns]));
    const reporterCountMap = new Map(reporterCounts.map(r => [r.reporter_account_id, r.open_count]));

    // Pre-fetch all existing flagged tickets in one query (avoids N+1)
    const existingFlagged = await query<{ id: number; ticket_key: string; risk_score: number; last_notified_score: number; status: string }>(
      `SELECT id, ticket_key, risk_score, last_notified_score, status FROM agent_flagged_tickets WHERE status != 'dismissed'`,
    );
    const existingMap = new Map(existingFlagged.map(r => [r.ticket_key, r]));

    let flagged = 0;
    let notified = 0;

    // Score all tickets and log top 20 breakdown
    const allScores: { key: string; score: number; factors: RiskFactor[]; ticket: typeof tickets[0] }[] = [];

    for (const ticket of tickets) {
      const state = stateMap.get(ticket.issue_key);
      const comments = commentMap.get(ticket.issue_key);

      const input: TicketRiskInput = {
        issueKey: ticket.issue_key,
        summary: ticket.summary,
        assignee: ticket.assignee_display,
        assigneeAccountId: ticket.assignee_account_id,
        reporter: ticket.reporter_display,
        reporterAccountId: ticket.reporter_account_id,
        priority: ticket.priority_name,
        jiraCreated: ticket.jira_created ? new Date(ticket.jira_created) : null,
        slaBreachTime: ticket.sla_breach_time ? new Date(ticket.sla_breach_time) : null,
        slaBreached: ticket.sla_breached === 1,
        commentCount: state?.comment_count ?? comments?.total_comments ?? 0,
        lastCustomerReplyAt: state?.last_customer_reply_at ? new Date(state.last_customer_reply_at) : null,
        lastAgentActionAt: state?.last_agent_action_at ? new Date(state.last_agent_action_at) : null,
        sentimentScore: sentimentMap.get(ticket.issue_key) ?? null,
        reassignCount: reassignMap.get(ticket.issue_key) ?? 0,
        uniqueInternalCommenters: comments?.unique_authors ?? 0,
        hasStrongEscalation: (comments?.has_strong_escalation ?? 0) === 1,
        hasModerateEscalation: (comments?.has_moderate_escalation ?? 0) === 1,
        reporterOpenTicketCount: ticket.reporter_account_id ? (reporterCountMap.get(ticket.reporter_account_id) ?? 0) : 0,
        statusName: ticket.status_name,
        jiraUpdated: ticket.jira_updated ? new Date(ticket.jira_updated) : null,
        descriptionText: ticket.description_text,
      };

      const { score, factors } = this.scoreTicket(input);
      allScores.push({ key: ticket.issue_key, score, factors, ticket });
    }

    // Log top 20 scored tickets with factor breakdown
    const top20 = allScores.sort((a, b) => b.score - a.score).slice(0, 20);
    console.log(`[risk] Top 20 scores (threshold=${threshold}):`);
    for (const { key, score, factors } of top20) {
      const breakdown = factors.map(f => `${f.id}(${f.score})`).join('+');
      console.log(`  ${key}: ${score} = ${breakdown || 'none'}`);
    }

    for (const { key, score, factors, ticket } of allScores) {
      if (score < threshold) continue;

      const existing = existingMap.get(key);

      if (existing) {
        await execute(
          `UPDATE agent_flagged_tickets SET risk_score = ?, risk_factors = ?, summary = ?, assignee = ?, reporter = ?, priority = ?, flagged_at = GETUTCDATE()
           WHERE id = ?`,
          [score, JSON.stringify(factors), ticket.summary, ticket.assignee_display, ticket.reporter_display, ticket.priority_name, existing.id],
        );

        if (score >= existing.last_notified_score + 20) {
          const sent = await this.sendRiskAlert(key, ticket.summary, score, factors, ticket.assignee_display);
          if (sent) {
            await execute(`UPDATE agent_flagged_tickets SET last_notified_score = ? WHERE id = ?`, [score, existing.id]);
            notified++;
          }
        }
      } else {
        await executeAndGetId(
          `INSERT INTO agent_flagged_tickets (ticket_key, risk_score, risk_factors, summary, assignee, reporter, priority, last_notified_score)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [key, score, JSON.stringify(factors), ticket.summary, ticket.assignee_display, ticket.reporter_display, ticket.priority_name, score],
        );

        const sent = await this.sendRiskAlert(key, ticket.summary, score, factors, ticket.assignee_display);
        if (sent) {
          await execute(
            `UPDATE agent_flagged_tickets SET last_notified_score = ? WHERE ticket_key = ? AND status = 'pending'`,
            [score, key],
          );
          notified++;
        }
      }

      flagged++;
    }

    // Auto-dismiss flagged tickets whose Jira status is now resolved
    await execute(
      `UPDATE agent_flagged_tickets SET status = 'dismissed', reviewed_at = GETUTCDATE()
       WHERE status = 'pending' AND ticket_key IN (
         SELECT issue_key FROM jira_issue_cache WHERE status_category = 'done'
       )`,
    );

    // Auto-dismiss flagged tickets that dropped below threshold
    await execute(
      `UPDATE agent_flagged_tickets SET status = 'dismissed', reviewed_at = GETUTCDATE()
       WHERE status = 'pending' AND ticket_key NOT IN (
         SELECT ticket_key FROM agent_flagged_tickets WHERE status = 'pending'
       ) OR (status = 'pending' AND risk_score < ?)`,
      [threshold],
    );

    // Auto-dismiss stale flags — flagged 7+ days with no score increase
    await execute(
      `UPDATE agent_flagged_tickets
       SET status = 'dismissed', reviewed_by = 'system-decay', reviewed_at = GETUTCDATE()
       WHERE status = 'pending'
         AND DATEDIFF(day, flagged_at, GETUTCDATE()) >= 7
         AND risk_score <= last_notified_score`,
    );

    return { flagged, notified };
  }

  private async sendRiskAlert(
    ticketKey: string, summary: string | null, score: number,
    factors: RiskFactor[], assignee: string | null,
  ): Promise<boolean> {
    const webhookUrl = this.settings.get('agent_risk_alert_to') || this.settings.get('agent_teams_webhook_url');
    if (!webhookUrl) return false;

    // Check working hours
    const alertHours = this.settings.get('agent_risk_alert_hours') || '08:00-18:00';
    const [startStr, endStr] = alertHours.split('-');
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const currentMinutes = hour * 60 + minute;
    const [startH, startM] = (startStr || '08:00').split(':').map(Number);
    const [endH, endM] = (endStr || '18:00').split(':').map(Number);
    const startMinutes = startH * 60 + (startM || 0);
    const endMinutes = endH * 60 + (endM || 0);
    const dayOfWeek = now.getDay();

    if (dayOfWeek === 0 || dayOfWeek === 6 || currentMinutes < startMinutes || currentMinutes >= endMinutes) {
      // Outside working hours — queue for later (store flag, don't send)
      await execute(
        `UPDATE agent_flagged_tickets SET last_notified_score = 0 WHERE ticket_key = ? AND status = 'pending'`,
        [ticketKey],
      );
      return false;
    }

    const reasonText = factors.map(f => f.label).join(', ');
    const payload = {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      themeColor: score >= 80 ? 'FF0000' : 'FFA500',
      summary: `Ticket flagged: ${ticketKey}`,
      sections: [{
        activityTitle: `🚨 ${ticketKey} flagged for review`,
        facts: [
          { name: 'Summary', value: summary || 'N/A' },
          { name: 'Risk Score', value: `${score}/100` },
          { name: 'Reasons', value: reasonText },
          { name: 'Assigned to', value: assignee || 'Unassigned' },
        ],
      }],
      potentialAction: [{
        '@type': 'OpenUri',
        name: 'View in NOVA',
        targets: [{ os: 'default', uri: 'https://nova.nurtur.tech/#ai-agent' }],
      }],
    };

    try {
      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        console.warn(`[RiskScorer] Teams webhook failed: ${resp.status}`);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[RiskScorer] Teams webhook error:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  async diagnoseTicket(ticketKey: string): Promise<{
    found: boolean;
    input: TicketRiskInput | null;
    score: number;
    threshold: number;
    factors: RiskFactor[];
    enrichment: Record<string, unknown>;
  }> {
    const threshold = this.getThreshold();

    const ticket = await queryOne<{
      issue_key: string; summary: string; assignee_display: string; assignee_account_id: string;
      reporter_display: string; reporter_account_id: string; priority_name: string;
      jira_created: string; sla_breach_time: string | null; sla_breached: number;
      status_name: string; jira_updated: string; description_text: string | null;
    }>(
      `SELECT issue_key, summary, assignee_display, assignee_account_id,
              reporter_display, reporter_account_id, priority_name,
              jira_created, sla_breach_time, sla_breached,
              status_name, jira_updated, description_text
       FROM jira_issue_cache WHERE issue_key = ?`, [ticketKey],
    );

    if (!ticket) return { found: false, input: null, score: 0, threshold, factors: [], enrichment: {} };

    const [stateRow, sentimentRow, commentRow, reassignRow, reporterRow] = await Promise.all([
      queryOne<{ comment_count: number; last_customer_reply_at: string | null; last_agent_action_at: string | null }>(
        `SELECT comment_count, last_customer_reply_at, last_agent_action_at
         FROM agent_ticket_state WHERE ticket_id = ?`, [ticketKey],
      ),
      queryOne<{ sentiment_score: number }>(
        `SELECT sentiment_score FROM problem_ticket_alerts
         WHERE issue_key = ? AND sentiment_score IS NOT NULL AND resolved_at IS NULL`, [ticketKey],
      ),
      queryOne<{ unique_authors: number; has_strong_escalation: number; has_moderate_escalation: number; total_comments: number }>(
        `SELECT COUNT(DISTINCT author_account_id) as unique_authors,
                MAX(CASE WHEN body_text LIKE '%formal complaint%' OR body_text LIKE '%lawyer%'
                         OR body_text LIKE '%solicitor%' OR body_text LIKE '%legal action%'
                         OR body_text LIKE '%trading standards%' OR body_text LIKE '%ombudsman%'
                         OR body_text LIKE '%ICO%' OR body_text LIKE '%GDPR breach%'
                         OR body_text LIKE '%data protection%'
                    THEN 1 ELSE 0 END) as has_strong_escalation,
                MAX(CASE WHEN body_text LIKE '%escalat%' OR body_text LIKE '%unacceptable%'
                         OR body_text LIKE '%disgraceful%' OR body_text LIKE '%ridiculous%'
                         OR body_text LIKE '%appalling%' OR body_text LIKE '%threatening%'
                    THEN 1 ELSE 0 END) as has_moderate_escalation,
                COUNT(*) as total_comments
         FROM jira_comment_cache WHERE issue_key = ? AND is_public = 1`, [ticketKey],
      ),
      queryOne<{ reassigns: number }>(
        `SELECT COUNT(*) as reassigns FROM agent_decisions
         WHERE ticket_id = ? AND action = 'assign'`, [ticketKey],
      ),
      queryOne<{ open_count: number }>(
        `SELECT COUNT(*) as open_count FROM jira_issue_cache
         WHERE reporter_account_id = (SELECT reporter_account_id FROM jira_issue_cache WHERE issue_key = ?)
           AND status_category != 'done'`, [ticketKey],
      ),
    ]);

    const input: TicketRiskInput = {
      issueKey: ticket.issue_key,
      summary: ticket.summary,
      assignee: ticket.assignee_display,
      assigneeAccountId: ticket.assignee_account_id,
      reporter: ticket.reporter_display,
      reporterAccountId: ticket.reporter_account_id,
      priority: ticket.priority_name,
      jiraCreated: ticket.jira_created ? new Date(ticket.jira_created) : null,
      slaBreachTime: ticket.sla_breach_time ? new Date(ticket.sla_breach_time) : null,
      slaBreached: ticket.sla_breached === 1,
      commentCount: stateRow?.comment_count ?? commentRow?.total_comments ?? 0,
      lastCustomerReplyAt: stateRow?.last_customer_reply_at ? new Date(stateRow.last_customer_reply_at) : null,
      lastAgentActionAt: stateRow?.last_agent_action_at ? new Date(stateRow.last_agent_action_at) : null,
      sentimentScore: sentimentRow?.sentiment_score ?? null,
      reassignCount: reassignRow?.reassigns ?? 0,
      uniqueInternalCommenters: commentRow?.unique_authors ?? 0,
      hasStrongEscalation: (commentRow?.has_strong_escalation ?? 0) === 1,
      hasModerateEscalation: (commentRow?.has_moderate_escalation ?? 0) === 1,
      reporterOpenTicketCount: reporterRow?.open_count ?? 0,
      statusName: ticket.status_name,
      jiraUpdated: ticket.jira_updated ? new Date(ticket.jira_updated) : null,
      descriptionText: ticket.description_text,
    };

    const { score, factors } = this.scoreTicket(input);

    return {
      found: true,
      input,
      score,
      threshold,
      factors,
      enrichment: {
        agentTicketState: stateRow ?? 'NOT FOUND',
        sentimentAlert: sentimentRow ?? 'NOT FOUND',
        commentCache: commentRow ?? 'NOT FOUND',
        reassignDecisions: reassignRow ?? 'NOT FOUND',
        reporterOpenCount: reporterRow ?? 'NOT FOUND',
      },
    };
  }

  // ── Query methods for API ──

  async getFlagged(status?: string): Promise<FlaggedTicket[]> {
    const where = status
      ? `WHERE f.status = ? AND j.status_category != 'done'`
      : `WHERE f.status != 'dismissed' AND j.status_category != 'done'`;
    const params = status ? [status] : [];
    const rows = await query<Record<string, unknown>>(
      `SELECT f.*, j.status_name AS ticket_status, j.sla_breach_time, j.sla_breached,
              j.current_tier, j.project_key,
              j.summary AS jira_summary, j.description_text,
              cc.body_text AS last_customer_comment, cc.jira_created AS last_customer_comment_at,
              ac.body_text AS last_agent_comment, ac.jira_created AS last_agent_comment_at,
              conv.conversation_json
       FROM agent_flagged_tickets f
       JOIN jira_issue_cache j ON j.issue_key = f.ticket_key
       OUTER APPLY (
         SELECT TOP(1) body_text, jira_created FROM jira_comment_cache
         WHERE issue_key = f.ticket_key AND is_public = 1
         ORDER BY jira_created DESC
       ) cc
       OUTER APPLY (
         SELECT TOP(1) body_text, jira_created FROM jira_comment_cache
         WHERE issue_key = f.ticket_key AND is_public = 0
         ORDER BY jira_created DESC
       ) ac
       OUTER APPLY (
         SELECT (
           SELECT author_display AS author, body_text AS body,
                  CASE WHEN is_public = 1 THEN 'customer' ELSE 'agent' END AS role,
                  jira_created AS created_at
           FROM jira_comment_cache
           WHERE issue_key = f.ticket_key
           ORDER BY jira_created ASC
           FOR JSON PATH
         ) AS conversation_json
       ) conv
       ${where} ORDER BY f.risk_score DESC`, params,
    );
    return rows.map(this.rowToFlagged);
  }

  async getFlaggedCount(): Promise<number> {
    const row = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM agent_flagged_tickets f
       JOIN jira_issue_cache j ON j.issue_key = f.ticket_key
       WHERE f.status = 'pending' AND j.status_category != 'done'`,
    );
    return row?.cnt ?? 0;
  }

  async getFlaggedSummary(): Promise<{ count: number; highestRisk: FlaggedTicket | null; avgScore: number }> {
    const joinClause = `FROM agent_flagged_tickets f
       JOIN jira_issue_cache j ON j.issue_key = f.ticket_key
       WHERE f.status = 'pending' AND j.status_category != 'done'`;
    const [countRow, avgRow] = await Promise.all([
      queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt ${joinClause}`),
      queryOne<{ avg_score: number }>(`SELECT ISNULL(AVG(CAST(f.risk_score AS FLOAT)), 0) as avg_score ${joinClause}`),
    ]);
    const count = countRow?.cnt ?? 0;
    const avgScore = avgRow?.avg_score ?? 0;
    let highestRisk: FlaggedTicket | null = null;
    if (count > 0) {
      const row = await queryOne<Record<string, unknown>>(
        `SELECT TOP(1) f.* ${joinClause} ORDER BY f.risk_score DESC`,
      );
      if (row) highestRisk = this.rowToFlagged(row);
    }
    return { count, highestRisk, avgScore };
  }

  async reviewTicket(ticketKey: string, reviewedBy: string, dismiss: boolean, dismissReason?: string): Promise<void> {
    if (dismiss) {
      await execute(
        `UPDATE agent_flagged_tickets SET status = 'dismissed', reviewed_at = GETUTCDATE(), reviewed_by = ?,
                dismiss_reason = ?, dismissed_at = GETUTCDATE()
         WHERE ticket_key = ? AND status = 'pending'`,
        [reviewedBy, dismissReason ?? null, ticketKey],
      );
    } else {
      await execute(
        `UPDATE agent_flagged_tickets SET status = 'reviewed', reviewed_at = GETUTCDATE(), reviewed_by = ?
         WHERE ticket_key = ? AND status = 'pending'`,
        [reviewedBy, ticketKey],
      );
    }
  }

  private rowToFlagged(row: Record<string, unknown>): FlaggedTicket {
    let factors: RiskFactor[] = [];
    try { factors = JSON.parse(row.risk_factors as string); } catch {}
    return {
      id: row.id as number,
      ticket_key: row.ticket_key as string,
      risk_score: row.risk_score as number,
      risk_factors: factors,
      summary: (row.summary as string) ?? null,
      assignee: (row.assignee as string) ?? null,
      reporter: (row.reporter as string) ?? null,
      priority: (row.priority as string) ?? null,
      flagged_at: row.flagged_at as string,
      reviewed_at: (row.reviewed_at as string) ?? null,
      reviewed_by: (row.reviewed_by as string) ?? null,
      status: row.status as 'pending' | 'reviewed' | 'dismissed',
      last_notified_score: (row.last_notified_score as number) ?? 0,
      ticket_status: (row.ticket_status as string) ?? null,
      sla_breach_at: (row.sla_breach_time as string) ?? null,
      sla_breached: (row.sla_breached as number) === 1,
      last_customer_comment: (row.last_customer_comment as string) ?? null,
      last_customer_comment_at: (row.last_customer_comment_at as string) ?? null,
      last_agent_comment: (row.last_agent_comment as string) ?? null,
      last_agent_comment_at: (row.last_agent_comment_at as string) ?? null,
      conversation_json: (row.conversation_json as string) ?? null,
      dismiss_reason: (row.dismiss_reason as string) ?? null,
      current_tier: (row.current_tier as string) ?? null,
      project_key: (row.project_key as string) ?? null,
    };
  }
}
