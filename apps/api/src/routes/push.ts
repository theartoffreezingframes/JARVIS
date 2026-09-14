import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../env.js';
import { requireUser } from '../http/auth-plugin.js';
import { enforceRateLimit } from '../http/rate-limit.js';
import { parseOrThrow } from '../lib/errors.js';
import { listPushTokens, mapPushRegistration, removePushToken, registerPushToken } from '../repo/push.js';
import { audit } from '../repo/users.js';
import { dispatchPushToUser } from '../services/push/dispatch.js';
import { isValidPushToken } from '../services/push/expo.js';

/**
 * Device registration for remote push.
 *
 * Tokens are only ever stored against an authenticated user, are revocable, and
 * are never returned to clients in raw form. Delivery itself lives in
 * `services/push`; these routes only manage the register/list/revoke lifecycle.
 */
export async function registerPushRoutes(app: FastifyInstance): Promise<void> {
  const registerSchema = z.object({
    token: z.string().min(16).max(512),
    platform: z.enum(['android', 'ios', 'web']),
    deviceId: z.string().max(120).nullish(),
    deviceName: z.string().max(120).nullish(),
  });

  app.get('/push/tokens', async (request) => {
    const user = requireUser(request);
    return {
      enabled: config.push.enabled,
      tokens: listPushTokens(user.id).map(mapPushRegistration),
    };
  });

  app.post('/push/tokens', async (request, reply) => {
    const user = requireUser(request);
    enforceRateLimit(request, reply, 'push-register', 30, 60_000);
    const input = parseOrThrow(registerSchema, request.body, 'That device token could not be registered');
    if (!isValidPushToken(input.token)) {
      return reply.status(400).send({ error: 'bad_request', message: 'That is not a valid device token' });
    }
    const row = registerPushToken({
      userId: user.id,
      token: input.token,
      platform: input.platform,
      deviceId: input.deviceId ?? null,
      deviceName: input.deviceName ?? null,
    });
    return reply.status(201).send({ registration: mapPushRegistration(row), enabled: config.push.enabled });
  });

  app.delete('/push/tokens', async (request, reply) => {
    const user = requireUser(request);
    const input = parseOrThrow(z.object({ token: z.string().min(8).max(512) }), request.body, 'A device token is required');
    const removed = removePushToken(user.id, input.token);
    if (removed) audit('push.unregister', { userId: user.id, ip: request.ip });
    return reply.send({ ok: true, removed });
  });

  /**
   * Sends a single test notification to the caller's devices so a user can
   * confirm delivery works on their phone. Reports what actually happened rather
   * than claiming success.
   */
  app.post('/push/test', async (request, reply) => {
    const user = requireUser(request);
    enforceRateLimit(request, reply, 'push-test', 3, 5 * 60_000);
    if (!config.push.enabled) {
      return reply.status(503).send({ error: 'unavailable', message: 'Push notifications are disabled on this server' });
    }
    const devices = listPushTokens(user.id).filter((row) => row.enabled === 1);
    if (!devices.length) {
      return reply.status(400).send({ error: 'bad_request', message: 'No device is registered for notifications yet' });
    }
    const accepted = await dispatchPushToUser(user.id, {
      kind: 'daily_planning',
      title: 'JARVIS notifications are on',
      body: 'This is a test notification from your JARVIS server.',
      data: { kind: 'test' },
    });
    return reply.send({ ok: true, accepted, devices: devices.length });
  });
}
