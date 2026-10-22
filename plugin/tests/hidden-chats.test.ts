import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HiddenChats } from '../src/hidden-chats.ts';
import { Credentials } from '../src/credentials.ts';
import { AccessGrants } from '../src/access-grants.ts';
import { CredentialApi } from '../src/api.ts';
// @ts-ignore: browser model is intentionally framework-independent JavaScript.
import { PrivacyClient, visibleRows, visibleHits } from '../client/model.mjs';

test('UI list and search filters exclude hidden pinned rows without changing catalog or archive membership', () => {
  const catalog = { ids: ['public','private'], byId: { public: { id:'public' }, private: { id:'private' } } };
  const hidden = new Set(['private']);
  assert.deepEqual(visibleRows(catalog, hidden, new Set()).map((r: {id:string}) => r.id), ['public']);
  assert.deepEqual(visibleHits([{ sessionId:'private', snippet:'sensitive' }, {sessionId:'public',snippet:'normal'}], hidden), [{sessionId:'public',snippet:'normal'}]);
  assert.equal(catalog.ids.length, 2);
});

test('actual browser model talks to credential API: hidden membership requires PIN, survives recovery and restart, removes without deleting chat', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-ui-lock-'));
  const credentials = new Credentials(directory, { attemptsPerWindow:5, initialCooldownMs:60000, maxCooldownMs:900000, recoveryLifetimeMs:300000, maxPendingOperations:64 });
  const grants = new AccessGrants({awayTimeoutMs:60000,connectionLeaseMs:60000,maxGrants:64}, () => credentials.status().version);
  let hidden = new HiddenChats(directory);
  const api = new CredentialApi(credentials, grants, {maxRequestBytes:16384,maxWindows:64,windowLifetimeMs:600000}, hidden);
  t.after(() => { api.close(); grants.close(); credentials.close(); hidden.close(); rmSync(directory,{recursive:true}); });
  const client = new PrivacyClient((url: URL, init: RequestInit) => api.fetch(new Request(url,init)));
  await client.refresh(); assert.equal(client.state.configured,false);
  await client.window();
  await assert.rejects(client.setHidden('fixture-session',true));
  const setup = await client.call('setup',{pin:'7319',confirmation:'7319'});
  await client.call('confirmBackup',{operationId:setup.operationId,recoveryCode:setup.recoveryCode});
  await client.unlock('7319'); await client.setHidden('fixture-session',true);
  assert.deepEqual(client.state.ids,['fixture-session']);
  await client.lock(); await assert.rejects(client.setHidden('fixture-session',false));
  const recovery = await client.call('beginRecovery',{recoveryCode:setup.recoveryCode});
  const replacement = await client.call('recover',{recoveryGrant:recovery.recoveryGrant,pin:'8274',confirmation:'8274'});
  await client.call('confirmBackup',{operationId:replacement.operationId,recoveryCode:replacement.recoveryCode});
  assert.deepEqual(hidden.list(),['fixture-session']);
  await assert.rejects(client.unlock('7319')); await client.unlock('8274');
  await client.setHidden('fixture-session',false); assert.deepEqual(hidden.list(),[]);
  await client.setHidden('fixture-session',true);
  hidden.close(); hidden = new HiddenChats(directory); assert.deepEqual(hidden.list(),['fixture-session']);
});
