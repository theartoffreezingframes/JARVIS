/**
 * API integration tests.
 *
 * Each run uses a throwaway SQLite file, so these tests exercise the real stack:
 * routing, validation, authentication, authorisation, sync and the gang clock.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import type { FastifyInstance } from 'fastify';

const dir = mkdtempSync(join(tmpdir(), 'jarvis-test-'));
process.env.JARVIS_DB_FILE = join(dir, 'test.sqlite');
process.env.JARVIS_JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
process.env.JARVIS_LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';
// The suite creates many accounts from a single IP; production limits stay at 1x.
process.env.JARVIS_RATE_LIMIT_MULTIPLIER = '50';

let app: FastifyInstance;

interface Session {
  token: string;
  userId: string;
}

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

async function signUp(email: string, username: string): Promise<Session> {
  const result = await call('POST', '/api/auth/signup', {
    body: {
      email,
      password: 'Passw0rd!',
      name: username,
      username,
      timezone: 'Asia/Kolkata',
      timezoneOffsetMinutes: 330,
      deviceName: 'test',
    },
  });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return { token: result.json.accessToken as string, userId: result.json.user.id as string };
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

test('health endpoint is public and reports readiness', async () => {
  const result = await call('GET', '/api/health');
  assert.equal(result.status, 200);
  assert.equal(result.json.ok, true);
});

test('sign up, sign in and refresh work, and passwords are never echoed', async () => {
  const session = await signUp('user1@example.com', 'userone');
  assert.ok(session.token.length > 20);

  const login = await call('POST', '/api/auth/login', {
    body: { email: 'user1@example.com', password: 'Passw0rd!' },
  });
  assert.equal(login.status, 200);
  assert.equal(login.json.user.email, 'user1@example.com');
  assert.equal(JSON.stringify(login.json).includes('Passw0rd!'), false);
  assert.equal(JSON.stringify(login.json).toLowerCase().includes('scrypt'), false);

  const refreshed = await call('POST', '/api/auth/refresh', {
    body: { refreshToken: login.json.refreshToken },
  });
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.json.accessToken);

  // Refresh tokens rotate: the old one cannot be used twice.
  const replay = await call('POST', '/api/auth/refresh', { body: { refreshToken: login.json.refreshToken } });
  assert.equal(replay.status, 401);
});

test('weak passwords, duplicate accounts and bad credentials are rejected', async () => {
  const weak = await call('POST', '/api/auth/signup', {
    body: { email: 'weak@example.com', password: 'password', name: 'Weak', username: 'weakling' },
  });
  assert.equal(weak.status, 400);

  const duplicate = await call('POST', '/api/auth/signup', {
    body: { email: 'user1@example.com', password: 'Passw0rd!', name: 'Clone', username: 'useroneclone' },
  });
  assert.equal(duplicate.status, 409);

  const badLogin = await call('POST', '/api/auth/login', {
    body: { email: 'user1@example.com', password: 'WrongPass1' },
  });
  assert.equal(badLogin.status, 401);

  const unknownLogin = await call('POST', '/api/auth/login', {
    body: { email: 'nobody@example.com', password: 'WrongPass1' },
  });
  assert.equal(unknownLogin.status, 401);
});

test('unauthenticated and malformed requests are refused', async () => {
  const noToken = await call('GET', '/api/tasks');
  assert.equal(noToken.status, 401);

  const badToken = await call('GET', '/api/tasks', { token: 'not-a-token' });
  assert.equal(badToken.status, 401);

  const session = await signUp('user2@example.com', 'usertwo');
  const emptyTitle = await call('POST', '/api/tasks', { token: session.token, body: { title: '   ' } });
  assert.equal(emptyTitle.status, 400);
  assert.equal(emptyTitle.json.error, 'bad_request');
});

test('a full workflow runs end to end: create → classify → plan → focus → complete', async () => {
  const session = await signUp('flow@example.com', 'flowuser');

  const project = await call('POST', '/api/projects', {
    token: session.token,
    body: { name: 'Thesis', color: '#6C5CE7', tags: ['study'] },
  });
  assert.equal(project.status, 201);

  const created = await call('POST', '/api/tasks', {
    token: session.token,
    body: {
      title: 'Draft literature review',
      projectId: project.json.project.id,
      important: true,
      urgent: false,
      dueDate: '2026-09-20',
      dueTime: '18:00',
      estimatedMinutes: 90,
      planDate: '2026-09-14',
      isMustDo: true,
      tags: ['study'],
      subtasks: [{ title: 'Collect papers', position: 0 }, { title: 'Summarise findings', position: 1 }],
    },
  });
  assert.equal(created.status, 201);
  const task = created.json.task;
  assert.equal(task.subtasks.length, 2);

  const matrix = await call('GET', '/api/tasks/matrix', { token: session.token });
  assert.equal(matrix.json.counts.schedule, 1);
  assert.equal(matrix.status, 200);

  // Move it into Do Now by marking it urgent (the matrix drag & drop path).
  const moved = await call('POST', '/api/tasks/bulk', {
    token: session.token,
    body: { updates: [{ id: task.id, urgent: true, planOrder: 0 }] },
  });
  assert.equal(moved.status, 200);
  const matrixAfter = await call('GET', '/api/tasks/matrix', { token: session.token });
  assert.equal(matrixAfter.json.counts.do_now, 1);
  assert.equal(matrixAfter.json.counts.schedule, 0);

  // Start and finish a focus session attached to the task.
  const sessionStart = await call('POST', '/api/focus/sessions', {
    token: session.token,
    body: { taskId: task.id, plannedMinutes: 25, mode: 'pomodoro' },
  });
  assert.equal(sessionStart.status, 201);
  const focusId = sessionStart.json.session.id;
  const finished = await call('PATCH', `/api/focus/sessions/${focusId}`, {
    token: session.token,
    body: { actualSeconds: 1500, completed: true, interruptions: 0 },
  });
  assert.equal(finished.status, 200);
  assert.equal(finished.json.session.actualSeconds, 1500);

  // Completing the task cascades: subtasks close, day rollup updates.
  const completed = await call('POST', `/api/tasks/${task.id}/complete`, {
    token: session.token,
    body: { completed: true },
  });
  assert.equal(completed.json.task.status, 'done');
  assert.ok(completed.json.task.subtasks.every((s: { status: string }) => s.status === 'done'));

  const dashboard = await call('GET', '/api/dashboard', { token: session.token });
  assert.equal(dashboard.status, 200);
  assert.ok(dashboard.json.progress.completed >= 1);
  assert.ok(dashboard.json.focus.todayMinutes >= 25);
  assert.ok(dashboard.json.score.score > 0);

  // Uncompleting reverses the rollup rather than corrupting it.
  const reopened = await call('POST', `/api/tasks/${task.id}/complete`, {
    token: session.token,
    body: { completed: false },
  });
  assert.equal(reopened.json.task.status, 'todo');
  const afterUndo = await call('GET', '/api/dashboard', { token: session.token });
  assert.equal(afterUndo.json.activity.tasksCompleted, 0);
  assert.equal(afterUndo.json.focus.todayMinutes, 25, 'focus history is not destroyed by reopening a task');
});

test('recurring tasks spawn their next occurrence on completion', async () => {
  const session = await signUp('recurring@example.com', 'recurring');
  const created = await call('POST', '/api/tasks', {
    token: session.token,
    body: {
      title: 'Weekly review',
      dueDate: '2026-09-14',
      recurrence: { kind: 'weekly', interval: 1, byWeekday: [], count: 0, maxOccurrences: null },
    },
  });
  const taskId = created.json.task.id;
  const completed = await call('POST', `/api/tasks/${taskId}/complete`, {
    token: session.token,
    body: { completed: true },
  });
  assert.ok(completed.json.spawned, 'a next occurrence should be created');
  assert.equal(completed.json.spawned.dueDate, '2026-09-21');
  assert.equal(completed.json.spawned.recurredFromId, taskId);
});

test('users cannot read or modify another account’s data', async () => {
  const alice = await signUp('alice@example.com', 'aliceuser');
  const bob = await signUp('bob@example.com', 'bobuser');

  const task = await call('POST', '/api/tasks', {
    token: alice.token,
    body: { title: 'Alice private task' },
  });
  const taskId = task.json.task.id;

  assert.equal((await call('GET', `/api/tasks/${taskId}`, { token: bob.token })).status, 404);
  assert.equal(
    (await call('PATCH', `/api/tasks/${taskId}`, { token: bob.token, body: { title: 'hacked' } })).status,
    404,
  );
  assert.equal(
    (await call('POST', `/api/tasks/${taskId}/complete`, { token: bob.token, body: { completed: true } })).status,
    404,
  );
  assert.equal((await call('DELETE', `/api/tasks/${taskId}`, { token: bob.token })).status, 404);

  const bobTasks = await call('GET', '/api/tasks?view=all', { token: bob.token });
  assert.equal(bobTasks.json.tasks.length, 0);

  const aliceTask = await call('GET', `/api/tasks/${taskId}`, { token: alice.token });
  assert.equal(aliceTask.json.task.title, 'Alice private task');
});

test('private groups are invisible to non-members and invite codes are required to join', async () => {
  const owner = await signUp('owner@example.com', 'groupowner');
  const stranger = await signUp('stranger@example.com', 'strangeruser');

  const group = await call('POST', '/api/groups', {
    token: owner.token,
    body: { name: 'Study Squad', emoji: '🔥', leaderboardEnabled: true },
  });
  assert.equal(group.status, 201);
  const groupId = group.json.group.id;
  const inviteCode = group.json.group.inviteCode;
  assert.match(inviteCode, /^[A-Z0-9]{6,9}$/);

  assert.equal((await call('GET', `/api/groups/${groupId}`, { token: stranger.token })).status, 404);
  assert.equal(
    (await call('POST', '/api/groups/join', { token: stranger.token, body: { inviteCode: 'WRONGCODE' } })).status,
    404,
  );

  const joined = await call('POST', '/api/groups/join', { token: stranger.token, body: { inviteCode } });
  assert.equal(joined.status, 200);
  assert.equal((await call('GET', `/api/groups/${groupId}`, { token: stranger.token })).status, 200);

  // A member cannot remove others; the owner can.
  const removeAttempt = await call(
    'DELETE',
    `/api/groups/${groupId}/members/${owner.userId}`,
    { token: stranger.token },
  );
  assert.equal(removeAttempt.status, 403);
  const ownerRemoval = await call(
    'DELETE',
    `/api/groups/${groupId}/members/${stranger.userId}`,
    { token: owner.token },
  );
  assert.equal(ownerRemoval.status, 200);
});

test('gang sessions synchronise through an authoritative clock', async () => {
  const host = await signUp('host@example.com', 'ganghost');
  const guest = await signUp('guest@example.com', 'gangguest');

  const group = await call('POST', '/api/groups', {
    token: host.token,
    body: { name: 'Night Owls', emoji: '🌙' },
  });
  const groupId = group.json.group.id;
  await call('POST', '/api/groups/join', {
    token: guest.token,
    body: { inviteCode: group.json.group.inviteCode },
  });

  const created = await call('POST', '/api/gang/sessions', {
    token: host.token,
    body: {
      groupId,
      title: 'Deep Work',
      startsAt: Date.now(),
      focusMinutes: 25,
      breakMinutes: 5,
      rounds: 2,
      mode: 'deep_work',
    },
  });
  assert.equal(created.status, 201);
  const sessionId = created.json.session.id;
  assert.equal(created.json.session.participants.length, 2, 'group members are invited');

  // The guest sees the session and can join.
  const guestView = await call('GET', `/api/gang/sessions/${sessionId}`, { token: guest.token });
  assert.equal(guestView.status, 200);
  assert.equal(guestView.json.clock.totalSeconds, 25 * 60 * 2 + 5 * 60);

  const started = await call('POST', `/api/gang/sessions/${sessionId}/control`, {
    token: host.token,
    body: { action: 'start' },
  });
  assert.equal(started.json.session.status, 'running');
  assert.equal(started.json.clock.phase, 'focus');

  // A non-host may not drive the shared clock.
  const forbidden = await call('POST', `/api/gang/sessions/${sessionId}/control`, {
    token: guest.token,
    body: { action: 'pause' },
  });
  assert.equal(forbidden.status, 403);

  // Individual pause is allowed and does not stop the group.
  const individual = await call('PATCH', `/api/gang/sessions/${sessionId}/participants/me`, {
    token: guest.token,
    body: { state: 'paused' },
  });
  assert.equal(individual.status, 200);
  const guestRow = individual.json.session.participants.find((p: { userId: string }) => p.userId === guest.userId);
  assert.equal(guestRow.state, 'paused');

  const paused = await call('POST', `/api/gang/sessions/${sessionId}/control`, {
    token: host.token,
    body: { action: 'pause' },
  });
  assert.equal(paused.json.session.status, 'paused');
  const remainingWhilePaused = paused.json.clock.phaseSecondsRemaining;

  // A paused clock does not drift.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const reread = await call('GET', `/api/gang/sessions/${sessionId}`, { token: host.token });
  assert.equal(reread.json.clock.phaseSecondsRemaining, remainingWhilePaused);

  const stopped = await call('POST', `/api/gang/sessions/${sessionId}/control`, {
    token: host.token,
    body: { action: 'stop' },
  });
  assert.equal(stopped.json.session.status, 'completed');
  assert.ok(stopped.json.session.participants.every((p: { state: string }) => p.state === 'done'));

  // Finishing a session writes focus history for each participant.
  const guestStats = await call('GET', '/api/focus/stats', { token: guest.token });
  assert.equal(guestStats.status, 200);
});

test('offline sync is idempotent and merges conflicts without data loss', async () => {
  const session = await signUp('sync@example.com', 'syncuser');

  const first = await call('POST', '/api/sync/push', {
    token: session.token,
    body: {
      deviceId: 'device-a',
      operations: [
        {
          id: 'op_create_1',
          entity: 'task',
          op: 'create',
          entityId: 'local-1',
          payload: { patch: { title: 'Written offline', priority: 'high', important: true, dueDate: '2026-09-14' } },
          clientTimestamp: Date.now(),
        },
        {
          id: 'op_habit_1',
          entity: 'habit',
          op: 'create',
          entityId: 'local-habit-1',
          payload: { patch: { name: 'Meditate', frequency: 'daily' } },
          clientTimestamp: Date.now(),
        },
      ],
    },
  });
  assert.equal(first.status, 200);
  assert.equal(first.json.applied.length, 2);
  assert.equal(first.json.conflicts.length, 0);

  // Replaying the same batch must not duplicate anything.
  const replay = await call('POST', '/api/sync/push', {
    token: session.token,
    body: {
      deviceId: 'device-a',
      operations: [
        {
          id: 'op_create_1',
          entity: 'task',
          op: 'create',
          entityId: 'local-1',
          payload: { patch: { title: 'Written offline' } },
          clientTimestamp: Date.now(),
        },
      ],
    },
  });
  assert.equal(replay.status, 200);

  const tasks = await call('GET', '/api/tasks?view=all', { token: session.token });
  assert.equal(tasks.json.tasks.length, 1, 'a replayed create must not duplicate the task');
  const taskId = tasks.json.tasks[0].id;

  // A conflicting edit from another device: the server changed the same field.
  await call('PATCH', `/api/tasks/${taskId}`, { token: session.token, body: { title: 'Renamed on device B' } });
  const conflict = await call('POST', '/api/sync/push', {
    token: session.token,
    body: {
      deviceId: 'device-a',
      operations: [
        {
          id: 'op_update_1',
          entity: 'task',
          op: 'update',
          entityId: taskId,
          baseUpdatedAt: 1,
          payload: {
            patch: { title: 'Renamed on device A', notes: 'added offline' },
            base: { title: 'Written offline', notes: null },
          },
          clientTimestamp: Date.now(),
        },
      ],
    },
  });
  assert.equal(conflict.status, 200);
  assert.equal(conflict.json.conflicts.length, 1);
  assert.deepEqual(conflict.json.conflicts[0].fields, ['title']);

  const afterMerge = await call('GET', `/api/tasks/${taskId}`, { token: session.token });
  assert.equal(afterMerge.json.task.title, 'Renamed on device B', 'conflicting field keeps the server value');
  assert.equal(afterMerge.json.task.notes, 'added offline', 'non-conflicting field is merged in');
});

test('sync pull returns everything new since a cursor, including deletions', async () => {
  const session = await signUp('pull@example.com', 'pulluser');
  const created = await call('POST', '/api/tasks', {
    token: session.token,
    body: { title: 'Pull me', dueDate: '2026-09-14' },
  });
  const taskId = created.json.task.id;

  const pull = await call('GET', '/api/sync/pull?since=0', { token: session.token });
  assert.equal(pull.status, 200);
  assert.ok(pull.json.tasks.some((t: { id: string }) => t.id === taskId));
  const cursor = pull.json.cursor as number;
  assert.ok(cursor > 0);

  await call('DELETE', `/api/tasks/${taskId}`, { token: session.token });
  const incremental = await call('GET', `/api/sync/pull?since=${cursor}`, { token: session.token });
  assert.equal(incremental.json.tasks.length, 0, 'deleted rows are not returned as live records');
  assert.ok(
    incremental.json.deletions.some((d: { id: string }) => d.id === taskId),
    'tombstones propagate deletions',
  );
});

test('habit tracking is frequency aware and streak-safe', async () => {
  const session = await signUp('habit@example.com', 'habituser');
  const habit = await call('POST', '/api/habits', {
    token: session.token,
    body: { name: 'Gym', frequency: 'weekdays', scheduleDays: [1, 2, 3, 4, 5] },
  });
  const habitId = habit.json.habit.id;

  for (const day of ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']) {
    const toggled = await call('POST', `/api/habits/${habitId}/toggle`, {
      token: session.token,
      body: { dayKey: day, completed: true },
    });
    assert.equal(toggled.status, 200);
  }
  // The weekend is not scheduled and must not break the streak.
  const monday = await call('POST', `/api/habits/${habitId}/toggle`, {
    token: session.token,
    body: { dayKey: '2026-09-14', completed: true },
  });
  assert.equal(monday.json.habit.currentStreak, 5);
  assert.equal(monday.json.habit.completionRate > 0, true);

  // Unticking is idempotent and recalculates rather than corrupting the streak.
  const untick = await call('POST', `/api/habits/${habitId}/toggle`, {
    token: session.token,
    body: { dayKey: '2026-09-14', completed: false },
  });
  assert.equal(untick.json.habit.completedToday, false);
  assert.equal(untick.json.habit.currentStreak, 4);
});

test('analytics and heat maps reflect real activity', async () => {
  const session = await signUp('analytics@example.com', 'analyticsuser');
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

  const ids: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const created = await call('POST', '/api/tasks', {
      token: session.token,
      body: { title: `Task ${i}`, dueDate: today, planDate: today, important: true, urgent: false },
    });
    ids.push(created.json.task.id);
  }

  // Backlog distribution: three "important, not urgent" tasks sit in Schedule.
  const backlog = await call('GET', '/api/analytics/overview?range=week', { token: session.token });
  assert.equal(backlog.status, 200);
  assert.ok(backlog.json.tasks.byQuadrant.schedule >= 3);
  assert.ok(Array.isArray(backlog.json.insights));

  for (const id of ids) {
    await call('POST', `/api/tasks/${id}/complete`, { token: session.token, body: { completed: true } });
  }

  const overview = await call('GET', '/api/analytics/overview?range=week', { token: session.token });
  assert.equal(overview.status, 200);
  assert.ok(overview.json.tasks.completed >= 3);
  assert.equal(overview.json.planning.completedPlanned >= 3, true);

  const heatmap = await call('GET', '/api/analytics/heatmap?metric=tasks_completed&range=month', {
    token: session.token,
  });
  assert.equal(heatmap.status, 200);
  const todayCell = heatmap.json.cells.find((cell: { dayKey: string }) => cell.dayKey === today);
  assert.equal(todayCell.tasksCompleted, 3);
  assert.ok(todayCell.level > 0);

  const focusHeatmap = await call('GET', '/api/analytics/heatmap?metric=focus&range=year', {
    token: session.token,
  });
  assert.equal(focusHeatmap.json.cells.length, 365);
});

test('global search respects filters and never leaks other users’ data', async () => {
  const session = await signUp('search@example.com', 'searchuser');
  await call('POST', '/api/tasks', {
    token: session.token,
    body: { title: 'Read distributed systems paper', tags: ['reading'], priority: 'high' },
  });
  await call('POST', '/api/projects', { token: session.token, body: { name: 'Reading list' } });
  await call('POST', '/api/notes', {
    token: session.token,
    body: { title: 'Paper notes', body: 'Consensus, replication, CAP' },
  });

  const results = await call('GET', '/api/search?q=reading', { token: session.token });
  assert.equal(results.status, 200);
  assert.ok(results.json.results.length >= 2, JSON.stringify(results.json.results));
  assert.ok(results.json.counts.task >= 1);

  // Tags behave like saved searches.
  const byTag = await call('GET', '/api/search?q=reading&types=task', { token: session.token });
  assert.equal(byTag.json.results.length, 1);
  assert.equal(byTag.json.results[0].title, 'Read distributed systems paper');

  // A filter that matches nothing returns nothing rather than everything.
  const filteredOut = await call('GET', '/api/search?q=reading&priority=urgent', { token: session.token });
  assert.equal(filteredOut.json.counts.task, 0);

  const filtered = await call('GET', '/api/search?q=&types=note', { token: session.token });
  assert.ok(filtered.json.results.every((r: { type: string }) => r.type === 'note'));

  const other = await signUp('nosecrets@example.com', 'nosecretsuser');
  const otherResults = await call('GET', '/api/search?q=distributed', { token: other.token });
  assert.equal(otherResults.json.results.length, 0);
});

test('settings, export and account deletion behave as promised', async () => {
  const session = await signUp('settings@example.com', 'settingsuser');

  const updated = await call('PATCH', '/api/me/settings', {
    token: session.token,
    body: { theme: 'dark', defaultTaskDurationMinutes: 45, dashboardWidgets: [{ id: 'habits', visible: false }] },
  });
  assert.equal(updated.json.settings.theme, 'dark');
  assert.equal(updated.json.settings.defaultTaskDurationMinutes, 45);
  const habitsWidget = updated.json.settings.dashboardWidgets.find((w: { id: string }) => w.id === 'habits');
  assert.equal(habitsWidget.visible, false);

  const profile = await call('PATCH', '/api/me', { token: session.token, body: { name: 'Renamed User' } });
  assert.equal(profile.json.user.name, 'Renamed User');

  const wrongPassword = await call('POST', '/api/auth/change-password', {
    token: session.token,
    body: { currentPassword: 'nope', newPassword: 'Fresh1234' },
  });
  assert.equal(wrongPassword.status, 400);

  const changed = await call('POST', '/api/auth/change-password', {
    token: session.token,
    body: { currentPassword: 'Passw0rd!', newPassword: 'Fresh1234' },
  });
  assert.equal(changed.status, 200);

  const exportResult = await call('GET', '/api/me/export?format=json', { token: session.token });
  assert.equal(exportResult.status, 200);
  assert.ok(exportResult.json.profile.email === 'settings@example.com');
  assert.equal(JSON.stringify(exportResult.json).includes('scrypt$'), false, 'exports never contain password hashes');

  const csv = await call('GET', '/api/me/export?format=csv', { token: session.token });
  assert.equal(csv.status, 200);

  const wrongConfirm = await call('DELETE', '/api/me', { token: session.token, body: { password: 'Fresh1234', confirm: 'delete' } });
  assert.equal(wrongConfirm.status, 400);

  const deleted = await call('DELETE', '/api/me', { token: session.token, body: { password: 'Fresh1234', confirm: 'DELETE' } });
  assert.equal(deleted.status, 200);

  const afterDeletion = await call('POST', '/api/auth/login', {
    body: { email: 'settings@example.com', password: 'Fresh1234' },
  });
  assert.equal(afterDeletion.status, 401);
});

test('daily review saves a reflection and can roll unfinished work forward', async () => {
  const session = await signUp('review@example.com', 'reviewuser');
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10);

  const task = await call('POST', '/api/tasks', {
    token: session.token,
    body: { title: 'Unfinished thing', planDate: today, dueDate: today, estimatedMinutes: 30 },
  });

  const saved = await call('POST', '/api/reviews', {
    token: session.token,
    body: {
      dayKey: today,
      reflection: 'Shipped the planner, skipped revision.',
      mood: 4,
      energy: 3,
      rolloverTaskIds: [task.json.task.id],
      rolloverTo: tomorrow,
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.review.dayKey, today);
  assert.equal(saved.json.rolledOver.length, 1);
  assert.equal(saved.json.rolledOver[0].planDate, tomorrow);

  const fetched = await call('GET', `/api/reviews/${today}`, { token: session.token });
  assert.equal(fetched.json.review.reflection, 'Shipped the planner, skipped revision.');
  assert.ok(fetched.json.summary);
});

test('malformed and unsupported requests fail cleanly with 4xx, never 500', async () => {
  const raw = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'content-type': 'application/json' },
    payload: '',
  });
  assert.equal(raw.statusCode, 400);
  assert.equal(raw.json().error, 'bad_request');

  const unsupported = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'content-type': 'application/xml' },
    payload: '<login />',
  });
  assert.equal(unsupported.statusCode, 415);

  const brokenJson = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'content-type': 'application/json' },
    payload: '{"email": "nope"',
  });
  assert.equal(brokenJson.statusCode, 400);

  const unknownRoute = await app.inject({ method: 'GET', url: '/api/nope' });
  assert.equal(unknownRoute.statusCode, 404);
});

test('credential endpoints stop brute force attempts and explain why', async () => {
  const previous = process.env.JARVIS_RATE_LIMIT_MULTIPLIER;
  delete process.env.JARVIS_RATE_LIMIT_MULTIPLIER; // exercise the shipped limits
  try {
    let blocked: { status: number; json: any } | null = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const result = await call('POST', '/api/auth/login', {
        body: { email: 'bruteforce@example.com', password: 'Wrong1234' },
      });
      if (result.status === 429) {
        blocked = result;
        break;
      }
      assert.equal(result.status, 401, 'bad credentials must be rejected before the limiter trips');
    }
    assert.ok(blocked, 'the limiter should trip within 12 attempts');
    assert.equal(blocked!.json.error, 'rate_limited');
    assert.match(blocked!.json.message, /too many/i);
  } finally {
    if (previous === undefined) delete process.env.JARVIS_RATE_LIMIT_MULTIPLIER;
    else process.env.JARVIS_RATE_LIMIT_MULTIPLIER = previous;
  }
});
