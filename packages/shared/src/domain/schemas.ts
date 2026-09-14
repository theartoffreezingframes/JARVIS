import { z } from 'zod';
import {
  FOCUS_MODES,
  GROUP_ROLES,
  HABIT_FREQUENCIES,
  PARTICIPANT_STATES,
  PRIORITIES,
  PROJECT_STATUSES,
  QUADRANTS,
  REACTIONS,
  RECURRENCE_KINDS,
  TASK_STATUSES,
  THEME_PREFS,
  NOTIFICATION_KINDS,
  dayKeySchema,
  hexColorSchema,
  tagNameSchema,
  timeOfDaySchema,
} from './primitives';
import {
  ANIMATION_LEVELS,
  CALENDAR_DISPLAYS,
  DASHBOARD_LAYOUTS,
  DASHBOARD_WIDGETS,
  DEFAULT_CLASSIFICATIONS,
  DENSITIES,
  FOCUS_COUNTDOWN_STYLES,
  HABIT_DISPLAY_STYLES,
  MATRIX_DISPLAY_STYLES,
  RADIUS_STYLES,
  TASK_DISPLAY_STYLES,
  TASK_GROUPINGS,
  TASK_SORT_ORDERS,
  THEME_PRESETS,
} from './models';

/* -------------------------------------------------------------------------- */
/*  Reusable field schemas                                                    */
/* -------------------------------------------------------------------------- */

export const idSchema = z.string().min(6).max(64);
const title = z.string().trim().min(1, 'Title is required').max(200);
const longText = z.string().max(20_000);
const minutes = z.number().int().min(0).max(24 * 60);
const optionalId = idSchema.nullish().transform((v) => v ?? null);
const nullableDayKey = dayKeySchema.nullish().transform((v) => v ?? null);

export const recurrenceRuleSchema = z.object({
  kind: z.enum(RECURRENCE_KINDS).default('none'),
  interval: z.number().int().min(1).max(365).default(1),
  byWeekday: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  until: nullableDayKey.default(null),
  count: z.number().int().min(0).default(0),
  maxOccurrences: z.number().int().min(1).max(1000).nullish().transform((v) => v ?? null),
});

export const eisenhowerFlagsSchema = z.object({
  important: z.boolean(),
  urgent: z.boolean(),
});

/* -------------------------------------------------------------------------- */
/*  Auth                                                                      */
/* -------------------------------------------------------------------------- */

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128)
  .refine((v) => /[a-zA-Z]/.test(v), 'Include at least one letter')
  .refine((v) => /[0-9]/.test(v), 'Include at least one number');

