import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Credentials } from '../src/credentials.ts';
import { AccessGrants } from '../src/access-grants.ts';
import { CredentialApi } from '../src/api.ts';
import { HiddenChats } from '../src/hidden-chats.ts';
// @ts-ignore: browser module
import { PrivacyClient } from '../client/model.mjs';

async function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  const directory = mkdtempSync(join(tmpdir(), 'dsh-client-window-'));
  const credentials = new Credentials(directory, { attemptsPerWindow: 5, initialCooldownMs: 60_000,
    maxCooldownMs: 900_000, recoveryLifetimeMs: 300_000, maxPendingOperations: 64 });
  const grants = new AccessGrants({ awayTimeoutMs: 60_000, connectionLeaseMs: 60_000, maxGrants: 64 },
    () => credentials.status().version);
  const hidden = new HiddenChats(directory);
  const policy = { maxRequestBytes: 16_384, maxWindows: 10, windowLifetimeMs: 600_000 };
  let api = new CredentialApi(credentials, grants, policy, hidden);
  const actions: string[] = [];
  const client = new PrivacyClient(async (url: URL, init: RequestInit) => {
    actions.push(JSON.parse(String(init.body)).action);
    return api.fetch(new Request(url, init));
  });
  const backup = await credentials.setup('seed', '1357');
  credentials.confirmBackup('seed', backup.operationId, backup.recoveryCode);
  t.after(() => { api.close(); grants.close(); credentials.close(); hidden.close(); rmSync(directory, { recursive: true }); });
  return { client, credentials, grants, hidden, actions, backup,
    idle() { t.mock.timers.tick(600_001); api.sweep(); },
    restart() { api.close(); api = new CredentialApi(credentials, grants, policy, hidden); },
  };
}

test('PIN unlock recovers after an idle window expires without a page refresh', async t => {
  const f = await fixture(t);
  await f.client.unlock('1357');
  await f.client.lock();
  const oldWindow = f.client.windowToken;
  f.idle();
  await f.client.unlock('1357');
  assert.notEqual(f.client.windowToken, oldWindow);
  assert.equal(f.client.state.unlocked, true);
  assert.equal(f.grants.authorize(f.client.windowToken, f.client.accessToken).aborted, false);
  assert.equal(f.actions.filter(a => a === 'openWindow').length, 2);
});

test('a surviving page can unlock after the Host loses its window registry', async t => {
  const f = await fixture(t);
  await f.client.unlock('1357');
  f.restart();
  await f.client.pulse(true);
  assert.equal(f.client.state.unlocked, false);
  assert.equal(f.client.windowToken, '');
  await f.client.unlock('1357');
  assert.equal(f.client.state.unlocked, true);
});

test('renewing a window still verifies the supplied PIN and never retries a wrong PIN', async t => {
  const f = await fixture(t);
  await f.client.unlock('1357');
  f.idle();
  await assert.rejects(f.client.unlock('0000'), { code: 'invalid_pin' });
  assert.equal(f.client.state.unlocked, false);
  assert.equal(f.client.accessToken, '');
  assert.deepEqual(f.actions.slice(-3), ['unlock', 'openWindow', 'unlock']);
  await f.client.unlock('1357');
  assert.equal(f.client.state.unlocked, true);
});

test('expired access never replays a protected write or transfers a pending backup to a new window', async t => {
  const f = await fixture(t);
  await f.client.unlock('1357');
  const backup = await f.client.call('rotateRecovery', { pin: '1357' });
  f.idle();
  await assert.rejects(f.client.setHidden('ordinary-chat', true), { code: 'wrong_connection' });
  assert.deepEqual(f.hidden.list(), []);
  assert.equal(f.client.state.unlocked, false);
  assert.equal(f.client.windowToken, '');
  await f.client.window();
  await assert.rejects(f.client.call('confirmBackup', { operationId: backup.operationId, recoveryCode: backup.recoveryCode }), { code: 'expired_operation' });
  assert.equal(f.credentials.status().version, 1);
  assert.ok(f.credentials.beginRecovery('check', f.backup.recoveryCode));
});

