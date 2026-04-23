import { ConfidentialClientApplication } from '@azure/msal-node';
import crypto from 'crypto';

const SSO_SCOPES = ['openid', 'profile', 'email', 'User.Read', 'GroupMember.Read.All'];

const EXPIRY_MS = 10 * 60 * 1000;

type PendingEntry = { verifier: string; createdAt: number };

// In-memory store — no file I/O races. Node is single-threaded so Map ops are atomic.
// A restart just means in-flight SSO users click login again (10-min window max).
const pendingStore = new Map<string, PendingEntry>();

function cleanExpired(): void {
  const now = Date.now();
  for (const [key, entry] of pendingStore) {
    if (now - entry.createdAt > EXPIRY_MS) pendingStore.delete(key);
  }
}

function putPending(state: string, verifier: string): void {
  cleanExpired();
  pendingStore.set(state, { verifier, createdAt: Date.now() });
}

function takePending(state: string): PendingEntry | null {
  cleanExpired();
  const entry = pendingStore.get(state);
  if (!entry) return null;
  pendingStore.delete(state);
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
