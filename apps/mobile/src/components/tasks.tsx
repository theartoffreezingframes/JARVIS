/**
 * Task presentation.
 *
 * One row component is used by every list in the app (today, project, matrix,
 * calendar, search) so a task always looks and behaves the same way. All time
 * formatting goes through the shared helpers and respects the user's clock.
 */
import type { Priority, Task } from '@jarvis/shared';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { Badge, IconButton, Row, Stack, Type, type IconName } from './ui';
import { radius, spacing, usePalette, type Palette } from '../lib/theme';
import { useAuth } from '../lib/auth';

export function priorityColor(priority: Priority | string, palette: Palette): string {
  switch (priority) {
    case 'urgent':
      return palette.priority.urgent;
    case 'high':
      return palette.priority.high;
    case 'medium':
      return palette.priority.medium;
    default:
      return palette.priority.low;
  }
}

export function formatClock(time: string | null | undefined, use24Hour: boolean): string {
  if (!time) return '';
  const [hRaw, mRaw] = time.split(':');
  const hour = Number(hRaw);
  const minute = mRaw ?? '00';
  if (Number.isNaN(hour)) return time;
  if (use24Hour) return `${String(hour).padStart(2, '0')}:${minute}`;
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minute} ${suffix}`;
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function useDateLabel() {
  const { user, settings } = useAuth();
  const use24Hour = settings?.use24Hour ?? false;

  const dayLabel = (dayKey: string | null, today: string): string => {
    if (!dayKey) return '';
    if (dayKey === today) return 'Today';
    const target = Date.parse(`${dayKey}T00:00:00Z`);
    const base = Date.parse(`${today}T00:00:00Z`);
    const diff = Math.round((target - base) / 86_400_000);
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    if (diff < 0) return `${Math.abs(diff)}d overdue`;
    if (diff <= 6) return new Date(target).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' });
    return new Date(target).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };

  return { dayLabel, formatClock: (time: string | null) => formatClock(time, use24Hour), use24Hour, user };
}

export function dueLabel(task: Task, today: string): { text: string; overdue: boolean } | null {
  if (!task.dueDate) return null;
  const target = Date.parse(`${task.dueDate}T00:00:00Z`);
  const base = Date.parse(`${today}T00:00:00Z`);
  const diff = Math.round((target - base) / 86_400_000);
  const overdue = diff < 0 && task.status !== 'done';
  const label =
    diff === 0
      ? 'Today'
      : diff === 1
        ? 'Tomorrow'
        : diff === -1
          ? 'Yesterday'
          : new Date(target).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return { text: overdue ? `${label} · overdue` : label, overdue };
}

/* -------------------------------------------------------------------------- */
/*  Row                                                                       */
/* -------------------------------------------------------------------------- */

export function TaskCheck({
  done,
  onPress,
  size = 24,
  label,
  color,
}: {
  done: boolean;
  onPress: () => void;
  size?: number;
  label: string;
  color?: string;
}) {
  const palette = usePalette();
  const tint = color ?? palette.primary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={label}
      hitSlop={10}
      style={{
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius.pill,
          borderWidth: done ? 0 : 1.8,
          borderColor: done ? tint : palette.borderStrong,
          backgroundColor: done ? tint : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {done ? <Ionicons name="checkmark" size={size * 0.62} color={palette.onPrimary} /> : null}
      </View>
    </Pressable>
  );
}

/** Which of the optional row fields are visible (Settings → Customize → Tasks). */
export interface TaskRowFields {
  due: boolean;
  priority: boolean;
  project: boolean;
  estimate: boolean;
  tags: boolean;
  subtasks: boolean;
  description: boolean;
}

const ALL_FIELDS: TaskRowFields = {
  due: true,
  priority: true,
  project: true,
  estimate: true,
  tags: true,
  subtasks: true,
  description: true,
};

export function TaskRow({
  task,
  today,
  onPress,
  onToggle,
  onLongPress,
  showProject,
  projectName,
  trailing,
  dense,
  fields,
}: {
  task: Task;
  today: string;
  onPress?: () => void;
  onToggle?: () => void;
  onLongPress?: () => void;
  showProject?: boolean;
  projectName?: string | null;
  trailing?: React.ReactNode;
  dense?: boolean;
  fields?: Partial<TaskRowFields>;
}) {
  const palette = usePalette();
  const { formatClock } = useDateLabel();
  const visible = { ...ALL_FIELDS, ...fields };
  const done = task.status === 'done';
  const due = dueLabel(task, today);
  const subtasksDone = task.subtasks.filter((subtask) => subtask.status === 'done').length;

  const meta: string[] = [];
  if (visible.project && projectName && (showProject ?? true)) meta.push(projectName);
  if (visible.due && due) meta.push(`${due.text}${task.dueTime ? ` ${formatClock(task.dueTime)}` : ''}`);
  if (visible.estimate && task.estimatedMinutes) meta.push(formatMinutes(task.estimatedMinutes));
  if (visible.subtasks && task.subtasks.length > 0) meta.push(`${subtasksDone}/${task.subtasks.length} steps`);
  if (visible.tags && task.tags.length > 0) meta.push(task.tags.map((tag) => `#${tag}`).join(' '));

  return (
    <Row gap={spacing.sm} style={{ paddingVertical: dense ? 4 : 8 }}>
      {onToggle ? (
        <TaskCheck
          done={done}
          onPress={onToggle}
          label={`${done ? 'Reopen' : 'Complete'} ${task.title}`}
          color={priorityColor(task.priority, palette)}
          size={dense ? 20 : 24}
        />
      ) : null}
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        disabled={!onPress && !onLongPress}
        accessibilityRole="button"
        accessibilityLabel={`${task.title}${done ? ', completed' : ''}`}
        accessibilityHint={meta.join(', ')}
        style={{ flex: 1, paddingVertical: 4 }}
      >
        <Stack gap={3}>
          <Type
            variant="bodyStrong"
            numberOfLines={2}
            style={done ? { textDecorationLine: 'line-through', color: palette.textFaint } : undefined}
          >
            {task.title}
          </Type>
          {visible.description && task.description && !dense ? (
            <Type variant="caption" color={palette.textFaint} numberOfLines={1}>
              {task.description}
            </Type>
          ) : null}
          {meta.length > 0 || task.isMustDo ? (
            <Row gap={6} wrap>
              {task.isMustDo ? <Badge label="Must do" color={palette.primary} /> : null}
              {visible.priority && task.priority !== 'medium' && task.priority !== 'low' ? (
                <Badge label={task.priority} color={priorityColor(task.priority, palette)} icon="flag" />
              ) : null}
              <Type variant="caption" color={due?.overdue ? palette.danger : palette.textMuted} numberOfLines={1}>
                {meta.join(' · ')}
              </Type>
            </Row>
          ) : null}
        </Stack>
      </Pressable>
      {trailing}
    </Row>
  );
}

