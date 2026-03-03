/**
 * Onboarding.Tool REST client.
 * Calls the setup endpoints on the Onboarding.Tool API to configure
 * brands, branches, logos, templates, cards, letterheads, and portal settings
 * for a client instance.
 */

export interface ObtoolConfig {
  baseUrl: string;   // e.g. https://onboarding.nurtur.agency
  apiKey: string;    // Bearer token
}

export interface SetupResult {
  Success: boolean;
  Message: string;
}

export class ObtoolApiError extends Error {
  constructor(
    public statusCode: number,
    public statusText: string,
    public body: unknown,
  ) {
    const detail = body && typeof body === 'object'
      ? (body as any).Message || (body as any).message || JSON.stringify(body).slice(0, 300)
      : String(body).slice(0, 300);
    super(`Onboarding.Tool API ${statusCode}: ${statusText} — ${detail}`);
    this.name = 'ObtoolApiError';
  }
}

export class OnboardingToolClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: ObtoolConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let errorBody: unknown;
      try { errorBody = await res.json(); } catch { errorBody = await res.text().catch(() => ''); }
      throw new ObtoolApiError(res.status, res.statusText, errorBody);
    }

    if (res.status === 204) return {} as T;
    return await res.json() as T;
  }

  /** Test connectivity. */
  async testConnection(): Promise<boolean> {
    try {
      await this.request('GET', '/api/health');
      return true;
    } catch {
      // Try a simple GET as fallback — some instances may not have /health
      try {
        await this.request('GET', '/api/setup');
        return true;
      } catch {
        return false;
      }
    }
  }

  // ── Per-domain setup endpoints ──
  // These match the Onboarding.Tool SetupController actions.

  async setupBrands(domain: string, payload: unknown): Promise<SetupResult> {
    return this.request('POST', `/api/setup/${encodeURIComponent(domain)}/brands`, payload);
  }

  async setupBranches(domain: string, payload: unknown): Promise<SetupResult> {
    return this.request('POST', `/api/setup/${encodeURIComponent(domain)}/branches`, payload);
  }

  async setupUsers(domain: string, payload: unknown): Promise<SetupResult> {
    return this.request('POST', `/api/setup/${encodeURIComponent(domain)}/users`, payload);
  }

  async setupRss(domain: string, payload: unknown): Promise<SetupResult> {
    return this.request('POST', `/api/setup/${encodeURIComponent(domain)}/rss`, payload);
  }

  async setupLogos(domain: string, payload: unknown): Promise<SetupResult> {
    return this.request('POST', `/api/setup/${encodeURIComponent(domain)}/logos`, payload);
  }

  async createTemplates(domain: string, payload: unknown): Promise<SetupResult> {
    return this.request('POST', `/api/setup/${encodeURIComponent(domain)}/templates/create`, payload);
  }

  async confirmTemplates(domain: string): Promise<SetupResult> {
    return this.request('POST', `/api/setup/${encodeURIComponent(domain)}/templates/confirm`);
  }

  async createCards(domain: string, payload: unknown): Promise<SetupResult> {
    return this.request('POST', `/api/setup/${encodeURIComponent(domain)}/cards/create`, payload);
  }

  async confirmCards(domain: string): Promise<SetupResult> {
    return this.request('POST', `/api/setup/${encodeURIComponent(domain)}/cards/confirm`);
  }

  async createLetterhead(domain: string, payload: unknown): Promise<SetupResult> {
    return this.request('POST', `/api/setup/${encodeURIComponent(domain)}/letterhead/create`, payload);
  }

  async confirmLetterhead(domain: string): Promise<SetupResult> {
    return this.request('POST', `/api/setup/${encodeURIComponent(domain)}/letterhead/confirm`);
  }

  async setupPortal(domain: string, payload: unknown): Promise<SetupResult> {
    return this.request('POST', `/api/setup/${encodeURIComponent(domain)}/portal`, payload);
  }
}
