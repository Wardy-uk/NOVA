import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface NovaConfig {
  nova_api_url: string;
  nova_username: string;
  nova_password: string;
}

interface AuthState {
  token: string;
  expiresAt: number;
}

let config: NovaConfig | null = null;
let auth: AuthState | null = null;

function loadConfig(): NovaConfig {
  if (config) return config;

  const configPath = join(__dirname, '..', 'config.json');
  if (!existsSync(configPath)) {
    throw new Error(
      'config.json not found. Create it with: { "nova_api_url": "https://nova.nurtur.tech", "nova_username": "...", "nova_password": "..." }',
    );
  }

  const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  if (!raw.nova_api_url || !raw.nova_username || !raw.nova_password) {
    throw new Error('config.json must contain nova_api_url, nova_username, nova_password');
  }

  config = {
    nova_api_url: raw.nova_api_url.replace(/\/+$/, ''),
    nova_username: raw.nova_username,
    nova_password: raw.nova_password,
  };
  return config;
}

async function authenticate(): Promise<string> {
  if (auth && auth.expiresAt > Date.now() + 60_000) {
    return auth.token;
  }

  const cfg = loadConfig();
  const res = await fetch(`${cfg.nova_api_url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: cfg.nova_username, password: cfg.nova_password }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Login failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const token = data.token ?? data.data?.token;
  if (!token) throw new Error('Login response missing token');

  // JWT tokens expire in 7d — refresh after 6d
  auth = { token, expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000 };
  console.error('[nova-mcp] Authenticated successfully');
  return token;
}

export async function novaGet<T = unknown>(path: string, params?: Record<string, string | number>): Promise<T> {
  const cfg = loadConfig();
  const token = await authenticate();

  const url = new URL(`${cfg.nova_api_url}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    auth = null;
    const freshToken = await authenticate();
    const retry = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    if (!retry.ok) throw new Error(`GET ${path} failed (${retry.status}): ${await retry.text()}`);
    return retry.json() as Promise<T>;
  }

  if (!res.ok) throw new Error(`GET ${path} failed (${res.status}): ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function novaPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const cfg = loadConfig();
  const token = await authenticate();

  const res = await fetch(`${cfg.nova_api_url}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    auth = null;
    const freshToken = await authenticate();
    const retry = await fetch(`${cfg.nova_api_url}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${freshToken}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!retry.ok) throw new Error(`POST ${path} failed (${retry.status}): ${await retry.text()}`);
    return retry.json() as Promise<T>;
  }

  if (!res.ok) throw new Error(`POST ${path} failed (${res.status}): ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function novaPut<T = unknown>(path: string, body?: unknown): Promise<T> {
  const cfg = loadConfig();
  const token = await authenticate();

  const res = await fetch(`${cfg.nova_api_url}${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    auth = null;
    const freshToken = await authenticate();
    const retry = await fetch(`${cfg.nova_api_url}${path}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${freshToken}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!retry.ok) throw new Error(`PUT ${path} failed (${retry.status}): ${await retry.text()}`);
    return retry.json() as Promise<T>;
  }

  if (!res.ok) throw new Error(`PUT ${path} failed (${res.status}): ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function novaDelete<T = unknown>(path: string): Promise<T> {
  const cfg = loadConfig();
  const token = await authenticate();

  const res = await fetch(`${cfg.nova_api_url}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    auth = null;
    const freshToken = await authenticate();
    const retry = await fetch(`${cfg.nova_api_url}${path}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    if (!retry.ok) throw new Error(`DELETE ${path} failed (${retry.status}): ${await retry.text()}`);
    return retry.json() as Promise<T>;
  }

  if (!res.ok) throw new Error(`DELETE ${path} failed (${res.status}): ${await res.text()}`);
  return res.json() as Promise<T>;
}
