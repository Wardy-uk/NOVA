/**
 * Adobe Acrobat Sign REST API v6 client.
 * Uses OAuth 2.0 Authorization Code grant with refresh token.
 *
 * Required settings (Admin > Integrations):
 *   adobe_sign_enabled       = 'true'
 *   adobe_sign_client_id     = OAuth Client ID from Adobe Developer Console
 *   adobe_sign_client_secret = OAuth Client Secret
 *   adobe_sign_redirect_uri  = OAuth redirect URI registered in Adobe
 *   adobe_sign_api_base_url  = API base (e.g. https://api.na1.adobesign.com)
 *   adobe_sign_refresh_token = Populated after successful OAuth connection
 */

export interface AdobeSignConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiBaseUrl: string;
  refreshToken: string | null;
}

export interface AdobeSignAgreementInput {
  name: string;
  signerEmails: string[];
  ccEmails?: string[];
  message?: string;
  transientDocumentId?: string;
  libraryDocumentId?: string;
  signatureType?: 'ESIGN' | 'WRITTEN';
  expirationDays?: number;
  mergeFields?: Array<{ fieldName: string; defaultValue: string }>;
}

export interface AdobeSignAgreementInfo {
  id: string;
  name: string;
  status: string;
  createdDate: string;
  expirationDate?: string;
  senderEmail?: string;
  participantSetsInfo?: Array<{
    memberInfos: Array<{ email: string; name?: string; status?: string }>;
    role: string;
    order: number;
  }>;
}

export interface AdobeSignLibraryDocument {
  id: string;
  name: string;
  createdDate: string;
  modifiedDate: string;
  status: string;
  sharingMode: string;
  templateTypes: string[];
}

export class AdobeSignApiError extends Error {
  constructor(
    public statusCode: number,
    public statusText: string,
    public body: unknown,
  ) {
    super(`Adobe Sign API ${statusCode}: ${statusText}`);
    this.name = 'AdobeSignApiError';
  }
}

export class AdobeSignClient {
  private tokenCache: { token: string; expiresAt: number } | null = null;
  private status: 'connected' | 'disconnected' | 'error' = 'disconnected';
  private lastError: string | null = null;
  private lastConnected: string | null = null;

  constructor(
    private config: AdobeSignConfig,
    private onRefreshTokenUpdate?: (newRefreshToken: string) => void,
  ) {
    if (config.refreshToken) {
      this.status = 'connected';
    }
  }

  getStatus() {
    return {
      status: this.status,
      lastError: this.lastError,
      lastConnected: this.lastConnected,
    };
  }

  // ── OAuth Flow ──

