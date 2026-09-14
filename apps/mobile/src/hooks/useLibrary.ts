/** Projects, notes, tags and global search. */
import { useCallback } from 'react';
import type { Note, Project, Tag } from '@jarvis/shared';
import { api } from '../lib/api';
import { enqueueOperation, isOfflineError } from '../lib/offline';
import { invalidate, queryKeys, useQuery } from '../lib/query';
import type { NotesResponse, ProjectOverviewResponse, ProjectsResponse, SearchResponse } from '../lib/types';

export function useProjects(includeArchived = false) {
  const params = includeArchived ? '?includeArchived=true' : '';
  const query = useQuery<ProjectsResponse>(queryKeys.projects, () =>
    api.get<ProjectsResponse>(`/api/projects${params}`),
  );
  return {
    projects: query.data?.projects ?? [],
    summary: query.data?.summary,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

export function useProject(projectId: string | null) {
  const query = useQuery<ProjectOverviewResponse>(
    projectId ? queryKeys.project(projectId) : null,
    () => api.get<ProjectOverviewResponse>(`/api/projects/${projectId}/overview`),
  );
  return { overview: query.data, isLoading: query.isLoading, refetch: query.refetch };
}

export function useProjectMutations() {
  const create = useCallback(async (draft: Partial<Project> & { name: string }) => {
    const payload = await api.post<{ project: Project }>('/api/projects', draft);
    invalidate('projects', 'dashboard');
    return payload.project;
  }, []);

  const update = useCallback(async (projectId: string, patch: Partial<Project>) => {
    await api.patch(`/api/projects/${projectId}`, patch);
    invalidate('projects', 'project', 'tasks', 'dashboard');
  }, []);

  const remove = useCallback(async (projectId: string) => {
    await api.delete(`/api/projects/${projectId}`);
    invalidate('projects', 'tasks', 'dashboard');
  }, []);

  return { create, update, remove };
}

export function useTags() {
  const query = useQuery<{ tags: Tag[] }>('tags', () => api.get<{ tags: Tag[] }>('/api/tags'));
  return { tags: query.data?.tags ?? [], refetch: query.refetch };
}

export function useNotes(filters: { search?: string; projectId?: string | null; taskId?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.projectId !== undefined && filters.projectId !== null) params.set('projectId', filters.projectId);
  if (filters.taskId) params.set('taskId', filters.taskId);
  const suffix = params.toString();

  const query = useQuery<NotesResponse>(queryKeys.notes(suffix), () => api.get<NotesResponse>(`/api/notes${suffix ? `?${suffix}` : ''}`), {
    staleTime: 15_000,
  });
  return { notes: query.data?.notes ?? [], isLoading: query.isLoading, refetch: query.refetch };
}

export function useNoteMutations() {
  const create = useCallback(async (draft: { title?: string; body?: string; projectId?: string | null; taskId?: string | null; tags?: string[]; pinned?: boolean }) => {
    const payload = await api.post<{ note: Note }>('/api/notes', draft);
    invalidate('notes', 'project', 'dashboard');
    return payload.note;
  }, []);

  const update = useCallback(async (noteId: string, patch: Partial<Note>) => {
    try {
      await api.patch(`/api/notes/${noteId}`, patch);
    } catch (error) {
      if (!isOfflineError(error)) throw error;
      await enqueueOperation({
        label: 'Save note',
        sync: { entity: 'note', op: 'update', entityId: noteId, patch: { ...patch } },
        invalidate: ['notes'],
      });
    }
    invalidate('notes', 'note', 'project');
  }, []);

  const remove = useCallback(async (noteId: string) => {
    await api.delete(`/api/notes/${noteId}`);
    invalidate('notes', 'project', 'dashboard');
  }, []);

  return { create, update, remove };
}

export function useGlobalSearch(query: string, filters: { types?: string[]; status?: string; priority?: string; projectId?: string | null } = {}) {
  const trimmed = query.trim();
  const params = new URLSearchParams();
  params.set('q', trimmed);
  if (filters.types?.length) params.set('types', filters.types.join(','));
  if (filters.status) params.set('status', filters.status);
  if (filters.priority) params.set('priority', filters.priority);
  if (filters.projectId) params.set('projectId', filters.projectId);
  const suffix = params.toString();

  const result = useQuery<SearchResponse>(trimmed.length >= 1 ? `search:${suffix}` : null, () =>
    api.get<SearchResponse>(`/api/search?${suffix}`),
  );
  const suggestions = useQuery<{ suggestions: Array<{ text: string; type: string; id: string }> }>(
    trimmed.length >= 2 ? `search-suggest:${trimmed}` : null,
    () => api.get<{ suggestions: Array<{ text: string; type: string; id: string }> }>(`/api/search/suggest?q=${encodeURIComponent(trimmed)}`),
  );
  return {
    results: result.data?.results ?? [],
    counts: result.data?.counts,
    suggestions: suggestions.data?.suggestions ?? [],
    isSearching: result.isFetching,
  };
}
