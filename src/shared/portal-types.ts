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

/** Customer-facing display of an agent's name: first name only (e.g. "Heidi
 *  Power" → "Heidi"). Emails and blanks pass through unchanged. */
export function firstNameOnly(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes('@')) return trimmed || null;
  return trimmed.split(/\s+/)[0];
}

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
  /** The user's effective role in THIS org (per-membership, home falls back to
   *  their base role). Drives what they can see/do while switched into it. */
  role: PortalUserRole;
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
  /** Additional people to CC on the ticket (added as JSM request participants). */
  ccEmails: z.array(z.string().max(200)).max(10).optional(),
});

export type PortalNetworkRequestInput = z.infer<typeof PortalNetworkRequestSchema>;

// ── Raise-a-Ticket routes (top-of-form selector, configurable per org) ──

export type PortalSupportRoute = 'support' | 'development' | 'onboarding';

export const PORTAL_SUPPORT_ROUTE_LABELS: Record<PortalSupportRoute, string> = {
  support: 'Raise to Support',
  development: 'Triaged for Development',
  onboarding: 'Onboarding Request',
};

/** Order routes appear in the selector / admin config. */
export const PORTAL_SUPPORT_ROUTE_ORDER: PortalSupportRoute[] = ['support', 'development', 'onboarding'];

/** Default when an org has no explicit config — just the Support route.
 *  (Orgs already live on the form before this default existed are backfilled to
 *  support+development by a schema migration, so their behaviour is unchanged.) */
export const DEFAULT_PORTAL_SUPPORT_ROUTES: PortalSupportRoute[] = ['support'];

/** Parse the stored CSV into a validated, de-duped, ordered route list. */
export function parseSupportRoutes(raw: string | null | undefined): PortalSupportRoute[] {
  if (!raw || !raw.trim()) return [...DEFAULT_PORTAL_SUPPORT_ROUTES];
  const set = new Set(
    raw.split(',').map(s => s.trim()).filter((s): s is PortalSupportRoute =>
      (PORTAL_SUPPORT_ROUTE_ORDER as string[]).includes(s)),
  );
  const routes = PORTAL_SUPPORT_ROUTE_ORDER.filter(r => set.has(r));
  return routes.length > 0 ? routes : [...DEFAULT_PORTAL_SUPPORT_ROUTES];
}

// ── Onboarding Request (generic customer set-up form → setup + QA tickets) ──
// Superset of the Guild Membership Set-Up Form + the "new agent joining" email
// (NT-24880), with generic labels so any customer can use it.

const OnboardingUserSchema = z.object({
  name: z.string().max(200).optional(),
  email: z.string().max(200).optional(),
  accessLevel: z.string().max(120).optional(),
  jobTitle: z.string().max(150).optional(),
});

export type PortalOnboardingUser = z.infer<typeof OnboardingUserSchema>;

export const PortalOnboardingRequestSchema = z.object({
  // Business
  brand: z.string().min(1).max(300),
  branch: z.string().min(1).max(300),
  // Mandatory (backlog #8, R1): the 30-day onboarding SLA and billing depend on
  // it. Required at submission — the form rejects an empty value. YYYY-MM-DD.
  invoiceCommencementDate: z.string().min(1, 'Invoice commencement date is required').max(20),
  network: z.string().max(120).optional(),           // Guild / Fine & Country / other
  registeredCompanyName: z.string().max(300).optional(),
  membershipArea: z.string().max(200).optional(),
  addressLine: z.string().max(300).optional(),
  town: z.string().max(150).optional(),
  county: z.string().max(150).optional(),
  postcode: z.string().max(30).optional(),
  // Services offered
  offersSales: z.boolean().default(false),
  offersLettings: z.boolean().default(false),
  salesEmail: z.string().max(200).optional(),
  lettingsEmail: z.string().max(200).optional(),
  salesPhone: z.string().max(60).optional(),
  lettingsPhone: z.string().max(60).optional(),
  // Marketing
  portals: z.array(z.string().max(60)).max(10).optional(),
  portalsOther: z.string().max(200).optional(),
  websiteProvider: z.string().max(200).optional(),
  // Users to set up
  users: z.array(OnboardingUserSchema).max(30).optional(),
  // Referral / CRM
  crmAccountName: z.string().max(300).optional(),
  // The customer's designated (free) Lead Pro user — captured so it isn't assumed at setup.
  leadProUser: z.string().max(200).optional(),
  // Magazine
  magazineReminderEmails: z.string().max(1000).optional(),
  magazineRegion: z.string().max(150).optional(),
  // Digital interactive magazine
  dimSales: z.boolean().optional(),
  dimLettings: z.boolean().optional(),
  dimIncludeSoldLet: z.boolean().optional(),
  dimOrderBy: z.string().max(60).optional(),          // Most Expensive / Recently Added
  dimApprovalEmail: z.string().max(200).optional(),
  // Regional market report
  marketReportRegion: z.string().max(150).optional(),
  // Lead generation
  leadResponderPostcodes: z.string().max(500).optional(),
  leadContactName: z.string().max(200).optional(),
  leadContactEmail: z.string().max(200).optional(),
  leadContactPhone: z.string().max(60).optional(),
  ivtUrl: z.string().max(500).optional(),
  ivtPresentOn: z.string().max(60).optional(),        // Main website / Separate mini site
  valuationNotificationEmails: z.string().max(500).optional(),
  // New agent joining (NT-24880)
  newAgentName: z.string().max(200).optional(),
  newAgentEmail: z.string().max(200).optional(),
  newAgentPhone: z.string().max(60).optional(),
  newAgentAddress: z.string().max(400).optional(),
  micrositeUrl: z.string().max(500).optional(),
  // For the QA ticket
  bymUrl: z.string().max(500).optional(),
  // Free text
  notes: z.string().max(5000).optional(),
});

