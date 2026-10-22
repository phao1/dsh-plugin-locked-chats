import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await build({ entryPoints: [new URL('../client/index.mjs', import.meta.url).pathname], bundle: true,
  platform: 'browser', format: 'cjs', external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'], loader: { '.css': 'text' }, target: 'es2022',
  outfile: new URL('../lib/client.js', import.meta.url).pathname,
  banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;` },
  footer: { js: 'return module.exports;}});' },
});
