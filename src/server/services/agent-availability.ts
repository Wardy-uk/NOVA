import sql from 'mssql';
import { query, queryOne, execute } from './database.js';
import type { SettingsQueries } from '../db/settings-store.js';

export type AvailabilityStatus = 'available' | 'annual_leave' | 'sick' | 'other_leave' | 'wfh' | 'training' | 'meeting' | 'offline';

/** 'manual' rows are set by a human in the UI and win over the People HR sync for that date. */
export type AvailabilitySource = 'peoplehr' | 'manual';

export interface AgentAvailability {
  id: number;
  roster_id: number;
  available_date: string;
  status: AvailabilityStatus;
  reason: string | null;
  source?: AvailabilitySource;
  set_by?: string | null;
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

export interface KpiAgent {
  AgentId: number;
  display_name: string;
  pool: string;
  PeopleHrId: string | null;
}

export class AgentAvailabilityService {
  private kpiPool: sql.ConnectionPool | null = null;

  constructor(private settings?: SettingsQueries) {}

  private async getKpiPool(): Promise<sql.ConnectionPool | null> {
    if (this.kpiPool?.connected) return this.kpiPool;
    if (!this.settings) return null;
    const server = this.settings.get('kpi_sql_server');
    const database = this.settings.get('kpi_sql_database');
    const user = this.settings.get('kpi_sql_user');
    const password = this.settings.get('kpi_sql_password');
    if (!server || !database || !user || !password) return null;
    try {
      this.kpiPool = await new sql.ConnectionPool({
        server, database, user, password,
        options: { encrypt: true, trustServerCertificate: true },
        requestTimeout: 30000,
      }).connect();
      return this.kpiPool;
    } catch { return null; }
  }

