import { Router } from 'express';
import type { BcCustomerQueries, ContractsQueries } from '../db/queries.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import { buildBcClient } from '../services/bc-client.js';

export function createContractsRoutes(
  bcCustomerQueries: BcCustomerQueries,
  contractsQueries: ContractsQueries,
  settingsQueries: FileSettingsQueries,
): Router {
  const router = Router();

  // ── Business Central helpers ──

  // POST /api/contracts/bc/detect-companies — list BC companies using supplied (or saved) creds
  router.post('/bc/detect-companies', async (req, res) => {
    const { tenant_id, client_id, client_secret, environment } = req.body as Record<string, string>;
    const saved = settingsQueries.getAll();

    const cfg = {
      tenantId:     tenant_id     || saved.bc_tenant_id     || '',
      clientId:     client_id     || saved.bc_client_id     || '',
      clientSecret: client_secret || saved.bc_client_secret || '',
      environment:  environment   || saved.bc_environment   || 'Production',
      companyId:    'none',        // not needed for company list
    };

    if (!cfg.tenantId || !cfg.clientId || !cfg.clientSecret) {
      res.status(400).json({ ok: false, error: 'Tenant ID, Client ID and Client Secret are required' });
      return;
    }

    try {
      // Get token
      const tokenRes = await fetch(
        `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
            scope: 'https://api.businesscentral.dynamics.com/.default',
          }).toString(),
        }
      );
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({})) as Record<string, string>;
        res.status(400).json({ ok: false, error: err.error_description ?? `Auth failed: ${tokenRes.status}` });
        return;
      }
      const { access_token } = await tokenRes.json() as { access_token: string };

      // Fetch companies
      const companiesRes = await fetch(
        `https://api.businesscentral.dynamics.com/v2.0/${cfg.tenantId}/${cfg.environment}/api/v2.0/companies`,
        { headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' } }
      );
      if (!companiesRes.ok) {
        const err = await companiesRes.json().catch(() => ({})) as Record<string, unknown>;
        res.status(400).json({ ok: false, error: (err as any)?.error?.message ?? `BC API failed: ${companiesRes.status}` });
        return;
      }
      const data = await companiesRes.json() as { value: Array<{ id: string; name: string; displayName?: string }> };
      res.json({ ok: true, data: data.value ?? [] });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Request failed' });
    }
  });

  // ── Business Central customer sync ──

  router.post('/bc/sync', async (_req, res) => {
    const settings = settingsQueries.getAll();
    process.stdout.write(`[BC Sync] bc_enabled=${settings.bc_enabled} company=${settings.bc_company_id}\n`);
    const client = buildBcClient(settings);
    if (!client) {
      res.status(503).json({ ok: false, error: 'Business Central is not configured. Add credentials in Admin > Integrations.' });
      return;
    }
    try {
      const customers = await client.getCustomers();
      for (const c of customers) {
        bcCustomerQueries.upsert({
          bc_id: c.id,
          number: c.number ?? null,
          display_name: c.displayName,
          email: c.email ?? null,
          phone_number: c.phoneNumber ?? null,
          address: c.addressLine1 ?? null,
          city: c.city ?? null,
          country: c.country ?? null,
          currency_code: c.currencyCode ?? null,
          balance: c.balance ?? null,
          blocked: c.blocked ?? null,
          last_synced: new Date().toISOString(),
        });
      }
      res.json({ ok: true, synced: customers.length });
    } catch (err) {
      console.error('[BC Sync]', err);
      const msg = err instanceof Error ? err.message : 'Sync failed';
      const body = (err as any).body;
      const detail = body?.error?.message ?? body?.message ?? (typeof body === 'string' ? body : null);
      res.status(500).json({ ok: false, error: detail ? `${msg} — ${detail}` : msg });
    }
  });

  // GET /api/contracts/customers — list cached BC customers
  router.get('/customers', (req, res) => {
    const search = req.query.search as string | undefined;
    const customers = bcCustomerQueries.getAll(search);
    res.json({ ok: true, data: customers, total: customers.length });
  });

  // GET /api/contracts/customers/:bcId/orders — fetch live BC sales orders for a customer
  router.get('/customers/:bcId/orders', async (req, res) => {
    const settings = settingsQueries.getAll();
    const client = buildBcClient(settings);

    const customer = bcCustomerQueries.getByBcId(req.params.bcId);
    if (!customer) {
      res.status(404).json({ ok: false, error: 'Customer not found' });
      return;
    }

    if (!client) {
      // Return empty — BC not configured
      res.json({ ok: true, data: [] });
      return;
    }

    try {
      const orders = await client.getSalesOrders(customer.number ?? customer.display_name);
      res.json({ ok: true, data: orders });
    } catch (err) {
      console.error('[BC Orders]', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to fetch orders' });
    }
  });

  // ── Local contracts CRUD ──

  // GET /api/contracts — list all contracts (optionally filter by bc_customer_id)
  router.get('/', (req, res) => {
    const contracts = contractsQueries.getAll({
      bc_customer_id: req.query.bc_customer_id as string | undefined,
      status: req.query.status as string | undefined,
      search: req.query.search as string | undefined,
    });
    res.json({ ok: true, data: contracts });
  });

  // POST /api/contracts — create a contract
  router.post('/', (req, res) => {
    const { title, customer_name } = req.body;
    if (!title?.trim()) { res.status(400).json({ ok: false, error: 'title is required' }); return; }
    if (!customer_name?.trim()) { res.status(400).json({ ok: false, error: 'customer_name is required' }); return; }
    const id = contractsQueries.create(req.body);
    res.json({ ok: true, data: contractsQueries.getById(id) });
  });

  // PUT /api/contracts/:id — update a contract
  router.put('/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const updated = contractsQueries.update(id, req.body);
    if (!updated) { res.status(404).json({ ok: false, error: 'Contract not found' }); return; }
    res.json({ ok: true, data: contractsQueries.getById(id) });
  });

  // DELETE /api/contracts/:id — delete a contract
  router.delete('/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const deleted = contractsQueries.delete(id);
    if (!deleted) { res.status(404).json({ ok: false, error: 'Contract not found' }); return; }
    res.json({ ok: true });
  });

  return router;
}
