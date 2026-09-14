/**
 * Focus sessions.
 *
 * The timer is deliberately local (a phone in flight mode must still run a
 * pomodoro) — the server is only told when a block starts and when it ends, and
 * a session finished offline is queued for the next connection.
 */
import { useCallback } from 'react';
import type { FocusSession, FocusStats } from '@jarvis/shared';
import { api } from '../lib/api';
import { enqueueOperation, isOfflineError } from '../lib/offline';
import { invalidate, queryKeys, useQuery } from '../lib/query';
import type { FocusPresetsResponse, FocusSessionsResponse } from '../lib/types';

export function useFocusStats() {
  const query = useQuery<{ stats: FocusStats; today: string }>(queryKeys.focusStats, () =>
    api.get<{ stats: FocusStats; today: string }>('/api/focus/stats'),
  );
  return {
    stats: query.data?.stats,
    today: query.data?.today,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useFocusSessions(params: { from?: string; to?: string; limit?: number } = {}) {
  const search = new URLSearchParams();
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  search.set('limit', String(params.limit ?? 50));
  const suffix = search.toString();
  const query = useQuery<FocusSessionsResponse>(queryKeys.focusSessions(suffix), () =>
    api.get<FocusSessionsResponse>(`/api/focus/sessions?${suffix}`),
  );
  return { sessions: query.data?.sessions ?? [], isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

/**
 * Offline fallback presets.
 *
 * The API returns presets built from the account's own settings, but the timer
 * must stay usable with no connection, so these well-known shapes are used until
 * the request resolves (and if it never does).
 */
const OFFLINE_PRESETS: FocusPresetsResponse['presets'] = [
  { id: 'classic', label: 'Classic 25 / 5', mode: 'pomodoro', focusMinutes: 25, breakMinutes: 5, rounds: 4 },
  { id: 'deep', label: 'Deep 50 / 10', mode: 'pomodoro', focusMinutes: 50, breakMinutes: 10, rounds: 3 },
  { id: 'sprint', label: 'Sprint 15 / 3', mode: 'pomodoro', focusMinutes: 15, breakMinutes: 3, rounds: 5 },
];

export function useFocusPresets() {
  const query = useQuery<FocusPresetsResponse>(queryKeys.focusPresets, () =>
    api.get<FocusPresetsResponse>('/api/focus/presets'),
  );
  return {
    presets: query.data?.presets?.length ? query.data.presets : OFFLINE_PRESETS,
    // Presets fall back to the built-in shapes above, so a failure here is worth
    // reporting but never blocks the timer.
    error: query.error,
    refetch: query.refetch,
  };
}

export function useFocusMutations() {
  const start = useCallback(async (input: FocusSessionInput) => {
    try {
      const payload = await api.post<{ session: FocusSession }>('/api/focus/sessions', input);
      return { session: payload.session, queued: false };
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      await enqueueOperation({
        label: 'Save focus session',
        sync: {
          entity: 'focus_session',
          op: 'create',
          entityId: `fcs_local_${Date.now().toString(36)}`,
          patch: { ...input },
        },
        invalidate: ['focus', 'dashboard', 'analytics'],
      });
      return { session: null, queued: true };
    }
  }, []);

  const finish = useCallback(
    async (sessionId: string, input: { actualSeconds: number; completed: boolean; interruptions?: number; taskId?: string | null }) => {
      try {
        await api.patch(`/api/focus/sessions/${sessionId}`, { interruptions: 0, ...input });
      } catch (error) {
        if (!isOfflineError(error)) throw error;
        await enqueueOperation({
          label: 'Record focus time',
          sync: { entity: 'focus_session', op: 'update', entityId: sessionId, patch: { ...input } },
          invalidate: ['focus', 'dashboard', 'analytics'],
        });
      }
      invalidate('focus', 'dashboard', 'analytics', 'heatmap');
    },
    [],
  );

  const discard = useCallback(async (sessionId: string) => {
    try {
      await api.delete(`/api/focus/sessions/${sessionId}`);
    } catch {
      /* nothing worth telling the user about */
    }
    invalidate('focus', 'dashboard', 'analytics');
  }, []);

  return { start, finish, discard };
}

export interface FocusSessionInput {
  taskId?: string | null;
  projectId?: string | null;
  mode: 'pomodoro' | 'custom' | 'deep_work' | 'short_break' | 'long_break';
  label?: string | null;
  plannedMinutes: number;
  startedAt?: number;
  dayKey?: string;
  clientId?: string;
}
