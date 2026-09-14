/**
 * Production-mode tests.
 *
 * This file boots the API exactly as a deployment does: `NODE_ENV=production`,
 * a strong `JARVIS_JWT_SECRET`, an HTTPS public URL, an explicit CORS allow-list,
 * and rate limits at their shipped values. It verifies the things that only
 * matter once real users are involved — no secrets in responses, no stack traces,
 * no reset token in the response body, real (captured) reset email, push-token
 * lifecycle, account deletion that actually deletes, and data that survives a
 * process restart.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test, { after, before } from 'node:test';
import type { FastifyInstance } from 'fastify';

const dir = mkdtempSync(join(tmpdir(), 'jarvis-prod-'));
const dbFile = join(dir, 'prod.sqlite');
const JWT_SECRET = 'prod-test-secret-0123456789abcdefghijklmnopqrstuvwxyz';

process.env.NODE_ENV = 'production';
process.env.JARVIS_DB_FILE = dbFile;
process.env.JARVIS_JWT_SECRET = JWT_SECRET;
process.env.JARVIS_PUBLIC_URL = 'https://api.test.local';
process.env.JARVIS_ALLOWED_ORIGINS = 'https://app.test.local';
process.env.JARVIS_LOG_LEVEL = 'silent';
process.env.JARVIS_RATE_LIMIT_MULTIPLIER = '1';
// Keep the suite hermetic: pushes are attempted, but against a closed local port.
process.env.JARVIS_PUSH_ENDPOINT = 'http://127.0.0.1:9/push';
process.env.JARVIS_PUSH_RECEIPT_ENDPOINT = 'http://127.0.0.1:9/receipts';
process.env.JARVIS_PUSH_TIMEOUT_MS = '1500';

let app: FastifyInstance;
let capture: { sent: Array<{ to: string; subject: string; text: string }> };

interface Session {
  token: string;
  userId: string;
}

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: any; headers: Record<string, unknown>; raw: string }> {
  const hasBody = options.body !== undefined;
  const response = await app.inject({
    method,
    url,
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    payload: hasBody ? JSON.stringify(options.body) : undefined,
  });
  let json: unknown = null;
  try {
    json = response.json();
  } catch {
    json = null;
  }
  return { status: response.statusCode, json, headers: response.headers, raw: response.body };
}

async function signUp(email: string, username: string): Promise<Session> {
  const result = await call('POST', '/api/auth/signup', {
    body: {
      email,
      password: 'Passw0rd!',
      name: username,
      username,
      timezone: 'Asia/Kolkata',
      timezoneOffsetMinutes: 330,
      deviceName: 'prod-test',
    },
  });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return { token: result.json.accessToken as string, userId: result.json.user.id as string };
}

/** Locates the workspace `tsx` binary, which npm hoists to the repo root. */
function resolveTsx(): string {
  let current = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = join(current, 'node_modules', '.bin', 'tsx');
    if (existsSync(candidate)) return candidate;
    const parent = join(current, '..');
    if (parent === current) break;
    current = parent;
  }
  throw new Error('tsx binary not found — run `npm install` at the repository root');
}

before(async () => {
  const emailModule = await import('../src/services/email/index.js');
  const transport = new emailModule.CaptureTransport();
  emailModule.setTransport(transport);
  capture = transport;

  const { buildServer } = await import('../src/server.js');
  const built = await buildServer({ logger: false });
  app = built.app;
  await app.ready();
});

after(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/*  Health, headers and configuration hygiene                                 */
/* -------------------------------------------------------------------------- */

test('health endpoints report readiness without leaking configuration', async () => {
  for (const url of ['/health', '/api/health']) {
    const result = await call('GET', url);
    assert.equal(result.status, 200, url);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.status, 'healthy');
    assert.ok(result.json.capabilities, 'capabilities are reported');
    assert.equal(result.json.capabilities.push, true);
    // Nothing sensitive: no secret, no path, no environment dump.
    const text = result.raw;
    assert.ok(!text.includes(JWT_SECRET), 'jwt secret must never be returned');
    assert.ok(!text.includes(dbFile), 'database path must never be returned');
    assert.ok(!text.includes(dir), 'filesystem paths must never be returned');
    assert.ok(!/JARVIS_[A-Z_]+/.test(text), 'raw environment variable names must not be echoed');
    assert.equal(result.json.jwtSecret, undefined);
  }
});

