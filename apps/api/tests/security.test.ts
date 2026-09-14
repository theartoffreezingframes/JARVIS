/**
 * Session and credential security tests.
 *
 * These cover the properties that decide whether a leaked token or a second
 * device can hurt an account: per-device sign-out, refresh-token rotation with
 * reuse detection, password changes that do not log the actor out but do log
 * everyone else out, and cross-account isolation of private data.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import type { FastifyInstance } from 'fastify';

const dir = mkdtempSync(join(tmpdir(), 'jarvis-sec-'));
process.env.JARVIS_DB_FILE = join(dir, 'security.sqlite');
process.env.JARVIS_JWT_SECRET = 'security-test-secret-abcdefghijklmnopqrstuvwxyz';
process.env.JARVIS_LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';
process.env.JARVIS_RATE_LIMIT_MULTIPLIER = '50';

let app: FastifyInstance;

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

interface Device {
  accessToken: string;
  refreshToken: string;
}

async function signUp(email: string, username: string): Promise<Device & { userId: string }> {
  const result = await call('POST', '/api/auth/signup', {
    body: {
      email,
      password: 'Passw0rd!',
      name: username,
      username,
      timezone: 'Asia/Kolkata',
      timezoneOffsetMinutes: 330,
    },
  });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return {
    accessToken: result.json.accessToken as string,
    refreshToken: result.json.refreshToken as string,
    userId: result.json.user.id as string,
  };
}

async function signIn(email: string): Promise<Device> {
  const result = await call('POST', '/api/auth/login', { body: { email, password: 'Passw0rd!' } });
  assert.equal(result.status, 200, JSON.stringify(result.json));
  return { accessToken: result.json.accessToken as string, refreshToken: result.json.refreshToken as string };
}

before(async () => {
  const { buildServer } = await import('../src/server.js');
  const built = await buildServer({ logger: false });
  app = built.app;
  await app.ready();
});

after(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test('signing out on one device leaves the other devices signed in', async () => {
  await signUp('multi@example.com', 'multiuser');
  const phone = await signIn('multi@example.com');
  const tablet = await signIn('multi@example.com');

  assert.equal((await call('GET', '/api/me', { token: phone.accessToken })).status, 200);
  assert.equal((await call('GET', '/api/me', { token: tablet.accessToken })).status, 200);

  const logout = await call('POST', '/api/auth/logout', {
    token: phone.accessToken,
    body: { refreshToken: phone.refreshToken },
  });
  assert.equal(logout.status, 200);

  // The phone is done: its session stops working immediately.
  assert.equal((await call('GET', '/api/me', { token: phone.accessToken })).status, 401);

  // The tablet is untouched — including its ability to refresh.
  assert.equal((await call('GET', '/api/me', { token: tablet.accessToken })).status, 200);
  const tabletRefresh = await call('POST', '/api/auth/refresh', { body: { refreshToken: tablet.refreshToken } });
  assert.equal(tabletRefresh.status, 200, 'the other device can still refresh');

  // A client that keeps using the signed-out refresh token is refused, and that
  // alone does not sign the other devices out.
  const phoneRefresh = await call('POST', '/api/auth/refresh', { body: { refreshToken: phone.refreshToken } });
  assert.equal(phoneRefresh.status, 401);
  assert.equal(
    (await call('GET', '/api/me', { token: tabletRefresh.json.accessToken as string })).status,
    200,
    'a stale sign-out token must not revoke the other devices',
  );
});

test('refresh tokens rotate, and replaying an old one revokes every session', async () => {
  await signUp('rotate@example.com', 'rotateuser');
  const first = await signIn('rotate@example.com');

  const rotated = await call('POST', '/api/auth/refresh', { body: { refreshToken: first.refreshToken } });
  assert.equal(rotated.status, 200);
  const second = { accessToken: rotated.json.accessToken as string, refreshToken: rotated.json.refreshToken as string };
  assert.notEqual(second.refreshToken, first.refreshToken, 'a new refresh token is issued');
  assert.equal((await call('GET', '/api/me', { token: second.accessToken })).status, 200);

  // Replaying the consumed token is treated as theft.
  const replay = await call('POST', '/api/auth/refresh', { body: { refreshToken: first.refreshToken } });
  assert.equal(replay.status, 401);
  assert.equal(
    (await call('GET', '/api/me', { token: second.accessToken })).status,
    401,
    'the whole family is revoked after a replay',
  );
  assert.equal(
    (await call('POST', '/api/auth/refresh', { body: { refreshToken: second.refreshToken } })).status,
    401,
  );
});

test('changing the password signs other devices out but keeps the actor signed in', async () => {
  await signUp('password@example.com', 'passworduser');
  const actor = await signIn('password@example.com');
  const other = await signIn('password@example.com');

  const changed = await call('POST', '/api/auth/change-password', {
    token: actor.accessToken,
    body: { currentPassword: 'Passw0rd!', newPassword: 'Rotated1234' },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));

  assert.equal((await call('GET', '/api/me', { token: actor.accessToken })).status, 200, 'the actor stays signed in');
  assert.equal((await call('GET', '/api/me', { token: other.accessToken })).status, 401, 'other devices are signed out');
  assert.equal(
    (await call('POST', '/api/auth/refresh', { body: { refreshToken: other.refreshToken } })).status,
    401,
  );

  const oldPassword = await call('POST', '/api/auth/login', {
    body: { email: 'password@example.com', password: 'Passw0rd!' },
  });
  assert.equal(oldPassword.status, 401);
  const newPassword = await call('POST', '/api/auth/login', {
    body: { email: 'password@example.com', password: 'Rotated1234' },
  });
  assert.equal(newPassword.status, 200);
});

test('one account cannot read, change or enumerate another account data', async () => {
  const alice = await signUp('iso-alice@example.com', 'isoalice');
  const bob = await signUp('iso-bob@example.com', 'isobob');

  const task = await call('POST', '/api/tasks', {
    token: alice.accessToken,
    body: { title: 'Alice private task', priority: 'high' },
  });
  assert.equal(task.status, 201, JSON.stringify(task.json));
  const taskId = task.json.task.id as string;

  assert.equal((await call('GET', `/api/tasks/${taskId}`, { token: bob.accessToken })).status, 404);
  assert.equal((await call('PATCH', `/api/tasks/${taskId}`, { token: bob.accessToken, body: { title: 'stolen' } })).status, 404);
  assert.equal((await call('DELETE', `/api/tasks/${taskId}`, { token: bob.accessToken })).status, 404);

  const bobTasks = await call('GET', '/api/tasks?view=all&limit=50', { token: bob.accessToken });
  assert.equal(
    (bobTasks.json.tasks as Array<{ id: string }>).some((item) => item.id === taskId),
    false,
    'another account never sees the task',
  );

  const bobSearch = await call('GET', '/api/search?q=Alice', { token: bob.accessToken });
  assert.equal(
    JSON.stringify(bobSearch.json).includes('Alice private task'),
    false,
    'search is scoped to the caller',
  );

  const aliceExport = await call('GET', '/api/me/export?format=json', { token: alice.accessToken });
  assert.ok(JSON.stringify(aliceExport.json).includes('Alice private task'));
  const bobExport = await call('GET', '/api/me/export?format=json', { token: bob.accessToken });
  assert.equal(JSON.stringify(bobExport.json).includes('Alice private task'), false);
});

test('group ownership is enforced server-side', async () => {
  const owner = await signUp('owner@example.com', 'groupowner');
  const member = await signUp('member@example.com', 'groupmember');
  const outsider = await signUp('outsider@example.com', 'groupoutsider');

  const group = await call('POST', '/api/groups', { token: owner.accessToken, body: { name: 'Private group' } });
  assert.equal(group.status, 201, JSON.stringify(group.json));
  const groupId = group.json.group.id as string;
  const inviteCode = group.json.group.inviteCode as string;

  const join = await call('POST', '/api/groups/join', { token: member.accessToken, body: { inviteCode } });
  assert.equal(join.status, 200, JSON.stringify(join.json));

  assert.equal((await call('GET', `/api/groups/${groupId}`, { token: outsider.accessToken })).status, 404, 'outsiders cannot see it');
  assert.equal((await call('GET', `/api/groups/${groupId}`, { token: member.accessToken })).status, 200);

  const memberDeletes = await call('DELETE', `/api/groups/${groupId}`, { token: member.accessToken });
  assert.notEqual(memberDeletes.status, 200, 'only the owner may delete the group');
  assert.equal((await call('GET', `/api/groups/${groupId}`, { token: owner.accessToken })).status, 200);

  const ownerDeletes = await call('DELETE', `/api/groups/${groupId}`, { token: owner.accessToken });
  assert.equal(ownerDeletes.status, 200, JSON.stringify(ownerDeletes.json));
});
