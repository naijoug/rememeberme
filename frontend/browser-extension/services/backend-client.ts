import { storage } from 'wxt/utils/storage';

export interface DeviceCredentials {
  userId: string; deviceId: string; accessToken: string; refreshToken: string;
  accessExpiresAtMs: number; refreshExpiresAtMs: number;
}
export interface Connection { origin: string; credentials: DeviceCredentials }
export class BackendError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryable = false) { super(code); }
}
const CONNECTION = 'local:backendConnection';
function credentials(value: unknown): value is DeviceCredentials {
  if (!value || typeof value !== 'object') return false;
  const v = value as DeviceCredentials;
  return typeof v.userId === 'string' && /^[A-Za-z0-9:_-]{1,200}$/.test(v.userId)
    && typeof v.deviceId === 'string' && /^[A-Za-z0-9:_-]{1,200}$/.test(v.deviceId)
    && /^[A-Za-z0-9_-]{43}$/.test(v.accessToken) && /^[A-Za-z0-9_-]{43}$/.test(v.refreshToken)
    && Number.isFinite(v.accessExpiresAtMs) && v.accessExpiresAtMs > 0
    && Number.isFinite(v.refreshExpiresAtMs) && v.refreshExpiresAtMs >= v.accessExpiresAtMs;
}
export function apiOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || !(url.protocol === 'https:' || (import.meta.env.DEV && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) {
    throw new Error('Enter an HTTPS API address.');
  }
  return url.origin;
}
async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function random(): string { return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

export class BackendClient {
  private connection?: Connection;
  private loaded?: Promise<void>;
  private generation = 0;
  private refresh?: Promise<DeviceCredentials>;
  private signingIn = false;
  private writes: Promise<unknown> = Promise.resolve();
  private dirty = false;
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.writes.then(action); this.writes = result.catch(() => {}); return result;
  }
  private async load() {
    await (this.loaded ??= (async () => {
      const stored = await storage.getItem<Connection>(CONNECTION);
      try {
        if (stored && credentials(stored.credentials) && apiOrigin(stored.origin) === stored.origin) this.connection = stored;
      } catch { /* Ignore malformed connection settings without touching vocabulary. */ }
    })());
  }
  async current(): Promise<Connection | undefined> { await this.load(); return this.connection ? structuredClone(this.connection) : undefined; }
  private async response(origin: string, path: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(origin + path, {
      ...init, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15_000),
    });
    if (!response.headers.get('content-type')?.includes('application/json') || !response.body) throw new Error('Invalid backend response.');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let count = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        count += next.value.length; if (count > 16 * 1024 * 1024) throw new Error('Backend response is too large.');
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(count); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!response.ok) throw new BackendError(response.status, value?.error?.code || 'INVALID_RESPONSE', value?.error?.retryable === true);
      return value;
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async request<T>(path: string, method = 'GET', body?: unknown, epoch?: string, frozenBody?: string): Promise<T> {
    await this.load();
    if (!this.connection) throw new Error('Connect your backend account first.');
    if (!path.startsWith('/api/v1/') || path.includes('..')) throw new Error('Invalid backend path.');
    const connection = this.connection, generation = this.generation;
    const active = () => { if (generation !== this.generation || connection !== this.connection) throw new Error('Account connection changed.'); };
    const persist = () => this.serialize(async () => {
      active(); await storage.setItem(CONNECTION, connection); active(); this.dirty = false;
    });
    if (this.dirty) await persist();
    const refresh = async () => {
      if (!this.refresh) this.refresh = (async () => {
        const reply = await this.response(connection.origin, '/api/v1/auth/refresh', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: connection.credentials.refreshToken }),
        });
        active();
        if (!credentials(reply) || reply.userId !== connection.credentials.userId || reply.deviceId !== connection.credentials.deviceId) throw new Error('Invalid account refresh.');
        connection.credentials = reply;
        this.dirty = true;
        await persist();
        return reply;
      })().finally(() => { this.refresh = undefined; });
      await this.refresh; active();
    };
    if (connection.credentials.accessExpiresAtMs < Date.now() + 60_000) await refresh();
    const send = () => this.response(connection.origin, path, {
      method, headers: { Accept: 'application/json', Authorization: 'Bearer ' + connection.credentials.accessToken,
        'X-Client-Capabilities': 'translation-source-v2',
        ...(epoch ? { 'X-Sync-Epoch': epoch } : {}),
        ...(body !== undefined || frozenBody !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined || frozenBody !== undefined ? { body: frozenBody ?? JSON.stringify(body) } : {}),
    });
    let result: unknown;
    try { result = await send(); }
    catch (error) {
      if (!(error instanceof BackendError) || error.status !== 401) throw error;
      await refresh(); result = await send();
    }
    active(); return result as T;
  }
  async signIn(address: string): Promise<void> {
    if (this.signingIn) throw new Error('Sign-in is already running.');
    await this.load(); this.signingIn = true;
    const generation = this.generation;
    try {
      const origin = apiOrigin(address), verifier = random(), state = random();
      const callback = browser.identity.getRedirectURL('auth/callback');
      const url = new URL(origin + '/auth/extension/start');
      url.search = new URLSearchParams({ state, challenge: await digest(verifier), callback, deviceName: 'Remember Me Browser' }).toString();
      const returned = await browser.identity.launchWebAuthFlow({ url: url.toString(), interactive: true });
      if (!returned) throw new Error('Sign-in was cancelled.');
      const result = new URL(returned);
      if (result.origin + result.pathname !== callback || result.hash
        || [...result.searchParams.keys()].some(key => !['state', 'code'].includes(key))
        || result.searchParams.getAll('state').length !== 1 || result.searchParams.getAll('code').length !== 1
        || result.searchParams.get('state') !== state
        || !/^[A-Za-z0-9_-]{43}$/.test(result.searchParams.get('code') || '')) throw new Error('Invalid sign-in callback.');
      const pair = await this.response(origin, '/api/v1/auth/exchange', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: result.searchParams.get('code'), verifier }),
      });
      if (!credentials(pair) || generation !== this.generation) throw new Error('Sign-in could not be completed.');
      const connection = { origin, credentials: pair };
      await this.serialize(async () => {
        if (generation !== this.generation) throw new Error('Account connection changed.');
        await storage.setItem(CONNECTION, connection);
        if (generation !== this.generation) throw new Error('Account connection changed.');
        this.connection = connection; this.generation++; this.dirty = false;
      });
    } finally { this.signingIn = false; }
  }
  async disconnect(): Promise<void> {
    await this.load();
    const connection = this.connection;
    // Local disconnection must still work while the server is unreachable.
    this.connection = undefined; this.generation++; this.dirty = false;
    this.refresh = undefined;
    await this.serialize(() => storage.removeItem(CONNECTION));
    if (connection) await this.response(connection.origin, '/api/v1/auth/logout', {
      method: 'POST', headers: { Authorization: 'Bearer ' + connection.credentials.accessToken },
    }).catch(() => {});
  }
}
export const backendClient = new BackendClient();
