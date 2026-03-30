import { z } from 'zod';

// ---------- Task ----------
export const TaskStatusSchema = z.enum([
  'open', 'in_progress', 'done', 'snoozed', 'dismissed',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSourceSchema = z.enum([
  'jira', 'planner', 'todo', 'monday', 'email', 'calendar', 'milestone',
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
  type: 'text' | 'password' | 'url' | 'group_roles';
  placeholder?: string;
  required: boolean;
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

// ---------- Adobe Sign ----------
export interface ContractTemplateFieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'email' | 'select' | 'textarea';
  required?: boolean;
  defaultValue?: string;
  options?: string[];
}

export interface ContractTemplate {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  fields_schema: string | null;
  adobe_library_doc_id: string | null;
  file_name: string | null;
  file_mime: string | null;
  has_file?: boolean;
  status: string;
  created_by: number | null;
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
