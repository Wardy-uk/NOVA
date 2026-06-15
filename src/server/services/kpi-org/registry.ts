// Organisational KPI registry — Layer 1 of the KPI rebuild.
// This file encodes the agreed BA spec (agent_work/ba/org-kpis-spec.md) as
// executable definitions. Each KPI declares how it is computed, its target,
// direction, rollup and RAG bands. Compute logic lives in nt-compute.ts.
//
// Source of truth: agent_work/ba/org-kpis-spec.md (Support / NT, 22 KPIs).

export type RollupRule = 'sum' | 'latest' | 'average' | 'min' | 'max';
export type Direction = 'higher-better' | 'lower-better' | 'informational';
export type KpiUnit = 'count' | 'percent' | 'currency' | 'days' | 'minutes';
export type KpiSource = 'jira' | 'manual' | 'escalation_log';

/** RAG bands. For lower-better: green ≤ greenMax, amber ≤ amberMax, else red.
 *  For higher-better: green ≥ greenMin, amber ≥ amberMin, else red. */
export interface RagBands {
  greenMax?: number;
  amberMax?: number;
  greenMin?: number;
  amberMin?: number;
}

/** Date context for a single capture day (UK local calendar day). */
export interface DayCtx {
  /** YYYY-MM-DD — the capture day. */
  day: string;
  /** YYYY-MM-DD — the day after (exclusive upper bound for JQL ranges). */
  nextDay: string;
}

export type ComputeSpec =
  // Count of issues matching a JQL query (uses jira.jqlCount).
  | { kind: 'jql_count'; jql: (ctx: DayCtx) => string }
  // Open bucket tickets, apply the isNoReply predicate in code.
  | { kind: 'no_reply'; bucketJql: string }
  // Oldest ACTIONABLE ticket in the bucket → age in whole days.
  | { kind: 'oldest_actionable'; bucketJql: string }
  // Distinct NT tickets in escalation_log for the day (rejection flag splits #13/#14).
  | { kind: 'escalation_log'; rejection: boolean }
  // escalation_log rows for the day filtered by from/to tier (escalated-to / rejected-by).
  | { kind: 'escalation_tier'; fromTiers?: string[]; toTiers: string[] }
  // Outcome derived from tickets solved during the day: SLA compliance % / CSAT.
  | { kind: 'resolved_outcome'; metric: 'frt' | 'res' | 'csat' }
  // First Contact Resolution % — comment scan over CC tickets solved today.
  | { kind: 'fcr' }
  // AI agent throughput from the local approval_queue table.
  | { kind: 'ai_metric'; metric: 'resolved' | 'pending' | 'rate' }
  // 1st-line resolution %: solved-today at Customer Care tier / all solved today.
  | { kind: 'first_line_rate' }
  // Bug escalation-to-ack hours: avg created→first-agent-comment over bug/dev tickets solved today.
  | { kind: 'bug_ack' }
  // WTD meta: % of captured kpi_org_daily rows this week that are green / red.
  | { kind: 'wtd_rag'; rag: 'green' | 'red' }
  // Per-tier SLA outcome over tickets solved during the day: FRT/Resolution Met /
  // Breached counts and Compliance %. tier='' means all tiers.
  | { kind: 'resolved_sla'; metric: 'frt' | 'res'; stat: 'met' | 'breached' | 'compliance'; tier: string }
  // Escalation accuracy % from escalation_log: (escalations - rejections) / escalations.
  | { kind: 'escalation_accuracy'; allTime: boolean }
  // Entered by a human; capture preserves the existing manual value.
  | { kind: 'manual' };

export interface OrgKpi {
  key: string;
  label: string;            // matches the spreadsheet KPI name
  team: string;             // top-level "Team Responsible"
  colA: string;             // spreadsheet column-A sub-context
  jiraSpace: string | null; // 'NT' for Support, null for manual teams
  unit: KpiUnit;
  direction: Direction;
  dailyTarget: number | null;
  monthlyTarget: number | null;
  rollup: RollupRule;
  rag: RagBands;
  compute: ComputeSpec;
  /** Provisional flags / build TODOs carried from the BA spec. */
  note?: string;
}

// ── Canonical NT JQL fragments (agreed in BA) ──

/** "Open / still on the board" — whole Done category plus named statuses (belt & braces). */
export const NT_OPEN = `project = NT AND statusCategory != Done AND status NOT IN (Closed, Resolved)`;

/** Canonical request-type field = JSM customer request type (customfield_12800), values suffixed "(NT)". */
const RT = 'cf[12800]';
const TIER = 'cf[12981]';

/** #4 Incident bucket: tier {Customer Care, Tier 2} + incident-class request types (incl. untriaged). */
export const INCIDENT_BUCKET =
  `${TIER} in ("Customer Care", "Tier 2") ` +
  `AND (${RT} in ("Incident (NT)", "Chat (NT)", "Emailed request (NT)", "AI Request (NT)", "TPJ Request (NT)", "GDPR (NT)") OR ${RT} is EMPTY)`;

