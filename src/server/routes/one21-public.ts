import { Router } from 'express';
import { getSessionByToken, isSubmissionEditable, saveAgentSubmission, displayDate, runDayBeforePrep, type One21Deps } from '../services/one21-service.js';
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

  return router;
}
