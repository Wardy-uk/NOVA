import { z } from 'zod';

// ── Portal Status (customer-facing) ──

export type PortalStatus =
  | 'Submitted'
  | 'Reviewed'
  | 'In Progress'
  | 'Awaiting Your Response'
  | 'Awaiting Third Party'
  | 'Resolved'
  | 'Closed';

export const portalStatusOrder: PortalStatus[] = [
  'Submitted',
  'Reviewed',
  'In Progress',
  'Resolved',
  'Closed',
];

export const portalStatusDescriptions: Record<PortalStatus, string> = {
  'Submitted': "We've received your request",
  'Reviewed': "We've assessed this and know what's needed",
  'In Progress': "We're actively working on this",
  'Awaiting Your Response': 'We need information or action from you',
  'Awaiting Third Party': "We're waiting on an external provider",
  'Resolved': 'We believe this is fixed/complete',
  'Closed': 'Confirmed done',
};

// ── Portal Organisation ──

export interface PortalOrganisation {
  id: number;
  external_id: string;
  name: string;
  domain: string | null;
  created_at: string;
  updated_at: string;
}

// ── Portal User ──

// Hierarchy: requester ⊂ leader ⊂ manager ⊂ org_admin ⊂ admin.
// - requester: own tickets only
// - leader: + view all org tickets
// - manager: + escalate a ticket
export type PortalUserRole = 'requester' | 'leader' | 'manager' | 'org_admin' | 'admin';
export type PortalUserAuthType = 'oidc' | 'local' | 'internal';
export type PortalUserAccessState = 'active' | 'disabled' | 'removed';

export const PORTAL_ROLE_RANK: Record<PortalUserRole, number> = {
  requester: 1,
  leader: 2,
  manager: 3,
  org_admin: 4,
  admin: 5,
};

/** Leader and above can see every ticket in their organisation, not just their own. */
export function canViewAllOrgTickets(role: PortalUserRole | undefined): boolean {
  return !!role && PORTAL_ROLE_RANK[role] >= PORTAL_ROLE_RANK.leader;
}

/** Manager and above can escalate a ticket (creates a linked Escalation request). */
export function canEscalateTicket(role: PortalUserRole | undefined): boolean {
  return !!role && PORTAL_ROLE_RANK[role] >= PORTAL_ROLE_RANK.manager;
}

// ── Priority ordering (for filter dropdowns) ──
// Highest urgency first; unknown priorities sort as Medium.
const PORTAL_PRIORITY_RANK: Record<string, number> = {
  blocker: 0, 'business critical': 0, highest: 1, high: 2, medium: 3, low: 4, lowest: 5,
};

export function portalPriorityRank(priority: string | null | undefined): number {
  return PORTAL_PRIORITY_RANK[(priority || '').toLowerCase()] ?? 3;
}

/** Unique priority values present in a set of tickets, ordered by urgency. */
export function portalPriorityOptions(priorities: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  for (const p of priorities) { if (p) seen.add(p); }
  return [...seen].sort((a, b) => portalPriorityRank(a) - portalPriorityRank(b));
}

export interface PortalUser {
  id: number;
  external_id: string;
  org_id: number;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: PortalUserRole;
  auth_type: PortalUserAuthType;
  access_state: PortalUserAccessState;
  last_login: string;
  created_at: string;
}

export interface PortalAuthPayload {
  userId: number;
  email: string;
  /** The org this request runs against — the active org, which may not be the home org. */
  orgId: number;
  orgName: string;
  role: PortalUserRole;
  authType?: PortalUserAuthType;
  /** The user's own org (portal_users.org_id). Only differs from orgId when switched. */
  homeOrgId?: number;
  /** True when the user has switched into an org they only have read access to. */
  viewAs?: boolean;
}

/** An org the current user may switch into. */
export interface PortalOrgMembershipSummary {
  orgId: number;
  orgName: string;
  kind: 'home' | 'member' | 'view-as';
  canWrite: boolean;
}

export interface PortalMyOrgsResponse {
  orgs: PortalOrgMembershipSummary[];
  activeOrgId: number;
}

// ── Chat ──

