import type { DayKey, Priority, Quadrant, Task, TaskStatus } from '@jarvis/shared';
import { quadrantOf } from '@jarvis/shared';
import type { Db } from '../db/index.js';
import { all, getDb, one, run } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { mapSubtask, mapTask, parseRecurrence } from './mappers.js';
import type { SubtaskRow, TagRow, TaskRow } from './rows.js';
import { nextSeq } from './users.js';

/* -------------------------------------------------------------------------- */
/*  Writes                                                                    */
/* -------------------------------------------------------------------------- */

export interface TaskWriteInput {
  projectId: string | null;
  parentTaskId?: string | null;
  title: string;
  description?: string | null;
  notes?: string | null;
  status?: TaskStatus;
  priority?: Priority;
  important?: boolean;
  urgent?: boolean;
  dueDate?: DayKey | null;
  dueTime?: string | null;
  reminderAt?: number | null;
  estimatedMinutes?: number | null;
  actualMinutes?: number;
  scheduledStart?: number | null;
  scheduledEnd?: number | null;
  planDate?: DayKey | null;
  planOrder?: number;
  isMustDo?: boolean;
  recurrence?: Task['recurrence'] | null;
  recurredFromId?: string | null;
  clientId?: string | null;
  tags?: string[];
}

export function insertTask(userId: string, input: TaskWriteInput, db: Db = getDb()): TaskRow {
  const now = Date.now();
  const id = newId('tsk');
  const seq = nextSeq(userId, db);
  run(
    `INSERT INTO tasks (
        id, user_id, project_id, parent_task_id, title, description, notes, status, priority,
        important, urgent, due_date, due_time, reminder_at, estimated_minutes, actual_minutes,
        scheduled_start, scheduled_end, plan_date, plan_order, is_must_do, recurrence, recurred_from_id,
        created_at, updated_at, seq, client_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      input.projectId,
      input.parentTaskId ?? null,
      input.title,
      input.description ?? null,
      input.notes ?? null,
      input.status ?? 'todo',
      input.priority ?? 'medium',
      input.important ? 1 : 0,
      input.urgent ? 1 : 0,
      input.dueDate ?? null,
      input.dueTime ?? null,
      input.reminderAt ?? null,
      input.estimatedMinutes ?? null,
      input.actualMinutes ?? 0,
      input.scheduledStart ?? null,
      input.scheduledEnd ?? null,
      input.planDate ?? null,
      input.planOrder ?? 0,
      input.isMustDo ? 1 : 0,
      input.recurrence && input.recurrence.kind !== 'none' ? JSON.stringify(input.recurrence) : null,
      input.recurredFromId ?? null,
      now,
      now,
      seq,
      input.clientId ?? null,
    ],
    db,
  );

  if (input.tags?.length) setTaskTags(userId, id, input.tags, db);
  return one<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id], db)!;
}

export type TaskPatch = Partial<{
  projectId: string | null;
  title: string;
  description: string | null;
  notes: string | null;
  status: TaskStatus;
  priority: Priority;
  important: boolean;
  urgent: boolean;
  dueDate: DayKey | null;
  dueTime: string | null;
  reminderAt: number | null;
  estimatedMinutes: number | null;
  actualMinutes: number;
  scheduledStart: number | null;
  scheduledEnd: number | null;
  planDate: DayKey | null;
  planOrder: number;
  isMustDo: boolean;
  recurrence: Task['recurrence'] | null;
  completedAt: number | null;
  archivedAt: number | null;
  tags: string[];
}>;

const PATCH_COLUMNS: Record<string, string> = {
  projectId: 'project_id',
  title: 'title',
  description: 'description',
  notes: 'notes',
  status: 'status',
  priority: 'priority',
  important: 'important',
  urgent: 'urgent',
  dueDate: 'due_date',
  dueTime: 'due_time',
  reminderAt: 'reminder_at',
  estimatedMinutes: 'estimated_minutes',
  actualMinutes: 'actual_minutes',
  scheduledStart: 'scheduled_start',
  scheduledEnd: 'scheduled_end',
  planDate: 'plan_date',
  planOrder: 'plan_order',
  isMustDo: 'is_must_do',
  recurrence: 'recurrence',
  completedAt: 'completed_at',
  archivedAt: 'archived_at',
};

function serializePatchValue(key: string, value: unknown): unknown {
  if (key === 'recurrence') {
    if (!value) return null;
    const rule = value as Task['recurrence'];
    return rule.kind === 'none' ? null : JSON.stringify(rule);
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value ?? null;
}

/** Applies a partial update and always advances the sync revision. */
export function patchTask(userId: string, taskId: string, patch: TaskPatch, db: Db = getDb()): TaskRow | undefined {
  const entries = Object.entries(patch).filter(([key]) => key in PATCH_COLUMNS);
  const now = Date.now();

  if (entries.length || patch.tags) {
    const seq = nextSeq(userId, db);
    const sets: string[] = ['updated_at = ?', 'seq = ?'];
    const params: unknown[] = [now, seq];
    for (const [key, value] of entries) {
      sets.push(`${PATCH_COLUMNS[key]} = ?`);
      params.push(serializePatchValue(key, value));
    }
    params.push(taskId, userId);
    run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params, db);
  }

  if (patch.tags) setTaskTags(userId, taskId, patch.tags, db);
  return one<TaskRow>('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId], db);
}

export function softDeleteTask(userId: string, taskId: string, db: Db = getDb()): void {
  const seq = nextSeq(userId, db);
  const now = Date.now();
  run('UPDATE tasks SET deleted_at = ?, updated_at = ?, seq = ? WHERE id = ? AND user_id = ?', [
    now, now, seq, taskId, userId,
  ], db);
  run('UPDATE subtasks SET deleted_at = ?, updated_at = ?, seq = ? WHERE task_id = ? AND user_id = ?', [
    now, now, seq, taskId, userId,
  ], db);
}

export function setTaskCompleted(
  userId: string,
  taskId: string,
  completed: boolean,
  options: { now?: number; actualMinutesDelta?: number } = {},
  db: Db = getDb(),
): TaskRow | undefined {
  const now = options.now ?? Date.now();
  const patch: TaskPatch = {
    status: completed ? 'done' : 'todo',
    completedAt: completed ? now : null,
  };
  if (options.actualMinutesDelta) {
    const existing = one<{ actual_minutes: number }>(
      'SELECT actual_minutes FROM tasks WHERE id = ? AND user_id = ?',
      [taskId, userId],
      db,
    );
    patch.actualMinutes = Math.max(0, (existing?.actual_minutes ?? 0) + (completed ? options.actualMinutesDelta : -options.actualMinutesDelta));
  }
  return patchTask(userId, taskId, patch, db);
}

export function archiveTask(userId: string, taskId: string, archived: boolean, db: Db = getDb()): TaskRow | undefined {
  return patchTask(
    userId,
    taskId,
    archived
      ? { status: 'archived', archivedAt: Date.now() }
      : { status: 'todo', archivedAt: null },
    db,
  );
}

/** Deep copy (optionally into a new day / project) including subtasks and tags. */
export function duplicateTask(userId: string, taskId: string, overrides: Partial<TaskWriteInput> = {}, db: Db = getDb()): Task | undefined {
  const source = one<TaskRow>('SELECT * FROM tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [taskId, userId], db);
  if (!source) return undefined;
  const tags = getTaskTagNames(taskId, db);
  const created = insertTask(
    userId,
    {
      projectId: (overrides.projectId ?? source.project_id) as string | null,
      parentTaskId: source.parent_task_id,
      title: overrides.title ?? `${source.title} (copy)`,
      description: source.description,
      notes: source.notes,
      status: 'todo',
      priority: (overrides.priority ?? source.priority) as Priority,
      important: overrides.important ?? source.important === 1,
      urgent: overrides.urgent ?? source.urgent === 1,
      dueDate: (overrides.dueDate ?? source.due_date) as DayKey | null,
      dueTime: (overrides.dueTime ?? source.due_time) as string | null,
      reminderAt: overrides.reminderAt ?? null,
      estimatedMinutes: source.estimated_minutes,
      planDate: (overrides.planDate ?? source.plan_date) as DayKey | null,
      planOrder: overrides.planOrder ?? source.plan_order,
      isMustDo: overrides.isMustDo ?? source.is_must_do === 1,
      recurrence: parseRecurrence(source.recurrence),
      tags,
      clientId: overrides.clientId ?? null,
    },
    db,
  );

  const subtasks = all<SubtaskRow>('SELECT * FROM subtasks WHERE task_id = ? AND deleted_at IS NULL ORDER BY position', [taskId], db);
  for (const subtask of subtasks) {
    run(
      `INSERT INTO subtasks (id, task_id, user_id, title, status, position, completed_at, created_at, updated_at, seq)
       VALUES (?, ?, ?, ?, 'todo', ?, NULL, ?, ?, ?)`,
      [newId('sub'), created.id, userId, subtask.title, subtask.position, Date.now(), Date.now(), nextSeq(userId, db)],
      db,
    );
  }

  return getTask(created.id, userId, db);
}

/* -------------------------------------------------------------------------- */
/*  Tags                                                                      */
/* -------------------------------------------------------------------------- */

export function ensureTag(userId: string, name: string, db: Db = getDb()): TagRow {
  const clean = name.trim().slice(0, 32);
  const existing = one<TagRow>(
    'SELECT * FROM tags WHERE user_id = ? AND name = ? AND deleted_at IS NULL',
    [userId, clean],
    db,
  );
  if (existing) return existing;
  const now = Date.now();
  const id = newId('tag');
  run(
    `INSERT INTO tags (id, user_id, name, color, created_at, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
    [id, userId, clean, '#8A8F98', now, now, nextSeq(userId, db)],
    db,
  );
  return one<TagRow>('SELECT * FROM tags WHERE user_id = ? AND name = ?', [userId, clean], db)!;
}

export function setTaskTags(userId: string, taskId: string, names: readonly string[], db: Db = getDb()): void {
  run('DELETE FROM task_tags WHERE task_id = ? AND user_id = ?', [taskId, userId], db);
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 12);
  for (const name of unique) {
    const tag = ensureTag(userId, name, db);
    run('INSERT OR IGNORE INTO task_tags (task_id, tag_id, user_id) VALUES (?, ?, ?)', [taskId, tag.id, userId], db);
  }
}

