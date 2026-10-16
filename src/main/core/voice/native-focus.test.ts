import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'darwin')('native voice focus guard', () => {
  let directory: string;
  let binary: string;
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'smartdd-focus-test-'));
    binary = join(directory, 'focus-test');
    execFileSync('xcrun', ['clang', '-fobjc-arc', '-fblocks', '-framework', 'Foundation',
      resolve('native/voice/focus-guard-test.m'), '-o', binary], { timeout: 30_000 });
  }, 35_000);
  afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
  it.each([
    'initial-retry', 'same-target-retry', 'different-input', 'app-already-changed',
    'app-changed-during-read', 'app-changed-during-retry', 'never-ready', 'unsupported', 'secure',
  ])('%s', scenario => {
    expect(execFileSync(binary, [scenario], { encoding: 'utf8', timeout: 5_000 }).trim()).toBe('passed');
  });
});
