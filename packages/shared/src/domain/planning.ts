import { formatDuration, minutesSinceMidnight, parseTime, type DayKey } from './dates';
import type { Task } from './models';

/* -------------------------------------------------------------------------- */
/*  Daily planner                                                             */
/* -------------------------------------------------------------------------- */

export interface PlannerTaskInput {
  id: string;
  title: string;
  estimatedMinutes: number | null;
  isMustDo: boolean;
  planOrder: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate: DayKey | null;
  dueTime: string | null;
  projectName?: string | null;
}

export interface PlannedBlock {
  taskId: string;
  title: string;
  startMinutes: number;
  endMinutes: number;
  startLabel: string;
  endLabel: string;
  estimatedMinutes: number;
  isMustDo: boolean;
}

export interface PlannerWarning {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  taskIds: string[];
}

export interface DayPlan {
  dayKey: DayKey;
  windowStartMinutes: number;
  windowEndMinutes: number;
  capacityMinutes: number;
  plannedMinutes: number;
  remainingMinutes: number;
  utilization: number; // 0..1+
  blocks: PlannedBlock[];
  warnings: PlannerWarning[];
  mustDoCount: number;
  niceDoCount: number;
}

export const DEFAULT_DAY_START = '07:00';
export const DEFAULT_DAY_END = '22:00';
/** Time reserved for meals, movement, commuting and slack. */
export const DEFAULT_BREAK_MINUTES = 90;

function toLabel(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}

export interface BuildDayPlanOptions {
  dayKey: DayKey;
  tasks: readonly PlannerTaskInput[];
  nowMinutes?: number;
  dayStartTime?: string;
  dayEndTime?: string;
  breakMinutes?: number;
}

/**
 * Sequentially lays tasks into the available window, respecting plan order,
 * "must do" priority and estimates. Produces warnings when the plan is
 * over-committed — the planner is honest about capacity rather than silently
 * cramming work.
 */
