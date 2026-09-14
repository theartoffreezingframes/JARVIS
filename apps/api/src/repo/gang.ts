import type { GangSession, GangStatus, ParticipantState, Reaction } from '@jarvis/shared';
import type { Db } from '../db/index.js';
import { all, getDb, one, run } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { mapGangParticipant, mapGangSession } from './mappers.js';
import type { GangParticipantRow, GangSessionRow } from './rows.js';
import { nextSeq } from './users.js';

/* -------------------------------------------------------------------------- */
/*  Sessions                                                                  */
/* -------------------------------------------------------------------------- */

export interface GangWriteInput {
  groupId: string;
  hostId: string;
  title: string;
  startsAt: number;
  focusMinutes: number;
  breakMinutes: number;
  rounds: number;
  mode: string;
  recurrence?: string | null;
  clientId?: string | null;
}

export function insertGangSession(input: GangWriteInput, db: Db = getDb()): GangSessionRow {
  const now = Date.now();
  const id = newId('gng');
  run(
    `INSERT INTO gang_sessions (id, group_id, host_id, title, starts_at, focus_minutes, break_minutes,
        rounds, mode, status, clock_anchor_at, clock_paused_ms, is_clock_paused, current_round,
        recurrence, created_at, updated_at, seq, client_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, 0, 0, 1, ?, ?, ?, ?, ?)`,
    [
      id, input.groupId, input.hostId, input.title, input.startsAt, input.focusMinutes, input.breakMinutes,
      input.rounds, input.mode, input.startsAt, input.recurrence ?? null, now, now,
      nextSeq(input.hostId, db), input.clientId ?? null,
    ],
    db,
  );
  return one<GangSessionRow>('SELECT * FROM gang_sessions WHERE id = ?', [id], db)!;
}

export function getSessionRow(id: string, db: Db = getDb()): GangSessionRow | undefined {
  return one<GangSessionRow>('SELECT * FROM gang_sessions WHERE id = ?', [id], db);
}

export function patchSession(
  actorId: string,
  sessionId: string,
  patch: Partial<{
    status: GangStatus;
    startsAt: number;
    focusMinutes: number;
    breakMinutes: number;
    rounds: number;
    mode: string;
    clockAnchorAt: number;
    clockPausedMs: number;
    isClockPaused: boolean;
    currentRound: number;
    title: string;
    recurrence: string | null;
  }>,
  db: Db = getDb(),
): GangSessionRow | undefined {
  const columns: Record<string, string> = {
    status: 'status',
    startsAt: 'starts_at',
    focusMinutes: 'focus_minutes',
    breakMinutes: 'break_minutes',
    rounds: 'rounds',
    mode: 'mode',
    clockAnchorAt: 'clock_anchor_at',
    clockPausedMs: 'clock_paused_ms',
    isClockPaused: 'is_clock_paused',
    currentRound: 'current_round',
    title: 'title',
    recurrence: 'recurrence',
  };
  const entries = Object.entries(patch).filter(([k]) => k in columns);
  if (!entries.length) return getSessionRow(sessionId, db);
  const sets = entries.map(([k]) => `${columns[k]} = ?`);
  const values = entries.map(([, v]) => (typeof v === 'boolean' ? (v ? 1 : 0) : v ?? null));
  run(
    `UPDATE gang_sessions SET ${sets.join(', ')}, updated_at = ?, seq = ? WHERE id = ?`,
    [...values, Date.now(), nextSeq(actorId, db), sessionId],
    db,
  );
  return getSessionRow(sessionId, db);
}

export function softDeleteSession(actorId: string, sessionId: string, db: Db = getDb()): void {
  const now = Date.now();
  run('UPDATE gang_sessions SET deleted_at = ?, updated_at = ?, seq = ? WHERE id = ?', [
    now, now, nextSeq(actorId, db), sessionId,
  ], db);
}

export function listSessionsForGroup(groupId: string, limit = 20, db: Db = getDb()): GangSessionRow[] {
  return all<GangSessionRow>(
    `SELECT * FROM gang_sessions WHERE group_id = ? AND deleted_at IS NULL
      ORDER BY starts_at DESC LIMIT ?`,
    [groupId, limit],
    db,
  );
}

/** Sessions the user is part of, including ones they were invited to. */
export function listSessionsForUser(userId: string, limit = 20, db: Db = getDb()): GangSessionRow[] {
  return all<GangSessionRow>(
    `SELECT s.* FROM gang_sessions s
      WHERE s.deleted_at IS NULL
        AND (s.host_id = ? OR EXISTS (SELECT 1 FROM gang_participants p WHERE p.session_id = s.id AND p.user_id = ?))
      ORDER BY CASE s.status WHEN 'running' THEN 0 WHEN 'paused' THEN 1 WHEN 'scheduled' THEN 2 ELSE 3 END,
               s.starts_at ASC
      LIMIT ?`,
    [userId, userId, limit],
    db,
  );
}

export function upcomingSessionsForUser(userId: string, fromMs: number, limit = 10, db: Db = getDb()): GangSessionRow[] {
  return all<GangSessionRow>(
    `SELECT s.* FROM gang_sessions s
      WHERE s.deleted_at IS NULL AND s.status = 'scheduled' AND s.starts_at >= ?
        AND EXISTS (SELECT 1 FROM gang_participants p WHERE p.session_id = s.id AND p.user_id = ?)
      ORDER BY s.starts_at ASC LIMIT ?`,
    [fromMs, userId, limit],
    db,
  );
}

