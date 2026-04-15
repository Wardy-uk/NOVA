import { loadConfig, type NovaApiConfig } from './config.js';

interface LoginResponse {
  ok: boolean;
  data?: { token?: string; user?: unknown };
  error?: string;
}

export class NovaAuthClient {
  private baseUrl: string;
  private token: string | null = null;
  private username?: string;
  private password?: string;

  constructor(config: NovaApiConfig) {
    this.baseUrl = config.baseUrl;
    this.username = config.username;
    this.password = config.password;
    this.token = config.token ?? null;
  }

  get base(): string {
    return this.baseUrl;
  }

  private async login(): Promise<string> {
    if (!this.username || !this.password) {
      throw new Error('No token and no username/password configured in config.json');
    }

    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.username, password: this.password }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Login to ${this.baseUrl} failed: ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 300)}` : ''}`,
      );
    }

    const body = (await res.json()) as LoginResponse;
    if (!body.ok || !body.data?.token) {
      throw new Error(`Login failed: ${body.error ?? 'no token returned'}`);
    }

    this.token = body.data.token;
    return this.token;
  }

  async ensureToken(): Promise<string> {
    if (this.token) return this.token;
    return this.login();
  }

  async fetchRaw(path: string, options: RequestInit = {}): Promise<Response> {
    const token = await this.ensureToken();

    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
    };
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    let res = await fetch(`${this.baseUrl}${path}`, { ...options, headers });

    if (res.status === 401 && this.username && this.password) {
      this.token = null;
      const fresh = await this.login();
      headers.Authorization = `Bearer ${fresh}`;
      res = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
    }

    return res;
  }
}

let clientSingleton: NovaAuthClient | null = null;
let configCache: NovaApiConfig | null = null;

function getOrLoadConfig(): NovaApiConfig {
  if (!configCache) configCache = loadConfig();
  return configCache;
}

export function getClient(): NovaAuthClient {
  if (!clientSingleton) {
    clientSingleton = new NovaAuthClient(getOrLoadConfig());
  }
  return clientSingleton;
}

/** The configured default NOVA environment ("live" or "uat"). */
export function getEnv(): 'live' | 'uat' {
  return getOrLoadConfig().env ?? 'live';
}

export interface ApiEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  [key: string]: unknown;
}

/** GET /api/... and unwrap { ok, data }. Throws on non-ok or HTTP errors. */
export async function apiGet<T = unknown>(
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  let url = path;
  if (query) {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (qs) url += (path.includes('?') ? '&' : '?') + qs;
  }

  const res = await getClient().fetchRaw(url);
  const text = await res.text();
  let body: ApiEnvelope<T>;
  try {
    body = text ? (JSON.parse(text) as ApiEnvelope<T>) : { ok: false, error: 'Empty response' };
  } catch {
    throw new Error(`GET ${url} returned non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok || !body.ok) {
    throw new Error(`GET ${url} failed: ${body.error ?? `${res.status} ${res.statusText}`}`);
  }
  return body.data as T;
}

/** PUT /api/... with JSON body. */
export async function apiPut<T = unknown>(path: string, body: unknown): Promise<T | undefined> {
  const res = await getClient().fetchRaw(path, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: ApiEnvelope<T>;
  try {
    parsed = text ? (JSON.parse(text) as ApiEnvelope<T>) : { ok: res.ok };
  } catch {
    throw new Error(`PUT ${path} returned non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || !parsed.ok) {
    throw new Error(`PUT ${path} failed: ${parsed.error ?? `${res.status} ${res.statusText}`}`);
  }
  return parsed.data;
}
