import { query, execute, executeAndGetId } from './database.js';

// ── Types ──

export interface Achievement {
  id: number;
  user_id: number;
  achievement_type: string;
  detail: string | null;
  earned_at: string;
}

export interface Streak {
  id: number;
  user_id: number;
  streak_type: string;
  current_count: number;
  best_count: number;
  last_date: string | null;
  updated_at: string;
}

export interface AgentGameProfile {
  achievements: Achievement[];
  streaks: Streak[];
  totalAchievements: number;
  currentStreaks: Record<string, number>;
  bestStreaks: Record<string, number>;
}

interface LeaderboardEntry {
  user_id: number;
  display_name: string;
  achievement_count: number;
  best_streak: number;
  current_streak: number;
}

// Achievement definitions
const ACHIEVEMENT_DEFS: Record<string, { name: string; icon: string; description: string }> = {
  first_resolve: { name: 'First Blood', icon: '🎯', description: 'Resolved your first ticket' },
  speed_demon: { name: 'Speed Demon', icon: '⚡', description: 'Resolved 5+ tickets in a single day' },
  sla_perfect_day: { name: 'SLA Perfectionist', icon: '🏆', description: 'Zero SLA breaches in a full day' },
  streak_5: { name: 'On a Roll', icon: '🔥', description: '5-day resolve streak' },
  streak_10: { name: 'Unstoppable', icon: '💪', description: '10-day resolve streak' },
  streak_20: { name: 'Iron Will', icon: '🏅', description: '20-day resolve streak' },
  century: { name: 'Century Club', icon: '💯', description: 'Resolved 100 tickets total' },
  qa_star: { name: 'Quality Star', icon: '⭐', description: 'QA score above 90% for 5 consecutive reviews' },
  zero_inbox: { name: 'Zero Inbox', icon: '📭', description: 'Cleared all assigned tickets to zero' },
  early_bird: { name: 'Early Bird', icon: '🐦', description: 'First response before 9am on 5 tickets' },
};

// ── Service ──

export class GamificationService {

