import { build } from 'esbuild';
await build({ entryPoints: ['src/dictionary/cli.ts'], bundle: true, platform: 'node', target: 'node22', format: 'esm',
  outfile: '.build/dictionary-cli.mjs', sourcemap: true });
await build({ entryPoints: ['src/dictionary/audit-cli.ts'], bundle: true, platform: 'node', target: 'node22', format: 'esm',
  outfile: '.build/dictionary-audit.mjs', sourcemap: true });
await build({ entryPoints: ['src/dictionary/package.ts'], bundle: true, platform: 'node', target: 'node22', format: 'esm',
  outfile: '.build/dictionary-assets.mjs', sourcemap: true });
