import type {
  FocusMode,
  GroupRole,
  HabitFrequency,
  NotificationKind,
  ParticipantState,
  Priority,
  ProjectStatus,
  Reaction,
  TaskStatus,
  ThemePref,
  GangStatus,
} from './primitives';
import type { DayKey } from './dates';
import type { Quadrant } from './primitives';
import type { RecurrenceRule } from './recurrence';

/* -------------------------------------------------------------------------- */
/*  Identity                                                                  */
/* -------------------------------------------------------------------------- */

export interface User {
  id: string;
  email: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  timezone: string;
  timezoneOffsetMinutes: number;
  weekStartsOn: 0 | 1;
  use24Hour: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AuthSession {
  user: User;
  accessToken: string;
  refreshToken: string;
  /** epoch ms */
  accessTokenExpiresAt: number;
}

export interface NotificationPreferences {
  taskReminder: boolean;
  deadline: boolean;
  overdue: boolean;
  habitReminder: boolean;
  focusScheduled: boolean;
  gangInvite: boolean;
  gangUpcoming: boolean;
  dailyPlanning: boolean;
  dailyReview: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

export const DASHBOARD_WIDGETS = [
  'greeting',
  'progress',
  'quick_add',
  'focus_cta',
  'today_tasks',
  'overdue',
  'important',
  'deadlines',
  'habits',
  'streaks',
  'heatmap',
  'focus_stats',
  'matrix_shortcut',
  'gang_sessions',
  'gang_shortcut',
  'projects',
  'summary',
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGETS)[number];

/** Widgets that show numbers rather than actionable content. */
export const STATISTIC_WIDGETS: DashboardWidgetId[] = ['progress', 'focus_stats', 'streaks', 'heatmap', 'summary'];

export interface DashboardWidget {
  id: DashboardWidgetId;
  visible: boolean;
}

/** Prebuilt dashboard arrangements the user can start from. */
export const DASHBOARD_LAYOUTS = ['balanced', 'minimal', 'focus', 'planner'] as const;
export type DashboardLayoutId = (typeof DASHBOARD_LAYOUTS)[number];

export const THEME_PRESETS = ['indigo', 'slate', 'ocean', 'forest', 'sunset', 'mono'] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number];

export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

export const RADIUS_STYLES = ['rounded', 'soft'] as const;
export type RadiusStyle = (typeof RADIUS_STYLES)[number];

export const ANIMATION_LEVELS = ['full', 'reduced', 'none'] as const;
export type AnimationLevel = (typeof ANIMATION_LEVELS)[number];

export const TASK_SORT_ORDERS = ['manual', 'due', 'priority', 'created', 'title'] as const;
export type TaskSortOrder = (typeof TASK_SORT_ORDERS)[number];

export const TASK_GROUPINGS = ['none', 'day', 'project', 'priority', 'quadrant'] as const;
export type TaskGrouping = (typeof TASK_GROUPINGS)[number];

export const TASK_DISPLAY_STYLES = ['comfortable', 'compact'] as const;
export type TaskDisplayStyle = (typeof TASK_DISPLAY_STYLES)[number];

export const MATRIX_DISPLAY_STYLES = ['grid', 'list'] as const;
export type MatrixDisplayStyle = (typeof MATRIX_DISPLAY_STYLES)[number];

export const DEFAULT_CLASSIFICATIONS = ['inbox', 'do_now', 'schedule', 'delegate', 'eliminate'] as const;
export type DefaultClassification = (typeof DEFAULT_CLASSIFICATIONS)[number];

export const CALENDAR_DISPLAYS = ['month', 'week', 'day'] as const;
export type CalendarDisplay = (typeof CALENDAR_DISPLAYS)[number];

export const FOCUS_COUNTDOWN_STYLES = ['ring', 'bar', 'digits'] as const;
export type FocusCountdownStyle = (typeof FOCUS_COUNTDOWN_STYLES)[number];

export const HABIT_DISPLAY_STYLES = ['list', 'grid'] as const;
export type HabitDisplayStyle = (typeof HABIT_DISPLAY_STYLES)[number];

export interface TaskDefaultsSettings {
  priority: Priority;
  estimateMinutes: number | null;
  reminderLeadMinutes: number | null;
  projectId: string | null;
  dueToday: boolean;
  classifyAtCreation: boolean;
}

export interface TaskDisplaySettings {
  style: TaskDisplayStyle;
  sort: TaskSortOrder;
  grouping: TaskGrouping;
  fields: {
    due: boolean;
    priority: boolean;
    project: boolean;
    estimate: boolean;
    tags: boolean;
    subtasks: boolean;
    description: boolean;
  };
}

export interface MatrixSettings {
  quadrantNames: Record<Quadrant, string>;
  quadrantDescriptions: Record<Quadrant, string>;
  defaultClassification: DefaultClassification;
  displayStyle: MatrixDisplayStyle;
  showHints: boolean;
}

export interface FocusSettings {
  sound: boolean;
  haptics: boolean;
  countdownStyle: FocusCountdownStyle;
  keepScreenAwake: boolean;
  dailyTargetMinutes: number;
}

export interface CalendarSettings {
  defaultEventMinutes: number;
  workingHoursStart: string;
  workingHoursEnd: string;
  display: CalendarDisplay;
  showCompleted: boolean;
  showHabits: boolean;
  showFocusSessions: boolean;
}

export interface HabitSettings {
  displayStyle: HabitDisplayStyle;
  showStreaks: boolean;
  showHeatmap: boolean;
}

export interface ThemeSettings {
  preset: ThemePreset;
  density: Density;
  radiusStyle: RadiusStyle;
  animationLevel: AnimationLevel;
  fontScale: number;
}

export interface DemoDataState {
  enabled: boolean;
  loadedAt: number | null;
  projectIds: string[];
  habitIds: string[];
  noteIds: string[];
}

export interface UserSettings {
  theme: ThemePref;
  accentColor: string;
  weekStartsOn: 0 | 1;
  use24Hour: boolean;
  defaultTaskDurationMinutes: number;
  dayStartTime: string;
  dayEndTime: string;
  pomodoroFocusMinutes: number;
  pomodoroShortBreakMinutes: number;
  pomodoroLongBreakMinutes: number;
  pomodoroSessionsBeforeLongBreak: number;
  autoStartBreaks: boolean;
  autoStartNextSession: boolean;
  dailyPlanningReminder: string | null;
  dailyReviewReminder: string | null;
  dashboardWidgets: DashboardWidget[];
  dashboardLayout: DashboardLayoutId;
  leaderboardEnabled: boolean;
  notifications: NotificationPreferences;
  appearance: ThemeSettings;
  taskDefaults: TaskDefaultsSettings;
  taskDisplay: TaskDisplaySettings;
  matrix: MatrixSettings;
  focus: FocusSettings;
  calendar: CalendarSettings;
  habits: HabitSettings;
  /** Bookkeeping for the optional sample workspace ("Try demo data"). */
  demoData: DemoDataState;
}

/* -------------------------------------------------------------------------- */
/*  Planning core                                                             */
/* -------------------------------------------------------------------------- */

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string | null;
  status: ProjectStatus;
  priority: Priority;
  dueDate: DayKey | null;
  tags: string[];
  taskCount: number;
  completedTaskCount: number;
  progress: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  status: TaskStatus;
  position: number;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Task {
  id: string;
  projectId: string | null;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  notes: string | null;
  status: TaskStatus;
  priority: Priority;
  important: boolean;
  urgent: boolean;
  dueDate: DayKey | null;
  dueTime: string | null;
  reminderAt: number | null;
  estimatedMinutes: number | null;
  actualMinutes: number;
  scheduledStart: number | null;
  scheduledEnd: number | null;
  /** Daily-plan membership. */
  planDate: DayKey | null;
  planOrder: number;
  isMustDo: boolean;
  recurrence: RecurrenceRule;
  recurredFromId: string | null;
  tags: string[];
  subtasks: Subtask[];
  completedAt: number | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  /** Server revision — used by the offline sync cursor. */
  seq: number;
}

/* -------------------------------------------------------------------------- */
/*  Focus                                                                     */
/* -------------------------------------------------------------------------- */

export interface FocusSession {
  id: string;
  taskId: string | null;
  taskTitle?: string | null;
  projectId: string | null;
  mode: FocusMode;
  label: string | null;
  plannedMinutes: number;
  actualSeconds: number;
  completed: boolean;
  startedAt: number;
  endedAt: number | null;
  interruptions: number;
  dayKey: DayKey;
  createdAt: number;
  updatedAt: number;
  seq: number;
  deletedAt: number | null;
}

export interface FocusStats {
  todayMinutes: number;
  weekMinutes: number;
  monthMinutes: number;
  totalMinutes: number;
  sessionsToday: number;
  sessionsWeek: number;
  averageSessionMinutes: number;
  streakDays: number;
  bestDayMinutes: number;
  dailyMinutes: Array<{ dayKey: DayKey; minutes: number; sessions: number }>;
  byProject: Array<{ projectId: string | null; projectName: string; minutes: number }>;
  byTask: Array<{ taskId: string; title: string; minutes: number; sessions: number }>;
}

/* -------------------------------------------------------------------------- */
/*  Habits                                                                    */
/* -------------------------------------------------------------------------- */

export interface Habit {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string;
  frequency: HabitFrequency;
  /** 0-6, required when `frequency === 'custom'` or to pin weekly days. */
  scheduleDays: number[];
  targetPerPeriod: number;
  reminderTime: string | null;
  archived: boolean;
  currentStreak: number;
  bestStreak: number;
  completionRate: number;
  recentCompletions: DayKey[];
  completedToday: boolean;
  createdAt: number;
  updatedAt: number;
  seq: number;
  deletedAt: number | null;
}

export interface HabitCompletion {
  id: string;
  habitId: string;
  dayKey: DayKey;
  count: number;
  note: string | null;
  createdAt: number;
  updatedAt: number;
  seq: number;
}

/* -------------------------------------------------------------------------- */
/*  Notes                                                                     */
/* -------------------------------------------------------------------------- */

export interface Note {
  id: string;
  title: string;
  body: string;
  projectId: string | null;
  taskId: string | null;
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  seq: number;
  deletedAt: number | null;
}

/* -------------------------------------------------------------------------- */
/*  Social                                                                    */
/* -------------------------------------------------------------------------- */

export interface GroupMember {
  userId: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  role: GroupRole;
  joinedAt: number;
  /** rolling 7 day focus minutes, only present when leaderboard is enabled */
  focusMinutes?: number;
  sessions?: number;
  tasksCompleted?: number;
  consistency?: number;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  emoji: string;
  inviteCode: string;
  ownerId: string;
  memberCount: number;
  members: GroupMember[];
  leaderboardEnabled: boolean;
  createdAt: number;
  updatedAt: number;
  seq: number;
  deletedAt: number | null;
}

export interface GangParticipant {
  userId: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  state: ParticipantState;
  focusSeconds: number;
  /** seconds remaining in this participant's current phase */
  secondsRemaining: number;
  isHost: boolean;
  joinedAt: number;
  lastSeenAt: number;
  reactionsSent: number;
}

export interface GangSession {
  id: string;
  groupId: string;
  groupName: string;
  title: string;
  hostId: string;
  /** shared schedule: when the authoritative clock started */
  startsAt: number;
  focusMinutes: number;
  breakMinutes: number;
  rounds: number;
  mode: FocusMode;
  status: GangStatus;
  /** server-authoritative anchor for the shared clock */
  clockAnchorAt: number;
  clockPausedMs: number;
  isClockPaused: boolean;
  currentRound: number;
  recurrence: RecurrenceRule | null;
  participants: GangParticipant[];
  createdAt: number;
  updatedAt: number;
  seq: number;
  deletedAt: number | null;
}

export interface GangReaction {
  id: string;
  sessionId: string;
  userId: string;
  name: string;
  reaction: Reaction;
  createdAt: number;
}

/** Server-pushed realtime envelope for gang sessions. */
export interface RealtimeEvent<T = unknown> {
  type:
    | 'hello'
    | 'presence'
    | 'session_state'
    | 'participant_update'
    | 'reaction'
    | 'session_completed'
    | 'pong';
  sessionId?: string;
  at: number;
  payload: T;
}

/* -------------------------------------------------------------------------- */
/*  Reviews, notifications, analytics                                         */
/* -------------------------------------------------------------------------- */

export interface DailyReview {
  id: string;
  dayKey: DayKey;
  reflection: string | null;
  mood: number | null;
  energy: number | null;
  tasksCompleted: number;
  tasksPlanned: number;
  focusMinutes: number;
  habitsCompleted: number;
  overdueCarryOver: number;
  tomorrowTopTaskId: string | null;
  createdAt: number;
  updatedAt: number;
  seq: number;
}

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  taskId: string | null;
  habitId: string | null;
  sessionId: string | null;
  groupId: string | null;
  scheduledFor: number;
  deliveredAt: number | null;
  readAt: number | null;
  createdAt: number;
}

export interface HeatmapCell {
  dayKey: DayKey;
  /** raw value for the selected metric */
  value: number;
  /** 0-4 intensity bucket */
  level: number;
  tasksCompleted: number;
  tasksCreated: number;
  focusMinutes: number;
  habitsCompleted: number;
  plannedTaskCount: number;
  productivityScore: number;
}

export interface HeatmapResponse {
  metric: HeatmapMetric;
  range: 'week' | 'month' | 'year';
  start: DayKey;
  end: DayKey;
  cells: HeatmapCell[];
  totals: {
    tasksCompleted: number;
    tasksCreated: number;
    focusMinutes: number;
    habitsCompleted: number;
    activeDays: number;
    bestDay: DayKey | null;
    bestDayValue: number;
  };
}

export type HeatmapMetric = 'tasks_completed' | 'tasks_created' | 'focus' | 'habits' | 'productivity';

/* -------------------------------------------------------------------------- */
/*  Search                                                                    */
/* -------------------------------------------------------------------------- */

export interface SearchResultItem {
  type: 'task' | 'project' | 'habit' | 'note';
  id: string;
  title: string;
  subtitle: string | null;
  /** 0..1 relevance, used only for ordering within a single result set. */
  score: number;
  meta: Record<string, unknown>;
}
