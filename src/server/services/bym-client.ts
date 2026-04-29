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
  configApiUrl?: string;    // e.g. https://configapi.briefyourmarket.com
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

/** Normalize PascalCase keys to camelCase (one level deep). */
function toCamel<T>(obj: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k[0].toLowerCase() + k.slice(1)] = v;
  }
  return out as T;
}

export interface RssFeed {
  isBymFeed: boolean;
  description: string;
  imageTitle: string;
  imageDescription: string;
  imageUrl: string;
  instance: string | null;
  contentChannel: string | null;
  automaticallyCreateArticles: boolean;
  feedUrl: string;
  categoryAssignType: string;
  isBookMarked: boolean;
  type: number;
  timeToLive: number;
  active: boolean;
}

export interface InstanceSetting {
  name: string;
  value: string;
  editable?: boolean;
  visible?: boolean;
}

export interface Milestone {
  id: number;
  length: number;
  milestoneType: string;
  milestoneContext: string;
}

export interface StandardContent {
  context: string;
  emailSubject: string;
  emailCopy: string;
  letterCopy: string;
  smsCopy: string;
}

export interface EmailComponentLibrary {
  id: number;
  name: string;
  instances: Record<number, string>;
  isGlobal: boolean;
  category: string;
}

export interface BymContact {
  alternateId: string;
  eMail: string;
}

export interface BymUser {
  userName: string;
  email: string;
  alertsEnabled: boolean;
  roles: string[];
  brands: LookupValue[];
  branches: LookupValue[];
  deliveryAddresses: unknown[];
  noBrand: boolean;
  enabled: boolean;
  contactId: number | null;
}

export interface DeliveryAddress {
  id?: number;
  name: string;
  recipient: string;
  isDefault: boolean;
  region: string;
  contactTel: string;
  contactEmail: string;
  address?: { organisation: string; line1: string; line2: string; line3: string; town: string; postCode: string; valid: boolean };
}

export class BymClient {
  private apiKey: string;
  private urlTemplate: string;
  private buildApiUrl: string;
  private imageServiceUrl: string;
  private configApiUrl: string;

  constructor(config: BymConfig) {
    this.apiKey = config.apiKey;
    this.urlTemplate = config.urlTemplate.trim().replace(/\/+$/, '');
    this.buildApiUrl = config.buildApiUrl.trim().replace(/\/+$/, '');
    this.imageServiceUrl = config.imageServiceUrl.trim().replace(/\/+$/, '');
    this.configApiUrl = (config.configApiUrl || '').trim().replace(/\/+$/, '');
  }

  hasConfigApi(): boolean { return !!this.configApiUrl; }

  /** Expose URL template for debugging. */
  getUrlTemplate(): string { return this.urlTemplate; }

  private instanceUrl(subdomain: string): string {
    return this.urlTemplate.replace('{0}', subdomain).trim().replace(/\/+$/, '');
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
      console.error(`[BYM] ${method} ${url} → ${res.status} ${res.statusText}`, errorBody);
      throw new BymApiError(res.status, res.statusText, errorBody);
    }

