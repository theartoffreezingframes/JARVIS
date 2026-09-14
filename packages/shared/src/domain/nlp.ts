/**
 * Natural-language task capture.
 *
 * Runs entirely on-device (and identically on the server, since it is pure) so
 * that "Finish DSA assignment tomorrow at 7 PM" becomes a real task with a real
 * date without any network hop. Chat-style AI parsers can be layered on top
 * later — `ParsedTaskDraft` is the stable contract.
 */

import {
  addDays,
  DAY_MS,
  MONTH_ABBR,
  type DayKey,
  startOfDayMs,
  toDayKey,
  toTimeOfDay,
  weekdayOfKey,
} from './dates';
import type { Priority, RecurrenceKind } from './primitives';

export interface ParsedMatch {
  kind:
    | 'date'
    | 'time'
    | 'duration'
    | 'priority'
    | 'tag'
    | 'project'
    | 'recurrence'
    | 'reminder'
    | 'flag';
  text: string;
  value: string | number | boolean | null;
  start: number;
  end: number;
}

export interface ParsedTaskDraft {
  title: string;
  dueDate: DayKey | null;
  dueTime: string | null;
  priority: Priority | null;
  important: boolean | null;
  urgent: boolean | null;
  estimatedMinutes: number | null;
  recurrenceKind: RecurrenceKind | null;
  recurrenceWeekdays: number[];
  reminderOffsetMinutes: number | null;
  tags: string[];
  projectName: string | null;
  /** 0..1 — how much structure was recognised. */
  confidence: number;
  matches: ParsedMatch[];
  /** human readable summary of what was understood */
  explanation: string[];
}

export interface ParseContext {
  now: number;
  offsetMinutes: number;
  defaultDurationMinutes?: number;
}

/* -------------------------------------------------------------------------- */
/*  Pattern primitives                                                        */
/* -------------------------------------------------------------------------- */

interface RawMatch {
  kind: ParsedMatch['kind'];
  start: number;
  end: number;
  value: string | number | boolean | null;
  text: string;
  /** lower = higher priority when spans overlap */
  weight: number;
}

const WEEKDAY_LOOKUP: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

const MONTH_LOOKUP: Record<string, number> = MONTH_ABBR.reduce<Record<string, number>>((acc, abbr, idx) => {
  acc[abbr.toLowerCase()] = idx + 1;
  return acc;
}, {});

const FULL_MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
FULL_MONTHS.forEach((name, idx) => {
  MONTH_LOOKUP[name] = idx + 1;
});

const DAYPART_TIMES: Record<string, string> = {
  morning: '09:00',
  noon: '12:00',
  midday: '12:00',
  afternoon: '14:00',
  evening: '19:00',
  tonight: '20:00',
  night: '21:00',
  midnight: '00:00',
};

const PRIORITY_WORDS: Record<string, Priority> = {
  urgent: 'urgent',
  asap: 'urgent',
  critical: 'urgent',
  blocker: 'urgent',
  important: 'high',
  high: 'high',
  medium: 'medium',
  normal: 'medium',
  low: 'low',
  someday: 'low',
  whenever: 'low',
};

/* -------------------------------------------------------------------------- */
/*  Collection                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Scans `text` for structured signals, skipping spans already claimed by a
 * higher-weight (more specific) match. Weighting is what keeps "tomorrow at
 * 7 PM" from also being read as "at 7" and "+ 'PM' as a separate token".
 */
