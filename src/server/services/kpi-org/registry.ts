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

/** Resolution SLA name for breached() JQL. ⚠ Confirm the exact SLA display name at build. */
export const RESOLUTION_SLA_NAME = 'Time to resolution';
const RES_BREACHED = `"${RESOLUTION_SLA_NAME}" = breached()`;

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
    unit: 'count', direction: 'lower-better', dailyTarget: 120, monthlyTarget: null, rollup: 'sum',
    rag: { greenMax: 119, amberMax: 150 },  // <120 green, 120–150 amber, >150 red
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
];

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
