/**
 * Types for the API envelopes the app consumes.
 *
 * Domain entities come from `@jarvis/shared` so the mobile client and the server
 * can never disagree about a field name or a union member.
 */
import type {
  AppNotification,
  DailyReview,
  DayPlan,
  DashboardWidget,
  FocusSession,
  FocusStats,
  GangReaction,
  GangSession,
  Group,
  Habit,
  HeatmapResponse,
  Note,
  NotificationPreferences,
  ParsedTaskDraft,
  ProductivityBreakdown,
  Project,
  SearchResultItem,
  Subtask,
  Tag,
  Task,
  UserSettings,
} from '@jarvis/shared';

export type { Task, Subtask, Project, Habit, Note, FocusSession, FocusStats, Group, GangSession, GangReaction, DailyReview, AppNotification, HeatmapResponse, SearchResultItem, Tag, ParsedTaskDraft, ProductivityBreakdown, UserSettings, DayPlan, DashboardWidget, NotificationPreferences };

/** Partial at every level — used by settings patches that touch one field. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[]
    ? U[]
    : T[K] extends object
      ? DeepPartial<T[K]> | T[K]
      : T[K];
};

export interface TaskCounts {
  total: number;
  open: number;
  done: number;
  overdue: number;
}

export interface TasksResponse {
  tasks: Task[];
  today: string;
  counts: TaskCounts;
}

export type QuadrantCounts = { do_now: number; schedule: number; delegate: number; eliminate: number };

export interface MatrixResponse {
  counts: QuadrantCounts;
  tasks: Task[];
  today: string;
}

export interface DashboardResponse {
  today: string;
  greetingHour: number;
  progress: {
    planned: number;
    completed: number;
    percent: number;
    remaining: number;
    overdue: number;
    important: number;
    upcoming: number;
  };
  tasks: Task[];
  plan: DayPlan;
  habits: Habit[];
  habitSummary: {
    completionRate: number;
    currentBestStreak: number;
    bestStreak: number;
    scheduledToday: number;
    completedToday: number;
    activeHabits: number;
  };
  focus: FocusStats;
  activity: {
    dayKey: string;
    tasksCompleted: number;
    tasksCreated: number;
    focusMinutes: number;
    habitsCompleted: number;
    habitsScheduled: number;
    plannedTaskCount: number;
    plannedCompletedCount: number;
    importantNotUrgentCompleted: number;
    overdueTasks: number;
    reviewed: boolean;
  };
  score: ProductivityBreakdown;
  matrix: {
    counts: QuadrantCounts;
    suggestions: Array<{ id: string; severity: string; quadrant: string; title: string; body: string }>;
  };
  upcomingDeadlines: Task[];
  nextGangSession: GangSession | null;
  activeGangSession: GangSession | null;
  sessionStreak: number;
  focusTodayTarget: number;
}

export interface HabitsResponse {
  habits: Habit[];
}

export interface HabitHeatmapResponse {
  from: string;
  to: string;
  cells: Array<{ dayKey: string; value: number }>;
  total: number;
  activeDays: number;
}

export interface ProjectsResponse {
  projects: Project[];
  summary: { active: number; completed: number; tasks: number; completedTasks: number };
}

export interface ProjectOverviewResponse {
  project: Project;
  tasks: Task[];
  notes: Note[];
  stats: { total: number; open: number; completed: number; overdue: number; estimatedMinutes: number; focusMinutes: number };
  nextUp: Task[];
}

export interface NotesResponse {
  notes: Note[];
}

export interface PlannerResponse {
  day: string;
  today: string;
  plan: DayPlan;
  plannedTasks: Task[];
  candidates: Task[];
  capacity: {
    windowMinutes: number;
    capacityMinutes: number;
    plannedMinutes: number;
    remainingMinutes: number;
    utilization: number;
    overCapacityBy: number;
  };
  warnings: DayPlan['warnings'];
  settings: { dayStartTime: string; dayEndTime: string };
}

export interface CalendarResponse {
  from: string;
  to: string;
  view: 'month' | 'week' | 'day';
  today: string;
  settings: { weekStartsOn: number; use24Hour: boolean; dayStartTime: string; dayEndTime: string };
  tasks: Task[];
  undated: Task[];
  scheduled: Task[];
  habits: Habit[];
  habitDays: Array<{
    habitId: string;
    name: string;
    color: string;
    icon: string | null;
    completedToday: boolean;
    reminderTime: string | null;
    days: string[];
  }>;
  focusSessions: Array<{ id: string; taskId: string | null; label: string | null; startedAt: number; minutes: number; mode: string; dayKey: string }>;
  gangSessions: GangSession[];
  monthGrid: string[];
  monthLabel: string;
}

export interface FocusPresetsResponse {
  presets: Array<{ id: string; label: string; mode: string; focusMinutes: number; breakMinutes: number; rounds: number }>;
}

export interface FocusSessionsResponse {
  sessions: FocusSession[];
  today: string;
}

export interface AnalyticsResponse {
  range: { from: string; to: string; label: string };
  tasks: {
    created: number;
    completed: number;
    open: number;
    overdue: number;
    completionRate: number;
    averageCompletionHours: number;
    byQuadrant: QuadrantCounts;
    byPriority: Record<string, number>;
  };
  focus: FocusStats;
  habits: DashboardResponse['habitSummary'];
  planning: { planned: number; completedPlanned: number; rescheduled: number; overdue: number; adherencePercent: number };
  trends: {
    focus: { direction: string; changePercent: number; average: number };
    completion: { direction: string; changePercent: number; average: number };
  };
  daily: Array<{ dayKey: string; tasksCompleted: number; focusMinutes: number; habitsCompleted: number; score: number }>;
  insights: string[];
  activityStreak: number;
  weeklyComparison: { thisWeekFocus: number; lastWeekFocus: number; thisWeekTasks: number; lastWeekTasks: number };
}

export interface ReviewDayResponse {
    dayKey: string;
    tasks: { planned: number; completed: number; remaining: number; overdue: number; created: number };
    focusMinutes: number;
    focusSessions: FocusSession[];
    habits: Habit[];
    habitSummary: DashboardResponse['habitSummary'];
    activity: DashboardResponse['activity'];
    score: ProductivityBreakdown;
  review: DailyReview | null;
  tomorrowTopTaskId: string | null;
  tomorrow?: { planned: Task[]; suggestions: Task[] };
  summary?: {
    completionPercent: number;
    focusMinutes: number;
    habitsCompleted: number;
    habitsScheduled: number;
    overdueCount: number;
    remainingCount: number;
  };
}

export interface ReviewPromptResponse {
  shouldPrompt: boolean;
  summary: ReviewDayResponse;
}

export interface ReviewsResponse {
  reviews: DailyReview[];
}

export interface GroupsResponse {
  groups: Group[];
  friendCount: number;
}

export interface GroupDetailResponse {
  group: Group;
  sessions: GangSession[];
}

export interface LeaderboardResponse {
  enabled: boolean;
  entries: Array<{
    userId: string;
    name: string;
    username: string;
    avatarUrl: string | null;
    focusMinutes: number;
    sessions: number;
    tasksCompleted: number;
    consistency: number;
    isYou?: boolean;
  }>;
  periodDays: number;
}

export interface GangListResponse {
  active: GangSession[];
  scheduled: GangSession[];
  history: GangSession[];
  serverTime: number;
}

export interface GangDetailResponse {
  session: GangSession;
  clock: {
    phase: 'focus' | 'break' | 'finished';
    phaseSecondsRemaining: number;
    phaseSecondsElapsed: number;
    totalSeconds: number;
    elapsedSeconds: number;
    currentRound: number;
    totalRounds: number;
    isPaused: boolean;
    focusSecondsPerRound: number;
    breakSecondsPerRound: number;
  };
  reactions: GangReaction[];
  serverTime: number;
}

export interface NotificationsResponse {
  notifications: AppNotification[];
  unreadCount: number;
  scheduled: AppNotification[];
  preferences: NotificationPreferences;
  serverTime: number;
}

export interface FriendEntry {
  friendshipId: string;
  status: string;
  direction: string;
  user: { id: string; name: string; username: string; avatarUrl: string | null };
}

export interface FriendsResponse {
  accepted: FriendEntry[];
  incoming: FriendEntry[];
  outgoing: FriendEntry[];
}

export interface SearchResponse {
  results: SearchResultItem[];
  counts: { task: number; project: number; habit: number; note: number };
}

export interface MeResponse {
  user: {
    id: string;
    email: string;
    name: string;
    username: string;
    avatarUrl: string | null;
    bio: string | null;
    timezone: string;
    timezoneOffsetMinutes: number;
    weekStartsOn: number;
    use24Hour: boolean;
    createdAt: number;
    updatedAt: number;
  };
  settings: UserSettings;
}
