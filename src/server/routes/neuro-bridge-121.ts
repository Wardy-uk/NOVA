import { Router } from 'express';

import { query } from '../services/database.js';
import {
  upsertBooking, cancelOpenSessions, isKnownAgent, setAgentCadenceDays,
} from '../services/one21-service.js';
import { bridgeAuth } from './neuro-bridge.js';

/**
 * 1-2-1 half of the NEURO bridge — how a booking becomes a NOVA session.
 *
 * WHY IT EXISTS. Nothing connected the two halves of the 1-2-1 loop. NEURO does the
 * scheduling — it is the only side that finds a real free slot, checks for clashes,
 * invites the person and bulk-books the team — while NOVA does the prep, the KPIs and
 * the action tracking. But NOVA's day-before prep job only fires for a session it holds
 * with `status = 'scheduled'`, and nothing ever created one. A 2026-08-27 audit found the
 * prep email had never been sent: not late, not intermittently — never, in two months.
 *
 * So the booking crosses here. NEURO calls; NOVA does not call out. That keeps the bridge
 * one-directional, reuses the shared secret unchanged, and means NOVA gains no dependency
 * on a Pi it cannot reach from prod.
 *
 * ⚠ NOVA no longer writes the Outlook event. NEURO made it, with the attendee actually
 * invited, so NOVA stores NEURO's `outlookEventId` and never creates its own — two writers
 * to one calendar is two events in Nick's diary.
 *
 * ⚠ Names are matched EXACTLY, against `agent_development_plans`. A name NOVA does not
 * know is a 404 and a roster-drift row, never a fuzzy match. Three systems key 1-2-1s on
 * a person's display name with no join table between them; quietly accepting a near-miss
 * is how one agent's history ends up split across two spellings.
 */
