export type TicketStatus = 'open' | 'in_progress' | 'waiting_customer' | 'waiting_third_party' | 'resolved' | 'closed';
export type TicketPriority = 'P1' | 'P2' | 'P3' | 'P4';

export interface CalyxTeam {
  id: number;
  name: string;
  slug: string;
  created_at: string;
}

export interface CalyxCategory {
  id: number;
  team_id: number;
  name: string;
  parent_id: number | null;
  level: 1 | 2 | 3;
  created_at: string;
  children?: CalyxCategory[];
}

export interface CalyxAgent {
  id: number;
  name: string;
  email: string;
  team_id: number;
  is_active: boolean;
  created_at: string;
  team_name?: string;
}

export interface CalyxSlaPolicy {
  id: number;
  name: string;
  team_id: number | null;
  category_id: number | null;
  priority: TicketPriority;
  frt_minutes: number;
  resolution_minutes: number;
  business_hours_only: boolean;
  pause_on_waiting: boolean;
  position: number;
  business_hours_id: number | null;
  created_at: string;
}

export interface CalyxTicket {
  id: number;
  reference: string;
  title: string;
  description: string;
  team_id: number;
  category_id: number | null;
  subcategory_id: number | null;
  item_id: number | null;
  priority: TicketPriority;
  status: TicketStatus;
  assigned_agent_id: number | null;
  requester_name: string;
  requester_email: string;
  sla_policy_id: number | null;
  frt_due_at: string | null;
  resolution_due_at: string | null;
  frt_met_at: string | null;
  resolved_at: string | null;
  first_replied_at: string | null;
  sla_paused_at: string | null;
  sla_pause_reason: string | null;
  requester_id: number | null;
  organisation_id: number | null;
  major_incident_id: number | null;
  asset_id: string | null;
  supplier_id: number | null;
  source: string;
  merged_into_id: number | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  team_name?: string;
  team_slug?: string;
  assigned_agent_name?: string;
  category_name?: string;
  subcategory_name?: string;
  item_name?: string;
  sla_policy_name?: string;
}

export type TicketEventType =
  | 'created'
  | 'status_change'
  | 'priority_change'
  | 'assignment_change'
  | 'category_change'
  | 'comment_added'
  | 'sla_paused'
  | 'sla_resumed'
  | 'frt_met'
  | 'resolved'
  | 'reopened';

export interface CalyxTicketEvent {
  id: number;
  ticket_id: number;
  event_type: TicketEventType;
  from_value: string | null;
  to_value: string | null;
  agent_id: number | null;
  note: string | null;
  created_at: string;
  agent_name?: string;
}

export interface CalyxComment {
  id: number;
  ticket_id: number;
  agent_id: number | null;
  body: string;
  is_internal: boolean;
  created_at: string;
  agent_name?: string;
}

export interface CreateTicketPayload {
  title: string;
  description: string;
  team_id: number;
  category_id?: number | null;
  subcategory_id?: number | null;
  item_id?: number | null;
  priority: TicketPriority;
  assigned_agent_id?: number | null;
  requester_name: string;
  requester_email: string;
}

export interface UpdateTicketPayload {
  status?: TicketStatus;
  priority?: TicketPriority;
  assigned_agent_id?: number | null;
  category_id?: number | null;
  subcategory_id?: number | null;
  item_id?: number | null;
}

export interface CreateCommentPayload {
  body: string;
  is_internal?: boolean;
  agent_id?: number | null;
}

export interface CreateSlaPolicyPayload {
  name: string;
  team_id?: number | null;
  category_id?: number | null;
  priority: TicketPriority;
  frt_minutes: number;
  resolution_minutes: number;
  business_hours_only?: boolean;
  pause_on_waiting?: boolean;
  position?: number;
}

export interface TicketFilters {
  team_id?: number;
  status?: TicketStatus;
  priority?: TicketPriority;
  assigned_agent_id?: number;
  sla_breached?: boolean;
}

// ── Phase 1 entity types ──

export interface CalyxOrganisation {
  id: number;
  name: string;
  slug: string;
  sla_policy_id: number | null;
  contact_name: string | null;
  contact_email: string | null;
  notes: string | null;
  created_at: string;
}

export interface CalyxRequester {
  id: number;
  organisation_id: number | null;
  name: string;
  email: string;
  phone: string | null;
  portal_token: string | null;
  portal_token_expires_at: string | null;
  portal_jwt_issued_at: string | null;
  last_login_at: string | null;
  created_at: string;
}

export interface CalyxBusinessHours {
  id: number;
  name: string;
  timezone: string;
  mon_start: string | null; mon_end: string | null; mon_enabled: number;
  tue_start: string | null; tue_end: string | null; tue_enabled: number;
  wed_start: string | null; wed_end: string | null; wed_enabled: number;
  thu_start: string | null; thu_end: string | null; thu_enabled: number;
  fri_start: string | null; fri_end: string | null; fri_enabled: number;
  sat_start: string | null; sat_end: string | null; sat_enabled: number;
  sun_start: string | null; sun_end: string | null; sun_enabled: number;
  created_at: string;
}

export interface CalyxBusinessHoursHoliday {
  id: number;
  business_hours_id: number;
  date: string;
  name: string;
  created_at: string;
}

export type SloMetricType = 'escalation_to_t2' | 'escalation_to_t3' | 'escalation_to_dev' | 'time_to_assign' | 'time_to_first_update' | 'time_to_close' | 'custom';

