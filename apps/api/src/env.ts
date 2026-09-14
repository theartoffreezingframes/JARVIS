import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Configuration is environment-driven; every security-relevant default is
 * production-safe (no secrets in the repo, no wildcard CORS, secure cookies).
 */

function loadDotEnv(): void {
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const content = readFileSync(file, 'utf8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

loadDotEnv();

const isProduction = process.env.NODE_ENV === 'production';

function requiredSecret(): string {
  const value = process.env.JARVIS_JWT_SECRET;
  if (value && value.length >= 32) return value;
  if (isProduction) {
    throw new Error(
      'JARVIS_JWT_SECRET must be set to a random string of at least 32 characters in production.',
    );
  }
  // Dev-only fallback: a stable-per-boot secret so tokens survive hot reloads
  // within a session, but never a hard-coded value that could reach production.
  const devSecret = process.env.JARVIS_DEV_SECRET ?? randomBytes(32).toString('base64url');
  process.env.JARVIS_DEV_SECRET = devSecret;
  return devSecret;
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export const config = {
  isProduction,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number.parseInt(process.env.PORT ?? process.env.JARVIS_API_PORT ?? '4000', 10),
  host: process.env.JARVIS_API_HOST ?? '0.0.0.0',
  /** Public URL used in emails / links. */
  publicUrl: process.env.JARVIS_PUBLIC_URL ?? '',
  databaseFile: process.env.JARVIS_DB_FILE ?? resolve(process.cwd(), 'data/jarvis.sqlite'),
  jwtSecret: requiredSecret(),
  accessTokenTtlSeconds: Number.parseInt(process.env.JARVIS_ACCESS_TTL ?? String(60 * 60 * 2), 10),
  refreshTokenTtlDays: Number.parseInt(process.env.JARVIS_REFRESH_TTL_DAYS ?? '60', 10),
  /**
   * CORS: explicit allow-list. Empty list = reflect any origin (dev only), which
   * is what Expo Go / sandbox previews need. Production must set
   * JARVIS_ALLOWED_ORIGINS.
   */
  allowedOrigins: parseList(process.env.JARVIS_ALLOWED_ORIGINS),
  allowAnyOriginInDev: !isProduction,
  logLevel: process.env.JARVIS_LOG_LEVEL ?? (isProduction ? 'warn' : 'info'),
  /** Password reset links: in dev we return the token to the client (no mailer configured). */
  exposeDevSecrets: !isProduction && process.env.JARVIS_EXPOSE_DEV_SECRETS !== 'false',
  /** Real-time heartbeat interval for gang sessions, in ms. */
  realtimeHeartbeatMs: 15_000,
  trustProxy: process.env.JARVIS_TRUST_PROXY === 'true',
} as const;

export type Config = typeof config;
