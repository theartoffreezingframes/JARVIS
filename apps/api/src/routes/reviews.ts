import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dailyReviewUpsertSchema, dayKeySchema, percent } from '@jarvis/shared';
import { requireUser } from '../http/auth-plugin.js';
import { getDb, one, run } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { AppError, parseOrThrow } from '../lib/errors.js';
import { incrementActivity, recomputeActivityDay } from '../repo/activity.js';
import { nextSeq } from '../repo/users.js';
import { dailyReviewPayload, userToday } from '../services/analytics.js';
import { rolloverTasks } from '../services/tasks.js';

export async function registerReviewRoutes(app: FastifyInstance): Promise<void> {
  /** Everything the end-of-day review shows, plus the saved reflection if any. */
  app.get('/reviews/:day', async (request) => {
    const user = requireUser(request);
    const { day } = parseOrThrow(z.object({ day: dayKeySchema }), request.params);
    const payload = dailyReviewPayload(user, day);
    const tomorrow = dailyReviewPayload(user, shift(day, 1));
    return {
      ...payload,
      tomorrow: {
        planned: tomorrow.tasks.planned.map((task) => ({ id: task.id, title: task.title, priority: task.priority })),
        suggestions: payload.tasks.incomplete.slice(0, 12).map((task) => ({
          id: task.id,
          title: task.title,
          priority: task.priority,
          dueDate: task.dueDate,
          estimatedMinutes: task.estimatedMinutes,
        })),
      },
      summary: {
        completionPercent: percent(payload.activity.plannedCompletedCount, Math.max(payload.activity.plannedTaskCount, payload.activity.plannedCompletedCount)),
        focusMinutes: payload.focusMinutes,
        habitsCompleted: payload.habitSummary.completedToday,
        habitsScheduled: payload.habitSummary.scheduledToday,
        overdueCount: payload.tasks.overdue.length,
        remainingCount: payload.tasks.incomplete.length,
      },
    };
  });

  /**
   * Save a review. Optionally rolls unfinished tasks into tomorrow and records
   * the chosen "top task" — the loop closes here, which is why this route exists
   * rather than letting the client write reflections into a generic blob.
   */
  app.post('/reviews', async (request) => {
    const user = requireUser(request);
    const input = parseOrThrow(dailyReviewUpsertSchema, request.body);
    const payload = dailyReviewPayload(user, input.dayKey);

    const now = Date.now();
    const existing = one<{ id: string }>(
      'SELECT id FROM daily_reviews WHERE user_id = ? AND day_key = ?',
      [user.id, input.dayKey],
    );

    const values = [
      input.reflection ?? payload.review?.reflection ?? null,
      input.mood ?? payload.review?.mood ?? null,
      input.energy ?? payload.review?.energy ?? null,
      payload.activity.tasksCompleted,
      Math.max(payload.activity.plannedTaskCount, payload.tasks.planned.length),
      payload.focusMinutes,
      payload.habitSummary.completedToday,
      payload.tasks.overdue.length,
      input.tomorrowTopTaskId ?? payload.review?.tomorrowTopTaskId ?? null,
    ];

    if (existing) {
      run(
        `UPDATE daily_reviews SET reflection = ?, mood = ?, energy = ?, tasks_completed = ?, tasks_planned = ?,
            focus_minutes = ?, habits_completed = ?, overdue_carry_over = ?, tomorrow_top_task_id = ?,
            updated_at = ?, seq = ?
          WHERE id = ?`,
        [...values, now, nextSeq(user.id), existing.id],
      );
    } else {
      run(
        `INSERT INTO daily_reviews (id, user_id, day_key, reflection, mood, energy, tasks_completed, tasks_planned,
            focus_minutes, habits_completed, overdue_carry_over, tomorrow_top_task_id, created_at, updated_at, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId('rev'), user.id, input.dayKey, ...values, now, now, nextSeq(user.id)],
      );
    }

    let rolledOver: Awaited<ReturnType<typeof rolloverTasks>> = [];
    if (input.rolloverTaskIds?.length) {
      const target = input.rolloverTo ?? shift(input.dayKey, 1);
      rolledOver = rolloverTasks(user, input.rolloverTaskIds, target);
    }

    // The rollup includes "reviewed", which feeds the productivity score.
    incrementActivity(user.id, input.dayKey, { reviewed: payload.activity.reviewed ? 0 : 1 });
    recomputeActivityDay(user.id, input.dayKey, user.tz_offset_minutes);
    run('UPDATE activity_days SET reviewed = 1 WHERE user_id = ? AND day_key = ?', [user.id, input.dayKey]);

    return {
      review: dailyReviewPayload(user, input.dayKey).review,
      rolledOver,
      savedAt: now,
    };
  });

  /** History of reviews for the "look back" view. */
  app.get('/reviews', async (request) => {
    const user = requireUser(request);
    const query = parseOrThrow(
      z.object({ from: dayKeySchema.optional(), to: dayKeySchema.optional(), limit: z.coerce.number().int().min(1).max(120).default(30) }),
      request.query,
    );
    const where = ['user_id = ?'];
    const params: unknown[] = [user.id];
    if (query.from) {
      where.push('day_key >= ?');
      params.push(query.from);
    }
    if (query.to) {
      where.push('day_key <= ?');
      params.push(query.to);
    }
    const rows = getDb()
      .prepare(`SELECT * FROM daily_reviews WHERE ${where.join(' AND ')} ORDER BY day_key DESC LIMIT ?`)
      .all(...params, query.limit) as Array<Record<string, unknown>>;
    return {
      reviews: rows.map((row) => ({
        id: row.id,
        dayKey: row.day_key,
        reflection: row.reflection,
        mood: row.mood,
        energy: row.energy,
        tasksCompleted: row.tasks_completed,
        tasksPlanned: row.tasks_planned,
        focusMinutes: row.focus_minutes,
        habitsCompleted: row.habits_completed,
        overdueCarryOver: row.overdue_carry_over,
        updatedAt: row.updated_at,
      })),
      today: userToday(user),
    };
  });

  app.get('/reviews/today/prompt', async (request) => {
    const user = requireUser(request);
    const today = userToday(user);
    const payload = dailyReviewPayload(user, today);
    return { shouldPrompt: !payload.review, summary: payload };
  });

  app.delete('/reviews/:day', async (request, reply) => {
    const user = requireUser(request);
    const { day } = parseOrThrow(z.object({ day: dayKeySchema }), request.params);
    const existing = one<{ id: string }>('SELECT id FROM daily_reviews WHERE user_id = ? AND day_key = ?', [user.id, day]);
    if (!existing) throw AppError.notFound('No review saved for that day');
    run('DELETE FROM daily_reviews WHERE id = ?', [existing.id]);
    run('UPDATE activity_days SET reviewed = 0 WHERE user_id = ? AND day_key = ?', [user.id, day]);
    return reply.send({ ok: true });
  });
}

function shift(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}
