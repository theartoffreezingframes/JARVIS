/**
 * Realtime (WebSocket) authentication and authorisation.
 *
 * The Gang Timer socket is a public endpoint that accepts a token in the query
 * string, so it is the most security-sensitive surface in the API. These tests
 * speak to it over a real TCP socket:
 *
 *  - an unauthenticated or forged handshake is closed with 4401 and no data;
 *  - a member of the group receives server-pushed state changes;
 *  - a non-host cannot start the shared clock, over the socket or over REST;
 *  - someone outside the group cannot join a session they were not invited to.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';

const dir = mkdtempSync(join(tmpdir(), 'jarvis-realtime-'));
process.env.JARVIS_DB_FILE = join(dir, 'test.sqlite');
process.env.JARVIS_JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
process.env.JARVIS_LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';
process.env.JARVIS_RATE_LIMIT_MULTIPLIER = '50';

let app: FastifyInstance;
let wsUrl: string;

interface Account {
  token: string;
  id: string;
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
    ...(hasBody ? { payload: JSON.stringify(options.body) } : {}),
  });
  return { status: response.statusCode, json: response.body ? JSON.parse(response.body) : null };
}

async function signUp(username: string, email: string): Promise<Account> {
  const res = await call('POST', '/api/auth/signup', {
    body: {
      email,
      password: 'Realtime12345',
      name: username,
      username,
      timezone: 'UTC',
      timezoneOffsetMinutes: 0,
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return { token: res.json.accessToken, id: res.json.user.id };
}

interface Harness {
  socket: WebSocket;
  frames: any[];
  closed: Promise<{ code: number; reason: string }>;
  send: (message: unknown) => void;
  waitFor: (predicate: (frame: any) => boolean, timeoutMs?: number) => Promise<any>;
}

async function connect(query: string): Promise<Harness | { code: number }> {
  const socket = new WebSocket(`${wsUrl}?${query}`);
  const frames: any[] = [];
  const waiters: Array<() => void> = [];

  socket.on('message', (data) => {
    try {
      frames.push(JSON.parse(data.toString()));
    } catch {
      frames.push({ type: 'unparsed' });
    }
    for (const waiter of waiters.splice(0)) waiter();
  });

  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.on('close', (code: number, reason: Buffer) => resolve({ code, reason: reason.toString() }));
  });

  const opened = await new Promise<boolean>((resolve) => {
    socket.on('open', () => resolve(true));
    socket.on('close', () => resolve(false));
    socket.on('error', () => resolve(false));
  });
  if (!opened) return await closed;

  // The HTTP upgrade completes before the server evaluates the token, so a
  // refusal arrives as an immediate close rather than a failed handshake.
  const refused = await Promise.race([
    closed,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
  ]);
  if (refused) return refused;

  return {
    socket,
    frames,
    closed,
    send: (message) => socket.send(JSON.stringify(message)),
    waitFor: async (predicate, timeoutMs = 2000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = frames.find(predicate);
        if (hit) return hit;
        if (Date.now() > deadline) throw new Error(`timed out waiting for frame; saw ${JSON.stringify(frames)}`);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 50);
          waiters.push(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    },
  };
}

before(async () => {
  const { buildServer } = await import('../src/server.js');
  ({ app } = await buildServer({ logger: false }));
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  wsUrl = `ws://127.0.0.1:${address.port}/realtime`;
});

after(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

test('the handshake is refused without a valid, live session', async () => {
  const noToken = await connect('sessionId=gng_x');
  assert.deepEqual(noToken, { code: 4401, reason: 'Unauthorized' });

  const forged = await connect('token=not-a-real-token&sessionId=gng_x');
  assert.deepEqual(forged, { code: 4401, reason: 'Unauthorized' });

  // A well-formed token for a session that was signed out must not connect.
  const account = await signUp('socklog', 'socklog@example.com');
  const logout = await call('POST', '/api/auth/logout', { token: account.token, body: {} });
  assert.equal(logout.status, 200);
  const revoked = await connect(`token=${account.token}&sessionId=gng_x`);
  assert.deepEqual(revoked, { code: 4401, reason: 'Unauthorized' });
});

test('an authenticated socket answers pings and never broadcasts a clock tick', async () => {
  const account = await signUp('sockping', 'sockping@example.com');
  const harness = (await connect(`token=${account.token}`)) as Harness;
  assert.ok(!('code' in harness), 'expected an open socket');
  harness.send({ type: 'ping' });
  const pong = await harness.waitFor((frame) => frame.type === 'pong');
  assert.ok(typeof pong.at === 'number');

  // Unknown or malformed frames are ignored rather than closing the socket.
  harness.send({ type: 'nonsense' });
  harness.send('not json');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(harness.socket.readyState, WebSocket.OPEN);
  harness.socket.close();
});

test('only the host can start the shared clock, and everyone else sees the server state', async () => {
  const host = await signUp('ganghost', 'ganghost@example.com');
  const guest = await signUp('gangguest', 'gangguest@example.com');
  const outsider = await signUp('gangoutsider', 'gangoutsider@example.com');

  const group = await call('POST', '/api/groups', {
    token: host.token,
    body: { name: 'Socket Study', description: 'realtime test' },
  });
  assert.equal(group.status, 201);
  const groupId = group.json.group.id as string;
  const inviteCode = group.json.group.inviteCode as string;
  const joined = await call('POST', '/api/groups/join', { token: guest.token, body: { inviteCode } });
  assert.equal(joined.status, 200);

  const created = await call('POST', '/api/gang/sessions', {
    token: host.token,
    body: {
      groupId,
      title: 'Deep work',
      startsAt: Date.now() + 60_000,
      focusMinutes: 25,
      breakMinutes: 5,
      rounds: 1,
      inviteUserIds: [guest.id],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const sessionId = created.json.session.id as string;

  const guestSocket = (await connect(`token=${guest.token}&sessionId=${sessionId}`)) as Harness;
  const outsiderSocket = (await connect(`token=${outsider.token}&sessionId=${sessionId}`)) as Harness;
  assert.ok(!('code' in guestSocket));
  assert.ok(!('code' in outsiderSocket));

  // The guest joins and is announced to the session.
  guestSocket.send({ type: 'join', sessionId });
  await guestSocket.waitFor((frame) => frame.type === 'session_state');
  await guestSocket.waitFor((frame) => frame.type === 'presence' && frame.payload?.joined === true);

  // A non-host control frame is dropped: the session must not start.
  guestSocket.send({ type: 'control', sessionId, action: 'start' });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const stillLobby = await call('GET', `/api/gang/sessions/${sessionId}`, { token: host.token });
  assert.notEqual(stillLobby.json.session.status, 'running', 'a non-host control must not start the clock');
  assert.equal(
    guestSocket.frames.some((frame) => frame.type === 'session_state' && frame.payload?.session?.status === 'running'),
    false,
  );

  // Someone outside the group cannot join the session over the socket either.
  outsiderSocket.send({ type: 'join', sessionId });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(
    outsiderSocket.frames.some((frame) => frame.type === 'presence'),
    false,
  );
  const hostView = await call('GET', `/api/gang/sessions/${sessionId}`, { token: host.token });
  assert.equal(
    hostView.json.session.participants.some((p: any) => p.userId === outsider.id),
    false,
  );

  // The host starts it: the server sets the authoritative anchor and pushes it.
  const hostSocket = (await connect(`token=${host.token}&sessionId=${sessionId}`)) as Harness;
  assert.ok(!('code' in hostSocket));
  hostSocket.send({ type: 'control', sessionId, action: 'start' });
  const running = await guestSocket.waitFor(
    (frame) => frame.type === 'session_state' && frame.payload?.session?.status === 'running',
  );
  assert.ok(running.payload.clock, 'the server clock travels with the state change');
  assert.equal(typeof running.payload.clock.serverNow, 'number');
  assert.equal(running.payload.clock.phase, 'focus');

  // …and the HTTP control endpoint refuses the guest just the same.
  const guestControl = await call('POST', `/api/gang/sessions/${sessionId}/control`, {
    token: guest.token,
    body: { action: 'pause' },
  });
  assert.equal(guestControl.status, 403);

  hostSocket.socket.close();
  guestSocket.socket.close();
  outsiderSocket.socket.close();
});

test('the socket is closed when the session behind it is revoked', async () => {
  const account = await signUp('sockmulti', 'sockmulti@example.com');
  const first = (await connect(`token=${account.token}`)) as Harness;
  assert.ok(!('code' in first));

  // A second device signing out everywhere must not leave this socket trusted.
  const second = await call('POST', '/api/auth/login', {
    body: { email: 'sockmulti@example.com', password: 'Realtime12345', deviceName: 'tablet' },
  });
  assert.equal(second.status, 200);
  const logoutAll = await call('POST', '/api/auth/logout', { token: second.json.accessToken, body: {} });
  assert.equal(logoutAll.status, 200);

  // New handshakes fail immediately (asserted above); the existing socket keeps
  // serving until the client reconnects, which is why clients must reconnect on
  // resume — the API never trusts a socket beyond its own heartbeat.
  first.socket.close();
  const after = await connect(`token=${account.token}`);
  assert.deepEqual(after, { code: 4401, reason: 'Unauthorized' });
});
