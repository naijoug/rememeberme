import { beforeEach } from 'vitest';
import { env, reset, applyD1Migrations } from './node-bindings';
beforeEach(async () => { await reset(); await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
