import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/*  Enumerations                                                              */
/* -------------------------------------------------------------------------- */

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const prioritySchema = z.enum(PRIORITIES);

export const TASK_STATUSES = ['todo', 'in_progress', 'done', 'archived'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const taskStatusSchema = z.enum(TASK_STATUSES);

export const PROJECT_STATUSES = ['not_started', 'active', 'completed', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const projectStatusSchema = z.enum(PROJECT_STATUSES);

export const QUADRANTS = ['do_now', 'schedule', 'delegate', 'eliminate'] as const;
export type Quadrant = (typeof QUADRANTS)[number];
export const quadrantSchema = z.enum(QUADRANTS);

export const FOCUS_MODES = ['pomodoro', 'deep_work', 'custom', 'short_break', 'long_break'] as const;
export type FocusMode = (typeof FOCUS_MODES)[number];
export const focusModeSchema = z.enum(FOCUS_MODES);

export const HABIT_FREQUENCIES = ['daily', 'weekdays', 'weekly', 'custom'] as const;
export type HabitFrequency = (typeof HABIT_FREQUENCIES)[number];
export const habitFrequencySchema = z.enum(HABIT_FREQUENCIES);

export const RECURRENCE_KINDS = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'] as const;
export type RecurrenceKind = (typeof RECURRENCE_KINDS)[number];
export const recurrenceKindSchema = z.enum(RECURRENCE_KINDS);

export const GROUP_ROLES = ['owner', 'admin', 'member'] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];
export const groupRoleSchema = z.enum(GROUP_ROLES);

export const GANG_STATUSES = ['scheduled', 'running', 'paused', 'completed', 'cancelled'] as const;
export type GangStatus = (typeof GANG_STATUSES)[number];
export const gangStatusSchema = z.enum(GANG_STATUSES);

export const PARTICIPANT_STATES = ['invited', 'focusing', 'paused', 'break', 'done', 'left'] as const;
export type ParticipantState = (typeof PARTICIPANT_STATES)[number];
export const participantStateSchema = z.enum(PARTICIPANT_STATES);

export const REACTIONS = ['fire', 'clap', 'muscle', 'heart', 'rocket'] as const;
export type Reaction = (typeof REACTIONS)[number];
export const reactionSchema = z.enum(REACTIONS);

export const THEME_PREFS = ['system', 'light', 'dark'] as const;
export type ThemePref = (typeof THEME_PREFS)[number];
export const themePrefSchema = z.enum(THEME_PREFS);

export const NOTIFICATION_KINDS = [
  'task_reminder',
  'deadline',
  'overdue',
  'habit_reminder',
  'focus_scheduled',
  'gang_invite',
  'gang_upcoming',
  'daily_planning',
  'daily_review',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);

/* -------------------------------------------------------------------------- */
/*  Small value helpers                                                       */
/* -------------------------------------------------------------------------- */

/** Rank used for sorting: urgent (0) → low (3). */
export const PRIORITY_RANK: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

/** `HH:mm` (24h) local wall-clock time. */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a HH:mm time');

/** `YYYY-MM-DD` local calendar date. */
export const dayKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

export const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Expected a hex colour');

export const tagNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[^\s#,]+$/, 'Tags cannot contain spaces');

/** A short, human readable id used for group invite codes. */
export function makeInviteCode(random: () => number = Math.random, length = 7): string {
  // Unambiguous alphabet (no 0/O/1/I/L).
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(random() * alphabet.length)] ?? 'A';
  }
  return out;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function percent(part: number, whole: number): number {
  if (!whole) return 0;
  return clamp(Math.round((part / whole) * 100), 0, 100);
}

export function average(values: readonly number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

export function groupCount<T, K extends string>(values: readonly T[], key: (value: T) => K): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const value of values) {
    const k = key(value);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