export const signUpSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: passwordSchema,
  name: z.string().trim().min(1, 'Name is required').max(80),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'At least 3 characters')
    .max(24)
    .regex(/^[a-z0-9_.]+$/, 'Letters, numbers, underscore and dot only'),
  timezone: z.string().max(64).default('UTC'),
  timezoneOffsetMinutes: z.number().int().min(-840).max(840).default(0),
  deviceName: z.string().max(80).nullish(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
  deviceName: z.string().max(80).nullish(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const changeEmailSchema = z.object({
  password: z.string().min(1),
  newEmail: z.string().trim().toLowerCase().email(),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(24)
    .regex(/^[a-z0-9_.]+$/)
    .optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
  bio: z.string().max(280).nullable().optional(),
  timezone: z.string().max(64).optional(),
  timezoneOffsetMinutes: z.number().int().min(-840).max(840).optional(),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
  use24Hour: z.boolean().optional(),
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1),
  confirm: z.literal('DELETE'),
});

/* -------------------------------------------------------------------------- */
/*  Settings                                                                  */
/* -------------------------------------------------------------------------- */

export const dashboardWidgetSchema = z.object({
  id: z.enum(DASHBOARD_WIDGETS),
  visible: z.boolean(),
});

export const taskDefaultsSettingsSchema = z.object({
  priority: z.enum(PRIORITIES),
  estimateMinutes: z.number().int().min(5).max(600).nullable(),
  reminderLeadMinutes: z.number().int().min(0).max(10_080).nullable(),
  projectId: z.string().min(3).max(64).nullable(),
  dueToday: z.boolean(),
  classifyAtCreation: z.boolean(),
});

export const taskDisplaySettingsSchema = z.object({
  style: z.enum(TASK_DISPLAY_STYLES),
  sort: z.enum(TASK_SORT_ORDERS),
  grouping: z.enum(TASK_GROUPINGS),
  fields: z.object({
    due: z.boolean(),
    priority: z.boolean(),
    project: z.boolean(),
    estimate: z.boolean(),
    tags: z.boolean(),
    subtasks: z.boolean(),
    description: z.boolean(),
  }),
});

const quadrantTextRecord = z.object({
  do_now: z.string().min(1).max(28),
  schedule: z.string().min(1).max(28),
  delegate: z.string().min(1).max(28),
  eliminate: z.string().min(1).max(28),
});

const quadrantDescriptionRecord = z.object({
  do_now: z.string().min(1).max(160),
  schedule: z.string().min(1).max(160),
  delegate: z.string().min(1).max(160),
  eliminate: z.string().min(1).max(160),
});

export const matrixSettingsSchema = z.object({
  quadrantNames: quadrantTextRecord,
  quadrantDescriptions: quadrantDescriptionRecord,
  defaultClassification: z.enum(DEFAULT_CLASSIFICATIONS),
  displayStyle: z.enum(MATRIX_DISPLAY_STYLES),
  showHints: z.boolean(),
});

export const focusSettingsSchema = z.object({
  sound: z.boolean(),
  haptics: z.boolean(),
  countdownStyle: z.enum(FOCUS_COUNTDOWN_STYLES),
  keepScreenAwake: z.boolean(),
  dailyTargetMinutes: z.number().int().min(15).max(720),
});

export const calendarSettingsSchema = z.object({
  defaultEventMinutes: z.number().int().min(5).max(600),
  workingHoursStart: timeOfDaySchema,
  workingHoursEnd: timeOfDaySchema,
  display: z.enum(CALENDAR_DISPLAYS),
  showCompleted: z.boolean(),
  showHabits: z.boolean(),
  showFocusSessions: z.boolean(),
});

export const habitSettingsSchema = z.object({
  displayStyle: z.enum(HABIT_DISPLAY_STYLES),
  showStreaks: z.boolean(),
  showHeatmap: z.boolean(),
});

export const demoDataSettingsSchema = z.object({
  enabled: z.boolean(),
  loadedAt: z.number().int().nullable(),
  projectIds: z.array(idSchema).max(50),
  habitIds: z.array(idSchema).max(50),
  noteIds: z.array(idSchema).max(100),
});

export const themeSettingsSchema = z.object({
  preset: z.enum(THEME_PRESETS),
  density: z.enum(DENSITIES),
  radiusStyle: z.enum(RADIUS_STYLES),
  animationLevel: z.enum(ANIMATION_LEVELS),
  fontScale: z.number().min(0.85).max(1.3),
});

export const notificationPreferencesSchema = z.object({
  taskReminder: z.boolean(),
  deadline: z.boolean(),
  overdue: z.boolean(),
  habitReminder: z.boolean(),
  focusScheduled: z.boolean(),
  gangInvite: z.boolean(),
  gangUpcoming: z.boolean(),
  dailyPlanning: z.boolean(),
  dailyReview: z.boolean(),
  quietHoursStart: timeOfDaySchema.nullable(),
  quietHoursEnd: timeOfDaySchema.nullable(),
});

export const updateSettingsSchema = z.object({
  theme: z.enum(THEME_PREFS).optional(),
  accentColor: hexColorSchema.optional(),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
  use24Hour: z.boolean().optional(),
  defaultTaskDurationMinutes: z.number().int().min(5).max(600).optional(),
  dayStartTime: timeOfDaySchema.optional(),
  dayEndTime: timeOfDaySchema.optional(),
  pomodoroFocusMinutes: z.number().int().min(1).max(180).optional(),
  pomodoroShortBreakMinutes: z.number().int().min(1).max(60).optional(),
  pomodoroLongBreakMinutes: z.number().int().min(1).max(120).optional(),
  pomodoroSessionsBeforeLongBreak: z.number().int().min(2).max(12).optional(),
  autoStartBreaks: z.boolean().optional(),
  autoStartNextSession: z.boolean().optional(),
  dailyPlanningReminder: timeOfDaySchema.nullable().optional(),
  dailyReviewReminder: timeOfDaySchema.nullable().optional(),
  dashboardWidgets: z.array(dashboardWidgetSchema).max(24).optional(),
  dashboardLayout: z.enum(DASHBOARD_LAYOUTS).optional(),
  leaderboardEnabled: z.boolean().optional(),
  notifications: notificationPreferencesSchema.partial().optional(),
  appearance: themeSettingsSchema.partial().optional(),
  taskDefaults: taskDefaultsSettingsSchema.partial().optional(),
  taskDisplay: taskDisplaySettingsSchema
    .extend({ fields: taskDisplaySettingsSchema.shape.fields.partial() })
    .partial()
    .optional(),
  matrix: matrixSettingsSchema
    .extend({
      quadrantNames: quadrantTextRecord.partial(),
      quadrantDescriptions: quadrantDescriptionRecord.partial(),
    })
    .partial()
    .optional(),
  focus: focusSettingsSchema.partial().optional(),
  calendar: calendarSettingsSchema.partial().optional(),
  habits: habitSettingsSchema.partial().optional(),
  demoData: demoDataSettingsSchema.optional(),
});

/* -------------------------------------------------------------------------- */
/*  Tasks                                                                     */
/* -------------------------------------------------------------------------- */

export const taskCreateSchema = z.object({
  title,
  description: longText.nullish().transform((v) => v ?? null),
  notes: longText.nullish().transform((v) => v ?? null),
  projectId: optionalId.default(null),
  parentTaskId: optionalId.default(null),
  priority: z.enum(PRIORITIES).default('medium'),
  important: z.boolean().default(false),
  urgent: z.boolean().default(false),
  dueDate: nullableDayKey.default(null),
  dueTime: timeOfDaySchema.nullish().transform((v) => v ?? null),
  reminderAt: z.number().int().nullish().transform((v) => v ?? null),
  estimatedMinutes: minutes.nullish().transform((v) => v ?? null),
  scheduledStart: z.number().int().nullish().transform((v) => v ?? null),
  scheduledEnd: z.number().int().nullish().transform((v) => v ?? null),
  planDate: nullableDayKey.default(null),
  planOrder: z.number().int().min(0).default(0),
  isMustDo: z.boolean().default(false),
  status: z.enum(TASK_STATUSES).default('todo'),
  tags: z.array(tagNameSchema).max(12).default([]),
  recurrence: recurrenceRuleSchema.optional(),
  subtasks: z.array(z.object({ title, position: z.number().int().min(0).default(0) })).max(50).default([]),
  /** client-generated id enables idempotent offline replay */
  clientId: idSchema.nullish().transform((v) => v ?? null),
});

export const taskUpdateSchema = z.object({
  title: title.optional(),
  description: longText.nullable().optional(),
  notes: longText.nullable().optional(),
  projectId: optionalId.optional(),
  priority: z.enum(PRIORITIES).optional(),
  important: z.boolean().optional(),
  urgent: z.boolean().optional(),
  dueDate: nullableDayKey.optional(),
  dueTime: timeOfDaySchema.nullable().optional(),
  reminderAt: z.number().int().nullable().optional(),
  estimatedMinutes: minutes.nullable().optional(),
  actualMinutes: minutes.optional(),
  scheduledStart: z.number().int().nullable().optional(),
  scheduledEnd: z.number().int().nullable().optional(),
  planDate: nullableDayKey.optional(),
  planOrder: z.number().int().min(0).optional(),
  isMustDo: z.boolean().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  tags: z.array(tagNameSchema).max(12).optional(),
  recurrence: recurrenceRuleSchema.optional(),
  /** optimistic concurrency: reject if the server is ahead */
  expectedUpdatedAt: z.number().int().optional(),
});

export const taskQuerySchema = z.object({
  view: z.enum(['today', 'upcoming', 'overdue', 'all', 'inbox', 'completed', 'archived', 'matrix']).default('all'),
  projectId: z.string().optional(),
  tag: z.string().optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  quadrant: z.enum(QUADRANTS).optional(),
  search: z.string().max(120).optional(),
  from: dayKeySchema.optional(),
  to: dayKeySchema.optional(),
  includeCompleted: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  cursor: z.string().optional(),
});

export const subtaskInputSchema = z.object({
  title,
  position: z.number().int().min(0).default(0),
  status: z.enum(TASK_STATUSES).default('todo'),
});

export const reorderTasksSchema = z.object({
  updates: z
    .array(
      z.object({
        id: idSchema,
        planOrder: z.number().int().min(0).optional(),
        isMustDo: z.boolean().optional(),
        planDate: nullableDayKey.optional(),
        scheduledStart: z.number().int().nullable().optional(),
        scheduledEnd: z.number().int().nullable().optional(),
        dueDate: nullableDayKey.optional(),
        dueTime: timeOfDaySchema.nullable().optional(),
        important: z.boolean().optional(),
        urgent: z.boolean().optional(),
        status: z.enum(TASK_STATUSES).optional(),
      }),
    )
    .min(1)
    .max(200),
});

export const quickPlanSchema = z.object({
  dayKey: dayKeySchema,
  mustDo: z.array(idSchema).max(20).default([]),
  niceToHave: z.array(idSchema).max(50).default([]),
  order: z.array(idSchema).max(80).default([]),
});

export const naturalLanguageTaskSchema = z.object({
  input: z.string().trim().min(2).max(500),
  timezoneOffsetMinutes: z.number().int().min(-840).max(840),
  now: z.number().int().optional(),
});

/* -------------------------------------------------------------------------- */
/*  Projects / tags / notes                                                   */
/* -------------------------------------------------------------------------- */

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: longText.nullish().transform((v) => v ?? null),
  color: hexColorSchema.default('#6C5CE7'),
  icon: z.string().max(40).nullish().transform((v) => v ?? null),
  status: z.enum(PROJECT_STATUSES).default('active'),
  priority: z.enum(PRIORITIES).default('medium'),
  dueDate: nullableDayKey.default(null),
  tags: z.array(tagNameSchema).max(12).default([]),
  clientId: idSchema.nullish().transform((v) => v ?? null),
});

