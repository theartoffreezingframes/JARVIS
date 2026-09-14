import type { Db } from '../db/index.js';
import { all, getDb, one, run } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import type { SettingsRow, UserRow } from './rows.js';

export function findUserById(id: string, db: Db = getDb()): UserRow | undefined {
  return one<UserRow>('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [id], db);
}

export function findUserByEmail(email: string, db: Db = getDb()): UserRow | undefined {
  return one<UserRow>('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL', [email.toLowerCase()], db);
}

export function findUserByUsername(username: string, db: Db = getDb()): UserRow | undefined {
  return one<UserRow>('SELECT * FROM users WHERE username = ? AND deleted_at IS NULL', [username.toLowerCase()], db);
}

/** Public profile lookup, used by group invites and friend search. */
export function findUsersByUsernameLike(term: string, excludeUserId: string, db: Db = getDb()): UserRow[] {
  const like = `${term.toLowerCase().replace(/[%_]/g, '')}%`;
  return all<UserRow>(
    `SELECT * FROM users
      WHERE deleted_at IS NULL AND (username LIKE ? OR lower(name) LIKE ?) AND id != ?
      LIMIT 20`,
    [like, like, excludeUserId],
    db,
  );
}

export interface CreateUserInput {
  email: string;
  username: string;
  name: string;
  passwordHash: string;
  timezone: string;
  timezoneOffsetMinutes: number;
}

export function createUser(input: CreateUserInput, db: Db = getDb()): UserRow {
  const now = Date.now();
  const id = newId('usr');
  run(
    `INSERT INTO users (id, email, username, name, password_hash, timezone, tz_offset_minutes,
                        week_starts_on, use_24_hour, email_verified, change_seq, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 0, ?, ?)`,
    [
      id,
      input.email.toLowerCase(),
      input.username.toLowerCase(),
      input.name,
      input.passwordHash,
      input.timezone,
      input.timezoneOffsetMinutes,
      now,
      now,
    ],
    db,
  );
  return findUserById(id, db)!;
}

export function insertSettingsRow(userId: string, data: unknown, db: Db = getDb()): void {
  run(
    `INSERT INTO user_settings (user_id, data, updated_at, seq) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, seq = excluded.seq`,
    [userId, JSON.stringify(data), Date.now(), nextSeq(userId, db)],
    db,
  );
}

export function getSettingsRow(userId: string, db: Db = getDb()): SettingsRow | undefined {
  return one<SettingsRow>('SELECT * FROM user_settings WHERE user_id = ?', [userId], db);
}

/**
 * Allocates the next per-user revision. Every write path calls this so that
 * `seq` forms a total order over a user's data — that is what makes incremental
 * offline sync (`GET /sync/pull?since=`) correct without a change-log table.
 */
export function nextSeq(userId: string, db: Db = getDb()): number {
  run('UPDATE users SET change_seq = change_seq + 1 WHERE id = ?', [userId], db);
  const row = one<{ change_seq: number }>('SELECT change_seq FROM users WHERE id = ?', [userId], db);
  return row?.change_seq ?? 0;
}

export function currentSeq(userId: string, db: Db = getDb()): number {
  const row = one<{ change_seq: number }>('SELECT change_seq FROM users WHERE id = ?', [userId], db);
  return row?.change_seq ?? 0;
}

export function touchUser(userId: string, db: Db = getDb()): void {
  run('UPDATE users SET updated_at = ? WHERE id = ?', [Date.now(), userId], db);
}

/* -------------------------------------------------------------------------- */
/*  Sessions & password resets                                                */
/* -------------------------------------------------------------------------- */

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  device_name: string | null;
  created_at: number;
  last_used_at: number | null;
  expires_at: number;
  revoked_at: number | null;
}

export function insertRefreshToken(
  input: { userId: string; tokenHash: string; deviceName: string | null; expiresAt: number },
  db: Db = getDb(),
): void {
  run(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, device_name, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [newId('rtk'), input.userId, input.tokenHash, input.deviceName, Date.now(), input.expiresAt],
    db,
  );
}

export function findRefreshToken(tokenHash: string, db: Db = getDb()): RefreshTokenRow | undefined {
  return one<RefreshTokenRow>('SELECT * FROM refresh_tokens WHERE token_hash = ?', [tokenHash], db);
}

export function revokeRefreshToken(id: string, db: Db = getDb()): void {
  run('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?', [Date.now(), id], db);
}

export function revokeAllRefreshTokens(userId: string, db: Db = getDb()): void {
  run('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [Date.now(), userId], db);
}

export function markRefreshTokenUsed(id: string, db: Db = getDb()): void {
  run('UPDATE refresh_tokens SET last_used_at = ? WHERE id = ?', [Date.now(), id], db);
}

export function insertPasswordReset(
  input: { userId: string; tokenHash: string; expiresAt: number },
  db: Db = getDb(),
): void {
  run(
    `INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
    [newId('prt'), input.userId, input.tokenHash, Date.now(), input.expiresAt],
    db,
  );
}

export function findPasswordReset(tokenHash: string, db: Db = getDb()): { id: string; user_id: string; expires_at: number; used_at: number | null } | undefined {
  return one('SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?', [tokenHash], db);
}

export function consumePasswordReset(id: string, db: Db = getDb()): void {
  run('UPDATE password_resets SET used_at = ? WHERE id = ?', [Date.now(), id], db);
}

export function updatePasswordHash(userId: string, passwordHash: string, db: Db = getDb()): void {
  run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [passwordHash, Date.now(), userId], db);
}

export function audit(action: string, meta: { userId?: string | null; ip?: string | null; userAgent?: string | null }, db: Db = getDb()): void {
  run(
    `INSERT INTO audit_log (id, user_id, action, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [newId('aud'), meta.userId ?? null, action, meta.ip ?? null, meta.userAgent ?? null, Date.now()],
    db,
  );
}