export interface CalyxSlo {
  id: number;
  name: string;
  description: string | null;
  metric_type: SloMetricType;
  target_minutes: number;
  warning_threshold_pct: number;
  applies_to_team_id: number | null;
  applies_to_priority: TicketPriority | null;
  applies_to_category_id: number | null;
  business_hours_only: number;
  is_active: number;
  created_at: string;
}

export interface CalyxTicketSloTracking {
  id: number;
  ticket_id: number;
  slo_id: number;
  started_at: string;
  completed_at: string | null;
  target_at: string;
  warning_at: string;
  paused_at: string | null;
  pause_minutes_accumulated: number;
  breached: number;
  breach_minutes: number | null;
  created_at: string;
}

export type ProblemStatus = 'identified' | 'in_analysis' | 'known_error' | 'resolved' | 'closed';

export interface CalyxProblem {
  id: number;
  reference: string;
  title: string;
  description: string | null;
  status: ProblemStatus;
  root_cause: string | null;
  workaround: string | null;
  assigned_agent_id: number | null;
  created_by_agent_id: number;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface CalyxProblemTicket {
  id: number;
  problem_id: number;
  ticket_id: number;
  created_at: string;
}

export type ChangeType = 'standard' | 'normal' | 'emergency';
export type ChangeStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'implementing' | 'complete' | 'cancelled';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface CalyxChange {
  id: number;
  reference: string;
  title: string;
  description: string | null;
  type: ChangeType;
  status: ChangeStatus;
  risk_level: RiskLevel;
  impact_assessment: string | null;
  rollback_plan: string | null;
  requested_by_agent_id: number;
  approved_by_agent_id: number | null;
  rejection_reason: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ChangeTicketRelationship = 'triggered_by' | 'affected_by' | 'resolved_by' | 'related';

export interface CalyxChangeTicket {
  id: number;
  change_id: number;
  ticket_id: number;
  relationship: ChangeTicketRelationship;
  created_at: string;
}

export type KbArticleStatus = 'draft' | 'published' | 'archived';

export interface CalyxKbArticle {
  id: number;
  title: string;
  slug: string;
  body: string;
  category_id: number | null;
  team_id: number | null;
  author_agent_id: number;
  status: KbArticleStatus;
  view_count: number;
  helpful_count: number;
  not_helpful_count: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface CalyxCannedResponse {
  id: number;
  title: string;
  body: string;
  team_id: number | null;
  category_id: number | null;
  author_agent_id: number;
  use_count: number;
  created_at: string;
  updated_at: string;
}

export interface CalyxTicketWatcher {
  id: number;
  ticket_id: number;
  agent_id: number;
  created_at: string;
}

export interface CalyxTag {
  id: number;
  name: string;
  colour: string;
  created_at: string;
}

export interface CalyxTicketTag {
  id: number;
  ticket_id: number;
  tag_id: number;
  created_at: string;
}

export type TicketLinkType = 'related' | 'blocks' | 'blocked_by' | 'duplicate_of' | 'merged_into';

export interface CalyxTicketLink {
  id: number;
  ticket_id: number;
  linked_ticket_id: number;
  link_type: TicketLinkType;
  created_at: string;
}

export interface CalyxCsatSurvey {
  id: number;
  ticket_id: number;
  requester_id: number | null;
  survey_token: string;
  sent_at: string;
  responded_at: string | null;
  csat_score: number | null;
  xla_score: number | null;
  effort_score: number | null;
  comment: string | null;
  created_at: string;
}

export interface CalyxMajorIncident {
  id: number;
  ticket_id: number;
  declared_at: string;
  resolved_at: string | null;
  incident_commander_agent_id: number | null;
  impact_statement: string;
  stakeholder_comms: string;
  post_incident_review: string | null;
  pir_completed_at: string | null;
  created_at: string;
}

export interface CalyxEmailQueueItem {
  id: number;
  ticket_id: number | null;
  recipient_email: string;
  event_type: string;
  subject: string;
  body_html: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  last_attempt_at: string | null;
  error: string | null;
  created_at: string;
}

export interface CalyxServiceCatalogueItem {
  id: number;
  name: string;
  description: string | null;
  team_id: number | null;
  category_id: number | null;
  sla_policy_id: number | null;
  slo_ids: string;
  request_form_schema: string;
  is_active: number;
  icon: string | null;
  created_at: string;
}

export interface CalyxSupplier {
  id: number;
  name: string;
  type: string | null;
  contact_name: string | null;
  contact_email: string | null;
  sla_description: string | null;
  notes: string | null;
  created_at: string;
}

export type ImprovementSource = 'problem' | 'pir' | 'csat' | 'manual' | 'audit';
export type ImprovementStatus = 'proposed' | 'approved' | 'in_progress' | 'complete' | 'rejected';

export interface CalyxImprovement {
  id: number;
  reference: string;
  title: string;
  description: string | null;
  source: ImprovementSource;
  source_id: number | null;
  status: ImprovementStatus;
  owner_agent_id: number | null;
  due_date: string | null;
  outcome: string | null;
  created_at: string;
  updated_at: string;
}

export type AuditActorType = 'agent' | 'requester' | 'system';

export interface CalyxAuditLogEntry {
  id: number;
  entity_type: string;
  entity_id: number | null;
  action: string;
  actor_type: AuditActorType;
  actor_id: number | null;
  changes_json: string | null;
  ip_address: string | null;
  created_at: string;
}
