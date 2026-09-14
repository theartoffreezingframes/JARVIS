import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Configuration is environment-driven; every security-relevant default is
 * production-safe (no secrets in the repo, no wildcard CORS, secure cookies).
 *
 * Nothing in here is ever sent to a client: `/health` reports only whether a
 * capability is configured, never a value.
 */

/* -------------------------------------------------------------------------- */
/*  Location independence                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The API directory, resolved from this file rather than from `process.cwd()`.
 *
 * Deployments start the server from many different working directories (systemd,
 * Docker, pm2, a repo root). Resolving storage relative to the source tree means
 * the database and backups always land in the same known place.
 */
export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(): void {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(packageRoot, '.env'),
    resolve(packageRoot, '../../.env'),
  ];
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
  if (value && value.length >= 32 && !WEAK_SECRETS.has(value.toLowerCase())) return value;
  if (isProduction) {
    const reason = !value
      ? 'is not set'
      : value.length < 32
        ? `is only ${value.length} characters long (needs at least 32)`
        : 'is a well-known placeholder value';
    throw new Error(
      `JARVIS_JWT_SECRET ${reason}. Generate one with: ` +
        `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`,
    );
  }
  // Dev-only fallback: a stable-per-boot secret so tokens survive hot reloads
  // within a session, but never a hard-coded value that could reach production.
  const devSecret = process.env.JARVIS_DEV_SECRET ?? randomBytes(32).toString('base64url');
  process.env.JARVIS_DEV_SECRET = devSecret;
  return devSecret;
}

/** Values that must never survive into a production deployment. */
const WEAK_SECRETS = new Set([
  'secret',
  'password',
  'changeme',
  'change-me',
  'test-secret-test-secret-test-secret',
  'your-secret-key-your-secret-key-1234',
  'development-secret-development-secret',
]);

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

/* -------------------------------------------------------------------------- */
/*  Storage                                                                   */
/* -------------------------------------------------------------------------- */

const dataDir = process.env.JARVIS_DATA_DIR
  ? resolve(process.env.JARVIS_DATA_DIR)
  : resolve(packageRoot, 'data');

const databaseFile = process.env.JARVIS_DB_FILE ? resolve(process.env.JARVIS_DB_FILE) : resolve(dataDir, 'jarvis.sqlite');
const backupDir = process.env.JARVIS_BACKUP_DIR ? resolve(process.env.JARVIS_BACKUP_DIR) : resolve(dataDir, 'backups');

/* -------------------------------------------------------------------------- */
/*  Email (password reset delivery)                                           */
/* -------------------------------------------------------------------------- */

export type EmailProviderKind = 'none' | 'smtp' | 'http';

/**
 * Email is modular: `smtp` speaks to any mail server, `http` speaks to a
 * transactional API (Resend, SendGrid, Postmark, or a generic JSON endpoint).
 * With neither configured the server still runs — it just cannot deliver reset
 * mail, and says so loudly at boot instead of pretending it sent something.
 */
const emailProviderKind: EmailProviderKind = (() => {
  const raw = (process.env.JARVIS_EMAIL_PROVIDER ?? '').trim().toLowerCase();
  if (raw === 'smtp' || raw === 'http') return raw;
  if (process.env.JARVIS_SMTP_HOST) return 'smtp';
  if (process.env.JARVIS_EMAIL_API_URL) return 'http';
  return 'none';
})();

export interface EmailConfig {
  readonly provider: EmailProviderKind;
  readonly from: string;
  readonly replyTo: string | null;
  /** Abort a provider request that takes longer than this (default 10 s). */
  readonly timeoutMs: number;
  readonly smtp: {
    readonly host: string;
    readonly port: number;
    /** true = implicit TLS (port 465), false = plaintext + STARTTLS upgrade (587). */
    readonly secure: boolean;
    readonly user: string | null;
    readonly password: string | null;
    readonly requireTls: boolean;
  };
  readonly http: {
    readonly url: string;
    readonly apiKey: string | null;
    readonly vendor: 'resend' | 'sendgrid' | 'postmark' | 'generic';
  };
}

const email: EmailConfig = {
  provider: emailProviderKind,
  from: process.env.JARVIS_EMAIL_FROM ?? 'JARVIS <no-reply@localhost>',
  replyTo: process.env.JARVIS_EMAIL_REPLY_TO ?? null,
  timeoutMs: parseInteger(process.env.JARVIS_EMAIL_TIMEOUT_MS, 10_000, 1_000, 120_000),
  smtp: {
    host: process.env.JARVIS_SMTP_HOST ?? '',
    port: parseInteger(process.env.JARVIS_SMTP_PORT, 587, 1, 65_535),
    secure: process.env.JARVIS_SMTP_SECURE === 'true' || parseInteger(process.env.JARVIS_SMTP_PORT, 587, 1, 65_535) === 465,
    user: process.env.JARVIS_SMTP_USER ?? null,
    password: process.env.JARVIS_SMTP_PASSWORD ?? null,
    requireTls: process.env.JARVIS_SMTP_REQUIRE_TLS !== 'false',
  },
  http: {
    url: process.env.JARVIS_EMAIL_API_URL ?? '',
    apiKey: process.env.JARVIS_EMAIL_API_KEY ?? null,
    vendor: (() => {
      const raw = (process.env.JARVIS_EMAIL_API_VENDOR ?? '').trim().toLowerCase();
      return raw === 'resend' || raw === 'sendgrid' || raw === 'postmark' ? raw : 'generic';
    })(),
  },
};

/* -------------------------------------------------------------------------- */
/*  Push notifications                                                        */
/* -------------------------------------------------------------------------- */

