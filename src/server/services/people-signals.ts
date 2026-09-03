import type { SettingsQueries } from '../db/settings-store.js';
import { query } from './database.js';
import { getKpiPool } from './kpi-pipeline.js';
import type { AgentKpiRow } from './kpi-agent/compute.js';

/**
 * Per-person service desk signals — the third half of the NEURO bridge.
 *
 * `flow-signals` describes how work moves and `sentiment-signals` how it lands,
 * and both are queue- or tier-level. Neither can answer a question counted per
 * head, which means NEURO could not see an underperforming agent, could not see
 * a duty that should have happened per person and did not, and could not read
 * any coverage figure — "8 people submitted a standup" is meaningless without
 * knowing whether the team is 9 or 15.
 *
 * Nothing here is new measurement. Every number already existed:
 *
 *  - workload, quality and SLA come from `kpi_agent_daily`, the 18:00 freeze of
 *    the kpi-agent engine. Reading the frozen row rather than recomputing is
 *    deliberate — a recompute costs a Jira JQL sweep plus a scan of
 *    `jira_issue_cache`, against a DTU-limited Azure SQL instance that is also
 *    serving the live service desk. NEURO caches; latency is cheaper than load.
 *  - the roster comes from `dbo.Agent` in the KPI database, live rather than
 *    frozen, so who is on the team is current even when the capture is not.
 *  - standups come from `standup_submissions`, escalations from `escalation_log`.
 *
 * Four things it refuses to do:
 *
 * 1. **It does not send a stored RAG rating.** `kpi_agent_daily` carries one,
 *    computed by whichever thresholds were in force on the day of the freeze.
 *    Sending a judgement made by superseded logic, into a report that informs a
 *    performance conversation, would be worse than sending nothing. The scores
 *    cross; the rating is made downstream, once, by current rules.
 *
 * 2. **It fences the productivity counts.** `solvedToday`, `solvedWeek` and
 *    `ticketsPerHour` are the headline productivity indicators that a PIP
 *    competency was opened over. They are real and they are here, but they sit
 *    in their own `verificationOnly` object rather than beside the quality
 *    scores, so a renderer cannot fold them into a scorecard by accident. They
 *    may check a claim; they may not form a judgement.
 *
 * 3. **It never turns an absence into a zero.** A person the capture never
 *    measured comes back `state: 'no-capture'` with nulls, not a row of noughts,
 *    and a metric the frozen row does not carry stays null. An agent who scored
 *    no QA today and an agent whose QA never ran must not read alike.
 *
 * 4. **It reports its own disagreements.** Anyone measured by the capture but
 *    missing from today's roster is listed rather than dropped, because a
 *    denominator that quietly shrinks is how a coverage figure lies.
 *
 * Each signal carries its own `ok`, same contract as `flow-signals` and NEURO's
 * `weekly-risk` sources: a signal that failed must render as absent, never as a
 * healthy zero.
 *
 * Strictly SELECT. Nothing here writes.
 */

/**
 * Stamped into every response so a caller can tell WHICH build answered.
 *
 * `flow-signals` earned this the hard way: a deploy served a stale `dist` and
 * returned a plausible response with new fields quietly `undefined`. A missing
 * field is indistinguishable from a field that is legitimately empty; a version
 * is not. VANTAGE refuses to render figures from a stamp it does not recognise.
 *
 * Bump on any change to the shape of the response.
 */
export const PEOPLE_SIGNALS_BUILD = '2026-09-03-people-a';

/**
 * Department scope, matching the kpi-agent engine's roster query exactly
 * (compute.ts step 1) and therefore the SLA breach board and the scorecard.
 *
 * TPJ's five are a different manager's team and are deliberately outside this;
 * Sebastian Broome sits in NT and is therefore inside it. Widening this is a
 * legitimate choice but has to be a deliberate one, so the scope travels back on
 * every response rather than being a default nobody remembers making.
 */
export const DEPARTMENTS = ['NT', 'NOVA_AI'];

