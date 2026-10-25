import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
await build({
  entryPoints: { server: 'src/server.ts', library: 'src/library.ts' },
  bundle: true, platform: 'node', target: 'node22', format: 'esm',
  outdir: '.build', outExtension: { '.js': '.mjs' }, sourcemap: true,
});
await mkdir('.build/dictionary', { recursive: true });
await cp('../frontend/browser-extension/public/dictionary/wordnet', '.build/dictionary/wordnet', { recursive: true });
