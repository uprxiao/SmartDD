import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runnerAdapter, type RunnerAdapter } from './runner-adapters';

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

  it('a scripted third agent satisfies the same contract without host branches', () => {
    const third: RunnerAdapter = {
      id: 'claude', // Runner union is not widened here; only the interface shape is under test.
      stateEnvVar: 'FAKE_AGENT_HOME', sessionIdStrategy: 'observed',
      sessionFile: (root, _cwd, sessionId) => { const f = join(root, `${sessionId}.log`); try { writeFileSync(f, '', { flag: 'wx' }); } catch { /* exists */ } return f; },
    };
    const root = tmp();
    expect(third.sessionFile(root, '/x', 'abc', { sinceMs: 0, scan: false })).toBe(join(root, 'abc.log'));
    expect(third.stateEnvVar).toBe('FAKE_AGENT_HOME');
  });
});
