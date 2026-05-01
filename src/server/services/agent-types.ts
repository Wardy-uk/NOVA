export type AgentState = 'stopped' | 'running' | 'paused';

// ── WP-23k: Hybrid Shadow Mode ──

export type AgentShadowMode = 'full_shadow' | 'hybrid' | 'live';
export type HybridActionId = 'plugin_to_tpj' | 'abuse_report';

export interface HybridActionMatch {
  actionId: HybridActionId;
  ticketKey: string;
  ticketId: string;
  summary: string;
  description: string;
  parsedData: Record<string, unknown>;
  requiresApproval: boolean;
}

export interface HybridActionResult {
  success: boolean;
  actionId: HybridActionId;
  ticketKey: string;
  detail: string;
  error?: string;
  createdTicketKey?: string;
  approvalId?: number;
}

// ── WP-23b: Ticket Lifecycle ──

export type TicketLifecycle =
  | 'new'
  | 'triaged'
  | 'awaiting_approval'
  | 'response_sent'
  | 'awaiting_customer'
  | 'customer_replied'
  | 're_evaluating'
  | 'resolved'
  | 'stale'
  | 'chase_sent'
  | 'auto_close_candidate'
  | 'closed'
  | 'pre_empted';

export type AssignedTicketMode = 'observer' | 'active_assistant' | 'hands_off';

export interface TicketLifecycleState {
  ticketId: string;
  lifecycle: TicketLifecycle;
  assignee: string | null;
  assigneeName: string | null;
  lastCommentId: string | null;
  lastTriageDecisionId: number | null;
  lastRespondDecisionId: number | null;
  commentCount: number;
  lastTransitionAt: string;
  lastAgentActionAt: string | null;
  lastCustomerReplyAt: string | null;
  approvalId: number | null;
  approvalSubmittedAt: string | null;
}

export type AgentAction =
  | 'no_action'
  | 'respond'
  | 'draft_response'
  | 'escalate'
  | 'gather_context'
  | 'assign'
  | 'chase'
  | 'transition'
  | 'comment'
  | 'update_fields'
  | 'alert'
  | 'bug_redirect'
  | 'plugin_to_tpj'
  | 'abuse_report';

export interface CommentSnapshot {
  author: string;
  body: string;
  created: string;
  isPublic: boolean;
}

export interface TicketEvent {
  ticketId: string;
  ticketKey: string;
  eventType: 'ticket_created' | 'comment_added' | 'status_changed' | 'sla_warning' | 'stale' | 'resolution_review';
  summary: string;
  description: string;
  status: string;
  priority: string;
  requestType: string;
  assignee: string | null;
  reporter: string | null;
  reporterEmail: string | null;
  organisation: string | null;
  created: string;
  updated: string;
  slaBreachTime: string | null;
  fields: Record<string, unknown>;
  comments?: CommentSnapshot[];
}

export interface QueuePerception {
  timestamp: string;
  totalOpen: number;
  byStatus: Record<string, number>;
  newEvents: TicketEvent[];
  slaAtRisk: TicketEvent[];
  staleTickets: TicketEvent[];
}

export interface AgentDecision {
  ticketId: string;
  ticketKey: string;
  eventType: string;
  action: AgentAction;
  confidence: number;
  reasoning: string;
  approvalRequired: boolean;
  shadowMode: boolean;
  inputs: Record<string, unknown>;
  output: Record<string, unknown>;
  provider?: string;
  model?: string;
  promptVersion?: string;
}

export interface ActionResult {
  success: boolean;
  action: AgentAction;
  ticketKey: string;
  detail: string;
  error?: string;
}

export type AgentMode = 'full' | 'reduced';

export interface AgentStatus {
  state: AgentState;
  shadowMode: boolean;
  shadowModeEnum: AgentShadowMode;
  lastTickAt: string | null;
  tickCount: number;
  ticketsProcessed: number;
  intervalMs: number;
  errors: number;
  mode: AgentMode;
  modeChangedAt: string | null;
  weekendOverrideUntil: string | null;
}

// ── WP-09: Queue Monitor ──

export interface QueueHealth {
  timestamp: string;
  totalOpen: number;
  slaBreachImminent: SlaRiskTicket[];
  unassignedStale: UnassignedTicket[];
  volumeSpike: VolumeSpike | null;
  capacityWarning: CapacityWarning | null;
}

export interface SlaRiskTicket {
  ticketKey: string;
  summary: string;
  assignee: string | null;
  slaType: 'first_response' | 'next_update' | 'resolution';
  minutesRemaining: number;
  breachTime: string;
}

export interface UnassignedTicket {
  ticketKey: string;
  summary: string;
  priority: string;
  ageMinutes: number;
  created: string;
}

export interface VolumeSpike {
  currentHourCount: number;
  averageForSlot: number;
  stdDevForSlot: number;
  sigmaAbove: number;
}

export interface CapacityWarning {
  totalOpen: number;
  availableAgents: number;
  ticketsPerAgent: number;
  threshold: number;
}

// ── WP-09: Alert System ──

export type AlertType =
  | 'sla_breach_imminent'
  | 'volume_spike'
  | 'capacity_low'
  | 'agent_loop_unhealthy'
  | 'autonomy_execution'
  | 'approval_timeout'
  | 'approval_abandoned'
  | 'token_budget_exceeded'
  | 'error';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AgentAlert {
  id?: number;
  alertType: AlertType;
  severity: AlertSeverity;
  title: string;
  detail?: string;
  ticketKey?: string;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  createdAt?: string;
}

// ── WP-09: Autonomy Engine ──

export interface AutonomyRule {
  id?: number;
  category: string;
  subCategory?: string | null;
  enabled: boolean;
  minConfidence: number;
  minAcceptRate: number;
  minQaScore: number;
  minDecisions: number;
  autonomousActions: string[];
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AutonomyCheck {
  allowed: boolean;
  reason: string;
  rule?: AutonomyRule;
  actualAcceptRate?: number;
  actualDecisionCount?: number;
}
