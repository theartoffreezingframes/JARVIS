/**
 * Realtime transport for group focus sessions.
 *
 * The server owns the clock; sockets only carry state changes. One socket is kept
 * per app session and re-subscribed automatically, with exponential backoff and a
 * heartbeat so a sleeping phone reconnects cleanly instead of hammering.
 */
import { useEffect, useRef, useState } from 'react';
import { realtimeUrl } from './api';
import { tokenStore } from './storage';

export interface RealtimeEvent {
  type: string;
  [key: string]: unknown;
}

type Handler = (event: RealtimeEvent) => void;
type StatusHandler = (status: RealtimeStatus) => void;

export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'closed';

class RealtimeClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private statusHandlers = new Set<StatusHandler>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private sessionId: string | null = null;
  private status: RealtimeStatus = 'idle';
  private closing = false;

  on(type: string, handler: Handler): () => void {
    const set = this.handlers.get(type) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(type, set);
    return () => set.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    handler(this.status);
    return () => this.statusHandlers.delete(handler);
  }

  private setStatus(status: RealtimeStatus): void {
    this.status = status;
    for (const handler of this.statusHandlers) handler(status);
  }

  getStatus(): RealtimeStatus {
    return this.status;
  }

  async connect(sessionId?: string | null): Promise<void> {
    if (sessionId) this.sessionId = sessionId;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    const token = await tokenStore.getAccess();
    if (!token) return;

    this.setStatus('connecting');
    const socket = new WebSocket(realtimeUrl(token, this.sessionId));
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus('open');
      if (this.sessionId) this.send({ type: 'join', sessionId: this.sessionId });
      this.heartbeat = setInterval(() => this.send({ type: 'ping' }), 25_000);
    };

    socket.onmessage = (message) => {
      let parsed: RealtimeEvent | null = null;
      try {
        parsed = JSON.parse(String(message.data)) as RealtimeEvent;
      } catch {
        return;
      }
      if (!parsed?.type) return;
      for (const handler of this.handlers.get(parsed.type) ?? []) handler(parsed);
      for (const handler of this.handlers.get('*') ?? []) handler(parsed);
    };

    socket.onerror = () => {
      /* onclose always follows; the retry lives there */
    };

    socket.onclose = (event) => {
      this.clearHeartbeat();
      this.socket = null;
      this.setStatus('closed');
      if (this.closing) return;
      // 4401 means the token is no longer valid — do not spin.
      if (event.code === 4401) return;
      const delay = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempts);
      this.reconnectAttempts += 1;
      this.reconnectTimer = setTimeout(() => void this.connect(), delay);
    };
  }

  send(payload: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  join(sessionId: string): void {
    this.sessionId = sessionId;
    this.send({ type: 'join', sessionId });
  }

  leave(sessionId: string): void {
    this.send({ type: 'leave', sessionId });
    if (this.sessionId === sessionId) this.sessionId = null;
  }

  /** Sends an arbitrary inbound frame (reaction, participant state). */
  emit(payload: Record<string, unknown>): void {
    this.send(payload);
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  disconnect(): void {
    this.closing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.clearHeartbeat();
    this.socket?.close();
    this.socket = null;
    this.setStatus('idle');
  }

  reconnect(): void {
    this.closing = false;
    this.disconnect();
    this.closing = false;
    void this.connect();
  }

  /**
   * Foreground recovery.
   *
   * A phone that slept has a closed socket and possibly a long backoff pending.
   * Returning to the foreground is the moment to try immediately instead of
   * waiting out the timer, and to forget how many attempts failed while the app
   * was in the background.
   */
  ensureConnected(): void {
    if (this.closing) return;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    void this.connect();
  }
}

export const realtime = new RealtimeClient();

/** Subscribes to one event type while the component is mounted. */
export function useRealtimeEvent(type: string, handler: Handler, enabled = true): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!enabled) return;
    return realtime.on(type, (event) => handlerRef.current(event));
  }, [type, enabled]);
}

export function useRealtimeStatus(): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>(realtime.getStatus());
  useEffect(() => realtime.onStatus(setStatus), []);
  return status;
}
