import {
  addDays,
  eachDayKey,
  endOfMonthKey,
  endOfWeekKey,
  formatDayKey,
  startOfMonthKey,
  startOfWeekKey,
  weekdayOfKey,
  type DayKey,
} from './dates';
import type { HeatmapCell, HeatmapMetric, HeatmapResponse } from './models';
import { productivityScore, type ProductivityInputs } from './scoring';

export interface ActivityDay {
  dayKey: DayKey;
  tasksCompleted: number;
  tasksCreated: number;
  focusMinutes: number;
  habitsCompleted: number;
  habitsScheduled: number;
  plannedTaskCount: number;
  plannedCompletedCount: number;
  importantNotUrgentCompleted?: number;
  overdueTasks?: number;
  reviewed?: boolean;
}

export const HEATMAP_METRIC_LABEL: Record<HeatmapMetric, string> = {
  tasks_completed: 'Task completion',
  tasks_created: 'Tasks created',
  focus: 'Focus activity',
  habits: 'Habit consistency',
  productivity: 'Overall productivity',
};

function metricValue(metric: HeatmapMetric, day: ActivityDay): number {
  switch (metric) {
    case 'tasks_completed':
      return day.tasksCompleted;
    case 'tasks_created':
      return day.tasksCreated;
    case 'focus':
      return day.focusMinutes;
    case 'habits':
      return day.habitsCompleted;
    case 'productivity':
      return productivityScore(toInputs(day)).score;
    default:
      return 0;
  }
}

function toInputs(day: ActivityDay): ProductivityInputs {
  return {
    dayKey: day.dayKey,
    plannedTasks: day.plannedTaskCount,
    completedPlannedTasks: day.plannedCompletedCount,
    completedTasks: day.tasksCompleted,
    focusMinutes: day.focusMinutes,
    habitsScheduled: day.habitsScheduled,
    habitsCompleted: day.habitsCompleted,
    importantNotUrgentCompleted: day.importantNotUrgentCompleted,
    overdueTasks: day.overdueTasks ?? 0,
    reviewedDay: day.reviewed,
  };
}

/** Thresholds at p50 / p75 / p90 of non-zero values, with sane fallbacks. */
export function levelThresholds(values: readonly number[]): [number, number, number] {
  const nonZero = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) return [1, 2, 3];
  const q = (p: number) => {
    const idx = Math.min(nonZero.length - 1, Math.max(0, Math.ceil(p * nonZero.length) - 1));
    return nonZero[idx] ?? 1;
  };
  let t1 = Math.max(1, q(0.5));
  let t2 = Math.max(t1 + 1, q(0.75));
  let t3 = Math.max(t2 + 1, q(0.9));
  if (nonZero.length < 4) {
    // Very little data: keep a readable scale instead of noise.
    t1 = Math.max(1, nonZero[0] ?? 1);
    t2 = Math.max(t1 + 1, nonZero[nonZero.length - 1] ?? t1 + 1);
    t3 = t2 + 1;
  }
  return [t1, t2, t3];
}

export function levelFor(value: number, thresholds: readonly [number, number, number]): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0) return 0;
  const [t1, t2, t3] = thresholds;
  if (value >= t3) return 4;
  if (value >= t2) return 3;
  if (value >= t1) return 2;
  return 1;
}

export interface BuildHeatmapOptions {
  metric: HeatmapMetric;
  range: 'week' | 'month' | 'year';
  anchor: DayKey;
  weekStartsOn?: 0 | 1;
  /** activity keyed by day key; missing days are treated as empty */
  activity: ReadonlyMap<DayKey, ActivityDay>;
}

export function resolveRange(
  range: 'week' | 'month' | 'year',
  anchor: DayKey,
  weekStartsOn: 0 | 1 = 1,
): { start: DayKey; end: DayKey; days: DayKey[] } {
  if (range === 'week') {
    const start = startOfWeekKey(anchor, weekStartsOn);
    const end = endOfWeekKey(anchor, weekStartsOn);
    return { start, end, days: eachDayKey(start, end) };
  }
  if (range === 'month') {
    const start = startOfMonthKey(anchor);
    const end = endOfMonthKey(anchor);
    return { start, end, days: eachDayKey(start, end) };
  }
  const year = anchor.slice(0, 4);
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  return { start, end, days: eachDayKey(start, end) };
}

function emptyActivity(dayKey: DayKey): ActivityDay {
  return {
    dayKey,
    tasksCompleted: 0,
    tasksCreated: 0,
    focusMinutes: 0,
    habitsCompleted: 0,
    habitsScheduled: 0,
    plannedTaskCount: 0,
    plannedCompletedCount: 0,
  };
}

