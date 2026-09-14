import assert from 'node:assert/strict';
import test from 'node:test';
import { consume, resetRateLimits } from '../src/http/rate-limit.js';

test('the limiter allows a burst, then blocks until the window rolls over', () => {
  resetRateLimits();
  const key = 'unit-test-window';
  assert.equal(consume(key, 3, 60_000).allowed, true);
  assert.equal(consume(key, 3, 60_000).allowed, true);
  const third = consume(key, 3, 60_000);
  assert.equal(third.allowed, true);
  assert.equal(third.remaining, 0);

  const fourth = consume(key, 3, 60_000);
  assert.equal(fourth.allowed, false);
  assert.ok(fourth.resetAt > Date.now(), 'the caller learns when to retry');

  // A different identity is unaffected.
  assert.equal(consume('unit-test-other', 3, 60_000).allowed, true);

  resetRateLimits();
});
