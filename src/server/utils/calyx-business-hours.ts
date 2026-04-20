import type Database from 'better-sqlite3';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function calculateDueAt(
  db: Database.Database,
  startTime: Date,
  targetMinutes: number,
  businessHoursId: number | null
): Date {
  if (!businessHoursId) {
    return new Date(startTime.getTime() + targetMinutes * 60 * 1000);
  }

  const profile = db.prepare('SELECT * FROM calyx_business_hours WHERE id = ?').get(businessHoursId) as any;
  if (!profile) return new Date(startTime.getTime() + targetMinutes * 60 * 1000);

  const holidays = db.prepare(
    'SELECT date FROM calyx_business_hours_holidays WHERE business_hours_id = ?'
  ).all(businessHoursId) as { date: string }[];
  const holidaySet = new Set(holidays.map(h => h.date));

  let remaining = targetMinutes;
  let cursor = new Date(startTime);
  const maxDate = new Date(startTime.getTime() + 365 * 24 * 60 * 60 * 1000);

  while (remaining > 0 && cursor < maxDate) {
    const dayKey = DAY_KEYS[cursor.getDay()];
    const enabled = profile[`${dayKey}_enabled`];
    const dateStr = formatLocalDate(cursor);

    if (!enabled || holidaySet.has(dateStr)) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }

    const startStr = profile[`${dayKey}_start`] as string;
    const endStr = profile[`${dayKey}_end`] as string;
    if (!startStr || !endStr) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }

    const [sh, sm] = startStr.split(':').map(Number);
    const [eh, em] = endStr.split(':').map(Number);

    const dayStart = new Date(cursor);
    dayStart.setHours(sh, sm, 0, 0);
    const dayEnd = new Date(cursor);
    dayEnd.setHours(eh, em, 0, 0);

    if (cursor < dayStart) cursor = new Date(dayStart);
    if (cursor >= dayEnd) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }

    const minutesInWindow = (dayEnd.getTime() - cursor.getTime()) / 60000;
    if (remaining <= minutesInWindow) {
      cursor = new Date(cursor.getTime() + remaining * 60000);
      remaining = 0;
    } else {
      remaining -= minutesInWindow;
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
    }
  }
  return cursor;
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function minutesToHuman(mins: number): string {
  if (mins < 60) return `${mins} min${mins !== 1 ? 's' : ''}`;
  if (mins < 1440) {
    const h = Math.floor(mins / 60), m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h} hour${h !== 1 ? 's' : ''}`;
  }
  const d = Math.floor(mins / 1440);
  return `${d} day${d !== 1 ? 's' : ''}`;
}
