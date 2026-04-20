import type Database from 'better-sqlite3';
import { calculateDueAt } from '../utils/calyx-business-hours.js';
import { queueEmail, isNotificationEnabled } from './calyx-email.js';
import { tmplSlaWarning, tmplSlaBreached, tmplSloWarning } from './calyx-email-templates.js';

export type SloEvent = 'assigned' | 'first_comment' | 'escalated_t2' | 'escalated_t3'
  | 'escalated_dev' | 'resolved' | 'closed';

const METRIC_TYPE_MAP: Record<SloEvent, string> = {
  assigned: 'time_to_assign',
  first_comment: 'time_to_first_update',
  escalated_t2: 'escalation_to_t2',
  escalated_t3: 'escalation_to_t3',
  escalated_dev: 'escalation_to_dev',
  resolved: 'time_to_close',
  closed: 'time_to_close',
};

export function startSlosForTicket(db: Database.Database, ticketId: number): void {
  const ticket = db.prepare('SELECT * FROM calyx_tickets WHERE id = ?').get(ticketId) as any;
  if (!ticket) return;

  const matchingSlos = db.prepare(`
    SELECT * FROM calyx_slos WHERE is_active = 1
      AND (applies_to_team_id IS NULL OR applies_to_team_id = ?)
      AND (applies_to_priority IS NULL OR applies_to_priority = ?)
      AND (applies_to_category_id IS NULL OR applies_to_category_id = ?)
  `).all(ticket.team_id, ticket.priority, ticket.category_id) as any[];

  const now = new Date();
  for (const slo of matchingSlos) {
    const existing = db.prepare(
      'SELECT id FROM calyx_ticket_slo_tracking WHERE ticket_id = ? AND slo_id = ?'
    ).get(ticketId, slo.id);
    if (existing) continue;

    const bhId = slo.business_hours_only ? 1 : null;
    const targetAt = calculateDueAt(db, now, slo.target_minutes, bhId);
    const warnMins = Math.floor(slo.target_minutes * (slo.warning_threshold_pct / 100));
    const warningAt = calculateDueAt(db, now, warnMins, bhId);

    db.prepare(`
      INSERT INTO calyx_ticket_slo_tracking
        (ticket_id, slo_id, started_at, target_at, warning_at)
      VALUES (?, ?, datetime('now'), ?, ?)
    `).run(ticketId, slo.id, targetAt.toISOString(), warningAt.toISOString());
  }
}

export function completeSloOnEvent(db: Database.Database, ticketId: number, eventType: SloEvent): void {
  const metricType = METRIC_TYPE_MAP[eventType];
  if (!metricType) return;

  db.prepare(`
    UPDATE calyx_ticket_slo_tracking SET completed_at = datetime('now')
    WHERE ticket_id = ? AND completed_at IS NULL
      AND slo_id IN (SELECT id FROM calyx_slos WHERE metric_type = ?)
  `).run(ticketId, metricType);
}

export function pauseSlos(db: Database.Database, ticketId: number): void {
  db.prepare(`
    UPDATE calyx_ticket_slo_tracking SET paused_at = datetime('now')
    WHERE ticket_id = ? AND completed_at IS NULL AND paused_at IS NULL
  `).run(ticketId);
}

export function resumeSlos(db: Database.Database, ticketId: number): void {
  const paused = db.prepare(`
    SELECT id, paused_at FROM calyx_ticket_slo_tracking
    WHERE ticket_id = ? AND completed_at IS NULL AND paused_at IS NOT NULL
  `).all(ticketId) as any[];

  const now = Date.now();
  for (const row of paused) {
    const pausedMins = Math.floor((now - new Date(row.paused_at).getTime()) / 60000);
    db.prepare(`
      UPDATE calyx_ticket_slo_tracking
      SET paused_at = NULL,
          pause_minutes_accumulated = pause_minutes_accumulated + ?,
          target_at = datetime(target_at, '+' || ? || ' minutes'),
          warning_at = datetime(warning_at, '+' || ? || ' minutes')
      WHERE id = ?
    `).run(pausedMins, pausedMins, pausedMins, row.id);
  }
}

