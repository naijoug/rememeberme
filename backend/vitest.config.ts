import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => ({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' }, miniflare: {
    bindings: { TEST_MIGRATIONS: await readD1Migrations('./migrations'), PUBLIC_ORIGIN: 'https://api.example.test',
      GITHUB_CLIENT_ID: 'synthetic-client', GITHUB_CLIENT_SECRET: 'synthetic-provider-secret' }
  } })],
  test: { setupFiles: ['./tests/setup.ts'], fileParallelism: false, exclude: ['tests/hermes.test.ts', 'tests/runtime-node.test.ts', '**/node_modules/**'] }
}));
