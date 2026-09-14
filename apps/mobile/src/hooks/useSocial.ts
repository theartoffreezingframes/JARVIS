/** Groups, friends, leaderboards and gang (synchronised) focus sessions. */
import { useCallback, useEffect } from 'react';
import type { GangSession, Group } from '@jarvis/shared';
import { api } from '../lib/api';
import { invalidate, queryKeys, setCached, useQuery } from '../lib/query';
import { realtime, useRealtimeEvent } from '../lib/realtime';
import type {
  FriendsResponse,
  GangDetailResponse,
  GangListResponse,
  GroupDetailResponse,
  GroupsResponse,
  LeaderboardResponse,
} from '../lib/types';

export function useGroups() {
  const query = useQuery<GroupsResponse>(queryKeys.groups, () => api.get<GroupsResponse>('/api/groups'));
  return {
    groups: query.data?.groups ?? [],
    friendCount: query.data?.friendCount ?? 0,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useGroup(groupId: string | null) {
  const query = useQuery<GroupDetailResponse>(groupId ? queryKeys.group(groupId) : null, () =>
    api.get<GroupDetailResponse>(`/api/groups/${groupId}`),
  );
  return {
    group: query.data?.group,
    sessions: query.data?.sessions ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useLeaderboard(groupId: string | null) {
  const query = useQuery<LeaderboardResponse>(groupId ? `leaderboard:${groupId}` : null, () =>
    api.get<LeaderboardResponse>(`/api/groups/${groupId}/leaderboard`),
  );
  return { leaderboard: query.data, error: query.error, refetch: query.refetch };
}

export function useFriends() {
  const query = useQuery<FriendsResponse>('friends', () => api.get<FriendsResponse>('/api/friends'));
  return {
    friends: query.data?.accepted ?? [],
    incoming: query.data?.incoming ?? [],
    outgoing: query.data?.outgoing ?? [],
    error: query.error,
    refetch: query.refetch,
  };
}

export function useGroupMutations() {
  const create = useCallback(async (draft: { name: string; description?: string | null; emoji?: string; leaderboardEnabled?: boolean }) => {
    const payload = await api.post<{ group: Group }>('/api/groups', draft);
    invalidate('groups');
    return payload.group;
  }, []);

  const join = useCallback(async (inviteCode: string) => {
    const payload = await api.post<{ group: Group }>('/api/groups/join', { inviteCode });
    invalidate('groups', 'gang');
    return payload.group;
  }, []);

  const leave = useCallback(async (groupId: string) => {
    await api.post(`/api/groups/${groupId}/leave`);
    invalidate('groups', 'gang');
  }, []);

  const update = useCallback(async (groupId: string, patch: { name?: string; emoji?: string; description?: string | null; leaderboardEnabled?: boolean }) => {
    await api.patch(`/api/groups/${groupId}`, patch);
    invalidate('groups', 'group');
  }, []);

  const remove = useCallback(async (groupId: string) => {
    await api.delete(`/api/groups/${groupId}`);
    invalidate('groups', 'gang');
  }, []);

  const removeMember = useCallback(async (groupId: string, userId: string) => {
    await api.delete(`/api/groups/${groupId}/members/${userId}`);
    invalidate('groups', 'group');
  }, []);

  const requestFriend = useCallback(async (username: string) => {
    await api.post('/api/friends/request', { username });
    invalidate('friends');
  }, []);

  const respondToFriend = useCallback(async (friendshipId: string, accept: boolean) => {
    await api.post(`/api/friends/${friendshipId}/${accept ? 'accept' : 'decline'}`);
    invalidate('friends', 'groups');
  }, []);

  const removeFriend = useCallback(async (friendshipId: string) => {
    await api.delete(`/api/friends/${friendshipId}`);
    invalidate('friends');
  }, []);

  return { create, join, leave, update, remove, removeMember, requestFriend, respondToFriend, removeFriend };
}

export function useGangSessions() {
  const query = useQuery<GangListResponse>('gang/sessions', () => api.get<GangListResponse>('/api/gang/sessions'), {
    staleTime: 10_000,
  });

  // Any state change on the server refreshes the lists the user can see.
  useRealtimeEvent('session_state', () => invalidate('gang'));
  useRealtimeEvent('session_started', () => invalidate('gang'));

  return {
    active: query.data?.active ?? [],
    scheduled: query.data?.scheduled ?? [],
    history: query.data?.history ?? [],
    serverTime: query.data?.serverTime ?? Date.now(),
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useGangSession(sessionId: string | null) {
  const query = useQuery<GangDetailResponse>(sessionId ? queryKeys.gang(sessionId) : null, () =>
    api.get<GangDetailResponse>(`/api/gang/sessions/${sessionId}`),
  );

  useEffect(() => {
    if (!sessionId) return;
    void realtime.connect(sessionId);
    realtime.join(sessionId);
    return () => realtime.leave(sessionId);
  }, [sessionId]);

  // The server pushes authoritative clock updates; never run a local clock of record.
  useRealtimeEvent(
    'session_state',
    (event) => {
      setCached<GangDetailResponse>(queryKeys.gang(sessionId ?? ''), undefined, (current) => {
        if (!current) return current;
        const payload = event as { clock?: GangDetailResponse['clock']; session?: GangSession; reactions?: GangDetailResponse['reactions'] };
        return {
          ...current,
          session: payload.session ?? current.session,
          clock: payload.clock ?? current.clock,
          reactions: payload.reactions ?? current.reactions,
          serverTime: typeof event.serverTime === 'number' ? event.serverTime : current.serverTime,
        };
      });
    },
    Boolean(sessionId),
  );

  useRealtimeEvent(
    'participant_update',
    () => {
      if (sessionId) void query.refetch();
    },
    Boolean(sessionId),
  );

  useRealtimeEvent(
    'reaction',
    (event) => {
      const reaction = event.reaction as GangDetailResponse['reactions'][number] | undefined;
      if (!reaction) return;
      setCached<GangDetailResponse>(queryKeys.gang(sessionId ?? ''), undefined, (current) =>
        current ? { ...current, reactions: [...current.reactions, reaction] } : current,
      );
    },
    Boolean(sessionId),
  );

  return { detail: query.data, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

export function useGangMutations() {
  const create = useCallback(
    async (draft: {
      groupId: string;
      title: string;
      startsAt: number;
      focusMinutes: number;
      breakMinutes?: number;
      rounds?: number;
      mode?: string;
      recurrence?: Record<string, unknown> | null;
      inviteUserIds?: string[];
    }) => {
      const payload = await api.post<{ session: GangSession }>('/api/gang/sessions', draft);
      invalidate('gang', 'groups');
      return payload.session;
    },
    [],
  );

  const control = useCallback(
    async (sessionId: string, action: 'start' | 'pause' | 'resume' | 'skip' | 'stop') => {
      const payload = await api.post<{ session: GangSession; clock: GangDetailResponse['clock'] }>(
        `/api/gang/sessions/${sessionId}/control`,
        { action },
      );
      setCached<GangDetailResponse>(queryKeys.gang(sessionId), undefined, (current) =>
        current ? { ...current, session: payload.session, clock: payload.clock } : current,
      );
      invalidate('gang');
      return payload;
    },
    [],
  );

  const join = useCallback(async (sessionId: string) => {
    await api.post(`/api/gang/sessions/${sessionId}/join`);
    invalidate('gang');
  }, []);

  const setMyState = useCallback(async (sessionId: string, state: 'focusing' | 'break' | 'done' | 'paused') => {
    await api.patch(`/api/gang/sessions/${sessionId}/participants/me`, { state });
    invalidate('gang', `gang:${sessionId}`);
  }, []);

  const react = useCallback(async (sessionId: string, reaction: string) => {
    await api.post(`/api/gang/sessions/${sessionId}/reactions`, { reaction });
  }, []);

  return { create, control, join, setMyState, react };
}
