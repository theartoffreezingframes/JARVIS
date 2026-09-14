import type { DayKey, Task, TaskCreateInput, TaskStatus, TaskUpdateInput } from '@jarvis/shared';
import { addDays, nextOccurrence, quadrantOf, toDayKey } from '@jarvis/shared';
import type { Db } from '../db/index.js';
import { getDb, one, tx } from '../db/index.js';
import { incrementActivity } from '../repo/activity.js';
import { insertNotification, clearTaskNotifications } from '../repo/notifications.js';
import * as tasksRepo from '../repo/tasks.js';
import {
  duplicateTask,
  getTask,
  insertSubtask,
  insertTask,
  listSubtasksForTasks,
  patchTask,
  softDeleteTask,
  type TaskPatch,
  type TaskWriteInput,
} from '../repo/tasks.js';
import { getSettingsRow } from '../repo/users.js';
import { parseSettings } from '../repo/mappers.js';
import type { TaskRow, UserRow } from '../repo/rows.js';
import { run } from '../db/index.js';

/* -------------------------------------------------------------------------- */
/*  Notifications driven by task state                                        */
/* -------------------------------------------------------------------------- */

/** Mirrors task reminders/deadlines into the notification table (respecting prefs). */
export function syncTaskNotifications(user: UserRow, task: TaskRow, db: Db = getDb()): void {
  const settings = parseSettings(user, getSettingsRow(user.id, db));
  clearTaskNotifications(user.id, task.id, db);
  if (task.deleted_at || task.status === 'done' || task.status === 'archived') return;
  const offset = user.tz_offset_minutes;

  if (task.reminder_at && settings.notifications.taskReminder) {
    insertNotification(
      user.id,
      {
        kind: 'task_reminder',
        title: task.title,
        body: 'Reminder for a task you planned',
        taskId: task.id,
        scheduledFor: task.reminder_at,
      },
      db,
    );
  }

  if (task.due_date && settings.notifications.deadline) {
    // Deadline nudge: the evening before, or an hour before a timed task.
    const dueMs = task.due_time
      ? Date.parse(`${task.due_date}T${task.due_time}:00Z`) - offset * 60_000
      : Date.parse(`${task.due_date}T00:00:00Z`) - offset * 60_000 + 20 * 3_600_000;
    const at = task.due_time ? dueMs - 3_600_000 : dueMs;
    if (at > Date.now()) {
      insertNotification(
        user.id,
        {
          kind: 'deadline',
          title: `Due soon: ${task.title}`,
          body: task.due_time ? `Due at ${task.due_time} today` : `Due ${task.due_date}`,
          taskId: task.id,
          scheduledFor: at,
        },
        db,
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Create / update / complete                                                */
/* -------------------------------------------------------------------------- */

export function createTask(user: UserRow, input: TaskCreateInput, db: Db = getDb()): Task {
  return tx((trx) => {
    const created = insertTask(user.id, toWriteInput(input), trx);
    for (const [index, subtask] of (input.subtasks ?? []).entries()) {
      insertSubtask(user.id, created.id, subtask.title, subtask.position ?? index, trx);
    }
    const today = toDayKey(Date.now(), user.tz_offset_minutes);
    incrementActivity(user.id, today, { tasksCreated: 1 }, trx);
    if (created.plan_date) {
      incrementActivity(user.id, created.plan_date as DayKey, { plannedCount: 1 }, trx);
    }
    syncTaskNotifications(user, created, trx);
    return getTask(created.id, user.id, trx)!;
  }, db);
}

function toWriteInput(input: TaskCreateInput): TaskWriteInput {
  return {
    projectId: input.projectId ?? null,
    parentTaskId: input.parentTaskId ?? null,
    title: input.title,
    description: input.description ?? null,
    notes: input.notes ?? null,
    status: input.status ?? 'todo',
    priority: input.priority ?? 'medium',
    important: input.important ?? false,
    urgent: input.urgent ?? false,
    dueDate: (input.dueDate ?? null) as DayKey | null,
    dueTime: input.dueTime ?? null,
    reminderAt: input.reminderAt ?? null,
    estimatedMinutes: input.estimatedMinutes ?? null,
    scheduledStart: input.scheduledStart ?? null,
    scheduledEnd: input.scheduledEnd ?? null,
    planDate: (input.planDate ?? null) as DayKey | null,
    planOrder: input.planOrder ?? 0,
    isMustDo: input.isMustDo ?? false,
    recurrence: input.recurrence,
    clientId: input.clientId ?? null,
    tags: input.tags ?? [],
  };
}

export function updateTask(user: UserRow, taskId: string, patch: TaskUpdateInput, db: Db = getDb()): Task | undefined {
  return tx((trx) => {
    const before = one<TaskRow>('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, user.id], trx);
    if (!before) return undefined;

    const taskPatch: TaskPatch = {};
    if (patch.title !== undefined) taskPatch.title = patch.title;
    if (patch.description !== undefined) taskPatch.description = patch.description;
    if (patch.notes !== undefined) taskPatch.notes = patch.notes;
    if (patch.projectId !== undefined) taskPatch.projectId = patch.projectId;
    if (patch.priority !== undefined) taskPatch.priority = patch.priority;
    if (patch.important !== undefined) taskPatch.important = patch.important;
    if (patch.urgent !== undefined) taskPatch.urgent = patch.urgent;
    if (patch.dueDate !== undefined) taskPatch.dueDate = patch.dueDate as DayKey | null;
    if (patch.dueTime !== undefined) taskPatch.dueTime = patch.dueTime;
    if (patch.reminderAt !== undefined) taskPatch.reminderAt = patch.reminderAt;
    if (patch.estimatedMinutes !== undefined) taskPatch.estimatedMinutes = patch.estimatedMinutes;
    if (patch.actualMinutes !== undefined) taskPatch.actualMinutes = patch.actualMinutes;
    if (patch.scheduledStart !== undefined) taskPatch.scheduledStart = patch.scheduledStart;
    if (patch.scheduledEnd !== undefined) taskPatch.scheduledEnd = patch.scheduledEnd;
    if (patch.planDate !== undefined) taskPatch.planDate = patch.planDate as DayKey | null;
    if (patch.planOrder !== undefined) taskPatch.planOrder = patch.planOrder;
    if (patch.isMustDo !== undefined) taskPatch.isMustDo = patch.isMustDo;
    if (patch.tags !== undefined) taskPatch.tags = patch.tags;
    if (patch.recurrence !== undefined) taskPatch.recurrence = patch.recurrence;

    if (patch.status !== undefined) {
      taskPatch.status = patch.status;
      taskPatch.completedAt = patch.status === 'done' ? Date.now() : null;
      taskPatch.archivedAt = patch.status === 'archived' ? Date.now() : null;
    }

    const updated = patchTask(user.id, taskId, taskPatch, trx);
    if (!updated) return undefined;

    fixActivityForUpdate(user, before, updated, trx);
    syncTaskNotifications(user, updated, trx);
    return getTask(taskId, user.id, trx);
  }, db);
}

/**
 * Completing a task is the heart of the product loop, so it does four things in
 * one transaction: flip status, update the day rollup, spawn the next occurrence
 * of a recurring task, and clear stale reminders.
 */
export function setTaskDone(user: UserRow, taskId: string, done: boolean, db: Db = getDb()): { task: Task; spawned: Task | null } | undefined {
  return tx((trx) => {
    const before = one<TaskRow>('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, user.id], trx);
    if (!before) return undefined;
    const now = Date.now();
    const dayKey = toDayKey(now, user.tz_offset_minutes);

    const updated = patchTask(
      user.id,
      taskId,
      {
        status: done ? 'done' : 'todo',
        completedAt: done ? now : null,
      },
      trx,
    );
    if (!updated) return undefined;

    if (done) {
      incrementActivity(user.id, dayKey, { tasksCompleted: 1 }, trx);
      const quadrant = quadrantOf({ important: before.important === 1, urgent: before.urgent === 1 });
      if (quadrant === 'schedule') incrementActivity(user.id, dayKey, { importantNotUrgentDone: 1 }, trx);
      if (before.plan_date) incrementActivity(user.id, before.plan_date as DayKey, { plannedCompleted: 1 }, trx);
      clearTaskNotifications(user.id, taskId, trx);
      // Completing every subtask is a strong signal, but never silent data loss:
      // we only auto-close subtasks that are still open.
      run(
        `UPDATE subtasks SET status = 'done', completed_at = ?, updated_at = ? WHERE task_id = ? AND user_id = ? AND deleted_at IS NULL AND status != 'done'`,
        [now, now, taskId, user.id],
        trx,
      );
    } else {
      incrementActivity(user.id, dayKey, { tasksCompleted: -1 }, trx);
      const quadrant = quadrantOf({ important: before.important === 1, urgent: before.urgent === 1 });
      if (quadrant === 'schedule') incrementActivity(user.id, dayKey, { importantNotUrgentDone: -1 }, trx);
      if (before.plan_date) incrementActivity(user.id, before.plan_date as DayKey, { plannedCompleted: -1 }, trx);
      if (before.completed_at) {
        const completedDay = toDayKey(before.completed_at, user.tz_offset_minutes);
        if (completedDay !== dayKey) incrementActivity(user.id, completedDay, { tasksCompleted: -1 }, trx);
      }
      syncTaskNotifications(user, updated, trx);
    }

    let spawned: Task | null = null;
    if (done && updated.recurrence) {
      const rule = parseRecurrenceSafe(updated.recurrence);
      if (rule.kind !== 'none') {
        const anchor = (updated.due_date ?? updated.plan_date ?? dayKey) as DayKey;
        const base = anchor > dayKey ? anchor : dayKey;
        const nextDay = nextOccurrence(anchor, { ...rule, count: rule.count }, base);
        if (nextDay) {
          const created = insertTask(
            user.id,
            {
              projectId: updated.project_id,
              title: updated.title,
              description: updated.description,
              notes: updated.notes,
              priority: updated.priority as TaskWriteInput['priority'],
              important: updated.important === 1,
              urgent: updated.urgent === 1,
              dueDate: nextDay,
              dueTime: updated.due_time,
              estimatedMinutes: updated.estimated_minutes,
              recurrence: { ...rule, count: rule.count + 1 },
              recurredFromId: updated.id,
              tags: getTagsForTask(updated.id, trx),
            },
            trx,
          );
          incrementActivity(user.id, nextDay, { plannedCount: 0 }, trx);
          spawned = getTask(created.id, user.id, trx) ?? null;
        }
      }
    }

    return { task: getTask(taskId, user.id, trx)!, spawned };
  }, db);
}

function parseRecurrenceSafe(value: string | null) {
  if (!value) return { kind: 'none' as const, interval: 1, byWeekday: [], until: null, count: 0, maxOccurrences: null };
  try {
    const parsed = JSON.parse(value);
    return {
      kind: parsed.kind ?? 'none',
      interval: parsed.interval ?? 1,
      byWeekday: parsed.byWeekday ?? [],
      until: parsed.until ?? null,
      count: parsed.count ?? 0,
      maxOccurrences: parsed.maxOccurrences ?? null,
    };
  } catch {
    return { kind: 'none' as const, interval: 1, byWeekday: [], until: null, count: 0, maxOccurrences: null };
  }
}

function getTagsForTask(taskId: string, db: Db): string[] {
  return tasksRepo.getTaskTagNames(taskId, db);
}

/** Keeps day rollups honest when planning fields change after the fact. */
function fixActivityForUpdate(user: UserRow, before: TaskRow, after: TaskRow, db: Db): void {
  if (before.plan_date !== after.plan_date) {
    if (before.plan_date) incrementActivity(user.id, before.plan_date as DayKey, { plannedCount: -1 }, db);
    if (after.plan_date) incrementActivity(user.id, after.plan_date as DayKey, { plannedCount: 1 }, db);
  }
  const wasDone = before.status === 'done';
  const isDone = after.status === 'done';
  if (wasDone !== isDone) {
    const day = toDayKey(isDone ? after.completed_at ?? Date.now() : before.completed_at ?? Date.now(), user.tz_offset_minutes);
    incrementActivity(user.id, day, { tasksCompleted: isDone ? 1 : -1 }, db);
    const quadrant = quadrantOf({ important: after.important === 1, urgent: after.urgent === 1 });
    if (quadrant === 'schedule') incrementActivity(user.id, day, { importantNotUrgentDone: isDone ? 1 : -1 }, db);
    if (after.plan_date) incrementActivity(user.id, after.plan_date as DayKey, { plannedCompleted: isDone ? 1 : -1 }, db);
  }
}

export function deleteTask(user: UserRow, taskId: string, db: Db = getDb()): boolean {
  return tx((trx) => {
    const before = one<TaskRow>('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, user.id], trx);
    if (!before) return false;
    clearTaskNotifications(user.id, taskId, trx);
    if (before.status === 'done' && before.completed_at) {
      incrementActivity(user.id, toDayKey(before.completed_at, user.tz_offset_minutes), { tasksCompleted: -1 }, trx);
    }
    if (before.plan_date) incrementActivity(user.id, before.plan_date as DayKey, { plannedCount: -1 }, trx);
    softDeleteTask(user.id, taskId, trx);
    return true;
  }, db);
}

export function duplicate(user: UserRow, taskId: string, overrides: Partial<TaskWriteInput> = {}, db: Db = getDb()): Task | undefined {
  return duplicateTask(user.id, taskId, overrides, db);
}

/** Bulk reorder / replan used by the planner and matrix drag & drop. */
export function applyPlanUpdates(
  user: UserRow,
  updates: Array<{
    id: string;
    planOrder?: number;
    isMustDo?: boolean;
    planDate?: DayKey | null;
    scheduledStart?: number | null;
    scheduledEnd?: number | null;
    dueDate?: DayKey | null;
    dueTime?: string | null;
    important?: boolean;
    urgent?: boolean;
    status?: TaskStatus;
  }>,
  db: Db = getDb(),
): Task[] {
  return tx((trx) => {
    const out: Task[] = [];
    for (const update of updates) {
      const before = one<TaskRow>('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [update.id, user.id], trx);
      if (!before) continue;
      const patch: TaskPatch = {};
      if (update.planOrder !== undefined) patch.planOrder = update.planOrder;
      if (update.isMustDo !== undefined) patch.isMustDo = update.isMustDo;
      if (update.planDate !== undefined) patch.planDate = update.planDate;
      if (update.scheduledStart !== undefined) patch.scheduledStart = update.scheduledStart;
      if (update.scheduledEnd !== undefined) patch.scheduledEnd = update.scheduledEnd;
      if (update.dueDate !== undefined) patch.dueDate = update.dueDate;
      if (update.dueTime !== undefined) patch.dueTime = update.dueTime;
      if (update.important !== undefined) patch.important = update.important;
      if (update.urgent !== undefined) patch.urgent = update.urgent;
      if (update.status !== undefined) patch.status = update.status;
      const updated = patchTask(user.id, update.id, patch, trx);
      if (!updated) continue;
      fixActivityForUpdate(user, before, updated, trx);
      out.push(getTask(update.id, user.id, trx)!);
    }
    return out;
  }, db);
}

/** "Reschedule everything unfinished from today" — the daily-review workhorse. */
export function rolloverTasks(user: UserRow, taskIds: readonly string[], to: DayKey, db: Db = getDb()): Task[] {
  return applyPlanUpdates(
    user,
    taskIds.map((id) => ({ id, planDate: to, dueDate: to })),
    db,
  );
}

export { listSubtasksForTasks, addDays };
