import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Database, DatabaseResult, DatabaseStatement } from './runtime';

class Statement implements DatabaseStatement {
  constructor(readonly owner: SQLiteDatabase, readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: unknown[]): Statement {
    if (values.some(value => value !== null && typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Uint8Array))) {
      throw new TypeError('Unsupported SQL parameter');
    }
    return new Statement(this.owner, this.sql, values as SQLInputValue[]);
  }
  execute(): DatabaseResult {
    const statement = this.owner.connection.prepare(this.sql);
    const results = statement.columns().length ? statement.all(...this.values) : [];
    const changes = statement.columns().length ? 0 : Number(statement.run(...this.values).changes);
    return { success: true, results, meta: { changes } };
  }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.owner.connection.prepare(this.sql).get(...this.values);
    return (row ? (column ? row[column] : row) : null) as T | null;
  }
  async all<T = Record<string, unknown>>(): Promise<DatabaseResult<T>> {
    return this.execute() as DatabaseResult<T>;
  }
  async run(): Promise<DatabaseResult> { return this.execute(); }
}

export class SQLiteDatabase implements Database {
  readonly connection: DatabaseSync;
  constructor(path: string) {
    this.connection = new DatabaseSync(path);
    this.connection.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  }
  prepare(sql: string): Statement { return new Statement(this, sql); }
  async exec(sql: string): Promise<void> { this.connection.exec(sql); }
  async batch(statements: DatabaseStatement[]): Promise<DatabaseResult[]> {
    if (statements.some(statement => !(statement instanceof Statement) || statement.owner !== this)) {
      throw new TypeError('Transaction statements must share a database');
    }
    // No await inside the transaction: unrelated requests cannot interleave writes.
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = (statements as Statement[]).map(statement => statement.execute());
      this.connection.exec('COMMIT');
      return result;
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }
  migrate(directory: string): void {
    this.connection.exec('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, digest TEXT NOT NULL)');
    for (const name of readdirSync(directory).filter(name => /^\d+_[a-z_]+\.sql$/.test(name)).sort()) {
      const sql = readFileSync(join(directory, name), 'utf8');
      const digest = createHash('sha256').update(sql).digest('hex');
      this.connection.exec('BEGIN IMMEDIATE');
      try {
        const previous = this.connection.prepare('SELECT digest FROM schema_migrations WHERE name=?').get(name);
        if (previous && previous.digest !== digest) throw new Error('Applied migration changed: ' + name);
        if (!previous) {
          this.connection.exec(sql);
          this.connection.prepare('INSERT INTO schema_migrations(name,digest) VALUES(?,?)').run(name, digest);
        }
        this.connection.exec('COMMIT');
      } catch (error) { this.connection.exec('ROLLBACK'); throw error; }
    }
  }
  close(): void { this.connection.close(); }
}
