import { z } from 'zod';

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

export type PortalUserRole = 'requester' | 'org_admin' | 'admin';

export interface PortalUser {
  id: number;
  external_id: string;
  org_id: number;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: PortalUserRole;
  last_login: string;
  created_at: string;
}

export interface PortalAuthPayload {
  userId: number;
  email: string;
  orgId: number;
  orgName: string;
  role: PortalUserRole;
}

// ── Chat ──

export type ChatSessionStatus = 'active' | 'resolved' | 'abandoned' | 'handed_off';
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
  | 'ticket_created'
  | 'chat_started'
  | 'chat_resolved'
  | 'chat_handoff'
  | 'form_started'
  | 'form_completed'
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

// ── Portal Ticket (view model for API responses) ──

export interface PortalTicketSummary {
  key: string;
  summary: string;
  status: string;
  priority: string;
  created: string;
  updated: string;
  assignee: string | null;
  reporter: string | null;
  latestComment: string | null;
}

export interface PortalTicketDetail extends PortalTicketSummary {
  description: string | null;
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
  from: string | null;
  to: string;
  changedAt: string;
  changedBy: string | null;
}

export interface PortalSlaStatus {
  name: string;
  remaining: string | null;
  breached: boolean;
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
  children: PortalCategoryTree[];
}

// ── Portal Admin View Models ──

export interface PortalUserAdmin {
  id: number;
  email: string;
  display_name: string;
  org_name: string;
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
}
