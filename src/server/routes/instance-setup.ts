import { Router } from 'express';
import { z } from 'zod';
import type { InstanceSetupQueries } from '../db/queries.js';
import type { DeliveryQueries } from '../db/queries.js';

export function createInstanceSetupRoutes(
  setupQueries: InstanceSetupQueries,
  deliveryQueries: DeliveryQueries,
): Router {
  const router = Router();

  // ── Step templates (admin config) ──

  router.get('/templates', (_req, res) => {
    res.json({ ok: true, data: setupQueries.getAllTemplates() });
  });

  router.get('/templates/products', (_req, res) => {
    res.json({ ok: true, data: setupQueries.getDistinctProducts() });
  });

  router.get('/templates/:product', (req, res) => {
    const product = req.params.product;
    res.json({ ok: true, data: setupQueries.getTemplatesByProduct(product) });
  });

  router.post('/templates', (req, res) => {
    const parsed = z.object({
      product: z.string().min(1),
      step_key: z.string().min(1),
      step_label: z.string().min(1),
      sort_order: z.number().optional(),
      required: z.number().min(0).max(1).optional(),
    }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    try {
      const d = parsed.data;
      const id = setupQueries.createTemplate({
        product: d.product,
        step_key: d.step_key,
        step_label: d.step_label,
        sort_order: d.sort_order,
        required: d.required,
      });
      res.json({ ok: true, data: { id } });
    } catch (err) {
      res.status(409).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  router.put('/templates/:id', (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    const parsed = z.object({
      step_label: z.string().min(1).optional(),
      sort_order: z.number().optional(),
      required: z.number().min(0).max(1).optional(),
    }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    setupQueries.updateTemplate(id, parsed.data);
    res.json({ ok: true });
  });

  router.delete('/templates/:id', (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    setupQueries.deleteTemplate(id);
    res.json({ ok: true });
  });

  // ── Per-delivery setup steps ──

  router.get('/delivery/:id/steps', (req, res) => {
    const deliveryId = parseInt(String(req.params.id), 10);
    const steps = setupQueries.getByDelivery(deliveryId);
    res.json({ ok: true, data: steps });
  });

  /** Initialize steps for a delivery (copies from templates based on product) */
  router.post('/delivery/:id/initialize', (req, res) => {
    const deliveryId = parseInt(String(req.params.id), 10);

    // Look up the delivery to get its product
    const entries = deliveryQueries.getAll();
    const entry = entries.find(e => e.id === deliveryId);
    if (!entry) { res.status(404).json({ ok: false, error: 'Delivery not found' }); return; }

    // Allow overriding product via body
    const product = (req.body?.product as string) || entry.product;

    const count = setupQueries.initializeSteps(deliveryId, product);
    const steps = setupQueries.getByDelivery(deliveryId);
    res.json({ ok: true, data: steps, initialized: count });
  });

  /** Update a step's status */
  router.patch('/delivery/:id/steps/:stepKey', (req, res) => {
    const deliveryId = parseInt(String(req.params.id), 10);
    const stepKey = req.params.stepKey;
    const parsed = z.object({
      status: z.enum(['pending', 'in_progress', 'complete', 'failed', 'skipped']),
      result_message: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }

    const userId = (req as any).user?.id;
    const updated = setupQueries.updateStepStatus(
      deliveryId,
      stepKey,
      parsed.data.status,
      parsed.data.result_message,
      userId,
    );
    if (!updated) { res.status(404).json({ ok: false, error: 'Step not found' }); return; }

    // Return updated step list
    const steps = setupQueries.getByDelivery(deliveryId);
    res.json({ ok: true, data: steps });
  });

  /** Reset (delete) all steps for a delivery */
  router.delete('/delivery/:id/steps', (req, res) => {
    const deliveryId = parseInt(String(req.params.id), 10);
    setupQueries.deleteStepsForDelivery(deliveryId);
    res.json({ ok: true });
  });

  /** Bulk progress for all deliveries (for list view indicators) */
  router.post('/bulk-progress', (req, res) => {
    const parsed = z.object({
      deliveryIds: z.array(z.number()),
    }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    const progress = setupQueries.getBulkProgress(parsed.data.deliveryIds);
    res.json({ ok: true, data: progress });
  });

  return router;
}
