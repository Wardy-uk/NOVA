export interface WorkingHoursConfig {
  start: number;       // hour of day, e.g. 9
  end: number;         // hour of day, e.g. 17
  timezone: string;    // IANA timezone, e.g. "Europe/London"
  daysOfWeek: number[]; // 1=Mon … 5=Fri
}

export interface WorkingDayClock {
  isWorkingTime(at: Date): boolean;
  clampToWorking(at: Date): Date;
  addWorkingHours(from: Date, hours: number): Date;
  addWorkingDays(from: Date, days: number): Date;
  workingHoursBetween(from: Date, to: Date): number;
}

const DEFAULT_CONFIG: WorkingHoursConfig = {
  start: 9,
  end: 17,
  timezone: 'Europe/London',
  daysOfWeek: [1, 2, 3, 4, 5],
};

const WORKING_HOURS_PER_DAY = 8;
const MS_PER_MINUTE = 60_000;

function getLocalParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parseInt(parts.find(p => p.type === type)!.value, 10);

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') === 24 ? 0 : get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function getLocalDayOfWeek(date: Date, timezone: string): number {
  const weekday = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
  }).format(date);
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[weekday] ?? 7;
}

function toLocalDateString(date: Date, timezone: string): string {
  const p = getLocalParts(date, timezone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function createWorkingDayClock(
  config: Partial<WorkingHoursConfig> = {},
  bankHolidays: string[] = [],
): WorkingDayClock {
  const cfg: WorkingHoursConfig = { ...DEFAULT_CONFIG, ...config };
  const holidaySet = new Set(bankHolidays);
  const hoursPerDay = cfg.end - cfg.start;

  function isWorkingDay(date: Date): boolean {
    const dow = getLocalDayOfWeek(date, cfg.timezone);
    if (!cfg.daysOfWeek.includes(dow)) return false;
    return !holidaySet.has(toLocalDateString(date, cfg.timezone));
  }

  function isWorkingTime(at: Date): boolean {
    if (!isWorkingDay(at)) return false;
    const parts = getLocalParts(at, cfg.timezone);
    const fractionalHour = parts.hour + parts.minute / 60 + parts.second / 3600;
    return fractionalHour >= cfg.start && fractionalHour < cfg.end;
  }

  function advanceToNextWorkingStart(date: Date): Date {
    let d = new Date(date.getTime());
    const parts = getLocalParts(d, cfg.timezone);
    const fractionalHour = parts.hour + parts.minute / 60;

    if (fractionalHour >= cfg.end || !isWorkingDay(d)) {
      // Move to next day's start
      d = addCalendarDays(d, 1, cfg.timezone);
      d = setLocalTime(d, cfg.start, 0, 0, cfg.timezone);
    } else if (fractionalHour < cfg.start) {
      d = setLocalTime(d, cfg.start, 0, 0, cfg.timezone);
    }

    // Skip non-working days
    while (!isWorkingDay(d)) {
      d = addCalendarDays(d, 1, cfg.timezone);
    }
    return d;
  }

  function setLocalTime(date: Date, hour: number, minute: number, second: number, timezone: string): Date {
    const parts = getLocalParts(date, timezone);
    const localStr = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
    // Use Intl to figure out the UTC offset for the target local time
    const guess = new Date(localStr + 'Z');
    const offsetMs = getUtcOffsetMs(guess, timezone);
    return new Date(guess.getTime() - offsetMs);
  }

  function getUtcOffsetMs(approxDate: Date, timezone: string): number {
    // Format as UTC and as local, diff them
    const utcStr = approxDate.toLocaleString('en-GB', { timeZone: 'UTC' });
    const localStr = approxDate.toLocaleString('en-GB', { timeZone: timezone });
    const parseLocale = (s: string) => {
      const [datePart, timePart] = s.split(', ');
      const [d, m, y] = datePart.split('/').map(Number);
      const [h, min, sec] = timePart.split(':').map(Number);
      return Date.UTC(y, m - 1, d, h, min, sec);
    };
    return parseLocale(localStr) - parseLocale(utcStr);
  }

  function addCalendarDays(date: Date, days: number, timezone: string): Date {
    // Add days while preserving local time (handles DST)
    const parts = getLocalParts(date, timezone);
    const localDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute, parts.second));
    const offsetMs = getUtcOffsetMs(localDate, timezone);
    return new Date(localDate.getTime() - offsetMs);
  }

  function workingHoursRemainingToday(date: Date): number {
    if (!isWorkingTime(date)) return 0;
    const parts = getLocalParts(date, cfg.timezone);
    const fractionalHour = parts.hour + parts.minute / 60 + parts.second / 3600;
    return Math.max(0, cfg.end - fractionalHour);
  }

  function workingHoursElapsedToday(date: Date): number {
    if (!isWorkingDay(date)) return 0;
    const parts = getLocalParts(date, cfg.timezone);
    const fractionalHour = parts.hour + parts.minute / 60 + parts.second / 3600;
    if (fractionalHour <= cfg.start) return 0;
    if (fractionalHour >= cfg.end) return hoursPerDay;
    return fractionalHour - cfg.start;
  }

  function clampToWorking(at: Date): Date {
    if (isWorkingTime(at)) return at;
    const parts = getLocalParts(at, cfg.timezone);
    const fractionalHour = parts.hour + parts.minute / 60;

    if (isWorkingDay(at) && fractionalHour >= cfg.end) {
      return setLocalTime(at, cfg.end, 0, 0, cfg.timezone);
    }
    if (isWorkingDay(at) && fractionalHour < cfg.start) {
      // Go back to previous working day's end
      let d = addCalendarDays(at, -1, cfg.timezone);
      while (!isWorkingDay(d)) {
        d = addCalendarDays(d, -1, cfg.timezone);
      }
      return setLocalTime(d, cfg.end, 0, 0, cfg.timezone);
    }
    // Non-working day — find previous working day's end
    let d = addCalendarDays(at, -1, cfg.timezone);
    while (!isWorkingDay(d)) {
      d = addCalendarDays(d, -1, cfg.timezone);
    }
    return setLocalTime(d, cfg.end, 0, 0, cfg.timezone);
  }

  function addWorkingHours(from: Date, hours: number): Date {
    if (hours < 0) return subtractWorkingHours(from, -hours);
    if (hours === 0) return from;

    let remaining = hours;
    let current = isWorkingTime(from) ? new Date(from.getTime()) : advanceToNextWorkingStart(from);

    while (remaining > 0) {
      const todayRemaining = workingHoursRemainingToday(current);
      if (todayRemaining >= remaining) {
        return new Date(current.getTime() + remaining * 3600_000);
      }
      remaining -= todayRemaining;
      current = addCalendarDays(current, 1, cfg.timezone);
      current = setLocalTime(current, cfg.start, 0, 0, cfg.timezone);
      while (!isWorkingDay(current)) {
        current = addCalendarDays(current, 1, cfg.timezone);
      }
    }

    return current;
  }

  function subtractWorkingHours(from: Date, hours: number): Date {
    if (hours === 0) return from;

    let remaining = hours;
    let current = isWorkingTime(from) ? new Date(from.getTime()) : clampToWorking(from);

    while (remaining > 0) {
      const todayElapsed = workingHoursElapsedToday(current);
      if (todayElapsed >= remaining) {
        return new Date(current.getTime() - remaining * 3600_000);
      }
      remaining -= todayElapsed;
      current = addCalendarDays(current, -1, cfg.timezone);
      while (!isWorkingDay(current)) {
        current = addCalendarDays(current, -1, cfg.timezone);
      }
      current = setLocalTime(current, cfg.end, 0, 0, cfg.timezone);
    }

    return current;
  }

  function addWorkingDays(from: Date, days: number): Date {
    return addWorkingHours(from, days * WORKING_HOURS_PER_DAY);
  }

  function workingHoursBetween(from: Date, to: Date): number {
    if (from.getTime() === to.getTime()) return 0;
    const reversed = from.getTime() > to.getTime();
    let [start, end] = reversed ? [to, from] : [from, to];

    let total = 0;
    let current = isWorkingTime(start) ? new Date(start.getTime()) : advanceToNextWorkingStart(start);

    if (current.getTime() >= end.getTime()) return 0;

    // Count hours from current position
    while (true) {
      const todayRemaining = workingHoursRemainingToday(current);
      const todayEnd = new Date(current.getTime() + todayRemaining * 3600_000);

      if (todayEnd.getTime() >= end.getTime()) {
        // end is within today's working hours
        const ms = end.getTime() - current.getTime();
        total += ms / 3600_000;
        break;
      }

      total += todayRemaining;
      current = addCalendarDays(current, 1, cfg.timezone);
      current = setLocalTime(current, cfg.start, 0, 0, cfg.timezone);
      while (!isWorkingDay(current)) {
        current = addCalendarDays(current, 1, cfg.timezone);
      }

      if (current.getTime() >= end.getTime()) break;
    }

    return reversed ? -total : total;
  }

  return { isWorkingTime, clampToWorking, addWorkingHours, addWorkingDays, workingHoursBetween };
}
