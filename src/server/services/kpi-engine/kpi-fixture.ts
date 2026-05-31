/**
 * KPI Recovery — Escalations Parity Proof Fixture (KPX-WP6A)
 *
 * A tightly-bounded, DISPOSABLE fixture that proves the populated Escalations
 * parity path behaviourally, end-to-end, through the REAL clean-sheet data path
 * — and then cleans itself back out so the environment is left in a known state.
 *
 * It does NOT fabricate escalation-family metric values. It inserts real SOURCE
 * rows (a disposable Jira space + a handful of jira_issue_cache tickets + real
 * escalation_log events) and then lets the live engine compute the escalation
 * family exactly as production would:
 *   - escalation_rate     ← escalation_log (non-rejection rows) / tickets in scope
 *   - rejection_rate      ← escalation_log rejection (bounce-back) rows
 *   - escalation_accuracy ← escalations not bounced back / escalations
 * The snapshot, EOD-freeze, 7-day history and per-agent breakdown are all the
 * real Phase 1/2/3 code paths (KpiEngine + KpiEodService), never a shortcut.
 *
 * Everything created lives under a single fixture space (`__ESCFX`) / Jira
 * project (`ZZESCFX`) so teardown is a clean, exhaustive delete. When the
 * fixture is absent the platform's honest null/awaiting behaviour is unchanged:
 * the fixture space simply does not exist, so the Escalations parity surface
 * omits it and every real space is untouched.
 *
 * Flow the fixture is designed to demonstrate:
 *   1. seed()         → escalation_rate is a REAL populated % ; accuracy /
 *                       rejection_rate honestly read "—" (no bounce-back yet).
 *   2. addRejection() → a real rejection event is captured, so escalation_accuracy
 *                       and rejection_rate transition to REAL populated values.
 *   3. teardown()     → all fixture rows removed; honest empty state restored.
 */
import { query, execute, queryOne } from '../database.js';
import type { KpiEngine } from './kpi-engine.js';
import type { KpiEodService } from './kpi-eod.js';

/** The single disposable space the whole fixture lives under. */
const SPACE_KEY = '__ESCFX';
/** Disposable Jira project key (≤10 chars per jira_issue_cache.project_key). */
const PROJECT = 'ZZESCFX';
const DISPLAY_NAME = 'Escalations Parity Fixture (disposable)';
/** Number of trailing calendar days of frozen daily history the fixture writes. */
const HISTORY_DAYS = 7;

/** The escalation metric family this fixture proves — and ONLY this family. */
const ESC_METRICS: Array<{ metricKey: string; target: number | null; order: number }> = [
  { metricKey: 'escalation_rate', target: null, order: 1 },
  { metricKey: 'escalation_accuracy', target: 90, order: 2 },
  { metricKey: 'rejection_rate', target: null, order: 3 },
];

/** Two fixture agents so the per-agent breakdown is non-trivial. */
const AGENT_A = { id: 'escfx-agent-a', name: 'Fixture Agent A' };
const AGENT_B = { id: 'escfx-agent-b', name: 'Fixture Agent B' };

/** Tickets, with which fixture agent owns each. */
const TICKETS: Array<{ key: string; agentId: string; agentName: string }> = [
  { key: `${PROJECT}-1`, agentId: AGENT_A.id, agentName: AGENT_A.name },
  { key: `${PROJECT}-2`, agentId: AGENT_A.id, agentName: AGENT_A.name },
  { key: `${PROJECT}-3`, agentId: AGENT_A.id, agentName: AGENT_A.name },
  { key: `${PROJECT}-4`, agentId: AGENT_B.id, agentName: AGENT_B.name },
  { key: `${PROJECT}-5`, agentId: AGENT_B.id, agentName: AGENT_B.name },
];

/** Genuine escalation events (non-rejection): one per agent. */
const ESCALATIONS: Array<{ ticket: string; by: string }> = [
  { ticket: `${PROJECT}-1`, by: AGENT_A.name },
  { ticket: `${PROJECT}-4`, by: AGENT_B.name },
];

/** The bounce-back / rejection event (added by addRejection / seed withRejection). */
const REJECTION = { ticket: `${PROJECT}-1`, rejectedBy: 'Fixture T2 Lead', returnedTo: AGENT_A.name };

export interface FixtureStatus {
  present: boolean;
  spaceKey: string;
  jiraProject: string;
  tickets: number;
  escalations: number;
  rejections: number;
  rejectionPresent: boolean;
  dailyRows: number;
  agentDailyRows: number;
  snapshotRows: number;
  /** Distinct report_date count in kpi_daily (history depth). */
  historyDays: number;
}

