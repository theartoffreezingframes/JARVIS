import type { GangSession, GangStatus, ParticipantState } from '@jarvis/shared';
import type { Db } from '../db/index.js';
import { getDb, one, run, tx } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import {
  addParticipant,
  getSessionRow,
  hydrateSession,
  hydrateSessions,
  insertReaction,
  participantRows,
  patchSession,
  upcomingSessionsForUser,
  upsertParticipant,
} from '../repo/gang.js';
import type { GangSessionRow } from '../repo/rows.js';
import { nextSeq } from '../repo/users.js';
import { incrementActivity } from '../repo/activity.js';
import { toDayKey } from '@jarvis/shared';

/* -------------------------------------------------------------------------- */
/*  Authoritative clock                                                       */
/* -------------------------------------------------------------------------- */

export interface SessionClockState {
  status: GangStatus;
  phase: 'focus' | 'break' | 'finished';
  phaseSecondsRemaining: number;
  phaseDurationSeconds: number;
  totalSeconds: number;
  elapsedSeconds: number;
  currentRound: number;
  rounds: number;
  serverNow: number;
}

export const PHASE_FOCUS = 'focus' as const;
export const PHASE_BREAK = 'break' as const;

/**
 * Derives the shared timer state from the stored anchor.
 *
 * The clock is *derived*, never broadcast: clients compute the same value from
 * `clockAnchorAt` + their own local clock offset, so no participant's phone has
 * to emit a tick every second and a dropped socket cannot desynchronise the group.
 */
export function clockState(row: GangSessionRow, now: number): SessionClockState {
  const focusSeconds = Math.max(1, row.focus_minutes) * 60;
  const breakSeconds = Math.max(0, row.break_minutes) * 60;
  const rounds = Math.max(1, row.rounds);
  const totalSeconds = rounds * focusSeconds + (rounds - 1) * breakSeconds;

  const elapsedMs = row.is_clock_paused === 1 ? row.clock_paused_ms : now - row.clock_anchor_at;
  const elapsedSeconds = Math.max(0, Math.min(Math.floor(elapsedMs / 1000), totalSeconds));

  const finished = elapsedSeconds >= totalSeconds;
  if (finished || row.status === 'completed' || row.status === 'cancelled') {
    return {
      status: row.status === 'cancelled' ? 'cancelled' : 'completed',
      phase: 'finished',
      phaseSecondsRemaining: 0,
      phaseDurationSeconds: focusSeconds,
      totalSeconds,
      elapsedSeconds: Math.min(elapsedSeconds, totalSeconds),
      currentRound: rounds,
      rounds,
      serverNow: now,
    };
  }

  // Round 1..n: focus then break (no trailing break after the final round).
  let cursor = 0;
  for (let round = 1; round <= rounds; round += 1) {
    const focusStart = cursor;
    const focusEnd = focusStart + focusSeconds;
    if (elapsedSeconds < focusEnd) {
      return {
        status: row.status === 'paused' ? 'paused' : 'running',
        phase: PHASE_FOCUS,
        phaseSecondsRemaining: focusEnd - elapsedSeconds,
        phaseDurationSeconds: focusSeconds,
        totalSeconds,
        elapsedSeconds,
        currentRound: round,
        rounds,
        serverNow: now,
      };
    }
    const breakEnd = focusEnd + breakSeconds;
    if (elapsedSeconds < breakEnd) {
      return {
        status: row.status === 'paused' ? 'paused' : 'running',
        phase: PHASE_BREAK,
        phaseSecondsRemaining: breakEnd - elapsedSeconds,
        phaseDurationSeconds: breakSeconds,
        totalSeconds,
        elapsedSeconds,
        currentRound: round,
        rounds,
        serverNow: now,
      };
    }
    cursor = breakEnd;
  }

  return {
    status: 'completed',
    phase: 'finished',
    phaseSecondsRemaining: 0,
    phaseDurationSeconds: focusSeconds,
    totalSeconds,
    elapsedSeconds: totalSeconds,
    currentRound: rounds,
    rounds,
    serverNow: now,
  };
}

