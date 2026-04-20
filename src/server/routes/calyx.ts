import { Router } from 'express';
import type { CalyxQueries } from '../db/calyx-queries.js';
import type { TicketFilters, TicketPriority, TicketStatus } from '../../shared/calyx-types.js';
import { auditLog } from '../db/calyx-db.js';
import { startSlosForTicket, completeSloOnEvent, pauseSlos, resumeSlos } from '../services/calyx-slo-engine.js';
import { minutesToHuman } from '../utils/calyx-business-hours.js';
import {
  emailOnTicketCreated, emailOnFirstReply, emailOnResolved,
  emailOnStatusWaiting, emailOnAssigned, emailOnStatusChange,
} from './calyx-phase5.js';
import type Database from 'better-sqlite3';

const WAITING_STATUSES: TicketStatus[] = ['waiting_customer', 'waiting_third_party'];

export function createCalyxRoutes(queries: CalyxQueries, db: Database.Database, getSettings: () => Record<string, string>): Router {
  const router = Router();

  // ── Teams ──

  router.get('/teams', (_req, res) => {
    res.json(queries.listTeams());
  });

  // ── Categories ──

  router.get('/categories', (req, res) => {
    const flat = req.query.flat === 'true';
    res.json(flat ? queries.listCategoriesFlat() : queries.listCategories());
  });

  // ── Agents ──

  router.get('/agents', (_req, res) => {
    res.json(queries.listAgents());
  });

  // ── SLA Policies ──

  router.get('/sla-policies', (_req, res) => {
    res.json(queries.listSlaPolicies());
  });

  router.post('/sla-policies', (req, res) => {
    try {
      const policy = queries.createSlaPolicy(req.body);
      res.status(201).json(policy);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create SLA policy' });
    }
  });

  // ── Tickets ──

  router.get('/tickets', (req, res) => {
    const filters: TicketFilters = {};
    if (req.query.team_id) filters.team_id = Number(req.query.team_id);
    if (req.query.status) filters.status = req.query.status as TicketStatus;
    if (req.query.priority) filters.priority = req.query.priority as TicketPriority;
    if (req.query.assigned_agent_id) filters.assigned_agent_id = Number(req.query.assigned_agent_id);
    if (req.query.sla_breached === 'true') filters.sla_breached = true;

    res.json(queries.listTickets(filters));
  });

  router.post('/tickets', (req, res) => {
    try {
      const { title, description, team_id, category_id, subcategory_id, item_id, priority, assigned_agent_id, requester_name, requester_email } = req.body;
      if (!title || !team_id || !priority || !requester_name || !requester_email) {
        res.status(400).json({ error: 'Missing required fields: title, team_id, priority, requester_name, requester_email' });
        return;
      }
      const ticket = queries.createTicket({
        title, description: description ?? '', team_id, category_id, subcategory_id, item_id,
        priority, assigned_agent_id, requester_name, requester_email,
      });

      startSlosForTicket(db, ticket.id);

      auditLog(db, {
        entityType: 'ticket',
        entityId: ticket.id,
        action: 'created',
        actorType: 'agent',
        actorId: req.body.agent_id ?? null,
        ipAddress: req.ip,
      });

      emailOnTicketCreated(db, getSettings(), ticket);

      res.status(201).json(ticket);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create ticket' });
    }
  });

  router.get('/tickets/:id', (req, res) => {
    const ticket = queries.getTicket(Number(req.params.id));
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    const events = queries.getTicketEvents(ticket.id);
    const comments = queries.getTicketComments(ticket.id);
    res.json({ ...ticket, events, comments });
  });

  router.patch('/tickets/:id', (req, res) => {
    const id = Number(req.params.id);
    const before = queries.getTicket(id);
    if (!before) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }

    const updated = queries.updateTicket(id, req.body, req.body.agent_id);
    if (!updated) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }

    const settings = getSettings();

    // SLO: assignment
    if (req.body.assigned_agent_id !== undefined && req.body.assigned_agent_id !== before.assigned_agent_id && req.body.assigned_agent_id !== null) {
      completeSloOnEvent(db, id, 'assigned');
      const agent = db.prepare('SELECT name, email FROM calyx_agents WHERE id = ?').get(req.body.assigned_agent_id) as any;
      if (agent) {
        emailOnAssigned(db, settings, updated, agent.name, agent.email);
      }
    }

    // SLO: status transitions
    if (req.body.status && req.body.status !== before.status) {
      const newStatus = req.body.status as TicketStatus;
      const wasWaiting = WAITING_STATUSES.includes(before.status as TicketStatus);
      const goingWaiting = WAITING_STATUSES.includes(newStatus);

      if (goingWaiting && !wasWaiting) {
        pauseSlos(db, id);
        emailOnStatusWaiting(db, settings, updated);
      }
      if (wasWaiting && !goingWaiting) {
        resumeSlos(db, id);
      }
      if (newStatus === 'resolved') {
        completeSloOnEvent(db, id, 'resolved');
        emailOnResolved(db, settings, updated);
      }
      if (newStatus === 'closed') {
        completeSloOnEvent(db, id, 'closed');
      }

      emailOnStatusChange(db, settings, updated);
    }

    // Audit
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (req.body.status && req.body.status !== before.status) {
      changes.status = { from: before.status, to: req.body.status };
    }
    if (req.body.priority && req.body.priority !== before.priority) {
      changes.priority = { from: before.priority, to: req.body.priority };
    }
    if (req.body.assigned_agent_id !== undefined && req.body.assigned_agent_id !== before.assigned_agent_id) {
      changes.assigned_agent_id = { from: before.assigned_agent_id, to: req.body.assigned_agent_id };
    }
    if (req.body.category_id !== undefined && req.body.category_id !== before.category_id) {
      changes.category_id = { from: before.category_id, to: req.body.category_id };
    }

    auditLog(db, {
      entityType: 'ticket',
      entityId: id,
      action: 'updated',
      actorType: 'agent',
      actorId: req.body.agent_id ?? null,
      changes: Object.keys(changes).length > 0 ? changes : undefined,
      ipAddress: req.ip,
    });

    res.json(updated);
  });

  router.post('/tickets/:id/comments', (req, res) => {
    try {
      const { body, is_internal, agent_id } = req.body;
      if (!body) {
        res.status(400).json({ error: 'Comment body is required' });
        return;
      }

      const ticketId = Number(req.params.id);

      // Check if this is the first public comment (for SLO)
      const ticketBefore = db.prepare('SELECT first_replied_at, status FROM calyx_tickets WHERE id = ?').get(ticketId) as any;
      const wasFirstReply = ticketBefore && !ticketBefore.first_replied_at && !is_internal;

      const comment = queries.addComment(ticketId, { body, is_internal, agent_id });

      if (wasFirstReply) {
        completeSloOnEvent(db, ticketId, 'first_comment');
        const ticketAfter = db.prepare('SELECT * FROM calyx_tickets WHERE id = ?').get(ticketId) as any;
        if (ticketAfter) {
          emailOnFirstReply(db, getSettings(), ticketAfter, body);
        }
      }

      // If ticket was in waiting state and agent posts a comment, resume SLOs
      if (ticketBefore && WAITING_STATUSES.includes(ticketBefore.status) && agent_id && !is_internal) {
        resumeSlos(db, ticketId);
      }

      res.status(201).json(comment);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to add comment' });
    }
  });

  // ── Ticket Tags (read) ──

  router.get('/tickets/:id/tags', (req, res) => {
    const tags = db.prepare(`
      SELECT tg.* FROM calyx_tags tg
      JOIN calyx_ticket_tags tt ON tt.tag_id = tg.id
      WHERE tt.ticket_id = ?
      ORDER BY tg.name
    `).all(Number(req.params.id));
    res.json({ ok: true, data: tags });
  });

  // ── Ticket SLO Tracking ──

  router.get('/tickets/:id/slos', (req, res) => {
    const rows = db.prepare(`
      SELECT t.*, s.name as slo_name, s.metric_type, s.target_minutes
      FROM calyx_ticket_slo_tracking t
      JOIN calyx_slos s ON s.id = t.slo_id
      WHERE t.ticket_id = ?
      ORDER BY t.created_at ASC
    `).all(Number(req.params.id));
    res.json({ ok: true, data: rows });
  });

  router.post('/tickets/:id/slos/:sloId/complete', (req, res) => {
    const ticketId = Number(req.params.id);
    const sloId = Number(req.params.sloId);

    const result = db.prepare(`
      UPDATE calyx_ticket_slo_tracking SET completed_at = datetime('now')
      WHERE ticket_id = ? AND slo_id = ? AND completed_at IS NULL
    `).run(ticketId, sloId);

    if (result.changes === 0) {
      res.status(404).json({ ok: false, error: 'No active SLO tracking found' });
      return;
    }

    auditLog(db, {
      entityType: 'ticket_slo',
      entityId: ticketId,
      action: 'slo_manually_completed',
      actorType: 'agent',
      actorId: req.body.agent_id ?? null,
      changes: { slo_id: { from: null, to: sloId } },
      ipAddress: req.ip,
    });

    res.json({ ok: true });
  });

  // ── SLOs ──

  router.get('/slos', (_req, res) => {
    const slos = db.prepare('SELECT * FROM calyx_slos ORDER BY name').all() as any[];

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const result = slos.map(slo => {
      const stats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN breached = 0 THEN 1 ELSE 0 END) as met,
          AVG(CASE WHEN breached = 1 THEN breach_minutes ELSE NULL END) as avg_breach_mins
        FROM calyx_ticket_slo_tracking
        WHERE slo_id = ? AND created_at >= ?
      `).get(slo.id, thirtyDaysAgo) as any;

      return {
        ...slo,
        target_human: minutesToHuman(slo.target_minutes),
        compliance_30d: {
          total: stats.total || 0,
          met: stats.met || 0,
          compliance_pct: stats.total > 0 ? Math.round((stats.met / stats.total) * 1000) / 10 : 100,
          avg_breach_mins: stats.avg_breach_mins ? Math.round(stats.avg_breach_mins) : null,
        },
      };
    });

    res.json({ ok: true, data: result });
  });

  router.post('/slos', (req, res) => {
    try {
      const { name, description, metric_type, target_minutes, warning_threshold_pct, applies_to_team_id, applies_to_priority, applies_to_category_id, business_hours_only } = req.body;
      if (!name || !metric_type || !target_minutes) {
        res.status(400).json({ ok: false, error: 'Missing required fields: name, metric_type, target_minutes' });
        return;
      }

      const result = db.prepare(`
        INSERT INTO calyx_slos (name, description, metric_type, target_minutes, warning_threshold_pct, applies_to_team_id, applies_to_priority, applies_to_category_id, business_hours_only)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name, description ?? null, metric_type, target_minutes,
        warning_threshold_pct ?? 80, applies_to_team_id ?? null,
        applies_to_priority ?? null, applies_to_category_id ?? null,
        business_hours_only ? 1 : 0
      );

      const slo = db.prepare('SELECT * FROM calyx_slos WHERE id = ?').get(result.lastInsertRowid);

      auditLog(db, {
        entityType: 'slo',
        entityId: Number(result.lastInsertRowid),
        action: 'created',
        actorType: 'agent',
        actorId: req.body.agent_id ?? null,
        ipAddress: req.ip,
      });

      res.status(201).json({ ok: true, data: slo });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to create SLO' });
    }
  });

  router.patch('/slos/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM calyx_slos WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ ok: false, error: 'SLO not found' });
      return;
    }

    const fields: string[] = [];
    const params: unknown[] = [];

    for (const key of ['name', 'description', 'metric_type', 'target_minutes', 'warning_threshold_pct', 'applies_to_team_id', 'applies_to_priority', 'applies_to_category_id', 'business_hours_only', 'is_active']) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(req.body[key]);
      }
    }

    if (fields.length === 0) {
      res.json({ ok: true, data: existing });
      return;
    }

    params.push(id);
    db.prepare(`UPDATE calyx_slos SET ${fields.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM calyx_slos WHERE id = ?').get(id);

    auditLog(db, {
      entityType: 'slo',
      entityId: id,
      action: 'updated',
      actorType: 'agent',
      actorId: req.body.agent_id ?? null,
      ipAddress: req.ip,
    });

    res.json({ ok: true, data: updated });
  });

  router.delete('/slos/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('UPDATE calyx_slos SET is_active = 0 WHERE id = ?').run(id);

    auditLog(db, {
      entityType: 'slo',
      entityId: id,
      action: 'deactivated',
      actorType: 'agent',
      actorId: req.body.agent_id ?? null,
      ipAddress: req.ip,
    });

    res.json({ ok: true });
  });

  // ── Business Hours ──

  router.get('/business-hours', (_req, res) => {
    const profiles = db.prepare('SELECT * FROM calyx_business_hours ORDER BY id').all() as any[];
    const result = profiles.map(p => {
      const holidays = db.prepare(
        'SELECT * FROM calyx_business_hours_holidays WHERE business_hours_id = ? ORDER BY date'
      ).all(p.id);
      return { ...p, holidays };
    });
    res.json({ ok: true, data: result });
  });

  router.post('/business-hours', (req, res) => {
    try {
      const b = req.body;
      const result = db.prepare(`
        INSERT INTO calyx_business_hours (name, timezone,
          mon_start, mon_end, mon_enabled, tue_start, tue_end, tue_enabled,
          wed_start, wed_end, wed_enabled, thu_start, thu_end, thu_enabled,
          fri_start, fri_end, fri_enabled, sat_start, sat_end, sat_enabled,
          sun_start, sun_end, sun_enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        b.name, b.timezone ?? 'Europe/London',
        b.mon_start ?? '08:00', b.mon_end ?? '18:00', b.mon_enabled ?? 1,
        b.tue_start ?? '08:00', b.tue_end ?? '18:00', b.tue_enabled ?? 1,
        b.wed_start ?? '08:00', b.wed_end ?? '18:00', b.wed_enabled ?? 1,
        b.thu_start ?? '08:00', b.thu_end ?? '18:00', b.thu_enabled ?? 1,
        b.fri_start ?? '08:00', b.fri_end ?? '18:00', b.fri_enabled ?? 1,
        b.sat_start ?? null, b.sat_end ?? null, b.sat_enabled ?? 0,
        b.sun_start ?? null, b.sun_end ?? null, b.sun_enabled ?? 0,
      );

      const profile = db.prepare('SELECT * FROM calyx_business_hours WHERE id = ?').get(result.lastInsertRowid);

      auditLog(db, {
        entityType: 'business_hours',
        entityId: Number(result.lastInsertRowid),
        action: 'created',
        actorType: 'agent',
        actorId: req.body.agent_id ?? null,
        ipAddress: req.ip,
      });

      res.status(201).json({ ok: true, data: profile });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to create profile' });
    }
  });

  router.patch('/business-hours/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM calyx_business_hours WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ ok: false, error: 'Business hours profile not found' });
      return;
    }

    const fields: string[] = [];
    const params: unknown[] = [];
    const allowed = ['name', 'timezone', 'mon_start', 'mon_end', 'mon_enabled', 'tue_start', 'tue_end', 'tue_enabled', 'wed_start', 'wed_end', 'wed_enabled', 'thu_start', 'thu_end', 'thu_enabled', 'fri_start', 'fri_end', 'fri_enabled', 'sat_start', 'sat_end', 'sat_enabled', 'sun_start', 'sun_end', 'sun_enabled'];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(req.body[key]);
      }
    }

    if (fields.length === 0) {
      res.json({ ok: true, data: existing });
      return;
    }

    params.push(id);
    db.prepare(`UPDATE calyx_business_hours SET ${fields.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM calyx_business_hours WHERE id = ?').get(id);
    res.json({ ok: true, data: updated });
  });

  router.post('/business-hours/:id/holidays', (req, res) => {
    try {
      const bhId = Number(req.params.id);
      const { date, name } = req.body;
      if (!date || !name) {
        res.status(400).json({ ok: false, error: 'Missing required fields: date, name' });
        return;
      }

      const result = db.prepare(
        'INSERT INTO calyx_business_hours_holidays (business_hours_id, date, name) VALUES (?, ?, ?)'
      ).run(bhId, date, name);

      const holiday = db.prepare('SELECT * FROM calyx_business_hours_holidays WHERE id = ?').get(result.lastInsertRowid);
      res.status(201).json({ ok: true, data: holiday });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to add holiday' });
    }
  });

  router.delete('/business-hours/:bhId/holidays/:holidayId', (req, res) => {
    db.prepare('DELETE FROM calyx_business_hours_holidays WHERE id = ? AND business_hours_id = ?')
      .run(Number(req.params.holidayId), Number(req.params.bhId));
    res.json({ ok: true });
  });

  // ── Audit Log ──

  router.get('/audit', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (req.query.entity_type) {
      conditions.push('a.entity_type = ?');
      params.push(req.query.entity_type);
    }
    if (req.query.entity_id) {
      conditions.push('a.entity_id = ?');
      params.push(Number(req.query.entity_id));
    }
    if (req.query.actor_id) {
      conditions.push('a.actor_id = ?');
      params.push(Number(req.query.actor_id));
    }

    let sql = `
      SELECT a.*,
        CASE a.actor_type
          WHEN 'agent' THEN ag.name
          WHEN 'requester' THEN r.name
          ELSE NULL
        END as actor_name
      FROM calyx_audit_log a
      LEFT JOIN calyx_agents ag ON a.actor_type = 'agent' AND ag.id = a.actor_id
      LEFT JOIN calyx_requesters r ON a.actor_type = 'requester' AND r.id = a.actor_id
    `;

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY a.created_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    res.json({ ok: true, data: rows });
  });

  return router;
}
