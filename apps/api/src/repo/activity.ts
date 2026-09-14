import { DAY_MS, eachDayKey, startOfDayMs, type ActivityDay, type DayKey } from '@jarvis/shared';
import type { Db } from '../db/index.js';
import { all, getDb, one, run } from '../db/index.js';
import type { ActivityDayRow } from './rows.js';

export interface ActivityDelta {
  tasksCompleted?: number;
  tasksCreated?: number;
  focusMinutes?: number;
  habitCompletions?: number;
  plannedCount?: number;
  plannedCompleted?: number;
  importantNotUrgentDone?: number;
  overdueCount?: number;
  reviewed?: number;
}

const COLUMN_BY_KEY: Record<keyof ActivityDelta, string> = {
  tasksCompleted: 'tasks_completed',
  tasksCreated: 'tasks_created',
  focusMinutes: 'focus_minutes',
  habitCompletions: 'habit_completions',
  plannedCount: 'planned_count',
  plannedCompleted: 'planned_completed',
  importantNotUrgentDone: 'important_not_urgent_done',
  overdueCount: 'overdue_count',
  reviewed: 'reviewed',
};

/**
 * Incrementally maintain a day's rollup row. Called from every write path that
 * changes productivity state, so analytics/heat-map reads stay O(days) instead
 * of O(tasks).
 */
export function incrementActivity(userId: string, dayKey: DayKey, delta: ActivityDelta, db: Db = getDb()): void {
  const keys = Object.keys(delta) as Array<keyof ActivityDelta>;
  if (!keys.length) return;

  const insertColumns = ['user_id', 'day_key', ...keys.map((k) => COLUMN_BY_KEY[k]), 'updated_at'];
  const insertValues: unknown[] = [
    userId,
    dayKey,
    ...keys.map((k) => delta[k] ?? 0),
    Date.now(),
  ];

  const updates = keys
    .map((k) => `${COLUMN_BY_KEY[k]} = MAX(0, ${COLUMN_BY_KEY[k]} + excluded.${COLUMN_BY_KEY[k]})`)
    .join(', ');

  run(
    `INSERT INTO activity_days (${insertColumns.join(', ')})
     VALUES (${insertColumns.map(() => '?').join(', ')})
     ON CONFLICT(user_id, day_key) DO UPDATE SET ${updates}, updated_at = excluded.updated_at`,
    insertValues,
    db,
  );
}

/** Absolute set — used after bulk sync/recount so deltas cannot drift. */
export function setActivity(userId: string, dayKey: DayKey, values: ActivityDelta, db: Db = getDb()): void {
  const keys = Object.keys(values) as Array<keyof ActivityDelta>;
  const columns = ['user_id', 'day_key', ...keys.map((k) => COLUMN_BY_KEY[k]), 'updated_at'];
  const params: unknown[] = [userId, dayKey, ...keys.map((k) => values[k] ?? 0), Date.now()];
  const updates = keys.map((k) => `${COLUMN_BY_KEY[k]} = excluded.${COLUMN_BY_KEY[k]}`).join(', ');
  run(
    `INSERT INTO activity_days (${columns.join(', ')})
     VALUES (${columns.map(() => '?').join(', ')})
     ON CONFLICT(user_id, day_key) DO UPDATE SET ${updates}, updated_at = excluded.updated_at`,
    params,
    db,
  );
}

export function getActivityDays(userId: string, from: DayKey, to: DayKey, db: Db = getDb()): ActivityDayRow[] {
  return all<ActivityDayRow>(
    'SELECT * FROM activity_days WHERE user_id = ? AND day_key BETWEEN ? AND ? ORDER BY day_key',
    [userId, from, to],
    db,
  );
}

export function getActivityDay(userId: string, dayKey: DayKey, db: Db = getDb()): ActivityDayRow | undefined {
  return one<ActivityDayRow>('SELECT * FROM activity_days WHERE user_id = ? AND day_key = ?', [userId, dayKey], db);
}