/** #5 Production bucket: tier {Customer Care, Tier 2, Production} + production-class request types. */
export const PRODUCTION_BUCKET =
  `${TIER} in ("Customer Care", "Tier 2", "Production") ` +
  `AND ${RT} in ("Onboarding (NT)", "Delivery QA (NT)", "Service Request (NT)")`;

/** #6 Development bucket: tier {Tier 3, Development}. */
export const DEVELOPMENT_BUCKET = `${TIER} in ("Tier 3", "Development")`;

/** Statuses where the ticket is NOT actionable (clock on an external party). */
export const NOT_ACTIONABLE_STATUSES = ['Waiting On Requestor', 'Waiting On Partner', 'Waiting on Development'];
const NOT_ACTIONABLE_JQL = `status in ("Waiting On Requestor", "Waiting On Partner", "Waiting on Development")`;
const ACTIONABLE_JQL = `status not in ("Waiting On Requestor", "Waiting On Partner", "Waiting on Development")`;

/** Resolution SLA = cf14048 ("Resolution") and FRT = cf14046 ("First Reply Time").
 *  These are the SLA fields the legacy pipeline used. Their display names collide
 *  with system fields in JQL ("Resolution" resolves to the resolution field, not the
 *  SLA), so they MUST be queried by cf id. (The display names "Time to resolution"/
 *  "Time to first response" are DIFFERENT, unused SLA fields — cf12805/cf12806 —
 *  that return 0 breaches; using them silently zeroed the whole over-SLA group.) */
export const RESOLUTION_SLA_NAME = 'Resolution';
export const RES_BREACHED = `cf[14048] = breached()`;
export const FRT_BREACHED = `cf[14046] = breached()`;

/** Legacy due-date gate for over-SLA (ACTIONABLE only): count only tickets whose
 *  due date has passed (or have none). Matches the SLA Breach Board / n8n report. */
export const DUE_GATE = `(duedate is EMPTY OR duedate <= endOfDay())`;

/** NOVA-Jira service account — splits Solved by Team vs NOVA. */
export const NOVA_JIRA_ACCOUNT_ID = '712020:67acd53f-75f0-4548-adfe-91bba72ad38f';

const SOLVED_TRANSITION = `status CHANGED TO ("Resolved", "Closed", "Done")`;

// ── Support (NT) — 22 KPIs ──

