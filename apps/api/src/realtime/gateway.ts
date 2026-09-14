import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { participantStateSchema, reactionSchema, type RealtimeEvent } from '@jarvis/shared';
import { config } from '../env.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { findUserById } from '../repo/users.js';
import type { UserRow } from '../repo/rows.js';
import { getSessionRow, participantRows, upsertParticipant } from '../repo/gang.js';
import { userGroupIds } from '../repo/gang.js';
import { canAccessSession, clockState, tickSession, tickAllActiveSessions } from '../services/gang.js';

declare module 'fastify' {
  interface FastifyInstance {
    realtime: RealtimeBus;
  }
}

type Topic = string;

interface Client {
  id: string;
  socket: WebSocket;
  user: UserRow;
  /** group topics this socket receives */
  groups: Set<Topic>;
  /** gang sessions this socket follows */
  sessions: Set<string>;
  alive: boolean;
}

const inboundSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('join'), sessionId: z.string().min(6).max(64) }),
  z.object({ type: z.literal('leave'), sessionId: z.string().min(6).max(64) }),
  z.object({
    type: z.literal('state'),
    sessionId: z.string().min(6).max(64),
    state: participantStateSchema,
  }),
  z.object({
    type: z.literal('control'),
    sessionId: z.string().min(6).max(64),
    action: z.enum(['start', 'pause', 'resume', 'skip', 'stop']),
  }),
  z.object({
    type: z.literal('reaction'),
    sessionId: z.string().min(6).max(64),
    reaction: reactionSchema,
  }),
]);

/**
 * Real-time hub for Gang Timer coordination.
 *
 * The socket carries *state changes only*: join/leave, phase transitions,
 * reactions and host controls. The countdown itself is derived on every device
 * from the authoritative anchor (`clockAnchorAt`), so a dropped connection never
 * desynchronises the group and nobody has to broadcast a tick every second.
 *
 * A single server-side interval advances accrual and auto-completes finished
 * sessions, which keeps the number of timers O(sessions) rather than
 * O(participants × devices).
 */
export class RealtimeBus {
  private clients = new Map<string, Client>();
  private heartbeat: NodeJS.Timeout | null = null;
  private ticker: NodeJS.Timeout | null = null;

  constructor(private readonly log: FastifyInstance['log']) {}