  /**
   * Run a KPI query with one reconnect-and-retry. Azure SQL silently drops idle
   * connections (~30 min) while pool.connected can still report true, so a cached
   * pool's first query throws. Without this, a single stale-pool failure would
   * sink the scheduled People HR sync indefinitely. On any query error we discard
   * the pool, rebuild a fresh one, and retry once.
   */
  private async runKpiQuery(text: string): Promise<sql.IRecordSet<any> | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const pool = await this.getKpiPool();
      if (!pool) return null;
      try {
        const result = await pool.request().query(text);
        return result.recordset;
      } catch (err) {
        try { await this.kpiPool?.close(); } catch { /* ignore */ }
        this.kpiPool = null;
        if (attempt === 1) {
          console.warn('[agent-availability] KPI query failed after retry:', err instanceof Error ? err.message : err);
          return null;
        }
      }
    }
    return null;
  }

  async getAgentsFromKpiPublic(): Promise<KpiAgent[]> {
    return this.getAgentsFromKpi();
  }

  private async getAgentsFromKpi(): Promise<KpiAgent[]> {
    const recordset = await this.runKpiQuery(`
      SELECT AgentId,
             LTRIM(RTRIM(AgentName)) + ' ' + LTRIM(RTRIM(ISNULL(AgentSurname, ''))) AS display_name,
             LOWER(Team) AS pool,
             PeopleHrId
      FROM dbo.Agent WHERE IsActive = 1 AND Department = 'NT'
      ORDER BY AgentName
    `);
    return recordset ?? [];
  }

  /**
   * Upsert one agent-day. A 'manual' write always wins; a 'peoplehr' write will
   * not overwrite an existing 'manual' row, so a same-day override survives the
   * sync until the date rolls over and a fresh row is written for the new day.
   */
  async setAvailability(
    rosterId: number,
    date: string,
    status: AvailabilityStatus,
    reason?: string,
    src: AvailabilitySource = 'peoplehr',
    setBy?: string,
  ): Promise<void> {
    await execute(`
      MERGE agent_availability AS target
      USING (SELECT ? AS roster_id, ? AS available_date) AS source
      ON target.roster_id = source.roster_id AND target.available_date = source.available_date
      WHEN MATCHED AND (? = 'manual' OR ISNULL(target.source, 'peoplehr') <> 'manual')
        THEN UPDATE SET status = ?, reason = ?, source = ?, set_by = ?, updated_at = GETUTCDATE()
      WHEN NOT MATCHED
        THEN INSERT (roster_id, available_date, status, reason, source, set_by) VALUES (?, ?, ?, ?, ?, ?);
    `, [
      rosterId, date,
      src, status, reason ?? null, src, setBy ?? null,
      rosterId, date, status, reason ?? null, src, setBy ?? null,
    ]);
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
    const agents = await this.getAgentsFromKpi();
    const agent = agents.find(a => a.AgentId === rosterId);

    const rows = await query<any>(`
      SELECT * FROM agent_availability
      WHERE roster_id = ? AND available_date BETWEEN ? AND ?
      ORDER BY available_date
    `, [rosterId, startDate, endDate]);

    return rows.map((r: any) => ({
      ...r,
      display_name: agent?.display_name ?? `Agent ${rosterId}`,
      pool: agent?.pool ?? 'cc',
    }));
  }

  async getDaySnapshot(date: string, pool?: string): Promise<DaySnapshot> {
    const agents = await this.getAgentsFromKpi();
    const filtered = pool ? agents.filter(a => a.pool === pool) : agents;
    const agentIds = filtered.map(a => a.AgentId);

    let availRows: any[] = [];
    if (agentIds.length > 0) {
      availRows = await query<any>(`
        SELECT roster_id, status, reason, source, set_by
        FROM agent_availability
        WHERE available_date = ? AND roster_id IN (${agentIds.map(() => '?').join(',')})
      `, [date, ...agentIds]);
    }
    const availMap = new Map(availRows.map((r: any) => [r.roster_id, r]));

    const available: AgentAvailability[] = [];
    const unavailable: AgentAvailability[] = [];

    for (const agent of filtered) {
      const avail = availMap.get(agent.AgentId);
      const status: AvailabilityStatus = avail?.status ?? 'available';
      const entry: AgentAvailability = {
        id: agent.AgentId,
        roster_id: agent.AgentId,
        available_date: date,
        status,
        reason: avail?.reason ?? null,
        source: (avail?.source as AvailabilitySource) ?? undefined,
        set_by: avail?.set_by ?? null,
        display_name: agent.display_name,
        pool: agent.pool,
      };

      if (!avail?.status || avail.status === 'available' || avail.status === 'wfh') {
        available.push(entry);
      } else {
        unavailable.push(entry);
      }
    }

    return {
      date,
      available,
      unavailable,
      totalRoster: filtered.length,
      availableCount: available.length,
    };
  }

  async getUpcomingAbsences(days: number = 14): Promise<AgentAvailability[]> {
    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const agents = await this.getAgentsFromKpi();
    const agentMap = new Map(agents.map(a => [a.AgentId, a]));

    const rows = await query<any>(`
      SELECT * FROM agent_availability
      WHERE available_date BETWEEN ? AND ?
        AND status NOT IN ('available', 'wfh')
      ORDER BY available_date
    `, [today, end]);

    return rows.map((r: any) => {
      const agent = agentMap.get(r.roster_id);
      return {
        ...r,
        display_name: agent?.display_name ?? `Agent ${r.roster_id}`,
        pool: agent?.pool ?? 'cc',
      };
    });
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
    const agents = await this.getAgentsFromKpi();
    const filtered = pool ? agents.filter(a => a.pool === pool) : agents;
    const agentIds = filtered.map(a => a.AgentId);

    let availRows: any[] = [];
    if (agentIds.length > 0) {
      availRows = await query<any>(`
        SELECT roster_id, status
        FROM agent_availability
        WHERE available_date = ? AND roster_id IN (${agentIds.map(() => '?').join(',')})
      `, [today, ...agentIds]);
    }
    const unavailableIds = new Set(
      availRows
        .filter((r: any) => r.status && r.status !== 'available' && r.status !== 'wfh')
        .map((r: any) => r.roster_id),
    );

    const byPool = new Map<string, { total: number; available: number; onLeave: number }>();
    for (const agent of filtered) {
      const p = agent.pool;
      if (!byPool.has(p)) byPool.set(p, { total: 0, available: 0, onLeave: 0 });
      const entry = byPool.get(p)!;
      entry.total++;
      if (unavailableIds.has(agent.AgentId)) {
        entry.onLeave++;
      } else {
        entry.available++;
      }
    }

    return [...byPool.entries()].map(([pool, stats]) => ({ pool, ...stats }));
  }
}
