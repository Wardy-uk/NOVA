import { Router } from 'express';
import type { CrmQueries, DeliveryQueries, OnboardingRunQueries } from '../db/queries.js';
import type { AreaAccessGuard } from '../middleware/auth.js';

export function createCrmRoutes(
  crmQueries: CrmQueries,
  deliveryQueries?: DeliveryQueries,
  onboardingRunQueries?: OnboardingRunQueries,
  requireAreaAccess?: AreaAccessGuard,
): Router {
  const router = Router();
  const writeGuard = requireAreaAccess ? requireAreaAccess('accounts', 'edit') : (_req: any, _res: any, next: any) => next();

  // --- Summary ---
  router.get('/summary', async (_req, res) => {
    res.json({ ok: true, data: await crmQueries.getSummary() });
  });

  // --- Owners (for filter dropdown) ---
  router.get('/owners', async (_req, res) => {
    res.json({ ok: true, data: await crmQueries.getOwners() });
  });

  // --- Customers CRUD ---
  router.get('/customers', async (req, res) => {
    const filters = {
      rag_status: req.query.rag_status as string | undefined,
      owner: req.query.owner as string | undefined,
      search: req.query.search as string | undefined,
    };
    res.json({ ok: true, data: await crmQueries.getAllCustomers(filters) });
  });

  router.get('/customers/:id', async (req, res) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const customer = await crmQueries.getCustomerById(id);
    if (!customer) { res.status(404).json({ ok: false, error: 'Customer not found' }); return; }
    res.json({ ok: true, data: customer });
  });

  router.post('/customers', writeGuard, async (req, res) => {
    const { name } = req.body;
    if (!name?.trim()) { res.status(400).json({ ok: false, error: 'name is required' }); return; }
    const id = await crmQueries.createCustomer(req.body);
    res.json({ ok: true, data: await crmQueries.getCustomerById(id) });
  });

  router.put('/customers/:id', writeGuard, async (req, res) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const updated = await crmQueries.updateCustomer(id, req.body);
    if (!updated) { res.status(404).json({ ok: false, error: 'Customer not found' }); return; }
    res.json({ ok: true, data: await crmQueries.getCustomerById(id) });
  });

  router.delete('/customers/:id', writeGuard, async (req, res) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const deleted = await crmQueries.deleteCustomer(id);
    if (!deleted) { res.status(404).json({ ok: false, error: 'Customer not found' }); return; }
    res.json({ ok: true });
  });

  // --- Reviews CRUD ---
  router.get('/customers/:id/reviews', async (req, res) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    res.json({ ok: true, data: await crmQueries.getReviewsForCustomer(id) });
  });

  router.post('/customers/:id/reviews', writeGuard, async (req, res) => {
    const customerId = parseInt(req.params.id as string, 10);
    if (isNaN(customerId)) { res.status(400).json({ ok: false, error: 'Invalid customer id' }); return; }
    const { review_date, rag_status } = req.body;
    if (!review_date || !rag_status) {
      res.status(400).json({ ok: false, error: 'review_date and rag_status are required' });
      return;
    }
    const id = await crmQueries.createReview({ ...req.body, customer_id: customerId });
    res.json({ ok: true, data: await crmQueries.getReviewById(id) });
  });

  router.put('/reviews/:id', writeGuard, async (req, res) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const updated = await crmQueries.updateReview(id, req.body);
    if (!updated) { res.status(404).json({ ok: false, error: 'Review not found' }); return; }
    res.json({ ok: true, data: await crmQueries.getReviewById(id) });
  });

  router.delete('/reviews/:id', writeGuard, async (req, res) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const deleted = await crmQueries.deleteReview(id);
    if (!deleted) { res.status(404).json({ ok: false, error: 'Review not found' }); return; }
    res.json({ ok: true });
  });

  // --- Customer 360 Timeline ---
  router.get('/customers/:id/timeline', async (req, res) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }

    const customer = await crmQueries.getCustomerById(id);
    if (!customer) { res.status(404).json({ ok: false, error: 'Customer not found' }); return; }

    const reviews = await crmQueries.getReviewsForCustomer(id);

    // Find delivery entries by account name (case-insensitive)
    let deliveryEntries: unknown[] = [];
    if (deliveryQueries) {
      const allDelivery = await deliveryQueries.getAll();
      deliveryEntries = allDelivery.filter(
        (de) => de.account.toLowerCase() === customer.name.toLowerCase()
      );
    }

    // Find onboarding runs via delivery entries' onboarding_ids
    let onboardingRuns: unknown[] = [];
    if (onboardingRunQueries) {
      const seenRefs = new Set<string>();
      for (const de of deliveryEntries as Array<{ onboarding_id?: string }>) {
        if (de.onboarding_id && !seenRefs.has(de.onboarding_id)) {
          seenRefs.add(de.onboarding_id);
          const runs = await onboardingRunQueries.getAllByRef(de.onboarding_id);
          onboardingRuns.push(...runs);
        }
      }
    }

    res.json({
      ok: true,
      data: { customer, reviews, deliveryEntries, onboardingRuns },
    });
  });

  return router;
}
