import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  addDays,
  buildDayPlan,
  dayKeySchema,
  endOfWeekKey,
  formatMonthKey,
  habitScheduledOn,
  minutesSinceMidnight,
  monthGridKeys,
  startOfWeekKey,
  type DayKey,
  type Task,
} from '@jarvis/shared';
import { getDb } from '../db/index.js';
import { requireUser, userSettings } from '../http/auth-plugin.js';
import { AppError, parseOrThrow } from '../lib/errors.js';
import { listFocusSessions } from '../repo/focus.js';
import { hydrateSessions, listSessionsForUser } from '../repo/gang.js';
import { listHabits } from '../repo/habits.js';
import { listTasks } from '../repo/tasks.js';
import { userToday } from '../services/analytics.js';
import { applyPlanUpdates } from '../services/tasks.js';

const rangeQuery = z.object({
  from: dayKeySchema,
  to: dayKeySchema,
  view: z.enum(['month', 'week', 'day']).default('month'),
});

function toPlannerInput(task: Task) {
  return {
    id: task.id,
    title: task.title,
    estimatedMinutes: task.estimatedMinutes,
    isMustDo: task.isMustDo,
    planOrder: task.planOrder,
    priority: task.priority,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
  };
}

function eachDay(from: DayKey, to: DayKey): DayKey[] {
  const out: DayKey[] = [];
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 400) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return out;
}

export async function registerPlannerRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------- calendar ------------------------------ */

  /**
   * One call returns everything the calendar needs for a visible range: dated
   * tasks, scheduled blocks, habit schedule, focus sessions and gang sessions.
   */
  app.get('/calendar', async (request) => {
    const user = requireUser(request, true);
    const settings = userSettings(request, user);
    const query = parseOrThrow(rangeQuery, request.query);
    const today = userToday(user);
    const from = query.from;
    const to = query.to < from ? from : query.to;

    const tasks = listTasks(user.id, { view: 'all', today, from, to, limit: 500 });
    const undated = query.view === 'month' ? [] : listTasks(user.id, { view: 'inbox', today, limit: 100 });
    const scheduled = listTasks(user.id, { view: 'all', today, limit: 500 }).filter(
      (task) => task.scheduledStart !== null && task.status !== 'archived',
    );
    const habits = listHabits(user.id, { today });
    const sessions = listFocusSessions(user.id, { from, to, limit: 500 });
    const gangSessions = hydrateSessions(listSessionsForUser(user.id, 20), getDb()).filter((session) => {
      const day = new Date(session.startsAt + user.tz_offset_minutes * 60_000).toISOString().slice(0, 10);
      return day >= from && day <= to;
    });

    return {
      from,
      to,
      view: query.view,
      today,
      settings: {
        weekStartsOn: settings.weekStartsOn,
        use24Hour: settings.use24Hour,
        dayStartTime: settings.dayStartTime,
        dayEndTime: settings.dayEndTime,
      },
      tasks,
      undated,
      scheduled,
      habits,
      habitDays: habits.map((habit) => ({
        habitId: habit.id,
        name: habit.name,
        color: habit.color,
        icon: habit.icon,
        completedToday: habit.completedToday,
        reminderTime: habit.reminderTime,
        days: eachDay(from, to).filter((day) => habitScheduledOn(habit, day)),
      })),
      focusSessions: sessions.map((session) => ({
        id: session.id,
        taskId: session.taskId,
        label: session.label ?? session.taskTitle ?? 'Focus session',
        startedAt: session.startedAt,
        minutes: Math.round(session.actualSeconds / 60),
        mode: session.mode,
        dayKey: session.dayKey,
      })),
      gangSessions,
      monthGrid: monthGridKeys(from, settings.weekStartsOn),
      monthLabel: formatMonthKey(from.slice(0, 7)),
      weekStart: startOfWeekKey(from, settings.weekStartsOn),
      weekEnd: endOfWeekKey(from, settings.weekStartsOn),
    };
  });

  /* ------------------------------- planner ------------------------------- */

  /** The daily plan: ordered blocks, capacity maths and honest warnings. */
  app.get('/planner', async (request) => {
    const user = requireUser(request, true);
    const settings = userSettings(request, user);
    const query = parseOrThrow(z.object({ day: dayKeySchema.optional() }), request.query);
    const today = userToday(user);
    const day = query.day ?? today;

    const plannedTasks = listTasks(user.id, { view: 'all', today, planDate: day, limit: 200 });
    const candidates = listTasks(user.id, { view: 'today', today, limit: 200 }).filter(
      (task) => task.status !== 'done' && task.status !== 'archived' && task.planDate !== day,
    );

    // Only work still open consumes the day; finished blocks stay in the list
    // below for context but must not push the plan over capacity.
    const openPlanned = plannedTasks.filter((task) => task.status !== 'done' && task.status !== 'archived');
    const nowMinutes = day === today ? minutesSinceMidnight(Date.now(), user.tz_offset_minutes) : 0;
    const plan = buildDayPlan({
      dayKey: day,
      tasks: openPlanned.map(toPlannerInput),
      nowMinutes,
      dayStartTime: settings.dayStartTime,
      dayEndTime: settings.dayEndTime,
    });

    return {
      day,
      today,
      plan,
      plannedTasks,
      candidates,
      capacity: {
        windowMinutes: plan.windowEndMinutes - plan.windowStartMinutes,
        capacityMinutes: plan.capacityMinutes,
        plannedMinutes: plan.plannedMinutes,
        remainingMinutes: plan.remainingMinutes,
        utilization: plan.utilization,
        overCapacityBy: Math.max(0, plan.plannedMinutes - plan.capacityMinutes),
      },
      warnings: plan.warnings,
      settings: { dayStartTime: settings.dayStartTime, dayEndTime: settings.dayEndTime },
    };
  });

  /** Explicit time-blocking: assign absolute start/end instants to tasks. */
  app.post('/planner/blocks', async (request) => {
    const user = requireUser(request);
    const input = parseOrThrow(
      z.object({
        day: dayKeySchema,
        blocks: z
          .array(
            z.object({
              taskId: z.string().min(6),
              startMinutes: z.number().int().min(0).max(1439),
              durationMinutes: z.number().int().min(5).max(600),
            }),
          )
          .max(60),
      }),
      request.body,
    );
    const offsetMs = user.tz_offset_minutes * 60_000;
    const dayStartMs = Date.parse(`${input.day}T00:00:00Z`) - offsetMs;

    const updates = input.blocks.map((block, index) => ({
      id: block.taskId,
      planDate: input.day,
      planOrder: index,
      scheduledStart: dayStartMs + block.startMinutes * 60_000,
      scheduledEnd: dayStartMs + (block.startMinutes + block.durationMinutes) * 60_000,
    }));

    const tasks = applyPlanUpdates(user, updates);
    return { tasks, updated: tasks.length };
  });

  /** Remove a task from a given day's plan. */
  app.delete('/planner/:day/:taskId', async (request, reply) => {
    const user = requireUser(request);
    const params = parseOrThrow(z.object({ day: dayKeySchema, taskId: z.string().min(6) }), request.params);
    const tasks = applyPlanUpdates(user, [{ id: params.taskId, planDate: null, isMustDo: false }]);
    if (!tasks.length) throw AppError.notFound('That task is no longer in this plan');
    return reply.send({ ok: true });
  });
}