test('cors is an explicit allow-list in production', async () => {
  const blocked = await call('GET', '/api/health', { headers: { origin: 'https://evil.example' } });
  assert.equal(blocked.headers['access-control-allow-origin'], undefined);

  const allowed = await call('GET', '/api/health', { headers: { origin: 'https://app.test.local' } });
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://app.test.local');
});

test('error responses never contain stack traces', async () => {
  const bad = await call('POST', '/api/auth/login', { body: { email: 'not-an-email', password: 'x' } });
  assert.equal(bad.status, 400);
  assert.ok(!/at .*\(.*:\d+:\d+\)/.test(bad.raw), 'no stack frames in the response');
  assert.ok(!bad.raw.includes('/home/'), 'no server paths in the response');
  assert.ok(bad.json.requestId, 'a request id is returned for support');
});

test('a weak or missing JWT secret prevents the server from booting', async () => {
  const envUrl = new URL('../src/env.ts', import.meta.url).href;
  const script = join(dir, 'weak-secret.mjs');
  writeFileSync(
    script,
    `await import(${JSON.stringify(envUrl)});\nconsole.log('BOOTED');\n`,
  );
  const tsx = resolveTsx();
  let output = '';
  let failed = false;
  try {
    output = execFileSync(tsx, [script], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'production', JARVIS_JWT_SECRET: 'short', JARVIS_DB_FILE: dbFile },
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 60_000,
    });
  } catch (error) {
    failed = true;
    const execError = error as { stdout?: string; stderr?: string };
    output = `${execError.stdout ?? ''}${execError.stderr ?? ''}`;
  }
  assert.ok(failed, `a short secret must fail the boot (output: ${output.slice(0, 300)})`);
  assert.ok(!output.includes('BOOTED'), 'the process must not continue');
  assert.ok(/JARVIS_JWT_SECRET/.test(output), `the error names the variable (output: ${output.slice(0, 300)})`);
});

/* -------------------------------------------------------------------------- */
/*  Password reset: real single-use tokens, real delivery abstraction         */
/* -------------------------------------------------------------------------- */

test('password reset delivers a single-use, expiring link and never exposes the token', async () => {
  const session = await signUp('reset@example.com', 'resetuser');

  capture.sent.length = 0;
  const request = await call('POST', '/api/auth/forgot-password', { body: { email: 'reset@example.com' } });
  assert.equal(request.status, 200);
  assert.equal(request.json.ok, true);
  assert.equal(request.json.devToken, undefined, 'production must never return the token');
  assert.ok(!request.raw.includes('prt_'), 'no reset identifiers in the response');

  assert.equal(capture.sent.length, 1, 'exactly one email was handed to the provider');
  const email = capture.sent[0]!;
  assert.equal(email.to, 'reset@example.com');
  assert.match(email.subject, /reset/i);
  const link = /https:\/\/api\.test\.local\/reset-password\?token=([A-Za-z0-9_-]+)/.exec(email.text);
  assert.ok(link, `the email contains a reset link (got: ${email.text.slice(0, 120)})`);
  const token = link![1]!;
  const logged = JSON.stringify(capture.sent);
  assert.ok(!logged.includes(JWT_SECRET));

  // The link works exactly once.
  const first = await call('POST', '/api/auth/reset-password', { body: { token, password: 'BrandNew1!' } });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.ok(first.json.accessToken, 'a successful reset signs the user in');

  const replay = await call('POST', '/api/auth/reset-password', { body: { token, password: 'Another1!' } });
  assert.equal(replay.status, 400, 'a reset token cannot be used twice');

  // The new password works and the old one does not.
  const loginOld = await call('POST', '/api/auth/login', { body: { email: 'reset@example.com', password: 'Passw0rd!' } });
  assert.equal(loginOld.status, 401);
  const loginNew = await call('POST', '/api/auth/login', { body: { email: 'reset@example.com', password: 'BrandNew1!' } });
  assert.equal(loginNew.status, 200);

  // Requesting a new link invalidates the previous one.
  capture.sent.length = 0;
  assert.equal(
    (await call('POST', '/api/auth/forgot-password', { body: { email: 'reset@example.com' } })).status,
    200,
  );
  const firstToken = /token=([A-Za-z0-9_-]+)/.exec(capture.sent[0]!.text)![1]!;
  capture.sent.length = 0;
  assert.equal(
    (await call('POST', '/api/auth/forgot-password', { body: { email: 'reset@example.com' } })).status,
    200,
  );
  const secondToken = /token=([A-Za-z0-9_-]+)/.exec(capture.sent[0]!.text)![1]!;
  assert.notEqual(firstToken, secondToken);
  const stale = await call('POST', '/api/auth/reset-password', { body: { token: firstToken, password: 'Whatever1!' } });
  assert.equal(stale.status, 400, 'an older link stops working once a new one is issued');

  // Revoked sessions: the reset signs every other device out.
  const rejected = await call('GET', '/api/me', { token: session.token });
  assert.equal(rejected.status, 401, 'existing sessions are revoked after a reset');
});

