import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomInt } from 'node:crypto';
import { Credentials, type CredentialPolicy } from '../src/credentials.ts';
import { LockError, type LockErrorCode } from '../src/errors.ts';

const policy: CredentialPolicy = {
  attemptsPerWindow: 5, initialCooldownMs: 60_000, maxCooldownMs: 900_000,
  recoveryLifetimeMs: 300_000, maxPendingOperations: 64,
};
const pin = () => randomInt(10_000).toString().padStart(4, '0');
const errorCode = (...codes: LockErrorCode[]) => (error: unknown) => error instanceof LockError && codes.includes(error.code);

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-lock-credentials-'));
  let now = 10_000;
  const handles: Credentials[] = [];
  const open = () => {
    const service = new Credentials(directory, policy, () => now);
    handles.push(service);
    return service;
  };
  t.after(() => { handles.forEach(service => service.close()); rmSync(directory, { recursive: true }); });
  return { directory, service: open(), open, advance: (milliseconds: number) => { now += milliseconds; } };
}

async function enroll(service: Credentials) {
  const password = pin();
  const backup = await service.setup('window-a', password);
  service.confirmBackup('window-a', backup.operationId, backup.recoveryCode);
  return { password, recovery: backup.recoveryCode };
}

test('enrollment does not activate a PIN until the saved backup is confirmed', async t => {
  const f = fixture(t);
  const password = pin();
  const challenge = await f.service.setup('window-a', password);
  assert.equal(f.service.status().configured, false);
  assert.throws(() => f.service.confirmBackup('window-a', challenge.operationId, 'wrong'), errorCode('backup_mismatch'));
  await assert.rejects(f.service.verifyPin(password), errorCode('not_configured'));
  assert.throws(() => f.service.confirmBackup('window-b', challenge.operationId, challenge.recoveryCode), errorCode('wrong_connection'));
  const result = f.service.confirmBackup('window-a', challenge.operationId, challenge.recoveryCode);
  assert.equal(result.version, 1);
  assert.equal(await f.service.verifyPin(password), 1);
  assert.deepEqual(f.service.confirmBackup('window-a', challenge.operationId, challenge.recoveryCode), result);
  await assert.rejects(f.service.setup('window-a', password), errorCode('already_configured'));
  assert.equal(readFileSync(join(f.directory, 'credentials.sqlite')).includes(Buffer.from(challenge.recoveryCode)), false);
});

test('cancellation and restart abandon unconfirmed setup without locking the user out', async t => {
  const f = fixture(t);
  const challenge = await f.service.setup('window-a', pin());
  f.service.cancel('window-a', challenge.operationId);
  assert.throws(() => f.service.confirmBackup('window-a', challenge.operationId, challenge.recoveryCode), errorCode('expired_operation'));
  const staged = await f.service.setup('window-a', pin());
  f.service.close();
  const restarted = f.open();
  assert.equal(restarted.status().configured, false);
  assert.throws(() => restarted.confirmBackup('window-a', staged.operationId, staged.recoveryCode), errorCode('expired_operation'));
  await enroll(restarted);
});

test('PIN changes retain the recovery code; recovery rotates both credentials atomically', async t => {
  const f = fixture(t);
  const initial = await enroll(f.service);
  let changed = pin();
  while (changed === initial.password) changed = pin();
  assert.equal((await f.service.changePin('window-a', initial.password, changed)).version, 2);
  await assert.rejects(f.service.verifyPin(initial.password), errorCode('invalid_pin'));
  const grant = f.service.beginRecovery('window-a', initial.recovery);
  await assert.rejects(f.service.recover('window-b', grant.recoveryGrant, pin()), errorCode('wrong_connection'));
  let recovered = pin();
  while (recovered === changed) recovered = pin();
  const pending = await f.service.recover('window-a', grant.recoveryGrant, recovered);
  assert.equal(await f.service.verifyPin(changed), 2);
  f.service.confirmBackup('window-a', pending.operationId, pending.recoveryCode);
  assert.equal(await f.service.verifyPin(recovered), 3);
  await assert.rejects(f.service.verifyPin(changed), errorCode('invalid_pin'));
  assert.throws(() => f.service.beginRecovery('window-a', initial.recovery), errorCode('invalid_recovery'));
  assert.ok(f.service.beginRecovery('window-a', pending.recoveryCode));
});

test('PIN throttle persists across processes and does not disable recovery', async t => {
  const f = fixture(t);
  const initial = await enroll(f.service);
  const other = f.open();
  for (let i = 0; i < 5; i++) {
    await assert.rejects((i % 2 ? other : f.service).verifyPin('invalid'), errorCode('invalid_pin'));
  }
  await assert.rejects(other.verifyPin(initial.password), errorCode('throttled'));
  f.service.close();
  const restarted = f.open();
  await assert.rejects(restarted.verifyPin(initial.password), errorCode('throttled'));
  assert.ok(restarted.beginRecovery('window-a', initial.recovery));
  await assert.rejects(restarted.verifyPin(initial.password), errorCode('throttled'));
  f.advance(60_000);
  assert.equal(await restarted.verifyPin(initial.password), 1);
});