/**
 * Recomputes a single day's rollup from source tables.
 *
 * Instants are converted to local day boundaries in JavaScript (using the user's
 * UTC offset) rather than in SQL, so the query stays index-friendly and the
 * timezone rules live in exactly one place.
 */
export function recomputeActivityDay(
  userId: string,
  dayKey: DayKey,
  offsetMinutes: number,
  db: Db = getDb(),
): ActivityDayRow {
  const dayStart = startOfDayMs(dayKey, offsetMinutes);
  const dayEnd = dayStart + DAY_MS - 1;

  const taskStats = one<{ done: number; quadrant2: number; planned: number }>(
    `SELECT
       (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status = 'done'
          AND completed_at BETWEEN ? AND ?) AS done,
       (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status = 'done'
          AND important = 1 AND urgent = 0 AND completed_at BETWEEN ? AND ?) AS quadrant2,
       (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND plan_date = ?) AS planned`,
    [userId, dayStart, dayEnd, userId, dayStart, dayEnd, userId, dayKey],
    db,
  );

  const created = one<{ c: number }>(
    'SELECT COUNT(*) AS c FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND created_at BETWEEN ? AND ?',
    [userId, dayStart, dayEnd],
    db,
  );

  const plannedCompleted = one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND plan_date = ? AND status = 'done'`,
    [userId, dayKey],
    db,
  );

  const focus = one<{ seconds: number }>(
    `SELECT COALESCE(SUM(actual_seconds), 0) AS seconds FROM focus_sessions
      WHERE user_id = ? AND day_key = ? AND deleted_at IS NULL AND actual_seconds > 0`,
    [userId, dayKey],
    db,
  );

  const habits = one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM habit_completions WHERE user_id = ? AND day_key = ? AND deleted_at IS NULL`,
    [userId, dayKey],
    db,
  );

  const overdue = one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM tasks WHERE user_id = ? AND deleted_at IS NULL
       AND status NOT IN ('done', 'archived') AND due_date IS NOT NULL AND due_date < ?`,
    [userId, dayKey],
    db,
  );

  const review = one<{ c: number }>(
    'SELECT COUNT(*) AS c FROM daily_reviews WHERE user_id = ? AND day_key = ?',
    [userId, dayKey],
    db,
  );

  setActivity(
    userId,
    dayKey,
    {
      tasksCompleted: taskStats?.done ?? 0,
      importantNotUrgentDone: taskStats?.quadrant2 ?? 0,
      plannedCount: taskStats?.planned ?? 0,
      tasksCreated: created?.c ?? 0,
      plannedCompleted: plannedCompleted?.c ?? 0,
      focusMinutes: Math.round((focus?.seconds ?? 0) / 60),
      habitCompletions: habits?.c ?? 0,
      overdueCount: overdue?.c ?? 0,
      reviewed: review?.c ?? 0,
    },
    db,
  );

  return getActivityDay(userId, dayKey, db) as ActivityDayRow;
}

/** Repair path for offline batches that land out of order. */
export function recomputeActivityRange(
  userId: string,
  from: DayKey,
  to: DayKey,
  offsetMinutes: number,
  db: Db = getDb(),
): void {
  for (const dayKey of eachDayKey(from, to)) {
    recomputeActivityDay(userId, dayKey, offsetMinutes, db);
  }
}

export function toActivityMap(rows: readonly ActivityDayRow[]): Map<DayKey, ActivityDay> {
  const map = new Map<DayKey, ActivityDay>();
  for (const row of rows) {
    map.set(row.day_key as DayKey, {
      dayKey: row.day_key as DayKey,
      tasksCompleted: row.tasks_completed,
      tasksCreated: row.tasks_created,
      focusMinutes: row.focus_minutes,
      habitsCompleted: row.habit_completions,
      habitsScheduled: 0,
      plannedTaskCount: row.planned_count,
      plannedCompletedCount: row.planned_completed,
      importantNotUrgentCompleted: row.important_not_urgent_done,
      overdueTasks: row.overdue_count,
      reviewed: row.reviewed === 1,
    });
  }
  return map;
}
