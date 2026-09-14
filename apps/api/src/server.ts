import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { capabilityReport, config } from './env.js';
import { migrate } from './db/index.js';
import { consume, clientKey } from './http/rate-limit.js';
import { sendError, serializeError } from './lib/errors.js';
import { registerRealtime, type RealtimeBus } from './realtime/gateway.js';
import { registerAnalyticsRoutes } from './routes/analytics.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerFocusRoutes } from './routes/focus.js';
import { registerHabitRoutes } from './routes/habits.js';
import { registerNoteRoutes } from './routes/notes.js';
import { registerPlannerRoutes } from './routes/planner.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerReviewRoutes } from './routes/reviews.js';
import { registerSocialRoutes } from './routes/social.js';
import { registerSyncRoutes } from './routes/sync.js';
import { registerAccountRoutes } from './routes/account.js';
import { registerNotificationRoutes } from './routes/notifications.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerPushRoutes } from './routes/push.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Where the exported Expo web build lives (single-server deployment). */
export function webRoot(): string | null {
  const candidates = [
    process.env.JARVIS_WEB_ROOT,
    resolve(process.cwd(), 'public'),
    resolve(process.cwd(), '../mobile/dist'),
    resolve(process.cwd(), '../../apps/mobile/dist'),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.html'))) return candidate;
  }
  return null;
}

function registerStatic(app: FastifyInstance): void {
  const root = webRoot();
  if (!root) {
    app.log.info('No web build found — API only. Run `npm run build:web` to serve the app from here.');
    return;
  }
  app.log.info({ root }, 'Serving web build');

  app.get('/', (_request, reply) => reply.type('text/html').send(readFileSync(join(root, 'index.html'))));

  app.get('/*', (request, reply) => {
    const url = (request.raw.url ?? '/').split('?')[0] ?? '/';
    if (url.startsWith('/api') || url.startsWith('/realtime')) return reply.callNotFound();

    const relative = normalize(decodeURIComponent(url)).replace(/^(\.\.[/\\])+/, '');
    const target = join(root, relative);

    // Path traversal guard: the resolved path must stay inside the build root.
    if (!target.startsWith(resolve(root))) return reply.code(403).send({ error: 'forbidden' });

    if (existsSync(target) && statSync(target).isFile()) {
      const ext = extname(target);
      const immutable = /\.[0-9a-f]{8,}\.(js|css|woff2?|png|jpg|svg)$/i.test(target);
      reply.header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=60');
      return reply.type(MIME[ext] ?? 'application/octet-stream').send(readFileSync(target));
    }

    // SPA fallback: Expo Router resolves the route on the client.
    return reply.type('text/html').send(readFileSync(join(root, 'index.html')));
  });
}

/** pino-pretty is optional: never let pretty logs break a boot. */
function hasPrettyPrinter(): boolean {
  try {
    return Boolean(require.resolve('pino-pretty'));
  } catch {
    return false;
  }
}

/** Shared, leak-free health payload for `/health` and `/api/health`. */
function healthPayload(realtime: RealtimeBus): Record<string, unknown> {
  return {
    ok: true,
    status: 'healthy',
    service: 'jarvis-api',
    version: '1.0.0',
    env: config.nodeEnv,
    uptimeSeconds: Math.round(process.uptime()),
    time: Date.now(),
    realtimeClients: realtime.clientCount,
    capabilities: capabilityReport(),
  };
}

