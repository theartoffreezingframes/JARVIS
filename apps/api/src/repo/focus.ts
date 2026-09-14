import type { DayKey, FocusMode, FocusSession, FocusStats } from '@jarvis/shared';
import { addDays, summarizeActivity } from '@jarvis/shared';
import type { Db } from '../db/index.js';
import { all, getDb, one, run } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { mapFocusSession } from './mappers.js';
import type { FocusSessionRow } from './rows.js';
import { nextSeq } from './users.js';

export interface FocusStartInput {
  taskId: string | null;
  projectId: string | null;
  mode: FocusMode;
  label: string | null;
  plannedMinutes: number;
  startedAt: number;
  dayKey: DayKey;
  gangSessionId?: string | null;
  clientId?: string | null;
}

export function insertFocusSession(userId: string, input: FocusStartInput, db: Db = getDb()): FocusSessionRow {
  const now = Date.now();
  const id = newId('fcs');
  run(
    `INSERT INTO focus_sessions (id, user_id, task_id, project_id, gang_session_id, mode, label,
                                 planned_minutes, actual_seconds, completed, started_at, day_key,
                                 created_at, updated_at, seq, client_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)`,
    [
      id, userId, input.taskId, input.projectId, input.gangSessionId ?? null, input.mode, input.label,
      input.plannedMinutes, input.startedAt, input.dayKey, now, now, nextSeq(userId, db), input.clientId ?? null,
    ],
    db,
  );
  return one<FocusSessionRow>('SELECT * FROM focus_sessions WHERE id = ?', [id], db)!;
}

export function finishFocusSession(
  userId: string,
  sessionId: string,
  patch: { actualSeconds: number; completed: boolean; interruptions: number; endedAt: number },
  db: Db = getDb(),
): FocusSessionRow | undefined {
  const existing = one<FocusSessionRow>('SELECT * FROM focus_sessions WHERE id = ? AND user_id = ?', [sessionId, userId], db);
  if (!existing) return undefined;
  // Idempotent: a retried "finish" never double counts.
  const isFinished = existing.completed === 1 && existing.ended_at != null;
  if (isFinished && patch.actualSeconds <= existing.actual_seconds) return existing;

  run(
    `UPDATE focus_sessions
        SET actual_seconds = ?, completed = ?, interruptions = ?, ended_at = ?, updated_at = ?, seq = ?
      WHERE id = ? AND user_id = ?`,
    [
      Math.max(patch.actualSeconds, existing.actual_seconds),
      patch.completed || existing.completed ? 1 : 0,
      Math.max(patch.interruptions, existing.interruptions),
      patch.endedAt,
      Date.now(),
      nextSeq(userId, db),
      sessionId,
      userId,
    ],
    db,
  );
  return one<FocusSessionRow>('SELECT * FROM focus_sessions WHERE id = ?', [sessionId], db);
}

export function patchFocusSession(
  userId: string,
  sessionId: string,
  patch: { actualSeconds?: number; completed?: boolean; interruptions?: number; endedAt?: number; taskId?: string | null },
  db: Db = getDb(),
): FocusSessionRow | undefined {
  const columns: Record<string, string> = {
    actualSeconds: 'actual_seconds',
    completed: 'completed',
    interruptions: 'interruptions',
    endedAt: 'ended_at',
    taskId: 'task_id',
  };
  const entries = Object.entries(patch).filter(([k]) => k in columns);
  if (!entries.length) return one<FocusSessionRow>('SELECT * FROM focus_sessions WHERE id = ? AND user_id = ?', [sessionId, userId], db);
  const sets = entries.map(([k]) => `${columns[k]} = ?`);
  const values = entries.map(([, v]) => (typeof v === 'boolean' ? (v ? 1 : 0) : v ?? null));
  run(
    `UPDATE focus_sessions SET ${sets.join(', ')}, updated_at = ?, seq = ? WHERE id = ? AND user_id = ?`,
    [...values, Date.now(), nextSeq(userId, db), sessionId, userId],
    db,
  );
  return one<FocusSessionRow>('SELECT * FROM focus_sessions WHERE id = ? AND user_id = ?', [sessionId, userId], db);
}

export function softDeleteFocusSession(userId: string, sessionId: string, db: Db = getDb()): void {
  const now = Date.now();
  run('UPDATE focus_sessions SET deleted_at = ?, updated_at = ?, seq = ? WHERE id = ? AND user_id = ?', [
    now, now, nextSeq(userId, db), sessionId, userId,
  ], db);
}

export function hydrateFocusSessions(rows: readonly FocusSessionRow[], db: Db = getDb()): FocusSession[] {
  if (!rows.length) return [];
  const taskIds = [...new Set(rows.map((r) => r.task_id).filter((id): id is string => Boolean(id)))];
  const titles = new Map<string, string>();
  if (taskIds.length) {
    const placeholders = taskIds.map(() => '?').join(', ');
    for (const row of all<{ id: string; title: string }>(
      `SELECT id, title FROM tasks WHERE id IN (${placeholders})`,
      taskIds,
      db,
    )) {
      titles.set(row.id, row.title);
    }
  }
  return rows.map((row) => mapFocusSession(row, row.task_id ? titles.get(row.task_id) ?? null : null));
}

