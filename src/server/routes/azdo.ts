import { Router } from 'express';
import type { AzDoClient, FileChange } from '../services/azdo-client.js';
import type { BrandSettingsQueries, LogoQueries, DeliveryQueries, InstanceSetupQueries } from '../db/queries.js';
import { LOGO_TYPE_DEFS } from '../../shared/brand-settings-defs.js';

export function createAzDoRoutes(
  getClient: () => AzDoClient | null,
  brandQueries: BrandSettingsQueries,
  logoQueries: LogoQueries,
  deliveryQueries: DeliveryQueries,
  setupQueries: InstanceSetupQueries,
): Router {
  const router = Router();

  /** Test AzDO connection */
  router.post('/test', async (_req, res) => {
    const client = getClient();
    if (!client) { res.status(400).json({ ok: false, error: 'Azure DevOps not configured' }); return; }
    try {
      const info = await client.testConnection();
      res.json({ ok: true, data: info });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Connection failed' });
    }
  });

  /** Push brand settings + logos to AzDO and create PR */
  router.post('/delivery/:id/push', async (req, res) => {
    const client = getClient();
    if (!client) { res.status(400).json({ ok: false, error: 'Azure DevOps not configured' }); return; }

    const deliveryId = parseInt(String(req.params.id), 10);
    const userId = (req as any).user?.id;

    try {
      const entries = deliveryQueries.getAll();
      const delivery = entries.find(e => e.id === deliveryId);
      if (!delivery) { res.status(404).json({ ok: false, error: 'Delivery not found' }); return; }

      const brandSettings = brandQueries.getByDelivery(deliveryId);
      const subdomain = brandSettings['subdomain'];
      if (!subdomain) { res.status(400).json({ ok: false, error: 'Subdomain not set in brand settings' }); return; }

      const branches = (deliveryQueries as any).getAll ? [] : []; // branches from separate query
      const logos = logoQueries.getMetadataByDelivery(deliveryId);
      const deliveryRef = delivery.onboarding_id || delivery.account || `delivery-${deliveryId}`;

      // Build files
      const files: FileChange[] = [];
      files.push({ path: `/${subdomain}/brand.json`, content: JSON.stringify(brandSettings, null, 2) });

      for (const logoMeta of logos) {
        const full = logoQueries.getById(logoMeta.id);
        if (full) {
          const typeDef = LOGO_TYPE_DEFS.find(t => t.type === logoMeta.logo_type);
          const ext = logoMeta.mime_type === 'image/svg+xml' ? 'svg' : logoMeta.mime_type === 'image/png' ? 'png' : 'jpg';
          const fileName = typeDef ? `${typeDef.key}.${ext}` : `logo-${logoMeta.logo_type}.${ext}`;
          files.push({
            path: `/${subdomain}/images/${fileName}`,
            content: full.image_data,
            contentType: 'base64encoded',
          });
        }
      }

      const result = await client.pushBrandSettingsAndCreatePR(deliveryRef, files);
      deliveryQueries.updateAzDoFields(deliveryId, result.branchName, result.prUrl);

      // Update setup step if exists
      setupQueries.updateStepStatus(deliveryId, 'azdo_push', 'complete', `PR: ${result.prUrl}`, userId);

      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Push failed' });
    }
  });

  /** Get AzDO push status for a delivery */
  router.get('/delivery/:id/status', (req, res) => {
    const deliveryId = parseInt(String(req.params.id), 10);
    const entries = deliveryQueries.getAll();
    const delivery = entries.find(e => e.id === deliveryId);
    if (!delivery) { res.status(404).json({ ok: false, error: 'Delivery not found' }); return; }

    res.json({
      ok: true,
      data: {
        azdo_branch_name: (delivery as any).azdo_branch_name || null,
        azdo_pr_url: (delivery as any).azdo_pr_url || null,
      },
    });
  });

  return router;
}
