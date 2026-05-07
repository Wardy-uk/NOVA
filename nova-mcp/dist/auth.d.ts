import { type NovaApiConfig } from './config.js';
export declare class NovaAuthClient {
    private baseUrl;
    private token;
    private username?;
    private password?;
    constructor(config: NovaApiConfig);
    get base(): string;
    private login;
    ensureToken(): Promise<string>;
    fetchRaw(path: string, options?: RequestInit): Promise<Response>;
}
export declare function getClient(): NovaAuthClient;
/** The configured default NOVA environment ("live" or "uat"). */
export declare function getEnv(): 'live' | 'uat';
export interface ApiEnvelope<T = unknown> {
    ok: boolean;
    data?: T;
    error?: string;
    [key: string]: unknown;
}
/** GET /api/... and unwrap { ok, data }. Throws on non-ok or HTTP errors. */
export declare function apiGet<T = unknown>(path: string, query?: Record<string, string | number | undefined>): Promise<T>;
/** PUT /api/... with JSON body. */
export declare function apiPut<T = unknown>(path: string, body: unknown): Promise<T | undefined>;
