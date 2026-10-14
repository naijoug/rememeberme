import { mkdirSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SQLiteDatabase } from './sqlite';
import { HermesTranslator } from './hermes';
import type { Bindings, Limiter } from './runtime';

export class WindowLimiter implements Limiter {
  private values = new Map<string, { count: number; until: number }>();
  constructor(private maximum: number, private periodMs = 60_000) {}
  async limit({ key }: { key: string }): Promise<{ success: boolean }> {
    const now = Date.now(); const previous = this.values.get(key);
    if (previous && previous.until > now) return { success: ++previous.count <= this.maximum };
    if (this.values.size >= 10_000) {
      for (const [name, value] of this.values) if (value.until <= now) this.values.delete(name);
      if (this.values.size >= 10_000) return { success: false };
    }
    this.values.set(key, { count: 1, until: now + this.periodMs });
    return { success: true };
  }
}
export function createRuntime(options: {
  databasePath: string; migrations: string; publicDirectory: string;
  configuration: Record<string, string | undefined>;
}): Bindings & { DB: SQLiteDatabase } {
  const config = options.configuration;
  const origin = new URL(config.PUBLIC_ORIGIN || 'http://127.0.0.1:8787');
  const environment = config.ENVIRONMENT || 'local';
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password
    || (environment !== 'local' && origin.protocol !== 'https:')) throw new Error('Configure an exact HTTPS PUBLIC_ORIGIN');
  if (options.databasePath !== ':memory:') mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 });
  const database = new SQLiteDatabase(options.databasePath);
  try {
    database.migrate(options.migrations);
    if (options.databasePath !== ':memory:') chmodSync(options.databasePath, 0o600);
    const homepage = readFileSync(resolve(options.publicDirectory, 'index.html'), 'utf8');
    const hermes = config.HERMES_BASE_URL ? new HermesTranslator({
      baseURL: config.HERMES_BASE_URL, key: config.HERMES_API_KEY || '', model: config.HERMES_MODEL || 'hermes-agent',
    }) : undefined;
    return {
      DB: database, ENVIRONMENT: environment, PUBLIC_ORIGIN: origin.origin,
      NATIVE_CALLBACKS: config.NATIVE_CALLBACKS || 'rememberme://auth/callback',
      CLIENT_ORIGINS: config.CLIENT_ORIGINS || '',
      GITHUB_CLIENT_ID: config.GITHUB_CLIENT_ID || '', GITHUB_CLIENT_SECRET: config.GITHUB_CLIENT_SECRET || '',
      AUTH_LIMIT: new WindowLimiter(30), API_LIMIT: new WindowLimiter(300),
      TRANSLATOR: hermes,
      ASSETS: { fetch: () => new Response(homepage, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) },
    };
  } catch (error) { database.close(); throw error; }
}
export function defaultDirectories() {
  // Works both from src/ and from the bundled .build/ entrypoint.
  const adjacent = dirname(fileURLToPath(import.meta.url));
  const backend = existsSync(resolve(adjacent, 'migrations')) ? adjacent : resolve(adjacent, '..');
  return { migrations: resolve(backend, 'migrations'), publicDirectory: resolve(backend, 'public') };
}
