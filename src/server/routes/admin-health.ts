import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { getHealthSignals } from '../services/health-signals.js';
import type { JobRegistry } from '../services/job-registry.js';

/**
 * The Health page's door — NOVA's self-report, for humans.
 *
 * All the judgement lives in `services/health-signals.ts`; this is thin on
 * purpose. The same function answers the NEURO bridge at
 * `GET /api/neuro-bridge/health-signals`, so the page and VANTAGE can never
 * disagree about whether NOVA is well, and there is no second copy of the SQL to
 * drift. It is also what lets the queries be validated on the production box
 * without deploying a route — see `scripts/validate-health-signals.ts`.
 *
 * Admin-only. It names internal tables and job identifiers.
 *
 * Strictly SELECT. Nothing on this router writes.
 */
export function createAdminHealthRoutes(jobRegistry: JobRegistry): Router {
  const router = Router();
  router.use(requireRole('admin'));

  router.get('/signals', async (_req, res) => {
    try {
      res.json({ ok: true, data: await getHealthSignals(jobRegistry) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Health check failed' });
    }
  });

  return router;
}
