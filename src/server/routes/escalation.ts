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

  // Explicit rejection / bounce-back capture (KPX-WP5). Records a real
  // escalation_type='rejection' event so rejection_rate / escalation_accuracy can
  // be sourced honestly from captured data rather than inferred from tier moves.
  router.post('/rejection', requireRole('editor', 'admin', 'super_admin'), async (req: Request, res: Response) => {
    try {
      const { ticket_key, from_tier, to_tier, reason_code, reason_label, returned_to, notes } = req.body ?? {};
      if (!ticket_key || typeof ticket_key !== 'string') {
        res.status(400).json({ ok: false, error: 'ticket_key is required' });
        return;
      }
      const id = await escalationLog.logRejection({
        ticket_key,
        from_tier,
        to_tier,
        reason_code,
        reason_label,
        rejected_by: req.user?.username,
        returned_to,
        notes,
        source: 'manual',
      });
      res.json({ ok: true, data: { id } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to log rejection' });
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