export type ChatSessionStatus = 'active' | 'resolved' | 'abandoned' | 'handed_off' | 'escalated';
export type ChatMessageRole = 'user' | 'assistant' | 'system';

export interface PortalChatSession {
  id: number;
  portal_user_id: number;
  jira_issue_key: string | null;
  status: ChatSessionStatus;
  started_at: string;
  ended_at: string | null;
  metadata: string | null;
}

export interface PortalChatMessage {
  id: number;
  session_id: number;
  role: ChatMessageRole;
  content: string;
  metadata: string | null;
  created_at: string;
}

// ── Form Submission ──

export interface PortalFormSubmission {
  id: number;
  portal_user_id: number;
  jira_issue_key: string | null;
  form_data: string;
  category: string | null;
  created_at: string;
}

export const PortalTicketCreateSchema = z.object({
  subject: z.string().min(1).max(500),
  category: z.string().min(1),
  subcategory: z.string().optional(),
  account: z.string().optional(),
  description: z.string().min(1),
  url: z.string().optional(),
  errorMessage: z.string().optional(),
  screenshots: z.array(z.string()).optional(),
  browser: z.string().optional(),
  os: z.string().optional(),
  urgency: z.enum(['Normal', 'High', 'Critical']).default('Normal'),
  contactPreference: z.enum(['portal', 'email', 'phone']).default('portal'),
});

export type PortalTicketCreateInput = z.infer<typeof PortalTicketCreateSchema>;

// ── Network Request (Guild / Fine & Country intake → NT) ──

export const PortalNetworkRequestSchema = z.object({
  network: z.enum(['Guild', 'Fine & Country']),
  summary: z.string().min(1).max(500),
  agentNameBranch: z.string().min(1).max(300),
  agentOfficeId: z.string().max(100).optional(),
  detail: z.string().min(1),
  priority: z.enum(['Low', 'Medium', 'High', 'Business Critical']).default('Medium'),
  // Optional context when priority = Business Critical (maps to Jira Blocker).
  businessCriticalReason: z.string().max(2000).optional(),
  requestType: z.enum(['broken', 'change']),
  hubspotLink: z.string().max(1000).optional(),
  notes: z.string().max(5000).optional(),
  supportTeam: z.enum(['development', 'support']),
});

export type PortalNetworkRequestInput = z.infer<typeof PortalNetworkRequestSchema>;

// ── KB Articles ──

export interface PortalKbArticle {
  id: number;
  confluence_page_id: string;
  title: string;
  body_html: string;
  body_text: string;
  category: string | null;
  labels: string | null;
  published_at: string;
  updated_at: string;
  view_count: number;
  helpful_yes: number;
  helpful_no: number;
  synced_at: string;
}

// ── Analytics ──

export type PortalAnalyticsEventType =
  | 'page_view'
  | 'kb_search'
  | 'kb_view'
  | 'deflection'
  | 'kb_deflection'
  | 'kb_failed_deflection'
  | 'no_kb_ticket'
  | 'ticket_created'
  | 'chat_started'
  | 'chat_resolved'
  | 'chat_handoff'
  | 'handoff_with_summary'
  | 'handoff_raw_transcript'
  | 'form_started'
  | 'form_completed'
  | 'intake_started'
  | 'intake_confirmed'
  | 'intake_kb_deflection'
  | 'comment_added'
  | 'attachment_uploaded';

export interface PortalAnalyticsEvent {
  id: number;
  event_type: PortalAnalyticsEventType;
  portal_user_id: number | null;
  org_id: number | null;
  metadata: string | null;
  created_at: string;
}

// ── Org → Jira Mapping ──

export interface PortalOrgJiraMapping {
  id: number;
  org_id: number;
  jira_organisation_id: string | null;
  jira_email_domain: string | null;
}

// ── My Tickets / org ticket listing (live Jira, role-scoped) ──

export interface PortalOrgTicket {
  key: string;
  summary: string;
  status: string;        // raw Jira status
  priority: string;
  tier: string | null;   // current handling tier (Customer Care / Tier 2 / Tier 3 / Development)
  requestType: string;
  reporter: string | null;
  assignee: string | null;
  created: string;
  updated: string;
  isEscalation: boolean;
  escalationKey: string | null; // if this ticket has been escalated, the Escalation ticket's key
}

