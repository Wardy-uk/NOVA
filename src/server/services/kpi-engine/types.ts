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

/** Signature for a pluggable metric computer. */
export type MetricComputer = (
  tickets: KpiTicket[],
  space: SpaceConfig,
  metric: EnabledMetric,
  tier?: TierDefinition,
) => number;
