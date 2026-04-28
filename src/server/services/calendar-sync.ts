import sql from 'mssql';
import type { SettingsQueries } from '../db/settings-store.js';
import { execute, query } from './database.js';

const PEOPLE_HR_BASE = 'https://api.peoplehr.net/';

interface PeopleHrAbsence {
  EmployeeId: { DisplayValue: string };
  FirstName: { DisplayValue: string };
  LastName: { DisplayValue: string };
  Department: { DisplayValue: string };
  AbsenceType: { DisplayValue: string };
  StartDate: { DisplayValue: string };
  EndDate: { DisplayValue: string };
  DurationType: { DisplayValue: string };
  Duration: { DisplayValue: string };
  Reason: { DisplayValue: string };
  Status: { DisplayValue: string };
  AbsenceId: { DisplayValue: string };
}

export class CalendarSyncService {
  private kpiPool: sql.ConnectionPool | null = null;
  private consecutiveAuthFailures = 0;
  private lastFailedApiKey: string | null = null;
  private cachedEmployeeIds: string[] = [];
  private employeeCacheTime = 0;
  private static readonly AUTH_BACKOFF_THRESHOLD = 3;
  private static readonly EMPLOYEE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
  constructor(private settings: SettingsQueries) {}

  private async getKpiPool(): Promise<sql.ConnectionPool | null> {
    if (this.kpiPool?.connected) return this.kpiPool;
    const all = this.settings.getAll();
    const server = all.kpi_sql_server;
    const database = all.kpi_sql_database;
    const user = all.kpi_sql_user;
    const password = all.kpi_sql_password;
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

  async sync(): Promise<{ synced: number; created: number; updated: number; removed: number }> {
    const apiKey = this.settings.get('people_hr_api_key');
    if (!apiKey) {
      console.log('[calendar-sync] Skipping — people_hr_api_key not configured');
      return { synced: 0, created: 0, updated: 0, removed: 0 };
    }
    if (this.consecutiveAuthFailures >= CalendarSyncService.AUTH_BACKOFF_THRESHOLD && this.lastFailedApiKey === apiKey) {
      console.log(`[calendar-sync] Skipping — People HR auth failed ${this.consecutiveAuthFailures} times, update people_hr_api_key to retry`);
      return { synced: 0, created: 0, updated: 0, removed: 0 };
    }
    if (this.lastFailedApiKey !== apiKey) {
      this.consecutiveAuthFailures = 0;
    }
    console.log(`[calendar-sync] Using API key: ${apiKey.slice(0, 8)}...`);

    try {
      const absences = await this.fetchAbsences(apiKey);
      this.consecutiveAuthFailures = 0;
      console.log(`[calendar-sync] Fetched ${absences.length} absences from People HR`);

      let created = 0;
      let updated = 0;

      for (const a of absences) {
        const sourceId = a.AbsenceId?.DisplayValue;
        if (!sourceId) continue;

        const name = `${a.FirstName?.DisplayValue ?? ''} ${a.LastName?.DisplayValue ?? ''}`.trim();
        const absenceType = this.mapAbsenceType(a.AbsenceType?.DisplayValue ?? '');
        const startDate = a.StartDate?.DisplayValue ?? '';
        const endDate = a.EndDate?.DisplayValue ?? '';
        const durationType = a.DurationType?.DisplayValue ?? '';
        const isHalfDay = durationType.toLowerCase().includes('half');
        const halfDayPeriod = durationType.toLowerCase().includes('am') ? 'AM'
          : durationType.toLowerCase().includes('pm') ? 'PM' : null;
        const team = a.Department?.DisplayValue ?? '';

        const existing = await query<{ id: number }>(
          `SELECT id FROM agent_team_calendar WHERE source_id = ?`, [sourceId]
        );

        if (existing.length > 0) {
          await execute(
            `UPDATE agent_team_calendar SET
              employee_name = ?, team = ?, absence_type = ?,
              start_date = ?, end_date = ?, is_half_day = ?,
              half_day_period = ?, synced_at = GETUTCDATE()
            WHERE source_id = ?`,
            [name, team, absenceType, startDate, endDate, isHalfDay ? 1 : 0, halfDayPeriod, sourceId]
          );
          updated++;
        } else {
          await execute(
            `INSERT INTO agent_team_calendar
              (employee_name, team, absence_type, start_date, end_date, is_half_day, half_day_period, source_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, team, absenceType, startDate, endDate, isHalfDay ? 1 : 0, halfDayPeriod, sourceId]
          );
          created++;
        }
      }

      const sourceIds = absences
        .map(a => a.AbsenceId?.DisplayValue)
        .filter(Boolean);

      let removed = 0;
      if (sourceIds.length > 0) {
        const placeholders = sourceIds.map(() => '?').join(',');
        const delResult = await execute(
          `DELETE FROM agent_team_calendar
           WHERE source_id IS NOT NULL
             AND source_id NOT IN (${placeholders})
             AND end_date >= CAST(GETDATE() AS DATE)`,
          sourceIds
        );
        removed = typeof delResult === 'number' ? delResult : 0;
      }

      console.log(`[calendar-sync] Synced: ${created} created, ${updated} updated, ${removed} removed`);
      return { synced: absences.length, created, updated, removed };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Access Denied') || msg.includes('Unauthorized') || msg.includes('Invalid API')) {
        this.consecutiveAuthFailures++;
        this.lastFailedApiKey = apiKey;
        console.error(`[calendar-sync] sync failed: ${msg} (auth failure ${this.consecutiveAuthFailures}/${CalendarSyncService.AUTH_BACKOFF_THRESHOLD})`);
      } else {
        console.error('[calendar-sync] Sync failed:', msg);
      }
      throw err;
    }
  }

  async getTeamAvailability(date?: string): Promise<any> {
    const targetDate = date ?? new Date().toISOString().slice(0, 10);
    const onLeave = await query(
      `SELECT employee_name, team, absence_type, start_date, end_date, is_half_day, half_day_period
       FROM agent_team_calendar
       WHERE ? BETWEEN start_date AND end_date
       ORDER BY employee_name`,
      [targetDate]
    );

    const leaveNames = new Set(onLeave.map((r: any) => r.employee_name));

    let allAgents: any[] = [];
    const kpi = await this.getKpiPool();
    if (kpi) {
      const result = await kpi.request().query(`
        SELECT LTRIM(RTRIM(AgentName)) + ' ' + LTRIM(RTRIM(ISNULL(AgentSurname, ''))) AS display_name,
               LOWER(Team) AS pool
        FROM dbo.Agent WHERE IsActive = 1 AND Department = 'NT'
        ORDER BY AgentName
      `);
      allAgents = result.recordset;
    }

    const available = (allAgents as any[]).filter(a => !leaveNames.has(a.display_name));
    const unavailable = onLeave;

    return {
      date: targetDate,
      totalRoster: allAgents.length,
      availableCount: available.length,
      unavailableCount: unavailable.length,
      available: available.map((a: any) => ({ name: a.display_name, pool: a.pool, status: 'available' })),
      unavailable: unavailable.map((r: any) => ({
        name: r.employee_name,
        team: r.team,
        type: r.absence_type,
        isHalfDay: r.is_half_day,
        halfDayPeriod: r.half_day_period,
      })),
    };
  }

  private async fetchEmployeeIds(): Promise<string[]> {
    if (this.cachedEmployeeIds.length > 0 && Date.now() - this.employeeCacheTime < CalendarSyncService.EMPLOYEE_CACHE_TTL) {
      return this.cachedEmployeeIds;
    }

    const kpi = await this.getKpiPool();
    if (!kpi) {
      console.warn('[calendar-sync] No KPI pool — cannot read PeopleHrId from Agent table');
      return [];
    }

    const result = await kpi.request().query(`
      SELECT PeopleHrId FROM dbo.Agent
      WHERE IsActive = 1 AND PeopleHrId IS NOT NULL AND PeopleHrId != ''
    `);

    const ids = result.recordset
      .map((r: any) => r.PeopleHrId as string)
      .filter(Boolean);

    this.cachedEmployeeIds = ids;
    this.employeeCacheTime = Date.now();
    console.log(`[calendar-sync] Loaded ${ids.length} People HR IDs from Agent table`);
    return ids;
  }

  private async callPeopleHrEndpoint(apiKey: string, endpoint: string, body: Record<string, string>): Promise<any[]> {
    const response = await fetch(`${PEOPLE_HR_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ APIKey: apiKey, ...body }),
    });

    if (!response.ok) {
      throw new Error(`People HR ${endpoint} API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (data.isError) throw new Error(`People HR ${endpoint} error: ${data.Message}`);

    return Array.isArray(data.Result) ? data.Result : [];
  }

  private async fetchAllForEmployee(apiKey: string, employeeId: string, startDate: string, endDate: string): Promise<PeopleHrAbsence[]> {
    const endpoints: { endpoint: string; action: string; absenceTypeOverride?: string; dateFields?: [string, string] }[] = [
      { endpoint: 'Absence', action: 'GetAbsenceDetail' },
      { endpoint: 'Holiday', action: 'GetHolidayDetail', absenceTypeOverride: 'Employee Holiday' },
      { endpoint: 'OtherEvent', action: 'getothereventdetail', absenceTypeOverride: 'Other Event' },
      { endpoint: 'MaternityPaternity', action: 'GetMaternityPaternityByEmployeeId', absenceTypeOverride: 'Maternity/Paternity', dateFields: ['ActualStartDate', 'ActualEndDate'] },
    ];

    const results: PeopleHrAbsence[] = [];

    for (const ep of endpoints) {
      try {
        const [startKey, endKey] = ep.dateFields ?? ['StartDate', 'EndDate'];
        const records = await this.callPeopleHrEndpoint(apiKey, ep.endpoint, {
          Action: ep.action,
          EmployeeId: employeeId,
          [startKey]: startDate,
          [endKey]: endDate,
        });

        for (const r of records) {
          if (r.Status?.DisplayValue === 'Cancelled' || r.Status?.DisplayValue === 'Declined') continue;
          if (ep.absenceTypeOverride && (!r.AbsenceType || !r.AbsenceType.DisplayValue)) {
            r.AbsenceType = { DisplayValue: ep.absenceTypeOverride };
          }
          results.push(r);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[calendar-sync] ${ep.endpoint} failed for employee ${employeeId}: ${msg}`);
      }
    }

    return results;
  }

  private async fetchAbsences(apiKey: string): Promise<PeopleHrAbsence[]> {
    const startDate = new Date().toISOString().slice(0, 10);
    const endDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    const employeeIds = await this.fetchEmployeeIds();
    if (employeeIds.length === 0) {
      console.warn('[calendar-sync] No employees found in People HR');
      return [];
    }

    console.log(`[calendar-sync] Fetching absences for ${employeeIds.length} employees across 4 endpoints`);
    const allAbsences: PeopleHrAbsence[] = [];
    let errors = 0;

    for (const empId of employeeIds) {
      try {
        const absences = await this.fetchAllForEmployee(apiKey, empId, startDate, endDate);
        allAbsences.push(...absences);
      } catch (err) {
        errors++;
        if (errors >= 5) {
          console.error(`[calendar-sync] Too many per-employee errors (${errors}), aborting`);
          throw err;
        }
      }
    }

    if (errors > 0) {
      console.warn(`[calendar-sync] ${errors} employee(s) had fetch errors`);
    }

    return allAbsences;
  }

  private mapAbsenceType(type: string): string {
    const lower = type.toLowerCase();
    if (lower.includes('employee holiday') || lower.includes('annual') || lower.includes('holiday')) return 'annual_leave';
    if (lower.includes('sick')) return 'sick';
    if (lower.includes('maternity') || lower.includes('paternity')) return 'maternity_paternity';
    if (lower.includes('birthday')) return 'birthday';
    if (lower.includes('unpaid')) return 'unpaid';
    if (lower.includes('other event')) return 'other_event';
    if (lower.includes('wfh') || lower.includes('work from home') || lower.includes('remote')) return 'wfh';
    if (lower.includes('training')) return 'training';
    return 'other';
  }
}
