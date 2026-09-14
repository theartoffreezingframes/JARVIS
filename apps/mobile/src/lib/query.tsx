/**
 * A small, offline-first query cache.
 *
 * Enough of a data layer to keep the app honest: one cache shared by every screen,
 * persisted to disk so cold starts and offline use show real data, prefix
 * invalidation so a task edit refreshes the dashboard and analytics too, and
 * optimistic writes so tapping "done" feels instant.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { realtime } from './realtime';
import { ApiError } from './api';
import { storageKeys } from './storage';
import { refreshFocusTimerFromClock } from './timer';

const CACHE_NS = 'jarvis.cache.';
const PERSIST_PREFIXES = ['dashboard', 'tasks', 'habits', 'focus', 'projects', 'notes', 'groups', 'gang', 'reviews', 'calendar', 'planner', 'analytics', 'me'];

interface CacheEntry<T = unknown> {
  data: T;
  updatedAt: number;
}

const cache = new Map<string, CacheEntry>();
const errors = new Map<string, ApiError | null>();
const fetches = new Map<string, Promise<unknown>>();
const bumps = new Map<string, number>();
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshotVersion(): number {
  return version;
}

function isPersistable(key: string): boolean {
  return PERSIST_PREFIXES.some((prefix) => key.startsWith(prefix));
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const snapshot: Record<string, CacheEntry> = {};
    for (const [key, entry] of cache) {
      if (isPersistable(key)) snapshot[key] = entry;
    }
    void AsyncStorage.setItem(storageKeys.cachedQueries, JSON.stringify(snapshot)).catch(() => {});
  }, 400);
}

let hydrated = false;

export async function hydrateCache(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(storageKeys.cachedQueries);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    for (const [key, entry] of Object.entries(parsed)) {
      if (!cache.has(key)) cache.set(key, entry);
    }
    emit();
  } catch {
    /* a corrupt cache is the same as an empty one */
  }
}

export function getCached<T>(key: string): T | undefined {
  return cache.get(key)?.data as T | undefined;
}

export function setCached<T>(key: string, data: T | undefined, updater?: (current: T | undefined) => T | undefined): void {
  if (updater) {
    const next = updater(cache.get(key)?.data as T | undefined);
    if (next === undefined) return;
    cache.set(key, { data: next, updatedAt: Date.now() });
  } else if (data !== undefined) {
    cache.set(key, { data, updatedAt: Date.now() });
  }
  schedulePersist();
  emit();
}

/** Drops entries and forces every mounted hook whose key starts with a prefix to refetch. */
export function invalidate(...prefixes: string[]): void {
  for (const prefix of prefixes) {
    bumps.set(prefix, (bumps.get(prefix) ?? 0) + 1);
    for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
    for (const key of errors.keys()) if (key.startsWith(prefix)) errors.delete(key);
  }
  schedulePersist();
  emit();
}

export function clearQueryCache(): void {
  cache.clear();
  errors.clear();
  fetches.clear();
  bumps.clear();
  void AsyncStorage.removeItem(storageKeys.cachedQueries).catch(() => {});
  emit();
}

function bumpToken(key: string): number {
  let total = 0;
  for (const [prefix, count] of bumps) if (key.startsWith(prefix)) total += count;
  return total;
}

async function runFetch<T>(key: string, fetcher: () => Promise<T>, force = false): Promise<T | undefined> {
  const existing = fetches.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = fetcher()
    .then((data) => {
      cache.set(key, { data, updatedAt: Date.now() });
      errors.set(key, null);
      schedulePersist();
      return data;
    })
    .catch((error: unknown) => {
      const apiError =
        error instanceof ApiError ? error : new ApiError(0, 'unknown', error instanceof Error ? error.message : 'Request failed');
      errors.set(key, apiError);
      return undefined;
    })
    .finally(() => {
      fetches.delete(key);
      emit();
      void force;
    });
  fetches.set(key, promise);
  emit();
  return promise;
}

