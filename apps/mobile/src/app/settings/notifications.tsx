/**
 * Settings → Notifications.
 *
 * Per-category control plus the OS permission state — if the operating system has
 * notifications switched off for JARVIS, that is said plainly instead of silently
 * producing nothing.
 */
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Badge, Button, Card, Chip, Row, Screen, SectionHeader, Stack, SwitchRow, Type } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { spacing, usePalette } from '../../lib/theme';

const CATEGORIES: Array<{ key: string; label: string; description: string }> = [
  { key: 'taskReminder', label: 'Task reminders', description: 'When a reminder time on a task arrives.' },
  { key: 'deadline', label: 'Upcoming deadlines', description: 'Before a task or project deadline.' },
  { key: 'overdue', label: 'Overdue tasks', description: 'When a task passes its due date.' },
  { key: 'habitReminder', label: 'Habit reminders', description: 'At each habit’s reminder time.' },
  { key: 'focusScheduled', label: 'Scheduled focus', description: 'Before a planned focus block.' },
  { key: 'gangInvite', label: 'Gang invitations', description: 'When someone invites you to a focus session.' },
  { key: 'gangUpcoming', label: 'Group sessions starting', description: 'Shortly before a shared session begins.' },
  { key: 'dailyPlanning', label: 'Daily planning', description: 'A nudge to plan the day.' },
  { key: 'dailyReview', label: 'Daily review', description: 'A nudge to close the day.' },
];

export default function NotificationSettingsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { settings, updateSettings } = useAuth();
  const [permission, setPermission] = useState<string>('unknown');
  const [counts, setCounts] = useState<{ notifications: number; scheduled: number } | null>(null);

  useEffect(() => {
    void (async () => {
      if (Platform.OS === 'web') {
        setPermission('unsupported');
        return;
      }
      try {
        const status = await Notifications.getPermissionsAsync();
        setPermission(status.granted ? 'granted' : status.canAskAgain ? 'askable' : 'denied');
      } catch {
        setPermission('unsupported');
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.get<{ notifications: unknown[]; scheduled: unknown[] }>('/api/notifications');
        setCounts({ notifications: data.notifications.length, scheduled: data.scheduled.length });
      } catch {
        setCounts(null);
      }
    })();
  }, []);

  if (!settings) {
    return (
      <Screen edges={['top']}>
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Type variant="body">Loading your preferences…</Type>
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Button label="Inbox" variant="ghost" icon="notifications-outline" onPress={() => router.push('/notifications')} />
      </Row>

      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          Notifications
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          Choose exactly what is allowed to reach you. Everything else stays inside the app.
        </Type>
      </Stack>

      <Card>
        <Stack gap={spacing.sm}>
          <Row justify="space-between" align="center">
            <Type variant="bodyStrong">Device permission</Type>
            <Badge
              label={
                permission === 'granted'
                  ? 'Granted'
                  : permission === 'askable'
                    ? 'Not requested'
                    : permission === 'denied'
                      ? 'Blocked'
                      : 'Unsupported here'
              }
              color={permission === 'granted' ? palette.success : permission === 'denied' ? palette.danger : palette.warning}
            />
          </Row>
          <Type variant="caption" color={palette.textMuted}>
            {permission === 'granted'
              ? 'Reminders are delivered by the system, so they arrive even when the app is closed.'
              : permission === 'askable'
                ? 'Tap below to let JARVIS send reminders.'
                : permission === 'denied'
                  ? 'Notifications are switched off for JARVIS in your device settings. The in-app inbox still works.'
                  : 'This platform has no local notifications; the in-app inbox still works.'}
          </Type>
          {permission !== 'granted' && permission !== 'unsupported' ? (
            <Button
              label="Request permission"
              size="sm"
              onPress={async () => {
                try {
                  const status = await Notifications.requestPermissionsAsync();
                  setPermission(status.granted ? 'granted' : status.canAskAgain ? 'askable' : 'denied');
                } catch {
                  setPermission('unsupported');
                }
              }}
            />
          ) : null}
          {counts ? (
            <Row gap={spacing.sm} wrap>
              <Badge label={`${counts.notifications} in your inbox`} />
              <Badge label={`${counts.scheduled} reminders queued`} color={palette.primary} />
            </Row>
          ) : null}
        </Stack>
      </Card>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Categories" />
        <Card>
          <Stack gap={spacing.xs}>
            {CATEGORIES.map((category) => (
              <SwitchRow
                key={category.key}
                label={category.label}
                description={category.description}
                value={Boolean((settings.notifications as unknown as Record<string, boolean>)[category.key])}
                onValueChange={(value) => void updateSettings({ notifications: { [category.key]: value } as never })}
              />
            ))}
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Quiet hours" subtitle="Nothing is delivered inside this window" />
        <Card>
          <Row gap={spacing.sm} wrap>
            {[null, '20:00', '21:00', '22:00', '23:00'].map((start) => (
              <Chip
                key={String(start)}
                label={start ? `From ${start}` : 'Off'}
                selected={settings.notifications.quietHoursStart === start}
                onPress={() =>
                  void updateSettings({
                    notifications: { quietHoursStart: start, quietHoursEnd: start ? '07:00' : null } as never,
                  })
                }
              />
            ))}
          </Row>
          {settings.notifications.quietHoursStart ? (
            <Type variant="caption" color={palette.textMuted} style={{ marginTop: spacing.sm }}>
              Quiet from {settings.notifications.quietHoursStart} to {settings.notifications.quietHoursEnd}. Overdue
              warnings are the only exception, and only once.
            </Type>
          ) : null}
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Daily rhythm" />
        <Card>
          <Row gap={spacing.sm} wrap>
            <Badge label={settings.dailyPlanningReminder ? `Planning at ${settings.dailyPlanningReminder}` : 'No planning reminder'} />
            <Badge label={settings.dailyReviewReminder ? `Review at ${settings.dailyReviewReminder}` : 'No review reminder'} />
          </Row>
          <Button
            label="Change the times"
            size="sm"
            variant="secondary"
            onPress={() => router.push('/settings/calendar')}
          />
        </Card>
      </Stack>
    </Screen>
  );
}
