/**
 * Pure time maths for the focus timer.
 *
 * The timer's correctness claim is that the countdown is *derived from stored
 * timestamps* rather than decremented in memory, so it stays right while the app
 * is backgrounded, while the phone is asleep, and after a restart. That claim
 * lives entirely in these functions, which are unit tested without React Native.
 */

export interface TimerClock {
  /** True while a phase is actively counting down. */
  running: boolean;
  /** Absolute timestamp (epoch ms) the running phase ends at. */
  endsAt: number | null;
  /** Remaining ms frozen while paused. */
  pausedRemainingMs: number | null;
  /** Length of the current phase in seconds. */
  phasePlannedSeconds: number;
}

/** Milliseconds left in the current phase at `now`. */
export function remainingMsAt(clock: TimerClock, now: number): number {
  if (!clock.running && clock.pausedRemainingMs !== null) return clock.pausedRemainingMs;
  if (clock.endsAt === null) return clock.phasePlannedSeconds * 1000;
  return Math.max(0, clock.endsAt - now);
}

/** True when a running phase has passed its end timestamp. */
export function hasExpiredAt(clock: TimerClock, now: number): boolean {
  return clock.running && clock.endsAt !== null && clock.endsAt <= now;
}

/** Seconds of this phase already spent at `now`. */
export function elapsedSecondsAt(
  clock: TimerClock & { startedAt: number | null; accruedSeconds: number },
  now: number,
): number {
  if (!clock.startedAt) return 0;
  if (clock.running && clock.endsAt !== null) {
    return clock.phasePlannedSeconds - Math.round(Math.max(0, clock.endsAt - now) / 1000);
  }
  return clock.accruedSeconds;
}

/** 0–1 progress through the phase, clamped so a clock jump cannot escape the ring. */
export function progressAt(clock: TimerClock, now: number): number {
  const planned = clock.phasePlannedSeconds * 1000;
  if (planned <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - remainingMsAt(clock, now) / planned));
}
