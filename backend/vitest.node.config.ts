import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
const path = (file: string) => fileURLToPath(new URL(file, import.meta.url));
export default defineConfig({
  resolve: { alias: [
    { find: 'cloudflare:workers', replacement: path('./tests/node-bindings.ts') },
    { find: 'cloudflare:test', replacement: path('./tests/node-bindings.ts') },
    { find: path('./tests/network.ts'), replacement: path('./tests/network-node.ts') },
  ] },
  // scripts/cloudflare.test.mjs uses node:test and must run via test:cloudflare.
  test: { include: ['tests/**/*.test.{ts,mjs}'], environment: 'node', setupFiles: ['./tests/setup-node.ts'], fileParallelism: false },
});
