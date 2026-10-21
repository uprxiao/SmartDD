import {randomUUID} from 'node:crypto';
import {withResourceLock} from '../resource-lock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FixtureProcessReader, runFixture } from './run-fixture';
import type { OwnedCapabilityRun } from '../run-registry';
let f: Awaited<ReturnType<typeof runFixture>>, reader: FixtureProcessReader;
const leases = (runId: string) => f.sqlite.prepare("SELECT state FROM capability_resource_leases WHERE owner_kind='run' AND owner_id=?").all(runId);
const protection = (runId: string) => f.sqlite.prepare("SELECT lr.resource_id FROM capability_lease_resources lr JOIN capability_resource_leases l ON l.lease_id=lr.lease_id WHERE l.owner_kind='run' AND l.owner_id=? ORDER BY lr.resource_id").all(runId);
const hostStopped = (runId: string) => f.sqlite.prepare('UPDATE capability_runs SET owner_pid=?,owner_started_at=? WHERE run_id=?').run(987654321,'darwin-proc-v1:1:1',runId);
async function active(): Promise<OwnedCapabilityRun> { const run = await f.create(); await run.prepare(); await run.cli.arm(); reader.identities.set(200001,'darwin-proc-v1:200:1'); await run.cli.attach(200001); return run; }
beforeEach(async () => { reader = new FixtureProcessReader(); f = await runFixture(reader); });
afterEach(() => f.cleanup());
describe('capability run resource registration, revocation and conservative recovery', () => {
  it('rolls back a failed restriction receipt without guessing the CLI was restricted or armed',async()=>{
    const run=await f.create();await run.prepare();f.sqlite.exec("CREATE TRIGGER restriction_write_fail BEFORE INSERT ON capability_run_restrictions BEGIN SELECT RAISE(ABORT,'private restriction receipt failure'); END");await expect(f.runs.restrictToNative(run.runId)).rejects.toThrow('private restriction receipt failure');expect(f.sqlite.prepare('SELECT COUNT(*) n FROM capability_run_restrictions').get()).toEqual({n:0});expect(f.sqlite.prepare('SELECT state FROM capability_run_processes WHERE run_id=?').get(run.runId)).toEqual({state:'reserved'});f.sqlite.exec('DROP TRIGGER restriction_write_fail');const bridge=await run.reserveBridge();await bridge.cancelBeforeLaunch();await run.cli.arm();reader.identities.set(200001,'darwin-proc-v1:200:1');await run.cli.attach(200001);expect(f.runs.assertActive(run.runId).run.runId).toBe(run.runId);await run.cli.exited();
  });
  it('refuses handoff after a narrowed-run receipt is corrupted but still permits owned cancellation and cleanup',async()=>{
    const run=await f.create();await run.prepare();await f.runs.restrictToNative(run.runId);f.sqlite.prepare("UPDATE capability_run_restrictions SET evidence_json='{}' WHERE run_id=?").run(run.runId);await expect(run.cli.arm()).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(f.runs.inputContext(f.snapshot.taskId,run.ptyId)).toBeNull();await run.stop();expect(leases(run.runId)).toEqual([{state:'released'}]);
  });
  it('returns only a verified owned native view for diagnostics and never lets another registry or a reused PID adopt it',async()=>{
    const run=await f.create();await run.prepare();await f.runs.restrictToNative(run.runId);await run.cli.arm();reader.identities.set(200001,'darwin-proc-v1:200:1');await run.cli.attach(200001);const native=f.runs.currentNativeRun(f.snapshot.taskId,run.ptyId);expect(native).toMatchObject({runId:run.runId,pid:200001});expect(native).not.toHaveProperty('snapshot');expect(native).not.toHaveProperty('signal');expect(f.registry().currentNativeRun(f.snapshot.taskId,run.ptyId)).toBeNull();expect(f.runs.currentNativeRun('another-task',run.ptyId)).toBeNull();reader.identities.set(200001,'darwin-proc-v1:300:1');expect(f.runs.currentNativeRun(f.snapshot.taskId,run.ptyId)).toBeNull();expect(()=>f.runs.assertActive(run.runId)).toThrow('不签发');await run.cli.exited();
  });
  it('narrows only a prepared, fully canceled-bridge run and retains protection until the owned native exit',async()=>{
    const run=await f.create();await run.prepare();const bridge=await run.reserveBridge();await expect(f.runs.restrictToNative(run.runId)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});await bridge.cancelBeforeLaunch();const refs=protection(run.runId);await f.runs.restrictToNative(run.runId);
    expect(()=>f.runs.assertActive(run.runId)).toThrow('不签发');await expect(run.reserveBridge()).rejects.toMatchObject({code:'SCOPE_DENIED'});await run.cli.arm();reader.identities.set(200001,'darwin-proc-v1:200:1');await run.cli.attach(200001);expect(f.runs.inputContext(f.snapshot.taskId,run.ptyId)).toBeNull();expect(protection(run.runId)).toEqual(refs);expect(leases(run.runId)).toEqual([{state:'active'}]);await run.cli.exited();expect(leases(run.runId)).toEqual([{state:'released'}]);
  });
  it('refuses narrowing an armed CLI without changing its authority or occupied resources',async()=>{
    const run=await f.create();await run.prepare();await run.cli.arm();await expect(f.runs.restrictToNative(run.runId)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});expect(leases(run.runId)).toEqual([{state:'active'}]);reader.identities.set(200001,'darwin-proc-v1:200:1');await run.cli.attach(200001);expect(f.runs.assertActive(run.runId).snapshot).toEqual(f.snapshot);await run.cli.exited();
  });
  it('accepts the first proved native ID on a narrowed run without restoring business authority',async()=>{
    const run=await f.create();await run.prepare();await f.runs.restrictToNative(run.runId);await run.cli.arm();reader.identities.set(200001,'darwin-proc-v1:200:1');await run.cli.attach(200001);const bound=await f.sessions.bindNativeSession(f.snapshot.taskId,f.session.pointer.snapshotHash,{...f.snapshot.native,runner:'claude-code',sessionId:'native-narrowed-id'});expect(f.runs.get(run.runId).snapshotHash).toBe(bound.pointer.snapshotHash);expect(()=>f.runs.assertActive(run.runId)).toThrow('不签发');await run.cli.exited();expect(leases(run.runId)).toEqual([{state:'released'}]);
  });
  it('joins input only to one actual active task/PTY owned by this registry',async()=>{
    const run=await f.create();expect(f.runs.inputContext(f.snapshot.taskId,run.ptyId)).toBeNull();await run.prepare();await run.cli.arm();reader.identities.set(200001,'darwin-proc-v1:200:1');await run.cli.attach(200001);expect(f.runs.inputContext(f.snapshot.taskId,run.ptyId)?.run.runId).toBe(run.runId);expect(f.runs.inputContext('other-task',run.ptyId)).toBeNull();expect(f.runs.inputContext(f.snapshot.taskId,'other-pty')).toBeNull();expect(f.registry().inputContext(f.snapshot.taskId,run.ptyId)).toBeNull();await run.cli.exited();expect(f.runs.inputContext(f.snapshot.taskId,run.ptyId)).toBeNull();
  });
  it('never adopts a reused PID when attachment requires the proved original birth identity',async()=>{
    const run=await active(),bridge=await run.reserveBridge();await bridge.arm();reader.identities.set(200002,'darwin-proc-v1:300:2');await expect(bridge.attach(200002,'darwin-proc-v1:200:2')).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(f.sqlite.prepare('SELECT state,pid,process_started_at FROM capability_run_processes WHERE process_id=?').get(bridge.processId)).toEqual({state:'unknown',pid:null,process_started_at:null});await expect(bridge.attach(200002,'not-a-kernel-start')).rejects.toMatchObject({code:'INVALID_INPUT'});await bridge.attach(200002,'darwin-proc-v1:300:2');expect(f.sqlite.prepare('SELECT state,pid,process_started_at FROM capability_run_processes WHERE process_id=?').get(bridge.processId)).toEqual({state:'active',pid:200002,process_started_at:'darwin-proc-v1:300:2'});await bridge.exited();await run.cli.exited();
  });
  it('protects the complete transitive dependency closure before any source bytes are consumed', async () => {
    const run = await f.create(); expect(f.runs.get(run.runId).state).toBe('preparing'); expect(protection(run.runId)).toHaveLength(3);
    f.setVerify(r => { expect(protection(run.runId)).toContainEqual({ resource_id: r.resourceId }); expect(leases(run.runId)).toEqual([{ state: 'preparing' }]); });
    await run.prepare(); expect(f.runs.get(run.runId).state).toBe('prepared'); expect(leases(run.runId)).toEqual([{ state: 'active' }]);
    expect(() => f.runs.assertActive(run.runId)).toThrow('尚未激活'); await run.stop(); expect(leases(run.runId)).toEqual([{ state: 'released' }]);
    expect(f.sqlite.prepare('SELECT count(*) AS n FROM capability_session_refs').get()).toEqual({ n: 1 }); expect(f.sqlite.prepare('SELECT retention_state FROM capability_session_snapshots').get()).toEqual({ retention_state: 'active' });
  });
  it('revokes immediately but keeps an armed launch window until its actual owned exit', async () => {
    const run = await f.create(); await run.prepare(); await run.cli.arm(); await run.stop();
    expect(run.signal.aborted).toBe(true); expect(f.runs.get(run.runId).state).toBe('stopping'); expect(leases(run.runId)).toEqual([{ state: 'active' }]);
    await expect(run.cli.cancelBeforeLaunch()).rejects.toMatchObject({ code: 'RESOURCE_STATE_CHANGED' });
    await run.cli.exited(); expect(f.runs.get(run.runId).state).toBe('stopped'); expect(leases(run.runId)).toEqual([{ state: 'released' }]);
  });
  it('keeps a running bridge protected after CLI exit and releases only after both exits', async () => {
    const run = await active(), bridge = await run.reserveBridge(); await bridge.arm(); reader.identities.set(200002,'darwin-proc-v1:200:2'); await bridge.attach(200002);
    await run.cli.exited(); expect(run.signal.aborted).toBe(true); expect(f.runs.get(run.runId).state).toBe('stopping'); expect(leases(run.runId)).toEqual([{ state: 'active' }]);
    expect(() => f.runs.assertActive(run.runId)).toThrow('停止'); await bridge.exited(); expect(f.runs.get(run.runId).state).toBe('stopped'); expect(leases(run.runId)).toEqual([{ state: 'released' }]);
  });
  it('waits for actual in-flight executor completion even when all native handles have exited', async () => {
    const run = await active(); let finish!: () => void, started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; }), work = f.runs.withActivity(run.runId,async context => { started(); expect(context.snapshot.projectId).toBe('p1'); await new Promise<void>(resolve => { finish = resolve; }); expect(context.signal.aborted).toBe(true); return 'settled external result'; });
    await ready; await run.cli.exited(); expect(f.runs.get(run.runId).state).toBe('stopping'); expect(leases(run.runId)).toEqual([{ state: 'active' }]);
    finish(); expect(await work).toBe('settled external result'); expect(f.runs.get(run.runId).state).toBe('stopped');
  });
  it('rechecks policy after preparation and on every call without changing the fixed snapshot', async () => {
    const run = await f.create(); f.setAllowed(false); await expect(run.prepare()).rejects.toMatchObject({ code: 'SCOPE_DENIED' }); await run.stop();
    f.setAllowed(true); const next = await active(); f.setAllowed(false); expect(() => f.runs.assertActive(next.runId)).toThrow('policy revoked');
    f.setAllowed(true); expect(f.runs.assertActive(next.runId).snapshot).toEqual(f.snapshot); await next.cli.exited();
  });
  it('preserves the original selection when first native ID completion updates the run pointer', async () => {
    const run = await active(); const bound = await f.sessions.bindNativeSession(f.snapshot.taskId,f.session.pointer.snapshotHash,{ ...f.snapshot.native,runner: 'claude-code',sessionId: 'native-owned-1' });
    const context = f.runs.assertActive(run.runId); expect(context.run.snapshotHash).toBe(bound.pointer.snapshotHash); expect(context.snapshot.native.sessionId).toBe('native-owned-1'); expect(context.snapshot.packages).toEqual([]); expect(protection(run.runId)).toHaveLength(3); await run.cli.exited();
  });
  it('refuses a second live run and another registry cannot impersonate an owned run', async () => {
    const run = await active(); await expect(f.create()).rejects.toMatchObject({ code: 'RESOURCE_BUSY' }); const other = f.registry();
    expect(() => other.assertActive(run.runId)).toThrow('当前宿主'); await expect(other.stop(run.runId)).rejects.toMatchObject({ code: 'SCOPE_DENIED' }); expect(await other.recover()).toEqual([{ runId: run.runId,state: 'running' }]); await run.cli.exited();
  });
  it('does not accept project or approval fields supplied with a reserve request', async () => {
    await expect(f.runs.reserve({ taskId: f.snapshot.taskId,snapshotHash: f.session.pointer.snapshotHash,bindings: [],projectId: 'another',approved: true } as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(f.sqlite.prepare('SELECT count(*) AS n FROM capability_runs').get()).toEqual({ n: 0 });
  });
  it('records an exit arriving before PID attachment without reopening the run later', async () => {
    const run = await f.create(); await run.prepare(); await run.cli.arm(); await run.cli.exited(); reader.identities.set(200001,'darwin-proc-v1:200:1'); await run.cli.attach(200001);
    expect(f.runs.get(run.runId).state).toBe('stopped'); expect(f.runs.get(run.runId).pid).toBeNull(); expect(leases(run.runId)).toEqual([{ state: 'released' }]);
  });
  it('retains an unknown PID attachment and rejects replacement of an already fixed process', async () => {
    const run = await f.create(); await run.prepare(); await run.cli.arm(); await expect(run.cli.attach(200001)).rejects.toMatchObject({ code: 'RESOURCE_RECOVERY_REQUIRED' });
    expect(f.sqlite.prepare('SELECT state FROM capability_run_processes WHERE run_id=?').get(run.runId)).toEqual({ state: 'unknown' });
    reader.identities.set(200001,'darwin-proc-v1:200:1'); await run.cli.attach(200001); reader.identities.set(200002,'darwin-proc-v1:200:2'); await expect(run.cli.attach(200002)).rejects.toMatchObject({ code: 'NATIVE_IDENTITY_CONFLICT' }); await run.cli.exited();
  });
  it('retains leases when revoke fails and allows a later successful revoke after actual exit', async () => {
    const run = await active(); f.setRevoke(() => { throw new Error('controlled revoker failure'); });
    await expect(run.stop()).rejects.toMatchObject({ code: 'RUN_STOP_FAILED' }); await expect(run.cli.exited()).rejects.toMatchObject({ code: 'RUN_STOP_FAILED' });
    expect(leases(run.runId)).toEqual([{ state: 'active' }]); expect(() => f.runs.assertActive(run.runId)).toThrow('停止'); f.setRevoke(() => undefined); await run.stop(); expect(f.runs.get(run.runId).state).toBe('stopped');
  });
  it('allows the revoker to await an exit callback without an exit/revoke wait cycle', async () => {
    const run = await active(); let exited!: () => void;
    f.setRevoke(() => new Promise<void>(resolve => { exited = resolve; })); const stopping = run.stop();
    await vi.waitFor(() => expect(f.revocations()).toBe(1),{ interval: 1 }); await run.cli.exited(); exited(); await stopping;
    expect(f.runs.get(run.runId).state).toBe('stopped'); expect(leases(run.runId)).toEqual([{ state: 'released' }]);
  });
  it('bounds stop waiting while preserving the pending revoke until it really completes', async () => {
    const run = await active(); let complete!: () => void; f.setRevoke(() => new Promise<void>(resolve => { complete = resolve; }));
    await expect(run.stop()).rejects.toMatchObject({ code: 'RUN_STOP_FAILED' }); expect(leases(run.runId)).toEqual([{ state: 'active' }]); complete(); await vi.waitFor(() => expect(f.sqlite.prepare('SELECT revocation_state FROM capability_runs WHERE run_id=?').get(run.runId)).toEqual({ revocation_state: 'revoked' }));
    await run.cli.exited(); expect(f.runs.get(run.runId).state).toBe('stopped'); expect(f.revocations()).toBe(1);
  });
  it('protects a ready projection added during preparation and rejects a generation race after byte verification', async () => {
    const run = await f.create(), projection = await f.resource('session-projection','projection',[f.adapter.resourceId]); await f.sessions.addProjectionReference(f.snapshot.taskId,f.session.pointer.snapshotHash,projection.resourceId);
    f.setVerify(r => { expect(protection(run.runId)).toContainEqual({ resource_id: r.resourceId }); }); await run.prepare(); expect(protection(run.runId)).toHaveLength(4); await run.stop();
    const next = await f.create(); f.setVerify(() => { f.sqlite.prepare('UPDATE capability_resources SET generation=generation+1 WHERE resource_id=?').run(f.adapter.resourceId); }); await expect(next.prepare()).rejects.toMatchObject({ code: 'RESOURCE_STATE_CHANGED' }); expect(leases(next.runId)).toEqual([{ state: 'preparing' }]); await next.stop();
  });
  it('refuses deleting resources, cyclic dependencies and maintenance without partial new runs', async () => {
    f.sqlite.prepare("UPDATE capability_resources SET state='deleting' WHERE resource_id=?").run(f.child.resourceId); await expect(f.create()).rejects.toMatchObject({ code: 'RESOURCE_STATE_CHANGED' }); f.sqlite.prepare("UPDATE capability_resources SET state='ready' WHERE resource_id=?").run(f.child.resourceId);
    f.sqlite.prepare('INSERT INTO capability_resource_dependencies VALUES(?,?)').run(f.child.resourceId,f.adapter.resourceId); await expect(f.create()).rejects.toMatchObject({ code: 'SNAPSHOT_CORRUPT' }); f.sqlite.prepare('DELETE FROM capability_resource_dependencies WHERE resource_id=?').run(f.child.resourceId);
    const first = await f.create(); await first.stop(); f.sqlite.exec("UPDATE capability_store_state SET maintenance_state='pending'"); await expect(f.create()).rejects.toMatchObject({ code: 'RESOURCE_RECOVERY_REQUIRED' }); expect(f.sqlite.prepare('SELECT count(*) AS n FROM capability_runs').get()).toEqual({ n: 1 });
  });
  it('recovers proven-dead unarmed preparation but never assumes an armed PID-null fork did not occur', async () => {
    const unarmed = await f.create(); hostStopped(unarmed.runId); const next = f.registry(); expect(await next.recover()).toEqual([{ runId: unarmed.runId,state: 'stopped' }]); expect(leases(unarmed.runId)).toEqual([{ state: 'released' }]);
    const armed = await f.create(); await armed.prepare(); await armed.cli.arm(); hostStopped(armed.runId); expect(await next.recover()).toEqual([{ runId: armed.runId,state: 'orphaned' }]); expect(leases(armed.runId)).toEqual([{ state: 'recovery-required' }]); await expect(next.reserve({ taskId: f.snapshot.taskId,snapshotHash: f.session.pointer.snapshotHash,bindings: [] })).rejects.toMatchObject({ code: 'RESOURCE_BUSY' });
  });
  it('does not release a recovered run while a known child is still alive or identity cannot be read', async () => {
    const run = await active(); hostStopped(run.runId); const next = f.registry(); expect(await next.recover()).toEqual([{ runId: run.runId,state: 'orphaned' }]); expect(leases(run.runId)).toEqual([{ state: 'recovery-required' }]);
    reader.unknown.add(200001); expect(await next.recover()).toEqual([{ runId: run.runId,state: 'orphaned' }]); reader.unknown.clear(); reader.identities.delete(200001); expect(await next.recover()).toEqual([{ runId: run.runId,state: 'stopped' }]); expect(leases(run.runId)).toEqual([{ state: 'released' }]);
  });
  it('treats a reused PID as proof the old child stopped without signalling its new occupant', async () => {
    const run = await active(); hostStopped(run.runId); reader.identities.set(200001,'darwin-proc-v1:201:1'); expect(await f.registry().recover()).toEqual([{ runId: run.runId,state: 'stopped' }]); expect(reader.read(200001)).toEqual({ pid: 200001,startedAt: 'darwin-proc-v1:201:1' }); expect(f.revocations()).toBe(0);
  });
  it('keeps missing child records and unprovable host identities held even with old timestamps', async () => {
    const run = await active(); f.sqlite.prepare("UPDATE capability_runs SET started_at='2000-01-01T00:00:00Z' WHERE run_id=?").run(run.runId); reader.unknown.add(process.pid); const otherHost = 987654320; reader.identities.set(otherHost,'darwin-proc-v1:300:1');
    // New supervisor still uses a proven current host; only the old recorded owner is unprovable.
    reader.unknown.clear(); f.sqlite.prepare('UPDATE capability_runs SET owner_pid=?,owner_started_at=? WHERE run_id=?').run(otherHost,'darwin-proc-v1:300:1',run.runId); reader.unknown.add(otherHost);
    const next = f.registry(); expect(await next.recover()).toEqual([{ runId: run.runId,state: 'unknown' }]); expect(leases(run.runId)).toEqual([{ state: 'active' }]); reader.unknown.clear(); hostStopped(run.runId); f.sqlite.prepare('DELETE FROM capability_run_processes WHERE run_id=?').run(run.runId);
    expect(await next.recover()).toEqual([{ runId: run.runId,state: 'orphaned' }]); expect(leases(run.runId)).toEqual([{ state: 'recovery-required' }]);
  });
  it('preserves stopped run and source references after project deletion, while rejecting restart', async () => {
    const run = await active(); await run.cli.exited(); f.sqlite.exec("DELETE FROM projects WHERE id='p1'"); expect(f.runs.get(run.runId).projectId).toBe('p1'); expect(f.sqlite.prepare('SELECT count(*) AS n FROM capability_session_refs').get()).toEqual({ n: 1 }); await expect(f.create()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('records real owned exit even if fixed snapshot bytes become corrupt', async () => {
    const run = await active(); f.sqlite.prepare("UPDATE capability_session_snapshots SET snapshot_json='corrupt' WHERE task_id=?").run(f.snapshot.taskId); await run.cli.exited(); expect(f.runs.get(run.runId).state).toBe('stopped'); expect(leases(run.runId)).toEqual([{ state: 'released' }]); expect(f.sqlite.prepare('SELECT count(*) AS n FROM capability_session_refs').get()).toEqual({ n: 1 });
  });
});


describe('native-only unknown-history lifecycle without business authority',()=>{
 async function guard(){const taskId='history-'+randomUUID();await f.sessions.holdUnknown({taskId,projectId:'p1',runner:'codex',stateRoot:f.home,cwd:f.snapshot.native.cwd,sessionId:'historical-native',reason:'history-unknown'});const row=f.sqlite.prepare('SELECT snapshot_hash AS hash FROM capability_session_snapshots WHERE task_id=?').get(taskId) as {hash:string};let checks=0;const input={taskId,projectId:'p1',runner:'codex' as const,snapshotHash:row.hash,resourceIds:[f.adapter.resourceId],verify:async()=>{await withResourceLock(f.store.root,()=>{checks++;});}};const run=await f.runs.reserveNativeGuard(input);return{taskId,input,run,checks:()=>checks};}
 it('registers source closure before launch, cannot mint a bridge or input provenance, and waits for owned exit',async()=>{const g=await guard();expect(protection(g.run.runId)).toHaveLength(3);await g.run.prepare();expect(g.checks()).toBe(1);await g.run.cli.arm();reader.identities.set(200003,'darwin-proc-v1:400:3');await g.run.cli.attach(200003);expect(f.runs.get(g.run.runId).state).toBe('active');expect(()=>f.runs.assertActive(g.run.runId)).toThrow('不签发');expect(()=>f.runs.bridgePreparation(g.run.runId)).toThrow('不签发');expect(f.runs.inputContext(g.taskId,g.run.ptyId)).toBeNull();await expect(g.run.reserveBridge()).rejects.toMatchObject({code:'SCOPE_DENIED'});await g.run.stop();expect(leases(g.run.runId)).toEqual([{state:'active'}]);await g.run.cli.exited();expect(leases(g.run.runId)).toEqual([{state:'released'}]);expect(f.sqlite.prepare('SELECT schema_version,retention_state FROM capability_session_snapshots WHERE task_id=?').get(g.taskId)).toEqual({schema_version:0,retention_state:'hold'});});
 it('refuses cross-project, v2 or empty-source promotion and detects changed original metadata',async()=>{const g=await guard();await expect(f.runs.reserveNativeGuard({...g.input,projectId:'different-project'})).rejects.toMatchObject({code:'SCOPE_DENIED'});await expect(f.runs.reserveNativeGuard({...g.input,taskId:f.snapshot.taskId,snapshotHash:f.session.pointer.snapshotHash})).rejects.toMatchObject({code:'SESSION_ON_HOLD'});await expect(f.runs.reserveNativeGuard({...g.input,resourceIds:[]})).rejects.toMatchObject({code:'INVALID_INPUT'});f.sqlite.prepare("UPDATE capability_session_snapshots SET snapshot_json='{}' WHERE task_id=?").run(g.taskId);await expect(g.run.prepare()).rejects.toMatchObject({code:'SNAPSHOT_CORRUPT'});expect(leases(g.run.runId)).toEqual([{state:'preparing'}]);await g.run.stop();expect(f.runs.get(g.run.runId).state).toBe('stopped');});
 it('recovers only when the previous guard owner and actual CLI identity are both stopped',async()=>{const g=await guard();await g.run.prepare();await g.run.cli.arm();reader.identities.set(200003,'darwin-proc-v1:400:3');await g.run.cli.attach(200003);hostStopped(g.run.runId);const other=f.registry();expect(await other.recover()).toContainEqual({runId:g.run.runId,state:'orphaned'});expect(leases(g.run.runId)).toEqual([{state:'recovery-required'}]);reader.identities.delete(200003);expect(await other.recover()).toContainEqual({runId:g.run.runId,state:'stopped'});expect(leases(g.run.runId)).toEqual([{state:'released'}]);expect(()=>other.assertActive(g.run.runId)).toThrow('不属于');});
});
