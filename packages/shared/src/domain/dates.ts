/**
 * Timezone-safe date arithmetic.
 *
 * Conventions used across JARVIS (see docs/DATA-MODEL.md):
 *  - **Instants** are stored as epoch milliseconds (UTC integers).
 *  - **Calendar days** are stored as `YYYY-MM-DD` day keys in the *user's* local
 *    timezone, so "due tomorrow" never shifts when the server changes timezone.
 *  - **Wall clock times** are stored as `HH:mm` strings.
 *
 * All helpers are pure and take an explicit `now` / `offsetMinutes`. `offsetMinutes`
 * is the number of minutes to *add* to UTC to obtain local time (IST = +330).
 */

export type DayKey = string; // YYYY-MM-DD
export type MonthKey = string; // YYYY-MM

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export const MONTH_ABBR = MONTH_NAMES.map((m) => m.slice(0, 3));
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const WEEKDAY_MIN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function daysInMonthOf(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/* -------------------------------------------------------------------------- */
/*  Conversions                                                               */
/* -------------------------------------------------------------------------- */

export interface LocalParts {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday */
  weekday: number;
  dayKey: DayKey;
}

/** Break an instant into local calendar parts for a given UTC offset. */
export function localParts(epochMs: number, offsetMinutes: number): LocalParts {
  const shifted = new Date(epochMs + offsetMinutes * MINUTE_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  return {
    year,
    month,
    day,
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
    dayKey: `${year}-${pad2(month)}-${pad2(day)}`,
  };
}

export function toDayKey(epochMs: number, offsetMinutes: number): DayKey {
  return localParts(epochMs, offsetMinutes).dayKey;
}

export function toMonthKey(epochMs: number, offsetMinutes: number): MonthKey {
  const p = localParts(epochMs, offsetMinutes);
  return `${p.year}-${pad2(p.month)}`;
}

export function toTimeOfDay(epochMs: number, offsetMinutes: number): string {
  const p = localParts(epochMs, offsetMinutes);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

export interface Ymd {
  year: number;
  month: number; // 1-12
  day: number;
}

export function parseDayKey(key: DayKey): Ymd {
  const [y, m, d] = key.split('-').map((n) => Number.parseInt(n, 10));
  return { year: y ?? 1970, month: m ?? 1, day: d ?? 1 };
}

/** Midnight (local) of a day key, expressed as an instant. */
export function startOfDayMs(key: DayKey, offsetMinutes: number): number {
  const { year, month, day } = parseDayKey(key);
  return Date.UTC(year, month - 1, day) - offsetMinutes * MINUTE_MS;
}

export function endOfDayMs(key: DayKey, offsetMinutes: number): number {
  return startOfDayMs(key, offsetMinutes) + DAY_MS - 1;
}

/** Combine a local date + `HH:mm` into an instant. */
export function combineDayAndTime(key: DayKey, time: string, offsetMinutes: number): number {
  const { hour, minute } = parseTime(time);
  return startOfDayMs(key, offsetMinutes) + hour * HOUR_MS + minute * MINUTE_MS;
}

export function parseTime(time: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return { hour: 0, minute: 0 };
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2])));
  return { hour, minute };
}

