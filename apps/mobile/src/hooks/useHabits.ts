/** Habits: today's list, streaks, heat map and completion toggles. */
import { useCallback } from 'react';
import type { Habit } from '@jarvis/shared';
import { todayKey } from '@jarvis/shared';
import { api } from '../lib/api';
import { enqueueOperation, isOfflineError } from '../lib/offline';
import { invalidate, queryKeys, useQuery } from '../lib/query';
import { useAuth } from '../lib/auth';
import type { HabitsResponse, HabitHeatmapResponse } from '../lib/types';

export interface HabitDraft {
  name: string;
  description?: string | null;
  icon?: string;
  color?: string;
  frequency?: 'daily' | 'weekdays' | 'custom' | 'weekly';
  scheduleDays?: number[];
  targetPerPeriod?: number;
  reminderTime?: string | null;
}

export function useHabits(includeArchived = false) {
  const { user } = useAuth();
  const params = includeArchived ? '?includeArchived=true' : '';
  const query = useQuery<HabitsResponse>(queryKeys.habits, () => api.get<HabitsResponse>(`/api/habits${params}`), {
    staleTime: 20_000,
  });
  return {
    habits: query.data?.habits ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    today: todayKey(Date.now(), user?.timezoneOffsetMinutes ?? 0),
  };
}

export function useHabitHeatmap(habitId: string | null, days = 120) {
  return useQuery<HabitHeatmapResponse>(
    habitId ? `habit-heatmap:${habitId}:${days}` : null,
    () => api.get<HabitHeatmapResponse>(`/api/habits/heatmap?days=${days}&habitId=${habitId}`),
    { staleTime: 60_000 },
  );
}

export function useHabitMutations() {
  const { user } = useAuth();

  const toggle = useCallback(
    async (habit: Habit, dayKey: string, completed: boolean) => {
      try {
        await api.post(`/api/habits/${habit.id}/toggle`, { dayKey, completed });
      } catch (error) {
        if (!isOfflineError(error)) throw error;
        await enqueueOperation({
          label: `${completed ? 'Complete' : 'Undo'} ${habit.name}`,
          sync: { entity: 'habit_completion', op: 'create', entityId: habit.id, patch: { habitId: habit.id, dayKey, completed } },
          invalidate: ['habits', 'dashboard'],
        });
      }
      invalidate('habits', 'dashboard', 'analytics', 'heatmap');
    },
    [],
  );

  const create = useCallback(
    async (draft: HabitDraft) => {
      const payload = await api.post<{ habit: Habit }>('/api/habits', draft);
      invalidate('habits', 'dashboard');
      return payload.habit;
    },
    [],
  );

  const update = useCallback(async (habitId: string, patch: Partial<HabitDraft> & { archived?: boolean }) => {
    await api.patch<{ habit: Habit }>(`/api/habits/${habitId}`, patch);
    invalidate('habits', 'dashboard', 'task');
  }, []);

  const remove = useCallback(async (habitId: string) => {
    await api.delete(`/api/habits/${habitId}`);
    invalidate('habits', 'dashboard', 'heatmap');
  }, []);

  const today = todayKey(Date.now(), user?.timezoneOffsetMinutes ?? 0);
  return { toggle, create, update, remove, today };
}