export const projectUpdateSchema = projectCreateSchema.partial().omit({ clientId: true });

export const tagUpsertSchema = z.object({
  name: tagNameSchema,
  color: hexColorSchema.default('#8A8F98'),
});

export const noteCreateSchema = z.object({
  title: z.string().trim().max(160).default(''),
  body: longText.default(''),
  projectId: optionalId.default(null),
  taskId: optionalId.default(null),
  tags: z.array(tagNameSchema).max(12).default([]),
  pinned: z.boolean().default(false),
  clientId: idSchema.nullish().transform((v) => v ?? null),
});

export const noteUpdateSchema = noteCreateSchema.partial().omit({ clientId: true });

/* -------------------------------------------------------------------------- */
/*  Habits                                                                    */
/* -------------------------------------------------------------------------- */

export const habitCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: longText.nullish().transform((v) => v ?? null),
  icon: z.string().max(40).nullish().transform((v) => v ?? null),
  color: hexColorSchema.default('#22C55E'),
  frequency: z.enum(HABIT_FREQUENCIES).default('daily'),
  scheduleDays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  targetPerPeriod: z.number().int().min(1).max(10).default(1),
  reminderTime: timeOfDaySchema.nullish().transform((v) => v ?? null),
  clientId: idSchema.nullish().transform((v) => v ?? null),
});

