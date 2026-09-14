import type { AppNotification, NotificationKind } from '@jarvis/shared';
import type { Db } from '../db/index.js';
import { all, getDb, one, run } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { mapNotification } from './mappers.js';
import type { NotificationRow } from './rows.js';
import { nextSeq } from './users.js';

export interface NotificationInput {
  kind: NotificationKind;
  title: string;
  body?: string;
  taskId?: string | null;
  habitId?: string | null;
  sessionId?: string | null;
  groupId?: string | null;
  scheduledFor: number;
}

export function insertNotification(userId: string, input: NotificationInput, db: Db = getDb()): NotificationRow {
  const now = Date.now();
  const id = newId('ntf');
  run(
    `INSERT INTO notifications (id, user_id, kind, title, body, task_id, habit_id, session_id, group_id,
                                scheduled_for, created_at, updated_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, userId, input.kind, input.title, input.body ?? '', input.taskId ?? null, input.habitId ?? null,
      input.sessionId ?? null, input.groupId ?? null, input.scheduledFor, now, now, nextSeq(userId, db),
    ],
    db,
  );
  return one<NotificationRow>('SELECT * FROM notifications WHERE id = ?', [id], db)!;
}

/** Replaces any pending notification of the same kind for the same entity. */
export function upsertEntityNotification(userId: string, input: NotificationInput & { entityId: string }, db: Db = getDb()): void {
  const column = input.kind === 'habit_reminder' ? 'habit_id' : input.kind === 'task_reminder' || input.kind === 'deadline' || input.kind === 'overdue' ? 'task_id' : input.kind === 'gang_invite' || input.kind === 'gang_upcoming' ? 'session_id' : null;
  if (column) {
    run(
      `DELETE FROM notifications WHERE user_id = ? AND kind = ? AND ${column} = ? AND delivered_at IS NULL`,
      [userId, input.kind, input.entityId],
      db,
    );
  }
  insertNotification(userId, input, db);
}

export function listNotifications(
  userId: string,
  options: { unreadOnly?: boolean; limit?: number; since?: number } = {},
  db: Db = getDb(),
): AppNotification[] {
  const where = ['user_id = ?'];
  const params: unknown[] = [userId];
  if (options.unreadOnly) where.push('read_at IS NULL');
  if (options.since) {
    where.push('scheduled_for >= ?');
    params.push(options.since);
  }
  const rows = all<NotificationRow>(
    `SELECT * FROM notifications WHERE ${where.join(' AND ')} ORDER BY scheduled_for DESC LIMIT ?`,
    [...params, Math.min(options.limit ?? 50, 200)],
    db,
  );
  return rows.map(mapNotification);
}

/** Notifications whose time has arrived — the client schedules these locally. */
export function dueNotifications(userId: string, nowMs: number, lookaheadMs: number, db: Db = getDb()): AppNotification[] {
  const rows = all<NotificationRow>(
    `SELECT * FROM notifications
      WHERE user_id = ? AND scheduled_for BETWEEN ? AND ? AND read_at IS NULL
      ORDER BY scheduled_for ASC LIMIT 100`,
    [userId, nowMs - 86_400_000, nowMs + lookaheadMs],
    db,
  );
  return rows.map(mapNotification);
}

export function markRead(userId: string, id: string, read: boolean, db: Db = getDb()): void {
  run('UPDATE notifications SET read_at = ?, updated_at = ?, seq = ? WHERE id = ? AND user_id = ?', [
    read ? Date.now() : null, Date.now(), nextSeq(userId, db), id, userId,
  ], db);
}

export function markAllRead(userId: string, db: Db = getDb()): void {
  run('UPDATE notifications SET read_at = ?, updated_at = ? WHERE user_id = ? AND read_at IS NULL', [
    Date.now(), Date.now(), userId,
  ], db);
}

export function deleteNotification(userId: string, id: string, db: Db = getDb()): void {
  run('DELETE FROM notifications WHERE id = ? AND user_id = ?', [id, userId], db);
}

export function unreadCount(userId: string, db: Db = getDb()): number {
  return one<{ c: number }>('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL', [userId], db)?.c ?? 0;
}

/** Removes stale reminders (task completed / rescheduled) so users aren't pinged twice. */
export function clearTaskNotifications(userId: string, taskId: string, db: Db = getDb()): void {
  run('DELETE FROM notifications WHERE user_id = ? AND task_id = ? AND delivered_at IS NULL', [userId, taskId], db);
}
