import { defineConfig } from 'vitest/config';
import base from '../../../vitest.config';

// Formal service-layer scenarios run explicitly after the development gate.
// They supplement the ordinary software suite; they do not launch an App UI.
export default defineConfig({
  ...base,
  test: { ...base.test, include: ['scripts/applications/acceptance/*.test.ts'], maxWorkers: 2 },
});
