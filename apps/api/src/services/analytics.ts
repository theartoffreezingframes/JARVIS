import type {
  ActivityDay,
  DailyReview,
  DayKey,
  FocusStats,
  HeatmapMetric,
  HeatmapResponse,
  MatrixSuggestion,
  Quadrant,
  Task,
} from '@jarvis/shared';
import {
  addDays,
  buildDayPlan,
  buildHeatmap,
  eachDayKey,
  habitScheduledOn,
  matrixSuggestions,
  productivityScore,
  startOfWeekKey,
  todayKey,
  trendOf,
  weekdayOfKey,
} from '@jarvis/shared';
import type { Db } from '../db/index.js';
import { getDb, one } from '../db/index.js';
import { getActivityDays, recomputeActivityDay, toActivityMap } from '../repo/activity.js';
import { focusStats, listFocusSessions } from '../repo/focus.js';
import { habitStats, listHabits } from '../repo/habits.js';
import { listNotes, countNotes } from '../repo/notes.js';
import { listProjects } from '../repo/projects.js';
import { matrixTasks, taskCountsByStatus, taskStats, listTasks } from '../repo/tasks.js';
import type { UserRow } from '../repo/rows.js';
import { listUpcomingForUser } from './gang.js';
import { listSessionsForUser } from '../repo/gang.js';
import { hydrateSessions } from '../repo/gang.js';
import { listNotifications } from '../repo/notifications.js';

export function userToday(user: UserRow, now = Date.now()): DayKey {
  return todayKey(now, user.tz_offset_minutes);
}

/* -------------------------------------------------------------------------- */
/*  Dashboard                                                                 */
/* -------------------------------------------------------------------------- */

export interface DashboardSummary {
  today: DayKey;
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
  plan: ReturnType<typeof buildDayPlan>;
  habits: ReturnType<typeof listHabits>;
  habitSummary: ReturnType<typeof habitStats>;
  focus: FocusStats;
  activity: ActivityDay;
  score: ReturnType<typeof productivityScore>;
  matrix: { counts: Record<Quadrant, number>; suggestions: MatrixSuggestion[] };
  upcomingDeadlines: Task[];
  nextGangSession: ReturnType<typeof listUpcomingForUser>[number] | null;
  activeGangSession: ReturnType<typeof hydrateSessions>[number] | null;
  sessionStreak: number;
  focusTodayTarget: number;
}

