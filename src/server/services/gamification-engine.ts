// Gamification v2 — the earning engine behind the rewards scheme.
//
// What changed from v1, and why:
//
//  - v1 only ever awarded on a BUTTON CLICK on the leaderboard. Nothing ran on a
//    schedule, so achievements barely accrued. This evaluates on a timer.
//  - Five of v1's twelve achievements (SLA Perfectionist, Quality King, Zero Inbox,
//    Early Bird, 10 Streak) were display-only strings with no awarding logic at all.
//  - v1 keyed on NOVA user_id, so anyone without a NOVA login could never earn.
//    This keys on the KPI agent name, which is what the boards rank on.
//  - v1 had two different points formulas (per-achievement values in one place,
//    count x 10 in another), so a person's score depended which panel you read.
//
// Design decisions that matter for a scheme with real prizes attached:
//
//  MILESTONES are earn-once and progressive (100 -> 500 -> 1000 solves), so long
//  service keeps giving without a one-off badge being the whole economy.
//  REPEATABLES are the actual engine — earnable every day or week you qualify.
//  SEASONS reset points; badges are permanent. Otherwise whoever joined first wins
//  forever regardless of current performance.
//
//  Targets are COHORT-relative (Customer Care vs Technical). CC and T2/DigitalDesign
//  do genuinely different work at different volumes; a single "5 in a day" bar
//  rewards the queue you sit in rather than the effort you put in.
//
//  Volume-only achievements are capped and deliberately worth less than quality and
//  consistency ones. "Resolve 5 in a day" is trivially gameable by closing five
//  easy tickets; "no SLA breach for 10 consecutive resolves" is not.

import { query, execute } from './database.js';
import { getAllInRange } from './kpi-agent/store.js';
import type { AgentKpiRow } from './kpi-agent/compute.js';

export type Cohort = 'cc' | 'technical';
export type Cadence = 'once' | 'daily' | 'weekly';

export interface AchievementDef {
  key: string;
  name: string;
  icon: string;
  description: string;
  points: number;
  cadence: Cadence;
  /** small = voucher-scale, mid = WFH day / early finish, large = Perkbox-scale. */
  tier: 'small' | 'mid' | 'large';
  /** Per-cohort threshold where the bar should differ by the work being done. */
  target?: Record<Cohort, number>;
}

/** Which cohort an agent's targets come from. CC runs high-volume front line;
 *  Technical (Tier 2 / Digital Design / Support) runs lower-volume, deeper work. */
export function cohortOf(team: string | null | undefined, tier: string | null | undefined): Cohort {
  const t = (team ?? '').toLowerCase();
  if (t.includes('customercare') || t.includes('customer care')) return 'cc';
  if ((tier ?? '').toUpperCase() === 'T1') return 'cc';
  return 'technical';
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // ── Milestones: earn once, permanent, recognition rather than currency ──
  { key: 'first_resolve', name: 'First Blood', icon: '🎯', description: 'Resolved your first ticket', points: 5, cadence: 'once', tier: 'small' },
  { key: 'century', name: 'Century Club', icon: '💯', description: 'Resolved 100 tickets', points: 30, cadence: 'once', tier: 'small' },
  { key: 'quincentenary', name: 'Five Hundred', icon: '🏛️', description: 'Resolved 500 tickets', points: 75, cadence: 'once', tier: 'mid' },
  { key: 'millennium', name: 'Thousand Club', icon: '👑', description: 'Resolved 1,000 tickets', points: 150, cadence: 'once', tier: 'large' },

  // ── Repeatable dailies: the engine. Volume ones are worth least, on purpose ──
  {
    key: 'speed_demon', name: 'Speed Demon', icon: '⚡', cadence: 'daily', tier: 'small', points: 6,
    description: 'Beat your cohort’s daily resolve target', target: { cc: 10, technical: 6 },
  },
  {
    key: 'sla_perfect_day', name: 'SLA Perfectionist', icon: '🏆', cadence: 'daily', tier: 'small', points: 12,
    description: 'A full day resolving with no SLA breach', target: { cc: 6, technical: 4 },
  },
  {
    key: 'zero_inbox', name: 'Zero Inbox', icon: '📭', cadence: 'daily', tier: 'mid', points: 20,
    description: 'A full day’s work ended with nothing over SLA and nothing stale', target: { cc: 6, technical: 4 },
  },

  // ── Repeatable weeklies: consistency and quality, the hardest to fake ──
  {
    key: 'qa_star', name: 'Quality King', icon: '⭐', cadence: 'weekly', tier: 'mid', points: 25,
    description: 'Averaged 9+ QA across a week', target: { cc: 9, technical: 9 },
  },
  {
    key: 'clean_week', name: 'Clean Sweep', icon: '🧹', cadence: 'weekly', tier: 'mid', points: 30,
    description: 'A full week at 100% SLA compliance', target: { cc: 25, technical: 15 },
  },
  {
    key: 'consistency', name: 'Metronome', icon: '📈', cadence: 'weekly', tier: 'large', points: 40,
    description: 'Hit your daily target every working day of the week', target: { cc: 10, technical: 6 },
  },
];

