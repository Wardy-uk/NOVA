import { query, execute } from './database.js';
import { recordEvent } from './agent-events.js';
import { createWorkingDayClock, type WorkingDayClock } from '../../shared/utils/workingDayClock.js';

export const DEFER_REASONS = {
  'waiting_on_customer': { label: 'Waiting on customer', defaultHours: null },
  'waiting_on_t2': { label: 'Waiting on T2', defaultHours: 8 },
  'waiting_on_dev': { label: 'Waiting on dev', defaultHours: 40 },
  'on_a_call': { label: 'On a call / phone follow-up', defaultHours: 2, maxHours: 2 },
  'coffee_break': { label: 'Need to grab a coffee', defaultMinutes: 10 },
  'disagree_with_ranking': { label: 'I disagree with the ranking', defaultMinutes: 30 },
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
  private clock: WorkingDayClock;

  constructor(bankHolidays: string[] = []) {
    this.clock = createWorkingDayClock({}, bankHolidays);
  }

  computeResurfaceAt(reason: DeferReason, customResurfaceAt?: string): Date {
    const config = DEFER_REASONS[reason];
    if (customResurfaceAt) {
      const custom = new Date(customResurfaceAt);
      if (!isNaN(custom.getTime())) {
        if ('maxHours' in config && config.maxHours) {
          const maxAt = new Date(Date.now() + config.maxHours * 3600_000);
          return custom.getTime() > maxAt.getTime() ? maxAt : custom;
        }
        return custom;
      }
    }

    if ('defaultMinutes' in config) {
      return new Date(Date.now() + (config as { defaultMinutes: number }).defaultMinutes * 60_000);
    }
    const hours = (config as { defaultHours: number | null }).defaultHours;
    if (hours === null) {
      return this.clock.addWorkingDays(new Date(), 10);
    }
    return this.clock.addWorkingHours(new Date(), hours);
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

    if (reason === 'disagree_with_ranking') {
      await recordEvent('rank_override', agentId, ticketKey, {
        override_reason: 'Agent disagreed with ranking',
        note: note ?? null,
      });
    }

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

      // Auto-resolve time-based defers that have resurfaced
      if (row.reason !== 'waiting_on_customer' && row.reason !== 'waiting_on_t2' && row.reason !== 'waiting_on_dev') {
        await this.resolveDefer(row.ticket_key, row.agent_id, 'timer_elapsed');
      }
    }
    return emitted;
  }
}
