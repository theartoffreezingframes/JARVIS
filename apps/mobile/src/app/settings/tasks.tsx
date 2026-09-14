/**
 * Settings → Customize → Tasks.
 *
 * Defaults that quick capture starts from, how lists are sorted and grouped, and
 * which fields are shown on a task row.
 */
import { useRouter } from 'expo-router';
import { Badge, Button, Card, Chip, Field, Input, Row, Screen, SectionHeader, Segmented, Stack, SwitchRow, Type } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useProjects } from '../../hooks/useLibrary';
import { priorityColor } from '../../components/tasks';
import { spacing, usePalette } from '../../lib/theme';

export default function TaskSettingsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { settings, updateSettings } = useAuth();
  const { projects } = useProjects();

  if (!settings) {
    return (
      <Screen edges={['top']}>
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Type variant="body">Loading your preferences…</Type>
      </Screen>
    );
  }

  const defaults = settings.taskDefaults;
  const display = settings.taskDisplay;

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Button label="Preview tasks" variant="ghost" onPress={() => router.replace('/(tabs)/tasks')} />
      </Row>

      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          Tasks
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          Defaults for new tasks, and how lists are presented.
        </Type>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Defaults for new tasks" />
        <Card>
          <Stack gap={spacing.md}>
            <Field label="Default priority">
              <Row gap={spacing.sm} wrap>
                {(['low', 'medium', 'high', 'urgent'] as const).map((option) => (
                  <Chip
                    key={option}
                    label={option}
                    color={priorityColor(option, palette)}
                    selected={defaults.priority === option}
                    onPress={() => void updateSettings({ taskDefaults: { priority: option } })}
                  />
                ))}
              </Row>
            </Field>

            <Field label="Default estimate">
              <Row gap={spacing.sm} wrap>
                <Chip
                  label="None"
                  selected={defaults.estimateMinutes === null}
                  onPress={() => void updateSettings({ taskDefaults: { estimateMinutes: null } })}
                />
                {[15, 25, 30, 45, 60, 90].map((minutes) => (
                  <Chip
                    key={minutes}
                    label={`${minutes}m`}
                    selected={defaults.estimateMinutes === minutes}
                    onPress={() => void updateSettings({ taskDefaults: { estimateMinutes: minutes } })}
                  />
                ))}
              </Row>
            </Field>

            <Field label="Default reminder" hint="Applied when quick capture does not name a time.">
              <Row gap={spacing.sm} wrap>
                <Chip
                  label="None"
                  selected={defaults.reminderLeadMinutes === null}
                  onPress={() => void updateSettings({ taskDefaults: { reminderLeadMinutes: null } })}
                />
                {[0, 15, 30, 60, 1440].map((minutes) => (
                  <Chip
                    key={minutes}
                    label={minutes === 0 ? 'At due time' : minutes === 1440 ? '1 day before' : `${minutes}m before`}
                    selected={defaults.reminderLeadMinutes === minutes}
                    onPress={() => void updateSettings({ taskDefaults: { reminderLeadMinutes: minutes } })}
                  />
                ))}
              </Row>
            </Field>

            <Field label="Default project">
              <Row gap={spacing.sm} wrap>
                <Chip
                  label="Inbox"
                  selected={!defaults.projectId}
                  onPress={() => void updateSettings({ taskDefaults: { projectId: null } })}
                />
                {projects.map((project) => (
                  <Chip
                    key={project.id}
                    label={project.name}
                    color={project.color}
                    selected={defaults.projectId === project.id}
                    onPress={() => void updateSettings({ taskDefaults: { projectId: project.id } })}
                  />
                ))}
              </Row>
            </Field>

            <SwitchRow
              label="Default new tasks to today"
              description="Useful if most of what you capture is for today."
              value={defaults.dueToday}
              onValueChange={(value) => void updateSettings({ taskDefaults: { dueToday: value } })}
            />

            <SwitchRow
              label="Ask importance and urgency on capture"
              description="Sorts the task into an Eisenhower quadrant as you create it."
              value={defaults.classifyAtCreation}
              onValueChange={(value) => void updateSettings({ taskDefaults: { classifyAtCreation: value } })}
            />
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="List presentation" />
        <Card>
          <Stack gap={spacing.md}>
            <Field label="Task style">
              <Segmented
                options={[
                  { value: 'comfortable', label: 'Comfortable' },
                  { value: 'compact', label: 'Compact' },
                ]}
                value={display.style}
                onChange={(value) => void updateSettings({ taskDisplay: { style: value } })}
              />
            </Field>

            <Field label="Sort order">
              <Row gap={spacing.sm} wrap>
                {(['due', 'priority', 'created', 'title', 'manual'] as const).map((option) => (
                  <Chip
                    key={option}
                    label={option === 'due' ? 'Due date' : option === 'created' ? 'Recently added' : option === 'manual' ? 'Manual' : option === 'title' ? 'Title' : 'Priority'}
                    selected={display.sort === option}
                    onPress={() => void updateSettings({ taskDisplay: { sort: option } })}
                  />
                ))}
              </Row>
            </Field>

            <Field label="Group by">
              <Row gap={spacing.sm} wrap>
                {(['day', 'project', 'priority', 'quadrant', 'none'] as const).map((option) => (
                  <Chip
                    key={option}
                    label={option}
                    selected={display.grouping === option}
                    onPress={() => void updateSettings({ taskDisplay: { grouping: option } })}
                  />
                ))}
              </Row>
            </Field>

            <Type variant="label" color={palette.textMuted}>
              VISIBLE FIELDS
            </Type>
            <Stack gap={spacing.xs}>
              {(
                [
                  ['due', 'Due date & time'],
                  ['priority', 'Priority'],
                  ['project', 'Project name'],
                  ['estimate', 'Estimate'],
                  ['subtasks', 'Subtask progress'],
                  ['tags', 'Tags'],
                  ['description', 'Description preview'],
                ] as const
              ).map(([key, label]) => (
                <SwitchRow
                  key={key}
                  label={label}
                  value={display.fields[key]}
                  onValueChange={(value) => void updateSettings({ taskDisplay: { fields: { [key]: value } } })}
                />
              ))}
            </Stack>
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Planner day window" subtitle="Used to work out how much work actually fits" />
        <Card>
          <Stack gap={spacing.md}>
            <Field label="Day starts">
              <Input
                value={settings.dayStartTime}
                onChangeText={(value) => void updateSettings({ dayStartTime: value })}
                placeholder="07:00"
              />
            </Field>
            <Field label="Day ends">
              <Input
                value={settings.dayEndTime}
                onChangeText={(value) => void updateSettings({ dayEndTime: value })}
                placeholder="22:00"
              />
            </Field>
            <Row gap={spacing.sm} wrap>
              <Badge label={`Planning window ${settings.dayStartTime}–${settings.dayEndTime}`} color={palette.primary} />
              <Badge label={`Default task length ${settings.defaultTaskDurationMinutes} min`} />
            </Row>
            <Field label="Default task length">
              <Row gap={spacing.sm} wrap>
                {[15, 25, 30, 45, 60].map((minutes) => (
                  <Chip
                    key={minutes}
                    label={`${minutes}m`}
                    selected={settings.defaultTaskDurationMinutes === minutes}
                    onPress={() => void updateSettings({ defaultTaskDurationMinutes: minutes })}
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
