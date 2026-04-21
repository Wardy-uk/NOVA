import { query, queryOne, execute } from './database.js';

export type AvailabilityStatus = 'available' | 'annual_leave' | 'sick' | 'wfh' | 'training' | 'meeting' | 'offline';

export interface AgentAvailability {
  id: number;
  roster_id: number;
  available_date: string;
  status: AvailabilityStatus;
  reason: string | null;
  display_name?: string;
  pool?: string;
}

export interface DaySnapshot {
  date: string;
  available: AgentAvailability[];
  unavailable: AgentAvailability[];
  totalRoster: number;
  availableCount: number;
}

export class AgentAvailabilityService {
  async setAvailability(rosterId: number, date: string, status: AvailabilityStatus, reason?: string): Promise<void> {
    await execute(`
      MERGE agent_availability AS target
      USING (SELECT ? AS roster_id, ? AS available_date) AS source
      ON target.roster_id = source.roster_id AND target.available_date = source.available_date
      WHEN MATCHED THEN UPDATE SET status = ?, reason = ?, updated_at = GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (roster_id, available_date, status, reason) VALUES (?, ?, ?, ?)
    `, [rosterId, date, status, reason ?? null, rosterId, date, status, reason ?? null]);
  }

  async bulkSetAvailability(entries: { rosterId: number; date: string; status: AvailabilityStatus; reason?: string }[]): Promise<number> {
    let count = 0;
    for (const entry of entries) {
      await this.setAvailability(entry.rosterId, entry.date, entry.status, entry.reason);
      count++;
    }
    return count;
  }

  async getAvailability(rosterId: number, startDate: string, endDate: string): Promise<AgentAvailability[]> {
    return query<AgentAvailability>(`
      SELECT a.*, r.display_name, r.pool
      FROM agent_availability a
      JOIN agent_roster r ON r.id = a.roster_id
      WHERE a.roster_id = ? AND a.available_date BETWEEN ? AND ?
      ORDER BY a.available_date
    `, [rosterId, startDate, endDate]);
  }

  async getDaySnapshot(date: string, pool?: string): Promise<DaySnapshot> {
    const poolFilter = pool ? `AND r.pool = ?` : '';
    const params: unknown[] = pool ? [date, pool] : [date];

    const allAgents = await query<any>(`
      SELECT r.id, r.display_name, r.pool,
             a.status, a.reason, a.available_date
      FROM agent_roster r
      LEFT JOIN agent_availability a ON a.roster_id = r.id AND a.available_date = ?
      WHERE r.active = 1 ${poolFilter}
      ORDER BY r.display_name
    `, params);

    const available: AgentAvailability[] = [];
    const unavailable: AgentAvailability[] = [];

    for (const row of allAgents) {
      const entry: AgentAvailability = {
        id: row.id,
        roster_id: row.id,
        available_date: date,
        status: row.status ?? 'available',
        reason: row.reason,
        display_name: row.display_name,
        pool: row.pool,
      };

      if (!row.status || row.status === 'available' || row.status === 'wfh') {
        available.push(entry);
      } else {
        unavailable.push(entry);
      }
    }

    return {
      date,
      available,
      unavailable,
      totalRoster: allAgents.length,
      availableCount: available.length,
    };
  }

  async getUpcomingAbsences(days: number = 14): Promise<AgentAvailability[]> {
    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

    return query<AgentAvailability>(`
      SELECT a.*, r.display_name, r.pool
      FROM agent_availability a
      JOIN agent_roster r ON r.id = a.roster_id
      WHERE a.available_date BETWEEN ? AND ?
        AND a.status NOT IN ('available', 'wfh')
      ORDER BY a.available_date, r.display_name
    `, [today, end]);
  }

  async clearAvailability(rosterId: number, date: string): Promise<void> {
    await execute(`DELETE FROM agent_availability WHERE roster_id = ? AND available_date = ?`, [rosterId, date]);
  }

  async isAgentAvailable(rosterId: number, date?: string): Promise<boolean> {
    const d = date ?? new Date().toISOString().slice(0, 10);
    const row = await queryOne<any>(
      `SELECT status FROM agent_availability WHERE roster_id = ? AND available_date = ?`,
      [rosterId, d],
    );
    if (!row) return true;
    return row.status === 'available' || row.status === 'wfh';
  }

  async getCapacitySummary(pool?: string): Promise<{ pool: string; total: number; available: number; onLeave: number }[]> {
    const today = new Date().toISOString().slice(0, 10);
    const poolFilter = pool ? `AND r.pool = ?` : '';
    const params: unknown[] = pool ? [today, pool] : [today];

    const rows = await query<any>(`
      SELECT r.pool,
             COUNT(*) as total,
             SUM(CASE WHEN a.status IS NULL OR a.status IN ('available', 'wfh') THEN 1 ELSE 0 END) as available,
             SUM(CASE WHEN a.status IS NOT NULL AND a.status NOT IN ('available', 'wfh') THEN 1 ELSE 0 END) as on_leave
      FROM agent_roster r
      LEFT JOIN agent_availability a ON a.roster_id = r.id AND a.available_date = ?
      WHERE r.active = 1 ${poolFilter}
      GROUP BY r.pool
    `, params);

    return rows.map((r: any) => ({
      pool: r.pool,
      total: r.total,
      available: r.available,
      onLeave: r.on_leave,
    }));
  }
}
