/**
 * Notifications.
 *
 * The server decides what should be announced and when; the app mirrors those
 * scheduled items into local notifications so reminders still arrive with no
 * connection, and re-syncs whenever it comes back to the foreground.
 */
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { api } from '../lib/api';
import { invalidate, useQuery } from '../lib/query';
import { useAuth } from '../lib/auth';
import type { NotificationsResponse } from '../lib/types';

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
} catch {
  /* web has no local notifications */
}

export function useNotifications() {
  const { status, settings } = useAuth();
  const scheduledRef = useRef<string[]>([]);

  useEffect(() => {
    if (status !== 'signedIn' || Platform.OS === 'web') return;
    let cancelled = false;

    void (async () => {
      try {
        const current = await Notifications.getPermissionsAsync();
        if (!current.granted && current.canAskAgain) await Notifications.requestPermissionsAsync();
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Reminders',
            importance: Notifications.AndroidImportance.DEFAULT,
            vibrationPattern: [0, 120, 80, 120],
          });
        }
      } catch {
        return;
      }
      if (cancelled) return;

      try {
        const payload = await api.get<NotificationsResponse>('/api/notifications');
        if (cancelled) return;

        const wanted = payload.scheduled
          .filter((item) => item.scheduledFor > Date.now())
          .filter((item) => {
            const prefs = payload.preferences;
            if (item.kind.startsWith('habit') && !prefs.habitReminder) return false;
            if (item.kind.startsWith('gang') && !prefs.gangInvite && !prefs.gangUpcoming) return false;
            if (item.kind === 'task_reminder' && !prefs.taskReminder) return false;
            if (item.kind === 'deadline' && !prefs.deadline) return false;
            if (item.kind === 'overdue' && !prefs.overdue) return false;
            if (item.kind === 'daily_planning' && !prefs.dailyPlanning) return false;
            if (item.kind === 'daily_review' && !prefs.dailyReview) return false;
            return true;
          })
          .slice(0, 40);

        // Replace the previous schedule so edits never double-notify.
        await Notifications.cancelAllScheduledNotificationsAsync();
        for (const item of wanted) {
          await Notifications.scheduleNotificationAsync({
            identifier: item.id,
            content: { title: item.title, body: item.body, data: { kind: item.kind, taskId: item.taskId } },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: new Date(item.scheduledFor),
              channelId: 'default',
            },
          });
        }
        scheduledRef.current = wanted.map((item) => item.id);
      } catch {
        /* offline: the previous schedule stays valid */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, settings?.notifications]);

  return { scheduledIds: scheduledRef.current };
}

export function useNotificationFeed() {
  const query = useQuery<NotificationsResponse>('notifications', () => api.get<NotificationsResponse>('/api/notifications'), {
    staleTime: 30_000,
  });

  const markRead = async (id: string, read = true) => {
    await api.post(`/api/notifications/${id}/${read ? 'read' : 'unread'}`);
    invalidate('notifications');
  };
  const readAll = async () => {
    await api.post('/api/notifications/read-all');
    invalidate('notifications');
  };
  const remove = async (id: string) => {
    await api.delete(`/api/notifications/${id}`);
    invalidate('notifications');
  };
  const clear = async () => {
    await api.post('/api/notifications/clear');
    invalidate('notifications');
  };

  return {
    notifications: query.data?.notifications ?? [],
    scheduled: query.data?.scheduled ?? [],
    unreadCount: query.data?.unreadCount ?? 0,
    preferences: query.data?.preferences,
    isLoading: query.isLoading,
    refetch: query.refetch,
    markRead,
    readAll,
    remove,
    clear,
  };
}
