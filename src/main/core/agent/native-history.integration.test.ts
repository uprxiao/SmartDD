// Native protocol verification without a real model: isolated HOME/config, no inherited credentials.
// M14_NATIVE_CONTEXT=1 explicitly enables these two bounded probes. Product A/R acceptance is separate.
import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { CodexAppServerInstance } from './drivers/codex-app-server';
import { ClaudeSdkInstance } from './drivers/claude-sdk';
import type { DriverEvent } from './driver';
import { until, tick } from './test-doubles';

const enabled = process.env.M14_NATIVE_CONTEXT === '1';
const out = process.env.M14_CONTEXT_OUT;
const save = (name: string, value: unknown) => { if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, name + '.json'), JSON.stringify(value, null, 2) + '\n'); } };
const files = (root: string): string[] => readdirSync(root, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(root, e.name)) : e.isFile() && e.name.endsWith('.jsonl') ? [join(root, e.name)] : []);
function fixture(command: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'm14-context-'))), home = join(root, 'home'), cwd = join(root, 'work');
  mkdirSync(home); mkdirSync(cwd);
  const executable = realpathSync(execFileSync('/usr/bin/which', [command], { encoding: 'utf8' }).trim());
  const version = execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim();
  const env = { HOME: home, PATH: process.env.PATH ?? '/usr/bin:/bin', TMPDIR: root, USER: process.env.USER ?? '', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
  return { root, home, cwd, executable, version, env };
}

it.skipIf(!enabled)('Codex native thread/inject_items appends a history item without creating a turn', async () => {
  const f = fixture('codex'), state = join(f.home, '.codex'); mkdirSync(state);
  const instance = new CodexAppServerInstance(), events: DriverEvent[] = [], note = `HISTORY_ONLY_${randomUUID()}`;
  instance.on(e => events.push(e));
  let error: string | undefined;
  try {
    await instance.open({ executable: { path: f.executable, version: f.version }, cwd: f.cwd, env: { ...f.env, CODEX_HOME: state }, tier: 'ask', extraArgs: ['--disable', 'plugins', '--disable', 'apps', '-c', 'analytics.enabled=false'] });
    await instance.injectHistory(note);
    expect(events.filter(e => e.type === 'turn.started')).toHaveLength(0);
  } catch (e) { error = String(e); throw e; }
  finally {
    await instance.close();
    const matches = files(f.root).flatMap(file => readFileSync(file, 'utf8').split('\n').filter(line => line.includes(note)).map(line => ({ file, line })));
    save('codex-native-history', { layer: 'native CLI; no model turn', ...f, env: undefined, note, error, events, matchingHistory: matches });
    if (events.some(e => e.type === 'exit')) rmSync(f.root, { recursive: true, force: true });
    if (!error) expect(matches.length).toBeGreaterThan(0);
  }
}, 45_000);

it.skipIf(!enabled)('Claude native shouldQuery=false records synthetic history without calling a model', async () => {
  const f = fixture('claude'), state = join(f.home, '.claude'); mkdirSync(state);
  const requests: { path: string; bytes: number }[] = [];
  const server = createServer((req, res) => { let bytes = 0; req.on('data', b => { bytes += b.length; }); req.on('end', () => { requests.push({ path: req.url ?? '', bytes }); res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Native history probe must not invoke a model' } })); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const instance = new ClaudeSdkInstance(), events: DriverEvent[] = [], note = `HISTORY_ONLY_${randomUUID()}`;
  instance.on(e => events.push(e)); let error: string | undefined;
  try {
    await instance.open({ executable: { path: f.executable, version: f.version }, cwd: f.cwd, env: { ...f.env, CLAUDE_CONFIG_DIR: state, ANTHROPIC_API_KEY: 'public-probe-placeholder', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` }, tier: 'ask', settingSources: [] });
    await instance.injectHistory(note);
    await until(() => events.some(e => e.type === 'session'), 20_000);
    await tick(500);
    expect(events.filter(e => e.type === 'turn.started')).toHaveLength(0);
    expect(requests).toEqual([]);
  } catch (e) { error = String(e); throw e; }
  finally {
    await instance.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    const matches = files(f.root).flatMap(file => readFileSync(file, 'utf8').split('\n').filter(line => line.includes(note)).map(line => ({ file, line })));
    save('claude-native-history', { layer: 'native CLI and local rejecting endpoint; no real model', ...f, env: undefined, note, error, events, requests, matchingHistory: matches });
    if (events.some(e => e.type === 'exit')) rmSync(f.root, { recursive: true, force: true });
    if (!error) expect(matches.length).toBeGreaterThan(0);
  }
}, 45_000);
