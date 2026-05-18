import { Router } from 'express';
import type { ContractTermsQueries } from '../db/queries.js';
import { isAdmin } from '../utils/role-helpers.js';

export function createContractTermsRoutes(termsQueries: ContractTermsQueries): Router {
  const router = Router();

  // GET — all callers can read active terms (wizard needs them).
  // Admin sees inactive too via ?activeOnly=0.
  router.get('/', async (req, res) => {
    const activeOnly = req.query.activeOnly !== '0' && req.query.activeOnly !== 'false';
    const terms = await termsQueries.getAll({ activeOnly });
    res.json({ ok: true, data: terms });
  });

  router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const term = await termsQueries.getById(id);
    if (!term) { res.status(404).json({ ok: false, error: 'Term not found' }); return; }
    res.json({ ok: true, data: term });
  });

  // Create / update / delete — admin only.
  router.post('/', async (req, res) => {
    if (!req.user || !isAdmin(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Admin only' });
      return;
    }
    const { label, body, active, sort_order } = req.body ?? {};
    if (typeof label !== 'string' || !label.trim()) {
      res.status(400).json({ ok: false, error: 'label is required' });
      return;
    }
    if (typeof body !== 'string' || !body.trim()) {
      res.status(400).json({ ok: false, error: 'body is required' });
      return;
    }
    const id = await termsQueries.create({
      label: label.trim(),
      body: body.trim(),
      active: active === false || active === 0 ? 0 : 1,
      sort_order: typeof sort_order === 'number' ? sort_order : 0,
    });
    res.json({ ok: true, data: { id } });
  });

  router.put('/:id', async (req, res) => {
    if (!req.user || !isAdmin(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Admin only' });
      return;
    }
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const { label, body, active, sort_order } = req.body ?? {};
    const updates: { label?: string; body?: string; active?: number; sort_order?: number } = {};
    if (typeof label === 'string') updates.label = label.trim();
    if (typeof body === 'string') updates.body = body.trim();
    if (typeof active === 'boolean') updates.active = active ? 1 : 0;
    else if (typeof active === 'number') updates.active = active ? 1 : 0;
    if (typeof sort_order === 'number') updates.sort_order = sort_order;
    const updated = await termsQueries.update(id, updates);
    if (!updated) { res.status(404).json({ ok: false, error: 'Term not found' }); return; }
    res.json({ ok: true });
  });

  router.delete('/:id', async (req, res) => {
    if (!req.user || !isAdmin(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Admin only' });
      return;
    }
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const deleted = await termsQueries.delete(id);
    if (!deleted) { res.status(404).json({ ok: false, error: 'Term not found' }); return; }
    res.json({ ok: true });
  });

  return router;
}
