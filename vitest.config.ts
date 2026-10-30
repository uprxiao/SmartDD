import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// `pnpm test` runs vitest under Electron's bundled Node (ELECTRON_RUN_AS_NODE=1) so
// better-sqlite3, which postinstall builds against Electron's ABI, loads in tests.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    // Tests also mount shared prototype components. Use the renderer's React
    // instance even when the isolated prototype has its own node_modules.
    dedupe: ['react', 'react-dom'],
    alias: {
      '@root': resolve('.'),
      '@shared': resolve('src/shared'),
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer'),
    },
  },
  test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'node' },
});
