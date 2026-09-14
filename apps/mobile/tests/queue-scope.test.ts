/**
 * Offline queue ownership.
 *
 * The queue is stored on the device, so these tests encode the isolation rule: a
 * change queued by one account must never be replayed under another account's token.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { belongsToUser, partitionByOwner } from '../src/lib/queue-scope.js';

test('a change is replayed only by the account that queued it', () => {
  const op = { owner: 'usr_alice' };
  assert.equal(belongsToUser(op, 'usr_alice'), true);
  assert.equal(belongsToUser(op, 'usr_bob'), false, 'bob must not send alice’s queued change');
  assert.equal(belongsToUser(op, null), false, 'a signed-out tool must not send anything owned');
});

test('entries from builds without ownership stay with the current user', () => {
  assert.equal(belongsToUser({}, 'usr_alice'), true);
  assert.equal(belongsToUser({ owner: null }, 'usr_alice'), true);
  assert.equal(belongsToUser({ owner: undefined }, 'usr_alice'), true);
});

test('switching accounts leaves the other account’s work queued', () => {
  const queue = [
    { id: 'a', owner: 'usr_alice' },
    { id: 'b', owner: 'usr_bob' },
    { id: 'c', owner: 'usr_alice' },
  ];

  const asBob = partitionByOwner(queue, 'usr_bob');
  assert.deepEqual(asBob.mine.map((op) => op.id), ['b']);
  assert.deepEqual(asBob.others.map((op) => op.id), ['a', 'c'], 'alice’s work is untouched, not dropped');

  // When alice signs back in, her changes are still there and hers alone.
  const asAlice = partitionByOwner(queue, 'usr_alice');
  assert.deepEqual(asAlice.mine.map((op) => op.id), ['a', 'c']);
  assert.deepEqual(asAlice.others.map((op) => op.id), ['b']);
});

test('nothing is sent while signed out', () => {
  const queue = [{ id: 'a', owner: 'usr_alice' }, { id: 'legacy' }];
  const signedOut = partitionByOwner(queue, null);
  assert.deepEqual(signedOut.mine.map((op) => op.id), ['legacy'], 'unowned entries only');
});
