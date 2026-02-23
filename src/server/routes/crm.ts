import { Router } from 'express';
import type { CrmQueries } from '../db/queries.js';

export function createCrmRoutes(crmQueries: CrmQueries): Router {
  const router = Router();

  // --- Summary ---
  router.get('/summary', (_req, res) => {
    res.json({ ok: true, data: crmQueries.getSummary() });
  });

  // --- Owners (for filter dropdown) ---
  router.get('/owners', (_req, res) => {
    res.json({ ok: true, data: crmQueries.getOwners() });
  });

  // --- Customers CRUD ---
  router.get('/customers', (req, res) => {
    const filters = {
      rag_status: req.query.rag_status as string | undefined,
      owner: req.query.owner as string | undefined,
      search: req.query.search as string | undefined,
    };
    res.json({ ok: true, data: crmQueries.getAllCustomers(filters) });
  });

  router.get('/customers/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const customer = crmQueries.getCustomerById(id);
    if (!customer) { res.status(404).json({ ok: false, error: 'Customer not found' }); return; }
    res.json({ ok: true, data: customer });
  });

  router.post('/customers', (req, res) => {
    const { name } = req.body;
    if (!name?.trim()) { res.status(400).json({ ok: false, error: 'name is required' }); return; }
    const id = crmQueries.createCustomer(req.body);
    res.json({ ok: true, data: crmQueries.getCustomerById(id) });
  });

  router.put('/customers/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const updated = crmQueries.updateCustomer(id, req.body);
    if (!updated) { res.status(404).json({ ok: false, error: 'Customer not found' }); return; }
    res.json({ ok: true, data: crmQueries.getCustomerById(id) });
  });

  router.delete('/customers/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const deleted = crmQueries.deleteCustomer(id);
    if (!deleted) { res.status(404).json({ ok: false, error: 'Customer not found' }); return; }
    res.json({ ok: true });
  });

  // --- Reviews CRUD ---
  router.get('/customers/:id/reviews', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    res.json({ ok: true, data: crmQueries.getReviewsForCustomer(id) });
  });

  router.post('/customers/:id/reviews', (req, res) => {
    const customerId = parseInt(req.params.id, 10);
    if (isNaN(customerId)) { res.status(400).json({ ok: false, error: 'Invalid customer id' }); return; }
    const { review_date, rag_status } = req.body;
    if (!review_date || !rag_status) {
      res.status(400).json({ ok: false, error: 'review_date and rag_status are required' });
      return;
    }
    const id = crmQueries.createReview({ ...req.body, customer_id: customerId });
    res.json({ ok: true, data: crmQueries.getReviewById(id) });
  });

  router.put('/reviews/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const updated = crmQueries.updateReview(id, req.body);
    if (!updated) { res.status(404).json({ ok: false, error: 'Review not found' }); return; }
    res.json({ ok: true, data: crmQueries.getReviewById(id) });
  });

  router.delete('/reviews/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const deleted = crmQueries.deleteReview(id);
    if (!deleted) { res.status(404).json({ ok: false, error: 'Review not found' }); return; }
    res.json({ ok: true });
  });

  return router;
}
