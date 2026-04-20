import { Router } from 'express';
import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { auditLog } from '../db/calyx-db.js';
import { completeSloOnEvent } from '../services/calyx-slo-engine.js';
import {
  emailOnDeclaredMajor, emailOnMajorComms, emailOnMajorResolved,
  emailOnCsat, emailOnChangeApproved, emailOnChangeRejected,
} from './calyx-phase5.js';

function nextReference(db: Database.Database, table: string, prefix: string): string {
  const last = db.prepare(
    `SELECT reference FROM ${table} ORDER BY id DESC LIMIT 1`
  ).get() as any;
  const n = last ? parseInt(last.reference.replace(`${prefix}-`, '')) + 1 : 1;
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function uniqueSlug(db: Database.Database, table: string, base: string): string {
  let slug = slugify(base);
  let suffix = 1;
  while (db.prepare(`SELECT id FROM ${table} WHERE slug = ?`).get(slug)) {
    suffix++;
    slug = `${slugify(base)}-${suffix}`;
  }
  return slug;
}

export function createCalyxPhase4Routes(db: Database.Database, getSettings: () => Record<string, string>): Router {
  const router = Router();

  // ═══════════════════════════════════════════════════════════════════
  // ORGANISATIONS
  // ═══════════════════════════════════════════════════════════════════

  router.get('/organisations', (_req, res) => {
    const rows = db.prepare(`
      SELECT o.*, COUNT(t.id) as ticket_count
      FROM calyx_organisations o
      LEFT JOIN calyx_tickets t ON t.organisation_id = o.id
      GROUP BY o.id
      ORDER BY o.name
    `).all();
    res.json({ ok: true, data: rows });
  });

  router.post('/organisations', (req, res) => {
    const { name, contact_name, contact_email, sla_policy_id, notes } = req.body;
    if (!name) { res.status(400).json({ ok: false, error: 'name is required' }); return; }
    const slug = uniqueSlug(db, 'calyx_organisations', name);
    const result = db.prepare(
      'INSERT INTO calyx_organisations (name, slug, contact_name, contact_email, sla_policy_id, notes) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, slug, contact_name ?? null, contact_email ?? null, sla_policy_id ?? null, notes ?? null);
    const org = db.prepare('SELECT * FROM calyx_organisations WHERE id = ?').get(result.lastInsertRowid);
    auditLog(db, { entityType: 'organisation', entityId: Number(result.lastInsertRowid), action: 'created', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.status(201).json({ ok: true, data: org });
  });

  router.patch('/organisations/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM calyx_organisations WHERE id = ?').get(id);
    if (!existing) { res.status(404).json({ ok: false, error: 'Organisation not found' }); return; }
    const fields: string[] = []; const params: unknown[] = [];
    for (const k of ['name', 'contact_name', 'contact_email', 'sla_policy_id', 'notes']) {
      if (req.body[k] !== undefined) { fields.push(`${k} = ?`); params.push(req.body[k]); }
    }
    if (fields.length) { params.push(id); db.prepare(`UPDATE calyx_organisations SET ${fields.join(', ')} WHERE id = ?`).run(...params); }
    const updated = db.prepare('SELECT * FROM calyx_organisations WHERE id = ?').get(id);
    auditLog(db, { entityType: 'organisation', entityId: id, action: 'updated', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.json({ ok: true, data: updated });
  });

  router.get('/organisations/:id', (req, res) => {
    const id = Number(req.params.id);
    const org = db.prepare('SELECT * FROM calyx_organisations WHERE id = ?').get(id) as any;
    if (!org) { res.status(404).json({ ok: false, error: 'Organisation not found' }); return; }
    const tickets = db.prepare('SELECT id, reference, title, status, priority, created_at FROM calyx_tickets WHERE organisation_id = ? ORDER BY created_at DESC LIMIT 20').all(id);
    res.json({ ok: true, data: { ...org, recent_tickets: tickets } });
  });

  router.get('/organisations/:id/tickets', (req, res) => {
    const id = Number(req.params.id);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const tickets = db.prepare('SELECT * FROM calyx_tickets WHERE organisation_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(id, limit, offset);
    res.json({ ok: true, data: tickets });
  });

  // ═══════════════════════════════════════════════════════════════════
  // REQUESTERS
  // ═══════════════════════════════════════════════════════════════════

  router.get('/requesters', (req, res) => {
    const q = req.query.q as string | undefined;
    let rows;
    if (q) {
      rows = db.prepare(`
        SELECT r.*, o.name as organisation_name FROM calyx_requesters r
        LEFT JOIN calyx_organisations o ON o.id = r.organisation_id
        WHERE r.name LIKE ? OR r.email LIKE ?
        ORDER BY r.name LIMIT 100
      `).all(`%${q}%`, `%${q}%`);
    } else {
      rows = db.prepare(`
        SELECT r.*, o.name as organisation_name FROM calyx_requesters r
        LEFT JOIN calyx_organisations o ON o.id = r.organisation_id
        ORDER BY r.name LIMIT 100
      `).all();
    }
    res.json({ ok: true, data: rows });
  });

  router.post('/requesters', (req, res) => {
    const { name, email, phone, organisation_id } = req.body;
    if (!name || !email) { res.status(400).json({ ok: false, error: 'name and email are required' }); return; }
    try {
      const result = db.prepare(
        'INSERT INTO calyx_requesters (name, email, phone, organisation_id) VALUES (?, ?, ?, ?)'
      ).run(name, email, phone ?? null, organisation_id ?? null);
      const requester = db.prepare('SELECT * FROM calyx_requesters WHERE id = ?').get(result.lastInsertRowid);
      auditLog(db, { entityType: 'requester', entityId: Number(result.lastInsertRowid), action: 'created', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
      res.status(201).json({ ok: true, data: requester });
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) { res.status(400).json({ ok: false, error: 'Email already exists' }); return; }
      throw err;
    }
  });

  router.patch('/requesters/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM calyx_requesters WHERE id = ?').get(id);
    if (!existing) { res.status(404).json({ ok: false, error: 'Requester not found' }); return; }
    const fields: string[] = []; const params: unknown[] = [];
    for (const k of ['name', 'email', 'phone', 'organisation_id']) {
      if (req.body[k] !== undefined) { fields.push(`${k} = ?`); params.push(req.body[k]); }
    }
    if (fields.length) { params.push(id); db.prepare(`UPDATE calyx_requesters SET ${fields.join(', ')} WHERE id = ?`).run(...params); }
    const updated = db.prepare('SELECT * FROM calyx_requesters WHERE id = ?').get(id);
    auditLog(db, { entityType: 'requester', entityId: id, action: 'updated', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.json({ ok: true, data: updated });
  });

  router.get('/requesters/:id', (req, res) => {
    const id = Number(req.params.id);
    const requester = db.prepare(`
      SELECT r.*, o.name as organisation_name FROM calyx_requesters r
      LEFT JOIN calyx_organisations o ON o.id = r.organisation_id
      WHERE r.id = ?
    `).get(id) as any;
    if (!requester) { res.status(404).json({ ok: false, error: 'Requester not found' }); return; }
    const tickets = db.prepare('SELECT id, reference, title, status, priority, created_at FROM calyx_tickets WHERE requester_id = ? ORDER BY created_at DESC LIMIT 20').all(id);
    const csatAvg = db.prepare('SELECT AVG(csat_score) as avg_csat FROM calyx_csat_surveys WHERE requester_id = ? AND csat_score IS NOT NULL').get(id) as any;
    res.json({ ok: true, data: { ...requester, recent_tickets: tickets, avg_csat: csatAvg?.avg_csat ?? null } });
  });

  router.get('/requesters/:id/tickets', (req, res) => {
    const id = Number(req.params.id);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const tickets = db.prepare('SELECT * FROM calyx_tickets WHERE requester_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(id, limit, offset);
    res.json({ ok: true, data: tickets });
  });

  // ═══════════════════════════════════════════════════════════════════
  // PROBLEMS
  // ═══════════════════════════════════════════════════════════════════

  router.get('/problems', (req, res) => {
    let sql = 'SELECT * FROM calyx_problems';
    const params: unknown[] = [];
    if (req.query.status) { sql += ' WHERE status = ?'; params.push(req.query.status); }
    sql += ' ORDER BY created_at DESC';
    res.json({ ok: true, data: db.prepare(sql).all(...params) });
  });

  router.post('/problems', (req, res) => {
    const { title, description, assigned_agent_id, created_by_agent_id } = req.body;
    if (!title || !created_by_agent_id) { res.status(400).json({ ok: false, error: 'title and created_by_agent_id are required' }); return; }
    const reference = nextReference(db, 'calyx_problems', 'PRB');
    const result = db.prepare(
      'INSERT INTO calyx_problems (reference, title, description, assigned_agent_id, created_by_agent_id) VALUES (?, ?, ?, ?, ?)'
    ).run(reference, title, description ?? null, assigned_agent_id ?? null, created_by_agent_id);
    const problem = db.prepare('SELECT * FROM calyx_problems WHERE id = ?').get(result.lastInsertRowid);
    auditLog(db, { entityType: 'problem', entityId: Number(result.lastInsertRowid), action: 'created', actorType: 'agent', actorId: created_by_agent_id, ipAddress: req.ip });
    res.status(201).json({ ok: true, data: problem });
  });

  router.patch('/problems/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM calyx_problems WHERE id = ?').get(id);
    if (!existing) { res.status(404).json({ ok: false, error: 'Problem not found' }); return; }
    const fields: string[] = ['updated_at = datetime(\'now\')']; const params: unknown[] = [];
    for (const k of ['title', 'description', 'status', 'root_cause', 'workaround', 'assigned_agent_id']) {
      if (req.body[k] !== undefined) { fields.push(`${k} = ?`); params.push(req.body[k]); }
    }
    params.push(id);
    db.prepare(`UPDATE calyx_problems SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    const updated = db.prepare('SELECT * FROM calyx_problems WHERE id = ?').get(id);
    auditLog(db, { entityType: 'problem', entityId: id, action: 'updated', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.json({ ok: true, data: updated });
  });

  router.get('/problems/:id', (req, res) => {
    const id = Number(req.params.id);
    const problem = db.prepare('SELECT * FROM calyx_problems WHERE id = ?').get(id) as any;
    if (!problem) { res.status(404).json({ ok: false, error: 'Problem not found' }); return; }
    const tickets = db.prepare(`
      SELECT t.id, t.reference, t.title, t.status, t.priority
      FROM calyx_problem_tickets pt
      JOIN calyx_tickets t ON t.id = pt.ticket_id
      WHERE pt.problem_id = ?
    `).all(id);
    res.json({ ok: true, data: { ...problem, linked_tickets: tickets } });
  });

  router.post('/problems/:id/link-ticket', (req, res) => {
    const id = Number(req.params.id);
    const { ticket_id } = req.body;
    if (!ticket_id) { res.status(400).json({ ok: false, error: 'ticket_id is required' }); return; }
    if (!db.prepare('SELECT id FROM calyx_problems WHERE id = ?').get(id)) { res.status(404).json({ ok: false, error: 'Problem not found' }); return; }
    try {
      db.prepare('INSERT INTO calyx_problem_tickets (problem_id, ticket_id) VALUES (?, ?)').run(id, ticket_id);
      auditLog(db, { entityType: 'problem', entityId: id, action: 'ticket_linked', actorType: 'agent', actorId: req.body.agent_id ?? null, changes: { ticket_id: { from: null, to: ticket_id } }, ipAddress: req.ip });
      res.status(201).json({ ok: true });
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) { res.json({ ok: true }); return; }
      throw err;
    }
  });

  router.delete('/problems/:id/tickets/:ticketId', (req, res) => {
    db.prepare('DELETE FROM calyx_problem_tickets WHERE problem_id = ? AND ticket_id = ?').run(Number(req.params.id), Number(req.params.ticketId));
    auditLog(db, { entityType: 'problem', entityId: Number(req.params.id), action: 'ticket_unlinked', actorType: 'agent', actorId: null, changes: { ticket_id: { from: Number(req.params.ticketId), to: null } }, ipAddress: req.ip });
    res.json({ ok: true });
  });

  router.post('/problems/:id/resolve', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM calyx_problems WHERE id = ?').get(id);
    if (!existing) { res.status(404).json({ ok: false, error: 'Problem not found' }); return; }
    db.prepare("UPDATE calyx_problems SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
    const updated = db.prepare('SELECT * FROM calyx_problems WHERE id = ?').get(id);
    auditLog(db, { entityType: 'problem', entityId: id, action: 'resolved', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.json({ ok: true, data: updated });
  });

  // ═══════════════════════════════════════════════════════════════════
  // CHANGES
  // ═══════════════════════════════════════════════════════════════════

  router.get('/changes', (req, res) => {
    let sql = 'SELECT * FROM calyx_changes'; const conds: string[] = []; const params: unknown[] = [];
    if (req.query.status) { conds.push('status = ?'); params.push(req.query.status); }
    if (req.query.type) { conds.push('type = ?'); params.push(req.query.type); }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY created_at DESC';
    res.json({ ok: true, data: db.prepare(sql).all(...params) });
  });

  router.post('/changes', (req, res) => {
    const { title, description, type, risk_level, impact_assessment, rollback_plan, requested_by_agent_id, scheduled_start_at, scheduled_end_at } = req.body;
    if (!title || !requested_by_agent_id) { res.status(400).json({ ok: false, error: 'title and requested_by_agent_id are required' }); return; }
    const reference = nextReference(db, 'calyx_changes', 'CHG');
    const result = db.prepare(`
      INSERT INTO calyx_changes (reference, title, description, type, risk_level, impact_assessment, rollback_plan, requested_by_agent_id, scheduled_start_at, scheduled_end_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(reference, title, description ?? null, type ?? 'normal', risk_level ?? 'low', impact_assessment ?? null, rollback_plan ?? null, requested_by_agent_id, scheduled_start_at ?? null, scheduled_end_at ?? null);
    const change = db.prepare('SELECT * FROM calyx_changes WHERE id = ?').get(result.lastInsertRowid);
    auditLog(db, { entityType: 'change', entityId: Number(result.lastInsertRowid), action: 'created', actorType: 'agent', actorId: requested_by_agent_id, ipAddress: req.ip });
    res.status(201).json({ ok: true, data: change });
  });

  router.patch('/changes/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM calyx_changes WHERE id = ?').get(id);
    if (!existing) { res.status(404).json({ ok: false, error: 'Change not found' }); return; }
    const fields: string[] = ['updated_at = datetime(\'now\')']; const params: unknown[] = [];
    for (const k of ['title', 'description', 'type', 'risk_level', 'impact_assessment', 'rollback_plan', 'scheduled_start_at', 'scheduled_end_at']) {
      if (req.body[k] !== undefined) { fields.push(`${k} = ?`); params.push(req.body[k]); }
    }
    params.push(id);
    db.prepare(`UPDATE calyx_changes SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    const updated = db.prepare('SELECT * FROM calyx_changes WHERE id = ?').get(id);
    auditLog(db, { entityType: 'change', entityId: id, action: 'updated', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.json({ ok: true, data: updated });
  });

  const changeTransition = (from: string | null, to: string, extraFields?: (id: number, req: any, db: Database.Database) => void) => {
    return (req: any, res: any) => {
      const id = Number(req.params.id);
      const existing = db.prepare('SELECT * FROM calyx_changes WHERE id = ?').get(id) as any;
      if (!existing) { res.status(404).json({ ok: false, error: 'Change not found' }); return; }
      if (from && existing.status !== from) { res.status(400).json({ ok: false, error: `Change must be in '${from}' status (currently '${existing.status}')` }); return; }
      db.prepare(`UPDATE calyx_changes SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(to, id);
      if (extraFields) extraFields(id, req, db);
      const updated = db.prepare('SELECT * FROM calyx_changes WHERE id = ?').get(id);
      auditLog(db, { entityType: 'change', entityId: id, action: `status_${to}`, actorType: 'agent', actorId: req.body.agent_id ?? null, changes: { status: { from: existing.status, to } }, ipAddress: req.ip });
      res.json({ ok: true, data: updated });
    };
  };

  router.post('/changes/:id/submit', changeTransition('draft', 'submitted'));
  router.post('/changes/:id/approve', (req, res) => {
    const user = (req as any).user;
    if (!user || user.role !== 'admin') { res.status(403).json({ ok: false, error: 'Admin only' }); return; }
    changeTransition('submitted', 'approved', (id, r) => {
      db.prepare('UPDATE calyx_changes SET approved_by_agent_id = ? WHERE id = ?').run(r.body.agent_id ?? null, id);
      const change = db.prepare('SELECT * FROM calyx_changes WHERE id = ?').get(id) as any;
      const approver = db.prepare('SELECT name FROM calyx_agents WHERE id = ?').get(r.body.agent_id) as any;
      emailOnChangeApproved(db, getSettings(), change, approver?.name || user.username);
    })(req, res);
  });
  router.post('/changes/:id/reject', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM calyx_changes WHERE id = ?').get(id) as any;
    if (!existing) { res.status(404).json({ ok: false, error: 'Change not found' }); return; }
    if (existing.status !== 'submitted') { res.status(400).json({ ok: false, error: `Change must be in 'submitted' status` }); return; }
    db.prepare("UPDATE calyx_changes SET status = 'rejected', rejection_reason = ?, updated_at = datetime('now') WHERE id = ?").run(req.body.reason ?? null, id);
    const updated = db.prepare('SELECT * FROM calyx_changes WHERE id = ?').get(id) as any;

    const user = (req as any).user;
    const rejector = db.prepare('SELECT name FROM calyx_agents WHERE id = ?').get(req.body.agent_id) as any;
    emailOnChangeRejected(db, getSettings(), updated, rejector?.name || user?.username || 'Unknown', req.body.reason ?? '');

    auditLog(db, { entityType: 'change', entityId: id, action: 'status_rejected', actorType: 'agent', actorId: req.body.agent_id ?? null, changes: { status: { from: 'submitted', to: 'rejected' } }, ipAddress: req.ip });
    res.json({ ok: true, data: updated });
  });
  router.post('/changes/:id/start', changeTransition('approved', 'implementing', (id) => {
    db.prepare("UPDATE calyx_changes SET actual_start_at = datetime('now') WHERE id = ?").run(id);
  }));
  router.post('/changes/:id/complete', changeTransition('implementing', 'complete', (id) => {
    db.prepare("UPDATE calyx_changes SET actual_end_at = datetime('now') WHERE id = ?").run(id);
  }));
  router.post('/changes/:id/cancel', changeTransition(null, 'cancelled'));

  router.get('/changes/:id/tickets', (req, res) => {
    const tickets = db.prepare(`
      SELECT ct.relationship, t.id, t.reference, t.title, t.status, t.priority
      FROM calyx_change_tickets ct
      JOIN calyx_tickets t ON t.id = ct.ticket_id
      WHERE ct.change_id = ?
    `).all(Number(req.params.id));
    res.json({ ok: true, data: tickets });
  });

  router.post('/changes/:id/link-ticket', (req, res) => {
    const id = Number(req.params.id);
    const { ticket_id, relationship } = req.body;
    if (!ticket_id) { res.status(400).json({ ok: false, error: 'ticket_id is required' }); return; }
    if (!db.prepare('SELECT id FROM calyx_changes WHERE id = ?').get(id)) { res.status(404).json({ ok: false, error: 'Change not found' }); return; }
    db.prepare('INSERT INTO calyx_change_tickets (change_id, ticket_id, relationship) VALUES (?, ?, ?)').run(id, ticket_id, relationship ?? 'related');
    auditLog(db, { entityType: 'change', entityId: id, action: 'ticket_linked', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.status(201).json({ ok: true });
  });

  // ═══════════════════════════════════════════════════════════════════
  // KNOWLEDGE BASE
  // ═══════════════════════════════════════════════════════════════════

  router.get('/kb/suggest', (req, res) => {
    const q = req.query.q as string;
    if (!q) { res.json({ ok: true, data: [] }); return; }
    const articles = db.prepare(`
      SELECT id, title, slug FROM calyx_kb_articles
      WHERE status = 'published' AND (title LIKE ? OR body LIKE ?)
      ORDER BY view_count DESC LIMIT 5
    `).all(`%${q}%`, `%${q}%`);
    res.json({ ok: true, data: articles });
  });

  router.get('/kb', (req, res) => {
    let sql = 'SELECT * FROM calyx_kb_articles'; const conds: string[] = []; const params: unknown[] = [];
    if (req.query.q) { conds.push('(title LIKE ? OR body LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
    if (req.query.team_id) { conds.push('team_id = ?'); params.push(Number(req.query.team_id)); }
    if (req.query.status) { conds.push('status = ?'); params.push(req.query.status); }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY updated_at DESC';
    res.json({ ok: true, data: db.prepare(sql).all(...params) });
  });

  router.post('/kb', (req, res) => {
    const { title, body, category_id, team_id, author_agent_id } = req.body;
    if (!title || !body || !author_agent_id) { res.status(400).json({ ok: false, error: 'title, body, and author_agent_id are required' }); return; }
    const slug = uniqueSlug(db, 'calyx_kb_articles', title);
    const result = db.prepare(
      'INSERT INTO calyx_kb_articles (title, slug, body, category_id, team_id, author_agent_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(title, slug, body, category_id ?? null, team_id ?? null, author_agent_id);
    const article = db.prepare('SELECT * FROM calyx_kb_articles WHERE id = ?').get(result.lastInsertRowid);
    auditLog(db, { entityType: 'kb_article', entityId: Number(result.lastInsertRowid), action: 'created', actorType: 'agent', actorId: author_agent_id, ipAddress: req.ip });
    res.status(201).json({ ok: true, data: article });
  });

  router.patch('/kb/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM calyx_kb_articles WHERE id = ?').get(id);
    if (!existing) { res.status(404).json({ ok: false, error: 'Article not found' }); return; }
    const fields: string[] = ['updated_at = datetime(\'now\')']; const params: unknown[] = [];
    for (const k of ['title', 'body', 'category_id', 'team_id']) {
      if (req.body[k] !== undefined) { fields.push(`${k} = ?`); params.push(req.body[k]); }
    }
    params.push(id);
    db.prepare(`UPDATE calyx_kb_articles SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    const updated = db.prepare('SELECT * FROM calyx_kb_articles WHERE id = ?').get(id);
    auditLog(db, { entityType: 'kb_article', entityId: id, action: 'updated', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.json({ ok: true, data: updated });
  });

  router.post('/kb/:id/publish', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM calyx_kb_articles WHERE id = ?').get(id)) { res.status(404).json({ ok: false, error: 'Article not found' }); return; }
    db.prepare("UPDATE calyx_kb_articles SET status = 'published', published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
    const updated = db.prepare('SELECT * FROM calyx_kb_articles WHERE id = ?').get(id);
    auditLog(db, { entityType: 'kb_article', entityId: id, action: 'published', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.json({ ok: true, data: updated });
  });

  router.post('/kb/:id/archive', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM calyx_kb_articles WHERE id = ?').get(id)) { res.status(404).json({ ok: false, error: 'Article not found' }); return; }
    db.prepare("UPDATE calyx_kb_articles SET status = 'archived', updated_at = datetime('now') WHERE id = ?").run(id);
    const updated = db.prepare('SELECT * FROM calyx_kb_articles WHERE id = ?').get(id);
    auditLog(db, { entityType: 'kb_article', entityId: id, action: 'archived', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.json({ ok: true, data: updated });
  });

  router.post('/kb/:id/helpful', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('UPDATE calyx_kb_articles SET helpful_count = helpful_count + 1, view_count = view_count + 1 WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  router.post('/kb/:id/not-helpful', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('UPDATE calyx_kb_articles SET not_helpful_count = not_helpful_count + 1 WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // ═══════════════════════════════════════════════════════════════════
  // CANNED RESPONSES
  // ═══════════════════════════════════════════════════════════════════

  router.get('/canned-responses', (req, res) => {
    let sql = 'SELECT * FROM calyx_canned_responses'; const conds: string[] = []; const params: unknown[] = [];
    if (req.query.team_id) { conds.push('team_id = ?'); params.push(Number(req.query.team_id)); }
    if (req.query.category_id) { conds.push('category_id = ?'); params.push(Number(req.query.category_id)); }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY use_count DESC, title';
    res.json({ ok: true, data: db.prepare(sql).all(...params) });
  });

  router.post('/canned-responses', (req, res) => {
    const { title, body, team_id, category_id, author_agent_id } = req.body;
    if (!title || !body || !author_agent_id) { res.status(400).json({ ok: false, error: 'title, body, and author_agent_id are required' }); return; }
    const result = db.prepare(
      'INSERT INTO calyx_canned_responses (title, body, team_id, category_id, author_agent_id) VALUES (?, ?, ?, ?, ?)'
    ).run(title, body, team_id ?? null, category_id ?? null, author_agent_id);
    const cr = db.prepare('SELECT * FROM calyx_canned_responses WHERE id = ?').get(result.lastInsertRowid);
    auditLog(db, { entityType: 'canned_response', entityId: Number(result.lastInsertRowid), action: 'created', actorType: 'agent', actorId: author_agent_id, ipAddress: req.ip });
    res.status(201).json({ ok: true, data: cr });
  });

  router.patch('/canned-responses/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM calyx_canned_responses WHERE id = ?').get(id);
    if (!existing) { res.status(404).json({ ok: false, error: 'Canned response not found' }); return; }
    const fields: string[] = ['updated_at = datetime(\'now\')']; const params: unknown[] = [];
    for (const k of ['title', 'body', 'team_id', 'category_id']) {
      if (req.body[k] !== undefined) { fields.push(`${k} = ?`); params.push(req.body[k]); }
    }
    params.push(id);
    db.prepare(`UPDATE calyx_canned_responses SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    const updated = db.prepare('SELECT * FROM calyx_canned_responses WHERE id = ?').get(id);
    auditLog(db, { entityType: 'canned_response', entityId: id, action: 'updated', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.json({ ok: true, data: updated });
  });

  router.delete('/canned-responses/:id', (req, res) => {
    db.prepare('DELETE FROM calyx_canned_responses WHERE id = ?').run(Number(req.params.id));
    auditLog(db, { entityType: 'canned_response', entityId: Number(req.params.id), action: 'deleted', actorType: 'agent', actorId: null, ipAddress: req.ip });
    res.json({ ok: true });
  });

  router.post('/canned-responses/:id/use', (_req, res) => {
    db.prepare('UPDATE calyx_canned_responses SET use_count = use_count + 1 WHERE id = ?').run(Number(_req.params.id));
    res.json({ ok: true });
  });

  // ═══════════════════════════════════════════════════════════════════
  // TAGS
  // ═══════════════════════════════════════════════════════════════════

  router.get('/tags', (_req, res) => {
    res.json({ ok: true, data: db.prepare('SELECT * FROM calyx_tags ORDER BY name').all() });
  });

  router.post('/tags', (req, res) => {
    const { name, colour } = req.body;
    if (!name) { res.status(400).json({ ok: false, error: 'name is required' }); return; }
    const result = db.prepare('INSERT INTO calyx_tags (name, colour) VALUES (?, ?)').run(name, colour ?? '#5ec1ca');
    const tag = db.prepare('SELECT * FROM calyx_tags WHERE id = ?').get(result.lastInsertRowid);
    auditLog(db, { entityType: 'tag', entityId: Number(result.lastInsertRowid), action: 'created', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.status(201).json({ ok: true, data: tag });
  });

  router.patch('/tags/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM calyx_tags WHERE id = ?').get(id)) { res.status(404).json({ ok: false, error: 'Tag not found' }); return; }
    const fields: string[] = []; const params: unknown[] = [];
    for (const k of ['name', 'colour']) { if (req.body[k] !== undefined) { fields.push(`${k} = ?`); params.push(req.body[k]); } }
    if (fields.length) { params.push(id); db.prepare(`UPDATE calyx_tags SET ${fields.join(', ')} WHERE id = ?`).run(...params); }
    res.json({ ok: true, data: db.prepare('SELECT * FROM calyx_tags WHERE id = ?').get(id) });
  });

  router.delete('/tags/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM calyx_ticket_tags WHERE tag_id = ?').run(id);
    db.prepare('DELETE FROM calyx_tags WHERE id = ?').run(id);
    auditLog(db, { entityType: 'tag', entityId: id, action: 'deleted', actorType: 'agent', actorId: null, ipAddress: req.ip });
    res.json({ ok: true });
  });

  router.post('/tickets/:id/tags', (req, res) => {
    const ticketId = Number(req.params.id);
    const { tag_id } = req.body;
    if (!tag_id) { res.status(400).json({ ok: false, error: 'tag_id is required' }); return; }
    try {
      db.prepare('INSERT INTO calyx_ticket_tags (ticket_id, tag_id) VALUES (?, ?)').run(ticketId, tag_id);
      auditLog(db, { entityType: 'ticket', entityId: ticketId, action: 'tag_added', actorType: 'agent', actorId: req.body.agent_id ?? null, changes: { tag_id: { from: null, to: tag_id } }, ipAddress: req.ip });
      res.status(201).json({ ok: true });
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) { res.json({ ok: true }); return; }
      throw err;
    }
  });

  router.delete('/tickets/:id/tags/:tagId', (req, res) => {
    db.prepare('DELETE FROM calyx_ticket_tags WHERE ticket_id = ? AND tag_id = ?').run(Number(req.params.id), Number(req.params.tagId));
    res.json({ ok: true });
  });

  // ═══════════════════════════════════════════════════════════════════
  // WATCHERS
  // ═══════════════════════════════════════════════════════════════════

  router.get('/tickets/:id/watchers', (req, res) => {
    const watchers = db.prepare(`
      SELECT w.*, a.name as agent_name, a.email as agent_email
      FROM calyx_ticket_watchers w
      JOIN calyx_agents a ON a.id = w.agent_id
      WHERE w.ticket_id = ?
    `).all(Number(req.params.id));
    res.json({ ok: true, data: watchers });
  });

  router.post('/tickets/:id/watchers', (req, res) => {
    const ticketId = Number(req.params.id);
    const { agent_id } = req.body;
    if (!agent_id) { res.status(400).json({ ok: false, error: 'agent_id is required' }); return; }
    try {
      db.prepare('INSERT INTO calyx_ticket_watchers (ticket_id, agent_id) VALUES (?, ?)').run(ticketId, agent_id);
      auditLog(db, { entityType: 'ticket', entityId: ticketId, action: 'watcher_added', actorType: 'agent', actorId: agent_id, ipAddress: req.ip });
      res.status(201).json({ ok: true });
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) { res.json({ ok: true }); return; }
      throw err;
    }
  });

  router.delete('/tickets/:id/watchers/:agentId', (req, res) => {
    db.prepare('DELETE FROM calyx_ticket_watchers WHERE ticket_id = ? AND agent_id = ?').run(Number(req.params.id), Number(req.params.agentId));
    res.json({ ok: true });
  });

  // ═══════════════════════════════════════════════════════════════════
  // MERGE
  // ═══════════════════════════════════════════════════════════════════

  router.post('/tickets/:id/merge', (req, res) => {
    const sourceId = Number(req.params.id);
    const { target_id, reason } = req.body;
    if (!target_id) { res.status(400).json({ ok: false, error: 'target_id is required' }); return; }

    const source = db.prepare('SELECT * FROM calyx_tickets WHERE id = ?').get(sourceId) as any;
    if (!source) { res.status(404).json({ ok: false, error: 'Source ticket not found' }); return; }
    const target = db.prepare('SELECT * FROM calyx_tickets WHERE id = ?').get(target_id) as any;
    if (!target) { res.status(404).json({ ok: false, error: 'Target ticket not found' }); return; }

    db.transaction(() => {
      db.prepare("UPDATE calyx_tickets SET merged_into_id = ?, status = 'closed', updated_at = datetime('now') WHERE id = ?").run(target_id, sourceId);
      db.prepare('UPDATE calyx_ticket_comments SET ticket_id = ? WHERE ticket_id = ?').run(target_id, sourceId);
      db.prepare("INSERT INTO calyx_ticket_links (ticket_id, linked_ticket_id, link_type) VALUES (?, ?, 'merged_into')").run(sourceId, target_id);
      db.prepare("INSERT INTO calyx_ticket_events (ticket_id, event_type, to_value, note, created_at) VALUES (?, 'merged', ?, ?, datetime('now'))").run(sourceId, target.reference, reason ?? `Merged into ${target.reference}`);
      db.prepare("INSERT INTO calyx_ticket_events (ticket_id, event_type, to_value, note, created_at) VALUES (?, 'merge_received', ?, ?, datetime('now'))").run(target_id, source.reference, `Received merge from ${source.reference}`);
    })();

    auditLog(db, { entityType: 'ticket', entityId: sourceId, action: 'merged', actorType: 'agent', actorId: req.body.agent_id ?? null, changes: { merged_into: { from: null, to: target_id } }, ipAddress: req.ip });
    auditLog(db, { entityType: 'ticket', entityId: target_id, action: 'merge_received', actorType: 'agent', actorId: req.body.agent_id ?? null, changes: { merged_from: { from: null, to: sourceId } }, ipAddress: req.ip });

    res.json({ ok: true, data: { source_id: sourceId, target_id, source_reference: source.reference, target_reference: target.reference } });
  });

  // ═══════════════════════════════════════════════════════════════════
  // TICKET LINKS
  // ═══════════════════════════════════════════════════════════════════

  router.get('/tickets/:id/links', (req, res) => {
    const ticketId = Number(req.params.id);
    const links = db.prepare(`
      SELECT l.*, t.reference, t.title, t.status, t.priority
      FROM calyx_ticket_links l
      JOIN calyx_tickets t ON t.id = l.linked_ticket_id
      WHERE l.ticket_id = ?
      UNION ALL
      SELECT l.*, t.reference, t.title, t.status, t.priority
      FROM calyx_ticket_links l
      JOIN calyx_tickets t ON t.id = l.ticket_id
      WHERE l.linked_ticket_id = ?
    `).all(ticketId, ticketId);
    res.json({ ok: true, data: links });
  });

  router.post('/tickets/:id/link', (req, res) => {
    const ticketId = Number(req.params.id);
    const { linked_ticket_id, link_type } = req.body;
    if (!linked_ticket_id || !link_type) { res.status(400).json({ ok: false, error: 'linked_ticket_id and link_type are required' }); return; }
    db.prepare('INSERT INTO calyx_ticket_links (ticket_id, linked_ticket_id, link_type) VALUES (?, ?, ?)').run(ticketId, linked_ticket_id, link_type);
    auditLog(db, { entityType: 'ticket', entityId: ticketId, action: 'linked', actorType: 'agent', actorId: req.body.agent_id ?? null, changes: { linked_to: { from: null, to: linked_ticket_id } }, ipAddress: req.ip });
    res.status(201).json({ ok: true });
  });

  router.delete('/tickets/:id/links/:linkedTicketId', (req, res) => {
    const ticketId = Number(req.params.id);
    const linkedId = Number(req.params.linkedTicketId);
    db.prepare('DELETE FROM calyx_ticket_links WHERE (ticket_id = ? AND linked_ticket_id = ?) OR (ticket_id = ? AND linked_ticket_id = ?)').run(ticketId, linkedId, linkedId, ticketId);
    res.json({ ok: true });
  });

  // ═══════════════════════════════════════════════════════════════════
  // ESCALATE
  // ═══════════════════════════════════════════════════════════════════

  router.post('/tickets/:id/escalate', (req, res) => {
    const ticketId = Number(req.params.id);
    const { team_id, reason } = req.body;
    if (!team_id) { res.status(400).json({ ok: false, error: 'team_id is required' }); return; }

    const ticket = db.prepare('SELECT * FROM calyx_tickets WHERE id = ?').get(ticketId) as any;
    if (!ticket) { res.status(404).json({ ok: false, error: 'Ticket not found' }); return; }

    const targetTeam = db.prepare('SELECT * FROM calyx_teams WHERE id = ?').get(team_id) as any;
    if (!targetTeam) { res.status(404).json({ ok: false, error: 'Target team not found' }); return; }

    db.prepare("UPDATE calyx_tickets SET team_id = ?, assigned_agent_id = NULL, updated_at = datetime('now') WHERE id = ?").run(team_id, ticketId);
    db.prepare("INSERT INTO calyx_ticket_events (ticket_id, event_type, from_value, to_value, note, agent_id, created_at) VALUES (?, 'escalated', ?, ?, ?, ?, datetime('now'))").run(
      ticketId, String(ticket.team_id), String(team_id), reason ?? `Escalated to ${targetTeam.name}`, req.body.agent_id ?? null
    );

    // Determine escalation SLO type based on target team slug
    const sloTypeMap: Record<string, string> = { t2: 'escalated_t2', t3: 'escalated_t3', dev: 'escalated_dev' };
    const sloEvent = sloTypeMap[targetTeam.slug] as any;
    if (sloEvent) {
      completeSloOnEvent(db, ticketId, sloEvent);
    }

    // Queue escalation notification email
    db.prepare(`
      INSERT INTO calyx_email_queue (ticket_id, recipient_email, event_type, subject, body_html, status)
      VALUES (?, ?, 'escalation', ?, ?, 'pending')
    `).run(ticketId, ticket.requester_email, `Ticket ${ticket.reference} escalated`, `<p>Your ticket <b>${ticket.reference}</b> has been escalated to ${targetTeam.name}.</p>`);

    auditLog(db, { entityType: 'ticket', entityId: ticketId, action: 'escalated', actorType: 'agent', actorId: req.body.agent_id ?? null, changes: { team_id: { from: ticket.team_id, to: team_id } }, ipAddress: req.ip });
    const updated = db.prepare('SELECT * FROM calyx_tickets WHERE id = ?').get(ticketId);
    res.json({ ok: true, data: updated });
  });

  // ═══════════════════════════════════════════════════════════════════
  // DECLARE MAJOR INCIDENT
  // ═══════════════════════════════════════════════════════════════════

  router.post('/tickets/:id/declare-major', (req, res) => {
    const ticketId = Number(req.params.id);
    const { impact_statement, incident_commander_agent_id } = req.body;
    if (!impact_statement) { res.status(400).json({ ok: false, error: 'impact_statement is required' }); return; }

    const ticket = db.prepare('SELECT * FROM calyx_tickets WHERE id = ?').get(ticketId) as any;
    if (!ticket) { res.status(404).json({ ok: false, error: 'Ticket not found' }); return; }

    const result = db.prepare(
      'INSERT INTO calyx_major_incidents (ticket_id, impact_statement, incident_commander_agent_id) VALUES (?, ?, ?)'
    ).run(ticketId, impact_statement, incident_commander_agent_id ?? null);

    db.prepare('UPDATE calyx_tickets SET major_incident_id = ? WHERE id = ?').run(result.lastInsertRowid, ticketId);
    db.prepare("INSERT INTO calyx_ticket_events (ticket_id, event_type, to_value, created_at) VALUES (?, 'major_incident_declared', ?, datetime('now'))").run(ticketId, String(result.lastInsertRowid));

    const incident = db.prepare('SELECT * FROM calyx_major_incidents WHERE id = ?').get(result.lastInsertRowid) as any;
    emailOnDeclaredMajor(db, getSettings(), incident, ticket);

    auditLog(db, { entityType: 'major_incident', entityId: Number(result.lastInsertRowid), action: 'declared', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.status(201).json({ ok: true, data: incident });
  });

  // ═══════════════════════════════════════════════════════════════════
  // BULK ACTIONS
  // ═══════════════════════════════════════════════════════════════════

  router.post('/tickets/bulk', (req, res) => {
    const { ticket_ids, action, payload } = req.body;
    if (!ticket_ids?.length || !action) { res.status(400).json({ ok: false, error: 'ticket_ids and action are required' }); return; }

    let updated = 0;
    let failed = 0;

    db.transaction(() => {
      for (const id of ticket_ids) {
        try {
          const ticket = db.prepare('SELECT * FROM calyx_tickets WHERE id = ?').get(id) as any;
          if (!ticket) { failed++; continue; }

          switch (action) {
            case 'assign':
              db.prepare("UPDATE calyx_tickets SET assigned_agent_id = ?, updated_at = datetime('now') WHERE id = ?").run(payload.assigned_agent_id, id);
              if (payload.assigned_agent_id) completeSloOnEvent(db, id, 'assigned');
              break;
            case 'set_status':
              db.prepare("UPDATE calyx_tickets SET status = ?, updated_at = datetime('now') WHERE id = ?").run(payload.status, id);
              break;
            case 'set_priority':
              db.prepare("UPDATE calyx_tickets SET priority = ?, updated_at = datetime('now') WHERE id = ?").run(payload.priority, id);
              break;
            case 'add_tag':
              try { db.prepare('INSERT INTO calyx_ticket_tags (ticket_id, tag_id) VALUES (?, ?)').run(id, payload.tag_id); } catch { /* dup */ }
              break;
            case 'close':
              db.prepare("UPDATE calyx_tickets SET status = 'closed', updated_at = datetime('now') WHERE id = ?").run(id);
              completeSloOnEvent(db, id, 'closed');
              break;
            default:
              failed++;
              continue;
          }
          auditLog(db, { entityType: 'ticket', entityId: id, action: `bulk_${action}`, actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
          updated++;
        } catch {
          failed++;
        }
      }
    })();

    res.json({ ok: true, data: { updated, failed } });
  });

  // ═══════════════════════════════════════════════════════════════════
  // MAJOR INCIDENTS
  // ═══════════════════════════════════════════════════════════════════

  router.get('/major-incidents', (_req, res) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const rows = db.prepare(`
      SELECT mi.*, t.reference as ticket_reference, t.title as ticket_title
      FROM calyx_major_incidents mi
      JOIN calyx_tickets t ON t.id = mi.ticket_id
      WHERE mi.resolved_at IS NULL OR mi.created_at >= ?
      ORDER BY mi.created_at DESC
    `).all(thirtyDaysAgo);
    res.json({ ok: true, data: rows });
  });

  router.get('/major-incidents/:id', (req, res) => {
    const id = Number(req.params.id);
    const incident = db.prepare(`
      SELECT mi.*, t.reference as ticket_reference, t.title as ticket_title, t.status as ticket_status, t.priority as ticket_priority
      FROM calyx_major_incidents mi
      JOIN calyx_tickets t ON t.id = mi.ticket_id
      WHERE mi.id = ?
    `).get(id) as any;
    if (!incident) { res.status(404).json({ ok: false, error: 'Major incident not found' }); return; }
    res.json({ ok: true, data: incident });
  });

  router.patch('/major-incidents/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM calyx_major_incidents WHERE id = ?').get(id)) { res.status(404).json({ ok: false, error: 'Major incident not found' }); return; }
    if (req.body.impact_statement !== undefined) {
      db.prepare('UPDATE calyx_major_incidents SET impact_statement = ? WHERE id = ?').run(req.body.impact_statement, id);
    }
    auditLog(db, { entityType: 'major_incident', entityId: id, action: 'updated', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.json({ ok: true, data: db.prepare('SELECT * FROM calyx_major_incidents WHERE id = ?').get(id) });
  });

  router.post('/major-incidents/:id/comms', (req, res) => {
    const id = Number(req.params.id);
    const incident = db.prepare('SELECT * FROM calyx_major_incidents WHERE id = ?').get(id) as any;
    if (!incident) { res.status(404).json({ ok: false, error: 'Major incident not found' }); return; }
    const { message, sent_to } = req.body;
    if (!message) { res.status(400).json({ ok: false, error: 'message is required' }); return; }
    const comms = JSON.parse(incident.stakeholder_comms || '[]');
    comms.push({ message, sent_to: sent_to ?? null, sent_at: new Date().toISOString() });
    db.prepare('UPDATE calyx_major_incidents SET stakeholder_comms = ? WHERE id = ?').run(JSON.stringify(comms), id);

    const ticket = db.prepare('SELECT * FROM calyx_tickets WHERE id = ?').get(incident.ticket_id) as any;
    emailOnMajorComms(db, getSettings(), incident, ticket, message);

    auditLog(db, { entityType: 'major_incident', entityId: id, action: 'comms_added', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.json({ ok: true, data: db.prepare('SELECT * FROM calyx_major_incidents WHERE id = ?').get(id) });
  });

  router.post('/major-incidents/:id/resolve', (req, res) => {
    const id = Number(req.params.id);
    const incidentBefore = db.prepare('SELECT * FROM calyx_major_incidents WHERE id = ?').get(id) as any;
    if (!incidentBefore) { res.status(404).json({ ok: false, error: 'Major incident not found' }); return; }
    db.prepare("UPDATE calyx_major_incidents SET resolved_at = datetime('now') WHERE id = ?").run(id);

    const ticket = db.prepare('SELECT * FROM calyx_tickets WHERE id = ?').get(incidentBefore.ticket_id) as any;
    const updatedIncident = db.prepare('SELECT * FROM calyx_major_incidents WHERE id = ?').get(id) as any;
    emailOnMajorResolved(db, getSettings(), updatedIncident, ticket);

    auditLog(db, { entityType: 'major_incident', entityId: id, action: 'resolved', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.json({ ok: true, data: updatedIncident });
  });

  router.patch('/major-incidents/:id/pir', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM calyx_major_incidents WHERE id = ?').get(id)) { res.status(404).json({ ok: false, error: 'Major incident not found' }); return; }
    db.prepare("UPDATE calyx_major_incidents SET post_incident_review = ?, pir_completed_at = datetime('now') WHERE id = ?").run(req.body.review_text ?? null, id);
    auditLog(db, { entityType: 'major_incident', entityId: id, action: 'pir_completed', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.json({ ok: true, data: db.prepare('SELECT * FROM calyx_major_incidents WHERE id = ?').get(id) });
  });

  // ═══════════════════════════════════════════════════════════════════
  // CSAT / XLA
  // ═══════════════════════════════════════════════════════════════════

  router.post('/tickets/:id/send-csat', (req, res) => {
    const ticketId = Number(req.params.id);
    const ticket = db.prepare('SELECT * FROM calyx_tickets WHERE id = ?').get(ticketId) as any;
    if (!ticket) { res.status(404).json({ ok: false, error: 'Ticket not found' }); return; }

    const token = crypto.randomBytes(32).toString('hex');
    const requester = ticket.requester_id
      ? db.prepare('SELECT id FROM calyx_requesters WHERE id = ?').get(ticket.requester_id) as any
      : null;

    db.prepare(
      'INSERT INTO calyx_csat_surveys (ticket_id, requester_id, survey_token) VALUES (?, ?, ?)'
    ).run(ticketId, requester?.id ?? null, token);

    emailOnCsat(db, getSettings(), ticket, token);

    auditLog(db, { entityType: 'csat_survey', entityId: ticketId, action: 'sent', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.status(201).json({ ok: true, data: { token, ticket_id: ticketId } });
  });

  router.get('/reports/csat', (req, res) => {
    const conds: string[] = []; const params: unknown[] = [];
    if (req.query.from) { conds.push('s.created_at >= ?'); params.push(req.query.from); }
    if (req.query.to) { conds.push('s.created_at <= ?'); params.push(req.query.to); }
    if (req.query.team_id) { conds.push('t.team_id = ?'); params.push(Number(req.query.team_id)); }
    if (req.query.agent_id) { conds.push('t.assigned_agent_id = ?'); params.push(Number(req.query.agent_id)); }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_sent,
        COUNT(s.responded_at) as total_responded,
        AVG(s.csat_score) as avg_csat,
        AVG(s.xla_score) as avg_xla,
        AVG(s.effort_score) as avg_effort
      FROM calyx_csat_surveys s
      JOIN calyx_tickets t ON t.id = s.ticket_id
      ${where}
    `).get(...params) as any;

    const perAgent = db.prepare(`
      SELECT a.id, a.name, AVG(s.csat_score) as avg_csat, COUNT(s.responded_at) as responses
      FROM calyx_csat_surveys s
      JOIN calyx_tickets t ON t.id = s.ticket_id
      JOIN calyx_agents a ON a.id = t.assigned_agent_id
      ${where} ${where ? 'AND' : 'WHERE'} s.csat_score IS NOT NULL
      GROUP BY a.id
    `).all(...params);

    res.json({
      ok: true,
      data: {
        avg_csat: stats.avg_csat ? Math.round(stats.avg_csat * 10) / 10 : null,
        avg_xla: stats.avg_xla ? Math.round(stats.avg_xla * 10) / 10 : null,
        avg_effort: stats.avg_effort ? Math.round(stats.avg_effort * 10) / 10 : null,
        response_rate: stats.total_sent > 0 ? Math.round((stats.total_responded / stats.total_sent) * 1000) / 10 : 0,
        total_sent: stats.total_sent,
        total_responded: stats.total_responded,
        per_agent: perAgent,
      },
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // SERVICE CATALOGUE
  // ═══════════════════════════════════════════════════════════════════

  router.get('/catalogue', (_req, res) => {
    res.json({ ok: true, data: db.prepare('SELECT * FROM calyx_service_catalogue WHERE is_active = 1 ORDER BY name').all() });
  });

  router.post('/catalogue', (req, res) => {
    const { name, description, team_id, category_id, sla_policy_id, slo_ids, request_form_schema, icon } = req.body;
    if (!name) { res.status(400).json({ ok: false, error: 'name is required' }); return; }
    const result = db.prepare(
      'INSERT INTO calyx_service_catalogue (name, description, team_id, category_id, sla_policy_id, slo_ids, request_form_schema, icon) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(name, description ?? null, team_id ?? null, category_id ?? null, sla_policy_id ?? null, JSON.stringify(slo_ids ?? []), JSON.stringify(request_form_schema ?? []), icon ?? null);
    const item = db.prepare('SELECT * FROM calyx_service_catalogue WHERE id = ?').get(result.lastInsertRowid);
    auditLog(db, { entityType: 'service_catalogue', entityId: Number(result.lastInsertRowid), action: 'created', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.status(201).json({ ok: true, data: item });
  });

  router.patch('/catalogue/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM calyx_service_catalogue WHERE id = ?').get(id)) { res.status(404).json({ ok: false, error: 'Service not found' }); return; }
    const fields: string[] = []; const params: unknown[] = [];
    for (const k of ['name', 'description', 'team_id', 'category_id', 'sla_policy_id', 'icon', 'is_active']) {
      if (req.body[k] !== undefined) { fields.push(`${k} = ?`); params.push(req.body[k]); }
    }
    if (req.body.slo_ids !== undefined) { fields.push('slo_ids = ?'); params.push(JSON.stringify(req.body.slo_ids)); }
    if (req.body.request_form_schema !== undefined) { fields.push('request_form_schema = ?'); params.push(JSON.stringify(req.body.request_form_schema)); }
    if (fields.length) { params.push(id); db.prepare(`UPDATE calyx_service_catalogue SET ${fields.join(', ')} WHERE id = ?`).run(...params); }
    auditLog(db, { entityType: 'service_catalogue', entityId: id, action: 'updated', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.json({ ok: true, data: db.prepare('SELECT * FROM calyx_service_catalogue WHERE id = ?').get(id) });
  });

  router.delete('/catalogue/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('UPDATE calyx_service_catalogue SET is_active = 0 WHERE id = ?').run(id);
    auditLog(db, { entityType: 'service_catalogue', entityId: id, action: 'deactivated', actorType: 'agent', actorId: null, ipAddress: req.ip });
    res.json({ ok: true });
  });

  router.get('/catalogue/:id', (req, res) => {
    const item = db.prepare('SELECT * FROM calyx_service_catalogue WHERE id = ?').get(Number(req.params.id));
    if (!item) { res.status(404).json({ ok: false, error: 'Service not found' }); return; }
    res.json({ ok: true, data: item });
  });

  // ═══════════════════════════════════════════════════════════════════
  // SUPPLIERS
  // ═══════════════════════════════════════════════════════════════════

  router.get('/suppliers', (_req, res) => {
    res.json({ ok: true, data: db.prepare('SELECT * FROM calyx_suppliers ORDER BY name').all() });
  });

  router.post('/suppliers', (req, res) => {
    const { name, type, contact_name, contact_email, sla_description, notes } = req.body;
    if (!name) { res.status(400).json({ ok: false, error: 'name is required' }); return; }
    const result = db.prepare(
      'INSERT INTO calyx_suppliers (name, type, contact_name, contact_email, sla_description, notes) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, type ?? null, contact_name ?? null, contact_email ?? null, sla_description ?? null, notes ?? null);
    const supplier = db.prepare('SELECT * FROM calyx_suppliers WHERE id = ?').get(result.lastInsertRowid);
    auditLog(db, { entityType: 'supplier', entityId: Number(result.lastInsertRowid), action: 'created', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.status(201).json({ ok: true, data: supplier });
  });

  router.patch('/suppliers/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM calyx_suppliers WHERE id = ?').get(id)) { res.status(404).json({ ok: false, error: 'Supplier not found' }); return; }
    const fields: string[] = []; const params: unknown[] = [];
    for (const k of ['name', 'type', 'contact_name', 'contact_email', 'sla_description', 'notes']) {
      if (req.body[k] !== undefined) { fields.push(`${k} = ?`); params.push(req.body[k]); }
    }
    if (fields.length) { params.push(id); db.prepare(`UPDATE calyx_suppliers SET ${fields.join(', ')} WHERE id = ?`).run(...params); }
    auditLog(db, { entityType: 'supplier', entityId: id, action: 'updated', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.json({ ok: true, data: db.prepare('SELECT * FROM calyx_suppliers WHERE id = ?').get(id) });
  });

  router.get('/suppliers/:id/tickets', (req, res) => {
    const tickets = db.prepare('SELECT * FROM calyx_tickets WHERE supplier_id = ? ORDER BY created_at DESC').all(Number(req.params.id));
    res.json({ ok: true, data: tickets });
  });

  // ═══════════════════════════════════════════════════════════════════
  // CONTINUAL IMPROVEMENT REGISTER
  // ═══════════════════════════════════════════════════════════════════

  router.get('/improvements', (req, res) => {
    let sql = 'SELECT * FROM calyx_improvements'; const params: unknown[] = [];
    if (req.query.status) { sql += ' WHERE status = ?'; params.push(req.query.status); }
    sql += ' ORDER BY created_at DESC';
    res.json({ ok: true, data: db.prepare(sql).all(...params) });
  });

  router.post('/improvements', (req, res) => {
    const { title, description, source, source_id, owner_agent_id, due_date } = req.body;
    if (!title) { res.status(400).json({ ok: false, error: 'title is required' }); return; }
    const reference = nextReference(db, 'calyx_improvements', 'CIR');
    const result = db.prepare(
      'INSERT INTO calyx_improvements (reference, title, description, source, source_id, owner_agent_id, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(reference, title, description ?? null, source ?? 'manual', source_id ?? null, owner_agent_id ?? null, due_date ?? null);
    const improvement = db.prepare('SELECT * FROM calyx_improvements WHERE id = ?').get(result.lastInsertRowid);
    auditLog(db, { entityType: 'improvement', entityId: Number(result.lastInsertRowid), action: 'created', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.status(201).json({ ok: true, data: improvement });
  });

  router.patch('/improvements/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM calyx_improvements WHERE id = ?').get(id)) { res.status(404).json({ ok: false, error: 'Improvement not found' }); return; }
    const fields: string[] = ['updated_at = datetime(\'now\')']; const params: unknown[] = [];
    for (const k of ['title', 'description', 'status', 'owner_agent_id', 'due_date', 'outcome']) {
      if (req.body[k] !== undefined) { fields.push(`${k} = ?`); params.push(req.body[k]); }
    }
    params.push(id);
    db.prepare(`UPDATE calyx_improvements SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    auditLog(db, { entityType: 'improvement', entityId: id, action: 'updated', actorType: 'agent', actorId: req.body.agent_id ?? null, ipAddress: req.ip });
    res.json({ ok: true, data: db.prepare('SELECT * FROM calyx_improvements WHERE id = ?').get(id) });
  });

  // ═══════════════════════════════════════════════════════════════════
  // PLAYLIST MODE
  // ═══════════════════════════════════════════════════════════════════

  router.get('/my-queue', (req, res) => {
    const user = (req as any).user;
    if (!user) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }

    const agent = db.prepare('SELECT id FROM calyx_agents WHERE email = ?').get(user.email ?? '') as any;
    if (!agent) { res.json({ ok: true, data: null }); return; }

    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const skipped = db.prepare(`
      SELECT DISTINCT CAST(to_value AS INTEGER) as ticket_id
      FROM calyx_ticket_events
      WHERE event_type = 'skipped' AND agent_id = ? AND created_at >= ?
    `).all(agent.id, thirtyMinsAgo).map((r: any) => r.ticket_id);

    let sql = `
      SELECT t.*, COALESCE(t.resolution_due_at, '9999-12-31') as sla_sort
      FROM calyx_tickets t
      WHERE t.assigned_agent_id = ? AND t.status NOT IN ('resolved', 'closed')
    `;
    const params: unknown[] = [agent.id];

    if (skipped.length) {
      sql += ` AND t.id NOT IN (${skipped.map(() => '?').join(',')})`;
      params.push(...skipped);
    }

    sql += ` ORDER BY CASE t.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 END, sla_sort ASC LIMIT 1`;

    const next = db.prepare(sql).get(...params);
    res.json({ ok: true, data: next ?? null });
  });

  router.post('/tickets/:id/skip', (req, res) => {
    const ticketId = Number(req.params.id);
    const user = (req as any).user;
    const agent = user ? db.prepare('SELECT id FROM calyx_agents WHERE email = ?').get(user.email ?? '') as any : null;
    const agentId = agent?.id ?? null;
    const { reason } = req.body;

    db.prepare("INSERT INTO calyx_ticket_events (ticket_id, event_type, to_value, note, agent_id, created_at) VALUES (?, 'skipped', ?, ?, ?, datetime('now'))").run(
      ticketId, String(ticketId), reason ?? null, agentId
    );

    // Return next ticket
    if (agentId) {
      const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const skipped = db.prepare(`
        SELECT DISTINCT CAST(to_value AS INTEGER) as ticket_id
        FROM calyx_ticket_events
        WHERE event_type = 'skipped' AND agent_id = ? AND created_at >= ?
      `).all(agentId, thirtyMinsAgo).map((r: any) => r.ticket_id);

      let sql = `
        SELECT t.*, COALESCE(t.resolution_due_at, '9999-12-31') as sla_sort
        FROM calyx_tickets t
        WHERE t.assigned_agent_id = ? AND t.status NOT IN ('resolved', 'closed')
      `;
      const params: unknown[] = [agentId];
      if (skipped.length) {
        sql += ` AND t.id NOT IN (${skipped.map(() => '?').join(',')})`;
        params.push(...skipped);
      }
      sql += ` ORDER BY CASE t.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 END, sla_sort ASC LIMIT 1`;

      const next = db.prepare(sql).get(...params);
      res.json({ ok: true, data: next ?? null });
    } else {
      res.json({ ok: true, data: null });
    }
  });

  router.get('/my-queue/stats', (req, res) => {
    const user = (req as any).user;
    if (!user) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }

    const agent = db.prepare('SELECT id FROM calyx_agents WHERE email = ?').get(user.email ?? '') as any;
    if (!agent) { res.json({ ok: true, data: { total: 0, actioned_today: 0, skipped_today: 0 } }); return; }

    const total = db.prepare("SELECT COUNT(*) as c FROM calyx_tickets WHERE assigned_agent_id = ? AND status NOT IN ('resolved','closed')").get(agent.id) as any;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayStr = todayStart.toISOString();
    const actioned = db.prepare("SELECT COUNT(DISTINCT ticket_id) as c FROM calyx_ticket_events WHERE agent_id = ? AND event_type IN ('status_change','comment_added','assignment_change') AND created_at >= ?").get(agent.id, todayStr) as any;
    const skippedToday = db.prepare("SELECT COUNT(*) as c FROM calyx_ticket_events WHERE agent_id = ? AND event_type = 'skipped' AND created_at >= ?").get(agent.id, todayStr) as any;

    res.json({ ok: true, data: { total: total.c, actioned_today: actioned.c, skipped_today: skippedToday.c } });
  });

  return router;
}