/* -------------------------------------------------------------------------- */
/*  Participants                                                              */
/* -------------------------------------------------------------------------- */

export function upsertParticipant(
  sessionId: string,
  userId: string,
  patch: Partial<{
    state: ParticipantState;
    focusSeconds: number;
    secondsRemaining: number;
    isHost: boolean;
    reactionsSent: number;
  }>,
  db: Db = getDb(),
): GangParticipantRow {
  const now = Date.now();
  const existing = one<GangParticipantRow>(
    'SELECT * FROM gang_participants WHERE session_id = ? AND user_id = ?',
    [sessionId, userId],
    db,
  );

  if (!existing) {
    run(
      `INSERT INTO gang_participants (session_id, user_id, state, focus_seconds, seconds_remaining, is_host, joined_at, last_seen_at, reactions_sent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        userId,
        patch.state ?? 'invited',
        patch.focusSeconds ?? 0,
        patch.secondsRemaining ?? 0,
        patch.isHost ? 1 : 0,
        now,
        now,
        patch.reactionsSent ?? 0,
      ],
      db,
    );
  } else {
    const sets: string[] = ['last_seen_at = ?'];
    const params: unknown[] = [now];
    if (patch.state !== undefined) {
      sets.push('state = ?');
      params.push(patch.state);
    }
    if (patch.focusSeconds !== undefined) {
      sets.push('focus_seconds = ?');
      params.push(Math.max(patch.focusSeconds, existing.focus_seconds));
    }
    if (patch.secondsRemaining !== undefined) {
      sets.push('seconds_remaining = ?');
      params.push(patch.secondsRemaining);
    }
    if (patch.isHost !== undefined) {
      sets.push('is_host = ?');
      params.push(patch.isHost ? 1 : 0);
    }
    if (patch.reactionsSent !== undefined) {
      sets.push('reactions_sent = ?');
      params.push(patch.reactionsSent);
    }
    params.push(sessionId, userId);
    run(`UPDATE gang_participants SET ${sets.join(', ')} WHERE session_id = ? AND user_id = ?`, params, db);
  }

  return one<GangParticipantRow>(
    'SELECT * FROM gang_participants WHERE session_id = ? AND user_id = ?',
    [sessionId, userId],
    db,
  )!;
}

export function addParticipant(sessionId: string, userId: string, state: ParticipantState = 'invited', db: Db = getDb()): void {
  const now = Date.now();
  run(
    `INSERT INTO gang_participants (session_id, user_id, state, joined_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id, user_id) DO NOTHING`,
    [sessionId, userId, state, now, now],
    db,
  );
}

export function removeParticipant(sessionId: string, userId: string, db: Db = getDb()): void {
  run('DELETE FROM gang_participants WHERE session_id = ? AND user_id = ?', [sessionId, userId], db);
}

export function participantRows(sessionId: string, db: Db = getDb()): GangParticipantRow[] {
  return all<GangParticipantRow>(
    `SELECT * FROM gang_participants WHERE session_id = ? ORDER BY is_host DESC, joined_at ASC`,
    [sessionId],
    db,
  );
}

/* -------------------------------------------------------------------------- */
/*  Reactions (ephemeral encouragement only — no chat)                        */
/* -------------------------------------------------------------------------- */

export function insertReaction(
  sessionId: string,
  userId: string,
  reaction: Reaction,
  db: Db = getDb(),
): { id: string; createdAt: number } {
  const id = newId('rct');
  const createdAt = Date.now();
  run(
    'INSERT INTO gang_reactions (id, session_id, user_id, reaction, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, sessionId, userId, reaction, createdAt],
    db,
  );
  return { id, createdAt };
}

export function recentReactions(sessionId: string, sinceMs: number, db: Db = getDb()): Array<{ user_id: string; reaction: string; created_at: number }> {
  return all('SELECT user_id, reaction, created_at FROM gang_reactions WHERE session_id = ? AND created_at >= ? ORDER BY created_at',
    [sessionId, sinceMs], db);
}

/* -------------------------------------------------------------------------- */
/*  Hydration                                                                 */
/* -------------------------------------------------------------------------- */

export function hydrateSession(row: GangSessionRow, db: Db = getDb()): GangSession {
  const participants = participantRows(row.id, db);
  const userIds = participants.map((p) => p.user_id);
  const users = new Map<string, { name: string; username: string; avatar_url: string | null }>();
  if (userIds.length) {
    const placeholders = userIds.map(() => '?').join(', ');
    for (const user of all<{ id: string; name: string; username: string; avatar_url: string | null }>(
      `SELECT id, name, username, avatar_url FROM users WHERE id IN (${placeholders})`,
      userIds,
      db,
    )) {
      users.set(user.id, user);
    }
  }
  const group = one<{ name: string }>('SELECT name FROM groups WHERE id = ?', [row.group_id], db);
  return mapGangSession(row, group, participants.map((p) => mapGangParticipant(p, users.get(p.user_id))));
}

export function hydrateSessions(rows: readonly GangSessionRow[], db: Db = getDb()): GangSession[] {
  return rows.map((row) => hydrateSession(row, db));
}

/** Group ids the user belongs to — used for realtime authorisation. */
export function userGroupIds(userId: string, db: Db = getDb()): string[] {
  return all<{ group_id: string }>('SELECT group_id FROM group_members WHERE user_id = ?', [userId], db).map((r) => r.group_id);
}
