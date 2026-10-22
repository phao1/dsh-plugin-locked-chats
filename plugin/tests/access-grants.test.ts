import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccessGrants } from '../src/access-grants.ts';
import { LockError } from '../src/errors.ts';

const policy = { awayTimeoutMs: 60_000, connectionLeaseMs: 60_000, maxGrants: 32 };

test('access is window-bound and revocation aborts already authorized streams', () => {
  const grants = new AccessGrants(policy, () => 1);
  const token = grants.issue('a', 1);
  const signal = grants.authorize('a', token);
  assert.throws(() => grants.authorize('b', token), LockError);
  assert.throws(() => grants.lock('b', token), LockError);
  assert.equal(signal.aborted, false);
  grants.lock('a', token);
  assert.equal(signal.aborted, true);
  assert.throws(() => grants.authorize('a', token), LockError);
  grants.close();
});

test('foreground presence keeps a window open without typing; background pulses cannot extend away time', () => {
  let now = 0;
  const grants = new AccessGrants(policy, () => 1, () => now);
  const token = grants.issue('a', 1);
  for (let i = 0; i < 10; i++) { now += 30_000; grants.presence('a', token, true); }
  const signal = grants.authorize('a', token);
  grants.presence('a', token, false);
  now += 30_000;
  grants.presence('a', token, false);
  now += 30_000;
  assert.throws(() => grants.presence('a', token, true), LockError);
  assert.equal(signal.aborted, true);
  grants.close();
});

test('version changes invalidate old grants even when another process changes the credentials', () => {
  let version = 1;
  const grants = new AccessGrants(policy, () => version);
  const token = grants.issue('a', 1);
  const signal = grants.authorize('a', token);
  version = 2;
  grants.sweep();
  assert.equal(signal.aborted, true);
  assert.throws(() => grants.issue('a', 1), LockError);
  const replacement = grants.issue('a', 2);
  assert.equal(grants.authorize('a', replacement).aborted, false);
  grants.close();
});

test('missed disconnect expires the lease and process disposal aborts active access', () => {
  let now = 0;
  const grants = new AccessGrants(policy, () => 1, () => now);
  const token = grants.issue('a', 1);
  const signal = grants.authorize('a', token);
  now += 60_000;
  grants.sweep();
  assert.equal(signal.aborted, true);
  const fresh = grants.issue('b', 1);
  const freshSignal = grants.authorize('b', fresh);
  grants.close();
  assert.equal(freshSignal.aborted, true);
  assert.throws(() => grants.authorize('b', fresh), LockError);
});

test('credential-store failure aborts every existing stream instead of keeping access open', () => {
  let broken = false;
  const grants = new AccessGrants(policy, () => { if (broken) throw new Error('storage invalid'); return 1; });
  const a = grants.issue('a', 1), b = grants.issue('b', 1);
  const signals = [grants.authorize('a', a), grants.authorize('b', b)];
  broken = true;
  assert.throws(() => grants.sweep());
  assert.ok(signals.every(signal => signal.aborted));
  grants.close();
});
