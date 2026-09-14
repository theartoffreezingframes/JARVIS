import { config } from '../../env.js';
import { dispatchNotificationPush, type PushableNotification } from './dispatch.js';

/**
 * Fire-and-forget bridge between the synchronous notification repository and the
 * asynchronous push transport.
 *
 * A database write must never wait on an HTTP round-trip to a push service, and
 * a push failure must never fail the request that produced the notification — so
 * delivery is queued on the microtask queue and every error is swallowed after
 * being logged by the dispatcher.
 */
export function queueNotificationPush(userId: string, notification: PushableNotification): void {
  if (!config.push.enabled) return;
  setImmediate(() => {
    void dispatchNotificationPush(userId, notification).catch((error: unknown) => {
      console.error('[push] unexpected dispatch failure', error instanceof Error ? error.message : error);
    });
  });
}