/**
 * Jira project the escalation log is scoped to. `escalation_log` has no project
 * column, only `ticket_key`, and the hyphen matters: `LIKE 'NT%'` also matches
 * every NTPJ ticket, which is exactly the conflation this scoping prevents.
 */
const TICKET_PREFIX = 'NT-%';

export interface Signal<T> {
  ok: boolean;
  error: string | null;
  data: T | null;
}

/**
 * Run one signal so its failure degrades a section rather than losing the whole
 * response. Same shape as `flow-signals.signal()` — the two halves have to agree
 * on what "unavailable" looks like or the renderer has to special-case one.
 */
async function signal<T>(fn: () => Promise<T>): Promise<Signal<T>> {
  try {
    return { ok: true, error: null, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Query failed', data: null };
  }
}

/**
 * Read a number off a frozen row WITHOUT inventing one.
 *
 * The rows in `kpi_agent_daily` are JSON written by whichever build was running
 * that evening, so a field added later is simply absent from an older row.
 * Defaulting that to 0 would report "no tickets solved" for a day on which the
 * question was never asked. Absent becomes null and stays null.
 */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Name matching key. `standup_submissions.agent_name` and
 * `escalation_log.escalated_by` are both free text written by different systems;
 * the roster is `AgentName + ' ' + AgentSurname`. Whitespace and case are the
 * only differences worth absorbing — anything cleverer would be guessing at
 * identity, and an unmatched name is reported rather than guessed.
 */
function nameKey(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface RosterPerson {
  accountId: string;
  agentId: number | null;
  name: string;
  tierCode: string | null;
  team: string | null;
  /**
   * `dbo.Agent.IsAvailable` — the round-robin assignment flag, NOT a leave
   * record. Someone can be unavailable for assignment and at their desk. Actual
   * absence lives on `GET /api/neuro-bridge/availability`, which reads the
   * People HR sync; this is here because `ticketsPerHour` is gated on it and a
   * null there is otherwise unexplainable.
   */
  availableForAssignment: boolean;
}

export interface RosterData {
  scope: { departments: string[]; activeOnly: true };
  people: RosterPerson[];
  /**
   * People the capture measured who are NOT on the live roster — someone who
   * left, moved department, or was deactivated since the freeze. Listed, not
   * dropped: their tickets and scores are in the day's totals, so a denominator
   * that silently excludes them makes every coverage percentage wrong.
   *
   * Null when the capture could not be read at all, which is NOT the same as an
   * empty array. Empty means checked and in agreement; null means not checked.
   */
  measuredButNotOnRoster: Array<{ accountId: string; name: string | null }> | null;
}

export interface PersonPerformance {
  accountId: string;
  agentId: number | null;
  name: string;
  tierCode: string | null;
  team: string | null;
  /**
   * 'measured' — the capture produced a row for this person on this day.
   * 'no-capture' — it did not, and every metric below is null. That is not a
   * quiet day; it is an unmeasured one, and the two must never render alike.
   */
  state: 'measured' | 'no-capture';
  workload: {
    open: number | null;
    overSla: number | null;
    noReply: number | null;
    oldestDays: number | null;
    oldestKey: string | null;
    /**
     * Oldest actionable ticket at Customer Care / Tier 2 — the support queues,
     * excluding work parked with the customer, a partner or development.
     */
    oldestSupportDays: number | null;
    oldestSupportKey: string | null;
  };
  quality: {
    /**
     * QA rows scored ON THIS DAY. A genuine 0 means nothing was sampled; null
     * means the frozen row does not carry the field at all.
     */
    qaScored: number | null;
    qaOverall: number | null;
    qaAccuracy: number | null;
    qaClarity: number | null;
    qaTone: number | null;
    qaGreen: number | null;
    qaAmber: number | null;
    qaRed: number | null;
    qaConcerning: number | null;
    grScored: number | null;
    grOverall: number | null;
    grOwnership: number | null;
    grNextAction: number | null;
    grTimeframe: number | null;
  };
  sla: {
    /**
     * Share of THIS DAY's resolved tickets that met the Resolution SLA. Null
     * where the person resolved nothing carrying a readable SLA field — read
     * `PerformanceData.slaCoverage` before treating this as a team figure.
     */
    compliancePct: number | null;
  };
  /**
   * Fenced deliberately. See note 2 at the top of this file: these are the
   * headline productivity indicators, admissible against a specific claim and
   * never as a performance judgement on their own.
   */
  verificationOnly: {
    solvedToday: number | null;
    solvedWeek: number | null;
    /**
     * solvedToday / 7.5h, and null when the person was not flagged available for
     * assignment at capture time — a part day divided by a full one.
     */
    ticketsPerHour: number | null;
  };
}

export interface PerformanceData {
  /**
   * The frozen day these figures describe, and how old it is. A capture that has
   * not run since Friday must be readable as Friday's numbers, not as today's.
   */
  asOf: { day: string | null; capturedAt: string | null; ageDays: number | null };
  people: PersonPerformance[];
  /**
   * Roster members with no row in the capture — the population the coverage
   * figures below are missing.
   */
  notCaptured: number;
  /**
   * What `sla.compliancePct` actually rests on, carried rather than smoothed.
   *
   * The denominator is not "tickets resolved" — it is tickets resolved that day
   * whose cached `fields_json` carries a parseable Resolution SLA (cf14048), and
   * that has historically been around 57% of them. A person can therefore show
   * 100% off two tickets while having resolved nine. The figure is real and the
   * hole in it is real; both cross.
   */
  slaCoverage: {
    withValue: number;
    ofPeople: number;
    basis: string;
  };
  /**
   * Fields present in the stored row and deliberately NOT sent, so a reader who
   * knows the table does not think they went missing.
   */
  withheld: Array<{ field: string; reason: string }>;
}

export interface StandupData {
  /**
   * Session ROWS in the window. Not the same as standups held, and not the
   * denominator: `ensureSession()` creates a row whenever anything touches a
   * date — a brief refresh, a Plaud lookup — and nothing in the codebase ever
   * moves `status` off 'pending', so a row proves a date was considered, not
   * that a standup ran.
   */
  sessionsInWindow: number;
  /**
   * Sessions with at least one submission — the only evidence available that a
   * standup actually happened, and therefore the denominator `missed` is counted
   * against. Charging someone with a missed standup on a row a background job
   * created is exactly the manufactured finding this endpoint must not produce.
   */
  sessionsEvidenced: number;
  perPerson: Array<{
    accountId: string;
    name: string;
    submitted: number;
    /**
     * sessionsEvidenced - submitted. Null when nothing was evidenced, because
     * "missed 0 of 0" is not a fact about the person.
     */
    missed: number | null;
    lastSubmittedAt: string | null;
  }>;
  /**
   * Submitters whose name matched nobody on the roster. `agent_name` is free
   * text; an unmatched row is a person the coverage figure is silently missing,
   * so it is named rather than absorbed.
   */
  unmatchedSubmitters: Array<{ name: string; submissions: number }>;
}

export interface EscalationData {
  scope: { ticketPrefix: string };
  perPerson: Array<{
    accountId: string;
    name: string;
    /** Tier moves attributed to this person that were not rejections. */
    raised: number;
    /**
     * Moves the classifier could evidence as a formal rejection — work sent back
     * down a tier through the rejection screen.
     */
    rejections: number;
    total: number;
  }>;
  /**
   * Attribution caveat, carried with the numbers because it changes what they
   * mean. Rows written by the Jira sync are stamped with the ticket's CURRENT
   * ASSIGNEE at sync time, not with whoever performed the transition. For a
   * ticket that has not moved hands since, those are the same person; for one
   * that has, they are not. Manual and AI escalations carry a true actor.
   */
  attributionCaveat: string;
  unmatchedActors: Array<{ name: string; events: number }>;
}

export interface PeopleSignals {
  /** Which build of this service answered. See PEOPLE_SIGNALS_BUILD. */
  build: string;
  /**
   * Window for the signals that span days — standups and escalations. The
   * performance figures are a single frozen day and carry their own `asOf`.
   */
  window: { days: number; from: string };
  roster: Signal<RosterData>;
  performance: Signal<PerformanceData>;
  standups: Signal<StandupData>;
  escalations: Signal<EscalationData>;
  unavailable: Array<{ name: string; error: string | null }>;
}

/**
 * Live roster from the KPI database. Live rather than frozen so the population is
 * current even when the capture is stale — and so a disagreement between the two
 * is visible instead of averaged away.
 */
async function fetchRoster(settings: SettingsQueries): Promise<RosterPerson[]> {
  const pool = await getKpiPool(settings);
  // Department is a later-added column; guard it the way compute.ts does, or an
  // older schema fails the whole signal instead of returning a wider roster.
  const hasDept = (await pool.request().query(
    `SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent') AND name = 'Department'`,
  )).recordset.length > 0;
  // Interpolated, not parameterised: DEPARTMENTS is a module constant of
  // identifiers, never caller input. Nothing on this route can reach it.
  const deptFilter = hasDept
    ? `AND Department IN (${DEPARTMENTS.map(d => `'${d}'`).join(', ')})`
    : '';
  const rows = (await pool.request().query(`
    SELECT AgentId, AccountId,
           RTRIM(LTRIM(ISNULL(AgentName,'') + ' ' + ISNULL(AgentSurname,''))) AS AgentName,
           ISNULL(TierCode,'') AS TierCode, ISNULL(Team,'') AS Team, ISNULL(IsAvailable,0) AS IsAvailable
    FROM dbo.Agent WHERE IsActive = 1 AND AccountId IS NOT NULL ${deptFilter}
    ORDER BY AgentName
  `)).recordset as Array<{
    AgentId: number; AccountId: string; AgentName: string;
    TierCode: string; Team: string; IsAvailable: number;
  }>;

  return rows.map(r => ({
    accountId: r.AccountId,
    agentId: r.AgentId ?? null,
    name: r.AgentName,
    tierCode: str(r.TierCode),
    team: str(r.Team),
    availableForAssignment: !!r.IsAvailable,
  }));
}

type FrozenRow = AgentKpiRow & { date: string; capturedAt: string };

/**
 * The frozen capture for a day — the requested one, or the most recent that
 * exists. Asking for "today" before the 18:00 freeze returns nothing, which would
 * render as a team with no KPIs rather than as a capture that has not run yet.
 *
 * Deliberately NOT `kpi-agent/store.ts`'s `getLatestDay()` / `getDay()`, which
 * are the obvious reuse and the wrong one: both call `ensureAgentTable()` first,
 * and that runs `sp_rename` and `CREATE TABLE`. Those are correct for the engine
 * that owns the table and unacceptable on a bridge endpoint whose entire
 * guarantee is that it cannot write. Idempotent DDL is still DDL.
 *
 * The cost of not reusing them is this SELECT and the parse below. If the table
 * is missing the query fails, the signal reports it, and nothing gets created —
 * which is the behaviour we want from a reader.
 */
async function fetchFrozen(day?: string): Promise<FrozenRow[]> {
  const rows = day
    ? await query<{ metrics_json: string; kpi_date: string; captured_at: string }>(
      `SELECT CONVERT(varchar(10), kpi_date, 23) AS kpi_date, metrics_json,
              CONVERT(varchar(33), captured_at, 126) AS captured_at
         FROM kpi_agent_daily WHERE kpi_date = ?`,
      [day],
    )
    : await query<{ metrics_json: string; kpi_date: string; captured_at: string }>(
      `WITH d AS (SELECT MAX(kpi_date) AS mx FROM kpi_agent_daily)
       SELECT CONVERT(varchar(10), kpi_date, 23) AS kpi_date, metrics_json,
              CONVERT(varchar(33), captured_at, 126) AS captured_at
         FROM kpi_agent_daily WHERE kpi_date = (SELECT mx FROM d)`,
    );

  const out: FrozenRow[] = [];
  for (const r of rows) {
    // A corrupt row is skipped rather than failing the day — but it then shows
    // up as someone with `state: 'no-capture'`, which is honest: we did not read
    // a measurement for them.
    try {
      out.push({ ...(JSON.parse(r.metrics_json) as AgentKpiRow), date: r.kpi_date, capturedAt: r.captured_at });
    } catch { /* skip */ }
  }
  return out;
}

function toPerformance(person: RosterPerson, row: FrozenRow | undefined): PersonPerformance {
  // Loosened deliberately: the row is JSON off disk, so its declared type is a
  // claim about the build that wrote it, not about this one.
  const r = (row ?? {}) as unknown as Record<string, unknown>;
  return {
    accountId: person.accountId,
    agentId: person.agentId,
    name: person.name,
    tierCode: person.tierCode,
    team: person.team,
    state: row ? 'measured' : 'no-capture',
    workload: {
      open: num(r.open),
      overSla: num(r.overSla),
      noReply: num(r.noReply),
      oldestDays: num(r.oldestDays),
      oldestKey: str(r.oldestKey),
      oldestSupportDays: num(r.oldestSupportDays),
      oldestSupportKey: str(r.oldestSupportKey),
    },
    quality: {
      qaScored: num(r.qaScored),
      qaOverall: num(r.qaOverall),
      qaAccuracy: num(r.qaAccuracy),
      qaClarity: num(r.qaClarity),
      qaTone: num(r.qaTone),
      qaGreen: num(r.qaGreen),
      qaAmber: num(r.qaAmber),
      qaRed: num(r.qaRed),
      qaConcerning: num(r.qaConcerning),
      grScored: num(r.grScored),
      grOverall: num(r.grOverall),
      grOwnership: num(r.grOwnership),
      grNextAction: num(r.grNextAction),
      grTimeframe: num(r.grTimeframe),
    },
    sla: { compliancePct: num(r.slaCompliancePct) },
    verificationOnly: {
      solvedToday: num(r.solvedToday),
      solvedWeek: num(r.solvedWeek),
      ticketsPerHour: num(r.ticketsPerHour),
    },
  };
}

const WITHHELD: PerformanceData['withheld'] = [
  {
    field: 'rag',
    reason: 'Stored rating, computed by whichever thresholds were in force at the freeze. '
      + 'The scores cross instead, so the judgement is made once and by current rules.',
  },
  {
    field: 'csatAvg / csatCount',
    reason: 'Per-agent CSAT is non-zero on around 2% of resolved rows. A mean over that '
      + 'sample describes the two customers who responded, not the agent.',
  },
  {
    field: 'qaScored7d / qaOverall7d / grScored7d / grOverall7d',
    reason: 'The rolling-7-day fields the RAG is rated on. Withheld until a capture has run '
      + 'on the deployed build — older frozen rows do not carry them, and a field that is '
      + 'absent on some days and present on others is worse than one absent on all.',
  },
];

/** Standup submission coverage, per person, against the sessions actually held. */
async function standups(days: number, roster: RosterPerson[]): Promise<StandupData> {
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  // `standup_sessions.date` is NVARCHAR(10) holding YYYY-MM-DD, so a string
  // comparison is the right one — CAST-ing it to DATE here would make the
  // predicate non-sargable for no gain.
  const sessions = await query<{ session_rows: number; evidenced: number }>(
    // Joined to a DISTINCT derived table rather than SUM(CASE WHEN EXISTS ...):
    // SQL Server rejects an aggregate over an expression containing a subquery
    // outright ("Cannot perform an aggregate function on an expression
    // containing an aggregate or a subquery"). COUNT of the joined column counts
    // non-null matches, which is the same fact and legal.
    `SELECT COUNT(*) AS session_rows, COUNT(sub.session_id) AS evidenced
       FROM standup_sessions s
       LEFT JOIN (SELECT DISTINCT session_id FROM standup_submissions) sub
              ON sub.session_id = s.id
      WHERE s.[date] >= ?`,
    [from],
  );
  const sessionsInWindow = sessions[0]?.session_rows ?? 0;
  const sessionsEvidenced = sessions[0]?.evidenced ?? 0;

  const subs = await query<{ agent_name: string; submissions: number; last_at: string | null }>(
    `SELECT sub.agent_name,
            COUNT(*) AS submissions,
            CONVERT(varchar(33), MAX(sub.submitted_at), 126) AS last_at
       FROM standup_submissions sub
       JOIN standup_sessions s ON s.id = sub.session_id
      WHERE s.[date] >= ?
      GROUP BY sub.agent_name`,
    [from],
  );

  const byName = new Map(subs.map(s => [nameKey(s.agent_name), s]));
  const matched = new Set<string>();

  const perPerson = roster.map(p => {
    const hit = byName.get(nameKey(p.name));
    if (hit) matched.add(nameKey(p.name));
    const submitted = hit?.submissions ?? 0;
    return {
      accountId: p.accountId,
      name: p.name,
      submitted,
      // "Missed 0 of 0" is not a fact about the person, it is a fact about the
      // standup not having run. Null rather than a flattering zero.
      missed: sessionsEvidenced > 0 ? Math.max(sessionsEvidenced - submitted, 0) : null,
      lastSubmittedAt: hit?.last_at ?? null,
    };
  });

  return {
    sessionsInWindow,
    sessionsEvidenced,
    perPerson,
    unmatchedSubmitters: subs
      .filter(s => !matched.has(nameKey(s.agent_name)))
      .map(s => ({ name: s.agent_name, submissions: s.submissions }))
      .sort((a, b) => b.submissions - a.submissions),
  };
}

/** Escalation events attributed to each person over the window. */
async function escalations(days: number, roster: RosterPerson[]): Promise<EscalationData> {
  const rows = await query<{ actor: string | null; escalation_type: string; count: number }>(
    `SELECT escalated_by AS actor, escalation_type, COUNT(*) AS count
       FROM escalation_log
      WHERE created_at >= DATEADD(day, ?, GETUTCDATE())
        AND ticket_key LIKE ?
        AND escalated_by IS NOT NULL
      GROUP BY escalated_by, escalation_type`,
    [-days, TICKET_PREFIX],
  );

  const byName = new Map<string, { raised: number; rejections: number }>();
  for (const r of rows) {
    const key = nameKey(r.actor);
    if (!key) continue;
    const acc = byName.get(key) ?? { raised: 0, rejections: 0 };
    if (r.escalation_type === 'rejection') acc.rejections += r.count;
    else acc.raised += r.count;
    byName.set(key, acc);
  }

  const matched = new Set<string>();
  const perPerson = roster.map(p => {
    const key = nameKey(p.name);
    const hit = byName.get(key);
    if (hit) matched.add(key);
    const raised = hit?.raised ?? 0;
    const rejections = hit?.rejections ?? 0;
    return { accountId: p.accountId, name: p.name, raised, rejections, total: raised + rejections };
  });

  const unmatchedActors = [...byName.entries()]
    .filter(([key]) => !matched.has(key))
    .map(([key, v]) => ({ name: key, events: v.raised + v.rejections }))
    .sort((a, b) => b.events - a.events);

  return {
    scope: { ticketPrefix: TICKET_PREFIX },
    perPerson,
    attributionCaveat:
      'Rows written by the Jira sync are stamped with the ticket assignee at sync time, not '
      + 'with whoever performed the transition. Treat per-person totals as indicative; manual '
      + 'and AI-agent escalations carry a true actor.',
    unmatchedActors,
  };
}

/**
 * Who the capture measured that the live roster does not know about.
 *
 * The roster signal does not fail on this: a disagreement note is worth having
 * and not worth losing the population for. But an unreadable capture returns
 * null — "not checked" — never an empty array, which would read as "checked, and
 * they agree".
 */
function measuredButNotOnRoster(
  people: RosterPerson[], frozen: FrozenRow[] | null,
): RosterData['measuredButNotOnRoster'] {
  if (!frozen) return null;
  const known = new Set(people.map(p => p.accountId));
  return frozen
    .filter(r => !known.has(r.accountId))
    .map(r => ({ accountId: r.accountId, name: str(r.agentName) }));
}

/**
 * The whole per-person picture in one pass.
 *
 * SEQUENTIAL, deliberately — the same lesson `flow-signals` learned the expensive
 * way. This runs against a DTU-limited Azure SQL instance that is also serving
 * the live service desk, and NEURO caches the result, so wall-clock does not
 * matter and load does. Four concurrent aggregates that starve each other produce
 * four absent sections; four slow ones produce a report.
 *
 * @param days window for the day-spanning signals (standups, escalations).
 * @param day  a specific frozen capture day, or the most recent one.
 */
export async function getPeopleSignals(
  settings: SettingsQueries,
  days = 30,
  day?: string,
): Promise<PeopleSignals> {
  const window = Math.min(Math.max(days, 1), 365);

  // The roster is the spine: performance, standups and escalations are all
  // reported PER ROSTER MEMBER, so without it there is no population to report
  // against and every coverage figure would be a count with no denominator. It
  // runs first and alone, and the three signals that depend on it fail honestly
  // rather than inventing an empty team.
  const rosterPeople = await signal(() => fetchRoster(settings));
  const people = rosterPeople.data ?? [];
  const NO_ROSTER = 'Roster unavailable — no population to report against';

  // Read ONCE. Both the roster's disagreement note and every performance figure
  // come out of the same capture, and issuing the query twice would double the
  // load on a box that is also serving the live service desk for no new fact.
  const frozenSignal = await signal(() => fetchFrozen(day));

  const roster: Signal<RosterData> = rosterPeople.ok
    ? {
      ok: true,
      error: null,
      data: {
        scope: { departments: DEPARTMENTS, activeOnly: true },
        people,
        measuredButNotOnRoster: measuredButNotOnRoster(people, frozenSignal.data),
      },
    }
    : { ok: false, error: rosterPeople.error, data: null };

  const performance = await signal<PerformanceData>(async () => {
    if (!rosterPeople.ok) throw new Error(NO_ROSTER);
    // The capture failing is its own error, reported as itself rather than
    // collapsing into a team of people who all happen to have no data.
    if (!frozenSignal.ok || !frozenSignal.data) {
      throw new Error(frozenSignal.error ?? 'Capture unavailable');
    }
    const frozen = frozenSignal.data;
    const byAccount = new Map(frozen.map(r => [r.accountId, r]));
    const rows = people.map(p => toPerformance(p, byAccount.get(p.accountId)));
    const asOfDay = frozen[0]?.date ?? null;
    return {
      asOf: {
        day: asOfDay,
        capturedAt: frozen[0]?.capturedAt ?? null,
        ageDays: asOfDay
          ? Math.round((Date.now() - Date.parse(`${asOfDay}T00:00:00Z`)) / 86_400_000)
          : null,
      },
      people: rows,
      notCaptured: rows.filter(r => r.state === 'no-capture').length,
      slaCoverage: {
        withValue: rows.filter(r => r.sla.compliancePct !== null).length,
        ofPeople: rows.length,
        basis: 'Denominator is tickets the person resolved on the captured day whose cached '
          + 'fields_json carries a parseable Resolution SLA (cf14048) — historically around '
          + '57% of resolved tickets, not all of them. A person can show 100% off two tickets '
          + 'while having resolved nine.',
      },
      withheld: WITHHELD,
    };
  });

  const standupSignal = await signal<StandupData>(async () => {
    if (!rosterPeople.ok) throw new Error(NO_ROSTER);
    return standups(window, people);
  });

  const escalationSignal = await signal<EscalationData>(async () => {
    if (!rosterPeople.ok) throw new Error(NO_ROSTER);
    return escalations(window, people);
  });

  const named: Array<[string, Signal<unknown>]> = [
    ['roster', roster], ['performance', performance],
    ['standups', standupSignal], ['escalations', escalationSignal],
  ];

  return {
    build: PEOPLE_SIGNALS_BUILD,
    window: {
      days: window,
      from: new Date(Date.now() - window * 86_400_000).toISOString().slice(0, 10),
    },
    roster,
    performance,
    standups: standupSignal,
    escalations: escalationSignal,
    // Named so a downstream renderer can list what did not answer without
    // knowing the shape of each signal.
    unavailable: named.filter(([, v]) => !v.ok).map(([name, v]) => ({ name, error: v.error })),
  };
}
