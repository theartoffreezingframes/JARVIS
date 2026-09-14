import type { DayKey, Priority, Project, ProjectStatus } from '@jarvis/shared';
import type { Db } from '../db/index.js';
import { all, getDb, one, run } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { mapProject } from './mappers.js';
import type { ProjectRow } from './rows.js';
import { ensureTag, projectRollups } from './tasks.js';
import { nextSeq } from './users.js';

export interface ProjectWriteInput {
  name: string;
  description?: string | null;
  color?: string;
  icon?: string | null;
  status?: ProjectStatus;
  priority?: Priority;
  dueDate?: DayKey | null;
  tags?: string[];
  clientId?: string | null;
}

export function insertProject(userId: string, input: ProjectWriteInput, db: Db = getDb()): ProjectRow {
  const now = Date.now();
  const id = newId('prj');
  run(
    `INSERT INTO projects (id, user_id, name, description, color, icon, status, priority, due_date,
                           created_at, updated_at, seq, client_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      input.name,
      input.description ?? null,
      input.color ?? '#6C5CE7',
      input.icon ?? null,
      input.status ?? 'active',
      input.priority ?? 'medium',
      input.dueDate ?? null,
      now,
      now,
      nextSeq(userId, db),
      input.clientId ?? null,
    ],
    db,
  );
  if (input.tags?.length) setProjectTags(userId, id, input.tags, db);
  return one<ProjectRow>('SELECT * FROM projects WHERE id = ?', [id], db)!;
}

export function patchProject(
  userId: string,
  projectId: string,
  patch: Partial<ProjectWriteInput>,
  db: Db = getDb(),
): ProjectRow | undefined {
  const columns: Record<string, string> = {
    name: 'name',
    description: 'description',
    color: 'color',
    icon: 'icon',
    status: 'status',
    priority: 'priority',
    dueDate: 'due_date',
  };
  const entries = Object.entries(patch).filter(([k]) => k in columns);
  if (entries.length) {
    const sets = entries.map(([k]) => `${columns[k]} = ?`);
    run(
      `UPDATE projects SET ${sets.join(', ')}, updated_at = ?, seq = ? WHERE id = ? AND user_id = ?`,
      [...entries.map(([, v]) => v ?? null), Date.now(), nextSeq(userId, db), projectId, userId],
      db,
    );
  }
  if (patch.tags) setProjectTags(userId, projectId, patch.tags, db);
  return one<ProjectRow>('SELECT * FROM projects WHERE id = ? AND user_id = ?', [projectId, userId], db);
}

export function softDeleteProject(userId: string, projectId: string, db: Db = getDb()): void {
  const now = Date.now();
  const seq = nextSeq(userId, db);
  run('UPDATE projects SET deleted_at = ?, updated_at = ?, seq = ? WHERE id = ? AND user_id = ?', [
    now, now, seq, projectId, userId,
  ], db);
  // Keep tasks: detach them so nothing is silently destroyed.
  run('UPDATE tasks SET project_id = NULL, updated_at = ?, seq = ? WHERE project_id = ? AND user_id = ?', [
    now, seq, projectId, userId,
  ], db);
  run('UPDATE notes SET project_id = NULL, updated_at = ?, seq = ? WHERE project_id = ? AND user_id = ?', [
    now, seq, projectId, userId,
  ], db);
}

export function setProjectTags(userId: string, projectId: string, names: readonly string[], db: Db = getDb()): void {
  run('DELETE FROM project_tags WHERE project_id = ? AND user_id = ?', [projectId, userId], db);
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 12);
  for (const name of unique) {
    const tag = ensureTag(userId, name, db);
    run('INSERT OR IGNORE INTO project_tags (project_id, tag_id, user_id) VALUES (?, ?, ?)', [projectId, tag.id, userId], db);
  }
}

export function getProjectTagNames(projectId: string, db: Db = getDb()): string[] {
  return all<{ name: string }>(
    `SELECT t.name FROM tags t JOIN project_tags pt ON pt.tag_id = t.id
      WHERE pt.project_id = ? AND t.deleted_at IS NULL ORDER BY t.name`,
    [projectId],
    db,
  ).map((r) => r.name);
}

export function hydrateProjects(rows: readonly ProjectRow[], db: Db = getDb()): Project[] {
  if (!rows.length) return [];
  const rollups = projectRollups(db === getDb() ? undefined === undefined ? rows[0]!.user_id : rows[0]!.user_id : rows[0]!.user_id, db);
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(', ');
  const tagRows = all<{ project_id: string; name: string }>(
    `SELECT pt.project_id, t.name FROM project_tags pt JOIN tags t ON t.id = pt.tag_id
      WHERE pt.project_id IN (${placeholders}) AND t.deleted_at IS NULL ORDER BY t.name`,
    ids,
    db,
  );
  const tagsByProject = new Map<string, string[]>();
  for (const row of tagRows) {
    const list = tagsByProject.get(row.project_id) ?? [];
    list.push(row.name);
    tagsByProject.set(row.project_id, list);
  }
  return rows.map((row) =>
    mapProject(row, tagsByProject.get(row.id) ?? [], rollups.get(row.id) ?? { taskCount: 0, completedTaskCount: 0 }),
  );
}

export function listProjects(
  userId: string,
  filters: { status?: ProjectStatus; includeArchived?: boolean; search?: string } = {},
  db: Db = getDb(),
): Project[] {
  const where = ['p.user_id = ?', 'p.deleted_at IS NULL'];
  const params: unknown[] = [userId];
  if (filters.status) {
    where.push('p.status = ?');
    params.push(filters.status);
  } else if (!filters.includeArchived) {
    where.push(`p.status != 'archived'`);
  }
  if (filters.search) {
    where.push('(p.name LIKE ? OR p.description LIKE ?)');
    const like = `%${filters.search.replace(/[%_]/g, '')}%`;
    params.push(like, like);
  }
  const rows = all<ProjectRow>(
    `SELECT p.* FROM projects p WHERE ${where.join(' AND ')}
      ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'not_started' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
               p.updated_at DESC`,
    params,
    db,
  );
  const rollups = projectRollups(userId, db);
  const ids = rows.map((r) => r.id);
  const tagsByProject = new Map<string, string[]>();
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(', ');
    const tagRows = all<{ project_id: string; name: string }>(
      `SELECT pt.project_id, t.name FROM project_tags pt JOIN tags t ON t.id = pt.tag_id
        WHERE pt.project_id IN (${placeholders}) AND t.deleted_at IS NULL ORDER BY t.name`,
      ids,
      db,
    );
    for (const row of tagRows) {
      const list = tagsByProject.get(row.project_id) ?? [];
      list.push(row.name);
      tagsByProject.set(row.project_id, list);
    }
  }
  return rows.map((row) =>
    mapProject(row, tagsByProject.get(row.id) ?? [], rollups.get(row.id) ?? { taskCount: 0, completedTaskCount: 0 }),
  );
}

export function getProject(id: string, userId: string, db: Db = getDb()): Project | undefined {
  const row = one<ProjectRow>('SELECT * FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [id, userId], db);
  if (!row) return undefined;
  return hydrateProjects([row], db)[0];
}
