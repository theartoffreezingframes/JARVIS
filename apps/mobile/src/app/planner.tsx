/**
 * Daily planner.
 *
 * The server builds the capacity picture (your day window, minus the work you
 * already planned) and warns when the plan no longer fits. Here you decide what
 * is a must-do, reorder the day, and place time blocks — all of which write to
 * the same task records the rest of the app reads.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { Task } from '@jarvis/shared';
import { TaskRow, formatMinutes, priorityColor } from '../components/tasks';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  ProgressBar,
  Row,
  Screen,
  SectionHeader,
  Stack,
  Type,
} from '../components/ui';
import { useAuth } from '../lib/auth';
import { usePlanner } from '../hooks/useDashboard';
import { useTaskMutations } from '../hooks/useTasks';
import { radius, spacing, usePalette } from '../lib/theme';

function addDays(dayKey: string, days: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function minutesOf(time: string | null | undefined, fallback: number): number {
  if (!time) return fallback;
  const [hour, minute] = time.split(':').map(Number);
  if (Number.isNaN(hour)) return fallback;
  return hour * 60 + (minute ?? 0);
}

export default function PlannerScreen() {
  const palette = usePalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ day?: string }>();
  const { settings } = useAuth();
  const [day, setDay] = useState<string | null>(params.day ?? null);
  const { planner, save, scheduleBlocks, unschedule, isLoading, error, refetch } = usePlanner(day ?? undefined);
  const { complete, update } = useTaskMutations();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const target = planner?.day ?? day ?? new Date().toISOString().slice(0, 10);
  const use24Hour = settings?.use24Hour ?? false;

  const planned = planner?.plannedTasks ?? [];
  const mustDo = planned.filter((task) => task.isMustDo);
  const niceToDo = planned.filter((task) => !task.isMustDo);

  const capacity = planner?.capacity;
  const over = (capacity?.overCapacityBy ?? 0) > 0;

  const blocks = useMemo(() => planner?.plan.blocks ?? [], [planner?.plan.blocks]);

  const move = async (list: Task[], index: number, direction: -1 | 1) => {
    const next = list.slice();
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= next.length) return;
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    const updates = next.map((task, position) => ({ id: task.id, planOrder: position, planDate: target }));
    setBusy(true);
    try {
      await save(updates);
    } finally {
      setBusy(false);
      void refetch();
    }
  };

  const quickSchedule = async () => {
    if (!planner) return;
    const windowStart = minutesOf(planner.settings.dayStartTime, 420) + 60;
    let cursor = windowStart;
    const entries: Array<{ taskId: string; startMinutes: number; durationMinutes: number }> = [];
    for (const task of [...mustDo, ...niceToDo]) {
      const minutes = task.estimatedMinutes ?? settings?.defaultTaskDurationMinutes ?? 30;
      if (cursor + minutes > minutesOf(planner.settings.dayEndTime, 1320)) break;
      entries.push({ taskId: task.id, startMinutes: cursor, durationMinutes: minutes });
      cursor += minutes;
    }
    setBusy(true);
    try {
      await scheduleBlocks(target, entries);
      setMessage(`Scheduled ${entries.length} block${entries.length === 1 ? '' : 's'} from ${planner.settings.dayStartTime}.`);
      void refetch();
    } catch {
      setMessage('Could not schedule the blocks — check your connection.');
    } finally {
      setBusy(false);
    }
  };

  if (isLoading && !planner) {
    return (
      <Screen edges={['top']}>
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <LoadingBlock label="Building the day" />
      </Screen>
    );
  }

  if (error && !planner) {
    return (
      <Screen edges={['top']}>
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <ErrorBlock message="Your plan could not be loaded." onRetry={() => void refetch()} />
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Row gap={spacing.sm}>
          <Chip label="Yesterday" small onPress={() => setDay(addDays(target, -1))} />
          <Chip label="Today" small selected={target === (planner?.today ?? target)} onPress={() => setDay(null)} />
          <Chip label="Tomorrow" small onPress={() => setDay(addDays(target, 1))} />
        </Row>
      </Row>

      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          Daily planner
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          {new Date(`${target}T00:00:00Z`).toLocaleDateString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            timeZone: 'UTC',
          })}
          {planner ? ` · ${planner.settings.dayStartTime}–${planner.settings.dayEndTime}` : ''}
        </Type>
      </Stack>

      {message ? (
        <Card style={{ backgroundColor: palette.surfaceMuted }}>
          <Type variant="caption">{message}</Type>
        </Card>
      ) : null}

      {capacity ? (
        <Card style={{ borderColor: over ? `${palette.danger}66` : palette.border }}>
          <Stack gap={spacing.md}>
            <Row justify="space-between" align="flex-end">
              <Stack gap={2}>
                <Type variant="label" color={palette.textMuted}>
                  PLANNED
                </Type>
                <Type variant="title">
                  {formatMinutes(capacity.plannedMinutes)}
                  <Type variant="caption" color={palette.textMuted}>
                    {' '}
                    of {formatMinutes(capacity.capacityMinutes)}
                  </Type>
                </Type>
              </Stack>
              <Badge
                label={over ? `Over by ${formatMinutes(capacity.overCapacityBy)}` : `${formatMinutes(capacity.remainingMinutes)} left`}
                color={over ? palette.danger : palette.success}
                icon={over ? 'alert' : 'checkmark'}
              />
            </Row>
            <ProgressBar value={Math.min(100, capacity.utilization * 100)} color={over ? palette.danger : palette.primary} />
            {planner?.warnings.map((warning) => (
              <Stack key={warning.id} gap={2}>
                <Row gap={spacing.sm}>
                  <Ionicons
                    name={warning.severity === 'critical' ? 'alert-circle' : warning.severity === 'warning' ? 'warning-outline' : 'information-circle-outline'}
                    size={15}
                    color={warning.severity === 'critical' ? palette.danger : warning.severity === 'warning' ? palette.warning : palette.info}
                  />
                  <Type variant="caption" color={palette.text} style={{ flex: 1 }}>
                    {warning.title}
                  </Type>
                </Row>
                <Type variant="micro" color={palette.textMuted}>
                  {warning.body}
                </Type>
              </Stack>
            ))}
          </Stack>
        </Card>
      ) : null}

      <Row gap={spacing.sm} wrap>
        <Button label="Auto-schedule blocks" icon="time-outline" size="sm" variant="secondary" onPress={quickSchedule} loading={busy} />
        <Button label="Review the day" icon="journal-outline" size="sm" variant="ghost" onPress={() => router.push(`/review?day=${target}`)} />
        <Button label="Add task" icon="add" size="sm" variant="ghost" onPress={() => router.push('/task-new')} />
      </Row>

      <PlanSection
        title="Must do"
        subtitle="The day succeeds if these get done"
        tasks={mustDo}
        palette={palette}
        target={target}
        use24Hour={use24Hour}
        onMustDo={(task, value) => void update(task.id, { isMustDo: value, planDate: target }).then(() => refetch())}
        onReorder={(index, direction) => void move(mustDo, index, direction)}
        onToggle={(task) => void complete(task, task.status !== 'done').then(() => refetch())}
        onOpen={(task) => router.push(`/task/${task.id}`)}
        onUnschedule={(task) => void unschedule(task.id).then(() => refetch())}
      />

      <PlanSection
        title="Nice to do"
        subtitle="Only after the must-dos are real"
        tasks={niceToDo}
        palette={palette}
        target={target}
        use24Hour={use24Hour}
        onMustDo={(task, value) => void update(task.id, { isMustDo: value, planDate: target }).then(() => refetch())}
        onReorder={(index, direction) => void move(niceToDo, index, direction)}
        onToggle={(task) => void complete(task, task.status !== 'done').then(() => refetch())}
        onOpen={(task) => router.push(`/task/${task.id}`)}
        onUnschedule={(task) => void unschedule(task.id).then(() => refetch())}
      />

      {blocks.length > 0 ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Time blocks" subtitle="The planned shape of the day" />
          <Card>
            <Stack gap={spacing.sm}>
              {blocks.map((block) => (
                <Row key={block.taskId} gap={spacing.md} justify="space-between">
                  <Stack gap={2} style={{ flex: 1 }}>
                    <Type variant="bodyStrong" numberOfLines={1}>
                      {block.title}
                    </Type>
                    <Type variant="caption" color={palette.textMuted}>
                      {block.startLabel} – {block.endLabel} · {formatMinutes(block.estimatedMinutes)}
                    </Type>
                  </Stack>
                  <Row gap={4}>
                    {block.isMustDo ? <Badge label="Must" color={palette.primary} /> : null}
                  </Row>
                </Row>
              ))}
            </Stack>
          </Card>
        </Stack>
      ) : null}

      {planner && planner.candidates.length > 0 ? (
        <Stack gap={spacing.sm}>
          <SectionHeader
            title="Candidates"
            subtitle={`${planner.candidates.length} open tasks elsewhere in your backlog`}
          />
          <Card style={{ paddingVertical: spacing.sm }}>
            {planner.candidates.slice(0, 10).map((task) => (
              <Row key={task.id} gap={spacing.sm} style={{ paddingVertical: 6 }}>
                <Stack gap={2} style={{ flex: 1 }}>
                  <Type variant="body" numberOfLines={1}>
                    {task.title}
                  </Type>
                  <Type variant="caption" color={palette.textMuted}>
                    {task.dueDate ? `due ${task.dueDate}` : 'no date'}
                    {task.estimatedMinutes ? ` · ${formatMinutes(task.estimatedMinutes)}` : ''}
                  </Type>
                </Stack>
                <Chip
                  label="Add"
                  small
                  color={priorityColor(task.priority, palette)}
                  onPress={() => void update(task.id, { planDate: target }).then(() => refetch())}
                />
              </Row>
            ))}
          </Card>
        </Stack>
      ) : null}

      {planner && planned.length === 0 && planner.candidates.length === 0 ? (
        <EmptyState
          icon="today-outline"
          title="Nothing to plan"
          body="Add a few tasks and they will show up here, ready to be sorted into must-do and nice-to-do."
          actionLabel="Add a task"
          onAction={() => router.push('/task-new')}
        />
      ) : null}
    </Screen>
  );
}

function PlanSection({
  title,
  subtitle,
  tasks,
  palette,
  target,
  use24Hour,
  onMustDo,
  onReorder,
  onToggle,
  onOpen,
  onUnschedule,
}: {
  title: string;
  subtitle: string;
  tasks: Task[];
  palette: ReturnType<typeof usePalette>;
  target: string;
  use24Hour: boolean;
  onMustDo: (task: Task, value: boolean) => void;
  onReorder: (index: number, direction: -1 | 1) => void;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
  onUnschedule: (task: Task) => void;
}) {
  void use24Hour;
  if (tasks.length === 0 && title === 'Nice to do') {
    return (
      <Stack gap={spacing.sm}>
        <SectionHeader title={title} subtitle={subtitle} />
        <Card>
          <Type variant="caption" color={palette.textFaint}>
            Nothing here yet. Add tasks to the plan and keep the must-do list short.
          </Type>
        </Card>
      </Stack>
    );
  }
  return (
    <Stack gap={spacing.sm}>
      <SectionHeader title={title} subtitle={subtitle} />
      <Card style={{ paddingVertical: spacing.sm }}>
        {tasks.length === 0 ? (
          <Type variant="caption" color={palette.textFaint}>
            Nothing planned for this day yet.
          </Type>
        ) : (
          tasks.map((task, index) => (
            <Row key={task.id} gap={6} style={{ paddingVertical: 2 }}>
              <Stack gap={2} style={{ flex: 1 }}>
                <TaskRow
                  task={task}
                  today={target}
                  onToggle={() => onToggle(task)}
                  onPress={() => onOpen(task)}
                />
              </Stack>
              <Stack gap={4} style={{ alignItems: 'center' }}>
                <Pressable
                  onPress={() => onReorder(index, -1)}
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${task.title} up`}
                  style={{ width: 34, height: 26, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Ionicons name="chevron-up" size={16} color={index === 0 ? palette.textFaint : palette.textMuted} />
                </Pressable>
                <Pressable
                  onPress={() => onReorder(index, 1)}
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${task.title} down`}
                  style={{ width: 34, height: 26, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Ionicons
                    name="chevron-down"
                    size={16}
                    color={index === tasks.length - 1 ? palette.textFaint : palette.textMuted}
                  />
                </Pressable>
              </Stack>
              <Stack gap={4}>
                <Pressable
                  onPress={() => onMustDo(task, !task.isMustDo)}
                  accessibilityRole="button"
                  accessibilityLabel={`${task.isMustDo ? 'Remove from' : 'Mark as'} must-do`}
                  style={{
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 4,
                    borderRadius: radius.pill,
                    backgroundColor: task.isMustDo ? palette.primary : palette.surfaceMuted,
                  }}
                >
                  <Type variant="micro" color={task.isMustDo ? palette.onPrimary : palette.textMuted}>
                    {task.isMustDo ? 'MUST' : 'NICE'}
                  </Type>
                </Pressable>
                <Pressable
                  onPress={() => onUnschedule(task)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${task.title} from the plan`}
                  style={{ width: 34, height: 26, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Ionicons name="close" size={15} color={palette.textFaint} />
                </Pressable>
              </Stack>
            </Row>
          ))
        )}
      </Card>
    </Stack>
  );
}
