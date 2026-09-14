/**
 * Project detail — the project's tasks, notes, progress and focus time.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import { TaskRow, priorityColor, formatMinutes } from '../../components/tasks';
import { ApiError } from '../../lib/api';
import {
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
import { useDashboard } from '../../hooks/useDashboard';
import { useProject } from '../../hooks/useLibrary';
import { useTaskMutations } from '../../hooks/useTasks';
import { spacing, usePalette } from '../../lib/theme';

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();
  const router = useRouter();
  const { overview, isLoading, error, refetch } = useProject(id ?? null);
  const { complete } = useTaskMutations();
  const { dashboard } = useDashboard();

  const grouped = useMemo(() => {
    const tasks = overview?.tasks ?? [];
    return {
      open: tasks.filter((task) => task.status !== 'done' && !task.archivedAt),
      done: tasks.filter((task) => task.status === 'done'),
      archived: tasks.filter((task) => task.archivedAt),
    };
  }, [overview?.tasks]);

  if (isLoading && !overview) {
    return (
      <Screen edges={['top']}>
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <LoadingBlock label="Loading project" />
      </Screen>
    );
  }

  if (error && !overview) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <Screen edges={['top']}>
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        {missing ? (
          <EmptyState icon="alert-circle-outline" title="Project not found" body="It may have been deleted." />
        ) : (
          <ErrorBlock message="This project could not be loaded." onRetry={() => void refetch()} />
        )}
      </Screen>
    );
  }

  if (!overview) {
    return (
      <Screen edges={['top']}>
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <EmptyState icon="alert-circle-outline" title="Project not found" body="It may have been deleted." />
      </Screen>
    );
  }

  const { project, stats, nextUp, notes } = overview;

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Button label="Add task" icon="add" size="sm" onPress={() => router.push('/task-new')} />
      </Row>

      <Stack gap={spacing.sm}>
        <Row gap={spacing.sm} align="center">
          <View
            style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: project.color }}
            accessibilityRole="image"
          />
          <Type variant="title" accessibilityRole="header">
            {project.name}
          </Type>
        </Row>
        {project.description ? (
          <Type variant="body" color={palette.textMuted}>
            {project.description}
          </Type>
        ) : null}
        <Row gap={spacing.sm} wrap>
          <Badge label={project.status.replace('_', ' ')} color={project.status === 'completed' ? palette.success : palette.primary} />
          <Badge label={`${project.priority} priority`} color={priorityColor(project.priority, palette)} />
          {project.dueDate ? <Badge label={`due ${project.dueDate}`} color={palette.textMuted} /> : null}
          {project.tags.map((tag) => (
            <Badge key={tag} label={`#${tag}`} />
          ))}
        </Row>
      </Stack>

      <Card>
        <Stack gap={spacing.md}>
          <Row justify="space-between">
            <Type variant="label" color={palette.textMuted}>
              PROGRESS
            </Type>
            <Type variant="label" color={project.color}>
              {project.progress}%
            </Type>
          </Row>
          <ProgressBar value={project.progress} color={project.color} />
          <Row gap={spacing.lg}>
            <Stack gap={2} style={{ flex: 1 }}>
              <Type variant="micro" color={palette.textMuted}>
                OPEN
              </Type>
              <Type variant="bodyStrong">{stats.open}</Type>
            </Stack>
            <Stack gap={2} style={{ flex: 1 }}>
              <Type variant="micro" color={palette.textMuted}>
                COMPLETED
              </Type>
              <Type variant="bodyStrong">{stats.completed}</Type>
            </Stack>
            <Stack gap={2} style={{ flex: 1 }}>
              <Type variant="micro" color={palette.textMuted}>
                OVERDUE
              </Type>
              <Type variant="bodyStrong" color={stats.overdue > 0 ? palette.danger : undefined}>
                {stats.overdue}
              </Type>
            </Stack>
            <Stack gap={2} style={{ flex: 1 }}>
              <Type variant="micro" color={palette.textMuted}>
                ESTIMATED
              </Type>
              <Type variant="bodyStrong">{formatMinutes(stats.estimatedMinutes)}</Type>
            </Stack>
            <Stack gap={2} style={{ flex: 1 }}>
              <Type variant="micro" color={palette.textMuted}>
                FOCUSED
              </Type>
              <Type variant="bodyStrong">{formatMinutes(stats.focusMinutes)}</Type>
            </Stack>
          </Row>
        </Stack>
      </Card>

      {nextUp.length > 0 ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Next up" subtitle="The nearest deadlines in this project" />
          <Card style={{ paddingVertical: spacing.sm }}>
            {nextUp.map((task, index) => (
              <View key={task.id}>
                {index > 0 ? <View style={{ height: 1, backgroundColor: palette.border, marginLeft: 40 }} /> : null}
                <TaskRow
                  task={task}
                  today={dashboard?.today ?? ''}
                  onToggle={() => {
                    void complete(task, task.status !== 'done').then(() => refetch());
                  }}
                  onPress={() => router.push(`/task/${task.id}`)}
                />
              </View>
            ))}
          </Card>
        </Stack>
      ) : null}

      <Stack gap={spacing.sm}>
        <SectionHeader title="Open tasks" subtitle={`${grouped.open.length} remaining`} />
        {grouped.open.length === 0 ? (
          <EmptyState icon="checkmark-done-outline" title="Nothing open" body="Every task in this project is complete." />
        ) : (
          <Card style={{ paddingVertical: spacing.sm }}>
            {grouped.open.map((task, index) => (
              <View key={task.id}>
                {index > 0 ? <View style={{ height: 1, backgroundColor: palette.border, marginLeft: 40 }} /> : null}
                <TaskRow
                  task={task}
                  today={dashboard?.today ?? ''}
                  onToggle={() => {
                    void complete(task, true).then(() => refetch());
                  }}
                  onPress={() => router.push(`/task/${task.id}`)}
                />
              </View>
            ))}
          </Card>
        )}
      </Stack>

      {grouped.done.length > 0 ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Completed" subtitle={`${grouped.done.length} tasks`} />
          <Card style={{ paddingVertical: spacing.sm }}>
            {grouped.done.slice(0, 8).map((task) => (
              <TaskRow key={task.id} task={task} today={dashboard?.today ?? ''} dense onPress={() => router.push(`/task/${task.id}`)} />
            ))}
          </Card>
        </Stack>
      ) : null}

      {notes.length > 0 ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Notes" action="All notes" onAction={() => router.push('/notes')} />
          {notes.map((note) => (
            <Card key={note.id} onPress={() => router.push(`/note/${note.id}`)} accessibilityLabel={`Open note ${note.title}`}>
              <Stack gap={4}>
                <Type variant="bodyStrong" numberOfLines={1}>
                  {note.title || 'Untitled note'}
                </Type>
                <Type variant="caption" color={palette.textMuted} numberOfLines={3}>
                  {note.body}
                </Type>
              </Stack>
            </Card>
          ))}
        </Stack>
      ) : null}
    </Screen>
  );
}
