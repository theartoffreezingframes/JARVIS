import type { Group, GroupMember, GroupRole } from '@jarvis/shared';
import { addDays, type DayKey } from '@jarvis/shared';
import type { Db } from '../db/index.js';
import { all, getDb, one, run } from '../db/index.js';
import { newId, randomCode } from '../lib/crypto.js';
import { mapGroup, mapGroupMember } from './mappers.js';
import type { GroupMemberRow, GroupRow } from './rows.js';
import { nextSeq } from './users.js';

/* -------------------------------------------------------------------------- */
/*  Groups                                                                    */
/* -------------------------------------------------------------------------- */

export interface GroupWriteInput {
  name: string;
  description?: string | null;
  emoji?: string;
  leaderboardEnabled?: boolean;
  clientId?: string | null;
}

function uniqueInviteCode(db: Db): string {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = randomCode(7);
    const clash = one<{ id: string }>('SELECT id FROM groups WHERE invite_code = ?', [code], db);
    if (!clash) return code;
  }
  return randomCode(9);
}

export function insertGroup(ownerId: string, input: GroupWriteInput, db: Db = getDb()): GroupRow {
  const now = Date.now();
  const id = newId('grp');
  run(
    `INSERT INTO groups (id, name, description, emoji, invite_code, owner_id, leaderboard_enabled,
                         created_at, updated_at, seq, client_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.name, input.description ?? null, input.emoji ?? '🔥', uniqueInviteCode(db), ownerId,
      input.leaderboardEnabled ? 1 : 0, now, now, nextSeq(ownerId, db), input.clientId ?? null,
    ],
    db,
  );
  run('INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', [id, ownerId, 'owner', now], db);
  return one<GroupRow>('SELECT * FROM groups WHERE id = ?', [id], db)!;
}

export function patchGroup(userId: string, groupId: string, patch: Partial<GroupWriteInput>, db: Db = getDb()): GroupRow | undefined {
  const columns: Record<string, string> = {
    name: 'name',
    description: 'description',
    emoji: 'emoji',
    leaderboardEnabled: 'leaderboard_enabled',
  };
  const entries = Object.entries(patch).filter(([k]) => k in columns);
  if (entries.length) {
    const sets = entries.map(([k]) => `${columns[k]} = ?`);
    const values = entries.map(([, v]) => (typeof v === 'boolean' ? (v ? 1 : 0) : v ?? null));
    run(
      `UPDATE groups SET ${sets.join(', ')}, updated_at = ?, seq = ? WHERE id = ?`,
      [...values, Date.now(), nextSeq(userId, db), groupId],
      db,
    );
  }
  return one<GroupRow>('SELECT * FROM groups WHERE id = ?', [groupId], db);
}

export function findGroupByInviteCode(code: string, db: Db = getDb()): GroupRow | undefined {
  return one<GroupRow>(
    'SELECT * FROM groups WHERE invite_code = ? AND deleted_at IS NULL',
    [code.trim().toUpperCase()],
    db,
  );
}

export function memberRow(groupId: string, userId: string, db: Db = getDb()): GroupMemberRow | undefined {
  return one<GroupMemberRow>('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, userId], db);
}

export function addMember(groupId: string, userId: string, role: GroupRole = 'member', db: Db = getDb()): void {
  run(
    `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(group_id, user_id) DO NOTHING`,
    [groupId, userId, role, Date.now()],
    db,
  );
}

export function removeMember(groupId: string, userId: string, db: Db = getDb()): void {
  run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, userId], db);
}

export function setMemberRole(groupId: string, userId: string, role: GroupRole, db: Db = getDb()): void {
  run('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?', [role, groupId, userId], db);
}

export function listGroupRowsForUser(userId: string, db: Db = getDb()): GroupRow[] {
  return all<GroupRow>(
    `SELECT g.* FROM groups g
       JOIN group_members m ON m.group_id = g.id
      WHERE m.user_id = ? AND g.deleted_at IS NULL
      ORDER BY g.created_at ASC`,
    [userId],
    db,
  );
}

export function memberRows(groupId: string, db: Db = getDb()): GroupMemberRow[] {
  return all<GroupMemberRow>(
    `SELECT * FROM group_members WHERE group_id = ? ORDER BY
       CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, joined_at ASC`,
    [groupId],
    db,
  );
}

export interface MemberStats {
  focusMinutes: number;
  sessions: number;
  tasksCompleted: number;
  consistency: number;
}

/**
 * Rolling 7-day member stats for the optional leaderboard. Computed on demand
 * (never stored) so it cannot drift and so opting out is genuinely private.
 */
export function memberStats(userId: string, today: DayKey, db: Db = getDb()): MemberStats {
  const weekStart = addDays(today, -6);
  const focus = one<{ minutes: number; sessions: number }>(
    `SELECT COALESCE(SUM(actual_seconds), 0) / 60 AS minutes, COUNT(*) AS sessions
       FROM focus_sessions
      WHERE user_id = ? AND deleted_at IS NULL AND completed = 1 AND day_key >= ?`,
    [userId, weekStart],
    db,
  );
  const tasks = one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status = 'done' AND completed_at >= ?`,
    [userId, Date.now() - 7 * 86_400_000],
    db,
  );
  const activeDays = one<{ c: number }>(
    `SELECT COUNT(DISTINCT day_key) AS c FROM (
        SELECT day_key FROM focus_sessions WHERE user_id = ? AND deleted_at IS NULL AND day_key >= ?
        UNION ALL
        SELECT CAST(strftime('%Y-%m-%d', completed_at / 1000, 'unixepoch') AS TEXT) AS day_key
          FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status = 'done' AND completed_at >= ?
     )`,
    [userId, weekStart, userId, Date.now() - 7 * 86_400_000],
    db,
  );
  return {
    focusMinutes: focus?.minutes ?? 0,
    sessions: focus?.sessions ?? 0,
    tasksCompleted: tasks?.c ?? 0,
    consistency: Math.round((((activeDays?.c ?? 0) / 7) * 100)),
  };
}

