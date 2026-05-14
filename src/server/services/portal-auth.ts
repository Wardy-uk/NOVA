import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query, queryOne, execute } from './database.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { PortalAuthPayload, PortalUserRole } from '../../shared/portal-types.js';

interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface OidcTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

interface OidcUserClaims {
  sub: string;
  email: string;
  name: string;
  organisation_id?: string;
  org_id?: string;
  organisation_name?: string;
  org_name?: string;
}

// PKCE state storage (in-memory, short-lived)
const pendingStates = new Map<string, { verifier: string; createdAt: number }>();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, val] of pendingStates) {
    if (val.createdAt < cutoff) pendingStates.delete(key);
  }
}, 60_000);

function getOidcConfig(settings: FileSettingsQueries): OidcConfig {
  return {
    issuer: settings.get('portal_oidc_issuer') || '',
    clientId: settings.get('portal_oidc_client_id') || '',
    clientSecret: settings.get('portal_oidc_client_secret') || '',
    redirectUri: settings.get('portal_oidc_redirect_uri') || '',
  };
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateAuthUrl(settings: FileSettingsQueries): { url: string; state: string } {
  const config = getOidcConfig(settings);
  console.log('[portal-auth] generateAuthUrl config:', JSON.stringify(config));
  if (!config.issuer || !config.clientId) {
    throw new Error('Portal OIDC not configured — set portal_oidc_issuer and portal_oidc_client_id');
  }

  const state = crypto.randomBytes(32).toString('hex');
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());

  pendingStates.set(state, { verifier, createdAt: Date.now() });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid profile email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  const url = `${config.issuer}/connect/authorize?${params.toString()}`;
  return { url, state };
}

export async function handleCallback(
  code: string,
  state: string,
  settings: FileSettingsQueries,
): Promise<{ token: string; user: PortalAuthPayload }> {
  const pending = pendingStates.get(state);
  if (!pending) throw new Error('Invalid or expired state parameter');
  pendingStates.delete(state);

  const config = getOidcConfig(settings);

  // Exchange code for tokens
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: pending.verifier,
    ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
  });

  const tokenRes = await fetch(`${config.issuer}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${errBody}`);
  }

  const tokens: OidcTokenResponse = await tokenRes.json();

  // Decode ID token claims (we trust the issuer, so no signature verification needed here
  // since we just exchanged an auth code over TLS)
  const claims = decodeIdToken(tokens.id_token);

  // Upsert organisation
  const orgExternalId = claims.organisation_id || claims.org_id || 'unknown';
  const orgName = claims.organisation_name || claims.org_name || 'Unknown Organisation';
  const orgDomain = claims.email ? claims.email.split('@')[1] : null;

  const orgId = await upsertOrganisation(orgExternalId, orgName, orgDomain);

  // Upsert user
  const userId = await upsertUser(claims.sub, orgId, claims.email, claims.name);

  // Store refresh token if provided by IdP
  if (tokens.refresh_token) {
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    await execute(
      `UPDATE portal_users SET refresh_token = ?, token_expires_at = ? WHERE id = ?`,
      [tokens.refresh_token, expiresAt, userId],
    );
  }

  // Issue portal JWT
  const payload: PortalAuthPayload = {
    userId,
    email: claims.email,
    orgId,
    orgName,
    role: 'requester',
  };

  const secret = process.env.PORTAL_JWT_SECRET || process.env.JWT_SECRET || 'portal-default-secret';
  const token = jwt.sign(payload, secret, { expiresIn: '8h' });

  return { token, user: payload };
}

function decodeIdToken(idToken: string): OidcUserClaims {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Invalid ID token format');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
  return {
    sub: payload.sub || '',
    email: payload.email || payload.preferred_username || '',
    name: payload.name || payload.given_name || '',
    organisation_id: payload.organisation_id || payload.org_id,
    organisation_name: payload.organisation_name || payload.org_name,
    org_id: payload.org_id,
    org_name: payload.org_name,
  };
}

