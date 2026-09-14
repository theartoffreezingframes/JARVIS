import { getDb, run, type Db } from '../db/index.js';
import { newId } from '../lib/crypto.js';

export type PushPlatform = 'android' | 'ios' | 'web';

export interface PushTokenRow {
  id: string;
  user_id: string;
  token: string;
  platform: string;
  device_id: string | null;
  device_name: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
  last_seen_at: number;
}

const COLUMNS =
  'id, user_id, token, platform, device_id, device_name, enabled, created_at, updated_at, last_seen_at';

/** A client-visible view of a registration: never exposes the raw token. */
export interface PushRegistration {
  id: string;
  platform: string;
  deviceId: string | null;
  deviceName: string | null;
  enabled: boolean;
  createdAt: number;
  lastSeenAt: number;
}

export function mapPushRegistration(row: PushTokenRow): PushRegistration {
  return {
    id: row.id,
    platform: row.platform,
    deviceId: row.device_id,
    deviceName: row.device_name,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

/**
 * Registers (or refreshes) a device token for an authenticated user.
 *
 * Re-registering the same token is idempotent. If the token currently belongs to
 * another account — the same phone, a different sign-in — ownership moves to the
 * caller so the previous account stops receiving that device's notifications.
 */
export function registerPushToken(
  input: {
    userId: string;
    token: string;
    platform: PushPlatform;
    deviceId?: string | null;
    deviceName?: string | null;
  },
  db: Db = getDb(),
): PushTokenRow {
  const now = Date.now();
  run(
    `INSERT INTO push_tokens (id, user_id, token, platform, device_id, device_name, enabled, created_at, updated_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET
       user_id      = excluded.user_id,
       platform     = excluded.platform,
       device_id    = COALESCE(excluded.device_id, push_tokens.device_id),
       device_name  = COALESCE(excluded.device_name, push_tokens.device_name),
       enabled      = 1,
       updated_at   = excluded.updated_at,
       last_seen_at = excluded.last_seen_at`,
    [newId('ptk'), input.userId, input.token, input.platform, input.deviceId ?? null, input.deviceName ?? null, now, now, now],
    db,
  );
  const row = db.prepare(`SELECT ${COLUMNS} FROM push_tokens WHERE token = ?`).get(input.token) as
    | PushTokenRow
    | undefined;
  return row!;
}

export function listPushTokens(userId: string, db: Db = getDb()): PushTokenRow[] {
  return db
    .prepare(`SELECT ${COLUMNS} FROM push_tokens WHERE user_id = ? ORDER BY last_seen_at DESC`)
    .all(userId) as PushTokenRow[];
}

/** Removes a registration the caller owns. Returns true when a row was deleted. */
export function removePushToken(userId: string, tokenOrId: string, db: Db = getDb()): boolean {
  const result = run('DELETE FROM push_tokens WHERE user_id = ? AND (token = ? OR id = ?)', [userId, tokenOrId, tokenOrId], db);
  return result.changes > 0;
}

/** Called when a device unregisters (sign-out) — the token stops receiving anything. */
export function disablePushToken(token: string, db: Db = getDb()): void {
  run('UPDATE push_tokens SET enabled = 0, updated_at = ? WHERE token = ?', [Date.now(), token], db);
}

/**
 * Drops tokens the push service rejected as permanently invalid
 * (`DeviceNotRegistered`). Keeps delivery healthy instead of retrying forever.
 */
export function deletePushTokens(tokens: string[], db: Db = getDb()): number {
  if (!tokens.length) return 0;
  const placeholders = tokens.map(() => '?').join(',');
  const result = run(`DELETE FROM push_tokens WHERE token IN (${placeholders})`, tokens, db);
  return result.changes;
}

export function markPushTokenSeen(token: string, db: Db = getDb()): void {
  run('UPDATE push_tokens SET last_seen_at = ? WHERE token = ?', [Date.now(), token], db);
}
