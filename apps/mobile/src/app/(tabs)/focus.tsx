/**
 * Focus.
 *
 * A real pomodoro: the countdown is derived from timestamps (see lib/timer.ts),
 * sessions are recorded on the server, and the time actually spent is written
 * back when a block ends — including when it ended while the app was closed.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { ScoreCard } from '../../components/analytics';
import { TaskRow, formatMinutes } from '../../components/tasks';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  Input,
  Row,
  Screen,
  SectionHeader,
  Segmented,
  Stack,
  Type,
} from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useDashboard } from '../../hooks/useDashboard';
import { useFocusPresets, useFocusSessions, useFocusStats } from '../../hooks/useFocus';
import { useTasks } from '../../hooks/useTasks';
import {
  configureFocusTimer,
  formatDuration,
  pauseFocus,
  remainingMs,
  resetFocus,
  resumeFocus,
  skipPhase,
  startBreak,
  startFocus,
  stopFocus,
  useFocusTimerState,
} from '../../lib/timer';
import { radius, spacing, usePalette } from '../../lib/theme';

export default function FocusScreen() {
  const palette = usePalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ taskId?: string }>();
  const { settings, user } = useAuth();
  const timer = useFocusTimerState();
  const { stats } = useFocusStats();
  const { presets } = useFocusPresets();
  const { sessions } = useFocusSessions({ limit: 6 });
  const { dashboard } = useDashboard();
  const { tasks } = useTasks({ view: 'today', limit: 50 });

  const [customMinutes, setCustomMinutes] = useState(25);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(params.taskId ?? null);
  const [deepWork, setDeepWork] = useState(false);

  useEffect(() => {
    if (params.taskId) setSelectedTaskId(params.taskId);
  }, [params.taskId]);

  useEffect(() => {
    configureFocusTimer({
      focusMinutes: settings?.pomodoroFocusMinutes ?? 25,
      shortBreakMinutes: settings?.pomodoroShortBreakMinutes ?? 5,
      longBreakMinutes: settings?.pomodoroLongBreakMinutes ?? 15,
      sessionsBeforeLongBreak: settings?.pomodoroSessionsBeforeLongBreak ?? 4,
      autoStartBreaks: settings?.autoStartBreaks ?? true,
      autoStartNextSession: settings?.autoStartNextSession ?? false,
      offsetMinutes: user?.timezoneOffsetMinutes ?? 0,
      haptics: settings?.focus?.haptics ?? true,
      sound: settings?.focus?.sound ?? false,
    });
  }, [settings, user?.timezoneOffsetMinutes]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );

  const isRunning = timer.running;
  const isPaused = !timer.running && timer.pausedRemainingMs !== null && timer.pausedRemainingMs > 0;
  const isIdle = !isRunning && !isPaused;
  const remaining = remainingMs(timer);
  const plannedMs = timer.phasePlannedSeconds * 1000;
  const progress = plannedMs > 0 ? 1 - remaining / plannedMs : 0;
  const phaseLabel = timer.phase === 'focus' ? (timer.mode === 'deep_work' ? 'Deep work' : 'Focus') : timer.phase === 'long_break' ? 'Long break' : 'Short break';

  const begin = async (minutes: number, mode: 'pomodoro' | 'custom' | 'deep_work') => {
    await startFocus({
      minutes,
      mode,
      taskId: selectedTaskId,
      taskTitle: selectedTask?.title ?? null,
      label: selectedTask?.title ?? (mode === 'deep_work' ? 'Deep work' : null),
    });
  };

  const size = 264;
  const stroke = 12;
  const radiusValue = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radiusValue;

  return (
    <Screen>
      <Row justify="space-between" align="center">
        <Stack gap={2}>
          <Type variant="title" accessibilityRole="header">
            Focus
          </Type>
          <Type variant="caption" color={palette.textMuted}>
            {stats
              ? `${formatMinutes(stats.todayMinutes)} today · ${stats.sessionsToday} sessions · ${stats.streakDays}-day streak`
              : 'Timer, sessions and history'}
          </Type>
        </Stack>
        <Chip
          label={timer.completedRounds > 0 ? `Round ${timer.completedRounds + 1}` : 'Round 1'}
          color={palette.primary}
        />
      </Row>

      <Card style={{ alignItems: 'center', gap: spacing.md }}>
        <Row gap={spacing.sm}>
          <Badge
            label={phaseLabel.toUpperCase()}
            color={timer.phase === 'focus' ? palette.primary : palette.success}
            icon={timer.phase === 'focus' ? 'flash' : 'cafe'}
          />
          {selectedTask ? <Badge label={selectedTask.title} color={palette.textMuted} icon="link" /> : null}
          {isPaused ? <Badge label="Paused" color={palette.warning} icon="pause" /> : null}
        </Row>

        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={size} height={size} style={{ position: 'absolute' }}>
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radiusValue}
              stroke={palette.surfaceMuted}
              strokeWidth={stroke}
              fill="none"
            />
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radiusValue}
              stroke={timer.phase === 'focus' ? palette.primary : palette.success}
              strokeWidth={stroke}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${circumference} ${circumference}`}
              strokeDashoffset={circumference * (1 - Math.max(0, Math.min(1, progress)))}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          </Svg>
          <Stack gap={2} style={{ alignItems: 'center' }}>
            <Type variant="display" style={{ fontSize: 56, lineHeight: 62 }} accessibilityRole="header">
              {formatDuration(remaining)}
            </Type>
            <Type variant="caption" color={palette.textMuted}>
              {isIdle
                ? `${customMinutes} minute session ready`
                : isPaused
                  ? 'Paused — resume when you are ready'
                  : `${Math.round(progress * 100)}% of this block`}
            </Type>
          </Stack>
        </View>

        <Row gap={spacing.sm} justify="center" wrap>
          {isIdle ? (
            <>
              <Button
                label={`Start ${customMinutes} min`}
                icon="play"
                onPress={() => begin(deepWork ? Math.max(45, customMinutes) : customMinutes, deepWork ? 'deep_work' : 'pomodoro')}
              />
              <Button label="Start a break" icon="cafe-outline" variant="secondary" onPress={() => startBreak(false)} />
            </>
          ) : (
            <>
              {isRunning ? (
                <Button label="Pause" icon="pause" onPress={pauseFocus} />
              ) : (
                <Button label="Resume" icon="play" onPress={resumeFocus} />
              )}
              <Button label="Skip" icon="play-skip-forward" variant="secondary" onPress={() => void skipPhase()} />
              <Button label="Stop" icon="stop" variant="secondary" onPress={() => void stopFocus()} />
            </>
          )}
          <Button label="Reset" icon="refresh" variant="ghost" onPress={() => void resetFocus()} />
        </Row>
      </Card>

      {isIdle ? (
        <>
          <Stack gap={spacing.sm}>
            <SectionHeader title="Session length" subtitle="Saved presets plus anything you like." />
            <Row gap={spacing.sm} wrap>
              {presets.map((preset) => (
                <Chip
                  key={preset.id}
                  label={`${preset.label} · ${preset.focusMinutes}m`}
                  selected={customMinutes === preset.focusMinutes}
                  onPress={() => {
                    setCustomMinutes(preset.focusMinutes);
                    setDeepWork(preset.mode === 'deep_work');
                  }}
                />
              ))}
            </Row>
            <Row gap={spacing.sm} wrap>
              {[15, 25, 30, 45, 60, 90].map((minutes) => (
                <Chip
                  key={minutes}
                  label={`${minutes}m`}
                  selected={customMinutes === minutes}
                  onPress={() => {
                    setCustomMinutes(minutes);
                    setDeepWork(false);
                  }}
                />
              ))}
            </Row>
            <Row gap={spacing.sm}>
              <View style={{ flex: 1 }}>
                <Input
                  value={String(customMinutes)}
                  onChangeText={(value) => setCustomMinutes(Math.max(1, Math.min(180, Number(value.replace(/\D/g, '')) || 1)))}
                  keyboardType="number-pad"
                  accessibilityLabel="Custom session length in minutes"
                />
              </View>
              <Button
                label={deepWork ? 'Deep work' : 'Standard'}
                variant="secondary"
                icon="flash-outline"
                onPress={() => setDeepWork((value) => !value)}
              />
            </Row>
          </Stack>

          <Stack gap={spacing.sm}>
            <SectionHeader title="Attach a task" subtitle="Focus time is credited to the task you pick." />
            {tasks.length === 0 ? (
              <Type variant="caption" color={palette.textFaint}>
                No tasks planned today — you can still focus, the session will just be unlabelled.
              </Type>
            ) : (
              <Card style={{ paddingVertical: spacing.sm }}>
                {tasks.slice(0, 6).map((task, index) => (
                  <View key={task.id}>
                    {index > 0 ? <View style={{ height: 1, backgroundColor: palette.border, marginLeft: 40 }} /> : null}
                    <TaskRow
                      task={task}
                      today={dashboard?.today ?? ''}
                      onPress={() => setSelectedTaskId(selectedTaskId === task.id ? null : task.id)}
                      trailing={
                        selectedTaskId === task.id ? (
                          <Ionicons name="radio-button-on" size={20} color={palette.primary} />
                        ) : (
                          <Ionicons name="ellipse-outline" size={20} color={palette.borderStrong} />
                        )
                      }
                    />
                  </View>
                ))}
              </Card>
            )}
          </Stack>
        </>
      ) : null}

      <Stack gap={spacing.sm}>
        <SectionHeader title="Today" subtitle={stats ? `${formatMinutes(stats.todayMinutes)} focused` : undefined} />
        <Card>
          <Row gap={spacing.lg}>
            <Stack gap={2} style={{ flex: 1 }}>
              <Type variant="micro" color={palette.textMuted}>
                SESSIONS
              </Type>
              <Type variant="title">{stats?.sessionsToday ?? 0}</Type>
            </Stack>
            <Stack gap={2} style={{ flex: 1 }}>
              <Type variant="micro" color={palette.textMuted}>
                THIS WEEK
              </Type>
              <Type variant="title">{formatMinutes(stats?.weekMinutes ?? 0)}</Type>
            </Stack>
            <Stack gap={2} style={{ flex: 1 }}>
              <Type variant="micro" color={palette.textMuted}>
                AVERAGE
              </Type>
              <Type variant="title">{formatMinutes(stats?.averageSessionMinutes ?? 0)}</Type>
            </Stack>
          </Row>
        </Card>
        {dashboard?.score ? <ScoreCard score={dashboard.score} /> : null}
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Recent sessions" action="Analytics" onAction={() => router.push('/analytics')} />
        {sessions.length === 0 ? (
          <EmptyState
            icon="timer-outline"
            title="No sessions yet"
            body="Finish a focus block and it will appear here with the exact time you spent."
          />
        ) : (
          sessions.map((session) => (
            <Card key={session.id}>
              <Row justify="space-between" align="center">
                <Stack gap={2} style={{ flex: 1 }}>
                  <Type variant="bodyStrong" numberOfLines={1}>
                    {session.taskTitle ?? session.label ?? modeLabel(session.mode)}
                  </Type>
                  <Type variant="caption" color={palette.textMuted}>
                    {new Date(session.startedAt).toLocaleString()} · {session.mode.replace('_', ' ')}
                  </Type>
                </Stack>
                <Stack gap={2} style={{ alignItems: 'flex-end' }}>
                  <Type variant="bodyStrong">{formatMinutes(session.actualSeconds / 60)}</Type>
                  <Badge
                    label={session.completed ? 'Completed' : 'Stopped early'}
                    color={session.completed ? palette.success : palette.warning}
                  />
                </Stack>
              </Row>
            </Card>
          ))
        )}
      </Stack>

      {settings ? null : (
        <EmptyState
          icon="cloud-offline-outline"
          title="Settings unavailable"
          body="Session lengths come from your account settings."
        />
      )}
    </Screen>
  );
}

function modeLabel(mode: string): string {
  return mode === 'deep_work' ? 'Deep work' : mode === 'custom' ? 'Custom session' : 'Pomodoro';
}