test('recovery attempts have their own persistent throttle and cannot clear PIN failures', async t => {
  const f = fixture(t);
  const initial = await enroll(f.service);
  for (let i = 0; i < 4; i++) await assert.rejects(f.service.verifyPin('bad'), errorCode('invalid_pin'));
  for (let i = 0; i < 5; i++) {
    assert.throws(() => f.service.beginRecovery('window-a', 'bad'), errorCode('invalid_recovery'));
  }
  f.service.close();
  const restarted = f.open();
  assert.throws(() => restarted.beginRecovery('window-a', initial.recovery), errorCode('throttled'));
  await assert.rejects(restarted.verifyPin('bad'), errorCode('invalid_pin'));
  await assert.rejects(restarted.verifyPin(initial.password), errorCode('throttled'));
  f.advance(60_000);
  assert.ok(restarted.beginRecovery('window-a', initial.recovery));
});

test('two Host instances cannot commit competing credential replacements', async t => {
  const f = fixture(t);
  const initial = await enroll(f.service);
  const other = f.open();
  const grantA = f.service.beginRecovery('window-a', initial.recovery);
  const grantB = other.beginRecovery('window-b', initial.recovery);
  const pinA = pin();
  const [a, b] = await Promise.all([
    f.service.recover('window-a', grantA.recoveryGrant, pinA),
    other.recover('window-b', grantB.recoveryGrant, pin()),
  ]);
  f.service.confirmBackup('window-a', a.operationId, a.recoveryCode);
  assert.throws(() => other.confirmBackup('window-b', b.operationId, b.recoveryCode), errorCode('stale_operation'));
  assert.equal(await other.verifyPin(pinA), 2);
  assert.ok(other.beginRecovery('window-b', a.recoveryCode));
});

test('expired or disconnected recovery does not consume the saved code', async t => {
  const f = fixture(t);
  const initial = await enroll(f.service);
  const first = f.service.beginRecovery('window-a', initial.recovery);
  f.advance(policy.recoveryLifetimeMs);
  await assert.rejects(f.service.recover('window-a', first.recoveryGrant, pin()), errorCode('expired_operation'));
  const second = f.service.beginRecovery('window-a', initial.recovery);
  const staged = await f.service.recover('window-a', second.recoveryGrant, pin());
  f.service.disconnect('window-a');
  assert.throws(() => f.service.confirmBackup('window-a', staged.operationId, staged.recoveryCode), errorCode('expired_operation'));
  assert.ok(f.service.beginRecovery('window-a', initial.recovery));
});

test('write failure rolls back both new credentials and leaves the old backup usable', async t => {
  const f = fixture(t);
  const initial = await enroll(f.service);
  const grant = f.service.beginRecovery('window-a', initial.recovery);
  const nextPin = pin();
  const staged = await f.service.recover('window-a', grant.recoveryGrant, nextPin);
  const injection = new DatabaseSync(join(f.directory, 'credentials.sqlite'));
  t.after(() => injection.close());
  injection.exec("CREATE TRIGGER injected_failure BEFORE UPDATE ON credential BEGIN SELECT RAISE(ABORT, 'injected'); END");
  assert.throws(() => f.service.confirmBackup('window-a', staged.operationId, staged.recoveryCode));
  assert.equal(await f.service.verifyPin(initial.password), 1);
  assert.ok(f.service.beginRecovery('window-a', initial.recovery));
  injection.exec('DROP TRIGGER injected_failure');
  assert.equal(f.service.confirmBackup('window-a', staged.operationId, staged.recoveryCode).version, 2);
  assert.equal(await f.service.verifyPin(nextPin), 2);
});

test('a lost response can be retried after restart without rotating credentials again', async t => {
  const f = fixture(t);
  const initial = await enroll(f.service);
  const staged = await f.service.rotateRecovery('window-a', initial.password);
  f.service.confirmBackup('window-a', staged.operationId, staged.recoveryCode);
  f.service.close();
  const restarted = f.open();
  assert.deepEqual(restarted.confirmBackup('window-a', staged.operationId, staged.recoveryCode), { version: 2 });
  assert.ok(restarted.beginRecovery('window-a', staged.recoveryCode));
  assert.throws(() => restarted.beginRecovery('window-a', initial.recovery), errorCode('invalid_recovery'));
});

test('other domains and corrupt persistent state cannot authorize recovery or reset enrollment', async t => {
  const first = fixture(t);
  const second = fixture(t);
  const a = await enroll(first.service);
  await enroll(second.service);
  assert.throws(() => second.service.beginRecovery('window-a', a.recovery), errorCode('invalid_recovery'));
  first.service.close();
  const db = new DatabaseSync(join(first.directory, 'credentials.sqlite'));
  db.exec('DELETE FROM credential');
  db.close();
  assert.throws(() => first.open(), errorCode('storage_invalid'));
});