/** Seconds of focus a given participant has accumulated in this session. */
export function participantFocusSeconds(row: GangSessionRow, userId: string, now: number, db: Db = getDb()): number {
  const participant = one<{ focus_seconds: number; state: string }>(
    'SELECT focus_seconds, state FROM gang_participants WHERE session_id = ? AND user_id = ?',
    [row.id, userId],
    db,
  );
  return participant?.focus_seconds ?? 0;
}

/** Participant state implied by the shared clock, for members who never reconnected. */
export function derivedParticipantState(
  row: GangSessionRow,
  storedState: string,
  clock: SessionClockState,
  now: number,
  lastSeenAt: number,
): ParticipantState {
  const state = storedState as ParticipantState;
  if (state === 'left' || state === 'done') return state;
  if (row.status === 'completed') return 'done';
  if (row.status === 'cancelled') return 'left';
  // A participant that stopped heart-beating for over 2 minutes is idle, not focusing.
  if (state === 'focusing' && now - lastSeenAt > 120_000) return 'paused';
  if (clock.phase === PHASE_BREAK && state === 'focusing') return 'break';
  if (clock.phase === PHASE_FOCUS && state === 'break') return 'focusing';
  return state;
}

/* -------------------------------------------------------------------------- */
/*  State transitions                                                         */
/* -------------------------------------------------------------------------- */

export interface GangControlResult {
  session: GangSession;
  clock: SessionClockState;
  changed: boolean;
}

export function startSession(userId: string, sessionId: string, now = Date.now(), db: Db = getDb()): GangControlResult | undefined {
  const row = getSessionRow(sessionId, db);
  if (!row) return undefined;
  if (row.host_id !== userId) return undefined;
  if (row.status === 'completed') return undefined;

  const alreadyRunning = row.status === 'running';
  const secondsRemainingBefore = clockState(row, now).phaseSecondsRemaining;

  const updated = patchSession(
    userId,
    sessionId,
    {
      status: 'running',
      // Starting late should not steal time: the clock starts when the host starts it.
      clockAnchorAt: row.starts_at > now ? row.starts_at : alreadyRunning ? row.clock_anchor_at : now,
      isClockPaused: false,
      clockPausedMs: 0,
    },
    db,
  );

  if (!updated) return undefined;
  const participants = participantRows(sessionId, db);
  for (const participant of participants) {
    if (participant.state === 'invited' || participant.state === 'left') {
      upsertParticipant(sessionId, participant.user_id, { state: 'focusing', secondsRemaining: secondsRemainingBefore }, db);
    }
  }
  return { session: hydrateSession(updated, db), clock: clockState(updated, now), changed: true };
}

export function pauseSession(userId: string, sessionId: string, now = Date.now(), db: Db = getDb()): GangControlResult | undefined {
  const row = getSessionRow(sessionId, db);
  if (!row || row.host_id !== userId || row.status !== 'running') return undefined;
  const elapsedMs = Math.max(0, now - row.clock_anchor_at);
  const updated = patchSession(userId, sessionId, { status: 'paused', isClockPaused: true, clockPausedMs: elapsedMs }, db);
  if (!updated) return undefined;
  return { session: hydrateSession(updated, db), clock: clockState(updated, now), changed: true };
}

export function resumeSession(userId: string, sessionId: string, now = Date.now(), db: Db = getDb()): GangControlResult | undefined {
  const row = getSessionRow(sessionId, db);
  if (!row || row.host_id !== userId || row.status !== 'paused') return undefined;
  const updated = patchSession(
    userId,
    sessionId,
    { status: 'running', isClockPaused: false, clockAnchorAt: now - row.clock_paused_ms, clockPausedMs: 0 },
    db,
  );
  if (!updated) return undefined;
  return { session: hydrateSession(updated, db), clock: clockState(updated, now), changed: true };
}

