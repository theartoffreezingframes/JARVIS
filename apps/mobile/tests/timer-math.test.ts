/**
 * Focus-timer time maths.
 *
 * These tests encode the behaviour a user actually relies on: a Pomodoro keeps
 * its correct remaining time while the app is backgrounded or the phone is
 * asleep, pausing freezes it, and a finished phase cannot drift negative.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { elapsedSecondsAt, hasExpiredAt, progressAt, remainingMsAt } from '../src/lib/timer-math.js';

const T0 = 1_700_000_000_000;

function running(overrides: Partial<Parameters<typeof remainingMsAt>[0]> = {}) {
  return {
    running: true,
    endsAt: T0 + 25 * 60_000,
    pausedRemainingMs: null,
    phasePlannedSeconds: 25 * 60,
    ...overrides,
  };
}

test('a running phase counts down from its end timestamp', () => {
  assert.equal(remainingMsAt(running(), T0), 25 * 60_000);
  assert.equal(remainingMsAt(running(), T0 + 60_000), 24 * 60_000);
});

test('backgrounding the app for ten minutes leaves exactly ten minutes less', () => {
  // Nothing ticks while the app is suspended — the timestamp is the only truth.
  const afterBackground = T0 + 10 * 60_000;
  assert.equal(remainingMsAt(running(), afterBackground), 15 * 60_000);
  assert.equal(elapsedSecondsAt({ ...running(), startedAt: T0, accruedSeconds: 0 }, afterBackground), 600);
});

test('a finished phase reports zero and never a negative time', () => {
  const clock = running({ endsAt: T0 + 1_000 });
  assert.equal(remainingMsAt(clock, T0 + 1_000), 0);
  assert.equal(remainingMsAt(clock, T0 + 5 * 60_000), 0);
  assert.equal(hasExpiredAt(clock, T0 + 999), false);
  assert.equal(hasExpiredAt(clock, T0 + 1_000), true);
});

test('pausing freezes the remaining time until it resumes', () => {
  const paused = { running: false, endsAt: null, pausedRemainingMs: 7 * 60_000, phasePlannedSeconds: 25 * 60 };
  assert.equal(remainingMsAt(paused, T0), 7 * 60_000);
  assert.equal(remainingMsAt(paused, T0 + 60 * 60_000), 7 * 60_000, 'an hour later it is still paused');
  assert.equal(hasExpiredAt(paused, T0 + 60 * 60_000), false);
});

test('an idle timer shows the whole phase and no progress', () => {
  const idle = { running: false, endsAt: null, pausedRemainingMs: null, phasePlannedSeconds: 25 * 60 };
  assert.equal(remainingMsAt(idle, T0), 25 * 60_000);
  assert.equal(progressAt(idle, T0), 0);
  assert.equal(elapsedSecondsAt({ ...idle, startedAt: null, accruedSeconds: 0 }, T0), 0);
});

test('progress is clamped even if the device clock jumps', () => {
  const clock = running();
  assert.equal(progressAt(clock, T0), 0);
  assert.equal(progressAt(clock, T0 + 25 * 60_000), 1);
  // A clock that jumps forward by a day cannot push progress past 100%.
  assert.equal(progressAt(clock, T0 + 86_400_000), 1);
  // A clock that jumps backwards cannot make it negative.
  assert.equal(progressAt(clock, T0 - 86_400_000), 0);
});

test('elapsed seconds follow the same timestamps', () => {
  const base = { ...running(), startedAt: T0, accruedSeconds: 0 };
  assert.equal(elapsedSecondsAt(base, T0), 0);
  assert.equal(elapsedSecondsAt(base, T0 + 90_000), 90);
  assert.equal(elapsedSecondsAt(base, T0 + 25 * 60_000), 25 * 60);
  // A paused phase reports the seconds that were actually spent.
  assert.equal(
    elapsedSecondsAt({ ...base, running: false, endsAt: null, accruedSeconds: 42 }, T0 + 60 * 60_000),
    42,
  );
});