function collect(text: string, ctx: ParseContext): RawMatch[] {
  const lower = text.toLowerCase();
  const matches: RawMatch[] = [];

  const claim = (m: RawMatch): boolean => {
    for (const existing of matches) {
      const overlaps = m.start < existing.end && existing.start < m.end;
      if (overlaps && existing.weight <= m.weight) return false;
    }
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const existing = matches[i]!;
      const overlaps = m.start < existing.end && existing.start < m.end;
      if (overlaps) matches.splice(i, 1);
    }
    matches.push(m);
    return true;
  };

  const today = toDayKey(ctx.now, ctx.offsetMinutes);

  const push = (
    regex: RegExp,
    kind: ParsedMatch['kind'],
    weight: number,
    resolve: (groups: RegExpExecArray) => string | number | boolean | null,
    accept?: (groups: RegExpExecArray) => boolean,
  ) => {
    regex.lastIndex = 0;
    let exec: RegExpExecArray | null;
    while ((exec = regex.exec(lower)) !== null) {
      if (accept && !accept(exec)) {
        if (exec.index === regex.lastIndex) regex.lastIndex += 1;
        continue;
      }
      const value = resolve(exec);
      if (value === null) continue;
      const start = exec.index + (exec[0].length - exec[0].trimStart().length);
      const end = exec.index + exec[0].length;
      const claimed = claim({ kind, start, end: end, value, text: text.slice(start, end), weight });
      if (claimed) matches.sort((a, b) => a.start - b.start);
      if (exec.index === regex.lastIndex) regex.lastIndex += 1;
    }
  };

  /* ---- reminders (must be claimed before plain durations/dates) ---------- */
  push(
    /\b(?:remind(?:er)?(?:\s+me)?)\s+(?:in\s+)?(\d{1,3})\s*(m|min|mins|minutes|h|hr|hrs|hours?|d|days?)\s*(?:before|prior|early|ahead)?\b/g,
    'reminder',
    1,
    (g) => {
      const amount = Number(g[1]);
      const unit = (g[2] ?? '').toLowerCase();
      if (unit.startsWith('d')) return amount * 1440;
      if (unit.startsWith('h')) return amount * 60;
      return amount;
    },
  );

  /* ---- recurrence ------------------------------------------------------- */
  const notLeading = (g: RegExpExecArray) => g.index > 0;
  push(/\b(?:every\s+day|daily|each\s+day)\b/g, 'recurrence', 1, () => 'daily', notLeading);
  push(/\b(?:every\s+weekday|weekdays|on\s+weekdays)\b/g, 'recurrence', 1, () => 'weekdays');
  push(/\b(?:every\s+week|weekly|each\s+week)\b/g, 'recurrence', 1, () => 'weekly', notLeading);
  push(/\b(?:every\s+month|monthly|each\s+month)\b/g, 'recurrence', 1, () => 'monthly', notLeading);
  push(/\b(?:every\s+year|yearly|annually|each\s+year)\b/g, 'recurrence', 1, () => 'yearly', notLeading);
  push(
    /\bevery\s+(sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)\b/g,
    'recurrence',
    1,
    (g) => `weekly:${WEEKDAY_LOOKUP[g[1] ?? ''] ?? 1}`,
  );

  /* ---- absolute dates --------------------------------------------------- */
  const year = Number(today.slice(0, 4));
  push(
    /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    'date',
    1,
    (g) => `${g[1]}-${g[2]}-${g[3]}`,
  );
  push(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b(?:\s+(\d{4}))?/g,
    'date',
    1,
    (g) => {
      const day = Number(g[1]);
      const month = MONTH_LOOKUP[g[2] ?? ''] ?? 1;
      const y = g[3] ? Number(g[3]) : year;
      return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    },
  );
  push(
    /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:\s*,?\s*(\d{4}))?/g,
    'date',
    1,
    (g) => {
      const month = MONTH_LOOKUP[g[1] ?? ''] ?? 1;
      const day = Number(g[2]);
      const y = g[3] ? Number(g[3]) : year;
      return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    },
  );

  /* ---- relative dates --------------------------------------------------- */
  push(/\b(?:the\s+)?day\s+after\s+tomorrow\b/g, 'date', 2, () => addDays(today, 2));
  push(/\b(?:tomorrow|tmrw|tmr|tomoz)\b/g, 'date', 2, () => addDays(today, 1));
  push(/\b(?:today|tonight)\b/g, 'date', 3, () => today);
  push(/\byesterday\b/g, 'date', 2, () => addDays(today, -1));
  push(
    /\bin\s+(\d{1,3})\s*(m|min|mins|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)\b/g,
    'date',
    2,
    (g) => {
      const amount = Number(g[1]);
      const unit = (g[2] ?? '').toLowerCase();
      const deltaMs =
        unit.startsWith('w') ? amount * 7 * DAY_MS
          : unit.startsWith('d') ? amount * DAY_MS
            : unit.startsWith('h') ? amount * 3_600_000
              : amount * 60_000;
      const target = ctx.now + deltaMs;
      const dayKey = toDayKey(target, ctx.offsetMinutes);
      // sub-day offsets resolve to a concrete clock time
      if (!unit.startsWith('d') && !unit.startsWith('w')) {
        return `${dayKey}|${toTimeOfDay(target, ctx.offsetMinutes)}`;
      }
      return dayKey;
    },
  );
  push(/\bnext\s+week\b/g, 'date', 2, () => addDays(today, 7));
  push(/\bnext\s+month\b/g, 'date', 2, () => addDays(today, 30));
  push(
    /\b(next\s+|this\s+|on\s+|by\s+)?(sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)\b/g,
    'date',
    2,
    (g) => {
      const modifier = (g[1] ?? '').trim();
      const target = WEEKDAY_LOOKUP[g[2] ?? ''];
      if (target === undefined) return null;
      if (modifier === 'on' || modifier === 'by') return null; // bare weekday handled below
      const current = weekdayOfKey(today);
      let delta = (target - current + 7) % 7;
      // "monday" on a Monday means next week; "next monday" always moves forward.
      if (delta === 0) delta = 7;
      return addDays(today, delta);
    },
  );
  push(
    /\b(?:on|by|due)\s+(sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)\b/g,
    'date',
    2,
    (g) => {
      const target = WEEKDAY_LOOKUP[g[1] ?? ''];
      if (target === undefined) return null;
      const current = weekdayOfKey(today);
      let delta = (target - current + 7) % 7;
      if (delta === 0) delta = 7;
      return addDays(today, delta);
    },
  );

  /* ---- times ------------------------------------------------------------ */
  push(
    /\b(?:at|by|before|around|from)?\s*(\d{1,2}):(\d{2})\s*(am|pm)?\b/g,
    'time',
    2,
    (g) => {
      let hour = Number(g[1]);
      const minute = Number(g[2]);
      const meridiem = g[3];
      if (!meridiem && !/\b(?:at|by|before|around)\b/.test(g[0])) return null;
      if (meridiem === 'pm' && hour < 12) hour += 12;
      if (meridiem === 'am' && hour === 12) hour = 0;
      if (hour > 23 || minute > 59) return null;
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    },
  );
  push(
    /\b(?:at|by|before|around|from)?\s*(\d{1,2})\s*(am|pm)\b/g,
    'time',
    2,
    (g) => {
      let hour = Number(g[1]);
      const meridiem = g[2];
      if (hour > 12 || hour === 0) return null;
      if (meridiem === 'pm' && hour < 12) hour += 12;
      if (meridiem === 'am' && hour === 12) hour = 0;
      return `${String(hour).padStart(2, '0')}:00`;
    },
  );
  push(
    /\b(?:at|by|before|around)\s+(\d{1,2})\b(?!\s*(?::|am|pm|%))/g,
    'time',
    3,
    (g) => {
      const hour = Number(g[1]);
      if (hour > 23) return null;
      return `${String(hour).padStart(2, '0')}:00`;
    },
  );
  push(
    /\b(morning|afternoon|evening|night|noon|midday|midnight)\b/g,
    'time',
    3,
    (g) => DAYPART_TIMES[g[1] ?? ''] ?? null,
  );

  /* ---- duration --------------------------------------------------------- */
  push(
    /\b(?:for|~|approx\.?|about|est\.?)?\s*(\d{1,3}(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/g,
    'duration',
    3,
    (g) => Math.round(Number(g[1]) * 60),
  );
  push(
    /\b(?:for|~|approx\.?|about|est\.?)?\s*(\d{1,3})\s*(?:m|min|mins|minute|minutes)\b/g,
    'duration',
    3,
    (g) => Number(g[1]),
  );

  /* ---- priority & flags -------------------------------------------------- */
  push(/!(urgent|high|medium|low)\b/g, 'priority', 1, (g) => PRIORITY_WORDS[g[1] ?? ''] ?? null);
  push(/\bp([1-4])\b/g, 'priority', 1, (g) => (['urgent', 'high', 'medium', 'low'] as Priority[])[Number(g[1]) - 1] ?? null);
  push(/\b(urgent|asap|critical|blocker)\b/g, 'priority', 4, (g) => PRIORITY_WORDS[g[1] ?? ''] ?? null);
  push(/\b(not urgent|non-urgent|no rush)\b/g, 'flag', 2, () => 'urgent:false');
  push(/\b(important|high priority)\b/g, 'flag', 4, () => 'important:true');
  push(/\b(not important|unimportant|low priority)\b/g, 'flag', 2, () => 'important:false');

  /* ---- tags & projects --------------------------------------------------- */
  push(/#([\p{L}\p{N}_-]{1,32})/gu, 'tag', 1, (g) => g[1] ?? null);
  push(/@([\p{L}\p{N}_-]{1,32})/gu, 'project', 1, (g) => g[1] ?? null);

  return matches.sort((a, b) => a.start - b.start);
}

/* -------------------------------------------------------------------------- */
/*  Title reconstruction                                                      */
/* -------------------------------------------------------------------------- */

const DANGLING = /^(?:at|by|before|on|in|from|for|due|the|a|an|to|until|around|about|next|this|remind(?:er)?|me|of|and|,|\.|-|–|—|\s)+$/i;

function buildTitle(text: string, matches: readonly RawMatch[], removeAll: boolean): string {
  if (!removeAll) return text.trim();
  const keep: string[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) keep.push(text.slice(cursor, m.start));
    cursor = Math.max(cursor, m.end);
  }
  keep.push(text.slice(cursor));
  let title = keep
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
  // strip dangling prepositions left behind by removed spans
  const words = title.split(' ');
  while (words.length > 1 && DANGLING.test(words[0] ?? '')) words.shift();
  while (words.length > 1 && DANGLING.test(words[words.length - 1] ?? '')) words.pop();
  title = words.join(' ').replace(/^[,.;:\-\s]+|[,.;:\-\s]+$/g, '').trim();
  if (!title) title = 'Untitled task';
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

export function parseNaturalLanguageTask(input: string, ctx: ParseContext): ParsedTaskDraft {
  const text = input.replace(/\s+/g, ' ').trim();
  const matches = collect(text, ctx);

  let dueDate: DayKey | null = null;
  let dueTime: string | null = null;
  let priority: Priority | null = null;
  let important: boolean | null = null;
  let urgent: boolean | null = null;
  let estimatedMinutes: number | null = null;
  let recurrenceKind: RecurrenceKind | null = null;
  let recurrenceWeekdays: number[] = [];
  let reminderOffsetMinutes: number | null = null;
  const tags: string[] = [];
  let projectName: string | null = null;

  for (const m of matches) {
    switch (m.kind) {
      case 'date':
        if (typeof m.value === 'string' && !dueDate) {
          const [dayPart, timePart] = m.value.split('|');
          dueDate = dayPart ?? null;
          if (timePart && !dueTime) dueTime = timePart;
        }
        break;
      case 'time':
        if (typeof m.value === 'string' && !dueTime) dueTime = m.value;
        break;
      case 'duration':
        if (typeof m.value === 'number') estimatedMinutes = m.value;
        break;
      case 'priority':
        if (typeof m.value === 'string') priority = m.value as Priority;
        break;
      case 'flag':
        if (m.value === 'important:true') important = true;
        if (m.value === 'important:false') important = false;
        if (m.value === 'urgent:true') urgent = true;
        if (m.value === 'urgent:false') urgent = false;
        break;
      case 'recurrence':
        if (typeof m.value === 'string') {
          if (m.value.startsWith('weekly:')) {
            recurrenceKind = 'weekly';
            const wd = Number(m.value.split(':')[1]);
            if (!Number.isNaN(wd)) recurrenceWeekdays = [...new Set([...recurrenceWeekdays, wd])];
          } else {
            recurrenceKind = m.value as RecurrenceKind;
          }
        }
        break;
      case 'reminder':
        if (typeof m.value === 'number') reminderOffsetMinutes = m.value;
        break;
      case 'tag':
        if (typeof m.value === 'string' && !tags.includes(m.value)) tags.push(m.value);
        break;
      case 'project':
        if (typeof m.value === 'string') projectName = m.value;
        break;
      default:
        break;
    }
  }

  /* Time-only input implies today (or tomorrow if already past). */
  if (!dueDate && dueTime) {
    const todayKey = toDayKey(ctx.now, ctx.offsetMinutes);
    const current = toTimeOfDay(ctx.now, ctx.offsetMinutes);
    dueDate = dueTime < current ? addDays(todayKey, 1) : todayKey;
  }

  /* Recurrence implies a start date if none was given. */
  if (!dueDate && recurrenceKind) {
    dueDate = toDayKey(ctx.now, ctx.offsetMinutes);
  }

  /* "tonight/evening" style date words can also carry a time-of-day meaning. */
  if (dueDate && !dueTime) {
    const daypart = /\b(tonight|morning|afternoon|evening|night|noon|midnight)\b/i.exec(text);
    if (daypart) dueTime = DAYPART_TIMES[(daypart[1] ?? '').toLowerCase()] ?? null;
  }

  /* A stated "urgent" priority is also an urgency signal for the matrix. */
  if (priority === 'urgent' && urgent === null) urgent = true;
  if (priority === 'low' && urgent === null) urgent = false;

  /* Urgency drives priority when the user did not state one explicitly. */
  if (!priority) {
    if (urgent === true && important === true) priority = 'urgent';
    else if (important === true) priority = 'high';
    else if (urgent === true) priority = 'medium';
  }

  const significant = matches.filter((m) => m.kind !== 'flag');
  const hasTimeSignal = Boolean(dueDate || dueTime || recurrenceKind);
  const confidenceSignals =
    (dueDate ? 1 : 0) + (dueTime ? 1 : 0) + (priority ? 1 : 0) + (estimatedMinutes ? 1 : 0) + (tags.length ? 0.5 : 0);
  const confidence = Math.min(1, confidenceSignals / 3.5) * (hasTimeSignal ? 1 : 0.85);

  const explanation: string[] = [];
  if (dueDate) {
    const relative = dueDate === toDayKey(ctx.now, ctx.offsetMinutes) ? 'today' : dueDate;
    explanation.push(`Due ${relative}${dueTime ? ` at ${dueTime}` : ''}`);
  }
  if (estimatedMinutes) explanation.push(`Estimated ${estimatedMinutes} min`);
  if (priority) explanation.push(`${priority[0]!.toUpperCase()}${priority.slice(1)} priority`);
  if (important !== null || urgent !== null) {
    explanation.push(
      `Matrix: ${important === false ? 'not important' : important === true ? 'important' : '—'} · ${urgent === false ? 'not urgent' : urgent === true ? 'urgent' : '—'}`,
    );
  }
  if (recurrenceKind) explanation.push(`Repeats ${recurrenceKind}`);
  if (tags.length) explanation.push(`Tags: ${tags.map((t) => `#${t}`).join(' ')}`);
  if (projectName) explanation.push(`Project @${projectName}`);
  if (reminderOffsetMinutes != null) explanation.push(`Reminder ${reminderOffsetMinutes} min before`);

  return {
    title: buildTitle(text, matches, significant.length > 0),
    dueDate,
    dueTime,
    priority,
    important,
    urgent,
    estimatedMinutes,
    recurrenceKind,
    recurrenceWeekdays,
    reminderOffsetMinutes,
    tags,
    projectName,
    confidence,
    matches: matches.map((m) => ({
      kind: m.kind,
      text: m.text,
      value: m.value,
      start: m.start,
      end: m.end,
    })),
    explanation,
  };
}

/** Resolve a reminder offset (minutes before due) to an absolute instant. */
export function reminderInstant(
  dueDate: DayKey | null,
  dueTime: string | null,
  offsetMinutes: number | null,
  ctx: ParseContext,
): number | null {
  if (!dueDate || offsetMinutes == null) return null;
  const base = dueTime
    ? startOfDayMs(dueDate, ctx.offsetMinutes) + minutesOf(dueTime) * 60_000
    : startOfDayMs(dueDate, ctx.offsetMinutes) + 9 * 60 * 60_000;
  return base - offsetMinutes * 60_000;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map((n) => Number.parseInt(n, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Smart default due time. Tasks due *today* inherit the user's day-start unless a
 * concrete time is given; future tasks stay untimed so they can be scheduled.
 */
export function inferredDueTime(
  dueDate: DayKey,
  today: DayKey,
  _nowTime: string,
  dayStart = '09:00',
): string | null {
  if (dueDate === today) return dayStart;
  return null;
}

/** Round trip helper used by the quick-add preview UI. */
export function quickAddPreview(input: string, ctx: ParseContext): string {
  const parsed = parseNaturalLanguageTask(input, ctx);
  if (!parsed.explanation.length) return 'No date or time detected — will be added to your inbox.';
  return parsed.explanation.join(' · ');
}
