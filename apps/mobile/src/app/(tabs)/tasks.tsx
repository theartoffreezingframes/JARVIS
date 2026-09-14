/**
 * Tasks.
 *
 * One list with switchable views, filters that stay out of the way, and a
 * long-press menu for everything you would otherwise hunt for in a detail
 * screen. Offline changes are queued and replayed automatically.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import type { Task } from '@jarvis/shared';
import { TaskRow, dueLabel, priorityColor } from '../../components/tasks';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Row,
  Screen,
  SectionHeader,
  Segmented,
  Sheet,
  Stack,
  Type,
} from '../../components/ui';
import { useTags } from '../../hooks/useLibrary';
import { useProjects } from '../../hooks/useLibrary';
import { useTaskMutations, useTasks, type TaskView } from '../../hooks/useTasks';
import { useAuth } from '../../lib/auth';
import { usePalette, spacing } from '../../lib/theme';

const VIEWS: Array<{ value: TaskView; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'inbox', label: 'Inbox' },
  { value: 'completed', label: 'Done' },
  { value: 'archived', label: 'Archive' },
];

const PRIORITIES = [
  { value: '', label: 'Any priority' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export default function TasksScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { user } = useAuth();
  const [view, setView] = useState<TaskView>('today');
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [menuTask, setMenuTask] = useState<Task | null>(null);

  const filters = useMemo(
    () => ({
      view,
      search: search.trim() || undefined,
      priority: priority || undefined,
      tag: tag ?? undefined,
      projectId: projectId ?? undefined,
      limit: 200,
    }),
    [view, search, priority, tag, projectId],
  );

  const { tasks, counts, today, isLoading, isFetching, error, refetch } = useTasks(filters);
  const { projects } = useProjects();
  const { tags } = useTags();
  const mutations = useTaskMutations();

  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const grouped = useMemo(() => {
    if (view !== 'today' && view !== 'upcoming' && view !== 'overdue') return null;
    const groups = new Map<string, Task[]>();
    for (const task of tasks) {
      const key = task.dueDate ?? 'No date';
      const bucket = groups.get(key) ?? [];
      bucket.push(task);
      groups.set(key, bucket);
    }
    return [...groups.entries()].sort((a, b) => (a[0] === 'No date' ? 1 : b[0] === 'No date' ? -1 : a[0] < b[0] ? -1 : 1));
  }, [tasks, view]);

  const activeFilterCount = [priority, tag, projectId].filter(Boolean).length;

  const toggle = (task: Task) => mutations.complete(task, task.status !== 'done');

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={palette.primary} />}
    >
      <Row justify="space-between" align="center">
        <Stack gap={2}>
          <Type variant="title" accessibilityRole="header">
            Tasks
          </Type>
          {counts ? (
            <Type variant="caption" color={palette.textMuted}>
              {counts.open} open · {counts.done} done
              {counts.overdue > 0 ? ` · ${counts.overdue} overdue` : ''}
            </Type>
          ) : null}
        </Stack>
        <Row gap={spacing.xs}>
          <Button label="Filters" icon="options-outline" size="sm" variant="secondary" onPress={() => setFiltersOpen(true)} />
        </Row>
      </Row>

      <Field>
        <Row gap={spacing.sm}>
          <View style={{ flex: 1 }}>
            <Input
              value={search}
              onChangeText={setSearch}
              placeholder="Search tasks"
              returnKeyType="search"
              autoCapitalize="none"
              accessibilityLabel="Search tasks"
            />
          </View>
          <Button label="Add" icon="add" size="sm" onPress={() => router.push('/task-new')} />
        </Row>
      </Field>

      <View style={{ gap: spacing.sm }}>
        <Segmented options={VIEWS.slice(0, 3)} value={view} onChange={setView} />
        <Segmented options={VIEWS.slice(3)} value={view} onChange={setView} />
      </View>

      {activeFilterCount > 0 ? (
        <Row gap={spacing.sm} wrap>
          {priority ? (
            <Chip label={priority} selected color={priorityColor(priority, palette)} onPress={() => setPriority('')} />
          ) : null}
          {tag ? <Chip label={`#${tag}`} selected onPress={() => setTag(null)} /> : null}
          {projectId ? (
            <Chip label={projectNames.get(projectId) ?? 'Project'} selected onPress={() => setProjectId(null)} />
          ) : null}
        </Row>
      ) : null}

      {isLoading && tasks.length === 0 ? <LoadingBlock label="Loading tasks" /> : null}
      {error && tasks.length === 0 ? <ErrorBlock message="Tasks could not be loaded." onRetry={refetch} /> : null}

      {!isLoading && tasks.length === 0 ? (
        <EmptyState
          icon={view === 'archived' ? 'archive-outline' : 'checkmark-done-outline'}
          title={emptyTitle(view, search)}
          body={emptyBody(view)}
          actionLabel="Add a task"
          onAction={() => router.push('/task-new')}
        />
      ) : null}

      {grouped
        ? grouped.map(([dayKey, group]) => (
            <Stack key={dayKey} gap={spacing.sm}>
              <SectionHeader
                title={dayKey === 'No date' ? 'No date' : dayLabelFor(dayKey, today)}
                subtitle={`${group.length} task${group.length === 1 ? '' : 's'}`}
              />
              <Card style={{ paddingVertical: spacing.sm }}>
                {group.map((task, index) => (
                  <View key={task.id}>
                    {index > 0 ? <View style={{ height: 1, backgroundColor: palette.border, marginLeft: 40 }} /> : null}
                    <TaskRow
                      task={task}
                      today={today}
                      projectName={task.projectId ? projectNames.get(task.projectId) : null}
                      showProject
                      onToggle={() => toggle(task)}
                      onPress={() => router.push(`/task/${task.id}`)}
                      onLongPress={() => setMenuTask(task)}
                    />
                  </View>
                ))}
              </Card>
            </Stack>
          ))
        : tasks.length > 0
          ? (
            <Card style={{ paddingVertical: spacing.sm }}>
              {tasks.map((task, index) => (
                <View key={task.id}>
                  {index > 0 ? <View style={{ height: 1, backgroundColor: palette.border, marginLeft: 40 }} /> : null}
                  <TaskRow
                    task={task}
                    today={today}
                    projectName={task.projectId ? projectNames.get(task.projectId) : null}
                    showProject
                    onToggle={() => toggle(task)}
                    onPress={() => router.push(`/task/${task.id}`)}
                    onLongPress={() => setMenuTask(task)}
                  />
                </View>
              ))}
            </Card>
          )
          : null}

      <Sheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        <Stack gap={spacing.md}>
          <Type variant="label" color={palette.textMuted}>
            PRIORITY
          </Type>
          <Row gap={spacing.sm} wrap>
            {PRIORITIES.map((option) => (
              <Chip
                key={option.value || 'any'}
                label={option.label}
                selected={priority === option.value}
                onPress={() => setPriority(option.value)}
                color={option.value ? priorityColor(option.value, palette) : undefined}
              />
            ))}
          </Row>

          <Type variant="label" color={palette.textMuted}>
            PROJECT
          </Type>
          <Row gap={spacing.sm} wrap>
            <Chip label="Any" selected={!projectId} onPress={() => setProjectId(null)} />
            {projects.map((project) => (
              <Chip
                key={project.id}
                label={project.name}
                selected={projectId === project.id}
                onPress={() => setProjectId(project.id)}
                color={project.color}
              />
            ))}
          </Row>

          {tags.length > 0 ? (
            <>
              <Type variant="label" color={palette.textMuted}>
                TAG
              </Type>
              <Row gap={spacing.sm} wrap>
                <Chip label="Any" selected={!tag} onPress={() => setTag(null)} />
                {tags.slice(0, 16).map((item) => (
                  <Chip key={item.id} label={`#${item.name}`} selected={tag === item.name} onPress={() => setTag(item.name)} />
                ))}
              </Row>
            </>
          ) : null}

          <Row gap={spacing.sm}>
            <Button
              label="Clear"
              variant="secondary"
              onPress={() => {
                setPriority('');
                setTag(null);
                setProjectId(null);
              }}
            />
            <Button label="Done" onPress={() => setFiltersOpen(false)} />
          </Row>
        </Stack>
      </Sheet>

      <Sheet visible={Boolean(menuTask)} onClose={() => setMenuTask(null)} title={menuTask?.title}>
        {menuTask ? (
          <Stack gap={spacing.sm}>
            <Row gap={spacing.sm} wrap>
              <Badge
                label={menuTask.status === 'done' ? 'Completed' : 'Open'}
                color={menuTask.status === 'done' ? palette.success : palette.info}
              />
              <Badge label={`${menuTask.priority} priority`} color={priorityColor(menuTask.priority, palette)} />
              {menuTask.dueDate ? <Badge label={menuTask.dueDate} /> : null}
              {menuTask.isMustDo ? <Badge label="Must do" color={palette.primary} /> : null}
            </Row>
            <Button
              label={menuTask.status === 'done' ? 'Mark as not done' : 'Mark as done'}
              icon="checkmark-circle-outline"
              onPress={() => {
                toggle(menuTask);
                setMenuTask(null);
              }}
            />
            <Button
              label="Open details"
              icon="open-outline"
              variant="secondary"
              onPress={() => {
                const task = menuTask;
                setMenuTask(null);
                router.push(`/task/${task.id}`);
              }}
            />
            <Button
              label="Duplicate"
              icon="copy-outline"
              variant="secondary"
              onPress={() => {
                void mutations.duplicate(menuTask.id);
                setMenuTask(null);
              }}
            />
            <Button
              label="Reschedule to tomorrow"
              icon="calendar-outline"
              variant="secondary"
              onPress={() => {
                const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
                void mutations.update(menuTask.id, { dueDate: tomorrow });
                setMenuTask(null);
              }}
            />
            <Button
              label={menuTask.archivedAt ? 'Unarchive' : 'Archive'}
              icon="archive-outline"
              variant="secondary"
              onPress={() => {
                void mutations.archive(menuTask.id);
                setMenuTask(null);
              }}
            />
            <Button
              label="Delete"
              icon="trash-outline"
              variant="danger"
              onPress={() => {
                void mutations.remove(menuTask);
                setMenuTask(null);
              }}
              accessibilityHint="Deletes the task and its subtasks"
            />
          </Stack>
        ) : null}
      </Sheet>
    </Screen>
  );
}

function emptyTitle(view: TaskView, search: string): string {
  if (search) return 'No matches';
  switch (view) {
    case 'completed':
      return 'Nothing completed yet';
    case 'archived':
      return 'Archive is empty';
    case 'overdue':
      return 'Nothing overdue';
    case 'inbox':
      return 'Inbox zero';
    default:
      return 'No tasks here';
  }
}

function emptyBody(view: TaskView): string {
  switch (view) {
    case 'completed':
      return 'Completed tasks land here so you can see the week add up.';
    case 'archived':
      return 'Archiving keeps the lists clean without deleting anything.';
    case 'overdue':
      return 'Everything is on time. Nice.';
    case 'inbox':
      return 'Unsorted captures wait here until you give them a project.';
    default:
      return 'Capture something in your own words — "finish the lab report tomorrow at 5".';
  }
}

function dayLabelFor(dayKey: string, today: string): string {
  const label = dueLabel({ dueDate: dayKey, status: 'todo' } as Task, today);
  return label?.overdue ? `Overdue · ${dayKey}` : (label?.text ?? dayKey);
}
