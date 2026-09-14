import { addDays, toDayKey, type DayKey } from '@jarvis/shared';
import { getDb } from '../db/index.js';
import { recomputeActivityDay } from '../repo/activity.js';
import type { UserRow } from '../repo/rows.js';
import type { SyncOperation } from './sync.js';

/**
 * After an offline batch lands, the day rollups can be stale (a device may have
 * completed a task for *yesterday* while offline). We recompute only the days the
 * batch actually touched, which keeps this cheap and keeps analytics exact.
 */
export async function reconcileActivity(user: UserRow, operations: readonly SyncOperation[]): Promise<{ days: DayKey[] }> {
  const touched = new Set<DayKey>();
  const today = toDayKey(Date.now(), user.tz_offset_minutes);

  for (const operation of operations) {
    const payload = operation.payload ?? {};
    const dayKey =
      (payload.dayKey as string | undefined) ??
      (payload.dueDate as string | undefined) ??
      (payload.planDate as string | undefined) ??
      (payload.completedAt ? toDayKey(Number(payload.completedAt), user.tz_offset_minutes) : undefined);
    if (dayKey && /^\d{4}-\d{2}-\d{2}$/.test(dayKey)) touched.add(dayKey as DayKey);
  }

  // Completion timestamps are the most common way a batch spans days.
  if (touched.size === 0 && operations.length > 0) {
    touched.add(today);
    touched.add(addDays(today, -1));
  }

  for (const day of touched) {
    recomputeActivityDay(user.id, day, user.tz_offset_minutes);
  }

  // Keep the "reviewed" flag, which recompute intentionally preserves.
  for (const day of touched) {
    const review = getDb()
      .prepare('SELECT 1 AS present FROM daily_reviews WHERE user_id = ? AND day_key = ? LIMIT 1')
      .get(user.id, day) as { present?: number } | undefined;
    if (review?.present) {
      getDb().prepare('UPDATE activity_days SET reviewed = 1 WHERE user_id = ? AND day_key = ?').run(user.id, day);
    }
  }

  return { days: [...touched] };
}
