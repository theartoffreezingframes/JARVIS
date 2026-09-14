/**
 * Task reads and writes.
 *
 * Every mutation updates the cache optimistically and, when the device is
 * offline, is queued to be replayed through the idempotent sync endpoint.
 */
import { useCallback } from 'react';
import type { ParsedTaskDraft, Task } from '@jarvis/shared';
import { parseNaturalLanguageTask, quadrantOf, todayKey } from '@jarvis/shared';
import { api, ApiError } from '../lib/api';
import { enqueueOperation, isOfflineError } from '../lib/offline';
import { invalidate, queryKeys, setCached, useQuery } from '../lib/query';
import { useAuth } from '../lib/auth';
import type { MatrixResponse, TasksResponse } from '../lib/types';

export type TaskView = 'today' | 'upcoming' | 'overdue' | 'all' | 'inbox' | 'completed' | 'archived';

export interface TaskFilters {
  view?: TaskView;
  projectId?: string | null;
  search?: string;
  priority?: string;
  tag?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
}

function filterParams(filters: TaskFilters): string {
  const params = new URLSearchParams();
  params.set('view', filters.view ?? 'today');
  if (filters.projectId !== undefined) params.set('projectId', filters.projectId ?? 'none');
  if (filters.search) params.set('search', filters.search);
  if (filters.priority) params.set('priority', filters.priority);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.status) params.set('status', filters.status);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.limit) params.set('limit', String(filters.limit));
  return params.toString();
}

function localId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function clientTimestamp(): number {
  return Date.now();
}

/** Task changes touch almost every screen, so refresh them together. */
function invalidateTaskViews(): void {
  invalidate('tasks', 'dashboard', 'analytics', 'planner', 'calendar', 'projects', 'habit', 'search', 'gang');
}

function todayFor(user: { timezoneOffsetMinutes: number } | null): string {
  return todayKey(Date.now(), user?.timezoneOffsetMinutes ?? 0);
}