export interface PortalMyTicketsResponse {
  tickets: PortalOrgTicket[];
  scope: 'mine' | 'org';
  canViewOrg: boolean;
  canEscalate: boolean;
}

// ── Portal Ticket (view model for API responses) ──

export interface PortalTicketSummary {
  key: string;
  summary: string;
  status: PortalStatus;
  priority: string;
  created: string;
  updated: string;
  assignee: string | null;
  reporter: string | null;
  latestComment: string | null;
}

export interface PortalTicketDetail extends PortalTicketSummary {
  description: string | null;
  bcAccountNumber: string | null;
  comments: PortalTicketComment[];
  attachments: PortalTicketAttachment[];
  statusHistory: PortalStatusChange[];
  slaStatus: PortalSlaStatus | null;
}

export interface PortalTicketComment {
  id: string;
  author: string;
  body: string;
  created: string;
  isInternal: boolean;
}

export interface PortalTicketAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
}

export interface PortalStatusChange {
  from: PortalStatus | null;
  to: PortalStatus;
  changedAt: string;
  changedBy: string | null;
}

export interface PortalSlaStatus {
  name: string;
  remaining: string | null;
  breached: boolean;
}

// ── Conversational Intake ──

export type IntakeStage = 'intent' | 'category' | 'detail' | 'kb_check' | 'summary' | 'confirmed';
export type IntakeIntent = 'problem' | 'change' | 'question' | 'status';

export interface IntakeCollectedFields {
  subject: string | null;
  account: string | null;
  description: string | null;
  url: string | null;
  errorMessage: string | null;
  browser: string | null;
  os: string | null;
  urgency: 'Normal' | 'High' | 'Critical';
  contactPreference: 'portal' | 'email' | 'phone';
  propertyAddress: string | null;
  listingId: string | null;
  affectedPortals: string | null;
  propertyStatus: string | null;
  affectedPersonName: string | null;
  affectedPersonEmail: string | null;
  officeBranch: string | null;
}

export interface IntakeSessionMetadata {
  stage: IntakeStage;
  intent: IntakeIntent | null;
  category: string | null;
  subcategory: string | null;
  collectedFields: IntakeCollectedFields;
  kbSuggested: boolean;
  deflected: boolean;
  conversational?: boolean;
  otherExchangeCount?: number;
  frustrationDetected?: boolean;
  offeredTicketCreation?: boolean;
  attachmentMentioned?: boolean;
  openingMessage?: string;
  disambiguationAsked?: boolean;
  disambiguationDomain?: string;
  securitySensitive?: boolean;
  ambiguityNote?: string;
  escalationDetected?: boolean;
  detailRounds?: number;
  lastMissingCount?: number;
  submissionFailed?: boolean;
  vagueGateAsked?: boolean;
  vagueGateVerified?: boolean;
  vagueGateSecondAsked?: boolean;
  portalClarificationAsked?: boolean;
  synthesizedSubject?: string;
  synthesizedDescription?: string;
  synthesisDone?: boolean;
  synthesisRetried?: boolean;
  followUpTicketKey?: string;
  followUpTicketSummary?: string;
  complaintDetected?: boolean;
  frustrationHandoffOffered?: boolean;
}

export interface ChatMessageMetadata {
  type?: 'summary_card' | 'kb_suggestions' | 'category_picker' | 'subcategory_picker' | 'confirmed';
  ticketKey?: string;
  intent?: IntakeIntent | null;
  fields?: IntakeCollectedFields & {
    category: string | null;
    subcategory: string | null;
    followUpTicketKey?: string;
    followUpTicketSummary?: string;
  };
  articles?: Array<{ id: number; title: string; excerpt: string }>;
  categories?: Array<{ id: string; name: string; description: string }>;
}

// ── Chat Widget Config ──

export interface PortalWidgetConfig {
  enabled: boolean;
  greeting: string;
  brandColor: string;
  position: 'bottom-right' | 'bottom-left';
  logoUrl?: string;
}

// ── SSE Event Types ──

export type PortalSSEEventType =
  | 'ticket:comment'
  | 'ticket:status_change'
  | 'ticket:assignment_change';

