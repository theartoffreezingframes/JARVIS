/**
 * Projects.
 *
 * Real projects with live rollups: task counts and progress come from the tasks
 * assigned to them, so completing a task updates the project bar immediately.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import type { Project } from '@jarvis/shared';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  ProgressBar,
  Row,
  Screen,
  SectionHeader,
  Segmented,
  Sheet,
  Stack,
  Type,
} from '../components/ui';
import { useProjectMutations, useProjects } from '../hooks/useLibrary';
import { radius, spacing, usePalette } from '../lib/theme';

const COLORS = ['#4F46E5', '#0E9F6E', '#D97706', '#D92D20', '#0E7490', '#7C3AED'];
const STATUSES = ['not_started', 'active', 'completed', 'archived'] as const;

export default function ProjectsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { projects, summary, isLoading, refetch } = useProjects(true);
  const mutations = useProjectMutations();
  const [filter, setFilter] = useState<'active' | 'all' | 'completed'>('active');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);

  const visible = projects.filter((project) =>
    filter === 'all' ? true : filter === 'completed' ? project.status === 'completed' : project.status !== 'completed' && project.status !== 'archived',
  );

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Button label="New project" icon="add" size="sm" onPress={() => setCreating(true)} />
      </Row>

      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          Projects
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          {summary
            ? `${summary.active} active · ${summary.tasks} tasks · ${summary.completedTasks} completed`
            : 'Group work into outcomes'}
        </Type>
      </Stack>

      <Segmented
        options={[
          { value: 'active', label: 'Active' },
          { value: 'completed', label: 'Completed' },
          { value: 'all', label: 'All' },
        ]}
        value={filter}
        onChange={setFilter}
      />

      {isLoading && projects.length === 0 ? <LoadingBlock label="Loading projects" /> : null}

      {!isLoading && visible.length === 0 ? (
        <EmptyState
          icon="folder-open-outline"
          title={filter === 'completed' ? 'Nothing completed yet' : 'Create your first project'}
          body="Projects group tasks, notes and deadlines — College, Fitness, a hackathon, anything with an outcome."
          actionLabel="Create a project"
          onAction={() => setCreating(true)}
        />
      ) : null}

      {visible.map((project) => (
        <Card key={project.id} onPress={() => router.push(`/project/${project.id}`)} accessibilityLabel={`Open project ${project.name}`}>
          <Stack gap={spacing.md}>
            <Row gap={spacing.md} align="flex-start">
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: radius.md,
                  backgroundColor: `${project.color}20`,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Type variant="bodyStrong" color={project.color}>
                  {project.name.replace(/^Sample · /, '').slice(0, 1).toUpperCase()}
                </Type>
              </View>
              <Stack gap={3} style={{ flex: 1 }}>
                <Type variant="bodyStrong">{project.name}</Type>
                {project.description ? (
                  <Type variant="caption" color={palette.textMuted} numberOfLines={2}>
                    {project.description}
                  </Type>
                ) : null}
                <Row gap={spacing.sm} wrap>
                  <Badge label={`${project.completedTaskCount}/${project.taskCount} tasks`} />
                  <Badge label={project.status.replace('_', ' ')} color={statusColor(project.status, palette)} />
                  {project.dueDate ? <Badge label={`due ${project.dueDate}`} color={palette.textMuted} /> : null}
                  {project.priority !== 'medium' ? <Badge label={project.priority} color={palette.priority[project.priority]} /> : null}
                </Row>
              </Stack>
            </Row>
            <Stack gap={6}>
              <Row justify="space-between">
                <Type variant="caption" color={palette.textMuted}>
                  Progress
                </Type>
                <Type variant="caption" color={palette.textMuted}>
                  {project.progress}%
                </Type>
              </Row>
              <ProgressBar value={project.progress} color={project.color} />
            </Stack>
            <Row gap={spacing.sm} wrap>
              <Button label="Open" size="sm" variant="secondary" onPress={() => router.push(`/project/${project.id}`)} />
              <Button label="Edit" size="sm" variant="ghost" onPress={() => setEditing(project)} />
              <Button
                label="Delete"
                size="sm"
                variant="ghost"
                onPress={() =>
                  Alert.alert('Delete project?', 'Tasks and notes stay, but they will no longer be grouped.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => void mutations.remove(project.id) },
                  ])
                }
              />
            </Row>
          </Stack>
        </Card>
      ))}

      <ProjectSheet
        visible={creating || Boolean(editing)}
        project={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSave={async (draft) => {
          if (editing) await mutations.update(editing.id, draft);
          else await mutations.create(draft);
          setCreating(false);
          setEditing(null);
          void refetch();
        }}
      />
    </Screen>
  );
}

function ProjectSheet({
  visible,
  project,
  onClose,
  onSave,
}: {
  visible: boolean;
  project: Project | null;
  onClose: () => void;
  onSave: (draft: { name: string; description: string | null; color: string; status: Project['status']; priority: Project['priority']; dueDate: string | null }) => Promise<void>;
}) {
  const palette = usePalette();
  const key = project?.id ?? 'new';
  const [lastKey, setLastKey] = useState(key);
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [color, setColor] = useState(project?.color ?? COLORS[0]);
  const [status, setStatus] = useState<Project['status']>(project?.status ?? 'active');
  const [priority, setPriority] = useState<Project['priority']>(project?.priority ?? 'medium');
  const [dueDate, setDueDate] = useState<string | null>(project?.dueDate ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (lastKey !== key) {
    setLastKey(key);
    setName(project?.name ?? '');
    setDescription(project?.description ?? '');
    setColor(project?.color ?? COLORS[0]);
    setStatus(project?.status ?? 'active');
    setPriority(project?.priority ?? 'medium');
    setDueDate(project?.dueDate ?? null);
  }

  const submit = async () => {
    if (!name.trim()) {
      setError('A project needs a name');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), description: description.trim() || null, color, status, priority, dueDate });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the project');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={project ? 'Edit project' : 'New project'}>
      <Field label="Name">
        <Input value={name} onChangeText={setName} placeholder="College" />
      </Field>
      <Field label="Description">
        <Input value={description} onChangeText={setDescription} placeholder="What does finishing this look like?" multiline />
      </Field>
      <Field label="Status">
        <Row gap={spacing.sm} wrap>
          {STATUSES.map((option) => (
            <Chip key={option} label={option.replace('_', ' ')} selected={status === option} onPress={() => setStatus(option)} />
          ))}
        </Row>
      </Field>
      <Field label="Priority">
        <Row gap={spacing.sm} wrap>
          {(['low', 'medium', 'high', 'urgent'] as const).map((option) => (
            <Chip
              key={option}
              label={option}
              color={palette.priority[option]}
              selected={priority === option}
              onPress={() => setPriority(option)}
            />
          ))}
        </Row>
      </Field>
      <Field label="Deadline" hint={dueDate ?? 'No deadline set'}>
        <Row gap={spacing.sm} wrap>
          <Chip label="None" selected={!dueDate} onPress={() => setDueDate(null)} />
          {[7, 14, 30, 90].map((days) => {
            const value = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
            return (
              <Chip key={days} label={`${days} days`} selected={dueDate === value} onPress={() => setDueDate(value)} />
            );
          })}
        </Row>
      </Field>
      <Field label="Colour">
        <Row gap={spacing.sm} wrap>
          {COLORS.map((option) => (
            <Pressable
              key={option}
              onPress={() => setColor(option)}
              accessibilityRole="button"
              accessibilityLabel={`Colour ${option}`}
              accessibilityState={{ selected: color === option }}
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                backgroundColor: option,
                borderWidth: color === option ? 3 : 0,
                borderColor: palette.text,
              }}
            />
          ))}
        </Row>
      </Field>
      {error ? (
        <Type variant="caption" color={palette.danger}>
          {error}
        </Type>
      ) : null}
      <Row gap={spacing.sm}>
        <Button label="Cancel" variant="secondary" onPress={onClose} />
        <Button label={project ? 'Save project' : 'Create project'} onPress={submit} loading={busy} />
      </Row>
    </Sheet>
  );
}

function statusColor(status: Project['status'], palette: ReturnType<typeof usePalette>): string {
  switch (status) {
    case 'active':
      return palette.primary;
    case 'completed':
      return palette.success;
    case 'archived':
      return palette.textMuted;
    default:
      return palette.info;
  }
}
