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
