import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import type { LogoQueries } from '../db/queries.js';
import { LOGO_TYPE_DEFS } from '../../shared/brand-settings-defs.js';

export function createLogoRoutes(logoQueries: LogoQueries): Router {
  const router = Router();

  // Override body parser limit for logo uploads (base64 images can be >100KB)
  router.use(express.json({ limit: '2mb' }));

  // GET /delivery/:id — get logo metadata (no image_data) for a delivery
  router.get('/delivery/:id', (req, res) => {
    const deliveryId = Number(req.params.id);
    if (!deliveryId) { res.status(400).json({ ok: false, error: 'Invalid delivery ID' }); return; }
    const logos = logoQueries.getMetadataByDelivery(deliveryId);
    res.json({ ok: true, data: logos });
  });

  // GET /delivery/:id/type/:type — get a single logo with full base64 data
  router.get('/delivery/:id/type/:type', (req, res) => {
    const deliveryId = Number(req.params.id);
    const logoType = Number(req.params.type);
    if (!deliveryId || isNaN(logoType)) { res.status(400).json({ ok: false, error: 'Invalid parameters' }); return; }
    const logo = logoQueries.getByDeliveryAndType(deliveryId, logoType);
    if (!logo) { res.status(404).json({ ok: false, error: 'Logo not found' }); return; }
    res.json({ ok: true, data: logo });
  });

  // GET /:logoId/image — serve as binary image for <img src>
  router.get('/:logoId/image', (req, res) => {
    const logoId = Number(req.params.logoId);
    if (!logoId) { res.status(400).json({ ok: false, error: 'Invalid logo ID' }); return; }
    const logo = logoQueries.getById(logoId);
    if (!logo) { res.status(404).json({ ok: false, error: 'Logo not found' }); return; }
    const buffer = Buffer.from(logo.image_data, 'base64');
    res.set('Content-Type', logo.mime_type);
    res.set('Content-Length', String(buffer.length));
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  });

  // PUT /delivery/:id/type/:type — upload/replace a logo
  router.put('/delivery/:id/type/:type', (req, res) => {
    const deliveryId = Number(req.params.id);
    const logoType = Number(req.params.type);
    if (!deliveryId || isNaN(logoType)) { res.status(400).json({ ok: false, error: 'Invalid parameters' }); return; }

    const typeDef = LOGO_TYPE_DEFS.find(d => d.type === logoType);
    if (!typeDef) { res.status(400).json({ ok: false, error: 'Invalid logo type' }); return; }

    const parsed = z.object({
      image_data: z.string().min(1),
      mime_type: z.string().optional(),
      file_name: z.string().optional(),
      file_size: z.number().optional(),
    }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }

    const mime = parsed.data.mime_type || 'image/png';
    const allowed = ['image/png', 'image/jpeg', 'image/svg+xml'];
    if (!allowed.includes(mime)) {
      res.status(400).json({ ok: false, error: `Unsupported image type: ${mime}. Allowed: ${allowed.join(', ')}` });
      return;
    }

    const id = logoQueries.upsert({
      delivery_id: deliveryId,
      logo_type: logoType,
      logo_label: typeDef.label,
      mime_type: mime,
      image_data: parsed.data.image_data,
      file_name: parsed.data.file_name,
      file_size: parsed.data.file_size,
    });

    const logos = logoQueries.getMetadataByDelivery(deliveryId);
    res.json({ ok: true, data: logos, id });
  });

  // DELETE /delivery/:id/type/:type — delete a logo
  router.delete('/delivery/:id/type/:type', (req, res) => {
    const deliveryId = Number(req.params.id);
    const logoType = Number(req.params.type);
    if (!deliveryId || isNaN(logoType)) { res.status(400).json({ ok: false, error: 'Invalid parameters' }); return; }
    const deleted = logoQueries.deleteByDeliveryAndType(deliveryId, logoType);
    if (!deleted) { res.status(404).json({ ok: false, error: 'Logo not found' }); return; }
    const logos = logoQueries.getMetadataByDelivery(deliveryId);
    res.json({ ok: true, data: logos });
  });

  return router;
}
