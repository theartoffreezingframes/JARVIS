import { weekdayOfKey, type DayKey } from './dates';
import type { Habit } from './models';
import type { HabitFrequency } from './primitives';

export interface HabitSchedule {
  frequency: HabitFrequency;
  scheduleDays: number[];
}

/**
 * Whether a habit is expected on a given day. Used identically on the server
 * (streaks, analytics) and on the client (today's habit list, reminders) so the
 * two can never disagree about what "due today" means.
 */
export function habitScheduledOn(habit: HabitSchedule, dayKey: DayKey): boolean {
  const weekday = weekdayOfKey(dayKey);
  switch (habit.frequency) {
    case 'daily':
      return true;
    case 'weekdays':
      return weekday !== 0 && weekday !== 6;
    case 'weekly':
    case 'custom':
      if (!habit.scheduleDays.length) return weekday === 1;
      return habit.scheduleDays.includes(weekday);
    default:
      return true;
  }
}

export const HABIT_FREQUENCY_LABEL: Record<HabitFrequency, string> = {
  daily: 'Every day',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  custom: 'Custom days',
};

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function habitScheduleLabel(habit: HabitSchedule): string {
  switch (habit.frequency) {
    case 'daily':
      return 'Every day';
    case 'weekdays':
      return 'Weekdays';
    case 'weekly':
    case 'custom': {
      if (!habit.scheduleDays.length) return 'Weekly';
      const sorted = [...habit.scheduleDays].sort((a, b) => a - b);
      if (sorted.length === 7) return 'Every day';
      if (sorted.length === 5 && sorted.every((d) => d >= 1 && d <= 5)) return 'Weekdays';
      if (sorted.length === 2 && sorted.includes(0) && sorted.includes(6)) return 'Weekends';
      return sorted.map((d) => DAY_SHORT[d] ?? '').join(' · ');
    }
    default:
      return 'Custom';
  }
}

/** Habits expected today, ordered so incomplete ones surface first. */
export function todaysHabits(habits: readonly Habit[], today: DayKey): Habit[] {
  return habits
    .filter((habit) => !habit.archived && habitScheduledOn(habit, today))
    .sort((a, b) => {
      if (a.completedToday !== b.completedToday) return a.completedToday ? 1 : -1;
      return b.currentStreak - a.currentStreak;
    });
}

/** Consistency over the trailing window, expressed as a labelled band. */
export function consistencyLabel(rate: number): string {
  if (rate >= 90) return 'Locked in';
  if (rate >= 70) return 'Consistent';
  if (rate >= 45) return 'Building';
  if (rate > 0) return 'Getting started';
  return 'Not started';
}

export function habitStreakMessage(habit: Habit): string {
  if (habit.completedToday) {
    return habit.currentStreak > 1
      ? `${habit.currentStreak} day streak — keep it alive`
      : 'Done today';
  }
  if (habit.currentStreak === 0) return 'Start a new streak today';
  return `${habit.currentStreak} day streak at risk`;
}
