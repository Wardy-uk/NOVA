/**
 * Business Central — Subscription Import client.
 *
 * Custom BC API published by the Subscription Billing AL extension. Pushes signed
 * Adobe Sign agreements into three staging tables which BC then converts into
 * real Customer Subscription Contract records via in-BC "Create..." actions:
 *
 *   1. importedCustomerSubscriptionContracts  (1 per agreement — header)
 *   2. importedSubscriptionHeaders            (N per agreement — one per item purchased)
 *   3. importedSubscriptionLines              (N per header — actual billable lines)
 *
 * URL form:
 *   https://api.businesscentral.dynamics.com/v2.0
 *     /{bc_tenant_id}
 *     /{bc_sub_environment}
 *     /api/technologyManagement/billingSub/v2.0
 *     /companies({bc_sub_company_id})
 *     /{entitySet}
 *
 * Auth: reuses the SAME Entra app reg credentials as the main BC integration
 * (bc_tenant_id, bc_client_id, bc_client_secret). The subscription import uses
 * different environment + company values (typically a test BC env), but the
 * OAuth token issuer is the same Microsoft Entra tenant.
 *
 * Required settings (Admin > Integrations > BC — Subscription Import):
 *   bc_sub_enabled      = 'true'
 *   bc_sub_environment  = BC env name (e.g. 'DA-260318')
 *   bc_sub_company_id   = BC company GUID inside that env
 *
 * Plus inherited from the main BC integration:
 *   bc_tenant_id, bc_client_id, bc_client_secret
 */

// ── Payload shapes (best-guess camelCase based on the column labels in the BC UI;
// the exact JSON property names depend on how the AL extension defined the API
// page. If a POST returns 400 with "unknown field 'foo'", rename the property
// here to match what BC expects — the client surfaces error bodies verbatim. ──

export interface ImportedCustomerSubscriptionContractPayload {
  subscriptionContractNo: string;       // NOVA-NNNNNNNNNN
  sellToCustomerNo: string;             // BC customer No. (e.g. 'CU0000001')
  billToCustomerNo: string;             // same as sellTo for our use case
  contractType: string;                 // always 'STD' per current config
  description: string;                  // always 'NOVA' per current config
  createContractDeferrals: boolean;     // always true per current config
  // Intentionally omitted (deferred until later):
  // sellToContactNo, billToContactNo, yourReference, salespersonCode,
  // assignedUserId, detailOverview, dimensionFromProjectNo
}

export interface ImportedSubscriptionHeaderPayload {
  subscriptionNo: string;               // '{subscriptionContractNo}_{n}'
  customerNo: string;                   // BC customer No.
  itemNo: string;                       // BC item No. (e.g. 'ITM0117')
  description: string;                  // item description / line description
  quantity: number;
  // customerReference omitted for now
}

export interface ImportedSubscriptionLinePayload {
  subscriptionNo: string;               // FK to header
  subscriptionLineEntryNo: number;      // sequence within the subscription
  partner: string;                      // always 'Customer'
  subscriptionContractNo: string;       // FK to contract header
  contractLineNo: number;               // 10000, 20000, ... per BC convention
  subscriptionContractLineType: string; // 'Item' (could also be 'GL Account' later)
  description: string;
  subscriptionLineStartDate: string;    // 'YYYY-MM-DD'
  subscriptionLineEndDate: string | null;
  nextBillingDate: string;
  quantity: number;
  calculationBaseAmount: number;
}

export interface BcSubscriptionImportConfig {
  // OAuth identity (shared with main BC integration)
  tenantId: string;
  clientId: string;
  clientSecret: string;
  // BC env + company (specific to subscription import — usually a test env)
  environment: string;
  companyId: string;
}

export class BcSubscriptionImportApiError extends Error {
  constructor(
    public statusCode: number,
    public statusText: string,
    public body: unknown,
    public requestUrl: string,
  ) {
    // Include a snippet of the response body in the message — BC's error
    // bodies are noisy but the meaningful bit ('Unknown field X', 'Permission
    // denied on Y', etc.) is what we want surfaced when this bubbles up.
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    super(`BC Subscription Import ${statusCode} ${statusText} — ${bodyStr.slice(0, 500)}`);
    this.name = 'BcSubscriptionImportApiError';
  }
}

