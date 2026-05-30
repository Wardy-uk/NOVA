/**
 * KPI Recovery — Seed Catalogue (P1-WP1)
 *
 * Declarative seed data for the clean-sheet foundation: spaces, the metric
 * definition catalogue, per-space metric bindings, and NT tier definitions.
 * Source of truth: KPI-Clean-Sheet-Design.md §2.1, §4, §3.5.
 *
 * This is DATA ONLY. The seeding routine (kpi-seed.ts) upserts it idempotently.
 * Targets here are seed defaults — they are stored in kpi_space_metrics and are
 * fully editable at runtime, never hardcoded into computation.
 */

export interface SpaceSeed {
  spaceKey: string;
  jiraProject: string | null;
  displayName: string;
  ownerName: string | null;
  timezone: string;
  bizStart: string;   // HH:MM
  bizEnd: string;     // HH:MM
  weekendDays: string; // CSV of 0..6
  pauseStatuses: string[];
  hasTiers: boolean;
  isJiraSpace: boolean;
}

export interface MetricSeed {
  metricKey: string;
  displayName: string;
  category: string;
  valueType: string; // integer|decimal|percentage|currency|duration_minutes
  direction: string; // higher|lower|neutral
  aggregation?: string; // snapshot|sum|avg|max|min|latest
  source?: string;      // computed|manual|api
  computationKey?: string | null;
  requiresTiers?: boolean;
  isAgentLevel?: boolean;
}

export interface SpaceMetricSeed {
  spaceKey: string;
  metricKey: string;
  target?: number | null;
  showOnSlt?: boolean;
  showOnWallboard?: boolean;
  order?: number;
}

export interface TierSeed {
  spaceKey: string;
  tierName: string;
  tierOrder: number;
  jiraFieldValue: string | null;
  frtTargetMinutes: number;
  resolutionTargetMinutes: number;
}

const DEFAULT_PAUSE = ['Waiting for Customer', 'Pending', 'On Hold', 'Waiting on Requestor'];

// ── Spaces (design §2.1) ──
export const SPACES: SpaceSeed[] = [
  { spaceKey: 'NT',      jiraProject: 'NT',   displayName: 'Tech Support 2nd Line', ownerName: 'Nick Ward',     timezone: 'Europe/London', bizStart: '08:30', bizEnd: '17:30', weekendDays: '0,6', pauseStatuses: DEFAULT_PAUSE, hasTiers: true,  isJiraSpace: true },
  { spaceKey: 'NTPJ',    jiraProject: 'NTPJ', displayName: 'Projects',              ownerName: 'Nick Ward',     timezone: 'Europe/London', bizStart: '08:30', bizEnd: '17:30', weekendDays: '0,6', pauseStatuses: DEFAULT_PAUSE, hasTiers: false, isJiraSpace: true },
  { spaceKey: 'STBY',    jiraProject: 'STBY', displayName: 'Starberry',             ownerName: 'Paul',          timezone: 'Asia/Kolkata',  bizStart: '09:00', bizEnd: '18:00', weekendDays: '0,6', pauseStatuses: DEFAULT_PAUSE, hasTiers: false, isJiraSpace: true },
  { spaceKey: 'YO',      jiraProject: 'YO',   displayName: 'Your Online',           ownerName: 'Hannah',        timezone: 'Europe/London', bizStart: '08:30', bizEnd: '17:30', weekendDays: '0,6', pauseStatuses: DEFAULT_PAUSE, hasTiers: false, isJiraSpace: true },
  { spaceKey: 'CS',      jiraProject: null,   displayName: 'Customer Success',      ownerName: 'Beth Windsor',  timezone: 'Europe/London', bizStart: '08:30', bizEnd: '17:30', weekendDays: '0,6', pauseStatuses: DEFAULT_PAUSE, hasTiers: false, isJiraSpace: false },
  { spaceKey: 'KAM',     jiraProject: null,   displayName: 'Key Accounts',          ownerName: 'Riannah Clegg', timezone: 'Europe/London', bizStart: '08:30', bizEnd: '17:30', weekendDays: '0,6', pauseStatuses: DEFAULT_PAUSE, hasTiers: false, isJiraSpace: false },
  { spaceKey: 'ONBOARD', jiraProject: null,   displayName: 'Onboarding',            ownerName: 'Emma Maciver',  timezone: 'Europe/London', bizStart: '08:30', bizEnd: '17:30', weekendDays: '0,6', pauseStatuses: DEFAULT_PAUSE, hasTiers: false, isJiraSpace: false },
  { spaceKey: 'COMMS',   jiraProject: null,   displayName: 'Comms Managed',         ownerName: 'Andrea/Touseef',timezone: 'Europe/London', bizStart: '08:30', bizEnd: '17:30', weekendDays: '0,6', pauseStatuses: DEFAULT_PAUSE, hasTiers: false, isJiraSpace: false },
];

