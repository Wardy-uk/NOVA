import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type Database from 'better-sqlite3';
import type { FileSettingsQueries } from '../db/settings-store.js';
import { portalAuthMiddleware, getPortalJwtSecret } from '../middleware/calyx-portal-auth.js';
import { queueEmail, isNotificationEnabled } from '../services/calyx-email.js';
import { emailBase, tmplTicketCreated } from '../services/calyx-email-templates.js';
import { startSlosForTicket, resumeSlos } from '../services/calyx-slo-engine.js';

const magicLinkAttempts = new Map<string, { count: number; firstAt: number }>();

function checkMagicLinkRate(email: string): boolean {
  const key = email.toLowerCase();
  const now = Date.now();
  const entry = magicLinkAttempts.get(key);
  if (!entry || now - entry.firstAt > 3600_000) {
    magicLinkAttempts.set(key, { count: 1, firstAt: now });
    return true;
  }
  if (entry.count >= 3) return false;
  entry.count++;
  return true;
}

export function createCalyxPortalRoutes(db: Database.Database, settingsQueries: FileSettingsQueries): Router {
  const router = Router();
  const portalAuth = portalAuthMiddleware(settingsQueries);

  // ── Public: Request magic link ──
  router.post('/request-access', (req, res) => {
    const { email } = req.body;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ ok: false, error: 'Valid email is required' });
      return;
    }

    const normalised = email.trim().toLowerCase();

    if (!checkMagicLinkRate(normalised)) {
      res.json({ ok: true, message: 'If that email is registered, a login link has been sent.' });
      return;
    }

    let requester = db.prepare('SELECT * FROM calyx_requesters WHERE email = ?').get(normalised) as any;
    if (!requester) {
      const namePart = normalised.split('@')[0].replace(/[._-]/g, ' ');
      const name = namePart.charAt(0).toUpperCase() + namePart.slice(1);
      db.prepare('INSERT INTO calyx_requesters (name, email) VALUES (?, ?)').run(name, normalised);
      requester = db.prepare('SELECT * FROM calyx_requesters WHERE email = ?').get(normalised) as any;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    db.prepare('UPDATE calyx_requesters SET portal_token = ?, portal_token_expires_at = ? WHERE id = ?')
      .run(token, expiresAt, requester.id);

    const portalBase = settingsQueries.get('calyx_portal_url') || '';
    const linkUrl = portalBase ? `${portalBase}/api/calyx/portal/verify/${token}` : `/api/calyx/portal/verify/${token}`;
    const subject = 'Your Nurtur Support login link';
    const html = emailBase(`
      <h2 style="margin:0 0 16px;color:#1e293b">Log in to Nurtur Support</h2>
      <p style="color:#475569">Click the link below to log in. This link expires in 15 minutes and can only be used once.</p>
      <div style="text-align:center;margin:24px 0">
        <a href="${linkUrl}" style="display:inline-block;padding:12px 32px;background:#5ec1ca;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:16px">Log in to Support Portal</a>
      </div>
      <p style="color:#94a3b8;font-size:13px">If you didn't request this link, you can safely ignore this email.</p>
    `);

    queueEmail(db, {
      recipientEmail: normalised,
      eventType: 'magic_link',
      subject,
      bodyHtml: html,
    });

    res.json({ ok: true, message: 'If that email is registered, a login link has been sent.' });
  });

  // ── Public: Verify magic link token ──
  router.get('/verify/:token', (req, res) => {
    const { token } = req.params;
    const requester = db.prepare(
      'SELECT * FROM calyx_requesters WHERE portal_token = ?'
    ).get(token) as any;

    if (!requester) {
      res.redirect('/portal/login?error=invalid');
      return;
    }

    if (!requester.portal_token_expires_at || new Date(requester.portal_token_expires_at) < new Date()) {
      db.prepare('UPDATE calyx_requesters SET portal_token = NULL, portal_token_expires_at = NULL WHERE id = ?')
        .run(requester.id);
      res.redirect('/portal/login?error=expired');
      return;
    }

    // Single-use: clear token immediately
    db.prepare(
      "UPDATE calyx_requesters SET portal_token = NULL, portal_token_expires_at = NULL, last_login_at = datetime('now') WHERE id = ?"
    ).run(requester.id);

    const secret = getPortalJwtSecret(settingsQueries);
    const jwtToken = jwt.sign(
      { requesterId: requester.id, email: requester.email, type: 'portal' as const },
      secret,
      { expiresIn: '7d' }
    );

    res.cookie('calyx_portal_token', jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.redirect('/portal/my-tickets');
  });

  // ── Public: CSAT submission ──
  router.post('/csat/:token', (req, res) => {
    const survey = db.prepare('SELECT * FROM calyx_csat_surveys WHERE survey_token = ?').get(req.params.token) as any;
    if (!survey) {
      res.status(404).json({ ok: false, error: 'Survey not found or link has expired' });
      return;
    }
    if (survey.responded_at) {
      res.status(400).json({ ok: false, error: 'This survey has already been submitted' });
      return;
    }

    const { csat_score, xla_score, effort_score, comment } = req.body;
    if (!csat_score || csat_score < 1 || csat_score > 5) {
      res.status(400).json({ ok: false, error: 'csat_score (1-5) is required' });
      return;
    }

    db.prepare(`
      UPDATE calyx_csat_surveys
      SET responded_at = datetime('now'), csat_score = ?, xla_score = ?, effort_score = ?, comment = ?
      WHERE id = ?
    `).run(csat_score, xla_score ?? null, effort_score ?? null, comment ?? null, survey.id);

    res.json({ ok: true, message: 'Thank you for your feedback!' });
  });

  // ── Public: CSAT survey info (for rendering the form) ──
  router.get('/csat/:token', (req, res) => {
    const survey = db.prepare(`
      SELECT s.*, t.reference, t.title
      FROM calyx_csat_surveys s
      JOIN calyx_tickets t ON t.id = s.ticket_id
      WHERE s.survey_token = ?
    `).get(req.params.token) as any;
    if (!survey) {
      res.status(404).json({ ok: false, error: 'Survey not found or link has expired' });
      return;
    }
    res.json({
      ok: true,
      data: {
        reference: survey.reference,
        title: survey.title,
        already_responded: !!survey.responded_at,
      },
    });
  });

  // ── Protected portal routes ──
  router.use('/me', portalAuth);
  router.use('/tickets', portalAuth);
  router.use('/kb', portalAuth);
  router.use('/catalogue', portalAuth);

  // ── Me ──
  router.get('/me', (req, res) => {
    const r = db.prepare(`
      SELECT r.id, r.name, r.email, r.organisation_id, o.name as organisation_name,
        (SELECT COUNT(*) FROM calyx_tickets WHERE requester_id = r.id AND status NOT IN ('resolved','closed')) as open_ticket_count
      FROM calyx_requesters r
      LEFT JOIN calyx_organisations o ON o.id = r.organisation_id
      WHERE r.id = ?
    `).get(req.portalUser!.requesterId) as any;
    if (!r) { res.status(404).json({ ok: false, error: 'Requester not found' }); return; }
    res.json({ ok: true, data: r });
  });

  // ── Tickets (own only) ──
  router.get('/tickets', (req, res) => {
    const rid = req.portalUser!.requesterId;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;
    const status = req.query.status as string | undefined;

    let sql = `SELECT id, reference, title, status, priority, created_at, updated_at, frt_due_at, resolution_due_at
      FROM calyx_tickets WHERE requester_id = ?`;
    const params: unknown[] = [rid];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const tickets = db.prepare(sql).all(...params);
    const total = db.prepare(
      `SELECT COUNT(*) as c FROM calyx_tickets WHERE requester_id = ?${status ? ' AND status = ?' : ''}`
    ).get(...(status ? [rid, status] : [rid])) as any;

    res.json({ ok: true, data: tickets, total: total.c });
  });

  router.post('/tickets', (req, res) => {
    const rid = req.portalUser!.requesterId;
    const requester = db.prepare('SELECT * FROM calyx_requesters WHERE id = ?').get(rid) as any;
    if (!requester) { res.status(400).json({ ok: false, error: 'Requester not found' }); return; }

    const { title, description, priority_label, service_id } = req.body;
    if (!title) { res.status(400).json({ ok: false, error: 'Title is required' }); return; }

    const priorityMap: Record<string, string> = { High: 'P1', Medium: 'P2', Low: 'P3' };
    const priority = priorityMap[priority_label] || 'P3';

    let team_id: number | null = null;
    let category_id: number | null = null;

    if (service_id) {
      const svc = db.prepare('SELECT * FROM calyx_service_catalogue WHERE id = ? AND is_active = 1').get(service_id) as any;
      if (svc) {
        team_id = svc.team_id;
        category_id = svc.category_id;
      }
    }

    // Fallback to first team
    if (!team_id) {
      const firstTeam = db.prepare('SELECT id FROM calyx_teams ORDER BY id LIMIT 1').get() as any;
      team_id = firstTeam?.id ?? 1;
    }

    // Generate reference
    const last = db.prepare('SELECT reference FROM calyx_tickets ORDER BY id DESC LIMIT 1').get() as any;
    const n = last ? parseInt(last.reference.replace('CAL-', '')) + 1 : 1;
    const reference = `CAL-${String(n).padStart(3, '0')}`;

    // Find matching SLA policy
    const sla = db.prepare(`
      SELECT * FROM calyx_sla_policies
      WHERE (team_id IS NULL OR team_id = ?) AND (priority IS NULL OR priority = ?)
      ORDER BY position ASC LIMIT 1
    `).get(team_id, priority) as any;

    const now = new Date();
    let frt_due_at: string | null = null;
    let resolution_due_at: string | null = null;
    let sla_policy_id: number | null = null;

    if (sla) {
      sla_policy_id = sla.id;
      frt_due_at = new Date(now.getTime() + sla.frt_minutes * 60000).toISOString();
      resolution_due_at = new Date(now.getTime() + sla.resolution_minutes * 60000).toISOString();
    }

    const result = db.prepare(`
      INSERT INTO calyx_tickets (reference, title, description, team_id, category_id, priority, status, requester_id,
        requester_name, requester_email, source, sla_policy_id, frt_due_at, resolution_due_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, 'portal', ?, ?, ?, datetime('now'), datetime('now'))
    `).run(reference, title, description ?? '', team_id, category_id, priority, rid,
      requester.name, requester.email, sla_policy_id, frt_due_at, resolution_due_at);

    const ticketId = Number(result.lastInsertRowid);

    db.prepare("INSERT INTO calyx_ticket_events (ticket_id, event_type, to_value, note, created_at) VALUES (?, 'created', 'open', 'Raised via portal', datetime('now'))")
      .run(ticketId);

    startSlosForTicket(db, ticketId);

    const ticket = db.prepare('SELECT * FROM calyx_tickets WHERE id = ?').get(ticketId) as any;
    const settings = settingsQueries.getAll();
    if (isNotificationEnabled(settings, 'ticket_created') && ticket.requester_email) {
      const portalUrl = settings.calyx_portal_url || '';
      const tmpl = tmplTicketCreated(ticket, portalUrl ? `${portalUrl}/portal/tickets/${reference}` : '');
      queueEmail(db, { ticketId, recipientEmail: ticket.requester_email, eventType: 'ticket_created', subject: tmpl.subject, bodyHtml: tmpl.html });
    }

    res.status(201).json({ ok: true, data: { id: ticketId, reference, title } });
  });

  router.get('/tickets/:ref', (req, res) => {
    const rid = req.portalUser!.requesterId;
    const ticket = db.prepare('SELECT * FROM calyx_tickets WHERE reference = ?').get(req.params.ref) as any;
    if (!ticket) { res.status(404).json({ ok: false, error: 'Ticket not found' }); return; }
    if (ticket.requester_id !== rid) {
      res.status(403).json({ ok: false, error: 'Access denied' });
      return;
    }

    // Get comments, EXCLUDING internal ones
    const comments = db.prepare(`
      SELECT c.id, c.body, c.is_internal, c.created_at,
        CASE WHEN c.agent_id IS NOT NULL THEN a.name ELSE 'You' END as author_name,
        CASE WHEN c.agent_id IS NOT NULL THEN 'agent' ELSE 'requester' END as author_type
      FROM calyx_ticket_comments c
      LEFT JOIN calyx_agents a ON a.id = c.agent_id
      WHERE c.ticket_id = ? AND c.is_internal = 0
      ORDER BY c.created_at ASC
    `).all(ticket.id);

    const team = ticket.team_id ? db.prepare('SELECT name FROM calyx_teams WHERE id = ?').get(ticket.team_id) as any : null;
    const category = ticket.category_id ? db.prepare('SELECT name FROM calyx_categories WHERE id = ?').get(ticket.category_id) as any : null;

    res.json({
      ok: true,
      data: {
        id: ticket.id,
        reference: ticket.reference,
        title: ticket.title,
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority,
        team_name: team?.name ?? null,
        category_name: category?.name ?? null,
        frt_due_at: ticket.frt_due_at,
        resolution_due_at: ticket.resolution_due_at,
        created_at: ticket.created_at,
        updated_at: ticket.updated_at,
        comments,
      },
    });
  });

  router.post('/tickets/:ref/reply', (req, res) => {
    const rid = req.portalUser!.requesterId;
    const ticket = db.prepare('SELECT * FROM calyx_tickets WHERE reference = ?').get(req.params.ref) as any;
    if (!ticket) { res.status(404).json({ ok: false, error: 'Ticket not found' }); return; }
    if (ticket.requester_id !== rid) {
      res.status(403).json({ ok: false, error: 'Access denied' });
      return;
    }

    const { body } = req.body;
    if (!body || typeof body !== 'string' || !body.trim()) {
      res.status(400).json({ ok: false, error: 'Reply body is required' });
      return;
    }

    db.prepare(`
      INSERT INTO calyx_ticket_comments (ticket_id, body, is_internal, created_at)
      VALUES (?, ?, 0, datetime('now'))
    `).run(ticket.id, body.trim());

    // If ticket was waiting_customer, move back to open and resume SLOs
    if (ticket.status === 'waiting_customer') {
      db.prepare("UPDATE calyx_tickets SET status = 'open', updated_at = datetime('now') WHERE id = ?").run(ticket.id);
      resumeSlos(db, ticket.id);
      db.prepare("INSERT INTO calyx_ticket_events (ticket_id, event_type, from_value, to_value, note, created_at) VALUES (?, 'status_change', 'waiting_customer', 'open', 'Requester replied via portal', datetime('now'))")
        .run(ticket.id);
    }

    db.prepare("INSERT INTO calyx_ticket_events (ticket_id, event_type, note, created_at) VALUES (?, 'comment_added', 'Portal reply from requester', datetime('now'))")
      .run(ticket.id);

    res.status(201).json({ ok: true });
  });

  // ── KB (public articles only) ──
  router.get('/kb', (req, res) => {
    const q = req.query.q as string | undefined;
    let sql = "SELECT id, title, slug, created_at, updated_at, view_count FROM calyx_kb_articles WHERE status = 'published'";
    const params: unknown[] = [];
    if (q) {
      sql += ' AND (title LIKE ? OR body LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    sql += ' ORDER BY view_count DESC LIMIT 50';
    res.json({ ok: true, data: db.prepare(sql).all(...params) });
  });

  router.get('/kb/:slug', (req, res) => {
    const article = db.prepare(
      "SELECT * FROM calyx_kb_articles WHERE slug = ? AND status = 'published'"
    ).get(req.params.slug) as any;
    if (!article) { res.status(404).json({ ok: false, error: 'Article not found' }); return; }
    db.prepare('UPDATE calyx_kb_articles SET view_count = view_count + 1 WHERE id = ?').run(article.id);
    res.json({ ok: true, data: article });
  });

  // ── Service Catalogue ──
  router.get('/catalogue', (_req, res) => {
    const items = db.prepare('SELECT id, name, description, icon, request_form_schema FROM calyx_service_catalogue WHERE is_active = 1 ORDER BY name').all();
    res.json({ ok: true, data: items });
  });

  return router;
}