export interface QueryResult<T> {
  data: T | undefined;
  error: ApiError | null;
  /** True only on a cold start with nothing cached. */
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => Promise<T | undefined>;
  setData: (updater: T | undefined | ((current: T | undefined) => T | undefined)) => void;
}

export interface QueryOptions {
  enabled?: boolean;
  /** How long cached data stays fresh. Defaults to 30s. */
  staleTime?: number;
  refetchOnMount?: boolean;
}

export function useQuery<T>(key: string | null, fetcher: () => Promise<T>, options: QueryOptions = {}): QueryResult<T> {
  const { enabled = true, staleTime = 30_000, refetchOnMount = true } = options;
  const version_ = useSyncExternalStore(subscribe, snapshotVersion, snapshotVersion);
  const token = key ? bumpToken(key) : 0;
  const [, forceRender] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const entry = key ? (cache.get(key) as CacheEntry<T> | undefined) : undefined;
  const error = key ? errors.get(key) ?? null : null;
  const inFlight = key ? fetches.has(key) : false;

  useEffect(() => {
    if (!key || !enabled) return;
    const fresh = entry !== undefined && Date.now() - entry.updatedAt < staleTime;
    const shouldFetch = !entry || (!fresh && refetchOnMount) || token > 0;
    if (!shouldFetch) return;
    void runFetch(key, () => fetcherRef.current());
    // `token` intentionally participates: invalidate() must trigger a refetch.
  }, [key, enabled, staleTime, refetchOnMount, entry, token, version_]);

  const refetch = useCallback(async () => {
    if (!key) return undefined;
    return runFetch(key, () => fetcherRef.current(), true);
  }, [key]);

  const setData = useCallback(
    (updater: T | undefined | ((current: T | undefined) => T | undefined)) => {
      if (!key) return;
      if (typeof updater === 'function') {
        setCached<T>(key, undefined, updater as (current: T | undefined) => T | undefined);
      } else {
        setCached<T>(key, updater);
      }
      forceRender((n) => n + 1);
    },
    [key],
  );

  return {
    data: entry?.data,
    error,
    isLoading: !entry && (inFlight || (enabled && !!key)),
    isFetching: inFlight,
    refetch,
    setData,
  };
}

/**
 * Refreshes whatever is stale whenever the app comes back to the foreground.
 *
 * The focus timer is checked against the wall clock in the same place: a phase
 * that ended while the phone slept is closed out the moment the app is visible
 * again, rather than on the next 500 ms tick.
 */
export function useForegroundRefresh(): void {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      invalidate(...PERSIST_PREFIXES);
      void refreshFocusTimerFromClock();
      // Reconnect immediately rather than waiting out a background backoff.
      realtime.ensureConnected();
    });
    return () => subscription.remove();
  }, []);
}

export const queryKeys = {
  dashboard: 'dashboard',
  tasks: (params?: string) => `tasks${params ? `?${params}` : ''}`,
  matrix: 'tasks/matrix',
  task: (id: string) => `task:${id}`,
  projects: 'projects',
  project: (id: string) => `project:${id}`,
  habits: 'habits',
  habit: (id: string) => `habit:${id}`,
  focusStats: 'focus/stats',
  focusSessions: (params?: string) => `focus/sessions${params ? `?${params}` : ''}`,
  focusPresets: 'focus/presets',
  notes: (params?: string) => `notes${params ? `?${params}` : ''}`,
  note: (id: string) => `note:${id}`,
  calendar: (month: string) => `calendar:${month}`,
  planner: (day: string) => `planner:${day}`,
  analytics: (range: string) => `analytics:${range}`,
  heatmap: (metric: string, range: string) => `heatmap:${metric}:${range}`,
  review: (day: string) => `reviews:${day}`,
  groups: 'groups',
  group: (id: string) => `group:${id}`,
  gang: (id: string) => `gang:${id}`,
  gangUpcoming: 'gang/upcoming',
  notifications: 'notifications',
  search: (q: string) => `search:${q}`,
  me: 'me',
} as const;
