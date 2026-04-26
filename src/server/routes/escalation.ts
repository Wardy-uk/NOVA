import { Router, type Request, type Response } from 'express';
import type { EscalationLogService } from '../services/escalation-log-service.js';
import type { JiraRestClient } from '../services/jira-client.js';
import { requireRole } from '../middleware/auth.js';

interface EscalationRouteDeps {
  escalationLog: EscalationLogService;
  jiraClient: JiraRestClient | null;
}

export function createEscalationRoutes(deps: EscalationRouteDeps): Router {
  const router = Router();
  const { escalationLog, jiraClient } = deps;

  router.get('/', async (req: Request, res: Response) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const type = req.query.type as string | undefined;
      const tier = req.query.tier as string | undefined;
      const data = await escalationLog.getAll({ days, type, tier });
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  router.get('/stats', async (req: Request, res: Response) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const data = await escalationLog.getStats(days);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  router.post('/backfill', requireRole('admin', 'super_admin'), async (req: Request, res: Response) => {
    if (!jiraClient) {
      res.status(503).json({ ok: false, error: 'Jira client not available' });
      return;
    }
    try {
      const { startDate, endDate, project } = req.body;
      const start = startDate || '2025-11-01';
      const end = endDate || new Date().toISOString().slice(0, 10);
      const proj = project || 'NT';

      const jql = `project = ${proj} AND status changed DURING ("${start}", "${end}") ORDER BY created ASC`;
      const result = await jiraClient.searchJql(jql, ['key', 'summary'], 500);
      const issues = result?.issues ?? [];

      let totalInserted = 0;
      const errors: string[] = [];

      for (const issue of issues) {
        try {
          const changelog = await jiraClient.getChangelog(issue.key);
          const inserted = await escalationLog.backfillFromChangelog(issue.key, changelog);
          totalInserted += inserted;
        } catch (e) {
          errors.push(`${issue.key}: ${e instanceof Error ? e.message : 'unknown error'}`);
        }
      }

      res.json({
        ok: true,
        data: {
          issuesScanned: issues.length,
          escalationsRecorded: totalInserted,
          errors: errors.slice(0, 20),
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Backfill failed' });
    }
  });

  return router;
}
