import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ResolvedProfile } from './ai-profile-service';
import { runProfileTest, testArgs } from './profile-tester';

let home: string;
let bin: string;
const SECRET = 'sk-ant-profile-secret-value-123';

// The fake CLI answers according to FAKE_MODE and reports what it was started with.
const FAKE = `#!/bin/sh
last=""; for a in "$@"; do last="$a"; done
code=$(printf "%s" "$last" | grep -o 'SMARTDD-OK-[a-z0-9]*')
case "$FAKE_MODE" in
  trace) p="$CLAUDE_CONFIG_DIR/projects/$(pwd -P | sed 's/[^a-zA-Z0-9]/-/g')"; mkdir -p "$p/memory"; [ -n "$KEEP" ] && touch "$p/s.jsonl"; echo "$code" ;;
  ok) echo "noise before"; echo "$code key=$ANTHROPIC_API_KEY retries=$CLAUDE_CODE_MAX_RETRIES args=$*" ;;
  auth) echo "Invalid API key · Fix external API key"; echo "debug: using $ANTHROPIC_API_KEY" >&2; exit 1 ;;
  echo-stderr) echo "user"; echo "$last" >&2; echo "ERROR: unexpected status 402 Payment Required: Insufficient Balance" >&2; exit 1 ;;
  wrong) echo "Sure! Here you go." ;;
  hang) sleep 30 ;;
esac
`;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'smartdd-tester-'));
  bin = join(home, 'bin');
  mkdirSync(bin);
  // The rc file exports another account's key: the profile's must win.
  writeFileSync(join(home, '.zshrc'), `echo "welcome from rc"\nexport PATH="${bin}:$PATH"\nexport ANTHROPIC_API_KEY=from-rc\n`);
  for (const name of ['claude', 'codex']) {
    writeFileSync(join(bin, name), FAKE);
    chmodSync(join(bin, name), 0o755);
  }
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const profile = (mode: string, p: Partial<ResolvedProfile> = {}): ResolvedProfile => ({
  id: 'p1',
  name: 'cc',
  runner: 'claude',
  command: 'claude',
  args: [],
  env: { FAKE_MODE: mode, ANTHROPIC_API_KEY: SECRET },
  isolatePrefixes: ['ANTHROPIC_'],
  ...p,
});
const deps = (extra: { timeoutMs?: number } = {}) => ({
  baseEnv: { HOME: home, ZDOTDIR: home, PATH: '/usr/bin:/bin', TERM: 'dumb', TMPDIR: home },
  shell: '/bin/zsh',
  code: 'SMARTDD-OK-abc123',
  ...extra,
});

describe('testArgs', () => {
  it('uses the non-interactive modes, profile arguments first', () => {
    expect(testArgs('claude', ['--model', 'x'], 'P')).toEqual(['--model', 'x', '--print', '--no-session-persistence', '--output-format', 'text', 'P']);
    expect(testArgs('codex', ['-m', 'y'], 'P')).toEqual(['-m', 'y', 'exec', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '--color', 'never', 'P']);
  });
});

describe('runProfileTest', () => {
  it('passes when the reply contains the code, with the profile env and one attempt only', async () => {
    const r = await runProfileTest(profile('ok'), [SECRET], deps());
    expect(r.category).toBe('ok');
    expect(r.message).toBe('');
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  it('reports what the fake saw: the profile key (not the rc one) and no retries', async () => {
    // Same script, but now it must fail so the output comes back as the message.
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "key=$ANTHROPIC_API_KEY retries=$CLAUDE_CODE_MAX_RETRIES print=$1"; exit 3\n');
    const r = await runProfileTest(profile('x', { env: { ANTHROPIC_API_KEY: 'profile-key-1' } }), [], deps());
    expect(r).toMatchObject({ category: 'other', message: 'key=profile-key-1 retries=0 print=--print' });
  });

  it('leaves no project folder behind in the Claude config, unless it holds a file', async () => {
    const config = join(home, 'claude-config');
    const run = (keep: boolean) =>
      runProfileTest(profile('trace', { env: { FAKE_MODE: 'trace', CLAUDE_CONFIG_DIR: config, ...(keep ? { KEEP: '1' } : {}) } }), [], deps());
    expect((await run(false)).category).toBe('ok');
    expect(readdirSync(join(config, 'projects'))).toEqual([]);
    await run(true);
    expect(readdirSync(join(config, 'projects'))).toHaveLength(1);
  });

  it('classifies an auth failure and redacts the secret', async () => {
    const r = await runProfileTest(profile('auth'), [SECRET], deps());
    expect(r.category).toBe('auth');
    expect(r.message).toBe('Invalid API key · Fix external API key');
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it('ignores the code in an echoed prompt on stderr (Codex) and keeps the real cause', async () => {
    const r = await runProfileTest(profile('echo-stderr', { runner: 'codex', command: 'codex', isolatePrefixes: [] }), [], deps());
    expect(r.category).toBe('billing');
    expect(r.message).toContain('402 Payment Required');
  });

  it('flags a reply without the code', async () => {
    const r = await runProfileTest(profile('wrong'), [], deps());
    expect(r.category).toBe('unexpected');
    expect(r.message).toContain('Sure! Here you go.');
  });

  it('times out, kills the process and cleans up its directory', async () => {
    const leftovers = () => readdirSync(tmpdir()).filter((n) => n.startsWith('smartdd-check-')).sort();
    const before = leftovers();
    const r = await runProfileTest(profile('hang'), [], deps({ timeoutMs: 800 }));
    expect(r.category).toBe('timeout');
    expect(r.ms).toBeLessThan(5000);
    expect(leftovers()).toEqual(before);
  });

  it('reports a missing command', async () => {
    const r = await runProfileTest(profile('ok', { command: 'no-such-cli' }), [], deps());
    expect(r.category).toBe('not_found');
    expect(r.message).toContain('no-such-cli');
  });
});