test('a late response for an old window cannot clear a replacement window', async () => {
  const delayed = Promise.withResolvers<Response>();
  const client = new PrivacyClient(async () => delayed.promise);
  client.windowToken = 'old-window';
  const request = client.call('presence', { accessToken: 'old-access', foreground: true });
  client.windowToken = 'new-window';
  client.accessToken = 'new-access';
  client.update({ unlocked: true });
  delayed.resolve(Response.json({ error: 'wrong_connection' }, { status: 403 }));
  await assert.rejects(request, { code: 'wrong_connection' });
  assert.equal(client.windowToken, 'new-window');
  assert.equal(client.accessToken, 'new-access');
  assert.equal(client.state.unlocked, true);
});

test('closing while a window is opening cannot resurrect the closed client', async () => {
  const delayed = Promise.withResolvers<Response>();
  const client = new PrivacyClient(async () => delayed.promise);
  const opening = client.window();
  client.close();
  delayed.resolve(Response.json({ windowToken: 'late-window' }));
  await assert.rejects(opening, { code: 'wrong_connection' });
  assert.equal(client.windowToken, '');
  assert.equal(client.state.unlocked, false);
});

test('renewal is bounded when the transport keeps rejecting window credentials', async () => {
  const actions: string[] = [];
  const client = new PrivacyClient(async (_url: URL, init: RequestInit) => {
    const action = JSON.parse(String(init.body)).action; actions.push(action);
    return action === 'openWindow' ? Response.json({ windowToken: 'new-window' })
      : Response.json({ error: 'wrong_connection' }, { status: 403 });
  });
  await assert.rejects(client.unlock('1357'), { code: 'wrong_connection' });
  assert.deepEqual(actions, ['openWindow', 'unlock', 'openWindow', 'unlock']);
  assert.equal(client.state.unlocked, false);
});

test('locking during PIN verification discards a late successful unlock', async () => {
  const delayed = Promise.withResolvers<Response>();
  const entered = Promise.withResolvers<void>();
  const client = new PrivacyClient(async (_url: URL, init: RequestInit) => {
    if (JSON.parse(String(init.body)).action === 'unlock') { entered.resolve(); return delayed.promise; }
    return Response.json({});
  });
  client.windowToken = 'current-window';
  const unlocking = client.unlock('1357');
  await entered.promise;
  await client.lock();
  delayed.resolve(Response.json({ accessToken: 'late-access' }));
  await assert.rejects(unlocking, { code: 'wrong_connection' });
  assert.equal(client.accessToken, '');
  assert.equal(client.state.unlocked, false);
});

test('locking an already expired window succeeds locally and allows a fresh unlock', async t => {
  const f = await fixture(t);
  await f.client.unlock('1357');
  f.idle();
  await f.client.lock();
  assert.equal(f.client.state.unlocked, false);
  assert.equal(f.client.windowToken, '');
  await f.client.unlock('1357');
  assert.equal(f.client.state.unlocked, true);
});

test('a rejected verification for an obsolete window cannot retry against a newer window', async () => {
  const delayed = Promise.withResolvers<Response>();
  let requests = 0;
  const client = new PrivacyClient(async () => { requests++; return delayed.promise; });
  client.windowToken = 'old-window';
  const request = client.call('unlock', { pin: '1357' });
  client.windowToken = 'new-window';client.accessToken = 'new-access';client.update({ unlocked: true });
  delayed.resolve(Response.json({ error: 'wrong_connection' }, { status: 403 }));
  await assert.rejects(request, { code: 'wrong_connection' });
  assert.equal(requests, 1);
  assert.equal(client.accessToken, 'new-access');
  assert.equal(client.state.unlocked, true);
});