const push = {
  /**
   * Remote push uses Expo's push service, which needs no secret of its own for
   * the default project. Set JARVIS_PUSH_ENABLED=false to switch it off entirely.
   */
  enabled: process.env.JARVIS_PUSH_ENABLED !== 'false',
  endpoint: process.env.JARVIS_PUSH_ENDPOINT ?? 'https://exp.host/--/api/v2/push/send',
  receiptEndpoint: process.env.JARVIS_PUSH_RECEIPT_ENDPOINT ?? 'https://exp.host/--/api/v2/push/getReceipts',
  accessToken: process.env.JARVIS_PUSH_ACCESS_TOKEN ?? null,
  timeoutMs: parseInteger(process.env.JARVIS_PUSH_TIMEOUT_MS, 5_000, 500, 30_000),
};

/* -------------------------------------------------------------------------- */

export const config = {
  isProduction,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInteger(process.env.PORT ?? process.env.JARVIS_API_PORT, 4000, 1, 65_535),
  host: process.env.JARVIS_API_HOST ?? '0.0.0.0',
  /** Public HTTPS origin of this API — used for links in email and in docs. */
  publicUrl: (process.env.JARVIS_PUBLIC_URL ?? '').replace(/\/$/, ''),
  dataDir,
  databaseFile,
  backupDir,
  jwtSecret: requiredSecret(),
  accessTokenTtlSeconds: parseInteger(process.env.JARVIS_ACCESS_TTL, 60 * 60 * 2, 60, 60 * 60 * 24 * 30),
  refreshTokenTtlDays: parseInteger(process.env.JARVIS_REFRESH_TTL_DAYS, 60, 1, 365),
  /**
   * CORS: explicit allow-list. An empty list means "no cross-origin access" in
   * production; in development it reflects any origin so Expo Go and sandbox
   * previews work without configuration.
   */
  allowedOrigins: parseList(process.env.JARVIS_ALLOWED_ORIGINS),
  allowAnyOriginInDev: !isProduction,
  logLevel: process.env.JARVIS_LOG_LEVEL ?? (isProduction ? 'info' : 'info'),
  /** Password reset links: outside production the token may be returned so a
   *  developer without a mail server can still complete the flow. */
  exposeDevSecrets: !isProduction && process.env.JARVIS_EXPOSE_DEV_SECRETS !== 'false',
  /** Real-time heartbeat interval for gang sessions, in ms. */
  realtimeHeartbeatMs: parseInteger(process.env.JARVIS_REALTIME_HEARTBEAT_MS, 15_000, 5_000, 60_000),
  trustProxy: process.env.JARVIS_TRUST_PROXY === 'true',
  email,
  push,
  /**
   * Test suites sign up far more accounts from one IP than a real client ever
   * would, so they raise the multiplier. Production always uses 1 — the shipped
   * limits are never silently relaxed by an environment variable.
   */
  rateLimitMultiplier: isProduction ? 1 : parseInteger(process.env.JARVIS_RATE_LIMIT_MULTIPLIER, 1, 1, 10_000),
} as const;

export type Config = typeof config;

/** Feature flags for `/health`: presence only, never values. */
export function capabilityReport(): Record<string, string | boolean> {
  return {
    email: email.provider,
    emailFrom: email.provider === 'none' ? false : Boolean(email.from),
    push: push.enabled,
    cors: allowedOriginMode(),
    https: config.publicUrl.startsWith('https://'),
    trustProxy: config.trustProxy,
    database: config.isProduction ? 'configured' : 'development',
  };
}

function allowedOriginMode(): string {
  if (config.allowedOrigins.length) return `${config.allowedOrigins.length} origin(s) allow-listed`;
  return config.isProduction ? 'same-origin only' : 'reflect any origin (development)';
}

/**
 * Boot-time production checks.
 *
 * Hard failures (a weak secret) are thrown by `config` itself before this runs.
 * Everything else is reported so the operator sees exactly what is missing in the
 * logs, instead of discovering it when a user cannot reset a password.
 */
export function productionWarnings(): string[] {
  const warnings: string[] = [];
  if (!config.isProduction) return warnings;

  if (!config.allowedOrigins.length) {
    warnings.push(
      'JARVIS_ALLOWED_ORIGINS is empty: cross-origin browser requests are refused. ' +
        'Set it to your web origin (e.g. https://app.example.com) if you serve the web build from a different host.',
    );
  }
  if (!config.publicUrl.startsWith('https://')) {
    warnings.push(
      'JARVIS_PUBLIC_URL is missing or not HTTPS: password-reset links cannot be built. ' +
        'Set it to the public https origin of this API (e.g. https://api.example.com).',
    );
  }
  if (config.email.provider === 'none') {
    warnings.push(
      'No email provider configured (JARVIS_EMAIL_PROVIDER / JARVIS_SMTP_HOST / JARVIS_EMAIL_API_URL): ' +
        'password reset emails cannot be delivered. The API will answer identically but nothing will be sent.',
    );
  }
  if (!config.trustProxy) {
    warnings.push(
      'JARVIS_TRUST_PROXY is not "true": if this instance runs behind a reverse proxy, rate limiting will see the ' +
        'proxy address instead of the client address. Set it to true only when a trusted proxy is in front.',
    );
  }
  if (config.databaseFile.includes('/tmp/') || config.databaseFile.includes('/var/tmp/')) {
    warnings.push(
      `JARVIS_DB_FILE points at ${config.databaseFile}, which looks like an ephemeral location. ` +
        'Use a persistent volume or your data will be lost on redeploy.',
    );
  }
  return warnings;
}

/** Guard for callers that must not proceed without mail delivery. */
export function emailIsConfigured(): boolean {
  if (config.email.provider === 'smtp') return Boolean(config.email.smtp.host);
  if (config.email.provider === 'http') return Boolean(config.email.http.url);
  return false;
}