export function QuadrantPill({
  quadrant,
  count,
  active,
  onPress,
}: {
  quadrant: 'do_now' | 'schedule' | 'delegate' | 'eliminate';
  count?: number;
  active?: boolean;
  onPress?: () => void;
}) {
  const palette = usePalette();
  const color = palette.quadrant[quadrant];
  const label = QUADRANT_LABEL[quadrant];
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={`${label} quadrant${count === undefined ? '' : `, ${count} tasks`}`}
      accessibilityState={{ selected: Boolean(active) }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
        borderRadius: radius.pill,
        backgroundColor: active ? color : `${color}18`,
      }}
    >
      <Ionicons name={QUADRANT_ICON[quadrant]} size={12} color={active ? palette.onPrimary : color} />
      <Type variant="caption" color={active ? palette.onPrimary : color}>
        {label}
        {count === undefined ? '' : ` ${count}`}
      </Type>
    </Pressable>
  );
}

export const QUADRANT_LABEL = {
  do_now: 'Do now',
  schedule: 'Schedule',
  delegate: 'Delegate',
  eliminate: 'Eliminate',
} as const;

export const QUADRANT_HINT = {
  do_now: 'Important and urgent — handle these first.',
  schedule: 'Important, not urgent — the work that compounds. Book time for it.',
  delegate: 'Urgent, not important — hand off, automate or batch.',
  eliminate: 'Neither — question whether it needs doing at all.',
} as const;

export const QUADRANT_ICON: Record<'do_now' | 'schedule' | 'delegate' | 'eliminate', IconName> = {
  do_now: 'flame',
  schedule: 'calendar',
  delegate: 'people',
  eliminate: 'trash-bin',
};

export function SubtaskRow({
  title,
  done,
  onToggle,
  onRemove,
}: {
  title: string;
  done: boolean;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  const palette = usePalette();
  return (
    <Row gap={spacing.xs}>
      <TaskCheck done={done} onPress={onToggle} size={19} label={`${done ? 'Reopen' : 'Complete'} subtask ${title}`} />
      <Type
        variant="body"
        numberOfLines={2}
        style={[{ flex: 1 }, done ? { color: palette.textFaint, textDecorationLine: 'line-through' } : null]}
      >
        {title}
      </Type>
      {onRemove ? <IconButton icon="close" label={`Remove subtask ${title}`} onPress={onRemove} size={16} /> : null}
    </Row>
  );
}

export function TaskRowSkeleton() {
  const palette = usePalette();
  return (
    <Row gap={spacing.sm} style={{ paddingVertical: spacing.md }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: palette.surfaceMuted }} />
      <View style={{ flex: 1, height: 14, borderRadius: 4, backgroundColor: palette.surfaceMuted }} />
    </Row>
  );
}

export const taskStyles = StyleSheet.create({
  pressed: { opacity: 0.7 },
});