  start(): void {
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => this.pingAll(), config.realtimeHeartbeatMs);
      this.heartbeat.unref?.();
    }
    if (!this.ticker) {
      this.ticker = setInterval(() => this.tickSessions(), 10_000);
      this.ticker.unref?.();
    }
  }

  stop(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.ticker) clearInterval(this.ticker);
    this.heartbeat = null;
    this.ticker = null;
    for (const client of this.clients.values()) {
      try {
        client.socket.close(1001, 'Server shutting down');
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /* ------------------------------- lifecycle ----------------------------- */

  register(user: UserRow, socket: WebSocket, sessionIds: string[] = []): Client {
    const id = `ws_${Math.random().toString(36).slice(2, 10)}`;
    const client: Client = {
      id,
      socket,
      user,
      groups: new Set(userGroupIds(user.id)),
      sessions: new Set(),
      alive: true,
    };
    for (const sessionId of sessionIds) {
      if (canAccessSession(user.id, sessionId)) client.sessions.add(sessionId);
    }
    this.clients.set(id, client);
    this.send(client, { type: 'hello', at: Date.now(), payload: { userId: user.id, serverTime: Date.now(), sessions: [...client.sessions] } });
    for (const sessionId of client.sessions) this.pushSessionState(client, sessionId);
    return client;
  }

  unregister(client: Client): void {
    this.clients.delete(client.id);
    // Marking the participant "left" is optimistic-only: the shared clock keeps
    // running, and the host can start without them.
    for (const sessionId of client.sessions) {
      const stillWatching = [...this.clients.values()].some(
        (other) => other.user.id === client.user.id && other.sessions.has(sessionId),
      );
      if (!stillWatching) {
        const row = getSessionRow(sessionId);
        if (!row || row.host_id === client.user.id) continue;
        if (row.status === 'running' || row.status === 'paused') {
          upsertParticipant(sessionId, client.user.id, { state: 'paused' });
          this.broadcastToSession(sessionId, {
            type: 'participant_update',
            sessionId,
            at: Date.now(),
            payload: { userId: client.user.id, state: 'paused' },
          });
        }
      }
    }
  }

  /* -------------------------------- sending ------------------------------ */

  private send(client: Client, event: RealtimeEvent): void {
    try {
      if (client.socket.readyState === 1) client.socket.send(JSON.stringify(event));
    } catch (error) {
      this.log.debug({ err: error }, 'realtime send failed');
    }
  }

  broadcast(groupId: string, event: Omit<RealtimeEvent, 'at'> & { at?: number }): void {
    const payload: RealtimeEvent = { ...event, at: event.at ?? Date.now() };
    for (const client of this.clients.values()) {
      if (client.groups.has(groupId)) this.send(client, payload);
    }
  }

  broadcastToSession(sessionId: string, event: Omit<RealtimeEvent, 'at'> & { at?: number }): void {
    const payload: RealtimeEvent = { ...event, at: event.at ?? Date.now() };
    for (const client of this.clients.values()) {
      if (client.sessions.has(sessionId)) this.send(client, payload);
    }
  }

  private pushSessionState(client: Client, sessionId: string): void {
    const result = tickSession(sessionId);
    if (!result) return;
    this.send(client, {
      type: 'session_state',
      sessionId,
      at: Date.now(),
      payload: { session: result.session, clock: result.clock },
    });
  }

  /* -------------------------------- inbound ------------------------------ */

  handleMessage(client: Client, raw: string): void {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return;
    }
    const parsed = inboundSchema.safeParse(parsedJson);
    if (!parsed.success) return;
    const message = parsed.data;

    switch (message.type) {
      case 'ping': {
        this.send(client, { type: 'pong', at: Date.now(), payload: {} });
        break;
      }
      case 'join': {
        if (!canAccessSession(client.user.id, message.sessionId)) return;
        client.sessions.add(message.sessionId);
        upsertParticipant(message.sessionId, client.user.id, { state: 'focusing' });
        this.pushSessionState(client, message.sessionId);
        this.broadcastToSession(message.sessionId, {
          type: 'presence',
          sessionId: message.sessionId,
          payload: { userId: client.user.id, name: client.user.name, joined: true },
        });
        break;
      }
      case 'leave': {
        client.sessions.delete(message.sessionId);
        break;
      }
      case 'state': {
        if (!client.sessions.has(message.sessionId)) return;
        upsertParticipant(message.sessionId, client.user.id, { state: message.state });
        this.broadcastToSession(message.sessionId, {
          type: 'participant_update',
          sessionId: message.sessionId,
          payload: { userId: client.user.id, name: client.user.name, state: message.state },
        });
        break;
      }
      case 'reaction': {
        if (!client.sessions.has(message.sessionId)) return;
        this.broadcastToSession(message.sessionId, {
          type: 'reaction',
          sessionId: message.sessionId,
          payload: { userId: client.user.id, name: client.user.name, reaction: message.reaction, createdAt: Date.now() },
        });
        break;
      }
      case 'control': {
        const row = getSessionRow(message.sessionId);
        if (!row || row.host_id !== client.user.id) return;
        // Controls are applied through the HTTP service to keep one code path.
        void import('../services/gang.js').then(({ startSession, pauseSession, resumeSession, skipPhase, stopSession }) => {
          const actions = {
            start: () => startSession(client.user.id, message.sessionId),
            pause: () => pauseSession(client.user.id, message.sessionId),
            resume: () => resumeSession(client.user.id, message.sessionId),
            skip: () => skipPhase(client.user.id, message.sessionId),
            stop: () => stopSession(client.user.id, message.sessionId),
          } as const;
          const result = actions[message.action]();
          if (!result) return;
          this.broadcast(result.session.groupId, {
            type: result.clock.phase === 'finished' ? 'session_completed' : 'session_state',
            sessionId: message.sessionId,
            payload: { session: result.session, clock: result.clock },
          });
        });
        break;
      }
      default:
        break;
    }
  }

  markAlive(client: Client): void {
    client.alive = true;
  }

  /* -------------------------------- timers ------------------------------- */

  private pingAll(): void {
    for (const client of [...this.clients.values()]) {
      if (!client.alive) {
        try {
          client.socket.terminate();
        } catch {
          /* ignore */
        }
        this.unregister(client);
        continue;
      }
      client.alive = false;
      try {
        client.socket.ping?.();
      } catch {
        /* ignore */
      }
      this.send(client, { type: 'pong', at: Date.now(), payload: { heartbeat: true } });
    }
  }

  /**
   * Advances every active session. Only sessions that are actually running do
   * work, and each pass is a handful of small queries — battery and CPU stay
   * quiet when nothing is happening.
   */
  private tickSessions(): void {
    try {
      const completed = tickAllActiveSessions();
      for (const sessionId of completed) {
        const row = getSessionRow(sessionId);
        if (!row) continue;
        this.broadcast(row.group_id, {
          type: 'session_completed',
          sessionId,
          payload: { sessionId },
        });
      }
      for (const client of this.clients.values()) {
        for (const sessionId of client.sessions) {
          const row = getSessionRow(sessionId);
          if (!row) continue;
          const clock = clockState(row, Date.now());
          // Only push when something material changed for the group.
          this.send(client, {
            type: 'session_state',
            sessionId,
            at: Date.now(),
            payload: { clock, participants: participantRows(sessionId).length },
          });
        }
      }
    } catch (error) {
      this.log.warn({ err: error }, 'gang session tick failed');
    }
  }
}

export interface RealtimeSocketQuery {
  token: string;
  sessionId?: string;
}

/** Authenticates the WebSocket handshake before any handler is attached. */
export function authenticateSocket(request: FastifyRequest): UserRow | null {
  const query = request.query as Partial<RealtimeSocketQuery> | undefined;
  const token = typeof query?.token === 'string' ? query.token : undefined;
  if (!token) return null;
  const claims = verifyAccessToken(token);
  if (!claims) return null;
  return findUserById(claims.sub) ?? null;
}

export function registerRealtime(app: FastifyInstance): RealtimeBus {
  const bus = new RealtimeBus(app.log);
  app.decorate('realtime', bus);
  bus.start();

  app.get('/realtime', { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    const user = authenticateSocket(request);
    if (!user) {
      try {
        socket.close(4401, 'Unauthorized');
      } catch {
        /* ignore */
      }
      return;
    }
    const query = request.query as Partial<RealtimeSocketQuery>;
    const sessionIds = query.sessionId ? [query.sessionId] : [];
    const client = bus.register(user, socket, sessionIds);

    socket.on('message', (data: Buffer | string) => {
      bus.handleMessage(client, typeof data === 'string' ? data : data.toString('utf8'));
    });
    socket.on('pong', () => bus.markAlive(client));
    socket.on('close', () => bus.unregister(client));
    socket.on('error', () => bus.unregister(client));
  });

  app.addHook('onClose', async () => {
    bus.stop();
  });

  return bus;
}