export function useTasks(filters: TaskFilters = {}) {
  const { user } = useAuth();
  const params = filterParams(filters);
  const key = queryKeys.tasks(params);

  const query = useQuery<TasksResponse>(key, () => api.get<TasksResponse>(`/api/tasks?${params}`), {
    staleTime: 15_000,
  });

  return {
    tasks: query.data?.tasks ?? [],
    counts: query.data?.counts,
    today: query.data?.today ?? todayFor(user),
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useTask(taskId: string | null) {
  return useQuery<Task>(
    taskId ? queryKeys.task(taskId) : null,
    async () => (await api.get<{ task: Task }>(`/api/tasks/${taskId}`)).task,
    { staleTime: 10_000 },
  );
}

export function useMatrix() {
  const query = useQuery<MatrixResponse>(queryKeys.matrix, () => api.get<MatrixResponse>('/api/tasks/matrix'), {
    staleTime: 15_000,
  });
  return {
    counts: query.data?.counts ?? { do_now: 0, schedule: 0, delegate: 0, eliminate: 0 },
    tasks: query.data?.tasks ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export interface TaskDraft {
  id?: string;
  title: string;
  description?: string | null;
  notes?: string | null;
  projectId?: string | null;
  priority?: string;
  important?: boolean;
  urgent?: boolean;
  dueDate?: string | null;
  dueTime?: string | null;
  reminderAt?: number | null;
  estimatedMinutes?: number | null;
  planDate?: string | null;
  planOrder?: number;
  isMustDo?: boolean;
  recurrence?: Record<string, unknown> | null;
  tags?: string[];
  status?: string;
  subtasks?: Array<{ title: string; position?: number }>;
}

export function useTaskMutations() {
  const { user, settings } = useAuth();

  const create = useCallback(
    async (draft: TaskDraft): Promise<{ task?: Task; queued: boolean }> => {
      const defaults = settings?.taskDefaults;
      const merged: TaskDraft = {
        priority: defaults?.priority ?? 'medium',
        estimatedMinutes: defaults?.estimateMinutes ?? settings?.defaultTaskDurationMinutes ?? null,
        projectId: defaults?.projectId ?? null,
        // Classification defaults come from Settings → Customize → Matrix.
        important: settings?.matrix.defaultClassification === 'do_now' || settings?.matrix.defaultClassification === 'schedule',
        urgent: settings?.matrix.defaultClassification === 'do_now' || settings?.matrix.defaultClassification === 'delegate',
        ...Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== undefined)),
      } as TaskDraft;

      // A default reminder lead time is applied when the caller did not set one.
      if (merged.reminderAt === undefined && defaults?.reminderLeadMinutes != null && merged.dueDate) {
        const time = merged.dueTime ?? '09:00';
        merged.reminderAt = Date.parse(`${merged.dueDate}T${time}:00Z`) - defaults.reminderLeadMinutes * 60_000;
      }

      const localTaskId = localId('tsk');
      const optimistic: Task = {
        id: localTaskId,
        projectId: merged.projectId ?? null,
        parentTaskId: null,
        title: merged.title,
        description: merged.description ?? null,
        notes: merged.notes ?? null,
        status: 'todo',
        priority: (merged.priority as Task['priority']) ?? 'medium',
        important: merged.important ?? false,
        urgent: merged.urgent ?? false,
        dueDate: (merged.dueDate as Task['dueDate']) ?? null,
        dueTime: merged.dueTime ?? null,
        reminderAt: merged.reminderAt ?? null,
        estimatedMinutes: merged.estimatedMinutes ?? null,
        actualMinutes: 0,
        scheduledStart: null,
        scheduledEnd: null,
        planDate: (merged.planDate as Task['planDate']) ?? null,
        planOrder: merged.planOrder ?? 0,
        isMustDo: merged.isMustDo ?? false,
        recurrence: (merged.recurrence as unknown as Task['recurrence']) ?? {
          kind: 'none',
          interval: 1,
          byWeekday: [],
          until: null,
          count: 0,
          maxOccurrences: null,
        },
        recurredFromId: null,
        tags: merged.tags ?? [],
        subtasks: [],
        completedAt: null,
        archivedAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
        seq: 0,
      };

      setCached<TasksResponse>(queryKeys.tasks(filterParams({ view: 'today' })), undefined, (current) =>
        current ? { ...current, tasks: [optimistic, ...current.tasks] } : current,
      );

      try {
        const payload = await api.post<{ task: Task }>('/api/tasks', { ...merged, clientId: localTaskId });
        invalidateTaskViews();
        return { task: payload.task, queued: false };
      } catch (error) {
        if (!isOfflineError(error)) throw error;
        await enqueueOperation({
          label: `Create “${merged.title}”`,
          sync: {
            entity: 'task',
            op: 'create',
            entityId: localTaskId,
            clientId: localTaskId,
            patch: { ...merged },
          },
          invalidate: ['tasks', 'dashboard'],
        });
        return { queued: true };
      }
    },
    [user, settings],
  );

  const update = useCallback(async (taskId: string, patch: Partial<TaskDraft>) => {
    try {
      await api.patch<{ task: Task }>(`/api/tasks/${taskId}`, patch);
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      await enqueueOperation({
        label: 'Update task',
        sync: { entity: 'task', op: 'update', entityId: taskId, patch: { ...patch } },
        invalidate: ['tasks', 'dashboard'],
      });
    }
    invalidateTaskViews();
  }, []);

  const complete = useCallback(async (task: Task, completed = true) => {
    const optimistic: Task = {
      ...task,
      status: completed ? 'done' : 'todo',
      completedAt: completed ? Date.now() : null,
    };
    setCached<TasksResponse>(queryKeys.tasks(filterParams({ view: 'today' })), undefined, (current) =>
      current ? { ...current, tasks: current.tasks.map((item) => (item.id === task.id ? optimistic : item)) } : current,
    );
    try {
      const payload = await api.post<{ task: Task; spawned?: Task | null }>(`/api/tasks/${task.id}/complete`, {
        completed,
      });
      return payload;
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      await enqueueOperation({
        label: completed ? `Complete “${task.title}”` : `Reopen “${task.title}”`,
        sync: { entity: 'task', op: 'toggle', entityId: task.id, patch: { completed } },
        invalidate: ['tasks', 'dashboard'],
      });
      return { task: optimistic, spawned: null };
    } finally {
      invalidateTaskViews();
    }
  }, []);

  const remove = useCallback(async (task: Task) => {
    setCached<TasksResponse>(queryKeys.tasks(filterParams({ view: 'today' })), undefined, (current) =>
      current ? { ...current, tasks: current.tasks.filter((item) => item.id !== task.id) } : current,
    );
    try {
      await api.delete(`/api/tasks/${task.id}`);
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      await enqueueOperation({
        label: `Delete “${task.title}”`,
        sync: { entity: 'task', op: 'delete', entityId: task.id },
        invalidate: ['tasks', 'dashboard'],
      });
    }
    invalidateTaskViews();
  }, []);

  const duplicate = useCallback(async (taskId: string) => {
    await api.post(`/api/tasks/${taskId}/duplicate`, {});
    invalidateTaskViews();
  }, []);

  const archive = useCallback(async (taskId: string) => {
    await api.post(`/api/tasks/${taskId}/archive`, {});
    invalidateTaskViews();
  }, []);

  const addSubtask = useCallback(async (taskId: string, title: string) => {
    try {
      await api.post(`/api/tasks/${taskId}/subtasks`, { title });
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      await enqueueOperation({
        label: `Add “${title}”`,
        rest: { method: 'POST', path: `/api/tasks/${taskId}/subtasks`, body: { title } },
        invalidate: ['tasks', 'task'],
      });
    }
    invalidate('tasks', 'task', 'dashboard');
  }, []);

  const updateSubtask = useCallback(async (subtaskId: string, patch: { title?: string; status?: string }) => {
    await api.patch(`/api/subtasks/${subtaskId}`, patch);
    invalidate('tasks', 'task', 'dashboard');
  }, []);

  const removeSubtask = useCallback(async (subtaskId: string) => {
    await api.delete(`/api/subtasks/${subtaskId}`);
    invalidate('tasks', 'task', 'dashboard');
  }, []);

  /** Bulk move used by the Eisenhower board and the planner's drag & drop. */
  const bulkUpdate = useCallback(
    async (updates: Array<{ id: string; planOrder?: number; planDate?: string | null; isMustDo?: boolean; important?: boolean; urgent?: boolean; status?: string }>) => {
      try {
        await api.post('/api/tasks/bulk', { updates });
      } catch (error) {
        if (!isOfflineError(error)) throw error;
        for (const update of updates) {
          await enqueueOperation({
            label: 'Reorder tasks',
            sync: {
              entity: 'task',
              op: 'update',
              entityId: update.id,
              patch: {
                planOrder: update.planOrder,
                planDate: update.planDate,
                isMustDo: update.isMustDo,
                important: update.important,
                urgent: update.urgent,
                status: update.status,
              },
            },
            invalidate: ['tasks', 'dashboard'],
          });
        }
      }
      invalidateTaskViews();
    },
    [],
  );

  /** Moves a task between Eisenhower quadrants by setting its two flags. */
  const setQuadrant = useCallback(
    async (task: Task, quadrant: 'do_now' | 'schedule' | 'delegate' | 'eliminate') => {
      const flags =
        quadrant === 'do_now'
          ? { important: true, urgent: true }
          : quadrant === 'schedule'
            ? { important: true, urgent: false }
            : quadrant === 'delegate'
              ? { important: false, urgent: true }
              : { important: false, urgent: false };
      setCached<MatrixResponse>(queryKeys.matrix, undefined, (current) => {
        if (!current) return current;
        const moving = current.tasks.find((item) => item.id === task.id);
        return {
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...flags } : item)),
          counts: moving
            ? {
                ...current.counts,
                [quadrantOf(moving)]: Math.max(0, current.counts[quadrantOf(moving)] - 1),
                [quadrant]: current.counts[quadrant] + 1,
              }
            : current.counts,
        };
      });
      await bulkUpdate([{ id: task.id, ...flags }]);
    },
    [bulkUpdate],
  );

  const savePlan = useCallback(
    async (updates: Array<{ id: string; planOrder?: number; planDate?: string | null; isMustDo?: boolean }>) => {
      await bulkUpdate(updates);
    },
    [bulkUpdate],
  );

  return {
    create,
    update,
    complete,
    remove,
    duplicate,
    archive,
    addSubtask,
    updateSubtask,
    removeSubtask,
    bulkUpdate,
    setQuadrant,
    savePlan,
  };
}

/**
 * Natural-language capture.
 *
 * Parsing runs locally through the shared domain module, so the confirmation
 * screen appears instantly and still works with no connection. The API exposes
 * the same parser for other clients (and is used by the web build).
 */
export function parseTaskDraft(text: string, offsetMinutes = 0, now = Date.now()): ParsedTaskDraft {
  return parseNaturalLanguageTask(text, { now, offsetMinutes });
}

export interface ApiFailure {
  offline: boolean;
  message: string;
}

export function describeFailure(error: unknown): ApiFailure {
  if (error instanceof ApiError) return { offline: error.isOffline, message: error.message };
  return { offline: false, message: error instanceof Error ? error.message : 'Something went wrong' };
}