export interface BuildServerOptions {
  logger?: boolean;
  migrateDatabase?: boolean;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<{
  app: FastifyInstance;
  realtime: RealtimeBus;
}> {
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: config.logLevel,
            // Quiet, readable development logs; structured JSON in production.
            transport: config.isProduction || !hasPrettyPrinter()
              ? undefined
              : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
          },
    trustProxy: config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
    disableRequestLogging: config.isProduction,
  });

  if (options.migrateDatabase !== false) migrate();

  /**
   * CORS policy.
   *
   *  - An explicit `JARVIS_ALLOWED_ORIGINS` list is always honoured.
   *  - With no list, production allows **same-origin only** (no `Access-Control-
   *    Allow-Origin` header is emitted, so browsers block cross-origin reads).
   *    Native Android/iOS clients are unaffected: they do not enforce CORS.
   *  - Development reflects any origin so Expo Go, the web dev server and
   *    sandbox previews work without configuration.
   */
  await app.register(cors, {
    origin: config.allowedOrigins.length ? config.allowedOrigins : config.allowAnyOriginInDev,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-device-id'],
    maxAge: 86_400,
  });
  await app.register(cookie, { secret: config.jwtSecret, hook: 'onRequest' });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  /* ----------------------------- hardening ------------------------------ */

  /**
   * Broad per-IP ceiling on API traffic.
   *
   * Credential endpoints have their own tight limits (see `enforceRateLimit`);
   * this is the safety net that keeps a single misbehaving client from saturating
   * the process — including expensive read endpoints such as analytics. Limits
   * are per IP and per minute, and `/health` is never limited so monitoring keeps
   * working during an incident.
   */
  app.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0] ?? '';
    if (!url.startsWith('/api') || url === '/api/health') return;
    const ceiling = (config.isProduction ? 600 : 3_000) * config.rateLimitMultiplier;
    const result = consume(clientKey(request, 'global-api'), ceiling, 60_000);
    reply.header('x-ratelimit-remaining', String(result.remaining));
    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
      reply.header('retry-after', String(retryAfter));
      await reply.status(429).send({
        error: 'rate_limited',
        message: 'Too many requests. Please slow down and try again in a moment.',
      });
    }
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'SAMEORIGIN');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('permissions-policy', 'geolocation=(), microphone=(), camera=()');
    if (config.isProduction) {
      reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;
    const { status, body } = serializeError(error);
    if (status >= 500) {
      // Full detail (including the stack) stays in the server log; the client
      // receives only the generic message produced by serializeError.
      request.log.error({ err: error, requestId, url: request.url }, 'unhandled error');
    } else if (status === 429) {
      request.log.warn({ requestId, url: request.url, ip: request.ip }, 'rate limited');
    }
    void reply.status(status).send({ ...body, requestId });
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api')) {
      return reply.status(404).send({ error: 'not_found', message: `No route for ${request.method} ${request.url}` });
    }
    return reply.status(404).send({ error: 'not_found', message: 'Not found' });
  });

  /* ------------------------------- routes -------------------------------- */

  const realtime = registerRealtime(app);

  await app.register(
    async (api) => {
      api.get('/health', async () => healthPayload(realtime));

      await api.register(registerAuthRoutes);
      await api.register(registerAccountRoutes);
      await api.register(registerTaskRoutes);
      await api.register(registerProjectRoutes);
      await api.register(registerHabitRoutes);
      await api.register(registerFocusRoutes);
      await api.register(registerNoteRoutes);
      await api.register(registerPlannerRoutes);
      await api.register(registerAnalyticsRoutes);
      await api.register(registerReviewRoutes);
      await api.register(registerSocialRoutes);
      await api.register(registerNotificationRoutes);
      await api.register(registerPushRoutes);
      await api.register(registerSearchRoutes);
      await api.register(registerSyncRoutes);
    },
    { prefix: '/api' },
  );

  /**
   * Plain `/health` for container probes and uptime monitors. Reports only
   * liveness plus which optional capabilities are configured — never a secret,
   * a database path, or an environment dump.
   */
  app.get('/health', async () => healthPayload(realtime));

  registerStatic(app);

  app.get('/api', async () => ({
    name: 'JARVIS API',
    tagline: 'Capture → Prioritize → Plan → Focus → Complete → Review → Improve',
    version: '1.0.0',
    realtime: 'wss://<host>/realtime?token=<accessToken>&sessionId=<optional>',
    endpoints: [
      'POST /api/auth/signup', 'POST /api/auth/login', 'POST /api/auth/refresh',
      'GET  /api/auth/session', 'POST /api/auth/forgot-password', 'POST /api/auth/reset-password',
      'GET  /api/dashboard', 'GET  /api/tasks', 'POST /api/tasks', 'GET  /api/tasks/matrix',
      'POST /api/tasks/parse', 'POST /api/tasks/bulk', 'POST /api/tasks/quick-plan',
      'GET  /api/projects', 'GET  /api/habits', 'POST /api/focus/sessions', 'GET  /api/focus/stats',
      'GET  /api/calendar', 'GET  /api/planner', 'POST /api/planner/blocks',
      'GET  /api/analytics/overview', 'GET  /api/analytics/heatmap',
      'GET  /api/groups', 'POST /api/gang/sessions', 'POST /api/gang/sessions/:id/control',
      'GET  /api/search', 'POST /api/sync/push', 'GET /api/sync/pull',
    ],
  }));

  // Drain realtime sockets before the HTTP server finishes closing so clients
  // reconnect cleanly instead of hanging on a half-closed socket.
  app.addHook('onClose', async () => {
    realtime.stop();
  });

  return { app, realtime };
}
