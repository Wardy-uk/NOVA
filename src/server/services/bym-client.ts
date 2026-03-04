/**
 * BriefYourMarket direct API client.
 * Calls the same underlying APIs as the standalone Onboarding.Tool:
 * 1. BriefYourMarket Instance API (Basic Auth) — brands, branches, authorize
 * 2. BuildYourMarket API (Bearer Token) — portal accounts, branch districts
 * 3. Image Service (No Auth) — logo uploads via multipart/form-data
 */

export interface BymConfig {
  apiKey: string;           // Base64-encoded Basic Auth value
  urlTemplate: string;      // e.g. https://{0}.briefyourmarket.services/
  buildApiUrl: string;      // e.g. https://buildyourmarketapi-live.azurewebsites.net/
  imageServiceUrl: string;  // e.g. https://bymmedia-dev.azurewebsites.net
}

export interface LookupValue {
  id?: number | null;
  value: string;
  classification: string;
  isSecured: boolean;
  isDefault: boolean;
}

export interface PostCodeDistrict {
  outwardCode: string;
  description: string;
  sectors: string[];
  allSectors: boolean;
}

export interface BuildBranchPayload {
  branchId: number;
  name: string;
  brand?: string | null;
  creditGroupId?: number | null;
  customDirty: boolean;
  emailTemplateId?: number | null;
  letterTemplateId?: number | null;
  printTemplateId?: number | null;
  officePhone?: string | null;
  personalLandlordSalutation: boolean;
  portalAccount?: string | null;
  region?: string | null;
  updating: boolean;
  wholeOfUK?: boolean | null;
  postCodeDistricts: PostCodeDistrict[];
}

export class BymApiError extends Error {
  constructor(
    public statusCode: number,
    public statusText: string,
    public body: unknown,
  ) {
    const detail = body && typeof body === 'object'
      ? (body as Record<string, unknown>).Message || (body as Record<string, unknown>).message || JSON.stringify(body).slice(0, 300)
      : String(body).slice(0, 300);
    super(`BYM API ${statusCode}: ${statusText} — ${detail}`);
    this.name = 'BymApiError';
  }
}

export class BymClient {
  private apiKey: string;
  private urlTemplate: string;
  private buildApiUrl: string;
  private imageServiceUrl: string;

  constructor(config: BymConfig) {
    this.apiKey = config.apiKey;
    this.urlTemplate = config.urlTemplate.replace(/\/+$/, '');
    this.buildApiUrl = config.buildApiUrl.replace(/\/+$/, '');
    this.imageServiceUrl = config.imageServiceUrl.replace(/\/+$/, '');
  }

  private instanceUrl(subdomain: string): string {
    return this.urlTemplate.replace('{0}', subdomain);
  }

  // ── Generic request helpers ──

  private async basicRequest<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Basic ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(300_000), // 5 min timeout like original tool
    });

    if (!res.ok) {
      let errorBody: unknown;
      try { errorBody = await res.json(); } catch { errorBody = await res.text().catch(() => ''); }
      throw new BymApiError(res.status, res.statusText, errorBody);
    }

    if (res.status === 204) return {} as T;
    const text = await res.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  private async bearerRequest<T>(method: string, url: string, token: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok) {
      let errorBody: unknown;
      try { errorBody = await res.json(); } catch { errorBody = await res.text().catch(() => ''); }
      throw new BymApiError(res.status, res.statusText, errorBody);
    }

    if (res.status === 204) return {} as T;
    const text = await res.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  // ── Auth ──

  /** Get bearer token from BriefYourMarket instance. */
  async authorize(subdomain: string): Promise<string> {
    const url = `${this.instanceUrl(subdomain)}/api/authorize`;
    const result = await this.basicRequest<{ bearerToken: string }>(
      'GET', url,
    );
    return result.bearerToken;
  }

  /** Test connectivity by calling authorize. */
  async testConnection(subdomain: string): Promise<boolean> {
    try {
      await this.authorize(subdomain);
      return true;
    } catch {
      return false;
    }
  }

  // ── BriefYourMarket Instance API (Basic Auth) ──

  async getBrands(subdomain: string): Promise<LookupValue[]> {
    return this.basicRequest('GET', `${this.instanceUrl(subdomain)}/api/brands`);
  }

  async createBrands(subdomain: string, brands: LookupValue[]): Promise<unknown> {
    return this.basicRequest('POST', `${this.instanceUrl(subdomain)}/api/brands`, brands);
  }

  async getBranches(subdomain: string): Promise<LookupValue[]> {
    return this.basicRequest('GET', `${this.instanceUrl(subdomain)}/api/branches`);
  }

  async createBranches(subdomain: string, branches: LookupValue[]): Promise<unknown> {
    return this.basicRequest('POST', `${this.instanceUrl(subdomain)}/api/branches`, branches);
  }

  // ── BuildYourMarket API (Bearer Token) ──

  async createPortalAccount(token: string, portalName: string): Promise<unknown> {
    return this.bearerRequest('POST', `${this.buildApiUrl}/api/portalaccounts`, token, {
      portal: portalName,
    });
  }

  async setupBranch(token: string, branch: BuildBranchPayload): Promise<unknown> {
    return this.bearerRequest('PUT', `${this.buildApiUrl}/api/branches/${branch.branchId}`, token, branch);
  }

  // ── Image Service (No Auth, multipart/form-data) ──

  async uploadImage(subdomain: string, fileName: string, imageBuffer: Buffer, mimeType: string): Promise<string> {
    const boundary = `----BymUpload${Date.now()}`;
    const bodyParts: Buffer[] = [];

    // Build multipart body
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
    bodyParts.push(Buffer.from(header, 'utf-8'));
    bodyParts.push(imageBuffer);
    bodyParts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8'));

    const body = Buffer.concat(bodyParts);

    const url = `${this.imageServiceUrl}/api/v1/media/onboarding/${encodeURIComponent(subdomain)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new BymApiError(res.status, res.statusText, errorText);
    }

    return await res.text();
  }
}
