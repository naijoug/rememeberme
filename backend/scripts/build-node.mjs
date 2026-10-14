import { build } from 'esbuild';
await build({
  entryPoints: { server: 'src/server.ts', library: 'src/library.ts' },
  bundle: true, platform: 'node', target: 'node22', format: 'esm',
  outdir: '.build', outExtension: { '.js': '.mjs' }, sourcemap: true,
});