/** Skip to the next phase (e.g. cut a break short). */
export function skipPhase(userId: string, sessionId: string, now = Date.now(), db: Db = getDb()): GangControlResult | undefined {
  const row = getSessionRow(sessionId, db);
  if (!row || row.host_id !== userId) return undefined;
  const clock = clockState(row, now);
  if (clock.phase === 'finished') return undefined;

  const focusSeconds = Math.max(1, row.focus_minutes) * 60;
  const breakSeconds = Math.max(0, row.break_minutes) * 60;
  // Flatten the clock so the current phase is exactly over.
  const targetElapsed = clock.elapsedSeconds + clock.phaseSecondsRemaining;
  const newElapsedMs = Math.min(
    targetElapsed * 1000,
    row.rounds * focusSeconds * 1000 + (row.rounds - 1) * breakSeconds * 1000,
  );

  const updated = patchSession(
    userId,
    sessionId,
    {
      status: 'running',
      isClockPaused: false,
      clockAnchorAt: now - newElapsedMs,
      clockPausedMs: 0,
      currentRound: Math.min(row.rounds, clock.currentRound + (clock.phase === PHASE_BREAK ? 1 : 0)),
    },
    db,
  );
  if (!updated) return undefined;
  void breakSeconds;
  return { session: hydrateSession(updated, db), clock: clockState(updated, now), changed: true };
}

export function extendSession(
  userId: string,
  sessionId: string,
  seconds: number,
  now = Date.now(),
  db: Db = getDb(),
): GangControlResult | undefined {
  const row = getSessionRow(sessionId, db);
  if (!row || row.host_id !== userId) return undefined;
  const extraMinutes = Math.max(1, Math.round(seconds / 60));
  const updated = patchSession(userId, sessionId, { focusMinutes: row.focus_minutes + extraMinutes }, db);
  if (!updated) return undefined;
  return { session: hydrateSession(updated, db), clock: clockState(updated, now), changed: true };
}

export function stopSession(userId: string, sessionId: string, now = Date.now(), db: Db = getDb()): GangControlResult | undefined {
  const row = getSessionRow(sessionId, db);
  if (!row || row.host_id !== userId) return undefined;
  const elapsedMs = row.is_clock_paused === 1 ? row.clock_paused_ms : Math.max(0, now - row.clock_anchor_at);
  const updated = patchSession(userId, sessionId, { status: 'completed', isClockPaused: true, clockPausedMs: elapsedMs }, db);
  if (!updated) return undefined;
  const session = completeSession(updated, now, db);
  return { session, clock: clockState(updated, now), changed: true };
}

/* -------------------------------------------------------------------------- */
/*  Accrual + completion                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Accrues focus time for everyone currently focusing and auto-completes sessions
 * whose clock has run out. Idempotent: safe to call from a timer, a request, or a
 * socket heartbeat.
 */
export function tickSession(sessionId: string, now = Date.now(), db: Db = getDb()): { session: GangSession; clock: SessionClockState; completed: boolean } | undefined {
  const row = getSessionRow(sessionId, db);
  if (!row || row.deleted_at) return undefined;
  const clock = clockState(row, now);

  if (row.status === 'running') {
    const participants = participantRows(sessionId, db);
    for (const participant of participants) {
      const stillHere = now - participant.last_seen_at < 120_000;
      if (participant.state === 'focusing' && stillHere && clock.phase === PHASE_FOCUS) {
        const delta = Math.min(Math.floor((now - participant.last_seen_at) / 1000), 30);
        if (delta > 0) {
          upsertParticipant(sessionId, participant.user_id, {
            focusSeconds: participant.focus_seconds + delta,
            secondsRemaining: clock.phaseSecondsRemaining,
          }, db);
        } else {
          upsertParticipant(sessionId, participant.user_id, { secondsRemaining: clock.phaseSecondsRemaining }, db);
        }
      } else {
        upsertParticipant(sessionId, participant.user_id, { secondsRemaining: clock.phaseSecondsRemaining }, db);
      }
    }
  }

  if (clock.phase === 'finished' && row.status !== 'completed' && row.status !== 'cancelled') {
    const finished = patchSession(row.host_id, sessionId, {
      status: 'completed',
      isClockPaused: true,
      clockPausedMs: clock.totalSeconds * 1000,
    }, db)!;
    const session = completeSession(finished, now, db);
    return { session, clock: clockState(finished, now), completed: true };
  }

  const fresh = getSessionRow(sessionId, db)!;
  return { session: hydrateSession(fresh, db), clock: clockState(fresh, now), completed: clock.phase === 'finished' };
}

/**
 * Records the outcome of a finished session: writes a focus session per
 * participant (so gang work shows up in analytics and heat maps) and marks
 * participants done.
 */
