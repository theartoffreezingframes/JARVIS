import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { projectCreateSchema, projectUpdateSchema, tagUpsertSchema } from '@jarvis/shared';
import { requireUser } from '../http/auth-plugin.js';
import { AppError, parseOrThrow } from '../lib/errors.js';
import { listNotes } from '../repo/notes.js';
import { getProject, insertProject, listProjects, patchProject, softDeleteProject } from '../repo/projects.js';
import { ensureTag, listTags, listTasks } from '../repo/tasks.js';
import { userToday } from '../services/analytics.js';

const idParam = z.object({ id: z.string().min(6).max(64) });

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects', async (request) => {
    const user = requireUser(request);
    const query = parseOrThrow(
      z.object({
        status: z.enum(['not_started', 'active', 'completed', 'archived']).optional(),
        includeArchived: z.coerce.boolean().optional(),
        search: z.string().max(120).optional(),
      }),
      request.query,
    );
    const projects = listProjects(user.id, query);
    return {
      projects,
      summary: {
        active: projects.filter((p) => p.status === 'active').length,
        completed: projects.filter((p) => p.status === 'completed').length,
        tasks: projects.reduce((sum, p) => sum + p.taskCount, 0),
        completedTasks: projects.reduce((sum, p) => sum + p.completedTaskCount, 0),
      },
    };
  });

  app.post('/projects', async (request, reply) => {
    const user = requireUser(request);
    const input = parseOrThrow(projectCreateSchema, request.body);
    const created = insertProject(user.id, input);
    return reply.status(201).send({ project: getProject(created.id, user.id) });
  });

  app.get('/projects/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const project = getProject(id, user.id);
    if (!project) throw AppError.notFound('That project no longer exists');
    return { project };
  });

  app.patch('/projects/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(projectUpdateSchema, request.body);
    const updated = patchProject(user.id, id, input);
    if (!updated) throw AppError.notFound('That project no longer exists');
    return { project: getProject(id, user.id) };
  });

  app.delete('/projects/:id', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    softDeleteProject(user.id, id);
    return reply.send({ ok: true, message: 'Project deleted. Its tasks were kept and moved out of the project.' });
  });

  /** Project workspace: tasks, notes, progress and upcoming work in one call. */
  app.get('/projects/:id/overview', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const project = getProject(id, user.id);
    if (!project) throw AppError.notFound('That project no longer exists');
    const today = userToday(user);

    const tasks = listTasks(user.id, { view: 'all', today, projectId: id, limit: 300 });
    const notes = listNotes(user.id, { projectId: id, limit: 100 });
    const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'archived');
    const done = tasks.filter((t) => t.status === 'done');

    return {
      project,
      tasks,
      notes,
      stats: {
        total: tasks.length,
        open: open.length,
        completed: done.length,
        overdue: open.filter((t) => t.dueDate && t.dueDate < today).length,
        estimatedMinutes: open.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0),
        focusMinutes: 0,
      },
      nextUp: open
        .filter((t) => t.dueDate)
        .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
        .slice(0, 5),
    };
  });

  /* --------------------------------- tags -------------------------------- */

  app.get('/tags', async (request) => {
    const user = requireUser(request);
    return { tags: listTags(user.id) };
  });

  app.post('/tags', async (request, reply) => {
    const user = requireUser(request);
    const input = parseOrThrow(tagUpsertSchema, request.body);
    const tag = ensureTag(user.id, input.name);
    return reply.status(201).send({ tag: { id: tag.id, name: tag.name, color: tag.color } });
  });
}