export function getTaskTagNames(taskId: string, db: Db = getDb()): string[] {
  return all<{ name: string }>(
    'SELECT t.name FROM tags t JOIN task_tags tt ON tt.tag_id = t.id WHERE tt.task_id = ? AND t.deleted_at IS NULL ORDER BY t.name',
    [taskId],
    db,
  ).map((r) => r.name);
}

export function listTags(userId: string, db: Db = getDb()): Array<{ id: string; name: string; color: string; taskCount: number }> {
  return all<{ id: string; name: string; color: string; taskCount: number }>(
    `SELECT t.id, t.name, t.color, (SELECT COUNT(*) FROM task_tags tt WHERE tt.tag_id = t.id) AS taskCount
       FROM tags t WHERE t.user_id = ? AND t.deleted_at IS NULL ORDER BY t.name`,
    [userId],
    db,
  );
}

/* -------------------------------------------------------------------------- */
/*  Reads                                                                     */
/* -------------------------------------------------------------------------- */

export interface TaskFilters {
  view?: 'today' | 'upcoming' | 'overdue' | 'all' | 'inbox' | 'completed' | 'archived' | 'matrix';
  today?: DayKey;
  nowMs?: number;
  projectId?: string | null;
  tag?: string;
  priority?: Priority;
  status?: TaskStatus;
  quadrant?: Quadrant;
  search?: string;
  from?: DayKey;
  to?: DayKey;
  planDate?: DayKey;
  parentTaskId?: string | null;
  includeCompleted?: boolean;
  limit?: number;
  offset?: number;
}

