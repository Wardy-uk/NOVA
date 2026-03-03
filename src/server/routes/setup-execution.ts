import { Router } from 'express';
import type { SetupExecutionQueries } from '../db/queries.js';
import type { SetupOrchestrator } from '../services/setup-orchestrator.js';

export function createSetupExecutionRoutes(
  execQueries: SetupExecutionQueries,
  getOrchestrator: () => SetupOrchestrator,
): Router {
  const router = Router();

  /** Start a full execution run */
  router.post('/delivery/:id/execute', async (req, res) => {
    const deliveryId = parseInt(String(req.params.id), 10);
    const userId = (req as any).user?.id ?? null;

    try {
      const orchestrator = getOrchestrator();
      const result = await orchestrator.execute(deliveryId, userId);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Execution failed' });
    }
  });

  /** Dry-run validation */
  router.post('/delivery/:id/execute/dry-run', async (req, res) => {
    const deliveryId = parseInt(String(req.params.id), 10);
    const userId = (req as any).user?.id ?? null;

    try {
      const orchestrator = getOrchestrator();
      const result = await orchestrator.execute(deliveryId, userId, { dryRun: true });
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Dry run failed' });
    }
  });

  /** List execution runs for a delivery */
  router.get('/delivery/:id/runs', (req, res) => {
    const deliveryId = parseInt(String(req.params.id), 10);
    const runs = execQueries.getRunsByDelivery(deliveryId);
    res.json({ ok: true, data: runs });
  });

  /** Get logs for a specific run */
  router.get('/runs/:runId/logs', (req, res) => {
    const runId = parseInt(String(req.params.runId), 10);
    const logs = execQueries.getLogsByRun(runId);
    res.json({ ok: true, data: logs });
  });

  /** Get latest run status for a delivery */
  router.get('/delivery/:id/latest-run', (req, res) => {
    const deliveryId = parseInt(String(req.params.id), 10);
    const run = execQueries.getLatestRun(deliveryId);
    res.json({ ok: true, data: run });
  });

  return router;
}
