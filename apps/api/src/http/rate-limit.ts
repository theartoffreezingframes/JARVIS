import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * In-process fixed-window rate limiter.
 *
 * Deliberately dependency-free and small: it protects the credential endpoints
 * (brute force) and the realtime handshake (socket spam) from a single node. In a
 * multi-instance deployment this is the one place to swap for Redis-backed
 * counters — the call sites do not change.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function consume(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }
  bucket.count += 1;
  return { allowed: bucket.count <= limit, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt };
}

export function clientKey(request: FastifyRequest, scope: string, extra?: string): string {
  const ip = request.ip || request.socket.remoteAddress || 'unknown';
  return `${scope}:${extra ?? ip}`;
}

/** Formatted like an HTTP 429 with a helpful message. */
/**
 * Limits are scaled by this multiplier. Automated test suites sign up far more
 * accounts from one IP than a real client ever would, so they raise it; the
 * production default of 1 keeps the shipped limits exactly as configured.
 */
function limitScale(): number {
  const raw = Number(process.env.JARVIS_RATE_LIMIT_MULTIPLIER ?? '1');
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

export function enforceRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  scope: string,
  limit: number,
  windowMs: number,
  extra?: string,
): void {
  const scaledLimit = Math.max(1, Math.floor(limit * limitScale()));
  const result = consume(clientKey(request, scope, extra), scaledLimit, windowMs);
  reply.header('x-ratelimit-remaining', String(result.remaining));
  reply.header('x-ratelimit-reset', String(Math.ceil(result.resetAt / 1000)));
  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    reply.header('retry-after', String(retryAfter));
    throw Object.assign(new Error('Too many attempts. Please try again in a moment.'), {
      statusCode: 429,
      code: 'rate_limited',
    });
  }
}

export function resetRateLimits(): void {
  buckets.clear();
}
