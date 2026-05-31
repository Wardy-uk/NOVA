/**
 * KPI Recovery — Agent Breaches Parity Proof Fixture (KPX-WP8A)
 *
 * A tightly-bounded, DISPOSABLE fixture that proves the populated Agent Breaches
 * parity path behaviourally, end-to-end, through the REAL clean-sheet data path
 * — and then cleans itself back out so the environment is left in a known state.
 *
 * It does NOT fabricate per-agent breach/at-risk/clear results. It inserts real
 * SOURCE rows (a disposable Jira space + a handful of jira_issue_cache tickets,
 * each resolved "today" and assigned to one of three fixture agents) and then
 * lets the live engine + EOD freeze compute the per-agent values exactly as
 * production would:
 *   - resolved_today (agent-level, direction 'higher', target 5) is computed per
 *     agent by the SAME Phase-1 computer the Agent Scorecard uses, and the SAME
 *     RAG logic the Agent Breaches surface applies decides each agent's state:
 *       red   → breach   (failing the target beyond the amber band)
 *       amber → at-risk  (within the amber band of the target)
 *       green → met / clear
 * The three fixture agents are given different volumes of tickets resolved today
 * so that — purely from the real computed values — one lands in each band:
 *   - Agent CLEAR   : 6 resolved → value 6 ≥ 5            → green → clear / met
 *   - Agent AT-RISK : 4 resolved → 3 ≤ 4 < 5 (amber band) → amber → at-risk
 *   - Agent BREACH  : 1 resolved → 1 < 3                  → red   → breach
 * (target 5, amber_band 40% → band = 2, so amber spans [3,5), red < 3, green ≥ 5.)
 *
 * The per-agent breakdown read by `KpiViewsService.getAgentBreaches` comes from
 * the real `kpi_agent_daily` rows frozen by `KpiEodService.captureSpace`, never a
 * shortcut: no kpi_agent_daily row is written by this fixture directly.
 *
 * Everything created lives under a single fixture space (`__ABFX`) / Jira project
 * (`ZZABFX`) so teardown is a clean, exhaustive delete. When the fixture is absent
 * the platform's honest empty-state behaviour is unchanged: the fixture space
 * simply does not exist, so the Agent Breaches surface omits it and every real
 * space is untouched.
 *
 * Flow the fixture is designed to demonstrate:
 *   1. seed()     → __ABFX appears on the Agent Breaches surface with one agent
 *                   breaching, one at-risk, and one clear — all from real values.
 *   2. teardown() → all fixture rows removed; honest empty state restored.
 */
import { query, execute, queryOne } from '../database.js';
import type { KpiEngine } from './kpi-engine.js';
import type { KpiEodService } from './kpi-eod.js';

/** The single disposable space the whole fixture lives under. */
const SPACE_KEY = '__ABFX';
/** Disposable Jira project key (≤10 chars per jira_issue_cache.project_key). */
const PROJECT = 'ZZABFX';
const DISPLAY_NAME = 'Agent Breaches Parity Fixture (disposable)';

/**
 * The single breach-evaluable agent-level metric this fixture proves. resolved_today
 * is agent-level, has a registered computer, direction 'higher', and counts tickets
 * resolved today — so per-agent volume alone drives the breach state, with no
 * business-hours or comment-timing dependency. target/amber chosen so three agents
 * with 6 / 4 / 1 resolved land cleanly green / amber / red.
 */
const METRIC = { metricKey: 'resolved_today', target: 5, amberBand: 40, order: 1 };

/**
 * Three fixture agents, each with a different number of tickets resolved today, so
 * the per-agent breach state is computed (never fabricated) into one of each band.
 */
const AGENTS: Array<{ id: string; name: string; resolvedToday: number; expected: 'breach' | 'at_risk' | 'clear' }> = [
  { id: 'abfx-agent-clear',   name: 'Fixture Agent Clear',   resolvedToday: 6, expected: 'clear' },
  { id: 'abfx-agent-atrisk',  name: 'Fixture Agent At-Risk', resolvedToday: 4, expected: 'at_risk' },
  { id: 'abfx-agent-breach',  name: 'Fixture Agent Breach',  resolvedToday: 1, expected: 'breach' },
];

