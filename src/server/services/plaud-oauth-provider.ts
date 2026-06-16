/**
 * OAuth client provider for Plaud's hosted MCP server (https://mcp.plaud.ai/mcp).
 *
 * Implements the MCP SDK OAuthClientProvider, persisting client registration,
 * tokens, PKCE verifier and CSRF state in settings.json. The browser sign-in is
 * one-time; the SDK auto-refreshes the access token from the stored refresh token,
 * so this does not need re-doing (unlike a hand-copied token file).
 *
 * Flow: connect() with no tokens -> SDK captures an authorization URL via
 * redirectToAuthorization() and throws UnauthorizedError. The user opens that URL,
 * signs in, and Plaud redirects to our public callback, which calls
 * transport.finishAuth(code) to exchange the code for tokens.
 */
import { randomBytes } from 'crypto';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientMetadata,
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { SettingsQueries } from '../db/settings-store.js';

const K = {
  client: 'plaud_oauth_client',
  tokens: 'plaud_oauth_tokens',
  verifier: 'plaud_oauth_verifier',
  state: 'plaud_oauth_state',
  authUrl: 'plaud_oauth_auth_url',
} as const;

export class PlaudOAuthProvider implements OAuthClientProvider {
  constructor(private settings: SettingsQueries, private getBaseUrl: () => string) {}

  get redirectUrl(): string {
    return `${this.getBaseUrl().replace(/\/+$/, '')}/api/public/plaud/oauth/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'N.O.V.A',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', // public client (PKCE)
    };
  }

  state(): string {
    const s = randomBytes(16).toString('hex');
    this.settings.set(K.state, s);
    return s;
  }
  savedState(): string {
    return this.settings.get(K.state) || '';
  }

  clientInformation(): OAuthClientInformation | undefined {
    const raw = this.settings.get(K.client);
    if (!raw) return undefined;
    try { return JSON.parse(raw) as OAuthClientInformation; } catch { return undefined; }
  }
  saveClientInformation(info: OAuthClientInformationFull): void {
    this.settings.set(K.client, JSON.stringify(info));
  }

  tokens(): OAuthTokens | undefined {
    const raw = this.settings.get(K.tokens);
    if (!raw) return undefined;
    try { return JSON.parse(raw) as OAuthTokens; } catch { return undefined; }
  }
  saveTokens(tokens: OAuthTokens): void {
    this.settings.set(K.tokens, JSON.stringify(tokens));
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    // Server context: we can't redirect the user agent here — capture the URL so
    // the Connect action can hand it to the user to open in their browser.
    this.settings.set(K.authUrl, authorizationUrl.toString());
  }
  authorizationUrl(): string {
    return this.settings.get(K.authUrl) || '';
  }
  clearAuthorizationUrl(): void {
    this.settings.set(K.authUrl, '');
  }

  saveCodeVerifier(verifier: string): void {
    this.settings.set(K.verifier, verifier);
  }
  codeVerifier(): string {
    const v = this.settings.get(K.verifier);
    if (!v) throw new Error('No Plaud PKCE code verifier saved — restart the connect flow.');
    return v;
  }

  hasTokens(): boolean {
    return !!this.settings.get(K.tokens);
  }

  /** Wipe all stored OAuth state (logout / reset). */
  reset(): void {
    for (const key of Object.values(K)) this.settings.set(key, '');
  }
}
