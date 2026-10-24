/** Exercise the installed Host's compatibility evaluator against the plugin manifest. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

assert.ok(process.argv[2], 'Pass the directory containing a real dsh installation package.json');
const requireHost = createRequire(resolve(process.argv[2], 'package.json'));
const { evaluatePluginCompatibility } = await import(pathToFileURL(requireHost.resolve('@deepseek-ai/dsh-app-boot')));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
for (const version of ['0.2.1-rc.2', '0.2.1-rc.3']) {
  assert.equal(evaluatePluginCompatibility(manifest, {}, version), undefined, `Host must accept ${version} without exemptions`);
}
for (const version of ['0.2.1-rc.1', '0.2.1-rc.4', '0.2.1', '0.3.0']) {
  assert.ok(evaluatePluginCompatibility(manifest, {}, version), `Do not claim unverified ${version} compatibility`);
}
const requireBoot = createRequire(requireHost.resolve('@deepseek-ai/dsh-app-boot'));
const semver = requireBoot('semver');
for (const version of ['0.2.1-rc.2', '0.2.1-rc.3']) {
  assert.ok(semver.satisfies(version, manifest.peerDependencies['@deepseek-ai/dsh-client-connection']), `Connection peer must accept ${version}`);
}
console.log(JSON.stringify({ accepted: ['0.2.1-rc.2', '0.2.1-rc.3'], unverifiedVersionsRejected: true, exemptions: false }));
