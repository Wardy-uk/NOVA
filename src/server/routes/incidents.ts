import { Router } from 'express';
import type { IncidentDetector } from '../services/incident-detector.js';
import { requireRole } from '../middleware/auth.js';

export function createIncidentRoutes(detector: IncidentDetector): Router {
  const router = Router();
  router.use(requireRole('admin'));

  router.get('/active', async (_req, res) => {
    try {
      const incidents = await detector.getActiveIncidents();
      res.json({ ok: true, data: incidents });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  router.get('/recent', async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const incidents = await detector.getRecentIncidents(days);
      res.json({ ok: true, data: incidents });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  router.post('/scan', async (_req, res) => {
    try {
      const detected = await detector.scan();
      res.json({ ok: true, data: { detected: detected.length, incidents: detected } });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  router.post('/:id/resolve', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ ok: false, error: 'Invalid incident ID' });
      await detector.resolveIncident(id);
      res.json({ ok: true });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  return router;
}