// ── Metric definitions (design §4) ──
// computationKey === metricKey for computed metrics; a registered computer (see
// metric-computers.ts) is required for the value to populate. Metrics whose key
// has no registered computer are skipped gracefully (Phase 1 bounded coverage).
export const METRICS: MetricSeed[] = [
  // 4.1 Jira-computed
  { metricKey: 'frt_compliance',        displayName: 'First Response SLA %',     category: 'SLA',     valueType: 'percentage',       direction: 'higher', computationKey: 'frt_compliance',        requiresTiers: true,  isAgentLevel: true },
  { metricKey: 'resolution_compliance', displayName: 'Resolution SLA %',         category: 'SLA',     valueType: 'percentage',       direction: 'higher', computationKey: 'resolution_compliance', requiresTiers: true,  isAgentLevel: true },
  { metricKey: 'frt_avg_minutes',       displayName: 'Avg First Response Time',  category: 'SLA',     valueType: 'duration_minutes', direction: 'lower',  computationKey: 'frt_avg_minutes',       requiresTiers: true,  isAgentLevel: true },
  { metricKey: 'resolution_avg_minutes',displayName: 'Avg Resolution Time',      category: 'SLA',     valueType: 'duration_minutes', direction: 'lower',  computationKey: 'resolution_avg_minutes',requiresTiers: true,  isAgentLevel: true },
  { metricKey: 'queue_total',           displayName: 'Total Open Tickets',       category: 'Volume',  valueType: 'integer',          direction: 'lower',  computationKey: 'queue_total' },
  { metricKey: 'queue_over_sla',        displayName: 'Tickets Over SLA',         category: 'Volume',  valueType: 'integer',          direction: 'lower',  computationKey: 'queue_over_sla' },
  { metricKey: 'queue_actionable',      displayName: 'Actionable Tickets',       category: 'Volume',  valueType: 'integer',          direction: 'lower',  computationKey: 'queue_actionable' },
  { metricKey: 'queue_no_reply_3d',     displayName: 'No Reply 3+ Days',         category: 'Volume',  valueType: 'integer',          direction: 'lower',  computationKey: 'queue_no_reply_3d' },
  { metricKey: 'queue_no_reply_5d',     displayName: 'No Reply 5+ Days',         category: 'Volume',  valueType: 'integer',          direction: 'lower',  computationKey: 'queue_no_reply_5d' },
  { metricKey: 'opened_today',          displayName: 'Tickets Opened Today',     category: 'Volume',  valueType: 'integer',          direction: 'neutral',computationKey: 'opened_today' },
  { metricKey: 'resolved_today',        displayName: 'Tickets Resolved Today',   category: 'Volume',  valueType: 'integer',          direction: 'higher', computationKey: 'resolved_today',        isAgentLevel: true },
  { metricKey: 'fcr_rate',              displayName: 'First Contact Resolution %',category: 'Quality',valueType: 'percentage',       direction: 'higher', computationKey: 'fcr_rate' },
  { metricKey: 'first_line_resolution', displayName: '1st Line Resolution %',    category: 'Quality', valueType: 'percentage',       direction: 'higher', computationKey: 'first_line_resolution' },
  { metricKey: 'csat_score',            displayName: 'CSAT Score',               category: 'Quality', valueType: 'decimal',          direction: 'higher', computationKey: 'csat_score',            isAgentLevel: true },
  { metricKey: 'csat_response_rate',    displayName: 'CSAT Response Rate %',     category: 'Quality', valueType: 'percentage',       direction: 'higher', computationKey: 'csat_response_rate' },
  { metricKey: 'escalation_rate',       displayName: 'Escalation Rate %',        category: 'Quality', valueType: 'percentage',       direction: 'lower',  computationKey: 'escalation_rate',       isAgentLevel: true },
  { metricKey: 'escalation_accuracy',   displayName: 'Escalation Accuracy %',    category: 'Quality', valueType: 'percentage',       direction: 'higher', computationKey: 'escalation_accuracy',    isAgentLevel: true },
  { metricKey: 'rejection_rate',        displayName: 'Rejection Rate %',         category: 'Quality', valueType: 'percentage',       direction: 'lower',  computationKey: 'rejection_rate',        isAgentLevel: true },
  { metricKey: 'qa_score_avg',          displayName: 'QA Score (avg)',           category: 'Quality', valueType: 'decimal',          direction: 'higher', computationKey: 'qa_score_avg',          isAgentLevel: true },
  { metricKey: 'golden_rules_avg',      displayName: 'Golden Rules Score (avg)', category: 'Quality', valueType: 'decimal',          direction: 'higher', computationKey: 'golden_rules_avg',      isAgentLevel: true },
  { metricKey: 'bug_escalation_ack_hrs',displayName: 'Bug Ack Time (avg hrs)',   category: 'Quality', valueType: 'decimal',          direction: 'lower',  computationKey: 'bug_escalation_ack_hrs' },
  { metricKey: 'oldest_actionable_hrs', displayName: 'Oldest Actionable (hrs)',  category: 'Volume',  valueType: 'decimal',          direction: 'lower',  computationKey: 'oldest_actionable_hrs' },
  { metricKey: 'sla_breach_count',      displayName: 'Live SLA Breaches',        category: 'Volume',  valueType: 'integer',          direction: 'lower',  computationKey: 'sla_breach_count' },
  { metricKey: 'backlog_age_avg_days',  displayName: 'Avg Backlog Age (days)',   category: 'Volume',  valueType: 'decimal',          direction: 'lower',  computationKey: 'backlog_age_avg_days' },
  { metricKey: 'reopen_rate',           displayName: 'Reopen Rate %',            category: 'Quality', valueType: 'percentage',       direction: 'lower',  computationKey: 'reopen_rate',           isAgentLevel: true },
  { metricKey: 'tickets_per_agent',     displayName: 'Tickets per Agent',        category: 'Volume',  valueType: 'decimal',          direction: 'lower',  computationKey: 'tickets_per_agent' },

  // 4.2 NTPJ bespoke
  { metricKey: 'story_points_completed',displayName: 'Story Points Completed',   category: 'Volume',  valueType: 'decimal',          direction: 'higher', computationKey: 'story_points_completed' },
  { metricKey: 'story_points_remaining',displayName: 'Story Points Remaining',   category: 'Volume',  valueType: 'decimal',          direction: 'lower',  computationKey: 'story_points_remaining' },
  { metricKey: 'sprint_velocity',       displayName: 'Sprint Velocity',          category: 'Volume',  valueType: 'decimal',          direction: 'higher', computationKey: 'sprint_velocity' },
  { metricKey: 'sprint_burndown_pct',   displayName: 'Sprint Burndown %',        category: 'Volume',  valueType: 'percentage',       direction: 'higher', computationKey: 'sprint_burndown_pct' },

  // 4.3 AI agent
  { metricKey: 'ai_tickets_handled',    displayName: 'AI Tickets Handled',       category: 'AI',      valueType: 'integer',          direction: 'higher', computationKey: 'ai_tickets_handled' },
  { metricKey: 'ai_accuracy_rate',      displayName: 'AI Accuracy %',            category: 'AI',      valueType: 'percentage',       direction: 'higher', computationKey: 'ai_accuracy_rate' },
  { metricKey: 'ai_autonomy_rate',      displayName: 'AI Autonomy %',            category: 'AI',      valueType: 'percentage',       direction: 'higher', computationKey: 'ai_autonomy_rate' },
  { metricKey: 'ai_cost_per_ticket',    displayName: 'AI Cost per Ticket',       category: 'AI',      valueType: 'currency',         direction: 'lower',  computationKey: 'ai_cost_per_ticket' },

  // 4.4 Manual / business — Onboarding
  { metricKey: 'onboard_qty_delivered',     displayName: 'Onboarding Delivered (qty)',        category: 'Business', valueType: 'integer',    direction: 'higher', source: 'manual' },
  { metricKey: 'onboard_value_delivered',   displayName: 'Onboarding Delivered (value)',      category: 'Business', valueType: 'currency',   direction: 'higher', source: 'manual' },
  { metricKey: 'onboard_over_sla_calls',    displayName: 'Over SLA Onboarding Calls',         category: 'Business', valueType: 'integer',    direction: 'lower',  source: 'manual' },
  { metricKey: 'onboard_over_sla_deliver',  displayName: 'Over SLA Time to Deliver',          category: 'Business', valueType: 'integer',    direction: 'lower',  source: 'manual' },
  { metricKey: 'onboard_training_calls',    displayName: 'Onboarding & Training Calls',       category: 'Business', valueType: 'integer',    direction: 'higher', source: 'manual' },
  // Comms Managed
  { metricKey: 'comms_content_built_qa_client', displayName: 'Content Built → QA (Client) %', category: 'Business', valueType: 'percentage', direction: 'higher', source: 'manual' },
  { metricKey: 'comms_content_qad_client',      displayName: "Content QA'd (Client) %",       category: 'Business', valueType: 'percentage', direction: 'higher', source: 'manual' },
  { metricKey: 'comms_content_built_ka',        displayName: 'Content Built → KA/Guild %',    category: 'Business', valueType: 'percentage', direction: 'higher', source: 'manual' },
  { metricKey: 'comms_social_scheduled',        displayName: 'Social Media Scheduled %',      category: 'Business', valueType: 'percentage', direction: 'higher', source: 'manual' },
  { metricKey: 'comms_qa_caught_remedy',        displayName: 'QA Internally Caught %',        category: 'Business', valueType: 'percentage', direction: 'higher', source: 'manual' },
  // Customer Success
  { metricKey: 'cs_proofing_amends',     displayName: 'Proofing Amends by CS %',        category: 'Business', valueType: 'percentage', direction: 'lower',  source: 'manual' },
  { metricKey: 'cs_comms_proof_sent',    displayName: 'Comms Proof Sent to Customer %',  category: 'Business', valueType: 'percentage', direction: 'higher', source: 'manual' },
  { metricKey: 'cs_comms_scheduled',     displayName: 'Comms Scheduled %',               category: 'Business', valueType: 'percentage', direction: 'higher', source: 'manual' },
  { metricKey: 'cs_biz_reviews_30d',     displayName: 'Business Reviews 30-Day %',       category: 'Business', valueType: 'percentage', direction: 'higher', source: 'manual' },
  { metricKey: 'cs_biz_reviews_60d',     displayName: 'Business Reviews 60-Day %',       category: 'Business', valueType: 'percentage', direction: 'higher', source: 'manual' },
  { metricKey: 'cs_biz_reviews_daily',   displayName: 'Business Reviews Completed',       category: 'Business', valueType: 'integer',    direction: 'higher', source: 'manual' },
  { metricKey: 'cs_other_calls',         displayName: 'Other Calls',                      category: 'Business', valueType: 'integer',    direction: 'neutral',source: 'manual' },
  { metricKey: 'cs_on_hold_qty',         displayName: 'Customers On Hold (qty)',          category: 'Business', valueType: 'integer',    direction: 'lower',  source: 'manual' },
  { metricKey: 'cs_on_hold_value',       displayName: 'Customers On Hold (value)',        category: 'Business', valueType: 'currency',   direction: 'lower',  source: 'manual' },
  { metricKey: 'cs_open_tickets',        displayName: 'Open CS Tickets',                  category: 'Business', valueType: 'integer',    direction: 'lower',  source: 'manual' },
  { metricKey: 'cs_over_sla',            displayName: 'CS Tickets Over SLA',              category: 'Business', valueType: 'integer',    direction: 'lower',  source: 'manual' },
  { metricKey: 'cs_resignations_value',  displayName: 'Resignations Received (value)',    category: 'Business', valueType: 'currency',   direction: 'lower',  source: 'manual' },
  { metricKey: 'cs_resignations_qty',    displayName: 'Resignations Received (qty)',      category: 'Business', valueType: 'integer',    direction: 'lower',  source: 'manual' },
  { metricKey: 'cs_cancellations_value', displayName: 'Cancellations Processed (value)',  category: 'Business', valueType: 'currency',   direction: 'lower',  source: 'manual' },
  { metricKey: 'cs_cancellations_qty',   displayName: 'Cancellations Processed (qty)',    category: 'Business', valueType: 'integer',    direction: 'lower',  source: 'manual' },
  { metricKey: 'cs_cross_sells',         displayName: 'Cross Sells Booked',               category: 'Business', valueType: 'integer',    direction: 'higher', source: 'manual' },
  { metricKey: 'cs_red_customers',       displayName: 'Red Customers',                    category: 'Business', valueType: 'integer',    direction: 'lower',  source: 'manual' },
  { metricKey: 'cs_amber_customers',     displayName: 'Amber Customers',                  category: 'Business', valueType: 'integer',    direction: 'lower',  source: 'manual' },
  { metricKey: 'cs_reviews_google_tp',   displayName: 'Reviews (Google/Trustpilot)',      category: 'Business', valueType: 'integer',    direction: 'higher', source: 'manual' },
  { metricKey: 'cs_case_studies',        displayName: 'Case Studies',                     category: 'Business', valueType: 'integer',    direction: 'higher', source: 'manual' },
  // Key Accounts / KAM
  { metricKey: 'kam_comms_proof_current',    displayName: 'KA Comms Proof (Current Month) %',  category: 'Business', valueType: 'percentage', direction: 'higher', source: 'manual' },
  { metricKey: 'kam_comms_proof_next',       displayName: 'KA Comms Proof (Next Month) %',     category: 'Business', valueType: 'percentage', direction: 'higher', source: 'manual' },
  { metricKey: 'kam_comms_scheduled_current',displayName: 'KA Comms Scheduled (Current) %',    category: 'Business', valueType: 'percentage', direction: 'higher', source: 'manual' },
  { metricKey: 'kam_comms_scheduled_next',   displayName: 'KA Comms Scheduled (Next) %',       category: 'Business', valueType: 'percentage', direction: 'higher', source: 'manual' },
  { metricKey: 'kam_30d_contact',            displayName: 'KAM 30-Day Contact %',              category: 'Business', valueType: 'percentage', direction: 'higher', source: 'manual' },
  { metricKey: 'kam_60d_contact',            displayName: 'KAM 60-Day Contact %',              category: 'Business', valueType: 'percentage', direction: 'higher', source: 'manual' },
  { metricKey: 'kam_open_tickets',           displayName: 'Open KAM Tickets',                  category: 'Business', valueType: 'integer',    direction: 'lower',  source: 'manual' },
  { metricKey: 'kam_over_sla',               displayName: 'KAM Tickets Over SLA',              category: 'Business', valueType: 'integer',    direction: 'lower',  source: 'manual' },
  { metricKey: 'kam_on_hold_qty',            displayName: 'KA On Hold (qty)',                  category: 'Business', valueType: 'integer',    direction: 'lower',  source: 'manual' },
  { metricKey: 'kam_on_hold_value',          displayName: 'KA On Hold (value)',                category: 'Business', valueType: 'currency',   direction: 'lower',  source: 'manual' },
  { metricKey: 'kam_cancellations_value',    displayName: 'KA Cancellations (value)',          category: 'Business', valueType: 'currency',   direction: 'lower',  source: 'manual' },
  { metricKey: 'kam_cancellations_qty',      displayName: 'KA Cancellations (qty)',            category: 'Business', valueType: 'integer',    direction: 'lower',  source: 'manual' },
  // Guild
  { metricKey: 'guild_comms_proof_current',     displayName: 'Guild Comms Proof (Current Month) %', category: 'Business', valueType: 'percentage', direction: 'higher', source: 'manual' },
  { metricKey: 'guild_comms_scheduled_current', displayName: 'Guild Comms Scheduled (Current) %',   category: 'Business', valueType: 'percentage', direction: 'higher', source: 'manual' },
  // Sales / Retention
  { metricKey: 'sales_signed_value',         displayName: 'Sales Signed Value',                category: 'Business', valueType: 'currency',   direction: 'higher', source: 'manual' },
  { metricKey: 'resignations_value',         displayName: 'Resignations Received (value)',     category: 'Business', valueType: 'currency',   direction: 'lower',  source: 'manual' },
  { metricKey: 'resignations_qty',           displayName: 'Resignations Received (qty)',       category: 'Business', valueType: 'integer',    direction: 'lower',  source: 'manual' },
  { metricKey: 'save_calls_booked',          displayName: 'Save Calls Booked',                 category: 'Business', valueType: 'integer',    direction: 'higher', source: 'manual' },
  { metricKey: 'save_calls_taken',           displayName: 'Save Calls Taken Place',            category: 'Business', valueType: 'integer',    direction: 'higher', source: 'manual' },
  { metricKey: 'cancellations_saved_value',  displayName: 'Cancellations Saved (value)',       category: 'Business', valueType: 'currency',   direction: 'higher', source: 'manual' },
  { metricKey: 'cancellations_saved_qty',    displayName: 'Cancellations Saved (qty)',         category: 'Business', valueType: 'integer',    direction: 'higher', source: 'manual' },
  // Tech Support (legacy manual)
  { metricKey: 'tech_failed_jobs',  displayName: 'Failed Jobs on Board',  category: 'Business', valueType: 'integer', direction: 'lower', source: 'manual' },
  { metricKey: 'tech_dev_releases', displayName: 'Dev Releases Today',    category: 'Business', valueType: 'integer', direction: 'higher', source: 'manual' },
  { metricKey: 'tech_bug_backlog',  displayName: 'Bug Ticket Backlog',    category: 'Business', valueType: 'integer', direction: 'lower', source: 'manual' },
];

