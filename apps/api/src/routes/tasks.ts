import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  naturalLanguageTaskSchema,
  parseNaturalLanguageTask,
  quickPlanSchema,
  reorderTasksSchema,
  subtaskInputSchema,
  taskCreateSchema,
  taskQuerySchema,
  taskUpdateSchema,
} from '@jarvis/shared';
import { requireUser } from '../http/auth-plugin.js';
import { AppError, parseOrThrow } from '../lib/errors.js';
import { listFocusSessions } from '../repo/focus.js';
import { listNotes } from '../repo/notes.js';
import {
  deleteSubtask,
  getTask,
  insertSubtask,
  listTags,
  listTasks,
  matrixTasks,
  patchSubtask,
} from '../repo/tasks.js';
import { userToday } from '../services/analytics.js';
import { applyPlanUpdates, createTask, deleteTask, duplicate, setTaskDone, updateTask } from '../services/tasks.js';

const idParam = z.object({ id: z.string().min(6).max(64) });

export async function registerTaskRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tasks', async (request) => {
    const user = requireUser(request);
    const query = parseOrThrow(taskQuerySchema, request.query);
    const today = userToday(user);

    const tasks = listTasks(user.id, {
      view: query.view,
      today,
      projectId: query.projectId === undefined ? undefined : query.projectId === 'none' ? null : query.projectId,
      tag: query.tag,
      priority: query.priority,
      status: query.status,
      quadrant: query.quadrant,
      search: query.search,
      from: query.from,
      to: query.to,
      includeCompleted: query.includeCompleted,
      limit: query.limit,
    });

    return {
      tasks,
      today,
      counts: {
        total: tasks.length,
        open: tasks.filter((t) => t.status !== 'done' && t.status !== 'archived').length,
        done: tasks.filter((t) => t.status === 'done').length,
        overdue: tasks.filter((t) => t.status !== 'done' && t.dueDate !== null && t.dueDate < today).length,
      },
    };
  });

  /** The Eisenhower board: open tasks plus per-quadrant counts. */
  app.get('/tasks/matrix', async (request) => {
    const user = requireUser(request);
    const today = userToday(user);
    const { counts, tasks } = matrixTasks(user.id, today);
    return { counts, tasks, today };
  });

  app.get('/tasks/tags', async (request) => {
    const user = requireUser(request);
    return { tags: listTags(user.id) };
  });

  /** Natural-language capture — same pure parser the client runs offline. */
  app.post('/tasks/parse', async (request) => {
    requireUser(request);
    const input = parseOrThrow(naturalLanguageTaskSchema, request.body);
    const parsed = parseNaturalLanguageTask(input.input, {
      now: input.now ?? Date.now(),
      offsetMinutes: input.timezoneOffsetMinutes,
    });
    return { parsed };
  });

  app.post('/tasks/quick-plan', async (request) => {
    const user = requireUser(request);
    const input = parseOrThrow(quickPlanSchema, request.body);
    const updates = [
      ...input.mustDo.map((id, index) => ({ id, planDate: input.dayKey, isMustDo: true, planOrder: index })),
      ...input.niceToHave.map((id, index) => ({
        id,
        planDate: input.dayKey,
        isMustDo: false,
        planOrder: input.mustDo.length + index,
      })),
      ...input.order.map((id, index) => ({ id, planOrder: index })),
    ];
    const tasks = applyPlanUpdates(user, updates);
    return { tasks };
  });

  /** Bulk replan — matrix drag & drop, planner reordering, calendar rescheduling. */
  app.post('/tasks/bulk', async (request) => {
    const user = requireUser(request);
    const input = parseOrThrow(reorderTasksSchema, request.body);
    const tasks = applyPlanUpdates(user, input.updates);
    return { tasks, updated: tasks.length };
  });

  app.post('/tasks', async (request, reply) => {
    const user = requireUser(request);
    const input = parseOrThrow(taskCreateSchema, request.body, 'Check the task details');
    const task = createTask(user, input);
    return reply.status(201).send({ task });
  });

  app.get('/tasks/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const task = getTask(id, user.id);
    if (!task) throw AppError.notFound('That task no longer exists');
    return { task };
  });

  app.patch('/tasks/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const patch = parseOrThrow(taskUpdateSchema, request.body, 'Check the task details');
    const task = updateTask(user, id, patch);
    if (!task) throw AppError.notFound('That task no longer exists');
    return { task };
  });

  app.delete('/tasks/:id', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const ok = deleteTask(user, id);
    if (!ok) throw AppError.notFound('That task no longer exists');
    return reply.send({ ok: true });
  });

  app.post('/tasks/:id/complete', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(z.object({ completed: z.boolean() }), request.body);
    const result = setTaskDone(user, id, body.completed);
    if (!result) throw AppError.notFound('That task no longer exists');
    return { task: result.task, spawned: result.spawned };
  });

  app.post('/tasks/:id/duplicate', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(
      z.object({
        dueDate: z.string().nullish(),
        planDate: z.string().nullish(),
        title: z.string().max(200).optional(),
      }),
      request.body ?? {},
    );
    const task = duplicate(user, id, {
      dueDate: (body.dueDate ?? undefined) as never,
      planDate: (body.planDate ?? undefined) as never,
      ...(body.title ? { title: body.title } : {}),
    });
    if (!task) throw AppError.notFound('That task no longer exists');
    return reply.status(201).send({ task });
  });

  app.post('/tasks/:id/archive', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(z.object({ archived: z.boolean().default(true) }), request.body ?? {});
    const task = updateTask(user, id, { status: body.archived ? 'archived' : 'todo' });
    if (!task) throw AppError.notFound('That task no longer exists');
    return { task };
  });

  /** Everything the task detail sheet needs, in one round trip. */
  app.get('/tasks/:id/context', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const task = getTask(id, user.id);
    if (!task) throw AppError.notFound('That task no longer exists');
    const sessions = listFocusSessions(user.id, { taskId: id, limit: 25 });
    return {
      task,
      focusSessions: sessions,
      focusMinutesTotal: sessions.reduce((sum, s) => sum + Math.round(s.actualSeconds / 60), 0),
      notes: listNotes(user.id, { taskId: id, limit: 50 }),
    };
  });

  /* ------------------------------- subtasks ------------------------------ */

  app.post('/tasks/:id/subtasks', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(subtaskInputSchema, request.body);
    const task = getTask(id, user.id);
    if (!task) throw AppError.notFound('That task no longer exists');
    const subtask = insertSubtask(user.id, id, input.title, input.position ?? task.subtasks.length);
    return reply.status(201).send({ subtask });
  });

  app.patch('/subtasks/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(subtaskInputSchema.partial(), request.body);
    const subtask = patchSubtask(user.id, id, {
      title: input.title,
      status: input.status,
      position: input.position,
      completedAt: input.status ? (input.status === 'done' ? Date.now() : null) : undefined,
    });
    if (!subtask) throw AppError.notFound('That subtask no longer exists');
    return { subtask };
  });

  app.delete('/subtasks/:id', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    deleteSubtask(user.id, id);
    return reply.send({ ok: true });
  });
}
