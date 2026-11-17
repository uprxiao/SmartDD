import { defineConfig } from 'vitest/config';
import base from '../../../vitest.config';
export default defineConfig({ ...base, test: { ...base.test, include: ['docs/review/evidence-20261117-2127/*.test.{ts,tsx}'], pool: 'threads', maxWorkers: 1, testTimeout: 4000 } });
