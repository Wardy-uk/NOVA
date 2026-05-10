import { Router } from 'express';
import type { CrossFunctionalIntelligence } from '../services/cross-functional-intelligence.js';

export function createCrossFunctionalRoutes(crossFunc: CrossFunctionalIntelligence): Router {
  const router = Router();

  router.get('/signals', async (req, res) => {
    try {
      const signalType = req.query.type as string | undefined;
      const limit = parseInt((req.query.limit as string) ?? '50', 10);
      const signals = await crossFunc.getSignals(signalType, limit);
      res.json({ ok: true, data: signals });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get signals' });
    }
  });

  router.get('/report', async (_req, res) => {
    try {
      const report = await crossFunc.getLatestReport();
      res.json({ ok: true, data: report });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get report' });
    }
  });

  router.get('/export', async (_req, res) => {
    try {
      const markdown = await crossFunc.exportMarkdown();
      res.setHeader('Content-Type', 'text/markdown');
      res.setHeader('Content-Disposition', 'attachment; filename="cross-functional-report.md"');
      res.send(markdown);
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Export failed' });
    }
  });

  router.post('/generate', async (_req, res) => {
    try {
      const count = await crossFunc.generateMonthlyReport();
      res.json({ ok: true, data: { signals_generated: count } });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Generation failed' });
    }
  });

  // Gap 7: Actionable workflow endpoints

  router.put('/:id/assign', async (req, res) => {
    try {
      const { owner } = req.body;
      if (!owner) { res.status(400).json({ ok: false, error: 'owner is required' }); return; }
      await crossFunc.assignOwner(parseInt(req.params.id, 10), owner);
      res.json({ ok: true });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Assign failed' });
    }
  });

  router.put('/:id/status', async (req, res) => {
    try {
      const { status, outcome } = req.body;
      if (!status) { res.status(400).json({ ok: false, error: 'status is required' }); return; }
      await crossFunc.updateStatus(parseInt(req.params.id, 10), status, outcome);
      res.json({ ok: true });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Status update failed' });
    }
  });

  router.put('/:id/dismiss', async (req, res) => {
    try {
      const { reason } = req.body;
      await crossFunc.dismiss(parseInt(req.params.id, 10), reason || 'No reason provided');
      res.json({ ok: true });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Dismiss failed' });
    }
  });

  router.put('/:id/volume-after', async (req, res) => {
    try {
      const { volume_after } = req.body;
      if (typeof volume_after !== 'number') { res.status(400).json({ ok: false, error: 'volume_after (number) is required' }); return; }
      await crossFunc.recordVolumeAfter(parseInt(req.params.id, 10), volume_after);
      res.json({ ok: true });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Update failed' });
    }
  });

  return router;
}
