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

export interface BcRawCustomer {
  id: string;
  number: string;
  displayName: string;
  email: string;
  phoneNumber: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  taxRegistrationNumber: string;
  contact: string;
  currencyCode: string;
  balance: number;
  blocked: string;
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

  private async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    const token = await this.getToken();
    let urlStr = `${this.baseUrl}${path}`;
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
    const data = await this.request<{ value: BcRawCustomer[] }>('/customers', {
      // Explicit $select keeps the payload small AND prevents BC from quietly
      // dropping fields when their default projection changes between BC versions.
      '$select': 'id,number,displayName,email,phoneNumber,addressLine1,addressLine2,city,state,country,postalCode,taxRegistrationNumber,contact,currencyCode,balance,blocked',
      '$top': '500',
    });
    return data.value ?? [];
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
    const filter = `contains(displayName, '${escaped}') or contains(email, '${escaped}') or contains(number, '${escaped}')`;
    console.log(`[bc] Searching customers: filter=${filter}`);
    try {
      const data = await this.request<{ value: BcRawCustomer[] }>('/customers', {
        '$filter': filter,
        '$top': '20',
        '$select': 'id,number,displayName,email,phoneNumber,addressLine1,city,country,balance,blocked',
      });
      console.log(`[bc] Search returned ${data.value?.length ?? 0} results`);
      return data.value ?? [];
    } catch (err) {
      console.error(`[bc] Search failed:`, err instanceof Error ? err.message : err);
      throw err;
    }
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