export type PortalOnboardingRequestInput = z.infer<typeof PortalOnboardingRequestSchema>;

// ── Onboarding escalation policy (per org, configurable by org admins) ──
// Multi-level schedule: at each day threshold NOVA can send a progress update to
// the customer and/or raise an internal escalation to named recipients. Fires
// once per onboarding per level; disabled by default until reviewed & enabled.

export const EscalationRecipientSchema = z.object({
  name: z.string().max(200),
  email: z.string().max(200),
});
export type EscalationRecipient = z.infer<typeof EscalationRecipientSchema>;

export const EscalationLevelSchema = z.object({
  day: z.number().int().min(1).max(365),
  name: z.string().min(1).max(120),
  /** Send a scheduled progress update to the onboarding's requestor. */
  sendCustomerUpdate: z.boolean().default(false),
  /** Raise an internal escalation to the escalation recipients. */
  escalate: z.boolean().default(false),
  escalationRecipients: z.array(EscalationRecipientSchema).max(30).default([]),
  /** Also-informed contacts (cc'd for visibility, no action required). */
  informRecipients: z.array(EscalationRecipientSchema).max(30).default([]),
  note: z.string().max(2000).optional(),
});
export type EscalationLevel = z.infer<typeof EscalationLevelSchema>;

// ── Head Office users (per-org reference list) ──
// Documentation of an org's head-office contacts — maintained by the org's admin
// and visible to support, so "who are the HO users?" is answered in one place.
// NOT an escalation recipient source: progress updates go to the ticket requestor.
export const HeadOfficeUserSchema = z.object({
  name: z.string().max(200),
  email: z.string().max(200),
  title: z.string().max(150).optional(),
  /** Portal role to grant this user. Head office defaults to Leader (sees all of
   *  their org's tickets). */
  role: z.enum(['requester', 'leader', 'manager', 'org_admin', 'admin']).default('leader'),
});
export type HeadOfficeUser = z.infer<typeof HeadOfficeUserSchema>;
export const HeadOfficeUsersSchema = z.array(HeadOfficeUserSchema).max(100);

export const OnboardingEscalationPolicySchema = z.object({
  /** Master switch — nothing is sent while false. Defaults off for safety. */
  enabled: z.boolean().default(false),
  /** Count age in working days (Mon–Fri) rather than calendar days. */
  workingDays: z.boolean().default(true),
  levels: z.array(EscalationLevelSchema).max(20).default([]),
});
export type OnboardingEscalationPolicy = z.infer<typeof OnboardingEscalationPolicySchema>;

/** A neutral three-checkpoint template (progress update + two escalation tiers).
 *  Recipients are intentionally empty — an admin adds the real contacts per org
 *  before enabling, so nothing is ever sent to a guessed address, and no specific
 *  customer or person is baked into the default. */
export const DEFAULT_ESCALATION_POLICY: OnboardingEscalationPolicy = {
  enabled: false,
  workingDays: true,
  levels: [
    {
      day: 7,
      name: 'Day 7 — Progress Update',
      sendCustomerUpdate: true,
      escalate: false,
      escalationRecipients: [],
      informRecipients: [],
      note: 'Progress update: completed activities, work in progress, dependencies and expected next milestones. Communicate proactively if meaningful progress happens sooner.',
    },
    {
      day: 14,
      name: 'Day 14 — Progress Update & First Escalation',
      sendCustomerUpdate: true,
      escalate: true,
      escalationRecipients: [],
      informRecipients: [],
      note: 'Raised if the onboarding is not complete by Day 14. Where delays are customer-side, assistance may be requested; where purely internal, the customer is still informed for visibility.',
    },
    {
      day: 21,
      name: 'Day 21 — Progress Update & Senior Escalation',
      sendCustomerUpdate: true,
      escalate: true,
      escalationRecipients: [],
      informRecipients: [],
      note: 'Senior stakeholder escalation if still incomplete by Day 21, to ensure every available action has been taken to remove blockers and complete the onboarding.',
    },
  ],
};

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
  /** Which routes the Raise-a-Ticket top selector offers this org. Absent →
   *  the default pair (support, development). */
  supportRoutes?: PortalSupportRoute[];
}

// ── Customer Dashboards (Onboarding + Support) ──
// Scoped per-customer by BC Account Number. Built from jira_issue_cache.

export interface OnboardingDashboardRow {
  key: string;
  summary: string;
  stage: string;              // Jira status = current stage (v1)
  owner: string | null;       // Jira assignee
  reporterEmail: string | null; // requestor — recipient for scheduled progress updates
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