export function buildHeatmap(options: BuildHeatmapOptions): HeatmapResponse {
  const { metric, range, anchor, activity, weekStartsOn = 1 } = options;
  const { start, end, days } = resolveRange(range, anchor, weekStartsOn);

  const values = days.map((dayKey) => metricValue(metric, activity.get(dayKey) ?? emptyActivity(dayKey)));
  const thresholds = levelThresholds(values);

  let bestDay: DayKey | null = null;
  let bestDayValue = 0;
  let activeDays = 0;

  const cells: HeatmapCell[] = days.map((dayKey, index) => {
    const day = activity.get(dayKey) ?? emptyActivity(dayKey);
    const value = values[index] ?? 0;
    if (value > 0) activeDays += 1;
    if (value > bestDayValue) {
      bestDayValue = value;
      bestDay = dayKey;
    }
    return {
      dayKey,
      value,
      level: levelFor(value, thresholds),
      tasksCompleted: day.tasksCompleted,
      tasksCreated: day.tasksCreated,
      focusMinutes: day.focusMinutes,
      habitsCompleted: day.habitsCompleted,
      plannedTaskCount: day.plannedTaskCount,
      productivityScore: metric === 'productivity' ? value : productivityScore(toInputs(day)).score,
    };
  });

  return {
    metric,
    range,
    start,
    end,
    cells,
    totals: {
      tasksCompleted: cells.reduce((s, c) => s + c.tasksCompleted, 0),
      tasksCreated: cells.reduce((s, c) => s + c.tasksCreated, 0),
      focusMinutes: cells.reduce((s, c) => s + c.focusMinutes, 0),
      habitsCompleted: cells.reduce((s, c) => s + c.habitsCompleted, 0),
      activeDays,
      bestDay,
      bestDayValue,
    },
  };
}

/** Group year cells into GitHub-style columns of weeks (Sunday-first). */
export function groupIntoWeeks(cells: readonly HeatmapCell[]): HeatmapCell[][] {
  const weeks: HeatmapCell[][] = [];
  let current: HeatmapCell[] = [];
  for (const cell of cells) {
    const weekday = weekdayOfKey(cell.dayKey);
    if (weekday === 0 && current.length) {
      weeks.push(current);
      current = [];
    }
    current.push(cell);
  }
  if (current.length) weeks.push(current);
  return weeks;
}

/** Rolling window used by dashboard + analytics summaries. */
export function rollingActivity(
  activity: ReadonlyMap<DayKey, ActivityDay>,
  endDay: DayKey,
  length: number,
): ActivityDay[] {
  const start = addDays(endDay, -(length - 1));
  return eachDayKey(start, endDay).map((key) => activity.get(key) ?? emptyActivity(key));
}

export function summarizeActivity(days: readonly ActivityDay[]): {
  tasksCompleted: number;
  tasksCreated: number;
  focusMinutes: number;
  habitsCompleted: number;
  activeDays: number;
  averageFocusMinutes: number;
  bestFocusDay: { dayKey: DayKey; minutes: number } | null;
} {
  let tasksCompleted = 0;
  let tasksCreated = 0;
  let focusMinutes = 0;
  let habitsCompleted = 0;
  let activeDays = 0;
  let bestFocusDay: { dayKey: DayKey; minutes: number } | null = null;

  for (const day of days) {
    tasksCompleted += day.tasksCompleted;
    tasksCreated += day.tasksCreated;
    focusMinutes += day.focusMinutes;
    habitsCompleted += day.habitsCompleted;
    if (day.tasksCompleted || day.focusMinutes || day.habitsCompleted) activeDays += 1;
    if (day.focusMinutes > 0 && (!bestFocusDay || day.focusMinutes > bestFocusDay.minutes)) {
      bestFocusDay = { dayKey: day.dayKey, minutes: day.focusMinutes };
    }
  }

  return {
    tasksCompleted,
    tasksCreated,
    focusMinutes,
    habitsCompleted,
    activeDays,
    averageFocusMinutes: days.length ? Math.round(focusMinutes / days.length) : 0,
    bestFocusDay,
  };
}

export function describeDayCell(cell: HeatmapCell, use24Hour = false): string {
  void use24Hour;
  const parts = [
    `${cell.tasksCompleted} task${cell.tasksCompleted === 1 ? '' : 's'} completed`,
    `${cell.tasksCreated} created`,
    `${cell.focusMinutes} focus min`,
    `${cell.habitsCompleted} habit${cell.habitsCompleted === 1 ? '' : 's'}`,
  ];
  return `${formatDayKey(cell.dayKey, 'long')} — ${parts.join(' · ')}`;
}