    if (res.status === 204) return {} as T;
    const text = await res.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  /** Like basicRequest but treats 409 Conflict as success (item already exists). */
  private async basicRequest409OK<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Basic ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(300_000),
    });

    if (res.status === 409) return {} as T; // already exists — idempotent

    if (!res.ok) {
      let errorBody: unknown;
      try { errorBody = await res.json(); } catch { errorBody = await res.text().catch(() => ''); }
      console.error(`[BYM] ${method} ${url} → ${res.status} ${res.statusText}`, errorBody);
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
    console.log(`[BYM] Authorize URL: ${url}`);
    const result = await this.basicRequest<Record<string, unknown>>(
      'GET', url,
    );
    // API returns PascalCase: BearerToken
    return (result.BearerToken || result.bearerToken) as string;
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
    const raw = await this.basicRequest<Record<string, unknown>[]>('GET', `${this.instanceUrl(subdomain)}/api/brands`);
    return raw.map(r => toCamel<LookupValue>(r));
  }

  async createBrands(subdomain: string, brands: LookupValue[]): Promise<unknown> {
    return this.basicRequest409OK('POST', `${this.instanceUrl(subdomain)}/api/brands`, brands);
  }

  async getBranches(subdomain: string): Promise<LookupValue[]> {
    const raw = await this.basicRequest<Record<string, unknown>[]>('GET', `${this.instanceUrl(subdomain)}/api/branches`);
    return raw.map(r => toCamel<LookupValue>(r));
  }

  async createBranches(subdomain: string, branches: LookupValue[]): Promise<unknown> {
    return this.basicRequest409OK('POST', `${this.instanceUrl(subdomain)}/api/branches`, branches);
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

  // ── BuildYourMarket: Milestones ──

  async addMilestones(token: string, milestones: Milestone[]): Promise<unknown> {
    return this.bearerRequest('POST', `${this.buildApiUrl}/api/milestones`, token, milestones);
  }

  // ── BuildYourMarket: Standard Content (Marketing Copy) ──

  async addStandardContent(token: string, branchId: number, content: StandardContent): Promise<unknown> {
    return this.bearerRequest('PUT', `${this.buildApiUrl}/api/marketingcopy/${encodeURIComponent(content.context)}/${branchId}`, token, content);
  }

  // ── Instance API: RSS Feeds ──

  async addRssFeeds(subdomain: string, feeds: RssFeed[]): Promise<unknown> {
    return this.basicRequest409OK('POST', `${this.instanceUrl(subdomain)}/api/newsfeeds`, feeds);
  }

  // ── Instance API: Letterhead (multipart file upload) ──

  async uploadLetterhead(subdomain: string, fileName: string, pdfBuffer: Buffer): Promise<unknown> {
    const boundary = `----BymLetterhead${Date.now()}`;
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/pdf\r\n\r\n`;
    const body = Buffer.concat([
      Buffer.from(header, 'utf-8'),
      pdfBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8'),
    ]);

    const res = await fetch(`${this.instanceUrl(subdomain)}/api/letterheads`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${this.apiKey}`,
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
    return res.json().catch(() => ({}));
  }

  // ── Instance API: Contacts & Users ──

  async createContacts(subdomain: string, contacts: BymContact[]): Promise<Record<string, unknown>> {
    return this.basicRequest<Record<string, unknown>>('POST', `${this.instanceUrl(subdomain)}/api/contacts`, contacts);
  }

  async createUser(subdomain: string, user: BymUser): Promise<unknown> {
    return this.basicRequest409OK('POST', `${this.instanceUrl(subdomain)}/api/users`, user);
  }

  // ── Instance API: Delivery Addresses ──

  async getDeliveryAddresses(subdomain: string): Promise<DeliveryAddress[]> {
    const raw = await this.basicRequest<Record<string, unknown>[]>('GET', `${this.instanceUrl(subdomain)}/api/deliveryaddress`);
    return raw.map(r => toCamel<DeliveryAddress>(r));
  }

  async createDeliveryAddress(subdomain: string, address: DeliveryAddress): Promise<unknown> {
    return this.basicRequest409OK('POST', `${this.instanceUrl(subdomain)}/api/deliveryaddress`, address);
  }

  // ── Config API (Robocop — Basic Auth) ──

  private configUrl(path: string): string {
    if (!this.configApiUrl) throw new Error('Config API URL not configured');
    return `${this.configApiUrl}/${path}`;
  }

  async getConfigSettings(instanceId: number): Promise<InstanceSetting[]> {
    const raw = await this.basicRequest<Record<string, unknown>[]>('GET', this.configUrl(`api/settings/${instanceId}`));
    return raw.map(r => toCamel<InstanceSetting>(r));
  }

  async setConfigSettings(instanceId: number, settings: InstanceSetting[]): Promise<unknown> {
    return this.basicRequest('POST', this.configUrl(`api/settings/${instanceId}`), settings);
  }

  async getEmailComponentLibrary(libraryId: number): Promise<EmailComponentLibrary> {
    return this.basicRequest<EmailComponentLibrary>('GET', this.configUrl(`api/emailcomponentlibraries/${libraryId}`));
  }

  async updateEmailComponentLibrary(library: EmailComponentLibrary): Promise<unknown> {
    return this.basicRequest('PUT', this.configUrl('api/emailcomponentlibraries'), library);
  }

  async addScheduledReport(instanceId: number, reportDefinitionId: number): Promise<unknown> {
    return this.basicRequest409OK('POST', this.configUrl('api/scheduledreports/definitions'), {
      instanceId,
      reportDefinitionId,
    });
  }

  async addPrintLibraryToInstance(instanceId: number, libraryId: number): Promise<unknown> {
    return this.basicRequest409OK('POST', this.configUrl('api/directmail/libraryinstances'), {
      libraryId,
      instanceId,
    });
  }

  // ── Instance ID Lookup ──
  // The Config API needs numeric instance IDs. This looks up by subdomain.

  async getInstanceId(subdomain: string): Promise<number | null> {
    try {
      const result = await this.basicRequest<Record<string, unknown>>('GET', this.configUrl(`api/instances/bysubdomain/${subdomain}`));
      return (result.id || result.Id || result.instanceId || result.InstanceId) as number | null;
    } catch {
      return null;
    }
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
        'Authorization': `Basic ${this.apiKey}`,
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
