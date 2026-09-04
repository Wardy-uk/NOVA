import { Router, type Request, type Response } from 'express';
import { query, queryOne, execute } from '../services/database.js';
import { isAdmin } from '../utils/role-helpers.js';
import { ACHIEVEMENTS, getStandings } from '../services/gamification-engine.js';
import type { GamificationService } from '../services/gamification.js';
import type { SettingsQueries } from '../db/settings-store.js';

export function createGamificationRoutes(service: GamificationService, settings?: SettingsQueries): Router {
  const router = Router();

  // ── Private-preview gate ──
  //
  // The rewards scheme runs quietly while the thresholds settle and before any
  // prize is agreed, so the v2 endpoints answer to ONE person. Enforced here and
  // not merely by hiding the tab: a hidden tab is not access control, and these
  // endpoints expose a ranking of named colleagues.
  //
  // `gamification_owner` is the username allowed through — set it to empty to open
  // the scheme up to everyone once it goes live.
  const OWNER_DEFAULT = 'nickw';
  const ownerOnly = (req: Request, res: Response, next: () => void) => {
    const owner = (settings?.get('gamification_owner') ?? OWNER_DEFAULT).trim();
    if (!owner) { next(); return; }                       // configured open
    if (req.user && (req.user.username ?? '').toLowerCase() === owner.toLowerCase()) { next(); return; }
    res.status(404).json({ ok: false, error: 'Not found' });  // 404, not 403 — do not advertise it
  };

  router.get('/profile', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const profile = await service.getProfile(req.user.id);
      res.json({ ok: true, data: profile });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  router.get('/profile/:userId', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const profile = await service.getProfile(parseInt(String(req.params.userId), 10));
      res.json({ ok: true, data: profile });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  router.get('/leaderboard', async (_req: Request, res: Response) => {
    try {
      const data = await service.getLeaderboard();
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });


  router.post('/check', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const awarded = await service.checkAndAwardAchievements(req.user.id);
      res.json({ ok: true, data: { awarded } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  router.get('/points', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    try {
      const points = await service.getPoints(req.user.id);
      res.json({ ok: true, data: { points } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // ── v2: season standings, catalogue, redemptions ──
  // The v1 endpoints above stay so the existing profile panel keeps working.

  router.get('/standings', ownerOnly, async (_req: Request, res: Response) => {
    try {
      res.json({ ok: true, data: await getStandings() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // Single source for the achievement catalogue. v1 also had an /achievements
  // route, registered EARLIER, returning ACHIEVEMENT_DEFS as an object keyed by
  // type rather than an array — so it shadowed this one and the UI crashed on
  // .map. v1's version is gone; nothing reads it since the v1 panel was removed.
  router.get('/achievements', ownerOnly, async (_req: Request, res: Response) => {
    res.json({ ok: true, data: ACHIEVEMENTS });
  });

  router.get('/rewards', ownerOnly, async (_req: Request, res: Response) => {
    try {
      const rewards = await query(
        `SELECT id, name, description, tier, cost_points, stock, is_active
         FROM gam_rewards WHERE is_active = 1 ORDER BY cost_points, name`,
      );
      res.json({ ok: true, data: rewards });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // Admin-maintained catalogue. Prizes are a leadership decision and will change,
  // so they are data rather than code — nothing here is hardcoded to a voucher.
  router.post('/rewards', ownerOnly, async (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user.role)) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }
    const { name, description, tier, cost_points, stock } = req.body ?? {};
    if (!name) { res.status(400).json({ ok: false, error: 'name required' }); return; }
    try {
      await execute(
        `INSERT INTO gam_rewards (name, description, tier, cost_points, stock) VALUES (?, ?, ?, ?, ?)`,
        [String(name).slice(0, 200), description ? String(description).slice(0, 500) : null,
         ['small', 'mid', 'large'].includes(tier) ? tier : 'small', Number(cost_points) || 0,
         stock == null ? null : Number(stock)],
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // A redemption is a REQUEST, never an automatic issue. These convert to real
  // money and time off, so a human approves every one.
  router.post('/redeem', ownerOnly, async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    const { agentName, rewardId } = req.body ?? {};
    if (!agentName || !rewardId) { res.status(400).json({ ok: false, error: 'agentName and rewardId required' }); return; }
    try {
      const reward = await queryOne<{ id: number; cost_points: number; stock: number | null }>(
        `SELECT id, cost_points, stock FROM gam_rewards WHERE id = ? AND is_active = 1`, [rewardId],
      );
      if (!reward) { res.status(404).json({ ok: false, error: 'Reward not found' }); return; }
      if (reward.cost_points <= 0) { res.status(400).json({ ok: false, error: 'Reward is not yet priced' }); return; }
      if (reward.stock != null && reward.stock <= 0) { res.status(400).json({ ok: false, error: 'Out of stock' }); return; }

      // Balance = season points earned, less everything already requested or
      // approved. Pending requests are held against the balance so the same points
      // cannot be spent twice while a decision is outstanding.
      const { season, rows } = await getStandings();
      const standing = rows.find(r => r.agentName === agentName);
      const spent = await queryOne<{ total: number }>(
        `SELECT ISNULL(SUM(cost_points), 0) AS total FROM gam_redemptions
         WHERE agent_name = ? AND season_id = ? AND status IN ('requested', 'approved')`,
        [agentName, season.id],
      );
      const balance = (standing?.seasonPoints ?? 0) - (spent?.total ?? 0);
      if (balance < reward.cost_points) {
        res.status(400).json({ ok: false, error: `Not enough points (${balance} available, ${reward.cost_points} needed)` });
        return;
      }
      await execute(
        `INSERT INTO gam_redemptions (season_id, agent_name, reward_id, cost_points) VALUES (?, ?, ?, ?)`,
        [season.id, agentName, reward.id, reward.cost_points],
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  router.get('/redemptions', ownerOnly, async (_req: Request, res: Response) => {
    try {
      const rows = await query(
        `SELECT r.id, r.agent_name, r.cost_points, r.status, r.requested_at, r.decided_at, r.decided_by, r.note,
                w.name AS reward_name, w.tier
         FROM gam_redemptions r JOIN gam_rewards w ON w.id = r.reward_id
         ORDER BY CASE WHEN r.status = 'requested' THEN 0 ELSE 1 END, r.requested_at DESC`,
      );
      res.json({ ok: true, data: rows });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  router.post('/redemptions/:id/decide', ownerOnly, async (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user.role)) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }
    const { decision, note } = req.body ?? {};
    if (!['approved', 'rejected', 'fulfilled'].includes(decision)) {
      res.status(400).json({ ok: false, error: 'decision must be approved, rejected or fulfilled' });
      return;
    }
    try {
      await execute(
        `UPDATE gam_redemptions SET status = ?, decided_at = GETUTCDATE(), decided_by = ?, note = ?
         WHERE id = ?`,
        [decision, req.user.username ?? String(req.user.id), note ? String(note).slice(0, 500) : null, Number(req.params.id)],
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // Wipe the scheme back to zero and open a fresh season. Intended for the end of
  // the quiet trial, once the thresholds have been judged against real behaviour.
  // Destructive and deliberately explicit: requires confirm:'RESET' in the body.
  router.post('/season/reset', ownerOnly, async (req: Request, res: Response) => {
    if (req.body?.confirm !== 'RESET') {
      res.status(400).json({ ok: false, error: "Send { confirm: 'RESET' } to wipe the scheme" });
      return;
    }
    try {
      const before = await queryOne<{ awards: number }>(`SELECT COUNT(*) AS awards FROM gam_awards`);
      await execute(`DELETE FROM gam_redemptions`);
      await execute(`DELETE FROM gam_awards`);
      await execute(`UPDATE gam_seasons SET is_active = 0, ends_on = CAST(GETUTCDATE() AS DATE) WHERE is_active = 1`);
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
      const name = (req.body?.name && String(req.body.name).slice(0, 100)) || `Season ${today}`;
      await execute(`INSERT INTO gam_seasons (name, starts_on, is_active) VALUES (?, ?, 1)`, [name, today]);
      // Let the next scheduled evaluation run today rather than waiting a day.
      settings?.set('gamification_eval_day', '');
      res.json({ ok: true, data: { cleared: before?.awards ?? 0, season: name } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  return router;
}
