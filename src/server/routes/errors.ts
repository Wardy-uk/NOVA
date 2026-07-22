import { Router, type Request, type Response } from 'express';
import { getRecentErrors, getErrorSummary, resolveError, type ErrorSeverity } from '../services/error-log.js';

// Centralised error log API — powers the admin Errors view and the NOVA MCP
// query tool. Read-only listing + summary, plus a resolve action.
export function createErrorRoutes(): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    try {
      const { source, severity, resolved, sinceHours, limit } = req.query as Record<string, string>;
      const rows = await getRecentErrors({
        source: source || undefined,
        severity: (severity as ErrorSeverity) || undefined,
        resolved: resolved === 'true' ? true : resolved === 'false' ? false : undefined,
        sinceHours: sinceHours ? parseInt(sinceHours, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      res.json({ ok: true, data: rows });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load errors' });
    }
  });

  router.get('/summary', async (req: Request, res: Response) => {
    try {
      const sinceHours = req.query.sinceHours ? parseInt(req.query.sinceHours as string, 10) : 24;
      res.json({ ok: true, data: await getErrorSummary(sinceHours) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load summary' });
    }
  });

  router.post('/:id/resolve', async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (!id) { res.status(400).json({ ok: false, error: 'Valid id required' }); return; }
    try {
      await resolveError(id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to resolve' });
    }
  });

  return router;
}
