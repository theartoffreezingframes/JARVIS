import type {
  AppNotification,
  DashboardLayoutId,
  DashboardWidgetId,
  FocusSession,
  Group,
  HabitCompletion,
  Habit,
  Note,
  Project,
  Subtask,
  Task,
  User,
  UserSettings,
  DailyReview,
  GangSession,
  GangParticipant,
  GroupMember,
} from '@jarvis/shared';
import { DASHBOARD_WIDGETS } from '@jarvis/shared';
import type { DayKey } from '@jarvis/shared';
import type {
  DailyReviewRow,
  SettingsRow,
  FocusSessionRow,
  GangParticipantRow,
  GangSessionRow,
  GroupMemberRow,
  GroupRow,
  HabitCompletionRow,
  HabitRow,
  NoteRow,
  NotificationRow,
  ProjectRow,
  SubtaskRow,
  TaskRow,
  UserRow,
} from './rows.js';

const bool = (value: number | null | undefined): boolean => value === 1;

export function mapUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    username: row.username,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    timezone: row.timezone,
    timezoneOffsetMinutes: row.tz_offset_minutes,
    weekStartsOn: row.week_starts_on === 1 ? 1 : 0,
    use24Hour: bool(row.use_24_hour),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSubtask(row: SubtaskRow): Subtask {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    status: row.status as Subtask['status'],
    position: row.position,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTask(row: TaskRow, subtasks: Subtask[] = [], tags: string[] = []): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    parentTaskId: row.parent_task_id,
    title: row.title,
    description: row.description,
    notes: row.notes,
    status: row.status as Task['status'],
    priority: row.priority as Task['priority'],
    important: bool(row.important),
    urgent: bool(row.urgent),
    dueDate: row.due_date as DayKey | null,
    dueTime: row.due_time,
    reminderAt: row.reminder_at,
    estimatedMinutes: row.estimated_minutes,
    actualMinutes: row.actual_minutes,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    planDate: row.plan_date as DayKey | null,
    planOrder: row.plan_order,
    isMustDo: bool(row.is_must_do),
    recurrence: parseRecurrence(row.recurrence),
    recurredFromId: row.recurred_from_id,
    tags,
    subtasks,
    completedAt: row.completed_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    seq: row.seq,
  };
}

export function parseRecurrence(value: string | null): Task['recurrence'] {
  if (!value) return { kind: 'none', interval: 1, byWeekday: [], until: null, count: 0, maxOccurrences: null };
  try {
    const parsed = JSON.parse(value) as Partial<Task['recurrence']>;
    return {
      kind: parsed.kind ?? 'none',
      interval: parsed.interval ?? 1,
      byWeekday: parsed.byWeekday ?? [],
      until: parsed.until ?? null,
      count: parsed.count ?? 0,
      maxOccurrences: parsed.maxOccurrences ?? null,
    };
  } catch {
    return { kind: 'none', interval: 1, byWeekday: [], until: null, count: 0, maxOccurrences: null };
  }
}

export interface ProjectRollup {
  taskCount: number;
  completedTaskCount: number;
}

export function mapProject(row: ProjectRow, tags: string[] = [], rollup: ProjectRollup = { taskCount: 0, completedTaskCount: 0 }): Project {
  const progress = rollup.taskCount ? Math.round((rollup.completedTaskCount / rollup.taskCount) * 100) : 0;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    icon: row.icon,
    status: row.status as Project['status'],
    priority: row.priority as Project['priority'],
    dueDate: row.due_date as DayKey | null,
    tags,
    taskCount: rollup.taskCount,
    completedTaskCount: rollup.completedTaskCount,
    progress,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function mapHabit(
  row: HabitRow,
  completions: HabitCompletionRow[],
  derived: { currentStreak: number; bestStreak: number; completionRate: number; completedToday: boolean },
): Habit {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    frequency: row.frequency as Habit['frequency'],
    scheduleDays: row.schedule_days
      ? row.schedule_days.split(',').map((d) => Number.parseInt(d, 10)).filter((n) => !Number.isNaN(n))
      : [],
    targetPerPeriod: row.target_per_period,
    reminderTime: row.reminder_time,
    archived: bool(row.archived),
    currentStreak: derived.currentStreak,
    bestStreak: derived.bestStreak,
    completionRate: derived.completionRate,
    recentCompletions: completions
      .filter((c) => !c.deleted_at)
      .map((c) => c.day_key as DayKey)
      .sort(),
    completedToday: derived.completedToday,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    seq: row.seq,
    deletedAt: row.deleted_at,
  };
}

