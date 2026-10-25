import { readFileSync, lstatSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));
const zeroId = '00000000000000000000000000000000';
const oldServices = new Set(['01a13b1f-f04b-7892-ada7-d9092b7ff0f4', '01a13e1f-3d24-7082-95bd-1d336c070b2a']);
const targets = ['account-gateway', 'lookup-gateway', 'account-entry', 'lookup-entry'];

export function readToken(file) {
  let stat;
  try { stat = lstatSync(file); } catch { throw new Error('Configure the explicit Cloudflare credential file first (mode 0600); global credentials are never used.'); }
  if (!stat.isFile() || (stat.mode & 0o077) || stat.uid !== process.getuid()) {
    throw new Error('The token file must be a regular file owned by you with mode 0600.');
  }
  const values = parseEnv(readFileSync(file, 'utf8'));
  if (Object.keys(values).some(key => key !== 'CLOUDFLARE_API_TOKEN')) throw new Error('Only CLOUDFLARE_API_TOKEN belongs in the token file.');
  const token = values.CLOUDFLARE_API_TOKEN;
  if (!token || /\s/.test(token)) throw new Error('Configure a nonempty Cloudflare API token in the private token file.');
  return token;
}

export function isolatedEnvironment(env, token, accountId) {
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !/^(CF_|CLOUDFLARE_|WRANGLER_)/.test(key)));
  return { ...clean, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', WRANGLER_SEND_METRICS: 'false', CI: 'true' };
}

export async function apiGet(path, token, request = fetch) {
  let response, body;
  try {
    response = await request(`https://api.cloudflare.com/client/v4/${path}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000), redirect: 'error',
    });
    body = await response.json();
  } catch { throw new Error(`Cloudflare GET ${path} failed; no write was attempted.`); }
  // Do not echo remote error bodies or credentials into terminal logs.
  if (!response.ok || body.success !== true) throw new Error(`Cloudflare GET ${path}: HTTP ${response.status}. Check token permissions.`);
  return body;
}

export async function verifyIdentity(policy, token, get = apiGet) {
  if (policy.expectedEmail !== 'naijoug@outlook.com') throw new Error('Unexpected personal Cloudflare identity policy.');
  const accountId = policy.accountId ?? policy.candidateAccountId;
  if (!/^[a-f0-9]{32}$/.test(accountId ?? '') || accountId === zeroId ||
      accountId === '83d5b273d7ceb2b02a9f454f67ac495b' || policy.blockedAccountIds?.includes(accountId)) {
    throw new Error('Missing or forbidden target account ID.');
  }
  const user = (await get('user', token)).result;
  if (user?.email?.toLowerCase() !== policy.expectedEmail) throw new Error('Cloudflare user email does not match naijoug@outlook.com.');
  for (let page = 1; page <= 100; page++) {
    const memberships = await get(`memberships?per_page=50&page=${page}`, token);
    if (memberships.result?.some(m => m.status === 'accepted' && m.account?.id === accountId)) {
      return { email: policy.expectedEmail, accountId };
    }
    if (page >= (memberships.result_info?.total_pages ?? 1)) break;
  }
  throw new Error('No active membership in the explicitly selected Cloudflare account.');
}

export function deploymentArgs(target, config, accountId) {
  if (!targets.includes(target)) throw new Error('Unknown Cloudflare deployment target.');
  if (!accountId || config.account_id !== accountId || accountId === zeroId || accountId === '83d5b273d7ceb2b02a9f454f67ac495b') {
    throw new Error('Deployment config must pin the verified personal account ID.');
  }
  if (config.env && Object.keys(config.env).length) throw new Error('Named environments are not supported by this gateway deployment entry.');
  const expectedName = target.startsWith('lookup') ? 'rememberme-lookup' : target.endsWith('gateway') ? 'rememberme-account' : 'rememberme';
  if (config.name !== expectedName) throw new Error('Unexpected deployment resource name.');
  if (target.endsWith('gateway')) {
    if (config.vpc_services?.length !== 1 || config.vpc_services.some(s =>
      !/^[a-f0-9-]{36}$/.test(s.service_id ?? '') || /^0+-0+-0+-0+-0+$/.test(s.service_id) || oldServices.has(s.service_id))) {
      throw new Error('Replace the old/placeholder VPC service with the verified personal service before deployment.');
    }
    return ['deploy', '--config', `${target}/wrangler.jsonc`];
  }
  return ['pages', 'deploy', `${target}/public`, '--project-name', config.name, '--branch', 'main', '--config', `${target}/wrangler.jsonc`];
}

export async function main(args = process.argv.slice(2)) {
  const [command, target, ...extra] = args;
  if (!['check', 'deploy'].includes(command) || extra.length || (command === 'check' && target) || (command === 'deploy' && !targets.includes(target))) {
    throw new Error('Usage: node scripts/cloudflare.mjs check | deploy <account-gateway|lookup-gateway|account-entry|lookup-entry>');
  }
  const policy = JSON.parse(readFileSync(resolve(root, 'deploy/cloudflare-account.json'), 'utf8'));
  const token = readToken(policy.credentialsFile ?? resolve(root, '.env.cloudflare'));
  const identity = await verifyIdentity(policy, token);
  console.log(`Verified Cloudflare identity: ${identity.email}; account: ${identity.accountId}`);
  if (command === 'check') return;
  if (policy.accountId !== identity.accountId) throw new Error('Record the verified accountId in deploy/cloudflare-account.json before deployment.');
  const config = JSON.parse(readFileSync(resolve(root, target, 'wrangler.jsonc'), 'utf8'));
  const wranglerArgs = deploymentArgs(target, config, identity.accountId);
  for (const service of config.vpc_services ?? []) {
    await apiGet(`accounts/${identity.accountId}/connectivity/directory/services/${service.service_id}`, token);
  }
  const child = spawnSync(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), ...wranglerArgs], {
    cwd: root, env: isolatedEnvironment(process.env, token, identity.accountId), stdio: 'inherit',
  });
  if (child.error || child.status !== 0) throw new Error('Cloudflare deployment failed.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
