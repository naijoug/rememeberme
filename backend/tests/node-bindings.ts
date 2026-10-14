import { SQLiteDatabase } from '../src/sqlite';
import { WindowLimiter } from '../src/node-runtime';
import type { Bindings } from '../src/runtime';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve('migrations');
type Migration = { name: string; sql: string };
export const env: Bindings & { TEST_MIGRATIONS: Migration[] } = {
  DB: new SQLiteDatabase(':memory:'),
  AUTH_LIMIT: new WindowLimiter(30), API_LIMIT: new WindowLimiter(300),
  PUBLIC_ORIGIN: 'https://api.example.test', ENVIRONMENT: 'local',
  GITHUB_CLIENT_ID: 'synthetic-client', GITHUB_CLIENT_SECRET: 'synthetic-provider-secret',
  NATIVE_CALLBACKS: 'rememberme://auth/callback',
  ASSETS: { fetch: () => new Response('Synthetic homepage') },
  TEST_MIGRATIONS: readdirSync(directory).filter(name => name.endsWith('.sql')).sort().map(name => ({ name, sql: readFileSync(resolve(directory, name), 'utf8') })),
};
export async function reset() {
  (env.DB as SQLiteDatabase).close(); env.DB = new SQLiteDatabase(':memory:');
  env.AUTH_LIMIT = new WindowLimiter(30); env.API_LIMIT = new WindowLimiter(300);
  env.NATIVE_CALLBACKS = 'rememberme://auth/callback';
  delete env.TRANSLATOR; delete env.CLIENT_ORIGINS;
}
export async function applyD1Migrations(database: Bindings['DB'], migrations: Migration[]) {
  await database.exec('CREATE TABLE IF NOT EXISTS fixture_migrations(name TEXT PRIMARY KEY)');
  for (const migration of migrations) {
    if (await database.prepare('SELECT name FROM fixture_migrations WHERE name=?').bind(migration.name).first()) continue;
    await database.exec(migration.sql);
    await database.prepare('INSERT INTO fixture_migrations(name) VALUES(?)').bind(migration.name).run();
  }
}
