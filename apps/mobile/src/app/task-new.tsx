/**
 * Quick capture.
 *
 * Type the task the way you would say it — "finish the DSA assignment tomorrow
 * at 7pm for 2 hours #college !high". The shared parser (the exact same module
 * the server uses) extracts the date, time, duration, tags and priority, and the
 * confirmation step below lets you correct anything before it is saved.
 *
 * Nothing is created until you press Save, and the whole screen works offline:
 * the parse is local, the save is queued.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { ParsedTaskDraft } from '@jarvis/shared';
import { priorityColor } from '../components/tasks';
import {
  Badge,
  Button,
  Card,
  Chip,
  Field,
  Input,
  Row,
  Screen,
  Segmented,
  Stack,
  SwitchRow,
  Type,
} from '../components/ui';
import { useAuth } from '../lib/auth';
import { useProjects } from '../hooks/useLibrary';
import { describeFailure, parseTaskDraft, useTaskMutations } from '../hooks/useTasks';
import { useOfflineStatus } from '../lib/offline';
import { radius, spacing, usePalette } from '../lib/theme';

const EXAMPLES = [
  'Finish DSA assignment tomorrow at 7 PM',
  'Gym every weekday at 6am for 1 hour',
  'Pay the electricity bill friday !urgent @personal',
];

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export default function TaskNewScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { user, settings } = useAuth();
  const offline = useOfflineStatus();
  const { projects } = useProjects();
  const { create } = useTaskMutations();

  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>('medium');
  const [important, setImportant] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [dueTime, setDueTime] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [recurrenceKind, setRecurrenceKind] = useState<'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly'>('none');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const parsed: ParsedTaskDraft | null = useMemo(() => {
    if (!text.trim()) return null;
    return parseTaskDraft(text, user?.timezoneOffsetMinutes ?? 0);
  }, [text, user?.timezoneOffsetMinutes]);

  const applyParsed = (draft: ParsedTaskDraft) => {
    setTitle(draft.title);
    setPriority((draft.priority as (typeof PRIORITIES)[number]) ?? settings?.taskDefaults.priority ?? 'medium');
    setImportant(Boolean(draft.important));
    setUrgent(Boolean(draft.urgent));
    setDueDate(draft.dueDate ?? null);
    setDueTime(draft.dueTime ?? null);
    setMinutes(draft.estimatedMinutes ?? settings?.defaultTaskDurationMinutes ?? null);
    setProjectId(
      (draft.projectName ? projects.find((project) => project.name.toLowerCase() === draft.projectName!.toLowerCase())?.id : null) ??
        settings?.taskDefaults.projectId ??
        null,
    );
    setTags(draft.tags ?? []);
    setRecurrenceKind((draft.recurrenceKind as typeof recurrenceKind) ?? 'none');
    setConfirming(true);
  };

  const startConfirm = () => {
    // Defaults from Settings → Customize → Tasks seed the confirmation step.
    if (parsed && parsed.confidence > 0 && parsed.title) {
      applyParsed(parsed);
      return;
    }
    // Nothing recognised: use the user's task defaults so the confirmation step
    // still starts from their own preferences.
    setTitle(text.trim());
    setPriority(settings?.taskDefaults.priority ?? 'medium');
    setImportant(false);
    setUrgent(false);
    setDueDate(settings?.taskDefaults.dueToday ? todayKeyFor(0, user?.timezoneOffsetMinutes ?? 0) : null);
    setDueTime(null);
    setMinutes(settings?.taskDefaults.estimateMinutes ?? settings?.defaultTaskDurationMinutes ?? null);
    setProjectId(settings?.taskDefaults.projectId ?? null);
    setTags([]);
    setRecurrenceKind('none');
    setConfirming(true);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const recurrence =
        recurrenceKind === 'none'
          ? undefined
          : { kind: recurrenceKind, interval: 1, byWeekday: [], until: null, count: 0, maxOccurrences: null };
      const result = await create({
        title: title.trim(),
        priority,
        important,
        urgent,
        dueDate,
        dueTime,
        estimatedMinutes: minutes,
        projectId,
        tags,
        recurrence,
        planDate: dueDate,
      });
      setMessage(
        result.queued || offline.pending > 0
          ? 'Saved on this device. It will sync when you are back online.'
          : 'Task saved.',
      );
      setTimeout(() => router.back(), 550);
    } catch (error) {
      const failure = describeFailure(error);
      setMessage(failure.offline ? 'You are offline — we could not queue this task.' : failure.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Type variant="title" accessibilityRole="header">
          Quick capture
        </Type>
        <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
      </Row>

      {!confirming ? (
        <>
          <Field
            label="What needs doing?"
            hint={
              parsed && parsed.confidence > 0
                ? `Understood: ${[
                    parsed.title ? `“${parsed.title}”` : null,
                    parsed.dueDate ? `due ${parsed.dueDate}` : null,
                    parsed.dueTime ? `at ${parsed.dueTime}` : null,
                    parsed.estimatedMinutes ? `${parsed.estimatedMinutes} min` : null,
                    parsed.priority && parsed.priority !== 'medium' ? `${parsed.priority} priority` : null,
                    parsed.tags.length ? `#${parsed.tags.join(' #')}` : null,
                    parsed.projectName ? `@${parsed.projectName}` : null,
                    parsed.recurrenceKind ? `repeats ${parsed.recurrenceKind}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}`
                : 'Dates, times, durations, #tags, !priority and @project are understood.'
            }
          >
            <Input
              value={text}
              onChangeText={setText}
              placeholder="Finish DSA assignment tomorrow at 7 PM"
              multiline
              numberOfLines={3}
              style={{ minHeight: 88, textAlignVertical: 'top' }}
              autoFocus
              accessibilityLabel="Task description"
            />
          </Field>

          <Stack gap={spacing.sm}>
            <Type variant="label" color={palette.textMuted}>
              TRY ONE OF THESE
            </Type>
            {EXAMPLES.map((example) => (
              <Pressable
                key={example}
                onPress={() => setText(example)}
                accessibilityRole="button"
                accessibilityLabel={`Use example: ${example}`}
                style={{
                  padding: spacing.md,
                  borderRadius: radius.md,
                  backgroundColor: palette.surface,
                  borderWidth: 1,
                  borderColor: palette.border,
                  borderStyle: 'dashed',
                }}
              >
                <Type variant="caption" color={palette.textMuted}>
                  {example}
                </Type>
              </Pressable>
            ))}
          </Stack>

          <Button label="Continue" icon="arrow-forward" onPress={startConfirm} disabled={!text.trim()} full />
          <Button label="Enter details manually" variant="ghost" onPress={() => {
            setTitle(text.trim());
            setPriority(settings?.taskDefaults.priority ?? 'medium');
            setMinutes(settings?.taskDefaults.estimateMinutes ?? settings?.defaultTaskDurationMinutes ?? null);
            setConfirming(true);
          }} />
        </>
      ) : (
        <>
          <Card>
            <Stack gap={spacing.md}>
              <Row gap={spacing.sm}>
                <Ionicons name="sparkles" size={16} color={palette.primary} />
                <Type variant="caption" color={palette.primary} style={{ flex: 1 }}>
                  Check the details — everything here is editable.
                </Type>
              </Row>
              <Field label="Title">
                <Input value={title} onChangeText={setTitle} multiline />
              </Field>

              <Field label="Priority">
                <Row gap={spacing.sm} wrap>
                  {PRIORITIES.map((option) => (
                    <Chip
                      key={option}
                      label={option}
                      color={priorityColor(option, palette)}
                      selected={priority === option}
                      onPress={() => setPriority(option)}
                    />
                  ))}
                </Row>
              </Field>

              <Stack gap={spacing.xs}>
                <SwitchRow
                  label="Important"
                  description="It moves something you care about."
                  value={important}
                  onValueChange={setImportant}
                />
                <SwitchRow
                  label="Urgent"
                  description="It has a deadline or someone is waiting."
                  value={urgent}
                  onValueChange={setUrgent}
                />
              </Stack>

              <Field label="Due date" hint={dueDate ? undefined : 'Tap a quick option below.'}>
                <Row gap={spacing.sm} wrap>
                  <Chip label="None" selected={!dueDate} onPress={() => setDueDate(null)} />
                  <Chip
                    label="Today"
                    selected={Boolean(dueDate && dueDate === todayKeyFor(0, user?.timezoneOffsetMinutes ?? 0))}
                    onPress={() => setDueDate(todayKeyFor(0, user?.timezoneOffsetMinutes ?? 0))}
                  />
                  <Chip
                    label="Tomorrow"
                    selected={Boolean(dueDate && dueDate === todayKeyFor(1, user?.timezoneOffsetMinutes ?? 0))}
                    onPress={() => setDueDate(todayKeyFor(1, user?.timezoneOffsetMinutes ?? 0))}
                  />
                  <Chip
                    label="Next week"
                    selected={Boolean(dueDate && dueDate === todayKeyFor(7, user?.timezoneOffsetMinutes ?? 0))}
                    onPress={() => setDueDate(todayKeyFor(7, user?.timezoneOffsetMinutes ?? 0))}
                  />
                </Row>
              </Field>

              <Field label="Time (optional)">
                <Row gap={spacing.sm} wrap>
                  <Chip label="None" selected={!dueTime} onPress={() => setDueTime(null)} />
                  {['09:00', '12:00', '17:00', '19:00', '21:00'].map((option) => (
                    <Chip key={option} label={option} selected={dueTime === option} onPress={() => setDueTime(option)} />
                  ))}
                </Row>
              </Field>

              <Field label="Estimate">
                <Row gap={spacing.sm} wrap>
                  <Chip label="None" selected={!minutes} onPress={() => setMinutes(null)} />
                  {[15, 30, 45, 60, 90, 120].map((option) => (
                    <Chip
                      key={option}
                      label={option >= 60 ? `${option / 60}h` : `${option}m`}
                      selected={minutes === option}
                      onPress={() => setMinutes(option)}
                    />
                  ))}
                </Row>
              </Field>

              <Field label="Project">
                <Row gap={spacing.sm} wrap>
                  <Chip label="Inbox" selected={!projectId} onPress={() => setProjectId(null)} />
                  {projects.map((project) => (
                    <Chip
                      key={project.id}
                      label={project.name}
                      color={project.color}
                      selected={projectId === project.id}
                      onPress={() => setProjectId(project.id)}
                    />
                  ))}
                </Row>
              </Field>

              <Field label="Repeat">
                <Segmented
                  options={[
                    { value: 'none', label: 'Once' },
                    { value: 'daily', label: 'Daily' },
                    { value: 'weekdays', label: 'Weekdays' },
                    { value: 'weekly', label: 'Weekly' },
                    { value: 'monthly', label: 'Monthly' },
                  ]}
                  value={recurrenceKind}
                  onChange={setRecurrenceKind}
                />
              </Field>

              {tags.length > 0 ? (
                <Field label="Tags">
                  <Row gap={spacing.sm} wrap>
                    {tags.map((tag) => (
                      <Chip key={tag} label={`#${tag}`} selected onPress={() => setTags(tags.filter((item) => item !== tag))} />
                    ))}
                  </Row>
                </Field>
              ) : null}

              <Row gap={spacing.sm} wrap>
                {important ? <Badge label="Important" color={palette.primary} icon="star" /> : null}
                {urgent ? <Badge label="Urgent" color={palette.danger} icon="alert" /> : null}
                <Badge label={quadrantLabel(important, urgent)} color={palette.quadrant[quadrantKey(important, urgent)]} />
                {minutes ? <Badge label={`${minutes} min`} /> : null}
              </Row>
            </Stack>
          </Card>

          {message ? (
            <Card style={{ backgroundColor: palette.surfaceMuted }}>
              <Type variant="caption">{message}</Type>
            </Card>
          ) : null}

          <Row gap={spacing.sm}>
            <Button label="Back" variant="secondary" onPress={() => setConfirming(false)} />
            <Button label="Save task" icon="checkmark" onPress={save} loading={saving} disabled={title.trim().length === 0} />
          </Row>
        </>
      )}
    </Screen>
  );
}

function todayKeyFor(offsetDays: number, offsetMinutes: number): string {
  const now = Date.now() + offsetMinutes * 60_000 + offsetDays * 86_400_000;
  return new Date(now).toISOString().slice(0, 10);
}

function quadrantKey(important: boolean, urgent: boolean): 'do_now' | 'schedule' | 'delegate' | 'eliminate' {
  if (important && urgent) return 'do_now';
  if (important) return 'schedule';
  if (urgent) return 'delegate';
  return 'eliminate';
}

function quadrantLabel(important: boolean, urgent: boolean): string {
  const key = quadrantKey(important, urgent);
  return key === 'do_now' ? 'Do now' : key === 'schedule' ? 'Schedule' : key === 'delegate' ? 'Delegate' : 'Eliminate';
}
