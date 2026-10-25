import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { verifyReleaseZip } from './release-integrity.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
execFileSync(process.execPath, [join(root, 'node_modules/wxt/bin/wxt.mjs'), 'zip', '--config', 'wxt.release.config.ts'], { cwd: root, stdio: 'inherit' });
const archive = join(root, '.output', `remember-me-${version}-chrome.zip`);
const result = await verifyReleaseZip(archive, version);
await writeFile(archive.replace(/\.zip$/, '.integrity.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`Release ${version}: extracted ZIP verified (${result.checkedResources} linked resources, ${result.files.length} files). SHA-256 ${result.archiveSha256}`);