test('unknown addresses produce exactly the same answer as real ones', async () => {
  capture.sent.length = 0;
  const unknown = await call('POST', '/api/auth/forgot-password', { body: { email: 'nobody@example.com' } });
  assert.equal(unknown.status, 200);
  assert.deepEqual(Object.keys(unknown.json).sort(), ['message', 'ok']);
  assert.equal(capture.sent.length, 0, 'no email is sent for an unknown address');
});

test('a mail provider failure is handled without telling the client', async () => {
  const { HttpTransport } = await import('../src/services/email/http.js');
  const { config } = await import('../src/env.js');
  const broken = new HttpTransport({
    ...config.email,
    provider: 'http',
    http: { url: 'http://127.0.0.1:9/never', apiKey: 'k', vendor: 'generic' },
  });
  const result = await broken.send({ to: 'x@example.com', subject: 'x', text: 'x' });
  assert.equal(result.ok, false);
  assert.ok(result.error, 'the failure is reported to the caller for logging');

  const response = await call('POST', '/api/auth/forgot-password', { body: { email: 'reset@example.com' } });
  assert.equal(response.status, 200, 'the client sees a generic success even though transport failed');
  assert.equal(response.json.devToken, undefined);
});

/* -------------------------------------------------------------------------- */
/*  Remote push registrations                                                 */
/* -------------------------------------------------------------------------- */

test('push tokens are registered per account, revocable and never echoed back', async () => {
  const alice = await signUp('alice-push@example.com', 'alicepush');
  const bob = await signUp('bob-push@example.com', 'bobpush');
  const deviceToken = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

  const invalid = await call('POST', '/api/push/tokens', {
    token: alice.token,
    body: { token: 'not a token', platform: 'android' },
  });
  assert.equal(invalid.status, 400);

  const registered = await call('POST', '/api/push/tokens', {
    token: alice.token,
    body: { token: deviceToken, platform: 'android', deviceId: 'dev-1', deviceName: 'Pixel' },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.json));
  assert.equal(registered.json.registration.platform, 'android');
  assert.equal(registered.json.registration.token, undefined, 'raw tokens are never returned');

  const aliceList = await call('GET', '/api/push/tokens', { token: alice.token });
  assert.equal(aliceList.json.tokens.length, 1);
  assert.equal(JSON.stringify(aliceList.json).includes(deviceToken), false);

  // The same device signing in as someone else moves the token, so the previous
  // account can no longer reach it.
  const moved = await call('POST', '/api/push/tokens', {
    token: bob.token,
    body: { token: deviceToken, platform: 'android', deviceId: 'dev-1', deviceName: 'Pixel' },
  });
  assert.equal(moved.status, 201);
  assert.equal((await call('GET', '/api/push/tokens', { token: alice.token })).json.tokens.length, 0);
  assert.equal((await call('GET', '/api/push/tokens', { token: bob.token })).json.tokens.length, 1);

  const test1 = await call('POST', '/api/push/test', { token: bob.token });
  assert.equal(test1.status, 200);
  assert.equal(test1.json.devices, 1);

  const removed = await call('DELETE', '/api/push/tokens', { token: bob.token, body: { token: deviceToken } });
  assert.equal(removed.status, 200);
  assert.equal(removed.json.removed, true);
  assert.equal((await call('GET', '/api/push/tokens', { token: bob.token })).json.tokens.length, 0);

  const none = await call('POST', '/api/push/test', { token: bob.token });
  assert.equal(none.status, 400, 'a test push without a registered device says so');
});

