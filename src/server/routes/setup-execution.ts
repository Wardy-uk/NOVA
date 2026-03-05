import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { SetupExecutionQueries, BranchQueries, BrandSettingsQueries, LogoQueries, DeliveryQueries } from '../db/queries.js';
import type { SetupOrchestrator } from '../services/setup-orchestrator.js';
import type { AzDoClient } from '../services/azdo-client.js';
import { TemplateBuilder } from '../services/template-builder.js';

/** Extract just the subdomain from a value that might be a full URL or plain name. */
function extractSubdomain(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    return url.hostname.split('.')[0];
  } catch {
    return trimmed;
  }
}

export function createSetupExecutionRoutes(
  execQueries: SetupExecutionQueries,
  getOrchestrator: () => SetupOrchestrator,
  deps: {
    getAzdo: () => AzDoClient | null;
    templateDir: string;
    brandQueries: BrandSettingsQueries;
    branchQueries: BranchQueries;
    logoQueries: LogoQueries;
    deliveryQueries: DeliveryQueries;
    requireAreaAccess: (area: string, level: 'view' | 'edit') => RequestHandler;
  },
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

  /** Push templates to AzDO (standalone, role-gated by azdo_push) */
  router.post('/delivery/:id/push-templates', deps.requireAreaAccess('azdo_push', 'edit'), async (req, res) => {
    const deliveryId = parseInt(String(req.params.id), 10);

    try {
      const azdo = deps.getAzdo();
      if (!azdo) {
        res.status(400).json({ ok: false, error: 'Azure DevOps not configured. Set up in Admin > Integrations.' });
        return;
      }

      // Load delivery data
      const entries = deps.deliveryQueries.getAll();
      const delivery = entries.find(e => e.id === deliveryId);
      if (!delivery) {
        res.status(404).json({ ok: false, error: 'Delivery not found' });
        return;
      }

      const brandSettings = deps.brandQueries.getByDelivery(deliveryId);
      const branches = deps.branchQueries.getByDelivery(deliveryId);
      const logoMeta = deps.logoQueries.getMetadataByDelivery(deliveryId);
      const fullLogos = logoMeta.map(l => deps.logoQueries.getById(l.id)).filter(Boolean) as import('../db/queries.js').DeliveryLogo[];

      const rawSubdomain = brandSettings['subdomain'];
      const subdomain = rawSubdomain ? extractSubdomain(rawSubdomain) : undefined;
      if (!subdomain) {
        res.status(400).json({ ok: false, error: 'Subdomain not set in brand settings' });
        return;
      }

      const domain = `${subdomain}.briefyourmarket.com`;

      // Build file changes
      const builder = new TemplateBuilder(deps.templateDir);
      const fileChanges = await builder.buildFileChanges({
        domain,
        subdomain,
        brandSettings,
        branches,
        logos: fullLogos,
      });

      // Push to AzDO
      const now = new Date();
      const pad2 = (n: number) => String(n).padStart(2, '0');
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const dateStr = `${pad2(now.getDate())}${months[now.getMonth()]}${now.getFullYear()}${pad2(now.getHours())}-${pad2(now.getMinutes())}`;
      const branchName = `onboarding-automation/${subdomain}-${dateStr}`;

      const push = await azdo.pushCommit({
        branchName,
        files: fileChanges,
        commitMessage: `Created new template set for instance: ${subdomain}`,
        createBranch: true,
      });

      const pr = await azdo.createPullRequest({
        sourceBranch: branchName,
        title: `New template set: ${subdomain}`,
        description: `Automated template push from N.O.V.A for ${subdomain}.\n\n${fileChanges.length} files.`,
      });

      res.json({
        ok: true,
        data: {
          fileCount: fileChanges.length,
          branchName,
          commitId: push.commitId,
          prId: pr.pullRequestId,
          prUrl: pr.webUrl,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Push failed' });
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
