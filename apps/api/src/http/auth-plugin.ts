import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { findUserById, getSettingsRow, sessionIsActive } from '../repo/users.js';
import { parseSettings } from '../repo/mappers.js';
import type { UserRow } from '../repo/rows.js';
import type { UserSettings } from '@jarvis/shared';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `authenticate`, or by `requireUser` when called directly. */
    user?: UserRow;
    settings?: UserSettings;
  }
}

/**
 * Bearer-token authentication.
 *
 * Access tokens are short lived and stateless; refresh tokens are opaque,
 * stored hashed, rotated on use and revocable. Every handler that touches user
 * data calls `requireUser`, which guarantees the row is scoped to the token
 * subject — there is no code path where a client-supplied id selects the owner.
 */
export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const cookie = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies?.jarvis_at;
  if (cookie) return cookie;
  // Deliberately no `?token=` support here: a token in a URL ends up in access
  // logs, browser history and referrers. The WebSocket handshake is the one place
  // that cannot use a header, and the gateway parses its own token (see
  // realtime/gateway.ts) instead of going through this function.
  return null;
}

export function authenticate(request: FastifyRequest): UserRow | null {
  if (request.user) return request.user;
  const token = bearerToken(request);
  if (!token) return null;
  const claims = verifyAccessToken(token);
  if (!claims) return null;
  // A revoked session (sign-out, password change or reset) stops working at once.
  if (!sessionIsActive(claims.sid)) return null;
  const user = findUserById(claims.sub);
  if (!user) return null;
  request.user = user;
  return user;
}

export function requireUser(request: FastifyRequest, settings = false): UserRow {
  const user = authenticate(request);
  if (!user) throw AppError.unauthorized('Your session has expired. Please sign in again.');
  if (settings) {
    request.settings = parseSettings(user, getSettingsRow(user.id));
  }
  return user;
}

export function userSettings(request: FastifyRequest, user: UserRow): UserSettings {
  if (request.settings) return request.settings;
  const parsed = parseSettings(user, getSettingsRow(user.id));
  request.settings = parsed;
  return parsed;
}

export function notFound(reply: FastifyReply): FastifyReply {
  return reply.status(404).send({ error: 'not_found', message: 'Not found' });
}
