import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CodeAgentTool, RunConfigView } from '@shared/ai-agents';
import { resolveProfileLaunch } from './profile-launch';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })));
const tool: CodeAgentTool = { id: 't', kind: 'codex', executable: 'codex', installed: true, login: 'subscription', version: '0.169.0' };
const config: RunConfigView = { id: 'c', name: 'Login', toolId: 't', kind: 'codex', source: 'login', providerId: null, models: [], defaultModel: null, homeVisible: true, isDefault: true, loggedOut: false, nameCustomized: true, order: 0, available: true, legacyReason: null };
function fixture() { const home = mkdtempSync(join(tmpdir(), 'm14-profile-')); roots.push(home); const state = join(home, '.codex'); mkdirSync(state); return { home, state, input: { config, tool, cwd: home, userData: join(home, 'data'), runId: '11111111-1111-4111-a111-111111111111', baseEnv: { HOME: home, CODEX_HOME: state } } }; }
it('A07: disables each personal MCP at launch without writing user config, including quoted names; carry restores normal loading', () => {
  const f = fixture(), file = join(f.state, 'config.toml');
  const original = '[mcp_servers.normal]\ncommand="first"\n[mcp_servers."with.dot"]\ncommand="second"\n'; writeFileSync(file, original);
  const isolated = resolveProfileLaunch({ ...f.input, carryExtensions: false });
  expect(isolated.extraArgs).toEqual(expect.arrayContaining(['mcp_servers."normal".enabled=false', 'mcp_servers."with.dot".enabled=false']));
  expect(resolveProfileLaunch(f.input).extraArgs.some(a => a.includes('.enabled=false'))).toBe(false);
  expect(readFileSync(file, 'utf8')).toBe(original);
  expect(isolated.compatibility.extensions).toBe(false);
});
it('A07: malformed personal configuration fails visibly instead of claiming extensions were isolated', () => {
  const f = fixture(); writeFileSync(join(f.state, 'config.toml'), '[invalid');
  expect(() => resolveProfileLaunch({ ...f.input, carryExtensions: false })).toThrow();
});
it('A07: Claude login extension opt-out excludes user settings while retaining project rules', () => {
  const f = fixture();
  const result = resolveProfileLaunch({ ...f.input, config: { ...config, kind: 'claude' }, tool: { ...tool, kind: 'claude', executable: 'claude' }, carryExtensions: false });
  expect(result.settingSources).toEqual(['project', 'local']);
  expect(result.compatibility.extensions).toBe(false);
});