// ── Per-space metric bindings (which metrics each space tracks) ──
// Jira-computed core set, reused across the four Jira spaces.
const JIRA_CORE: Array<Omit<SpaceMetricSeed, 'spaceKey'>> = [
  { metricKey: 'queue_total',           target: 30, showOnSlt: true,  order: 1 },
  { metricKey: 'queue_over_sla',        target: 0,  showOnSlt: true,  order: 2 },
  { metricKey: 'queue_actionable',      target: null, order: 3 },
  { metricKey: 'frt_compliance',        target: 90, showOnSlt: true,  order: 4 },
  { metricKey: 'resolution_compliance', target: 90, showOnSlt: true,  order: 5 },
  { metricKey: 'frt_avg_minutes',       target: null, order: 6 },
  { metricKey: 'resolution_avg_minutes',target: null, order: 7 },
  { metricKey: 'queue_no_reply_3d',     target: 0,  order: 8 },
  { metricKey: 'queue_no_reply_5d',     target: 0,  order: 9 },
  { metricKey: 'opened_today',          target: null, order: 10 },
  { metricKey: 'resolved_today',        target: 15, order: 11 },
  { metricKey: 'oldest_actionable_hrs', target: null, order: 12 },
  { metricKey: 'sla_breach_count',      target: 0,  order: 13 },
  { metricKey: 'backlog_age_avg_days',  target: null, order: 14 },
  { metricKey: 'csat_score',            target: 4,  order: 15 },
  { metricKey: 'csat_response_rate',    target: null, order: 16 },
  { metricKey: 'tickets_per_agent',     target: null, order: 17 },
];

