import { Router } from 'express';
import type { JobRegistry } from '../services/job-registry.js';
import { requireRole } from '../middleware/auth.js';

export function createAdminJobRoutes(jobRegistry: JobRegistry): Router {
  const router = Router();
  router.use(requireRole('admin'));

  router.get('/', (_req, res) => {
    try {
      const jobs = jobRegistry.getStatus();
      res.json({ ok: true, data: jobs });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  router.post('/:id/start', (req, res) => {
    try {
      jobRegistry.start(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  router.post('/:id/stop', (req, res) => {
    try {
      jobRegistry.stop(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  router.post('/:id/run-now', async (req, res) => {
    try {
      await jobRegistry.runNow(req.params.id);
      const job = jobRegistry.getJob(req.params.id);
      res.json({ ok: true, data: job });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  router.post('/pause-all', (_req, res) => {
    try {
      jobRegistry.pauseAll();
      res.json({ ok: true });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  router.post('/resume-all', (_req, res) => {
    try {
      jobRegistry.resumeAll();
      res.json({ ok: true });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  return router;
}
