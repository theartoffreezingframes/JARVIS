import type { FastifyInstance } from 'fastify';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  resetPasswordSchema,
  signUpSchema,
} from '@jarvis/shared';
import { config } from '../env.js';
import { authenticate, bearerToken, requireUser } from '../http/auth-plugin.js';
import { enforceRateLimit } from '../http/rate-limit.js';
import { parseOrThrow } from '../lib/errors.js';
import { findRefreshToken, revokeAllRefreshTokens, revokeRefreshToken, audit, getSettingsRow } from '../repo/users.js';
import { hashToken } from '../lib/crypto.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { mapUser, parseSettings } from '../repo/mappers.js';
import {
  authenticateWithPassword,
  changePassword,
  issueTokens,
  registerUser,
  requestPasswordReset,
  resetPassword,
  rotateTokens,
} from '../services/auth.js';

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  /** Create an account and log straight in. */
  app.post('/auth/signup', async (request, reply) => {
    enforceRateLimit(request, reply, 'signup', 10, 60 * 60_000);
    const input = parseOrThrow(signUpSchema, request.body, 'Check the highlighted fields');
    const user = await registerUser({
      email: input.email,
      password: input.password,
      name: input.name,
      username: input.username,
      timezone: input.timezone,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes,
    });
    const tokens = issueTokens(user, input.deviceName ?? null);
    audit('auth.signup', { userId: user.id, ip: request.ip });
    return reply.status(201).send({
      user: mapUser(user),
      settings: parseSettings(user, getSettingsRow(user.id)),
      ...tokens,
    });
  });

  app.post('/auth/login', async (request, reply) => {
    const input = parseOrThrow(loginSchema, request.body);
    // Rate limit per email *and* per IP so credential stuffing is slowed down.
    enforceRateLimit(request, reply, 'login-ip', 30, 15 * 60_000);
    enforceRateLimit(request, reply, 'login-email', 10, 15 * 60_000, input.email);

    const user = await authenticateWithPassword(input.email, input.password);
    const tokens = issueTokens(user, input.deviceName ?? null);
    audit('auth.login', { userId: user.id, ip: request.ip });
    return reply.send({
      user: mapUser(user),
      settings: parseSettings(user, getSettingsRow(user.id)),
      ...tokens,
    });
  });

  app.post('/auth/refresh', async (request, reply) => {
    enforceRateLimit(request, reply, 'refresh', 120, 15 * 60_000);
    const input = parseOrThrow(refreshSchema, request.body);
    const { user, tokens } = rotateTokens(input.refreshToken);
    return reply.send({ user: mapUser(user), settings: parseSettings(user, getSettingsRow(user.id)), ...tokens });
  });

  /**
   * Signs out **this** device.
   *
   * Only the presented refresh token is revoked, so signing out on a phone keeps
   * a tablet signed in — genuine multi-device behaviour. Called without a refresh
   * token (a lost device, an admin action) it falls back to revoking every
   * session for the authenticated account.
   */
  app.post('/auth/logout', async (request, reply) => {
    const input = parseOrThrow(refreshSchema.partial(), request.body ?? {});
    const user = authenticate(request);
    if (input.refreshToken) {
      const row = findRefreshToken(hashToken(input.refreshToken));
      if (row) {
        revokeRefreshToken(row.id, 'logout');
        audit('auth.logout', { userId: row.user_id, ip: request.ip });
      }
    } else if (user) {
      revokeAllRefreshTokens(user.id, 'logout');
      audit('auth.logout_all', { userId: user.id, ip: request.ip });
    }
    reply.clearCookie?.('jarvis_at', { path: '/' });
    return reply.send({ ok: true });
  });

  app.post('/auth/forgot-password', async (request, reply) => {
    enforceRateLimit(request, reply, 'forgot', 6, 30 * 60_000);
    const input = parseOrThrow(forgotPasswordSchema, request.body);
    const result = await requestPasswordReset(input.email);
    audit('auth.forgot_password', { ip: request.ip });
    // Identical response whether or not the address exists, and whether or not
    // the mail provider accepted the message.
    return reply.send({
      ok: true,
      message: 'If that email is registered, a reset link is on its way. The link expires in 30 minutes.',
      // Development convenience only: never populated when NODE_ENV=production.
      ...(config.exposeDevSecrets && result.token ? { devToken: result.token } : {}),
      ...(config.exposeDevSecrets ? { devDelivered: Boolean(result.delivered) } : {}),
    });
  });

  app.post('/auth/reset-password', async (request, reply) => {
    enforceRateLimit(request, reply, 'reset', 20, 60 * 60_000);
    const input = parseOrThrow(resetPasswordSchema, request.body);
    const user = await resetPassword(input.token, input.password);
    audit('auth.reset_password', { userId: user.id, ip: request.ip });
    const tokens = issueTokens(user, null);
    return reply.send({
      user: mapUser(user),
      settings: parseSettings(user, getSettingsRow(user.id)),
      ...tokens,
    });
  });

  /** Current session bootstrap: used on cold start to validate a stored token. */
  app.get('/auth/session', async (request) => {
    const user = requireUser(request, true);
    return { user: mapUser(user), settings: request.settings!, serverTime: Date.now() };
  });

  app.post('/auth/change-password', async (request, reply) => {
    const user = requireUser(request);
    const input = parseOrThrow(changePasswordSchema, request.body);
    // Identify this device's session so it survives the change while every other
    // device is signed out.
    const claims = verifyAccessToken(bearerToken(request) ?? '');
    await changePassword(user, input.currentPassword, input.newPassword, claims?.sid ?? null);
    audit('auth.change_password', { userId: user.id, ip: request.ip });
    return reply.send({ ok: true, message: 'Password updated. Other devices have been signed out.' });
  });
}
