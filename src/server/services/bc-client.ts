/**
 * Business Central REST API client.
 * Uses OAuth2 client credentials (Azure AD app registration).
 *
 * Required settings (Admin > Integrations):
 *   bc_enabled        = 'true'
 *   bc_tenant_id      = Azure AD tenant ID
 *   bc_client_id      = App registration client ID
 *   bc_client_secret  = App registration client secret
 *   bc_environment    = BC environment name (e.g. 'Production')
 *   bc_company_id     = BC company GUID
 */

export interface BcConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  environment: string;
  companyId: string;
}

// All fields except the core identity ones are optional — BC tenant configurations
// vary (e.g. `contact` doesn't exist on every tenant; UK localization exposes a
// "Reg. No." field that's not in the standard schema). Sync code coalesces
// missing/null values defensively rather than assuming a fixed shape.
export interface BcRawCustomer {
  id: string;
  number: string;
  displayName: string;
  email?: string;
  phoneNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  taxRegistrationNumber?: string;       // VAT Registration No.
  // Company registration ("Companies House" style). Different BC tenants expose
  // this under different names — sync coalesces the first non-empty.
  registrationNumber?: string;
  companyRegistrationNumber?: string;
  contact?: string;
  currencyCode?: string;
  balance?: number;
  blocked?: string;
}

export interface BcRawOrder {
  id: string;
  number: string;
  orderDate: string;
  customerNumber: string;
  customerName: string;
  status: string;
  totalAmountIncludingTax: number;
  currencyCode: string;
}

export class BcApiError extends Error {
  constructor(
    public statusCode: number,
    public statusText: string,
    public body: unknown,
  ) {
    super(`BC API ${statusCode}: ${statusText}`);
    this.name = 'BcApiError';
  }
}

export class BusinessCentralClient {
  private baseUrl: string;
  private tokenUrl: string;
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(private config: BcConfig) {
    this.baseUrl = `https://api.businesscentral.dynamics.com/v2.0/${config.tenantId}/${config.environment}/api/v2.0/companies(${config.companyId})`;
    this.tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;
  }

