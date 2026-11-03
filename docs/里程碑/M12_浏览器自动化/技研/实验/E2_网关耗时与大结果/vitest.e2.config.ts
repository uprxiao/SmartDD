import {resolve} from 'node:path';
import {defineConfig} from 'vitest/config';

export default defineConfig({
 root: resolve('.'),
 cacheDir: process.env.WILLYOU_TEST_CACHE_DIR,
 resolve: {alias: {'@root': resolve('.'), '@shared': resolve('src/shared'), '@main': resolve('src/main'), '@renderer': resolve('src/renderer')}},
 test: {include: ['docs/里程碑/M12_浏览器自动化/技研/实验/E2_网关耗时与大结果/*.test.ts'], environment: 'node', maxWorkers: 1, testTimeout: 120000, hookTimeout: 120000},
});
