import { Router } from 'express';
import { z } from 'zod';
import type { BrandSettingsQueries } from '../db/queries.js';

export function createBrandSettingsRoutes(brandSettingsQueries: BrandSettingsQueries): Router {
  const router = Router();

  // GET /delivery/:id — get all brand settings for a delivery
  router.get('/delivery/:id', (req, res) => {
    const deliveryId = Number(req.params.id);
    if (!deliveryId) { res.status(400).json({ ok: false, error: 'Invalid delivery ID' }); return; }
    const settings = brandSettingsQueries.getByDelivery(deliveryId);
    res.json({ ok: true, data: settings });
  });

  // PUT /delivery/:id — bulk upsert settings
  router.put('/delivery/:id', (req, res) => {
    const deliveryId = Number(req.params.id);
    if (!deliveryId) { res.status(400).json({ ok: false, error: 'Invalid delivery ID' }); return; }
    const parsed = z.object({
      settings: z.record(z.string(), z.string().nullable()),
    }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    const count = brandSettingsQueries.bulkUpsert(deliveryId, parsed.data.settings);
    const settings = brandSettingsQueries.getByDelivery(deliveryId);
    res.json({ ok: true, data: settings, updated: count });
  });

  // PATCH /delivery/:id/:key — update a single setting
  router.patch('/delivery/:id/:key', (req, res) => {
    const deliveryId = Number(req.params.id);
    const key = req.params.key;
    if (!deliveryId || !key) { res.status(400).json({ ok: false, error: 'Invalid parameters' }); return; }
    const parsed = z.object({ value: z.string().nullable() }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    brandSettingsQueries.upsert(deliveryId, key, parsed.data.value);
    res.json({ ok: true });
  });

  // DELETE /delivery/:id — delete all brand settings for a delivery
  router.delete('/delivery/:id', (req, res) => {
    const deliveryId = Number(req.params.id);
    if (!deliveryId) { res.status(400).json({ ok: false, error: 'Invalid delivery ID' }); return; }
    brandSettingsQueries.deleteByDelivery(deliveryId);
    res.json({ ok: true });
  });

  return router;
}
