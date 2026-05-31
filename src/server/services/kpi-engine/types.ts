/**
 * KPI Recovery — Clean-Sheet Foundation shared types (P1-WP1).
 * Source of truth: KPI-Clean-Sheet-Design.md.
 */

/** A space (Jira project / team) row from kpi_spaces, normalised for runtime use. */
export interface SpaceConfig {
  spaceKey: string;
  jiraProject: string | null;
  displayName: string;
  ownerName: string | null;
  timezone: string;
  /** Business hours start as minutes-from-midnight in the space timezone. */
  bizStartMinutes: number;
  /** Business hours end as minutes-from-midnight in the space timezone. */
  bizEndMinutes: number;
  /** Weekend day numbers (0=Sun … 6=Sat). */
  weekendDays: number[];
  /** Status names that pause the SLA clock (lower-cased). */
  pauseStatuses: string[];
  hasTiers: boolean;
  isJiraSpace: boolean;
  isActive: boolean;
  /** Holiday dates (YYYY-MM-DD in the space timezone). */
  holidays: Set<string>;
  /** Space-level SLA thresholds (minutes), from the configurable `Standard` tier row. */
  defaultFrtTargetMin: number;
  defaultResTargetMin: number;
}

/** A metric definition row joined with its per-space binding. */
export interface EnabledMetric {
  metricKey: string;
  displayName: string;
  category: string;
  valueType: string;
  direction: string;
  aggregation: string;
  source: string;
  computationKey: string | null;
  requiresTiers: boolean;
  isAgentLevel: boolean;
  targetValue: number | null;
  amberBand: number | null;
}

/** NT-style tier definition. */
export interface TierDefinition {
  tierName: string;
  tierOrder: number;
  jiraFieldValue: string | null;
  frtTargetMinutes: number | null;
  resolutionTargetMinutes: number | null;
}

/** A single computed metric value, optionally broken down by tier. */
export interface MetricValue {
  spaceKey: string;
  metricKey: string;
  tierName: string | null;
  value: number;
}

/**
 * A ticket row pulled from jira_issue_cache for computation. Mirrors the cache
 * columns the foundation needs, plus derived fields parsed from fields_json.
 */
export interface KpiTicket {
  issueKey: string;
  projectKey: string;
  statusName: string | null;
  statusCategory: string | null;
  currentTier: string | null;
  requestType: string | null;
  assigneeAccountId: string | null;
  assigneeDisplay: string | null;
  created: Date | null;
  updated: Date | null;
  resolvedAt: Date | null;
  resolutionName: string | null;
  slaBreached: boolean;
  slaBreachTime: Date | null;
  labels: string[];
  /** First public (customer-facing) comment time, from jira_comment_cache. */
  firstPublicCommentAt: Date | null;
  /** CSAT rating 1–5 parsed from customfield_12802. */
  csatRating: number | null;
  /** Story points parsed from customfield_11706 (NTPJ). */
  storyPoints: number | null;
  /** True when neither Key_Account nor Enterprise_Account label is present. */
  isCustomerSuccess: boolean;
  /** True when Key_Account or Enterprise_Account label is present. */
  isKeyAccount: boolean;
}

/**
 * A single escalation event for a space, sourced from the NOVA `escalation_log`
 * table (the clean-sheet replacement for the deprecated JiraTickets escalation
 * columns). Keyed by issueKey so a computer can intersect it with whatever ticket
 * subset it is given (space-level = all tickets, agent-level = that agent's).
 *
 * Rows whose `escalationType` is `rejection` are bounce-back events (a higher
 * tier formally returned a ticket); they are partitioned out of the escalation
 * list and carried separately on the context so they never inflate
 * `escalation_rate` and can source `rejection_rate` / `escalation_accuracy`.
 */
export interface EscalationEvent {
  issueKey: string;
  escalationType: string;
}

/** A QA result row (jira_qa_results), keyed by issueKey for ticket-subset join. */
export interface QaScoreRow {
  issueKey: string;
  overallScore: number | null;
}

/** A Golden-Rules result row (Jira_QA_GoldenRules), keyed by issueKey. */
export interface GoldenRuleScoreRow {
  issueKey: string;
  overallScore: number | null;
}

/**
 * Pre-fetched non-ticket source data passed to source-family computers. Built
 * once per space by the engine and shared across the space-level, per-tier and
 * per-agent computer calls; each computer intersects the data with the ticket
 * subset it receives. The `*Available` flags let a computer return `null` (→ no
 * value, cell shows "—") when its source could not be read, distinct from a
 * genuine zero (e.g. zero escalations on tickets that were read fine).
 */
export interface MetricSourceContext {
  escalationAvailable: boolean;
  escalations: EscalationEvent[];
  /**
   * True only when the rejection capture path has produced at least one
   * bounce-back event in window. While false, `rejection_rate` /
   * `escalation_accuracy` return `null` (→ "—", wired-but-awaiting-capture)
   * rather than asserting a fabricated 0% / 100%.
   */
  rejectionAvailable: boolean;
  rejections: EscalationEvent[];
  qaAvailable: boolean;
  qaResults: QaScoreRow[];
  goldenRulesAvailable: boolean;
  goldenRules: GoldenRuleScoreRow[];
}

/**
 * Signature for a pluggable metric computer.
 *
 * Returns the computed value, or `null` to mean "no value to record" — used by
 * source-family computers when their source is unavailable or there is nothing
 * to average. A `null` is skipped by the engine/EOD (no snapshot/daily row), so
 * the metric reads as "—" (wired, awaiting data) rather than a fabricated 0.
 */
export type MetricComputer = (
  tickets: KpiTicket[],
  space: SpaceConfig,
  metric: EnabledMetric,
  tier?: TierDefinition,
  ctx?: MetricSourceContext,
) => number | null;