  getAuthUrl(scopes = 'agreement_read agreement_write agreement_send library_read'): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: scopes,
    });
    return `${this.config.apiBaseUrl}/public/oauth/v2?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const res = await fetch(`${this.config.apiBaseUrl}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        code,
      }).toString(),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new AdobeSignApiError(res.status, res.statusText, errText);
    }

    const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    this.config.refreshToken = data.refresh_token;
    this.status = 'connected';
    this.lastConnected = new Date().toISOString();
    this.lastError = null;

    this.onRefreshTokenUpdate?.(data.refresh_token);

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  // ── Token Management ──

  private async getToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt - 60_000) {
      return this.tokenCache.token;
    }

    if (!this.config.refreshToken) {
      this.status = 'disconnected';
      throw new Error('Adobe Sign not connected — no refresh token. Complete OAuth flow first.');
    }

    const res = await fetch(`${this.config.apiBaseUrl}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
      }).toString(),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[Adobe Sign Token] ${res.status} ${res.statusText} — ${errText}`);
      this.status = 'error';
      this.lastError = `Token refresh failed: ${res.status}`;
      throw new AdobeSignApiError(res.status, res.statusText, errText);
    }

    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    this.status = 'connected';
    this.lastConnected = new Date().toISOString();
    this.lastError = null;

    if (data.refresh_token && data.refresh_token !== this.config.refreshToken) {
      this.config.refreshToken = data.refresh_token;
      this.onRefreshTokenUpdate?.(data.refresh_token);
    }

    return this.tokenCache.token;
  }

  // ── HTTP Helpers ──

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.getToken();
    const url = `${this.config.apiBaseUrl}/api/rest/v6${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
    if (body && !(body instanceof Buffer)) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body instanceof Buffer ? undefined : body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[Adobe Sign API] ${method} ${path} → ${res.status} ${res.statusText}`);
      let errBody: unknown;
      try { errBody = JSON.parse(errText); } catch { errBody = errText; }
      throw new AdobeSignApiError(res.status, res.statusText, errBody);
    }

    return res.json() as Promise<T>;
  }

  // ── Agreements ──

  async listAgreements(): Promise<AdobeSignAgreementInfo[]> {
    const data = await this.request<{ userAgreementList: AdobeSignAgreementInfo[] }>(
      'GET', '/agreements',
    );
    return data.userAgreementList ?? [];
  }

  async getAgreement(agreementId: string): Promise<AdobeSignAgreementInfo> {
    return this.request<AdobeSignAgreementInfo>('GET', `/agreements/${encodeURIComponent(agreementId)}`);
  }

  async createAgreement(input: AdobeSignAgreementInput): Promise<{ id: string }> {
    const fileInfos: Array<Record<string, unknown>> = [];
    if (input.transientDocumentId) {
      fileInfos.push({ transientDocumentId: input.transientDocumentId });
    } else if (input.libraryDocumentId) {
      fileInfos.push({ libraryDocumentId: input.libraryDocumentId });
    }

    const participantSetsInfo = input.signerEmails.map((email, i) => ({
      memberInfos: [{ email }],
      role: 'SIGNER',
      order: i + 1,
    }));

    if (input.ccEmails?.length) {
      for (const email of input.ccEmails) {
        participantSetsInfo.push({
          memberInfos: [{ email }],
          role: 'CC' as any,
          order: 1,
        });
      }
    }

    const body: Record<string, unknown> = {
      name: input.name,
      fileInfos,
      participantSetsInfo,
      signatureType: input.signatureType ?? 'ESIGN',
      state: 'IN_PROCESS',
    };

    if (input.message) {
      body.message = input.message;
    }
    if (input.expirationDays) {
      const expDate = new Date();
      expDate.setDate(expDate.getDate() + input.expirationDays);
      body.expirationTime = expDate.toISOString();
    }
    if (input.mergeFields?.length) {
      body.mergeFieldInfo = input.mergeFields;
    }

    return this.request<{ id: string }>('POST', '/agreements', body);
  }

  // ── Transient Documents ──

  async uploadTransientDocument(
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<{ transientDocumentId: string }> {
    const token = await this.getToken();
    const url = `${this.config.apiBaseUrl}/api/rest/v6/transientDocuments`;

    // Build multipart body manually (same pattern as bym-client.ts)
    const boundary = `----AdobeSign${Date.now()}`;
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="File"; filename="${fileName}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`,
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, fileBuffer, footer]);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new AdobeSignApiError(res.status, res.statusText, errText);
    }

    return res.json() as Promise<{ transientDocumentId: string }>;
  }

  // ── Library Documents ──

  async getLibraryDocuments(): Promise<AdobeSignLibraryDocument[]> {
    const data = await this.request<{ libraryDocumentList: AdobeSignLibraryDocument[] }>(
      'GET', '/libraryDocuments',
    );
    return data.libraryDocumentList ?? [];
  }

  // ── Download Signed Document ──

  async downloadSignedDocument(agreementId: string): Promise<Buffer> {
    const token = await this.getToken();
    const url = `${this.config.apiBaseUrl}/api/rest/v6/agreements/${encodeURIComponent(agreementId)}/combinedDocument`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new AdobeSignApiError(res.status, res.statusText, errText);
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  disconnect(): void {
    this.tokenCache = null;
    this.config.refreshToken = null;
    this.status = 'disconnected';
    this.lastError = null;
  }
}

export function buildAdobeSignClient(
  settings: Record<string, string>,
  onRefreshTokenUpdate?: (newToken: string) => void,
): AdobeSignClient | null {
  if (
    settings.adobe_sign_enabled !== 'true' ||
    !settings.adobe_sign_client_id ||
    !settings.adobe_sign_client_secret ||
    !settings.adobe_sign_redirect_uri ||
    !settings.adobe_sign_api_base_url
  ) {
    return null;
  }
  return new AdobeSignClient(
    {
      clientId: settings.adobe_sign_client_id,
      clientSecret: settings.adobe_sign_client_secret,
      redirectUri: settings.adobe_sign_redirect_uri,
      apiBaseUrl: settings.adobe_sign_api_base_url.replace(/\/+$/, ''),
      refreshToken: settings.adobe_sign_refresh_token || null,
    },
    onRefreshTokenUpdate,
  );
}
