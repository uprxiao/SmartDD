import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { builtinRunnerAdapters, RunnerAdapterRegistry, runnerAdapter, type RunnerAdapter } from './runner-adapters';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'willyou-runner-adapter-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

// Contract every adapter must satisfy; the host only talks to this shape.
function contract(adapter: RunnerAdapter) {
  expect(adapter.stateEnvVar).toMatch(/^[A-Z][A-Z0-9_]*$/);
  expect(['host', 'observed']).toContain(adapter.sessionIdStrategy);
  expect(adapter.sessionFile(tmp(), '/nonexistent/cwd', '00000000-0000-4000-8000-000000000001', { sinceMs: 0, scan: true })).toBeNull();
}

describe('RunnerAdapter contract', () => {
  it('built-in adapters keep their prior lifecycle facts', () => {
    expect(runnerAdapter('claude')).toMatchObject({ stateEnvVar: 'CLAUDE_CONFIG_DIR', sessionIdStrategy: 'host' });
    expect(runnerAdapter('codex')).toMatchObject({ stateEnvVar: 'CODEX_HOME', sessionIdStrategy: 'observed' });
    contract(runnerAdapter('claude'));
    contract(runnerAdapter('codex'));
  });

  it('locates a Claude session file by id under the encoded project folder', () => {
    const root = tmp(), cwd = '/work/proj', id = '11111111-1111-4111-8111-111111111111';
    mkdirSync(join(root, 'projects', '-work-proj'), { recursive: true });
    writeFileSync(join(root, 'projects', '-work-proj', `${id}.jsonl`), '{}\n');
    expect(runnerAdapter('claude').sessionFile(root, cwd, id, { sinceMs: 0, scan: false })).toBe(join(root, 'projects', '-work-proj', `${id}.jsonl`));
  });

  it('executes a registered scripted runner through new and resume without builtin argument dispatch', async () => {
    const root = tmp(), script = join(root, 'scripted.cjs');
    writeFileSync(script, `const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2);if(args[0]==='--version'){console.log('scripted 1.0.0');process.exit(0);}const root=process.env.M11_SCRIPTED_HOME,mode=args[0],id=args[1],file=path.join(root,id+'.jsonl');if(mode==='resume'&&!fs.existsSync(file))process.exit(2);fs.appendFileSync(file,JSON.stringify({mode,id,prompt:args[2]||null})+'\\n');`);
    const third: RunnerAdapter = {
      ...runnerAdapter('codex'),
      id: 'scripted-test',
      describe: () => ({ id: 'scripted-test', agentId: 'scripted-test', label: 'Scripted test', sessionLabel: 'Scripted test', command: process.execPath }),
      profileSchema: () => z.object({ runner: z.literal('scripted-test') }),
      stateEnvVar: 'M11_SCRIPTED_HOME', sessionIdStrategy: 'host',
      defaultStateRoot: home => join(home, 'scripted-state'),
      stateRoot: (profile, base) => profile.M11_SCRIPTED_HOME || base.M11_SCRIPTED_HOME || root,
      launchArgs: o => { if (!o.sessionId) throw Error('Missing scripted session'); return [script, o.mode, o.sessionId, ...(o.mode === 'new' ? [o.firstMessage ?? ''] : [])]; },
      sessionFile: (root, _cwd, sessionId) => { const f = join(root, `${sessionId}.jsonl`); return existsSync(f) ? f : null; },
      canConfirmNoHistory: root => existsSync(root),
    };
    const registry = new RunnerAdapterRegistry([...builtinRunnerAdapters.list(), third]), adapter = registry.get('scripted-test');
    contract(adapter);
    expect(adapter.profileSchema().safeParse({ runner: 'scripted-test' }).success).toBe(true);
    expect(adapter.profileSchema().safeParse({ runner: 'codex' }).success).toBe(false);
    expect(adapter.stateRoot({}, { M11_SCRIPTED_HOME: root })).toBe(root);
    const options = { cwd: root, sessionId: 'registered-session', firstMessage: 'prompt; never a shell command' };
    const env = { PATH: '/usr/bin:/bin', HOME: root, M11_SCRIPTED_HOME: root, ELECTRON_RUN_AS_NODE: '1' };
    expect(adapter.sessionFile(root, root, options.sessionId, { sinceMs: 0, scan: true })).toBeNull();
    for (const mode of ['new', 'resume'] as const) execFileSync(process.execPath, adapter.launchArgs({ ...options, mode }), { cwd: root, env, timeout: 5000 });
    const file = adapter.sessionFile(root, root, options.sessionId, { sinceMs: 0, scan: true });
    expect(file).toBe(join(root, options.sessionId + '.jsonl'));
    expect(readFileSync(file!, 'utf8').trim().split('\n').map(line => JSON.parse(line))).toEqual([
      { mode: 'new', id: options.sessionId, prompt: options.firstMessage },
      { mode: 'resume', id: options.sessionId, prompt: null },
    ]);
    // This is the A-group lifecycle contract; full TaskService/B-group T35 remains separate.
  });

  it('rejects duplicate, incomplete or mismatched registrations and unknown lookups', () => {
    const codex = runnerAdapter('codex');
    expect(() => new RunnerAdapterRegistry([codex, codex])).toThrow('身份无效或重复');
    expect(() => new RunnerAdapterRegistry([{ ...codex, id: 'other' }])).toThrow('身份无效或重复');
    expect(() => new RunnerAdapterRegistry([{ ...codex, launchArgs: undefined } as unknown as RunnerAdapter])).toThrow('身份无效或重复');
    expect(() => builtinRunnerAdapters.get('unregistered')).toThrow('未登记');
    expect(Object.isFrozen(builtinRunnerAdapters.get('codex'))).toBe(true);
  });

  it('preserves prototype-defined adapter methods when freezing startup composition', () => {
    const inherited = Object.create(runnerAdapter('codex')) as RunnerAdapter;
    const registry = new RunnerAdapterRegistry([inherited]);
    expect(registry.get('codex').launchArgs({ mode: 'resume', cwd: '/work', sessionId: 'same-session' })).toEqual(['resume', '--cd', '/work', 'same-session']);
    expect(Object.isFrozen(registry.get('codex'))).toBe(true);
  });

  it('keeps state-root precedence and implicit native defaults explicit in the adapters', () => {
    const claude = runnerAdapter('claude'), codex = runnerAdapter('codex');
    expect(claude.stateRoot({ HOME: '/p' }, { HOME: '/b' })).toBe('/p/.claude');
    expect(claude.stateRoot({ CLAUDE_CONFIG_DIR: '/p/state' }, { CLAUDE_CONFIG_DIR: '/b/state' })).toBe('/p/state');
    expect(codex.stateRoot({}, { HOME: '/b', CODEX_HOME: '/b/state' })).toBe('/b/state');
    expect(codex.stateRoot({ HOME: '/p' }, {})).toBe('/p/.codex');
    expect(claude.preserveImplicitStateRoot).toBe(true);
    expect(codex.preserveImplicitStateRoot).toBe(false);
    expect(claude.canConfirmNoHistory('/not-present')).toBe(false);
    expect(claude.canConfirmNoHistory(tmp())).toBe(true);
    expect(codex.canConfirmNoHistory(tmp())).toBe(false);
  });
});
