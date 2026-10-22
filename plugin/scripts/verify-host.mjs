/** Credential smoke against a disposable, real dsh Web profile; never run against personal data. */
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';

if (process.env.DSH_TEST_ISOLATED !== '1' || !process.env.DSH_TEST_URL) {
  throw new Error('Set DSH_TEST_ISOLATED=1 and DSH_TEST_URL to the disposable Host launch URL.');
}
const launch = new URL(process.env.DSH_TEST_URL);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(launch.hostname), 'Disposable smoke must use loopback');
const exchange = await fetch(launch, { redirect: 'manual' });
const cookie = exchange.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie, 'Expected an authenticated disposable Host launch URL');
const endpoint = new URL('/api/locked-chats/credentials', launch);
const anonymous = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', origin: launch.origin },
  body: JSON.stringify({ action: 'status' }) });
assert.equal(anonymous.status, 401, 'Host authentication must precede the plugin endpoint');
const foreignOrigin = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', cookie,
  origin: 'https://untrusted.example' }, body: JSON.stringify({ action: 'status' }) });
assert.equal(foreignOrigin.status, 403, 'A foreign origin must not use an owner cookie');

async function call(action, args = {}, window) {
  const headers = { 'content-type': 'application/json', cookie, origin: launch.origin };
  if (window) headers['x-dsh-private-window'] = window;
  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ action, ...args }) });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return { status: response.status, value: await response.json() };
}

const status = await call('status');
assert.equal(status.status, 200, 'Plugin must be loaded by dsh');
assert.equal(status.value.configured, false, 'Use a fresh disposable profile; do not overwrite existing credentials');
const a = (await call('openWindow')).value.windowToken;
const b = (await call('openWindow')).value.windowToken;
const pin = randomInt(10_000).toString().padStart(4, '0');
const first = await call('setup', { pin, confirmation: pin }, a);
assert.equal(first.status, 200);
assert.equal((await call('status')).value.configured, false);
assert.equal((await call('confirmBackup', first.value, b)).status, 403);
assert.equal((await call('confirmBackup', first.value, a)).status, 200);
const access = (await call('unlock', { pin }, a)).value.accessToken;
assert.equal((await call('presence', { accessToken: access, foreground: true }, b)).status, 403);
assert.equal((await call('presence', { accessToken: access, foreground: true }, a)).status, 200);
const recovery = (await call('beginRecovery', { recoveryCode: first.value.recoveryCode }, a)).value.recoveryGrant;
let newPin = pin;
while (newPin === pin) newPin = randomInt(10_000).toString().padStart(4, '0');
const second = await call('recover', { recoveryGrant: recovery, pin: newPin, confirmation: newPin }, a);
assert.equal(second.status, 200);
assert.equal((await call('confirmBackup', second.value, a)).status, 200);
assert.equal((await call('presence', { accessToken: access, foreground: true }, a)).status, 403);
assert.equal((await call('unlock', { pin }, a)).status, 403);
assert.equal((await call('unlock', { pin: newPin }, a)).status, 200);
assert.equal((await call('beginRecovery', { recoveryCode: first.value.recoveryCode }, a)).status, 403);
await call('closeWindow', {}, a);
await call('closeWindow', {}, b);
console.log(JSON.stringify({ result: 'passed', scope: 'real dsh owner-route credential lifecycle',
  chatProtectionReady: status.value.chatProtectionReady, secretsReported: false }));