export interface AgentBreachFixtureStatus {
  present: boolean;
  spaceKey: string;
  jiraProject: string;
  metricKey: string;
  /** Total fixture tickets inserted into jira_issue_cache. */
  tickets: number;
  /** Distinct fixture agents represented in jira_issue_cache. */
  agents: number;
  /** Frozen per-agent rows (kpi_agent_daily) for the fixture space. */
  agentDailyRows: number;
  dailyRows: number;
  snapshotRows: number;
  /** Report date the latest agent rows were frozen for; null if none. */
  reportDate: string | null;
  /**
   * The intended per-agent classification this fixture is built to produce, for
   * eval convenience. The ACTUAL classification must be observed via the live
   * Agent Breaches surface (GET /api/kpi/agent-breaches) — this is the design
   * intent, not a self-certified result.
   */
  expectedBands: { breach: number; atRisk: number; clear: number };
}

export class KpiAgentBreachFixtureService {
  constructor(
    private readonly engine: KpiEngine,
    private readonly eod: KpiEodService,
  ) {}

  /** YYYY-MM-DD for an instant (UTC calendar day — matches kpi_daily DATE storage). */
  private dateKey(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  /** Insert the disposable space + the single breach-evaluable binding (idempotent). */
  private async ensureSpaceAndBindings(): Promise<void> {
    await execute(`DELETE FROM kpi_spaces WHERE space_key = ?`, [SPACE_KEY]);
    await execute(
      `INSERT INTO kpi_spaces
         (space_key, jira_project, display_name, owner_name, timezone,
          biz_hours_start, biz_hours_end, weekend_days, pause_statuses,
          has_tiers, is_jira_space, is_active)
       VALUES (?, ?, ?, ?, 'Europe/London', '08:30', '17:30', '0,6', ?, 0, 1, 1)`,
      [SPACE_KEY, PROJECT, DISPLAY_NAME, 'KPX-WP8A', JSON.stringify([])],
    );

    await execute(`DELETE FROM kpi_space_metrics WHERE space_key = ?`, [SPACE_KEY]);
    await execute(
      `INSERT INTO kpi_space_metrics
         (space_key, metric_key, is_enabled, target_value, amber_band, display_order, show_on_wallboard, show_on_slt_view)
       VALUES (?, ?, 1, ?, ?, ?, 0, 0)`,
      [SPACE_KEY, METRIC.metricKey, METRIC.target, METRIC.amberBand, METRIC.order],
    );
  }

  /**
   * Insert the fixture tickets into jira_issue_cache, each resolved "today" and
   * assigned to its agent, so resolved_today computes a real per-agent volume.
   */
  private async insertTickets(now = new Date()): Promise<void> {
    await execute(`DELETE FROM jira_issue_cache WHERE project_key = ?`, [PROJECT]);
    const nowIso = now.toISOString();
    let seq = 0;
    for (const agent of AGENTS) {
      for (let i = 0; i < agent.resolvedToday; i++) {
        seq++;
        const key = `${PROJECT}-${seq}`;
        await execute(
          `INSERT INTO jira_issue_cache
             (issue_key, jira_id, project_key, summary, status_name, status_category,
              assignee_account_id, assignee_display, jira_created, jira_updated, resolved_at, sla_breached)
           VALUES (?, ?, ?, ?, 'Done', 'done', ?, ?, ?, ?, ?, 0)`,
          [key, `80000${seq}`, PROJECT, `Agent breaches fixture ticket ${seq}`,
           agent.id, agent.name, nowIso, nowIso, nowIso],
        );
      }
    }
  }

  /**
   * Re-derive the agent-level family through the live engine + EOD freeze. Writes
   * a live snapshot (now) and freezes TODAY's daily + per-agent rows into
   * kpi_daily / kpi_agent_daily / kpi_eod_snapshot. captureSpace is idempotent per
   * (space, date), so a re-seed cleanly replaces the day's rows.
   *
   * Only today is frozen: resolved_today is by definition a same-day count, so
   * fabricating multiple historical days would imply false history. The Agent
   * Breaches surface reads the latest frozen date, which today satisfies.
   */
  private async recompute(now = new Date()): Promise<void> {
    const values = await this.engine.computeSpaceMetrics(SPACE_KEY);
    await this.engine.writeSnapshots(values, now);
    await this.eod.captureSpace(SPACE_KEY, { reportDate: this.dateKey(now), now });
  }

  /**
   * Build the fixture. Inserts the disposable space + binding + tickets, then
   * computes/freezes the agent-level family through the live engine so the Agent
   * Breaches surface shows one breaching, one at-risk, and one clear agent — all
   * from real computed values. Idempotent: a re-seed fully rebuilds from scratch.
   */
  async seed(): Promise<AgentBreachFixtureStatus> {
    const now = new Date();
    await this.ensureSpaceAndBindings();
    await this.insertTickets(now);
    await this.recompute(now);
    return this.status();
  }

  /**
   * Remove every fixture row across all clean-sheet tables, leaving the
   * environment in a known state. Exhaustive and bounded to the fixture
   * space / project only — never touches real spaces or real tickets.
   */
  async teardown(): Promise<{ removed: boolean; status: AgentBreachFixtureStatus }> {
    await execute(`DELETE FROM jira_issue_cache WHERE project_key = ?`, [PROJECT]);
    await execute(`DELETE FROM kpi_snapshots WHERE space_key = ?`, [SPACE_KEY]);
    await execute(`DELETE FROM kpi_daily WHERE space_key = ?`, [SPACE_KEY]);
    await execute(`DELETE FROM kpi_agent_daily WHERE space_key = ?`, [SPACE_KEY]);
    await execute(`DELETE FROM kpi_eod_snapshot WHERE space_key = ?`, [SPACE_KEY]);
    await execute(`DELETE FROM kpi_tier_definitions WHERE space_key = ?`, [SPACE_KEY]);
    await execute(`DELETE FROM kpi_holidays WHERE space_key = ?`, [SPACE_KEY]);
    await execute(`DELETE FROM kpi_space_metrics WHERE space_key = ?`, [SPACE_KEY]);
    await execute(`DELETE FROM kpi_spaces WHERE space_key = ?`, [SPACE_KEY]);
    return { removed: true, status: await this.status() };
  }

  /** Report what the fixture currently holds (presence + row counts). */
  async status(): Promise<AgentBreachFixtureStatus> {
    const one = async (sqlText: string, params: unknown[] = []) =>
      (await queryOne<{ n: number }>(sqlText, params))?.n ?? 0;

    const present = (await one(`SELECT TOP 1 1 AS n FROM kpi_spaces WHERE space_key = ?`, [SPACE_KEY])) > 0;
    const tickets = await one(`SELECT COUNT(*) AS n FROM jira_issue_cache WHERE project_key = ?`, [PROJECT]);
    const agents = await one(`SELECT COUNT(DISTINCT assignee_account_id) AS n FROM jira_issue_cache WHERE project_key = ?`, [PROJECT]);
    const agentDailyRows = await one(`SELECT COUNT(*) AS n FROM kpi_agent_daily WHERE space_key = ?`, [SPACE_KEY]);
    const dailyRows = await one(`SELECT COUNT(*) AS n FROM kpi_daily WHERE space_key = ?`, [SPACE_KEY]);
    const snapshotRows = await one(`SELECT COUNT(*) AS n FROM kpi_snapshots WHERE space_key = ?`, [SPACE_KEY]);
    const latest = await queryOne<{ d: string | Date }>(
      `SELECT TOP 1 report_date AS d FROM kpi_agent_daily WHERE space_key = ? ORDER BY report_date DESC`, [SPACE_KEY]);

    const expectedBands = { breach: 0, atRisk: 0, clear: 0 };
    for (const a of AGENTS) {
      if (a.expected === 'breach') expectedBands.breach++;
      else if (a.expected === 'at_risk') expectedBands.atRisk++;
      else expectedBands.clear++;
    }

    return {
      present,
      spaceKey: SPACE_KEY,
      jiraProject: PROJECT,
      metricKey: METRIC.metricKey,
      tickets,
      agents,
      agentDailyRows,
      dailyRows,
      snapshotRows,
      reportDate: latest?.d ? (latest.d instanceof Date ? this.dateKey(latest.d) : String(latest.d).slice(0, 10)) : null,
      expectedBands,
    };
  }
}
