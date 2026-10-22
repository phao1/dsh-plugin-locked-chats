import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IsolatedMemory, MEMORY_GUIDANCE, MEMORY_TOOL_NAME, registerMemoryTools } from '../src/memory-isolation.ts';
import { HiddenChats } from '../src/hidden-chats.ts';
import { WorkspaceLocks, type LockSessionHeader } from '../src/workspace-locks.ts';

function fixture(t: any) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-isolated-memory-'));
  const locked = new Set(['private-a', 'private-b']);
  let unavailable = false;
  const resolveLock = (id: string) => { if (unavailable) throw new Error('session_not_found'); return locked.has(id); };
  let memory = new IsolatedMemory(directory, resolveLock, () => 1234);
  let definition: any, prompt: any, toolDisposed = false, promptDisposed = false;
  const host = { tools: { register(tool: any) { definition = tool; return () => { toolDisposed = true; }; } },
    systemPrompt: { section(section: any) { prompt = section; return () => { promptDisposed = true; }; } } };
  let dispose = registerMemoryTools(host, memory);
  t.after(() => { dispose(); memory.close(); rmSync(directory, { recursive: true }); });
  const invoke = (id: string, args: any, signal = new AbortController().signal) => definition.execute(args, { agent: { session: { id } }, signal });
  return { invoke, locked, definition, prompt, memory,
    setUnavailable(value: boolean) { unavailable = value; },
    disposeAndCheck() { dispose(); assert.equal(toolDisposed, true); assert.equal(promptDisposed, true); },
    restart() { dispose(); memory.close(); memory = new IsolatedMemory(directory, resolveLock); dispose = registerMemoryTools(host, memory); },
  };
}

test('real registered memory handler isolates writes and permits locked read-through of ordinary memories', async t => {
  const f = fixture(t);
  assert.equal(f.definition.name, MEMORY_TOOL_NAME);
  assert.equal(f.definition.parameters.additionalProperties, false);
  assert.equal(f.prompt.text, MEMORY_GUIDANCE);
  await f.invoke('ordinary', { action: 'remember', key: 'drink', text: 'green tea' });
  await f.invoke('private-a', { action: 'remember', key: 'surprise', text: 'violet birthday cake' });
  const ordinary = await f.invoke('ordinary', { action: 'search' });
  assert.deepEqual(ordinary.memories.map((m: any) => m.key), ['drink']);
  const privateResult = await f.invoke('private-b', { action: 'search' });
  assert.deepEqual(new Set(privateResult.memories.map((m: any) => m.key)), new Set(['drink', 'surprise']));
  assert.equal((await f.invoke('ordinary', { action: 'search', query: 'violet' })).memories.length, 0);
  assert.equal((await f.invoke('ordinary', { action: 'forget', key: 'surprise' })).changed, false);
  assert.equal((await f.invoke('private-a', { action: 'forget', key: 'drink' })).changed, false);
  assert.equal((await f.invoke('ordinary', { action: 'search' })).memories.length, 1);
});

test('session state, never model arguments, determines memory authority on every execution', async t => {
  const f = fixture(t);
  await f.invoke('private-a', { action: 'remember', key: 'same-key', text: 'private value' });
  await assert.rejects(f.invoke('ordinary', { action: 'search', scope: 'locked' }), /cannot be supplied/);
  await assert.rejects(f.invoke('ordinary', { action: 'remember', key: 'same-key', text: 'attempt', sessionId: 'private-a' }), /cannot be supplied/);
  await assert.rejects(f.definition.execute({ action: 'search' }, { signal: new AbortController().signal }), /host-owned/);
  await f.invoke('ordinary', { action: 'remember', key: 'same-key', text: 'ordinary value' });
  assert.deepEqual((await f.invoke('ordinary', { action: 'search' })).memories.map((m: any) => m.text), ['ordinary value']);
  f.locked.delete('private-a');
  assert.deepEqual((await f.invoke('private-a', { action: 'search' })).memories.map((m: any) => m.text), ['ordinary value']);
  assert.equal((await f.invoke('private-b', { action: 'search', query: 'private value' })).memories.length, 1);
  f.restart();
  assert.equal((await f.invoke('ordinary', { action: 'search', query: 'private value' })).memories.length, 0);
  assert.equal((await f.invoke('private-b', { action: 'search', query: 'private value' })).memories.length, 1);
});