  async getProfile(userId: number): Promise<AgentGameProfile> {
    const [achievements, streaks] = await Promise.all([
      query<Achievement>(
        `SELECT * FROM agent_achievements WHERE user_id = ? ORDER BY earned_at DESC`,
        [userId],
      ),
      query<Streak>(
        `SELECT * FROM agent_streaks WHERE user_id = ?`,
        [userId],
      ),
    ]);

    const currentStreaks: Record<string, number> = {};
    const bestStreaks: Record<string, number> = {};
    for (const s of streaks) {
      currentStreaks[s.streak_type] = s.current_count;
      bestStreaks[s.streak_type] = s.best_count;
    }

    return {
      achievements,
      streaks,
      totalAchievements: achievements.length,
      currentStreaks,
      bestStreaks,
    };
  }

  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    return query<LeaderboardEntry>(
      `SELECT
         a.user_id,
         CAST(a.user_id AS NVARCHAR) as display_name,
         COUNT(DISTINCT a.id) as achievement_count,
         ISNULL(MAX(s.best_count), 0) as best_streak,
         ISNULL(MAX(CASE WHEN s.streak_type = 'daily_resolve' THEN s.current_count END), 0) as current_streak
       FROM agent_achievements a
       LEFT JOIN agent_streaks s ON s.user_id = a.user_id
       GROUP BY a.user_id
       ORDER BY COUNT(DISTINCT a.id) DESC, MAX(s.best_count) DESC`,
    );
  }

  async getAchievementDefs(): Promise<Record<string, { name: string; icon: string; description: string }>> {
    return ACHIEVEMENT_DEFS;
  }

  async checkAndAwardAchievements(userId: number): Promise<Achievement[]> {
    const today = new Date().toISOString().slice(0, 10);
    const awarded: Achievement[] = [];

    const existing = await query<{ achievement_type: string }>(
      `SELECT DISTINCT achievement_type FROM agent_achievements WHERE user_id = ?`,
      [userId],
    );
    const has = new Set(existing.map(e => e.achievement_type));

    // First resolve
    if (!has.has('first_resolve')) {
      const rows = await query<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM jira_ticket_cache WHERE assignee_id = CAST(? AS NVARCHAR) AND status IN ('Resolved', 'Closed', 'Done')`,
        [userId],
      );
      if ((rows[0]?.cnt ?? 0) > 0) {
        const a = await this.award(userId, 'first_resolve');
        if (a) awarded.push(a);
      }
    }

    // Speed demon: 5+ resolved today
    if (!has.has('speed_demon')) {
      const rows = await query<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM jira_ticket_cache
         WHERE assignee_id = CAST(? AS NVARCHAR)
         AND status IN ('Resolved', 'Closed', 'Done')
         AND resolved_at >= CAST(GETUTCDATE() AS DATE)`,
        [userId],
      );
      if ((rows[0]?.cnt ?? 0) >= 5) {
        const a = await this.award(userId, 'speed_demon');
        if (a) awarded.push(a);
      }
    }

    // Century club: 100+ total resolved
    if (!has.has('century')) {
      const rows = await query<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM jira_ticket_cache WHERE assignee_id = CAST(? AS NVARCHAR) AND status IN ('Resolved', 'Closed', 'Done')`,
        [userId],
      );
      if ((rows[0]?.cnt ?? 0) >= 100) {
        const a = await this.award(userId, 'century');
        if (a) awarded.push(a);
      }
    }

    // Streak milestones
    await this.updateResolveStreak(userId, today);
    const streaks = await query<Streak>(
      `SELECT * FROM agent_streaks WHERE user_id = ? AND streak_type = 'daily_resolve'`,
      [userId],
    );
    const streak = streaks[0];
    if (streak) {
      if (streak.current_count >= 5 && !has.has('streak_5')) {
        const a = await this.award(userId, 'streak_5');
        if (a) awarded.push(a);
      }
      if (streak.current_count >= 10 && !has.has('streak_10')) {
        const a = await this.award(userId, 'streak_10');
        if (a) awarded.push(a);
      }
      if (streak.current_count >= 20 && !has.has('streak_20')) {
        const a = await this.award(userId, 'streak_20');
        if (a) awarded.push(a);
      }
    }

    return awarded;
  }

  private async updateResolveStreak(userId: number, today: string): Promise<void> {
    const resolved = await query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM jira_ticket_cache
       WHERE assignee_id = CAST(? AS NVARCHAR)
       AND status IN ('Resolved', 'Closed', 'Done')
       AND resolved_at >= CAST(? AS DATE)`,
      [userId, today],
    );

    if ((resolved[0]?.cnt ?? 0) === 0) return;

    const rows = await query<Streak>(
      `SELECT * FROM agent_streaks WHERE user_id = ? AND streak_type = 'daily_resolve'`,
      [userId],
    );

    if (rows.length === 0) {
      await execute(
        `INSERT INTO agent_streaks (user_id, streak_type, current_count, best_count, last_date)
         VALUES (?, 'daily_resolve', 1, 1, ?)`,
        [userId, today],
      );
      return;
    }

    const s = rows[0];
    if (s.last_date === today) return;

    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const isConsecutive = s.last_date === yesterday;
    const newCount = isConsecutive ? s.current_count + 1 : 1;
    const newBest = Math.max(newCount, s.best_count);

    await execute(
      `UPDATE agent_streaks SET current_count = ?, best_count = ?, last_date = ?, updated_at = GETUTCDATE()
       WHERE user_id = ? AND streak_type = 'daily_resolve'`,
      [newCount, newBest, today, userId],
    );
  }

  private async award(userId: number, type: string, detail?: string): Promise<Achievement | null> {
    try {
      const id = await executeAndGetId(
        `INSERT INTO agent_achievements (user_id, achievement_type, detail) VALUES (?, ?, ?)`,
        [userId, type, detail ?? ACHIEVEMENT_DEFS[type]?.description ?? null],
      );
      return { id, user_id: userId, achievement_type: type, detail: detail ?? null, earned_at: new Date().toISOString() };
    } catch {
      return null;
    }
  }
}
