/**
 * A deployment that has not configured Google Sign-In must say so plainly:
 * 503 with an operator-facing message, and `/health` reporting the capability
 * as `not-configured` so the app can hide the button instead of offering a
 * sign-in method that cannot work.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import type { FastifyInstance } from 'fastify';

const dir = mkdtempSync(join(tmpdir(), 'jarvis-google-off-'));

process.env.JARVIS_DB_FILE = join(dir, 'test.sqlite');
process.env.JARVIS_JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
process.env.JARVIS_LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';
delete process.env.JARVIS_GOOGLE_CLIENT_IDS;

let app: FastifyInstance;

before(async () => {
  const { buildServer } = await import('../src/server.js');
  ({ app } = await buildServer({ logger: false }));
  await app.ready();
});

after(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

test('Google sign-in reports itself as unavailable instead of failing silently', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/google',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ idToken: 'x'.repeat(40) }),
  });
  assert.equal(res.statusCode, 503);
  assert.match(res.body, /not enabled/i);

  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
  const capabilities = JSON.parse(health.body).capabilities;
  assert.equal(capabilities.google, 'not-configured');
});
