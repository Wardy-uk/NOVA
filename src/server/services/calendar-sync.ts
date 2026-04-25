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
  constructor(private settings: SettingsQueries) {}

  async sync(): Promise<{ synced: number; created: number; updated: number; removed: number }> {
    const apiKey = this.settings.get('people_hr_api_key');
    if (!apiKey) {
      console.log('[calendar-sync] Skipping — people_hr_api_key not configured');
      return { synced: 0, created: 0, updated: 0, removed: 0 };
    }
    console.log(`[calendar-sync] Using API key: ${apiKey.slice(0, 8)}...`);

    try {
      const absences = await this.fetchAbsences(apiKey);
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
      console.error('[calendar-sync] Sync failed:', err instanceof Error ? err.message : err);
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

    const allAgents = await query(
      `SELECT DISTINCT display_name, pool FROM agent_roster WHERE active = 1 ORDER BY display_name`,
      []
    );

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

  private async fetchAbsences(apiKey: string): Promise<PeopleHrAbsence[]> {
    const startDate = new Date().toISOString().slice(0, 10);
    const endDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    const response = await fetch(`${PEOPLE_HR_BASE}Absence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        APIKey: apiKey,
        Action: 'GetAbsencesForDateRange',
        StartDate: startDate,
        EndDate: endDate,
      }),
    });

    if (!response.ok) {
      throw new Error(`People HR API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.isError && Array.isArray(data.Result)) {
      return data.Result.filter((a: any) =>
        a.Status?.DisplayValue !== 'Cancelled' && a.Status?.DisplayValue !== 'Declined'
      );
    }
    if (data.isError) throw new Error(`People HR error: ${data.Message}`);
    return [];
  }

  private mapAbsenceType(type: string): string {
    const lower = type.toLowerCase();
    if (lower.includes('annual') || lower.includes('holiday')) return 'annual_leave';
    if (lower.includes('sick')) return 'sick';
    if (lower.includes('wfh') || lower.includes('work from home') || lower.includes('remote')) return 'wfh';
    if (lower.includes('training')) return 'training';
    return 'other';
  }
}
