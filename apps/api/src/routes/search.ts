import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../http/auth-plugin.js';
import { getDb } from '../db/index.js';
import { parseOrThrow } from '../lib/errors.js';
import { globalSearch } from '../services/search.js';

const searchSchema = z.object({
  q: z.string().trim().max(120).default(''),
  types: z.string().optional(),
  projectId: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  status: z.enum(['todo', 'in_progress', 'done', 'archived']).optional(),
  tags: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Global search across tasks, projects, habits and notes with filters.
   * Optionally writes the term into recent searches for the empty state.
   */
  app.get('/search', async (request) => {
    const user = requireUser(request);
    const query = parseOrThrow(searchSchema, request.query);

    const results = globalSearch(user, {
      q: query.q,
      types: query.types
        ? (query.types.split(',').filter((t) =>
            ['task', 'project', 'habit', 'note'].includes(t),
          ) as Array<'task' | 'project' | 'habit' | 'note'>)
        : undefined,
      projectId: query.projectId === 'none' ? undefined : query.projectId,
      priority: query.priority,
      status: query.status,
      tags: query.tags ? query.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      from: query.from,
      to: query.to,
      limit: query.limit,
    });

    if (query.q.length > 1) {
      getDb()
        .prepare(
          `INSERT INTO audit_log (id, user_id, action, created_at) VALUES (?, ?, ?, ?)`,
        )
        .run(`sea_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, user.id, `search:${query.q.slice(0, 60)}`, Date.now());
    }

    return {
      results,
      counts: {
        task: results.filter((r) => r.type === 'task').length,
        project: results.filter((r) => r.type === 'project').length,
        habit: results.filter((r) => r.type === 'habit').length,
        note: results.filter((r) => r.type === 'note').length,
      },
    };
  });

  /** Recent searches power the search empty state without extra state storage. */
  app.get('/search/recent', async (request) => {
    const user = requireUser(request);
    const rows = getDb()
      .prepare(
        `SELECT action, MAX(created_at) AS at FROM audit_log
          WHERE user_id = ? AND action LIKE 'search:%'
          GROUP BY action ORDER BY at DESC LIMIT 8`,
      )
      .all(user.id) as Array<{ action: string; at: number }>;
    return {
      recent: rows.map((row) => ({ query: row.action.replace(/^search:/, ''), at: row.at })),
    };
  });

  /** Lightweight typeahead used by quick-add and the planner. */
  app.get('/search/suggest', async (request) => {
    const user = requireUser(request);
    const query = parseOrThrow(z.object({ q: z.string().trim().min(1).max(80) }), request.query);
    const results = globalSearch(user, { q: query.q, types: ['task', 'project'], limit: 8 });
    return { suggestions: results };
  });
}
