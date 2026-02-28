import crypto from 'crypto';

interface OAuthState {
  state: string;
  codeVerifier: string;
  userId: number;
  createdAt: number;
}

const pendingStates = new Map<string, OAuthState>();
const STATE_TTL = 600_000; // 10 minutes

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export class JiraOAuthService {
  constructor(
    private getSettings: () => Record<string, string>,
  ) {}

  private get clientId(): string | null {
    return this.getSettings().jira_oauth_client_id || null;
  }

  private get clientSecret(): string | null {
    return this.getSettings().jira_oauth_client_secret || null;
  }

  isConfigured(): boolean {
    return !!this.clientId && !!this.clientSecret;
  }

  getAuthUrl(redirectUri: string, userId: number): string {
    const clientId = this.clientId;
    if (!clientId) throw new Error('Jira OAuth client ID not configured');

    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    pendingStates.set(state, { state, codeVerifier, userId, createdAt: Date.now() });

    // Clean up expired states
    for (const [key, val] of pendingStates) {
      if (Date.now() - val.createdAt > STATE_TTL) pendingStates.delete(key);
    }

    const params = new URLSearchParams({
      audience: 'api.atlassian.com',
      client_id: clientId,
      scope: 'read:jira-work write:jira-work offline_access',
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      prompt: 'consent',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return `https://auth.atlassian.com/authorize?${params}`;
  }

  async exchangeCode(
    code: string,
    state: string,
    redirectUri: string,
  ): Promise<{ accessToken: string; refreshToken: string; cloudId: string; siteUrl: string; userId: number }> {
    const pending = pendingStates.get(state);
    if (!pending) throw new Error('Invalid or expired state parameter');
    pendingStates.delete(state);

    if (Date.now() - pending.createdAt > STATE_TTL) {
      throw new Error('OAuth state expired');
    }

    const clientId = this.clientId;
    const clientSecret = this.clientSecret;
    if (!clientId || !clientSecret) throw new Error('Jira OAuth not configured');

    // Exchange authorization code for tokens
    const tokenRes = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: pending.codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      throw new Error(`Token exchange failed: ${tokenRes.status} ${errBody}`);
    }

    const tokenData = await tokenRes.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    // Get accessible resources to find cloud ID and site URL
    const resourcesRes = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/json' },
    });

    if (!resourcesRes.ok) throw new Error('Failed to get accessible resources');

    const resources = await resourcesRes.json() as Array<{ id: string; url: string; name: string }>;
    if (resources.length === 0) throw new Error('No Jira sites found for this account');

    // Use the first available site
    const site = resources[0];

    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      cloudId: site.id,
      siteUrl: site.url,
      userId: pending.userId,
    };
  }

  async refreshToken(refreshTokenValue: string): Promise<{ accessToken: string; refreshToken: string }> {
    const clientId = this.clientId;
    const clientSecret = this.clientSecret;
    if (!clientId || !clientSecret) throw new Error('Jira OAuth not configured');

    const res = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshTokenValue,
      }),
    });

    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);

    const data = await res.json() as { access_token: string; refresh_token: string };
    return { accessToken: data.access_token, refreshToken: data.refresh_token };
  }

  getPendingUserId(state: string): number | null {
    return pendingStates.get(state)?.userId ?? null;
  }
}
