/** Bounded public-interface probes using synthetic sessions; no Host mutation or credential access. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const repo = resolve(root, 'deepseek-harness');
const require = createRequire(resolve(repo, 'packages/core/session/package.json'));
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')));
const { SessionStore } = await import(pathToFileURL(resolve(repo, 'packages/core/session/lib/index.js')));
const { SessionPersistence } = await import(pathToFileURL(resolve(repo, 'packages/session/session-persistence/lib/index.js')));
const { SessionQueryEngine } = await import(pathToFileURL(resolve(repo, 'packages/session-query/session-query/lib/index.js')));
const jsonl = await import(pathToFileURL(resolve(repo, 'packages/session/session-persistence-jsonl/lib/index.js')));
class DenyPersistence extends SessionPersistence {
  async create() { throw new Error('probe: denied'); }
  async open() { throw new Error('probe: denied'); }
  async stat() { return undefined; }
  async list() { return []; }
  async flush() {}
}
class Query extends SessionQueryEngine {
  async searchSessions() { throw new Error('probe: full-text not exercised'); }
  async searchEvents() { throw new Error('probe: full-text not exercised'); }
}
class HiddenSessions extends SessionStore {
  get() { return undefined; }
  list() { return []; }
}
const ctx = new Context();
const storageContexts = [];
const storageDirectory = await mkdtemp(resolve(tmpdir(), 'dsh-public-seams-'));
try {
  await ctx.plugin(SessionStore);
  await ctx.plugin(DenyPersistence);
  await ctx.plugin(Query);
  const session = ctx.sessions.create(undefined, { meta: { cwd: root } });
  const isolated = ctx.isolate('sessions');
  await isolated.plugin(HiddenSessions);
  assert.equal(isolated.sessions.get(session.id), undefined);
  assert.equal(ctx.sessions.get(session.id), session);
  assert.equal(ctx.sessions.list().length, 1);
  await assert.rejects(ctx.sessionPersistence.open(session.id, 'read'), /probe: denied/);
  const listed = await ctx.sessionQuery.listSessions();
  assert.equal(listed.length, 1);
  const read = await ctx.sessionQuery.readSession(session.id);
  assert.ok(read);
  async function storage(path) {
    const owner = new Context(); storageContexts.push(owner);
    await owner.plugin(jsonl, { root: path, compression: 'none', listConcurrency: 1 });
    return owner;
  }
  const privateRoot = resolve(storageDirectory, 'private');
  const privateWriter = await storage(privateRoot);
  const handle = await privateWriter.sessionPersistence.create(session.header);
  await handle.flush(); await handle.close();
  await privateWriter.fiber.dispose();
  const ordinary = await storage(resolve(storageDirectory, 'ordinary'));
  assert.equal((await ordinary.sessionPersistence.list()).length, 0);
  await assert.rejects(ordinary.sessionPersistence.open(session.id, 'read'));
  const reopened = await storage(privateRoot);
  assert.equal((await reopened.sessionPersistence.list()).length, 1);
  const persisted = await reopened.sessionPersistence.open(session.id, 'read');
  await persisted.read(); await persisted.close();
  const result = {
    version: '0.2.1-rc.2', syntheticOnly: true, hostModified: false,
    isolation: { childHidesSession: true, originalScopeStillReadsSession: true },
    persistenceReplacement: { backendDeniesRead: true, originalLiveQueryStillReads: true },
    privateStorage: { separateRootsSupported: true, ordinaryRootDoesNotDiscoverPrivateRecord: true, reopenPreservesSyntheticRecord: true, existingChatMigrationTested: false },
    scope: 'Public Context.isolate, SessionStore/SessionQuery/SessionPersistence and JSONL configuration; no full-text, existing-chat migration or attachment coverage',
    conclusion: 'Child isolation and persistence-only denial do not by themselves protect an existing live session',
  };
  await writeFile(resolve(root, 'docs/evidence/public-seams.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await ctx.fiber.dispose();
  for (const owner of storageContexts) await owner.fiber.dispose();
  await rm(storageDirectory, { recursive: true, force: true });
}