export function checkSloBreaches(db: Database.Database, settings?: Record<string, string>): void {
  const now = new Date().toISOString();
  const s = settings || {};

  // Check warnings (approaching target)
  const warnings = db.prepare(`
    SELECT t.id, t.ticket_id, t.slo_id, t.warning_at, t.target_at,
      s.name as slo_name, s.metric_type
    FROM calyx_ticket_slo_tracking t
    JOIN calyx_slos s ON s.id = t.slo_id
    WHERE t.breached = 0 AND t.completed_at IS NULL AND t.paused_at IS NULL
      AND t.warning_at <= ? AND t.target_at > ?
      AND t.warning_sent = 0
  `).all(now, now) as any[];

  for (const row of warnings) {
    const minsRemaining = Math.max(0, Math.floor(
      (new Date(row.target_at).getTime() - new Date(now).getTime()) / 60000
    ));
    db.prepare('UPDATE calyx_ticket_slo_tracking SET warning_sent = 1 WHERE id = ?').run(row.id);

    const ticket = db.prepare('SELECT * FROM calyx_tickets WHERE id = ?').get(row.ticket_id) as any;
    if (ticket && isNotificationEnabled(s, 'sla_warning')) {
      const { subject, html } = tmplSlaWarning(ticket, row.metric_type, minsRemaining);
      const recipients = getTicketNotifyEmails(db, ticket);
      for (const email of recipients) {
        queueEmail(db, { ticketId: ticket.id, recipientEmail: email, eventType: 'sla_warning', subject, bodyHtml: html });
      }
    }
  }

  // Check breaches
  const breached = db.prepare(`
    SELECT id, ticket_id, slo_id, target_at FROM calyx_ticket_slo_tracking
    WHERE breached = 0 AND completed_at IS NULL AND paused_at IS NULL AND target_at <= ?
  `).all(now) as any[];

  for (const row of breached) {
    const breachMins = Math.floor(
      (new Date(now).getTime() - new Date(row.target_at).getTime()) / 60000
    );
    db.prepare('UPDATE calyx_ticket_slo_tracking SET breached = 1, breach_minutes = ? WHERE id = ?')
      .run(breachMins, row.id);
    db.prepare(`
      INSERT INTO calyx_ticket_events (ticket_id, event_type, to_value, created_at)
      VALUES (?, 'slo_breached', ?, datetime('now'))
    `).run(row.ticket_id, String(row.slo_id));

    const ticket = db.prepare('SELECT * FROM calyx_tickets WHERE id = ?').get(row.ticket_id) as any;
    const slo = db.prepare('SELECT * FROM calyx_slos WHERE id = ?').get(row.slo_id) as any;
    if (ticket && slo && isNotificationEnabled(s, 'sla_breached')) {
      const { subject, html } = tmplSlaBreached(ticket, slo.metric_type, breachMins);
      const recipients = getTicketNotifyEmails(db, ticket);
      for (const email of recipients) {
        queueEmail(db, { ticketId: ticket.id, recipientEmail: email, eventType: 'sla_breached', subject, bodyHtml: html });
      }
    }
  }
}

function getTicketNotifyEmails(db: Database.Database, ticket: any): string[] {
  const emails: Set<string> = new Set();
  if (ticket.assigned_agent_id) {
    const agent = db.prepare('SELECT email FROM calyx_agents WHERE id = ?').get(ticket.assigned_agent_id) as any;
    if (agent?.email) emails.add(agent.email);
  }
  const watchers = db.prepare(`
    SELECT a.email FROM calyx_ticket_watchers w
    JOIN calyx_agents a ON a.id = w.agent_id
    WHERE w.ticket_id = ? AND a.email IS NOT NULL
  `).all(ticket.id) as { email: string }[];
  for (const w of watchers) emails.add(w.email);
  return [...emails];
}
