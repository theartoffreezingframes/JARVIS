/**
 * Habits.
 *
 * Real completion tracking: a habit is completed for a specific day, streaks are
 * derived server-side from those records, and the heat map is drawn from the
 * same data. Nothing here is decorative.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import type { Habit } from '@jarvis/shared';
import { HeatmapGrid } from '../components/analytics';
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
  ProgressBar,
  Row,
  Screen,
  SectionHeader,
  Stack,
  Sheet,
  Type,
  type IconName,
} from '../components/ui';
import { useAuth } from '../lib/auth';
import { useHabitHeatmap, useHabitMutations, useHabits, type HabitDraft } from '../hooks/useHabits';
import { radius, spacing, usePalette } from '../lib/theme';

const COLORS = ['#4F46E5', '#0E9F6E', '#D97706', '#D92D20', '#0E7490', '#7C3AED'];
const ICONS: IconName[] = ['walk', 'book', 'barbell', 'water', 'moon', 'code-slash'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function HabitsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { settings } = useAuth();
  const { habits, today, isLoading, error, refetch } = useHabits(true);
  const mutations = useHabitMutations();
  const [editing, setEditing] = useState<Habit | null>(null);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const active = habits.filter((habit) => !habit.archived);
  const archived = habits.filter((habit) => habit.archived);

  const completedToday = active.filter((habit) => habit.completedToday).length;

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Button label="New habit" icon="add" size="sm" onPress={() => setCreating(true)} />
      </Row>

      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          Habits
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          {active.length > 0
            ? `${completedToday} of ${active.length} done today · consistency, not perfection`
            : 'Small, repeatable actions — the compounding kind.'}
        </Type>
      </Stack>

      {isLoading && habits.length === 0 ? <LoadingBlock label="Loading habits" /> : null}

      {error && !isLoading && habits.length === 0 ? (
        <ErrorBlock message="Your habits could not be loaded." onRetry={() => void refetch()} />
      ) : null}

      {active.length === 0 && !isLoading && !error ? (
        <EmptyState
          icon="repeat"
          title="Build your first habit"
          body="Habits are tracked by day, so streaks, completion rates and the heat map are all real numbers."
          actionLabel="Create a habit"
          onAction={() => setCreating(true)}
        />
      ) : null}

      {active.map((habit) => (
        <HabitCard
          key={habit.id}
          habit={habit}
          today={today}
          expanded={expanded === habit.id}
          onToggleExpand={() => setExpanded(expanded === habit.id ? null : habit.id)}
          onToggleToday={() => mutations.toggle(habit, today, !habit.completedToday)}
          onEdit={() => setEditing(habit)}
          onDelete={() =>
            Alert.alert('Delete habit?', 'Its completion history will be removed too.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => void mutations.remove(habit.id) },
            ])
          }
          onArchive={() => void mutations.update(habit.id, { archived: !habit.archived })}
          showHeatmap={settings?.habits.showHeatmap ?? true}
          showStreaks={settings?.habits.showStreaks ?? true}
        />
      ))}

      {archived.length > 0 ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Archived" subtitle={`${archived.length} habits`} />
          {archived.map((habit) => (
            <Card key={habit.id}>
              <Row justify="space-between" align="center">
                <Stack gap={2} style={{ flex: 1 }}>
                  <Type variant="bodyStrong">{habit.name}</Type>
                  <Type variant="caption" color={palette.textMuted}>
                    {habit.completionRate}% completion · best {habit.bestStreak} days
                  </Type>
                </Stack>
                <Button label="Restore" size="sm" variant="secondary" onPress={() => void mutations.update(habit.id, { archived: false })} />
              </Row>
            </Card>
          ))}
        </Stack>
      ) : null}

      <HabitSheet
        visible={creating || Boolean(editing)}
        habit={editing}
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

function HabitCard({
  habit,
  today,
  expanded,
  onToggleExpand,
  onToggleToday,
  onEdit,
  onDelete,
  onArchive,
  showHeatmap,
  showStreaks,
}: {
  habit: Habit;
  today: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleToday: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onArchive: () => void;
  showHeatmap: boolean;
  showStreaks: boolean;
}) {
  const palette = usePalette();
  const heatQuery = useHabitHeatmap(expanded ? habit.id : null, 120);
  const heatmap = heatQuery.data;

  return (
    <Card>
      <Stack gap={spacing.md}>
        <Row gap={spacing.md} align="flex-start">
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: radius.md,
              backgroundColor: `${habit.color}20`,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={(habit.icon as IconName) ?? 'repeat'} size={20} color={habit.color} />
          </View>
          <Stack gap={3} style={{ flex: 1 }}>
            <Type variant="bodyStrong">{habit.name}</Type>
            <Type variant="caption" color={palette.textMuted} numberOfLines={2}>
              {habit.description ?? frequencyLabel(habit)}
            </Type>
            {showStreaks ? (
              <Row gap={spacing.sm} wrap>
                <Badge label={`${habit.currentStreak} day streak`} color={habit.currentStreak > 0 ? palette.success : palette.textMuted} icon="flame" />
                <Badge label={`best ${habit.bestStreak}`} />
                <Badge label={`${habit.completionRate}% completion`} />
              </Row>
            ) : null}
          </Stack>
          <Pressable
            onPress={onToggleToday}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: habit.completedToday }}
            accessibilityLabel={`${habit.completedToday ? 'Undo' : 'Complete'} ${habit.name} for today`}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons
              name={habit.completedToday ? 'checkmark-circle' : 'ellipse-outline'}
              size={30}
              color={habit.completedToday ? palette.success : palette.borderStrong}
            />
          </Pressable>
        </Row>

        <Row gap={spacing.sm} wrap>
          {WEEKDAYS.map((day, index) => {
            const scheduled = habit.frequency === 'daily' || (habit.frequency === 'weekdays' && index > 0 && index < 6) || habit.scheduleDays.includes(index);
            const done = habit.recentCompletions.includes(dayKeyBack(today, daysBackForWeekday(today, index)));
            return (
              <View key={day} style={{ alignItems: 'center', gap: 4 }}>
                <Type variant="micro" color={palette.textFaint}>
                  {day[0]}
                </Type>
                <View
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    backgroundColor: done ? palette.success : scheduled ? palette.surfaceMuted : 'transparent',
                    borderWidth: scheduled ? 0 : 1,
                    borderColor: palette.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {done ? <Ionicons name="checkmark" size={14} color={palette.onPrimary} /> : null}
                </View>
              </View>
            );
          })}
        </Row>

        <ProgressBar value={habit.completionRate} color={habit.color} />

        <Row gap={spacing.sm} wrap>
          <Button label={expanded ? 'Hide history' : 'History & heat map'} size="sm" variant="secondary" onPress={onToggleExpand} />
          <Button label="Edit" size="sm" variant="ghost" onPress={onEdit} />
          <Button label={habit.archived ? 'Restore' : 'Archive'} size="sm" variant="ghost" onPress={onArchive} />
          <Button label="Delete" size="sm" variant="ghost" onPress={onDelete} />
        </Row>

        {expanded && showHeatmap ? (
          <Stack gap={spacing.sm}>
            {heatmap ? (
              <>
                <HeatmapGrid
                  cells={heatmap.cells.map((cell) => ({
                    dayKey: cell.dayKey,
                    value: cell.value,
                    level: cell.value > 0 ? 4 : 0,
                    tasksCompleted: 0,
                    tasksCreated: 0,
                    focusMinutes: 0,
                    habitsCompleted: cell.value,
                    plannedTaskCount: 0,
                    productivityScore: 0,
                  }))}
                />
                <Type variant="caption" color={palette.textMuted}>
                  {heatmap.total} completions in the last {heatmap.cells.length} days · {heatmap.activeDays} active days
                </Type>
              </>
            ) : (
              <LoadingBlock label="Loading history" />
            )}
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}

function HabitSheet({
  visible,
  habit,
  onClose,
  onSave,
}: {
  visible: boolean;
  habit: Habit | null;
  onClose: () => void;
  onSave: (draft: HabitDraft) => Promise<void>;
}) {
  const palette = usePalette();
  const [name, setName] = useState(habit?.name ?? '');
  const [description, setDescription] = useState(habit?.description ?? '');
  const [frequency, setFrequency] = useState<'daily' | 'weekdays' | 'weekly' | 'custom'>(habit?.frequency ?? 'daily');
  const [scheduleDays, setScheduleDays] = useState<number[]>(habit?.scheduleDays ?? []);
  const [color, setColor] = useState(habit?.color ?? COLORS[0]);
  const [icon, setIcon] = useState<string>(habit?.icon ?? 'walk');
  const [reminderTime, setReminderTime] = useState<string | null>(habit?.reminderTime ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the fields whenever the sheet opens for a different habit.
  const key = habit?.id ?? 'new';
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setName(habit?.name ?? '');
    setDescription(habit?.description ?? '');
    setFrequency(habit?.frequency ?? 'daily');
    setScheduleDays(habit?.scheduleDays ?? []);
    setColor(habit?.color ?? COLORS[0]);
    setIcon(habit?.icon ?? 'walk');
    setReminderTime(habit?.reminderTime ?? null);
  }

  const submit = async () => {
    if (!name.trim()) {
      setError('Give the habit a name');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || null,
        frequency,
        scheduleDays: frequency === 'custom' ? scheduleDays : frequency === 'weekdays' ? [1, 2, 3, 4, 5] : [],
        color,
        icon,
        reminderTime,
      });
      setName('');
      setDescription('');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the habit');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={habit ? 'Edit habit' : 'New habit'}>
      <Field label="Name">
        <Input value={name} onChangeText={setName} placeholder="Morning walk" />
      </Field>
      <Field label="Why it matters (optional)">
        <Input
          value={description}
          onChangeText={setDescription}
          placeholder="Thirty minutes outside before the day starts"
          multiline
        />
      </Field>
      <Field label="Frequency">
        <Row gap={spacing.sm} wrap>
          {(['daily', 'weekdays', 'weekly', 'custom'] as const).map((option) => (
            <Chip key={option} label={option} selected={frequency === option} onPress={() => setFrequency(option)} />
          ))}
        </Row>
      </Field>
      {frequency === 'custom' ? (
        <Field label="Days">
          <Row gap={6} wrap>
            {WEEKDAYS.map((day, index) => (
              <Chip
                key={day}
                label={day}
                small
                selected={scheduleDays.includes(index)}
                onPress={() =>
                  setScheduleDays((current) =>
                    current.includes(index) ? current.filter((item) => item !== index) : [...current, index],
                  )
                }
              />
            ))}
          </Row>
        </Field>
      ) : null}
      <Field label="Reminder">
        <Row gap={spacing.sm} wrap>
          <Chip label="None" selected={!reminderTime} onPress={() => setReminderTime(null)} />
          {['06:30', '08:00', '12:30', '18:00', '21:30'].map((time) => (
            <Chip key={time} label={time} selected={reminderTime === time} onPress={() => setReminderTime(time)} />
          ))}
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
      <Field label="Icon">
        <Row gap={spacing.sm} wrap>
          {ICONS.map((option) => (
            <Pressable
              key={option}
              onPress={() => setIcon(option)}
              accessibilityRole="button"
              accessibilityLabel={`Icon ${option}`}
              accessibilityState={{ selected: icon === option }}
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: icon === option ? palette.primaryMuted : palette.surfaceMuted,
              }}
            >
              <Ionicons name={option} size={20} color={icon === option ? palette.primary : palette.textMuted} />
            </Pressable>
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
        <Button label={habit ? 'Save habit' : 'Create habit'} onPress={submit} loading={busy} />
      </Row>
    </Sheet>
  );
}

function frequencyLabel(habit: Habit): string {
  if (habit.frequency === 'daily') return 'Every day';
  if (habit.frequency === 'weekdays') return 'Weekdays';
  if (habit.frequency === 'weekly') return 'Every week';
  return `Custom: ${habit.scheduleDays.map((day) => WEEKDAYS[day]).join(', ') || 'no days set'}`;
}

function daysBackForWeekday(today: string, weekday: number): number {
  const current = new Date(`${today}T00:00:00Z`).getUTCDay();
  const diff = (current - weekday + 7) % 7;
  return diff;
}

function dayKeyBack(today: string, days: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}
