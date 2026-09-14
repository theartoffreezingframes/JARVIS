import type { Priority, SearchResultItem, TaskStatus } from '@jarvis/shared';
import type { Db } from '../db/index.js';
import { getDb } from '../db/index.js';
import { listHabits } from '../repo/habits.js';
import { listNotes } from '../repo/notes.js';
import { listProjects } from '../repo/projects.js';
import { listTasks } from '../repo/tasks.js';
import type { UserRow } from '../repo/rows.js';
import { userToday } from './analytics.js';
import type { DayKey } from '@jarvis/shared';

export type { SearchResultItem };

export interface SearchFilters {
  q: string;
  types?: Array<'task' | 'project' | 'habit' | 'note'>;
  projectId?: string;
  priority?: Priority;
  status?: TaskStatus;
  tags?: string[];
  from?: DayKey;
  to?: DayKey;
  limit?: number;
}

function score(item: { title: string; subtitle?: string | null }, query: string): number {
  const q = query.toLowerCase();
  const title = item.title.toLowerCase();
  if (!q) return 0.5;
  let value = 0;
  if (title === q) value += 1;
  if (title.startsWith(q)) value += 0.6;
  if (title.includes(q)) value += 0.4;
  if (item.subtitle?.toLowerCase().includes(q)) value += 0.15;
  return Math.min(1, value);
}

/** Searching a tag should find everything carrying it, even if the text doesn't match. */
function tagBoost(query: string, tags: readonly string[] | undefined): number {
  if (!query || !tags?.length) return 0;
  const q = query.toLowerCase();
  return tags.some((tag) => tag.toLowerCase().includes(q)) ? 0.3 : 0;
}

/**
 * Global search across tasks, projects, habits and notes.
 *
 * Deliberately simple and fast: indexed LIKE scans over a user-scoped subset
 * (one account's data fits comfortably in memory) with a deterministic ranking,
 * and filters applied in SQL where they are cheapest.
 */
export function globalSearch(user: UserRow, filters: SearchFilters, db: Db = getDb()): SearchResultItem[] {
  const query = filters.q.trim();
  const types = new Set(filters.types ?? ['task', 'project', 'habit', 'note']);
  const today = userToday(user);
  const limit = filters.limit ?? 30;
  const results: SearchResultItem[] = [];

  if (types.has('task')) {
    const tasks = listTasks(
      user.id,
      {
        view: filters.status === 'done' ? 'completed' : 'all',
        today,
        search: query || undefined,
        projectId: filters.projectId ?? undefined,
        priority: filters.priority,
        status: filters.status,
        from: filters.from,
        to: filters.to,
        limit: 200,
      },
      db,
    );
    const tagFiltered = filters.tags?.length
      ? tasks.filter((task) => filters.tags!.every((tag) => task.tags.includes(tag)))
      : tasks;
    for (const task of tagFiltered) {
      results.push({
        type: 'task',
        id: task.id,
        title: task.title,
        subtitle: task.description ?? null,
        meta: {
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          dueTime: task.dueTime,
          projectId: task.projectId,
          tags: task.tags,
          important: task.important,
          urgent: task.urgent,
        },
        score: Math.max(score({ title: task.title, subtitle: task.description }, query), tagBoost(query, task.tags)),
      });
    }
  }

  if (types.has('project')) {
    for (const project of listProjects(user.id, { includeArchived: true, search: query || undefined }, db)) {
      if (filters.tags?.length && !filters.tags.every((tag) => project.tags.includes(tag))) continue;
      results.push({
        type: 'project',
        id: project.id,
        title: project.name,
        subtitle: project.description,
        meta: {
          status: project.status,
          progress: project.progress,
          dueDate: project.dueDate,
          taskCount: project.taskCount,
          tags: project.tags,
        },
        score: Math.max(score({ title: project.name, subtitle: project.description }, query), tagBoost(query, project.tags)),
      });
    }
  }

  if (types.has('habit')) {
    for (const habit of listHabits(user.id, { includeArchived: true, today }, db)) {
      if (query && !`${habit.name} ${habit.description ?? ''}`.toLowerCase().includes(query.toLowerCase())) continue;
      results.push({
        type: 'habit',
        id: habit.id,
        title: habit.name,
        subtitle: habit.description,
        meta: {
          streak: habit.currentStreak,
          bestStreak: habit.bestStreak,
          completedToday: habit.completedToday,
          frequency: habit.frequency,
        },
        score: score({ title: habit.name, subtitle: habit.description }, query),
      });
    }
  }

  if (types.has('note')) {
    for (const note of listNotes(
      user.id,
      { search: query || undefined, projectId: filters.projectId ?? undefined, limit: 100 },
      db,
    )) {
      if (filters.tags?.length && !filters.tags.every((tag) => note.tags.includes(tag))) continue;
      const title = note.title || note.body.slice(0, 60) || 'Untitled note';
      results.push({
        type: 'note',
        id: note.id,
        title,
        subtitle: note.body.slice(0, 140) || null,
        meta: { projectId: note.projectId, taskId: note.taskId, tags: note.tags, pinned: note.pinned },
        score: Math.max(score({ title, subtitle: note.body }, query), tagBoost(query, note.tags)),
      });
    }
  }

  // When a query is present, empty-match noise is worse than a short list.
  return results
    .filter((item) => (query ? item.score > 0.15 : true))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}
