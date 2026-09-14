/**
 * Notifications.
 *
 * The list is real: rows come from the API, and the scheduled section is the
 * set of reminders the server computed from due dates, habit times, gang
 * sessions and daily planning/review slots. Tapping a row opens the thing it
 * refers to.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert, View } from 'react-native';
import { Badge, Button, Card, EmptyState, ErrorBlock, LoadingBlock, Row, Screen, SectionHeader, Stack, SwitchRow, Type } from '../components/ui';
import { useNotificationFeed } from '../hooks/useNotifications';
import { useAuth } from '../lib/auth';
import { spacing, usePalette } from '../lib/theme';

const PREFERENCE_ROWS: Array<{ key: keyof NotificationPrefs; label: string; description: string }> = [
  { key: 'taskReminder', label: 'Task reminders', description: 'When a reminder time arrives on a task.' },
  { key: 'deadline', label: 'Deadlines', description: 'Ahead of a task or project deadline.' },
  { key: 'overdue', label: 'Overdue tasks', description: 'Once a task passes its date.' },
  { key: 'habitReminder', label: 'Habit reminders', description: 'At each habit’s reminder time.' },
  { key: 'focusScheduled', label: 'Scheduled focus', description: 'Before a planned focus block.' },
  { key: 'gangInvite', label: 'Gang invites', description: 'When someone invites you to a group session.' },
  { key: 'gangUpcoming', label: 'Upcoming group sessions', description: 'Shortly before a session starts.' },
  { key: 'dailyPlanning', label: 'Daily planning', description: 'A nudge to plan the day.' },
  { key: 'dailyReview', label: 'Daily review', description: 'A nudge to close the day.' },
];

type NotificationPrefs = {
  taskReminder: boolean;
  deadline: boolean;
  overdue: boolean;
  habitReminder: boolean;
  focusScheduled: boolean;
  gangInvite: boolean;
  gangUpcoming: boolean;
  dailyPlanning: boolean;
  dailyReview: boolean;
};

export default function NotificationsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { settings, updateSettings } = useAuth();
  const { notifications, scheduled, unreadCount, isLoading, error, markRead, readAll, remove, refetch } =
    useNotificationFeed();

  const prefs = (settings?.notifications ?? null) as (NotificationPrefs & { quietHoursStart?: string | null }) | null;

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Row gap={spacing.sm}>
          {unreadCount > 0 ? <Button label="Mark all read" size="sm" variant="secondary" onPress={() => void readAll()} /> : null}
          <Button
            label="Clear"
            size="sm"
            variant="ghost"
            onPress={() =>
              Alert.alert('Clear all notifications?', 'Scheduled reminders are not affected.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Clear', style: 'destructive' },
              ])
            }
          />
        </Row>
      </Row>

      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          Notifications
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          {unreadCount > 0 ? `${unreadCount} unread` : 'You are up to date'}
        </Type>
      </Stack>

      {isLoading && notifications.length === 0 ? <LoadingBlock label="Loading notifications" /> : null}

      {!isLoading && error && notifications.length === 0 ? (
        <ErrorBlock message="Notifications could not be loaded." onRetry={() => void refetch()} />
      ) : null}

      {!isLoading && !error && notifications.length === 0 ? (
        <EmptyState
          icon="notifications-off-outline"
          title="Nothing here yet"
          body="Reminders, deadline warnings and group invites will appear here."
        />
      ) : null}

      {notifications.map((notification) => (
        <Card
          key={notification.id}
          style={notification.readAt ? undefined : { borderColor: palette.primary }}
          onPress={async () => {
            if (!notification.readAt) await markRead(notification.id, true);
            if (notification.taskId) router.push(`/task/${notification.taskId}`);
            else if (notification.sessionId) router.push(`/gang/${notification.sessionId}`);
            else if (notification.groupId) router.push(`/group/${notification.groupId}`);
            else if (notification.habitId) router.push('/habits');
          }}
          accessibilityLabel={notification.title}
        >
          <Stack gap={6}>
            <Row justify="space-between" align="flex-start">
              <Row gap={spacing.sm} style={{ flex: 1 }}>
                <Ionicons name={iconFor(notification.kind)} size={16} color={palette.primary} />
                <Type variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
                  {notification.title}
                </Type>
              </Row>
              {notification.readAt ? null : <Badge label="New" color={palette.primary} />}
            </Row>
            <Type variant="caption" color={palette.textMuted}>
              {notification.body}
            </Type>
            <Row justify="space-between" align="center">
              <Type variant="micro" color={palette.textFaint}>
                {new Date(notification.createdAt).toLocaleString()}
              </Type>
              <Row gap={spacing.sm}>
                <Button
                  label={notification.readAt ? 'Unread' : 'Read'}
                  size="sm"
                  variant="ghost"
                  onPress={async () => {
                    await markRead(notification.id, !notification.readAt);
                    void refetch();
                  }}
                />
                <Button
                  label="Dismiss"
                  size="sm"
                  variant="ghost"
                  onPress={async () => {
                    await remove(notification.id);
                    void refetch();
                  }}
                />
              </Row>
            </Row>
          </Stack>
        </Card>
      ))}

      {scheduled.length > 0 ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Scheduled" subtitle={`${scheduled.length} reminders queued from your own data`} />
          {scheduled.slice(0, 12).map((item) => (
            <Card key={item.id}>
              <Row gap={spacing.sm} align="center">
                <Ionicons name={iconFor(item.kind)} size={15} color={palette.textMuted} />
                <Stack gap={2} style={{ flex: 1 }}>
                  <Type variant="caption" numberOfLines={1}>
                    {item.title}
                  </Type>
                  <Type variant="micro" color={palette.textFaint}>
                    {new Date(item.scheduledFor).toLocaleString()}
                  </Type>
                </Stack>
              </Row>
            </Card>
          ))}
        </Stack>
      ) : null}

      <Stack gap={spacing.sm}>
        <SectionHeader title="Preferences" subtitle="Choose exactly what is allowed to interrupt you" />
        <Card>
          <Stack gap={spacing.xs}>
            {prefs
              ? PREFERENCE_ROWS.map((row) => (
                  <SwitchRow
                    key={row.key}
                    label={row.label}
                    description={row.description}
                    value={prefs[row.key]}
                    onValueChange={(value) =>
                      void updateSettings({ notifications: { [row.key]: value } as never })
                    }
                  />
                ))
              : null}
          </Stack>
        </Card>

        <Card>
          <Stack gap={spacing.sm}>
            <Type variant="bodyStrong">Quiet hours</Type>
            <Type variant="caption" color={palette.textMuted}>
              Outside these hours nothing is delivered except overdue task warnings.
            </Type>
            <Row gap={spacing.sm} wrap>
              {[null, '21:00', '22:00', '23:00'].map((start) => (
                <Button
                  key={String(start)}
                  label={start ? `From ${start}` : 'Off'}
                  size="sm"
                  variant={prefs?.quietHoursStart === start ? 'primary' : 'secondary'}
                  onPress={() =>
                    void updateSettings({
                      notifications: { quietHoursStart: start, quietHoursEnd: start ? '07:00' : null } as never,
                    })
                  }
                />
              ))}
            </Row>
          </Stack>
        </Card>
      </Stack>

      <View style={{ marginTop: spacing.sm }}>
        <Button label="Notification permission" variant="ghost" onPress={() => router.push('/settings/notifications')} />
      </View>
    </Screen>
  );
}

function iconFor(kind: string): React.ComponentProps<typeof Ionicons>['name'] {
  if (kind.startsWith('habit')) return 'repeat';
  if (kind.startsWith('gang')) return 'people';
  if (kind === 'deadline') return 'calendar';
  if (kind === 'overdue') return 'alert-circle';
  if (kind === 'daily_planning') return 'list';
  if (kind === 'daily_review') return 'journal';
  if (kind === 'focus_scheduled') return 'timer';
  return 'notifications';
}
