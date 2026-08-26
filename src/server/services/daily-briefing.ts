import { z } from 'zod';
import sql from 'mssql';
import { query, executeAndGetId } from './database.js';
import type { LlmService } from './llm-service.js';
import type { JiraCacheQueries } from './jira-cache-queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { EmailService } from './email.js';

// ── Types ──

export interface BriefingSection {
  id: string;
  title: string;
  content: string;
  priority?: 'high' | 'medium' | 'low';
  tickets?: string[];
}

export interface DailyBriefing {
  headline: string;
  sections: BriefingSection[];
  priorityActions: Array<{ ticketKey: string; summary: string; reason: string }>;
  generatedAt: string;
}

interface StoredBriefing {
  id: number;
  user_id: number | null;
  role_type: string;
  briefing_date: string;
  content_json: string;
  generated_at: string;
  dismissed_at: string | null;
}

const flexStr = z.any().transform((val): string => {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') return val.description ?? val.summary ?? val.value ?? val.text ?? JSON.stringify(val);
  return String(val ?? '');
});

const BriefingLlmSchema = z.object({
  headline: flexStr,
  narrative: flexStr,
  priority_actions: z.array(z.object({
    ticket_key: flexStr,
    summary: flexStr,
    reason: flexStr,
  })),
});

type BriefingLlmResult = z.infer<typeof BriefingLlmSchema>;

// ── Service ──

export class DailyBriefingService {
  private kpiPool: sql.ConnectionPool | null = null;

  constructor(
    private llm: LlmService,
    private cache: JiraCacheQueries,
    private settings: SettingsQueries,
    private email: EmailService | null,
  ) {}

  private async getKpiPool(): Promise<sql.ConnectionPool | null> {
    if (this.kpiPool?.connected) return this.kpiPool;
    const s = this.settings.getAll();
    if (!s.kpi_sql_server || !s.kpi_sql_database || !s.kpi_sql_user || !s.kpi_sql_password) return null;
    try {
      this.kpiPool = await new sql.ConnectionPool({
        server: s.kpi_sql_server, database: s.kpi_sql_database,
        user: s.kpi_sql_user, password: s.kpi_sql_password,
        options: { encrypt: true, trustServerCertificate: true },
        requestTimeout: 15000,
      }).connect();
      return this.kpiPool;
    } catch {
      return null;
    }
  }

  // ── Generate for a specific agent ──

