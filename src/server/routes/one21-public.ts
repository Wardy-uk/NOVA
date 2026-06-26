import { Router } from 'express';
import {
  getSessionByToken, isSubmissionEditable, saveAgentSubmission, displayDate, runDayBeforePrep,
  startSession, getSessionDetail, updateActionStatus, addSessionAction, updateSessionNotes,
  completeSession, getPlaudCandidates, attachPlaudNote, runWeeklyKpiEmail,
  ACTION_REVIEW_STATUSES, type One21Deps,
} from '../services/one21-service.js';
import { getPrepQuestions } from '../config/one21-config.js';
import type { FileSettingsQueries } from '../db/settings-store.js';

/**
 * PUBLIC 1-2-1 routes — mounted at /api/121 BEFORE the auth middleware. The agent
 * reaches their prep form via an unguessable per-session token emailed the day before.
 */
export function createOne21PublicRoutes(settings: FileSettingsQueries): Router {
  const router = Router();

  // Bootstrap the agent's prep form for a token.
  router.get('/public/:token', async (req, res) => {
    try {
      const session = await getSessionByToken(String(req.params.token));
      if (!session) { res.status(404).json({ ok: false, error: 'This 1-2-1 prep link is not valid.' }); return; }

      const questions = getPrepQuestions(settings);
      let answers: Array<{ question: string; answer: string }> = [];
      if (session.agent_submission_json) {
        try { answers = JSON.parse(session.agent_submission_json); } catch { answers = []; }
      }
      res.json({
        ok: true,
        data: {
          agentName: session.agent_name,
          dateDisplay: displayDate(session.scheduled_date),
          editable: isSubmissionEditable(session.status),
          questions,
          answers,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Agent submits (or updates) their prep answers.
  router.post('/submit', async (req, res) => {
    try {
      const token = String(req.body?.token ?? '');
      const rawAnswers = req.body?.answers;
      if (!Array.isArray(rawAnswers)) { res.status(400).json({ ok: false, error: 'answers required' }); return; }
      const answers = rawAnswers
        .map((a) => ({ question: String(a?.question ?? '').trim(), answer: String(a?.answer ?? '').trim() }))
        .filter((a) => a.question);
      const result = await saveAgentSubmission(token, answers);
      if (!result.ok) { res.status(409).json({ ok: false, error: result.error }); return; }
      res.json({ ok: true, data: {} });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  return router;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * AUTHENTICATED 1-2-1 routes — mounted at /api/121 behind NOVA auth. Manual triggers
 * for testing the day-before prep job.
 */
export function createOne21Routes(deps: One21Deps): Router {
  const router = Router();

  // Manually run the day-before prep job for a date (default tomorrow). Handy for testing.
  router.post('/run-prep', async (req, res) => {
    try {
      const date = typeof req.body?.date === 'string' && DATE_RE.test(req.body.date) ? req.body.date : undefined;
      const result = await runDayBeforePrep(deps, date);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Manually run the weekly KPI email (Phase 5). Handy for testing.
  router.post('/run-weekly-kpi', async (_req, res) => {
    try {
      const result = await runWeeklyKpiEmail(deps);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── Click-through session (Phase 3) ──

  // Start (or resume) the click-through for an agent → marks the session in_progress.
  router.post('/session/start', async (req, res) => {
    try {
      const agent = String(req.body?.agent ?? '').trim();
      if (!agent) { res.status(400).json({ ok: false, error: 'agent required' }); return; }
      const sessionId = await startSession(deps.settingsQueries, agent);
      res.json({ ok: true, data: { sessionId } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Full session detail for all 5 stages.
  router.get('/session/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
      const detail = await getSessionDetail(deps.settingsQueries, id);
      if (!detail) { res.status(404).json({ ok: false, error: 'Session not found' }); return; }
      res.json({ ok: true, data: detail });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Stage 1 — review an outstanding action (delivered | missed | carried_over | pending).
  router.patch('/action/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const status = String(req.body?.status ?? '');
      if (!Number.isInteger(id) || !ACTION_REVIEW_STATUSES.has(status)) {
        res.status(400).json({ ok: false, error: 'Invalid id or status' });
        return;
      }
      await updateActionStatus(id, status);
      res.json({ ok: true, data: {} });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Stage 5 — add a new commitment/action for the coming month.
  router.post('/session/:id/action', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const description = String(req.body?.description ?? '').trim();
      const agent = String(req.body?.agent ?? '').trim();
      if (!Number.isInteger(id) || !description || !agent) {
        res.status(400).json({ ok: false, error: 'id, agent and description required' });
        return;
      }
      const actionId = await addSessionAction(id, agent, {
        description,
        owner: req.body?.owner ? String(req.body.owner) : null,
        due_date: req.body?.due_date ? String(req.body.due_date) : null,
      });
      res.json({ ok: true, data: { id: actionId } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Stage 4 — save discussion notes.
  router.patch('/session/:id/notes', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
      await updateSessionNotes(id, String(req.body?.notes_text ?? ''));
      res.json({ ok: true, data: {} });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Stage 4 — list candidate Plaud notes (title contains the agent's name; no auto-bind).
  router.get('/session/:id/plaud-candidates', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
      const result = await getPlaudCandidates(deps, id);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Stage 4 — attach a chosen Plaud note (merges its summary into the discussion notes).
  router.post('/session/:id/plaud-attach', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const recordingId = String(req.body?.recordingId ?? '').trim();
      if (!Number.isInteger(id) || !recordingId) { res.status(400).json({ ok: false, error: 'id and recordingId required' }); return; }
      const result = await attachPlaudNote(deps, id, recordingId);
      if (!result.ok) { res.status(502).json({ ok: false, error: result.error }); return; }
      res.json({ ok: true, data: { notes_text: result.notes_text } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Complete the session and schedule the next one.
  router.post('/session/:id/complete', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
      const nextDate = typeof req.body?.next_date === 'string' && DATE_RE.test(req.body.next_date) ? req.body.next_date : undefined;
      const result = await completeSession(id, nextDate);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  return router;
}
