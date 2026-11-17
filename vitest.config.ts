import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

// Collect only the colocated source suites (never dist/), and resolve `n8n-node-core` to its
// vendored TypeScript source, as tsconfig.json and build.mjs do, so tests need no core build.
export default defineConfig({
  resolve: {
    alias: {
      'n8n-node-core': path.resolve(here, 'src/vendor/n8n-node-core/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
