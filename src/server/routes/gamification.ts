import { Router, type Request, type Response } from 'express';
import { query, queryOne, execute } from '../services/database.js';
import { isAdmin } from '../utils/role-helpers.js';
import { ACHIEVEMENTS, getStandings } from '../services/gamification-engine.js';
import type { GamificationService } from '../services/gamification.js';

export function createGamificationRoutes(service: GamificationService): Router {
  const router = Router();

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

  router.get('/achievements', async (_req: Request, res: Response) => {
    try {
      const data = await service.getAchievementDefs();
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

  router.get('/standings', async (_req: Request, res: Response) => {
    try {
      res.json({ ok: true, data: await getStandings() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  router.get('/achievements', async (_req: Request, res: Response) => {
    res.json({ ok: true, data: ACHIEVEMENTS });
  });

  router.get('/rewards', async (_req: Request, res: Response) => {
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
  router.post('/rewards', async (req: Request, res: Response) => {
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
  router.post('/redeem', async (req: Request, res: Response) => {
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

  router.get('/redemptions', async (_req: Request, res: Response) => {
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

  router.post('/redemptions/:id/decide', async (req: Request, res: Response) => {
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

  return router;
}
