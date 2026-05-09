import { Router, type Request, type Response } from 'express';
import type { FileSettingsQueries } from '../db/settings-store.js';
import { generateAuthUrl, handleCallback, generateLogoutUrl } from '../services/portal-auth.js';

export function createPortalAuthRoutes(settings: FileSettingsQueries): Router {
  const router = Router();

  router.get('/login', (req: Request, res: Response) => {
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
    // For now, refresh is not implemented — client should re-authenticate
    res.status(501).json({ ok: false, error: 'Token refresh not yet implemented' });
  });

  router.post('/logout', (req: Request, res: Response) => {
    const logoutUrl = generateLogoutUrl(settings);
    res.json({ ok: true, data: { logoutUrl } });
  });

  return router;
}
