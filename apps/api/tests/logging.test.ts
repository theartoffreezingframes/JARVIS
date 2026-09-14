/**
 * Log-hygiene tests (phase 11).
 *
 * Credentials can reach a log line in two ways: as a *value in a URL* (the
 * realtime handshake and the password-reset page both carry `?token=…`) or as a
 * field in something we log (a request body, a user row, an error object).
 *
 * These tests boot the API with a real logger writing into an in-memory stream and
 * assert on what was actually written — not on what the code intends to write.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import test, { after, before } from 'node:test';
import type { FastifyInstance } from 'fastify';

const dir = mkdtempSync(join(tmpdir(), 'jarvis-log-'));
process.env.JARVIS_DB_FILE = join(dir, 'logging.sqlite');
process.env.JARVIS_JWT_SECRET = 'logging-test-secret-abcdefghijklmnopqrstuvwxyz';
process.env.JARVIS_LOG_LEVEL = 'info';
process.env.JARVIS_RATE_LIMIT_MULTIPLIER = '50';
delete process.env.NODE_ENV;

/** Everything the API logged during the test, as one searchable string. */
const lines: string[] = [];
const sink = new Writable({
  write(chunk: Buffer | string, _encoding, callback) {
    lines.push(String(chunk));
    callback();
  },
});

let app: FastifyInstance;

async function call(
  method: 'GET' | 'POST',
  url: string,
  options: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const hasBody = options.body !== undefined;
  const response = await app.inject({
    method,
    url,
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
    },
    payload: hasBody ? JSON.stringify(options.body) : undefined,
  });
  let json: unknown = null;
  try {
    json = response.json();
  } catch {
    json = null;
  }
  return { status: response.statusCode, json };
}

before(async () => {
  const { buildServer } = await import('../src/server.js');
  const built = await buildServer({ logger: { level: 'info', stream: sink } });
  app = built.app;
  await app.ready();
});

after(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

test('credentials in a request URL never reach the logs', async () => {
  const RESET_MARKER = 'reset-token-that-must-never-be-logged';
  const QUERY_MARKER = 'query-token-that-must-never-be-logged';

  // A valid access token, used the way a careless client would: in the query.
  const signup = await call('POST', '/api/auth/signup', {
    body: {
      email: 'logging@example.com',
      password: 'Passw0rd!',
      name: 'Logging',
      username: 'logginguser',
      timezone: 'Asia/Kolkata',
      timezoneOffsetMinutes: 330,
      deviceName: 'logging-test',
    },
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  const accessToken = signup.json.accessToken as string;

  // 1. A browser opening the emailed reset link.
  await call('GET', `/reset-password?token=${RESET_MARKER}`);
  // 2. A token in the query string of an API call (no longer accepted, but it is
  //    still a URL, and the URL is what gets logged).
  const queryAuth = await call('GET', `/api/tasks?token=${accessToken}`, { });
  assert.equal(queryAuth.status, 401, 'a token in the query string must not authenticate');
  // 3. A realtime handshake, which legitimately carries the token in the query.
  await call('GET', `/realtime?token=${accessToken}&sessionId=gng_test`);
  // 4. An unknown route carrying junk that happens to be credential-shaped.
  await call('GET', `/api/nope?access_token=${QUERY_MARKER}&filter=active`);

  const log = lines.join('');

  assert.ok(log.length > 0, 'the API did log something — useful logging was not removed');
  assert.equal(log.includes(RESET_MARKER), false, 'the reset token must never appear in a log');
  assert.equal(log.includes(accessToken), false, 'the access token must never appear in a log');
  assert.equal(log.includes(QUERY_MARKER), false, 'credential-shaped query values must never appear in a log');
  assert.match(log, /\[redacted\]/, 'the redaction is visible to an operator');
  assert.match(log, /\/api\/nope/, 'the route itself is still logged, so debugging keeps working');
  assert.match(log, /filter=active/, 'non-sensitive query parameters are still logged');
  // The password was in a request *body*; Fastify never logs bodies, and the
  // redaction net covers it if a future log line includes one.
  assert.equal(log.includes('Passw0rd!'), false, 'passwords must never appear in a log');
});

test('sanitizeUrl keeps paths and parameter names but removes secret values', async () => {
  const { sanitizeUrl } = await import('../src/lib/sanitize.js');
  assert.equal(sanitizeUrl('/api/tasks?token=abc123&filter=active'), '/api/tasks?token=[redacted]&filter=active');
  assert.equal(sanitizeUrl('/reset-password?token=abc123'), '/reset-password?token=[redacted]');
  assert.equal(sanitizeUrl('/realtime?access_token=abc&sessionId=gng_1'), '/realtime?access_token=[redacted]&sessionId=gng_1');
  assert.equal(sanitizeUrl('/api/me?password=hunter2'), '/api/me?password=[redacted]');
  assert.equal(sanitizeUrl('/api/tasks'), '/api/tasks');
  assert.equal(sanitizeUrl(''), '/');
  assert.equal(sanitizeUrl(undefined), '/');
  // A very long URL cannot be used to flood the log file.
  assert.ok(sanitizeUrl(`/api/tasks?cursor=${'x'.repeat(5_000)}`).length < 400);
});
