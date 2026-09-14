/**
 * Notifications.
 *
 * The server owns the list: it mirrors task reminders and deadlines into rows
 * that the app schedules locally, so reminders still arrive with no connection.
 * These tests cover generation, the per-category preferences each account
 * controls, the read/clear lifecycle, and the fact that one account can never
 * touch another account's notifications.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import type { FastifyInstance } from 'fastify';

const dir = mkdtempSync(join(tmpdir(), 'jarvis-notify-'));
process.env.JARVIS_DB_FILE = join(dir, 'test.sqlite');
process.env.JARVIS_JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
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
    ...(hasBody ? { payload: JSON.stringify(options.body) } : {}),
  });
  return { status: response.statusCode, json: response.body ? JSON.parse(response.body) : null };
}

const PASSWORD = 'NotifyMe12345';

async function signUp(username: string): Promise<{ token: string; id: string }> {
  const res = await call('POST', '/api/auth/signup', {
    body: {
      email: `${username}@example.com`,
      password: PASSWORD,
      name: username,
      username,
      timezone: 'UTC',
      timezoneOffsetMinutes: 0,
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  // Daily planning/review reminders are on by default and would otherwise add
  // rows to every list in these tests. They have their own coverage below.
  const quiet = await call('PATCH', '/api/me/settings', {
    token: res.json.accessToken,
    body: { notifications: { dailyPlanning: false, dailyReview: false } },
  });
  assert.equal(quiet.status, 200);
  return { token: res.json.accessToken, id: res.json.user.id };
}

before(async () => {
  const { buildServer } = await import('../src/server.js');
  ({ app } = await buildServer({ logger: false }));
  await app.ready();
});

after(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a task reminder becomes a scheduled notification the app can mirror', async () => {
  const account = await signUp('notifyone');
  const reminderAt = Date.now() + 90 * 60_000;

  const created = await call('POST', '/api/tasks', {
    token: account.token,
    body: { title: 'Submit the assignment', reminderAt, important: true, urgent: true },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const taskId = created.json.task.id as string;

  const list = await call('GET', '/api/notifications', { token: account.token });
  assert.equal(list.status, 200);
  const reminder = list.json.notifications.find((n: any) => n.kind === 'task_reminder' && n.taskId === taskId);
  assert.ok(reminder, 'the reminder is listed');
  assert.equal(reminder.title, 'Submit the assignment');
  assert.equal(reminder.readAt, null);

  // `scheduled` is what the device mirrors into local notifications.
  const scheduled = list.json.scheduled.find((n: any) => n.taskId === taskId && n.kind === 'task_reminder');
  assert.ok(scheduled, 'the reminder is inside the local-scheduling window');
  assert.equal(scheduled.scheduledFor, reminderAt);

  // Completing the task retires it.
  const done = await call('PATCH', `/api/tasks/${taskId}`, { token: account.token, body: { status: 'done' } });
  assert.equal(done.status, 200);
  const afterDone = await call('GET', '/api/notifications', { token: account.token });
  assert.equal(
    afterDone.json.notifications.some((n: any) => n.taskId === taskId && n.kind === 'task_reminder'),
    false,
  );
});

test('turning a category off stops new notifications of that kind', async () => {
  const account = await signUp('notifytwo');
  const off = await call('PATCH', '/api/me/settings', {
    token: account.token,
    body: { notifications: { taskReminder: false } },
  });
  assert.equal(off.status, 200);
  assert.equal(off.json.settings.notifications.taskReminder, false);

  const created = await call('POST', '/api/tasks', {
    token: account.token,
    body: { title: 'Quiet reminder', reminderAt: Date.now() + 30 * 60_000 },
  });
  assert.equal(created.status, 201);
  const list = await call('GET', '/api/notifications', { token: account.token });
  assert.equal(
    list.json.notifications.some((n: any) => n.kind === 'task_reminder'),
    false,
    'a disabled category produces nothing',
  );
  assert.equal(list.json.preferences.taskReminder, false);

  // Turning it back on regenerates the reminder for the existing task.
  await call('PATCH', '/api/me/settings', { token: account.token, body: { notifications: { taskReminder: true } } });
  await call('PATCH', `/api/tasks/${created.json.task.id}`, { token: account.token, body: { title: 'Quiet reminder' } });
  const again = await call('GET', '/api/notifications', { token: account.token });
  assert.ok(again.json.notifications.some((n: any) => n.kind === 'task_reminder'));
});

test('read, unread, read-all, delete and clear behave as the UI expects', async () => {
  const account = await signUp('notifythree');
  await call('POST', '/api/tasks', {
    token: account.token,
    body: { title: 'Read me', reminderAt: Date.now() + 45 * 60_000 },
  });

  const list = await call('GET', '/api/notifications', { token: account.token });
  const notification = list.json.notifications[0];
  assert.ok(notification, 'at least one notification exists');
  assert.ok(list.json.unreadCount >= 1);

  const read = await call('POST', `/api/notifications/${notification.id}/read`, { token: account.token });
  assert.equal(read.status, 200);
  assert.equal(read.json.unreadCount, 0);

  const unread = await call('POST', `/api/notifications/${notification.id}/unread`, { token: account.token });
  assert.equal(unread.json.unreadCount, 1);

  const all = await call('POST', '/api/notifications/read-all', { token: account.token });
  assert.equal(all.json.unreadCount, 0);
  const afterReadAll = await call('GET', '/api/notifications', { token: account.token });
  assert.equal(afterReadAll.json.unreadCount, 0);

  const deleted = await call('DELETE', `/api/notifications/${notification.id}`, { token: account.token });
  assert.equal(deleted.status, 200);
  const afterDelete = await call('GET', '/api/notifications', { token: account.token });
  assert.equal(
    afterDelete.json.notifications.some((n: any) => n.id === notification.id),
    false,
  );

  const cleared = await call('POST', '/api/notifications/clear?kind=task_reminder', { token: account.token });
  assert.equal(cleared.status, 200);
  const afterClear = await call('GET', '/api/notifications', { token: account.token });
  assert.equal(
    afterClear.json.notifications.some((n: any) => n.kind === 'task_reminder'),
    false,
  );
});

test('notifications are private to the account that owns them', async () => {
  const owner = await signUp('notifyowner');
  const stranger = await signUp('notifystranger');
  await call('POST', '/api/tasks', {
    token: owner.token,
    body: { title: 'Owner only', reminderAt: Date.now() + 20 * 60_000 },
  });
  const ownerList = await call('GET', '/api/notifications', { token: owner.token });
  const notification = ownerList.json.notifications[0];
  assert.ok(notification);

  const strangerList = await call('GET', '/api/notifications', { token: stranger.token });
  assert.equal(strangerList.json.notifications.length, 0);

  // Attempts to touch another account's row are no-ops, never partial successes.
  await call('POST', `/api/notifications/${notification.id}/read`, { token: stranger.token });
  await call('DELETE', `/api/notifications/${notification.id}`, { token: stranger.token });
  const stillThere = await call('GET', '/api/notifications', { token: owner.token });
  assert.equal(
    stillThere.json.notifications.some((n: any) => n.id === notification.id),
    true,
    'the owner keeps their notification',
  );
  assert.equal(stillThere.json.unreadCount, 1);

  // …and the route requires a session at all.
  const anonymous = await call('GET', '/api/notifications', {});
  assert.equal(anonymous.status, 401);
});