export function dashboardSummary(user: UserRow, settings: { dayStartTime: string; dayEndTime: string; defaultTaskDurationMinutes: number; pomodoroFocusMinutes: number } , now = Date.now(), db: Db = getDb()): DashboardSummary {
  const today = userToday(user, now);
  const counts = taskCountsByStatus(user.id, today, db);
  const tasks = listTasks(user.id, { view: 'today', today, limit: 200 }, db);
  const openToday = tasks.filter((task) => task.status !== 'done');
  const doneToday = tasks.filter((task) => task.status === 'done');
  const planned = tasks.length;
  const completed = doneToday.length;

  const habits = listHabits(user.id, { today }, db);
  const habitSummary = habitStats(user.id, today, db);
  const focus = focusStats(user.id, today, db);
  const activityRow = getActivityDays(user.id, today, today, db)[0];
  const activity: ActivityDay = {
    dayKey: today,
    tasksCompleted: activityRow?.tasks_completed ?? completed,
    tasksCreated: activityRow?.tasks_created ?? 0,
    focusMinutes: activityRow?.focus_minutes ?? focus.todayMinutes,
    habitsCompleted: activityRow?.habit_completions ?? habitSummary.completedToday,
    habitsScheduled: habitSummary.scheduledToday,
    plannedTaskCount: activityRow?.planned_count ?? planned,
    plannedCompletedCount: activityRow?.planned_completed ?? completed,
    importantNotUrgentCompleted: activityRow?.important_not_urgent_done ?? 0,
    overdueTasks: activityRow?.overdue_count ?? counts.overdue,
    reviewed: activityRow?.reviewed === 1,
  };

  const score = productivityScore({
    dayKey: today,
    plannedTasks: Math.max(planned, completed),
    completedPlannedTasks: completed,
    completedTasks: completed,
    focusMinutes: activity.focusMinutes,
    focusGoalMinutes: 120,
    habitsScheduled: habitSummary.scheduledToday,
    habitsCompleted: habitSummary.completedToday,
    importantNotUrgentCompleted: activity.importantNotUrgentCompleted,
    overdueTasks: counts.overdue,
    reviewedDay: activity.reviewed,
  });

  const { counts: matrixCounts } = matrixTasks(user.id, today, db);
  const upcomingDeadlines = listTasks(user.id, { view: 'upcoming', today, limit: 20 }, db).slice(0, 6);

  const nowMinutes = Math.floor(((now + user.tz_offset_minutes * 60_000) % 86_400_000) / 60_000);
  const plan = buildDayPlan({
    dayKey: today,
    tasks: openToday.map((task) => ({
      id: task.id,
      title: task.title,
      estimatedMinutes: task.estimatedMinutes,
      isMustDo: task.isMustDo,
      planOrder: task.planOrder,
      priority: task.priority,
      dueDate: task.dueDate,
      dueTime: task.dueTime,
    })),
    nowMinutes,
    dayStartTime: settings.dayStartTime,
    dayEndTime: settings.dayEndTime,
  });

  const gangSessions = hydrateSessions(listSessionsForUser(user.id, 10, db), db);
  const activeGangSession =
    gangSessions.find((s) => s.status === 'running' || s.status === 'paused') ?? null;
  const nextGangSession =
    gangSessions.find((s) => s.status === 'scheduled' && s.startsAt >= now) ?? null;

  const streakDays = activityStreakDays(user, today, db);

  return {
    today,
    greetingHour: Math.floor(((now + user.tz_offset_minutes * 60_000) / 3_600_000) % 24),
    progress: {
      planned,
      completed,
      percent: planned ? Math.round((completed / planned) * 100) : 0,
      remaining: Math.max(0, planned - completed),
      overdue: counts.overdue,
      important: counts.important,
      upcoming: counts.upcoming,
    },
    tasks,
    plan,
    habits,
    habitSummary,
    focus,
    activity,
    score,
    matrix: { counts: matrixCounts, suggestions: matrixSuggestions(matrixCounts) },
    upcomingDeadlines,
    nextGangSession,
    activeGangSession,
    sessionStreak: streakDays,
    focusTodayTarget: settings.defaultTaskDurationMinutes ?? 25,
  };
}

function activityStreakDays(user: UserRow, today: DayKey, db: Db): number {
  const rows = getActivityDays(user.id, addDays(today, -180), today, db);
  const active = new Set(
    rows
      .filter((r) => r.tasks_completed > 0 || r.focus_minutes > 0 || r.habit_completions > 0)
      .map((r) => r.day_key),
  );
  let streak = 0;
  let cursor = today;
  if (!active.has(today)) cursor = addDays(today, -1);
  for (let i = 0; i < 181; i += 1) {
    if (active.has(cursor)) {
      streak += 1;
      cursor = addDays(cursor, -1);
    } else {
      break;
    }
  }
  return streak;
}

/* -------------------------------------------------------------------------- */
/*  Analytics overview                                                        */
/* -------------------------------------------------------------------------- */

export interface AnalyticsOverview {
  range: { from: DayKey; to: DayKey; label: string };
  tasks: ReturnType<typeof taskStats> & { byQuadrant: Record<Quadrant, number>; byPriority: Record<string, number> };
  focus: FocusStats;
  habits: ReturnType<typeof habitStats>;
  planning: {
    planned: number;
    completedPlanned: number;
    rescheduled: number;
    overdue: number;
    adherencePercent: number;
  };
  trends: {
    focus: ReturnType<typeof trendOf>;
    completion: ReturnType<typeof trendOf>;
  };
  daily: Array<{ dayKey: DayKey; tasksCompleted: number; focusMinutes: number; habitsCompleted: number; score: number }>;
  insights: string[];
  activityStreak: number;
  weeklyComparison: { thisWeekFocus: number; lastWeekFocus: number; thisWeekTasks: number; lastWeekTasks: number };
}

