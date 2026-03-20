import { describe, it, expect } from 'vitest';
import {
  utcDecimalHours,
  toLocalDecimal,
  isDstActive,
  formatHour,
  decimalToTime,
  fmtTime,
  fmtDayLength,
  generateDailyData,
  sportsData,
  SPRING_FORWARD,
  FALL_BACK,
} from '../utils';

// ── utcDecimalHours ─────────────────────────────────────────────────────

describe('utcDecimalHours', () => {
  it('returns 0 for midnight UTC', () => {
    const d = new Date('2026-06-15T00:00:00Z');
    expect(utcDecimalHours(d)).toBe(0);
  });

  it('returns 12 for noon UTC', () => {
    const d = new Date('2026-06-15T12:00:00Z');
    expect(utcDecimalHours(d)).toBe(12);
  });

  it('handles minutes as decimal fractions', () => {
    const d = new Date('2026-06-15T06:30:00Z');
    expect(utcDecimalHours(d)).toBe(6.5);
  });

  it('handles seconds as decimal fractions', () => {
    const d = new Date('2026-06-15T06:00:36Z');
    expect(utcDecimalHours(d)).toBeCloseTo(6.01, 2);
  });
});

// ── toLocalDecimal ──────────────────────────────────────────────────────

describe('toLocalDecimal', () => {
  it('converts UTC to PDT (offset -7)', () => {
    expect(toLocalDecimal(20, -7)).toBe(13);
  });

  it('converts UTC to PST (offset -8)', () => {
    expect(toLocalDecimal(20, -8)).toBe(12);
  });

  it('wraps negative values to previous day', () => {
    // 3 UTC with offset -8 = -5 → wraps to 19
    expect(toLocalDecimal(3, -8)).toBe(19);
  });

  it('handles midnight UTC with PDT offset', () => {
    expect(toLocalDecimal(0, -7)).toBe(17); // wraps: 0-7=-7 → +24=17
  });
});

// ── isDstActive ─────────────────────────────────────────────────────────

describe('isDstActive', () => {
  it('returns false before spring forward (March 7)', () => {
    expect(isDstActive(new Date(2026, 2, 7))).toBe(false);
  });

  it('returns true on spring forward day (March 8)', () => {
    expect(isDstActive(new Date(2026, 2, 8))).toBe(true);
  });

  it('returns true in summer (July 15)', () => {
    expect(isDstActive(new Date(2026, 6, 15))).toBe(true);
  });

  it('returns true on October 31 (day before fall back)', () => {
    expect(isDstActive(new Date(2026, 9, 31))).toBe(true);
  });

  it('returns false on fall back day (November 1)', () => {
    expect(isDstActive(new Date(2026, 10, 1))).toBe(false);
  });

  it('returns false in winter (January 15)', () => {
    expect(isDstActive(new Date(2026, 0, 15))).toBe(false);
  });

  it('returns false in December', () => {
    expect(isDstActive(new Date(2026, 11, 25))).toBe(false);
  });
});

// ── formatHour ──────────────────────────────────────────────────────────

describe('formatHour', () => {
  it('formats midnight (0) as 12 AM', () => {
    expect(formatHour(0)).toBe('12 AM');
  });

  it('formats noon (12) as 12 PM', () => {
    expect(formatHour(12)).toBe('12 PM');
  });

  it('formats 7 as 7 AM', () => {
    expect(formatHour(7)).toBe('7 AM');
  });

  it('formats 23 as 11 PM', () => {
    expect(formatHour(23)).toBe('11 PM');
  });

  it('handles 24+ values by wrapping (25 = 1 AM)', () => {
    expect(formatHour(25)).toBe('1 AM');
  });

  it('handles 26 as 2 AM', () => {
    expect(formatHour(26)).toBe('2 AM');
  });
});

// ── decimalToTime ───────────────────────────────────────────────────────

describe('decimalToTime', () => {
  it('formats whole hours', () => {
    expect(decimalToTime(9)).toBe('9:00');
  });

  it('formats half hours', () => {
    expect(decimalToTime(9.5)).toBe('9:30');
  });

  it('formats quarter hours', () => {
    expect(decimalToTime(14.25)).toBe('14:15');
  });
});

// ── fmtTime ─────────────────────────────────────────────────────────────

describe('fmtTime', () => {
  it('formats morning time', () => {
    expect(fmtTime(7.5)).toBe('7:30 AM');
  });

  it('formats afternoon time', () => {
    expect(fmtTime(17.75)).toBe('5:45 PM');
  });

  it('formats noon', () => {
    expect(fmtTime(12.0)).toBe('12:00 PM');
  });

  it('formats midnight', () => {
    expect(fmtTime(0)).toBe('12:00 AM');
  });
});

// ── fmtDayLength ────────────────────────────────────────────────────────

describe('fmtDayLength', () => {
  it('formats whole hours', () => {
    expect(fmtDayLength(8)).toBe('8h 0m');
  });

  it('formats hours and minutes', () => {
    expect(fmtDayLength(12.5)).toBe('12h 30m');
  });

  it('formats short day', () => {
    expect(fmtDayLength(8.25)).toBe('8h 15m');
  });
});

// ── generateDailyData ───────────────────────────────────────────────────

