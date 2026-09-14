/**
 * Which queued offline changes may be replayed by the account that is signed in.
 *
 * The offline queue lives in device storage, not in the session, so a shared or
 * handed-over phone would otherwise replay one person's unsynced work with the next
 * person's token — and the server would dutifully write it into the wrong account.
 * This module is deliberately tiny and pure so the rule can be unit tested without
 * a running app.
 */

export interface OwnedOperation {
  /** The account id that queued the change; `undefined`/`null` means "pre-scoping build". */
  owner?: string | null;
}

/**
 * True when this queued change belongs to the currently signed-in account.
 *
 * Entries from builds that predate ownership tracking have no owner and are treated
 * as belonging to whoever is signed in — they were queued by that device's user.
 * When nobody is signed in (`currentUserId === null`) only those unowned entries
 * qualify, and they are never flushed because there is no token to send.
 */
export function belongsToUser(operation: OwnedOperation, currentUserId: string | null): boolean {
  if (operation.owner === undefined || operation.owner === null) return true;
  return operation.owner === currentUserId;
}

export interface ScopedQueue<T extends OwnedOperation> {
  /** Safe to send with the current session. */
  mine: T[];
  /** Belongs to a different account; stays put until that account signs back in. */
  others: T[];
}

export function partitionByOwner<T extends OwnedOperation>(queue: T[], currentUserId: string | null): ScopedQueue<T> {
  const mine: T[] = [];
  const others: T[] = [];
  for (const operation of queue) {
    if (belongsToUser(operation, currentUserId)) mine.push(operation);
    else others.push(operation);
  }
  return { mine, others };
}
