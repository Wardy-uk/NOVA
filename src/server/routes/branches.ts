import { Router } from 'express';
import { z } from 'zod';
import type { BranchQueries } from '../db/queries.js';

const BranchSchema = z.object({
  name: z.string().min(1),
  is_default: z.number().optional(),
  sales_email: z.string().optional().nullable(),
  sales_phone: z.string().optional().nullable(),
  lettings_email: z.string().optional().nullable(),
  lettings_phone: z.string().optional().nullable(),
  address1: z.string().optional().nullable(),
  address2: z.string().optional().nullable(),
  address3: z.string().optional().nullable(),
  town: z.string().optional().nullable(),
  post_code1: z.string().optional().nullable(),
  post_code2: z.string().optional().nullable(),
  sort_order: z.number().optional(),
});

const BranchUpdateSchema = BranchSchema.partial();

export function createBranchRoutes(branchQueries: BranchQueries): Router {
  const router = Router();

  // GET /delivery/:id — list branches for a delivery
  router.get('/delivery/:id', async (req, res) => {
    const deliveryId = Number(req.params.id);
    if (!deliveryId) { res.status(400).json({ ok: false, error: 'Invalid delivery ID' }); return; }
    const branches = await branchQueries.getByDelivery(deliveryId);
    res.json({ ok: true, data: branches });
  });

  // POST /delivery/:id — create a branch
  router.post('/delivery/:id', async (req, res) => {
    const deliveryId = Number(req.params.id);
    if (!deliveryId) { res.status(400).json({ ok: false, error: 'Invalid delivery ID' }); return; }
    const parsed = BranchSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    try {
      const id = await branchQueries.create({ delivery_id: deliveryId, ...parsed.data } as any);
      const branches = await branchQueries.getByDelivery(deliveryId);
      res.json({ ok: true, data: branches, created: id });
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) {
        res.status(409).json({ ok: false, error: `Branch "${parsed.data.name}" already exists` });
      } else {
        res.status(500).json({ ok: false, error: err.message });
      }
    }
  });

  // PUT /:id — update a branch
  router.put('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ ok: false, error: 'Invalid branch ID' }); return; }
    const parsed = BranchUpdateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    const updated = await branchQueries.update(id, parsed.data as any);
    if (!updated) { res.status(404).json({ ok: false, error: 'Branch not found' }); return; }
    const branch = await branchQueries.getById(id);
    if (branch) {
      const branches = await branchQueries.getByDelivery(branch.delivery_id);
      res.json({ ok: true, data: branches });
    } else {
      res.json({ ok: true });
    }
  });

  // DELETE /:id — delete a branch
  router.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ ok: false, error: 'Invalid branch ID' }); return; }
    const branch = await branchQueries.getById(id);
    const deleted = await branchQueries.delete(id);
    if (!deleted) { res.status(404).json({ ok: false, error: 'Branch not found' }); return; }
    const branches = branch ? await branchQueries.getByDelivery(branch.delivery_id) : [];
    res.json({ ok: true, data: branches });
  });

  // POST /delivery/:id/bulk — import array of branches
  router.post('/delivery/:id/bulk', async (req, res) => {
    const deliveryId = Number(req.params.id);
    if (!deliveryId) { res.status(400).json({ ok: false, error: 'Invalid delivery ID' }); return; }
    const parsed = z.object({ branches: z.array(BranchSchema) }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
    const created = await branchQueries.bulkCreate(deliveryId, parsed.data.branches as any);
    const branches = await branchQueries.getByDelivery(deliveryId);
    res.json({ ok: true, data: branches, created });
  });

  // PUT /delivery/:id/:branchId/default — set a branch as default
  router.put('/delivery/:id/:branchId/default', async (req, res) => {
    const deliveryId = Number(req.params.id);
    const branchId = Number(req.params.branchId);
    if (!deliveryId || !branchId) { res.status(400).json({ ok: false, error: 'Invalid IDs' }); return; }
    await branchQueries.setDefault(deliveryId, branchId);
    const branches = await branchQueries.getByDelivery(deliveryId);
    res.json({ ok: true, data: branches });
  });

  return router;
}
