import { PublicClientApplication, LogLevel } from '@azure/msal-node';
import type { DeviceCodeRequest, AuthenticationResult, AccountInfo } from '@azure/msal-node';
import type { CrmQueries } from '../db/queries.js';
import * as fs from 'fs';
import * as path from 'path';

const D365_BASE_URL = process.env.D365_ORG_URL || 'https://nurtur-prod.crm11.dynamics.com';
const DATA_DIR = process.env.DATA_DIR || process.cwd();
const CACHE_FILE = path.join(DATA_DIR, '.d365-token-cache.json');

interface D365Config {
  tenantId: string;
  clientId: string;
}

interface D365Account {
  accountid: string;
  name: string | null;
  revenue: number | null;
  telephone1: string | null;
  emailaddress1: string | null;
  industrycode: number | null;
  statecode: number; // 0=Active, 1=Inactive
  statuscode: number;
  _ownerid_value: string | null;
  createdon: string;
  modifiedon: string;
}

export class Dynamics365Service {
  private msalApp: PublicClientApplication;
  private status: 'connected' | 'disconnected' | 'error' = 'disconnected';
  private lastError: string | null = null;
  private lastConnected: string | null = null;
  private loginInProgress: Promise<AuthenticationResult | null> | null = null;

  constructor(private config: D365Config) {
    // Load persisted token cache if it exists
    let cacheData: string | undefined;
    try {
      if (fs.existsSync(CACHE_FILE)) {
        cacheData = fs.readFileSync(CACHE_FILE, 'utf-8');
      }
    } catch {
      // ignore read errors
    }

    this.msalApp = new PublicClientApplication({
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
      },
      cache: {
        cachePlugin: {
          beforeCacheAccess: async (ctx) => {
            // Load from file on first access
            try {
              if (fs.existsSync(CACHE_FILE)) {
                const data = fs.readFileSync(CACHE_FILE, 'utf-8');
                ctx.tokenCache.deserialize(data);
              }
            } catch {
              // ignore
            }
          },
          afterCacheAccess: async (ctx) => {
            // Persist to file after any change
            if (ctx.cacheHasChanged) {
              try {
                fs.writeFileSync(CACHE_FILE, ctx.tokenCache.serialize(), 'utf-8');
              } catch (err) {
                console.error('[D365] Failed to persist token cache:', err);
              }
            }
          },
        },
      },
      system: {
        loggerOptions: {
          logLevel: LogLevel.Warning,
          loggerCallback: (_level, message) => {
            if (message.includes('Error')) console.error('[D365-MSAL]', message);
          },
        },
      },
    });
  }

  /** Start device code login flow. Callback fires immediately with code+URL. */
  async startLogin(
    onDeviceCode: (info: { userCode: string; verificationUri: string; message: string }) => void
  ): Promise<AuthenticationResult | null> {
    const request: DeviceCodeRequest = {
      scopes: [`${D365_BASE_URL}/.default`],
      deviceCodeCallback: (response) => {
        onDeviceCode({
          userCode: response.userCode,
          verificationUri: response.verificationUri,
          message: response.message,
        });
      },
    };

    this.loginInProgress = this.msalApp.acquireTokenByDeviceCode(request);
    try {
      const result = await this.loginInProgress;
      if (result) {
        this.status = 'connected';
        this.lastConnected = new Date().toISOString();
        this.lastError = null;
        console.log('[D365] Device code login succeeded');
      }
      return result;
    } catch (err) {
      this.status = 'error';
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error('[D365] Device code login failed:', this.lastError);
      return null;
    } finally {
      this.loginInProgress = null;
    }
  }

  /** Check if there's a cached account (i.e. user has logged in). */
  async isLoggedIn(): Promise<boolean> {
    try {
      const cache = this.msalApp.getTokenCache();
      const accounts = await cache.getAllAccounts();
      return accounts.length > 0;
    } catch {
      return false;
    }
  }

  /** Clear all cached accounts and tokens. */
  async logout(): Promise<void> {
    try {
      const cache = this.msalApp.getTokenCache();
      const accounts = await cache.getAllAccounts();
      for (const acct of accounts) {
        await cache.removeAccount(acct);
      }
    } catch {
      // ignore
    }
    // Delete cache file
    try {
      if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
    } catch {
      // ignore
    }
    this.status = 'disconnected';
    this.lastError = null;
    console.log('[D365] Logged out, cache cleared');
  }

  /** Acquire a valid access token (silent — uses cached refresh token). */
  private async getToken(): Promise<string> {
    const cache = this.msalApp.getTokenCache();
    const accounts = await cache.getAllAccounts();
    if (accounts.length === 0) {
      throw new Error('Not signed in to Dynamics 365. Please sign in first.');
    }

    try {
      const result = await this.msalApp.acquireTokenSilent({
        scopes: [`${D365_BASE_URL}/.default`],
        account: accounts[0],
      });
      if (!result?.accessToken) {
        throw new Error('Failed to acquire D365 access token');
      }
      return result.accessToken;
    } catch (err) {
      // If silent fails (refresh token expired), mark as disconnected
      this.status = 'error';
      this.lastError = 'Session expired. Please sign in again.';
      throw new Error('D365 session expired. Please sign in again.');
    }
  }

  private async fetch<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const token = await this.getToken();
    const url = new URL(`${D365_BASE_URL}/api/data/v9.2/${endpoint}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    const res = await globalThis.fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        Accept: 'application/json',
        Prefer: 'odata.include-annotations="*"',
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`D365 API ${res.status}: ${body.substring(0, 500)}`);
    }

    return res.json() as Promise<T>;
  }

  async whoAmI(): Promise<{ UserId: string; OrganizationId: string; BusinessUnitId: string }> {
    try {
      const result = await this.fetch<{ UserId: string; OrganizationId: string; BusinessUnitId: string }>('WhoAmI');
      this.status = 'connected';
      this.lastConnected = new Date().toISOString();
      this.lastError = null;
      return result;
    } catch (err) {
      this.status = 'error';
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  async getAccounts(top = 100): Promise<D365Account[]> {
    const result = await this.fetch<{ value: D365Account[] }>('accounts', {
      $select: 'accountid,name,revenue,telephone1,emailaddress1,industrycode,statecode,statuscode,_ownerid_value,createdon,modifiedon',
      $orderby: 'name asc',
      $top: String(top),
      $filter: 'statecode eq 0', // Active only
    });
    return result.value;
  }

  async getAccountActivities(accountId: string): Promise<unknown[]> {
    const result = await this.fetch<{ value: unknown[] }>('tasks', {
      $select: 'subject,description,scheduledstart,scheduledend,statecode,prioritycode',
      $filter: `_regardingobjectid_value eq '${accountId}'`,
      $orderby: 'createdon desc',
      $top: '50',
    });
    return result.value;
  }

  async syncToLocal(crmQueries: CrmQueries): Promise<{ created: number; updated: number; total: number }> {
    const accounts = await this.getAccounts(500);
    let created = 0;
    let updated = 0;

    for (const acct of accounts) {
      // Skip accounts with no name
      const accountName = acct.name?.trim();
      if (!accountName) {
        console.log(`[D365 Sync] Skipping account ${acct.accountid} — no name`);
        continue;
      }

      // Check if customer already exists by dynamics_id
      const existing = crmQueries.getAllCustomers({ search: undefined }).find(
        (c) => c.dynamics_id === acct.accountid
      );

      const data = {
        name: accountName,
        company: accountName,
        mrr: acct.revenue ?? null,
        dynamics_id: acct.accountid,
      };

      if (existing) {
        crmQueries.updateCustomer(existing.id, data);
        updated++;
      } else {
        crmQueries.createCustomer({
          ...data,
          sector: null,
          owner: null,
          rag_status: 'green',
          next_review_date: null,
          contract_start: null,
          contract_end: null,
          notes: null,
        });
        created++;
      }
    }

    this.status = 'connected';
    this.lastConnected = new Date().toISOString();
    this.lastError = null;

    return { created, updated, total: accounts.length };
  }

  getStatus() {
    return {
      status: this.status,
      lastError: this.lastError,
      lastConnected: this.lastConnected,
    };
  }
}
