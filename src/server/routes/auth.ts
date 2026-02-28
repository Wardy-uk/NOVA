import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { FileUserQueries } from '../db/user-store.js';
type UserQueries = FileUserQueries;
import { authMiddleware, type AuthPayload } from '../middleware/auth.js';
import type { EntraSsoService } from '../services/entra-sso.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { JiraOAuthService } from '../services/jira-oauth.js';
import type { UserSettingsQueries } from '../db/queries.js';

function signToken(user: { id: number; username: string; role: string }, secret: string): string {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, secret, { expiresIn: '7d' });
}

function safeUser(u: { id: number; username: string; display_name: string | null; email: string | null; role: string; auth_provider: string }) {
  return { id: u.id, username: u.username, display_name: u.display_name, email: u.email, role: u.role, auth_provider: u.auth_provider };
}

import type { CustomRole } from '../middleware/auth.js';

const DEFAULT_CUSTOM_ROLES: CustomRole[] = [
  { id: 'editor', name: 'Editor', areas: { command: 'edit', servicedesk: 'edit', onboarding: 'edit', accounts: 'edit' } },
  { id: 'viewer', name: 'Viewer', areas: { command: 'view', servicedesk: 'view', onboarding: 'view', accounts: 'view' } },
];

function getCustomRoles(settingsQueries: FileSettingsQueries): CustomRole[] {
  const raw = settingsQueries.get('custom_roles');
  try {
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return DEFAULT_CUSTOM_ROLES;
}

function resolveAreaAccess(role: string, roles: CustomRole[]): Record<string, string> {
  if (role === 'admin') {
    return { command: 'edit', servicedesk: 'edit', onboarding: 'edit', accounts: 'edit', admin: 'edit' };
  }
  const def = roles.find(r => r.id === role);
  if (!def) return { command: 'view', servicedesk: 'view', onboarding: 'view', accounts: 'view' };
  return { ...def.areas, admin: 'hidden' };
}

export function createAuthRoutes(
  userQueries: UserQueries,
  jwtSecret: string,
  ssoService: EntraSsoService,
  settingsQueries: FileSettingsQueries,
  jiraOAuthService?: JiraOAuthService,
  userSettingsQueries?: UserSettingsQueries,
): Router {
  const router = Router();

  // POST /api/auth/login
  router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username?.trim() || !password) {
      res.status(400).json({ ok: false, error: 'Username and password are required' });
      return;
    }

    const user = userQueries.getByUsername(username.trim().toLowerCase());
    if (!user) {
      res.status(401).json({ ok: false, error: 'Invalid username or password' });
      return;
    }

    // SSO-only users cannot log in locally
    if (user.auth_provider === 'entra' && !user.password_hash) {
      res.status(401).json({ ok: false, error: 'This account uses Microsoft SSO. Please sign in with Microsoft.' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ ok: false, error: 'Invalid username or password' });
      return;
    }

    const token = signToken(user, jwtSecret);
    res.json({ ok: true, data: { token, user: safeUser(user) } });
  });

  // POST /api/auth/register — only allowed if no users exist (first user setup) or caller is admin
  router.post('/register', async (req, res) => {
    const { username, password, display_name, email } = req.body;
    if (!username?.trim() || !password) {
      res.status(400).json({ ok: false, error: 'Username and password are required' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });
      return;
    }

    const userCount = userQueries.count();

    // If users already exist, only admin can create new users
    if (userCount > 0) {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(403).json({ ok: false, error: 'Registration is restricted. Contact an admin.' });
        return;
      }
      try {
        const payload = jwt.verify(authHeader.slice(7), jwtSecret) as AuthPayload;
        if (payload.role !== 'admin') {
          res.status(403).json({ ok: false, error: 'Only admins can create new users' });
          return;
        }
      } catch {
        res.status(403).json({ ok: false, error: 'Invalid token' });
        return;
      }
    }

    const normalizedUsername = username.trim().toLowerCase();
    if (userQueries.getByUsername(normalizedUsername)) {
      res.status(409).json({ ok: false, error: 'Username already taken' });
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    const role = userCount === 0 ? 'admin' : 'viewer'; // First user is admin
    const id = userQueries.create({
      username: normalizedUsername,
      display_name: display_name?.trim() || normalizedUsername,
      email: email?.trim() || undefined,
      password_hash: hash,
      role,
    });

    const user = userQueries.getById(id)!;
    const token = signToken(user, jwtSecret);
    res.json({ ok: true, data: { token, user: safeUser(user), firstUser: userCount === 0 } });
  });

  // GET /api/auth/status — public, check if any users exist (for first-run UX)
  router.get('/status', (_req, res) => {
    const count = userQueries.count();
    res.json({ ok: true, data: { hasUsers: count > 0 } });
  });

  // GET /api/auth/me — requires valid token
  router.get('/me', authMiddleware(jwtSecret), (req, res) => {
    const user = userQueries.getById(req.user!.id);
    if (!user) {
      res.status(401).json({ ok: false, error: 'User not found' });
      return;
    }
    res.json({ ok: true, data: { user: safeUser(user) } });
  });

  // ── SSO Routes ──

  // GET /api/auth/sso/status — public, check if SSO is configured
  router.get('/sso/status', (_req, res) => {
    res.json({ ok: true, data: { enabled: ssoService.isConfigured() } });
  });

  // GET /api/auth/sso/login — public, returns Microsoft OAuth login URL
  router.get('/sso/login', async (_req, res) => {
    try {
      if (!ssoService.isConfigured()) {
        res.status(503).json({ ok: false, error: 'SSO not configured' });
        return;
      }
      // Build redirect URI pointing to the backend callback route
      const settings = settingsQueries.getAll();
      const baseUrl = settings.sso_base_url || `http://localhost:${process.env.PORT ?? '3001'}`;
      const redirectUri = `${baseUrl}/api/auth/sso/callback`;
      const url = await ssoService.getLoginUrl(redirectUri);
      res.json({ ok: true, data: { url } });
    } catch (err) {
      console.error('[SSO] Login URL error:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'SSO login failed' });
    }
  });

  // GET /api/auth/sso/callback — Microsoft redirects here after authentication
  router.get('/sso/callback', async (req, res) => {
    try {
      const { code, state, error: oauthError, error_description } = req.query;

      // Determine frontend URL for redirects
      const frontendUrl = process.env.FRONTEND_URL || '';

      if (oauthError) {
        res.redirect(`${frontendUrl}/?sso_error=${encodeURIComponent(String(error_description || oauthError))}`);
        return;
      }

      if (!code || !state) {
        res.redirect(`${frontendUrl}/?sso_error=${encodeURIComponent('Missing code or state')}`);
        return;
      }

      // Reconstruct the same redirect URI used in getLoginUrl
      const settings = settingsQueries.getAll();
      const baseUrl = settings.sso_base_url || `http://localhost:${process.env.PORT ?? '3001'}`;
      const redirectUri = `${baseUrl}/api/auth/sso/callback`;

      const claims = await ssoService.handleCallback(
        String(code),
        String(state),
        redirectUri,
      );

      // User resolution: OID lookup → email lookup (link existing) → auto-create
      let user = userQueries.getByProviderId('entra', claims.oid);

      if (!user) {
        // Try matching by email to link existing local accounts
        const existing = userQueries.getByEmail(claims.email);
        if (existing) {
          // Link existing account to Entra
          userQueries.update(existing.id, {
            auth_provider: 'entra',
            provider_id: claims.oid,
            email: claims.email,
            display_name: claims.name || existing.display_name,
          });
          user = userQueries.getById(existing.id);
        }
      }

      if (!user) {
        // Auto-provision new user
        let username = claims.preferredUsername.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
        if (userQueries.getByUsername(username)) {
          username = `${username}_${Date.now().toString(36)}`;
        }

        const isFirstUser = userQueries.count() === 0;
        const id = userQueries.create({
          username,
          display_name: claims.name || username,
          email: claims.email,
          password_hash: '', // SSO users cannot use local login
          role: isFirstUser ? 'admin' : 'viewer',
          auth_provider: 'entra',
          provider_id: claims.oid,
        });
        user = userQueries.getById(id);
      }

      if (!user) {
        res.redirect(`${frontendUrl}/?sso_error=${encodeURIComponent('Failed to create user')}`);
        return;
      }

      const token = signToken(user, jwtSecret);
      // Redirect to frontend with token in hash fragment (never sent to server)
      res.redirect(`${frontendUrl}/#sso_token=${token}`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'SSO callback failed';
      console.error('[SSO Callback]', msg);
      const frontendUrl = process.env.FRONTEND_URL || '';
      res.redirect(`${frontendUrl}/?sso_error=${encodeURIComponent(msg)}`);
    }
  });

  // ── Permissions ──

  // GET /api/auth/permissions — public, returns custom roles + caller's resolved area access
  router.get('/permissions', (req, res) => {
    const roles = getCustomRoles(settingsQueries);

    // If caller is authenticated, resolve their access; otherwise return roles only
    let areaAccess: Record<string, string> | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = jwt.verify(authHeader.slice(7), jwtSecret) as { role: string };
        areaAccess = resolveAreaAccess(payload.role, roles);
      } catch { /* ignore invalid token */ }
    }

    res.json({ ok: true, data: { roles, areaAccess } });
  });

  // ── Jira OAuth 3LO ──

  // GET /api/auth/jira/status — check if OAuth is configured and user is connected
  router.get('/jira/status', authMiddleware(jwtSecret), (req, res) => {
    const userId = (req as any).user?.id as number;
    const configured = jiraOAuthService?.isConfigured() ?? false;
    let connected = false;
    if (configured && userId && userSettingsQueries) {
      connected = !!userSettingsQueries.get(userId, 'jira_access_token');
    }
    res.json({ ok: true, configured, connected });
  });

  // GET /api/auth/jira/login — initiate OAuth flow
  router.get('/jira/login', authMiddleware(jwtSecret), (req, res) => {
    const userId = (req as any).user?.id as number;
    if (!jiraOAuthService?.isConfigured()) {
      res.status(400).json({ ok: false, error: 'Jira OAuth not configured. Set client ID and secret in Admin > Integrations.' });
      return;
    }

    const baseUrl = process.env.FRONTEND_URL ? `http://localhost:3001` : `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${baseUrl}/api/auth/jira/callback`;
    const authUrl = jiraOAuthService.getAuthUrl(redirectUri, userId);
    res.json({ ok: true, url: authUrl });
  });

  // GET /api/auth/jira/callback — handle Atlassian callback
  router.get('/jira/callback', async (req, res) => {
    const frontendUrl = process.env.FRONTEND_URL || '';
    try {
      const { code, state, error: oauthError } = req.query;

      if (oauthError || !code || !state) {
        res.redirect(`${frontendUrl}/?jira_error=${encodeURIComponent(String(oauthError || 'Missing code or state'))}`);
        return;
      }

      if (!jiraOAuthService || !userSettingsQueries) {
        res.redirect(`${frontendUrl}/?jira_error=${encodeURIComponent('Jira OAuth not configured')}`);
        return;
      }

      const baseUrl = process.env.FRONTEND_URL ? `http://localhost:3001` : `${req.protocol}://${req.get('host')}`;
      const redirectUri = `${baseUrl}/api/auth/jira/callback`;

      const result = await jiraOAuthService.exchangeCode(String(code), String(state), redirectUri);
      const userId = result.userId;

      // Store tokens in user_settings
      userSettingsQueries.set(userId, 'jira_access_token', result.accessToken);
      userSettingsQueries.set(userId, 'jira_refresh_token', result.refreshToken);
      userSettingsQueries.set(userId, 'jira_cloud_id', result.cloudId);
      userSettingsQueries.set(userId, 'jira_site_url', result.siteUrl);

      res.redirect(`${frontendUrl}/#jira_connected=true`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Jira OAuth failed';
      res.redirect(`${frontendUrl}/?jira_error=${encodeURIComponent(msg)}`);
    }
  });

  // DELETE /api/auth/jira/disconnect — remove stored tokens
  router.delete('/jira/disconnect', authMiddleware(jwtSecret), (req, res) => {
    const userId = (req as any).user?.id as number;
    if (userId && userSettingsQueries) {
      userSettingsQueries.delete(userId, 'jira_access_token');
      userSettingsQueries.delete(userId, 'jira_refresh_token');
      userSettingsQueries.delete(userId, 'jira_cloud_id');
      userSettingsQueries.delete(userId, 'jira_site_url');
    }
    res.json({ ok: true });
  });

  return router;
}
