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
  hasEscalationLanguage: boolean;
  reporterOpenTicketCount: number;
}

const ESCALATION_WORDS = /\b(escalat|manager|urgent|asap|complaint|unacceptable|disgraceful|ridiculous|lawyer|legal|cancel)\b/i;

export class RiskScorer {
  private settings: SettingsQueries;

  constructor(settings: SettingsQueries) {
    this.settings = settings;
  }

  private getThreshold(): number {
    const val = this.settings.get('agent_risk_threshold');
    return val ? parseInt(val, 10) || 60 : 60;
  }

  scoreTicket(input: TicketRiskInput): { score: number; factors: RiskFactor[] } {
    const factors: RiskFactor[] = [];
    const now = Date.now();

    // 1. Sentiment deterioration
    if (input.sentimentScore !== null) {
      if (input.sentimentScore <= -0.7) {
        factors.push({ id: 'sentiment_angry', label: 'Angry customer', score: 25, detail: `Sentiment: ${input.sentimentScore.toFixed(2)}` });
      } else if (input.sentimentScore <= -0.3) {
        factors.push({ id: 'sentiment_frustrated', label: 'Frustrated customer', score: 15, detail: `Sentiment: ${input.sentimentScore.toFixed(2)}` });
      }
    }

    // 2. Escalation language
    if (input.hasEscalationLanguage) {
      factors.push({ id: 'escalation_language', label: 'Escalation requested', score: 25 });
    }

    // 3. Age + activity mismatch
    if (input.jiraCreated) {
      const ageDays = (now - input.jiraCreated.getTime()) / 86_400_000;
      if (ageDays >= 5 && input.commentCount >= 10) {
        factors.push({ id: 'age_activity', label: `${Math.round(ageDays)}d old, ${input.commentCount} comments`, score: 20 });
      } else if (ageDays >= 10 && input.commentCount >= 5) {
        factors.push({ id: 'age_activity', label: `${Math.round(ageDays)}d old, ${input.commentCount} comments`, score: 15 });
      }
    }

    // 4. Bounce detection
    if (input.reassignCount >= 3) {
      factors.push({ id: 'bounced', label: `Bounced ${input.reassignCount}x`, score: 20 });
    }
    if (input.uniqueInternalCommenters >= 4) {
      factors.push({ id: 'many_hands', label: `${input.uniqueInternalCommenters} internal commenters`, score: 10 });
    }

    // 5. Agent inaction
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
    if (input.reporterOpenTicketCount >= 3) {
      factors.push({ id: 'repeat_reporter', label: `Reporter has ${input.reporterOpenTicketCount} open tickets`, score: 10 });
    }

    const score = Math.min(100, factors.reduce((s, f) => s + f.score, 0));
    return { score, factors };
  }

