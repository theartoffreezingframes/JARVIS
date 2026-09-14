import { addDays, addMonths, parseDayKey, weekdayOfKey, type DayKey } from './dates';
import type { RecurrenceKind } from './primitives';

export interface RecurrenceRule {
  kind: RecurrenceKind;
  /** Repeat every N periods (1 = every day/week/month). */
  interval: number;
  /** 0-6 (Sunday based), used by `weekly`. Empty = same weekday as the anchor. */
  byWeekday: number[];
  /** Stop generating occurrences after this day (inclusive). */
  until: DayKey | null;
  /** Number of occurrences already generated from this task. */
  count: number;
  /** Optional cap on total occurrences. */
  maxOccurrences: number | null;
}

export const DEFAULT_RECURRENCE: RecurrenceRule = {
  kind: 'none',
  interval: 1,
  byWeekday: [],
  until: null,
  count: 0,
  maxOccurrences: null,
};

export const RECURRENCE_LABEL: Record<RecurrenceKind, string> = {
  none: 'Does not repeat',
  daily: 'Every day',
  weekdays: 'Every weekday',
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
};

/**
 * Next occurrence strictly after `from`.
 * Returns `null` when the rule is exhausted (`until` / `maxOccurrences`).
 */
export function nextOccurrence(anchor: DayKey, rule: RecurrenceRule, from: DayKey): DayKey | null {
  if (rule.kind === 'none') return null;

  const interval = Math.max(1, Math.floor(rule.interval || 1));
  const exhaustedByCount =
    rule.maxOccurrences != null && rule.count + 1 > rule.maxOccurrences;
  if (exhaustedByCount) return null;

  const withinUntil = (candidate: DayKey) => !rule.until || candidate <= rule.until;

  switch (rule.kind) {
    case 'daily': {
      let cursor = anchor;
      // Jump forward in interval steps until we pass `from`.
      let guard = 0;
      while (cursor <= from && guard < 4000) {
        cursor = addDays(cursor, interval);
        guard += 1;
      }
      return withinUntil(cursor) ? cursor : null;
    }
    case 'weekdays': {
      let cursor = addDays(anchor, 1);
      let guard = 0;
      while ((cursor <= from || weekdayOfKey(cursor) === 0 || weekdayOfKey(cursor) === 6) && guard < 4000) {
        cursor = addDays(cursor, 1);
        guard += 1;
      }
      return withinUntil(cursor) ? cursor : null;
    }
    case 'weekly': {
      const days = rule.byWeekday.length ? [...rule.byWeekday].sort((a, b) => a - b) : [weekdayOfKey(anchor)];
      // Search day by day, bounded to interval*7 * 4 windows.
      const horizon = addDays(from, interval * 7 * 4 + 7);
      let cursor = addDays(from, 1);
      while (cursor <= horizon) {
        const weeksSinceAnchor = Math.floor((dateToUtcMs(cursor) - dateToUtcMs(startOfWeekOf(anchor))) / (7 * 86_400_000));
        if (weeksSinceAnchor % interval === 0 && days.includes(weekdayOfKey(cursor)) && cursor > anchor) {
          return withinUntil(cursor) ? cursor : null;
        }
        cursor = addDays(cursor, 1);
      }
      return null;
    }
    case 'monthly': {
      let cursor = addMonths(anchor, interval);
      let guard = 0;
      while (cursor <= from && guard < 400) {
        cursor = addMonths(cursor, interval);
        guard += 1;
      }
      return withinUntil(cursor) ? cursor : null;
    }
    case 'yearly': {
      let cursor = addMonths(anchor, 12 * interval);
      let guard = 0;
      while (cursor <= from && guard < 100) {
        cursor = addMonths(cursor, 12 * interval);
        guard += 1;
      }
      return withinUntil(cursor) ? cursor : null;
    }
    default:
      return null;
  }
}

function startOfWeekOf(key: DayKey): DayKey {
  const wd = weekdayOfKey(key);
  return addDays(key, -wd);
}

function dateToUtcMs(key: DayKey): number {
  const { year, month, day } = parseDayKey(key);
  return Date.UTC(year, month - 1, day);
}

/** Group daily habits into their weekly cadence for streak maths. */
export function periodKeyForFrequency(kind: RecurrenceKind, day: DayKey): string {
  switch (kind) {
    case 'daily':
    case 'weekdays':
      return day;
    case 'weekly':
      return startOfWeekOf(day);
    case 'monthly':
      return day.slice(0, 7);
    case 'yearly':
      return day.slice(0, 4);
    default:
      return day;
  }
}

export function describeRecurrence(rule: RecurrenceRule): string {
  if (rule.kind === 'none') return 'One-off task';
  const interval = Math.max(1, rule.interval || 1);
  const base = RECURRENCE_LABEL[rule.kind].toLowerCase();
  if (interval === 1) return RECURRENCE_LABEL[rule.kind];
  return base.replace('every ', `every ${interval} `);
}
