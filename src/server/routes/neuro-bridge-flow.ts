import { Router } from 'express';

import { getFlowSignals } from '../services/flow-signals.js';
import { getSentimentSignals } from '../services/sentiment-signals.js';
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
   * GET /flow-signals?days=30&projects=NT
   *
   * NEURO pulls this once per weekly report rather than making five round trips
   * over the Funnel.
   *
   * `projects` defaults to NT, matching every NOVA KPI and wallboard. Widening
   * it is supported and deliberate — the Support Review counted TPJ work too —
   * but the scope always travels back on the response so a number can be
   * reconciled against the board on the wall.
   */
  router.get('/flow-signals', async (req, res) => {
    if (!bridgeAuth(req, res)) return;
    try {
      const days = parseInt(req.query.days as string, 10) || 30;
      const raw = typeof req.query.projects === 'string' ? req.query.projects : '';
      // Uppercased and stripped to word characters: these interpolate into a
      // LIKE prefix and an IN list, and a project key is a Jira identifier, not
      // free text.
      const projects = raw
        ? raw.split(',').map(p => p.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean)
        : undefined;
      res.json({ ok: true, data: await getFlowSignals(days, projects?.length ? projects : undefined) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  /**
   * GET /sentiment-signals?days=30
   *
   * Customer and internal sentiment, reported as four separate measures rather
   * than one number — they have different scales, populations and biases, and
   * averaging them would produce a figure that describes nothing.
   */
  router.get('/sentiment-signals', async (req, res) => {
    if (!bridgeAuth(req, res)) return;
    try {
      const days = parseInt(req.query.days as string, 10) || 30;
      res.json({ ok: true, data: await getSentimentSignals(days) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  return router;
}
