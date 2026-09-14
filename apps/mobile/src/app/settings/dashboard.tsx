/**
 * Settings → Customize → Dashboard.
 *
 * Choose a starting layout, then show, hide and reorder each widget. The order
 * and visibility are stored on the account, and Home renders exactly this list.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import type { DashboardLayoutId, DashboardWidgetId } from '@jarvis/shared';
import { DASHBOARD_WIDGETS } from '@jarvis/shared';
import { Badge, Button, Card, Chip, Row, Screen, SectionHeader, Stack, SwitchRow, Type, type IconName } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { radius, spacing, usePalette } from '../../lib/theme';

const LABELS: Record<DashboardWidgetId, { title: string; description: string; icon: IconName }> = {
  greeting: { title: 'Greeting & date', description: 'Your name, the date and the shape of the day.', icon: 'hand-left' },
  progress: { title: "Today's progress", description: 'Completed, remaining, overdue and important counts.', icon: 'pie-chart' },
  quick_add: { title: 'Quick capture', description: 'One tap to the natural-language task box.', icon: 'add-circle' },
  focus_cta: { title: 'Start focusing', description: 'Today’s focus time with a button to begin.', icon: 'timer' },
  today_tasks: { title: "Today's tasks", description: 'The work planned for today.', icon: 'checkbox' },
  overdue: { title: 'Overdue', description: 'Anything past its date, so it gets a decision.', icon: 'alert-circle' },
  important: { title: 'Important', description: 'Tasks marked important but not yet done.', icon: 'star' },
  deadlines: { title: 'Upcoming deadlines', description: 'The next few dated tasks.', icon: 'calendar' },
  habits: { title: 'Habits', description: 'Today’s habits with streaks and check-off.', icon: 'repeat' },
  streaks: { title: 'Streaks', description: 'Focus and habit streaks at a glance.', icon: 'flame' },
  heatmap: { title: 'Activity heat map', description: 'Thirty days of real activity.', icon: 'grid-outline' },
  focus_stats: { title: 'Focus statistics', description: 'Minutes and sessions for today and the week.', icon: 'stats-chart' },
  matrix_shortcut: { title: 'Eisenhower matrix', description: 'Quadrant counts and balance hints.', icon: 'grid' },
  gang_sessions: { title: 'Group sessions', description: 'Live and scheduled gang sessions.', icon: 'people' },
  gang_shortcut: { title: 'Gang timer shortcut', description: 'The next shared session in one tap.', icon: 'flash' },
  projects: { title: 'Projects', description: 'Active projects with live progress.', icon: 'folder-open' },
  summary: { title: 'Productivity summary', description: 'Today’s balanced score with its components.', icon: 'sparkles' },
};

const LAYOUTS: Array<{ id: DashboardLayoutId; label: string; description: string }> = [
  { id: 'balanced', label: 'Balanced', description: 'Everything, in a calm order.' },
  { id: 'minimal', label: 'Minimal', description: 'Greeting, capture, progress, today and focus.' },
  { id: 'focus', label: 'Focus first', description: 'Timer, focus stats and activity at the top.' },
  { id: 'planner', label: 'Planner', description: 'Today, overdue, deadlines and the matrix up top.' },
];

export default function DashboardSettingsScreen() {
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

  const widgets = settings.dashboardWidgets;
  const visibleCount = widgets.filter((widget) => widget.visible).length;

  const move = async (id: DashboardWidgetId, direction: -1 | 1) => {
    const index = widgets.findIndex((widget) => widget.id === id);
    const next = widgets.slice();
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await updateSettings({ dashboardWidgets: next });
  };

  const toggle = async (id: DashboardWidgetId, visible: boolean) => {
    await updateSettings({
      dashboardWidgets: widgets.map((widget) => (widget.id === id ? { ...widget, visible } : widget)),
    });
  };

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Button
          label="Restore all"
          variant="ghost"
          onPress={() => void updateSettings({ dashboardWidgets: DASHBOARD_WIDGETS.map((id) => ({ id, visible: true })) })}
        />
      </Row>

      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          Dashboard
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          {visibleCount} of {widgets.length} widgets visible · reorder with the arrows
        </Type>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Starting layout" subtitle="Switching a layout replaces the order and visibility" />
        <Row gap={spacing.sm} wrap>
          {LAYOUTS.map((layout) => (
            <Chip
              key={layout.id}
              label={layout.label}
              selected={settings.dashboardLayout === layout.id}
              onPress={() => void updateSettings({ dashboardLayout: layout.id })}
            />
          ))}
        </Row>
        <Type variant="caption" color={palette.textFaint}>
          {LAYOUTS.find((layout) => layout.id === settings.dashboardLayout)?.description}
        </Type>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Widgets" subtitle="In the order they appear on Home" />
        {widgets.map((widget, index) => {
          const meta = LABELS[widget.id];
          return (
            <Card key={widget.id} style={{ opacity: widget.visible ? 1 : 0.55 }}>
              <Row gap={spacing.md} align="center">
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: radius.sm,
                    backgroundColor: palette.surfaceMuted,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name={meta.icon} size={18} color={palette.textMuted} />
                </View>
                <Stack gap={2} style={{ flex: 1 }}>
                  <Row gap={6}>
                    <Type variant="bodyStrong">{meta.title}</Type>
                    {index === 0 ? <Badge label="First" color={palette.primary} /> : null}
                  </Row>
                  <Type variant="caption" color={palette.textMuted} numberOfLines={2}>
                    {meta.description}
                  </Type>
                </Stack>
                <Stack gap={4} style={{ alignItems: 'center' }}>
                  <Pressable
                    onPress={() => void move(widget.id, -1)}
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${meta.title} up`}
                    style={{ width: 34, height: 26, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Ionicons name="chevron-up" size={16} color={index === 0 ? palette.textFaint : palette.text} />
                  </Pressable>
                  <Pressable
                    onPress={() => void move(widget.id, 1)}
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${meta.title} down`}
                    style={{ width: 34, height: 26, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Ionicons
                      name="chevron-down"
                      size={16}
                      color={index === widgets.length - 1 ? palette.textFaint : palette.text}
                    />
                  </Pressable>
                </Stack>
              </Row>
              <View style={{ marginTop: spacing.sm }}>
                <SwitchRow
                  label="Show on Home"
                  value={widget.visible}
                  onValueChange={(value) => void toggle(widget.id, value)}
                />
              </View>
            </Card>
          );
        })}
      </Stack>

      <Button label="Preview on Home" icon="home-outline" variant="secondary" onPress={() => router.replace('/(tabs)')} full />
    </Screen>
  );
}
