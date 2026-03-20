import SunCalc from 'suncalc';

// Vancouver coordinates
export const LAT = 49.2827;
export const LNG = -123.1207;

// DST transitions for 2026
export const SPRING_FORWARD = new Date(2026, 2, 8); // March 8
export const FALL_BACK = new Date(2026, 10, 1);     // November 1

export const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export type DayData = {
  date: Date;
  dayOfYear: number;
  label: string;
  sunrise: number;
  sunset: number;
};

export function utcDecimalHours(d: Date): number {
  return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
}

export function toLocalDecimal(utcH: number, offset: number): number {
  let local = utcH + offset;
  if (local < 0) local += 24;
  return local;
}

export function isDstActive(date: Date): boolean {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return d >= SPRING_FORWARD && d < FALL_BACK;
}

export function formatHour(h: number): string {
  const normalized = h % 24;
  const period = normalized < 12 ? 'AM' : 'PM';
  let display = normalized % 12;
  if (display === 0) display = 12;
  return `${display} ${period}`;
}

export function decimalToTime(d: number): string {
  const h = Math.floor(d);
  const m = Math.round((d - h) * 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
}

export function fmtTime(h: number): string {
  const hour = Math.floor(h);
  const min = Math.round((h - hour) * 60);
  const suffix = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 || 12;
  return `${h12}:${min.toString().padStart(2, '0')} ${suffix}`;
}

export function fmtDayLength(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
}

export function generateDailyData(offsetFn: (date: Date) => number): DayData[] {
  const result: DayData[] = [];
  for (let month = 0; month < 12; month++) {
    const daysInMonth = new Date(2026, month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(2026, month, day);
      const dayOfYear = Math.round((date.getTime() - new Date(2026, 0, 1).getTime()) / 86400000) + 1;
      const times = SunCalc.getTimes(date, LAT, LNG);
      const offset = offsetFn(date);
      const sunrise = toLocalDecimal(utcDecimalHours(times.sunrise), offset);
      const sunset = toLocalDecimal(utcDecimalHours(times.sunset), offset);
      const label = `${MONTH_NAMES[month]} ${day}`;
      result.push({ date, dayOfYear, label, sunrise, sunset });
    }
  }
  return result;
}

export type SportEntry = {
  icon: string;
  league: string;
  context: string;
  source: string;
  pdt: string;
  dst: string;
  pst: string;
  takeaway: string;
};

export const sportsData: SportEntry[] = [
  {
    icon: '\u{1F3D2}',
    league: 'Vancouver Canucks (NHL)',
    context: 'Away game in Toronto, January',
    source: 'Game starts 7:00 PM EST (UTC\u22125) = 00:00 UTC',
    pdt: '5:00 PM',
    dst: '4:00 PM',
    pst: '4:00 PM',
    takeaway: 'Permanent PDT: watch Canucks away games 1 hour later than standard time'
  },
  {
    icon: '\u{1F3C6}',
    league: 'UEFA Champions League',
    context: 'Round of 16 first leg, February',
    source: 'Kickoff 21:00 CET (UTC+1) = 20:00 UTC',
    pdt: '1:00 PM',
    dst: '12:00 PM',
    pst: '12:00 PM',
    takeaway: 'Permanent PDT: Champions League knockout ties kick off at 1 PM, not noon'
  },
  {
    icon: '\u{1F3C8}',
    league: 'NFL',
    context: 'Sunday afternoon game, January playoffs',
    source: 'Kickoff 1:00 PM EST (UTC\u22125) = 18:00 UTC',
    pdt: '11:00 AM',
    dst: '10:00 AM',
    pst: '10:00 AM',
    takeaway: 'Permanent PDT: early NFL games start at 11 AM instead of 10 AM'
  }
];
