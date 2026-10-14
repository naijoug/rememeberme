import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiOrigin, BackendClient, type Connection } from './backend-client';
const disk = vi.hoisted(() => ({ value: undefined as unknown, failWrite: false }));
vi.mock('wxt/utils/storage', () => ({ storage: {
  getItem: async () => structuredClone(disk.value),
  setItem: async (_key: string, value: unknown) => {
    if (disk.failWrite) { disk.failWrite = false; throw new Error('Synthetic disk failure'); }
    disk.value = structuredClone(value);
  },
  removeItem: async () => { disk.value = undefined; },
} }));
const pair = () => ({
  userId: 'synthetic-user', deviceId: 'synthetic-device', accessToken: 'a'.repeat(43),
  refreshToken: 'b'.repeat(43), accessExpiresAtMs: Date.now() - 1, refreshExpiresAtMs: Date.now() + 86_400_000,
});
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => { disk.value = { origin: 'https://api.example.test', credentials: pair() }; disk.failWrite = false; });
afterEach(() => vi.unstubAllGlobals());

it('shares refresh, scopes bearer credentials to the configured origin and sends exact frozen bytes', async () => {
  const updated = { ...pair(), accessToken: 'c'.repeat(43), refreshToken: 'd'.repeat(43), accessExpiresAtMs: Date.now() + 900_000 };
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async url => String(url).endsWith('/auth/refresh') ? reply(updated) : reply({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  const client = new BackendClient(), frozen = '{"kind":"synthetic", "operationId":"literal"}';
  await Promise.all([client.request('/api/v1/me'), client.request('/api/v1/sync/operations', 'POST', undefined, 'epoch', frozen)]);
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))).toHaveLength(1);
  const [, init] = fetch.mock.calls.find(([url]) => String(url).endsWith('/sync/operations'))!;
  expect(init?.body).toBe(frozen);
  expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer ' + updated.accessToken);
  expect(new Headers(init?.headers).get('X-Sync-Epoch')).toBe('epoch');
  expect(fetch.mock.calls.every(([url]) => String(url).startsWith('https://api.example.test/'))).toBe(true);
});

it('retries saving a completed refresh instead of consuming the spent refresh token again', async () => {
  const updated = { ...pair(), accessExpiresAtMs: Date.now() + 900_000, refreshToken: 'd'.repeat(43) };
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async url => String(url).endsWith('/auth/refresh') ? reply(updated) : reply({ ok: true }));
  vi.stubGlobal('fetch', fetch); disk.failWrite = true;
  const client = new BackendClient();
  await expect(client.request('/api/v1/me')).rejects.toThrow('disk failure');
  await expect(client.request('/api/v1/me')).resolves.toEqual({ ok: true });
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))).toHaveLength(1);
  expect((disk.value as Connection).credentials.refreshToken).toBe(updated.refreshToken);
});

it('disconnects while offline and rejects a late refresh without saving credentials again', async () => {
  let release!: (value: Response) => void;
  const gate = new Promise<Response>(resolve => { release = resolve; });
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(url => String(url).endsWith('/auth/refresh') ? gate : Promise.reject(new TypeError('Synthetic offline')));
  vi.stubGlobal('fetch', fetch);
  const client = new BackendClient();
  const request = client.request('/api/v1/me');
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await client.disconnect();
  release(reply({ ...pair(), accessExpiresAtMs: Date.now() + 900_000 }));
  await expect(request).rejects.toThrow('connection changed');
  expect(disk.value).toBeUndefined(); expect(await client.current()).toBeUndefined();
});

it('validates PKCE and the exact browser callback before exchanging a one-time code', async () => {
  disk.value = undefined;
  const callback = 'https://synthetic.chromiumapp.org/auth/callback';
  vi.stubGlobal('browser', { identity: {
    getRedirectURL: () => callback,
    launchWebAuthFlow: vi.fn().mockImplementation(async ({ url }: { url: string }) => {
      const start = new URL(url);
      expect(start.pathname).toBe('/auth/extension/start');
      expect(start.searchParams.get('challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
      return callback + '?state=' + start.searchParams.get('state') + '&code=' + 'e'.repeat(43);
    }),
  } });
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(reply({ ...pair(), accessExpiresAtMs: Date.now() + 900_000 }));
  vi.stubGlobal('fetch', fetch);
  await new BackendClient().signIn('https://api.example.test');
  const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
  expect(body.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect((disk.value as Connection).origin).toBe('https://api.example.test');
  expect(() => apiOrigin('https://attacker:password@api.example.test')).toThrow();
});