describe('generateDailyData', () => {
  const pdtData = generateDailyData(() => -7);
  const pstData = generateDailyData(() => -8);
  const dstData = generateDailyData((date) => isDstActive(date) ? -7 : -8);

  it('generates 365 days for 2026', () => {
    expect(pdtData).toHaveLength(365);
  });

  it('first day is Jan 1', () => {
    expect(pdtData[0].label).toBe('Jan 1');
    expect(pdtData[0].dayOfYear).toBe(1);
  });

  it('last day is Dec 31', () => {
    expect(pdtData[364].label).toBe('Dec 31');
  });

  it('sunrise is before sunset for every day', () => {
    for (const d of pdtData) {
      expect(d.sunrise).toBeLessThan(d.sunset);
    }
  });

  // Summer solstice plausibility (June 20-21)
  it('summer solstice has earliest sunrise (~5 AM PDT) and latest sunset (~9 PM PDT)', () => {
    const solstice = pdtData.find(d => d.date.getMonth() === 5 && d.date.getDate() === 21)!;
    expect(solstice.sunrise).toBeGreaterThan(4);
    expect(solstice.sunrise).toBeLessThan(6);
    expect(solstice.sunset).toBeGreaterThan(20);
    expect(solstice.sunset).toBeLessThan(22);
  });

  // Winter solstice plausibility (December 21)
  it('winter solstice has latest sunrise (~9 AM PDT) and earliest sunset (~5 PM PDT)', () => {
    const solstice = pdtData.find(d => d.date.getMonth() === 11 && d.date.getDate() === 21)!;
    expect(solstice.sunrise).toBeGreaterThan(8);
    expect(solstice.sunrise).toBeLessThan(10);
    expect(solstice.sunset).toBeGreaterThan(16);
    expect(solstice.sunset).toBeLessThan(18);
  });

  it('PST sunrise is 1 hour earlier than PDT on same date', () => {
    const pdtJan = pdtData[14]; // Jan 15
    const pstJan = pstData[14];
    expect(pdtJan.sunrise - pstJan.sunrise).toBeCloseTo(1, 1);
    expect(pdtJan.sunset - pstJan.sunset).toBeCloseTo(1, 1);
  });

  it('DST data matches PST in winter and PDT in summer', () => {
    // January 15 (winter) — DST should be UTC-8 like PST
    const dstWinter = dstData[14];
    const pstWinter = pstData[14];
    expect(dstWinter.sunrise).toBeCloseTo(pstWinter.sunrise, 5);

    // July 15 (summer) — DST should be UTC-7 like PDT
    const julyIdx = pdtData.findIndex(d => d.date.getMonth() === 6 && d.date.getDate() === 15);
    const dstSummer = dstData[julyIdx];
    const pdtSummer = pdtData[julyIdx];
    expect(dstSummer.sunrise).toBeCloseTo(pdtSummer.sunrise, 5);
  });

  // schoolDarkDays and workDaylightDays ordering
  it('PDT has more school dark days than PST (sunrise > 8:30)', () => {
    const pdtDark = pdtData.filter(d => d.sunrise > 8.5).length;
    const pstDark = pstData.filter(d => d.sunrise > 8.5).length;
    expect(pdtDark).toBeGreaterThan(pstDark);
  });

  it('PDT has more work daylight days than PST (sunset > 17:00)', () => {
    const pdtLight = pdtData.filter(d => d.sunset > 17.0).length;
    const pstLight = pstData.filter(d => d.sunset > 17.0).length;
    expect(pdtLight).toBeGreaterThan(pstLight);
  });

  it('DST school dark days is between PST and PDT', () => {
    const pdtDark = pdtData.filter(d => d.sunrise > 8.5).length;
    const pstDark = pstData.filter(d => d.sunrise > 8.5).length;
    const dstDark = dstData.filter(d => d.sunrise > 8.5).length;
    expect(dstDark).toBeGreaterThanOrEqual(pstDark);
    expect(dstDark).toBeLessThanOrEqual(pdtDark);
  });
});

// ── sportsData ──────────────────────────────────────────────────────────

describe('sportsData', () => {
  it('has 3 sports entries', () => {
    expect(sportsData).toHaveLength(3);
  });

  it('each entry has pdt, dst, and pst times', () => {
    for (const sport of sportsData) {
      expect(sport.pdt).toBeTruthy();
      expect(sport.dst).toBeTruthy();
      expect(sport.pst).toBeTruthy();
    }
  });

  it('each entry has required fields', () => {
    for (const sport of sportsData) {
      expect(sport.icon).toBeTruthy();
      expect(sport.league).toBeTruthy();
      expect(sport.context).toBeTruthy();
      expect(sport.source).toBeTruthy();
      expect(sport.takeaway).toBeTruthy();
    }
  });

  it('NHL entry has correct times', () => {
    const nhl = sportsData[0];
    expect(nhl.pdt).toBe('5:00 PM');
    expect(nhl.dst).toBe('4:00 PM');
    expect(nhl.pst).toBe('4:00 PM');
  });

  it('NFL entry has correct times', () => {
    const nfl = sportsData[2];
    expect(nfl.pdt).toBe('11:00 AM');
    expect(nfl.dst).toBe('10:00 AM');
    expect(nfl.pst).toBe('10:00 AM');
  });
});
