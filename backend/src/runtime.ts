export interface DatabaseResult<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes: number };
}
export interface DatabaseStatement {
  bind(...values: unknown[]): DatabaseStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
  run(): Promise<DatabaseResult>;
}
export interface Database {
  prepare(sql: string): DatabaseStatement;
  batch(statements: DatabaseStatement[]): Promise<DatabaseResult[]>;
  exec(sql: string): Promise<unknown>;
}
export interface Limiter {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}
export interface Translation {
  text: string;
  target: 'zh-CN';
  source: 'hermes';
}
export interface Bindings {
  DB: Database;
  AUTH_LIMIT: Limiter;
  API_LIMIT: Limiter;
  ASSETS: { fetch(request: Request): Promise<Response> | Response };
  ENVIRONMENT: string;
  PUBLIC_ORIGIN: string;
  NATIVE_CALLBACKS: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  CLIENT_ORIGINS?: string;
  CLIENT_IP?: string;
  TRANSLATOR?: { translate(word: string): Promise<Translation> };
}