export function mapFocusSession(row: FocusSessionRow, taskTitle?: string | null): FocusSession {
  return {
    id: row.id,
    taskId: row.task_id,
    taskTitle: taskTitle ?? null,
    projectId: row.project_id,
    mode: row.mode as FocusSession['mode'],
    label: row.label,
    plannedMinutes: row.planned_minutes,
    actualSeconds: row.actual_seconds,
    completed: bool(row.completed),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    interruptions: row.interruptions,
    dayKey: row.day_key as DayKey,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    seq: row.seq,
    deletedAt: row.deleted_at,
  };
}

export function mapNote(row: NoteRow, tags: string[] = []): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    projectId: row.project_id,
    taskId: row.task_id,
    tags,
    pinned: bool(row.pinned),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    seq: row.seq,
    deletedAt: row.deleted_at,
  };
}

export function mapGroup(row: GroupRow, members: GroupMember[]): Group {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    emoji: row.emoji,
    inviteCode: row.invite_code,
    ownerId: row.owner_id,
    memberCount: members.length,
    members,
    leaderboardEnabled: bool(row.leaderboard_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    seq: row.seq,
    deletedAt: row.deleted_at,
  };
}

export function mapGroupMember(
  row: GroupMemberRow,
  user: { name: string; username: string; avatar_url: string | null } | undefined,
  stats?: { focusMinutes?: number; sessions?: number; tasksCompleted?: number; consistency?: number },
): GroupMember {
  return {
    userId: row.user_id,
    name: user?.name ?? 'Member',
    username: user?.username ?? 'member',
    avatarUrl: user?.avatar_url ?? null,
    role: row.role as GroupMember['role'],
    joinedAt: row.joined_at,
    ...(stats ?? {}),
  };
}

export function mapGangParticipant(
  row: GangParticipantRow,
  user: { name: string; username: string; avatar_url: string | null } | undefined,
): GangParticipant {
  return {
    userId: row.user_id,
    name: user?.name ?? 'Member',
    username: user?.username ?? 'member',
    avatarUrl: user?.avatar_url ?? null,
    state: row.state as GangParticipant['state'],
    focusSeconds: row.focus_seconds,
    secondsRemaining: row.seconds_remaining,
    isHost: bool(row.is_host),
    joinedAt: row.joined_at,
    lastSeenAt: row.last_seen_at,
    reactionsSent: row.reactions_sent,
  };
}

export function mapGangSession(
  row: GangSessionRow,
  group: { name: string } | undefined,
  participants: GangParticipant[],
): GangSession {
  return {
    id: row.id,
    groupId: row.group_id,
    groupName: group?.name ?? 'Group',
    title: row.title,
    hostId: row.host_id,
    startsAt: row.starts_at,
    focusMinutes: row.focus_minutes,
    breakMinutes: row.break_minutes,
    rounds: row.rounds,
    mode: row.mode as GangSession['mode'],
    status: row.status as GangSession['status'],
    clockAnchorAt: row.clock_anchor_at,
    clockPausedMs: row.clock_paused_ms,
    isClockPaused: bool(row.is_clock_paused),
    currentRound: row.current_round,
    recurrence: row.recurrence ? parseRecurrence(row.recurrence) : null,
    participants,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    seq: row.seq,
    deletedAt: row.deleted_at,
  };
}

