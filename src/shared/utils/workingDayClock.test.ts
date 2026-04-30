import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkingDayClock } from './workingDayClock.js';

// Helper: create a date in UK time via UTC offset.
// For precise DST testing we rely on Intl internally, but for building
// test inputs we use explicit UTC dates and let the clock interpret them.
function utc(iso: string): Date {
  return new Date(iso + (iso.includes('Z') || iso.includes('+') ? '' : 'Z'));
}

const BANK_HOLIDAYS = ['2026-12-25', '2026-12-28', '2027-01-01'];

describe('WorkingDayClock', () => {
  const clock = createWorkingDayClock({}, BANK_HOLIDAYS);

  describe('isWorkingTime', () => {
    it('returns true for midday on a weekday', () => {
      // Wed 2026-04-29 12:00 UTC = 13:00 BST (working time)
      assert.equal(clock.isWorkingTime(utc('2026-04-29T12:00:00')), true);
    });

    it('returns false before 09:00 UK time', () => {
      // Wed 2026-04-29 07:30 UTC = 08:30 BST
      assert.equal(clock.isWorkingTime(utc('2026-04-29T07:30:00')), false);
    });

    it('returns false at exactly 17:00 UK time', () => {
      // Wed 2026-04-29 16:00 UTC = 17:00 BST (end boundary, exclusive)
      assert.equal(clock.isWorkingTime(utc('2026-04-29T16:00:00')), false);
    });

    it('returns true at exactly 09:00 UK time', () => {
      // Wed 2026-04-29 08:00 UTC = 09:00 BST
      assert.equal(clock.isWorkingTime(utc('2026-04-29T08:00:00')), true);
    });

    it('returns false on Saturday', () => {
      // Sat 2026-05-02 12:00 UTC
      assert.equal(clock.isWorkingTime(utc('2026-05-02T12:00:00')), false);
    });

    it('returns false on Sunday', () => {
      assert.equal(clock.isWorkingTime(utc('2026-05-03T12:00:00')), false);
    });

    it('returns false on a bank holiday', () => {
      // Fri 2026-12-25 12:00 UTC = 12:00 GMT (Christmas, bank holiday)
      assert.equal(clock.isWorkingTime(utc('2026-12-25T12:00:00')), false);
    });
  });

  describe('clampToWorking', () => {
    it('returns the same instant if already working time', () => {
      const d = utc('2026-04-29T10:00:00'); // 11:00 BST
      const result = clock.clampToWorking(d);
      assert.equal(result.getTime(), d.getTime());
    });

    it('clamps evening to that day end-of-working', () => {
      // Wed 2026-04-29 18:00 UTC = 19:00 BST (past end)
      const result = clock.clampToWorking(utc('2026-04-29T18:00:00'));
      // Should clamp to 17:00 BST = 16:00 UTC
      assert.equal(result.toISOString(), '2026-04-29T16:00:00.000Z');
    });

    it('clamps early morning to previous working day end', () => {
      // Wed 2026-04-29 06:00 UTC = 07:00 BST (before 09:00)
      const result = clock.clampToWorking(utc('2026-04-29T06:00:00'));
      // Should clamp to Tue 2026-04-28 17:00 BST = 16:00 UTC
      assert.equal(result.toISOString(), '2026-04-28T16:00:00.000Z');
    });

    it('clamps Saturday to Friday end', () => {
      const result = clock.clampToWorking(utc('2026-05-02T12:00:00'));
      // Fri 2026-05-01 17:00 BST = 16:00 UTC
      assert.equal(result.toISOString(), '2026-05-01T16:00:00.000Z');
    });

    it('clamps day after bank holiday to last working day', () => {
      // Sat 2026-12-26, Sun 2026-12-27, Mon 2026-12-28 (bank holiday)
      // Tue 2026-12-29 06:00 UTC = 06:00 GMT (before start)
      // Previous working day is Thu 2026-12-24
      const result = clock.clampToWorking(utc('2026-12-29T06:00:00'));
      // Thu 2026-12-24 17:00 GMT = 17:00 UTC
      assert.equal(result.toISOString(), '2026-12-24T17:00:00.000Z');
    });
  });

  describe('addWorkingHours', () => {
    it('adds hours within same day', () => {
      // Wed 2026-04-29 09:00 BST = 08:00 UTC, +3h = 12:00 BST = 11:00 UTC
      const result = clock.addWorkingHours(utc('2026-04-29T08:00:00'), 3);
      assert.equal(result.toISOString(), '2026-04-29T11:00:00.000Z');
    });

    it('wraps to next day when exceeding end of day', () => {
      // Wed 2026-04-29 15:00 BST = 14:00 UTC, +4h = remaining 2h today + 2h tomorrow
      // Thu 2026-04-30 11:00 BST = 10:00 UTC
      const result = clock.addWorkingHours(utc('2026-04-29T14:00:00'), 4);
      assert.equal(result.toISOString(), '2026-04-30T10:00:00.000Z');
    });

    it('skips weekends', () => {
      // Fri 2026-05-01 16:00 BST = 15:00 UTC, +2h = 1h remaining Fri + skip Sat/Sun + 1h Mon
      // Mon 2026-05-04 10:00 BST = 09:00 UTC
      const result = clock.addWorkingHours(utc('2026-05-01T15:00:00'), 2);
      assert.equal(result.toISOString(), '2026-05-04T09:00:00.000Z');
    });

    it('adds zero hours returns same instant', () => {
      const d = utc('2026-04-29T10:00:00');
      const result = clock.addWorkingHours(d, 0);
      assert.equal(result.getTime(), d.getTime());
    });

    it('adds negative hours', () => {
      // Wed 2026-04-29 12:00 BST = 11:00 UTC, -3h = 09:00 BST = 08:00 UTC
      const result = clock.addWorkingHours(utc('2026-04-29T11:00:00'), -3);
      assert.equal(result.toISOString(), '2026-04-29T08:00:00.000Z');
    });

    it('negative hours wraps to previous day', () => {
      // Thu 2026-04-30 10:00 BST = 09:00 UTC, -2h = 1h back to start + previous day
      // Wed 2026-04-29 16:00 BST = 15:00 UTC
      const result = clock.addWorkingHours(utc('2026-04-30T09:00:00'), -2);
      assert.equal(result.toISOString(), '2026-04-29T15:00:00.000Z');
    });

    it('handles starting outside working hours', () => {
      // Sat 2026-05-02 12:00 UTC + 1h = Mon 2026-05-04 10:00 BST = 09:00 UTC
      // Wait — starts outside, advances to Mon 09:00 BST then +1h = 10:00 BST = 09:00 UTC
      // Actually Mon 09:00 BST = 08:00 UTC, +1h = 10:00 BST = 09:00 UTC
      const result = clock.addWorkingHours(utc('2026-05-02T12:00:00'), 1);
      assert.equal(result.toISOString(), '2026-05-04T09:00:00.000Z');
    });

    it('skips bank holidays', () => {
      // Thu 2026-12-24 16:00 GMT = 16:00 UTC, +2h = 1h remaining Thu + skip Fri(Xmas)/Sat/Sun/Mon(BH)
      // Tue 2026-12-29 10:00 GMT = 10:00 UTC
      const result = clock.addWorkingHours(utc('2026-12-24T16:00:00'), 2);
      assert.equal(result.toISOString(), '2026-12-29T10:00:00.000Z');
    });
  });

  describe('addWorkingDays', () => {
    it('Fri 16:30 + 2 working days = Tue 16:30', () => {
      // Fri 2026-05-01 16:30 BST = 15:30 UTC, +2 working days (16h)
      // Fri has 0.5h remaining, Mon has 8h (8.5h), Tue has 7.5h more needed = Tue 16:30
      const result = clock.addWorkingDays(utc('2026-05-01T15:30:00'), 2);
      // Tue 2026-05-05 16:30 BST = 15:30 UTC
      assert.equal(result.toISOString(), '2026-05-05T15:30:00.000Z');
    });

    it('adding 0 working days returns same instant', () => {
      const d = utc('2026-04-29T10:00:00');
      assert.equal(clock.addWorkingDays(d, 0).getTime(), d.getTime());
    });
  });

  describe('workingHoursBetween', () => {
    it('same instant returns 0', () => {
      const d = utc('2026-04-29T10:00:00');
      assert.equal(clock.workingHoursBetween(d, d), 0);
    });

    it('counts hours within same day', () => {
      const from = utc('2026-04-29T08:00:00'); // 09:00 BST
      const to = utc('2026-04-29T11:00:00');   // 12:00 BST
      assert.equal(clock.workingHoursBetween(from, to), 3);
    });

    it('spans weekend', () => {
      // Fri 09:00 BST to Mon 17:00 BST = 8 + 8 = 16h
      const from = utc('2026-05-01T08:00:00'); // Fri 09:00 BST
      const to = utc('2026-05-04T16:00:00');   // Mon 17:00 BST
      assert.equal(clock.workingHoursBetween(from, to), 16);
    });

    it('returns negative for reversed args', () => {
      const from = utc('2026-04-29T11:00:00');
      const to = utc('2026-04-29T08:00:00');
      assert.equal(clock.workingHoursBetween(from, to), -3);
    });

    it('non-working start advances to next working time', () => {
      // Sat 12:00 to Mon 10:00 BST = 1h (Mon 09:00-10:00)
      const from = utc('2026-05-02T11:00:00');
      const to = utc('2026-05-04T09:00:00'); // Mon 10:00 BST
      assert.equal(clock.workingHoursBetween(from, to), 1);
    });
  });

  describe('DST transitions', () => {
    it('handles BST→GMT (clocks go back, last Sun in Oct)', () => {
      // 2026-10-25 is the last Sunday of October — clocks go back 02:00 BST → 01:00 GMT
      // Fri 2026-10-23 16:00 BST = 15:00 UTC, +2h = 1h Fri + skip Sat/Sun + 1h Mon
      // Mon 2026-10-26 is now GMT, 10:00 GMT = 10:00 UTC
      const result = clock.addWorkingHours(utc('2026-10-23T15:00:00'), 2);
      assert.equal(result.toISOString(), '2026-10-26T10:00:00.000Z');
    });

    it('handles GMT→BST (clocks go forward, last Sun in Mar)', () => {
      // 2026-03-29 is the last Sunday of March — clocks go forward 01:00 GMT → 02:00 BST
      // Fri 2026-03-27 16:00 GMT = 16:00 UTC, +2h = 1h Fri + skip Sat/Sun + 1h Mon
      // Mon 2026-03-30 is now BST, 10:00 BST = 09:00 UTC
      const result = clock.addWorkingHours(utc('2026-03-27T16:00:00'), 2);
      assert.equal(result.toISOString(), '2026-03-30T09:00:00.000Z');
    });
  });
});