export function buildDayPlan(options: BuildDayPlanOptions): DayPlan {
  const {
    dayKey,
    tasks,
    nowMinutes,
    dayStartTime = DEFAULT_DAY_START,
    dayEndTime = DEFAULT_DAY_END,
    breakMinutes = DEFAULT_BREAK_MINUTES,
  } = options;

  const windowStartMinutes = Math.max(
    parseTime(dayStartTime).hour * 60 + parseTime(dayStartTime).minute,
    nowMinutes ?? 0,
  );
  const windowEndMinutes = parseTime(dayEndTime).hour * 60 + parseTime(dayEndTime).minute;
  const capacityMinutes = Math.max(0, windowEndMinutes - windowStartMinutes - breakMinutes);

  const ordered = [...tasks].sort((a, b) => {
    if (a.isMustDo !== b.isMustDo) return a.isMustDo ? -1 : 1;
    if (a.planOrder !== b.planOrder) return a.planOrder - b.planOrder;
    return a.title.localeCompare(b.title);
  });

  let cursor = windowStartMinutes;
  const blocks: PlannedBlock[] = [];
  const unestimated: string[] = [];
  let plannedMinutes = 0;

  for (const task of ordered) {
    const minutes = task.estimatedMinutes ?? 0;
    if (!minutes) unestimated.push(task.id);
    const length = minutes || 30;
    blocks.push({
      taskId: task.id,
      title: task.title,
      startMinutes: cursor,
      endMinutes: cursor + length,
      startLabel: toLabel(cursor),
      endLabel: toLabel(cursor + length),
      estimatedMinutes: length,
      isMustDo: task.isMustDo,
    });
    cursor += length;
    plannedMinutes += length;
  }

  const lastBlock = blocks[blocks.length - 1];
  const finishMinutes = lastBlock ? lastBlock.endMinutes : windowStartMinutes;
  const utilization = capacityMinutes > 0 ? plannedMinutes / capacityMinutes : plannedMinutes > 0 ? 2 : 0;

  const warnings: PlannerWarning[] = [];
  const overBy = plannedMinutes - capacityMinutes;

  if (overBy > 0) {
    warnings.push({
      id: 'overbooked',
      severity: overBy > 90 ? 'critical' : 'warning',
      title: `You planned ${formatDuration(plannedMinutes)} into ${formatDuration(capacityMinutes)} of space`,
      body: `That is ${formatDuration(overBy)} more than realistically fits before ${toLabel(windowEndMinutes)}. Move the lowest-priority block to tomorrow or shorten an estimate.`,
      taskIds: blocks.slice(-3).map((b) => b.taskId),
    });
  } else if (utilization > 0.85) {
    warnings.push({
      id: 'tight',
      severity: 'info',
      title: 'Your day is fully booked',
      body: 'Every minute is allocated. Leave a buffer for the unexpected — aim for 70–80% utilisation.',
      taskIds: [],
    });
  }

  if (finishMinutes > windowEndMinutes) {
    warnings.push({
      id: 'late_finish',
      severity: 'warning',
      title: `The plan runs past ${toLabel(windowEndMinutes)}`,
      body: 'Protecting the end of your day matters as much as the start. Trim or reschedule the tail.',
      taskIds: blocks.filter((b) => b.endMinutes > windowEndMinutes).map((b) => b.taskId),
    });
  }

  if (unestimated.length) {
    warnings.push({
      id: 'no_estimate',
      severity: 'info',
      title: `${unestimated.length} task${unestimated.length === 1 ? '' : 's'} have no time estimate`,
      body: 'Blocks default to 30 minutes. Adding estimates makes the plan trustworthy.',
      taskIds: unestimated,
    });
  }

  const mustDoCount = ordered.filter((t) => t.isMustDo).length;
  if (mustDoCount > 3) {
    warnings.push({
      id: 'too_many_must_do',
      severity: 'warning',
      title: `${mustDoCount} “must do” tasks`,
      body: 'If everything is a must, nothing is. Keep it to one to three.',
      taskIds: ordered.filter((t) => t.isMustDo).map((t) => t.id),
    });
  }

  const dueSoonConflicts = ordered.filter(
    (t) => t.dueTime && t.dueDate === dayKey,
  );
  if (dueSoonConflicts.length) {
    for (const task of dueSoonConflicts) {
      const due = task.dueTime ? parseTime(task.dueTime) : null;
      if (!due) continue;
      const dueMinutes = due.hour * 60 + due.minute;
      const block = blocks.find((b) => b.taskId === task.id);
      if (block && block.endMinutes > dueMinutes) {
        warnings.push({
          id: `due_conflict_${task.id}`,
          severity: 'critical',
          title: `“${task.title}” is scheduled to finish after its deadline`,
          body: `The block ends at ${block.endLabel} but the task is due at ${task.dueTime}. Move it earlier or reduce its scope.`,
          taskIds: [task.id],
        });
      }
    }
  }

  return {
    dayKey,
    windowStartMinutes,
    windowEndMinutes,
    capacityMinutes,
    plannedMinutes,
    remainingMinutes: capacityMinutes - plannedMinutes,
    utilization,
    blocks,
    warnings,
    mustDoCount,
    niceDoCount: ordered.length - mustDoCount,
  };
}

export interface AvailableTimeInput {
  nowMs: number;
  offsetMinutes: number;
  dayEndTime: string;
  breakMinutes?: number;
}

/** Minutes of realistic remaining working time today. */
export function remainingCapacityToday(input: AvailableTimeInput): number {
  const { nowMs, offsetMinutes, dayEndTime, breakMinutes = 0 } = input;
  const now = minutesSinceMidnight(nowMs, offsetMinutes);
  const endParts = parseTime(dayEndTime);
  const end = endParts.hour * 60 + endParts.minute;
  const slack = Math.round(breakMinutes * ((end - now) / Math.max(1, end)));
  return Math.max(0, end - now - slack);
}

/** Minutes of work still expected today (open, today-or-earlier tasks). */
export function outstandingWorkload(tasks: readonly Task[], today: DayKey): number {
  return tasks
    .filter((t) => t.status !== 'done' && t.status !== 'archived' && (!t.dueDate || t.dueDate <= today))
    .reduce((sum, t) => sum + (t.estimatedMinutes ?? 30), 0);
}