export function hydrateGroups(rows: readonly GroupRow[], viewerId: string, today: DayKey, db: Db = getDb()): Group[] {
  return rows.map((row) => {
    const rows2 = memberRows(row.id, db);
    const userIds = rows2.map((m) => m.user_id);
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
    const leaderboard = row.leaderboard_enabled === 1;
    const members: GroupMember[] = rows2.map((memberRowItem) =>
      mapGroupMember(
        memberRowItem,
        users.get(memberRowItem.user_id),
        leaderboard ? memberStats(memberRowItem.user_id, today, db) : undefined,
      ),
    );
    void viewerId;
    return mapGroup(row, members);
  });
}

export function getGroup(id: string, viewerId: string, today: DayKey, db: Db = getDb()): Group | undefined {
  const row = one<GroupRow>('SELECT * FROM groups WHERE id = ? AND deleted_at IS NULL', [id], db);
  if (!row) return undefined;
  if (!memberRow(id, viewerId, db)) return undefined; // private groups stay private
  return hydrateGroups([row], viewerId, today, db)[0];
}

export function listGroups(userId: string, today: DayKey, db: Db = getDb()): Group[] {
  const rows = listGroupRowsForUser(userId, db);
  return hydrateGroups(rows, userId, today, db);
}

/* -------------------------------------------------------------------------- */
/*  Friends (kept deliberately minimal: accountability, not a feed)            */
/* -------------------------------------------------------------------------- */

export interface FriendshipRow {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: string;
  created_at: number;
  updated_at: number;
}

export function findFriendship(a: string, b: string, db: Db = getDb()): FriendshipRow | undefined {
  return one<FriendshipRow>(
    `SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
    [a, b, b, a],
    db,
  );
}

export function createFriendship(requesterId: string, addresseeId: string, db: Db = getDb()): FriendshipRow {
  const now = Date.now();
  const id = newId('frd');
  run(
    `INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, ?)`,
    [id, requesterId, addresseeId, now, now],
    db,
  );
  return one<FriendshipRow>('SELECT * FROM friendships WHERE id = ?', [id], db)!;
}

export function setFriendshipStatus(id: string, status: string, db: Db = getDb()): void {
  run('UPDATE friendships SET status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), id], db);
}

export function deleteFriendship(id: string, db: Db = getDb()): void {
  run('DELETE FROM friendships WHERE id = ?', [id], db);
}

export interface FriendWithUser {
  friendshipId: string;
  status: string;
  direction: 'outgoing' | 'incoming';
  user: { id: string; name: string; username: string; avatarUrl: string | null };
}

export function listFriends(userId: string, db: Db = getDb()): FriendWithUser[] {
  const rows = all<FriendshipRow>(
    'SELECT * FROM friendships WHERE requester_id = ? OR addressee_id = ? ORDER BY updated_at DESC',
    [userId, userId],
    db,
  );
  const out: FriendWithUser[] = [];
  for (const row of rows) {
    const otherId = row.requester_id === userId ? row.addressee_id : row.requester_id;
    const user = one<{ id: string; name: string; username: string; avatar_url: string | null }>(
      'SELECT id, name, username, avatar_url FROM users WHERE id = ? AND deleted_at IS NULL',
      [otherId],
      db,
    );
    if (!user) continue;
    out.push({
      friendshipId: row.id,
      status: row.status,
      direction: row.requester_id === userId ? 'outgoing' : 'incoming',
      user: { id: user.id, name: user.name, username: user.username, avatarUrl: user.avatar_url },
    });
  }
  return out;
}

export function friendIds(userId: string, db: Db = getDb()): string[] {
  return all<{ other: string }>(
    `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS other
       FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`,
    [userId, userId, userId],
    db,
  ).map((r) => r.other);
}
