/**
 * Calendar.
 *
 * Month, week and day views over real records: task due dates and their
 * scheduled time blocks, habit schedules, focus sessions and gang sessions.
 * Long-press a task in a day list to move it to another date — which writes the
 * new due date, the same field the task list and matrix read.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { TaskRow, formatClock, formatMinutes } from '../components/tasks';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Row,
  Screen,
  SectionHeader,
  Segmented,
  Sheet,
  Stack,
  Type,
} from '../components/ui';
import { useAuth } from '../lib/auth';
import { useCalendar, useReschedule } from '../hooks/useDashboard';
import { useTaskMutations } from '../hooks/useTasks';
import { radius, spacing, usePalette } from '../lib/theme';

type CalendarView = 'month' | 'week' | 'day';

function shiftDay(dayKey: string, days: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function startOfWeek(dayKey: string, weekStartsOn: number): string {
  const weekday = new Date(`${dayKey}T00:00:00Z`).getUTCDay();
  const diff = (weekday - weekStartsOn + 7) % 7;
  return shiftDay(dayKey, -diff);
}

export default function CalendarScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { settings } = useAuth();
  const weekStartsOn = settings?.weekStartsOn ?? 1;
  const [view, setView] = useState<CalendarView>(settings?.calendar.display ?? 'month');
  const [anchor, setAnchor] = useState<string>(new Date().toISOString().slice(0, 10));
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const reschedule = useReschedule();
  const { complete } = useTaskMutations();

  const { from, to } = useMemo(() => {
    if (view === 'day') return { from: anchor, to: anchor };
    if (view === 'week') {
      const start = startOfWeek(anchor, weekStartsOn);
      return { from: start, to: shiftDay(start, 6) };
    }
    const monthStart = `${anchor.slice(0, 7)}-01`;
    return { from: shiftDay(monthStart, -7), to: shiftDay(monthStart, 37) };
  }, [anchor, view, weekStartsOn]);

  const { calendar, isLoading, error, refetch } = useCalendar(from, to, view);
  const use24Hour = settings?.use24Hour ?? false;

  const dayGrid = useMemo(() => {
    if (!calendar) return [];
    if (view === 'month' && calendar.monthGrid.length > 0) return calendar.monthGrid;
    const days: string[] = [];
    for (let cursor = from; cursor <= to; cursor = shiftDay(cursor, 1)) days.push(cursor);
    return days;
  }, [calendar, from, to, view]);

  const selectedDay = view === 'day' ? anchor : null;

  const tasksByDay = useMemo(() => {
    const map = new Map<string, typeof tasks>();
    const tasks = calendar?.tasks ?? [];
    for (const task of tasks) {
      const key = task.dueDate ?? task.planDate;
      if (!key) continue;
      map.set(key, [...(map.get(key) ?? []), task]);
    }
    return map;
  }, [calendar?.tasks]);

  const focusByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const session of calendar?.focusSessions ?? []) {
      map.set(session.dayKey, (map.get(session.dayKey) ?? 0) + session.minutes);
    }
    return map;
  }, [calendar?.focusSessions]);

  const gangByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const session of calendar?.gangSessions ?? []) {
      const key = new Date(session.startsAt).toISOString().slice(0, 10);
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [calendar?.gangSessions]);

  const today = calendar?.today ?? new Date().toISOString().slice(0, 10);

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Button label="Plan the day" icon="list" size="sm" variant="secondary" onPress={() => router.push('/planner')} />
      </Row>

      <Row justify="space-between" align="center">
        <Stack gap={2}>
          <Type variant="title" accessibilityRole="header">
            Calendar
          </Type>
          <Type variant="caption" color={palette.textMuted}>
            {calendar?.monthLabel ?? ''} · {view} view
          </Type>
        </Stack>
        <Row gap={spacing.xs}>
          <Pressable
            onPress={() => setAnchor(view === 'month' ? shiftDay(anchor, -28) : view === 'week' ? shiftDay(anchor, -7) : shiftDay(anchor, -1))}
            accessibilityRole="button"
            accessibilityLabel="Previous period"
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="chevron-back" size={20} color={palette.text} />
          </Pressable>
          <Pressable
            onPress={() => setAnchor(new Date().toISOString().slice(0, 10))}
            accessibilityRole="button"
            accessibilityLabel="Jump to today"
            style={{ height: 40, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' }}
          >
            <Type variant="caption" color={palette.primary}>
              Today
            </Type>
          </Pressable>
          <Pressable
            onPress={() => setAnchor(view === 'month' ? shiftDay(anchor, 28) : view === 'week' ? shiftDay(anchor, 7) : shiftDay(anchor, 1))}
            accessibilityRole="button"
            accessibilityLabel="Next period"
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="chevron-forward" size={20} color={palette.text} />
          </Pressable>
        </Row>
      </Row>

      <Segmented
        options={[
          { value: 'month', label: 'Month' },
          { value: 'week', label: 'Week' },
          { value: 'day', label: 'Day' },
        ]}
        value={view}
        onChange={(value) => setView(value as CalendarView)}
      />

      {isLoading && !calendar ? <LoadingBlock label="Loading calendar" /> : null}

      {!isLoading && !calendar && error ? (
        <ErrorBlock message="The calendar could not be loaded." onRetry={() => void refetch()} />
      ) : null}

      {view === 'month' ? (
        <Card>
          <Stack gap={spacing.sm}>
            <Row justify="space-between">
              {Array.from({ length: 7 }).map((_, index) => {
                const weekday = new Date(Date.UTC(2024, 0, 7 + ((weekStartsOn + index) % 7))).toLocaleDateString(undefined, {
                  weekday: 'short',
                  timeZone: 'UTC',
                });
                return (
                  <View key={weekday} style={{ flex: 1, alignItems: 'center' }}>
                    <Type variant="micro" color={palette.textFaint}>
                      {weekday.slice(0, 2).toUpperCase()}
                    </Type>
                  </View>
                );
              })}
            </Row>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {dayGrid.map((dayKey) => {
                const tasks = tasksByDay.get(dayKey) ?? [];
                const open = tasks.filter((task) => task.status !== 'done').length;
                const inMonth = dayKey.slice(0, 7) === anchor.slice(0, 7);
                const isToday = dayKey === today;
                return (
                  <Pressable
                    key={dayKey}
                    onPress={() => {
                      setAnchor(dayKey);
                      setView('day');
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${dayKey}, ${open} open tasks`}
                    style={{
                      width: `${100 / 7}%`,
                      aspectRatio: 0.86,
                      padding: 3,
                    }}
                  >
                    <View
                      style={{
                        flex: 1,
                        borderRadius: radius.sm,
                        padding: 4,
                        gap: 3,
                        backgroundColor: isToday ? palette.primaryMuted : 'transparent',
                        borderWidth: isToday ? 1 : 0,
                        borderColor: palette.primary,
                        opacity: inMonth ? 1 : 0.4,
                      }}
                    >
                      <Type variant="micro" color={isToday ? palette.primary : palette.text}>
                        {Number(dayKey.slice(-2))}
                      </Type>
                      {open > 0 ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
                          {tasks.slice(0, 3).map((task) => (
                            <View
                              key={task.id}
                              style={{
                                width: 5,
                                height: 5,
                                borderRadius: 3,
                                backgroundColor: task.urgent ? palette.danger : task.important ? palette.primary : palette.borderStrong,
                              }}
                            />
                          ))}
                          {open > 3 ? (
                            <Type variant="micro" color={palette.textMuted}>
                              +{open - 3}
                            </Type>
                          ) : null}
                        </View>
                      ) : null}
                      {(focusByDay.get(dayKey) ?? 0) > 0 ? (
                        <Type variant="micro" color={palette.success}>
                          {focusByDay.get(dayKey)}m
                        </Type>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <Row gap={spacing.sm} wrap>
              <Badge label="urgent" color={palette.danger} />
              <Badge label="important" color={palette.primary} />
              <Badge label="focus minutes" color={palette.success} />
            </Row>
          </Stack>
        </Card>
      ) : null}

      {view !== 'month' ? (
        <Stack gap={spacing.sm}>
          {dayGrid.map((dayKey) => {
            const tasks = tasksByDay.get(dayKey) ?? [];
            const focusMinutes = focusByDay.get(dayKey) ?? 0;
            const gangCount = gangByDay.get(dayKey) ?? 0;
            return (
              <Card key={dayKey}>
                <Stack gap={spacing.sm}>
                  <Row justify="space-between" align="center">
                    <Stack gap={2}>
                      <Type variant="bodyStrong">
                        {new Date(`${dayKey}T00:00:00Z`).toLocaleDateString(undefined, {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'short',
                          timeZone: 'UTC',
                        })}
                      </Type>
                      <Type variant="caption" color={palette.textMuted}>
                        {tasks.length} task{tasks.length === 1 ? '' : 's'}
                        {focusMinutes > 0 ? ` · ${formatMinutes(focusMinutes)} focused` : ''}
                        {gangCount > 0 ? ` · ${gangCount} group session${gangCount === 1 ? '' : 's'}` : ''}
                      </Type>
                    </Stack>
                    {dayKey === today ? <Badge label="Today" color={palette.primary} /> : null}
                  </Row>

                  {tasks.length === 0 ? (
                    <Type variant="caption" color={palette.textFaint}>
                      Nothing scheduled. Long-press a task anywhere in the app to reschedule it here.
                    </Type>
                  ) : (
                    tasks
                      .slice()
                      .sort((a, b) => (a.scheduledStart ?? 0) - (b.scheduledStart ?? 0))
                      .map((task) => (
                        <View key={task.id}>
                          <TaskRow
                            task={task}
                            today={today}
                            onToggle={() => {
                              void complete(task, task.status !== 'done').then(() => refetch());
                            }}
                            onPress={() => router.push(`/task/${task.id}`)}
                            onLongPress={() => setSelectedTask(task.id)}
                            trailing={
                              task.scheduledStart ? (
                                <Stack gap={2} style={{ alignItems: 'flex-end' }}>
                                  <Type variant="micro" color={palette.primary}>
                                    {new Date(task.scheduledStart).toLocaleTimeString(undefined, {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      hour12: !use24Hour,
                                    })}
                                  </Type>
                                  {task.scheduledEnd ? (
                                    <Type variant="micro" color={palette.textFaint}>
                                      {formatMinutes((task.scheduledEnd - task.scheduledStart) / 60_000)}
                                    </Type>
                                  ) : null}
                                </Stack>
                              ) : undefined
                            }
                          />
                        </View>
                      ))
                  )}

                  {calendar?.habitDays.length ? (
                    <Row gap={spacing.sm} wrap>
                      {calendar.habitDays
                        .filter((habit) => habit.days.includes(dayKey))
                        .map((habit) => (
                          <Badge key={habit.habitId} label={habit.name} color={habit.color} icon="repeat" />
                        ))}
                    </Row>
                  ) : null}

                  <Row gap={spacing.sm}>
                    <Button label="Add task here" size="sm" variant="secondary" icon="add" onPress={() => router.push('/task-new')} />
                    <Button label="Plan day" size="sm" variant="ghost" onPress={() => router.push(`/planner?day=${dayKey}`)} />
                  </Row>
                </Stack>
              </Card>
            );
          })}
        </Stack>
      ) : null}

      {calendar && calendar.undated.length > 0 && view !== 'month' ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Unscheduled" subtitle="Tasks with no date yet" />
          <Card style={{ paddingVertical: spacing.sm }}>
            {calendar.undated.slice(0, 6).map((task) => (
              <TaskRow key={task.id} task={task} today={today} dense onPress={() => router.push(`/task/${task.id}`)} />
            ))}
          </Card>
        </Stack>
      ) : null}

      {calendar && calendar.tasks.length === 0 && !isLoading && view !== 'month' ? (
        <EmptyState
          icon="calendar-outline"
          title="Nothing on the calendar"
          body="Give a task a due date and it appears here — or schedule time blocks in the daily planner."
          actionLabel="Open the planner"
          onAction={() => router.push('/planner')}
        />
      ) : null}

      <Sheet
        visible={Boolean(selectedTask)}
        onClose={() => setSelectedTask(null)}
        title="Move this task"
      >
        <Stack gap={spacing.sm}>
          <Type variant="caption" color={palette.textMuted}>
            Moving a task changes its due date — the same field every other screen reads.
          </Type>
          {[-3, -1, 0, 1, 2, 7].map((offset) => {
            const target = shiftDay(today, offset);
            return (
              <Button
                key={offset}
                label={
                  offset === 0
                    ? `Today (${target})`
                    : offset === 1
                      ? `Tomorrow (${target})`
                      : `${new Date(`${target}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })}`
                }
                variant="secondary"
                onPress={async () => {
                  if (!selectedTask) return;
                  try {
                    await reschedule(selectedTask, target);
                    void refetch();
                  } catch {
                    Alert.alert('Could not move it', 'You appear to be offline. It will move when you reconnect.');
                  }
                  setSelectedTask(null);
                }}
              />
            );
          })}
        </Stack>
      </Sheet>
    </Screen>
  );
}
