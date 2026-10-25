import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiGet, deploymentArgs, isolatedEnvironment, readToken, verifyIdentity } from './cloudflare.mjs';

const accountId = 'a'.repeat(32);
const policy = { expectedEmail: 'naijoug@outlook.com', accountId };
const membership = { status: 'accepted', account: { id: accountId } };
const response = (result) => ({ result });
const identityApi = async (path) => response(path === 'user' ? { email: policy.expectedEmail } : [membership]);

test('verifies email and active membership, not the first account returned', async () => {
  const calls = [];
  const api = async path => {
    calls.push(path);
    if (path === 'user') return response({ email: policy.expectedEmail });
    return { result: path.endsWith('page=1') ? [{ ...membership, account: { id: 'b'.repeat(32) } }] : [membership], result_info: { total_pages: 2 } };
  };
  assert.deepEqual(await verifyIdentity(policy, 'fixture', api), { email: policy.expectedEmail, accountId });
  assert.equal(calls.length, 3);
});

test('rejects company identity even when it has access to the target account', async () => {
  let reads = 0;
  await assert.rejects(verifyIdentity(policy, 'fixture', async () => {
    reads++;
    return response({ email: 'guojian@hoxigames.com' });
  }), /email does not match/);
  assert.equal(reads, 1);
});

test('rejects the company account before any API request', async () => {
  await assert.rejects(verifyIdentity({ ...policy, accountId: '83d5b273d7ceb2b02a9f454f67ac495b' }, 'fixture', () => assert.fail('No network expected')), /forbidden/);
});

test('rejects missing and pending memberships', async () => {
  for (const memberships of [[], [{ ...membership, status: 'pending' }]]) {
    await assert.rejects(verifyIdentity(policy, 'fixture', async path => path === 'user' ? identityApi(path) : response(memberships)), /No active membership/);
  }
});

test('permission failure stops verification without exposing remote error text', async () => {
  let reads = 0;
  const request = async () => {
    reads++;
    return new Response(JSON.stringify({ success: false, errors: [{ message: 'SECRET_FIXTURE' }] }), { status: 403 });
  };
  await assert.rejects(verifyIdentity(policy, 'fixture', (path, token) => apiGet(path, token, request)), error => {
    assert.match(error.message, /HTTP 403/);
    assert.doesNotMatch(error.message, /SECRET_FIXTURE/);
    return true;
  });
  assert.equal(reads, 1);
});

test('private token file is required; no implicit environment fallback', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rememberme-cf-test-'));
  const file = join(directory, 'token.env');
  try {
    assert.throws(() => readToken(file), /Configure/);
    writeFileSync(file, 'CLOUDFLARE_API_TOKEN=fixture\n', { mode: 0o600 });
    assert.equal(readToken(file), 'fixture');
    chmodSync(file, 0o644);
    assert.throws(() => readToken(file), /0600/);
    chmodSync(file, 0o600);
    symlinkSync(file, join(directory, 'link'));
    assert.throws(() => readToken(join(directory, 'link')), /regular file/);
    writeFileSync(file, 'CLOUDFLARE_API_TOKEN=\n');
    assert.throws(() => readToken(file), /nonempty/);
    writeFileSync(file, 'CLOUDFLARE_API_TOKEN=fixture\nCLOUDFLARE_ACCOUNT_ID=company\n');
    assert.throws(() => readToken(file), /Only CLOUDFLARE_API_TOKEN/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('child environment excludes inherited credentials and Wrangler overrides', () => {
  const env = isolatedEnvironment({ PATH: '/bin', CLOUDFLARE_API_TOKEN: 'wrong', CLOUDFLARE_ACCOUNT_ID: 'wrong', CF_API_KEY: 'wrong', CLOUDFLARE_EMAIL: 'wrong', WRANGLER_API_BASE_URL: 'https://wrong.invalid' }, 'fixture', accountId);
  assert.equal(env.CLOUDFLARE_API_TOKEN, 'fixture');
  assert.equal(env.CLOUDFLARE_ACCOUNT_ID, accountId);
  assert.equal(env.PATH, '/bin');
  for (const key of ['CF_API_KEY', 'CLOUDFLARE_EMAIL', 'WRANGLER_API_BASE_URL']) assert.equal(env[key], undefined);
});

const gateway = { name: 'rememberme-account', account_id: accountId, vpc_services: [{ service_id: '11111111-2222-3333-4444-555555555555' }] };
test('only exact prepared deployment targets can be selected', () => {
  assert.deepEqual(deploymentArgs('account-gateway', gateway, accountId), ['deploy', '--config', 'account-gateway/wrangler.jsonc']);
  assert.throws(() => deploymentArgs('--config=other', gateway, accountId), /Unknown/);
  assert.throws(() => deploymentArgs('account-gateway', { ...gateway, env: { production: {} } }, accountId), /Named environments/);
});

test('rejects wrong account, old VPC bindings, and migration placeholders', () => {
  for (const wrongId of ['83d5b273d7ceb2b02a9f454f67ac495b', '0'.repeat(32), 'b'.repeat(32)]) {
    assert.throws(() => deploymentArgs('account-gateway', { ...gateway, account_id: wrongId }, accountId), /pin/);
  }
  for (const service_id of ['01a13e1f-3d24-7082-95bd-1d336c070b2a', '01a13b1f-f04b-7892-ada7-d9092b7ff0f4', '00000000-0000-0000-0000-000000000000']) {
    assert.throws(() => deploymentArgs('account-gateway', { ...gateway, vpc_services: [{ service_id }] }, accountId), /VPC service/);
  }
});

test('Pages deployment pins project, branch and config', () => {
  assert.deepEqual(deploymentArgs('account-entry', { name: 'rememberme', account_id: accountId }, accountId),
    ['pages', 'deploy', 'account-entry/public', '--project-name', 'rememberme', '--branch', 'main', '--config', 'account-entry/wrangler.jsonc']);
});
