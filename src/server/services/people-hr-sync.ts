import type { SettingsQueries } from '../db/settings-store.js';
import type { AgentAvailabilityService, AvailabilityStatus } from './agent-availability.js';

interface PeopleHRConfig {
  apiKey: string;
  baseUrl: string;
}

interface PeopleHREmployee {
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface PeopleHRAbsence {
  startDate: string;
  endDate: string;
  reason?: string;
  type: 'absence' | 'holiday';
  status?: string;
  durationInDays?: number;
  partOfDay?: string;
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

function dv(field: unknown): string {
  if (!field) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field !== null && 'DisplayValue' in field) {
    return String((field as any).DisplayValue ?? '');
  }
  return String(field);
}

async function fetchEmployees(config: PeopleHRConfig): Promise<PeopleHREmployee[]> {
  const result = await apiCall(config, 'Employee', {
    Action: 'GetAllEmployeeDetail',
    IncludeLeavers: false,
  });
  if (!Array.isArray(result)) return [];
  return result.map((e: any) => ({
    employeeId: dv(e.EmployeeId),
    firstName: dv(e.FirstName),
    lastName: dv(e.LastName),
    email: dv(e.EmailId),
  })).filter((e: PeopleHREmployee) => e.employeeId && (e.firstName || e.lastName));
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
      status: h.Status,
      durationInDays: h.DurationInDays,
      partOfDay: h.PartOfDay,
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
    durationInDays: a.DurationInDays,
    partOfDay: a.PartOfDay ? String(a.PartOfDay) : undefined,
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '');
}

function dateInRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

function mapAbsenceType(absence: PeopleHRAbsence): AvailabilityStatus {
  if (absence.type === 'absence') return 'sick';
  return 'annual_leave';
}

interface KpiAgent {
  AgentId: number;
  display_name: string;
  pool: string;
}

export async function syncPeopleHR(
  settings: SettingsQueries,
  availabilityService: AgentAvailabilityService,
  kpiAgents: KpiAgent[],
): Promise<{ synced: number; errors: string[] }> {
  const config = getConfig(settings);
  if (!config) return { synced: 0, errors: ['People HR not configured or disabled'] };

  const errors: string[] = [];
  let synced = 0;

  const employees = await fetchEmployees(config);
  console.log(`[people-hr] Fetched ${employees.length} employees from People HR`);

  // Build name → agent mapping
  const agentMap = new Map<string, KpiAgent>();
  for (const agent of kpiAgents) {
    agentMap.set(normalise(agent.display_name), agent);
  }

  // Match employees to agents
  const matched: { employee: PeopleHREmployee; agent: KpiAgent }[] = [];
  for (const emp of employees) {
    const fullName = normalise(`${emp.firstName}${emp.lastName}`);
    const agent = agentMap.get(fullName);
    if (agent) {
      matched.push({ employee: emp, agent });
    }
  }
  console.log(`[people-hr] Matched ${matched.length}/${employees.length} employees to ${kpiAgents.length} KPI agents`);

  // Sync window: today + 14 days
  const today = new Date();
  const endDate = new Date(today.getTime() + 14 * 86400000);
  const startStr = today.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  // Track which agent+date combos have leave
  const leaveEntries: { rosterId: number; date: string; status: AvailabilityStatus; reason: string }[] = [];

  for (const { employee, agent } of matched) {
    try {
      // Throttle to stay under 30 calls/min
      await sleep(2200);
      const holidays = await fetchHolidays(config, employee.employeeId, startStr, endStr);

      await sleep(2200);
      const absences = await fetchAbsences(config, employee.employeeId, startStr, endStr);

      const allLeave = [...holidays, ...absences];
      for (const leave of allLeave) {
        if (!leave.startDate || !leave.endDate) continue;
        // Expand date range into individual days
        const start = new Date(leave.startDate);
        const end = new Date(leave.endDate);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dateStr = d.toISOString().slice(0, 10);
          if (!dateInRange(dateStr, startStr, endStr)) continue;
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
      errors.push(`${employee.firstName} ${employee.lastName}: ${msg}`);
      console.warn(`[people-hr] Error fetching leave for ${employee.firstName} ${employee.lastName}:`, msg);
    }
  }

  // Clear existing People HR entries for the sync window, then write new ones
  for (const entry of leaveEntries) {
    try {
      await availabilityService.setAvailability(entry.rosterId, entry.date, entry.status, entry.reason);
      synced++;
    } catch (err) {
      errors.push(`Write error for agent ${entry.rosterId} on ${entry.date}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`[people-hr] Sync complete: ${synced} entries written, ${errors.length} errors`);
  return { synced, errors };
}
