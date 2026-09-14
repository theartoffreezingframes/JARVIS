import type { Note } from '@jarvis/shared';
import type { Db } from '../db/index.js';
import { all, getDb, one, run } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { mapNote } from './mappers.js';
import type { NoteRow } from './rows.js';
import { ensureTag } from './tasks.js';
import { nextSeq } from './users.js';

export interface NoteWriteInput {
  title?: string;
  body?: string;
  projectId?: string | null;
  taskId?: string | null;
  tags?: string[];
  pinned?: boolean;
  clientId?: string | null;
}

export function insertNote(userId: string, input: NoteWriteInput, db: Db = getDb()): NoteRow {
  const now = Date.now();
  const id = newId('nte');
  run(
    `INSERT INTO notes (id, user_id, project_id, task_id, title, body, pinned, created_at, updated_at, seq, client_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, userId, input.projectId ?? null, input.taskId ?? null,
      input.title ?? '', input.body ?? '', input.pinned ? 1 : 0,
      now, now, nextSeq(userId, db), input.clientId ?? null,
    ],
    db,
  );
  if (input.tags?.length) setNoteTags(userId, id, input.tags, db);
  return one<NoteRow>('SELECT * FROM notes WHERE id = ?', [id], db)!;
}

export function patchNote(userId: string, noteId: string, patch: NoteWriteInput, db: Db = getDb()): NoteRow | undefined {
  const columns: Record<string, string> = {
    title: 'title',
    body: 'body',
    projectId: 'project_id',
    taskId: 'task_id',
    pinned: 'pinned',
  };
  const entries = Object.entries(patch).filter(([k]) => k in columns);
  if (entries.length) {
    const sets = entries.map(([k]) => `${columns[k]} = ?`);
    const values = entries.map(([, v]) => (typeof v === 'boolean' ? (v ? 1 : 0) : v ?? null));
    run(
      `UPDATE notes SET ${sets.join(', ')}, updated_at = ?, seq = ? WHERE id = ? AND user_id = ?`,
      [...values, Date.now(), nextSeq(userId, db), noteId, userId],
      db,
    );
  }
  if (patch.tags) setNoteTags(userId, noteId, patch.tags, db);
  return one<NoteRow>('SELECT * FROM notes WHERE id = ? AND user_id = ?', [noteId, userId], db);
}

export function softDeleteNote(userId: string, noteId: string, db: Db = getDb()): void {
  const now = Date.now();
  run('UPDATE notes SET deleted_at = ?, updated_at = ?, seq = ? WHERE id = ? AND user_id = ?', [
    now, now, nextSeq(userId, db), noteId, userId,
  ], db);
}

export function setNoteTags(userId: string, noteId: string, names: readonly string[], db: Db = getDb()): void {
  run('DELETE FROM note_tags WHERE note_id = ? AND user_id = ?', [noteId, userId], db);
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 12);
  for (const name of unique) {
    const tag = ensureTag(userId, name, db);
    run('INSERT OR IGNORE INTO note_tags (note_id, tag_id, user_id) VALUES (?, ?, ?)', [noteId, tag.id, userId], db);
  }
}

export function getNoteTagNames(noteId: string, db: Db = getDb()): string[] {
  return all<{ name: string }>(
    `SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ? AND t.deleted_at IS NULL ORDER BY t.name`,
    [noteId],
    db,
  ).map((r) => r.name);
}

export function hydrateNotes(rows: readonly NoteRow[], db: Db = getDb()): Note[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(', ');
  const tagRows = all<{ note_id: string; name: string }>(
    `SELECT nt.note_id, t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
      WHERE nt.note_id IN (${placeholders}) AND t.deleted_at IS NULL ORDER BY t.name`,
    ids,
    db,
  );
  const tagsByNote = new Map<string, string[]>();
  for (const row of tagRows) {
    const list = tagsByNote.get(row.note_id) ?? [];
    list.push(row.name);
    tagsByNote.set(row.note_id, list);
  }
  return rows.map((row) => mapNote(row, tagsByNote.get(row.id) ?? []));
}

export function listNotes(
  userId: string,
  filters: { projectId?: string | null; taskId?: string; search?: string; tag?: string; limit?: number } = {},
  db: Db = getDb(),
): Note[] {
  const where = ['n.user_id = ?', 'n.deleted_at IS NULL'];
  const params: unknown[] = [userId];
  if (filters.projectId !== undefined) {
    if (filters.projectId === null) where.push('n.project_id IS NULL');
    else {
      where.push('n.project_id = ?');
      params.push(filters.projectId);
    }
  }
  if (filters.taskId) {
    where.push('n.task_id = ?');
    params.push(filters.taskId);
  }
  if (filters.search) {
    const like = `%${filters.search.replace(/[%_]/g, '')}%`;
    where.push('(n.title LIKE ? OR n.body LIKE ?)');
    params.push(like, like);
  }
  if (filters.tag) {
    where.push('n.id IN (SELECT nt.note_id FROM note_tags nt JOIN tags g ON g.id = nt.tag_id WHERE g.user_id = ? AND g.name = ?)');
    params.push(userId, filters.tag);
  }
  const rows = all<NoteRow>(
    `SELECT n.* FROM notes n WHERE ${where.join(' AND ')} ORDER BY n.pinned DESC, n.updated_at DESC LIMIT ?`,
    [...params, Math.min(filters.limit ?? 200, 500)],
    db,
  );
  return hydrateNotes(rows, db);
}

export function getNote(id: string, userId: string, db: Db = getDb()): Note | undefined {
  const row = one<NoteRow>('SELECT * FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [id, userId], db);
  if (!row) return undefined;
  return hydrateNotes([row], db)[0];
}

export function countNotes(userId: string, db: Db = getDb()): number {
  return one<{ c: number }>('SELECT COUNT(*) AS c FROM notes WHERE user_id = ? AND deleted_at IS NULL', [userId], db)?.c ?? 0;
}
