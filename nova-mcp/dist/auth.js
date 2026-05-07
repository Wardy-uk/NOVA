import { loadConfig } from './config.js';
export class NovaAuthClient {
    baseUrl;
    token = null;
    username;
    password;
    constructor(config) {
        this.baseUrl = config.baseUrl;
        this.username = config.username;
        this.password = config.password;
        this.token = config.token ?? null;
    }
    get base() {
        return this.baseUrl;
    }
    async login() {
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
            throw new Error(`Login to ${this.baseUrl} failed: ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 300)}` : ''}`);
        }
        const body = (await res.json());
        if (!body.ok || !body.data?.token) {
            throw new Error(`Login failed: ${body.error ?? 'no token returned'}`);
        }
        this.token = body.data.token;
        return this.token;
    }
    async ensureToken() {
        if (this.token)
            return this.token;
        return this.login();
    }
    async fetchRaw(path, options = {}) {
        const token = await this.ensureToken();
        const headers = {
            ...options.headers,
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
let clientSingleton = null;
let configCache = null;
function getOrLoadConfig() {
    if (!configCache)
        configCache = loadConfig();
    return configCache;
}
export function getClient() {
    if (!clientSingleton) {
        clientSingleton = new NovaAuthClient(getOrLoadConfig());
    }
    return clientSingleton;
}
/** The configured default NOVA environment ("live" or "uat"). */
export function getEnv() {
    return getOrLoadConfig().env ?? 'live';
}
/** GET /api/... and unwrap { ok, data }. Throws on non-ok or HTTP errors. */
export async function apiGet(path, query) {
    let url = path;
    if (query) {
        const qs = Object.entries(query)
            .filter(([, v]) => v !== undefined && v !== null && v !== '')
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
            .join('&');
        if (qs)
            url += (path.includes('?') ? '&' : '?') + qs;
    }
    const res = await getClient().fetchRaw(url);
    const text = await res.text();
    let body;
    try {
        body = text ? JSON.parse(text) : { ok: false, error: 'Empty response' };
    }
    catch {
        throw new Error(`GET ${url} returned non-JSON response (${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok || !body.ok) {
        throw new Error(`GET ${url} failed: ${body.error ?? `${res.status} ${res.statusText}`}`);
    }
    return body.data;
}
/** PUT /api/... with JSON body. */
export async function apiPut(path, body) {
    const res = await getClient().fetchRaw(path, {
        method: 'PUT',
        body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed;
    try {
        parsed = text ? JSON.parse(text) : { ok: res.ok };
    }
    catch {
        throw new Error(`PUT ${path} returned non-JSON response (${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok || !parsed.ok) {
        throw new Error(`PUT ${path} failed: ${parsed.error ?? `${res.status} ${res.statusText}`}`);
    }
    return parsed.data;
}
//# sourceMappingURL=auth.js.map