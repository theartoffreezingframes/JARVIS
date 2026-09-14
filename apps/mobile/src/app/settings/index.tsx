/**
 * Account & settings.
 *
 * The hub for profile, customization, notifications, data and privacy. Every
 * control writes to the account (not the device), so preferences follow the user
 * across installs.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  Field,
  Input,
  ListRow,
  LoadingBlock,
  Row,
  Screen,
  SectionHeader,
  Segmented,
  Stack,
  Type,
} from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { applyThemeSettings, spacing, usePalette } from '../../lib/theme';
import { api } from '../../lib/api';

export default function SettingsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { user, settings, updateProfile, updateSettings, signOut, refreshMe } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [demoState, setDemoState] = useState<{ enabled: boolean } | null>(null);

  if (!user || !settings) {
    return (
      <Screen edges={['top']}>
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <LoadingBlock label="Loading your account" />
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Button label="Home" variant="ghost" icon="home-outline" onPress={() => router.replace('/(tabs)')} />
      </Row>

      <Card>
        <Row gap={spacing.md} align="center">
          <Avatar name={user.name} url={user.avatarUrl} size={52} />
          <Stack gap={3} style={{ flex: 1 }}>
            <Type variant="headline">{user.name}</Type>
            <Type variant="caption" color={palette.textMuted}>
              @{user.username} · {user.email}
            </Type>
            <Row gap={spacing.sm} wrap>
              {user.emailVerified ? (
                <Badge label="Email verified" color={palette.success} icon="checkmark-circle" />
              ) : (
                <Badge label="Email not verified" color={palette.warning} icon="alert-circle" />
              )}
              <Badge label={user.timezone} />
              <Badge label={`member since ${new Date(user.createdAt).toLocaleDateString()}`} />
            </Row>
          </Stack>
          <Button label="Edit" size="sm" variant="secondary" onPress={() => setEditing((value) => !value)} />
        </Row>
      </Card>

      {message ? (
        <Card style={{ backgroundColor: palette.surfaceMuted }}>
          <Type variant="caption">{message}</Type>
        </Card>
      ) : null}

      {editing ? (
        <Card>
          <Stack gap={spacing.md}>
            <Field label="Name">
              <Input value={name} onChangeText={setName} />
            </Field>
            <Field label="Username" hint="Others use this to add you as a friend.">
              <Input
                value={username}
                onChangeText={(value) => setUsername(value.toLowerCase().replace(/[^a-z0-9._]/g, ''))}
                autoCapitalize="none"
              />
            </Field>
            <Field label="Bio">
              <Input value={bio} onChangeText={setBio} placeholder="A line about how you work" multiline />
            </Field>
            <Row gap={spacing.sm}>
              <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} />
              <Button
                label="Save profile"
                loading={busy}
                onPress={async () => {
                  setBusy(true);
                  setMessage(null);
                  try {
                    await updateProfile({ name: name.trim(), username: username.trim(), bio: bio.trim() || null });
                    setEditing(false);
                    setMessage('Profile updated.');
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : 'Could not save your profile');
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </Row>
          </Stack>
        </Card>
      ) : null}

      <Stack gap={spacing.xs}>
        <SectionHeader title="Customize" subtitle="Make it yours — saved to your account" />
        <Card>
          <ListRow
            title="Appearance"
            subtitle={`${settings.theme} theme · ${settings.appearance.preset} preset`}
            icon="color-palette"
            onPress={() => router.push('/settings/appearance')}
          />
          <View style={{ height: 1, backgroundColor: palette.border, marginLeft: 46 }} />
          <ListRow
            title="Dashboard"
            subtitle={`${settings.dashboardWidgets.filter((widget) => widget.visible).length} widgets visible · ${settings.dashboardLayout} layout`}
            icon="grid"
            onPress={() => router.push('/settings/dashboard')}
          />
          <View style={{ height: 1, backgroundColor: palette.border, marginLeft: 46 }} />
          <ListRow
            title="Tasks"
            subtitle={`Default ${settings.taskDefaults.priority} priority · ${settings.defaultTaskDurationMinutes} min · sorted by ${settings.taskDisplay.sort}`}
            icon="checkbox"
            onPress={() => router.push('/settings/tasks')}
          />
          <View style={{ height: 1, backgroundColor: palette.border, marginLeft: 46 }} />
          <ListRow
            title="Eisenhower matrix"
            subtitle={`Quadrant names, default classification · ${settings.matrix.displayStyle} view`}
            icon="grid-outline"
            onPress={() => router.push('/settings/matrix')}
          />
          <View style={{ height: 1, backgroundColor: palette.border, marginLeft: 46 }} />
          <ListRow
            title="Focus & pomodoro"
            subtitle={`${settings.pomodoroFocusMinutes} / ${settings.pomodoroShortBreakMinutes} / ${settings.pomodoroLongBreakMinutes} · ${settings.pomodoroSessionsBeforeLongBreak} rounds`}
            icon="timer"
            onPress={() => router.push('/settings/focus')}
          />
          <View style={{ height: 1, backgroundColor: palette.border, marginLeft: 46 }} />
          <ListRow
            title="Calendar & habits"
            subtitle={`Week starts ${settings.weekStartsOn === 1 ? 'Monday' : 'Sunday'} · ${settings.calendar.display} view`}
            icon="calendar"
            onPress={() => router.push('/settings/calendar')}
          />
        </Card>
      </Stack>

      <Stack gap={spacing.xs}>
        <SectionHeader title="Notifications" />
        <Card>
          <ListRow
            title="Reminders & permissions"
            subtitle={
              settings.notifications.taskReminder || settings.notifications.habitReminder
                ? 'Task, habit, deadline and group notifications'
                : 'All reminders are off'
            }
            icon="notifications"
            onPress={() => router.push('/settings/notifications')}
          />
        </Card>
      </Stack>

      <Stack gap={spacing.xs}>
        <SectionHeader title="Account" />
        <Card>
          <ListRow title="Change email" subtitle={user.email} icon="mail" onPress={() => router.push('/settings/email')} />
          <View style={{ height: 1, backgroundColor: palette.border, marginLeft: 46 }} />
          <ListRow title="Change password" subtitle="Revokes sessions on other devices" icon="lock-closed" onPress={() => router.push('/settings/password')} />
          <View style={{ height: 1, backgroundColor: palette.border, marginLeft: 46 }} />
          <ListRow title="Data & privacy" subtitle="Export, sample data, delete account" icon="shield-checkmark" onPress={() => router.push('/settings/data')} />
          <View style={{ height: 1, backgroundColor: palette.border, marginLeft: 46 }} />
          <ListRow title="About JARVIS" subtitle="Version, offline behaviour, how sync works" icon="information-circle" onPress={() => router.push('/settings/about')} />
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Quick preferences" />
        <Card>
          <Stack gap={spacing.md}>
            <Field label="Theme">
              <Segmented
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
                value={settings.theme}
                onChange={(value) => {
                  // Apply immediately, then persist to the account.
                  applyThemeSettings({ preference: value });
                  void updateSettings({ theme: value });
                }}
              />
            </Field>
            <Field label="Start of week">
              <Segmented
                options={[
                  { value: '1', label: 'Monday' },
                  { value: '0', label: 'Sunday' },
                ]}
                value={String(settings.weekStartsOn)}
                onChange={(value) => void updateSettings({ weekStartsOn: value === '1' ? 1 : 0 })}
              />
            </Field>
            <Field label="Clock">
              <Segmented
                options={[
                  { value: '24', label: '24-hour' },
                  { value: '12', label: '12-hour' },
                ]}
                value={settings.use24Hour ? '24' : '12'}
                onChange={(value) => void updateSettings({ use24Hour: value === '24' })}
              />
            </Field>
            <Row gap={spacing.sm} wrap>
              <Badge label={`Day ${settings.dayStartTime}–${settings.dayEndTime}`} />
              <Badge label={`${settings.dashboardWidgets.length} widgets known`} />
              <Badge label={settings.leaderboardEnabled ? 'Leaderboards on' : 'Leaderboards hidden'} />
            </Row>
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Sample data" subtitle="Optional, and always removable" />
        <Card>
          <Stack gap={spacing.sm}>
            <Type variant="caption" color={palette.textMuted}>
              Your workspace starts empty. If you would like to see the analytics, heat maps and planner with realistic
              content, you can add a clearly-labelled sample workspace inside this account and remove it in one tap.
            </Type>
            <Row gap={spacing.sm} wrap>
              <Button
                label="Try demo data"
                icon="flask-outline"
                variant="secondary"
                onPress={async () => {
                  setBusy(true);
                  try {
                    const result = await api.post<{ demoData: { enabled: boolean } }>('/api/me/demo-data');
                    setDemoState(result.demoData);
                    await refreshMe();
                    setMessage('Sample workspace added. Remove it any time from Data & privacy.');
                  } catch {
                    setMessage('Could not add the sample workspace.');
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              <Button
                label="Remove demo data"
                icon="trash-outline"
                variant="ghost"
                onPress={async () => {
                  setBusy(true);
                  try {
                    const result = await api.delete<{ demoData: { enabled: boolean } }>('/api/me/demo-data');
                    setDemoState(result.demoData);
                    await refreshMe();
                    setMessage('Sample workspace removed. Anything you created yourself is untouched.');
                  } catch {
                    setMessage('Could not remove the sample workspace.');
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </Row>
            {demoState ? (
              <Type variant="caption" color={demoState.enabled ? palette.success : palette.textMuted}>
                {demoState.enabled ? 'Sample workspace is present.' : 'Sample workspace removed.'}
              </Type>
            ) : null}
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Session" />
        <Button
          label="Sign out"
          icon="log-out-outline"
          variant="secondary"
          onPress={() =>
            Alert.alert('Sign out?', 'Your data stays on your account. Offline changes are synced first.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
            ])
          }
          full
        />
        <Type variant="micro" color={palette.textFaint} style={{ textAlign: 'center' }}>
          JARVIS 1.0.0 · {user.id}
        </Type>
      </Stack>
    </Screen>
  );
}
