// Read-only check of public deployment configuration; never reads secret values.
import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const staging = config.env.staging, problems = [];
let origin;
try {
  origin = new URL(staging.vars.PUBLIC_ORIGIN);
  if (origin.protocol !== 'https:' || origin.hostname.endsWith('.invalid') || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error();
} catch { problems.push('Set staging PUBLIC_ORIGIN to the authorized HTTPS API origin.'); }
if (!staging.vars.GITHUB_CLIENT_ID) problems.push('Set staging GITHUB_CLIENT_ID for the authorized OAuth App.');
const db = staging.d1_databases.find(value => value.binding === 'DB');
if (!db?.database_id || db.database_id === '00000000-0000-0000-0000-000000000000') problems.push('Set the registered staging D1 database_id.');
if (!staging.vars.NATIVE_CALLBACKS.split(',').includes('rememberme://auth/callback')) problems.push('Allow the callback declared by the native apps: rememberme://auth/callback.');
if (problems.length) {
  problems.forEach(value => console.error(value)); process.exitCode = 1;
} else {
  console.log('Public staging configuration ready for review.');
  console.log('GitHub callback: ' + origin.origin + '/auth/github/callback');
  console.log('Confirm GITHUB_CLIENT_SECRET in Cloudflare secret storage and registered signing/App Group capabilities separately. No deployment performed.');
}
