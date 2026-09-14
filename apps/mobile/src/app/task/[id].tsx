/**
 * Task detail.
 *
 * Every field of a task is editable here and saved through the same API the
 * lists use, so the matrix, calendar, planner, analytics and heat maps all
 * reflect a change made on this screen immediately.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { Alert, Pressable, View } from 'react-native';
import type { Task } from '@jarvis/shared';
import { SubtaskRow, priorityColor } from '../../components/tasks';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Row,
  Screen,
  SectionHeader,
  Segmented,
  Stack,
  SwitchRow,
  Type,
} from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useProjects, useNotes, useNoteMutations } from '../../hooks/useLibrary';
import { describeFailure, useTask, useTaskMutations } from '../../hooks/useTasks';
import { radius, spacing, usePalette } from '../../lib/theme';

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const PRIORITY_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();
  const router = useRouter();
  const { settings } = useAuth();
  const { data: task, refetch } = useTask(id ?? null);
  const { projects } = useProjects();
  const mutations = useTaskMutations();
  const { notes } = useNotes({ taskId: id });
  const noteMutations = useNoteMutations();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [notesText, setNotesText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description ?? '');
    setNotesText(task.notes ?? '');
    setDirty(false);
  }, [task?.id, task?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const project = useMemo(() => projects.find((item) => item.id === task?.projectId), [projects, task?.projectId]);
  const today = useMemo(() => new Date(Date.now()).toISOString().slice(0, 10), []);

  if (!task) {
    return (
      <Screen edges={['top']}>
        <Row justify="space-between">
          <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        </Row>
        <LoadingBlock label="Loading task" />
      </Screen>
    );
  }

  const patch = async (input: Parameters<typeof mutations.update>[1], note?: string) => {
    setSaving(true);
    setMessage(null);
    try {
      await mutations.update(task.id, input);
      if (note) setMessage(note);
    } catch (error) {
      const failure = describeFailure(error);
      setMessage(failure.offline ? 'Saved on this device — will sync when you are online.' : failure.message);
    } finally {
      setSaving(false);
      void refetch();
    }
  };

  const saveText = async () => {
    await patch({ title: title.trim() || task.title, description: description || null, notes: notesText || null });
    setDirty(false);
    setMessage('Saved.');
  };

  const toggleDone = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSaving(true);
    try {
      await mutations.complete(task, task.status !== 'done');
      setMessage(task.status === 'done' ? 'Reopened.' : 'Completed — analytics and heat map updated.');
    } finally {
      setSaving(false);
      void refetch();
    }
  };

  const confirmDelete = () => {
    Alert.alert('Delete task?', 'This removes the task and its subtasks from every screen.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await mutations.remove(task);
          router.back();
        },
      },
    ]);
  };

  const quadrant =
    task.important && task.urgent
      ? 'do_now'
      : task.important
        ? 'schedule'
        : task.urgent
          ? 'delegate'
          : 'eliminate';

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Row gap={spacing.xs}>
          {saving ? <Badge label="Saving" color={palette.info} /> : null}
          <Button
            label={task.status === 'done' ? 'Reopen' : 'Complete'}
            icon={task.status === 'done' ? 'refresh' : 'checkmark'}
            size="sm"
            onPress={toggleDone}
          />
        </Row>
      </Row>

      {message ? (
        <Card style={{ backgroundColor: palette.surfaceMuted }}>
          <Type variant="caption">{message}</Type>
        </Card>
      ) : null}

      <Card>
        <Stack gap={spacing.md}>
          <Field label="Title">
            <Input
              value={title}
              onChangeText={(value) => {
                setTitle(value);
                setDirty(true);
              }}
              multiline
            />
          </Field>
          <Field label="Description">
            <Input
              value={description}
              onChangeText={(value) => {
                setDescription(value);
                setDirty(true);
              }}
              placeholder="What does done look like?"
              multiline
              style={{ minHeight: 72, textAlignVertical: 'top' }}
            />
          </Field>
          <Field label="Notes">
            <Input
              value={notesText}
              onChangeText={(value) => {
                setNotesText(value);
                setDirty(true);
              }}
              placeholder="Links, context, anything you would otherwise forget"
              multiline
              style={{ minHeight: 72, textAlignVertical: 'top' }}
            />
          </Field>
          {dirty ? <Button label="Save changes" icon="save-outline" onPress={saveText} loading={saving} full /> : null}
        </Stack>
      </Card>

      <Card>
        <Stack gap={spacing.md}>
          <SectionHeader title="Classification" subtitle="This is what places the task in the matrix." />
          <Stack gap={spacing.xs}>
            <SwitchRow
              label="Important"
              description="Contributes to something you care about."
              value={task.important}
              onValueChange={(value) => void patch({ important: value })}
            />
            <SwitchRow
              label="Urgent"
              description="Has a deadline or someone is waiting."
              value={task.urgent}
              onValueChange={(value) => void patch({ urgent: value })}
            />
          </Stack>
          <Row gap={spacing.sm} wrap>
            <Badge label={`Quadrant: ${quadrantLabel(quadrant)}`} color={palette.quadrant[quadrant]} />
            <Badge label={`Priority: ${PRIORITY_LABEL[task.priority]}`} color={priorityColor(task.priority, palette)} />
          </Row>
          <Row gap={spacing.sm} wrap>
            {PRIORITIES.map((option) => (
              <Chip
                key={option}
                label={PRIORITY_LABEL[option]}
                color={priorityColor(option, palette)}
                selected={task.priority === option}
                onPress={() => void patch({ priority: option })}
              />
            ))}
          </Row>
        </Stack>
      </Card>

      <Card>
        <Stack gap={spacing.md}>
          <SectionHeader title="Schedule" />
          <Field label="Due date">
            <Row gap={spacing.sm} wrap>
              <Chip label="None" selected={!task.dueDate} onPress={() => void patch({ dueDate: null })} />
              {[0, 1, 7].map((offset) => {
                const key = dayKeyWithOffset(offset, task);
                return (
                  <Chip
                    key={offset}
                    label={offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : 'Next week'}
                    selected={task.dueDate === key}
                    onPress={() => void patch({ dueDate: key })}
                  />
                );
              })}
            </Row>
          </Field>
          <Field label="Time">
            <Row gap={spacing.sm} wrap>
              <Chip label="None" selected={!task.dueTime} onPress={() => void patch({ dueTime: null })} />
              {['07:00', '09:00', '12:00', '15:00', '17:00', '19:00', '21:00'].map((option) => (
                <Chip
                  key={option}
                  label={option}
                  selected={task.dueTime === option}
                  onPress={() => void patch({ dueTime: option })}
                />
              ))}
            </Row>
          </Field>
          <Field
            label="Reminder"
            hint={task.reminderAt ? `Set for ${new Date(task.reminderAt).toLocaleString()}` : 'Reminders use local notifications.'}
          >
            <Row gap={spacing.sm} wrap>
              <Chip label="None" selected={!task.reminderAt} onPress={() => void patch({ reminderAt: null })} />
              {[
                { label: 'At due time', minutes: 0 },
                { label: '30 min before', minutes: 30 },
                { label: '1 hour before', minutes: 60 },
                { label: '1 day before', minutes: 1440 },
              ].map((option) => (
                <Chip
                  key={option.minutes}
                  label={option.label}
                  onPress={() => void patch({ reminderAt: reminderFor(task, option.minutes) })}
                />
              ))}
            </Row>
          </Field>
          <Field label="Estimate">
            <Row gap={spacing.sm} wrap>
              <Chip label="None" selected={!task.estimatedMinutes} onPress={() => void patch({ estimatedMinutes: null })} />
              {[15, 30, 45, 60, 90, 120].map((option) => (
                <Chip
                  key={option}
                  label={option >= 60 ? `${option / 60}h` : `${option}m`}
                  selected={task.estimatedMinutes === option}
                  onPress={() => void patch({ estimatedMinutes: option })}
                />
              ))}
            </Row>
          </Field>
          <Row gap={spacing.lg}>
            <Stack gap={2}>
              <Type variant="micro" color={palette.textMuted}>
                ACTUAL TIME
              </Type>
              <Type variant="bodyStrong">{task.actualMinutes} min</Type>
            </Stack>
            <Stack gap={2}>
              <Type variant="micro" color={palette.textMuted}>
                PLANNED DAY
              </Type>
              <Type variant="bodyStrong">{task.planDate ?? 'Not planned'}</Type>
            </Stack>
            <Stack gap={2}>
              <Type variant="micro" color={palette.textMuted}>
                {task.isMustDo ? 'MUST DO' : 'NICE TO DO'}
              </Type>
              <Type variant="bodyStrong">{task.isMustDo ? 'Yes' : 'No'}</Type>
            </Stack>
          </Row>
          <Row gap={spacing.sm}>
            <Button
              label={task.isMustDo ? 'Move to nice-to-do' : 'Mark must-do'}
              size="sm"
              variant="secondary"
              onPress={() => void patch({ isMustDo: !task.isMustDo })}
            />
            <Button
              label={task.planDate ? 'Remove from plan' : 'Add to today'}
              size="sm"
              variant="secondary"
              onPress={() => void patch({ planDate: task.planDate ? null : today })}
            />
          </Row>
        </Stack>
      </Card>

      <Card>
        <Stack gap={spacing.md}>
          <SectionHeader title="Project & tags" />
          <Row gap={spacing.sm} wrap>
            <Chip label="Inbox" selected={!task.projectId} onPress={() => void patch({ projectId: null })} />
            {projects.map((item) => (
              <Chip
                key={item.id}
                label={item.name}
                color={item.color}
                selected={task.projectId === item.id}
                onPress={() => void patch({ projectId: item.id })}
              />
            ))}
          </Row>
          <Row gap={spacing.sm} wrap>
            {task.tags.length > 0 ? (
              task.tags.map((tag) => (
                <Chip
                  key={tag}
                  label={`#${tag}`}
                  selected
                  onPress={() => void patch({ tags: task.tags.filter((item) => item !== tag) })}
                />
              ))
            ) : (
              <Type variant="caption" color={palette.textFaint}>
                No tags. Add them from quick capture with #hashtags.
              </Type>
            )}
          </Row>
          {project ? (
            <Type variant="caption" color={palette.textMuted}>
              {project.name} · {project.completedTaskCount}/{project.taskCount} tasks done ({project.progress}%)
            </Type>
          ) : null}
        </Stack>
      </Card>

      <Card>
        <Stack gap={spacing.md}>
          <SectionHeader title="Repeat" />
          <Segmented
            options={[
              { value: 'none', label: 'Once' },
              { value: 'daily', label: 'Daily' },
              { value: 'weekdays', label: 'Weekdays' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
            ]}
            value={(task.recurrence?.kind ?? 'none') as 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly'}
            onChange={(value) =>
              void patch({
                recurrence:
                  value === 'none'
                    ? { kind: 'none', interval: 1, byWeekday: [], until: null, count: 0, maxOccurrences: null }
                    : { kind: value, interval: 1, byWeekday: [], until: null, count: 0, maxOccurrences: null },
              })
            }
          />
          <Type variant="caption" color={palette.textFaint}>
            Completing a repeating task creates the next occurrence automatically.
          </Type>
        </Stack>
      </Card>

      <Card>
        <Stack gap={spacing.md}>
          <SectionHeader
            title="Subtasks"
            subtitle={`${task.subtasks.filter((item) => item.status === 'done').length}/${task.subtasks.length} complete`}
          />
          <Stack gap={spacing.xs}>
            {task.subtasks.length === 0 ? (
              <Type variant="caption" color={palette.textFaint}>
                Break the task into steps — the progress bar in the list uses them.
              </Type>
            ) : (
              task.subtasks
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((subtask) => (
                  <SubtaskRow
                    key={subtask.id}
                    title={subtask.title}
                    done={subtask.status === 'done'}
                    onToggle={() => mutations.updateSubtask(subtask.id, { status: subtask.status !== 'done' ? 'done' : 'todo' })}
                    onRemove={() => mutations.removeSubtask(subtask.id)}
                  />
                ))
            )}
          </Stack>
          <Row gap={spacing.sm}>
            <View style={{ flex: 1 }}>
              <Input
                value={subtaskDraft}
                onChangeText={setSubtaskDraft}
                placeholder="Add a step"
                onSubmitEditing={() => {
                  if (!subtaskDraft.trim()) return;
                  void mutations.addSubtask(task.id, subtaskDraft.trim());
                  setSubtaskDraft('');
                }}
                returnKeyType="done"
              />
            </View>
            <Button
              label="Add"
              size="sm"
              onPress={() => {
                if (!subtaskDraft.trim()) return;
                void mutations.addSubtask(task.id, subtaskDraft.trim());
                setSubtaskDraft('');
              }}
              disabled={!subtaskDraft.trim()}
            />
          </Row>
        </Stack>
      </Card>

      <Card>
        <Stack gap={spacing.md}>
          <SectionHeader
            title="Linked notes"
            action={showNoteEditor ? 'Cancel' : 'Add note'}
            onAction={() => setShowNoteEditor((value) => !value)}
          />
          {showNoteEditor ? (
            <Stack gap={spacing.sm}>
              <Input
                value={noteDraft}
                onChangeText={setNoteDraft}
                placeholder="Write a note for this task"
                multiline
                style={{ minHeight: 72, textAlignVertical: 'top' }}
              />
              <Button
                label="Save note"
                size="sm"
                onPress={async () => {
                  if (!noteDraft.trim()) return;
                  await noteMutations.create({ title: task.title, body: noteDraft.trim(), taskId: task.id, projectId: task.projectId });
                  setNoteDraft('');
                  setShowNoteEditor(false);
                }}
              />
            </Stack>
          ) : null}
          {notes.length === 0 && !showNoteEditor ? (
            <Type variant="caption" color={palette.textFaint}>
              No notes attached yet.
            </Type>
          ) : (
            notes.map((note) => (
              <Pressable
                key={note.id}
                onPress={() => router.push(`/note/${note.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Open note ${note.title}`}
                style={{ paddingVertical: spacing.sm }}
              >
                <Stack gap={2}>
                  <Type variant="bodyStrong" numberOfLines={1}>
                    {note.title || 'Untitled note'}
                  </Type>
                  <Type variant="caption" numberOfLines={2} color={palette.textMuted}>
                    {note.body}
                  </Type>
                </Stack>
              </Pressable>
            ))
          )}
        </Stack>
      </Card>

      <Card>
        <Stack gap={spacing.sm}>
          <SectionHeader title="Other actions" />
          <Button
            label="Start a focus session on this task"
            icon="timer-outline"
            variant="secondary"
            onPress={() => router.push({ pathname: '/(tabs)/focus', params: { taskId: task.id } })}
          />
          <Button
            label="Duplicate"
            icon="copy-outline"
            variant="secondary"
            onPress={async () => {
              try {
                await mutations.duplicate(task.id);
                setMessage('Duplicated — the copy is in your task list.');
              } catch (error) {
                setMessage(describeFailure(error).message);
              }
            }}
          />
          <Button
            label={task.archivedAt ? 'Unarchive' : 'Archive'}
            icon="archive-outline"
            variant="secondary"
            onPress={async () => {
              if (task.archivedAt) await patch({ status: 'todo' });
              else await mutations.archive(task.id);
              void refetch();
            }}
          />
          <Button label="Delete task" icon="trash-outline" variant="danger" onPress={confirmDelete} />
        </Stack>
      </Card>

      <Stack gap={4}>
        <Type variant="micro" color={palette.textFaint}>
          CREATED {new Date(task.createdAt).toLocaleString()}
        </Type>
        <Type variant="micro" color={palette.textFaint}>
          UPDATED {new Date(task.updatedAt).toLocaleString()}
        </Type>
        {task.completedAt ? (
          <Type variant="micro" color={palette.textFaint}>
            COMPLETED {new Date(task.completedAt).toLocaleString()}
          </Type>
        ) : null}
        <Type variant="micro" color={palette.textFaint}>
          ID {task.id}
        </Type>
      </Stack>

      {settings ? null : (
        <EmptyState title="Settings unavailable" body="Your account settings could not be loaded." />
      )}
    </Screen>
  );
}

function quadrantLabel(key: string): string {
  return key === 'do_now' ? 'Do now' : key === 'schedule' ? 'Schedule' : key === 'delegate' ? 'Delegate' : 'Eliminate';
}

function dayKeyWithOffset(offset: number, task: Task): string {
  const base = task.dueDate ? Date.parse(`${task.dueDate}T00:00:00Z`) : Date.now();
  return new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
}

function reminderFor(task: Task, minutesBefore: number): number {
  if (!task.dueDate) return Date.now() + 60 * 60_000;
  const time = task.dueTime ?? '09:00';
  const due = Date.parse(`${task.dueDate}T${time}:00Z`);
  return due - minutesBefore * 60_000;
}
