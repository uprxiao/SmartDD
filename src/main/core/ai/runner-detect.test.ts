import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectRunner, parseDetectOutput } from './runner-detect';

let home: string;
let bin: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'smartdd-detect-'));
  bin = join(home, 'bin');
  mkdirSync(bin);
  const noisyRc = `echo "welcome from rc"\nexport PATH="${bin}:$PATH"\nalias claude='echo hijacked'\n`;
  writeFileSync(join(home, '.zshrc'), noisyRc);
  writeFileSync(join(home, '.bashrc'), noisyRc);
  writeFileSync(join(home, '.bash_profile'), `. "${home}/.bashrc"\n`);
  const fake = join(bin, 'claude');
  writeFileSync(fake, '#!/bin/sh\necho "9.9.9 (Claude Code)"\n');
  chmodSync(fake, 0o755);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const env = () => ({ HOME: home, ZDOTDIR: home, PATH: '/usr/bin:/bin', TERM: 'dumb' });

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
