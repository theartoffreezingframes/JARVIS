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

export function findUserByGoogleSub(googleSub: string, db: Db = getDb()): UserRow | undefined {
  return one<UserRow>('SELECT * FROM users WHERE google_sub = ? AND deleted_at IS NULL', [googleSub], db);
}

/** Links a Google subject to an existing account that proved the same email. */
export function linkGoogleSub(userId: string, googleSub: string, db: Db = getDb()): void {
  run('UPDATE users SET google_sub = ?, email_verified = 1, updated_at = ? WHERE id = ?', [
    googleSub,
    Date.now(),
    userId,
  ], db);
}

/** Records that an account (created through Google) now has its own password. */
export function recordPasswordSet(userId: string, db: Db = getDb()): void {
  run('UPDATE users SET has_password = 1, updated_at = ? WHERE id = ?', [Date.now(), userId], db);
}

export interface CreateUserInput {
  email: string;
  username: string;
  name: string;
  passwordHash: string;
  timezone: string;
  timezoneOffsetMinutes: number;
  /** Set for accounts created through Google Sign-In. */
  googleSub?: string | null;
  /** False for Google-only accounts until they choose a password. Defaults to true. */
  hasPassword?: boolean;
  /** True when the email address was verified by an identity provider. */
  emailVerified?: boolean;
  avatarUrl?: string | null;
}

export function createUser(input: CreateUserInput, db: Db = getDb()): UserRow {
  const now = Date.now();
  const id = newId('usr');
  run(
    `INSERT INTO users (id, email, username, name, password_hash, avatar_url, timezone, tz_offset_minutes,
                        week_starts_on, use_24_hour, email_verified, google_sub, has_password,
                        change_seq, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, 0, ?, ?)`,
    [
      id,
      input.email.toLowerCase(),
      input.username.toLowerCase(),
      input.name,
      input.passwordHash,
      input.avatarUrl ?? null,
      input.timezone,
      input.timezoneOffsetMinutes,
      input.emailVerified ? 1 : 0,
      input.googleSub ?? null,
      input.hasPassword === false ? 0 : 1,
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
  revoked_reason: string | null;
}

export function insertRefreshToken(
  input: { userId: string; tokenHash: string; deviceName: string | null; expiresAt: number; sid?: string },
  db: Db = getDb(),
): void {
  run(
    `INSERT INTO refresh_tokens (id, user_id, sid, token_hash, device_name, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newId('rtk'), input.userId, input.sid ?? null, input.tokenHash, input.deviceName, Date.now(), input.expiresAt],
    db,
  );
}

/**
 * Is the session behind this access token still alive?
 *
 * Refresh-token rows are the record of a live session: while one exists for the
 * token's `sid`, the access token is honoured; once it is revoked (sign-out,
 * password change, password reset, account deletion) every access token minted
 * for that session stops working immediately instead of lingering until expiry.
 */
export function sessionIsActive(sid: string, db: Db = getDb()): boolean {
  const row = one<{ id: string }>(
    'SELECT id FROM refresh_tokens WHERE sid = ? AND revoked_at IS NULL AND expires_at > ?',
    [sid, Date.now()],
    db,
  );
  return Boolean(row);
}

export function findRefreshToken(tokenHash: string, db: Db = getDb()): RefreshTokenRow | undefined {
  return one<RefreshTokenRow>('SELECT * FROM refresh_tokens WHERE token_hash = ?', [tokenHash], db);
}

export type RevokeReason = 'rotated' | 'logout' | 'password' | 'admin';

export function revokeRefreshToken(id: string, reason: RevokeReason = 'logout', db: Db = getDb()): void {
  run('UPDATE refresh_tokens SET revoked_at = ?, revoked_reason = ? WHERE id = ?', [Date.now(), reason, id], db);
}

export function revokeAllRefreshTokens(userId: string, reason: RevokeReason = 'admin', db: Db = getDb()): void {
  run(
    'UPDATE refresh_tokens SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL',
    [Date.now(), reason, userId],
    db,
  );
}

/**
 * Revokes every session for a user except the one currently in use.
 *
 * Used by "change password": the device that performed the change stays signed
 * in, every other device is signed out immediately (their access tokens stop
 * working because their session rows are revoked).
 */
export function revokeOtherRefreshTokens(userId: string, keepSid: string | null, db: Db = getDb()): void {
  if (!keepSid) {
    revokeAllRefreshTokens(userId, 'password', db);
    return;
  }
  run(
    `UPDATE refresh_tokens SET revoked_at = ?, revoked_reason = 'password'
      WHERE user_id = ? AND revoked_at IS NULL AND (sid IS NULL OR sid != ?)`,
    [Date.now(), userId, keepSid],
    db,
  );
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

/**
 * Marks every outstanding reset link for a user as used.
 *
 * Called before issuing a new link, so at most one reset token is ever live per
 * account: requesting a second link invalidates the first.
 */
export function invalidateOpenPasswordResets(userId: string, db: Db = getDb()): void {
  run('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL', [Date.now(), userId], db);
}

/** Housekeeping: drops reset rows that are long expired or already consumed. */
export function purgePasswordResets(olderThanMs: number, db: Db = getDb()): number {
  const result = run('DELETE FROM password_resets WHERE expires_at < ? AND used_at IS NOT NULL', [olderThanMs], db);
  return result.changes;
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