export function hydrateTasks(rows: readonly TaskRow[], db: Db = getDb()): Task[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(', ');

  const subtaskRows = all<SubtaskRow>(
    `SELECT * FROM subtasks WHERE task_id IN (${placeholders}) AND deleted_at IS NULL ORDER BY position`,
    ids,
    db,
  );
  const tagRows = all<{ task_id: string; name: string }>(
    `SELECT tt.task_id, t.name FROM task_tags tt JOIN tags t ON t.id = tt.tag_id
      WHERE tt.task_id IN (${placeholders}) AND t.deleted_at IS NULL ORDER BY t.name`,
    ids,
    db,
  );

  const subtasksByTask = new Map<string, SubtaskRow[]>();
  for (const row of subtaskRows) {
    const list = subtasksByTask.get(row.task_id) ?? [];
    list.push(row);
    subtasksByTask.set(row.task_id, list);
  }
  const tagsByTask = new Map<string, string[]>();
  for (const row of tagRows) {
    const list = tagsByTask.get(row.task_id) ?? [];
    list.push(row.name);
    tagsByTask.set(row.task_id, list);
  }

  return rows.map((row) =>
    mapTask(
      row,
      (subtasksByTask.get(row.id) ?? []).map(mapSubtask),
      tagsByTask.get(row.id) ?? [],
    ),
  );
}

