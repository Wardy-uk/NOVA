import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query, queryOne, execute } from './database.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type {
  PortalAuthPayload,
  PortalUserAccessState,
  PortalUserAuthType,
  PortalUserRole,
} from '../../shared/portal-types.js';

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

const CODEX_TEST_ORG_EXTERNAL_ID = 'codex-test-org';
const CODEX_TEST_ORG_NAME = 'Codex Test Organisation';
const CODEX_TEST_ORG_DOMAIN = 'codex.test';
const CODEX_TEST_USER_EXTERNAL_ID = 'codex-test-user';
const CODEX_TEST_USER_EMAIL = 'codex.portal.test@nurtur.tech';
const CODEX_TEST_USER_NAME = 'Codex Test User';
const CODEX_TEST_USER_ROLE: PortalUserRole = 'requester';

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

function issuePortalToken(payload: PortalAuthPayload): string {
  const secret = process.env.PORTAL_JWT_SECRET || process.env.JWT_SECRET || 'portal-default-secret';
  return jwt.sign(payload, secret, { expiresIn: '8h' });
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
  const userId = await upsertUser(claims.sub, orgId, claims.email, claims.name, 'requester', 'oidc');

  // Store refresh token if provided by IdP
  if (tokens.refresh_token) {
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    await execute(
      `UPDATE portal_users SET refresh_token = ?, token_expires_at = ? WHERE id = ?`,
      [tokens.refresh_token, expiresAt, userId],
    );
  }

  // Resolve the user's ACTUAL org + role (may differ from the token claims if the
  // account was linked by email to an admin-created portal user).
  const finalUser = await queryOne<{ org_id: number; role: PortalUserRole; org_name: string }>(
    `SELECT u.org_id, u.role, o.name AS org_name
     FROM portal_users u JOIN portal_organisations o ON o.id = u.org_id
     WHERE u.id = ?`,
    [userId],
  );

  // Issue portal JWT
  const payload: PortalAuthPayload = {
    userId,
    email: claims.email,
    orgId: finalUser?.org_id ?? orgId,
    orgName: finalUser?.org_name ?? orgName,
    role: finalUser?.role ?? 'requester',
    authType: 'oidc',
  };

  const token = issuePortalToken(payload);

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
  role: PortalUserRole = 'requester',
  authType: PortalUserAuthType = 'oidc',
): Promise<number> {
  // 1. Already linked to this Ecosystem identity (external_id = OIDC subject).
  let existing = await queryOne<{ id: number }>(
    `SELECT id FROM portal_users WHERE external_id = ?`,
    [externalId],
  );

  // 2. Otherwise adopt an admin-created (or any) portal user with the same email.
  //    This is how a locally-created user gets linked to Ecosystem SSO on first
  //    sign-in. We deliberately do NOT overwrite org_id or role here so the
  //    admin-assigned organisation and role are preserved.
  if (!existing) {
    existing = await queryOne<{ id: number }>(
      `SELECT TOP 1 id FROM portal_users
       WHERE LOWER(email) = LOWER(?) AND access_state <> 'removed'
       ORDER BY id`,
      [email],
    );
  }

  if (existing) {
    await execute(
      `UPDATE portal_users
       SET external_id = ?, email = ?, display_name = ?, auth_type = ?, last_login = GETUTCDATE()
       WHERE id = ?`,
      [externalId, email, displayName, authType, existing.id],
    );
    return existing.id;
  }

  const result = await queryOne<{ id: number }>(
    `INSERT INTO portal_users (external_id, org_id, email, display_name, role, auth_type, access_state)
     OUTPUT INSERTED.id VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    [externalId, orgId, email, displayName, role, authType],
  );
  return result!.id;
}

export async function refreshOidcToken(
  userId: number,
  settings: FileSettingsQueries,
): Promise<{ token: string; user: PortalAuthPayload }> {
  const row = await queryOne<{
    id: number; refresh_token: string | null; email: string; display_name: string;
    org_id: number; role: string; auth_type: PortalUserAuthType; access_state: PortalUserAccessState;
  }>(
    `SELECT u.id, u.refresh_token, u.email, u.display_name, u.org_id, u.role, u.auth_type, u.access_state
     FROM portal_users u WHERE u.id = ?`,
    [userId],
  );
  if (!row) {
    throw new Error('Portal user not found');
  }
  if (row.access_state !== 'active') {
    throw new Error(row.access_state === 'disabled' ? 'This portal account is disabled' : 'This portal account has been removed');
  }
  if (row.auth_type !== 'oidc') {
    return buildPortalSession(row);
  }

  const config = getOidcConfig(settings);
  if (!config.issuer || !config.clientId) {
    throw new Error('OIDC not configured');
  }
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
    authType: row.auth_type,
  };

  const token = issuePortalToken(payload);

  return { token, user: payload };
}

export function isCodexTestLoginEnabled(settings: FileSettingsQueries): boolean {
  return settings.get('portal_codex_test_user_enabled') === 'true' || process.env.NODE_ENV !== 'production';
}

export async function createCodexTestSession(
  settings: FileSettingsQueries,
): Promise<{ token: string; user: PortalAuthPayload }> {
  if (!isCodexTestLoginEnabled(settings)) {
    throw new Error('Codex test login is disabled');
  }

  const orgId = await upsertOrganisation(CODEX_TEST_ORG_EXTERNAL_ID, CODEX_TEST_ORG_NAME, CODEX_TEST_ORG_DOMAIN);
  const userId = await upsertUser(
    CODEX_TEST_USER_EXTERNAL_ID,
    orgId,
    CODEX_TEST_USER_EMAIL,
    CODEX_TEST_USER_NAME,
    CODEX_TEST_USER_ROLE,
    'oidc',
  );

  const payload: PortalAuthPayload = {
    userId,
    email: CODEX_TEST_USER_EMAIL,
    orgId,
    orgName: CODEX_TEST_ORG_NAME,
    role: CODEX_TEST_USER_ROLE,
    authType: 'oidc',
  };

  return { token: issuePortalToken(payload), user: payload };
}

export function generateLogoutUrl(settings: FileSettingsQueries): string {
  const config = getOidcConfig(settings);
  if (!config.issuer) return '/portal';
  return `${config.issuer}/connect/endsession?post_logout_redirect_uri=${encodeURIComponent(config.redirectUri.replace('/callback', ''))}`;
}

interface PortalUserSessionRow {
  id: number;
  email: string;
  display_name: string;
  org_id: number;
  role: string;
  auth_type: PortalUserAuthType;
  access_state: PortalUserAccessState;
}

async function buildPortalSession(row: PortalUserSessionRow): Promise<{ token: string; user: PortalAuthPayload }> {
  const org = await queryOne<{ name: string }>(
    `SELECT name FROM portal_organisations WHERE id = ?`,
    [row.org_id],
  );
  const payload: PortalAuthPayload = {
    userId: row.id,
    email: row.email,
    orgId: row.org_id,
    orgName: org?.name || 'Unknown',
    role: (row.role as PortalUserRole) || 'requester',
    authType: row.auth_type,
  };
  return { token: issuePortalToken(payload), user: payload };
}

export async function loginLocalPortalUser(
  email: string,
  password: string,
): Promise<{ token: string; user: PortalAuthPayload }> {
  const normalizedEmail = email.trim().toLowerCase();
  const row = await queryOne<PortalUserSessionRow & { password_hash: string | null }>(
    `SELECT TOP 1 id, email, display_name, org_id, role, auth_type, access_state, password_hash
     FROM portal_users
     WHERE LOWER(email) = LOWER(?)
       AND auth_type = 'local'
     ORDER BY CASE access_state WHEN 'active' THEN 0 WHEN 'disabled' THEN 1 ELSE 2 END, id DESC`,
    [normalizedEmail],
  );

  if (!row || !row.password_hash) {
    throw new Error('Invalid email or password');
  }
  if (row.access_state === 'disabled') {
    throw new Error('This portal account is disabled');
  }
  if (row.access_state === 'removed') {
    throw new Error('This portal account has been removed');
  }

  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) {
    throw new Error('Invalid email or password');
  }

  await execute(`UPDATE portal_users SET last_login = GETUTCDATE() WHERE id = ?`, [row.id]);
  return buildPortalSession({ ...row, access_state: 'active' });
}