export const habitUpdateSchema = habitCreateSchema.partial().omit({ clientId: true }).extend({
  archived: z.boolean().optional(),
});

export const habitToggleSchema = z.object({
  dayKey: dayKeySchema,
  completed: z.boolean(),
  note: z.string().max(500).nullish(),
  clientId: idSchema.nullish(),
});

/* -------------------------------------------------------------------------- */
/*  Focus                                                                     */
/* -------------------------------------------------------------------------- */

export const focusSessionStartSchema = z.object({
  taskId: optionalId.default(null),
  projectId: optionalId.default(null),
  mode: z.enum(FOCUS_MODES).default('pomodoro'),
  label: z.string().max(120).nullish().transform((v) => v ?? null),
  plannedMinutes: z.number().int().min(1).max(480),
  startedAt: z.number().int().optional(),
  dayKey: dayKeySchema.optional(),
  clientId: idSchema.nullish().transform((v) => v ?? null),
});

export const focusSessionUpdateSchema = z.object({
  actualSeconds: z.number().int().min(0).max(24 * 3600),
  completed: z.boolean().default(true),
  interruptions: z.number().int().min(0).max(100).default(0),
  endedAt: z.number().int().optional(),
  taskId: optionalId.optional(),
});

/* -------------------------------------------------------------------------- */
/*  Daily review                                                              */
/* -------------------------------------------------------------------------- */

export const dailyReviewUpsertSchema = z.object({
  dayKey: dayKeySchema,
  reflection: z.string().max(4000).nullish(),
  mood: z.number().int().min(1).max(5).nullish(),
  energy: z.number().int().min(1).max(5).nullish(),
  tomorrowTopTaskId: optionalId,
  /** optional rollover of unfinished tasks to a new day */
  rolloverTaskIds: z.array(idSchema).max(200).optional(),
  rolloverTo: dayKeySchema.optional(),
});

/* -------------------------------------------------------------------------- */
/*  Groups & gang sessions                                                    */
/* -------------------------------------------------------------------------- */

export const groupCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(400).nullish().transform((v) => v ?? null),
  emoji: z.string().max(8).default('🔥'),
  leaderboardEnabled: z.boolean().default(false),
  clientId: idSchema.nullish().transform((v) => v ?? null),
});

