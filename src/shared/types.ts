import { z } from 'zod';

// ---------- Task ----------
export const TaskStatusSchema = z.enum([
  'open', 'in_progress', 'done', 'snoozed', 'dismissed',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSourceSchema = z.enum([
  'jira', 'milestone',
]);
export type TaskSource = z.infer<typeof TaskSourceSchema>;

export const TaskCategorySchema = z.enum([
  'urgent_sla', 'team', 'project', 'admin', 'personal',
]);
export type TaskCategory = z.infer<typeof TaskCategorySchema>;

export interface Task {
  id: string;
  source: string;
  source_id: string | null;
  source_url: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  due_date: string | null;
  sla_breach_at: string | null;
  category: string | null;
  is_pinned: boolean;
  snoozed_until: string | null;
  last_synced: string | null;
  raw_data: unknown;
  created_at: string;
  updated_at: string;
}

// ---------- MCP Server Status ----------
export type McpServerStatus =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'unavailable'
  | 'error';

export interface McpServerInfo {
  name: string;
  status: McpServerStatus;
  toolCount: number;
  lastError: string | null;
  lastConnected: string | null;
}

// ---------- API Responses ----------
export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

// ---------- Health ----------
export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptime: number;
  servers: McpServerInfo[];
}

// ---------- Integrations ----------
export interface IntegrationField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url' | 'group_roles' | 'toggle' | 'select';
  placeholder?: string;
  required: boolean;
  options?: string[];
}

export interface SsoGroupRoleMapping {
  groupId: string;
  groupName: string;
  novaRole: string;
}

export interface IntegrationDefinition {
  id: string;
  name: string;
  description: string;
  fields: IntegrationField[];
  enabledKey: string;
  authType: 'credentials' | 'device_code';
  superAdminOnly?: boolean;
}

export interface IntegrationStatus {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  fields: IntegrationField[];
  values: Record<string, string>;
  mcpStatus: McpServerStatus;
  lastError: string | null;
  lastConnected: string | null;
  toolCount: number;
  authType: 'credentials' | 'device_code';
  loggedIn: boolean;
}

// ---------- Task Update (for pin/snooze/dismiss) ----------
export const TaskUpdateSchema = z.object({
  is_pinned: z.boolean().optional(),
  snoozed_until: z.string().nullable().optional(),
  status: TaskStatusSchema.optional(),
});
export type TaskUpdate = z.infer<typeof TaskUpdateSchema>;

// ---------- Business Central ----------
export interface BcCustomerLite {
  id: number;
  bc_id: string;
  number: string | null;
  display_name: string;
  email: string | null;
  phone_number: string | null;
  address: string | null;             // addressLine1 from BC
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  tax_registration_number: string | null;
  primary_contact_name: string | null;
}

// ---------- Adobe Sign ----------
export interface AdobeSignLibraryDocument {
  id: string;
  name: string;
  createdDate: string;
  modifiedDate: string;
  status: string;
  sharingMode: string;
  templateTypes: string[];
}

export interface AdobeSignFormField {
  name: string;
  displayLabel?: string;
  contentType: string;
  inputType?: string;
  defaultValue?: string;
  options?: string[];
  required?: boolean;
  assignee?: string;
  multiLine?: boolean;
  isMultiLine?: boolean;
}

export interface ContractTerm {
  id: number;
  label: string;
  body: string;
  active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface AdobeSignAgreement {
  id: number;
  agreement_id: string;
  contract_id: number | null;
  template_id: number | null;
  name: string;
  status: string;
  sender_email: string | null;
  signer_emails: string | null;
  filled_fields: string | null;
  created_via_nova: number;
  adobe_created_date: string | null;
  adobe_expiration_date: string | null;
  signed_document_url: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}
