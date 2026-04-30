import { Router, type Request, type Response } from 'express';
import {
  recordEvent,
  isValidEventType,
  getEventsForTicket,
  getAgentEventsToday,
  type AgentEventType,
} from '../services/agent-events.js';

export function createMyTicketsRoutes(): Router {
  const router = Router();

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

  return router;
}