export function formatTime(time: string, use24Hour = false): string {
  const { hour, minute } = parseTime(time);
  if (use24Hour) return `${pad2(hour)}:${pad2(minute)}`;
  const suffix = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${pad2(minute)} ${suffix}`;
}

export function todayKey(nowMs: number, offsetMinutes: number): DayKey {
  return toDayKey(nowMs, offsetMinutes);
}

/** Current local time as minutes since local midnight (e.g. 19:30 → 1170). */
export function minutesSinceMidnight(epochMs: number, offsetMinutes: number): number {
  const p = localParts(epochMs, offsetMinutes);
  return p.hour * 60 + p.minute;
}

export function fromMinutesSinceMidnight(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
}

/** Move a `HH:mm` wall-clock time by `deltaMinutes`, wrapping within the day. */
export function shiftTime(time: string, deltaMinutes: number): string {
  const { hour, minute } = parseTime(time);
  return fromMinutesSinceMidnight(hour * 60 + minute + deltaMinutes);
}

/* -------------------------------------------------------------------------- */
/*  Day-key arithmetic                                                        */
/* -------------------------------------------------------------------------- */

export function addDays(key: DayKey, delta: number): DayKey {
  const { year, month, day } = parseDayKey(key);
  const next = new Date(Date.UTC(year, month - 1, day + delta));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

export function addMonths(key: DayKey, delta: number): DayKey {
  const { year, month, day } = parseDayKey(key);
  const targetMonth = month - 1 + delta;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const day2 = Math.min(day, daysInMonthOf(targetYear, normalizedMonth + 1));
  return `${targetYear}-${pad2(normalizedMonth + 1)}-${pad2(day2)}`;
}

export function dayDiff(a: DayKey, b: DayKey): number {
  const pa = parseDayKey(a);
  const pb = parseDayKey(b);
  const msA = Date.UTC(pa.year, pa.month - 1, pa.day);
  const msB = Date.UTC(pb.year, pb.month - 1, pb.day);
  return Math.round((msA - msB) / DAY_MS);
}

export function weekdayOfKey(key: DayKey): number {
  const { year, month, day } = parseDayKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** `weekStartsOn`: 0 = Sunday, 1 = Monday. */
export function startOfWeekKey(key: DayKey, weekStartsOn = 1): DayKey {
  const weekday = weekdayOfKey(key);
  const delta = (weekday - weekStartsOn + 7) % 7;
  return addDays(key, -delta);
}

export function endOfWeekKey(key: DayKey, weekStartsOn = 1): DayKey {
  return addDays(startOfWeekKey(key, weekStartsOn), 6);
}

export function startOfMonthKey(key: DayKey): DayKey {
  const { year, month } = parseDayKey(key);
  return `${year}-${pad2(month)}-01`;
}

export function endOfMonthKey(key: DayKey): DayKey {
  const { year, month } = parseDayKey(key);
  return `${year}-${pad2(month)}-${pad2(daysInMonthOf(year, month))}`;
}

export function monthKeyOfDay(key: DayKey): MonthKey {
  return key.slice(0, 7);
}

export function yearOfDay(key: DayKey): number {
  return parseDayKey(key).year;
}

export function daysInMonthKey(key: DayKey): number {
  const { year, month } = parseDayKey(key);
  return daysInMonthOf(year, month);
}

/** Inclusive list of day keys from `start` to `end`. */
export function eachDayKey(start: DayKey, end: DayKey): DayKey[] {
  const out: DayKey[] = [];
  const span = dayDiff(end, start);
  if (span < 0) return out;
  for (let i = 0; i <= span; i += 1) out.push(addDays(start, i));
  return out;
}

/** Six-week (42 day) grid used by month calendars. */
export function monthGridKeys(anchor: DayKey, weekStartsOn = 1): DayKey[] {
  const first = addDays(startOfMonthKey(anchor), -6);
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

/* -------------------------------------------------------------------------- */
/*  Formatting                                                                */
/* -------------------------------------------------------------------------- */

export function formatDayKey(key: DayKey, style: 'short' | 'medium' | 'long' | 'monthDay' = 'medium'): string {
  const { year, month, day } = parseDayKey(key);
  switch (style) {
    case 'short':
      return `${MONTH_ABBR[month - 1]} ${day}`;
    case 'long':
      return `${WEEKDAY_NAMES[weekdayOfKey(key)]}, ${MONTH_NAMES[month - 1]} ${day}, ${year}`;
    case 'monthDay':
      return `${MONTH_NAMES[month - 1]} ${day}`;
    case 'medium':
    default:
      return `${WEEKDAY_ABBR[weekdayOfKey(key)]} ${MONTH_ABBR[month - 1]} ${day}`;
  }
}

export function formatMonthKey(key: MonthKey, style: 'long' | 'short' = 'long'): string {
  const [y, m] = key.split('-').map((n) => Number.parseInt(n, 10));
  const idx = Math.max(0, Math.min(11, (m ?? 1) - 1));
  return style === 'short' ? `${MONTH_ABBR[idx]} ${y}` : `${MONTH_NAMES[idx]} ${y}`;
}

export function relativeDayLabel(key: DayKey, today: DayKey, use24Hour = false): string {
  const diff = dayDiff(key, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return WEEKDAY_NAMES[weekdayOfKey(key)] ?? key;
  if (diff < -1 && diff > -7) return `Last ${WEEKDAY_ABBR[weekdayOfKey(key)]}`;
  void use24Hour;
  return formatDayKey(key, 'medium');
}

export function greetingFor(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

/** "1h 25m" / "45m" / "2h" */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

/** "1:05" / "25:00" — for countdown timers. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${pad2(m)}:${pad2(sec)}`;
  return `${pad2(m)}:${pad2(sec)}`;
}

export function describeDue(
  dayKey: DayKey | null,
  time: string | null,
  today: DayKey,
  use24Hour = false,
): string {
  if (!dayKey) return 'No date';
  const base = relativeDayLabel(dayKey, today, use24Hour);
  return time ? `${base} · ${formatTime(time, use24Hour)}` : base;
}