async function upsertOrganisation(externalId: string, name: string, domain: string | null): Promise<number> {
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM portal_organisations WHERE external_id = ?`,
    [externalId],
  );

  if (existing) {
    await execute(
      `UPDATE portal_organisations SET name = ?, domain = ?, updated_at = GETUTCDATE() WHERE id = ?`,
      [name, domain, existing.id],
    );
    return existing.id;
  }

  const result = await queryOne<{ id: number }>(
    `INSERT INTO portal_organisations (external_id, name, domain) OUTPUT INSERTED.id VALUES (?, ?, ?)`,
    [externalId, name, domain],
  );
  return result!.id;
}

async function upsertUser(
  externalId: string,
  orgId: number,
  email: string,
  displayName: string,
): Promise<number> {
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM portal_users WHERE external_id = ?`,
    [externalId],
  );

  if (existing) {
    await execute(
      `UPDATE portal_users SET email = ?, display_name = ?, last_login = GETUTCDATE() WHERE id = ?`,
      [email, displayName, existing.id],
    );
    return existing.id;
  }

  const result = await queryOne<{ id: number }>(
    `INSERT INTO portal_users (external_id, org_id, email, display_name)
     OUTPUT INSERTED.id VALUES (?, ?, ?, ?)`,
    [externalId, orgId, email, displayName],
  );
  return result!.id;
}

export async function refreshOidcToken(
  userId: number,
  settings: FileSettingsQueries,
): Promise<{ token: string; user: PortalAuthPayload }> {
  const config = getOidcConfig(settings);
  if (!config.issuer || !config.clientId) {
    throw new Error('OIDC not configured');
  }

  const row = await queryOne<{
    id: number; refresh_token: string | null; email: string; display_name: string;
    org_id: number; role: string;
  }>(
    `SELECT u.id, u.refresh_token, u.email, u.display_name, u.org_id, u.role
     FROM portal_users u WHERE u.id = ?`,
    [userId],
  );
  if (!row?.refresh_token) {
    throw new Error('No refresh token available — re-authentication required');
  }

  const org = await queryOne<{ name: string }>(
    `SELECT name FROM portal_organisations WHERE id = ?`,
    [row.org_id],
  );

  const tokenBody = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: row.refresh_token,
    client_id: config.clientId,
    ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
  });

  const tokenRes = await fetch(`${config.issuer}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  });

  if (!tokenRes.ok) {
    // Refresh token expired or revoked — clear it
    await execute(`UPDATE portal_users SET refresh_token = NULL, token_expires_at = NULL WHERE id = ?`, [userId]);
    throw new Error('Refresh token expired — re-authentication required');
  }

  const tokens: OidcTokenResponse = await tokenRes.json();

  // Update refresh token if rotated
  if (tokens.refresh_token) {
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    await execute(
      `UPDATE portal_users SET refresh_token = ?, token_expires_at = ? WHERE id = ?`,
      [tokens.refresh_token, expiresAt, userId],
    );
  }

  // Issue fresh portal JWT
  const payload: PortalAuthPayload = {
    userId: row.id,
    email: row.email,
    orgId: row.org_id,
    orgName: org?.name || 'Unknown',
    role: (row.role as PortalAuthPayload['role']) || 'requester',
  };

  const secret = process.env.PORTAL_JWT_SECRET || process.env.JWT_SECRET || 'portal-default-secret';
  const token = jwt.sign(payload, secret, { expiresIn: '8h' });

  return { token, user: payload };
}

export function generateLogoutUrl(settings: FileSettingsQueries): string {
  const config = getOidcConfig(settings);
  if (!config.issuer) return '/portal';
  return `${config.issuer}/connect/endsession?post_logout_redirect_uri=${encodeURIComponent(config.redirectUri.replace('/callback', ''))}`;
}
