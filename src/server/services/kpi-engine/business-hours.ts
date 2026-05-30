/**
 * KPI Recovery — Business Hours Engine (P1-WP1)
 *
 * Timezone-aware working-time calculator. Replaces reliance on Jira SLA fields
 * (which are null for NTPJ/STBY/YO) with a single NOVA-side approach for all
 * spaces. Source of truth: KPI-Clean-Sheet-Design.md §2.2.
 *
 *   calculateBusinessMinutes(start, end, space)  → working minutes between two instants
 *   isBusinessHour(timestamp, space)             → is this instant inside the working window
 *   nextBusinessStart(timestamp, space)          → next working-window opening at/after instant
 *
 * Working window, timezone, weekend days, and holidays come from SpaceConfig.
 * Pause-status intervals can be supplied to subtract paused time; when omitted
 * (Phase 1 default — no status-change history in jira_issue_cache) gross working
 * minutes are returned.
 */
import type { SpaceConfig } from './types.js';

interface TzParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sun … 6=Sat
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      weekday: 'short', hour12: false,
    });
    partsCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts for an instant, in the given timezone. */
function getTzParts(date: Date, tz: string): TzParts {
  const parts = formatter(tz).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0; // some engines emit 24 for midnight
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour,
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
    weekday: WEEKDAY_INDEX[map.weekday] ?? 0,
  };
}

/** Offset in ms such that (utc instant) + offset == wall clock interpreted as UTC. */
function tzOffsetMs(date: Date, tz: string): number {
  const p = getTzParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/** Build the UTC instant for a wall-clock time on a calendar day in a timezone. */
function wallToUtc(
  year: number, month: number, day: number,
  minutesOfDay: number, tz: string,
): Date {
  const hh = Math.floor(minutesOfDay / 60);
  const mm = minutesOfDay % 60;
  const guess = Date.UTC(year, month - 1, day, hh, mm, 0);
  // Resolve offset at the guessed instant, then again after correction to handle
  // DST transitions. Two iterations is sufficient for hourly DST shifts.
  let offset = tzOffsetMs(new Date(guess), tz);
  let result = guess - offset;
  offset = tzOffsetMs(new Date(result), tz);
  result = guess - offset;
  return new Date(result);
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isNonWorkingDay(p: TzParts, space: SpaceConfig): boolean {
  if (space.weekendDays.includes(p.weekday)) return true;
  if (space.holidays.has(dateKey(p.year, p.month, p.day))) return true;
  return false;
}

/** Advance a TzParts date by one calendar day (date fields only). */
function nextDay(p: TzParts, tz: string): TzParts {
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0); // noon avoids DST edges
  const next = new Date(asUtc + 24 * 60 * 60 * 1000);
  return getTzParts(next, tz);
}

export interface PausedInterval { start: Date; end: Date; }

/**
 * Working minutes between two instants for a space, honouring timezone, the
 * daily working window, weekends and holidays. Optionally subtracts the working
 * minutes that fall inside supplied paused intervals (e.g. "Waiting for Customer").
 */
export function calculateBusinessMinutes(
  start: Date,
  end: Date,
  space: SpaceConfig,
  pausedIntervals: PausedInterval[] = [],
): number {
  if (!(start instanceof Date) || !(end instanceof Date)) return 0;
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  if (end <= start) return 0;

  const tz = space.timezone;
  let total = 0;
  let dayParts = getTzParts(start, tz);
  const endParts = getTzParts(end, tz);
  const lastKeyNum = endParts.year * 10000 + endParts.month * 100 + endParts.day;

  // Guard against pathological ranges (cap at ~3 years of iteration).
  for (let guard = 0; guard < 1200; guard++) {
    const keyNum = dayParts.year * 10000 + dayParts.month * 100 + dayParts.day;
    if (keyNum > lastKeyNum) break;

    if (!isNonWorkingDay(dayParts, space)) {
      const winStart = wallToUtc(dayParts.year, dayParts.month, dayParts.day, space.bizStartMinutes, tz);
      const winEnd = wallToUtc(dayParts.year, dayParts.month, dayParts.day, space.bizEndMinutes, tz);
      const overlapStart = Math.max(start.getTime(), winStart.getTime());
      const overlapEnd = Math.min(end.getTime(), winEnd.getTime());
      if (overlapEnd > overlapStart) {
        let dayMinutes = (overlapEnd - overlapStart) / 60000;
        // Subtract paused time that overlaps this working window slice.
        for (const pause of pausedIntervals) {
          const ps = Math.max(overlapStart, pause.start.getTime());
          const pe = Math.min(overlapEnd, pause.end.getTime());
          if (pe > ps) dayMinutes -= (pe - ps) / 60000;
        }
        if (dayMinutes > 0) total += dayMinutes;
      }
    }

    if (keyNum === lastKeyNum) break;
    dayParts = nextDay(dayParts, tz);
  }

  return Math.round(total);
}

/** Is the given instant inside the working window (not weekend/holiday)? */
export function isBusinessHour(timestamp: Date, space: SpaceConfig): boolean {
  if (!(timestamp instanceof Date) || isNaN(timestamp.getTime())) return false;
  const p = getTzParts(timestamp, space.timezone);
  if (isNonWorkingDay(p, space)) return false;
  const minutesOfDay = p.hour * 60 + p.minute;
  return minutesOfDay >= space.bizStartMinutes && minutesOfDay < space.bizEndMinutes;
}

/** The next working-window opening at or after the given instant. */
export function nextBusinessStart(timestamp: Date, space: SpaceConfig): Date {
  if (!(timestamp instanceof Date) || isNaN(timestamp.getTime())) return timestamp;
  const tz = space.timezone;
  let p = getTzParts(timestamp, tz);

  for (let guard = 0; guard < 400; guard++) {
    if (!isNonWorkingDay(p, space)) {
      const winStart = wallToUtc(p.year, p.month, p.day, space.bizStartMinutes, tz);
      const winEnd = wallToUtc(p.year, p.month, p.day, space.bizEndMinutes, tz);
      if (timestamp.getTime() < winStart.getTime()) return winStart;
      if (timestamp.getTime() < winEnd.getTime()) return timestamp; // already inside
    }
    // Move to the start of the next calendar day and retry.
    p = nextDay(p, tz);
    const startOfNext = wallToUtc(p.year, p.month, p.day, space.bizStartMinutes, tz);
    if (!isNonWorkingDay(p, space)) return startOfNext;
  }
  return timestamp;
}

/** Parse "HH:MM" or "HH:MM:SS" into minutes-from-midnight. */
export function parseTimeToMinutes(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return fallback;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}
