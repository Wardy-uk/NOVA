import { Router } from 'express';
import type { CommitmentStatus } from '../db/team-standup-queries.js';
import {
  type StandupDeps,
  refreshBrief,
  importPlaudRecording,
  buildAccountabilityReport,
  runAccountabilityReport,
  sendMorningPrompts,
} from '../services/standup-service.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_COMMITMENT_STATUS = new Set<CommitmentStatus>(['pending', 'delivered', 'missed', 'excused']);

function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * PUBLIC standup routes — mounted at /api/standup BEFORE the auth middleware.
 * Only the agent-facing form endpoints live here; everything else falls through
 * (Router calls next()) to the authenticated manager router mounted later.
 */
export function createTeamStandupPublicRoutes(deps: StandupDeps): Router {
  const router = Router();
  const { standupQueries } = deps;

  // Bootstrap the public submission form. Optional ?agent= prefills their submission.
  router.get('/public/:date', async (req, res) => {
    const { date } = req.params;
    if (!DATE_RE.test(date)) { res.status(400).json({ ok: false, error: 'Invalid date' }); return; }
    try {
      const session = await standupQueries.ensureSession(date);
      const agentName = typeof req.query.agent === 'string' ? req.query.agent : null;
      let submission = null;
      if (agentName) {
        submission = (await standupQueries.getSubmissionByAgent(session.id, agentName)) ?? null;
      }
      const roster = await deps.getRoster().catch(() => []);
      res.json({
        ok: true,
        data: {
          date,
          status: session.status,
          editable: session.status === 'pending',
          agents: roster.map((a) => a.name),
          submission,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Agent submits (or updates) their standup.
  router.post('/submit', async (req, res) => {
    try {
      const { date, agent_name, ticket_count, over_5_count, oldest_ticket, oldest_age, blockers, notes } = req.body ?? {};
      const commitments: unknown = req.body?.commitments;

      if (!DATE_RE.test(date ?? '')) { res.status(400).json({ ok: false, error: 'Invalid date' }); return; }
      const roster = await deps.getRoster().catch(() => []);
      if (!agent_name || !roster.some((a) => a.name === agent_name)) {
        res.status(400).json({ ok: false, error: 'Please choose your name from the list.' });
        return;
      }
      const commitmentList = Array.isArray(commitments)
        ? commitments.map((c) => String(c).trim()).filter(Boolean)
        : [];
      if (commitmentList.length === 0) {
        res.status(400).json({ ok: false, error: 'Please add at least one commitment.' });
        return;
      }

      const session = await standupQueries.ensureSession(date);
      if (session.status !== 'pending') {
        res.status(409).json({ ok: false, error: 'Standup is already underway — submissions are closed for today.' });
        return;
      }

      const submissionId = await standupQueries.upsertSubmission({
        session_id: session.id,
        agent_name,
        ticket_count: toIntOrNull(ticket_count),
        over_5_count: toIntOrNull(over_5_count),
        oldest_ticket: oldest_ticket ? String(oldest_ticket).trim() : null,
        oldest_age: toIntOrNull(oldest_age),
        blockers: blockers ? String(blockers) : null,
        commitments_json: JSON.stringify(commitmentList),
        notes: notes ? String(notes) : null,
      });
      await standupQueries.replaceCommitments(submissionId, session.id, agent_name, commitmentList);

      res.json({ ok: true, data: { submissionId } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  return router;
}

/**
 * AUTHENTICATED manager routes — mounted at /api/standup behind NOVA auth.
 * This is Nick's view of the standup loop.
 */
export function createTeamStandupRoutes(deps: StandupDeps): Router {
  const router = Router();
  const { standupQueries } = deps;

  // List sessions (history picker).
  router.get('/sessions', async (_req, res) => {
    try {
      res.json({ ok: true, data: await standupQueries.listSessions() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Full session detail: session + submissions + commitments + report.
  router.get('/sessions/:date', async (req, res) => {
    const { date } = req.params;
    if (!DATE_RE.test(date)) { res.status(400).json({ ok: false, error: 'Invalid date' }); return; }
    try {
      const session = await standupQueries.ensureSession(date);
      const submissions = await standupQueries.getSubmissions(session.id);
      const commitments = await standupQueries.getCommitments(session.id);
      const report = await buildAccountabilityReport(date, deps);
      const brief = session.brief_json ? JSON.parse(session.brief_json) : null;
      const roster = await deps.getRoster().catch(() => []);
      res.json({ ok: true, data: { session: { ...session, brief_json: undefined }, brief, submissions, commitments, report, roster: roster.map((a) => a.name) } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Create or update a session (e.g. set status pending|active|complete).
  router.post('/sessions/:date', async (req, res) => {
    const { date } = req.params;
    if (!DATE_RE.test(date)) { res.status(400).json({ ok: false, error: 'Invalid date' }); return; }
    try {
      await standupQueries.ensureSession(date);
      const status = req.body?.status as string | undefined;
      if (status && !['pending', 'active', 'complete'].includes(status)) {
        res.status(400).json({ ok: false, error: 'Invalid status' });
        return;
      }
      if (status) await standupQueries.updateSession(date, { status: status as any });
      res.json({ ok: true, data: await standupQueries.getSession(date) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Submissions for a date.
  router.get('/submissions/:date', async (req, res) => {
    const { date } = req.params;
    if (!DATE_RE.test(date)) { res.status(400).json({ ok: false, error: 'Invalid date' }); return; }
    try {
      const session = await standupQueries.ensureSession(date);
      res.json({ ok: true, data: await standupQueries.getSubmissions(session.id) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Fetch/refresh the Jira brief (live) and persist it.
  router.get('/brief/:date', async (req, res) => {
    const { date } = req.params;
    if (!DATE_RE.test(date)) { res.status(400).json({ ok: false, error: 'Invalid date' }); return; }
    try {
      const brief = await refreshBrief(date, deps);
      res.json({ ok: true, data: brief });
    } catch (err) {
      res.status(502).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Trigger Plaud import for a date.
  router.post('/poll-plaud/:date', async (req, res) => {
    const { date } = req.params;
    if (!DATE_RE.test(date)) { res.status(400).json({ ok: false, error: 'Invalid date' }); return; }
    try {
      const result = await importPlaudRecording(date, deps);
      const session = await standupQueries.getSession(date);
      res.json({ ok: true, data: { ...result, session } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Accountability report for a date.
  router.get('/report/:date', async (req, res) => {
    const { date } = req.params;
    if (!DATE_RE.test(date)) { res.status(400).json({ ok: false, error: 'Invalid date' }); return; }
    try {
      const report = await buildAccountabilityReport(date, deps);
      res.json({ ok: true, data: report });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Update a commitment's review status (Nick's accountability action).
  router.patch('/commitments/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const status = req.body?.status as CommitmentStatus | undefined;
    const reviewNote = req.body?.review_note != null ? String(req.body.review_note) : null;
    if (!status || !VALID_COMMITMENT_STATUS.has(status)) {
      res.status(400).json({ ok: false, error: 'Invalid status' });
      return;
    }
    try {
      const ok = await standupQueries.updateCommitmentStatus(id, status, reviewNote);
      if (!ok) { res.status(404).json({ ok: false, error: 'Commitment not found' }); return; }
      res.json({ ok: true, data: await standupQueries.getCommitment(id) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Manually trigger the morning prompt emails.
  router.post('/send-prompts/:date', async (req, res) => {
    const { date } = req.params;
    if (!DATE_RE.test(date)) { res.status(400).json({ ok: false, error: 'Invalid date' }); return; }
    try {
      const result = await sendMorningPrompts(date, deps);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Manually run the accountability report + email (handy for testing).
  router.post('/run-report/:date', async (req, res) => {
    const { date } = req.params;
    if (!DATE_RE.test(date)) { res.status(400).json({ ok: false, error: 'Invalid date' }); return; }
    try {
      const result = await runAccountabilityReport(date, deps);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  return router;
}
