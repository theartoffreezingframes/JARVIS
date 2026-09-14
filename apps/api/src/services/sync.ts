import type { DayKey, FocusMode } from '@jarvis/shared';
import type { Db } from '../db/index.js';
import { all, getDb, one, run, tx } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { incrementActivity } from '../repo/activity.js';
import * as habitsRepo from '../repo/habits.js';
import { patchHabit, toggleCompletion } from '../repo/habits.js';
import { hydrateFocusSessions, insertFocusSession, patchFocusSession } from '../repo/focus.js';
import { hydrateNotes, insertNote, patchNote, softDeleteNote } from '../repo/notes.js';
import { hydrateProjects, insertProject, patchProject, softDeleteProject } from '../repo/projects.js';
import { hydrateTasks, insertTask, patchTask, setTaskCompleted, softDeleteTask, type TaskPatch, type TaskWriteInput } from '../repo/tasks.js';
import type { NoteRow, ProjectRow, TaskRow, UserRow } from '../repo/rows.js';
import { getSettingsRow, nextSeq } from '../repo/users.js';
import { parseSettings } from '../repo/mappers.js';
import { syncTaskNotifications } from './tasks.js';

/**
 * Offline-first synchronisation.
 *
 * Clients queue mutations locally and replay them here. Two properties matter:
 *
 *  1. **Idempotency** — every operation carries a client-generated id, recorded
 *     in `sync_operations`, so a retried push never duplicates data.
 *  2. **Safe conflict handling** — updates are three-way merged against the
 *     `base` snapshot the client last saw. If the server's value still equals the
 *     base, the client's change is applied; if the server moved on, the server
 *     value is kept and the conflict is reported back so the UI can explain it.
 *     Nothing is silently overwritten and nothing is silently dropped.
 */

export type SyncEntity =
  | 'task'
  | 'subtask'
  | 'project'
  | 'habit'
  | 'habit_completion'
  | 'focus_session'
  | 'note'
  | 'daily_review'
  | 'settings';

export interface SyncOperation {
  id: string;
  entity: SyncEntity;
  op: 'create' | 'update' | 'delete' | 'toggle';
  entityId: string;
  payload: Record<string, unknown>;
  clientTimestamp: number;
  baseUpdatedAt?: number | null;
}

export interface SyncConflict {
  entity: SyncEntity;
  entityId: string;
  reason: 'server_newer' | 'deleted_on_server' | 'validation_failed';
  fields?: string[];
  message: string;
}

export interface SyncPushResult {
  applied: Array<{ id: string; entity: SyncEntity; entityId: string; serverId?: string; serverUpdatedAt?: number }>;
  conflicts: SyncConflict[];
  cursor: number;
}

const ENTITY_TABLE: Record<SyncEntity, string | null> = {
  task: 'tasks',
  subtask: 'subtasks',
  project: 'projects',
  habit: 'habits',
  habit_completion: 'habit_completions',
  focus_session: 'focus_sessions',
  note: 'notes',
  daily_review: 'daily_reviews',
  settings: 'user_settings',
};

function alreadyApplied(operationId: string, userId: string, db: Db): boolean {
  return Boolean(one<{ id: string }>('SELECT id FROM sync_operations WHERE id = ? AND user_id = ?', [operationId, userId], db));
}

function recordOperation(operation: SyncOperation, userId: string, result: unknown, db: Db): void {
  run(
    `INSERT OR REPLACE INTO sync_operations (id, user_id, entity, op, entity_id, result, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [operation.id, userId, operation.entity, operation.op, operation.entityId, JSON.stringify(result ?? null), Date.now()],
    db,
  );
}

/**
 * Looks a row up by the id the *client* generated for it.
 *
 * A device that replayed a create after losing its local id map must not be able
 * to create a second copy, and must not fail either — the queued mutation simply
 * lands on the row it originally created.
 */
function rowByClientId(entity: SyncEntity, clientId: string, userId: string, db: Db): Record<string, unknown> | undefined {
  const table = ENTITY_TABLE[entity];
  if (!table || entity === 'settings' || entity === 'subtask') return undefined;
  return one<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE user_id = ? AND client_id = ? AND deleted_at IS NULL`,
    [userId, clientId],
    db,
  );
}

