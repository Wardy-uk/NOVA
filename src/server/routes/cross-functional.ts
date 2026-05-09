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

  return router;
}
