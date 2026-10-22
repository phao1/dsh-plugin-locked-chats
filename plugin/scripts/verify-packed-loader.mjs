/** Packed-code Cordis lifecycle test. Transport is a fixture, not a real dsh installation. */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Context, Service } from '@deepseek-ai/cordis';

const pluginRoot = fileURLToPath(new URL('..', import.meta.url));
const archive = resolve(process.argv[2] ?? '');
assert.ok(archive.endsWith('.tgz'), 'Pass the reviewed local plugin tarball');
const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
assert.ok(entries.every(entry => entry.startsWith('package/') && !entry.split('/').includes('..')));
const directory = await mkdtemp(resolve(pluginRoot, '.packed-check-'));
const ctx = new Context();
const routes = new Map();
class ConnectionFixture extends Service {
  constructor(owner) {
    super(owner, 'connection');
    this.fetch = { register(route) {
      assert.equal(routes.has(route.path), false);
      routes.set(route.path, route);
      return () => { routes.delete(route.path); };
    } };
  }
}
try {
  execFileSync('tar', ['-xzf', archive, '-C', directory]);
  const packed = await import(pathToFileURL(resolve(directory, 'package/lib/index.js')));
  await ctx.plugin(ConnectionFixture);
  const fiber = ctx.plugin(packed, { directory: resolve(directory, 'synthetic-state') });
  await fiber;
  assert.equal(routes.size, 2);
  const page = await routes.get('/api/locked-chats/settings').fetch(new Request('http://localhost/api/locked-chats/settings'));
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('导入恢复文件'));
  const status = await routes.get('/api/locked-chats/credentials').fetch(new Request('http://localhost/api/locked-chats/credentials', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'status' }),
  }));
  const state = await status.json();
  assert.equal(state.configured, false);
  assert.equal(state.chatProtectionReady, false);
  await fiber.dispose();
  assert.equal(routes.size, 0);
  const evidence = { packedImport: 'passed', cordisActivation: 'passed', routeDisposal: 'passed',
    syntheticState: true, realHostInstallation: 'not_tested', transport: 'fixture', credentialValuesReported: false };
  await writeFile(resolve(pluginRoot, '../docs/evidence/packed-loader.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }); }
