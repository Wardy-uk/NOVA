import { Router, type Request, type Response } from 'express';
import type { DailyBriefingService } from '../services/daily-briefing.js';
import type { UserQueries } from '../db/queries.js';

export function createBriefingRoutes(
  briefingService: DailyBriefingService,
  userQueries: UserQueries,
): Router {
  const router = Router();

  // Get today's briefing (or latest)
  router.get('/today', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const briefing = await briefingService.getLatest(req.user.id);
      if (!briefing) {
        res.json({ ok: true, data: null });
        return;
      }
      res.json({
        ok: true,
        data: {
          ...briefing,
          content: JSON.parse(briefing.content_json),
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get briefing' });
    }
  });

  // Get briefing for a specific date
  router.get('/date/:date', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const briefing = await briefingService.getForDate(req.user.id, String(req.params.date));
      if (!briefing) {
        res.json({ ok: true, data: null });
        return;
      }
      res.json({
        ok: true,
        data: {
          ...briefing,
          content: JSON.parse(briefing.content_json),
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get briefing' });
    }
  });

  // Get briefing history (last 30 days)
  router.get('/history', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 30, 90);
      const rows = await briefingService.getHistory(req.user.id, limit);
      res.json({
        ok: true,
        data: rows.map(r => ({
          id: r.id,
          briefing_date: r.briefing_date,
          role_type: r.role_type,
          headline: (JSON.parse(r.content_json) as any).headline,
          generated_at: r.generated_at,
          dismissed_at: r.dismissed_at,
        })),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get history' });
    }
  });

  // Dismiss today's briefing popup
  router.post('/dismiss', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const date = new Date().toISOString().slice(0, 10);
      await briefingService.dismiss(req.user.id, date);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to dismiss' });
    }
  });

  // Check if popup should show
  router.get('/popup', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const popupEnabled = true; // setting check could go here
      if (!popupEnabled) { res.json({ ok: true, data: { show: false } }); return; }

      const shouldShow = await briefingService.needsPopup(req.user.id);
      if (!shouldShow) { res.json({ ok: true, data: { show: false } }); return; }

      const briefing = await briefingService.getLatest(req.user.id);
      if (!briefing) { res.json({ ok: true, data: { show: false } }); return; }

      const content = JSON.parse(briefing.content_json);
      res.json({
        ok: true,
        data: {
          show: true,
          headline: content.headline,
          priorityActions: content.priorityActions?.slice(0, 3) ?? [],
          briefingDate: briefing.briefing_date,
        },
      });
    } catch (err) {
      res.json({ ok: true, data: { show: false } });
    }
  });

  // Generate briefing on demand (admin or for self)
  router.post('/generate', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const user = await userQueries.getById(req.user.id);
      if (!user) { res.status(404).json({ ok: false, error: 'User not found' }); return; }

      const roles = (user.role || '').split(',').map(r => r.trim());
      const isManager = roles.includes('admin') || roles.includes('super_admin');

      let briefing;
      if (isManager) {
        briefing = await briefingService.generateManagerBriefing(user.id, user.display_name || user.username);
      } else {
        briefing = await briefingService.generateAgentBriefing(user.id, user.email || '', user.display_name || user.username);
      }

      res.json({ ok: true, data: briefing });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to generate briefing' });
    }
  });

  return router;
}