  async generateAgentBriefing(userId: number, agentEmail: string, agentName: string): Promise<DailyBriefing> {
    const project = this.settings.get('agent_jira_project') || 'NT';
    const today = new Date().toISOString().slice(0, 10);

    const [myTickets, breached, atRisk, recentDecisions, coaching] = await Promise.all([
      this.cache.getByAssignee(agentEmail, [project], 'email'),
      this.cache.getSlaBreach(project),
      this.cache.getSlaAtRisk(project, 60 * 60 * 1000),
      query<{ ticket_id: string; action: string; confidence: number; created_at: string }>(
        `SELECT TOP 20 ticket_id, action, confidence, created_at
         FROM agent_decisions WHERE created_at >= DATEADD(day, -1, GETUTCDATE())
         ORDER BY created_at DESC`
      ),
      this.getKpiPool().then(async (p): Promise<Array<{ nudge_type: string; message: string; ticket_id: string }>> => {
        if (!p) return [];
        try {
          const safeName = agentName.replace(/'/g, "''");
          const r = await p.request().query(`
            SELECT TOP 5 issueKey, grade, coachingPoints, category
            FROM dbo.jira_qa_results
            WHERE assigneeName = '${safeName}'
              AND (grade = 'RED' OR isConcerning = 1)
              AND CreatedAt >= DATEADD(day, -1, GETUTCDATE())
            ORDER BY CreatedAt DESC
          `);
          return r.recordset.map((row: any) => ({
            nudge_type: `qa_${(row.grade ?? 'RED').toLowerCase()}`,
            message: row.coachingPoints ?? `${row.grade} grade on ${row.category ?? 'ticket'}`,
            ticket_id: row.issueKey,
          }));
        } catch { return []; }
      }),
    ]);

    const myBreached = breached.filter(t => t.assignee_email === agentEmail);
    const myAtRisk = atRisk.filter(t => t.assignee_email === agentEmail);
    const oldestTicket = myTickets.length > 0
      ? myTickets.reduce((o, t) => (!o.jira_created || (t.jira_created && t.jira_created < o.jira_created)) ? t : o)
      : null;

    // Tickets assigned overnight (created/updated in last 12h, assigned to this agent)
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const newOvernight = myTickets.filter(t =>
      t.jira_created && t.jira_created.toISOString() >= twelveHoursAgo
    );

    // Stale tickets: customer replied but agent hasn't (check comments)
    const staleTickets = await query<{ issue_key: string; summary: string; last_customer_comment: string }>(
      `SELECT c.issue_key, i.summary,
              MAX(c.jira_created) as last_customer_comment
       FROM jira_comment_cache c
       JOIN jira_issue_cache i ON c.issue_key = i.issue_key
       WHERE i.assignee_email = ?
         AND i.status_category != 'done'
         AND c.is_public = 1
         AND c.author_email NOT LIKE '%@nurtur.tech'
         AND c.jira_created >= DATEADD(day, -2, GETUTCDATE())
         AND NOT EXISTS (
           SELECT 1 FROM jira_comment_cache c2
           WHERE c2.issue_key = c.issue_key
             AND c2.author_email LIKE '%@nurtur.tech'
             AND c2.jira_created > c.jira_created
         )
       GROUP BY c.issue_key, i.summary
       ORDER BY last_customer_comment DESC`,
      [agentEmail]
    );

    const dataContext = [
      `Agent: ${agentName}`,
      `Date: ${today}`,
      `Open tickets: ${myTickets.length}`,
      myBreached.length > 0 ? `SLA BREACHED: ${myBreached.map(t => `${t.issue_key} — ${t.summary}`).join('; ')}` : 'No SLA breaches',
      myAtRisk.length > 0 ? `At risk (< 1h): ${myAtRisk.map(t => `${t.issue_key} — ${t.summary}`).join('; ')}` : 'No at-risk tickets',
      oldestTicket ? `Oldest ticket: ${oldestTicket.issue_key} — ${oldestTicket.summary} (created ${oldestTicket.jira_created?.toISOString().slice(0, 10)})` : '',
      newOvernight.length > 0 ? `New overnight: ${newOvernight.map(t => `${t.issue_key} — ${t.summary}`).join('; ')}` : 'No new tickets overnight',
      staleTickets.length > 0 ? `Awaiting your reply: ${staleTickets.map(t => `${t.issue_key} — ${t.summary}`).join('; ')}` : 'No pending customer replies',
      coaching.length > 0 ? `Coaching nudges: ${coaching.map(c => `${c.nudge_type}: ${c.message.slice(0, 100)}`).join('; ')}` : '',
      '',
    ].filter(Boolean).join('\n');

    const systemPrompt = `You are a daily briefing assistant for a service desk agent. Generate a short, direct, actionable morning briefing. Address the agent by first name. Use plain text — no markdown, no bullets with asterisks. Use line breaks to separate sections. Be warm but direct. Focus on what needs attention NOW. If there are SLA breaches, lead with those. Keep it under 300 words.

Produce JSON with:
- headline: one punchy sentence greeting + state (e.g. "Good morning Sarah. 3 tickets need your attention before 10am.")
- narrative: the full briefing text, plain paragraphs
- priority_actions: array of {ticket_key, summary, reason} — the top 3-5 tickets needing immediate action, ordered by urgency`;

    const result = await this.llm.call<BriefingLlmResult>(
      systemPrompt,
      `Generate today's briefing from this data:\n\n${dataContext}`,
      BriefingLlmSchema,
      { tier: 'cheap', callType: 'daily_briefing_agent', temperature: 0.3 },
    );

    const briefing: DailyBriefing = {
      headline: result.data.headline,
      sections: [
        { id: 'narrative', title: 'Your Briefing', content: result.data.narrative },
        ...(myBreached.length > 0 ? [{
          id: 'breached', title: 'SLA Breached', content: `${myBreached.length} ticket(s) breached`,
          priority: 'high' as const, tickets: myBreached.map(t => t.issue_key),
        }] : []),
        ...(staleTickets.length > 0 ? [{
          id: 'stale', title: 'Awaiting Your Reply', content: `${staleTickets.length} customer(s) waiting`,
          priority: 'medium' as const, tickets: staleTickets.map(t => t.issue_key),
        }] : []),
      ],
      priorityActions: result.data.priority_actions.map(a => ({ ticketKey: a.ticket_key, summary: a.summary, reason: a.reason })),
      generatedAt: new Date().toISOString(),
    };

    await this.storeBriefing(userId, 'agent', today, briefing);
    return briefing;
  }

  // ── Generate for manager/admin ──

  async generateManagerBriefing(userId: number, userName: string): Promise<DailyBriefing> {
    const project = this.settings.get('agent_jira_project') || 'NT';
    const today = new Date().toISOString().slice(0, 10);
    const yesterdayDate = new Date(Date.now() - 86_400_000);

    const [
      openCount, unassignedCount, breachedCount,
      breached, atRisk,
      resolvedYesterday, createdYesterday,
      flagged,
      aiDecisions, pendingApprovals, costYesterday,
    ] = await Promise.all([
      this.cache.countOpen(project),
      this.cache.countUnassigned(project),
      this.cache.countBreachedSla(project),
      this.cache.getSlaBreach(project),
      this.cache.getSlaAtRisk(project, 60 * 60 * 1000),
      this.cache.countResolvedSince(project, yesterdayDate),
      this.cache.countCreatedSince(project, yesterdayDate),
      query<{ ticket_key: string; risk_score: number; summary: string; assignee: string }>(
        `SELECT TOP 10 ticket_key, risk_score, summary, assignee
         FROM agent_flagged_tickets WHERE status = 'pending' ORDER BY risk_score DESC`
      ),
      query<{ action: string; cnt: number }>(
        `SELECT action, COUNT(*) as cnt FROM agent_decisions
         WHERE created_at >= DATEADD(day, -1, GETUTCDATE()) GROUP BY action`
      ),
      query<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM agent_approvals WHERE status = 'pending'`
      ),
      // estimated_cost is USD (see MODEL_PRICING in llm-service.ts). NULL means the
      // model had no price entry — counted separately, never folded in as zero.
      query<{ cost: number; calls: number; unpriced: number }>(
        `SELECT ISNULL(SUM(estimated_cost), 0) as cost, COUNT(*) as calls,
                SUM(CASE WHEN estimated_cost IS NULL THEN 1 ELSE 0 END) as unpriced
         FROM agent_llm_calls WHERE created_at >= DATEADD(day, -1, GETUTCDATE())`
      ),
    ]);

    // Agent workload from cache
    const workload = await query<{ assignee_display: string; assignee_email: string; cnt: number }>(
      `SELECT assignee_display, assignee_email, COUNT(*) as cnt
       FROM jira_issue_cache
       WHERE project_key = ? AND status_category != 'done' AND assignee_account_id IS NOT NULL
       GROUP BY assignee_display, assignee_email
       ORDER BY cnt DESC`,
      [project]
    );

    // Aged tickets (7+ days open)
    const agedCount = await query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM jira_issue_cache
       WHERE project_key = ? AND status_category != 'done'
         AND jira_created <= DATEADD(day, -7, GETUTCDATE())`,
      [project]
    );

    // No-response 24h+ tickets
    const noResponse = await query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM jira_issue_cache
       WHERE project_key = ? AND status_category != 'done'
         AND jira_updated <= DATEADD(hour, -24, GETUTCDATE())
         AND assignee_account_id IS NOT NULL`,
      [project]
    );

    const totalAiDecisions = aiDecisions.reduce((s, d) => s + d.cnt, 0);

    const dataContext = [
      `Manager: ${userName}`,
      `Date: ${today}`,
      ``,
      `QUEUE HEALTH:`,
      `Open: ${openCount} | Unassigned: ${unassignedCount} | Breached: ${breachedCount} | At risk: ${atRisk.length}`,
      `Aged 7+ days: ${agedCount[0]?.cnt ?? 0} | No update 24h+: ${noResponse[0]?.cnt ?? 0}`,
      ``,
      `YESTERDAY:`,
      `Resolved: ${resolvedYesterday} | Created: ${createdYesterday} | Net: ${resolvedYesterday - createdYesterday >= 0 ? '+' : ''}${resolvedYesterday - createdYesterday}`,
      ``,
      `BREACHED TICKETS:`,
      breached.length > 0 ? breached.slice(0, 10).map(t => `${t.issue_key} — ${t.summary} (${t.assignee_display ?? 'unassigned'})`).join('\n') : 'None',
      ``,
      `FLAGGED (risk):`,
      flagged.length > 0 ? flagged.slice(0, 5).map(f => `${f.ticket_key} (score ${f.risk_score}) — ${f.summary}`).join('\n') : 'None',
      ``,
      `AGENT WORKLOAD:`,
      workload.slice(0, 10).map(w => `${w.assignee_display}: ${w.cnt} open`).join('\n'),
      ``,
      `AVAILABILITY:`,
      'Calendar sync removed',
      ``,
      `AI AGENT:`,
      `Decisions yesterday: ${totalAiDecisions} | Pending approvals: ${pendingApprovals[0]?.cnt ?? 0}`,
      `Cost yesterday: $${(costYesterday[0]?.cost ?? 0).toFixed(2)} USD (${costYesterday[0]?.calls ?? 0} LLM calls)${(costYesterday[0]?.unpriced ?? 0) > 0 ? ` — ${costYesterday[0].unpriced} call(s) from unpriced models, cost unknown` : ''}`,
    ].join('\n');

    const systemPrompt = `You are a daily briefing assistant for a service desk manager. Generate a concise strategic morning briefing. Address the manager by first name. Use plain text — no markdown. Be high-level but flag anything that needs immediate attention. If there are breaches or staffing concerns, lead with those. Include specific ticket references where relevant. Keep it under 400 words.

Produce JSON with:
- headline: one sentence greeting + key state (e.g. "Good morning Nick. Queue is healthy but 2 SLA breaches need escalation.")
- narrative: the full briefing text, plain paragraphs separated by line breaks
- priority_actions: array of {ticket_key, summary, reason} — top actions the manager should take, could include "review flagged ticket X" or "reassign Y's tickets — they're overloaded"`;

    const result = await this.llm.call<BriefingLlmResult>(
      systemPrompt,
      `Generate today's manager briefing from this data:\n\n${dataContext}`,
      BriefingLlmSchema,
      { tier: 'cheap', callType: 'daily_briefing_manager', temperature: 0.3 },
    );

    const briefing: DailyBriefing = {
      headline: result.data.headline,
      sections: [
        { id: 'narrative', title: 'State of Play', content: result.data.narrative },
        ...(breached.length > 0 ? [{
          id: 'breached', title: 'SLA Breaches', content: `${breached.length} breached`,
          priority: 'high' as const, tickets: breached.map(t => t.issue_key),
        }] : []),
        ...(flagged.length > 0 ? [{
          id: 'flagged', title: 'Flagged Tickets', content: `${flagged.length} pending review`,
          priority: 'medium' as const, tickets: flagged.map(f => f.ticket_key),
        }] : []),
      ],
      priorityActions: result.data.priority_actions.map(a => ({ ticketKey: a.ticket_key, summary: a.summary, reason: a.reason })),
      generatedAt: new Date().toISOString(),
    };

    await this.storeBriefing(userId, 'manager', today, briefing);
    return briefing;
  }

  // ── Generate all briefings (called by timer) ──

  async generateAll(users: Array<{ id: number; email: string; display_name: string; role: string }>): Promise<number> {
    let count = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (const user of users) {
      const existing = await query<{ id: number }>(
        `SELECT id FROM daily_briefings WHERE user_id = ? AND briefing_date = ?`,
        [user.id, today]
      );
      if (existing.length > 0) continue;

      try {
        const roles = user.role.split(',').map(r => r.trim());
        const isManager = roles.includes('admin') || roles.includes('super_admin');

        if (isManager) {
          await this.generateManagerBriefing(user.id, user.display_name || user.email);
        } else {
          await this.generateAgentBriefing(user.id, user.email, user.display_name || user.email);
        }
        count++;

        // Send email if enabled
        if (this.email && this.settings.get('agent_briefing_email_enabled') !== 'false') {
          const briefing = await this.getLatest(user.id);
          if (briefing && user.email) {
            const content = JSON.parse(briefing.content_json) as DailyBriefing;
            await this.sendBriefingEmail(user.email, user.display_name, content).catch(err => {
              console.warn(`[daily-briefing] Email failed for ${user.email}:`, err instanceof Error ? err.message : err);
            });
          }
        }
      } catch (err) {
        console.error(`[daily-briefing] Failed for user ${user.id}:`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`[daily-briefing] Generated ${count} briefing(s) for ${today}`);
    return count;
  }

  // ── Query ──

  async getLatest(userId: number): Promise<StoredBriefing | null> {
    const rows = await query<StoredBriefing>(
      `SELECT TOP 1 * FROM daily_briefings WHERE user_id = ? ORDER BY briefing_date DESC, generated_at DESC`,
      [userId]
    );
    return rows[0] ?? null;
  }

  async getForDate(userId: number, date: string): Promise<StoredBriefing | null> {
    const rows = await query<StoredBriefing>(
      `SELECT TOP 1 * FROM daily_briefings WHERE user_id = ? AND briefing_date = ? ORDER BY generated_at DESC`,
      [userId, date]
    );
    return rows[0] ?? null;
  }

  async getHistory(userId: number, limit = 30): Promise<StoredBriefing[]> {
    return query<StoredBriefing>(
      `SELECT TOP (?) * FROM daily_briefings WHERE user_id = ? ORDER BY briefing_date DESC`,
      [limit, userId]
    );
  }

  async dismiss(userId: number, briefingDate: string): Promise<void> {
    await executeAndGetId(
      `UPDATE daily_briefings SET dismissed_at = GETUTCDATE()
       WHERE user_id = ? AND briefing_date = ? AND dismissed_at IS NULL`,
      [userId, briefingDate]
    );
  }

  async needsPopup(userId: number): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await query<{ id: number; dismissed_at: string | null }>(
      `SELECT TOP 1 id, dismissed_at FROM daily_briefings
       WHERE user_id = ? AND briefing_date = ?`,
      [userId, today]
    );
    if (rows.length === 0) return false;
    return rows[0].dismissed_at === null;
  }

  // ── Storage ──

  private async storeBriefing(userId: number | null, roleType: string, date: string, briefing: DailyBriefing): Promise<number> {
    return executeAndGetId(
      `INSERT INTO daily_briefings (user_id, role_type, briefing_date, content_json)
       VALUES (?, ?, ?, ?)`,
      [userId, roleType, date, JSON.stringify(briefing)]
    );
  }

  // ── Email ──

  private async sendBriefingEmail(to: string, name: string, briefing: DailyBriefing): Promise<void> {
    if (!this.email) return;

    const actionsHtml = briefing.priorityActions.length > 0
      ? briefing.priorityActions.map(a =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #333;font-family:monospace;color:#5ec1ca">${a.ticketKey}</td><td style="padding:8px 12px;border-bottom:1px solid #333;color:#ccc">${a.summary}</td><td style="padding:8px 12px;border-bottom:1px solid #333;color:#999;font-size:12px">${a.reason}</td></tr>`
      ).join('')
      : '<tr><td colspan="3" style="padding:12px;color:#666;text-align:center">No priority actions today</td></tr>';

    const narrativeHtml = briefing.sections
      .filter(s => s.id === 'narrative')
      .map(s => s.content.split('\n').map(p => `<p style="margin:0 0 12px 0;color:#ddd;line-height:1.6">${p}</p>`).join(''))
      .join('');

    const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#1a1f25;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#272C33;border-radius:12px;overflow:hidden;border:1px solid #3a424d">
    <div style="padding:24px;background:linear-gradient(135deg,#2f353d,#272C33);border-bottom:1px solid #3a424d">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#5ec1ca;margin-bottom:8px">N.O.V.A Daily Briefing</div>
      <div style="font-size:18px;color:#f0f0f0;font-weight:600">${briefing.headline}</div>
    </div>
    <div style="padding:24px">
      ${narrativeHtml}
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid #3a424d">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:12px">Priority Actions</div>
        <table style="width:100%;border-collapse:collapse">${actionsHtml}</table>
      </div>
    </div>
    <div style="padding:16px 24px;background:#2f353d;border-top:1px solid #3a424d;text-align:center">
      <span style="font-size:12px;color:#666">Generated by N.O.V.A at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  </div>
</div>
</body></html>`;

    const plainText = [
      briefing.headline,
      '',
      ...briefing.sections.filter(s => s.id === 'narrative').map(s => s.content),
      '',
      'Priority Actions:',
      ...briefing.priorityActions.map(a => `  ${a.ticketKey} — ${a.summary} (${a.reason})`),
    ].join('\n');

    await this.email.send({
      to,
      subject: `NOVA Briefing — ${briefing.headline.slice(0, 80)}`,
      text: plainText,
      html,
    });
    console.log(`[daily-briefing] Briefing sent to: ${to} at ${new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' })}`);
  }
}