  async runRiskSweep(projects: string[]): Promise<{ flagged: number; notified: number }> {
    const threshold = this.getThreshold();
    const projectPlaceholders = projects.map(() => '?').join(',');

    // Get all open tickets from cache with enrichment data
    const tickets = await query<{
      issue_key: string; summary: string; assignee_display: string; assignee_account_id: string;
      reporter_display: string; reporter_account_id: string; priority_name: string;
      jira_created: string; sla_breach_time: string | null; sla_breached: number;
    }>(
      `SELECT issue_key, summary, assignee_display, assignee_account_id,
              reporter_display, reporter_account_id, priority_name,
              jira_created, sla_breach_time, sla_breached
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
      query<{ issue_key: string; unique_authors: number; has_escalation: number }>(
        `SELECT issue_key,
                COUNT(DISTINCT author_account_id) as unique_authors,
                MAX(CASE WHEN body_text LIKE '%escalat%' OR body_text LIKE '%manager%'
                         OR body_text LIKE '%urgent%' OR body_text LIKE '%asap%'
                         OR body_text LIKE '%complaint%' OR body_text LIKE '%unacceptable%'
                    THEN 1 ELSE 0 END) as has_escalation
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
         GROUP BY reporter_account_id HAVING COUNT(*) >= 3`, [],
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
        commentCount: state?.comment_count ?? 0,
        lastCustomerReplyAt: state?.last_customer_reply_at ? new Date(state.last_customer_reply_at) : null,
        lastAgentActionAt: state?.last_agent_action_at ? new Date(state.last_agent_action_at) : null,
        sentimentScore: sentimentMap.get(ticket.issue_key) ?? null,
        reassignCount: reassignMap.get(ticket.issue_key) ?? 0,
        uniqueInternalCommenters: comments?.unique_authors ?? 0,
        hasEscalationLanguage: (comments?.has_escalation ?? 0) === 1,
        reporterOpenTicketCount: ticket.reporter_account_id ? (reporterCountMap.get(ticket.reporter_account_id) ?? 0) : 0,
      };

      const { score, factors } = this.scoreTicket(input);
      if (score < threshold) continue;

      const existing = existingMap.get(ticket.issue_key);

      if (existing) {
        await execute(
          `UPDATE agent_flagged_tickets SET risk_score = ?, risk_factors = ?, summary = ?, assignee = ?, reporter = ?, priority = ?, flagged_at = GETUTCDATE()
           WHERE id = ?`,
          [score, JSON.stringify(factors), ticket.summary, ticket.assignee_display, ticket.reporter_display, ticket.priority_name, existing.id],
        );

        // Re-notify if score increased by 20+
        if (score >= existing.last_notified_score + 20) {
          const sent = await this.sendRiskAlert(ticket.issue_key, ticket.summary, score, factors, ticket.assignee_display);
          if (sent) {
            await execute(`UPDATE agent_flagged_tickets SET last_notified_score = ? WHERE id = ?`, [score, existing.id]);
            notified++;
          }
        }
      } else {
        await executeAndGetId(
          `INSERT INTO agent_flagged_tickets (ticket_key, risk_score, risk_factors, summary, assignee, reporter, priority, last_notified_score)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [ticket.issue_key, score, JSON.stringify(factors), ticket.summary, ticket.assignee_display, ticket.reporter_display, ticket.priority_name, score],
        );

        const sent = await this.sendRiskAlert(ticket.issue_key, ticket.summary, score, factors, ticket.assignee_display);
        if (sent) {
          await execute(
            `UPDATE agent_flagged_tickets SET last_notified_score = ? WHERE ticket_key = ? AND status = 'pending'`,
            [score, ticket.issue_key],
          );
          notified++;
        }
      }

      flagged++;
    }

    // Auto-dismiss flagged tickets that dropped below threshold
    await execute(
      `UPDATE agent_flagged_tickets SET status = 'dismissed', reviewed_at = GETUTCDATE()
       WHERE status = 'pending' AND ticket_key NOT IN (
         SELECT ticket_key FROM agent_flagged_tickets WHERE status = 'pending'
       ) OR (status = 'pending' AND risk_score < ?)`,
      [threshold],
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

  // ── Query methods for API ──

  async getFlagged(status?: string): Promise<FlaggedTicket[]> {
    const where = status ? `WHERE status = ?` : `WHERE status != 'dismissed'`;
    const params = status ? [status] : [];
    const rows = await query<Record<string, unknown>>(
      `SELECT * FROM agent_flagged_tickets ${where} ORDER BY risk_score DESC`, params,
    );
    return rows.map(this.rowToFlagged);
  }

  async getFlaggedCount(): Promise<number> {
    const row = await queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM agent_flagged_tickets WHERE status = 'pending'`);
    return row?.cnt ?? 0;
  }

  async getFlaggedSummary(): Promise<{ count: number; highestRisk: FlaggedTicket | null; avgScore: number }> {
    const [countRow, avgRow] = await Promise.all([
      queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM agent_flagged_tickets WHERE status = 'pending'`),
      queryOne<{ avg_score: number }>(`SELECT ISNULL(AVG(CAST(risk_score AS FLOAT)), 0) as avg_score FROM agent_flagged_tickets WHERE status = 'pending'`),
    ]);
    const count = countRow?.cnt ?? 0;
    const avgScore = avgRow?.avg_score ?? 0;
    let highestRisk: FlaggedTicket | null = null;
    if (count > 0) {
      const row = await queryOne<Record<string, unknown>>(
        `SELECT TOP(1) * FROM agent_flagged_tickets WHERE status = 'pending' ORDER BY risk_score DESC`,
      );
      if (row) highestRisk = this.rowToFlagged(row);
    }
    return { count, highestRisk, avgScore };
  }

  async reviewTicket(ticketKey: string, reviewedBy: string, dismiss: boolean): Promise<void> {
    await execute(
      `UPDATE agent_flagged_tickets SET status = ?, reviewed_at = GETUTCDATE(), reviewed_by = ?
       WHERE ticket_key = ? AND status = 'pending'`,
      [dismiss ? 'dismissed' : 'reviewed', reviewedBy, ticketKey],
    );
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
    };
  }
}
