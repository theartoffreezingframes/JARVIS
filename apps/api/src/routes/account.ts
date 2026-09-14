import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  changeEmailSchema,
  dayKeySchema,
  deleteAccountSchema,
  parseNaturalLanguageTask,
  updateProfileSchema,
  updateSettingsSchema,
} from '@jarvis/shared';
import { requireUser, userSettings } from '../http/auth-plugin.js';
import { getDb, one, run } from '../db/index.js';
import { AppError, parseOrThrow } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { mapUser, parseSettings, defaultSettings } from '../repo/mappers.js';
import {
  audit,
  findUserByEmail,
  findUserById,
  findUserByUsername,
  getSettingsRow,
  insertSettingsRow,
  revokeAllRefreshTokens,
  updatePasswordHash,
} from '../repo/users.js';
import { hydrateTasks, listTags } from '../repo/tasks.js';
import { hydrateProjects } from '../repo/projects.js';
import { listHabits } from '../repo/habits.js';
import { listNotes } from '../repo/notes.js';
import { hydrateFocusSessions } from '../repo/focus.js';
import { listGroups } from '../repo/social.js';
import { userToday } from '../services/analytics.js';

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me', async (request) => {
    const user = requireUser(request, true);
    return { user: mapUser(user), settings: request.settings! };
  });

  app.patch('/me', async (request) => {
    const user = requireUser(request);
    const input = parseOrThrow(updateProfileSchema, request.body);

    if (input.username && input.username !== user.username) {
      const clash = findUserByUsername(input.username);
      if (clash && clash.id !== user.id) throw AppError.conflict('That username is taken');
    }

    const columns: Record<string, string> = {
      name: 'name',
      username: 'username',
      avatarUrl: 'avatar_url',
      bio: 'bio',
      timezone: 'timezone',
      timezoneOffsetMinutes: 'tz_offset_minutes',
      weekStartsOn: 'week_starts_on',
      use24Hour: 'use_24_hour',
    };
    const entries = Object.entries(input).filter(([key]) => key in columns);
    if (entries.length) {
      const sets = entries.map(([key]) => `${columns[key]} = ?`);
      const values = entries.map(([, value]) => (typeof value === 'boolean' ? (value ? 1 : 0) : value ?? null));
      run(`UPDATE users SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...values, Date.now(), user.id]);
    }

    const refreshed = findUserById(user.id) ?? user;
    return { user: mapUser(refreshed), settings: parseSettings(refreshed, getSettingsRow(refreshed.id)) };
  });

  /** Settings are stored as one versioned document — cheap to read, easy to extend. */
  app.patch('/me/settings', async (request) => {
    const user = requireUser(request, true);
    const input = parseOrThrow(updateSettingsSchema, request.body);
    const current = userSettings(request, user);

    const merged = {
      ...current,
      ...input,
      notifications: { ...current.notifications, ...(input.notifications ?? {}) },
      dashboardWidgets: input.dashboardWidgets ?? current.dashboardWidgets,
    };

    insertSettingsRow(user.id, merged);

    // Week start / 24h clock are also mirrored onto the user row so every query
    // that needs them does not have to parse the settings blob.
    if (input.weekStartsOn !== undefined || input.use24Hour !== undefined) {
      run('UPDATE users SET week_starts_on = ?, use_24_hour = ?, updated_at = ? WHERE id = ?', [
        merged.weekStartsOn,
        merged.use24Hour ? 1 : 0,
        Date.now(),
        user.id,
      ]);
    }

    const refreshed = findUserById(user.id) ?? user;
    return { settings: parseSettings(refreshed, getSettingsRow(refreshed.id)) };
  });

  app.post('/me/settings/reset', async (request) => {
    const user = requireUser(request);
    insertSettingsRow(user.id, defaultSettings(user));
    return { settings: defaultSettings(user) };
  });

  app.post('/me/email', async (request) => {
    const user = requireUser(request);
    const input = parseOrThrow(changeEmailSchema, request.body);
    const ok = await verifyPassword(input.password, user.password_hash);
    if (!ok) throw AppError.badRequest('Your password is incorrect');
    const existing = findUserByEmail(input.newEmail);
    if (existing && existing.id !== user.id) throw AppError.conflict('That email is already registered');
    run('UPDATE users SET email = ?, email_verified = 0, updated_at = ? WHERE id = ?', [
      input.newEmail.toLowerCase(),
      Date.now(),
      user.id,
    ]);
    audit('account.change_email', { userId: user.id, ip: request.ip });
    const refreshed = findUserById(user.id) ?? user;
    return { user: mapUser(refreshed), message: 'Email updated.' };
  });

  /**
   * Full data export. Streams a JSON document (or CSV per entity) so users can
   * take their data with them — a trust requirement, not a nice-to-have.
   */
  app.get('/me/export', async (request, reply) => {
    const user = requireUser(request, true);
    const query = parseOrThrow(z.object({ format: z.enum(['json', 'csv']).default('json') }), request.query);

    const db = getDb();
    const tasks = hydrateTasks(
      db.prepare('SELECT * FROM tasks WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at').all(user.id) as never,
    );
    const projects = hydrateProjects(
      db.prepare('SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at').all(user.id) as never,
    );
    const habits = listHabits(user.id, { includeArchived: true, today: userToday(user) });
    const notes = listNotes(user.id, { limit: 500 });
    const focusSessions = hydrateFocusSessions(
      db.prepare('SELECT * FROM focus_sessions WHERE user_id = ? AND deleted_at IS NULL ORDER BY started_at').all(user.id) as never,
    );
    const groups = listGroups(user.id, userToday(user));
    const reviews = db.prepare('SELECT * FROM daily_reviews WHERE user_id = ? ORDER BY day_key').all(user.id) as never[];
    const completions = db
      .prepare('SELECT * FROM habit_completions WHERE user_id = ? AND deleted_at IS NULL ORDER BY day_key')
      .all(user.id) as never[];

    const payload = {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      profile: { ...mapUser(user), passwordHash: undefined },
      settings: request.settings,
      projects,
      tasks,
      tags: listTags(user.id),
      habits,
      habitCompletions: completions,
      focusSessions,
      notes,
      groups,
      dailyReviews: reviews,
    };

    const filename = `jarvis-export-${new Date().toISOString().slice(0, 10)}`;

    if (query.format === 'csv') {
      const rows: string[] = ['type,id,title,status,due_date,project,created_at,updated_at'];
      const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      for (const task of tasks) {
        rows.push(
          [
            'task',
            task.id,
            task.title,
            task.status,
            task.dueDate ?? '',
            projects.find((p) => p.id === task.projectId)?.name ?? '',
            new Date(task.createdAt).toISOString(),
            new Date(task.updatedAt).toISOString(),
          ]
            .map(escape)
            .join(','),
        );
      }
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="${filename}.csv"`);
      return reply.send(rows.join('\n'));
    }

    reply.header('content-disposition', `attachment; filename="${filename}.json"`);
    return reply.send(payload);
  });

  /**
   * Account deletion: soft-delete the user, revoke every session and clear
   * credentials. Data is retained only as anonymised rows for referential
   * integrity, and is excluded from every query by `deleted_at IS NULL`.
   */
  app.delete('/me', async (request, reply) => {
    const user = requireUser(request);
    const input = parseOrThrow(deleteAccountSchema, request.body);
    const ok = await verifyPassword(input.password, user.password_hash);
    if (!ok) throw AppError.badRequest('Your password is incorrect');

    const now = Date.now();
    const db = getDb();
    db.prepare('UPDATE users SET deleted_at = ?, email = ?, username = ?, name = ?, avatar_url = NULL, bio = NULL, password_hash = ?, updated_at = ? WHERE id = ?')
      .run(
        now,
        `deleted+${user.id}@jarvis.invalid`,
        `deleted_${user.id.slice(-10)}`,
        'Deleted account',
        await hashPassword(`deleted-${user.id}-${now}`),
        now,
        user.id,
      );
    revokeAllRefreshTokens(user.id);
    db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(user.id);
    audit('account.delete', { userId: user.id, ip: request.ip });

    reply.clearCookie('jarvis_at', { path: '/' });
    return reply.send({ ok: true, message: 'Your account has been deleted.' });
  });

  /** Privacy summary — what we store and why, surfaced in the app. */
  app.get('/me/privacy', async (request) => {
    const user = requireUser(request);
    const counts = one<{ tasks: number; notes: number; sessions: number }>(
      `SELECT
         (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND deleted_at IS NULL) AS tasks,
         (SELECT COUNT(*) FROM notes WHERE user_id = ? AND deleted_at IS NULL) AS notes,
         (SELECT COUNT(*) FROM focus_sessions WHERE user_id = ? AND deleted_at IS NULL) AS sessions`,
      [user.id, user.id, user.id],
    );
    return {
      dataStored: counts ?? { tasks: 0, notes: 0, sessions: 0 },
      notes: [
        'Your tasks, projects, habits, notes and focus history are stored against your account id only.',
        'Group members can see your focus status and totals inside a session. They never see your task titles unless you share them.',
        'Leaderboards are opt-in per group and can be turned off at any time.',
        'Password reset tokens and refresh tokens are stored only as SHA-256 digests.',
        'You can export or delete everything from Settings at any time.',
      ],
    };
  });

  /** Server-side quick capture (same parser as the client, useful for widgets/shortcuts). */
  app.post('/me/quick-capture', async (request) => {
    const user = requireUser(request);
    const input = parseOrThrow(
      z.object({ input: z.string().trim().min(2).max(500) }),
      request.body,
    );
    const parsed = parseNaturalLanguageTask(input.input, {
      now: Date.now(),
      offsetMinutes: user.tz_offset_minutes,
    });
    return { parsed };
  });
}
