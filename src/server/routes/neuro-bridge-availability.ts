import { Router } from 'express';

import type { SettingsQueries } from '../db/settings-store.js';
import { AgentAvailabilityService } from '../services/agent-availability.js';
import { bridgeAuth } from './neuro-bridge.js';

/**
 * Availability half of the NEURO bridge — read-only.
 *
 * WHY IT EXISTS. NEURO went quiet on a day off only when Nick pressed a button.
 * NOVA already knows the real answer: People HR is synced into
 * `agent_availability` every day, and Nick is in it (AgentId 24, PeopleHrId
 * D2V00244). Leave should be READ, not declared — the same rule that already
 * governs who reports to him and when his 1-2-1s happened.
 *
 * NEURO cannot read it directly, and not for want of a connection string. The
 * table stores no names: `roster_id` is a bare integer pointing at
 * `dbo.Agent.AgentId` in the KPI database on another server, with no FK and no
 * join table, and the display name is stitched on at READ time from credentials
 * that live in NOVA's admin settings. NOVA's own `/api/agent/availability/*`
 * routes do that stitching but sit behind `requireAreaAccess` JWT, which the
 * bridge secret does not satisfy — a route that exists and answers 401, which
 * NEURO has been bitten by before. So the data crosses here.
 *
 * Strictly SELECT. Nothing on this router writes.
 */
export function createNeuroBridgeAvailabilityRoutes(settingsQueries: SettingsQueries): Router {
  const router = Router();
  const service = new AgentAvailabilityService(settingsQueries);

  /**
   * GET /availability?days=14
   *
   * Absences for the whole NT team, names attached.
   *
   * ⚠ The shape exists to keep three answers apart, because NEURO uses this to
   * decide whether to go SILENT and silence-by-accident is the failure that
   * would end the feature:
   *
   *   ok:false            — we could not look. Never means "nobody is off".
   *   ok:true, roster 0   — we reached the KPI database and it named no agents,
   *                         which is a broken roster rather than a free team.
   *   ok:true, absences 0 — we looked, everyone is in. The real all-clear.
   *
   * ⚠ It carries APPROVED leave only. People HR's GetHolidayDetail does not
   * return a request still awaiting a manager, so an absence booked for
   * tomorrow and not yet approved is legitimately absent from this feed. NEURO
   * must keep its manual override for exactly that case, and for same-day
   * decisions — this is a complement to that button, not a replacement.
   */
  router.get('/availability', async (req, res) => {
    if (!bridgeAuth(req, res)) return;

    const raw = Number(req.query.days);
    const days = Number.isFinite(raw) ? Math.min(90, Math.max(1, Math.round(raw))) : 14;

    try {
      // Reuses the service the Team Availability widget uses, rather than
      // re-querying — a second copy of the roster join would drift on the half
      // that matters (which agents count) and the two screens would disagree.
      const absences = await service.getUpcomingAbsences(days);
      const roster = await service.getAgentsFromKpiPublic();

      const today = new Date().toISOString().slice(0, 10);
      const to = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

      res.json({
        ok: true,
        source: 'peoplehr',
        // Named so NEURO can say WHICH source answered rather than asserting a
        // bare "you are off today".
        from: today,
        to,
        days,
        // The roster is returned alongside so NEURO can resolve itself by id or
        // by name without a second call, and so an empty roster is visible as
        // an empty roster rather than as a quiet all-clear.
        rosterCount: roster.length,
        roster: roster.map(a => ({
          rosterId: a.AgentId,
          name: a.display_name,
          pool: a.pool,
          // Whether People HR can be asked about this person at all. Without an
          // id they never sync and simply always look available — an absence of
          // evidence that reads exactly like evidence of presence.
          syncable: Boolean(a.PeopleHrId),
        })),
        absences: absences.map(a => ({
          rosterId: a.roster_id,
          name: a.display_name ?? null,
          date: typeof a.available_date === 'string'
            ? a.available_date.slice(0, 10)
            : new Date(a.available_date as unknown as string).toISOString().slice(0, 10),
          status: a.status,
          reason: a.reason ?? null,
          // 'manual' rows are a human overriding the sync in NOVA's UI and win
          // for that date; passing it through means NEURO can say so too.
          setBy: a.source ?? 'peoplehr',
        })),
      });
    } catch (err) {
      // Loud and explicit. A caller deciding whether to stay silent must never
      // read a failure as "nothing booked".
      const message = err instanceof Error ? err.message : String(err);
      console.error('[neuro-bridge] availability failed:', message);
      res.status(503).json({ ok: false, error: message, absences: null, roster: null });
    }
  });

  return router;
}