export const ACHIEVEMENT_BY_KEY = new Map(ACHIEVEMENTS.map(a => [a.key, a]));

/** ISO year-week, e.g. 2026-W36 — the period key for weekly achievements. */
export function weekKey(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);           // Thursday decides the ISO year
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fDow = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fDow + 3);
  const week = 1 + Math.round((d.getTime() - firstThu.getTime()) / (7 * 86_400_000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface ActiveSeason { id: number; name: string; starts_on: string }

/** The open season, created on first use so the engine is self-starting. */
export async function getActiveSeason(): Promise<ActiveSeason> {
  const rows = await query<ActiveSeason>(
    `SELECT TOP 1 id, name, CONVERT(varchar(10), starts_on, 23) AS starts_on
     FROM gam_seasons WHERE is_active = 1 ORDER BY starts_on DESC`,
  );
  if (rows.length > 0) return rows[0];
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const name = `Season ${today.slice(0, 7)}`;
  await execute(`INSERT INTO gam_seasons (name, starts_on, is_active) VALUES (?, ?, 1)`, [name, today]);
  const created = await query<ActiveSeason>(
    `SELECT TOP 1 id, name, CONVERT(varchar(10), starts_on, 23) AS starts_on
     FROM gam_seasons WHERE is_active = 1 ORDER BY starts_on DESC`,
  );
  return created[0];
}

/** Insert an award. The unique index on (agent, key, period) makes this idempotent,
 *  so the evaluator can re-run over the same days without double-paying. */
async function grant(
  seasonId: number, agentName: string, key: string, periodKey: string, detail: string,
): Promise<boolean> {
  const def = ACHIEVEMENT_BY_KEY.get(key);
  if (!def) return false;
  try {
    const res = await execute(
      `IF NOT EXISTS (SELECT 1 FROM gam_awards WHERE agent_name = ? AND achievement_key = ? AND period_key = ?)
         INSERT INTO gam_awards (season_id, agent_name, achievement_key, period_key, points, detail)
         VALUES (?, ?, ?, ?, ?, ?)`,
      [agentName, key, periodKey, seasonId, agentName, key, periodKey, def.points, detail],
    );
    return (res.rowsAffected ?? 0) > 0;
  } catch {
    return false; // unique index lost a race — already awarded, which is the point
  }
}

export interface EvaluateResult { season: string; days: number; granted: number }

/**
 * Evaluate achievements over a window of completed days.
 *
 * Reads the Rebuild agent store — the same rows the leaderboard ranks on — so a
 * prize can never be based on numbers that disagree with the board someone is
 * looking at. Only days that have been captured are considered, which means today
 * is not evaluated until the 18:00 freeze has run and the solve re-capture has
 * corrected it the next morning. That lag is deliberate: awarding off a partial
 * day is how you end up clawing a prize back.
 */
export async function evaluateAchievements(fromDay: string, toDay: string): Promise<EvaluateResult> {
  const season = await getActiveSeason();
  const rows = await getAllInRange(fromDay, toDay);
  if (rows.length === 0) return { season: season.name, days: 0, granted: 0 };

  const byAgent = new Map<string, Array<AgentKpiRow & { date: string }>>();
  for (const r of rows) {
    if (!r.agentName || r.agentName === 'NOVA AI') continue;   // synthetic agent does not compete
    if (!byAgent.has(r.agentName)) byAgent.set(r.agentName, []);
    byAgent.get(r.agentName)!.push(r);
  }

  let granted = 0;
  const target = (key: string, c: Cohort): number => ACHIEVEMENT_BY_KEY.get(key)?.target?.[c] ?? 0;

  for (const [agentName, days] of byAgent) {
    days.sort((a, b) => a.date.localeCompare(b.date));
    const latest = days[days.length - 1];
    const cohort = cohortOf(latest.team, latest.tierCode);

    // ── Milestones. Lifetime solves, so these survive a season reset. ──
    const lifetime = await query<{ total: number }>(
      `SELECT ISNULL(SUM(points), 0) AS total FROM gam_awards WHERE agent_name = ? AND achievement_key = 'first_resolve'`,
      [agentName],
    );
    const everSolved = days.some(d => d.solvedToday > 0);
    if (everSolved && lifetime[0]?.total === 0) {
      if (await grant(season.id, agentName, 'first_resolve', '', 'First ticket resolved')) granted++;
    }

    // ── Dailies ──
    for (const d of days) {
      if (d.solvedToday >= target('speed_demon', cohort)) {
        if (await grant(season.id, agentName, 'speed_demon', d.date, `${d.solvedToday} resolved`)) granted++;
      }
      // Needs real volume behind it — "no breaches" on one ticket is not a perfect day.
      if (d.solvedToday >= target('sla_perfect_day', cohort) && d.slaCompliancePct === 100) {
        if (await grant(season.id, agentName, 'sla_perfect_day', d.date, `${d.solvedToday} resolved, no breach`)) granted++;
      }
      // Volume floor matters here: "nothing over SLA and nothing stale" is trivial
      // on a near-empty queue. Without it, the lowest-volume agent on the team
      // topped the dry run — the same fault the leaderboard had.
      if (d.solvedToday >= target('zero_inbox', cohort) && d.overSla === 0 && d.noReply === 0) {
        if (await grant(season.id, agentName, 'zero_inbox', d.date, 'Nothing over SLA, nothing stale')) granted++;
      }
    }

    // ── Weeklies ──
    const byWeek = new Map<string, Array<AgentKpiRow & { date: string }>>();
    for (const d of days) {
      const w = weekKey(d.date);
      if (!byWeek.has(w)) byWeek.set(w, []);
      byWeek.get(w)!.push(d);
    }
    for (const [wk, wdays] of byWeek) {
      const qaVals = wdays.map(d => d.qaOverall).filter((v): v is number => v != null);
      if (qaVals.length > 0) {
        const qaAvg = qaVals.reduce((s, v) => s + v, 0) / qaVals.length;
        if (qaAvg >= target('qa_star', cohort)) {
          if (await grant(season.id, agentName, 'qa_star', wk, `QA ${qaAvg.toFixed(1)} across the week`)) granted++;
        }
      }
      const solvedWeek = wdays.reduce((s, d) => s + d.solvedToday, 0);
      const slaDays = wdays.filter(d => d.slaCompliancePct != null);
      if (solvedWeek >= target('clean_week', cohort) && slaDays.length > 0 && slaDays.every(d => d.slaCompliancePct === 100)) {
        if (await grant(season.id, agentName, 'clean_week', wk, `${solvedWeek} resolved, 100% SLA`)) granted++;
      }
      const workingDays = wdays.filter(d => d.solvedToday > 0 || (d.ticketsPerHour ?? 0) > 0);
      if (workingDays.length >= 4 && workingDays.every(d => d.solvedToday >= target('consistency', cohort))) {
        if (await grant(season.id, agentName, 'consistency', wk, `Target hit on ${workingDays.length} days`)) granted++;
      }
    }
  }

  return { season: season.name, days: new Set(rows.map(r => r.date)).size, granted };
}

export interface StandingRow {
  agentName: string; cohort: Cohort; seasonPoints: number; lifetimePoints: number;
  awards: number; badges: string[];
}

/** Season standings. Cohorts are returned so the UI can rank CC and Technical
 *  separately — they are held to different targets, so a single table would be
 *  comparing work that is not comparable. */
export async function getStandings(): Promise<{ season: ActiveSeason; rows: StandingRow[] }> {
  const season = await getActiveSeason();
  const rows = await query<{ agent_name: string; achievement_key: string; points: number; season_id: number }>(
    `SELECT agent_name, achievement_key, points, season_id FROM gam_awards`,
  );

  // Cohort from each agent's most recent captured day, so standings can be split
  // CC vs Technical — they are held to different targets, and a single table would
  // rank work that is not comparable.
  const cohortByAgent = new Map<string, Cohort>();
  const recent = await query<{ agent_name: string; metrics_json: string }>(
    `SELECT a.agent_name, a.metrics_json FROM kpi_agent_daily a
     INNER JOIN (SELECT agent_account_id, MAX(kpi_date) AS d FROM kpi_agent_daily GROUP BY agent_account_id) m
       ON m.agent_account_id = a.agent_account_id AND m.d = a.kpi_date`,
  );
  for (const r of recent) {
    try {
      const m = JSON.parse(r.metrics_json) as AgentKpiRow;
      cohortByAgent.set(r.agent_name, cohortOf(m.team, m.tierCode));
    } catch { /* skip unparseable row */ }
  }

  const byAgent = new Map<string, StandingRow>();
  for (const r of rows) {
    let e = byAgent.get(r.agent_name);
    if (!e) {
      e = { agentName: r.agent_name, cohort: cohortByAgent.get(r.agent_name) ?? 'technical', seasonPoints: 0, lifetimePoints: 0, awards: 0, badges: [] };
      byAgent.set(r.agent_name, e);
    }
    e.lifetimePoints += r.points;
    e.awards++;
    if (r.season_id === season.id) e.seasonPoints += r.points;
    if (!e.badges.includes(r.achievement_key)) e.badges.push(r.achievement_key);
  }
  return { season, rows: [...byAgent.values()].sort((a, b) => b.seasonPoints - a.seasonPoints) };
}