export class KpiEscalationFixtureService {
  constructor(
    private readonly engine: KpiEngine,
    private readonly eod: KpiEodService,
  ) {}

  /** YYYY-MM-DD for an instant (UTC calendar day — matches kpi_daily DATE storage). */
  private dateKey(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  /** The trailing HISTORY_DAYS calendar dates, oldest → newest. */
  private historyDates(now = new Date()): string[] {
    const out: string[] = [];
    for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
      out.push(this.dateKey(new Date(now.getTime() - i * 86400000)));
    }
    return out;
  }

  /** Insert the disposable space + escalation-family bindings (idempotent). */
  private async ensureSpaceAndBindings(): Promise<void> {
    await execute(`DELETE FROM kpi_spaces WHERE space_key = ?`, [SPACE_KEY]);
    await execute(
      `INSERT INTO kpi_spaces
         (space_key, jira_project, display_name, owner_name, timezone,
          biz_hours_start, biz_hours_end, weekend_days, pause_statuses,
          has_tiers, is_jira_space, is_active)
       VALUES (?, ?, ?, ?, 'Europe/London', '08:30', '17:30', '0,6', ?, 0, 1, 1)`,
      [SPACE_KEY, PROJECT, DISPLAY_NAME, 'KPX-WP6A', JSON.stringify([])],
    );

    await execute(`DELETE FROM kpi_space_metrics WHERE space_key = ?`, [SPACE_KEY]);
    for (const m of ESC_METRICS) {
      await execute(
        `INSERT INTO kpi_space_metrics
           (space_key, metric_key, is_enabled, target_value, amber_band, display_order, show_on_wallboard, show_on_slt_view)
         VALUES (?, ?, 1, ?, 10.0, ?, 0, 0)`,
        [SPACE_KEY, m.metricKey, m.target, m.order],
      );
    }
  }

  /** Insert the fixture tickets into jira_issue_cache (open, recent, assigned). */
  private async insertTickets(now = new Date()): Promise<void> {
    await execute(`DELETE FROM jira_issue_cache WHERE project_key = ?`, [PROJECT]);
    const nowIso = now.toISOString();
    for (let i = 0; i < TICKETS.length; i++) {
      const t = TICKETS[i];
      await execute(
        `INSERT INTO jira_issue_cache
           (issue_key, jira_id, project_key, summary, status_name, status_category,
            assignee_account_id, assignee_display, jira_created, jira_updated, sla_breached)
         VALUES (?, ?, ?, ?, 'In Progress', 'indeterminate', ?, ?, ?, ?, 0)`,
        [t.key, `90000${i}`, PROJECT, `Escalations parity fixture ticket ${i + 1}`,
         t.agentId, t.agentName, nowIso, nowIso],
      );
    }
  }

  /** Insert the genuine (non-rejection) escalation events. */
  private async insertEscalations(now = new Date()): Promise<void> {
    const nowIso = now.toISOString();
    for (const e of ESCALATIONS) {
      await execute(
        `INSERT INTO escalation_log
           (ticket_key, escalation_type, escalated_by, notes, source, created_at)
         VALUES (?, 'manual', ?, 'KPX-WP6A fixture escalation', 'kpx_wp6a_fixture', ?)`,
        [e.ticket, e.by, nowIso],
      );
    }
  }

  /** Re-derive the escalation family through the live engine + EOD freeze.
   *  Writes a live snapshot (now) and freezes HISTORY_DAYS of daily/agent rows,
   *  so current value, 7-day history and per-agent breakdown all populate from
   *  real computed output. */
  private async recompute(now = new Date()): Promise<{ dates: string[] }> {
    // Live snapshot (current value via the snapshot path).
    const values = await this.engine.computeSpaceMetrics(SPACE_KEY);
    await this.engine.writeSnapshots(values, now);

    // EOD freeze for each of the trailing days → kpi_daily + kpi_agent_daily +
    // kpi_eod_snapshot. captureSpace is idempotent per (space, date), so re-running
    // after a rejection cleanly replaces the day's rows with the updated family.
    const dates = this.historyDates(now);
    for (const d of dates) {
      await this.eod.captureSpace(SPACE_KEY, { reportDate: d, now });
    }
    return { dates };
  }

