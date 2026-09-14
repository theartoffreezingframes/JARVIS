import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notificationQuerySchema, type DayKey, type NotificationKind, type UserSettings } from '@jarvis/shared';
import { getDb } from '../db/index.js';
import { requireUser, userSettings } from '../http/auth-plugin.js';
import { parseOrThrow } from '../lib/errors.js';
import { hydrateSessions, listSessionsForUser } from '../repo/gang.js';
import { listHabits } from '../repo/habits.js';
import {
  deleteNotification,
  dueNotifications,
  dismissAll,
  insertNotification,
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
} from '../repo/notifications.js';
import { listTasks } from '../repo/tasks.js';
import { userToday } from '../services/analytics.js';

/**
 * Notification *definitions* are generated server-side and returned as data.
 *
 * The device schedules them locally (expo-notifications), which means: reminders
 * work with no push provider and no battery-hungry polling, the user's
 * preferences are interpreted in exactly one place, and the same list is
 * available on every device the account signs into.
 */
export async function registerNotificationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/notifications', async (request) => {
    const user = requireUser(request, true);
    const settings = userSettings(request, user);
    const query = parseOrThrow(notificationQuerySchema, request.query);
    const today = userToday(user);

    regenerate(user.id, today, settings);

    return {
      notifications: listNotifications(user.id, { unreadOnly: query.unreadOnly, limit: query.limit }),
      unreadCount: unreadCount(user.id),
      scheduled: dueNotifications(user.id, Date.now(), 7 * 86_400_000),
      preferences: settings.notifications,
      serverTime: Date.now(),
    };
  });

  app.post('/notifications/:id/read', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(z.object({ id: z.string().min(6) }), request.params);
    markRead(user.id, id, true);
    return { unreadCount: unreadCount(user.id) };
  });

  app.post('/notifications/:id/unread', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(z.object({ id: z.string().min(6) }), request.params);
    markRead(user.id, id, false);
    return { unreadCount: unreadCount(user.id) };
  });

  app.post('/notifications/read-all', async (request) => {
    const user = requireUser(request);
    markAllRead(user.id);
    return { unreadCount: 0 };
  });

  app.delete('/notifications/:id', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(z.object({ id: z.string().min(6) }), request.params);
    deleteNotification(user.id, id);
    return reply.send({ ok: true });
  });

  /** Clear every generated reminder — the "quiet day" switch. */
  app.post('/notifications/clear', async (request) => {
    const user = requireUser(request);
    const query = parseOrThrow(z.object({ kind: z.string().optional() }), request.query);
    dismissAll(user.id, query.kind ?? null);
    return { ok: true, unreadCount: 0 };
  });
}

/* -------------------------------------------------------------------------- */
/*  Generation                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Has this reminder already been produced?
 *
 * Deliberately ignores `read_at`/`dismissed_at`: a notification that was read or
 * cleared must not be re-created on the next pass (that would nag forever), so the
 * row itself is the record that it happened. Recurring reminders (habits, the
 * daily planning/review nudges) pass the exact `scheduledFor` they are about to
 * create, which lets tomorrow's reminder appear while today's stays dismissed.
 */
function alreadyNotified(
  userId: string,
  kind: NotificationKind,
  column: string,
  entityId: string | null,
  scheduledFor?: number,
): boolean {
  const params: unknown[] = [userId, kind, entityId ?? ''];
  let sql = `SELECT 1 AS present FROM notifications
              WHERE user_id = ? AND kind = ? AND coalesce(${column}, '') = coalesce(?, '')`;
  if (typeof scheduledFor === 'number') {
    sql += ' AND scheduled_for = ?';
    params.push(scheduledFor);
  }
  sql += ' LIMIT 1';
  const row = getDb()
    .prepare(sql)
    .get(...params) as { present?: number } | undefined;
  return Boolean(row?.present);
}

/**
 * Idempotent generation pass. Called when the notification list is read, so the
 * client always gets a correct set without a cron job. Every insert is guarded
 * by a dedupe check, so repeatedly opening the screen cannot spam the user.
 */
export function regenerate(userId: string, today: DayKey, settings: UserSettings, now = Date.now()): void {
  const prefs = settings.notifications;

  if (prefs.habitReminder) {
    for (const habit of listHabits(userId, { today })) {
      if (!habit.reminderTime || habit.completedToday) continue;
      const at = Date.parse(`${today}T${habit.reminderTime}:00Z`);
      if (Number.isNaN(at) || at < now) continue;
      if (alreadyNotified(userId, 'habit_reminder', 'habit_id', habit.id, at)) continue;
      insertNotification(userId, {
        kind: 'habit_reminder',
        title: `${habit.name} today`,
        body: habit.currentStreak > 0 ? `Keep your ${habit.currentStreak} day streak alive` : 'Scheduled for today',
        habitId: habit.id,
        scheduledFor: at,
      });
    }
  }

  if (prefs.overdue) {
    for (const task of listTasks(userId, { view: 'overdue', today, limit: 50 })) {
      if (alreadyNotified(userId, 'overdue', 'task_id', task.id)) continue;
      insertNotification(userId, {
        kind: 'overdue',
        title: `Overdue: ${task.title}`,
        body: `Was due ${task.dueDate ?? 'earlier'}. Reschedule it or drop it.`,
        taskId: task.id,
        scheduledFor: now,
      });
    }
  }

  if (prefs.taskReminder) {
    for (const task of listTasks(userId, { view: 'all', today, limit: 300 })) {
      // A finished task must never be re-announced: completing it clears its
      // reminders, and this pass would otherwise quietly put them back.
      if (task.status === 'done' || task.status === 'archived') continue;
      if (!task.reminderAt || task.reminderAt <= now) continue;
      if (alreadyNotified(userId, 'task_reminder', 'task_id', task.id)) continue;
      insertNotification(userId, {
        kind: 'task_reminder',
        title: task.title,
        body: 'Reminder for a task you planned',
        taskId: task.id,
        scheduledFor: task.reminderAt,
      });
    }
  }

  if (prefs.dailyPlanning && settings.dailyPlanningReminder) {
    const at = Date.parse(`${today}T${settings.dailyPlanningReminder}:00Z`);
    if (at > now && !alreadyNotified(userId, 'daily_planning', 'kind', 'daily_planning', at)) {
      insertNotification(userId, {
        kind: 'daily_planning',
        title: 'Plan your day',
        body: 'Pick up to three must-dos and give them real time blocks.',
        scheduledFor: at,
      });
    }
  }

  if (prefs.dailyReview && settings.dailyReviewReminder) {
    const at = Date.parse(`${today}T${settings.dailyReviewReminder}:00Z`);
    if (at > now && !alreadyNotified(userId, 'daily_review', 'kind', 'daily_review', at)) {
      insertNotification(userId, {
        kind: 'daily_review',
        title: 'Close the loop',
        body: 'Review today, reschedule what slipped, and pick tomorrow’s top task.',
        scheduledFor: at,
      });
    }
  }

  if (prefs.gangUpcoming) {
    for (const session of hydrateSessions(listSessionsForUser(userId, 10))) {
      if (session.status !== 'scheduled') continue;
      const at = session.startsAt - 15 * 60_000;
      if (at < now) continue;
      if (alreadyNotified(userId, 'gang_upcoming', 'session_id', session.id, at)) continue;
      insertNotification(userId, {
        kind: 'gang_upcoming',
        title: `“${session.title}” starts soon`,
        body: `${session.groupName} · ${session.focusMinutes} minutes`,
        sessionId: session.id,
        groupId: session.groupId,
        scheduledFor: at,
      });
    }
  }
}
