import type { SettingsQueries } from '../db/settings-store.js';
import type { AgentAvailabilityService, AvailabilityStatus } from './agent-availability.js';
import type { KpiAgent } from './agent-availability.js';

interface PeopleHRConfig {
  apiKey: string;
  baseUrl: string;
}

interface PeopleHRAbsence {
  startDate: string;
  endDate: string;
  reason?: string;
  type: 'absence' | 'holiday';
}

function getConfig(settings: SettingsQueries): PeopleHRConfig | null {
  const all = settings.getAll();
  if (all.people_hr_enabled === 'false') return null;
  const apiKey = all.people_hr_api_key;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (all.people_hr_base_url || 'https://api.peoplehr.net').replace(/\/$/, ''),
  };
}

async function apiCall(config: PeopleHRConfig, endpoint: string, body: Record<string, unknown>): Promise<any> {
  const url = `${config.baseUrl}/${endpoint}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ APIKey: config.apiKey, ...body }),
  });
  if (!res.ok) throw new Error(`People HR API ${res.status}: ${res.statusText}`);
  const json = await res.json();
  if (json.isError) throw new Error(`People HR error: ${json.Message ?? 'unknown'}`);
  return json.Result ?? [];
}

async function fetchHolidays(config: PeopleHRConfig, employeeId: string, startDate: string, endDate: string): Promise<PeopleHRAbsence[]> {
  const result = await apiCall(config, 'Holiday', {
    Action: 'GetHolidayDetail',
    EmployeeId: employeeId,
    StartDate: startDate,
    EndDate: endDate,
  });
  if (!Array.isArray(result)) return [];
  return result
    .filter((h: any) => (h.Status ?? '').toLowerCase() === 'approved')
    .map((h: any) => ({
      startDate: h.StartDate,
      endDate: h.EndDate,
      reason: h.RequesterComments || 'Annual Leave',
      type: 'holiday' as const,
    }));
}

async function fetchAbsences(config: PeopleHRConfig, employeeId: string, startDate: string, endDate: string): Promise<PeopleHRAbsence[]> {
  const result = await apiCall(config, 'Absence', {
    Action: 'GetAbsenceDetail',
    EmployeeId: employeeId,
    StartDate: startDate,
    EndDate: endDate,
  });
  if (!Array.isArray(result)) return [];
  return result.map((a: any) => ({
    startDate: a.StartDate,
    endDate: a.EndDate,
    reason: a.Reason || 'Sick',
    type: 'absence' as const,
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function mapAbsenceType(absence: PeopleHRAbsence): AvailabilityStatus {
  if (absence.type === 'absence') return 'sick';
  return 'annual_leave';
}

export async function syncPeopleHR(
  settings: SettingsQueries,
  availabilityService: AgentAvailabilityService,
  kpiAgents: KpiAgent[],
): Promise<{ synced: number; skipped: number; errors: string[] }> {
  const config = getConfig(settings);
  if (!config) return { synced: 0, skipped: 0, errors: ['People HR not configured or disabled'] };

  const errors: string[] = [];
  let synced = 0;

  // Only process agents that have a People HR ID configured
  const agentsWithHrId = kpiAgents.filter(a => a.PeopleHrId);
  const skipped = kpiAgents.length - agentsWithHrId.length;
  console.log(`[people-hr] ${agentsWithHrId.length} agents have People HR IDs (${skipped} without)`);

  const today = new Date();
  const endDate = new Date(today.getTime() + 14 * 86400000);
  const startStr = today.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  const leaveEntries: { rosterId: number; date: string; status: AvailabilityStatus; reason: string }[] = [];

  for (const agent of agentsWithHrId) {
    const hrId = agent.PeopleHrId!;
    try {
      await sleep(2200);
      const holidays = await fetchHolidays(config, hrId, startStr, endStr);

      await sleep(2200);
      const absences = await fetchAbsences(config, hrId, startStr, endStr);

      const allLeave = [...holidays, ...absences];
      for (const leave of allLeave) {
        if (!leave.startDate || !leave.endDate) continue;
        const start = new Date(leave.startDate);
        const end = new Date(leave.endDate);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dateStr = d.toISOString().slice(0, 10);
          if (dateStr < startStr || dateStr > endStr) continue;
          leaveEntries.push({
            rosterId: agent.AgentId,
            date: dateStr,
            status: mapAbsenceType(leave),
            reason: leave.reason ?? (leave.type === 'absence' ? 'Sick' : 'Annual Leave'),
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${agent.display_name} (${hrId}): ${msg}`);
      console.warn(`[people-hr] Error fetching leave for ${agent.display_name} (${hrId}):`, msg);
    }
  }

  for (const entry of leaveEntries) {
    try {
      await availabilityService.setAvailability(entry.rosterId, entry.date, entry.status, entry.reason);
      synced++;
    } catch (err) {
      errors.push(`Write error for agent ${entry.rosterId} on ${entry.date}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`[people-hr] Sync complete: ${synced} entries written, ${errors.length} errors`);
  return { synced, skipped, errors };
}