export function mapNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    kind: row.kind as AppNotification['kind'],
    title: row.title,
    body: row.body,
    taskId: row.task_id,
    habitId: row.habit_id,
    sessionId: row.session_id,
    groupId: row.group_id,
    scheduledFor: row.scheduled_for,
    deliveredAt: row.delivered_at,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export function mapDailyReview(row: DailyReviewRow): DailyReview {
  return {
    id: row.id,
    dayKey: row.day_key as DayKey,
    reflection: row.reflection,
    mood: row.mood,
    energy: row.energy,
    tasksCompleted: row.tasks_completed,
    tasksPlanned: row.tasks_planned,
    focusMinutes: row.focus_minutes,
    habitsCompleted: row.habits_completed,
    overdueCarryOver: row.overdue_carry_over,
    tomorrowTopTaskId: row.tomorrow_top_task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    seq: row.seq,
  };
}

/** Habit check-ins are exposed with the same camelCase shape as every other model. */
export function mapHabitCompletion(row: HabitCompletionRow): HabitCompletion {
  return {
    id: row.id,
    habitId: row.habit_id,
    dayKey: row.day_key as DayKey,
    count: row.count,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    seq: row.seq,
  };
}

/* -------------------------------------------------------------------------- */
/*  Settings                                                                  */
/* -------------------------------------------------------------------------- */

export const DASHBOARD_WIDGET_ORDER: DashboardWidgetId[] = [...DASHBOARD_WIDGETS];

/**
 * Dashboard arrangements offered in Settings → Customize. Each preset starts
 * from the full widget list so nothing is lost when switching layouts.
 */
export const DASHBOARD_LAYOUTS: Record<DashboardLayoutId, DashboardWidgetId[]> = {
  balanced: [...DASHBOARD_WIDGETS],
  minimal: ['greeting', 'quick_add', 'progress', 'today_tasks', 'focus_cta'],
  focus: [
    'greeting',
    'focus_cta',
    'focus_stats',
    'heatmap',
    'today_tasks',
    'progress',
    'streaks',
    'habits',
    'quick_add',
    'matrix_shortcut',
    'gang_shortcut',
  ],
  planner: [
    'greeting',
    'quick_add',
    'progress',
    'today_tasks',
    'overdue',
    'important',
    'deadlines',
    'habits',
    'streaks',
    'matrix_shortcut',
    'focus_cta',
    'focus_stats',
    'heatmap',
    'gang_sessions',
    'gang_shortcut',
    'projects',
    'summary',
  ],
};

export function layoutWidgets(layout: DashboardLayoutId): UserSettings['dashboardWidgets'] {
  const order = DASHBOARD_LAYOUTS[layout] ?? DASHBOARD_WIDGET_ORDER;
  const rest = DASHBOARD_WIDGET_ORDER.filter((id) => !order.includes(id));
  return [...order, ...rest].map((id) => ({ id, visible: order.includes(id) }));
}