export const SUPPORT_NT_KPIS: OrgKpi[] = [
  {
    key: 'nt_new_tickets', label: 'New Tickets', team: 'Support', colA: 'Support', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 110, monthlyTarget: null, rollup: 'sum',
    rag: { greenMax: 110, amberMax: 120 },  // ≤110 green, 111–120 amber, >120 red
    compute: { kind: 'jql_count', jql: c => `project = NT AND created >= "${c.day}" AND created < "${c.nextDay}"` },
  },
  {
    key: 'nt_solved_team', label: 'Solved by Team', team: 'Support', colA: 'Support', jiraSpace: 'NT',
    unit: 'count', direction: 'higher-better', dailyTarget: 120, monthlyTarget: null, rollup: 'sum',
    rag: { greenMin: 120, amberMin: 100 },
    compute: { kind: 'jql_count', jql: c =>
      `project = NT AND statusCategory = Done AND ${SOLVED_TRANSITION} DURING ("${c.day}", "${c.nextDay}") ` +
      `AND assignee != "${NOVA_JIRA_ACCOUNT_ID}"` },
    note: 'Team = everything not solved by NOVA (incl. unassigned). assignee != NOVA covers unassigned in JQL.',
  },
  {
    key: 'nt_solved_nova', label: 'Solved by NOVA', team: 'Support', colA: 'Support', jiraSpace: 'NT',
    unit: 'count', direction: 'higher-better', dailyTarget: 15, monthlyTarget: null, rollup: 'sum',
    rag: { greenMin: 15, amberMin: 8 },
    compute: { kind: 'jql_count', jql: c =>
      `project = NT AND statusCategory = Done AND ${SOLVED_TRANSITION} DURING ("${c.day}", "${c.nextDay}") ` +
      `AND assignee = "${NOVA_JIRA_ACCOUNT_ID}"` },
    note: 'Target 15 predates NOVA throughput (~61/day observed) — re-baseline.',
  },
  {
    key: 'nt_incidents', label: 'Number of Incidents Tickets', team: 'Support', colA: 'Support', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 75, monthlyTarget: null, rollup: 'latest',
    rag: { greenMax: 75, amberMax: 90 },
    compute: { kind: 'jql_count', jql: () => `${NT_OPEN} AND ${INCIDENT_BUCKET}` },
  },
  {
    key: 'nt_production', label: 'Number of Production Tickets', team: 'Support', colA: 'Support', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 75, monthlyTarget: null, rollup: 'latest',
    rag: { greenMax: 75, amberMax: 90 },
    compute: { kind: 'jql_count', jql: () => `${NT_OPEN} AND ${PRODUCTION_BUCKET}` },
  },
  {
    key: 'nt_development', label: 'Number of Tickets in Development', team: 'Support', colA: 'Development', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 150, monthlyTarget: null, rollup: 'latest',
    rag: { greenMax: 150, amberMax: 180 },
    compute: { kind: 'jql_count', jql: () => `${NT_OPEN} AND ${DEVELOPMENT_BUCKET}` },
  },
  {
    key: 'nt_incidents_no_reply', label: 'Number of Incidents Tickets With No Reply', team: 'Support', colA: 'Support', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 0, monthlyTarget: null, rollup: 'latest',
    rag: { greenMax: 0, amberMax: 5 },
    compute: { kind: 'no_reply', bucketJql: `${NT_OPEN} AND ${INCIDENT_BUCKET}` },
  },
  {
    key: 'nt_production_no_reply', label: 'Number of Production Tickets With No Reply', team: 'Support', colA: 'Support', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 0, monthlyTarget: null, rollup: 'latest',
    rag: { greenMax: 0, amberMax: 5 },
    compute: { kind: 'no_reply', bucketJql: `${NT_OPEN} AND ${PRODUCTION_BUCKET}` },
  },
  {
    key: 'nt_incidents_sla_actionable', label: 'Number of Incident tickets over SLA (actionable)', team: 'Support', colA: 'Support', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 0, monthlyTarget: null, rollup: 'latest',
    rag: { greenMax: 0, amberMax: 5 },
    compute: { kind: 'jql_count', jql: () => `${NT_OPEN} AND ${INCIDENT_BUCKET} AND ${RES_BREACHED} AND ${ACTIONABLE_JQL} AND ${DUE_GATE}` },
  },
  {
    key: 'nt_production_sla_actionable', label: 'Number of Production tickets over SLA (actionable)', team: 'Support', colA: 'Support', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 0, monthlyTarget: null, rollup: 'latest',
    rag: { greenMax: 0, amberMax: 5 },
    compute: { kind: 'jql_count', jql: () => `${NT_OPEN} AND ${PRODUCTION_BUCKET} AND ${RES_BREACHED} AND ${ACTIONABLE_JQL} AND ${DUE_GATE}` },
  },
  {
    key: 'nt_incidents_sla_not_actionable', label: 'Number of Incident tickets over SLA (Not actionable)', team: 'Support', colA: 'Support', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 20, monthlyTarget: null, rollup: 'latest',
    rag: { greenMax: 20, amberMax: 30 },
    compute: { kind: 'jql_count', jql: () => `${NT_OPEN} AND ${INCIDENT_BUCKET} AND ${RES_BREACHED} AND ${NOT_ACTIONABLE_JQL}` },
  },
  {
    key: 'nt_production_sla_not_actionable', label: 'Number of Production tickets over SLA (Not actionable)', team: 'Support', colA: 'Support', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 20, monthlyTarget: null, rollup: 'latest',
    rag: { greenMax: 20, amberMax: 30 },
    compute: { kind: 'jql_count', jql: () => `${NT_OPEN} AND ${PRODUCTION_BUCKET} AND ${RES_BREACHED} AND ${NOT_ACTIONABLE_JQL}` },
  },
  {
    key: 'nt_escalated', label: 'Tickets escalated', team: 'Support', colA: 'Support', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 20, monthlyTarget: null, rollup: 'sum',
    rag: { greenMax: 20, amberMax: 30 },
    compute: { kind: 'escalation_log', rejection: false },
  },
  {
    key: 'nt_rejected', label: 'Tickets rejected', team: 'Support', colA: 'Support', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 10, monthlyTarget: null, rollup: 'sum',
    rag: { greenMax: 10, amberMax: 15 },
    compute: { kind: 'escalation_log', rejection: true },
  },
  {
    key: 'nt_oldest_incident', label: 'Oldest actionable Incident ticket', team: 'Support', colA: 'Support', jiraSpace: 'NT',
    unit: 'days', direction: 'lower-better', dailyTarget: 5, monthlyTarget: null, rollup: 'latest',
    rag: { greenMax: 5, amberMax: 10 },
    compute: { kind: 'oldest_actionable', bucketJql: `${NT_OPEN} AND ${INCIDENT_BUCKET}` },
  },
  {
    key: 'nt_oldest_production', label: 'Oldest actionable Production ticket', team: 'Support', colA: 'Support', jiraSpace: 'NT',
    unit: 'days', direction: 'lower-better', dailyTarget: 15, monthlyTarget: null, rollup: 'latest',
    rag: { greenMax: 15, amberMax: 25 },
    compute: { kind: 'oldest_actionable', bucketJql: `${NT_OPEN} AND ${PRODUCTION_BUCKET}` },
  },
  {
    key: 'nt_oldest_development', label: 'Oldest actionable Development ticket', team: 'Support', colA: 'Development', jiraSpace: 'NT',
    unit: 'days', direction: 'lower-better', dailyTarget: 60, monthlyTarget: null, rollup: 'latest',
    rag: { greenMax: 60, amberMax: 90 },
    compute: { kind: 'oldest_actionable', bucketJql: `${NT_OPEN} AND ${DEVELOPMENT_BUCKET}` },
  },
  {
    key: 'nt_failed_jobs', label: 'Failed Jobs remaining on Board', team: 'Support', colA: 'Support', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 100, monthlyTarget: null, rollup: 'latest',
    rag: { greenMax: 100, amberMax: 150 },
    compute: { kind: 'manual' },
    note: 'Manual for now. Source = SQL query feeding a Grafana board; automate later.',
  },
  {
    key: 'nt_ci_in_progress', label: 'No. of CI In Progress (unmitigated)', team: 'Support', colA: 'Support', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 0, monthlyTarget: null, rollup: 'latest',
    rag: { greenMax: 0, amberMax: 1 },
    compute: { kind: 'manual' },
    note: 'Manual for now. Build Jira-based CI detection later.',
  },
  {
    key: 'nt_tpj_tickets', label: 'Number of TPJ Tickets', team: 'Support', colA: 'Support', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 50, monthlyTarget: null, rollup: 'latest',
    rag: { greenMax: 50, amberMax: 65 },
    compute: { kind: 'jql_count', jql: () =>
      `${NT_OPEN} AND ${RT} = "TPJ Request (NT)" AND ${TIER} in ("Customer Care", "Tier 2")` },
  },
  {
    key: 'nt_product_launch_incidents', label: 'Open Product Launch Incidents', team: 'Support', colA: 'Development', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 0, monthlyTarget: null, rollup: 'latest',
    rag: { greenMax: 0, amberMax: 1 },
    compute: { kind: 'jql_count', jql: () => `${NT_OPEN} AND ${RT} = "Product Launch Incident (NT)"` },
    note: '⚠ Confirm exact request-type value for Product Launch at build.',
  },
  {
    key: 'nt_tpj_dev_t3', label: 'Number of TPJ Tickets in Dev/T3', team: 'Support', colA: 'Development', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 75, monthlyTarget: null, rollup: 'latest',
    rag: { greenMax: 75, amberMax: 90 },
    compute: { kind: 'jql_count', jql: () =>
      `${NT_OPEN} AND ${RT} = "TPJ Request (NT)" AND ${TIER} in ("Tier 3", "Development")` },
  },

  // ── Outcome KPIs (derived from tickets solved during the day). Reproduce the
  // legacy "Resolved Today" formulas so the numbers match. ──
  {
    key: 'nt_frt_compliance', label: 'FRT Compliance %', team: 'Support', colA: 'SLA', jiraSpace: 'NT',
    unit: 'percent', direction: 'higher-better', dailyTarget: 90, monthlyTarget: null, rollup: 'average',
    rag: { greenMin: 90, amberMin: 72 },
    compute: { kind: 'resolved_outcome', metric: 'frt' },
  },
  {
    key: 'nt_res_compliance', label: 'Resolution Compliance %', team: 'Support', colA: 'SLA', jiraSpace: 'NT',
    unit: 'percent', direction: 'higher-better', dailyTarget: 90, monthlyTarget: null, rollup: 'average',
    rag: { greenMin: 90, amberMin: 72 },
    compute: { kind: 'resolved_outcome', metric: 'res' },
  },
  {
    key: 'nt_csat', label: 'CSAT %', team: 'Support', colA: 'Quality', jiraSpace: 'NT',
    unit: 'percent', direction: 'higher-better', dailyTarget: 80, monthlyTarget: null, rollup: 'average',
    rag: { greenMin: 80, amberMin: 64 },
    compute: { kind: 'resolved_outcome', metric: 'csat' },
  },
  {
    key: 'nt_fcr', label: 'FCR Rate %', team: 'Support', colA: 'Quality', jiraSpace: 'NT',
    unit: 'percent', direction: 'higher-better', dailyTarget: 65, monthlyTarget: null, rollup: 'average',
    rag: { greenMin: 65, amberMin: 35 },
    compute: { kind: 'fcr' },
  },

  // ── Legacy 7-tier shape (colA 'Legacy'). Open-ticket volumes split by CurrentTier
  // (cf12981), with Customer Care further split by request type — reproducing the
  // legacy jira_kpi_daily definitions so the "Legacy KPIs" view can read this engine
  // with the same numbers. amber band = target × 1.5 (legacy computeRag for counts). ──
  {
    key: 'nt_legacy_cc_incidents', label: 'Number of Tickets in CC (Incidents)', team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 40, monthlyTarget: null, rollup: 'latest', rag: { greenMax: 40, amberMax: 60 },
    compute: { kind: 'jql_count', jql: () => `${NT_OPEN} AND ${TIER} = "Customer Care" AND (${RT} not in ("Service Request (NT)", "TPJ Request (NT)") OR ${RT} is EMPTY)` },
  },
  {
    key: 'nt_legacy_cc_service_requests', label: 'Number of Tickets in CC (Service Requests)', team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 40, monthlyTarget: null, rollup: 'latest', rag: { greenMax: 40, amberMax: 60 },
    compute: { kind: 'jql_count', jql: () => `${NT_OPEN} AND ${TIER} = "Customer Care" AND ${RT} = "Service Request (NT)"` },
  },
  {
    key: 'nt_legacy_cc_tpj', label: 'Number of Tickets in CC (TPJ)', team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 40, monthlyTarget: null, rollup: 'latest', rag: { greenMax: 40, amberMax: 60 },
    compute: { kind: 'jql_count', jql: () => `${NT_OPEN} AND ${TIER} = "Customer Care" AND ${RT} = "TPJ Request (NT)"` },
  },
  {
    key: 'nt_legacy_production', label: 'Number of Tickets in Production', team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 40, monthlyTarget: null, rollup: 'latest', rag: { greenMax: 40, amberMax: 60 },
    compute: { kind: 'jql_count', jql: () => `${NT_OPEN} AND ${TIER} = "Production"` },
  },
  {
    key: 'nt_legacy_tier2', label: 'Number of Tickets in Tier 2', team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 20, monthlyTarget: null, rollup: 'latest', rag: { greenMax: 20, amberMax: 30 },
    compute: { kind: 'jql_count', jql: () => `${NT_OPEN} AND ${TIER} = "Tier 2"` },
  },
  {
    key: 'nt_legacy_tier3', label: 'Number of Tickets in Tier 3', team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 10, monthlyTarget: null, rollup: 'latest', rag: { greenMax: 10, amberMax: 15 },
    compute: { kind: 'jql_count', jql: () => `${NT_OPEN} AND ${TIER} = "Tier 3"` },
  },
  {
    key: 'nt_legacy_development', label: 'Number of Tickets in Development', team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 125, monthlyTarget: null, rollup: 'latest', rag: { greenMax: 125, amberMax: 188 },
    compute: { kind: 'jql_count', jql: () => `${NT_OPEN} AND ${TIER} = "Development"` },
  },
  {
    key: 'nt_legacy_solved_today', label: 'Tickets Solved Today', team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
    unit: 'count', direction: 'higher-better', dailyTarget: 85, monthlyTarget: null, rollup: 'sum', rag: { greenMin: 85, amberMin: 68 },
    compute: { kind: 'jql_count', jql: (ctx) => `project = NT AND statusCategory = Done AND ${SOLVED_TRANSITION} DURING ("${ctx.day}", "${ctx.nextDay}")` },
  },
  {
    key: 'nt_legacy_cc_total', label: 'Number of Tickets in Customer Care', team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 120, monthlyTarget: null, rollup: 'latest', rag: { greenMax: 120, amberMax: 180 },
    compute: { kind: 'jql_count', jql: () => `${NT_OPEN} AND ${TIER} = "Customer Care"` },
  },
  {
    key: 'nt_legacy_new_tickets', label: 'New Tickets Today', team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 110, monthlyTarget: null, rollup: 'sum', rag: { greenMax: 110, amberMax: 120 },
    compute: { kind: 'jql_count', jql: (ctx) => `project = NT AND created >= "${ctx.day}" AND created < "${ctx.nextDay}"` },
  },

  // ── Global queue-health stocks (the throughput group on the Operational Indicators
  // tab). These were NOVA-only in the legacy jira_kpi_daily (n8n never produced them);
  // computed here so the Rebuild reads them from this NOVA-only engine. Onboarding NOT
  // excluded (agreed 2026-06-15). SLA Breached uses cf14048 native breached(). ──
  {
    key: 'nt_legacy_open_tickets', label: 'Open Tickets', team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 30, monthlyTarget: null, rollup: 'latest', rag: { greenMax: 30, amberMax: 45 },
    compute: { kind: 'jql_count', jql: () => NT_OPEN },
  },
  {
    key: 'nt_legacy_unassigned', label: 'Unassigned', team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 0, monthlyTarget: null, rollup: 'latest', rag: { greenMax: 0, amberMax: 3 },
    compute: { kind: 'jql_count', jql: () => `${NT_OPEN} AND assignee is EMPTY` },
  },
  {
    key: 'nt_legacy_waiting_on_requestor', label: 'Waiting on Requestor', team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 10, monthlyTarget: null, rollup: 'latest', rag: { greenMax: 10, amberMax: 15 },
    compute: { kind: 'jql_count', jql: () => `${NT_OPEN} AND status = "Waiting On Requestor"` },
  },
  {
    key: 'nt_legacy_sla_breached', label: 'SLA Breached', team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 0, monthlyTarget: null, rollup: 'latest', rag: { greenMax: 0, amberMax: 5 },
    compute: { kind: 'jql_count', jql: () => `${NT_OPEN} AND ${RES_BREACHED}` },
  },

  // ── AI agent + derived + summary KPIs (were NOVA-only in legacy jira_kpi_daily;
  // n8n never produced them). Ported so the rebuild reaches full legacy parity. ──
  {
    key: 'nt_ai_resolved', label: 'AI Tickets Resolved (Today)', team: 'Support', colA: 'AI', jiraSpace: 'NT',
    unit: 'count', direction: 'higher-better', dailyTarget: 10, monthlyTarget: null, rollup: 'sum', rag: { greenMin: 10, amberMin: 5 },
    compute: { kind: 'ai_metric', metric: 'resolved' },
  },
  {
    key: 'nt_ai_pending', label: 'AI Tickets Pending Approval', team: 'Support', colA: 'AI', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 0, monthlyTarget: null, rollup: 'latest', rag: { greenMax: 0, amberMax: 5 },
    compute: { kind: 'ai_metric', metric: 'pending' },
  },
  {
    key: 'nt_ai_rate', label: 'AI Resolution Rate %', team: 'Support', colA: 'AI', jiraSpace: 'NT',
    unit: 'percent', direction: 'higher-better', dailyTarget: 50, monthlyTarget: null, rollup: 'average', rag: { greenMin: 50, amberMin: 25 },
    compute: { kind: 'ai_metric', metric: 'rate' },
  },
  {
    key: 'nt_first_line_rate', label: '1st Line Resolution Rate %', team: 'Support', colA: 'Derived', jiraSpace: 'NT',
    unit: 'percent', direction: 'higher-better', dailyTarget: 60, monthlyTarget: null, rollup: 'average', rag: { greenMin: 60, amberMin: 48 },
    compute: { kind: 'first_line_rate' },
  },
  {
    key: 'nt_bug_ack', label: 'Bug Escalation-to-Ack (hours)', team: 'Support', colA: 'Derived', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 4, monthlyTarget: null, rollup: 'average', rag: { greenMax: 4, amberMax: 6 },
    compute: { kind: 'bug_ack' },
  },
  {
    key: 'nt_wtd_green', label: "WTD percentage KPI's Green", team: 'Support', colA: 'Summary', jiraSpace: 'NT',
    unit: 'percent', direction: 'higher-better', dailyTarget: 80, monthlyTarget: null, rollup: 'latest', rag: { greenMin: 80, amberMin: 64 },
    compute: { kind: 'wtd_rag', rag: 'green' },
  },
  {
    key: 'nt_wtd_red', label: "WTD percentage KPI's Red", team: 'Support', colA: 'Summary', jiraSpace: 'NT',
    unit: 'percent', direction: 'lower-better', dailyTarget: 10, monthlyTarget: null, rollup: 'latest', rag: { greenMax: 10, amberMax: 15 },
    compute: { kind: 'wtd_rag', rag: 'red' },
  },

  // ── Escalations / rejections by destination tier (escalation_log, by from/to tier). ──
  {
    key: 'nt_legacy_esc_t2', label: 'Tickets escalated to Tier 2', team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 0, monthlyTarget: null, rollup: 'sum', rag: { greenMax: 0, amberMax: 5 },
    compute: { kind: 'escalation_tier', toTiers: ['T2', 'Tier 2'] },
  },
  {
    key: 'nt_legacy_esc_t3', label: 'Tickets escalated to Tier 3', team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 0, monthlyTarget: null, rollup: 'sum', rag: { greenMax: 0, amberMax: 5 },
    compute: { kind: 'escalation_tier', toTiers: ['T3', 'Tier 3'] },
  },
  {
    key: 'nt_legacy_esc_dev', label: 'Tickets escalated to Development', team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 0, monthlyTarget: null, rollup: 'sum', rag: { greenMax: 0, amberMax: 5 },
    compute: { kind: 'escalation_tier', toTiers: ['Dev', 'Development'] },
  },
  {
    key: 'nt_legacy_rej_t2', label: 'Tickets rejected by Tier 2', team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 0, monthlyTarget: null, rollup: 'sum', rag: { greenMax: 0, amberMax: 5 },
    compute: { kind: 'escalation_tier', fromTiers: ['T2', 'Tier 2'], toTiers: ['T1', 'Customer Care'] },
  },
  {
    key: 'nt_legacy_rej_t3', label: 'Tickets rejected by Tier 3', team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 0, monthlyTarget: null, rollup: 'sum', rag: { greenMax: 0, amberMax: 5 },
    compute: { kind: 'escalation_tier', fromTiers: ['T3', 'Tier 3'], toTiers: ['T2', 'Tier 2', 'T1', 'Customer Care'] },
  },
  {
    key: 'nt_legacy_rej_dev', label: 'Tickets rejected by Development', team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
    unit: 'count', direction: 'lower-better', dailyTarget: 0, monthlyTarget: null, rollup: 'sum', rag: { greenMax: 0, amberMax: 5 },
    compute: { kind: 'escalation_tier', fromTiers: ['Dev', 'Development'], toTiers: ['T3', 'Tier 3', 'T2', 'Tier 2'] },
  },
];