// Matches a bare GUID (with or without dashes/braces). Used to decide whether the
// company identifier is a GUID (use bare) or a display name (single-quote it).
const GUID_RE = /^\{?[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}\}?$/;

function formatCompanyRef(companyId: string): string {
  const v = (companyId ?? '').trim();
  if (GUID_RE.test(v)) return v.replace(/[{}]/g, '');     // companies(d01adb5e-…)
  return `'${v.replace(/'/g, "''")}'`;                    // companies('TEST1')
}

export class BcSubscriptionImportClient {
  private baseUrl: string;
  private tokenUrl: string;
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(private config: BcSubscriptionImportConfig) {
    // BC's OData company reference accepts either a bare GUID — companies(d01adb5e-…)
    // — or a quoted display name — companies('TEST1'). A name passed unquoted
    // (companies(TEST1)) is parsed as an OData key and throws
    // "',' expected at position N", so we quote anything that isn't a GUID.
    this.baseUrl = `https://api.businesscentral.dynamics.com/v2.0/${config.tenantId}/${config.environment}/api/technologyManagement/billingSub/v2.0/companies(${formatCompanyRef(config.companyId)})`;
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
      console.error(`[BC-Sub Token] ${res.status} ${res.statusText} — ${errText}`);
      let errBody: unknown;
      try { errBody = JSON.parse(errText); } catch { errBody = errText; }
      throw new BcSubscriptionImportApiError(res.status, res.statusText, errBody, this.tokenUrl);
    }
    const data = await res.json() as { access_token: string; expires_in: number };
    this.tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return this.tokenCache.token;
  }

  private async post<T>(path: string, payload: unknown): Promise<T> {
    const token = await this.getToken();
    const url = `${this.baseUrl}${path}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[BC-Sub API] POST ${path} → ${res.status} ${res.statusText}`);
      console.error(`[BC-Sub API] Request URL: ${url}`);
      console.error(`[BC-Sub API] Request payload: ${JSON.stringify(payload)}`);
      console.error(`[BC-Sub API] Response body: ${errText}`);
      let errBody: unknown;
      try { errBody = JSON.parse(errText); } catch { errBody = errText; }
      throw new BcSubscriptionImportApiError(res.status, res.statusText, errBody, url);
    }

    return res.json() as Promise<T>;
  }

  // ── Endpoints ──

  // POSTs the contract header. Returns whatever BC echoes back (typically the
  // created row including any BC-assigned fields like SystemId).
  async createImportedCustomerSubscriptionContract(payload: ImportedCustomerSubscriptionContractPayload): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>('/importedCustomerSubscriptionContracts', payload);
  }

  // Subscription headers — one per item purchased. NOT WIRED YET: blocked on the
  // template-field → BC-item code mapping work, which is parked. When mapping
  // ships, the service layer will call this once per mapped item.
  async createImportedSubscriptionHeader(payload: ImportedSubscriptionHeaderPayload): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>('/importedSubscriptionHeaders', payload);
  }

  // Subscription lines — one per billable line under a header. NOT WIRED YET,
  // same reason as createImportedSubscriptionHeader.
  async createImportedSubscriptionLine(payload: ImportedSubscriptionLinePayload): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>('/importedSubscriptionLines', payload);
  }
}

// Returns null if any required setting is missing — caller treats that as
// 'subscription import is not configured' and falls back to manual / future setup.
export function buildBcSubscriptionImportClient(settings: Record<string, string>): BcSubscriptionImportClient | null {
  if (
    settings.bc_sub_enabled !== 'true' ||
    !settings.bc_tenant_id ||
    !settings.bc_client_id ||
    !settings.bc_client_secret ||
    !settings.bc_sub_environment ||
    !settings.bc_sub_company_id
  ) {
    return null;
  }
  return new BcSubscriptionImportClient({
    tenantId: settings.bc_tenant_id,
    clientId: settings.bc_client_id,
    clientSecret: settings.bc_client_secret,
    environment: settings.bc_sub_environment,
    companyId: settings.bc_sub_company_id,
  });
}
