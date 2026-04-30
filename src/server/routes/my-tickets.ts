import { Router, type Request, type Response } from 'express';
import {
  recordEvent,
  isValidEventType,
  getEventsForTicket,
  getAgentEventsToday,
  type AgentEventType,
} from '../services/agent-events.js';
import type { JiraRestClient } from '../services/jira-client.js';
import type { QueueRanker } from '../services/queue-ranker.js';
import type { UserQueries } from '../db/queries.js';
import { DeferService, isValidDeferReason, DEFER_REASONS, type DeferReason } from '../services/defer-service.js';
import { JIRA_FIELDS } from '../../shared/jira-fields.js';
import { createWorkingDayClock } from '../../shared/utils/workingDayClock.js';

interface MyTicketsRouteDeps {
  jiraClient: JiraRestClient | null;
  queueRanker: QueueRanker;
  deferService: DeferService;
  userQueries: UserQueries;
  bankHolidays?: string[];
}

export function createMyTicketsRoutes(deps: MyTicketsRouteDeps): Router {
  const router = Router();
  const { jiraClient, queueRanker, deferService, userQueries } = deps;
  const clock = createWorkingDayClock({}, deps.bankHolidays ?? []);

  // ── Events ──

  router.post('/events', async (req: Request, res: Response) => {
    try {
      const { event_type, ticket_key, payload } = req.body;
      if (!event_type || !payload) {
        res.status(400).json({ ok: false, error: 'event_type and payload are required' });
        return;
      }
      if (!isValidEventType(event_type)) {
        res.status(400).json({ ok: false, error: `Invalid event_type: ${event_type}` });
        return;
      }
      const agentId = req.user?.username ?? null;
      await recordEvent(event_type as AgentEventType, agentId, ticket_key ?? null, payload);
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to record event' });
    }
  });

  router.get('/events', async (req: Request, res: Response) => {
    try {
      const ticketKey = req.query.ticket_key as string;
      if (!ticketKey) {
        res.status(400).json({ ok: false, error: 'ticket_key query param is required' });
        return;
      }
      const limit = parseInt(req.query.limit as string) || 50;
      const data = await getEventsForTicket(ticketKey, limit);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  router.get('/events/agent/:agentId/today', async (req: Request, res: Response) => {
    try {
      const data = await getAgentEventsToday(req.params.agentId as string);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // ── Queue ──

  router.get('/queue/:agentId', async (req: Request, res: Response) => {
    try {
      const agentId = req.params.agentId as string;
      const user = await userQueries.getByUsername(agentId);
      if (!user?.email) {
        res.status(404).json({ ok: false, error: `Agent ${agentId} not found or has no email` });
        return;
      }
      const data = await queueRanker.computeQueue(agentId, user.email);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to compute queue' });
    }
  });

  // ── Defers ──

  router.get('/defer-reasons', (_req: Request, res: Response) => {
    const reasons = Object.entries(DEFER_REASONS).map(([key, config]) => ({
      key,
      label: config.label,
    }));
    res.json({ ok: true, data: reasons });
  });

  router.post('/defer', async (req: Request, res: Response) => {
    try {
      const { ticket_key, reason, resurface_at, note } = req.body;
      if (!ticket_key || !reason) {
        res.status(400).json({ ok: false, error: 'ticket_key and reason are required' });
        return;
      }
      if (!isValidDeferReason(reason)) {
        res.status(400).json({ ok: false, error: `Invalid defer reason: ${reason}` });
        return;
      }
      const agentId = req.user?.username ?? 'unknown';
      const data = await deferService.deferTicket(ticket_key, agentId, reason as DeferReason, resurface_at, note);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to defer ticket' });
    }
  });

  router.get('/defers/:agentId', async (req: Request, res: Response) => {
    try {
      const data = await deferService.getActiveDefers(req.params.agentId as string);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // ── Agent Next Update ──

  router.patch('/jira/:ticketKey/agent-next-update', async (req: Request, res: Response) => {
    if (!jiraClient) {
      res.status(503).json({ ok: false, error: 'Jira client not available' });
      return;
    }
    try {
      const ticketKey = req.params.ticketKey as string;
      const { at } = req.body as { at: string | null };

      if (at !== null) {
        const target = new Date(at);
        if (isNaN(target.getTime())) {
          res.status(400).json({ ok: false, error: 'Invalid date format' });
          return;
        }
        if (target.getTime() <= Date.now()) {
          res.status(400).json({ ok: false, error: 'Agent Next Update must be in the future' });
          return;
        }
        if (!clock.isWorkingTime(target)) {
          res.status(400).json({ ok: false, error: 'Agent Next Update must fall within working hours' });
          return;
        }
      }

      await jiraClient.updateFields(ticketKey, {
        [JIRA_FIELDS.AGENT_NEXT_UPDATE]: at,
      });

      const agentId = req.user?.username ?? null;
      await recordEvent('next_update_commitment_set', agentId, ticketKey, {
        at,
        set_by: agentId,
      });

      res.json({ ok: true, data: { ticketKey, agentNextUpdate: at } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to update field' });
    }
  });

  return router;
}
