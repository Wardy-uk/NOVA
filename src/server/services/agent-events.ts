import { query, execute } from './database.js';

const ALLOWED_EVENT_TYPES = [
  'next_action_proposed',
  'action_taken',
  'action_deferred',
  'rank_override',
  'defer_overrun',
  'next_update_commitment_set',
  'hygiene_flagged',
  'hygiene_pass_completed',
  'auto_close_backstop_fired',
] as const;

export type AgentEventType = typeof ALLOWED_EVENT_TYPES[number];

export interface AgentEvent {
  id: number;
  event_type: string;
  ticket_key: string | null;
  agent_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

type CacheInvalidationCallback = (agentId: string) => void;
const invalidationListeners: CacheInvalidationCallback[] = [];

export function onEventWritten(cb: CacheInvalidationCallback): void {
  invalidationListeners.push(cb);
}

export function isValidEventType(type: string): type is AgentEventType {
  return (ALLOWED_EVENT_TYPES as readonly string[]).includes(type);
}

export async function recordEvent(
  eventType: AgentEventType,
  agentId: string | null,
  ticketKey: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  await execute(
    `INSERT INTO agent_events (event_type, ticket_key, agent_id, payload, created_at)
     VALUES (?, ?, ?, ?, SYSUTCDATETIME())`,
    [eventType, ticketKey, agentId, JSON.stringify(payload)],
  );
  if (agentId) {
    for (const cb of invalidationListeners) cb(agentId);
  }
}

export async function getEventsForTicket(
  ticketKey: string,
  limit = 50,
): Promise<AgentEvent[]> {
  const rows = await query<AgentEvent>(
    `SELECT TOP(?) id, event_type, ticket_key, agent_id, payload, created_at
     FROM agent_events
     WHERE ticket_key = ?
     ORDER BY created_at DESC`,
    [limit, ticketKey],
  );
  return rows.map(parsePayload);
}

export async function getAgentEventsToday(
  agentId: string,
): Promise<AgentEvent[]> {
  const rows = await query<AgentEvent>(
    `SELECT id, event_type, ticket_key, agent_id, payload, created_at
     FROM agent_events
     WHERE agent_id = ?
       AND created_at >= CAST(SYSUTCDATETIME() AS DATE)
     ORDER BY created_at DESC`,
    [agentId],
  );
  return rows.map(parsePayload);
}

function parsePayload(row: AgentEvent): AgentEvent {
  if (typeof row.payload === 'string') {
    try { row.payload = JSON.parse(row.payload); } catch { row.payload = {}; }
  }
  return row;
}
