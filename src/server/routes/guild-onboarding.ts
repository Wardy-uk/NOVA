import { Router, type Request, type Response } from 'express';
import type { GuildDashboardService } from '../services/guild-dashboard.js';
import type { GuildOnboardingService } from '../services/guild-onboarding.js';
import type { OnboardingRecordQueries } from '../db/queries.js';
import { GUILD_MANUAL_FIELDS } from '../services/guild-onboarding-sla.js';

const MANUAL_KEYS = new Set(GUILD_MANUAL_FIELDS.map(f => f.key).concat('crmCreated'));

// Internal (BYM staff) dashboard + manual-field capture for Guild onboardings
// (backlog #8, R5/R6). Behind the global JWT auth middleware. Manual edits are
// gated off view-only roles; the exact role set is a BA decision (spec §7).
export function createGuildOnboardingRoutes(deps: {
  dashboard: GuildDashboardService;
  records: OnboardingRecordQueries;
  guild: GuildOnboardingService | null;
}): Router {
  const router = Router();

  router.get('/dashboard', async (req: Request, res: Response) => {
    try {
      const orgId = req.query.orgId ? parseInt(String(req.query.orgId), 10) : undefined;
      const data = await deps.dashboard.getDashboard({ orgId: Number.isFinite(orgId!) ? orgId : undefined });
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load dashboard' });
    }
  });

  router.get('/records/:id', async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    const record = await deps.records.getById(id);
    if (!record) { res.status(404).json({ ok: false, error: 'Not found' }); return; }
    res.json({ ok: true, data: record });
  });

  // R6 — staff edit the manual fields. Merges the patch into manual_fields JSON;
  // only known keys are accepted.
  router.patch('/records/:id/manual', async (req: Request, res: Response) => {
    const role = (req as { user?: { role?: string } }).user?.role;
    if (role === 'viewer') { res.status(403).json({ ok: false, error: 'View-only role cannot edit onboarding fields' }); return; }
    const id = parseInt(req.params.id as string, 10);
    const record = await deps.records.getById(id);
    if (!record) { res.status(404).json({ ok: false, error: 'Not found' }); return; }
    const patch = (req.body?.manualFields ?? req.body) as Record<string, unknown>;
    if (!patch || typeof patch !== 'object') { res.status(400).json({ ok: false, error: 'manualFields object required' }); return; }
    let current: Record<string, unknown> = {};
    try { current = record.manual_fields ? JSON.parse(record.manual_fields) : {}; } catch { current = {}; }
    for (const [k, v] of Object.entries(patch)) { if (MANUAL_KEYS.has(k)) current[k] = v; }
    await deps.records.update(id, { manual_fields: JSON.stringify(current) });
    res.json({ ok: true, data: current });
  });

  // Re-run creation for a partial/failed record — idempotent, safe to repeat.
  router.post('/records/:id/retry', async (req: Request, res: Response) => {
    if (!deps.guild) { res.status(503).json({ ok: false, error: 'Jira not configured' }); return; }
    const id = parseInt(req.params.id as string, 10);
    const record = await deps.records.getById(id);
    if (!record) { res.status(404).json({ ok: false, error: 'Not found' }); return; }
    try {
      const result = await deps.guild.createForRecord(record);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Retry failed' });
    }
  });

  return router;
}
