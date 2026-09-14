/**
 * Production-readiness acceptance tests.
 *
 * One test per named workflow the product must survive in the real world, written
 * against the real HTTP surface and a real SQLite file — including a genuine
 * server + database restart in the middle of the suite.
 *
 * Day keys are always taken from the server's own notion of "today" (which is
 * timezone aware), so the suite does not depend on the machine's clock.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { quadrantOf } from '@jarvis/shared';

const dir = mkdtempSync(join(tmpdir(), 'jarvis-acceptance-'));
const dbFile = join(dir, 'acceptance.sqlite');
process.env.JARVIS_DB_FILE = dbFile;
process.env.JARVIS_JWT_SECRET = 'acceptance-secret-acceptance-secret-acceptance';
process.env.JARVIS_LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';
process.env.JARVIS_RATE_LIMIT_MULTIPLIER = '50';

/** The signed-up accounts use this offset, so local time matches their day keys. */
const OFFSET_MINUTES = 330;

let app: FastifyInstance;
let closeDb: () => void;

interface Session {
  token: string;
  refreshToken: string;
  userId: string;
  day: string;
}

/** Boots a fresh server instance against the same database file. */
async function boot(): Promise<void> {
  const { buildServer } = await import('../src/server.js');
  const { closeDb: close } = await import('../src/db/index.js');
  closeDb = close;
  const built = await buildServer({ logger: false });
  app = built.app;
  await app.ready();
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

async function signUp(email: string, username: string, password = 'Passw0rd!'): Promise<Session> {
  const result = await call('POST', '/api/auth/signup', {
    body: {
      email,
      password,
      name: username,
      username,
      timezone: 'Asia/Kolkata',
      timezoneOffsetMinutes: OFFSET_MINUTES,
      deviceName: 'acceptance',
    },
  });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  const token = result.json.accessToken as string;
  const dashboard = await call('GET', '/api/dashboard', { token });
  return {
    token,
    refreshToken: result.json.refreshToken as string,
    userId: result.json.user.id as string,
    day: dashboard.json.today as string,
  };
}

/** Local wall-clock time on a given day, as an instant (ms). */
function localInstant(day: string, time: string): number {
  return Date.parse(`${day}T${time}:00Z`) - OFFSET_MINUTES * 60_000;
}

before(async () => {
  await boot();
});

after(async () => {
  await app?.close();
  closeDb?.();
  rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ 1. account */

test('workflow 1 — an account round-trips: sign up, sign out, sign back in, same workspace', async () => {
  const created = await signUp('roundtrip@example.com', 'roundtrip');
  const project = await call('POST', '/api/projects', {
    token: created.token,
    body: { name: 'Round trip', color: '#6C5CE7' },
  });
  const task = await call('POST', '/api/tasks', {
    token: created.token,
    body: { title: 'Survive a reinstall', projectId: project.json.project.id, important: true },
  });

  // Signing out kills this device's refresh token.
  const out = await call('POST', '/api/auth/logout', { token: created.token, body: { refreshToken: created.refreshToken } });
  assert.equal(out.status, 200);
  const reuse = await call('POST', '/api/auth/refresh', { body: { refreshToken: created.refreshToken } });
  assert.equal(reuse.status, 401, 'a revoked refresh token cannot be replayed');

  // Signing back in returns the same account and the work is still there.
  const login = await call('POST', '/api/auth/login', {
    body: { email: 'roundtrip@example.com', password: 'Passw0rd!', deviceName: 'acceptance-2' },
  });
  assert.equal(login.status, 200, JSON.stringify(login.json));
  assert.equal(login.json.user.id, created.userId, 'the account is the same, not a new one');

  const tasks = await call('GET', '/api/tasks?view=all', { token: login.json.accessToken });
  assert.equal(tasks.status, 200);
  assert.ok(tasks.json.tasks.some((row: { id: string }) => row.id === task.json.task.id));

  // A second device gets its own session, and settings are per account.
  const session = await call('GET', '/api/auth/session', { token: login.json.accessToken });
  assert.equal(session.status, 200);
  assert.equal(session.json.user.email, 'roundtrip@example.com');
  const patched = await call('PATCH', '/api/me/settings', { token: login.json.accessToken, body: { theme: 'dark' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.settings.theme, 'dark');
  assert.equal(patched.json.user.id, created.userId, 'the settings response carries the updated user too');

  // Expiry: an access token signed for the wrong secret is rejected.
  const forged = await call('GET', '/api/auth/session', { token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3JfZmFrZSJ9.not-a-real-signature' });
  assert.equal(forged.status, 401);

  // Password reset rotates the credential and invalidates the old one.
  const forgot = await call('POST', '/api/auth/forgot-password', { body: { email: 'roundtrip@example.com' } });
  assert.equal(forgot.status, 200);
  assert.ok(forgot.json.devToken, 'no mail provider in this deployment, so the token is returned in-app');
  const reset = await call('POST', '/api/auth/reset-password', {
    body: { token: forgot.json.devToken, password: 'Fresh1Pass!' },
  });
  assert.equal(reset.status, 200);
  const oldPassword = await call('POST', '/api/auth/login', {
    body: { email: 'roundtrip@example.com', password: 'Passw0rd!' },
  });
  assert.equal(oldPassword.status, 401, 'the previous password no longer works');
});

/* ------------------------------------------------------------------- 2. restart */

test('workflow 2 — a task survives a full server and database restart', async () => {
  const session = await signUp('restart@example.com', 'restart');
  const created = await call('POST', '/api/tasks', {
    token: session.token,
    body: {
      title: 'Survive the restart',
      important: true,
      urgent: true,
      dueDate: session.day,
      planDate: session.day,
      estimatedMinutes: 45,
    },
  });
  const taskId = created.json.task.id as string;

  // Close the HTTP server and the SQLite handle entirely, then boot again on the
  // same file — the same thing that happens when a phone reconnects to a server
  // that was restarted, or when the app itself is killed and relaunched.
  await app.close();
  closeDb();
  await boot();

  const reread = await call('GET', `/api/tasks/${taskId}`, { token: session.token });
  assert.equal(reread.status, 200, 'the row is still there after the restart');
  assert.equal(reread.json.task.title, 'Survive the restart');
  assert.equal(reread.json.task.estimatedMinutes, 45);

  const matrix = await call('GET', '/api/tasks/matrix', { token: session.token });
  assert.equal(matrix.json.counts.do_now, 1, 'classification is recomputed from the stored flags');

  const dashboard = await call('GET', '/api/dashboard', { token: session.token });
  assert.equal(dashboard.status, 200);
  assert.ok(dashboard.json.progress.planned >= 1, 'the day plan is intact');

  // The session survives the restart too — the phone is not signed out.
  const stillSignedIn = await call('GET', '/api/auth/session', { token: session.token });
  assert.equal(stillSignedIn.status, 200);
});

/* -------------------------------------------------------------------- 3. matrix */

test('workflow 3 — changing importance or urgency moves a task between quadrants instantly', async () => {
  const session = await signUp('matrix@example.com', 'matrixuser');
  const created = await call('POST', '/api/tasks', {
    token: session.token,
    body: { title: 'Classify me', important: false, urgent: false },
  });
  const id = created.json.task.id as string;

  const expectQuadrant = async (expected: string, label: string) => {
    const matrix = await call('GET', '/api/tasks/matrix', { token: session.token });
    const row = matrix.json.tasks.find((entry: { id: string }) => entry.id === id);
    assert.ok(row, `${label} → the task is on the board`);
    // The board stores flags; the quadrant the client paints is derived from them.
    assert.equal(quadrantOf({ important: row.important, urgent: row.urgent }), expected, `${label} → row quadrant`);
    assert.equal(matrix.json.counts[expected], 1, `${label} → ${expected} count`);
    for (const other of ['do_now', 'schedule', 'delegate', 'eliminate'].filter((q) => q !== expected)) {
      assert.equal(matrix.json.counts[other], 0, `${label} → ${other} empty`);
    }
  };

  await expectQuadrant('eliminate', 'neither flag');

  const urgentOnly = await call('PATCH', `/api/tasks/${id}`, { token: session.token, body: { urgent: true } });
  assert.equal(urgentOnly.status, 200);
  await expectQuadrant('delegate', 'urgent only');

  const important = await call('PATCH', `/api/tasks/${id}`, { token: session.token, body: { important: true } });
  assert.equal(important.status, 200);
  await expectQuadrant('do_now', 'important and urgent');

  const relaxed = await call('PATCH', `/api/tasks/${id}`, { token: session.token, body: { urgent: false } });
  assert.equal(relaxed.status, 200);
  await expectQuadrant('schedule', 'important only');

  // The drag & drop path (bulk replan) is equivalent to the field edit.
  await call('POST', '/api/tasks/bulk', { token: session.token, body: { updates: [{ id, important: false, urgent: true }] } });
  await expectQuadrant('delegate', 'bulk re-classify');
});

/* ------------------------------------------------------------------ 4. calendar */

test('workflow 4 — a scheduled task appears on the right calendar day at the right time', async () => {
  const session = await signUp('calendar@example.com', 'calendaruser');
  const day = session.day;
  const tomorrow = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

  const created = await call('POST', '/api/tasks', {
    token: session.token,
    body: { title: 'Standup', dueDate: day, dueTime: '09:30', estimatedMinutes: 30, planDate: day },
  });
  const id = created.json.task.id as string;

  const scheduled = await call('PATCH', `/api/tasks/${id}`, {
    token: session.token,
    body: { scheduledStart: localInstant(day, '09:30'), scheduledEnd: localInstant(day, '10:00') },
  });
  assert.equal(scheduled.status, 200, JSON.stringify(scheduled.json));
  assert.equal(scheduled.json.task.scheduledStart, localInstant(day, '09:30'));

  const calendar = await call('GET', `/api/calendar?from=${day}&to=${day}&view=day`, { token: session.token });
  assert.equal(calendar.status, 200);
  const row = calendar.json.tasks.find((task: { id: string }) => task.id === id);
  assert.ok(row, 'the task shows up on its day');
  assert.equal(row.dueDate, day);
  // The client renders these instants in the device's local time.
  assert.equal(new Date(row.scheduledStart).toISOString(), new Date(localInstant(day, '09:30')).toISOString());
  assert.equal(new Date(row.scheduledEnd).toISOString(), new Date(localInstant(day, '10:00')).toISOString());
  assert.equal(calendar.json.scheduled.filter((task: { id: string }) => task.id === id).length, 1, 'it is on the time grid');

  // Dragging it later rewrites the time on the same day.
  await call('POST', '/api/tasks/bulk', {
    token: session.token,
    body: { updates: [{ id, scheduledStart: localInstant(day, '14:00'), scheduledEnd: localInstant(day, '14:30') }] },
  });
  const moved = await call('GET', `/api/calendar?from=${day}&to=${day}&view=day`, { token: session.token });
  const movedRow = moved.json.tasks.find((task: { id: string }) => task.id === id);
  assert.equal(movedRow.scheduledStart, localInstant(day, '14:00'));

  // Moving it to another day removes it from the original one.
  await call('POST', '/api/tasks/bulk', {
    token: session.token,
    body: {
      updates: [
        {
          id,
          dueDate: tomorrow,
          planDate: tomorrow,
          scheduledStart: localInstant(tomorrow, '14:00'),
          scheduledEnd: localInstant(tomorrow, '14:30'),
        },
      ],
    },
  });
  const originalDay = await call('GET', `/api/calendar?from=${day}&to=${day}&view=day`, { token: session.token });
  assert.equal(originalDay.json.tasks.filter((task: { id: string }) => task.id === id).length, 0);
  const nextDay = await call('GET', `/api/calendar?from=${tomorrow}&to=${tomorrow}&view=day`, { token: session.token });
  assert.equal(nextDay.json.tasks.filter((task: { id: string }) => task.id === id).length, 1, 'it landed on the new day');

  // The planner reads the same records, so plan and calendar never disagree.
  const planner = await call('GET', `/api/planner?day=${tomorrow}`, { token: session.token });
  assert.equal(planner.status, 200);
  assert.ok(planner.json.plannedTasks.some((task: { id: string }) => task.id === id));

  // Unscheduling puts it back in the inbox rather than leaving a phantom block.
  const cleared = await call('PATCH', `/api/tasks/${id}`, {
    token: session.token,
    body: { scheduledStart: null, scheduledEnd: null, planDate: null },
  });
  assert.equal(cleared.status, 200);
  const afterClear = await call('GET', `/api/calendar?from=${tomorrow}&to=${tomorrow}&view=day`, { token: session.token });
  assert.equal(afterClear.json.scheduled.filter((task: { id: string }) => task.id === id).length, 0);
});

/* ------------------------------------------------------------------ 5. pomodoro */

test('workflow 5 — focus sessions recorded around a backgrounded timer keep their history', async () => {
  const session = await signUp('focus@example.com', 'focususer');
  const created = await call('POST', '/api/tasks', {
    token: session.token,
    body: { title: 'Write chapter', estimatedMinutes: 25 },
  });
  const taskId = created.json.task.id as string;

  // The phone starts a 25 minute block, then goes into the background. The client
  // derives the countdown from stored timestamps instead of counting ticks, so what
  // it writes on return is the wall-clock elapsed time.
  const started = await call('POST', '/api/focus/sessions', {
    token: session.token,
    body: { taskId, plannedMinutes: 25, mode: 'pomodoro' },
  });
  assert.equal(started.status, 201);
  const focusId = started.json.session.id as string;
  assert.equal(started.json.session.plannedMinutes, 25, 'the created session is returned in the client shape');
  assert.equal(started.json.session.completed, false);
  assert.equal(started.json.session.taskTitle, 'Write chapter');

  const finished = await call('PATCH', `/api/focus/sessions/${focusId}`, {
    token: session.token,
    body: { actualSeconds: 1500, completed: true, interruptions: 1 },
  });
  assert.equal(finished.status, 200);
  assert.equal(finished.json.session.actualSeconds, 1500);
  assert.equal(finished.json.session.completed, true);

  // A block the user abandons part-way still records the focus that really
  // happened: it is in the history and it counts towards the task's actual time.
  const partial = await call('POST', '/api/focus/sessions', {
    token: session.token,
    body: { taskId, plannedMinutes: 25, mode: 'pomodoro' },
  });
  await call('PATCH', `/api/focus/sessions/${partial.json.session.id}`, {
    token: session.token,
    body: { actualSeconds: 620, completed: false, interruptions: 2 },
  });

  const stats = await call('GET', '/api/focus/stats', { token: session.token });
  assert.equal(stats.status, 200);
  assert.equal(stats.json.stats.todayMinutes, 35, '25 + 10 minutes of real focus');

  const sessions = await call('GET', '/api/focus/sessions?limit=10', { token: session.token });
  const rows = sessions.json.sessions.filter(
    (row: { id: string }) => row.id === focusId || row.id === partial.json.session.id,
  );
  assert.equal(rows.length, 2, 'both blocks are in the history');
  assert.ok(rows.every((row: { taskId: string }) => row.taskId === taskId), 'each block links back to its task');

  const dashboard = await call('GET', '/api/dashboard', { token: session.token });
  assert.equal(dashboard.json.focus.todayMinutes, 35);
  assert.ok(dashboard.json.focus.sessionsToday >= 2);

  const task = await call('GET', `/api/tasks/${taskId}`, { token: session.token });
  assert.equal(task.json.task.actualMinutes, 35, 'estimate vs actual stays honest');

  // The heat map agrees with the session list — no fake activity anywhere.
  const heatmap = await call('GET', '/api/analytics/heatmap?days=30&metric=focus', { token: session.token });
  const todayCell = heatmap.json.cells.find((cell: { dayKey: string }) => cell.dayKey === session.day);
  assert.equal(todayCell.value, 35);
});

/* -------------------------------------------------------------------- 6. habits */

test('workflow 6 — completing a habit updates its streak and the heat map', async () => {
  const session = await signUp('habits@example.com', 'habituser');
  const habit = await call('POST', '/api/habits', {
    token: session.token,
    body: { name: 'Read 20 pages', frequency: 'daily', color: '#22C55E' },
  });
  assert.equal(habit.status, 201, JSON.stringify(habit.json));
  const habitId = habit.json.habit.id as string;
  assert.equal(habit.json.habit.currentStreak, 0);

  const checked = await call('POST', `/api/habits/${habitId}/toggle`, {
    token: session.token,
    body: { dayKey: session.day, completed: true },
  });
  assert.equal(checked.status, 200);
  assert.equal(checked.json.habit.completedToday, true);
  assert.equal(checked.json.habit.currentStreak, 1, 'the streak starts today');

  const heatmap = await call('GET', `/api/habits/heatmap?days=30&habitId=${habitId}`, { token: session.token });
  assert.equal(heatmap.status, 200);
  const todayCell = heatmap.json.cells.find((cell: { dayKey: string }) => cell.dayKey === session.day);
  assert.ok(todayCell, 'today has a cell');
  assert.equal(todayCell.value, 1, 'the heat map counts the real check-in');

  // The day rollup the dashboard reads is updated in the same request.
  const dashboard = await call('GET', '/api/dashboard', { token: session.token });
  assert.ok(dashboard.json.habitSummary.completedToday >= 1);

  // Unticking the same day reverses cleanly instead of corrupting the streak.
  const unchecked = await call('POST', `/api/habits/${habitId}/toggle`, {
    token: session.token,
    body: { dayKey: session.day, completed: false },
  });
  assert.equal(unchecked.json.habit.completedToday, false);
  assert.equal(unchecked.json.habit.currentStreak, 0);
  const afterUndo = await call('GET', `/api/habits/heatmap?days=30&habitId=${habitId}`, { token: session.token });
  assert.equal(afterUndo.json.cells.find((cell: { dayKey: string }) => cell.dayKey === session.day)?.value ?? 0, 0);

  // Re-checking is idempotent — an offline replay cannot double count.
  await call('POST', `/api/habits/${habitId}/toggle`, { token: session.token, body: { dayKey: session.day, completed: true } });
  const replay = await call('POST', `/api/habits/${habitId}/toggle`, {
    token: session.token,
    body: { dayKey: session.day, completed: true },
  });
  assert.equal(replay.json.habit.currentStreak, 1, 'still one day, not two');
});

/* ----------------------------------------------------------------------- 7. gang */

test('workflow 7 — two people in a gang session see consistent state and correct focus stats', async () => {
  const host = await signUp('synchost@example.com', 'synchost');
  const guest = await signUp('syncguest@example.com', 'syncguest');

  const group = await call('POST', '/api/groups', { token: host.token, body: { name: 'Sync Squad', emoji: '⚡' } });
  const groupId = group.json.group.id as string;
  await call('POST', '/api/groups/join', { token: guest.token, body: { inviteCode: group.json.group.inviteCode } });

  const created = await call('POST', '/api/gang/sessions', {
    token: host.token,
    body: {
      groupId,
      title: 'Shared deep work',
      startsAt: Date.now(),
      focusMinutes: 2,
      breakMinutes: 1,
      rounds: 1,
      mode: 'pomodoro',
    },
  });
  assert.equal(created.status, 201);
  const sessionId = created.json.session.id as string;
  assert.equal(created.json.session.participants.length, 2, 'both members are invited');

  await call('POST', `/api/gang/sessions/${sessionId}/control`, { token: host.token, body: { action: 'start' } });

  // Both devices compute the remaining time from the same authoritative anchor.
  const hostView = await call('GET', `/api/gang/sessions/${sessionId}`, { token: host.token });
  const guestView = await call('GET', `/api/gang/sessions/${sessionId}`, { token: guest.token });
  assert.equal(hostView.json.session.clockAnchorAt, guestView.json.session.clockAnchorAt, 'one shared anchor');
  assert.equal(hostView.json.clock.totalSeconds, guestView.json.clock.totalSeconds);
  assert.ok(Math.abs(hostView.json.clock.phaseSecondsRemaining - guestView.json.clock.phaseSecondsRemaining) <= 1);

  // Rather than sleeping through a whole pomodoro, advance the authoritative clock
  // the way the gateway ticker does and let the real accrual logic run.
  const { tickSession } = await import('../src/services/gang.js');
  const base = Date.now();
  const firstTick = tickSession(sessionId, base + 35_000);
  assert.equal(firstTick?.completed, false);
  const secondTick = tickSession(sessionId, base + 70_000);
  assert.equal(secondTick?.completed, false);
  const hostFocus = secondTick?.session.participants.find((row) => row.userId === host.userId)?.focusSeconds ?? 0;
  const guestFocus = secondTick?.session.participants.find((row) => row.userId === guest.userId)?.focusSeconds ?? 0;
  assert.equal(hostFocus, 60, 'wall-clock focus seconds are accrued for the host');
  assert.equal(guestFocus, 60, 'and for the guest, identically');

  // Individual state is per participant: leaving the desk does not stop the group.
  const guestState = await call('PATCH', `/api/gang/sessions/${sessionId}/participants/me`, {
    token: guest.token,
    body: { state: 'break' },
  });
  assert.equal(guestState.status, 200);
  assert.equal(
    guestState.json.session.participants.find((row: { userId: string }) => row.userId === guest.userId).state,
    'break',
  );
  const forbidden = await call('POST', `/api/gang/sessions/${sessionId}/control`, {
    token: guest.token,
    body: { action: 'stop' },
  });
  assert.equal(forbidden.status, 403, 'a member cannot end the session for everyone');

  // Running past the end finishes the session and writes focus history per person.
  const finished = tickSession(sessionId, base + 130_000);
  assert.equal(finished?.completed, true);
  assert.equal(finished?.session.status, 'completed');
  assert.ok(finished?.session.participants.every((row) => row.state === 'done'));

  const hostStats = await call('GET', '/api/focus/stats', { token: host.token });
  const guestStats = await call('GET', '/api/focus/stats', { token: guest.token });
  assert.equal(hostStats.json.stats.todayMinutes, 1, 'one minute of shared focus, from the real clock');
  assert.equal(guestStats.json.stats.todayMinutes, 1, 'the guest sees their own, equal figure');

  const guestSessions = await call('GET', '/api/focus/sessions?limit=5', { token: guest.token });
  assert.ok(
    guestSessions.json.sessions.some((row: { label: string | null }) => (row.label ?? '') === 'Gang: Shared deep work'),
    'the guest has their own focus record for the shared session',
  );

  // The leaderboard is computed from those same records, seven days back.
  const leaderboard = await call('GET', `/api/groups/${groupId}/leaderboard`, { token: guest.token });
  assert.equal(leaderboard.status, 200);

  // The session stays private to its members.
  const outsider = await signUp('syncoutsider@example.com', 'syncoutsider');
  const peek = await call('GET', `/api/gang/sessions/${sessionId}`, { token: outsider.token });
  assert.equal(peek.status, 404, 'a non-member cannot even see that the session exists');
});

/* -------------------------------------------------------------------- 8. offline */

test('workflow 8 — work created offline syncs on reconnect exactly once, without clobbering newer edits', async () => {
  const session = await signUp('offline@example.com', 'offlineuser');

  const push = {
    deviceId: 'device-plane-mode',
    operations: [
      {
        id: 'op_create_1',
        entity: 'task',
        op: 'create',
        entityId: 'tsk_local_offline_1',
        payload: {
          patch: { title: 'Written on a plane', important: true, urgent: true, dueDate: session.day, estimatedMinutes: 30 },
        },
        clientTimestamp: Date.now(),
      },
    ],
  };

  const first = await call('POST', '/api/sync/push', { token: session.token, body: push });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.applied.length, 1);
  assert.equal(first.json.conflicts.length, 0);
  const serverTaskId = first.json.applied[0].serverId as string;
  assert.ok(serverTaskId?.startsWith('tsk_'), 'the server hands back its own id for the local row');

  // Replaying the same queue (the phone reconnecting twice) must not duplicate it.
  const replay = await call('POST', '/api/sync/push', { token: session.token, body: push });
  assert.equal(replay.json.applied[0].serverId, serverTaskId, 'the same client id resolves to the same row');
  const listed = await call('GET', '/api/tasks?view=all', { token: session.token });
  assert.equal(
    listed.json.tasks.filter((task: { title: string }) => task.title === 'Written on a plane').length,
    1,
    'exactly one row, however many times the queue is replayed',
  );

  // The queued create captured the classification, so it is already on the board.
  const matrix = await call('GET', '/api/tasks/matrix', { token: session.token });
  assert.equal(matrix.json.counts.do_now, 1);

  // A queued edit from the offline device is applied on top of the server row.
  const edit = await call('POST', '/api/sync/push', {
    token: session.token,
    body: {
      deviceId: 'device-plane-mode',
      operations: [
        {
          id: 'op_update_1',
          entity: 'task',
          op: 'update',
          entityId: serverTaskId,
          payload: { patch: { title: 'Written on a plane (edited offline)' } },
          clientTimestamp: Date.now(),
        },
      ],
    },
  });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  const after = await call('GET', `/api/tasks/${serverTaskId}`, { token: session.token });
  assert.equal(after.json.task.title, 'Written on a plane (edited offline)');

  // The change is delivered to the *other* device on the next pull.
  const pull = await call('GET', '/api/sync/pull?since=0', { token: session.token });
  assert.equal(pull.status, 200);
  assert.ok(
    pull.json.tasks.some((task: { id: string }) => task.id === serverTaskId),
    'the pull carries the row the other device needs',
  );
  assert.ok(pull.json.cursor > 0, 'and a cursor to resume from');

  // Even a queue that lost the id map (fresh install, stale queue) lands on the row
  // it created instead of creating a copy or failing.
  const stale = await call('POST', '/api/sync/push', {
    token: session.token,
    body: {
      deviceId: 'device-fresh-install',
      operations: [
        {
          id: 'op_stale_replay',
          entity: 'task',
          op: 'create',
          entityId: 'tsk_local_offline_1',
          payload: { patch: { title: 'Written on a plane (edited offline)', estimatedMinutes: 30 } },
          clientTimestamp: Date.now(),
        },
      ],
    },
  });
  assert.equal(stale.status, 200, JSON.stringify(stale.json));
  assert.equal(stale.json.applied[0].serverId, serverTaskId, 'it resolves to the existing row');
  const afterStale = await call('GET', '/api/tasks?view=all', { token: session.token });
  assert.equal(afterStale.json.tasks.length, 1, 'and creates no duplicate');

  // A queued completion while offline still completes on reconnect.
  const complete = await call('POST', '/api/sync/push', {
    token: session.token,
    body: {
      deviceId: 'device-plane-mode',
      operations: [
        {
          id: 'op_toggle_1',
          entity: 'task',
          op: 'toggle',
          entityId: serverTaskId,
          payload: { completed: true },
          clientTimestamp: Date.now(),
        },
      ],
    },
  });
  assert.equal(complete.status, 200, JSON.stringify(complete.json));
  const done = await call('GET', `/api/tasks/${serverTaskId}`, { token: session.token });
  assert.equal(done.json.task.status, 'done');
});

/* ----------------------------------------------------------------- isolation */

test('workflow 9 — two accounts can never see each other’s data', async () => {
  const alice = await signUp('iso.alice@example.com', 'isoalice');
  const bob = await signUp('iso.bob@example.com', 'isobob');

  const aliceProject = await call('POST', '/api/projects', { token: alice.token, body: { name: 'Alice private' } });
  const aliceTask = await call('POST', '/api/tasks', {
    token: alice.token,
    body: { title: 'Alice secret task', projectId: aliceProject.json.project.id, important: true, planDate: alice.day },
  });
  const aliceNote = await call('POST', '/api/notes', { token: alice.token, body: { title: 'Alice note', body: 'private' } });
  const aliceHabit = await call('POST', '/api/habits', {
    token: alice.token,
    body: { name: 'Alice habit', frequency: 'daily' },
  });
  const aliceGroup = await call('POST', '/api/groups', { token: alice.token, body: { name: 'Alice group' } });

  const aliceIds: Record<string, string> = {
    project: aliceProject.json.project.id,
    task: aliceTask.json.task.id,
    note: aliceNote.json.note.id,
    habit: aliceHabit.json.habit.id,
    group: aliceGroup.json.group.id,
  };

  // Direct reads by id are 404s, not "here is someone else's row".
  for (const [entity, id] of Object.entries(aliceIds)) {
    const plural = entity === 'habit' ? 'habits' : entity === 'group' ? 'groups' : `${entity}s`;
    const read = await call('GET', `/api/${plural}/${id}`, { token: bob.token });
    assert.equal(read.status, 404, `bob cannot read alice's ${entity}`);
  }

  // List endpoints never leak.
  const bobTasks = await call('GET', '/api/tasks?view=all', { token: bob.token });
  assert.equal(bobTasks.json.tasks.length, 0);
  const bobProjects = await call('GET', '/api/projects', { token: bob.token });
  assert.equal(bobProjects.json.projects.length, 0);
  const bobNotes = await call('GET', '/api/notes', { token: bob.token });
  assert.equal(bobNotes.json.notes.length, 0);
  const bobHabits = await call('GET', '/api/habits', { token: bob.token });
  assert.equal(bobHabits.json.habits.length, 0);
  const bobGroups = await call('GET', '/api/groups', { token: bob.token });
  assert.equal(bobGroups.json.groups.length, 0);

  // Search, analytics and the dashboard are scoped too.
  const search = await call('GET', '/api/search?q=Alice', { token: bob.token });
  assert.equal(search.status, 200);
  assert.equal(search.json.results.length, 0);
  const bobDashboard = await call('GET', '/api/dashboard', { token: bob.token });
  assert.equal(bobDashboard.json.progress.planned, 0);
  assert.equal(
    bobDashboard.json.activity.tasksCompleted + bobDashboard.json.activity.focusMinutes,
    0,
    'bob has no activity of his own yet',
  );

  // Writes against someone else's rows are refused.
  const patch = await call('PATCH', `/api/tasks/${aliceIds.task}`, { token: bob.token, body: { title: 'hijacked' } });
  assert.ok(patch.status === 404 || patch.status === 403, `unexpected ${patch.status}`);
  const remove = await call('DELETE', `/api/tasks/${aliceIds.task}`, { token: bob.token });
  assert.ok(remove.status === 404 || remove.status === 403);
  const membership = await call('DELETE', `/api/groups/${aliceIds.group}/members/${alice.userId}`, { token: bob.token });
  assert.ok(membership.status === 404 || membership.status === 403, 'bob cannot remove alice from her own group');

  // Alice's data is intact after all of that.
  const stillThere = await call('GET', `/api/tasks/${aliceIds.task}`, { token: alice.token });
  assert.equal(stillThere.status, 200);
  assert.equal(stillThere.json.task.title, 'Alice secret task');

  // Deleting an account anonymises it: bob disappears, alice is untouched.
  const bobDelete = await call('DELETE', '/api/me', {
    token: bob.token,
    body: { password: 'Passw0rd!', confirm: 'DELETE' },
  });
  assert.equal(bobDelete.status, 200, JSON.stringify(bobDelete.json));
  const bobSession = await call('GET', '/api/auth/session', { token: bob.token });
  assert.equal(bobSession.status, 401, 'the deleted account can no longer authenticate');
  const aliceIntact = await call('GET', `/api/tasks/${aliceIds.task}`, { token: alice.token });
  assert.equal(aliceIntact.status, 200);
});
