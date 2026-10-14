import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
const path = (file: string) => fileURLToPath(new URL(file, import.meta.url));
export default defineConfig({
  resolve: { alias: [
    { find: 'cloudflare:workers', replacement: path('./tests/node-bindings.ts') },
    { find: 'cloudflare:test', replacement: path('./tests/node-bindings.ts') },
    { find: path('./tests/network.ts'), replacement: path('./tests/network-node.ts') },
  ] },
  test: { environment: 'node', setupFiles: ['./tests/setup-node.ts'], fileParallelism: false },
});