export function completeSession(row: GangSessionRow, now: number, db: Db = getDb()): GangSession {
  return tx((trx) => {
    const participants = participantRows(row.id, trx);
    for (const participant of participants) {
      const alreadyRecorded = one<{ id: string }>(
        'SELECT id FROM focus_sessions WHERE gang_session_id = ? AND user_id = ?',
        [row.id, participant.user_id],
        trx,
      );
      if (!alreadyRecorded && participant.focus_seconds > 0) {
        const user = one<{ tz_offset_minutes: number }>('SELECT tz_offset_minutes FROM users WHERE id = ?', [participant.user_id], trx);
        const dayKey = toDayKey(now, user?.tz_offset_minutes ?? 0);
        run(
          `INSERT INTO focus_sessions (id, user_id, task_id, project_id, gang_session_id, mode, label,
              planned_minutes, actual_seconds, completed, started_at, ended_at, day_key, created_at, updated_at, seq)
           VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
          [
            newId('fcs'), participant.user_id, row.id, row.mode, `Gang: ${row.title}`,
            row.focus_minutes, participant.focus_seconds, row.starts_at, now, dayKey, now, now,
            nextSeq(participant.user_id, trx),
          ],
          trx,
        );
        incrementActivity(participant.user_id, dayKey, {
          focusMinutes: Math.round(participant.focus_seconds / 60),
        }, trx);
      }
      upsertParticipant(row.id, participant.user_id, { state: 'done' }, trx);
    }
    const fresh = getSessionRow(row.id, trx)!;
    return hydrateSession(fresh, trx);
  }, db);
}

/** Advances every running session. Called on a timer by the realtime gateway. */
export function tickAllActiveSessions(now = Date.now(), db: Db = getDb()): string[] {
  const rows = db
    .prepare(`SELECT id FROM gang_sessions WHERE status IN ('running', 'paused') AND deleted_at IS NULL`)
    .all() as Array<{ id: string }>;
  const completed: string[] = [];
  for (const row of rows) {
    const result = tickSession(row.id, now, db);
    if (result?.completed) completed.push(row.id);
  }
  return completed;
}

/** Invitee joins an existing session (idempotent). */
export function joinSession(userId: string, sessionId: string, now = Date.now(), db: Db = getDb()): GangSession | undefined {
  const row = getSessionRow(sessionId, db);
  if (!row || row.deleted_at) return undefined;
  const clock = clockState(row, now);
  const state: ParticipantState = row.status === 'completed' ? 'done' : clock.phase === PHASE_BREAK ? 'break' : 'focusing';
  const existing = one<{ state: string }>(
    'SELECT state FROM gang_participants WHERE session_id = ? AND user_id = ?',
    [sessionId, userId],
    db,
  );
  if (existing) {
    upsertParticipant(sessionId, userId, { state: state === 'done' ? 'done' : state, secondsRemaining: clock.phaseSecondsRemaining }, db);
  } else {
    addParticipant(sessionId, userId, state, db);
    upsertParticipant(sessionId, userId, { secondsRemaining: clock.phaseSecondsRemaining }, db);
  }
  return hydrateSession(getSessionRow(sessionId, db)!, db);
}

export function reactToSession(userId: string, sessionId: string, reaction: Parameters<typeof insertReaction>[2], db: Db = getDb()): { id: string; createdAt: number } | undefined {
  const row = getSessionRow(sessionId, db);
  if (!row) return undefined;
  const participant = one<{ reactions_sent: number }>(
    'SELECT reactions_sent FROM gang_participants WHERE session_id = ? AND user_id = ?',
    [sessionId, userId],
    db,
  );
  if (!participant) return undefined;
  const created = insertReaction(sessionId, userId, reaction, db);
  upsertParticipant(sessionId, userId, { reactionsSent: participant.reactions_sent + 1 }, db);
  return created;
}

export function listUpcomingForUser(userId: string, now = Date.now(), db: Db = getDb()): GangSession[] {
  return hydrateSessions(upcomingSessionsForUser(userId, now, 10, db), db);
}

/** Whether the user may watch/act on a session (host or participant only). */
export function canAccessSession(userId: string, sessionId: string, db: Db = getDb()): boolean {
  const row = getSessionRow(sessionId, db);
  if (!row) return false;
  if (row.host_id === userId) return true;
  return Boolean(
    one<{ user_id: string }>('SELECT user_id FROM gang_participants WHERE session_id = ? AND user_id = ?', [sessionId, userId], db),
  );
}
