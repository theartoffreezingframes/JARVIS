import { config } from '../env.js';
import { createOpaqueToken, hashToken, verifyPassword } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { accessTokenExpiry, signAccessToken } from '../lib/tokens.js';
import {
  consumePasswordReset,
  createUser,
  findPasswordReset,
  findRefreshToken,
  findUserByEmail,
  findUserByUsername,
  insertPasswordReset,
  insertRefreshToken,
  markRefreshTokenUsed,
  revokeAllRefreshTokens,
  revokeOtherRefreshTokens,
  revokeRefreshToken,
  updatePasswordHash,
  invalidateOpenPasswordResets,
} from '../repo/users.js';
import type { UserRow } from '../repo/rows.js';
import { newId } from '../lib/crypto.js';
import { publicBaseUrl, sendPasswordResetEmail } from './email/mailer.js';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
}

export function issueTokens(user: UserRow, deviceName: string | null = null): IssuedTokens {
  const sessionId = newId('ses');
  const accessToken = signAccessToken({ sub: user.id, sid: sessionId });
  const { token: refreshToken, hash } = createOpaqueToken(48);
  insertRefreshToken({
    userId: user.id,
    tokenHash: hash,
    deviceName,
    sid: sessionId,
    expiresAt: Date.now() + config.refreshTokenTtlDays * 86_400_000,
  });
  return { accessToken, refreshToken, accessTokenExpiresAt: accessTokenExpiry() };
}

/** Refresh-token rotation: the old token is revoked the moment a new one is issued. */
export function rotateTokens(refreshToken: string, deviceName: string | null = null): { user: UserRow; tokens: IssuedTokens } {
  const hash = hashToken(refreshToken);
  const row = findRefreshToken(hash);
  if (!row) throw AppError.unauthorized('This session is no longer valid. Please sign in again.');
  if (row.revoked_at) {
    // Replaying a token that was already exchanged for a new one is the classic
    // theft signal: kill every session on the account. Tokens that were revoked
    // for another reason (sign-out, password change) are simply rejected — that
    // path is reachable by a buggy or offline client, and must not sign a user
    // out of their other devices.
    if (row.revoked_reason === 'rotated') {
      revokeAllRefreshTokens(row.user_id, 'admin');
      throw AppError.unauthorized('This session was revoked. Please sign in again.');
    }
    throw AppError.unauthorized('This session is no longer valid. Please sign in again.');
  }
  if (row.expires_at < Date.now()) throw AppError.unauthorized('This session has expired. Please sign in again.');

  const user = findUserByIdForSession(row.user_id);
  revokeRefreshToken(row.id, 'rotated');
  const tokens = issueTokens(user, deviceName ?? row.device_name);
  markRefreshTokenUsed(row.id);
  return { user, tokens };
}

function findUserByIdForSession(userId: string): UserRow {
  // Imported lazily to keep this module free of cycles.
  const { findUserById } = usersRepo;
  const user = findUserById(userId);
  if (!user) throw AppError.unauthorized('Account not found');
  return user;
}
import * as usersRepo from '../repo/users.js';

export async function registerUser(input: {
  email: string;
  password: string;
  name: string;
  username: string;
  timezone: string;
  timezoneOffsetMinutes: number;
}): Promise<UserRow> {
  const email = input.email.toLowerCase();
  const username = input.username.toLowerCase();
  if (findUserByEmail(email)) throw AppError.conflict('An account with that email already exists');
  if (findUserByUsername(username)) throw AppError.conflict('That username is taken');

  const { hashPassword } = await import('../lib/crypto.js');
  const passwordHash = await hashPassword(input.password);
  return createUser({
    email,
    username,
    name: input.name,
    passwordHash,
    timezone: input.timezone,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes,
  });
}

export async function authenticateWithPassword(email: string, password: string): Promise<UserRow> {
  const user = findUserByEmail(email.toLowerCase());
  // Always run a verification so response timing does not reveal account existence.
  const hash = user?.password_hash ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
  const ok = await verifyPassword(password, hash);
  if (!user || !ok) throw AppError.unauthorized('Email or password is incorrect');
  return user;
}

/**
 * Reset links live for 30 minutes. Short enough that a leaked mailbox snapshot
 * is not a permanent key, long enough for a real user to find the email.
 */
export const PASSWORD_RESET_TTL_MINUTES = 30;

export interface PasswordResetRequest {
  /**
   * The raw token. Returned to the caller only so a non-production environment
   * can hand it back to the developer when no mail provider is configured; the
   * route decides whether to expose it, and never does in production.
   */
  token?: string;
  /** True when a message was accepted by a configured provider. */
  delivered?: boolean;
  /** True when the address matched an account (never surfaced to clients). */
  matched?: boolean;
}

/**
 * Starts a password reset.
 *
 * Security properties:
 *  - the token is 32 random bytes, stored only as a SHA-256 hash;
 *  - issuing a new link invalidates any previously issued link for that account;
 *  - the caller cannot distinguish "sent" from "no such account";
 *  - delivery failures are logged server-side and never returned to the client.
 */
export async function requestPasswordReset(email: string): Promise<PasswordResetRequest> {
  const user = findUserByEmail(email.toLowerCase());
  if (!user) {
    // Never disclose whether the address exists.
    return { matched: false };
  }
  const { token, hash } = createOpaqueToken(32);
  invalidateOpenPasswordResets(user.id);
  insertPasswordReset({ userId: user.id, tokenHash: hash, expiresAt: Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000 });

  const result = await sendPasswordResetEmail({
    to: user.email,
    name: user.name,
    resetUrl: `${publicBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`,
    expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
  });

  return { token, delivered: result.ok, matched: true };
}

export async function resetPassword(token: string, newPassword: string): Promise<UserRow> {
  const row = findPasswordReset(hashToken(token));
  if (!row || row.used_at || row.expires_at < Date.now()) {
    throw AppError.badRequest('That reset link is invalid or has expired');
  }
  const { hashPassword } = await import('../lib/crypto.js');
  const passwordHash = await hashPassword(newPassword);
  updatePasswordHash(row.user_id, passwordHash);
  consumePasswordReset(row.id);
  revokeAllRefreshTokens(row.user_id, 'password');
  const user = usersRepo.findUserById(row.user_id);
  if (!user) throw AppError.notFound('Account not found');
  return user;
}

/**
 * Changes the password and signs out every *other* device.
 *
 * The session that performed the change keeps working (its `sid` is left alone,
 * so the caller's access token stays valid); every other session is revoked
 * immediately. If the session id cannot be determined, all sessions are revoked —
 * fail closed.
 */
export async function changePassword(
  user: UserRow,
  currentPassword: string,
  newPassword: string,
  keepSid: string | null = null,
): Promise<void> {
  const ok = await verifyPassword(currentPassword, user.password_hash);
  if (!ok) throw AppError.badRequest('Your current password is incorrect');
  const { hashPassword } = await import('../lib/crypto.js');
  updatePasswordHash(user.id, await hashPassword(newPassword));
  revokeOtherRefreshTokens(user.id, keepSid);
}
