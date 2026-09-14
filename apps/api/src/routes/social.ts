import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  gangControlSchema,
  gangParticipantUpdateSchema,
  gangReactionSchema,
  gangSessionCreateSchema,
  groupCreateSchema,
  groupJoinSchema,
  groupMemberUpdateSchema,
  groupUpdateSchema,
} from '@jarvis/shared';
import { requireUser } from '../http/auth-plugin.js';
import { AppError, parseOrThrow } from '../lib/errors.js';
import { audit } from '../repo/users.js';
import {
  addParticipant,
  getSessionRow,
  hydrateSession,
  hydrateSessions,
  insertGangSession,
  listSessionsForGroup,
  listSessionsForUser,
  participantRows,
  removeParticipant,
  upsertParticipant,
  userGroupIds,
} from '../repo/gang.js';
import { insertNotification, listNotifications } from '../repo/notifications.js';
import {
  addMember,
  createFriendship,
  deleteFriendship,
  findFriendship,
  findGroupByInviteCode,
  friendIds,
  getGroup,
  insertGroup,
  listFriends,
  listGroups,
  memberRow,
  patchGroup,
  removeMember,
  setFriendshipStatus,
  setMemberRole,
} from '../repo/social.js';
import { findUserByUsername, findUsersByUsernameLike } from '../repo/users.js';
import { userToday } from '../services/analytics.js';
import {
  canAccessSession,
  extendSession,
  joinSession,
  pauseSession,
  reactToSession,
  resumeSession,
  skipPhase,
  startSession,
  stopSession,
  tickSession,
} from '../services/gang.js';
import { getDb, run } from '../db/index.js';

const idParam = z.object({ id: z.string().min(6).max(64) });