export function getTask(id: string, userId: string, db: Db = getDb()): Task | undefined {
  const row = one<TaskRow>('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [id, userId], db);
  if (!row) return undefined;
  return hydrateTasks([row], db)[0];
}

export function listTasks(userId: string, filters: TaskFilters = {}, db: Db = getDb()): Task[] {
  const where: string[] = ['t.user_id = ?', 't.deleted_at IS NULL'];
  const params: unknown[] = [userId];
  const today = filters.today;

  switch (filters.view) {
    case 'today':
      where.push(`(t.plan_date = ? OR t.due_date = ? OR (t.due_date IS NOT NULL AND t.due_date < ? AND t.status NOT IN ('done','archived')))`);
      params.push(today, today, today);
      where.push(`t.status NOT IN ('archived')`);
      break;
    case 'upcoming':
      where.push(`t.due_date IS NOT NULL AND t.due_date > ?`);
      params.push(today);
      where.push(`t.status != 'archived'`);
      break;
    case 'overdue':
      where.push(`t.due_date IS NOT NULL AND t.due_date < ? AND t.status NOT IN ('done','archived')`);
      params.push(today);
      break;
    case 'inbox':
      where.push(`t.status NOT IN ('archived')`);
      where.push(`t.due_date IS NULL AND t.plan_date IS NULL`);
      where.push(`t.project_id IS NULL`);
      break;
    case 'completed':
      where.push(`t.status = 'done'`);
      break;
    case 'archived':
      where.push(`t.status = 'archived'`);
      break;
    case 'all':
    case 'matrix':
    default:
      where.push(`t.status != 'archived'`);
      break;
  }

  if (filters.view === 'matrix') {
    // matrix needs every open task, with or without a date
    where.push(`t.status NOT IN ('archived', 'done')`);
  }

  if (filters.projectId !== undefined) {
    if (filters.projectId === null) where.push('t.project_id IS NULL');
    else {
      where.push('t.project_id = ?');
      params.push(filters.projectId);
    }
  }
  if (filters.planDate) {
    where.push('t.plan_date = ?');
    params.push(filters.planDate);
  }
  if (filters.priority) {
    where.push('t.priority = ?');
    params.push(filters.priority);
  }
  if (filters.status) {
    where.push('t.status = ?');
    params.push(filters.status);
  }
  if (filters.from) {
    where.push('t.due_date >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('t.due_date <= ?');
    params.push(filters.to);
  }
  if (filters.includeCompleted === false) where.push(`t.status != 'done'`);
  if (filters.tag) {
    where.push(
      `t.id IN (SELECT tt.task_id FROM task_tags tt JOIN tags g ON g.id = tt.tag_id WHERE g.user_id = ? AND g.name = ?)`,
    );
    params.push(userId, filters.tag);
  }
  if (filters.search) {
    const like = `%${filters.search.replace(/[%_]/g, '')}%`;
    // Title, body and tag names all match so a tag behaves like a saved search.
    where.push(
      `(t.title LIKE ? OR t.description LIKE ? OR t.notes LIKE ?
        OR t.id IN (SELECT tt.task_id FROM task_tags tt JOIN tags g ON g.id = tt.tag_id
                    WHERE g.user_id = ? AND g.name LIKE ?))`,
    );
    params.push(like, like, like, userId, like);
  }
  if (filters.parentTaskId !== undefined) {
    if (filters.parentTaskId === null) where.push('t.parent_task_id IS NULL');
    else {
      where.push('t.parent_task_id = ?');
      params.push(filters.parentTaskId);
    }
  }

  const limit = Math.min(filters.limit ?? 300, 500);
  const offset = filters.offset ?? 0;

  const rows = all<TaskRow>(
    `SELECT t.* FROM tasks t
      WHERE ${where.join(' AND ')}
      ORDER BY
        CASE t.status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
        CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
        t.due_date ASC,
        CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        t.plan_order ASC,
        t.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset],
    db,
  );

  const tasks = hydrateTasks(rows, db);
  if (!filters.quadrant) return tasks;
  return tasks.filter((task) => quadrantOf({ important: task.important, urgent: task.urgent }) === filters.quadrant);
}

export interface MatrixCountsAndTasks {
  counts: Record<Quadrant, number>;
  tasks: Task[];
}

export function matrixTasks(userId: string, today: DayKey, db: Db = getDb()): MatrixCountsAndTasks {
  const tasks = listTasks(userId, { view: 'matrix', today, limit: 500 }, db);
  const counts: Record<Quadrant, number> = { do_now: 0, schedule: 0, delegate: 0, eliminate: 0 };
  for (const task of tasks) {
    const q = quadrantOf({ important: task.important, urgent: task.urgent });
    counts[q] += 1;
  }
  return { counts, tasks };
}

/* -------------------------------------------------------------------------- */
/*  Subtasks                                                                  */
/* -------------------------------------------------------------------------- */

export function insertSubtask(
  userId: string,
  taskId: string,
  title: string,
  position: number,
  db: Db = getDb(),
): SubtaskRow {
  const now = Date.now();
  const id = newId('sub');
  run(
    `INSERT INTO subtasks (id, task_id, user_id, title, status, position, created_at, updated_at, seq)
     VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, ?)`,
    [id, taskId, userId, title, position, now, now, nextSeq(userId, db)],
    db,
  );
  return one<SubtaskRow>('SELECT * FROM subtasks WHERE id = ?', [id], db)!;
}

export function patchSubtask(
  userId: string,
  subtaskId: string,
  patch: Partial<{ title: string; status: TaskStatus; position: number; completedAt: number | null }>,
  db: Db = getDb(),
): SubtaskRow | undefined {
  const columns: Record<string, string> = {
    title: 'title',
    status: 'status',
    position: 'position',
    completedAt: 'completed_at',
  };
  const entries = Object.entries(patch).filter(([k]) => k in columns);
  if (!entries.length) return undefined;
  const sets = entries.map(([k]) => `${columns[k]} = ?`);
  const params = entries.map(([, v]) => v);
  run(
    `UPDATE subtasks SET ${sets.join(', ')}, updated_at = ?, seq = ? WHERE id = ? AND user_id = ?`,
    [...params, Date.now(), nextSeq(userId, db), subtaskId, userId],
    db,
  );
  return one<SubtaskRow>('SELECT * FROM subtasks WHERE id = ?', [subtaskId], db);
}

export function deleteSubtask(userId: string, subtaskId: string, db: Db = getDb()): void {
  const now = Date.now();
  run('UPDATE subtasks SET deleted_at = ?, updated_at = ?, seq = ? WHERE id = ? AND user_id = ?', [
    now, now, nextSeq(userId, db), subtaskId, userId,
  ], db);
}

export function listSubtasksForTasks(taskIds: readonly string[], db: Db = getDb()): SubtaskRow[] {
  if (!taskIds.length) return [];
  const placeholders = taskIds.map(() => '?').join(', ');
  return all<SubtaskRow>(
    `SELECT * FROM subtasks WHERE task_id IN (${placeholders}) AND deleted_at IS NULL ORDER BY position`,
    [...taskIds],
    db,
  );
}

/* -------------------------------------------------------------------------- */
/*  Aggregates                                                                */
/* -------------------------------------------------------------------------- */

export function taskCountsByStatus(
  userId: string,
  today: DayKey,
  db: Db = getDb(),
): { open: number; today: number; overdue: number; completedToday: number; important: number; upcoming: number } {
  const row = one<{
    open: number; today_count: number; overdue: number; completed_today: number; important: number; upcoming: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status NOT IN ('done','archived')) AS open,
       (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status NOT IN ('done','archived')
          AND (due_date = ? OR plan_date = ?)) AS today_count,
       (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status NOT IN ('done','archived')
          AND due_date IS NOT NULL AND due_date < ?) AS overdue,
       (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status = 'done' AND plan_date = ?) AS completed_today,
       (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status NOT IN ('done','archived') AND important = 1) AS important,
       (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status NOT IN ('done','archived')
          AND due_date IS NOT NULL AND due_date > ? AND due_date <= date(?, '+7 day')) AS upcoming`,
    [userId, userId, today, today, userId, today, userId, today, userId, userId, today, today],
    db,
  );
  return {
    open: row?.open ?? 0,
    today: row?.today_count ?? 0,
    overdue: row?.overdue ?? 0,
    completedToday: row?.completed_today ?? 0,
    important: row?.important ?? 0,
    upcoming: row?.upcoming ?? 0,
  };
}

export interface TaskStats {
  created: number;
  completed: number;
  open: number;
  overdue: number;
  completionRate: number;
  averageCompletionHours: number | null;
  averageEstimateAccuracy: number | null;
}

export function taskStats(userId: string, fromMs: number, toMs: number, today: DayKey, db: Db = getDb()): TaskStats {
  const row = one<{ created: number; completed: number; open: number; overdue: number; avg_hours: number | null }>(
    `SELECT
       (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND created_at BETWEEN ? AND ?) AS created,
       (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status = 'done' AND completed_at BETWEEN ? AND ?) AS completed,
       (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status NOT IN ('done','archived')) AS open,
       (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status NOT IN ('done','archived')
          AND due_date IS NOT NULL AND due_date < ?) AS overdue,
       (SELECT AVG((completed_at - created_at) / 3600000.0) FROM tasks
          WHERE user_id = ? AND deleted_at IS NULL AND status = 'done' AND completed_at BETWEEN ? AND ?) AS avg_hours`,
    [userId, fromMs, toMs, userId, fromMs, toMs, userId, userId, today, userId, fromMs, toMs],
    db,
  );
  const created = row?.created ?? 0;
  const completed = row?.completed ?? 0;
  return {
    created,
    completed,
    open: row?.open ?? 0,
    overdue: row?.overdue ?? 0,
    completionRate: created ? Math.min(100, Math.round((completed / created) * 100)) : 0,
    averageCompletionHours: row?.avg_hours != null ? Math.round((row.avg_hours + Number.EPSILON) * 10) / 10 : null,
    averageEstimateAccuracy: null,
  };
}

export function projectRollups(userId: string, db: Db = getDb()): Map<string, { taskCount: number; completedTaskCount: number }> {
  const rows = all<{ project_id: string; total: number; done: number }>(
    `SELECT project_id,
            COUNT(*) AS total,
            COUNT(CASE WHEN status = 'done' THEN 1 END) AS done
       FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status != 'archived' AND project_id IS NOT NULL
       GROUP BY project_id`,
    [userId],
    db,
  );
  const map = new Map<string, { taskCount: number; completedTaskCount: number }>();
  for (const row of rows) {
    map.set(row.project_id, { taskCount: row.total, completedTaskCount: row.done });
  }
  return map;
}
