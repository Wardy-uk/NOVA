import { Router } from 'express';

import type { SettingsQueries } from '../db/settings-store.js';
import { getPeopleSignals } from '../services/people-signals.js';
import { bridgeAuth } from './neuro-bridge.js';

/**
 * People half of the NEURO bridge — read-only.
 *
 * All the judgement lives in `services/people-signals.ts`; this is the door. The
 * split is what lets the queries be validated on the production box without
 * deploying a route, which matters because NOVA has no local instance to test
 * against — see `scripts/validate-people-signals.ts`.
 *
 * Strictly SELECT. Nothing on this router writes.
 */
export function createNeuroBridgePeopleRoutes(settingsQueries: SettingsQueries): Router {
  const router = Router();

  /**
   * GET /people-signals?days=30&day=YYYY-MM-DD
   *
   * The per-person subset of NOVA's KPIs, plus the roster they were computed
   * over. NEURO pulls it on a cache rather than per render.
   *
   * `days` windows the day-spanning signals (standups, escalations). `day`
   * selects a specific frozen KPI capture; omitted, the most recent capture that
   * exists answers, and its age comes back so a stale one cannot be read as
   * today's.
   *
   * Deliberately takes NO caller identity. This endpoint returns the whole team
   * by construction, and a "who is asking" parameter on a route that sits in
   * front of the JWT middleware is a scope-widening lever with nothing behind it
   * — the bridge secret is the only authority here, and it is Nick's.
   */
  router.get('/people-signals', async (req, res) => {
    if (!bridgeAuth(req, res)) return;
    try {
      const days = parseInt(req.query.days as string, 10) || 30;
      // Shape-checked, not just typed: `day` reaches a parameterised query, but a
      // malformed value would silently select nothing and render as a team the
      // capture never measured. Rejecting it early makes the mistake loud.
      const raw = typeof req.query.day === 'string' ? req.query.day : '';
      if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        res.status(400).json({ ok: false, error: 'day must be YYYY-MM-DD' });
        return;
      }
      res.json({ ok: true, data: await getPeopleSignals(settingsQueries, days, raw || undefined) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  return router;
}
