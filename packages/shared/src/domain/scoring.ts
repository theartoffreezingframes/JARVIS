import { clamp, round } from './primitives';
import { type DayKey } from './dates';

/**
 * Productivity scoring.
 *
 * Design rule (see docs/PRODUCT.md#analytics-ethics): a score must never reward
 * raw output volume. Every input here is *ratio-shaped* — how much of what you
 * planned got done, whether you invested in important-not-urgent work, whether
 * you kept your commitments and whether you stopped. Working longer cannot push
 * the score up once sustainable limits are reached; overworking is actively
 * discounted.
 */

export interface ProductivityInputs {
  dayKey: DayKey;
  plannedTasks: number;
  completedPlannedTasks: number;
  completedTasks: number;
  focusMinutes: number;
  /** target focus minutes for a normal day (default 120) */
  focusGoalMinutes?: number;
  habitsScheduled: number;
  habitsCompleted: number;
  /** completed tasks that were important + not urgent (quadrant 2) */
  importantNotUrgentCompleted?: number;
  overdueTasks: number;
  reviewedDay?: boolean;
}

export interface ProductivityBreakdown {
  score: number;
  band: 'light' | 'steady' | 'strong' | 'exceptional';
  components: Array<{
    id: 'completion' | 'focus' | 'habits' | 'investment' | 'consistency';
    label: string;
    /** points earned */
    value: number;
    /** points available */
    max: number;
    note: string;
  }>;
  flags: {
    overwork: boolean;
    underPlanned: boolean;
    sustainable: boolean;
  };
  headline: string;
}

/** Sustainable daily focus ceiling — beyond this, extra minutes earn nothing. */
export const SUSTAINABLE_FOCUS_MINUTES = 300;
export const SUSTAINABLE_FOCUS_CEILING = 360;

export function productivityScore(inputs: ProductivityInputs): ProductivityBreakdown {
  const focusGoal = inputs.focusGoalMinutes ?? 120;

  /* --- Completion: did the day you planned actually happen? ---------------- */
  const planned = Math.max(inputs.plannedTasks, inputs.completedTasks);
  const completionRatio = planned > 0 ? clamp(inputs.completedPlannedTasks / planned, 0, 1) : 0;
  // Days with nothing planned still let you earn completion credit for finishing things.
  const fallbackRatio = planned === 0 ? clamp(inputs.completedTasks / 3, 0, 1) : 0;
  const completionPoints = 40 * (planned > 0 ? completionRatio : fallbackRatio);

  /* --- Focus: capped, diminishing returns after the sustainable ceiling ---- */
  const focusRatio = focusGoal > 0 ? Math.min(inputs.focusMinutes / focusGoal, 1.6) : 0;
  const focusPoints = focusRatio <= 1 ? 25 * focusRatio : 25;

  /* --- Habits: commitment keeping ---------------------------------------- */
  const habitRatio = inputs.habitsScheduled > 0 ? inputs.habitsCompleted / inputs.habitsScheduled : 0;
  const habitPoints = 20 * clamp(habitRatio, 0, 1);

  /* --- Investment: important-but-not-urgent work -------------------------- */
  const importantNotUrgent = inputs.importantNotUrgentCompleted ?? 0;
  const investmentPoints = 15 * clamp(importantNotUrgent / 2, 0, 1);

  /* --- Consistency: closing the loop + clearing debt --------------------- */
  let consistency = 10;
  if (inputs.reviewedDay) consistency += 5;
  consistency -= clamp(inputs.overdueTasks, 0, 5) * 2;
  if (inputs.completedTasks === 0) consistency -= 5;
  const consistencyPoints = clamp(consistency, -10, 15);

  const raw = completionPoints + focusPoints + habitPoints + investmentPoints + consistencyPoints;
  const score = clamp(Math.round(raw), 0, 100);

  const overwork = inputs.focusMinutes > SUSTAINABLE_FOCUS_CEILING;
  const underPlanned = inputs.plannedTasks === 0 && inputs.completedTasks === 0;

  let band: ProductivityBreakdown['band'] = 'light';
  if (score >= 85) band = 'exceptional';
  else if (score >= 65) band = 'strong';
  else if (score >= 40) band = 'steady';

  const headline = overwork
    ? 'Strong day — and long. Protect recovery tonight.'
    : band === 'exceptional'
      ? 'Everything you planned moved forward.'
      : band === 'strong'
        ? 'A solid, well-spent day.'
        : band === 'steady'
          ? 'Progress made. A couple of open commitments remain.'
          : underPlanned
            ? 'Nothing planned or completed — a quiet day is fine, but a plan helps.'
            : 'Partial day. Pick one important task to close out.';

  return {
    score,
    band,
    components: [
      {
        id: 'completion',
        label: 'Planned work completed',
        value: round(completionPoints, 1),
        max: 40,
        note: planned ? `${inputs.completedPlannedTasks}/${planned} planned tasks` : 'nothing was planned',
      },
      {
        id: 'focus',
        label: 'Focus time',
        value: round(focusPoints, 1),
        max: 25,
        note: `${inputs.focusMinutes} of ${focusGoal} target minutes`,
      },
      {
        id: 'habits',
        label: 'Habits kept',
        value: round(habitPoints, 1),
        max: 20,
        note: inputs.habitsScheduled ? `${inputs.habitsCompleted}/${inputs.habitsScheduled} habits` : 'no habits scheduled',
      },
      {
        id: 'investment',
        label: 'Important, not urgent',
        value: round(investmentPoints, 1),
        max: 15,
        note: importantNotUrgent ? `${importantNotUrgent} scheduled-task wins` : 'no quadrant‑2 work completed',
      },
      {
        id: 'consistency',
        label: 'Open loops',
        value: round(consistencyPoints, 1),
        max: 15,
        note: inputs.overdueTasks ? `${inputs.overdueTasks} overdue` : 'nothing overdue',
      },
    ],
    flags: { overwork, underPlanned, sustainable: !overwork },
    headline,
  };
}

