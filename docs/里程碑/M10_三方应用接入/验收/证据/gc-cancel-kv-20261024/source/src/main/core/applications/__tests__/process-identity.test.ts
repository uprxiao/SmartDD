import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MacProcessIdentityReader } from '../process-identity';
import { runFixture } from './run-fixture';
let build: string, native: string, reader: MacProcessIdentityReader;
const children = new Set<ChildProcess>();
const child = async () => { const processChild = spawn(process.execPath,['-e','setInterval(() => {}, 10000)'],{ env: { ...process.env,ELECTRON_RUN_AS_NODE: '1' },stdio: 'ignore' }); children.add(processChild); processChild.once('exit',() => children.delete(processChild)); await once(processChild,'spawn'); return processChild; };
describe.skipIf(process.platform !== 'darwin')('kernel process identity and actual owned process lifecycles', () => {
  beforeAll(() => { build = mkdtempSync(join(tmpdir(),'willyou-m10-process-probe-')); native = join(build,'identity'); execFileSync('xcrun',['clang++','-std=c++17','-O2','-mmacosx-version-min=12.0',resolve('native/applications/process-identity.cc'),'-o',native]); const started=Date.now(),probe=JSON.parse(execFileSync(native,[String(process.pid)],{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']}));expect(probe).toMatchObject({schema:1,state:'running',pid:process.pid});expect(probe.startedAt).toMatch(/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/);console.log(JSON.stringify({kind:'fresh-native-test-precondition',elapsedMs:Date.now()-started})); reader = new MacProcessIdentityReader(native); });
  afterAll(() => rmSync(build,{ recursive: true,force: true }));
  afterEach(async () => { await Promise.all([...children].map(async p => { const done = once(p,'exit'); p.kill('SIGKILL'); await done; })); });
  it('reads actual microsecond start identity, distinguishes exit/reuse, and never treats approximate time as proof', async () => {
    const own = reader.read(process.pid)!; expect(own.pid).toBe(process.pid); expect(own.startedAt).toMatch(/^darwin-proc-v1:[0-9]+:[0-9]+$/); expect(reader.state(own)).toBe('running');
    const p = await child(), id = reader.read(p.pid!)!; expect(reader.state(id)).toBe('running'); expect(reader.state({ ...id,startedAt: 'darwin-proc-v1:1:1' })).toBe('stopped'); expect(reader.state({ ...id,startedAt: new Date().toISOString() })).toBe('unknown');
    const exited = once(p,'exit'); p.kill('SIGTERM'); await exited; expect(reader.state(id)).toBe('stopped'); expect(reader.state(own)).toBe('running');
  });
  it('returns unknown for invalid inputs, missing helper and unavailable identity', () => {
    expect(reader.read(-1)).toBeNull(); expect(reader.read(Number.NaN)).toBeNull(); expect(new MacProcessIdentityReader(join(build,'not-present')).state({ pid: process.pid,startedAt: 'darwin-proc-v1:1:1' })).toBe('unknown');
    expect(JSON.parse(execFileSync(native,['invalid'],{ encoding: 'utf8' }))).toEqual({ schema: 1,state: 'unknown' });
  });
  it('keeps leases until actual CLI and bridge child exit events, retaining an in-flight executor', async () => {
    const f = await runFixture(reader); let cli: ChildProcess | undefined, bridge: ChildProcess | undefined;
    try {
      const run = await f.create(); await run.prepare(); await run.cli.arm(); cli = await child(); await run.cli.attach(cli.pid!);
      const bridgeHandle = await run.reserveBridge(); await bridgeHandle.arm(); bridge = await child(); await bridgeHandle.attach(bridge.pid!);
      const cliExit = once(cli,'exit').then(() => run.cli.exited()), bridgeExit = once(bridge,'exit').then(() => bridgeHandle.exited());
      let complete!: () => void, started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
      const activity = f.runs.withActivity(run.runId,async context => { expect(context.run.pid).toBe(cli!.pid); started(); await new Promise<void>(resolve => { complete = resolve; }); expect(context.signal.aborted).toBe(true); }); await ready;
      f.setRevoke(() => { cli!.kill('SIGTERM'); bridge!.kill('SIGTERM'); }); await run.stop(); await Promise.all([cliExit,bridgeExit]);
      expect(f.runs.get(run.runId).state).toBe('stopping'); expect(f.sqlite.prepare("SELECT state FROM capability_resource_leases WHERE owner_kind='run'").all()).toEqual([{ state: 'active' }]); complete(); await activity;
      await vi.waitFor(() => expect(f.runs.get(run.runId).state).toBe('stopped')); expect(f.sqlite.prepare("SELECT state FROM capability_resource_leases WHERE owner_kind='run'").all()).toEqual([{ state: 'released' }]); expect(reader.state(f.runs.host)).toBe('running');
    } finally { for (const p of [cli,bridge]) if (p && children.has(p)) { const done = once(p,'exit'); p.kill('SIGKILL'); await done; } f.cleanup(); }
  });
});