function jiraCore(spaceKey: string, extra: Array<Omit<SpaceMetricSeed, 'spaceKey'>> = []): SpaceMetricSeed[] {
  return [...JIRA_CORE, ...extra].map((m) => ({ ...m, spaceKey }));
}

const MANUAL = (spaceKey: string, keys: string[]): SpaceMetricSeed[] =>
  keys.map((metricKey, i) => ({ spaceKey, metricKey, order: i + 1 }));

export const SPACE_METRICS: SpaceMetricSeed[] = [
  // NT — full Jira core + quality + NT-only first-line
  ...jiraCore('NT', [
    { metricKey: 'first_line_resolution', target: 60, order: 18 },
    { metricKey: 'fcr_rate',              target: 60, order: 19 },
    { metricKey: 'escalation_rate',       target: null, order: 20 },
    { metricKey: 'escalation_accuracy',   target: 90, order: 21 },
    { metricKey: 'rejection_rate',        target: null, order: 22 },
    { metricKey: 'reopen_rate',           target: null, order: 23 },
    { metricKey: 'qa_score_avg',          target: null, order: 24 },
    { metricKey: 'golden_rules_avg',      target: null, order: 25 },
    { metricKey: 'bug_escalation_ack_hrs',target: 4,  order: 26 },
  ]),
  // NTPJ — queue + story points (bespoke)
  ...jiraCore('NTPJ', [
    { metricKey: 'story_points_completed', target: null, showOnSlt: true, order: 18 },
    { metricKey: 'story_points_remaining', target: null, order: 19 },
    { metricKey: 'sprint_velocity',        target: null, showOnSlt: true, order: 20 },
    { metricKey: 'sprint_burndown_pct',    target: null, order: 21 },
  ]),
  // STBY — Jira core (India timezone)
  ...jiraCore('STBY'),
  // YO — Jira core
  ...jiraCore('YO'),
  // Manual teams
  ...MANUAL('CS', ['cs_open_tickets', 'cs_over_sla', 'cs_biz_reviews_30d', 'cs_biz_reviews_60d', 'cs_biz_reviews_daily', 'cs_comms_proof_sent', 'cs_comms_scheduled', 'cs_proofing_amends', 'cs_on_hold_qty', 'cs_on_hold_value', 'cs_resignations_value', 'cs_resignations_qty', 'cs_cancellations_value', 'cs_cancellations_qty', 'cs_cross_sells', 'cs_red_customers', 'cs_amber_customers', 'cs_reviews_google_tp', 'cs_case_studies', 'cs_other_calls']),
  ...MANUAL('KAM', ['kam_open_tickets', 'kam_over_sla', 'kam_30d_contact', 'kam_60d_contact', 'kam_comms_proof_current', 'kam_comms_proof_next', 'kam_comms_scheduled_current', 'kam_comms_scheduled_next', 'kam_on_hold_qty', 'kam_on_hold_value', 'kam_cancellations_value', 'kam_cancellations_qty']),
  ...MANUAL('ONBOARD', ['onboard_qty_delivered', 'onboard_value_delivered', 'onboard_over_sla_calls', 'onboard_over_sla_deliver', 'onboard_training_calls']),
  ...MANUAL('COMMS', ['comms_content_built_qa_client', 'comms_content_qad_client', 'comms_content_built_ka', 'comms_social_scheduled', 'comms_qa_caught_remedy', 'guild_comms_proof_current', 'guild_comms_scheduled_current']),
];

