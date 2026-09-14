import { captureError } from './error-log.js';
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
  if (settings.get('people_hr_enabled') === 'false') return null;
  const apiKey = settings.get('people_hr_api_key');
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (settings.get('people_hr_base_url') || 'https://api.peoplehr.net').replace(/\/$/, ''),
  };
}

function normalizePeopleHrDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const ukMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ukMatch) {
    const day = ukMatch[1].padStart(2, '0');
    const month = ukMatch[2].padStart(2, '0');
    return `${ukMatch[3]}-${month}-${day}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return [
    parsed.getUTCFullYear(),
    String(parsed.getUTCMonth() + 1).padStart(2, '0'),
    String(parsed.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return dates;

  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

// People HR caps at 50 calls/minute per IP. Hold a little under that, and count
// calls across every caller in this process so a manual sync firing while the
// scheduled one is mid-run can't blow the budget between them.
const RATE_LIMIT_PER_MIN = 45;
const RATE_WINDOW_MS = 60_000;
const callTimestamps: number[] = [];

async function throttle(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (callTimestamps.length > 0 && now - callTimestamps[0] >= RATE_WINDOW_MS) callTimestamps.shift();
    if (callTimestamps.length < RATE_LIMIT_PER_MIN) {
      callTimestamps.push(now);
      return;
    }
    // Budget spent — wait for the oldest call to age out of the window.
    await sleep(RATE_WINDOW_MS - (now - callTimestamps[0]) + 100);
  }
}

function isRateLimited(message: string): boolean {
  return /limited to \d+ per minute|rate limit|too many requests/i.test(message);
}

async function apiCall(config: PeopleHRConfig, endpoint: string, body: Record<string, unknown>): Promise<any> {
  const url = `${config.baseUrl}/${endpoint}`;

  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    await throttle();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ APIKey: config.apiKey, ...body }),
    });

    if (res.status === 429) {
      lastError = 'People HR API 429: Too Many Requests';
    } else if (!res.ok) {
      throw new Error(`People HR API ${res.status}: ${res.statusText}`);
    } else {
      const json = await res.json();
      if (!json.isError) return json.Result ?? [];
      lastError = `People HR error: ${json.Message ?? 'unknown'}`;
      // Anything that isn't a rate limit (bad key, bad employee id) won't fix itself.
      if (!isRateLimited(lastError)) throw new Error(lastError);
    }

    // Rate limited: drop our window budget and back off before retrying.
    callTimestamps.length = 0;
    if (attempt < 2) await sleep(RATE_WINDOW_MS * (attempt + 1));
  }
  throw new Error(`${lastError} (retries exhausted)`);
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

type SyncResult = {
  synced: number;
  skipped: number;
  errors: string[];
  /** Named agents skipped because dbo.Agent.PeopleHrId is blank — they can never
   *  be marked on leave, so round-robin will keep assigning to them. */
  skippedAgents: string[];
};

// A manual sync firing while the scheduled one is still running just doubles the
// call volume into a 50/min cap and rate-limits both. Share the in-flight run.
let inFlight: Promise<SyncResult> | null = null;

export function syncPeopleHR(
  settings: SettingsQueries,
  availabilityService: AgentAvailabilityService,
  kpiAgents: KpiAgent[],
): Promise<SyncResult> {
  if (inFlight) {
    console.log('[people-hr] Sync already running — returning in-flight result');
    return inFlight;
  }
  inFlight = runSync(settings, availabilityService, kpiAgents).finally(() => { inFlight = null; });
  return inFlight;
}

async function runSync(
  settings: SettingsQueries,
  availabilityService: AgentAvailabilityService,
  kpiAgents: KpiAgent[],
): Promise<SyncResult> {
  const today = new Date();
  const end = new Date(today.getTime() + 14 * 86400000);
  const result = await runWindow(settings, availabilityService, kpiAgents, today.toISOString().slice(0, 10), end.toISOString().slice(0, 10));

  // Heartbeat for the assignment side. "No leave rows today" is not a usable
  // failure signal — on a day when nobody is off it's the correct answer — so
  // record when the sync last actually reached People HR instead.
  const reached = result.errors.length === 0
    || result.errors.length < Math.max(1, kpiAgents.filter(a => a.PeopleHrId).length);
  if (reached) {
    try { settings.set(PEOPLE_HR_LAST_OK_KEY, new Date().toISOString()); } catch { /* non-fatal */ }
  }
  return result;
}

/** ISO timestamp of the last sync that reached People HR for at least one agent. */
export const PEOPLE_HR_LAST_OK_KEY = 'people_hr_last_sync_ok_at';

/**
 * Pull leave for an arbitrary past window and write it to agent_availability.
 *
 * The scheduled sync only ever asks for today→+14, so NOVA holds no leave
 * history before the sync first ran (20 Jul 2026) even though PeopleHR does —
 * GetHolidayDetail and GetAbsenceDetail both accept any date range. Without it,
 * any productivity comparison silently reads annual leave as low output, which
 * matters most across a summer.
 *
 * Idempotent: setAvailability upserts on (roster_id, available_date), so
 * re-running over the same window rewrites rather than duplicates. It will
 * overwrite manually-set availability for those dates with what PeopleHR says.
 */
export async function backfillPeopleHR(
  settings: SettingsQueries,
  availabilityService: AgentAvailabilityService,
  kpiAgents: KpiAgent[],
  startDate: string,
  endDate: string,
): Promise<SyncResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { synced: 0, skipped: 0, errors: ['startDate and endDate must be YYYY-MM-DD'], skippedAgents: [] };
  }
  if (startDate > endDate) {
    return { synced: 0, skipped: 0, errors: ['startDate must not be after endDate'], skippedAgents: [] };
  }
  console.log(`[people-hr] Backfill ${startDate} → ${endDate}`);
  return runWindow(settings, availabilityService, kpiAgents, startDate, endDate);
}

async function runWindow(
  settings: SettingsQueries,
  availabilityService: AgentAvailabilityService,
  kpiAgents: KpiAgent[],
  startStr: string,
  endStr: string,
): Promise<SyncResult> {
  const config = getConfig(settings);
  if (!config) return { synced: 0, skipped: 0, errors: ['People HR not configured or disabled'], skippedAgents: [] };

  const errors: string[] = [];
  let synced = 0;

  // Only process agents that have a People HR ID configured
  const agentsWithHrId = kpiAgents.filter(a => a.PeopleHrId);
  const skippedAgents = kpiAgents
    .filter(a => !a.PeopleHrId)
    .map(a => `${a.display_name}${a.department ? ` (${a.department})` : ''}`);
  const skipped = skippedAgents.length;
  console.log(`[people-hr] ${agentsWithHrId.length} agents have People HR IDs (${skipped} without)`);

  // An agent with no People HR ID is invisible to leave: they read as available
  // every day and round-robin keeps assigning to them while they're off. Surface
  // it rather than letting it sit silently in a counter.
  if (skippedAgents.length > 0) {
    console.warn(`[people-hr] No People HR ID — leave will never be seen for: ${skippedAgents.join(', ')}`);
    captureError('people-hr-sync', `${skippedAgents.length} active agent(s) have no People HR ID — their leave is invisible to round-robin`, {
      context: { agents: skippedAgents },
    });
  }

  const leaveEntries: { rosterId: number; date: string; status: AvailabilityStatus; reason: string }[] = [];

  for (const agent of agentsWithHrId) {
    const hrId = agent.PeopleHrId!;
    try {
      const holidays = await fetchHolidays(config, hrId, startStr, endStr);
      const absences = await fetchAbsences(config, hrId, startStr, endStr);

      const allLeave = [...holidays, ...absences];
      for (const leave of allLeave) {
        const startDate = normalizePeopleHrDate(leave.startDate);
        const endDate = normalizePeopleHrDate(leave.endDate);
        if (!startDate || !endDate) {
          console.warn(`[people-hr] Skipping unparseable leave date for ${agent.display_name} (${hrId}): ${leave.startDate} -> ${leave.endDate}`);
          continue;
        }

        for (const dateStr of enumerateDates(startDate, endDate)) {
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

  // Fail loud on a total wipeout. Every agent erroring still leaves
  // agent_availability empty, which reads downstream as "everyone is in" — the
  // exact shape of the July 2026 incident, where a bad base URL 404'd all 13
  // agents and round-robin carried on assigning into annual leave.
  if (agentsWithHrId.length > 0 && errors.length >= agentsWithHrId.length) {
    captureError(
      'people-hr-sync',
      `People HR sync failed for all ${agentsWithHrId.length} agent(s) — availability is stale and round-robin will treat everyone as available`,
      { severity: 'critical', context: { errors: errors.slice(0, 10) } },
    );
  }

  console.log(`[people-hr] Sync complete: ${synced} entries written, ${errors.length} errors`);
  return { synced, skipped, errors, skippedAgents };
}