export interface PortalSSEEvent {
  type: PortalSSEEventType;
  ticketKey: string;
  data: Record<string, unknown>;
}

// ── API Response Types ──

export interface PortalTicketListResponse {
  tickets: PortalTicketSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PortalKbSearchResponse {
  articles: Array<{
    id: number;
    title: string;
    excerpt: string;
    category: string | null;
    labels: string | null;
    helpfulScore: number;
  }>;
  total: number;
}

export interface PortalCategoryTree {
  id: string;
  name: string;
  description?: string;
  children: PortalCategoryTree[];
}

// ── Portal Admin View Models ──

export interface PortalUserAdmin {
  id: number;
  email: string;
  display_name: string;
  org_name: string;
  org_id: number;
  auth_type: PortalUserAuthType;
  access_state: PortalUserAccessState;
  last_login: string;
  ticket_count: number;
}

export interface PortalOrgAdmin {
  id: number;
  name: string;
  domain: string | null;
  user_count: number;
  ticket_count: number;
}

export interface PortalMetrics {
  deflectionRate: number;
  chatResolutionRate: number;
  formCompletionRate: number;
  kbSearchSuccessRate: number;
  articleHelpfulness: number;
  medianTimeToTicket: number;
  portalAdoption: number;
  repeatDeflection: number;
}

// ── Per-org branding ──

export interface PortalOrgBranding {
  websiteUrl: string | null;
  logoUrl: string | null;   // http(s) or data: URI
  primary: string | null;   // hex
  secondary: string | null; // hex
  font: string | null;      // font family name (loadable web font)
}

// ── Per-org portal feature toggles ──

export interface PortalOrgFeatures {
  getHelp: boolean;
  kb: boolean;
  support: boolean;
  onboarding: boolean;
  /** Guild / Fine & Country "Raise a ticket" intake. Gated per-org via the
   *  `portal_raise_ticket_org_ids` setting (allowlist of org ids). */
  raiseTicket?: boolean;
}

// ── Customer Dashboards (Onboarding + Support) ──
// Scoped per-customer by BC Account Number. Built from jira_issue_cache.

export interface OnboardingDashboardRow {
  key: string;
  summary: string;
  stage: string;              // Jira status = current stage (v1)
  owner: string | null;       // Jira assignee
  created: string;            // logged date
  ageDays: number;            // whole days since logged
  ageBucket: 'ok' | 'over7' | 'over14' | 'over21' | 'breach'; // >30 = SLA breach
  priority: string;           // Jira priority name
}

export interface OnboardingDashboardSummary {
  total: number;
  over7: number;
  over14: number;
  over21: number;   // escalation trigger
  breach: number;   // over 30 days = SLA breach
}

export interface OnboardingDashboardResponse {
  summary: OnboardingDashboardSummary;
  rows: OnboardingDashboardRow[];
  bcAccountNumber: string | null;
}

export interface SupportDashboardRow {
  key: string;
  summary: string;
  owner: string | null;       // Jira assignee
  type: string;               // resolved: Tier 2/3, Starberry, TPJ, etc.
  status: string;             // raw Jira status = current stage
  created: string;            // logged date
  ageDays: number;
  daysSinceUpdate: number;    // whole days since last Jira update
  stale: boolean;             // no update for 3+ days
  overSla: boolean;           // SLA breached
  businessCritical: boolean;  // Priority = Blocker
  priority: string;
  sprintState: 'allocated' | 'awaiting' | 'na';
  tierGroup: 'support' | 't3' | 'development' | 'other'; // Support = Customer Care + Tier 2
  escalation: boolean;        // Request Type = Escalation
}

export interface SupportDashboardSummary {
  total: number;
  stale: number;              // 3+ days no update
  overSla: number;
  businessCritical: number;
  awaitingSprint: number;
  allocatedSprint: number;
  escalations: number;        // Request Type = Escalation
  tierSupport: number;        // current tier = Customer Care or Tier 2
  tierT3: number;             // current tier = Tier 3
  tierDevelopment: number;    // current tier = Development
}

export interface SupportDashboardResponse {
  summary: SupportDashboardSummary;
  rows: SupportDashboardRow[];
  bcAccountNumber: string | null;
}
