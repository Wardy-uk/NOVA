import type Database from 'better-sqlite3';
import type {
  CalyxTicket, CalyxTeam, CalyxCategory, CalyxAgent, CalyxSlaPolicy,
  CalyxTicketEvent, CalyxComment,
  CreateTicketPayload, UpdateTicketPayload, CreateCommentPayload,
  CreateSlaPolicyPayload, TicketFilters, TicketStatus,
} from '../../shared/calyx-types.js';
import { addBusinessMinutes, toSqliteDatetime } from '../utils/business-hours.js';

export class CalyxQueries {
  constructor(private db: Database.Database) {}

  // ── Teams ──

  listTeams(): CalyxTeam[] {
    return this.db.prepare('SELECT * FROM calyx_teams ORDER BY id').all() as CalyxTeam[];
  }

  // ── Categories ──

  listCategories(): CalyxCategory[] {
    const rows = this.db.prepare('SELECT * FROM calyx_categories ORDER BY team_id, level, name').all() as CalyxCategory[];
    return this.buildCategoryTree(rows);
  }

  listCategoriesFlat(): CalyxCategory[] {
    return this.db.prepare('SELECT * FROM calyx_categories ORDER BY team_id, level, name').all() as CalyxCategory[];
  }

  private buildCategoryTree(rows: CalyxCategory[]): CalyxCategory[] {
    const map = new Map<number, CalyxCategory>();
    const roots: CalyxCategory[] = [];

    for (const row of rows) {
      map.set(row.id, { ...row, children: [] });
    }

    for (const row of rows) {
      const node = map.get(row.id)!;
      if (row.parent_id && map.has(row.parent_id)) {
        map.get(row.parent_id)!.children!.push(node);
      } else if (!row.parent_id) {
        roots.push(node);
      }
    }

    return roots;
  }

  // ── Agents ──

  listAgents(): CalyxAgent[] {
    return this.db.prepare(`
      SELECT a.*, t.name as team_name
      FROM calyx_agents a
      JOIN calyx_teams t ON t.id = a.team_id
      WHERE a.is_active = 1
      ORDER BY a.name
    `).all() as CalyxAgent[];
  }

  // ── SLA Policies ──

  listSlaPolicies(): CalyxSlaPolicy[] {
    return this.db.prepare('SELECT * FROM calyx_sla_policies ORDER BY position, priority').all() as CalyxSlaPolicy[];
  }

  findSlaPolicy(priority: string, teamId?: number, categoryId?: number | null): CalyxSlaPolicy | undefined {
    if (categoryId && teamId) {
      const specific = this.db.prepare(
        'SELECT * FROM calyx_sla_policies WHERE priority = ? AND team_id = ? AND category_id = ? LIMIT 1'
      ).get(priority, teamId, categoryId) as CalyxSlaPolicy | undefined;
      if (specific) return specific;
    }

    if (teamId) {
      const teamMatch = this.db.prepare(
        'SELECT * FROM calyx_sla_policies WHERE priority = ? AND team_id = ? AND category_id IS NULL LIMIT 1'
      ).get(priority, teamId) as CalyxSlaPolicy | undefined;
      if (teamMatch) return teamMatch;
    }

    return this.db.prepare(
      'SELECT * FROM calyx_sla_policies WHERE priority = ? AND team_id IS NULL AND category_id IS NULL LIMIT 1'
    ).get(priority) as CalyxSlaPolicy | undefined;
  }