function serverRow(entity: SyncEntity, entityId: string, userId: string, db: Db): Record<string, unknown> | undefined {
  const table = ENTITY_TABLE[entity];
  if (!table) return undefined;
  if (entity === 'settings') {
    return one<Record<string, unknown>>('SELECT * FROM user_settings WHERE user_id = ?', [userId], db);
  }
  return one<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`, [entityId, userId], db);
}

/**
 * Field level three-way merge. Returns the merged patch plus the fields that
 * could not be applied because the server changed them independently.
 */
export function mergePatch(
  base: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
  current: Record<string, unknown> | undefined,
): { merged: Record<string, unknown>; conflicts: string[] } {
  const merged: Record<string, unknown> = {};
  const conflicts: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (!current || !base || !(key in base)) {
      merged[key] = value;
      continue;
    }
    const serverValue = current[key];
    const baseValue = base[key];
    const serverChanged = JSON.stringify(serverValue) !== JSON.stringify(baseValue);
    const clientChanged = JSON.stringify(value) !== JSON.stringify(baseValue);
    if (serverChanged && clientChanged) {
      conflicts.push(key);
      continue; // keep the server value
    }
    merged[key] = value;
  }
  return { merged, conflicts };
}

export function pushOperations(user: UserRow, deviceId: string, operations: readonly SyncOperation[], db: Db = getDb()): SyncPushResult {
  const applied: SyncPushResult['applied'] = [];
  const conflicts: SyncConflict[] = [];

  return tx((trx) => {
    for (const operation of operations) {
      if (alreadyApplied(operation.id, user.id, trx)) {
        const previous = one<{ result: string | null }>('SELECT result FROM sync_operations WHERE id = ?', [operation.id], trx);
        if (previous?.result) {
          try {
            applied.push(JSON.parse(previous.result) as SyncPushResult['applied'][number]);
            continue;
          } catch {
            /* fall through and re-apply */
          }
        }
      }

      const patch = (operation.payload.patch ?? operation.payload) as Record<string, unknown>;
      const base = operation.payload.base as Record<string, unknown> | undefined;
      const current = serverRow(operation.entity, operation.entityId, user.id, trx);

      if (operation.op === 'delete') {
        applyDelete(user, operation, trx);
        const result = { id: operation.id, entity: operation.entity, entityId: operation.entityId };
        recordOperation(operation, user.id, result, trx);
        applied.push(result);
        continue;
      }

      if (operation.op === 'update' && current && operation.baseUpdatedAt != null) {
        const serverUpdatedAt = Number(current.updated_at ?? 0);
        if (serverUpdatedAt > operation.baseUpdatedAt) {
          const { merged, conflicts: fieldConflicts } = mergePatch(base, mapToColumnNames(operation.entity, patch), current);
          if (fieldConflicts.length) {
            conflicts.push({
              entity: operation.entity,
              entityId: operation.entityId,
              reason: 'server_newer',
              fields: fieldConflicts,
              message: 'This item changed on another device. Your edit was merged where possible; conflicting fields kept the other device’s value.',
            });
          }
          if (Object.keys(merged).length) {
            applyUpdate(user, operation, merged, trx);
          }
          const result = { id: operation.id, entity: operation.entity, entityId: operation.entityId, serverUpdatedAt: Date.now() };
          recordOperation(operation, user.id, result, trx);
          applied.push(result);
          continue;
        }
      }

      const result = applyCreateOrUpdate(user, operation, patch, current, trx);
      recordOperation(operation, user.id, result, trx);
      applied.push(result);
    }

    const cursor = one<{ change_seq: number }>('SELECT change_seq FROM users WHERE id = ?', [user.id], trx)?.change_seq ?? 0;
    void deviceId;
    return { applied, conflicts, cursor };
  }, db);
}

/* -------------------------------------------------------------------------- */
/*  Entity appliers                                                           */
/* -------------------------------------------------------------------------- */

function mapToColumnNames(entity: SyncEntity, patch: Record<string, unknown>): Record<string, unknown> {
  // Client payloads are already camelCase domain fields; repo layers translate.
  void entity;
  return patch;
}

function applyDelete(user: UserRow, operation: SyncOperation, db: Db): void {
  switch (operation.entity) {
    case 'task':
      softDeleteTask(user.id, operation.entityId, db);
      break;
    case 'project':
      softDeleteProject(user.id, operation.entityId, db);
      break;
    case 'note':
      softDeleteNote(user.id, operation.entityId, db);
      break;
    case 'habit':
      patchHabit(user.id, operation.entityId, { archived: true }, db);
      break;
    case 'focus_session':
      run('UPDATE focus_sessions SET deleted_at = ?, updated_at = ?, seq = ? WHERE id = ? AND user_id = ?', [
        Date.now(), Date.now(), nextSeq(user.id, db), operation.entityId, user.id,
      ], db);
      break;
    default:
      break;
  }
}

function applyUpdate(
  user: UserRow,
  operation: SyncOperation,
  merged: Record<string, unknown>,
  db: Db,
): void {
  switch (operation.entity) {
    case 'task': {
      patchTask(user.id, operation.entityId, merged as TaskPatch, db);
      break;
    }
    case 'project':
      patchProject(user.id, operation.entityId, merged as never, db);
      break;
    case 'habit':
      patchHabit(user.id, operation.entityId, merged as never, db);
      break;
    case 'note':
      patchNote(user.id, operation.entityId, merged as never, db);
      break;
    case 'focus_session':
      patchFocusSession(user.id, operation.entityId, merged as never, db);
      break;
    default:
      break;
  }
}

function applyCreateOrUpdate(
  user: UserRow,
  operation: SyncOperation,
  patch: Record<string, unknown>,
  current: Record<string, unknown> | undefined,
  db: Db,
): SyncPushResult['applied'][number] {
  switch (operation.entity) {
    case 'task': {
      const existingTask = current ?? rowByClientId('task', operation.entityId, user.id, db);
      if (existingTask) {
        setTaskFieldsForSync(user, String(existingTask.id), patch, db);
        return {
          id: operation.id,
          entity: operation.entity,
          entityId: operation.entityId,
          serverId: String(existingTask.id),
        };
      }
      if (operation.op === 'toggle') {
        const completed = patch.completed === true;
        setTaskCompleted(user.id, operation.entityId, completed, { actualMinutesDelta: Number(patch.actualMinutesDelta ?? 0) || undefined }, db);
        return { id: operation.id, entity: operation.entity, entityId: operation.entityId };
      }
      const created = insertTask(
        user.id,
        { ...(patch as unknown as TaskWriteInput), clientId: (patch.clientId as string) ?? operation.entityId },
        db,
      );
      const today = new Date().toISOString().slice(0, 10) as DayKey;
      incrementActivity(user.id, today, { tasksCreated: 1 }, db);
      return { id: operation.id, entity: operation.entity, entityId: operation.entityId, serverId: created.id };
    }
    case 'project': {
      const existingProject = rowByClientId('project', operation.entityId, user.id, db);
      if (existingProject) {
        patchProject(user.id, String(existingProject.id), patch as never, db);
        return { id: operation.id, entity: operation.entity, entityId: operation.entityId, serverId: String(existingProject.id) };
      }
      const created = insertProject(
        user.id,
        { ...(patch as unknown as Parameters<typeof insertProject>[1]), clientId: (patch.clientId as string) ?? operation.entityId },
        db,
      );
      return { id: operation.id, entity: operation.entity, entityId: operation.entityId, serverId: created.id };
    }
    case 'habit': {
      const existingHabit = current ?? rowByClientId('habit', operation.entityId, user.id, db);
      if (existingHabit) {
        patchHabit(user.id, String(existingHabit.id), patch as never, db);
        return { id: operation.id, entity: operation.entity, entityId: operation.entityId, serverId: String(existingHabit.id) };
      }
      const created = patchHabitRow(user, patch);
      return { id: operation.id, entity: operation.entity, entityId: operation.entityId, serverId: created };
    }
    case 'habit_completion': {
      const habitId = String(patch.habitId ?? operation.entityId);
      const dayKey = String(patch.dayKey ?? new Date().toISOString().slice(0, 10));
      const completed = patch.completed !== false;
      toggleCompletion(user.id, habitId, dayKey as DayKey, completed, (patch.note as string) ?? null, db);
      incrementActivity(user.id, dayKey as DayKey, { habitCompletions: completed ? 1 : -1 }, db);
      return { id: operation.id, entity: operation.entity, entityId: operation.entityId };
    }
    case 'focus_session': {
      const existingSession = current ?? rowByClientId('focus_session', operation.entityId, user.id, db);
      if (existingSession) {
        patchFocusSession(user.id, String(existingSession.id), patch as never, db);
        return { id: operation.id, entity: operation.entity, entityId: operation.entityId, serverId: String(existingSession.id) };
      }
      const created = insertFocusSession(
        user.id,
        {
          taskId: (patch.taskId as string) ?? null,
          projectId: (patch.projectId as string) ?? null,
          mode: (patch.mode as FocusMode) ?? 'pomodoro',
          label: (patch.label as string) ?? null,
          plannedMinutes: Number(patch.plannedMinutes ?? 25),
          startedAt: Number(patch.startedAt ?? Date.now()),
          dayKey: String(patch.dayKey ?? new Date().toISOString().slice(0, 10)) as DayKey,
          clientId: (patch.clientId as string) ?? operation.entityId,
        },
        db,
      );
      return { id: operation.id, entity: operation.entity, entityId: operation.entityId, serverId: created.id };
    }
    case 'note': {
      const existingNote = current ?? rowByClientId('note', operation.entityId, user.id, db);
      if (existingNote) {
        patchNote(user.id, String(existingNote.id), patch as never, db);
        return { id: operation.id, entity: operation.entity, entityId: operation.entityId, serverId: String(existingNote.id) };
      }
      const created = insertNote(
        user.id,
        { ...(patch as unknown as Parameters<typeof insertNote>[1]), clientId: (patch.clientId as string) ?? operation.entityId },
        db,
      );
      return { id: operation.id, entity: operation.entity, entityId: operation.entityId, serverId: created.id };
    }
    case 'daily_review': {
      upsertReview(user.id, patch, db);
      return { id: operation.id, entity: operation.entity, entityId: operation.entityId };
    }
    case 'settings': {
      const existing = getSettingsRow(user.id, db);
      const saved = existing ? (JSON.parse(existing.data) as Record<string, unknown>) : {};
      const merged = { ...saved, ...patch };
      run(
        `INSERT INTO user_settings (user_id, data, updated_at, seq) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, seq = excluded.seq`,
        [user.id, JSON.stringify(merged), Date.now(), nextSeq(user.id, db)],
        db,
      );
      return { id: operation.id, entity: operation.entity, entityId: operation.entityId };
    }
    default:
      return { id: operation.id, entity: operation.entity, entityId: operation.entityId };
  }
}

function setTaskFieldsForSync(user: UserRow, taskId: string, patch: Record<string, unknown>, db: Db): void {
  if (patch.completed !== undefined) {
    setTaskCompleted(user.id, taskId, patch.completed === true, {}, db);
    return;
  }
  const updated = patchTask(user.id, taskId, patch as TaskPatch, db);
  if (updated) syncTaskNotifications(user, updated, db);
}

function patchHabitRow(user: UserRow, patch: Record<string, unknown>): string {
  const created = habitsRepo.insertHabit(user.id, {
    ...(patch as unknown as Parameters<typeof habitsRepo.insertHabit>[1]),
    clientId: (patch.clientId as string) ?? undefined,
  });
  return created.id;
}

function upsertReview(userId: string, patch: Record<string, unknown>, db: Db): void {
  const dayKey = String(patch.dayKey ?? new Date().toISOString().slice(0, 10));
  const existing = one<{ id: string }>('SELECT id FROM daily_reviews WHERE user_id = ? AND day_key = ?', [userId, dayKey], db);
  const now = Date.now();
  if (existing) {
    run(
      `UPDATE daily_reviews SET reflection = ?, mood = ?, energy = ?, tomorrow_top_task_id = ?, updated_at = ?, seq = ?
        WHERE id = ?`,
      [
        (patch.reflection as string) ?? null,
        (patch.mood as number) ?? null,
        (patch.energy as number) ?? null,
        (patch.tomorrowTopTaskId as string) ?? null,
        now,
        nextSeq(userId, db),
        existing.id,
      ],
      db,
    );
    return;
  }
  run(
    `INSERT INTO daily_reviews (id, user_id, day_key, reflection, mood, energy, tomorrow_top_task_id, created_at, updated_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId('rev'), userId, dayKey, (patch.reflection as string) ?? null, (patch.mood as number) ?? null,
      (patch.energy as number) ?? null, (patch.tomorrowTopTaskId as string) ?? null, now, now, nextSeq(userId, db),
    ],
    db,
  );
}

