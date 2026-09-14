import type { DayKey, Habit, HabitFrequency } from '@jarvis/shared';
import { addDays, habitScheduledOn, habitStreak, percent } from '@jarvis/shared';
import type { Db } from '../db/index.js';
import { all, getDb, one, run } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { mapHabit } from './mappers.js';
import type { HabitCompletionRow, HabitRow } from './rows.js';
import { nextSeq } from './users.js';

export interface HabitWriteInput {
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string;
  frequency?: HabitFrequency;
  scheduleDays?: number[];
  targetPerPeriod?: number;
  reminderTime?: string | null;
  archived?: boolean;
  clientId?: string | null;
}

export function insertHabit(userId: string, input: HabitWriteInput, db: Db = getDb()): HabitRow {
  const now = Date.now();
  const id = newId('hab');
  run(
    `INSERT INTO habits (id, user_id, name, description, icon, color, frequency, schedule_days,
                         target_per_period, reminder_time, archived, created_at, updated_at, seq, client_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [
      id,
      userId,
      input.name,
      input.description ?? null,
      input.icon ?? null,
      input.color ?? '#22C55E',
      input.frequency ?? 'daily',
      (input.scheduleDays ?? []).join(','),
      input.targetPerPeriod ?? 1,
      input.reminderTime ?? null,
      now,
      now,
      nextSeq(userId, db),
      input.clientId ?? null,
    ],
    db,
  );
  return one<HabitRow>('SELECT * FROM habits WHERE id = ?', [id], db)!;
}

export function patchHabit(userId: string, habitId: string, patch: Partial<HabitWriteInput>, db: Db = getDb()): HabitRow | undefined {
  const columns: Record<string, string> = {
    name: 'name',
    description: 'description',
    icon: 'icon',
    color: 'color',
    frequency: 'frequency',
    scheduleDays: 'schedule_days',
    targetPerPeriod: 'target_per_period',
    reminderTime: 'reminder_time',
    archived: 'archived',
  };
  const entries = Object.entries(patch).filter(([k]) => k in columns);
  if (entries.length) {
    const sets = entries.map(([k]) => `${columns[k]} = ?`);
    const values = entries.map(([k, v]) => {
      if (k === 'scheduleDays') return (Array.isArray(v) ? v.join(',') : '');
      if (typeof v === 'boolean') return v ? 1 : 0;
      return v ?? null;
    });
    run(
      `UPDATE habits SET ${sets.join(', ')}, updated_at = ?, seq = ? WHERE id = ? AND user_id = ?`,
      [...values, Date.now(), nextSeq(userId, db), habitId, userId],
      db,
    );
  }
  return one<HabitRow>('SELECT * FROM habits WHERE id = ? AND user_id = ?', [habitId, userId], db);
}

export function softDeleteHabit(userId: string, habitId: string, db: Db = getDb()): void {
  const now = Date.now();
  const seq = nextSeq(userId, db);
  run('UPDATE habits SET deleted_at = ?, updated_at = ?, seq = ? WHERE id = ? AND user_id = ?', [now, now, seq, habitId, userId], db);
  run('UPDATE habit_completions SET deleted_at = ?, updated_at = ?, seq = ? WHERE habit_id = ? AND user_id = ?', [
    now, now, seq, habitId, userId,
  ], db);
}

/* -------------------------------------------------------------------------- */
/*  Completions                                                               */
/* -------------------------------------------------------------------------- */

export function toggleCompletion(
  userId: string,
  habitId: string,
  dayKey: DayKey,
  completed: boolean,
  note: string | null = null,
  db: Db = getDb(),
): HabitCompletionRow | undefined {
  const existing = one<HabitCompletionRow>(
    'SELECT * FROM habit_completions WHERE habit_id = ? AND day_key = ?',
    [habitId, dayKey],
    db,
  );
  const now = Date.now();
  const seq = nextSeq(userId, db);

  if (completed) {
    if (existing) {
      run('UPDATE habit_completions SET deleted_at = NULL, count = 1, note = ?, updated_at = ?, seq = ? WHERE id = ?', [
        note, now, seq, existing.id,
      ], db);
    } else {
      run(
        `INSERT INTO habit_completions (id, habit_id, user_id, day_key, count, note, created_at, updated_at, seq)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        [newId('hcp'), habitId, userId, dayKey, note, now, now, seq],
        db,
      );
    }
  } else if (existing) {
    run('UPDATE habit_completions SET deleted_at = ?, updated_at = ?, seq = ? WHERE id = ?', [
      now,
      now,
      seq,
      existing.id,
    ], db);
  }

  return one<HabitCompletionRow>('SELECT * FROM habit_completions WHERE habit_id = ? AND day_key = ?', [habitId, dayKey], db);
}

export function listCompletions(userId: string, habitIds: readonly string[], from: DayKey | null, db: Db = getDb()): HabitCompletionRow[] {
  if (!habitIds.length) return [];
  const placeholders = habitIds.map(() => '?').join(', ');
  const params: unknown[] = [userId, ...habitIds];
  let sql = `SELECT * FROM habit_completions WHERE user_id = ? AND habit_id IN (${placeholders}) AND deleted_at IS NULL`;
  if (from) {
    sql += ' AND day_key >= ?';
    params.push(from);
  }
  sql += ' ORDER BY day_key';
  return all<HabitCompletionRow>(sql, params, db);
}

