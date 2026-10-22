import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Credentials } from '../src/credentials.ts';
import { AccessGrants } from '../src/access-grants.ts';
import { CredentialApi } from '../src/api.ts';

test('credential transport binds windows, bounds bodies, and never advertises chat protection prematurely', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-lock-api-'));
  const credentials = new Credentials(directory, { attemptsPerWindow: 5, initialCooldownMs: 60_000,
    maxCooldownMs: 900_000, recoveryLifetimeMs: 300_000, maxPendingOperations: 64 });
  const grants = new AccessGrants({ awayTimeoutMs: 60_000, connectionLeaseMs: 60_000, maxGrants: 64 },
    () => credentials.status().version);
  const api = new CredentialApi(credentials, grants, { maxRequestBytes: 1024, maxWindows: 10, windowLifetimeMs: 600_000 });
  t.after(() => { api.close(); grants.close(); credentials.close(); rmSync(directory, { recursive: true }); });
  const call = async (body: unknown, token?: string) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers['x-dsh-private-window'] = token;
    const response = await api.fetch(new Request('http://localhost/api/locked-chats/credentials', {
      method: 'POST', headers, body: JSON.stringify(body),
    }));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await call({ action: 'status' })).body.chatProtectionReady, false);
  const a = (await call({ action: 'openWindow' })).body.windowToken;
  const b = (await call({ action: 'openWindow' })).body.windowToken;
  assert.notEqual(a, b);
  assert.equal((await call({ action: 'setup', pin: '1234', confirmation: '1234' })).status, 403);
  assert.equal((await call({ action: 'setup', pin: '1234', confirmation: '1235' }, a)).status, 400);
  const challenge = (await call({ action: 'setup', pin: '1234', confirmation: '1234' }, a)).body;
  assert.equal((await call({ action: 'confirmBackup', ...challenge }, b)).status, 403);
  assert.equal((await call({ action: 'confirmBackup', ...challenge }, a)).status, 200);
  const access = (await call({ action: 'unlock', pin: '1234' }, a)).body.accessToken;
  assert.equal((await call({ action: 'presence', accessToken: access, foreground: true }, b)).status, 403);
  assert.equal((await call({ action: 'presence', accessToken: access, foreground: true }, a)).status, 200);
  assert.equal((await call({ action: 'status', extra: 'x'.repeat(2048) })).status, 400);
  const status = (await call({ action: 'status' })).body;
  assert.equal(status.configured, true);
  assert.equal(status.recoveryCode, undefined);
  assert.equal(status.chatProtectionReady, false);
  await call({ action: 'lock', accessToken: access }, a);
  assert.equal((await call({ action: 'presence', accessToken: access, foreground: true }, a)).status, 403);
});

test('closing a window during PIN verification prevents a late access grant', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-lock-api-race-'));
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  class PausedCredentials extends Credentials {
    override async verifyPin(pin: string): Promise<number> {
      const version = await super.verifyPin(pin);
      entered.resolve();
      await resume.promise;
      return version;
    }
  }
  const credentials = new PausedCredentials(directory, { attemptsPerWindow: 5, initialCooldownMs: 60_000,
    maxCooldownMs: 900_000, recoveryLifetimeMs: 300_000, maxPendingOperations: 64 });
  const grants = new AccessGrants({ awayTimeoutMs: 60_000, connectionLeaseMs: 60_000, maxGrants: 64 },
    () => credentials.status().version);
  const api = new CredentialApi(credentials, grants, { maxRequestBytes: 1024, maxWindows: 10, windowLifetimeMs: 600_000 });
  t.after(() => { resume.resolve(); api.close(); grants.close(); credentials.close(); rmSync(directory, { recursive: true }); });
  const challenge = await credentials.setup('enrollment', '1234');
  credentials.confirmBackup('enrollment', challenge.operationId, challenge.recoveryCode);
  const call = (body: unknown, token?: string) => api.fetch(new Request('http://localhost/api/locked-chats/credentials', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-dsh-private-window': token } : {}) },
    body: JSON.stringify(body),
  }));
  const { windowToken } = await (await call({ action: 'openWindow' })).json();
  const unlocking = call({ action: 'unlock', pin: '1234' }, windowToken);
  await entered.promise;
  assert.equal((await call({ action: 'closeWindow' }, windowToken)).status, 200);
  resume.resolve();
  const response = await unlocking;
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'wrong_connection', retryAfterSeconds: 0 });
});