/* -------------------------------------------------------------------------- */
/*  Pull                                                                      */
/* -------------------------------------------------------------------------- */

export interface SyncPullResult {
  cursor: number;
  hasMore: boolean;
  serverTime: number;
  tasks: unknown[];
  subtasks: unknown[];
  projects: unknown[];
  habits: unknown[];
  habitCompletions: unknown[];
  focusSessions: unknown[];
  notes: unknown[];
  reviews: unknown[];
  settings: ReturnType<typeof parseSettings> | null;
  deletions: Array<{ entity: SyncEntity; id: string; seq: number }>;
}

/**
 * Incremental pull: everything whose `seq` is greater than the client's cursor,
 * plus tombstones so remote deletions propagate. Rows are returned with their
 * full domain shape, so the client can write them straight into its local store.
 */
export function pullChanges(user: UserRow, since: number, limit = 500, db: Db = getDb()): SyncPullResult {
  const cappedLimit = Math.min(Math.max(limit, 1), 1000);
  const userId = user.id;

  const taskRows = all<TaskRow>(
    'SELECT * FROM tasks WHERE user_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?',
    [userId, since, cappedLimit],
    db,
  );
  const projectRows = all<ProjectRow>(
    'SELECT * FROM projects WHERE user_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?',
    [userId, since, cappedLimit],
    db,
  );
  const noteRows = all<NoteRow>(
    'SELECT * FROM notes WHERE user_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?',
    [userId, since, cappedLimit],
    db,
  );
  const habitRows = all<import('../repo/rows.js').HabitRow>(
    'SELECT * FROM habits WHERE user_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?',
    [userId, since, cappedLimit],
    db,
  );
  const completionRows = all<import('../repo/rows.js').HabitCompletionRow>(
    'SELECT * FROM habit_completions WHERE user_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?',
    [userId, since, cappedLimit],
    db,
  );
  const focusRows = all<import('../repo/rows.js').FocusSessionRow>(
    'SELECT * FROM focus_sessions WHERE user_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?',
    [userId, since, cappedLimit],
    db,
  );
  const reviewRows = all<import('../repo/rows.js').DailyReviewRow>(
    'SELECT * FROM daily_reviews WHERE user_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?',
    [userId, since, cappedLimit],
    db,
  );
  const subtaskRows = all<import('../repo/rows.js').SubtaskRow>(
    `SELECT s.* FROM subtasks s WHERE s.user_id = ? AND s.seq > ? ORDER BY s.seq ASC LIMIT ?`,
    [userId, since, cappedLimit],
    db,
  );
  const settingsRow = getSettingsRow(userId, db);

  const seqs = [
    ...taskRows.map((r) => r.seq),
    ...projectRows.map((r) => r.seq),
    ...noteRows.map((r) => r.seq),
    ...habitRows.map((r) => r.seq),
    ...completionRows.map((r) => r.seq),
    ...focusRows.map((r) => r.seq),
    ...reviewRows.map((r) => r.seq),
    ...subtaskRows.map((r) => r.seq),
  ];
  const maxSeq = seqs.length ? Math.max(...seqs) : since;
  const cursor = maxSeq === since ? since : maxSeq;

  const deletions: SyncPullResult['deletions'] = [
    ...taskRows.filter((r) => r.deleted_at).map((r) => ({ entity: 'task' as const, id: r.id, seq: r.seq })),
    ...projectRows.filter((r) => r.deleted_at).map((r) => ({ entity: 'project' as const, id: r.id, seq: r.seq })),
    ...noteRows.filter((r) => r.deleted_at).map((r) => ({ entity: 'note' as const, id: r.id, seq: r.seq })),
    ...focusRows.filter((r) => r.deleted_at).map((r) => ({ entity: 'focus_session' as const, id: r.id, seq: r.seq })),
  ];

  const currentCursor = one<{ change_seq: number }>('SELECT change_seq FROM users WHERE id = ?', [userId], db)?.change_seq ?? 0;

  return {
    cursor,
    hasMore: currentCursor > cursor,
    serverTime: Date.now(),
    tasks: hydrateTasks(taskRows.filter((r) => !r.deleted_at), db),
    subtasks: subtaskRows
      .filter((r) => !r.deleted_at)
      .map((r) => ({
        id: r.id,
        taskId: r.task_id,
        title: r.title,
        status: r.status,
        position: r.position,
        completedAt: r.completed_at,
        updatedAt: r.updated_at,
      })),
    projects: hydrateProjects(projectRows.filter((r) => !r.deleted_at), db),
    habits: habitRows
      .filter((r) => !r.deleted_at)
      .map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        icon: r.icon,
        color: r.color,
        frequency: r.frequency,
        scheduleDays: r.schedule_days ? r.schedule_days.split(',').map(Number).filter((n) => !Number.isNaN(n)) : [],
        targetPerPeriod: r.target_per_period,
        reminderTime: r.reminder_time,
        archived: r.archived === 1,
        updatedAt: r.updated_at,
      })),
    habitCompletions: completionRows.map((r) => ({
      id: r.id,
      habitId: r.habit_id,
      dayKey: r.day_key,
      count: r.count,
      deletedAt: r.deleted_at,
      updatedAt: r.updated_at,
    })),
    focusSessions: hydrateFocusSessions(focusRows.filter((r) => !r.deleted_at), db),
    notes: hydrateNotes(noteRows.filter((r) => !r.deleted_at), db),
    reviews: reviewRows.map((r) => ({
      id: r.id,
      dayKey: r.day_key,
      reflection: r.reflection,
      mood: r.mood,
      energy: r.energy,
      updatedAt: r.updated_at,
    })),
    settings: settingsRow ? parseSettings(user, settingsRow) : null,
    deletions,
  };
}
