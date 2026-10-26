import { mkdtemp, cp, copyFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const output = resolve(process.argv[2] || '.build/rememberme-api.tar.gz');
const stage = await mkdtemp(join(tmpdir(), 'rememberme-release-'));
const runtime = join(stage, 'runtime');
try {
await mkdir(runtime);
await copyFile('.build/server.mjs', join(runtime, 'server.mjs'));
await copyFile('.build/library.mjs', join(runtime, 'library.mjs'));
await cp('migrations', join(runtime, 'migrations'), { recursive: true });
await cp('public', join(runtime, 'public'), { recursive: true });
await cp('.build/dictionary', join(runtime, 'public/dictionary'), { recursive: true });
await cp('deploy', join(stage, 'deploy'), { recursive: true,
  filter: source => !source.split(/[\\/]/).includes('__pycache__') && !/\.py[cod]$/.test(source),
});
await mkdir(join(runtime, 'scripts'));
for (const name of ['backup.mjs', 'restore.mjs', 'check-server.sh', 'verify-live-hermes.mjs', 'verify-live-magpie.mjs', 'verify-live-lookups.mjs', 'verify-github-login.mjs']) await copyFile('scripts/' + name, join(runtime, 'scripts', name));
await mkdir(resolve(output, '..'), { recursive: true });
const tar = spawnSync('tar', ['--no-xattrs', '-czf', output, '-C', stage, 'runtime', 'deploy'], {
  stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' },
});
if (tar.status !== 0) throw new Error('Release packaging failed');
console.log('Deployment archive: ' + output);
console.log('Contains bundled server, migrations, homepage and configuration templates; no database or credentials.');
} finally { await rm(stage, { recursive: true, force: true }); }
