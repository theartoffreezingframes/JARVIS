/** Home dashboard, daily planning and the daily review. */
import { useCallback } from 'react';
import { todayKey, addDays } from '@jarvis/shared';
import { api } from '../lib/api';
import { invalidate, queryKeys, useQuery } from '../lib/query';
import { useAuth } from '../lib/auth';
import type {
  AnalyticsResponse,
  HeatmapResponse,
  CalendarResponse,
  DashboardResponse,
  PlannerResponse,
  ReviewDayResponse,
  ReviewPromptResponse,
} from '../lib/types';

export function useDashboard() {
  const { user } = useAuth();
  const query = useQuery<DashboardResponse>(queryKeys.dashboard, () => api.get<DashboardResponse>('/api/dashboard'), {
    staleTime: 20_000,
  });
  const today = query.data?.today ?? todayKey(Date.now(), user?.timezoneOffsetMinutes ?? 0);
  return {
    dashboard: query.data,
    today,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}

export function usePlanner(day?: string) {
  const { user } = useAuth();
  const today = todayKey(Date.now(), user?.timezoneOffsetMinutes ?? 0);
  const target = day ?? today;
  const query = useQuery<PlannerResponse>(queryKeys.planner(target), () =>
    api.get<PlannerResponse>(`/api/planner?day=${target}`),
  );

  const plan = query.data;

  const save = useCallback(
    async (updates: Array<{ id: string; planOrder?: number; planDate?: string | null; isMustDo?: boolean }>) => {
      await api.post('/api/tasks/bulk', { updates });
      invalidate('planner', 'dashboard', 'tasks');
    },
    [],
  );

  const quickPlan = useCallback(
    async (input: { dayKey: string; mustDo: string[]; niceToHave: string[]; order?: string[] }) => {
      await api.post('/api/tasks/quick-plan', { order: [], ...input });
      invalidate('planner', 'dashboard', 'tasks');
    },
    [],
  );

  /** Writes one or more time blocks for a day; the server owns plan order. */
  const scheduleBlocks = useCallback(
    async (
      dayKey: string,
      blocks: Array<{ taskId: string; startMinutes: number; durationMinutes: number }>,
    ) => {
      await api.post('/api/planner/blocks', { day: dayKey, blocks });
      invalidate('planner', 'calendar', 'tasks', 'dashboard');
    },
    [],
  );

  const scheduleBlock = useCallback(
    async (input: { taskId: string; dayKey: string; startMinutes: number; minutes: number }) =>
      scheduleBlocks(input.dayKey, [
        { taskId: input.taskId, startMinutes: input.startMinutes, durationMinutes: input.minutes },
      ]),
    [scheduleBlocks],
  );

  /** Takes a task out of the plan without touching its due date. */
  const unschedule = useCallback(async (taskId: string) => {
    await api.patch(`/api/tasks/${taskId}`, { planDate: null, scheduledStart: null, scheduledEnd: null });
    invalidate('planner', 'calendar', 'tasks', 'dashboard');
  }, []);

  return {
    planner: plan,
    today,
    target,
    isLoading: query.isLoading,
    refetch: query.refetch,
    save,
    quickPlan,
    scheduleBlock,
    scheduleBlocks,
    unschedule,
  };
}

export function useCalendar(from: string, to: string, view: 'month' | 'week' | 'day' = 'month') {
  const key = `${queryKeys.calendar(from)}:${to}:${view}`;
  const query = useQuery<CalendarResponse>(key, () => api.get<CalendarResponse>(`/api/calendar?from=${from}&to=${to}&view=${view}`), {
    staleTime: 60_000,
  });
  return { calendar: query.data, isLoading: query.isLoading, refetch: query.refetch };
}

/** Moves a task to another day by rewriting its due date (the calendar's drag action). */
export function useReschedule() {
  return useCallback(async (taskId: string, dayKey: string) => {
    await api.patch(`/api/tasks/${taskId}`, { dueDate: dayKey });
    invalidate('calendar', 'tasks', 'dashboard', 'analytics', 'planner');
  }, []);
}

export function useAnalytics(range: 'week' | 'month' | 'quarter' | 'year') {
  const query = useQuery<AnalyticsResponse>(queryKeys.analytics(range), () =>
    api.get<AnalyticsResponse>(`/api/analytics/overview?range=${range}`),
  );
  return { analytics: query.data, isLoading: query.isLoading, refetch: query.refetch };
}

export function useHeatmap(
  metric: 'tasks_completed' | 'tasks_created' | 'focus' | 'habits' | 'productivity',
  range: 'week' | 'month' | 'year',
) {
  const query = useQuery(
    queryKeys.heatmap(metric, range),
    () => api.get<HeatmapResponse>(`/api/analytics/heatmap?metric=${metric}&range=${range}`),
    { staleTime: 60_000 },
  );
  return { heatmap: query.data, isLoading: query.isLoading, refetch: query.refetch };
}

export function useDailyReview(day?: string) {
  const { user } = useAuth();
  const today = todayKey(Date.now(), user?.timezoneOffsetMinutes ?? 0);
  const target = day ?? today;

  const prompt = useQuery<ReviewPromptResponse>('reviews/today/prompt', () =>
    api.get<ReviewPromptResponse>('/api/reviews/today/prompt'),
  );
  const dayQuery = useQuery<ReviewDayResponse>(queryKeys.review(target), () =>
    api.get<ReviewDayResponse>(`/api/reviews/${target}`),
  );

  const save = useCallback(
    async (input: {
      dayKey: string;
      reflection?: string | null;
      mood?: number | null;
      energy?: number | null;
      tomorrowTopTaskId?: string | null;
      rolloverTaskIds?: string[];
      rolloverTo?: string;
    }) => {
      const result = await api.post<{ review: unknown; rolledOver: unknown[] }>('/api/reviews', input);
      invalidate('reviews', 'dashboard', 'tasks', 'planner', 'analytics');
      return result;
    },
    [],
  );

  const history = useQuery<{ reviews: ReviewDayResponse[]; today: string }>('reviews/history', () =>
    api.get<{ reviews: ReviewDayResponse[]; today: string }>('/api/reviews?limit=14'),
  );

  return {
    prompt: prompt.data,
    day: dayQuery.data,
    today,
    target,
    history: history.data?.reviews ?? [],
    tomorrow: addDays(target, 1),
    isLoading: dayQuery.isLoading,
    refetch: dayQuery.refetch,
    save,
  };
}
