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
  city: string;
  country: string;
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
      '$top': '500',
    });
    return data.value ?? [];
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
