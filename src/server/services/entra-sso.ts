import { ConfidentialClientApplication } from '@azure/msal-node';
import crypto from 'crypto';

const SSO_SCOPES = ['openid', 'profile', 'email', 'User.Read'];

// In-memory PKCE + state store (expires after 10 min)
const pendingLogins = new Map<string, { verifier: string; createdAt: number }>();
const EXPIRY_MS = 10 * 60 * 1000;

function cleanExpired(): void {
  const now = Date.now();
  for (const [key, val] of pendingLogins) {
    if (now - val.createdAt > EXPIRY_MS) pendingLogins.delete(key);
  }
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

    cleanExpired();
    const { verifier, challenge } = generatePkce();
    const state = crypto.randomBytes(16).toString('hex');
    pendingLogins.set(state, { verifier, createdAt: Date.now() });

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

    cleanExpired();
    const pending = pendingLogins.get(state);
    if (!pending) throw new Error('Invalid or expired SSO state. Please try logging in again.');
    pendingLogins.delete(state);

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

    return { oid, email, name, preferredUsername };
  }
}
