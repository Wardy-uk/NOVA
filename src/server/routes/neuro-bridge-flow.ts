import { Router } from 'express';

import { getFlowSignals } from '../services/flow-signals.js';
import { bridgeAuth } from './neuro-bridge.js';

/**
 * Flow half of the NEURO bridge — read-only.
 *
 * All the judgement lives in `services/flow-signals.ts`; this is the door. The
 * split is what lets the queries be validated on the production box without
 * deploying a route, which matters because NOVA has no local instance to test
 * against — see `scripts/validate-flow-signals.ts`.
 *
 * Strictly SELECT. Nothing on this router writes.
 */
export function createNeuroBridgeFlowRoutes(): Router {
  const router = Router();

  /**
   * GET /flow-signals?days=30
   *
   * NEURO pulls this once per weekly report rather than making five round trips
   * over the Funnel.
   */
  router.get('/flow-signals', async (req, res) => {
    if (!bridgeAuth(req, res)) return;
    try {
      const days = parseInt(req.query.days as string, 10) || 30;
      res.json({ ok: true, data: await getFlowSignals(days) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  return router;
}
