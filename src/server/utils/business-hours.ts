/**
 * UK Business Hours Calculator
 * Hours: Mon-Fri, 09:00-17:30 (8.5 hours/day)
 * Excludes UK bank holidays
 */

// UK bank holidays 2025-2027 (update annually or fetch from gov.uk API)
const UK_BANK_HOLIDAYS: Set<string> = new Set([
  // 2025
  '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-05', '2025-05-26',
  '2025-08-25', '2025-12-25', '2025-12-26',
  // 2026
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25',
  '2026-08-31', '2026-12-25', '2026-12-28',
  // 2027
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31',
  '2027-08-30', '2027-12-27', '2027-12-28',
]);

const BUSINESS_START_HOUR = 9;
const BUSINESS_START_MIN = 0;
const BUSINESS_END_HOUR = 17;
const BUSINESS_END_MIN = 30;
const BUSINESS_MINUTES_PER_DAY = (BUSINESS_END_HOUR * 60 + BUSINESS_END_MIN) - (BUSINESS_START_HOUR * 60 + BUSINESS_START_MIN); // 510 min = 8.5h

function dateToYMD(d: Date): string {
  return d.toISOString().split('T')[0];
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function isBankHoliday(d: Date): boolean {
  return UK_BANK_HOLIDAYS.has(dateToYMD(d));
}

function isBusinessDay(d: Date): boolean {
  return !isWeekend(d) && !isBankHoliday(d);
}

function getBusinessStartOfDay(d: Date): Date {
  const result = new Date(d);
  result.setHours(BUSINESS_START_HOUR, BUSINESS_START_MIN, 0, 0);
  return result;
}

function getBusinessEndOfDay(d: Date): Date {
  const result = new Date(d);
  result.setHours(BUSINESS_END_HOUR, BUSINESS_END_MIN, 0, 0);
  return result;
}

function nextBusinessDay(d: Date): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + 1);
  while (!isBusinessDay(result)) {
    result.setDate(result.getDate() + 1);
  }
  result.setHours(BUSINESS_START_HOUR, BUSINESS_START_MIN, 0, 0);
  return result;
}

/**
 * Add business hours to a start date and return the deadline.
 * If start is outside business hours, begins counting from next business window.
 */
export function addBusinessMinutes(start: Date, minutesToAdd: number): Date {
  let current = new Date(start);
  let remaining = minutesToAdd;

  // If weekend or bank holiday, skip to next business day
  if (!isBusinessDay(current)) {
    current = nextBusinessDay(current);
  }

  // If before business hours, snap to start
  const currentMinutes = current.getHours() * 60 + current.getMinutes();
  const startMinutes = BUSINESS_START_HOUR * 60 + BUSINESS_START_MIN;
  const endMinutes = BUSINESS_END_HOUR * 60 + BUSINESS_END_MIN;

  if (currentMinutes < startMinutes) {
    current.setHours(BUSINESS_START_HOUR, BUSINESS_START_MIN, 0, 0);
  }

  // If after business hours, skip to next business day
  if (currentMinutes >= endMinutes) {
    current = nextBusinessDay(current);
  }

  while (remaining > 0) {
    const eod = getBusinessEndOfDay(current);
    const minutesUntilEod = Math.floor((eod.getTime() - current.getTime()) / 60000);

    if (remaining <= minutesUntilEod) {
      current = new Date(current.getTime() + remaining * 60000);
      remaining = 0;
    } else {
      remaining -= minutesUntilEod;
      current = nextBusinessDay(current);
    }
  }

  return current;
}

/**
 * Add business hours (convenience wrapper).
 * @param start - Start date
 * @param hours - Number of business hours to add
 * @returns Deadline date
 */
export function addBusinessHours(start: Date, hours: number): Date {
  return addBusinessMinutes(start, hours * 60);
}

/**
 * Check if a given date is within business hours.
 */
export function isWithinBusinessHours(d: Date): boolean {
  if (!isBusinessDay(d)) return false;
  const mins = d.getHours() * 60 + d.getMinutes();
  return mins >= (BUSINESS_START_HOUR * 60 + BUSINESS_START_MIN) && mins < (BUSINESS_END_HOUR * 60 + BUSINESS_END_MIN);
}

/**
 * Format a deadline as an ISO-ish string suitable for SQLite datetime comparison.
 * e.g. "2026-04-06 11:30:00"
 */
export function toSqliteDatetime(d: Date): string {
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}
