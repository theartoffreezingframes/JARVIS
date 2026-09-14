import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { config } from './env.js';
import { migrate } from './db/index.js';
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

  await app.register(cors, {
    origin: config.allowedOrigins.length
      ? config.allowedOrigins
      : config.allowAnyOriginInDev
        ? true
        : true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-device-id'],
    maxAge: 86_400,
  });
  await app.register(cookie, { secret: config.jwtSecret, hook: 'onRequest' });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  /* ----------------------------- hardening ------------------------------ */

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
      request.log.error({ err: error, requestId }, 'unhandled error');
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
      api.get('/health', async () => ({
        ok: true,
        service: 'jarvis-api',
        version: '1.0.0',
        time: Date.now(),
        realtimeClients: realtime.clientCount,
      }));

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
      await api.register(registerSearchRoutes);
      await api.register(registerSyncRoutes);
    },
    { prefix: '/api' },
  );

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

  return { app, realtime };
}
