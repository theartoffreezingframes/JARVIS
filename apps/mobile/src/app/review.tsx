/**
 * Daily review.
 *
 * Closes the loop: what happened today, what is left, what moved forward — then
 * rolls unfinished work forward and takes a reflection. Saving the review is
 * what marks the day as reviewed in the activity rollups.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ScoreCard } from '../components/analytics';
import { TaskRow, formatMinutes } from '../components/tasks';
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
  Stack,
  Type,
} from '../components/ui';
import { useDailyReview } from '../hooks/useDashboard';
import { useTaskMutations } from '../hooks/useTasks';
import { spacing, usePalette } from '../lib/theme';

const MOODS = ['😞', '😐', '🙂', '😄', '🤩'];

export default function ReviewScreen() {
  const { day } = useLocalSearchParams<{ day?: string }>();
  const palette = usePalette();
  const router = useRouter();
  const { day: review, target, tomorrow, save, isLoading, refetch, history } = useDailyReview(day ?? undefined);
  const { complete } = useTaskMutations();

  const [reflection, setReflection] = useState('');
  const [mood, setMood] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [rollover, setRollover] = useState<string[]>([]);
  const [topTaskId, setTopTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!review) return;
    setReflection(review.review?.reflection ?? '');
    setMood(review.review?.mood ?? null);
    setEnergy(review.review?.energy ?? null);
    setTopTaskId(review.tomorrowTopTaskId ?? null);
  }, [review?.dayKey, review?.review?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading && !review) {
    return (
      <Screen edges={['top']}>
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <LoadingBlock label="Loading your day" />
      </Screen>
    );
  }

  if (!review) {
    return (
      <Screen edges={['top']}>
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <EmptyState icon="journal-outline" title="Nothing to review" body="This day has no records yet." />
      </Screen>
    );
  }

  const summary = review.summary;
  const remaining = (review.tomorrow?.planned ?? []).concat(review.tomorrow?.suggestions ?? []);

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Chip label={target} color={palette.primary} />
      </Row>

      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          Daily review
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          Close the day honestly — the point is to plan better tomorrow, not to score points.
        </Type>
      </Stack>

      {message ? (
        <Card style={{ backgroundColor: palette.surfaceMuted }}>
          <Type variant="caption">{message}</Type>
        </Card>
      ) : null}

      <Card>
        <Stack gap={spacing.md}>
          <SectionHeader title="What happened" />
          <Row gap={spacing.lg} wrap>
            <Stack gap={2} style={{ flex: 1, minWidth: 90 }}>
              <Type variant="micro" color={palette.textMuted}>
                COMPLETED
              </Type>
              <Type variant="title">{review.tasks.completed}</Type>
            </Stack>
            <Stack gap={2} style={{ flex: 1, minWidth: 90 }}>
              <Type variant="micro" color={palette.textMuted}>
                REMAINING
              </Type>
              <Type variant="title">{review.tasks.remaining}</Type>
            </Stack>
            <Stack gap={2} style={{ flex: 1, minWidth: 90 }}>
              <Type variant="micro" color={palette.textMuted}>
                OVERDUE
              </Type>
              <Type variant="title" color={review.tasks.overdue > 0 ? palette.danger : undefined}>
                {review.tasks.overdue}
              </Type>
            </Stack>
            <Stack gap={2} style={{ flex: 1, minWidth: 90 }}>
              <Type variant="micro" color={palette.textMuted}>
                CREATED
              </Type>
              <Type variant="title">{review.tasks.created}</Type>
            </Stack>
          </Row>
          {summary ? (
            <Stack gap={6}>
              <Row justify="space-between">
                <Type variant="caption">Task completion</Type>
                <Type variant="caption" color={palette.textMuted}>
                  {summary.completionPercent}%
                </Type>
              </Row>
              <ProgressBar value={summary.completionPercent} />
            </Stack>
          ) : null}
          <Row gap={spacing.sm} wrap>
            <Badge label={`${formatMinutes(review.focusMinutes)} focused`} color={palette.primary} icon="timer" />
            <Badge
              label={`${review.habitSummary.completedToday}/${review.habitSummary.scheduledToday} habits`}
              color={palette.success}
              icon="repeat"
            />
            {review.activity.reviewed ? <Badge label="Reviewed" color={palette.info} icon="checkmark" /> : null}
          </Row>
        </Stack>
      </Card>

      {review.focusSessions.length > 0 ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Focus sessions" subtitle={`${review.focusSessions.length} recorded`} />
          <Card>
            <Stack gap={spacing.sm}>
              {review.focusSessions.map((session) => (
                <Row key={session.id} justify="space-between">
                  <Type variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                    {session.taskTitle ?? session.label ?? session.mode.replace('_', ' ')}
                  </Type>
                  <Type variant="caption" color={palette.textMuted}>
                    {formatMinutes(session.actualSeconds / 60)}
                  </Type>
                </Row>
              ))}
            </Stack>
          </Card>
        </Stack>
      ) : null}

      <Stack gap={spacing.sm}>
        <SectionHeader title="Habits" subtitle="A miss is information, not failure" />
        <Card>
          <Stack gap={spacing.sm}>
            {review.habits.length === 0 ? (
              <Type variant="caption" color={palette.textFaint}>
                No habits tracked yet.
              </Type>
            ) : (
              review.habits.map((habit) => (
                <Row key={habit.id} justify="space-between" align="center">
                  <Stack gap={2} style={{ flex: 1 }}>
                    <Type variant="bodyStrong">{habit.name}</Type>
                    <Type variant="caption" color={palette.textMuted}>
                      {habit.currentStreak}-day streak · {habit.completionRate}% completion
                    </Type>
                  </Stack>
                  <Type variant="caption" color={palette.textMuted}>
                    {habit.recentCompletions.includes(target) ? 'Done' : 'Missed'}
                  </Type>
                </Row>
              ))
            )}
          </Stack>
        </Card>
      </Stack>

      {review.score ? <ScoreCard score={review.score} /> : null}

      <Stack gap={spacing.sm}>
        <SectionHeader
          title="Reschedule what is left"
          subtitle={`Move unfinished work to ${tomorrow}`}
        />
        <Card>
          <Stack gap={spacing.sm}>
            {remaining.length === 0 ? (
              <Type variant="caption" color={palette.textFaint}>
                Nothing left to move. Clear plate.
              </Type>
            ) : (
              remaining.slice(0, 12).map((task) => {
                const selected = rollover.includes(task.id);
                return (
                  <Row key={task.id} gap={spacing.sm} align="center">
                    <View style={{ flex: 1 }}>
                      <TaskRow
                        task={task}
                        today={target}
                        dense
                        onPress={() => {
                          setRollover((current) =>
                            current.includes(task.id) ? current.filter((item) => item !== task.id) : [...current, task.id],
                          );
                        }}
                      />
                    </View>
                    <Chip
                      label={selected ? 'Moving' : 'Keep'}
                      small
                      color={selected ? palette.primary : undefined}
                      onPress={() =>
                        setRollover((current) =>
                          current.includes(task.id) ? current.filter((item) => item !== task.id) : [...current, task.id],
                        )
                      }
                    />
                  </Row>
                );
              })
            )}
            {remaining.length > 0 ? (
              <Button
                label={rollover.length > 0 ? `Move ${rollover.length} to ${tomorrow}` : 'Select tasks to move'}
                variant="secondary"
                disabled={rollover.length === 0}
                onPress={async () => {
                  setBusy(true);
                  try {
                    await save({ dayKey: target, rolloverTaskIds: rollover, rolloverTo: tomorrow });
                    setRollover([]);
                    setMessage(`Moved to ${tomorrow}.`);
                    void refetch();
                  } catch {
                    setMessage('Could not move them — you appear to be offline.');
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            ) : null}
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Plan tomorrow" subtitle="Pick the one thing that matters most" />
        <Card>
          <Stack gap={spacing.sm}>
            {(review.tomorrow?.planned ?? []).length === 0 ? (
              <Type variant="caption" color={palette.textFaint}>
                Tomorrow is empty. Add tasks or let the planner suggest a shape.
              </Type>
            ) : (
              (review.tomorrow?.planned ?? []).slice(0, 8).map((task) => (
                <Row key={task.id} gap={spacing.sm} align="center">
                  <View style={{ flex: 1 }}>
                    <TaskRow task={task} today={tomorrow} dense onPress={() => setTopTaskId(task.id)} />
                  </View>
                  <Chip
                    label={topTaskId === task.id ? 'Top task' : 'Set top'}
                    small
                    color={topTaskId === task.id ? palette.primary : undefined}
                    onPress={() => setTopTaskId(task.id)}
                  />
                </Row>
              ))
            )}
            <Button
              label="Open the planner for tomorrow"
              size="sm"
              variant="secondary"
              onPress={() => router.push(`/planner?day=${tomorrow}`)}
            />
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Reflection" />
        <Card>
          <Stack gap={spacing.md}>
            <Field label="How did the day feel?">
              <Row gap={spacing.sm} wrap>
                {MOODS.map((emoji, index) => (
                  <Chip
                    key={emoji}
                    label={emoji}
                    selected={mood === index + 1}
                    onPress={() => setMood(mood === index + 1 ? null : index + 1)}
                  />
                ))}
              </Row>
            </Field>
            <Field label="Energy (1–5)">
              <Row gap={spacing.sm} wrap>
                {[1, 2, 3, 4, 5].map((value) => (
                  <Chip
                    key={value}
                    label={String(value)}
                    selected={energy === value}
                    onPress={() => setEnergy(energy === value ? null : value)}
                  />
                ))}
              </Row>
            </Field>
            <Field label="What would make tomorrow better?">
              <Input
                value={reflection}
                onChangeText={setReflection}
                placeholder="Two lines is plenty — what worked, what to change."
                multiline
                style={{ minHeight: 100, textAlignVertical: 'top' }}
              />
            </Field>
            <Button
              label="Save review"
              icon="checkmark"
              loading={busy}
              onPress={async () => {
                setBusy(true);
                try {
                  await save({
                    dayKey: target,
                    reflection: reflection.trim() || null,
                    mood,
                    energy,
                    tomorrowTopTaskId: topTaskId,
                    rolloverTaskIds: rollover,
                    rolloverTo: tomorrow,
                  });
                  setRollover([]);
                  setMessage('Review saved. Tomorrow is planned.');
                  void refetch();
                } catch {
                  setMessage('Could not save the review — you appear to be offline.');
                } finally {
                  setBusy(false);
                }
              }}
            />
          </Stack>
        </Card>
      </Stack>

      {history.length > 0 ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Recent reviews" />
          {history.slice(0, 5).map((entry) => (
            <Card
              key={entry.dayKey}
              onPress={() => router.push(`/review?day=${entry.dayKey}`)}
              accessibilityLabel={`Open review for ${entry.dayKey}`}
            >
              <Row justify="space-between" align="center">
                <Stack gap={2} style={{ flex: 1 }}>
                  <Type variant="bodyStrong">{entry.dayKey}</Type>
                  <Type variant="caption" color={palette.textMuted} numberOfLines={1}>
                    {entry.review?.reflection ?? 'No reflection written'}
                  </Type>
                </Stack>
                <Row gap={spacing.sm}>
                  <Badge label={`${entry.tasks.completed} done`} color={palette.success} />
                  {entry.review?.mood ? <Type variant="body">{MOODS[entry.review.mood - 1]}</Type> : null}
                </Row>
              </Row>
            </Card>
          ))}
        </Stack>
      ) : null}

      <Stack gap={spacing.sm}>
        <SectionHeader title="Quick actions" />
        <Row gap={spacing.sm} wrap>
          <Button label="Analytics" size="sm" variant="secondary" icon="stats-chart-outline" onPress={() => router.push('/analytics')} />
          <Button label="Tomorrow's planner" size="sm" variant="secondary" icon="list" onPress={() => router.push(`/planner?day=${tomorrow}`)} />
          <Button
            label="Complete a task"
            size="sm"
            variant="ghost"
            icon="checkmark-circle-outline"
            onPress={async () => {
              const first = remaining[0];
              if (!first) return;
              await complete(first, true);
              void refetch();
            }}
          />
        </Row>
      </Stack>

      {review.activity ? (
        <Row gap={6}>
          <Ionicons name="information-circle-outline" size={14} color={palette.textFaint} />
          <Type variant="caption" color={palette.textFaint} style={{ flex: 1 }}>
            Reviewed days carry a small part of the productivity score: reflection is part of the system, not an extra.
          </Type>
        </Row>
      ) : null}
    </Screen>
  );
}
