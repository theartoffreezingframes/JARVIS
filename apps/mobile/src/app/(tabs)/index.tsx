/**
 * Home.
 *
 * The daily loop in one glance — what is planned, what is left, what needs
 * attention, how focus and habits are going — plus the two shortcuts that
 * matter most in the moment: capture a task and start focusing.
 *
 * Every widget is independently hideable and reorderable from settings; the
 * screen stays quiet by showing a short list with a link to the full view.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import type { DashboardWidgetId, Habit, Task } from '@jarvis/shared';
import { HeatmapGrid, ScoreCard } from '../../components/analytics';
import { QuadrantPill, TaskRow, formatMinutes } from '../../components/tasks';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  ProgressBar,
  Row,
  Screen,
  SectionHeader,
  Stack,
  Type,
} from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useDashboard, useHeatmap } from '../../hooks/useDashboard';
import { useProjects } from '../../hooks/useLibrary';
import { useGangSessions } from '../../hooks/useSocial';
import { useHabitMutations } from '../../hooks/useHabits';
import { useTaskMutations } from '../../hooks/useTasks';
import { useNotificationFeed } from '../../hooks/useNotifications';
import { useOfflineStatus } from '../../lib/offline';
import { radius, spacing, usePalette } from '../../lib/theme';

const DEFAULT_ORDER: DashboardWidgetId[] = [
  'greeting',
  'progress',
  'quick_add',
  'focus_cta',
  'today_tasks',
  'overdue',
  'important',
  'deadlines',
  'habits',
  'focus_stats',
  'matrix_shortcut',
  'gang_shortcut',
  'summary',
];

function greetingFor(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 22) return 'Good evening';
  return 'Winding down';
}

function formatDate(dayKey: string): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`)).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default function HomeScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { user, settings } = useAuth();
  const { dashboard, today, isLoading, error, refetch, isFetching } = useDashboard();
  const { complete: toggleTask } = useTaskMutations();
  const habitMutations = useHabitMutations();
  const { unreadCount } = useNotificationFeed();
  const offline = useOfflineStatus();
  const gang = useGangSessions();
  const { projects } = useProjects();

  const order = useMemo<DashboardWidgetId[]>(() => {
    const configured = settings?.dashboardWidgets ?? [];
    const known = configured.map((widget) => widget.id).filter((id) => DEFAULT_ORDER.includes(id));
    const missing = DEFAULT_ORDER.filter((id) => !known.includes(id));
    return [...known, ...missing];
  }, [settings?.dashboardWidgets]);

  const hidden = useMemo(
    () => new Set((settings?.dashboardWidgets ?? []).filter((widget) => !widget.visible).map((widget) => widget.id)),
    [settings?.dashboardWidgets],
  );

  const openTask = useCallback((task: Task) => router.push(`/task/${task.id}`), [router]);

  if (isLoading && !dashboard) {
    return (
      <Screen>
        <LoadingBlock label="Loading your day" />
      </Screen>
    );
  }

  if (error && !dashboard) {
    return (
      <Screen>
        <ErrorBlock message="We could not reach your dashboard." onRetry={refetch} />
      </Screen>
    );
  }

  const progress = dashboard?.progress;
  const focus = dashboard?.focus;

  const widgets: Record<DashboardWidgetId, () => React.ReactNode> = {
    greeting: () => (
      <Stack gap={2}>
        <Type variant="caption" color={palette.textMuted}>
          {today ? formatDate(today) : ''}
        </Type>
        <Type variant="display" accessibilityRole="header">
          {greetingFor(dashboard?.greetingHour ?? new Date().getHours())}
          {user?.name ? `, ${user.name.split(' ')[0]}` : ''}
        </Type>
        {progress ? (
          <Type variant="body" color={palette.textMuted}>
            {progress.completed} of {progress.planned || progress.completed} planned tasks done
            {progress.remaining > 0 ? ` · ${progress.remaining} left` : ' · clear plate'}
          </Type>
        ) : null}
      </Stack>
    ),

    progress: () =>
      progress ? (
        <Card>
          <Stack gap={spacing.md}>
            <Row justify="space-between" align="flex-end">
              <Stack gap={2}>
                <Type variant="label" color={palette.textMuted}>
                  TODAY&apos;S PROGRESS
                </Type>
                <Type variant="title">{progress.percent}%</Type>
              </Stack>
              <Row gap={spacing.sm}>
                {progress.overdue > 0 ? <Badge label={`${progress.overdue} overdue`} color={palette.danger} icon="alert" /> : null}
                {progress.important > 0 ? (
                  <Badge label={`${progress.important} important`} color={palette.primary} icon="star" />
                ) : null}
              </Row>
            </Row>
            <ProgressBar value={progress.percent} />
            <Row gap={spacing.lg}>
              <Stack gap={2} style={{ flex: 1 }}>
                <Type variant="micro" color={palette.textMuted}>
                  COMPLETED
                </Type>
                <Type variant="bodyStrong">{progress.completed}</Type>
              </Stack>
              <Stack gap={2} style={{ flex: 1 }}>
                <Type variant="micro" color={palette.textMuted}>
                  REMAINING
                </Type>
                <Type variant="bodyStrong">{progress.remaining}</Type>
              </Stack>
              <Stack gap={2} style={{ flex: 1 }}>
                <Type variant="micro" color={palette.textMuted}>
                  UPCOMING
                </Type>
                <Type variant="bodyStrong">{progress.upcoming}</Type>
              </Stack>
            </Row>
          </Stack>
        </Card>
      ) : null,

    quick_add: () => (
      <Pressable
        onPress={() => router.push('/task-new')}
        accessibilityRole="button"
        accessibilityLabel="Add a task"
        accessibilityHint="Type a task in your own words, we will work out the details"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          minHeight: 52,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.lg,
          backgroundColor: palette.surface,
          borderWidth: 1,
          borderColor: palette.border,
          borderStyle: 'dashed',
        }}
      >
        <Ionicons name="add-circle" size={22} color={palette.primary} />
        <Type variant="body" color={palette.textMuted} style={{ flex: 1 }}>
          Add a task…  &quot;DSA assignment tomorrow 7 PM&quot;
        </Type>
      </Pressable>
    ),

    focus_cta: () =>
      focus ? (
        <Card
          onPress={() => router.push('/(tabs)/focus')}
          accessibilityLabel="Open focus timer"
          style={{ backgroundColor: palette.primaryMuted, borderColor: palette.primary }}
        >
          <Row justify="space-between" align="center">
            <Stack gap={3} style={{ flex: 1 }}>
              <Type variant="label" color={palette.primary}>
                {focus.todayMinutes > 0 ? 'KEEP THE STREAK' : 'START FOCUSING'}
              </Type>
              <Type variant="headline">
                {focus.todayMinutes > 0
                  ? `${formatMinutes(focus.todayMinutes)} focused today`
                  : 'Begin a pomodoro'}
              </Type>
              <Type variant="caption" color={palette.textMuted}>
                {focus.sessionsToday} session{focus.sessionsToday === 1 ? '' : 's'} today · target{' '}
                {formatMinutes(dashboard?.focusTodayTarget ?? 120)}
              </Type>
            </Stack>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: radius.pill,
                backgroundColor: palette.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="play" size={22} color={palette.onPrimary} />
            </View>
          </Row>
        </Card>
      ) : null,

    today_tasks: () => {
      const tasks = (dashboard?.tasks ?? []).filter((task) => task.status !== 'done').slice(0, 5);
      const done = (dashboard?.tasks ?? []).filter((task) => task.status === 'done').slice(0, 2);
      const list = [...tasks, ...done];
      return (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Today" action="All tasks" onAction={() => router.push('/(tabs)/tasks')} />
          {list.length === 0 ? (
            <EmptyState
              icon="leaf-outline"
              title="Nothing planned for today"
              body="Add a task or run the daily planner to shape the day."
              actionLabel="Plan my day"
              onAction={() => router.push('/planner')}
            />
          ) : (
            <Card style={{ paddingVertical: spacing.sm }}>
              {list.map((task, index) => (
                <View key={task.id}>
                  {index > 0 ? <View style={{ height: 1, backgroundColor: palette.border, marginLeft: 40 }} /> : null}
                  <TaskRow task={task} today={today} onToggle={() => toggleTask(task, task.status !== 'done')} onPress={() => openTask(task)} />
                </View>
              ))}
            </Card>
          )}
        </Stack>
      );
    },

    overdue: () => {
      const tasks = (dashboard?.tasks ?? []).filter(
        (task) => task.status !== 'done' && task.dueDate !== null && task.dueDate < today,
      );
      if (tasks.length === 0) return null;
      return (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Overdue" subtitle={`${tasks.length} need a decision`} />
          <Card style={{ paddingVertical: spacing.sm, borderColor: `${palette.danger}55` }}>
            {tasks.slice(0, 3).map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                today={today}
                dense
                onToggle={() => toggleTask(task, task.status !== 'done')}
                onPress={() => openTask(task)}
              />
            ))}
            {tasks.length > 3 ? (
              <Type variant="caption" color={palette.textMuted} style={{ paddingTop: spacing.xs }}>
                and {tasks.length - 3} more — reschedule them from the planner.
              </Type>
            ) : null}
          </Card>
        </Stack>
      );
    },

    important: () => {
      const tasks = (dashboard?.tasks ?? []).filter((task) => task.important && task.status !== 'done').slice(0, 3);
      if (tasks.length === 0) return null;
      return (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Important" subtitle="Protect time for these" />
          <Card style={{ paddingVertical: spacing.sm }}>
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} today={today} dense onPress={() => openTask(task)} />
            ))}
          </Card>
        </Stack>
      );
    },

    deadlines: () => {
      const items = dashboard?.upcomingDeadlines ?? [];
      if (items.length === 0) return null;
      return (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Upcoming deadlines" action="Calendar" onAction={() => router.push('/calendar')} />
          <Card style={{ paddingVertical: spacing.sm }}>
            {items.slice(0, 4).map((task) => (
              <TaskRow key={task.id} task={task} today={today} dense onPress={() => openTask(task)} showProject />
            ))}
          </Card>
        </Stack>
      );
    },

    habits: () => {
      const habits = dashboard?.habits ?? [];
      const summary = dashboard?.habitSummary;
      if (habits.length === 0) return null;
      return (
        <Stack gap={spacing.sm}>
          <SectionHeader
            title="Habits"
            subtitle={
              summary
                ? `${summary.completedToday}/${summary.scheduledToday} today · best streak ${summary.bestStreak} days`
                : undefined
            }
            action="All habits"
            onAction={() => router.push('/habits')}
          />
          <Card style={{ paddingVertical: spacing.xs }}>
            {habits.slice(0, 4).map((habit: Habit, index: number) => (
              <View key={habit.id}>
                {index > 0 ? <View style={{ height: 1, backgroundColor: palette.border }} /> : null}
                <Row gap={spacing.md} style={{ paddingVertical: spacing.sm }}>
                  <View
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: radius.sm,
                      backgroundColor: `${habit.color}20`,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="repeat" size={15} color={habit.color} />
                  </View>
                  <Stack gap={2} style={{ flex: 1 }}>
                    <Type variant="bodyStrong" numberOfLines={1}>
                      {habit.name}
                    </Type>
                    <Type variant="caption" color={palette.textMuted}>
                      {habit.currentStreak > 0 ? `${habit.currentStreak}-day streak` : 'No streak yet'} ·{' '}
                      {habit.completionRate}% completion
                    </Type>
                  </Stack>
                  <Pressable
                    onPress={() => habitMutations.toggle(habit, today, !habit.completedToday)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: habit.completedToday }}
                    accessibilityLabel={`${habit.completedToday ? 'Undo' : 'Complete'} habit ${habit.name}`}
                    style={{
                      width: 36,
                      height: 36,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons
                      name={habit.completedToday ? 'checkmark-circle' : 'ellipse-outline'}
                      size={26}
                      color={habit.completedToday ? palette.success : palette.borderStrong}
                    />
                  </Pressable>
                </Row>
              </View>
            ))}
          </Card>
        </Stack>
      );
    },

    focus_stats: () =>
      focus ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Focus" action="Details" onAction={() => router.push('/analytics')} />
          <Card>
            <Row gap={spacing.lg}>
              <Stack gap={2} style={{ flex: 1 }}>
                <Type variant="micro" color={palette.textMuted}>
                  TODAY
                </Type>
                <Type variant="title">{formatMinutes(focus.todayMinutes)}</Type>
                <Type variant="caption" color={palette.textMuted}>
                  {focus.sessionsToday} sessions
                </Type>
              </Stack>
              <Stack gap={2} style={{ flex: 1 }}>
                <Type variant="micro" color={palette.textMuted}>
                  THIS WEEK
                </Type>
                <Type variant="title">{formatMinutes(focus.weekMinutes)}</Type>
                <Type variant="caption" color={palette.textMuted}>
                  {focus.sessionsWeek} sessions
                </Type>
              </Stack>
              <Stack gap={2} style={{ flex: 1 }}>
                <Type variant="micro" color={palette.textMuted}>
                  STREAK
                </Type>
                <Type variant="title">{dashboard?.sessionStreak ?? 0}d</Type>
                <Type variant="caption" color={palette.textMuted}>
                  best day {formatMinutes(focus.bestDayMinutes)}
                </Type>
              </Stack>
            </Row>
            <View style={{ marginTop: spacing.md }}>
              <ProgressBar
                value={((focus.todayMinutes ?? 0) / Math.max(1, dashboard?.focusTodayTarget ?? 120)) * 100}
                color={palette.primary}
              />
            </View>
          </Card>
        </Stack>
      ) : null,

    matrix_shortcut: () => {
      const counts = dashboard?.matrix.counts;
      if (!counts) return null;
      const suggestions = dashboard?.matrix.suggestions ?? [];
      return (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Eisenhower matrix" action="Open" onAction={() => router.push('/(tabs)/matrix')} />
          <Card>
            <Row gap={spacing.sm} wrap>
              <QuadrantPill quadrant="do_now" count={counts.do_now} onPress={() => router.push('/(tabs)/matrix')} />
              <QuadrantPill quadrant="schedule" count={counts.schedule} onPress={() => router.push('/(tabs)/matrix')} />
              <QuadrantPill quadrant="delegate" count={counts.delegate} onPress={() => router.push('/(tabs)/matrix')} />
              <QuadrantPill quadrant="eliminate" count={counts.eliminate} onPress={() => router.push('/(tabs)/matrix')} />
            </Row>
            {suggestions.slice(0, 1).map((suggestion) => (
              <Row key={suggestion.id} gap={spacing.sm} style={{ marginTop: spacing.md }}>
                <Ionicons name="bulb-outline" size={16} color={palette.warning} />
                <Type variant="caption" style={{ flex: 1 }}>
                  {suggestion.body}
                </Type>
              </Row>
            ))}
          </Card>
        </Stack>
      );
    },

    gang_shortcut: () => {
      const active = dashboard?.activeGangSession;
      const next = dashboard?.nextGangSession;
      if (!active && !next) return null;
      const session = active ?? next;
      if (!session) return null;
      const startsIn = session.startsAt > Date.now() ? Math.round((session.startsAt - Date.now()) / 60_000) : 0;
      return (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Gang timer" action="Open" onAction={() => router.push('/groups')} />
          <Card onPress={() => router.push(`/gang/${session.id}`)} accessibilityLabel="Open gang session">
            <Row gap={spacing.md}>
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: radius.md,
                  backgroundColor: active ? palette.success : palette.surfaceMuted,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="people" size={20} color={active ? palette.onPrimary : palette.textMuted} />
              </View>
              <Stack gap={3} style={{ flex: 1 }}>
                <Type variant="bodyStrong" numberOfLines={1}>
                  {session.title}
                </Type>
                <Type variant="caption" color={palette.textMuted}>
                  {active
                    ? `Live · ${session.participants.length} focusing`
                    : startsIn <= 0
                      ? 'Starting now'
                      : `Starts in ${startsIn} min`}
                  {' · '}
                  {session.focusMinutes}m focus
                </Type>
              </Stack>
              <Ionicons name="chevron-forward" size={18} color={palette.textFaint} />
            </Row>
          </Card>
        </Stack>
      );
    },

    streaks: () => {
      const habitSummary = dashboard?.habitSummary;
      const focus = dashboard?.focus;
      if (!habitSummary || !focus) return null;
      return (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Streaks" subtitle="Consistency over intensity" />
          <Card>
            <Row gap={spacing.lg}>
              <Stack gap={2} style={{ flex: 1 }}>
                <Type variant="micro" color={palette.textMuted}>
                  FOCUS STREAK
                </Type>
                <Type variant="title">{dashboard?.sessionStreak ?? 0}d</Type>
                <Type variant="caption" color={palette.textMuted}>
                  days with a session
                </Type>
              </Stack>
              <Stack gap={2} style={{ flex: 1 }}>
                <Type variant="micro" color={palette.textMuted}>
                  BEST HABIT STREAK
                </Type>
                <Type variant="title">{habitSummary.bestStreak}d</Type>
                <Type variant="caption" color={palette.textMuted}>
                  longest current run
                </Type>
              </Stack>
              <Stack gap={2} style={{ flex: 1 }}>
                <Type variant="micro" color={palette.textMuted}>
                  HABIT RATE
                </Type>
                <Type variant="title">{habitSummary.completionRate}%</Type>
                <Type variant="caption" color={palette.textMuted}>
                  last 30 days
                </Type>
              </Stack>
            </Row>
          </Card>
        </Stack>
      );
    },

    heatmap: () => <HeatmapWidget palette={palette} onOpen={() => router.push('/analytics')} />,

    gang_sessions: () => {
      const { active, scheduled } = gang;
      const sessions = [...active, ...scheduled];
      if (sessions.length === 0) return null;
      return (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Group sessions" action="Groups" onAction={() => router.push('/groups')} />
          <Card>
            <Stack gap={spacing.sm}>
              {sessions.slice(0, 3).map((session) => (
                <Row key={session.id} gap={spacing.md}>
                  <Ionicons
                    name={session.status === 'running' || session.status === 'paused' ? 'radio-button-on' : 'time-outline'}
                    size={16}
                    color={session.status === 'running' || session.status === 'paused' ? palette.success : palette.textMuted}
                  />
                  <Stack gap={2} style={{ flex: 1 }}>
                    <Type variant="bodyStrong" numberOfLines={1}>
                      {session.title}
                    </Type>
                    <Type variant="caption" color={palette.textMuted}>
                      {session.groupName} · {session.participants.length} joined ·{' '}
                      {new Date(session.startsAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </Type>
                  </Stack>
                  <Button
                    label={session.status === 'running' || session.status === 'paused' ? 'Join' : 'View'}
                    size="sm"
                    onPress={() => router.push(`/gang/${session.id}`)}
                  />
                </Row>
              ))}
            </Stack>
          </Card>
        </Stack>
      );
    },

    projects: () => {
      const list = projects.filter((project) => project.status === 'active').slice(0, 3);
      if (list.length === 0) return null;
      return (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Projects" action="All" onAction={() => router.push('/projects')} />
          <Card style={{ gap: spacing.md }}>
            {list.map((project) => (
              <Pressable
                key={project.id}
                onPress={() => router.push(`/project/${project.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Open project ${project.name}`}
              >
                <Stack gap={6}>
                  <Row justify="space-between">
                    <Type variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                      {project.name}
                    </Type>
                    <Type variant="caption" color={palette.textMuted}>
                      {project.progress}%
                    </Type>
                  </Row>
                  <ProgressBar value={project.progress} color={project.color} />
                  <Type variant="micro" color={palette.textFaint}>
                    {project.completedTaskCount}/{project.taskCount} TASKS
                    {project.dueDate ? ` · DUE ${project.dueDate}` : ''}
                  </Type>
                </Stack>
              </Pressable>
            ))}
          </Card>
        </Stack>
      );
    },

    summary: () => {
      const score = dashboard?.score;
      if (!score) return null;
      return (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Daily summary" action="Review" onAction={() => router.push('/review')} />
          <ScoreCard score={score} />
          {dashboard?.activity ? (
            <Row gap={spacing.md} wrap>
              <Badge label={`${dashboard.activity.tasksCompleted} completed`} color={palette.success} icon="checkmark" />
              <Badge label={`${dashboard.activity.focusMinutes}m focus`} color={palette.primary} icon="timer" />
              <Badge
                label={`${dashboard.activity.habitsCompleted} habits`}
                color={palette.quadrant.schedule}
                icon="repeat"
              />
              {dashboard.activity.reviewed ? <Badge label="Reviewed" color={palette.info} icon="journal" /> : null}
            </Row>
          ) : null}
        </Stack>
      );
    },
  };

  const visible = order.filter((id) => !hidden.has(id));

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={palette.primary} />
      }
    >
      <Row justify="space-between" align="center">
        <Row gap={spacing.sm}>
          <Pressable
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            accessibilityLabel="Account and settings"
          >
            <Avatar name={user?.name ?? 'You'} url={user?.avatarUrl} size={40} />
          </Pressable>
          {offline.pending > 0 ? (
            <Badge
              label={offline.online ? `Syncing ${offline.pending}` : `${offline.pending} offline`}
              color={offline.online ? palette.info : palette.warning}
              icon={offline.online ? 'sync' : 'cloud-offline'}
            />
          ) : null}
        </Row>
        <Row gap={spacing.xs}>
          <Pressable
            onPress={() => router.push('/search')}
            accessibilityRole="button"
            accessibilityLabel="Search"
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="search" size={21} color={palette.text} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/notifications')}
            accessibilityRole="button"
            accessibilityLabel={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="notifications-outline" size={21} color={palette.text} />
            {unreadCount > 0 ? (
              <View
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  minWidth: 16,
                  height: 16,
                  borderRadius: 8,
                  backgroundColor: palette.danger,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 3,
                }}
              >
                <Type variant="micro" color={palette.onPrimary}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </Type>
              </View>
            ) : null}
          </Pressable>
        </Row>
      </Row>

      {visible.map((id) => {
        const render = widgets[id];
        const node = render ? render() : null;
        if (!node) return null;
        return <View key={id}>{node}</View>;
      })}

      <Stack gap={spacing.sm}>
        <SectionHeader title="Plan" action="Customise" onAction={() => router.push('/settings/widgets')} />
        <Row gap={spacing.sm}>
          <Button label="Daily planner" icon="list" variant="secondary" size="sm" onPress={() => router.push('/planner')} />
          <Button label="Review day" icon="journal" variant="secondary" size="sm" onPress={() => router.push('/review')} />
        </Row>
      </Stack>
    </Screen>
  );
}

/**
 * The dashboard heat map uses the same analytics data as the Analytics screen —
 * active days are drawn from real completions, focus sessions and habit records.
 */
function HeatmapWidget({ palette, onOpen }: { palette: ReturnType<typeof usePalette>; onOpen: () => void }) {
  const { heatmap } = useHeatmap('productivity', 'month');
  if (!heatmap) return null;
  return (
    <Stack gap={spacing.sm}>
      <SectionHeader title="Activity" subtitle="Last 30 days" action="Analytics" onAction={onOpen} />
      <Card onPress={onOpen} accessibilityLabel="Open analytics">
        <Stack gap={spacing.sm}>
          <HeatmapGrid cells={heatmap.cells} compact />
          <Row gap={spacing.sm} wrap>
            <Badge label={`${heatmap.totals.tasksCompleted} tasks done`} color={palette.success} icon="checkmark" />
            <Badge label={`${heatmap.totals.focusMinutes} focus min`} color={palette.primary} icon="timer" />
            <Badge label={`${heatmap.totals.activeDays} active days`} />
          </Row>
        </Stack>
      </Card>
    </Stack>
  );
}
