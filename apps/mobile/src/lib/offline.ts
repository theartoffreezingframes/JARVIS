/**
 * Offline support.
 *
 * Writes made without a connection are appended to a durable queue. When the
 * connection returns the queue is replayed through `/api/sync/push`, which is
 * idempotent per operation id and merges field by field, so a phone that was
 * offline for a day cannot corrupt or duplicate anything.
 */
import * as Network from 'expo-network';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { apiRequest, ApiError } from './api';
import { deviceId, readJson, writeJson, storageKeys } from './storage';
import { getCached, invalidate, setCached } from './query';

export type SyncEntity = 'task' | 'project' | 'note' | 'habit' | 'habit_completion' | 'focus_session' | 'daily_review' | 'settings';

export interface SyncOperationPayload {
  entity: SyncEntity;
  op: 'create' | 'update' | 'delete' | 'toggle';
  entityId: string;
  patch?: Record<string, unknown>;
  base?: Record<string, unknown>;
  baseUpdatedAt?: number;
  /** Local id → replaces the row id on the server where the entity is soft-created. */
  clientId?: string;
}

export interface PendingOperation {
  id: string;
  label: string;
  createdAt: number;
  attempts: number;
  sync?: SyncOperationPayload;
  rest?: { method: 'POST' | 'PATCH' | 'DELETE' | 'PUT'; path: string; body?: unknown };
  invalidate?: string[];
}

export interface OfflineSnapshot {
  online: boolean;
  pending: number;
  syncing: boolean;
  lastSyncedAt: number | null;
  lastError: string | null;
  /** Set when the server rejected an operation so the UI can explain why. */
  rejected: string | null;
}

let queue: PendingOperation[] = [];
let online = true;
let syncing = false;
let lastSyncedAt: number | null = null;
let lastError: string | null = null;
let rejected: string | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function offlineSnapshot(): OfflineSnapshot {
  return { online, pending: queue.length, syncing, lastSyncedAt, lastError, rejected };
}

