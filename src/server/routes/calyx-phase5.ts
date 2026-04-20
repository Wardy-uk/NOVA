import { Router } from 'express';
import nodemailer from 'nodemailer';
import type Database from 'better-sqlite3';
import type { FileSettingsQueries } from '../db/settings-store.js';
import { queueEmail, isNotificationEnabled, processEmailQueue } from '../services/calyx-email.js';
import {
  tmplTicketCreated, tmplFirstReply, tmplResolved, tmplStatusWaiting,
  tmplAssigned, tmplCsatSurvey, tmplChangeApproved, tmplChangeRejected,
  tmplMajorIncident,
} from '../services/calyx-email-templates.js';

export function createCalyxPhase5Routes(db: Database.Database, settingsQueries: FileSettingsQueries): Router {
  const router = Router();

  // ── Notification Settings ──

  router.get('/settings/notifications', (_req, res) => {
    const raw = settingsQueries.get('calyx_notifications');
    const defaults: Record<string, boolean> = {
      ticket_created: true, first_reply: true, status_resolved: true,
      status_waiting: true, assigned: true, sla_warning: true,
      sla_breached: true, slo_warning: true, major_incident: true,
      major_incident_update: true, major_incident_resolved: true,
      csat_survey: true, change_approved: true, change_rejected: true,
    };
    let toggles = defaults;
    if (raw) {
      try { toggles = { ...defaults, ...JSON.parse(raw) }; } catch { /* use defaults */ }
    }
    res.json({ ok: true, data: toggles });
  });

  router.post('/settings/notifications', (req, res) => {
    const current = settingsQueries.get('calyx_notifications');
    let toggles: Record<string, boolean> = {};
    if (current) { try { toggles = JSON.parse(current); } catch { /* empty */ } }
    Object.assign(toggles, req.body);
    settingsQueries.set('calyx_notifications', JSON.stringify(toggles));
    res.json({ ok: true, data: toggles });
  });

  // ── SMTP Settings ──

  router.get('/settings/smtp', (_req, res) => {
    res.json({
      ok: true,
      data: {
        host: settingsQueries.get('calyx_smtp_host') ?? '',
        port: settingsQueries.get('calyx_smtp_port') ?? '587',
        user: settingsQueries.get('calyx_smtp_user') ?? '',
        pass: settingsQueries.get('calyx_smtp_pass') ? '***' : '',
        from: settingsQueries.get('calyx_smtp_from') ?? '',
        enabled: settingsQueries.get('calyx_smtp_enabled') ?? '0',
      },
    });
  });

  router.post('/settings/smtp', (req, res) => {
    const { host, port, user, pass, from, enabled } = req.body;
    if (host !== undefined) settingsQueries.set('calyx_smtp_host', host);
    if (port !== undefined) settingsQueries.set('calyx_smtp_port', String(port));
    if (user !== undefined) settingsQueries.set('calyx_smtp_user', user);
    if (pass !== undefined && pass !== '***') settingsQueries.set('calyx_smtp_pass', pass);
    if (from !== undefined) settingsQueries.set('calyx_smtp_from', from);
    if (enabled !== undefined) settingsQueries.set('calyx_smtp_enabled', String(enabled));
    res.json({ ok: true });
  });

  router.post('/settings/smtp/test', async (req, res) => {
    try {
      const user = (req as any).user;
      const toEmail = req.body.email || user?.email;
      if (!toEmail) {
        res.status(400).json({ ok: false, error: 'No email address available for test' });
        return;
      }

      let transporter: nodemailer.Transporter;
      let fromAddr: string;
      let previewUrl: string | false = false;

      const host = settingsQueries.get('calyx_smtp_host');
      if (host) {
        const port = Number(settingsQueries.get('calyx_smtp_port')) || 587;
        transporter = nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: {
            user: settingsQueries.get('calyx_smtp_user') ?? '',
            pass: settingsQueries.get('calyx_smtp_pass') ?? '',
          },
        });
        fromAddr = settingsQueries.get('calyx_smtp_from') || settingsQueries.get('calyx_smtp_user') || '';
      } else {
        const testAccount = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: { user: testAccount.user, pass: testAccount.pass },
        });
        fromAddr = testAccount.user;
      }

      const info = await transporter.sendMail({
        from: fromAddr,
        to: toEmail,
        subject: 'Calyx SMTP Test',
        html: '<h2>SMTP Configuration Test</h2><p>If you received this, your Calyx email settings are working correctly.</p>',
      });

      previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) {
        console.log(`[Calyx Email] Test email preview: ${previewUrl}`);
      }

      res.json({ ok: true, data: { sent_to: toEmail, preview_url: previewUrl || undefined } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Email Queue ──

  router.get('/email-queue', (req, res) => {
    const status = req.query.status as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    let sql = 'SELECT * FROM calyx_email_queue';
    const params: unknown[] = [];
    if (status) { sql += ' WHERE status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    res.json({ ok: true, data: db.prepare(sql).all(...params) });
  });

  router.post('/email-queue/:id/retry', (req, res) => {
    const id = Number(req.params.id);
    const email = db.prepare('SELECT * FROM calyx_email_queue WHERE id = ?').get(id) as any;
    if (!email) { res.status(404).json({ ok: false, error: 'Email not found' }); return; }
    db.prepare("UPDATE calyx_email_queue SET status = 'pending', attempts = 0, error = NULL WHERE id = ?").run(id);
    res.json({ ok: true });
  });

  return router;
}

// ── Trigger helper: queue with toggle check ──

export function triggerEmail(
  db: Database.Database,
  settings: Record<string, string>,
  eventType: string,
  opts: { ticketId?: number; recipientEmail: string; subject: string; bodyHtml: string }
): void {
  if (!isNotificationEnabled(settings, eventType)) return;
  queueEmail(db, { ...opts, eventType });
}

// ── Ticket lifecycle triggers (called from calyx.ts) ──

export function emailOnTicketCreated(db: Database.Database, settings: Record<string, string>, ticket: any): void {
  if (!ticket.requester_email) return;
  const portalUrl = settings.calyx_portal_url || '';
  const { subject, html } = tmplTicketCreated(ticket, portalUrl ? `${portalUrl}/tickets/${ticket.id}` : '');
  triggerEmail(db, settings, 'ticket_created', { ticketId: ticket.id, recipientEmail: ticket.requester_email, subject, bodyHtml: html });
}

export function emailOnFirstReply(db: Database.Database, settings: Record<string, string>, ticket: any, replyBody: string): void {
  if (!ticket.requester_email) return;
  const portalUrl = settings.calyx_portal_url || '';
  const { subject, html } = tmplFirstReply(ticket, replyBody, portalUrl ? `${portalUrl}/tickets/${ticket.id}` : '');
  triggerEmail(db, settings, 'first_reply', { ticketId: ticket.id, recipientEmail: ticket.requester_email, subject, bodyHtml: html });
}

export function emailOnResolved(db: Database.Database, settings: Record<string, string>, ticket: any): void {
  if (!ticket.requester_email) return;
  const portalUrl = settings.calyx_portal_url || '';
  const csatBase = portalUrl ? `${portalUrl}/csat/${ticket.id}?` : `/portal/csat/${ticket.id}?`;
  const { subject, html } = tmplResolved(ticket, csatBase, portalUrl ? `${portalUrl}/tickets/${ticket.id}` : '');
  triggerEmail(db, settings, 'status_resolved', { ticketId: ticket.id, recipientEmail: ticket.requester_email, subject, bodyHtml: html });
}

export function emailOnStatusWaiting(db: Database.Database, settings: Record<string, string>, ticket: any): void {
  if (!ticket.requester_email) return;
  const portalUrl = settings.calyx_portal_url || '';
  const { subject, html } = tmplStatusWaiting(ticket, portalUrl ? `${portalUrl}/tickets/${ticket.id}` : '');
  triggerEmail(db, settings, 'status_waiting', { ticketId: ticket.id, recipientEmail: ticket.requester_email, subject, bodyHtml: html });
}

export function emailOnAssigned(db: Database.Database, settings: Record<string, string>, ticket: any, agentName: string, agentEmail: string): void {
  if (!agentEmail) return;
  const { subject, html } = tmplAssigned(ticket, agentName);
  triggerEmail(db, settings, 'assigned', { ticketId: ticket.id, recipientEmail: agentEmail, subject, bodyHtml: html });
}

export function emailOnStatusChange(db: Database.Database, settings: Record<string, string>, ticket: any): void {
  const watchers = db.prepare(`
    SELECT a.email FROM calyx_ticket_watchers w
    JOIN calyx_agents a ON a.id = w.agent_id
    WHERE w.ticket_id = ? AND a.email IS NOT NULL
  `).all(ticket.id) as { email: string }[];

  for (const w of watchers) {
    queueEmail(db, {
      ticketId: ticket.id,
      recipientEmail: w.email,
      eventType: 'watcher_status_change',
      subject: `[${ticket.reference || 'TKT-' + ticket.id}] Status changed to ${ticket.status}`,
      bodyHtml: `<p>Ticket <b>${ticket.reference || 'TKT-' + ticket.id}</b> status changed to <b>${ticket.status}</b>.</p>`,
    });
  }
}

export function emailOnDeclaredMajor(db: Database.Database, settings: Record<string, string>, incident: any, ticket: any): void {
  const { subject, html } = tmplMajorIncident(incident, ticket, false, false);
  const stakeholders = getStakeholderEmails(db, ticket);
  for (const email of stakeholders) {
    triggerEmail(db, settings, 'major_incident', { ticketId: ticket.id, recipientEmail: email, subject, bodyHtml: html });
  }
}

export function emailOnMajorComms(db: Database.Database, settings: Record<string, string>, incident: any, ticket: any, latestComm: string): void {
  const inc = { ...incident, latest_comm: latestComm };
  const { subject, html } = tmplMajorIncident(inc, ticket, true, false);
  const stakeholders = getStakeholderEmails(db, ticket);
  for (const email of stakeholders) {
    triggerEmail(db, settings, 'major_incident_update', { ticketId: ticket.id, recipientEmail: email, subject, bodyHtml: html });
  }
}

export function emailOnMajorResolved(db: Database.Database, settings: Record<string, string>, incident: any, ticket: any): void {
  const { subject, html } = tmplMajorIncident(incident, ticket, false, true);
  const stakeholders = getStakeholderEmails(db, ticket);
  for (const email of stakeholders) {
    triggerEmail(db, settings, 'major_incident_resolved', { ticketId: ticket.id, recipientEmail: email, subject, bodyHtml: html });
  }
}

export function emailOnCsat(db: Database.Database, settings: Record<string, string>, ticket: any, token: string): void {
  if (!ticket.requester_email) return;
  const portalUrl = settings.calyx_portal_url || '';
  const surveyUrl = portalUrl ? `${portalUrl}/csat/${token}?` : `/portal/csat/${token}?`;
  const { subject, html } = tmplCsatSurvey(ticket, surveyUrl);
  triggerEmail(db, settings, 'csat_survey', { ticketId: ticket.id, recipientEmail: ticket.requester_email, subject, bodyHtml: html });
}

export function emailOnChangeApproved(db: Database.Database, settings: Record<string, string>, change: any, agentName: string): void {
  const requesterAgent = db.prepare('SELECT email FROM calyx_agents WHERE id = ?').get(change.requested_by_agent_id) as any;
  if (!requesterAgent?.email) return;
  const { subject, html } = tmplChangeApproved(change, agentName);
  triggerEmail(db, settings, 'change_approved', { recipientEmail: requesterAgent.email, subject, bodyHtml: html });
}

export function emailOnChangeRejected(db: Database.Database, settings: Record<string, string>, change: any, agentName: string, reason: string): void {
  const requesterAgent = db.prepare('SELECT email FROM calyx_agents WHERE id = ?').get(change.requested_by_agent_id) as any;
  if (!requesterAgent?.email) return;
  const { subject, html } = tmplChangeRejected(change, agentName, reason);
  triggerEmail(db, settings, 'change_rejected', { recipientEmail: requesterAgent.email, subject, bodyHtml: html });
}

function getStakeholderEmails(db: Database.Database, ticket: any): string[] {
  const emails: Set<string> = new Set();
  if (ticket.requester_email) emails.add(ticket.requester_email);
  const watchers = db.prepare(`
    SELECT a.email FROM calyx_ticket_watchers w
    JOIN calyx_agents a ON a.id = w.agent_id
    WHERE w.ticket_id = ? AND a.email IS NOT NULL
  `).all(ticket.id) as { email: string }[];
  for (const w of watchers) emails.add(w.email);
  const assigned = ticket.assigned_agent_id
    ? db.prepare('SELECT email FROM calyx_agents WHERE id = ?').get(ticket.assigned_agent_id) as any
    : null;
  if (assigned?.email) emails.add(assigned.email);
  return [...emails];
}