export function defaultSettings(row: UserRow): UserSettings {
  return {
    theme: 'system',
    accentColor: '#6C5CE7',
    weekStartsOn: row.week_starts_on === 1 ? 1 : 0,
    use24Hour: bool(row.use_24_hour),
    defaultTaskDurationMinutes: 30,
    dayStartTime: '07:00',
    dayEndTime: '22:00',
    pomodoroFocusMinutes: 25,
    pomodoroShortBreakMinutes: 5,
    pomodoroLongBreakMinutes: 15,
    pomodoroSessionsBeforeLongBreak: 4,
    autoStartBreaks: true,
    autoStartNextSession: false,
    dailyPlanningReminder: '08:30',
    dailyReviewReminder: '21:00',
    dashboardWidgets: DASHBOARD_WIDGET_ORDER.map((id) => ({ id, visible: true })),
    dashboardLayout: 'balanced',
    leaderboardEnabled: false,
    notifications: {
      taskReminder: true,
      deadline: true,
      overdue: true,
      habitReminder: true,
      focusScheduled: true,
      gangInvite: true,
      gangUpcoming: true,
      dailyPlanning: true,
      dailyReview: true,
      quietHoursStart: null,
      quietHoursEnd: null,
    },
    appearance: {
      preset: 'indigo',
      density: 'comfortable',
      radiusStyle: 'rounded',
      animationLevel: 'full',
      fontScale: 1,
    },
    taskDefaults: {
      priority: 'medium',
      estimateMinutes: null,
      reminderLeadMinutes: null,
      projectId: null,
      dueToday: false,
      classifyAtCreation: false,
    },
    taskDisplay: {
      style: 'comfortable',
      sort: 'due',
      grouping: 'day',
      fields: {
        due: true,
        priority: true,
        project: true,
        estimate: true,
        tags: false,
        subtasks: true,
        description: false,
      },
    },
    matrix: {
      quadrantNames: {
        do_now: 'Do Now',
        schedule: 'Schedule',
        delegate: 'Delegate',
        eliminate: 'Eliminate',
      },
      quadrantDescriptions: {
        do_now: 'Important and urgent — handle these first.',
        schedule: 'Important, not urgent — the work that compounds. Book time for it.',
        delegate: 'Urgent, not important — hand off, batch or automate.',
        eliminate: 'Neither — question whether it needs doing at all.',
      },
      defaultClassification: 'inbox',
      displayStyle: 'grid',
      showHints: true,
    },
    focus: {
      sound: false,
      haptics: true,
      countdownStyle: 'ring',
      keepScreenAwake: false,
      dailyTargetMinutes: 120,
    },
    calendar: {
      defaultEventMinutes: 60,
      workingHoursStart: '07:00',
      workingHoursEnd: '22:00',
      display: 'month',
      showCompleted: false,
      showHabits: true,
      showFocusSessions: true,
    },
    habits: {
      displayStyle: 'list',
      showStreaks: true,
      showHeatmap: true,
    },
    demoData: { enabled: false, loadedAt: null, projectIds: [], habitIds: [], noteIds: [] },
  };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> | T[K] : T[K] };

/**
 * Settings are a nested document; a patch must merge per section so changing
 * the pomodoro length never wipes the notification choices.
 */
export function mergeSettings(current: UserSettings, patch: DeepPartial<UserSettings>): UserSettings {
  const mergeGroup = <T extends object>(base: T, next: DeepPartial<T> | T | undefined): T => {
    if (!next) return base;
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(next as Record<string, unknown>)) {
      if (value === undefined) continue;
      const existing = out[key];
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        existing &&
        typeof existing === 'object' &&
        !Array.isArray(existing)
      ) {
        out[key] = mergeGroup(existing as object, value as object);
      } else {
        out[key] = value;
      }
    }
    return out as T;
  };

  return mergeGroup(current, patch as DeepPartial<UserSettings>);
}

export function parseSettings(row: UserRow, settingsRow: SettingsRow | undefined): UserSettings {
  const base = defaultSettings(row);
  if (!settingsRow) return base;
  try {
    const parsed = JSON.parse(settingsRow.data) as DeepPartial<UserSettings>;
    const merged = mergeSettings(base, {
      ...parsed,
      // arrays are replaced wholesale, never merged element-wise
      dashboardWidgets: normalizeWidgets(
        parsed.dashboardWidgets as UserSettings['dashboardWidgets'] | undefined,
        base.dashboardWidgets,
      ),
    });
    return {
      ...merged,
      notifications: { ...base.notifications, ...(parsed.notifications ?? {}) },
      dashboardWidgets: normalizeWidgets(
        parsed.dashboardWidgets as UserSettings['dashboardWidgets'] | undefined,
        base.dashboardWidgets,
      ),
    };
  } catch {
    return base;
  }
}

function normalizeWidgets(
  value: UserSettings['dashboardWidgets'] | undefined,
  fallback: UserSettings['dashboardWidgets'],
): UserSettings['dashboardWidgets'] {
  if (!Array.isArray(value) || value.length === 0) return fallback;
  const known = new Set<string>(DASHBOARD_WIDGET_ORDER);
  const cleaned = value
    .filter((w) => w && typeof w.id === 'string' && known.has(w.id))
    .map((w) => ({ id: w.id as DashboardWidgetId, visible: w.visible !== false }));
  const missing = fallback.filter((w) => !cleaned.some((c) => c.id === w.id));
  return [...cleaned, ...missing];
}
