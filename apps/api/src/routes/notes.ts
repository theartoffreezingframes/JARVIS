import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { noteCreateSchema, noteUpdateSchema } from '@jarvis/shared';
import { requireUser } from '../http/auth-plugin.js';
import { AppError, parseOrThrow } from '../lib/errors.js';
import { getNote, insertNote, listNotes, patchNote, softDeleteNote } from '../repo/notes.js';

const idParam = z.object({ id: z.string().min(6).max(64) });

export const noteQuerySchema = z.object({
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  search: z.string().max(200).optional(),
  tag: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export async function registerNoteRoutes(app: FastifyInstance): Promise<void> {
  app.get('/notes', async (request) => {
    const user = requireUser(request);
    const query = parseOrThrow(noteQuerySchema, request.query);
    const notes = listNotes(user.id, {
      projectId: query.projectId === undefined ? undefined : query.projectId === 'none' ? null : query.projectId,
      taskId: query.taskId,
      search: query.search,
      tag: query.tag,
      limit: query.limit,
    });
    return { notes };
  });

  app.post('/notes', async (request, reply) => {
    const user = requireUser(request);
    const input = parseOrThrow(noteCreateSchema, request.body);
    const created = insertNote(user.id, input);
    return reply.status(201).send({ note: getNote(created.id, user.id) });
  });

  app.get('/notes/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const note = getNote(id, user.id);
    if (!note) throw AppError.notFound('That note no longer exists');
    return { note };
  });

  app.patch('/notes/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    const input = parseOrThrow(noteUpdateSchema, request.body);
    const updated = patchNote(user.id, id, input);
    if (!updated) throw AppError.notFound('That note no longer exists');
    return { note: getNote(id, user.id) };
  });

  app.delete('/notes/:id', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parseOrThrow(idParam, request.params);
    softDeleteNote(user.id, id);
    return reply.send({ ok: true });
  });
}