export function analyticsOverview(
  user: UserRow,
  range: { from: DayKey; to: DayKey; label: string },
  now = Date.now(),
  db: Db = getDb(),
): AnalyticsOverview {
  const today = userToday(user, now);
  const offsetMs = user.tz_offset_minutes * 60_000;
  const fromMs = Date.parse(`${range.from}T00:00:00Z`) - offsetMs;
  const toMs = Date.parse(`${range.to}T23:59:59Z`) - offsetMs;

  const stats = taskStats(user.id, fromMs, toMs, today, db);
  const focus = focusStats(user.id, today, db);
  const habitSummary = habitStats(user.id, today, db);
  const { counts: matrixCounts } = matrixTasks(user.id, today, db);

  const priorityRows = db
    .prepare(
      `SELECT priority, COUNT(*) AS c FROM tasks
        WHERE user_id = ? AND deleted_at IS NULL AND status NOT IN ('archived')
        GROUP BY priority`,
    )
    .all(user.id) as Array<{ priority: string; c: number }>;

  const activityRows = getActivityDays(user.id, range.from, range.to, db);
  const daily = activityRows.map((row) => {
    const day: ActivityDay = {
      dayKey: row.day_key as DayKey,
      tasksCompleted: row.tasks_completed,
      tasksCreated: row.tasks_created,
      focusMinutes: row.focus_minutes,
      habitsCompleted: row.habit_completions,
      habitsScheduled: 0,
      plannedTaskCount: row.planned_count,
      plannedCompletedCount: row.planned_completed,
      importantNotUrgentCompleted: row.important_not_urgent_done,
      overdueTasks: row.overdue_count,
      reviewed: row.reviewed === 1,
    };
    return {
      dayKey: day.dayKey,
      tasksCompleted: day.tasksCompleted,
      focusMinutes: day.focusMinutes,
      habitsCompleted: day.habitsCompleted,
      score: productivityScore({
        dayKey: day.dayKey,
        plannedTasks: Math.max(day.plannedTaskCount, day.plannedCompletedCount),
        completedPlannedTasks: day.plannedCompletedCount,
        completedTasks: day.tasksCompleted,
        focusMinutes: day.focusMinutes,
        habitsScheduled: day.habitsCompleted,
        habitsCompleted: day.habitsCompleted,
        importantNotUrgentCompleted: day.importantNotUrgentCompleted,
        overdueTasks: day.overdueTasks ?? 0,
        reviewedDay: day.reviewed,
      }).score,
    };
  });

  const planned = activityRows.reduce((s, r) => s + r.planned_count, 0);
  const completedPlanned = activityRows.reduce((s, r) => s + r.planned_completed, 0);
  const rescheduled = one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND plan_date IS NOT NULL
       AND due_date IS NOT NULL AND due_date > plan_date`,
    [user.id],
    db,
  )?.c ?? 0;

  const weekStart = startOfWeekKey(today, 1);
  const lastWeekStart = addDays(weekStart, -7);
  const thisWeek = getActivityDays(user.id, weekStart, addDays(weekStart, 6), db);
  const lastWeek = getActivityDays(user.id, lastWeekStart, addDays(lastWeekStart, 6), db);

  const focusTrend = trendOf(daily.map((d) => ({ dayKey: d.dayKey, value: d.focusMinutes })));
  const completionTrend = trendOf(daily.map((d) => ({ dayKey: d.dayKey, value: d.tasksCompleted })));

  return {
    range,
    tasks: {
      ...stats,
      byQuadrant: matrixCounts,
      byPriority: Object.fromEntries(priorityRows.map((row) => [row.priority, row.c])),
    },
    focus,
    habits: habitSummary,
    planning: {
      planned,
      completedPlanned,
      rescheduled,
      overdue: stats.overdue,
      adherencePercent: planned ? Math.round((completedPlanned / planned) * 100) : 0,
    },
    trends: { focus: focusTrend, completion: completionTrend },
    daily,
    insights: buildInsights({ stats, focus, habitSummary, matrixCounts, focusTrend, completionTrend, daily }),
    activityStreak: activityStreakDays(user, today, db),
    weeklyComparison: {
      thisWeekFocus: thisWeek.reduce((s, r) => s + r.focus_minutes, 0),
      lastWeekFocus: lastWeek.reduce((s, r) => s + r.focus_minutes, 0),
      thisWeekTasks: thisWeek.reduce((s, r) => s + r.tasks_completed, 0),
      lastWeekTasks: lastWeek.reduce((s, r) => s + r.tasks_completed, 0),
    },
  };
}

function buildInsights(input: {
  stats: ReturnType<typeof taskStats>;
  focus: FocusStats;
  habitSummary: ReturnType<typeof habitStats>;
  matrixCounts: Record<Quadrant, number>;
  focusTrend: ReturnType<typeof trendOf>;
  completionTrend: ReturnType<typeof trendOf>;
  daily: Array<{ dayKey: DayKey; focusMinutes: number; tasksCompleted: number }>;
}): string[] {
  const insights: string[] = [];
  const { stats, focus, habitSummary, matrixCounts, focusTrend, completionTrend, daily } = input;

  const bestDay = [...daily].sort((a, b) => b.focusMinutes - a.focusMinutes)[0];
  if (bestDay && bestDay.focusMinutes > 0) {
    const weekday = weekdayOfKey(bestDay.dayKey);
    insights.push(`Your strongest focus day was ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday] ?? bestDay.dayKey} with ${bestDay.focusMinutes} minutes.`);
  }
  if (focusTrend.direction === 'up') insights.push('Focus minutes are trending up over the selected range.');
  if (focusTrend.direction === 'down') insights.push('Focus minutes are trending down — consider protecting one long block tomorrow.');
  if (completionTrend.direction === 'up') insights.push('You are closing more tasks than earlier in the range.');
  if (stats.overdue > 0) {
    insights.push(`${stats.overdue} task${stats.overdue === 1 ? '' : 's'} are overdue. Rescheduling beats carrying them.`);
  }
  if (matrixCounts.do_now >= 5) {
    insights.push(`${matrixCounts.do_now} tasks sit in Do Now — a sign that planning time is being lost to firefighting.`);
  }
  if (matrixCounts.schedule === 0 && stats.open > 5) {
    insights.push('Nothing is in the Schedule quadrant. Long-term work needs protected time.');
  }
  if (habitSummary.completionRate > 0 && habitSummary.completionRate < 50) {
    insights.push(`Habit consistency is ${habitSummary.completionRate}%. Fewer, smaller habits tend to survive.`);
  }
  if (focus.averageSessionMinutes > 0 && focus.averageSessionMinutes < 15) {
    insights.push('Average sessions are under 15 minutes — try a 25 minute block to reduce context switching.');
  }
  if (focus.todayMinutes > 300) {
    insights.push('You have focused for over 5 hours today. Recovery is part of the system, not a break from it.');
  }
  if (!insights.length) insights.push('Not enough activity in this range yet — complete a few tasks to unlock insights.');
  return insights.slice(0, 6);
}

/* -------------------------------------------------------------------------- */
/*  Heat maps                                                                 */
/* -------------------------------------------------------------------------- */

export function heatmap(
  user: UserRow,
  options: { metric: HeatmapMetric; range: 'week' | 'month' | 'year'; anchor?: DayKey },
  db: Db = getDb(),
): HeatmapResponse {
  const today = userToday(user);
  const anchor = options.anchor ?? today;
  const from = options.range === 'year' ? `${anchor.slice(0, 4)}-01-01` : addDays(anchor, -400);
  const to = options.range === 'year' ? `${anchor.slice(0, 4)}-12-31` : addDays(anchor, 400);
  const rows = getActivityDays(user.id, from < to ? from : to, to, db);
  const activity = toActivityMap(rows);

  // Habits scheduled per day enrich the "habits" metric denominator.
  const habits = listHabits(user.id, { today }, db);
  const days = eachDayKey(
    options.range === 'week' ? addDays(anchor, -3) : options.range === 'month' ? `${anchor.slice(0, 7)}-01` : `${anchor.slice(0, 4)}-01-01`,
    options.range === 'week' ? addDays(anchor, 3) : options.range === 'month' ? addDays(`${anchor.slice(0, 7)}-01`, 40) : `${anchor.slice(0, 4)}-12-31`,
  );
  for (const day of days) {
    const existing = activity.get(day);
    const scheduled = habits.filter((habit) => habitScheduledOn(habit, day)).length;
    if (existing) existing.habitsScheduled = scheduled;
  }

  return buildHeatmap({
    metric: options.metric,
    range: options.range,
    anchor,
    weekStartsOn: user.week_starts_on === 1 ? 1 : 0,
    activity,
  });
}

/* -------------------------------------------------------------------------- */
/*  Daily review                                                              */
/* -------------------------------------------------------------------------- */

export interface DailyReviewPayload {
  dayKey: DayKey;
  tasks: { planned: Task[]; completed: Task[]; overdue: Task[]; incomplete: Task[] };
  focusMinutes: number;
  focusSessions: ReturnType<typeof listFocusSessions>;
  habits: ReturnType<typeof listHabits>;
  habitSummary: ReturnType<typeof habitStats>;
  activity: ActivityDay;
  score: ReturnType<typeof productivityScore>;
  review: DailyReview | null;
  tomorrowTopTaskId: string | null;
}

export function dailyReviewPayload(user: UserRow, dayKey: DayKey, db: Db = getDb()): DailyReviewPayload {
  const tasks = listTasks(user.id, { view: 'all', today: dayKey, limit: 300 }, db);
  const completed = tasks.filter((t) => t.status === 'done');
  const planned = tasks.filter((t) => t.planDate === dayKey || t.dueDate === dayKey);
  const incomplete = planned.filter((t) => t.status !== 'done');
  const overdue = listTasks(user.id, { view: 'overdue', today: dayKey, limit: 100 }, db);
  const habits = listHabits(user.id, { today: dayKey }, db);
  const habitSummary = habitStats(user.id, dayKey, db);
  const sessions = listFocusSessions(user.id, { from: dayKey, to: dayKey, limit: 100 }, db);
  const focusMinutes = sessions.reduce((sum, s) => sum + Math.round(s.actualSeconds / 60), 0);

  const row = getActivityDays(user.id, dayKey, dayKey, db)[0];
  const activity: ActivityDay = {
    dayKey,
    tasksCompleted: row?.tasks_completed ?? completed.length,
    tasksCreated: row?.tasks_created ?? 0,
    focusMinutes: row?.focus_minutes ?? focusMinutes,
    habitsCompleted: row?.habit_completions ?? habitSummary.completedToday,
    habitsScheduled: habitSummary.scheduledToday,
    plannedTaskCount: row?.planned_count ?? planned.length,
    plannedCompletedCount: row?.planned_completed ?? planned.filter((t) => t.status === 'done').length,
    importantNotUrgentCompleted: row?.important_not_urgent_done ?? 0,
    overdueTasks: row?.overdue_count ?? overdue.length,
    reviewed: row?.reviewed === 1,
  };

  const score = productivityScore({
    dayKey,
    plannedTasks: Math.max(activity.plannedTaskCount, activity.plannedCompletedCount),
    completedPlannedTasks: activity.plannedCompletedCount,
    completedTasks: activity.tasksCompleted,
    focusMinutes: activity.focusMinutes,
    habitsScheduled: habitSummary.scheduledToday,
    habitsCompleted: habitSummary.completedToday,
    importantNotUrgentCompleted: activity.importantNotUrgentCompleted,
    overdueTasks: activity.overdueTasks ?? 0,
    reviewedDay: activity.reviewed,
  });

  const reviewRow = one<import('../repo/rows.js').DailyReviewRow>(
    'SELECT * FROM daily_reviews WHERE user_id = ? AND day_key = ?',
    [user.id, dayKey],
    db,
  );

  return {
    dayKey,
    tasks: { planned, completed, overdue, incomplete },
    focusMinutes: activity.focusMinutes,
    focusSessions: sessions,
    habits,
    habitSummary,
    activity,
    score,
    review: reviewRow
      ? {
          id: reviewRow.id,
          dayKey: reviewRow.day_key as DayKey,
          reflection: reviewRow.reflection,
          mood: reviewRow.mood,
          energy: reviewRow.energy,
          tasksCompleted: reviewRow.tasks_completed,
          tasksPlanned: reviewRow.tasks_planned,
          focusMinutes: reviewRow.focus_minutes,
          habitsCompleted: reviewRow.habits_completed,
          overdueCarryOver: reviewRow.overdue_carry_over,
          tomorrowTopTaskId: reviewRow.tomorrow_top_task_id,
          createdAt: reviewRow.created_at,
          updatedAt: reviewRow.updated_at,
          seq: reviewRow.seq,
        }
      : null,
    tomorrowTopTaskId: reviewRow?.tomorrow_top_task_id ?? null,
  };
}

/** Refresh the rollup for a day (used after reviews and offline batches). */
export function refreshDay(user: UserRow, dayKey: DayKey, db: Db = getDb()): void {
  recomputeActivityDay(user.id, dayKey, user.tz_offset_minutes, db);
}

export { countNotes, listNotes, listProjects, listNotifications };
