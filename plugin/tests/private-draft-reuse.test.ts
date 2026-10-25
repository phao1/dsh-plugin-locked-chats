import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser module
import { protectPrivateDraftReuse } from '../client/private-draft-reuse.mjs';

test('native named blank reuse cannot select a protected draft; preset and draft navigation stay native', async () => {
  const calls: any[] = [];
  const sessions = {
    list: { getSnapshot: () => ({ byId: { private: { blank: true }, ordinary: { blank: true }, conversation: { blank: false } } }) },
    async create(request: any) { assert.equal(this, sessions); calls.push(request); return request.sessionId; },
  };
  const original = sessions.create;
  const dispose = protectPrivateDraftReuse(sessions, () => new Set(['private', 'conversation', 'reserved']));
  const privateRequest = { sessionId: 'private', workspaceId: 'workspace', agentPreset: 'custom', allowMigration: false };
  const created = await sessions.create(privateRequest);
  assert.notEqual(created, 'private');
  assert.match(created, /^[0-9a-f-]{36}$/);
  assert.deepEqual(calls[0], { ...privateRequest, sessionId: created });
  assert.equal(privateRequest.sessionId, 'private', 'do not mutate native caller inputs');
  for (const sessionId of ['ordinary', 'conversation', 'reserved', undefined]) {
    const request = { sessionId, workspaceId: 'workspace' };
    await sessions.create(request);
    assert.equal(calls.at(-1), request, 'all other native requests retain object identity');
  }
  dispose(); assert.equal(sessions.create, original);
});

test('protection follows live lock membership and unloading preserves a later extension', async () => {
  const hidden = new Set(['draft']);
  const sessions = { list: { getSnapshot: () => ({ byId: { draft: { blank: true } } }) }, async create(input: any) { return input.sessionId; } };
  const dispose = protectPrivateDraftReuse(sessions, () => hidden);
  assert.notEqual(await sessions.create({ sessionId: 'draft' }), 'draft');
  hidden.clear(); assert.equal(await sessions.create({ sessionId: 'draft' }), 'draft');
  hidden.add('draft');
  const captured = sessions.create;
  const next = async (input: any) => captured.call(sessions, input); sessions.create = next;
  dispose(); assert.equal(sessions.create, next);
  assert.equal(await sessions.create({ sessionId: 'draft' }), 'draft', 'unloaded guard must be inert even when retained by another extension');
});
