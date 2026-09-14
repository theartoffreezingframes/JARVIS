/**
 * More — everything that is important but not daily-driver enough for the bar.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Badge, Card, ListRow, Row, Screen, SectionHeader, Stack, Type, type IconName } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useDashboard, usePlanner } from '../../hooks/useDashboard';
import { useGroups, useGangSessions } from '../../hooks/useSocial';
import { useNotes, useProjects } from '../../hooks/useLibrary';
import { useHabits } from '../../hooks/useHabits';
import { useOfflineStatus } from '../../lib/offline';
import { useNotificationFeed } from '../../hooks/useNotifications';
import { spacing, usePalette } from '../../lib/theme';

interface Shortcut {
  title: string;
  subtitle: string;
  icon: IconName;
  href: string;
  badge?: string;
}

export default function MoreScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { user } = useAuth();
  const { dashboard } = useDashboard();
  const { planner } = usePlanner();
  const { projects, summary } = useProjects();
  const { notes } = useNotes();
  const { habits } = useHabits();
  const { groups } = useGroups();
  const { active, scheduled, history } = useGangSessions();
  const { unreadCount } = useNotificationFeed();
  const offline = useOfflineStatus();

  const productivity: Shortcut[] = [
    {
      title: 'Daily planner',
      subtitle: planner
        ? `${Math.round(planner.capacity.plannedMinutes)} / ${planner.capacity.capacityMinutes} min planned${
            planner.warnings.length > 0 ? ` · ${planner.warnings.length} warning${planner.warnings.length === 1 ? '' : 's'}` : ''
          }`
        : 'Shape today: must-do, nice-to-do, time blocks',
      icon: 'list',
      href: '/planner',
    },
    {
      title: 'Calendar',
      subtitle: 'Month, week and day views with drag-to-reschedule',
      icon: 'calendar',
      href: '/calendar',
    },
    {
      title: 'Habits',
      subtitle: habits.length > 0 ? `${habits.length} habits · streaks and consistency` : 'Build your first habit',
      icon: 'repeat',
      href: '/habits',
    },
    {
      title: 'Analytics',
      subtitle: 'Tasks, focus, habits, planning and heat maps',
      icon: 'stats-chart',
      href: '/analytics',
    },
    {
      title: 'Daily review',
      subtitle: 'Close the day, roll unfinished work forward, plan tomorrow',
      icon: 'journal',
      href: '/review',
      badge: dashboard?.activity.reviewed ? 'Done' : 'Due',
    },
  ];

  const library: Shortcut[] = [
    {
      title: 'Projects',
      subtitle:
        projects.length > 0
          ? `${summary?.active ?? projects.length} active · ${summary?.tasks ?? 0} tasks`
          : 'Create your first project',
      icon: 'folder-open',
      href: '/projects',
    },
    {
      title: 'Notes',
      subtitle: notes.length > 0 ? `${notes.length} notes` : 'Lightweight notes you can attach to tasks',
      icon: 'document-text',
      href: '/notes',
    },
    {
      title: 'Search',
      subtitle: 'Tasks, projects, habits and notes in one query',
      icon: 'search',
      href: '/search',
    },
  ];

  const social: Shortcut[] = [
    {
      title: 'Focus groups',
      subtitle: groups.length > 0 ? `${groups.length} group${groups.length === 1 ? '' : 's'}` : 'Create a focus group with your friends',
      icon: 'people',
      href: '/groups',
    },
    {
      title: 'Gang timer',
      subtitle: active.length > 0
        ? `${active.length} live session${active.length === 1 ? '' : 's'}`
        : scheduled.length > 0
          ? `${scheduled.length} scheduled`
          : 'Synchronised group focus sessions',
      icon: 'timer',
      href: '/groups',
      badge: active.length > 0 ? 'Live' : undefined,
    },
  ];

  const account: Shortcut[] = [
    {
      title: 'Notifications',
      subtitle: unreadCount > 0 ? `${unreadCount} unread` : 'Reminders, deadlines and group invites',
      icon: 'notifications',
      href: '/notifications',
    },
    {
      title: 'Account & settings',
      subtitle: 'Profile, customization, notifications, data and privacy',
      icon: 'settings',
      href: '/settings',
    },
  ];

  return (
    <Screen>
      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          More
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          {user?.email}
        </Type>
      </Stack>

      {offline.pending > 0 || !offline.online ? (
        <Card style={{ backgroundColor: offline.online ? palette.primaryMuted : `${palette.warning}18` }}>
          <Row gap={spacing.sm}>
            <Ionicons
              name={offline.online ? 'sync' : 'cloud-offline'}
              size={18}
              color={offline.online ? palette.primary : palette.warning}
            />
            <Stack gap={2} style={{ flex: 1 }}>
              <Type variant="bodyStrong">
                {offline.online ? 'Syncing changes' : 'You are offline'}
              </Type>
              <Type variant="caption" color={palette.textMuted}>
                {offline.pending} change{offline.pending === 1 ? '' : 's'} waiting
                {offline.online ? ' — sending now.' : ' to sync. Everything you do still works.'}
              </Type>
            </Stack>
            {offline.online ? null : (
              <Badge label="Cached" color={palette.warning} />
            )}
          </Row>
        </Card>
      ) : null}

      {[
        { title: 'Plan & review', items: productivity },
        { title: 'Library', items: library },
        { title: 'Focus together', items: social },
        { title: 'Account', items: account },
      ].map((group) => (
        <Stack key={group.title} gap={spacing.xs}>
          <SectionHeader title={group.title} />
          <Card>
            {group.items.map((item, index) => (
              <View key={item.title}>
                {index > 0 ? (
                  <View style={{ height: 1, backgroundColor: palette.border, marginLeft: 46 }} />
                ) : null}
                <ListRow
                  title={item.title}
                  subtitle={item.subtitle}
                  icon={item.icon}
                  onPress={() => router.push(item.href as never)}
                  trailing={item.badge ? <Badge label={item.badge} color={palette.primary} /> : undefined}
                />
              </View>
            ))}
          </Card>
        </Stack>
      ))}

      <Stack gap={spacing.xs}>
        <SectionHeader title="About" />
        <Card>
          <Stack gap={spacing.sm}>
            <Type variant="bodyStrong">JARVIS 1.0.0</Type>
            <Type variant="caption" color={palette.textMuted}>
              Capture, prioritise, plan, focus, complete, review, improve.
            </Type>
            <Row gap={spacing.sm} wrap>
              <Badge label="Offline capable" color={palette.success} icon="cloud-offline-outline" />
              <Badge label="Real-time groups" color={palette.info} icon="flash" />
              {history.length > 0 ? <Badge label={`${history.length} past sessions`} /> : null}
            </Row>
          </Stack>
        </Card>
      </Stack>
    </Screen>
  );
}
