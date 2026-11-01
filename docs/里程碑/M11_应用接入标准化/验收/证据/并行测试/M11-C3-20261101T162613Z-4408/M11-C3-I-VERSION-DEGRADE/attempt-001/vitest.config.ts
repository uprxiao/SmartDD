import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// `pnpm test` runs vitest under Electron's bundled Node (ELECTRON_RUN_AS_NODE=1) so
// better-sqlite3, which postinstall builds against Electron's ABI, loads in tests.
export default defineConfig({
  cacheDir: "/var/folders/rt/7q3bp7tx7p13zgcpkcfs04080000gn/T/willyou-M11-C3-20261101T162613Z-4408-sgsd2h0s/version-worker-vite-cache",
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
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Native fixtures launch helpers and competing writers. Keep CI resource
    // contention from consuming their bounded transaction-gate waits.
    maxWorkers: 2,
  },
});