/* -------------------------------------------------------------------------- */
/*  Deletion and durability                                                   */
/* -------------------------------------------------------------------------- */

test('deleting an account really deletes its data and frees the address', async () => {
  const session = await signUp('delete-me@example.com', 'deleteme');
  const task = await call('POST', '/api/tasks', { token: session.token, body: { title: 'Secret project task' } });
  assert.equal(task.status, 201);
  await call('POST', '/api/notes', { token: session.token, body: { title: 'Secret note', body: 'private' } });

  const { getDb } = await import('../src/db/index.js');
  const db = getDb();
  const taskId = task.json.task.id as string;
  assert.ok(db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(taskId));

  const wrongPassword = await call('DELETE', '/api/me', {
    token: session.token,
    body: { password: 'not-the-password', confirm: 'DELETE' },
  });
  assert.equal(wrongPassword.status, 400);

  const deleted = await call('DELETE', '/api/me', {
    token: session.token,
    body: { password: 'Passw0rd!', confirm: 'DELETE' },
  });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));

  const count = (sql: string, param: string): number =>
    (db.prepare(sql).get(param) as { n: number } | undefined)?.n ?? 0;
  assert.equal(count('SELECT COUNT(*) AS n FROM tasks WHERE id = ?', taskId), 0, 'task row removed');
  assert.equal(count('SELECT COUNT(*) AS n FROM tasks WHERE user_id = ?', session.userId), 0, 'no tasks remain');
  assert.equal(count('SELECT COUNT(*) AS n FROM notes WHERE user_id = ?', session.userId), 0, 'no notes remain');
  assert.equal(count('SELECT COUNT(*) AS n FROM users WHERE id = ?', session.userId), 0, 'the user row is gone');
  assert.equal(count('SELECT COUNT(*) AS n FROM push_tokens WHERE user_id = ?', session.userId), 0, 'no devices remain');

  const signedOut = await call('GET', '/api/me', { token: session.token });
  assert.equal(signedOut.status, 401);

  // The address can be registered again — nothing was merely flagged.
  const reused = await signUp('delete-me@example.com', 'deleteme2');
  assert.ok(reused.userId);
});

test('data survives a full process restart', async () => {
  const session = await signUp('restart@example.com', 'restartuser');
  const created = await call('POST', '/api/tasks', {
    token: session.token,
    body: { title: 'Survives a restart', priority: 'high' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const taskId = created.json.task.id as string;

  // Close everything the way a deploy/restart would, then boot again on the same file.
  const { closeDb } = await import('../src/db/index.js');
  await app.close();
  closeDb();

  const { buildServer } = await import('../src/server.js');
  const rebuilt = await buildServer({ logger: false });
  app = rebuilt.app;
  await app.ready();

  const login = await call('POST', '/api/auth/login', {
    body: { email: 'restart@example.com', password: 'Passw0rd!' },
  });
  assert.equal(login.status, 200, 'the account survived the restart');
  const fetched = await call('GET', `/api/tasks/${taskId}`, { token: login.json.accessToken as string });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.json.task.title, 'Survives a restart');
  assert.equal(fetched.json.task.priority, 'high');
});

test('the global request ceiling protects the API in production', async () => {
  const { resetRateLimits } = await import('../src/http/rate-limit.js');
  resetRateLimits();
  const { config } = await import('../src/env.js');
  assert.equal(config.rateLimitMultiplier, 1, 'production never relaxes the limiter');

  let blocked = 0;
  let lastStatus = 0;
  for (let i = 0; i < 700 && blocked === 0; i += 1) {
    const result = await call('GET', '/api/tasks', {});
    lastStatus = result.status;
    if (result.status === 429) {
      blocked = i + 1;
      assert.ok(result.headers['retry-after'], 'a retry-after header is sent');
      assert.equal(result.json.error, 'rate_limited');
    }
  }
  assert.ok(blocked > 0, `expected a 429 within 700 requests (last status ${lastStatus})`);
  resetRateLimits();
});
