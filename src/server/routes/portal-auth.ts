import { Router, type Request, type Response } from 'express';
import type { FileSettingsQueries } from '../db/settings-store.js';
import {
  createCodexTestSession,
  generateAuthUrl,
  handleCallback,
  generateLogoutUrl,
  isCodexTestLoginEnabled,
  loginLocalPortalUser,
  refreshOidcToken,
} from '../services/portal-auth.js';
import { isInternalMode } from '../middleware/portal-auth-middleware.js';

export function createPortalAuthRoutes(settings: FileSettingsQueries): Router {
  const router = Router();

  router.get('/mode', (_req: Request, res: Response) => {
    const mode = (settings.get('portal_auth_mode') || 'internal') === 'internal' ? 'internal' : 'oidc';
    res.json({ ok: true, data: { mode, codexTestUserEnabled: isCodexTestLoginEnabled(settings), localLoginEnabled: mode !== 'internal' } });
  });

  router.post('/local-login', async (req: Request, res: Response) => {
    const { email, password } = req.body ?? {};
    if (isInternalMode(settings)) {
      res.status(400).json({ ok: false, error: 'Local portal login is unavailable in internal mode' });
      return;
    }
    if (!email?.trim() || !password) {
      res.status(400).json({ ok: false, error: 'Email and password are required' });
      return;
    }

    try {
      const result = await loginLocalPortalUser(email, password);
      res.json({ ok: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid email or password';
      const status = /disabled|removed/i.test(message) ? 403 : 401;
      res.status(status).json({ ok: false, error: message });
    }
  });

  router.post('/codex-test-login', async (_req: Request, res: Response) => {
    try {
      const result = await createCodexTestSession(settings);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(403).json({ ok: false, error: err instanceof Error ? err.message : 'Codex test login unavailable' });
    }
  });

  router.get('/login', (req: Request, res: Response) => {
    if (isInternalMode(settings)) {
      // Internal mode: redirect to portal — NOVA auth handles the rest
      res.redirect('/portal');
      return;
    }

    try {
      const { url } = generateAuthUrl(settings);
      res.json({ ok: true, data: { url } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'OIDC not configured' });
    }
  });

  router.get('/callback', async (req: Request, res: Response) => {
    const { code, state, error } = req.query as Record<string, string>;

    if (error) {
      res.redirect(`/portal/login?error=${encodeURIComponent(error)}`);
      return;
    }

    if (!code || !state) {
      res.redirect('/portal/login?error=missing_params');
      return;
    }

    try {
      const { token } = await handleCallback(code, state, settings);
      res.redirect(`/portal#token=${token}`);
    } catch (err) {
      console.error('[portal-auth] Callback error:', err);
      res.redirect(`/portal/login?error=${encodeURIComponent(err instanceof Error ? err.message : 'auth_failed')}`);
    }
  });

  router.post('/refresh', async (req: Request, res: Response) => {
    if (isInternalMode(settings)) {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ ok: false, error: 'Session expired' });
        return;
      }
      try {
        const jwt = await import('jsonwebtoken');
        const secret = settings.get('jwt_secret') || 'nova-secret';
        jwt.default.verify(authHeader.slice(7), secret);
        res.json({ ok: true });
      } catch {
        res.status(401).json({ ok: false, error: 'Session expired' });
      }
      return;
    }
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ ok: false, error: 'No token provided' });
      return;
    }

    try {
      const jwt = await import('jsonwebtoken');
      const secrets = [
        process.env.PORTAL_JWT_SECRET,
        process.env.JWT_SECRET,
        'portal-default-secret',
      ].filter(Boolean) as string[];

      let userId: number | null = null;
      for (const secret of secrets) {
        try {
          const payload = jwt.default.verify(authHeader.slice(7), secret) as Record<string, unknown>;
          if (payload.userId) { userId = payload.userId as number; break; }
        } catch { /* try next secret */ }
      }

      if (!userId) {
        // Token fully invalid — can't even decode userId
        res.status(401).json({ ok: false, error: 'Invalid token' });
        return;
      }

      const result = await refreshOidcToken(userId, settings);
      res.json({ ok: true, data: { token: result.token, user: result.user } });
    } catch (err) {
      console.error('[portal-auth] OIDC refresh failed:', err);
      res.status(401).json({ ok: false, error: err instanceof Error ? err.message : 'Refresh failed' });
    }
  });

  router.post('/logout', (req: Request, res: Response) => {
    if (isInternalMode(settings)) {
      res.json({ ok: true, data: { logoutUrl: '/' } });
      return;
    }
    const logoutUrl = generateLogoutUrl(settings);
    res.json({ ok: true, data: { logoutUrl } });
  });

  return router;
}
