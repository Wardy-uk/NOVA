import { Router } from 'express';
import type { CalyxQueries } from '../db/calyx-queries.js';
import type { TicketFilters, TicketPriority, TicketStatus } from '../../shared/calyx-types.js';

export function createCalyxRoutes(queries: CalyxQueries): Router {
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
    const ticket = queries.updateTicket(Number(req.params.id), req.body, req.body.agent_id);
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    res.json(ticket);
  });

  router.post('/tickets/:id/comments', (req, res) => {
    try {
      const { body, is_internal, agent_id } = req.body;
      if (!body) {
        res.status(400).json({ error: 'Comment body is required' });
        return;
      }
      const comment = queries.addComment(Number(req.params.id), { body, is_internal, agent_id });
      res.status(201).json(comment);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to add comment' });
    }
  });

  return router;
}
