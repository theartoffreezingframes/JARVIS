/**
 * Settings → Customize → Calendar & habits.
 *
 * Week start, working hours, default event length, what the calendar shows, and
 * how habits are presented.
 */
import { useRouter } from 'expo-router';
import { Badge, Button, Card, Chip, Field, Input, Row, Screen, SectionHeader, Segmented, Stack, SwitchRow, Type } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { spacing, usePalette } from '../../lib/theme';

export default function CalendarSettingsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { settings, updateSettings } = useAuth();

  if (!settings) {
    return (
      <Screen edges={['top']}>
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Type variant="body">Loading your preferences…</Type>
      </Screen>
    );
  }

  const calendar = settings.calendar;

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Button label="Open calendar" variant="ghost" onPress={() => router.replace('/calendar')} />
      </Row>

      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          Calendar & habits
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          Working hours drive the planner’s capacity calculation.
        </Type>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Week & hours" />
        <Card>
          <Stack gap={spacing.md}>
            <Field label="Start of week">
              <Segmented
                options={[
                  { value: '1', label: 'Monday' },
                  { value: '0', label: 'Sunday' },
                ]}
                value={String(settings.weekStartsOn)}
                onChange={(value) => void updateSettings({ weekStartsOn: value === '1' ? 1 : 0 })}
              />
            </Field>
            <Field label="Working hours start">
              <Input
                value={calendar.workingHoursStart}
                onChangeText={(value) => void updateSettings({ calendar: { workingHoursStart: value } })}
                placeholder="07:00"
              />
            </Field>
            <Field label="Working hours end">
              <Input
                value={calendar.workingHoursEnd}
                onChangeText={(value) => void updateSettings({ calendar: { workingHoursEnd: value } })}
                placeholder="22:00"
              />
            </Field>
            <Field label="Default event length">
              <Row gap={spacing.sm} wrap>
                {[15, 30, 45, 60, 90].map((minutes) => (
                  <Chip
                    key={minutes}
                    label={`${minutes}m`}
                    selected={calendar.defaultEventMinutes === minutes}
                    onPress={() => void updateSettings({ calendar: { defaultEventMinutes: minutes } })}
                  />
                ))}
              </Row>
            </Field>
            <Row gap={spacing.sm} wrap>
              <Badge label={`${calendar.workingHoursStart}–${calendar.workingHoursEnd}`} color={palette.primary} />
              <Badge label={`Planner day ${settings.dayStartTime}–${settings.dayEndTime}`} />
            </Row>
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Display" />
        <Card>
          <Stack gap={spacing.md}>
            <Segmented
              options={[
                { value: 'month', label: 'Month' },
                { value: 'week', label: 'Week' },
                { value: 'day', label: 'Day' },
              ]}
              value={calendar.display}
              onChange={(value) => void updateSettings({ calendar: { display: value } })}
            />
            <Stack gap={spacing.xs}>
              <SwitchRow
                label="Show completed tasks"
                description="Off keeps the calendar focused on what is still ahead."
                value={calendar.showCompleted}
                onValueChange={(value) => void updateSettings({ calendar: { showCompleted: value } })}
              />
              <SwitchRow
                label="Show habits"
                description="Habit schedule indicators on each day."
                value={calendar.showHabits}
                onValueChange={(value) => void updateSettings({ calendar: { showHabits: value } })}
              />
              <SwitchRow
                label="Show focus sessions"
                description="Focus minutes recorded each day."
                value={calendar.showFocusSessions}
                onValueChange={(value) => void updateSettings({ calendar: { showFocusSessions: value } })}
              />
            </Stack>
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Habits" />
        <Card>
          <Stack gap={spacing.md}>
            <Field label="Habit list style">
              <Segmented
                options={[
                  { value: 'list', label: 'Detailed list' },
                  { value: 'grid', label: 'Compact grid' },
                ]}
                value={settings.habits.displayStyle}
                onChange={(value) => void updateSettings({ habits: { displayStyle: value } })}
              />
            </Field>
            <SwitchRow
              label="Show streaks"
              description="Current and best streak on each habit."
              value={settings.habits.showStreaks}
              onValueChange={(value) => void updateSettings({ habits: { showStreaks: value } })}
            />
            <SwitchRow
              label="Show habit heat maps"
              description="Per-habit completion history drawn from real check-ins."
              value={settings.habits.showHeatmap}
              onValueChange={(value) => void updateSettings({ habits: { showHeatmap: value } })}
            />
            <Field label="Default habit reminder">
              <Row gap={spacing.sm} wrap>
                <Chip
                  label="None"
                  selected={!settings.dailyPlanningReminder}
                  onPress={() => void updateSettings({ dailyPlanningReminder: null })}
                />
                {['06:30', '08:00', '09:00'].map((time) => (
                  <Chip
                    key={time}
                    label={time}
                    selected={settings.dailyPlanningReminder === time}
                    onPress={() => void updateSettings({ dailyPlanningReminder: time })}
                  />
                ))}
              </Row>
            </Field>
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Daily rhythm" subtitle="Reminders that frame the day" />
        <Card>
          <Stack gap={spacing.md}>
            <Field label="Daily planning reminder">
              <Row gap={spacing.sm} wrap>
                <Chip label="Off" selected={!settings.dailyPlanningReminder} onPress={() => void updateSettings({ dailyPlanningReminder: null })} />
                {['07:30', '08:30', '09:30', '10:00'].map((time) => (
                  <Chip
                    key={time}
                    label={time}
                    selected={settings.dailyPlanningReminder === time}
                    onPress={() => void updateSettings({ dailyPlanningReminder: time })}
                  />
                ))}
              </Row>
            </Field>
            <Field label="Daily review reminder">
              <Row gap={spacing.sm} wrap>
                <Chip label="Off" selected={!settings.dailyReviewReminder} onPress={() => void updateSettings({ dailyReviewReminder: null })} />
                {['20:00', '21:00', '22:00'].map((time) => (
                  <Chip
                    key={time}
                    label={time}
                    selected={settings.dailyReviewReminder === time}
                    onPress={() => void updateSettings({ dailyReviewReminder: time })}
                  />
                ))}
              </Row>
            </Field>
          </Stack>
        </Card>
      </Stack>
    </Screen>
  );
}