export async function registerSocialRoutes(app: FastifyInstance): Promise<void> {
  /* -------------------------------- groups -------------------------------- */

  app.get('/groups', async (request) => {
    const user = requireUser(request);
    const today = userToday(user);
    const groups = listGroups(user.id, today);
    return {
      groups,
      friendCount: friendIds(user.id).length,
    };
  });

  app.post('/groups', async (request, reply) => {
    const user = requireUser(request);
    const input = parseOrThrow(groupCreateSchema, request.body);
    const created = insertGroup(user.id, input);
    audit('group.create', { userId: user.id, ip: request.ip });
    return reply.status(201).send({ group: getGroup(created.id, user.id, userToday(user)) });
  });

  app.get('/groups/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const group = getGroup(id, user.id, userToday(user));
    if (!group) throw AppError.notFound('That group is not available');
    const sessions = hydrateSessions(listSessionsForGroup(id, 12));
    return { group, sessions };
  });

  app.patch('/groups/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const membership = memberRow(id, user.id);
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw AppError.forbidden('Only the group owner or an admin can edit this group');
    }
    const input = parseOrThrow(groupUpdateSchema, request.body);
    patchGroup(user.id, id, input);
    return { group: getGroup(id, user.id, userToday(user)) };
  });

  app.delete('/groups/:id', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const group = getGroup(id, user.id, userToday(user));
    if (!group) throw AppError.notFound('That group is not available');
    if (group.ownerId !== user.id) throw AppError.forbidden('Only the owner can delete a group');
    run('UPDATE groups SET deleted_at = ? WHERE id = ?', [Date.now(), id]);
    return reply.send({ ok: true });
  });

  /** Join with an invite code. Codes are unguessable and single-purpose. */
  app.post('/groups/join', async (request) => {
    const user = requireUser(request);
    const input = parseOrThrow(groupJoinSchema, request.body);
    const group = findGroupByInviteCode(input.inviteCode);
    if (!group) throw AppError.notFound('That invite code is not valid');
    const existing = memberRow(group.id, user.id);
    addMember(group.id, user.id, 'member');
    return {
      group: getGroup(group.id, user.id, userToday(user)),
      alreadyMember: Boolean(existing),
    };
  });

  app.post('/groups/:id/leave', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const membership = memberRow(id, user.id);
    if (!membership) throw AppError.notFound('You are not a member of that group');
    if (membership.role === 'owner') {
      throw AppError.badRequest('Transfer ownership or delete the group instead of leaving it');
    }
    removeMember(id, user.id);
    return reply.send({ ok: true });
  });

  app.delete('/groups/:id/members/:userId', async (request, reply) => {
    const user = requireUser(request);
    const params = parseOrThrow(idParam.extend({ userId: z.string().min(6) }), request.params);
    const membership = memberRow(params.id, user.id);
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw AppError.forbidden('Only the owner or an admin can remove members');
    }
    if (params.userId === user.id) throw AppError.badRequest('You cannot remove yourself');
    removeMember(params.id, params.userId);
    detachMemberFromGroup(params.id, params.userId);
    return reply.send({ ok: true });
  });

  app.patch('/groups/:id/members/:userId', async (request) => {
    const user = requireUser(request);
    const params = parseOrThrow(idParam.extend({ userId: z.string().min(6) }), request.params);
    const membership = memberRow(params.id, user.id);
    if (!membership || membership.role !== 'owner') throw AppError.forbidden('Only the owner can change roles');
    const input = parseOrThrow(groupMemberUpdateSchema, request.body);
    setMemberRole(params.id, params.userId, input.role);
    return { group: getGroup(params.id, user.id, userToday(user)) };
  });

  /** Optional, friendly leaderboard. Disabled by default and never used for ranking users. */
  app.get('/groups/:id/leaderboard', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const group = getGroup(id, user.id, userToday(user));
    if (!group) throw AppError.notFound('That group is not available');
    if (!group.leaderboardEnabled) {
      return { enabled: false, entries: [], message: 'The leaderboard is turned off for this group.' };
    }
    const entries = [...group.members]
      .map((member) => ({
        userId: member.userId,
        name: member.name,
        username: member.username,
        avatarUrl: member.avatarUrl,
        focusMinutes: member.focusMinutes ?? 0,
        sessions: member.sessions ?? 0,
        tasksCompleted: member.tasksCompleted ?? 0,
        consistency: member.consistency ?? 0,
      }))
      .sort((a, b) => b.focusMinutes - a.focusMinutes);
    return { enabled: true, entries, periodDays: 7 };
  });

  /* -------------------------------- friends ------------------------------- */

  app.get('/friends', async (request) => {
    const user = requireUser(request);
    const friends = listFriends(user.id);
    return {
      accepted: friends.filter((f) => f.status === 'accepted'),
      incoming: friends.filter((f) => f.status === 'pending' && f.direction === 'incoming'),
      outgoing: friends.filter((f) => f.status === 'pending' && f.direction === 'outgoing'),
    };
  });

  app.get('/friends/search', async (request) => {
    const user = requireUser(request);
    const query = parseOrThrow(z.object({ q: z.string().trim().min(1).max(40) }), request.query);
    const results = findUsersByUsernameLike(query.q, user.id).map((row) => ({
      id: row.id,
      name: row.name,
      username: row.username,
      avatarUrl: row.avatar_url,
      friendship: findFriendship(user.id, row.id)?.status ?? null,
    }));
    return { results };
  });

  app.post('/friends/request', async (request, reply) => {
    const user = requireUser(request);
    const input = parseOrThrow(z.object({ username: z.string().trim().min(2).max(40) }), request.body);
    const target = findUserByUsername(input.username);
    if (!target || target.id === user.id) throw AppError.notFound('No account with that username');
    const existing = findFriendship(user.id, target.id);
    if (existing) {
      if (existing.status === 'accepted') return reply.send({ ok: true, status: 'accepted' });
      if (existing.addressee_id === user.id) {
        setFriendshipStatus(existing.id, 'accepted');
        return reply.send({ ok: true, status: 'accepted' });
      }
      return reply.send({ ok: true, status: 'pending' });
    }
    createFriendship(user.id, target.id);
    return reply.status(201).send({ ok: true, status: 'pending', user: { id: target.id, name: target.name, username: target.username } });
  });

  app.post('/friends/:id/accept', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const friendship = findFriendship(user.id, id);
    if (!friendship) throw AppError.notFound('No pending request from that account');
    if (friendship.addressee_id !== user.id) throw AppError.forbidden('Only the recipient can accept a request');
    setFriendshipStatus(friendship.id, 'accepted');
    return { ok: true };
  });

  app.post('/friends/:id/decline', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const friendship = findFriendship(user.id, id);
    if (!friendship) throw AppError.notFound('No pending request from that account');
    deleteFriendship(friendship.id);
    return reply.send({ ok: true });
  });

  app.delete('/friends/:id', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const friendship = findFriendship(user.id, id);
    if (!friendship) throw AppError.notFound('Not connected with that account');
    deleteFriendship(friendship.id);
    return reply.send({ ok: true });
  });

  /* ------------------------------ gang timer ------------------------------ */

  app.get('/gang/sessions', async (request) => {
    const user = requireUser(request);
    const rows = listSessionsForUser(user.id, 30);
    const sessions = hydrateSessions(rows);
    const now = Date.now();
    return {
      active: sessions.filter((s) => s.status === 'running' || s.status === 'paused'),
      scheduled: sessions.filter((s) => s.status === 'scheduled' && s.startsAt >= now - 3_600_000),
      history: sessions.filter((s) => s.status === 'completed' || s.status === 'cancelled').slice(0, 15),
      serverTime: now,
    };
  });

  /** Schedule (or start now) a group focus session and invite participants. */
  app.post('/gang/sessions', async (request, reply) => {
    const user = requireUser(request);
    const input = parseOrThrow(gangSessionCreateSchema, request.body);

    const membership = memberRow(input.groupId, user.id);
    if (!membership) throw AppError.forbidden('You must be a group member to start a session');

    const created = insertGangSession({
      groupId: input.groupId,
      hostId: user.id,
      title: input.title,
      startsAt: input.startsAt,
      focusMinutes: input.focusMinutes,
      breakMinutes: input.breakMinutes,
      rounds: input.rounds,
      mode: input.mode,
      recurrence: input.recurrence ? JSON.stringify(input.recurrence) : null,
      clientId: input.clientId ?? null,
    });

    addParticipant(created.id, user.id, 'focusing');
    upsertParticipant(created.id, user.id, { isHost: true, state: 'focusing' });

    // Members of the group are invited; the host decides who actually joins.
    const members = getDb()
      .prepare('SELECT user_id FROM group_members WHERE group_id = ?')
      .all(input.groupId) as Array<{ user_id: string }>;
    for (const member of members) {
      if (member.user_id === user.id) continue;
      addParticipant(created.id, member.user_id, 'invited');
      insertNotification(member.user_id, {
        kind: 'gang_invite',
        title: `${user.name} started “${input.title}”`,
        body: 'Join the gang focus session',
        sessionId: created.id,
        groupId: input.groupId,
        scheduledFor: Date.now(),
      });
      insertNotification(member.user_id, {
        kind: 'gang_upcoming',
        title: `Upcoming: ${input.title}`,
        body: `${input.focusMinutes} minute session`,
        sessionId: created.id,
        groupId: input.groupId,
        scheduledFor: Math.max(Date.now() + 60_000, input.startsAt - 15 * 60_000),
      });
    }

    const session = hydrateSession(created);
    app.realtime?.broadcast(created.group_id, { type: 'session_state', sessionId: created.id, payload: session });
    return reply.status(201).send({ session });
  });

  app.get('/gang/sessions/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    if (!canAccessSession(user.id, id)) throw AppError.notFound('That session is not available');
    const tick = tickSession(id);
    return { session: tick?.session ?? hydrateSession(getSessionRow(id)!), clock: tick?.clock };
  });

  app.post('/gang/sessions/:id/join', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const row = getSessionRow(id);
    if (!row) throw AppError.notFound('That session no longer exists');
    if (!memberRow(row.group_id, user.id) && !canAccessSession(user.id, id)) {
      throw AppError.forbidden('Join the group first');
    }
    const session = joinSession(user.id, id);
    if (!session) throw AppError.notFound('That session no longer exists');
    app.realtime?.broadcast(session.groupId, { type: 'participant_update', sessionId: id, payload: session });
    return { session };
  });

  app.post('/gang/sessions/:id/leave', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    upsertParticipant(id, user.id, { state: 'left' });
    const session = hydrateSession(getSessionRow(id)!);
    app.realtime?.broadcast(session.groupId, { type: 'participant_update', sessionId: id, payload: session });
    return reply.send({ ok: true, session });
  });

  /** Individual pause/resume — you can step out without stopping the group. */
  app.patch('/gang/sessions/:id/participants/me', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(gangParticipantUpdateSchema, request.body);
    if (!canAccessSession(user.id, id)) throw AppError.notFound('That session is not available');
    upsertParticipant(id, user.id, { state: input.state });
    const session = hydrateSession(getSessionRow(id)!);
    app.realtime?.broadcast(session.groupId, { type: 'participant_update', sessionId: id, payload: session });
    return { session };
  });

  app.post('/gang/sessions/:id/reactions', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(gangReactionSchema, request.body);
    if (!canAccessSession(user.id, id)) throw AppError.notFound('That session is not available');
    const created = reactToSession(user.id, id, input.reaction);
    if (!created) throw AppError.badRequest('Join the session before sending reactions');
    app.realtime?.broadcastToSession(id, {
      type: 'reaction',
      sessionId: id,
      payload: { userId: user.id, name: user.name, reaction: input.reaction, createdAt: created.createdAt },
    });
    return reply.status(201).send({ ok: true });
  });

  /** Host-only transport controls for the shared clock. */
  app.post('/gang/sessions/:id/control', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(gangControlSchema, request.body);
    const row = getSessionRow(id);
    if (!row) throw AppError.notFound('That session no longer exists');
    if (row.host_id !== user.id) throw AppError.forbidden('Only the host can control the session timer');

    const actions = {
      start: () => startSession(user.id, id),
      pause: () => pauseSession(user.id, id),
      resume: () => resumeSession(user.id, id),
      skip: () => skipPhase(user.id, id),
      stop: () => stopSession(user.id, id),
      extend: () => extendSession(user.id, id, input.seconds ?? 300),
    } as const;

    const result = actions[input.action]();
    if (!result) throw AppError.badRequest(`Could not ${input.action} this session right now`);

    app.realtime?.broadcast(result.session.groupId, {
      type: result.clock.phase === 'finished' ? 'session_completed' : 'session_state',
      sessionId: id,
      payload: { session: result.session, clock: result.clock },
    });
    return { session: result.session, clock: result.clock };
  });

  /** Sessions in groups the user belongs to — used for the dashboard widget. */
  app.get('/gang/upcoming', async (request) => {
    const user = requireUser(request);
    const groupIds = userGroupIds(user.id);
    if (!groupIds.length) return { sessions: [] };
    const placeholders = groupIds.map(() => '?').join(', ');
    const rows = getDb()
      .prepare(
        `SELECT * FROM gang_sessions WHERE group_id IN (${placeholders}) AND deleted_at IS NULL
           AND status IN ('scheduled','running','paused') ORDER BY starts_at ASC LIMIT 10`,
      )
      .all(...groupIds) as never[];
    return { sessions: hydrateSessions(rows as never) };
  });
}

// `removeParticipant` from the gang repo takes (sessionId, userId); removing a
// group member detaches them from that group's future sessions instead.
export function detachMemberFromGroup(groupId: string, userId: string): void {
  const rows = getDb()
    .prepare('SELECT id FROM gang_sessions WHERE group_id = ? AND status IN (\'scheduled\', \'running\')')
    .all(groupId) as Array<{ id: string }>;
  for (const row of rows) removeParticipant(row.id, userId);
}

export { listNotifications };