// ── Tier definitions (design §3.5) ──
// Design names NT tiers 1st/2nd/3rd Line; jira_field_value binds to the actual
// jira_issue_cache.current_tier values so per-tier computation can filter.
//
// kpi_tier_definitions also serves as the CONFIGURABLE home for SLA minute
// targets (frt_/resolution_target_minutes). A `Standard` row (tier_order 0,
// jira_field_value NULL = all tickets) is seeded for every Jira space to hold
// its space-level SLA thresholds — this keeps SLA targets fully configurable
// in-DB rather than hardcoded in computation. Per-tier BREAKDOWN rows are only
// emitted for spaces with has_tiers = 1 (NT). Targets are seed defaults, editable.
export const TIER_DEFS: TierSeed[] = [
  // Space-level SLA thresholds (Standard = applies to all tickets in the space)
  { spaceKey: 'NT',   tierName: 'Standard', tierOrder: 0, jiraFieldValue: null, frtTargetMinutes: 60,  resolutionTargetMinutes: 480 },
  { spaceKey: 'NTPJ', tierName: 'Standard', tierOrder: 0, jiraFieldValue: null, frtTargetMinutes: 120, resolutionTargetMinutes: 2880 },
  { spaceKey: 'STBY', tierName: 'Standard', tierOrder: 0, jiraFieldValue: null, frtTargetMinutes: 120, resolutionTargetMinutes: 960 },
  { spaceKey: 'YO',   tierName: 'Standard', tierOrder: 0, jiraFieldValue: null, frtTargetMinutes: 60,  resolutionTargetMinutes: 480 },
  // NT per-tier breakdown (design §2.1 — NT has tiers 1/2/3)
  { spaceKey: 'NT', tierName: '1st Line', tierOrder: 1, jiraFieldValue: 'Customer Care', frtTargetMinutes: 60,  resolutionTargetMinutes: 480 },
  { spaceKey: 'NT', tierName: '2nd Line', tierOrder: 2, jiraFieldValue: 'Tier 2',        frtTargetMinutes: 120, resolutionTargetMinutes: 960 },
  { spaceKey: 'NT', tierName: '3rd Line', tierOrder: 3, jiraFieldValue: 'Tier 3',        frtTargetMinutes: 240, resolutionTargetMinutes: 1920 },
];
