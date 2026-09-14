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
  revokeRefreshToken,
  updatePasswordHash,
} from '../repo/users.js';
import type { UserRow } from '../repo/rows.js';
import { newId } from '../lib/crypto.js';

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
    // Re-use of a revoked token indicates theft: kill the whole family.
    revokeAllRefreshTokens(row.user_id);
    throw AppError.unauthorized('This session was revoked. Please sign in again.');
  }
  if (row.expires_at < Date.now()) throw AppError.unauthorized('This session has expired. Please sign in again.');

  const user = findUserByIdForSession(row.user_id);
  revokeRefreshToken(row.id);
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

export interface PasswordResetRequest {
  /** Present only outside production, where no mail provider is configured. */
  devToken?: string;
}

export function requestPasswordReset(email: string): PasswordResetRequest {
  const user = findUserByEmail(email.toLowerCase());
  if (!user) {
    // Never disclose whether the address exists.
    return {};
  }
  const { token, hash } = createOpaqueToken(32);
  insertPasswordReset({ userId: user.id, tokenHash: hash, expiresAt: Date.now() + 60 * 60_000 });
  if (config.exposeDevSecrets) return { devToken: token };
  return {};
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
  revokeAllRefreshTokens(row.user_id);
  const user = usersRepo.findUserById(row.user_id);
  if (!user) throw AppError.notFound('Account not found');
  return user;
}

export async function changePassword(user: UserRow, currentPassword: string, newPassword: string): Promise<void> {
  const ok = await verifyPassword(currentPassword, user.password_hash);
  if (!ok) throw AppError.badRequest('Your current password is incorrect');
  const { hashPassword } = await import('../lib/crypto.js');
  updatePasswordHash(user.id, await hashPassword(newPassword));
  revokeAllRefreshTokens(user.id);
}