  createSlaPolicy(payload: CreateSlaPolicyPayload): CalyxSlaPolicy {
    const result = this.db.prepare(`
      INSERT INTO calyx_sla_policies (name, team_id, category_id, priority, frt_minutes, resolution_minutes, business_hours_only, pause_on_waiting, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.name,
      payload.team_id ?? null,
      payload.category_id ?? null,
      payload.priority,
      payload.frt_minutes,
      payload.resolution_minutes,
      payload.business_hours_only !== false ? 1 : 0,
      payload.pause_on_waiting !== false ? 1 : 0,
      payload.position ?? 0,
    );

    return this.db.prepare('SELECT * FROM calyx_sla_policies WHERE id = ?').get(result.lastInsertRowid) as CalyxSlaPolicy;
  }

  // ── Tickets ──

  private nextReference(): string {
    const row = this.db.prepare("SELECT MAX(CAST(SUBSTR(reference, 5) AS INTEGER)) as num FROM calyx_tickets").get() as { num: number | null };
    const next = (row.num ?? 0) + 1;
    return `CAL-${String(next).padStart(3, '0')}`;
  }

  listTickets(filters?: TicketFilters): CalyxTicket[] {
    let sql = `
      SELECT t.*,
        tm.name as team_name, tm.slug as team_slug,
        a.name as assigned_agent_name,
        c1.name as category_name,
        c2.name as subcategory_name,
        c3.name as item_name,
        sp.name as sla_policy_name
      FROM calyx_tickets t
      JOIN calyx_teams tm ON tm.id = t.team_id
      LEFT JOIN calyx_agents a ON a.id = t.assigned_agent_id
      LEFT JOIN calyx_categories c1 ON c1.id = t.category_id
      LEFT JOIN calyx_categories c2 ON c2.id = t.subcategory_id
      LEFT JOIN calyx_categories c3 ON c3.id = t.item_id
      LEFT JOIN calyx_sla_policies sp ON sp.id = t.sla_policy_id
    `;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.team_id) {
      conditions.push('t.team_id = ?');
      params.push(filters.team_id);
    }
    if (filters?.status) {
      conditions.push('t.status = ?');
      params.push(filters.status);
    }
    if (filters?.priority) {
      conditions.push('t.priority = ?');
      params.push(filters.priority);
    }
    if (filters?.assigned_agent_id) {
      conditions.push('t.assigned_agent_id = ?');
      params.push(filters.assigned_agent_id);
    }
    if (filters?.sla_breached) {
      conditions.push(`(
        (t.frt_due_at IS NOT NULL AND t.frt_met_at IS NULL AND t.first_replied_at IS NULL AND t.frt_due_at < datetime('now'))
        OR
        (t.resolution_due_at IS NOT NULL AND t.resolved_at IS NULL AND t.status NOT IN ('resolved', 'closed') AND t.resolution_due_at < datetime('now'))
      )`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY CASE t.priority WHEN \'P1\' THEN 1 WHEN \'P2\' THEN 2 WHEN \'P3\' THEN 3 WHEN \'P4\' THEN 4 END, t.created_at DESC';

    return this.db.prepare(sql).all(...params) as CalyxTicket[];
  }

  getTicket(id: number): CalyxTicket | undefined {
    return this.db.prepare(`
      SELECT t.*,
        tm.name as team_name, tm.slug as team_slug,
        a.name as assigned_agent_name,
        c1.name as category_name,
        c2.name as subcategory_name,
        c3.name as item_name,
        sp.name as sla_policy_name
      FROM calyx_tickets t
      JOIN calyx_teams tm ON tm.id = t.team_id
      LEFT JOIN calyx_agents a ON a.id = t.assigned_agent_id
      LEFT JOIN calyx_categories c1 ON c1.id = t.category_id
      LEFT JOIN calyx_categories c2 ON c2.id = t.subcategory_id
      LEFT JOIN calyx_categories c3 ON c3.id = t.item_id
      LEFT JOIN calyx_sla_policies sp ON sp.id = t.sla_policy_id
      WHERE t.id = ?
    `).get(id) as CalyxTicket | undefined;
  }

  createTicket(payload: CreateTicketPayload): CalyxTicket {
    const reference = this.nextReference();
    const now = new Date();
    const nowStr = toSqliteDatetime(now);

    const slaPolicy = this.findSlaPolicy(payload.priority, payload.team_id, payload.category_id);

    let frtDueAt: string | null = null;
    let resolutionDueAt: string | null = null;

    if (slaPolicy) {
      if (slaPolicy.business_hours_only) {
        frtDueAt = toSqliteDatetime(addBusinessMinutes(now, slaPolicy.frt_minutes));
        resolutionDueAt = toSqliteDatetime(addBusinessMinutes(now, slaPolicy.resolution_minutes));
      } else {
        frtDueAt = toSqliteDatetime(new Date(now.getTime() + slaPolicy.frt_minutes * 60000));
        resolutionDueAt = toSqliteDatetime(new Date(now.getTime() + slaPolicy.resolution_minutes * 60000));
      }
    }

    const result = this.db.prepare(`
      INSERT INTO calyx_tickets (reference, title, description, team_id, category_id, subcategory_id, item_id, priority, status, assigned_agent_id, requester_name, requester_email, sla_policy_id, frt_due_at, resolution_due_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reference, payload.title, payload.description,
      payload.team_id, payload.category_id ?? null, payload.subcategory_id ?? null, payload.item_id ?? null,
      payload.priority, payload.assigned_agent_id ?? null,
      payload.requester_name, payload.requester_email,
      slaPolicy?.id ?? null, frtDueAt, resolutionDueAt,
      nowStr, nowStr,
    );

    const ticketId = result.lastInsertRowid as number;

    this.db.prepare(
      'INSERT INTO calyx_ticket_events (ticket_id, event_type, to_value, note, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(ticketId, 'created', 'open', 'Ticket created', nowStr);

    return this.getTicket(ticketId)!;
  }

  updateTicket(id: number, payload: UpdateTicketPayload, agentId?: number): CalyxTicket | undefined {
    const ticket = this.getTicket(id);
    if (!ticket) return undefined;

    const now = new Date();
    const nowStr = toSqliteDatetime(now);

    this.db.transaction(() => {
      if (payload.status && payload.status !== ticket.status) {
        this.handleStatusChange(ticket, payload.status, nowStr, agentId ?? null);
      }

      if (payload.priority && payload.priority !== ticket.priority) {
        this.db.prepare(
          'INSERT INTO calyx_ticket_events (ticket_id, event_type, from_value, to_value, agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(id, 'priority_change', ticket.priority, payload.priority, agentId ?? null, nowStr);
      }

      if (payload.assigned_agent_id !== undefined && payload.assigned_agent_id !== ticket.assigned_agent_id) {
        const fromName = ticket.assigned_agent_name ?? 'unassigned';
        let toName = 'unassigned';
        if (payload.assigned_agent_id) {
          const agent = this.db.prepare('SELECT name FROM calyx_agents WHERE id = ?').get(payload.assigned_agent_id) as { name: string } | undefined;
          toName = agent?.name ?? 'unknown';
        }
        this.db.prepare(
          'INSERT INTO calyx_ticket_events (ticket_id, event_type, from_value, to_value, agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(id, 'assignment_change', fromName, toName, agentId ?? null, nowStr);
      }

      const sets: string[] = ['updated_at = ?'];
      const params: unknown[] = [nowStr];

      if (payload.status) { sets.push('status = ?'); params.push(payload.status); }
      if (payload.priority) { sets.push('priority = ?'); params.push(payload.priority); }
      if (payload.assigned_agent_id !== undefined) { sets.push('assigned_agent_id = ?'); params.push(payload.assigned_agent_id); }
      if (payload.category_id !== undefined) { sets.push('category_id = ?'); params.push(payload.category_id); }
      if (payload.subcategory_id !== undefined) { sets.push('subcategory_id = ?'); params.push(payload.subcategory_id); }
      if (payload.item_id !== undefined) { sets.push('item_id = ?'); params.push(payload.item_id); }

      params.push(id);
      this.db.prepare(`UPDATE calyx_tickets SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    })();

    return this.getTicket(id);
  }

  private handleStatusChange(ticket: CalyxTicket, newStatus: TicketStatus, nowStr: string, agentId: number | null): void {
    const waitingStatuses: TicketStatus[] = ['waiting_customer', 'waiting_third_party'];
    const wasWaiting = waitingStatuses.includes(ticket.status as TicketStatus);
    const goingWaiting = waitingStatuses.includes(newStatus);

    if (goingWaiting && !wasWaiting && ticket.sla_paused_at === null) {
      this.db.prepare(
        'UPDATE calyx_tickets SET sla_paused_at = ?, sla_pause_reason = ? WHERE id = ?'
      ).run(nowStr, newStatus, ticket.id);

      this.db.prepare(
        'INSERT INTO calyx_ticket_events (ticket_id, event_type, to_value, agent_id, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(ticket.id, 'sla_paused', newStatus, agentId, nowStr);
    }

    if (wasWaiting && !goingWaiting && ticket.sla_paused_at) {
      const pausedAt = new Date(ticket.sla_paused_at.replace(' ', 'T') + 'Z');
      const pausedMs = new Date(nowStr.replace(' ', 'T') + 'Z').getTime() - pausedAt.getTime();
      const pausedMinutes = Math.floor(pausedMs / 60000);

      if (ticket.frt_due_at && !ticket.frt_met_at && !ticket.first_replied_at) {
        const oldFrt = new Date(ticket.frt_due_at.replace(' ', 'T') + 'Z');
        const newFrt = new Date(oldFrt.getTime() + pausedMs);
        this.db.prepare('UPDATE calyx_tickets SET frt_due_at = ? WHERE id = ?').run(toSqliteDatetime(newFrt), ticket.id);
      }
      if (ticket.resolution_due_at && !ticket.resolved_at) {
        const oldRes = new Date(ticket.resolution_due_at.replace(' ', 'T') + 'Z');
        const newRes = new Date(oldRes.getTime() + pausedMs);
        this.db.prepare('UPDATE calyx_tickets SET resolution_due_at = ? WHERE id = ?').run(toSqliteDatetime(newRes), ticket.id);
      }

      this.db.prepare(
        'UPDATE calyx_tickets SET sla_paused_at = NULL, sla_pause_reason = NULL WHERE id = ?'
      ).run(ticket.id);

      this.db.prepare(
        'INSERT INTO calyx_ticket_events (ticket_id, event_type, to_value, note, agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(ticket.id, 'sla_resumed', newStatus, `Paused for ${pausedMinutes} minutes`, agentId, nowStr);
    }

    if (newStatus === 'resolved' && ticket.status !== 'resolved') {
      this.db.prepare('UPDATE calyx_tickets SET resolved_at = ? WHERE id = ?').run(nowStr, ticket.id);
      this.db.prepare(
        'INSERT INTO calyx_ticket_events (ticket_id, event_type, to_value, agent_id, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(ticket.id, 'resolved', 'resolved', agentId, nowStr);
    }

    if ((ticket.status === 'resolved' || ticket.status === 'closed') && newStatus !== 'resolved' && newStatus !== 'closed') {
      this.db.prepare('UPDATE calyx_tickets SET resolved_at = NULL WHERE id = ?').run(ticket.id);
      this.db.prepare(
        'INSERT INTO calyx_ticket_events (ticket_id, event_type, to_value, agent_id, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(ticket.id, 'reopened', newStatus, agentId, nowStr);
    }

    this.db.prepare(
      'INSERT INTO calyx_ticket_events (ticket_id, event_type, from_value, to_value, agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(ticket.id, 'status_change', ticket.status, newStatus, agentId, nowStr);
  }

  // ── Comments ──

  getTicketComments(ticketId: number): CalyxComment[] {
    return this.db.prepare(`
      SELECT c.*, a.name as agent_name
      FROM calyx_ticket_comments c
      LEFT JOIN calyx_agents a ON a.id = c.agent_id
      WHERE c.ticket_id = ?
      ORDER BY c.created_at ASC
    `).all(ticketId) as CalyxComment[];
  }

  addComment(ticketId: number, payload: CreateCommentPayload): CalyxComment {
    const now = toSqliteDatetime(new Date());

    const result = this.db.prepare(
      'INSERT INTO calyx_ticket_comments (ticket_id, agent_id, body, is_internal, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(ticketId, payload.agent_id ?? null, payload.body, payload.is_internal ? 1 : 0, now);

    this.db.prepare(
      'INSERT INTO calyx_ticket_events (ticket_id, event_type, to_value, agent_id, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(ticketId, 'comment_added', payload.is_internal ? 'internal' : 'public', payload.agent_id ?? null, now);

    if (!payload.is_internal) {
      const ticket = this.db.prepare('SELECT first_replied_at, frt_due_at FROM calyx_tickets WHERE id = ?').get(ticketId) as { first_replied_at: string | null; frt_due_at: string | null } | undefined;
      if (ticket && !ticket.first_replied_at) {
        this.db.prepare('UPDATE calyx_tickets SET first_replied_at = ?, frt_met_at = ? WHERE id = ?').run(now, now, ticketId);
        this.db.prepare(
          'INSERT INTO calyx_ticket_events (ticket_id, event_type, to_value, agent_id, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(ticketId, 'frt_met', now, payload.agent_id ?? null, now);
      }
    }

    return this.db.prepare(`
      SELECT c.*, a.name as agent_name
      FROM calyx_ticket_comments c
      LEFT JOIN calyx_agents a ON a.id = c.agent_id
      WHERE c.id = ?
    `).get(result.lastInsertRowid) as CalyxComment;
  }

  // ── Events ──

  getTicketEvents(ticketId: number): CalyxTicketEvent[] {
    return this.db.prepare(`
      SELECT e.*, a.name as agent_name
      FROM calyx_ticket_events e
      LEFT JOIN calyx_agents a ON a.id = e.agent_id
      WHERE e.ticket_id = ?
      ORDER BY e.created_at ASC
    `).all(ticketId) as CalyxTicketEvent[];
  }
}