export const groupUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(400).nullable().optional(),
  emoji: z.string().max(8).optional(),
  leaderboardEnabled: z.boolean().optional(),
});

export const groupJoinSchema = z.object({
  inviteCode: z.string().trim().toUpperCase().min(4).max(12),
});

export const groupMemberUpdateSchema = z.object({
  role: z.enum(GROUP_ROLES),
});

export const gangSessionCreateSchema = z.object({
  groupId: idSchema,
  title: z.string().trim().min(1).max(120),
  startsAt: z.number().int(),
  focusMinutes: z.number().int().min(1).max(240),
  breakMinutes: z.number().int().min(0).max(60).default(5),
  rounds: z.number().int().min(1).max(12).default(1),
  mode: z.enum(FOCUS_MODES).default('deep_work'),
  recurrence: recurrenceRuleSchema.nullish().transform((v) => v ?? null),
  /** participant user ids to invite immediately */
  inviteUserIds: z.array(idSchema).max(50).default([]),
  clientId: idSchema.nullish().transform((v) => v ?? null),
});

export const gangParticipantUpdateSchema = z.object({
  state: z.enum(PARTICIPANT_STATES),
});

export const gangReactionSchema = z.object({
  reaction: z.enum(REACTIONS),
});

export const gangControlSchema = z.object({
  action: z.enum(['start', 'pause', 'resume', 'skip', 'stop', 'extend']),
  /** seconds to add when action === 'extend' */
  seconds: z.number().int().min(30).max(3600).optional(),
});

/* -------------------------------------------------------------------------- */
/*  Search & notifications                                                    */
/* -------------------------------------------------------------------------- */

export const searchQuerySchema = z.object({
  q: z.string().trim().max(120).default(''),
  types: z
    .array(z.enum(['task', 'project', 'habit', 'note']))
    .default(['task', 'project', 'habit', 'note']),
  projectId: z.string().optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  tags: z.array(z.string()).optional(),
  from: dayKeySchema.optional(),
  to: dayKeySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const notificationQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const notificationCreateSchema = z.object({
  kind: z.enum(NOTIFICATION_KINDS),
  title: z.string().min(1).max(160),
  body: z.string().max(400).default(''),
  taskId: optionalId.default(null),
  habitId: optionalId.default(null),
  sessionId: optionalId.default(null),
  groupId: optionalId.default(null),
  scheduledFor: z.number().int(),
});

/* -------------------------------------------------------------------------- */
/*  Offline sync                                                              */
/* -------------------------------------------------------------------------- */

export const syncOperationSchema = z.object({
  /** client mutation id used for idempotent replay */
  id: idSchema,
  entity: z.enum(['task', 'subtask', 'project', 'habit', 'habit_completion', 'focus_session', 'note', 'daily_review', 'settings']),
  op: z.enum(['create', 'update', 'delete', 'toggle']),
  /** entity id (server id when known, otherwise the client id) */
  entityId: z.string().min(1).max(64),
  payload: z.record(z.string(), z.unknown()).default({}),
  /** local timestamp of the mutation */
  clientTimestamp: z.number().int(),
  /** last known server updatedAt for conflict detection */
  baseUpdatedAt: z.number().int().nullish(),
});

export const syncPushSchema = z.object({
  deviceId: z.string().min(4).max(64),
  operations: z.array(syncOperationSchema).max(500),
});

export const syncPullSchema = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export interface SyncConflict {
  entity: string;
  entityId: string;
  reason: 'server_newer' | 'deleted_on_server' | 'missing';
  server: unknown;
  client: unknown;
}

/* -------------------------------------------------------------------------- */
/*  Export                                                                    */
/* -------------------------------------------------------------------------- */

export const exportQuerySchema = z.object({
  format: z.enum(['json', 'csv']).default('json'),
});

/* -------------------------------------------------------------------------- */
/*  Inferred input types                                                      */
/* -------------------------------------------------------------------------- */

export type SignUpInput = z.infer<typeof signUpSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type HabitCreateInput = z.infer<typeof habitCreateSchema>;
export type NoteCreateInput = z.infer<typeof noteCreateSchema>;
export type GroupCreateInput = z.infer<typeof groupCreateSchema>;
export type GangSessionCreateInput = z.infer<typeof gangSessionCreateSchema>;
export type SyncOperation = z.infer<typeof syncOperationSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type DailyReviewInput = z.infer<typeof dailyReviewUpsertSchema>;
