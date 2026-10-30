import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = resolve(import.meta.dirname, '../../../../../..');

// Research-only entry point; production test discovery/configuration is unchanged.
export default defineConfig({
  root,
  resolve: { alias: {
    '@root': root,
    '@shared': resolve(root, 'src/shared'),
    '@main': resolve(root, 'src/main'),
  } },
  test: {
    include: ['docs/里程碑/M10_三方应用接入/技研/实验/agent-bridge/codex-mcp-call.probe.test.ts'],
    environment: 'node',
    fileParallelism: false,
  },
});