export interface TrendPoint {
  dayKey: DayKey;
  value: number;
}

/** Simple least-squares trend used for "improving / steady / slipping" copy. */
export function trendOf(points: readonly TrendPoint[]): {
  direction: 'up' | 'down' | 'flat';
  delta: number;
} {
  if (points.length < 2) return { direction: 'flat', delta: 0 };
  const n = points.length;
  const meanX = (n - 1) / 2;
  const meanY = points.reduce((s, p) => s + p.value, 0) / n;
  let num = 0;
  let den = 0;
  points.forEach((p, i) => {
    num += (i - meanX) * (p.value - meanY);
    den += (i - meanX) ** 2;
  });
  const slope = den === 0 ? 0 : num / den;
  const delta = slope * (n - 1);
  const threshold = Math.max(1, meanY * 0.08);
  if (delta > threshold) return { direction: 'up', delta };
  if (delta < -threshold) return { direction: 'down', delta };
  return { direction: 'flat', delta };
}

/**
 * Streak of consecutive days with meaningful activity, counting today as
 * "still open" rather than breaking the streak.
 */
export function activityStreak(activeDays: readonly DayKey[], today: DayKey, hasActivityToday: boolean): number {
  const set = new Set(activeDays);
  let streak = 0;
  let cursorMs = Date.UTC(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)) - 1,
    Number(today.slice(8, 10)),
  );
  if (!hasActivityToday) cursorMs -= 86_400_000;
  for (let i = 0; i < 3650; i += 1) {
    const d = new Date(cursorMs);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    if (!set.has(key)) break;
    streak += 1;
    cursorMs -= 86_400_000;
  }
  return streak;
}

/** Habit streak with frequency awareness (weekly habits don't need a daily hit). */
export function habitStreak(
  completions: readonly DayKey[],
  scheduledDays: (day: DayKey) => boolean,
  today: DayKey,
  tolerance = 0,
): { current: number; best: number } {
  const set = new Set(completions);
  let current = 0;
  let missed = 0;
  let cursor = today;
  const subtract = (key: DayKey): DayKey => {
    const d = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))));
    d.setUTCDate(d.getUTCDate() - 1);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  };
  for (let i = 0; i < 3650; i += 1) {
    const isScheduled = scheduledDays(cursor);
    if (isScheduled) {
      if (set.has(cursor)) {
        current += 1;
        missed = 0;
      } else if (cursor === today) {
        // today is still open
      } else if (missed < tolerance) {
        missed += 1;
      } else {
        break;
      }
    }
    cursor = subtract(cursor);
  }
  return { current, best: Math.max(current, bestStreak(completions, scheduledDays, today)) };
}

function bestStreak(completions: readonly DayKey[], scheduledDays: (day: DayKey) => boolean, today: DayKey): number {
  const set = new Set(completions);
  const sorted = [...set].sort();
  let best = 0;
  let run = 0;
  let cursor = sorted[0] ?? today;
  const last = sorted[sorted.length - 1] ?? today;
  for (let i = 0; i < 3650 && cursor <= last; i += 1) {
    if (scheduledDays(cursor)) {
      if (set.has(cursor)) {
        run += 1;
        best = Math.max(best, run);
      } else {
        run = 0;
      }
    }
    const d = new Date(Date.UTC(Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7)) - 1, Number(cursor.slice(8, 10))));
    d.setUTCDate(d.getUTCDate() + 1);
    cursor = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  return best;
}
