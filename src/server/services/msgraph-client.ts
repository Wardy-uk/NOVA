import { ConfidentialClientApplication, LogLevel } from '@azure/msal-node';
import type { ClientCredentialRequest } from '@azure/msal-node';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = process.env.DATA_DIR || process.cwd();
const CACHE_FILE = path.join(DATA_DIR, '.msgraph-token-cache.json');
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

interface MsGraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export class MsGraphClient {
  private msalApp: ConfidentialClientApplication;
  private status: 'connected' | 'disconnected' | 'error' = 'disconnected';
  private lastError: string | null = null;

  constructor(private config: MsGraphConfig) {
    this.msalApp = new ConfidentialClientApplication({
      auth: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
      },
      cache: {
        cachePlugin: {
          beforeCacheAccess: async (ctx) => {
            try {
              if (fs.existsSync(CACHE_FILE)) {
                ctx.tokenCache.deserialize(fs.readFileSync(CACHE_FILE, 'utf-8'));
              }
            } catch { /* ignore */ }
          },
          afterCacheAccess: async (ctx) => {
            if (ctx.cacheHasChanged) {
              try { fs.writeFileSync(CACHE_FILE, ctx.tokenCache.serialize(), 'utf-8'); }
              catch (err) { console.error('[MsGraph] Failed to persist token cache:', err); }
            }
          },
        },
      },
      system: {
        loggerOptions: {
          logLevel: LogLevel.Warning,
          loggerCallback: (_level, message) => {
            if (message.includes('Error')) console.error('[MsGraph-MSAL]', message);
          },
        },
      },
    });
  }

  private async getToken(): Promise<string> {
    const request: ClientCredentialRequest = {
      scopes: ['https://graph.microsoft.com/.default'],
    };
    const result = await this.msalApp.acquireTokenByClientCredential(request);
    if (!result?.accessToken) {
      this.status = 'error';
      this.lastError = 'Failed to acquire token';
      throw new Error('Failed to acquire Microsoft Graph token');
    }
    this.status = 'connected';
    this.lastError = null;
    return result.accessToken;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const token = await this.getToken();
      const resp = await fetch(`${GRAPH_BASE}/organization`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        const text = await resp.text();
        this.status = 'error';
        this.lastError = `${resp.status}: ${text.slice(0, 200)}`;
        return { ok: false, error: this.lastError };
      }
      this.status = 'connected';
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.status = 'error';
      this.lastError = msg;
      return { ok: false, error: msg };
    }
  }

  getStatus() {
    return { status: this.status, lastError: this.lastError };
  }

  async graphGet<T = unknown>(endpoint: string): Promise<T> {
    const token = await this.getToken();
    const url = endpoint.startsWith('http') ? endpoint : `${GRAPH_BASE}${endpoint}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Graph API ${resp.status}: ${text.slice(0, 500)}`);
    }
    return resp.json() as Promise<T>;
  }

  async graphGetBuffer(endpoint: string): Promise<Buffer> {
    const token = await this.getToken();
    const url = endpoint.startsWith('http') ? endpoint : `${GRAPH_BASE}${endpoint}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Graph API ${resp.status}: ${text.slice(0, 500)}`);
    }
    return Buffer.from(await resp.arrayBuffer());
  }

  async graphPut(endpoint: string, body: Buffer, contentType = 'application/octet-stream'): Promise<unknown> {
    const token = await this.getToken();
    const url = endpoint.startsWith('http') ? endpoint : `${GRAPH_BASE}${endpoint}`;
    const resp = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
      },
      body: new Uint8Array(body),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Graph API PUT ${resp.status}: ${text.slice(0, 500)}`);
    }
    return resp.json();
  }

  // --- SharePoint-specific helpers ---

  async listSiteDrives(siteId: string): Promise<Array<{ id: string; name: string }>> {
    // hostname:/path format needs trailing colon before /drives
    const normalized = siteId.includes(':') && !siteId.endsWith(':') ? `${siteId}:` : siteId;
    const data = await this.graphGet<{ value: Array<{ id: string; name: string }> }>(
      `/sites/${normalized}/drives`
    );
    return data.value;
  }

  async listFolderChildren(driveId: string, itemId: string): Promise<Array<{ id: string; name: string; folder?: unknown }>> {
    const data = await this.graphGet<{ value: Array<{ id: string; name: string; folder?: unknown }> }>(
      `/drives/${driveId}/items/${itemId}/children`
    );
    return data.value;
  }

  async downloadFile(driveId: string, itemId: string): Promise<Buffer> {
    return this.graphGetBuffer(`/drives/${driveId}/items/${itemId}/content`);
  }

  async uploadFile(driveId: string, parentItemId: string, fileName: string, content: Buffer): Promise<unknown> {
    const encodedName = encodeURIComponent(fileName);
    return this.graphPut(
      `/drives/${driveId}/items/${parentItemId}:/${encodedName}:/content`,
      content,
    );
  }
}
