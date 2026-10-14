import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PARENT_AGENT_VARS, planLaunchEnv, VALUE_PREFIX } from './launch-env';
import { shellWrapped } from './pty-manager';

// A fake home whose rc files export the same variables globally, like the user's ~/.zshrc does.
const home = mkdtempSync(join(tmpdir(), 'smartdd-launch-'));
const RC = [
  'export ANTHROPIC_BASE_URL=https://rc.invalid',
  'export ANTHROPIC_AUTH_TOKEN=rc-token',
  'export ANTHROPIC_API_KEY=rc-key',
  'export RC_ONLY=1',
  'claude() { echo FUNCTION; }',
  "alias env='echo ALIAS'",
  '',
].join('\n');
for (const f of ['.zshrc', '.bash_profile', '.bashrc']) writeFileSync(join(home, f), RC);
afterAll(() => rmSync(home, { recursive: true, force: true }));

function runEnv(shell: string, injected: Record<string, string>, extraArgs: string[] = []) {
  const plan = planLaunchEnv(
    { PATH: '/usr/bin:/bin', HOME: home, ANTHROPIC_MODEL: 'inherited', KEEP: 'yes' },
    injected,
    ['ANTHROPIC_']
  );
  const { file, args } = shellWrapped('/usr/bin/env', extraArgs, plan.scriptArgs, shell);
  const r = spawnSync(file, args, { env: { ...plan.env, SHELL: shell }, encoding: 'utf8', timeout: 10_000 });
  const vars = new Map<string, string>();
  for (const line of r.stdout.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) vars.set(line.slice(0, i), line.slice(i + 1));
  }
  return { plan, args, vars, status: r.status, stderr: r.stderr };
}

const tricky = `a b"c'$HOME;\`x\`\\n`;

describe.each(['/bin/zsh', '/bin/bash'].filter(existsSync))('launch through %s', (shell) => {
  it('profile values win over rc exports; other ANTHROPIC_* are cleared', () => {
    const { vars, status } = runEnv(shell, {
      ANTHROPIC_BASE_URL: 'https://profile.invalid',
      ANTHROPIC_AUTH_TOKEN: tricky,
    });
    expect(status).toBe(0);
    expect(vars.get('ANTHROPIC_BASE_URL')).toBe('https://profile.invalid');
    expect(vars.get('ANTHROPIC_AUTH_TOKEN')).toBe(tricky);
    expect(vars.has('ANTHROPIC_API_KEY')).toBe(false); // rc export removed
    expect(vars.has('ANTHROPIC_MODEL')).toBe(false); // inherited one removed
    expect(vars.get('RC_ONLY')).toBe('1'); // rest of the rc still applies
    expect(vars.get('KEEP')).toBe('yes');
    expect([...vars.keys()].some((k) => k.startsWith(VALUE_PREFIX) || k === '__smartdd_n')).toBe(false);
  });

  it('passes command arguments verbatim and bypasses aliases', () => {
    // `env -0`-free check: env prints NAME=VALUE for assignments given as arguments.
    const { vars, status } = runEnv(shell, {}, [`ARG=${tricky}`]);
    expect(status).toBe(0);
    expect(vars.get('ARG')).toBe(tricky);
  });

  it('keeps secret values out of argv', () => {
    const { args } = runEnv(shell, { ANTHROPIC_AUTH_TOKEN: 'sk-secret-value' });
    expect(args.join(' ')).not.toContain('sk-secret-value');
    expect(args).toContain('ANTHROPIC_AUTH_TOKEN');
  });
});

describe('planLaunchEnv', () => {
  it('rejects names that are not identifiers', () => {
    expect(() => planLaunchEnv({}, { 'A;rm': 'x' }, [])).toThrow('无效的变量名');
    expect(() => planLaunchEnv({}, {}, ['A B'])).toThrow('无效的变量前缀');
  });

  it('drops stale carriers from the base env and lists names sorted', () => {
    const p = planLaunchEnv({ [`${VALUE_PREFIX}X`]: 'old', Y: '1' }, { B: '2', A: '1' }, []);
    expect(p.injectedNames).toEqual(['A', 'B']);
    expect(p.env[`${VALUE_PREFIX}X`]).toBeUndefined();
    expect(p.scriptArgs).toEqual(['-e', 'A', '-e', 'B', '--']);
  });

  it('names parent-agent variables to strip', () => {
    expect(PARENT_AGENT_VARS).toContain('CLAUDECODE');
  });
});
