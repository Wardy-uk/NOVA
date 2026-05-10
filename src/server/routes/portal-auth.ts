import { Router, type Request, type Response } from 'express';
import type { FileSettingsQueries } from '../db/settings-store.js';
import { generateAuthUrl, handleCallback, generateLogoutUrl } from '../services/portal-auth.js';
import { isInternalMode } from '../middleware/portal-auth-middleware.js';

export function createPortalAuthRoutes(settings: FileSettingsQueries): Router {
  const router = Router();

  router.get('/mode', (_req: Request, res: Response) => {
    const mode = (settings.get('portal_auth_mode') || 'internal') === 'internal' ? 'internal' : 'oidc';
    res.json({ ok: true, data: { mode } });
  });

  router.get('/login', (req: Request, res: Response) => {
    if (isInternalMode(settings)) {
      // Internal mode: redirect to portal — NOVA auth handles the rest
      res.redirect('/portal');
      return;
    }

    try {
      const { url } = generateAuthUrl(settings);
      res.redirect(url);
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
    res.status(501).json({ ok: false, error: 'OIDC token refresh not yet implemented' });
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
