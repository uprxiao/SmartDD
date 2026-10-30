import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectRunner, parseDetectOutput } from './runner-detect';

let fixtureDir: string;
let bin: string;

beforeEach(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'smartdd-detect-'));
  bin = join(fixtureDir, 'bin');
  mkdirSync(bin);
  // macOS's system login profile runs path_helper before this fixture. Replace
  // that PATH, so a user's installed codex cannot turn the missing-command case
  // into a success. Keep system utilities needed by the detection script.
  const noisyRc = `echo "welcome from rc"\nexport PATH="${bin}:/usr/bin:/bin"\nalias claude='echo hijacked'\n`;
  writeFileSync(join(fixtureDir, '.zshrc'), noisyRc);
  writeFileSync(join(fixtureDir, '.bashrc'), noisyRc);
  writeFileSync(join(fixtureDir, '.bash_profile'), `. "${fixtureDir}/.bashrc"\n`);
  const fake = join(bin, 'claude');
  writeFileSync(fake, '#!/bin/sh\necho "9.9.9 (Claude Code)"\n');
  chmodSync(fake, 0o755);
});
afterEach(() => rmSync(fixtureDir, { recursive: true, force: true }));

const env = () => ({ HOME: fixtureDir, ZDOTDIR: fixtureDir, PATH: '/usr/bin:/bin', TERM: 'dumb' });

describe.each(['/bin/zsh', '/bin/bash'])('detectRunner via %s', (shell) => {
  it('finds the command on the rc PATH, ignoring aliases and rc noise', async () => {
    expect(await detectRunner('claude', null, { env: env(), shell })).toEqual({
      runner: 'claude',
      command: 'claude',
      path: join(bin, 'claude'),
      version: '9.9.9 (Claude Code)',
      error: null,
    });
  });

  it('reports a missing command clearly', async () => {
    const r = await detectRunner('codex', null, { env: env(), shell });
    expect(r).toMatchObject({ path: null, version: null });
    expect(r.error).toContain('找不到 codex');
  });

  it('accepts an explicit path', async () => {
    const r = await detectRunner('claude', join(bin, 'claude'), { env: env(), shell });
    expect(r).toMatchObject({ command: join(bin, 'claude'), path: join(bin, 'claude'), version: '9.9.9 (Claude Code)' });
  });
});

describe('parseDetectOutput', () => {
  it('handles a binary without version output', () => {
    expect(parseDetectOutput('codex', 'codex', 'noise\n__SMARTDD_PATH__/x/codex\n\n').error).toBe('codex --version 没有输出');
    expect(parseDetectOutput('codex', 'codex', '').path).toBeNull();
  });
});