// ── Legacy per-tier hygiene matrix (no-reply / over-SLA actionable+not / oldest,
// for all 7 legacy tiers). Labels match the Legacy KPIs view's KPI_ORDER so it can
// read this engine. Generated to stay DRY. amber bands match legacy computeRag. ──
const LT = (tierJql: string) => `${NT_OPEN} AND ${tierJql}`;
const CC_TIER = `${TIER} = "Customer Care"`;
interface LegacyTierDef { bucket: string; noReply: string; overSla: string; notAct: string; oldest: string; oldestTarget: number; }
const LEGACY_TIERS: LegacyTierDef[] = [
  { bucket: `${LT(CC_TIER)} AND (${RT} not in ("Service Request (NT)", "TPJ Request (NT)") OR ${RT} is EMPTY)`,
    noReply: 'Number of Tickets With No Reply in CC (Incidents)', overSla: 'CC Incidents over SLA (actionable)',
    notAct: 'CC Incidents over SLA (not actionable)', oldest: 'Oldest actionable ticket (days) in CC Incidents', oldestTarget: 5 },
  { bucket: `${LT(CC_TIER)} AND ${RT} = "Service Request (NT)"`,
    noReply: 'Number of Tickets With No Reply in CC (Service Requests)', overSla: 'CC Service Requests over SLA (actionable)',
    notAct: 'CC Service Requests over SLA (not actionable)', oldest: 'Oldest actionable ticket (days) in CC Service Requests', oldestTarget: 5 },
  { bucket: `${LT(CC_TIER)} AND ${RT} = "TPJ Request (NT)"`,
    noReply: 'Number of Tickets With No Reply in CC (TPJ)', overSla: 'CC (TPJ) over SLA (actionable)',
    notAct: 'CC (TPJ) over SLA (not actionable)', oldest: 'Oldest actionable ticket (days) in CC (TPJ)', oldestTarget: 5 },
  { bucket: LT(`${TIER} = "Production"`),
    noReply: 'Number of Tickets With No Reply in Production', overSla: 'Production over SLA (actionable)',
    notAct: 'Production over SLA (not actionable)', oldest: 'Oldest actionable ticket (days) in Production', oldestTarget: 15 },
  { bucket: LT(`${TIER} = "Tier 2"`),
    noReply: 'Number of Tickets With No Reply in Tier 2', overSla: 'Tier 2 over SLA (actionable)',
    notAct: 'Tier 2 over SLA (not actionable)', oldest: 'Oldest actionable ticket (days) in Tier 2', oldestTarget: 5 },
  { bucket: LT(`${TIER} = "Tier 3"`),
    noReply: 'Number of Tickets With No Reply in Tier 3', overSla: 'Tier 3 over SLA (actionable)',
    notAct: 'Tier 3 over SLA (not actionable)', oldest: 'Oldest actionable ticket (days) in Tier 3', oldestTarget: 10 },
  { bucket: LT(`${TIER} = "Development"`),
    noReply: 'Number of Tickets With No Reply in Development', overSla: 'Development over SLA (actionable)',
    notAct: 'Development over SLA (not actionable)', oldest: 'Oldest actionable ticket (days) in Development', oldestTarget: 60 },
];
for (const t of LEGACY_TIERS) {
  const slug = t.overSla.replace(/[^a-z0-9]+/gi, '_').toLowerCase().replace(/_+$/, '');
  // FRT-breach labels mirror the over-SLA labels (e.g. "Tier 2 FRT breached (actionable)"),
  // matching the Operational Indicators tab's `${bare(tier)} FRT breached (...)` names.
  const frtAct = t.overSla.replace('over SLA', 'FRT breached');
  const frtNotAct = t.notAct.replace('over SLA', 'FRT breached');
  SUPPORT_NT_KPIS.push(
    { key: `nt_lg_noreply_${slug}`, label: t.noReply, team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
      unit: 'count', direction: 'lower-better', dailyTarget: 0, monthlyTarget: null, rollup: 'latest', rag: { greenMax: 0, amberMax: 5 },
      compute: { kind: 'no_reply', bucketJql: t.bucket } },
    { key: `nt_lg_oversla_${slug}`, label: t.overSla, team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
      unit: 'count', direction: 'lower-better', dailyTarget: 0, monthlyTarget: null, rollup: 'latest', rag: { greenMax: 0, amberMax: 5 },
      compute: { kind: 'jql_count', jql: () => `${t.bucket} AND ${RES_BREACHED} AND ${ACTIONABLE_JQL} AND ${DUE_GATE}` } },
    { key: `nt_lg_oversla_notact_${slug}`, label: t.notAct, team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
      unit: 'count', direction: 'lower-better', dailyTarget: 20, monthlyTarget: null, rollup: 'latest', rag: { greenMax: 20, amberMax: 30 },
      compute: { kind: 'jql_count', jql: () => `${t.bucket} AND ${RES_BREACHED} AND ${NOT_ACTIONABLE_JQL}` } },
    { key: `nt_lg_frt_${slug}`, label: frtAct, team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
      unit: 'count', direction: 'lower-better', dailyTarget: 0, monthlyTarget: null, rollup: 'latest', rag: { greenMax: 0, amberMax: 5 },
      compute: { kind: 'jql_count', jql: () => `${t.bucket} AND ${FRT_BREACHED} AND ${ACTIONABLE_JQL}` } },
    { key: `nt_lg_frt_notact_${slug}`, label: frtNotAct, team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
      unit: 'count', direction: 'lower-better', dailyTarget: 20, monthlyTarget: null, rollup: 'latest', rag: { greenMax: 20, amberMax: 30 },
      compute: { kind: 'jql_count', jql: () => `${t.bucket} AND ${FRT_BREACHED} AND ${NOT_ACTIONABLE_JQL}` } },
    { key: `nt_lg_oldest_${slug}`, label: t.oldest, team: 'Support', colA: 'Legacy', jiraSpace: 'NT',
      unit: 'days', direction: 'lower-better', dailyTarget: t.oldestTarget, monthlyTarget: null, rollup: 'latest', rag: { greenMax: t.oldestTarget, amberMax: t.oldestTarget * 2 },
      compute: { kind: 'oldest_actionable', bucketJql: t.bucket } },
  );
}

