import { Router, type Request, type Response } from 'express';
import type { EscalationLogService } from '../services/escalation-log-service.js';
import type { JiraRestClient } from '../services/jira-client.js';
import { ManualEscalationService } from '../services/manual-escalation-service.js';
import { requireRole } from '../middleware/auth.js';

interface EscalationRouteDeps {
  escalationLog: EscalationLogService;
  jiraClient: JiraRestClient | null;
}

export function createEscalationRoutes(deps: EscalationRouteDeps): Router {
  const router = Router();
  const { escalationLog, jiraClient } = deps;
  const manualEscalation = jiraClient ? new ManualEscalationService(jiraClient, escalationLog) : null;

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

  // The reason vocabulary, for a picker. ?kind=urgency | capability.
  router.get('/reasons', async (req: Request, res: Response) => {
    if (!manualEscalation) {
      res.status(503).json({ ok: false, error: 'Jira client not available' });
      return;
    }
    try {
      const kind = req.query.kind as 'capability' | 'urgency' | undefined;
      if (kind && kind !== 'capability' && kind !== 'urgency') {
        res.status(400).json({ ok: false, error: 'kind must be capability or urgency' });
        return;
      }
      res.json({ ok: true, data: await manualEscalation.listReasons(kind) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // Manual escalation — "this needs to jump the queue".
  // Writes an INTERNAL-only Jira comment, tightens duedate (never extends it) and
  // raises priority to Critical (never lowers it), then logs the row.
  // admin+ only in v1 by decision; escalated_by comes from the JWT, never the body,
  // so opening this up later is a role change rather than a rewrite.
  router.post('/manual', requireRole('admin', 'super_admin'), async (req: Request, res: Response) => {
    if (!manualEscalation) {
      res.status(503).json({ ok: false, error: 'Jira client not available' });
      return;
    }
    const escalatedBy = req.user?.username;
    if (!escalatedBy) {
      res.status(401).json({ ok: false, error: 'No authenticated user' });
      return;
    }
    try {
      const { ticket_key, reason_code, needed_by, notes } = req.body ?? {};
      const data = await manualEscalation.escalate({
        ticket_key, reason_code, needed_by, notes, escalated_by: escalatedBy,
      });
      res.json({ ok: true, data });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to escalate';
      // Bad input from the caller vs a genuine failure — the client needs to tell them apart.
      const clientError = /required|Unknown reason_code|is retired|not found|must be YYYY-MM-DD/.test(msg);
      res.status(clientError ? 400 : 500).json({ ok: false, error: msg });
    }
  });

  // The route back (Q6). An escalation the assignee cannot contest is one they
  // come to resent, so a dispute is a first-class recorded event rather than a
  // conversation that happens somewhere else. editor+ — the assignee must be
  // able to use it, and they are not an admin.
  router.post('/:id/dispute', requireRole('editor', 'admin', 'super_admin'), async (req: Request, res: Response) => {
    try {
      const escalationId = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(escalationId)) {
        res.status(400).json({ ok: false, error: 'Invalid escalation id' });
        return;
      }
      const { ticket_key, reason } = req.body ?? {};
      if (!ticket_key || typeof ticket_key !== 'string') {
        res.status(400).json({ ok: false, error: 'ticket_key is required' });
        return;
      }
      if (!reason || typeof reason !== 'string') {
        res.status(400).json({ ok: false, error: 'reason is required — a dispute with no stated reason helps nobody' });
        return;
      }
      const id = await escalationLog.log({
        ticket_key,
        escalation_type: 'dispute',
        escalated_by: req.user?.username,
        disputes_escalation_id: escalationId,
        notes: reason,
        source: 'manual',
      });
      res.json({ ok: true, data: { id, disputes: escalationId } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to record dispute' });
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