export function useOfflineStatus(): OfflineSnapshot & { flush: () => Promise<void> } {
  const [snapshot, setSnapshot] = useState<OfflineSnapshot>(offlineSnapshot);
  useEffect(() => {
    const listener = () => setSnapshot(offlineSnapshot());
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const flush = useCallback(() => flushQueue(), []);
  return { ...snapshot, flush };
}

async function persistQueue(): Promise<void> {
  await writeJson(storageKeys.pendingOps, queue);
}

export async function hydrateOffline(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  queue = await readJson<PendingOperation[]>(storageKeys.pendingOps, []);
  const state = await Network.getNetworkStateAsync().catch(() => null);
  online = state?.isInternetReachable ?? state?.isConnected ?? true;
  emit();
  if (online && queue.length) void flushQueue();
}

export function newOperationId(prefix = 'op'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Queue a write and remember to refresh these caches once it lands. */
export async function enqueueOperation(
  operation: Omit<PendingOperation, 'createdAt' | 'attempts' | 'id'> & { id?: string },
): Promise<void> {
  const entry: PendingOperation = {
    id: operation.id ?? newOperationId(),
    label: operation.label,
    createdAt: Date.now(),
    attempts: 0,
    sync: operation.sync,
    rest: operation.rest,
    invalidate: operation.invalidate,
  };
  queue.push(entry);
  lastError = null;
  emit();
  await persistQueue();
}

export function pendingOperationCount(): number {
  return queue.length;
}

/** True when a request failed because there was no usable connection. */
export function isOfflineError(error: unknown): boolean {
  return error instanceof ApiError ? error.isOffline : false;
}

interface PushResult {
  applied: Array<{ id: string; entity: string; entityId: string; serverId?: string }>;
  conflicts: Array<{ entity: string; entityId: string; fields: string[]; message: string }>;
  cursor: number;
}

/** Local rows keep their client id until the server assigns one. */
const localIdMap = new Map<string, string>();

function remapLocalIds(result: PushResult): void {
  let changed = false;
  for (const applied of result.applied) {
    if (applied.serverId && applied.serverId !== applied.entityId) {
      localIdMap.set(applied.entityId, applied.serverId);
      changed = true;
    }
  }
  if (!changed) return;

  for (const key of ['tasks?view=today', 'tasks?view=all', 'tasks?view=upcoming', 'tasks?view=overdue', 'tasks?view=inbox']) {
    setCached<{ tasks: Array<{ id: string }> }>(key, undefined, (current) => {
      if (!current?.tasks) return current;
      return { ...current, tasks: current.tasks.map((task) => ({ ...task, id: localIdMap.get(task.id) ?? task.id })) };
    });
  }
  // Later operations for the same row must target the server id.
  for (const op of queue) {
    if (op.sync && localIdMap.has(op.sync.entityId)) op.sync.entityId = localIdMap.get(op.sync.entityId)!;
  }
}

export async function flushQueue(): Promise<void> {
  if (syncing) return;
  if (!queue.length) {
    await checkConnection();
    return;
  }
  if (!online) {
    await checkConnection();
    if (!online) return;
  }

  syncing = true;
  emit();
  const device = await deviceId();
  const batch = [...queue];
  const syncable = batch.filter((op) => op.sync);
  let cursorUpdate = 0;

  try {
    if (syncable.length) {
      const result = await apiRequest<PushResult>('/api/sync/push', {
        method: 'POST',
        body: {
          deviceId: device,
          operations: syncable.map((op) => ({
            id: op.id,
            entity: op.sync!.entity,
            op: op.sync!.op,
            entityId: op.sync!.entityId,
            baseUpdatedAt: op.sync!.baseUpdatedAt,
            payload: { patch: op.sync!.patch, base: op.sync!.base, clientId: op.sync!.clientId },
            clientTimestamp: op.createdAt,
          })),
        },
      });
      remapLocalIds(result);
      cursorUpdate = result.cursor;
      const done = new Set(syncable.map((op) => op.id));
      queue = queue.filter((op) => !done.has(op.id));
      if (result.conflicts.length) {
        rejected = result.conflicts[0]?.message ?? 'Some changes were merged with newer data from another device.';
      }
    }

    // Operations without a sync mapping (subtasks, planner blocks, social) replay
    // over plain REST, in order.
    const restOps = queue.filter((op) => op.rest);
    for (const op of restOps) {
      try {
        await apiRequest(op.rest!.path, { method: op.rest!.method, body: op.rest!.body });
        queue = queue.filter((candidate) => candidate.id !== op.id);
      } catch (error) {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 429) {
          // The server will never accept this; drop it and tell the user.
          rejected = `${op.label} could not be saved: ${error.message}`;
          queue = queue.filter((candidate) => candidate.id !== op.id);
        } else {
          throw error;
        }
      }
    }

    await persistQueue();
    lastSyncedAt = Date.now();
    lastError = null;
    if (cursorUpdate) await writeJson(storageKeys.lastSyncedSeq, cursorUpdate);
    invalidate('dashboard', 'tasks', 'habits', 'focus', 'projects', 'notes', 'analytics', 'me');
  } catch (error) {
    const apiError = error instanceof ApiError ? error : null;
    lastError = apiError?.isOffline ? 'Waiting for a connection' : apiError?.message ?? 'Sync failed';
    if (apiError && apiError.status === 401) {
      // The session is gone; the auth layer handles sign-out.
    }
  } finally {
    syncing = false;
    emit();
  }
}

export async function checkConnection(): Promise<boolean> {
  const state = await Network.getNetworkStateAsync().catch(() => null);
  const next = state ? state.isInternetReachable ?? state.isConnected ?? true : online;
  if (next !== online) {
    online = next;
    emit();
    if (online) void flushQueue();
  }
  return online;
}

/** Watches connectivity for the lifetime of the app. */
export function useConnectivityWatch(): void {
  useEffect(() => {
    void hydrateOffline();
    const interval = setInterval(() => {
      void checkConnection();
    }, 20_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkConnection();
    });
    let networkSubscription: { remove: () => void } | undefined;
    try {
      networkSubscription = Network.addNetworkStateListener((state) => {
        const next = state.isInternetReachable ?? state.isConnected ?? true;
        if (next !== online) {
          online = next;
          emit();
          if (online) void flushQueue();
        }
      });
    } catch {
      /* listener unavailable on this platform — polling covers it */
    }
    return () => {
      clearInterval(interval);
      subscription.remove();
      networkSubscription?.remove();
    };
  }, []);
}

export { getCached };
