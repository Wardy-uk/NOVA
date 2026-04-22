import { ConfidentialClientApplication } from '@azure/msal-node';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const SSO_SCOPES = ['openid', 'profile', 'email', 'User.Read', 'GroupMember.Read.All'];

// File-backed PKCE + state store — survives process restarts and builds.
const DATA_DIR = process.env.DATA_DIR || process.cwd();
const PENDING_FILE = path.join(DATA_DIR, 'sso-pending.json');
const EXPIRY_MS = 10 * 60 * 1000;

type PendingEntry = { verifier: string; createdAt: number };
type PendingStore = Record<string, PendingEntry>;

function loadPending(): PendingStore {
  try {
    if (fs.existsSync(PENDING_FILE)) {
      return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf-8')) as PendingStore;
    }
  } catch {
    console.warn('[SSO] Failed to read sso-pending.json, starting fresh');
  }
  return {};
}

function savePending(store: PendingStore): void {
  try {
    fs.writeFileSync(PENDING_FILE, JSON.stringify(store), 'utf-8');
  } catch (err) {
    console.error('[SSO] Failed to persist sso-pending.json:', err instanceof Error ? err.message : err);
  }
}

function cleanExpired(store: PendingStore): PendingStore {
  const now = Date.now();
  let changed = false;
  for (const key of Object.keys(store)) {
    if (now - store[key].createdAt > EXPIRY_MS) {
      delete store[key];
      changed = true;
    }
  }
  if (changed) savePending(store);
  return store;
}

function putPending(state: string, verifier: string): void {
  const store = cleanExpired(loadPending());
  store[state] = { verifier, createdAt: Date.now() };
  savePending(store);
}

function takePending(state: string): PendingEntry | null {
  const store = cleanExpired(loadPending());
  const entry = store[state];
  if (!entry) return null;
  delete store[state];
  savePending(store);
  return entry;
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export interface SsoClaimResult {
  oid: string;
  email: string;
  name: string;
  preferredUsername: string;
  groups: string[];
}

export class EntraSsoService {
  private app: ConfidentialClientApplication | null = null;
  private settingsGetter: () => Record<string, string>;

  constructor(settingsGetter: () => Record<string, string>) {
    this.settingsGetter = settingsGetter;
  }

  isConfigured(): boolean {
    const s = this.settingsGetter();
    return s.sso_enabled === 'true' && !!s.sso_tenant_id && !!s.sso_client_id && !!s.sso_client_secret;
  }

  private getApp(): ConfidentialClientApplication | null {
    const s = this.settingsGetter();
    if (!s.sso_tenant_id || !s.sso_client_id || !s.sso_client_secret) return null;

    // Rebuild app each time in case settings changed
    this.app = new ConfidentialClientApplication({
      auth: {
        clientId: s.sso_client_id,
        authority: `https://login.microsoftonline.com/${s.sso_tenant_id}`,
        clientSecret: s.sso_client_secret,
      },
    });
    return this.app;
  }

  async getLoginUrl(redirectUri: string): Promise<string> {
    const app = this.getApp();
    if (!app) throw new Error('SSO not configured');

    const { verifier, challenge } = generatePkce();
    const state = crypto.randomBytes(16).toString('hex');
    putPending(state, verifier);

    const url = await app.getAuthCodeUrl({
      scopes: SSO_SCOPES,
      redirectUri,
      state,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
    });

    return url;
  }

  async handleCallback(code: string, state: string, redirectUri: string): Promise<SsoClaimResult> {
    const app = this.getApp();
    if (!app) throw new Error('SSO not configured');

    const pending = takePending(state);
    if (!pending) throw new Error('Invalid or expired SSO state. Please try logging in again.');

    const result = await app.acquireTokenByCode({
      code,
      redirectUri,
      scopes: SSO_SCOPES,
      codeVerifier: pending.verifier,
    });

    const claims = result.idTokenClaims as Record<string, unknown>;
    if (!claims) throw new Error('No ID token claims returned from Microsoft');

    const oid = (claims.oid as string) || (claims.sub as string) || '';
    const email = (claims.email as string) || (claims.preferred_username as string) || '';
    const name = (claims.name as string) || '';
    const preferredUsername = (claims.preferred_username as string) || email;

    if (!oid) throw new Error('No user identifier (oid) in Microsoft token');
    if (!email) throw new Error('No email in Microsoft token. Ensure User.Read permission is granted.');

    // Fetch group memberships via Graph API
    const groups = await this.fetchUserGroups(result.accessToken);

    return { oid, email, name, preferredUsername, groups };
  }

  /** Fetch the user's Azure AD group IDs via Microsoft Graph /me/transitiveMemberOf */
  private async fetchUserGroups(accessToken: string): Promise<string[]> {
    // Use transitiveMemberOf to resolve nested group memberships (e.g. user is
    // in "Dept - Development" which nests into "N.O.V.A-Developers").
    // Graph paginates at 100 entries by default — follow @odata.nextLink to exhaustion.
    const ids: string[] = [];
    let url: string | null = 'https://graph.microsoft.com/v1.0/me/transitiveMemberOf?$select=id&$top=999';
    try {
      while (url) {
        const res: Response = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
          console.warn(`[SSO] Failed to fetch groups: ${res.status} ${res.statusText}`);
          return ids;
        }
        const data = await res.json() as {
          value?: Array<{ id?: string; '@odata.type'?: string }>;
          '@odata.nextLink'?: string;
        };
        for (const m of data.value ?? []) {
          if (m['@odata.type'] === '#microsoft.graph.group' && m.id) ids.push(m.id);
        }
        url = data['@odata.nextLink'] ?? null;
      }
      return ids;
    } catch (err) {
      console.warn('[SSO] Error fetching group memberships:', err instanceof Error ? err.message : err);
      return ids;
    }
  }
}