test('lock transitions preserve old ordinary memory and future private memory never migrates', async t => {
  const f = fixture(t);
  await f.invoke('ordinary', { action: 'remember', key: 'before', text: 'old ordinary fact' });
  f.locked.add('ordinary');
  await f.invoke('ordinary', { action: 'remember', key: 'after', text: 'new locked fact' });
  assert.equal((await f.invoke('other', { action: 'search' })).memories[0].key, 'before');
  f.locked.delete('ordinary');
  assert.equal((await f.invoke('ordinary', { action: 'search', query: 'locked' })).memories.length, 0);
  assert.equal((await f.invoke('private-b', { action: 'search', query: 'locked' })).memories.length, 1);
});

test('invalid, aborted and unavailable-authority requests cannot read or mutate memory', async t => {
  const f = fixture(t);
  await assert.rejects(f.invoke('ordinary', { action: 'remember', key: '', text: 'secret' }));
  await assert.rejects(f.invoke('ordinary', { action: 'remember', key: 'key', text: 'x'.repeat(4001) }));
  await assert.rejects(f.invoke('ordinary', { action: 'search', query: 'x', text: 'unexpected' }));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.invoke('ordinary', { action: 'remember', key: 'abort', text: 'secret' }, controller.signal));
  f.setUnavailable(true);
  await assert.rejects(f.invoke('private-a', { action: 'remember', key: 'lost-authority', text: 'secret' }), /session_not_found/);
  await assert.rejects(f.invoke('private-a', { action: 'search' }), /session_not_found/);
  await assert.rejects(f.invoke('private-a', { action: 'forget', key: 'lost-authority' }), /session_not_found/);
  f.setUnavailable(false);
  assert.equal((await f.invoke('ordinary', { action: 'search' })).memories.length, 0);
  f.disposeAndCheck();
  await assert.rejects(f.invoke('private-a', { action: 'search' }), /unavailable/);
});

test('native memory handler uses new live session headers before workspace attachment or creation-cache delivery', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-memory-creation-'));
  const cwd = join(directory, 'workspace'); mkdirSync(cwd);
  const hidden = new HiddenChats(directory);
  const live = new Map<string, { header: LockSessionHeader }>();
  const locks = new WorkspaceLocks(hidden, {
    workspaceRegistry: { list: () => [{ id: 'private-workspace', path: cwd, sessionIds: [] }] },
    sessions: { list: () => [...live.values()], get: id => live.get(id) },
    sessionPersistence: { list: async () => [] },
  });
  locks.setWorkspace('private-workspace', true);
  await locks.refresh();
  const memory = new IsolatedMemory(directory, id => locks.isLockedId(id));
  let definition: any;
  const dispose = registerMemoryTools({
    tools: { register(tool) { definition = tool; return () => {}; } },
    systemPrompt: { section() { return () => {}; } },
  }, memory);
  t.after(() => { dispose(); memory.close(); hidden.close(); rmSync(directory, { recursive: true }); });
  const invoke = (id: string, args: unknown) => definition.execute(args, { agent: { session: { id } }, signal: new AbortController().signal });
  // Real dsh enters the live Session before synchronous session/created and
  // attaches it to the Workspace only after agent creation has completed.
  live.set('fresh-private', { header: { id: 'fresh-private', cwd } });
  const saved = await invoke('fresh-private', { action: 'remember', key: 'new-secret', text: 'creation window secret' });
  assert.equal(saved.scope, 'locked');
  live.set('nested', { header: { id: 'nested', cwd: directory, parentSession: 'fresh-private' } });
  assert.equal((await invoke('nested', { action: 'search' })).memories[0].key, 'new-secret');
  live.set('fresh-ordinary', { header: { id: 'fresh-ordinary', cwd: directory } });
  assert.deepEqual((await invoke('fresh-ordinary', { action: 'search' })).memories, []);
  live.set('unknown-parent', { header: { id: 'unknown-parent', cwd: directory, parentSession: 'missing-parent' } });
  await assert.rejects(invoke('unknown-parent', { action: 'remember', key: 'unresolved', text: 'must not become ordinary' }), /session_not_found/);
  assert.deepEqual((await invoke('fresh-ordinary', { action: 'search' })).memories, []);
});
