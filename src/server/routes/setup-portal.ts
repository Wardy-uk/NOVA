/**
 * Customer Setup Portal routes.
 *
 * Public routes — token-validated, no NOVA auth required.
 * Internal routes — behind NOVA auth, for managing tokens.
 */

import { Router } from 'express';
import express from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import type { SetupPortalQueries } from '../db/queries.js';
import type { BrandSettingsQueries, BranchQueries, LogoQueries, DeliveryQueries } from '../db/queries.js';
import { BRAND_SETTING_DEFS, BRAND_SETTING_GROUPS, LOGO_TYPE_DEFS } from '../../shared/brand-settings-defs.js';
import { EmailService } from '../services/email.js';
import { setupPortalHtml } from '../services/email-templates.js';

// ─── Public Routes (before auth middleware) ─────────────────────────────────

interface PortalRequest extends express.Request {
  portalToken?: { id: number; delivery_id: number; token: string; completed_at: string | null };
}

export function createSetupPortalPublicRoutes(
  portalQueries: SetupPortalQueries,
  brandQueries: BrandSettingsQueries,
  branchQueries: BranchQueries,
  logoQueries: LogoQueries,
  deliveryQueries: DeliveryQueries,
): Router {
  const router = Router();

  // 2MB body limit for logo uploads
  router.use(express.json({ limit: '2mb' }));

  // Token validation middleware
  router.use((req: PortalRequest, res, next) => {
    const token = req.query.token as string;
    if (!token || typeof token !== 'string' || token.length !== 64) {
      res.status(401).json({ ok: false, error: 'Invalid or missing token' });
      return;
    }
    const record = portalQueries.getByToken(token);
    if (!record) {
      res.status(401).json({ ok: false, error: 'expired', message: 'This link has expired or is no longer valid.' });
      return;
    }
    req.portalToken = {
      id: record.id,
      delivery_id: record.delivery_id,
      token: record.token,
      completed_at: record.completed_at,
    };
    // Update last accessed timestamp (fire-and-forget)
    portalQueries.updateLastAccessed(token);
    next();
  });

  // GET /info — delivery summary, brand defs, logo types, progress
  router.get('/info', (req: PortalRequest, res) => {
    const did = req.portalToken!.delivery_id;
    const entries = deliveryQueries.getAll();
    const delivery = entries.find(e => e.id === did);
    if (!delivery) { res.status(404).json({ ok: false, error: 'Delivery not found' }); return; }

    const tokenRecord = portalQueries.getByToken(req.portalToken!.token);
    res.json({
      ok: true,
      data: {
        account: delivery.account,
        product: delivery.product,
        completed_at: req.portalToken!.completed_at,
        progress: JSON.parse(tokenRecord?.progress_json || '{}'),
        brandSettingDefs: BRAND_SETTING_DEFS,
        brandSettingGroups: BRAND_SETTING_GROUPS,
        logoTypeDefs: LOGO_TYPE_DEFS,
      },
    });
  });

  // GET /brand-settings — current brand settings
  router.get('/brand-settings', (req: PortalRequest, res) => {
    const settings = brandQueries.getByDelivery(req.portalToken!.delivery_id);
    res.json({ ok: true, data: settings });
  });

  // PUT /brand-settings — bulk upsert
  router.put('/brand-settings', (req: PortalRequest, res) => {
    if (req.portalToken!.completed_at) { res.status(400).json({ ok: false, error: 'This form has already been submitted' }); return; }
    const parsed = z.object({ settings: z.record(z.string(), z.string().nullable()) }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    const count = brandQueries.bulkUpsert(req.portalToken!.delivery_id, parsed.data.settings);
    res.json({ ok: true, updated: count });
  });

  // PATCH /brand-settings/:key — single field auto-save
  router.patch('/brand-settings/:key', (req: PortalRequest, res) => {
    if (req.portalToken!.completed_at) { res.status(400).json({ ok: false, error: 'This form has already been submitted' }); return; }
    const key = String(req.params.key);
    const parsed = z.object({ value: z.string().nullable() }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    brandQueries.upsert(req.portalToken!.delivery_id, key, parsed.data.value);
    res.json({ ok: true });
  });

  // GET /branches — list branches
  router.get('/branches', (req: PortalRequest, res) => {
    const branches = branchQueries.getByDelivery(req.portalToken!.delivery_id);
    res.json({ ok: true, data: branches });
  });

  // POST /branches — create branch
  router.post('/branches', (req: PortalRequest, res) => {
    if (req.portalToken!.completed_at) { res.status(400).json({ ok: false, error: 'This form has already been submitted' }); return; }
    const parsed = z.object({
      name: z.string().min(1),
      is_default: z.number().optional(),
      sales_email: z.string().nullable().optional(),
      sales_phone: z.string().nullable().optional(),
      lettings_email: z.string().nullable().optional(),
      lettings_phone: z.string().nullable().optional(),
      address1: z.string().nullable().optional(),
      address2: z.string().nullable().optional(),
      address3: z.string().nullable().optional(),
      town: z.string().nullable().optional(),
      post_code1: z.string().nullable().optional(),
      post_code2: z.string().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }

    const id = branchQueries.create({
      delivery_id: req.portalToken!.delivery_id,
      is_default: parsed.data.is_default ?? 0,
      name: parsed.data.name,
      sales_email: parsed.data.sales_email ?? null,
      sales_phone: parsed.data.sales_phone ?? null,
      lettings_email: parsed.data.lettings_email ?? null,
      lettings_phone: parsed.data.lettings_phone ?? null,
      address1: parsed.data.address1 ?? null,
      address2: parsed.data.address2 ?? null,
      address3: parsed.data.address3 ?? null,
      town: parsed.data.town ?? null,
      post_code1: parsed.data.post_code1 ?? null,
      post_code2: parsed.data.post_code2 ?? null,
      sort_order: 0,
    });
    const branches = branchQueries.getByDelivery(req.portalToken!.delivery_id);
    res.json({ ok: true, data: branches, id });
  });

  // PUT /branches/:id — update branch
  router.put('/branches/:id', (req: PortalRequest, res) => {
    if (req.portalToken!.completed_at) { res.status(400).json({ ok: false, error: 'This form has already been submitted' }); return; }
    const branchId = Number(req.params.id);
    const branch = branchQueries.getById(branchId);
    if (!branch || branch.delivery_id !== req.portalToken!.delivery_id) {
      res.status(404).json({ ok: false, error: 'Branch not found' });
      return;
    }
    const { delivery_id, id, created_at, ...rest } = req.body;
    branchQueries.update(branchId, rest);
    const branches = branchQueries.getByDelivery(req.portalToken!.delivery_id);
    res.json({ ok: true, data: branches });
  });

  // DELETE /branches/:id — delete branch
  router.delete('/branches/:id', (req: PortalRequest, res) => {
    if (req.portalToken!.completed_at) { res.status(400).json({ ok: false, error: 'This form has already been submitted' }); return; }
    const branchId = Number(req.params.id);
    const branch = branchQueries.getById(branchId);
    if (!branch || branch.delivery_id !== req.portalToken!.delivery_id) {
      res.status(404).json({ ok: false, error: 'Branch not found' });
      return;
    }
    branchQueries.delete(branchId);
    const branches = branchQueries.getByDelivery(req.portalToken!.delivery_id);
    res.json({ ok: true, data: branches });
  });

  // GET /logos — logo metadata
  router.get('/logos', (req: PortalRequest, res) => {
    const logos = logoQueries.getMetadataByDelivery(req.portalToken!.delivery_id);
    res.json({ ok: true, data: logos });
  });

  // GET /logos/:id/image — serve logo as binary image (public, token-validated)
  router.get('/logos/:id/image', (req: PortalRequest, res) => {
    const logoId = Number(req.params.id);
    if (!logoId) { res.status(400).json({ ok: false, error: 'Invalid logo ID' }); return; }
    const logo = logoQueries.getById(logoId);
    if (!logo || logo.delivery_id !== req.portalToken!.delivery_id) {
      res.status(404).json({ ok: false, error: 'Logo not found' });
      return;
    }
    const buffer = Buffer.from(logo.image_data, 'base64');
    res.set('Content-Type', logo.mime_type);
    res.set('Content-Length', String(buffer.length));
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  });

  // PUT /logos/:type — upload logo
  router.put('/logos/:type', (req: PortalRequest, res) => {
    if (req.portalToken!.completed_at) { res.status(400).json({ ok: false, error: 'This form has already been submitted' }); return; }
    const logoType = Number(req.params.type);
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
      res.status(400).json({ ok: false, error: `Unsupported image type: ${mime}` });
      return;
    }

    logoQueries.upsert({
      delivery_id: req.portalToken!.delivery_id,
      logo_type: logoType,
      logo_label: typeDef.label,
      mime_type: mime,
      image_data: parsed.data.image_data,
      file_name: parsed.data.file_name,
      file_size: parsed.data.file_size,
    });
    const logos = logoQueries.getMetadataByDelivery(req.portalToken!.delivery_id);
    res.json({ ok: true, data: logos });
  });

  // DELETE /logos/:type — delete logo
  router.delete('/logos/:type', (req: PortalRequest, res) => {
    if (req.portalToken!.completed_at) { res.status(400).json({ ok: false, error: 'This form has already been submitted' }); return; }
    const logoType = Number(req.params.type);
    logoQueries.deleteByDeliveryAndType(req.portalToken!.delivery_id, logoType);
    const logos = logoQueries.getMetadataByDelivery(req.portalToken!.delivery_id);
    res.json({ ok: true, data: logos });
  });

  // GET /progress — get progress JSON
  router.get('/progress', (req: PortalRequest, res) => {
    const record = portalQueries.getByToken(req.portalToken!.token);
    res.json({ ok: true, data: JSON.parse(record?.progress_json || '{}') });
  });

  // PUT /progress — update section completion
  router.put('/progress', (req: PortalRequest, res) => {
    const parsed = z.object({ progress: z.record(z.string(), z.boolean()) }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    portalQueries.updateProgress(req.portalToken!.token, JSON.stringify(parsed.data.progress));
    res.json({ ok: true });
  });

  // POST /complete — mark as submitted
  router.post('/complete', (req: PortalRequest, res) => {
    if (req.portalToken!.completed_at) { res.status(400).json({ ok: false, error: 'Already submitted' }); return; }
    portalQueries.markCompleted(req.portalToken!.token);
    res.json({ ok: true });
  });

  return router;
}

// ─── Internal Routes (behind auth middleware) ──────────────────────────────

export function createSetupPortalRoutes(
  portalQueries: SetupPortalQueries,
  deliveryQueries: DeliveryQueries,
  settingsGetter: () => Record<string, string>,
): Router {
  const router = Router();

  // POST /generate/:deliveryId — generate token + optionally send email
  router.post('/generate/:deliveryId', async (req, res) => {
    const deliveryId = Number(req.params.deliveryId);
    const userId = (req as any).user?.id;

    const parsed = z.object({
      email: z.string().email(),
      name: z.string().optional(),
      sendEmail: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }

    const entries = deliveryQueries.getAll();
    const delivery = entries.find(e => e.id === deliveryId);
    if (!delivery) { res.status(404).json({ ok: false, error: 'Delivery not found' }); return; }

    const settings = settingsGetter();
    const expiryDays = parseInt(settings.setup_link_expiry_days || '30', 10);
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
    const token = crypto.randomBytes(32).toString('hex');

    const id = portalQueries.create({
      token,
      delivery_id: deliveryId,
      customer_email: parsed.data.email,
      customer_name: parsed.data.name,
      expires_at: expiresAt,
      created_by: userId,
    });

    // Build portal URL
    // Derive base URL: explicit setting > request origin > localhost fallback
    const baseUrl = settings.sso_base_url || settings.app_base_url || `${req.protocol}://${req.get('host')}`;
    const portalUrl = `${baseUrl}/setup/${token}`;

    // Optionally send email
    if (parsed.data.sendEmail !== false) {
      try {
        const emailService = new EmailService(() => settings);
        if (emailService.isConfigured()) {
          const html = setupPortalHtml({
            customerName: parsed.data.name,
            accountName: delivery.account,
            portalUrl,
            expiryDays,
          });
          await emailService.send({
            to: parsed.data.email,
            subject: `Complete your setup — ${delivery.account}`,
            text: `Hi${parsed.data.name ? ' ' + parsed.data.name : ''}, please complete your setup at: ${portalUrl}`,
            html,
          });
        } else {
          // Email not configured — return URL for manual copy
          res.json({ ok: true, id, token, url: portalUrl, emailSent: false, reason: 'Email not configured' });
          return;
        }
      } catch (err) {
        // Email failed — still return the URL
        console.error('[SetupPortal] Email send failed:', err instanceof Error ? err.message : err);
        res.json({ ok: true, id, token, url: portalUrl, emailSent: false, reason: err instanceof Error ? err.message : 'Send failed' });
        return;
      }
    }

    res.json({ ok: true, id, token, url: portalUrl, emailSent: parsed.data.sendEmail !== false });
  });

  // GET /tokens/:deliveryId — list tokens for a delivery
  router.get('/tokens/:deliveryId', (req, res) => {
    const deliveryId = Number(req.params.deliveryId);
    const tokens = portalQueries.getByDelivery(deliveryId);
    // Don't expose the full token in the list — just first 8 chars for identification
    const safe = tokens.map(t => ({
      ...t,
      token: t.token.slice(0, 8) + '...',
      full_token: t.token, // needed for copy-link
    }));
    res.json({ ok: true, data: safe });
  });

  // DELETE /tokens/:tokenId — revoke a token
  router.delete('/tokens/:tokenId', (req, res) => {
    const tokenId = Number(req.params.tokenId);
    const deleted = portalQueries.revokeToken(tokenId);
    if (!deleted) { res.status(404).json({ ok: false, error: 'Token not found' }); return; }
    res.json({ ok: true });
  });

  return router;
}