/** All completion day keys for a user, used by habit heat maps. */
export function completionsByDay(userId: string, from: DayKey, to: DayKey, db: Db = getDb()): Array<{ day_key: string; c: number }> {
  return all<{ day_key: string; c: number }>(
    `SELECT day_key, COUNT(*) AS c FROM habit_completions
      WHERE user_id = ? AND deleted_at IS NULL AND day_key BETWEEN ? AND ?
      GROUP BY day_key ORDER BY day_key`,
    [userId, from, to],
    db,
  );
}

/* -------------------------------------------------------------------------- */
/*  Reads & derived stats                                                     */
/* -------------------------------------------------------------------------- */

export function scheduledOn(row: HabitRow, dayKey: DayKey): boolean {
  if (row.archived === 1) return false;
  const weekday = new Date(`${dayKey}T00:00:00Z`).getUTCDay();
  switch (row.frequency) {
    case 'daily':
      return true;
    case 'weekdays':
      return weekday !== 0 && weekday !== 6;
    case 'weekly':
    case 'custom': {
      const days = row.schedule_days
        ? row.schedule_days.split(',').map((d) => Number.parseInt(d, 10)).filter((n) => !Number.isNaN(n))
        : [];
      if (!days.length) return weekday === new Date(`${row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : dayKey}T00:00:00Z`).getUTCDay();
      return days.includes(weekday);
    }
    default:
      return true;
  }
}

function deriveStats(row: HabitRow, completions: HabitCompletionRow[], today: DayKey) {
  const days = completions.filter((c) => !c.deleted_at).map((c) => c.day_key as DayKey);
  const set = new Set(days);
  const streak = habitStreak(
    days,
    (day) => scheduledOn(row, day),
    today,
    row.frequency === 'weekly' ? 1 : 0,
  );

  const windowStart = addDays(today, -29);
  let scheduled = 0;
  let done = 0;
  for (let i = 0; i < 30; i += 1) {
    const day = addDays(windowStart, i);
    if (scheduledOn(row, day)) {
      scheduled += 1;
      if (set.has(day)) done += 1;
    }
  }

  return {
    currentStreak: streak.current,
    bestStreak: Math.max(streak.best, streak.current),
    completionRate: percent(done, scheduled),
    completedToday: set.has(today),
    completions: days,
  };
}

export function listHabits(
  userId: string,
  filters: { includeArchived?: boolean; today: DayKey } ,
  db: Db = getDb(),
): Habit[] {
  const where = ['h.user_id = ?', 'h.deleted_at IS NULL'];
  if (!filters.includeArchived) where.push('h.archived = 0');
  const rows = all<HabitRow>(
    `SELECT h.* FROM habits h WHERE ${where.join(' AND ')} ORDER BY h.archived ASC, h.created_at ASC`,
    [userId],
    db,
  );
  if (!rows.length) return [];

  const completions = listCompletions(userId, rows.map((r) => r.id), addDays(filters.today, -400), db);
  const byHabit = new Map<string, HabitCompletionRow[]>();
  for (const completion of completions) {
    const list = byHabit.get(completion.habit_id) ?? [];
    list.push(completion);
    byHabit.set(completion.habit_id, list);
  }

  return rows.map((row) => {
    const stats = deriveStats(row, byHabit.get(row.id) ?? [], filters.today);
    return mapHabit(row, byHabit.get(row.id) ?? [], stats);
  });
}

export function getHabit(id: string, userId: string, today: DayKey, db: Db = getDb()): Habit | undefined {
  const row = one<HabitRow>('SELECT * FROM habits WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [id, userId], db);
  if (!row) return undefined;
  const completions = listCompletions(userId, [id], addDays(today, -400), db);
  return mapHabit(row, completions, deriveStats(row, completions, today));
}

export interface HabitStats {
  completionRate: number;
  currentBestStreak: number;
  bestStreak: number;
  scheduledToday: number;
  completedToday: number;
  activeHabits: number;
}

export function habitStats(userId: string, today: DayKey, db: Db = getDb()): HabitStats {
  const habits = listHabits(userId, { today }, db);
  const scheduledToday = habits.filter((habit) => habitScheduledOn(habit, today));
  const rates = habits.map((h) => h.completionRate);
  return {
    completionRate: rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : 0,
    currentBestStreak: habits.reduce((max, h) => Math.max(max, h.currentStreak), 0),
    bestStreak: habits.reduce((max, h) => Math.max(max, h.bestStreak), 0),
    scheduledToday: scheduledToday.length,
    completedToday: scheduledToday.filter((h) => h.completedToday).length,
    activeHabits: habits.length,
  };
}

export function habitRowsForUser(userId: string, db: Db = getDb()): HabitRow[] {
  return all<HabitRow>('SELECT * FROM habits WHERE user_id = ? AND deleted_at IS NULL', [userId], db);
}