  /**
   * Build the fixture. Inserts the disposable space + tickets + real escalation
   * events, then computes/freezes the escalation family through the live engine.
   * Idempotent: a re-seed fully rebuilds the fixture from scratch.
   *
   * @param opts.withRejection when true, also captures the bounce-back so
   *   escalation_accuracy / rejection_rate populate immediately. Default false,
   *   so the evaluator first observes them honestly "—" (awaiting capture).
   */
  async seed(opts: { withRejection?: boolean } = {}): Promise<FixtureStatus> {
    const now = new Date();
    await this.ensureSpaceAndBindings();
    await this.insertTickets(now);
    // Clear any prior fixture escalation rows, then insert the genuine escalations.
    await execute(`DELETE FROM escalation_log WHERE ticket_key LIKE ?`, [`${PROJECT}-%`]);
    await this.insertEscalations(now);
    if (opts.withRejection) await this.insertRejectionRow(now);
    await this.recompute(now);
    return this.status();
  }

  /** Insert the rejection row only (no recompute). */
  private async insertRejectionRow(now = new Date()): Promise<void> {
    await execute(
      `INSERT INTO escalation_log
         (ticket_key, escalation_type, escalated_by, assigned_to, notes, source, created_at)
       VALUES (?, 'rejection', ?, ?, 'KPX-WP6A fixture bounce-back', 'kpx_wp6a_fixture', ?)`,
      [REJECTION.ticket, REJECTION.rejectedBy, REJECTION.returnedTo, now.toISOString()],
    );
  }

  /**
   * Capture a real bounce-back / rejection on top of an existing seed, then
   * recompute. This is the transition demonstrator: before this call
   * escalation_accuracy / rejection_rate read "—" (no captured rejection); after
   * it they carry REAL computed values. No-ops gracefully if a rejection already
   * exists. Errors if the fixture has not been seeded.
   */
  async addRejection(): Promise<FixtureStatus> {
    const present = await queryOne<{ n: number }>(`SELECT TOP 1 1 AS n FROM kpi_spaces WHERE space_key = ?`, [SPACE_KEY]);
    if (!present) throw new Error('Fixture not seeded — call seed first');
    const now = new Date();
    const existing = await queryOne<{ n: number }>(
      `SELECT TOP 1 1 AS n FROM escalation_log WHERE ticket_key LIKE ? AND escalation_type = 'rejection'`,
      [`${PROJECT}-%`],
    );
    if (!existing) await this.insertRejectionRow(now);
    await this.recompute(now);
    return this.status();
  }

  /**
   * Remove every fixture row across all clean-sheet tables, leaving the
   * environment in a known state. Exhaustive and bounded to the fixture
   * space / project only — never touches real spaces or real escalations.
   */
  async teardown(): Promise<{ removed: boolean; status: FixtureStatus }> {
    await execute(`DELETE FROM escalation_log WHERE ticket_key LIKE ?`, [`${PROJECT}-%`]);
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
  async status(): Promise<FixtureStatus> {
    const one = async (sqlText: string, params: unknown[] = []) =>
      (await queryOne<{ n: number }>(sqlText, params))?.n ?? 0;

    const present = (await one(`SELECT TOP 1 1 AS n FROM kpi_spaces WHERE space_key = ?`, [SPACE_KEY])) > 0;
    const tickets = await one(`SELECT COUNT(*) AS n FROM jira_issue_cache WHERE project_key = ?`, [PROJECT]);
    const escalations = await one(
      `SELECT COUNT(*) AS n FROM escalation_log WHERE ticket_key LIKE ? AND escalation_type <> 'rejection'`, [`${PROJECT}-%`]);
    const rejections = await one(
      `SELECT COUNT(*) AS n FROM escalation_log WHERE ticket_key LIKE ? AND escalation_type = 'rejection'`, [`${PROJECT}-%`]);
    const dailyRows = await one(`SELECT COUNT(*) AS n FROM kpi_daily WHERE space_key = ?`, [SPACE_KEY]);
    const agentDailyRows = await one(`SELECT COUNT(*) AS n FROM kpi_agent_daily WHERE space_key = ?`, [SPACE_KEY]);
    const snapshotRows = await one(`SELECT COUNT(*) AS n FROM kpi_snapshots WHERE space_key = ?`, [SPACE_KEY]);
    const historyDays = await one(`SELECT COUNT(DISTINCT report_date) AS n FROM kpi_daily WHERE space_key = ?`, [SPACE_KEY]);

    return {
      present,
      spaceKey: SPACE_KEY,
      jiraProject: PROJECT,
      tickets,
      escalations,
      rejections,
      rejectionPresent: rejections > 0,
      dailyRows,
      agentDailyRows,
      snapshotRows,
      historyDays,
    };
  }
}
