import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { focusSessionStartSchema, focusSessionUpdateSchema, toDayKey } from '@jarvis/shared';
import { requireUser } from '../http/auth-plugin.js';
import { AppError, parseOrThrow } from '../lib/errors.js';
import { incrementActivity } from '../repo/activity.js';
import {
  finishFocusSession,
  hydrateFocusSessions,
  focusStats,
  insertFocusSession,
  listFocusSessions,
  patchFocusSession,
  softDeleteFocusSession,
} from '../repo/focus.js';
import { patchTask, getTask } from '../repo/tasks.js';
import { userToday } from '../services/analytics.js';

const idParam = z.object({ id: z.string().min(6).max(64) });

export async function registerFocusRoutes(app: FastifyInstance): Promise<void> {
  /** Start a focus session. Sessions are recorded server-side so stats survive reinstalls. */
  app.post('/focus/sessions', async (request, reply) => {
    const user = requireUser(request);
    const input = parseOrThrow(focusSessionStartSchema, request.body);
    const startedAt = input.startedAt ?? Date.now();
    const dayKey = input.dayKey ?? toDayKey(startedAt, user.tz_offset_minutes);

    const session = insertFocusSession(user.id, {
      taskId: input.taskId ?? null,
      projectId: input.projectId ?? null,
      mode: input.mode ?? 'pomodoro',
      label: input.label ?? null,
      plannedMinutes: input.plannedMinutes,
      startedAt,
      dayKey,
      clientId: input.clientId ?? null,
    });

    return reply.status(201).send({ session, dayKey });
  });

  /** Finish (or sync) a session. Idempotent: replaying an offline finish is safe. */
  app.patch('/focus/sessions/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(focusSessionUpdateSchema, request.body);
    const existing = listFocusSessions(user.id, { limit: 500 }).find((s) => s.id === id);
    if (!existing) throw AppError.notFound('That focus session no longer exists');

    const endedAt = input.endedAt ?? Date.now();
    const updated = finishFocusSession(user.id, id, {
      actualSeconds: input.actualSeconds,
      completed: input.completed,
      interruptions: input.interruptions,
      endedAt,
    });
    if (!updated) throw AppError.notFound('That focus session no longer exists');

    const deltaMinutes = Math.round((updated.actual_seconds - existing.actualSeconds) / 60);
    if (deltaMinutes !== 0 && updated.completed === 1) {
      incrementActivity(user.id, updated.day_key as never, { focusMinutes: deltaMinutes });
    }

    // Focus time counts towards the task's actual time — the estimate/actual gap
    // is one of the most useful signals in the analytics screen.
    if (deltaMinutes > 0 && updated.task_id) {
      const task = getTask(updated.task_id, user.id);
      if (task) {
        patchTask(user.id, task.id, { actualMinutes: task.actualMinutes + deltaMinutes });
      }
    }

    const [session] = hydrateFocusSessions([updated]);
    return { session, dayKey: updated.day_key };
  });

  app.delete('/focus/sessions/:id', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const existing = listFocusSessions(user.id, { limit: 500 }).find((s) => s.id === id);
    if (existing && existing.completed && existing.actualSeconds > 0) {
      incrementActivity(user.id, existing.dayKey, { focusMinutes: -Math.round(existing.actualSeconds / 60) });
    }
    softDeleteFocusSession(user.id, id);
    return reply.send({ ok: true });
  });

  app.get('/focus/sessions', async (request) => {
    const user = requireUser(request);
    const query = parseOrThrow(
      z.object({
        from: z.string().optional(),
        to: z.string().optional(),
        taskId: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
      request.query,
    );
    return { sessions: listFocusSessions(user.id, query), today: userToday(user) };
  });

  app.get('/focus/stats', async (request) => {
    const user = requireUser(request);
    const stats = focusStats(user.id, userToday(user));
    return { stats, today: userToday(user) };
  });

  /** Preset timer configurations derived from the user's settings. */
  app.get('/focus/presets', async (request) => {
    return { presets: [] };
  });
}
