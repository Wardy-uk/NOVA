import { query, execute } from './database.js';
import { recordEvent } from './agent-events.js';
import { addBusinessHours, addBusinessMinutes } from '../utils/business-hours.js';

export const DEFER_REASONS = {
  'coffee_break': { label: 'Coffee break', defaultMinutes: 10 },
  'in_meeting': { label: 'In a meeting', defaultMinutes: 30 },
  'end_of_day': { label: 'End of day', nextWorkingDay: true },
  'awaiting_customer': { label: 'Awaiting customer', businessHours: 4 },
  'blocked_by_third_party': { label: 'Blocked by third party', businessHours: 24 },
  'need_more_info': { label: 'Need more info', businessHours: 2 },
} as const;

export type DeferReason = keyof typeof DEFER_REASONS;

export interface TicketDefer {
  id: number;
  ticket_key: string;
  agent_id: string;
  reason: string;
  deferred_at: string;
  resurface_at: string;
  note: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
}

export function isValidDeferReason(reason: string): reason is DeferReason {
  return reason in DEFER_REASONS;
}

export class DeferService {
  constructor() {}

  computeResurfaceAt(reason: DeferReason, customResurfaceAt?: string): Date {
    const config = DEFER_REASONS[reason];
    if (customResurfaceAt) {
      const custom = new Date(customResurfaceAt);
      if (!isNaN(custom.getTime())) return custom;
    }

    if ('defaultMinutes' in config) {
      return new Date(Date.now() + config.defaultMinutes * 60_000);
    }
    if ('nextWorkingDay' in config) {
      return addBusinessMinutes(new Date(Date.now() + 8 * 3600_000), 0);
    }
    if ('businessHours' in config) {
      return addBusinessHours(new Date(), config.businessHours);
    }
    return new Date(Date.now() + 10 * 60_000);
  }

  async deferTicket(
    ticketKey: string,
    agentId: string,
    reason: DeferReason,
    resurface_at?: string,
    note?: string,
  ): Promise<TicketDefer> {
    // Resolve any existing active defer for this ticket/agent
    await execute(
      `UPDATE ticket_defers SET resolved_at = SYSUTCDATETIME(), resolved_by = 'system_new_defer'
       WHERE ticket_key = ? AND agent_id = ? AND resolved_at IS NULL`,
      [ticketKey, agentId],
    );

    const resurfaceAt = this.computeResurfaceAt(reason, resurface_at);

    await execute(
      `INSERT INTO ticket_defers (ticket_key, agent_id, reason, resurface_at, note)
       VALUES (?, ?, ?, ?, ?)`,
      [ticketKey, agentId, reason, resurfaceAt, note ?? null],
    );

    await recordEvent('action_deferred', agentId, ticketKey, {
      reason,
      deferred_until: resurfaceAt.toISOString(),
      note: note ?? null,
    });

    const row = await query<TicketDefer>(
      `SELECT TOP 1 * FROM ticket_defers
       WHERE ticket_key = ? AND agent_id = ? AND resolved_at IS NULL
       ORDER BY deferred_at DESC`,
      [ticketKey, agentId],
    );
    return row[0]!;
  }

  async getActiveDefers(agentId: string): Promise<TicketDefer[]> {
    return query<TicketDefer>(
      `SELECT * FROM ticket_defers
       WHERE agent_id = ? AND resolved_at IS NULL
       ORDER BY resurface_at ASC`,
      [agentId],
    );
  }

  async resolveDefer(ticketKey: string, agentId: string, resolvedBy: string): Promise<void> {
    await execute(
      `UPDATE ticket_defers SET resolved_at = SYSUTCDATETIME(), resolved_by = ?
       WHERE ticket_key = ? AND agent_id = ? AND resolved_at IS NULL`,
      [resolvedBy, ticketKey, agentId],
    );
  }

  async resolveDefersForTicket(ticketKey: string, resolvedBy: string): Promise<void> {
    await execute(
      `UPDATE ticket_defers SET resolved_at = SYSUTCDATETIME(), resolved_by = ?
       WHERE ticket_key = ? AND resolved_at IS NULL`,
      [resolvedBy, ticketKey],
    );
  }

  async sweepOverdueDefers(): Promise<number> {
    const overdue = await query<{ id: number; ticket_key: string; agent_id: string; reason: string; resurface_at: Date }>(
      `SELECT id, ticket_key, agent_id, reason, resurface_at FROM ticket_defers
       WHERE resolved_at IS NULL AND resurface_at <= SYSUTCDATETIME()`,
    );

    let emitted = 0;
    for (const row of overdue) {
      const resurfaceAt = new Date(row.resurface_at);
      const minutesOverdue = (Date.now() - resurfaceAt.getTime()) / 60_000;

      if (minutesOverdue >= 30) {
        await recordEvent('defer_overrun', row.agent_id, row.ticket_key, {
          defer_reason: row.reason,
          hours_overdue: Math.round(minutesOverdue / 60 * 10) / 10,
        });
        emitted++;
      }

      // Auto-resolve time-based defers that have resurfaced (keep awaiting_customer and blocked_by_third_party active until manual resolve)
      if (row.reason !== 'awaiting_customer' && row.reason !== 'blocked_by_third_party') {
        await this.resolveDefer(row.ticket_key, row.agent_id, 'timer_elapsed');
      }
    }
    return emitted;
  }
}