// ── Per-tier resolved-SLA outcome matrix (FRT/Resolution Met/Breached/Compliance),
// + escalation accuracy. Reproduces the n8n-only granular SLA KPIs for full parity.
// Computed over tickets solved during the day, split by CurrentTier (cf12981). ──
const SLA_TIERS: Array<[string, string]> = [
  ['', 'All'], ['Customer Care', 'Customer Care'], ['Production', 'Production'],
  ['Tier 2', 'Tier 2'], ['Tier 3', 'Tier 3'], ['Development', 'Development'],
];
for (const [metricKey, metricLabel] of [['frt', 'FRT'], ['res', 'Resolution']] as Array<['frt' | 'res', string]>) {
  for (const [tierVal, tierLabel] of SLA_TIERS) {
    const slug = `${metricKey}_${tierLabel.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;
    SUPPORT_NT_KPIS.push(
      { key: `nt_sla_${slug}_met`, label: `${metricLabel} Met (${tierLabel})`, team: 'Support', colA: 'SLA', jiraSpace: 'NT',
        unit: 'count', direction: 'higher-better', dailyTarget: 0, monthlyTarget: null, rollup: 'sum', rag: { greenMin: 0 },
        compute: { kind: 'resolved_sla', metric: metricKey, stat: 'met', tier: tierVal } },
      { key: `nt_sla_${slug}_breached`, label: `${metricLabel} Breached (${tierLabel})`, team: 'Support', colA: 'SLA', jiraSpace: 'NT',
        unit: 'count', direction: 'lower-better', dailyTarget: 0, monthlyTarget: null, rollup: 'sum', rag: { greenMax: 0, amberMax: 5 },
        compute: { kind: 'resolved_sla', metric: metricKey, stat: 'breached', tier: tierVal } },
    );
    if (tierVal) { // compliance only for the 5 named tiers (aggregate already exists)
      SUPPORT_NT_KPIS.push(
        { key: `nt_sla_${slug}_compliance`, label: `${metricLabel} Compliance % (${tierLabel})`, team: 'Support', colA: 'SLA', jiraSpace: 'NT',
          unit: 'percent', direction: 'higher-better', dailyTarget: 90, monthlyTarget: null, rollup: 'average', rag: { greenMin: 90, amberMin: 72 },
          compute: { kind: 'resolved_sla', metric: metricKey, stat: 'compliance', tier: tierVal } },
      );
    }
  }
}
SUPPORT_NT_KPIS.push(
  { key: 'nt_esc_accuracy', label: 'Escalation Accuracy %', team: 'Support', colA: 'Escalation', jiraSpace: 'NT',
    unit: 'percent', direction: 'higher-better', dailyTarget: 90, monthlyTarget: null, rollup: 'average', rag: { greenMin: 90, amberMin: 72 },
    compute: { kind: 'escalation_accuracy', allTime: false } },
  { key: 'nt_esc_accuracy_alltime', label: 'Escalation Accuracy % (All Time)', team: 'Support', colA: 'Escalation', jiraSpace: 'NT',
    unit: 'percent', direction: 'higher-better', dailyTarget: 90, monthlyTarget: null, rollup: 'latest', rag: { greenMin: 90, amberMin: 72 },
    compute: { kind: 'escalation_accuracy', allTime: true } },
);

/** All registered org KPIs (only Support/NT for now). */
export const ORG_KPIS: OrgKpi[] = [...SUPPORT_NT_KPIS];

export function getKpi(key: string): OrgKpi | undefined {
  return ORG_KPIS.find(k => k.key === key);
}

/** RAG verdict for a value given the KPI's direction + bands. Returns null if value/bands missing. */
export function computeRag(kpi: OrgKpi, value: number | null): 'green' | 'amber' | 'red' | null {
  if (value == null) return null;
  const { greenMax, amberMax, greenMin, amberMin } = kpi.rag;
  if (kpi.direction === 'lower-better') {
    if (greenMax != null && value <= greenMax) return 'green';
    if (amberMax != null && value <= amberMax) return 'amber';
    return 'red';
  }
  if (kpi.direction === 'higher-better') {
    if (greenMin != null && value >= greenMin) return 'green';
    if (amberMin != null && value >= amberMin) return 'amber';
    return 'red';
  }
  return null; // informational
}
