import type { FastifyInstance } from 'fastify';
import { syncPullSchema, syncPushSchema } from '@jarvis/shared';
import { requireUser } from '../http/auth-plugin.js';
import { currentSeq } from '../repo/users.js';
import { parseOrThrow } from '../lib/errors.js';
import { reconcileActivity } from '../services/reconcile.js';
import { pullChanges, pushOperations, type SyncOperation } from '../services/sync.js';

export async function registerSyncRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Offline replay endpoint.
   *
   * Idempotent per operation id, three-way merged against the client's base
   * snapshot, and returns both the applied results and any conflicts so the UI
   * can tell the user what happened instead of silently losing work.
   */
  app.post('/sync/push', async (request) => {
    const user = requireUser(request);
    const input = parseOrThrow(syncPushSchema, request.body);
    const result = pushOperations(user, input.deviceId, input.operations as SyncOperation[]);
    const reconciled = await reconcileActivity(user, input.operations as SyncOperation[]);
    return { ...result, reconciled };
  });

  /** Incremental pull with a per-user revision cursor and tombstones. */
  app.get('/sync/pull', async (request) => {
    const user = requireUser(request);
    const query = parseOrThrow(syncPullSchema, request.query);
    return pullChanges(user, query.since, query.limit);
  });

  /**
   * Cheap cursor probe: lets the client decide whether to pull without
   * transferring any rows (used on app foreground and after reconnect).
   */
  app.get('/sync/status', async (request) => {
    const user = requireUser(request);
    return { cursor: currentSeq(user.id), serverTime: Date.now() };
  });
}
