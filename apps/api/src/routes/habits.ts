import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { habitCreateSchema, habitToggleSchema, habitUpdateSchema } from '@jarvis/shared';
import { getDb } from '../db/index.js';
import { requireUser } from '../http/auth-plugin.js';
import { AppError, parseOrThrow } from '../lib/errors.js';
import { incrementActivity } from '../repo/activity.js';
import { getHabit, insertHabit, listHabits, patchHabit, softDeleteHabit, toggleCompletion } from '../repo/habits.js';
import { userToday } from '../services/analytics.js';

const idParam = z.object({ id: z.string().min(6).max(64) });

export async function registerHabitRoutes(app: FastifyInstance): Promise<void> {
  app.get('/habits', async (request) => {
    const user = requireUser(request);
    const query = parseOrThrow(
      z.object({ includeArchived: z.coerce.boolean().optional(), day: z.string().optional() }),
      request.query,
    );
    const today = query.day ?? userToday(user);
    const habits = listHabits(user.id, { includeArchived: query.includeArchived, today });
    return {
      habits,
      today,
      summary: {
        scheduled: habits.filter((h) => !h.archived).length,
        completed: habits.filter((h) => h.completedToday).length,
        bestStreak: habits.reduce((max, h) => Math.max(max, h.bestStreak), 0),
        averageRate: habits.length
          ? Math.round(habits.reduce((sum, h) => sum + h.completionRate, 0) / habits.length)
          : 0,
      },
    };
  });

  app.post('/habits', async (request, reply) => {
    const user = requireUser(request);
    const input = parseOrThrow(habitCreateSchema, request.body);
    const created = insertHabit(user.id, input);
    const habit = getHabit(created.id, user.id, userToday(user));
    return reply.status(201).send({ habit });
  });

  app.get('/habits/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const habit = getHabit(id, user.id, userToday(user));
    if (!habit) throw AppError.notFound('That habit no longer exists');
    return { habit };
  });

  app.patch('/habits/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(habitUpdateSchema, request.body);
    const updated = patchHabit(user.id, id, input);
    if (!updated) throw AppError.notFound('That habit no longer exists');
    return { habit: getHabit(id, user.id, userToday(user)) };
  });

  app.delete('/habits/:id', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    softDeleteHabit(user.id, id);
    return reply.send({ ok: true });
  });

  /**
   * Toggle a habit for a day. Idempotent so an offline replay cannot double count,
   * and the day rollup is updated in the same request.
   */
  app.post('/habits/:id/toggle', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(habitToggleSchema, request.body);
    const habit = getHabit(id, user.id, userToday(user));
    if (!habit) throw AppError.notFound('That habit no longer exists');

    toggleCompletion(user.id, id, input.dayKey, input.completed, input.note ?? null);
    incrementActivity(user.id, input.dayKey, { habitCompletions: input.completed ? 1 : -1 });

    return { habit: getHabit(id, user.id, userToday(user)) };
  });

  /** Habit heat map data (frequency-aware, so weekly habits are not penalised). */
  app.get('/habits/heatmap', async (request) => {
    const user = requireUser(request);
    const query = parseOrThrow(
      z.object({ days: z.coerce.number().int().min(7).max(365).default(120), habitId: z.string().optional() }),
      request.query,
    );
    const today = userToday(user);
    const from = new Date(Date.now() - query.days * 86_400_000).toISOString().slice(0, 10);

    const rows = getDb()
      .prepare(
        `SELECT day_key, COUNT(*) AS c FROM habit_completions
          WHERE user_id = ? AND deleted_at IS NULL AND day_key >= ?
            ${query.habitId ? 'AND habit_id = ?' : ''}
          GROUP BY day_key ORDER BY day_key`,
      )
      .all(...(query.habitId ? [user.id, from, query.habitId] : [user.id, from])) as Array<{ day_key: string; c: number }>;

    return {
      from,
      to: today,
      cells: rows.map((row) => ({ dayKey: row.day_key, value: row.c })),
      total: rows.reduce((sum, row) => sum + row.c, 0),
      activeDays: rows.length,
    };
  });
}
