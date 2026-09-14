import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  addDays,
  dayKeySchema,
  startOfWeekKey,
  yearOfDay,
  type DayKey,
  type HeatmapMetric,
} from '@jarvis/shared';
import { requireUser, userSettings } from '../http/auth-plugin.js';
import { parseOrThrow } from '../lib/errors.js';
import { getActivityDays } from '../repo/activity.js';
import { analyticsOverview, dashboardSummary, heatmap, userToday } from '../services/analytics.js';

const heatmapQuery = z.object({
  metric: z.enum(['tasks_completed', 'tasks_created', 'focus', 'habits', 'productivity']).default('tasks_completed'),
  range: z.enum(['week', 'month', 'year']).default('month'),
  anchor: dayKeySchema.optional(),
});

const analyticsQuery = z.object({
  range: z.enum(['week', 'month', 'quarter', 'year', 'custom']).default('week'),
  from: dayKeySchema.optional(),
  to: dayKeySchema.optional(),
});

export function resolveAnalyticsRange(
  range: 'week' | 'month' | 'quarter' | 'year' | 'custom',
  today: DayKey,
  from?: DayKey,
  to?: DayKey,
): { from: DayKey; to: DayKey; label: string } {
  const end = to ?? today;
  switch (range) {
    case 'week': {
      const start = startOfWeekKey(end, 1);
      return { from: from ?? start, to: end, label: 'This week' };
    }
    case 'month': {
      const start = addDays(end, -29);
      return { from: from ?? start, to: end, label: 'Last 30 days' };
    }
    case 'quarter': {
      const start = addDays(end, -89);
      return { from: from ?? start, to: end, label: 'Last 90 days' };
    }
    case 'year': {
      const start = `${yearOfDay(end)}-01-01`;
      return { from: from ?? start, to: end, label: 'This year' };
    }
    case 'custom':
    default:
      return { from: from ?? addDays(end, -29), to: end, label: 'Selected range' };
  }
}

export async function registerAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  /** Dashboard payload: everything the home screen renders, in one request. */
  app.get('/dashboard', async (request) => {
    const user = requireUser(request, true);
    const settings = userSettings(request, user);
    return dashboardSummary(
      user,
      {
        dayStartTime: settings.dayStartTime,
        dayEndTime: settings.dayEndTime,
        defaultTaskDurationMinutes: settings.defaultTaskDurationMinutes,
        pomodoroFocusMinutes: settings.pomodoroFocusMinutes,
      },
      Date.now(),
    );
  });

  app.get('/analytics/overview', async (request) => {
    const user = requireUser(request);
    const query = parseOrThrow(analyticsQuery, request.query);
    const today = userToday(user);
    const range = resolveAnalyticsRange(query.range, today, query.from, query.to);
    return analyticsOverview(user, range);
  });

  app.get('/analytics/heatmap', async (request) => {
    const user = requireUser(request);
    const query = parseOrThrow(heatmapQuery, request.query);
    return heatmap(user, {
      metric: query.metric as HeatmapMetric,
      range: query.range,
      anchor: query.anchor,
    });
  });

  app.get('/analytics/activity', async (request) => {
    const user = requireUser(request);
    const query = parseOrThrow(
      z.object({ from: dayKeySchema, to: dayKeySchema }),
      request.query,
    );
    const rows = getActivityDays(user.id, query.from, query.to);
    return {
      days: rows.map((row) => ({
        dayKey: row.day_key,
        tasksCompleted: row.tasks_completed,
        tasksCreated: row.tasks_created,
        focusMinutes: row.focus_minutes,
        habitsCompleted: row.habit_completions,
        plannedCount: row.planned_count,
        plannedCompleted: row.planned_completed,
        importantNotUrgentDone: row.important_not_urgent_done,
        overdueCount: row.overdue_count,
        reviewed: row.reviewed === 1,
      })),
    };
  });
}
