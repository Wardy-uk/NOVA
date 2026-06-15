import { Router } from 'express';
import type { OpsPackService } from '../services/ops-pack.js';
import { query } from '../services/database.js';

export function createOpsPackRoutes(opsPack: OpsPackService): Router {
  const router = Router();

  // TEMP diagnostic — what does the LIVE process's pool actually see for jira_issue_cache?
  router.get('/_diag', async (_req, res) => {
    try {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const ident = await query(`SELECT SUSER_SNAME() AS login_name, DB_NAME() AS db, @@SERVERNAME AS srv, SYSUTCDATETIME() AS sql_utc`);
      const rawTotal = await query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM jira_issue_cache`);
      const byNt = await query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM jira_issue_cache WHERE project_key = ?`, ['NT']);
      const withDate = await query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM jira_issue_cache WHERE project_key = ? AND jira_created >= ?`, ['NT', since]);
      const projKeys = await query(`SELECT project_key, COUNT(*) AS cnt FROM jira_issue_cache GROUP BY project_key`);
      res.json({
        ok: true,
        data: {
          identity: ident[0],
          node_now: new Date().toISOString(),
          since: since.toISOString(),
          jira_issue_cache_total: rawTotal[0]?.cnt,
          jira_issue_cache_NT: byNt[0]?.cnt,
          jira_issue_cache_NT_last7d: withDate[0]?.cnt,
          project_keys: projKeys,
        },
      });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'diag failed', stack: err instanceof Error ? err.stack : undefined });
    }
  });

  router.post('/generate', async (req, res) => {
    try {
      const userId = req.user?.id ?? null;
      const pack = await opsPack.generate(userId);
      res.json({ ok: true, data: pack });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to generate ops pack' });
    }
  });

  router.get('/latest', async (_req, res) => {
    try {
      const pack = await opsPack.getLatest();
      res.json({ ok: true, data: pack });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get latest pack' });
    }
  });

  router.get('/history', async (req, res) => {
    try {
      const limit = parseInt((req.query.limit as string) ?? '10', 10);
      const history = await opsPack.getHistory(limit);
      res.json({ ok: true, data: history });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get history' });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const pack = await opsPack.getById(parseInt(req.params.id, 10));
      if (!pack) { res.json({ ok: false, error: 'Pack not found' }); return; }
      res.json({ ok: true, data: pack });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get pack' });
    }
  });

  return router;
}