  private async getToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt - 60_000) {
      return this.tokenCache.token;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: 'https://api.businesscentral.dynamics.com/.default',
    });

    const res = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[BC Token] ${res.status} ${res.statusText} — ${errText}`);
      let errBody: unknown;
      try { errBody = JSON.parse(errText); } catch { errBody = errText; }
      throw new BcApiError(res.status, res.statusText, errBody);
    }

    const data = await res.json() as { access_token: string; expires_in: number };
    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return this.tokenCache.token;
  }

  private async request<T>(pathOrUrl: string, params?: Record<string, string>): Promise<T> {
    const token = await this.getToken();
    // Absolute URL → use as-is (used for @odata.nextLink continuation, which
    // already encodes $skiptoken etc. and must not be re-encoded).
    let urlStr = pathOrUrl.startsWith('http') ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
    if (params) {
      // Use manual query string — URLSearchParams encodes '$' as '%24' which breaks OData
      const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      urlStr += `?${qs}`;
    }

    const res = await fetch(urlStr, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[BC API] ${res.status} ${res.statusText} — URL: ${urlStr}`);
      console.error(`[BC API] Response body: ${errText}`);
      let errBody: unknown;
      try { errBody = JSON.parse(errText); } catch { errBody = errText; }
      throw new BcApiError(res.status, res.statusText, errBody);
    }

    return res.json() as Promise<T>;
  }

  async getCustomers(): Promise<BcRawCustomer[]> {
    // No $select — BC tenants vary in which properties they expose (e.g. the
    // `contact` property doesn't exist on every tenant, UK localization adds
    // `registrationNumber`, custom extensions add `companyRegistrationNumber`
    // etc.). Requesting a property the tenant doesn't expose returns
    // 400 "Could not find a property named '...'" and breaks the whole sync.
    // Drop $select → BC returns the full projection it knows about; we read
    // whatever we recognise on the TS side.
    //
    // Pagination: BC v2.0 returns up to ~20,000 records per page and includes
    // @odata.nextLink when more exist. Follow nextLink until exhausted so
    // tenants with >500 customers don't silently truncate (the previous
    // $top=500 cap was hiding everything past CU00xxxxx in the wizard picker).
    const all: BcRawCustomer[] = [];
    let next: string | null = `${this.baseUrl}/customers`;
    const MAX_PAGES = 50; // safety: 50 × ~20k = 1M cap before we bail
    let page = 0;
    while (next && page < MAX_PAGES) {
      const data: { value: BcRawCustomer[]; '@odata.nextLink'?: string } =
        await this.request<{ value: BcRawCustomer[]; '@odata.nextLink'?: string }>(next);
      if (data.value?.length) all.push(...data.value);
      next = data['@odata.nextLink'] ?? null;
      page++;
    }
    if (page === MAX_PAGES && next) {
      console.warn(`[BC] getCustomers hit ${MAX_PAGES}-page safety cap with more pages remaining — investigate.`);
    }
    return all;
  }

  async getCustomerByNumber(customerNumber: string): Promise<BcRawCustomer | null> {
    const filter = `number eq '${customerNumber.replace(/'/g, "''")}'`;
    const data = await this.request<{ value: BcRawCustomer[] }>('/customers', {
      '$filter': filter,
      '$top': '1',
    });
    return data.value?.[0] ?? null;
  }

  async searchCustomers(query: string): Promise<BcRawCustomer[]> {
    const escaped = query.replace(/'/g, "''");
    const select = 'id,number,displayName,email,phoneNumber,addressLine1,city,country,balance,blocked';
    // BC OData does NOT support the OR operator across distinct fields in a single
    // $filter — it returns 400 "The 'OR' operator is not supported on distinct
    // fields on an OData filter". The old single-filter
    //   contains(displayName,..) or contains(email,..) or contains(number,..)
    // therefore failed on EVERY search (which the UI surfaced as "No results
    // found"). Run one contains() per field instead and merge unique results.
    const fields = ['displayName', 'email', 'number'];
    const byNumber = new Map<string, BcRawCustomer>();
    await Promise.all(fields.map(async (field) => {
      try {
        const data = await this.request<{ value: BcRawCustomer[] }>('/customers', {
          '$filter': `contains(${field}, '${escaped}')`,
          '$top': '20',
          '$select': select,
        });
        for (const c of data.value ?? []) {
          if (c.number && !byNumber.has(c.number)) byNumber.set(c.number, c);
        }
      } catch (err) {
        // Don't let one unfilterable field kill the whole search — the primary
        // path (displayName) should still return even if e.g. a tenant rejects
        // contains() on another field.
        console.warn(`[bc] search field '${field}' failed:`, err instanceof Error ? err.message : err);
      }
    }));
    console.log(`[bc] Search "${query}" returned ${byNumber.size} unique results`);
    return [...byNumber.values()];
  }

  async getSalesOrders(customerNumber: string): Promise<BcRawOrder[]> {
    const filter = `customerNumber eq '${customerNumber.replace(/'/g, "''")}'`;
    const data = await this.request<{ value: BcRawOrder[] }>('/salesOrders', {
      '$filter': filter,
      '$select': 'id,number,orderDate,customerNumber,customerName,status,totalAmountIncludingTax,currencyCode',
      '$top': '100',
    });
    return data.value ?? [];
  }
}

export function buildBcClient(settings: Record<string, string>): BusinessCentralClient | null {
  if (
    settings.bc_enabled !== 'true' ||
    !settings.bc_tenant_id ||
    !settings.bc_client_id ||
    !settings.bc_client_secret ||
    !settings.bc_environment ||
    !settings.bc_company_id
  ) {
    return null;
  }
  return new BusinessCentralClient({
    tenantId: settings.bc_tenant_id,
    clientId: settings.bc_client_id,
    clientSecret: settings.bc_client_secret,
    environment: settings.bc_environment,
    companyId: settings.bc_company_id,
  });
}
