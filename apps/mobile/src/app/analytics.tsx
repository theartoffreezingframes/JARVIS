/**
 * Analytics.
 *
 * Every number is computed server-side from stored records: completions, focus
 * sessions, habit completions and planning adherence. Tapping a heat-map day
 * opens that day's real underlying statistics.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { HeatmapCell, HeatmapMetric } from '@jarvis/shared';
import { DistributionBar, HeatmapGrid, MiniBars, ScoreCard, TrendPill } from '../components/analytics';
import { formatMinutes } from '../components/tasks';
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
  Segmented,
  Stack,
  Type,
} from '../components/ui';
import { useAnalytics, useDashboard, useHeatmap } from '../hooks/useDashboard';
import { useFocusStats } from '../hooks/useFocus';
import { usePalette, spacing } from '../lib/theme';

const METRICS: Array<{ value: HeatmapMetric; label: string }> = [
  { value: 'tasks_completed', label: 'Tasks' },
  { value: 'focus', label: 'Focus' },
  { value: 'habits', label: 'Habits' },
  { value: 'productivity', label: 'Productivity' },
  { value: 'tasks_created', label: 'Created' },
];

export default function AnalyticsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const [range, setRange] = useState<'week' | 'month' | 'quarter' | 'year'>('week');
  const [metric, setMetric] = useState<HeatmapMetric>('tasks_completed');
  const [heatRange, setHeatRange] = useState<'week' | 'month' | 'year'>('month');
  const [selectedDay, setSelectedDay] = useState<HeatmapCell | null>(null);

  const { analytics, isLoading, error, refetch } = useAnalytics(range);
  const { heatmap } = useHeatmap(metric, heatRange);
  const { stats } = useFocusStats();
  const { dashboard } = useDashboard();

  if (isLoading && !analytics) {
    return (
      <Screen edges={['top']}>
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <LoadingBlock label="Crunching numbers" />
      </Screen>
    );
  }

  if (error && !analytics) {
    return (
      <Screen edges={['top']}>
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <ErrorBlock message="Analytics could not be loaded." onRetry={() => void refetch()} />
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Chip label={analytics?.range.label ?? 'This period'} color={palette.primary} />
      </Row>

      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          Analytics
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          Calculated from your own records — never estimated.
        </Type>
      </Stack>

      <Segmented
        options={[
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'quarter', label: 'Quarter' },
          { value: 'year', label: 'Year' },
        ]}
        value={range}
        onChange={setRange}
      />

      {analytics ? (
        <>
          <Card>
            <Stack gap={spacing.md}>
              <SectionHeader title="Tasks" subtitle={analytics.range.label} />
              <Row gap={spacing.lg}>
                <Stack gap={2} style={{ flex: 1 }}>
                  <Type variant="micro" color={palette.textMuted}>
                    COMPLETED
                  </Type>
                  <Type variant="title">{analytics.tasks.completed}</Type>
                </Stack>
                <Stack gap={2} style={{ flex: 1 }}>
                  <Type variant="micro" color={palette.textMuted}>
                    CREATED
                  </Type>
                  <Type variant="title">{analytics.tasks.created}</Type>
                </Stack>
                <Stack gap={2} style={{ flex: 1 }}>
                  <Type variant="micro" color={palette.textMuted}>
                    OPEN
                  </Type>
                  <Type variant="title">{analytics.tasks.open}</Type>
                </Stack>
                <Stack gap={2} style={{ flex: 1 }}>
                  <Type variant="micro" color={palette.textMuted}>
                    OVERDUE
                  </Type>
                  <Type variant="title" color={analytics.tasks.overdue > 0 ? palette.danger : undefined}>
                    {analytics.tasks.overdue}
                  </Type>
                </Stack>
              </Row>
              <Stack gap={6}>
                <Row justify="space-between">
                  <Type variant="caption">Completion rate</Type>
                  <Type variant="caption" color={palette.textMuted}>
                    {analytics.tasks.completionRate}%
                  </Type>
                </Row>
                <ProgressBar value={analytics.tasks.completionRate} />
              </Stack>
              <Row justify="space-between">
                <Type variant="caption">Average time to complete</Type>
                <Type variant="caption" color={palette.textMuted}>
                  {analytics.tasks.averageCompletionHours}h
                </Type>
              </Row>
              <TrendPill
                direction={analytics.trends.completion.direction}
                changePercent={analytics.trends.completion.changePercent}
                label="completion"
              />
            </Stack>
          </Card>

          <Card>
            <Stack gap={spacing.md}>
              <SectionHeader title="Eisenhower distribution" subtitle="Where your open work is sitting" />
              <DistributionBar
                segments={[
                  { label: 'Do now', value: analytics.tasks.byQuadrant.do_now, color: palette.quadrant.do_now },
                  { label: 'Schedule', value: analytics.tasks.byQuadrant.schedule, color: palette.quadrant.schedule },
                  { label: 'Delegate', value: analytics.tasks.byQuadrant.delegate, color: palette.quadrant.delegate },
                  { label: 'Eliminate', value: analytics.tasks.byQuadrant.eliminate, color: palette.quadrant.eliminate },
                ]}
              />
              <Type variant="caption" color={palette.textFaint}>
                A healthy profile keeps “Do now” small and “Schedule” full — that is where the compounding work lives.
              </Type>
            </Stack>
          </Card>

          <Card>
            <Stack gap={spacing.md}>
              <SectionHeader title="Focus" subtitle={stats ? `${formatMinutes(stats.totalMinutes)} all time` : undefined} />
              <Row gap={spacing.lg}>
                <Stack gap={2} style={{ flex: 1 }}>
                  <Type variant="micro" color={palette.textMuted}>
                    TOTAL MINUTES
                  </Type>
                  <Type variant="title">{analytics.focus.totalMinutes}</Type>
                </Stack>
                <Stack gap={2} style={{ flex: 1 }}>
                  <Type variant="micro" color={palette.textMuted}>
                    SESSIONS
                  </Type>
                  <Type variant="title">{analytics.focus.sessionsWeek + analytics.focus.sessionsToday}</Type>
                </Stack>
                <Stack gap={2} style={{ flex: 1 }}>
                  <Type variant="micro" color={palette.textMuted}>
                    AVG LENGTH
                  </Type>
                  <Type variant="title">{formatMinutes(analytics.focus.averageSessionMinutes)}</Type>
                </Stack>
              </Row>
              {stats && stats.dailyMinutes.length > 1 ? (
                <MiniBars
                  data={stats.dailyMinutes.slice(-14).map((day) => ({ label: day.dayKey.slice(5), value: day.minutes }))}
                  formatValue={(value) => `${value} min`}
                />
              ) : null}
              <TrendPill direction={analytics.trends.focus.direction} changePercent={analytics.trends.focus.changePercent} label="focus time" />
              <Row gap={spacing.sm} wrap>
                <Badge label={`${analytics.weeklyComparison.thisWeekFocus} min this week`} color={palette.primary} />
                <Badge label={`${analytics.weeklyComparison.lastWeekFocus} min last week`} />
              </Row>
            </Stack>
          </Card>

          <Card>
            <Stack gap={spacing.md}>
              <SectionHeader title="Habits" />
              <Row gap={spacing.lg}>
                <Stack gap={2} style={{ flex: 1 }}>
                  <Type variant="micro" color={palette.textMuted}>
                    COMPLETION
                  </Type>
                  <Type variant="title">{analytics.habits.completionRate}%</Type>
                </Stack>
                <Stack gap={2} style={{ flex: 1 }}>
                  <Type variant="micro" color={palette.textMuted}>
                    ACTIVE
                  </Type>
                  <Type variant="title">{analytics.habits.activeHabits}</Type>
                </Stack>
                <Stack gap={2} style={{ flex: 1 }}>
                  <Type variant="micro" color={palette.textMuted}>
                    BEST STREAK
                  </Type>
                  <Type variant="title">{analytics.habits.bestStreak}</Type>
                </Stack>
              </Row>
            </Stack>
          </Card>

          <Card>
            <Stack gap={spacing.md}>
              <SectionHeader title="Planning" subtitle="Did the plan match reality?" />
              <Row gap={spacing.lg}>
                <Stack gap={2} style={{ flex: 1 }}>
                  <Type variant="micro" color={palette.textMuted}>
                    PLANNED
                  </Type>
                  <Type variant="title">{analytics.planning.planned}</Type>
                </Stack>
                <Stack gap={2} style={{ flex: 1 }}>
                  <Type variant="micro" color={palette.textMuted}>
                    COMPLETED
                  </Type>
                  <Type variant="title">{analytics.planning.completedPlanned}</Type>
                </Stack>
                <Stack gap={2} style={{ flex: 1 }}>
                  <Type variant="micro" color={palette.textMuted}>
                    RESCHEDULED
                  </Type>
                  <Type variant="title">{analytics.planning.rescheduled}</Type>
                </Stack>
              </Row>
              <ProgressBar value={analytics.planning.adherencePercent} />
              <Type variant="caption" color={palette.textMuted}>
                {analytics.planning.adherencePercent}% plan adherence
              </Type>
            </Stack>
          </Card>

          <Card>
            <Stack gap={spacing.md}>
              <SectionHeader title="Daily activity" subtitle="Tasks completed and focus minutes" />
              <MiniBars
                data={analytics.daily.map((day) => ({ label: day.dayKey.slice(5), value: day.tasksCompleted }))}
                formatValue={(value) => `${value} tasks`}
              />
              <Type variant="caption" color={palette.textFaint}>
                Activity streak: {analytics.activityStreak} day{analytics.activityStreak === 1 ? '' : 's'} with something
                completed.
              </Type>
            </Stack>
          </Card>

          {analytics.insights.length > 0 ? (
            <Card>
              <Stack gap={spacing.sm}>
                <SectionHeader title="Insights" />
                {analytics.insights.map((insight) => (
                  <Type key={insight} variant="caption">
                    • {insight}
                  </Type>
                ))}
              </Stack>
            </Card>
          ) : null}
        </>
      ) : (
        <EmptyState icon="stats-chart-outline" title="No data yet" body="Complete a task or run a focus session and this screen fills in." />
      )}

      <Stack gap={spacing.md}>
        <SectionHeader title="Heat map" subtitle="Tap a day for its full breakdown" />
        <Segmented options={METRICS} value={metric} onChange={setMetric} />
        <Segmented
          options={[
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
            { value: 'year', label: 'Year' },
          ]}
          value={heatRange}
          onChange={setHeatRange}
        />
        <Card>
          {heatmap ? (
            <Stack gap={spacing.md}>
              <HeatmapGrid cells={heatmap.cells} onSelectDay={setSelectedDay} selectedDay={selectedDay?.dayKey ?? null} />
              <Row gap={spacing.lg} wrap>
                <Badge label={`${heatmap.totals.tasksCompleted} tasks`} color={palette.quadrant.schedule} />
                <Badge label={`${heatmap.totals.focusMinutes} focus min`} color={palette.primary} />
                <Badge label={`${heatmap.totals.habitsCompleted} habit check-ins`} color={palette.success} />
                <Badge label={`${heatmap.totals.activeDays} active days`} />
              </Row>
              {heatmap.totals.bestDay ? (
                <Type variant="caption" color={palette.textMuted}>
                  Most active day: {heatmap.totals.bestDay} ({heatmap.totals.bestDayValue})
                </Type>
              ) : null}
            </Stack>
          ) : (
            <LoadingBlock label="Loading heat map" />
          )}
        </Card>

        {selectedDay ? (
          <Card style={{ backgroundColor: palette.surfaceMuted }}>
            <Stack gap={spacing.sm}>
              <Row justify="space-between">
                <Type variant="bodyStrong">{selectedDay.dayKey}</Type>
                <Button label="Close" size="sm" variant="ghost" onPress={() => setSelectedDay(null)} />
              </Row>
              {[
                ['Tasks completed', selectedDay.tasksCompleted],
                ['Tasks created', selectedDay.tasksCreated],
                ['Focus minutes', selectedDay.focusMinutes],
                ['Habits completed', selectedDay.habitsCompleted],
                ['Planned tasks', selectedDay.plannedTaskCount],
                ['Productivity score', Math.round(selectedDay.productivityScore)],
              ].map(([label, value]) => (
                <Row key={String(label)} justify="space-between">
                  <Type variant="caption">{label}</Type>
                  <Type variant="caption" color={palette.textMuted}>
                    {String(value)}
                  </Type>
                </Row>
              ))}
              <View style={{ marginTop: spacing.xs }}>
                <Button
                  label="Open the daily review for this day"
                  size="sm"
                  variant="secondary"
                  onPress={() => router.push(`/review?day=${selectedDay.dayKey}`)}
                />
              </View>
            </Stack>
          </Card>
        ) : null}
      </Stack>

      {dashboard?.score ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Today's score" />
          <ScoreCard score={dashboard.score} />
        </Stack>
      ) : null}
    </Screen>
  );
}
