import { Router } from 'express';
import { OnboardingPayloadSchema, type OnboardingOrchestrator } from '../services/onboarding-orchestrator.js';
import type { JiraRestClient } from '../services/jira-client.js';
import type { OnboardingRunQueries } from '../db/queries.js';

export function createOnboardingRoutes(
  getOrchestrator: () => OnboardingOrchestrator | null,
  getJiraClient: () => JiraRestClient | null,
  runQueries: OnboardingRunQueries
): Router {
  const router = Router();

  // POST /api/onboarding/create-tickets — main endpoint
  router.post('/create-tickets', async (req, res) => {
    const orchestrator = getOrchestrator();
    if (!orchestrator) {
      res.status(503).json({ ok: false, error: 'Jira not configured. Set Jira credentials in Settings.' });
      return;
    }

    const parsed = OnboardingPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.message });
      return;
    }

    const dryRun = req.query.dryRun === 'true';
    const userId = (req as any).user?.id;

    try {
      const result = await orchestrator.execute(parsed.data, { dryRun, userId });
      res.json({ ok: true, data: result });
    } catch (err) {
      console.error('[Onboarding] create-tickets error:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Ticket creation failed' });
    }
  });

  // GET /api/onboarding/status/:ref — check run status
  router.get('/status/:ref', (req, res) => {
    const ref = req.params.ref;
    const runs = runQueries.getAllByRef(ref);
    if (runs.length === 0) {
      res.status(404).json({ ok: false, error: 'No runs found for this reference' });
      return;
    }
    res.json({
      ok: true,
      data: {
        latest: runs[0],
        history: runs,
      },
    });
  });

  // GET /api/onboarding/runs — list recent runs
  router.get('/runs', (req, res) => {
    const limit = parseInt(req.query.limit as string, 10) || 20;
    res.json({ ok: true, data: runQueries.getRecent(limit) });
  });

  // GET /api/onboarding/jira-meta — discover field IDs and request types
  router.get('/jira-meta', async (_req, res) => {
    const client = getJiraClient();
    if (!client) {
      res.status(503).json({ ok: false, error: 'Jira not configured' });
      return;
    }

    try {
      const [createMeta, linkTypes] = await Promise.all([
        client.getCreateMeta('NT').catch(() => null),
        client.getLinkTypes().catch(() => null),
      ]);

      res.json({
        ok: true,
        data: {
          createMeta,
          linkTypes: linkTypes?.issueLinkTypes ?? [],
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to fetch Jira metadata' });
    }
  });

  return router;
}