export function createNeuroBridge121Routes(): Router {
  const router = Router();

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  /**
   * POST /121/booking — NEURO booked (or moved) a 1-2-1; make NOVA agree.
   *
   * Idempotent. NEURO's reconciliation sweep replays every booking each morning, so the
   * overwhelming majority of calls here are `unchanged: true` and touch nothing.
   */
  router.post('/121/booking', async (req, res) => {
    if (!bridgeAuth(req, res)) return;

    const agentName = String(req.body?.agentName ?? '').trim();
    const date = String(req.body?.date ?? '').slice(0, 10);
    const outlookEventId = req.body?.outlookEventId ? String(req.body.outlookEventId) : null;

    if (!agentName || !DATE_RE.test(date)) {
      res.status(400).json({ ok: false, error: 'agentName and date (YYYY-MM-DD) are required' });
      return;
    }
    if (!(await isKnownAgent(agentName))) {
      // 404 rather than 400: the request is well-formed, the person is not on NOVA's
      // roster. NEURO surfaces this as drift rather than retrying it forever.
      res.status(404).json({ ok: false, error: `No active 1-2-1 roster entry for "${agentName}"` });
      return;
    }

    try {
      const result = await upsertBooking(agentName, date, { outlookEventId });
      if (!result.unchanged) {
        console.log(`[121-bridge] ${agentName} booked ${date}` +
          (result.created ? ' (new session)' : ` (moved from ${result.previousDate})`));
      }
      res.json({ ok: true, data: { ...result, scheduled_date: date } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[121-bridge] booking failed:', message);
      res.status(500).json({ ok: false, error: message });
    }
  });

  /**
   * POST /121/cancel — the 1-2-1 came out of the diary.
   *
   * Returns the Outlook ids NOVA had stored so NEURO can reconcile its own view; NOVA
   * does not delete the events, because it no longer owns them.
   */
  router.post('/121/cancel', async (req, res) => {
    if (!bridgeAuth(req, res)) return;

    const agentName = String(req.body?.agentName ?? '').trim();
    if (!agentName) { res.status(400).json({ ok: false, error: 'agentName is required' }); return; }

    try {
      res.json({ ok: true, data: await cancelOpenSessions(agentName) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  /**
   * POST /121/cadence — how often this person's 1-2-1 should recur, from their People
   * card. NOVA had `one21_cadence_days` NULL on every plan, so a fortnightly 1-2-1 was
   * being rebooked at the 28-day default with nothing to say otherwise.
   */
  router.post('/121/cadence', async (req, res) => {
    if (!bridgeAuth(req, res)) return;

    const agentName = String(req.body?.agentName ?? '').trim();
    const raw = req.body?.cadenceDays;
    // null is meaningful: `cadence: n/a` in the vault takes someone out of the rota.
    const cadenceDays = raw === null || raw === undefined ? null : Number(raw);
    if (!agentName || (cadenceDays !== null && (!Number.isInteger(cadenceDays) || cadenceDays < 1 || cadenceDays > 365))) {
      res.status(400).json({ ok: false, error: 'agentName and cadenceDays (1-365, or null) are required' });
      return;
    }
    if (!(await isKnownAgent(agentName))) {
      res.status(404).json({ ok: false, error: `No active 1-2-1 roster entry for "${agentName}"` });
      return;
    }

    try {
      res.json({ ok: true, data: await setAgentCadenceDays(agentName, cadenceDays) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  /**
   * GET /121/state?days=60 — what NOVA believes is booked, plus its roster.
   *
   * This is what makes a dropped push self-healing: NEURO compares its own
   * `1-2-1-booked` dates against this and re-pushes the difference. It is also the
   * roster-drift feed, which is why it returns every plan rather than only the booked
   * ones — a person NOVA has and the vault does not is exactly the thing to surface.
   */
  router.get('/121/state', async (req, res) => {
    if (!bridgeAuth(req, res)) return;

    const raw = Number(req.query.days);
    const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.round(raw))) : 60;
    const horizon = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    try {
      const roster = await query<{ agent_name: string; status: string; one21_cadence_days: number | null }>(
        `SELECT agent_name, status, one21_cadence_days FROM agent_development_plans
         WHERE status IN ('active','deferred') ORDER BY agent_name`);

      const open = await query<{
        agent_name: string; id: number; scheduled_date: string; status: string; outlook_event_id: string | null;
      }>(`
        SELECT s.agent_name, s.id, s.scheduled_date, s.status, s.outlook_event_id
        FROM agent_121_sessions s
        INNER JOIN (
          SELECT agent_name, MIN(scheduled_date) AS d FROM agent_121_sessions
          WHERE status IN ('scheduled','prep_sent','awaiting_agent','ready','in_progress')
          GROUP BY agent_name
        ) m ON m.agent_name = s.agent_name AND m.d = s.scheduled_date
        WHERE s.status IN ('scheduled','prep_sent','awaiting_agent','ready','in_progress')
          AND s.scheduled_date <= ?
      `, [horizon]);
      const openByAgent = new Map(open.map((r) => [r.agent_name, r]));

      const last = await query<{ agent_name: string; last_date: string }>(
        `SELECT agent_name, MAX(scheduled_date) AS last_date FROM agent_121_sessions
         WHERE status = 'complete' GROUP BY agent_name`);
      const lastByAgent = new Map(last.map((r) => [r.agent_name, String(r.last_date).slice(0, 10)]));

      res.json({
        ok: true,
        data: {
          horizon,
          agents: roster.map((p) => {
            const o = openByAgent.get(p.agent_name);
            return {
              agentName: p.agent_name,
              planStatus: p.status,
              cadenceDays: p.one21_cadence_days,
              booked: o ? String(o.scheduled_date).slice(0, 10) : null,
              sessionId: o?.id ?? null,
              sessionStatus: o?.status ?? null,
              outlookEventId: o?.outlook_event_id ?? null,
              lastHeld: lastByAgent.get(p.agent_name) ?? null,
            };
          }),
        },
      });
    } catch (err) {
      // Loud, and never an empty list. "NOVA has nothing booked" would make the
      // reconciliation sweep re-push the entire team on a transient DB error.
      const message = err instanceof Error ? err.message : String(err);
      console.error('[121-bridge] state failed:', message);
      res.status(503).json({ ok: false, error: message, agents: null });
    }
  });

  /**
   * GET /121/completed?since=YYYY-MM-DD — 1-2-1s NOVA has finished running.
   *
   * The read half of the loop. NOVA holds what was agreed; the vault is where Nick and
   * everyone else actually reads it, and until this existed the loop dead-ended in
   * `agent_121_actions` — the People card, the development plan and the tracker never
   * learned a 1-2-1 had happened at all.
   *
   * NEURO does the writing. NOVA prod cannot see the vault (it runs on BYM-AAPP01; the
   * vault lives on Nick's machine and the Pi over Syncthing), and NEURO already owns
   * every vault-mutation path plus the nightly tracker regeneration. A second writer to
   * files NEURO rewrites each night is a race with no upside.
   *
   * `completed_at` is the proof the meeting happened — the same standard the vault's own
   * detector applies to a written-up note — so it is what NEURO stamps `last-1-2-1` from.
   */
  router.get('/121/completed', async (req, res) => {
    if (!bridgeAuth(req, res)) return;

    const since = String(req.query.since ?? '').slice(0, 10);
    if (!DATE_RE.test(since)) {
      res.status(400).json({ ok: false, error: 'since (YYYY-MM-DD) is required' });
      return;
    }

    try {
      const sessions = await query<{
        id: number; agent_name: string; scheduled_date: string; completed_at: string;
        plaud_recording_id: string | null; notes_text: string | null;
      }>(`
        SELECT id, agent_name, scheduled_date, completed_at, plaud_recording_id, notes_text
        FROM agent_121_sessions
        WHERE status = 'complete' AND completed_at IS NOT NULL AND completed_at >= ?
        ORDER BY completed_at ASC
      `, [since]);

      if (sessions.length === 0) { res.json({ ok: true, data: { since, sessions: [] } }); return; }

      // One query for every session's actions rather than one per session — this runs on
      // a DTU-limited instance and the caller is a nightly batch, not a screen.
      const ids = sessions.map((s) => s.id);
      const actions = await query<{
        id: number; session_id: number; description: string; owner: string | null;
        due_date: string | null; status: string;
      }>(`
        SELECT id, session_id, description, owner, due_date, status
        FROM agent_121_actions
        WHERE session_id IN (${ids.map(() => '?').join(',')})
        ORDER BY id ASC
      `, ids);
      const bySession = new Map<number, typeof actions>();
      for (const a of actions) {
        const list = bySession.get(a.session_id) ?? [];
        list.push(a);
        bySession.set(a.session_id, list);
      }

      const iso = (v: string | null) => (v ? String(v).slice(0, 10) : null);

      res.json({
        ok: true,
        data: {
          since,
          sessions: sessions.map((s) => {
            const list = bySession.get(s.id) ?? [];
            return {
              sessionId: s.id,
              agentName: s.agent_name,
              scheduledDate: iso(s.scheduled_date),
              completedAt: iso(s.completed_at),
              plaudRecordingId: s.plaud_recording_id,
              notesText: s.notes_text,
              // Split by what the vault does with them: commitments become checkboxes,
              // reviewed items are already-closed history and must not reappear as open.
              actions: list.filter((a) => ['pending', 'open', 'in_progress', 'carried_over'].includes(a.status))
                .map((a) => ({ id: a.id, description: a.description, owner: a.owner, dueDate: iso(a.due_date), status: a.status })),
              reviewedActions: list.filter((a) => ['delivered', 'missed'].includes(a.status))
                .map((a) => ({ id: a.id, description: a.description, status: a.status })),
            };
          }),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[121-bridge] completed failed:', message);
      res.status(503).json({ ok: false, error: message, sessions: null });
    }
  });

  return router;
}