export function listFocusSessions(
  userId: string,
  filters: { from?: DayKey; to?: DayKey; taskId?: string; limit?: number } = {},
  db: Db = getDb(),
): FocusSession[] {
  const where = ['user_id = ?', 'deleted_at IS NULL'];
  const params: unknown[] = [userId];
  if (filters.from) {
    where.push('day_key >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('day_key <= ?');
    params.push(filters.to);
  }
  if (filters.taskId) {
    where.push('task_id = ?');
    params.push(filters.taskId);
  }
  const rows = all<FocusSessionRow>(
    `SELECT * FROM focus_sessions WHERE ${where.join(' AND ')} ORDER BY started_at DESC LIMIT ?`,
    [...params, Math.min(filters.limit ?? 100, 500)],
    db,
  );
  return hydrateFocusSessions(rows, db);
}

export function focusStats(
  userId: string,
  today: DayKey,
  db: Db = getDb(),
): FocusStats {
  const from = addDays(today, -370);
  const days = all<{ day_key: string; minutes: number; sessions: number }>(
    `SELECT day_key,
            COALESCE(SUM(actual_seconds), 0) / 60 AS minutes,
            COUNT(*) AS sessions
       FROM focus_sessions
      WHERE user_id = ? AND deleted_at IS NULL AND completed = 1 AND day_key BETWEEN ? AND ?
      GROUP BY day_key ORDER BY day_key`,
    [userId, from, today],
    db,
  );

  const dailyMinutes = days.map((d) => ({ dayKey: d.day_key as DayKey, minutes: d.minutes, sessions: d.sessions }));
  const summary = summarizeActivity(
    dailyMinutes.map((d) => ({
      dayKey: d.dayKey,
      tasksCompleted: 0,
      tasksCreated: 0,
      focusMinutes: d.minutes,
      habitsCompleted: 0,
      habitsScheduled: 0,
      plannedTaskCount: 0,
      plannedCompletedCount: 0,
    })),
  );

  const weekStart = addDays(today, -6);
  const monthStart = addDays(today, -29);
  const todayRow = dailyMinutes.find((d) => d.dayKey === today);

  const totalRow = one<{ seconds: number; sessions: number; avg: number | null }>(
    `SELECT COALESCE(SUM(actual_seconds), 0) AS seconds, COUNT(*) AS sessions, AVG(actual_seconds) AS avg
       FROM focus_sessions WHERE user_id = ? AND deleted_at IS NULL AND completed = 1`,
    [userId],
    db,
  );

  const byProject = all<{ project_id: string | null; project_name: string | null; minutes: number }>(
    `SELECT f.project_id, p.name AS project_name, COALESCE(SUM(f.actual_seconds), 0) / 60 AS minutes
       FROM focus_sessions f LEFT JOIN projects p ON p.id = f.project_id
      WHERE f.user_id = ? AND f.deleted_at IS NULL AND f.completed = 1
      GROUP BY f.project_id ORDER BY minutes DESC LIMIT 8`,
    [userId],
    db,
  ).map((row) => ({ projectId: row.project_id, projectName: row.project_name ?? 'No project', minutes: row.minutes }));

  const byTask = all<{ task_id: string; title: string; minutes: number; sessions: number }>(
    `SELECT f.task_id, t.title, COALESCE(SUM(f.actual_seconds), 0) / 60 AS minutes, COUNT(*) AS sessions
       FROM focus_sessions f JOIN tasks t ON t.id = f.task_id
      WHERE f.user_id = ? AND f.deleted_at IS NULL AND f.completed = 1
      GROUP BY f.task_id ORDER BY minutes DESC LIMIT 8`,
    [userId],
    db,
  ).map((row) => ({ taskId: row.task_id, title: row.title, minutes: row.minutes, sessions: row.sessions }));

  return {
    todayMinutes: todayRow?.minutes ?? 0,
    weekMinutes: dailyMinutes.filter((d) => d.dayKey >= weekStart).reduce((s, d) => s + d.minutes, 0),
    monthMinutes: dailyMinutes.filter((d) => d.dayKey >= monthStart).reduce((s, d) => s + d.minutes, 0),
    totalMinutes: Math.round((totalRow?.seconds ?? 0) / 60),
    sessionsToday: todayRow?.sessions ?? 0,
    sessionsWeek: dailyMinutes.filter((d) => d.dayKey >= weekStart).reduce((s, d) => s + d.sessions, 0),
    averageSessionMinutes: totalRow?.avg ? Math.round((totalRow.avg / 60) * 10) / 10 : 0,
    streakDays: summary.activeDays,
    bestDayMinutes: summary.bestFocusDay?.minutes ?? 0,
    dailyMinutes,
    byProject,
    byTask,
  };
}
