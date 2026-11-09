import { randomUUID } from 'node:crypto';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';
import { applicationMcpServerName, applicationNativeSkillName } from '@shared/application-session';
import { applicationSkillContentHash } from '../session-registry';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationError } from '@shared/applications';
import { boundedJson, type BridgeToolCall } from '@shared/application-bridge';
import { ApplicationToolService, type HostToolOperation, type ApplicationOperationContext } from '../tool-service';
import { FixtureProcessReader, runFixture } from './run-fixture';
import { digest } from '../manifest';
let f: Awaited<ReturnType<typeof runFixture>>, service: ApplicationToolService, run: Awaited<ReturnType<typeof f.create>>, execute: HostToolOperation['execute'], connectionAllowed: boolean, retry: HostToolOperation['retry'], count: number;
const call = (value = 'synthetic-body',write = false): BridgeToolCall => ({ operation: write ? 'smartdd_zentao_write_v1' : 'smartdd_zentao_query_v1',contractMajor: 1,connectionId: null,arguments: { value } });
function makeService() { return new ApplicationToolService(f.store,f.runs,{ resolve: (_hash,name) => ({ semantics: name.includes('_write_') ? 'write' : 'read',retry: name.includes('_write_') ? 'never' : retry,authorize: (_context,connection) => { if (!connectionAllowed || connection !== null) throw new ApplicationError('AUTH_REQUIRED','controlled binding revoked'); },execute: async (...args) => { count++; return execute(...args); } }) },{ retryDelays: [0,0] }); }
beforeEach(async () => { const reader = new FixtureProcessReader(); f = await runFixture(reader,{ application: true }); run = await f.create(); await run.prepare(); await run.cli.arm(); reader.identities.set(200001,'darwin-proc-v1:200:1'); await run.cli.attach(200001); connectionAllowed = true; retry = 'safe-read'; count = 0; execute = async (context,args,operation) => ({ value: String(args.value),packageHash: operation.packageHash,projectId: context.run.projectId,taskId: context.run.taskId,operationId: operation.operationId }); service = makeService(); });
afterEach(async () => { await run.cli.exited(); f.cleanup(); });
describe('fixed-package tools, exact request receipts, semantic retries and resource activity', () => {
  it('reuses immutable schema compilers while validating every new request and current authority', async () => {
    const compile = vi.spyOn(AjvJsonSchemaValidator.prototype,'getValidator');
    try {
      for (let i = 0; i < 8; i++) expect(await service.call(run.runId,randomUUID(),call('body-' + i))).toMatchObject({status:'ok',value:{value:'body-' + i}});
      expect(compile).toHaveBeenCalledTimes(2);
      expect(count).toBe(8);
      expect(await service.call(run.runId,randomUUID(),{...call(),arguments:{unexpected:true}})).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});
      expect(count).toBe(8);
      const original = execute; execute = async (...args) => ({...await original(...args) as Record<string,unknown>,value:123});
      expect(await service.call(run.runId,randomUUID(),call('fresh-invalid-output'))).toMatchObject({status:'error',error:{code:'INVALID_RESPONSE'}});
      expect(count).toBe(9);
      connectionAllowed = false;
      expect(await service.call(run.runId,randomUUID(),call('revoked'))).toMatchObject({status:'error',error:{code:'AUTH_REQUIRED'}});
      connectionAllowed = true;
      const file = join(f.store.root,f.application!.relativePath,'adapter/index.cjs'), bytes = readFileSync(file);
      try {
        writeFileSync(file,'damaged after compiler warmup');
        expect(await service.call(run.runId,randomUUID(),call('damaged'))).toMatchObject({status:'error',error:{code:'HASH_MISMATCH'}});
      } finally { writeFileSync(file,bytes); }
      expect(count).toBe(9);
      expect(compile).toHaveBeenCalledTimes(2);
    } finally { compile.mockRestore(); }
  });
  it('keeps compiled constraints separate for two pinned versions of the same capability', async () => {
    const compile = vi.spyOn(AjvJsonSchemaValidator.prototype,'getValidator');
    let second: Awaited<ReturnType<typeof f.create>> | undefined;
    try {
      expect(await service.call(run.runId,randomUUID(),call('long-original'))).toMatchObject({status:'ok'});
      const source = {manifest:structuredClone(f.applicationSource!.manifest),files:{...f.applicationSource!.files}};
      source.manifest.version = '2.0.0';
      const input = JSON.parse(source.files['schemas/input.json'].toString('utf8')); input.properties.value.maxLength = 3;
      source.files['schemas/input.json'] = Buffer.from(JSON.stringify(input));
      source.manifest.files = Object.entries(source.files).map(([path,bytes]) => ({path,size:bytes.length,sha256:digest(bytes),executable:false}));
      const next = await f.packageRegistry.install(source); await f.packageRegistry.activate(next.packageHash,1);
      const snapshot = structuredClone(f.snapshot); snapshot.taskId = randomUUID();
      const selected = snapshot.packages[0]; selected.packageHash = next.packageHash; selected.version = next.version;
      for (const skill of selected.skills) {
        const declaration = source.manifest.skills.find(s => s.id === skill.skillId)!;
        skill.nativeName = applicationNativeSkillName(selected.appId,skill.skillId,next.packageHash);
        skill.contentHash = applicationSkillContentHash(source.manifest,declaration.path);
        skill.projectionPath = join(f.store.root,'sessions',snapshot.taskId,'claude/plugin/skills',skill.nativeName,'SKILL.md');
      }
      const server = applicationMcpServerName(digest(snapshot.taskId));
      for (const bridge of snapshot.mcp) if (bridge.kind === 'applications') bridge.serverName = server;
      snapshot.adapterBinding.nativeToolNames = Object.fromEntries(Object.keys(selected.toolContractMajors).map(name => [name,'mcp__' + server + '__' + name]));
      const saved = await f.sessions.create(snapshot,f.home);
      second = await f.runs.reserve({taskId:snapshot.taskId,snapshotHash:saved.pointer.snapshotHash,bindings:[]});
      await second.prepare(); await second.cli.arm();
      (f.reader as FixtureProcessReader).identities.set(200004,'darwin-proc-v1:200:4'); await second.cli.attach(200004);
      expect(await service.call(second.runId,randomUUID(),call('too-long'))).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});
      expect(await service.call(second.runId,randomUUID(),call('new'))).toMatchObject({status:'ok',value:{value:'new',packageHash:next.packageHash}});
      expect(await service.call(run.runId,randomUUID(),call('old-still-long'))).toMatchObject({status:'ok',value:{value:'old-still-long',packageHash:f.application!.packageHash}});
      expect(compile).toHaveBeenCalledTimes(4);
    } finally { if (second) await second.cli.exited(); compile.mockRestore(); }
  });
  it('rechecks every listed contract source on each request, including the nonfirst tool', async () => {
    const baseline = await service.list(run.runId), hash = f.application!.packageHash, name = 'smartdd_zentao_write_v1';
    const saved = f.sqlite.prepare('SELECT input_source,output_source FROM capability_package_contracts WHERE package_hash=? AND tool_name=?').get(hash,name) as { input_source:string;output_source:string };
    for (const column of ['input_source','output_source'] as const) {
      try {
        f.sqlite.prepare('UPDATE capability_package_contracts SET ' + column + '=? WHERE package_hash=? AND tool_name=?').run(JSON.stringify({...JSON.parse(saved[column]),description:'changed after earlier listing'}),hash,name);
        expect(await service.list(run.runId)).toEqual({tools:[],unavailable:[{appId:'zentao',code:'HASH_MISMATCH'}]});
      } finally { f.sqlite.prepare('UPDATE capability_package_contracts SET ' + column + '=? WHERE package_hash=? AND tool_name=?').run(saved[column],hash,name); }
      expect(await service.list(run.runId)).toEqual(baseline);
    }
    const row = f.sqlite.prepare('SELECT manifest_json FROM capability_packages WHERE package_hash=?').get(hash) as {manifest_json:string};
    try {
      f.sqlite.prepare('UPDATE capability_packages SET manifest_json=? WHERE package_hash=?').run(JSON.stringify({...JSON.parse(row.manifest_json),displayName:'changed after earlier listing'}),hash);
      expect(await service.list(run.runId)).toEqual({tools:[],unavailable:[{appId:'zentao',code:'HASH_MISMATCH'}]});
    } finally { f.sqlite.prepare('UPDATE capability_packages SET manifest_json=? WHERE package_hash=?').run(row.manifest_json,hash); }
    expect(await service.list(run.runId)).toEqual(baseline);
    expect(count).toBe(0);
  });
  it('keeps an excluded contract out of listing and does not read its tampered retained source', async () => {
    const reader = new FixtureProcessReader(), isolated = await runFixture(reader,{application:true,allowedOperations:['zentao.read']});
    let owned: Awaited<ReturnType<typeof isolated.create>> | undefined;
    try {
      owned=await isolated.create();await owned.prepare();await owned.cli.arm();reader.identities.set(200003,'darwin-proc-v1:200:3');await owned.cli.attach(200003);
      isolated.sqlite.prepare("UPDATE capability_package_contracts SET output_source='{}' WHERE package_hash=? AND tool_name=?").run(isolated.application!.packageHash,'smartdd_zentao_write_v1');
      const limited = new ApplicationToolService(isolated.store,isolated.runs,{resolve:()=>{throw Error('Listing must not execute');}});
      expect(await limited.list(owned.runId)).toMatchObject({tools:[{name:'smartdd_zentao_query_v1'}],unavailable:[]});
      expect((await limited.list(owned.runId)).tools).toHaveLength(1);
    } finally { if(owned)await owned.cli.exited();isolated.cleanup(); }
  });
  it('lists actual fixed package schemas and routes using host project/task/package context', async () => {
    const listed = await service.list(run.runId); expect(listed.tools.map(t => t.name)).toEqual(['smartdd_zentao_query_v1','smartdd_zentao_write_v1']); expect(listed.tools[0].annotations.readOnlyHint).toBe(true); expect(listed.unavailable).toEqual([]);
    const response = await service.call(run.runId,randomUUID(),call()); expect(response).toMatchObject({ status: 'ok',value: { packageHash: f.application!.packageHash,projectId: 'p1',taskId: f.snapshot.taskId,value: 'synthetic-body' } });
    const ledger = f.sqlite.prepare('SELECT * FROM application_invocations').all(); expect(JSON.stringify(ledger)).not.toContain('synthetic-body'); expect(ledger).toHaveLength(1);
  });
  it('preserves permitted reads when a fixed session deliberately excludes the write permission', async () => {
    const reader = new FixtureProcessReader(), isolated = await runFixture(reader,{ application: true,allowedOperations: ['zentao.read'] });
    try {
      const owned = await isolated.create(); await owned.prepare(); await owned.cli.arm(); reader.identities.set(200003,'darwin-proc-v1:200:3'); await owned.cli.attach(200003);
      const limited = new ApplicationToolService(isolated.store,isolated.runs,{ resolve: () => { throw new Error('excluded operation must never resolve'); } });
      expect((await limited.list(owned.runId)).tools.map(t => t.name)).toEqual(['smartdd_zentao_query_v1']); expect(await limited.call(owned.runId,randomUUID(),call('excluded',true))).toMatchObject({ status: 'error',error: { code: 'SCOPE_DENIED' } }); await owned.cli.exited();
    } finally { isolated.cleanup(); }
  });
  it('rejects unselected tools, mismatched contracts, spoofed scopes and invalid schema before executing', async () => {
    const unknown = { ...call(),operation: 'smartdd_other_query_v1' }; expect(await service.call(run.runId,randomUUID(),unknown)).toMatchObject({ status: 'error',error: { code: 'SCOPE_DENIED' } });
    expect(await service.call(run.runId,randomUUID(),{ ...call(),contractMajor: 2 })).toMatchObject({ status: 'error',error: { code: 'SCOPE_DENIED' } });
    expect(await service.call(run.runId,randomUUID(),{ ...call(),projectId: 'another' } as never)).toMatchObject({ status: 'error',error: { code: 'INVALID_INPUT' } });
    expect(await service.call(run.runId,randomUUID(),{ ...call(),arguments: { value: 'x',projectId: 'another' } })).toMatchObject({ status: 'error',error: { code: 'INVALID_INPUT' } }); expect(count).toBe(0); expect(f.sqlite.prepare('SELECT count(*) AS n FROM application_invocations').get()).toEqual({ n: 0 });
  });
  it('deduplicates parallel and completed identical requests, rejecting changed arguments under the same ID', async () => {
    const id = randomUUID(), original = execute; let finish!: () => void; const waiting = new Promise<void>(resolve => { finish = resolve; }); execute = async (...args) => { await waiting; return original(...args); };
    const a = service.call(run.runId,id,call()),b = service.call(run.runId,id,call()); finish(); expect(await a).toEqual(await b); expect(await service.call(run.runId,id,call())).toEqual(await a); expect(count).toBe(1);
    expect(await service.call(run.runId,id,call('changed'))).toMatchObject({ status: 'error',error: { code: 'REQUEST_CONFLICT' } }); expect(count).toBe(1);
  });
  it('never re-executes an invocation when its in-memory receipt is absent', async () => {
    const id = randomUUID(), first = await service.call(run.runId,id,call('once',true)); expect(first.status).toBe('ok'); service.clearMemory(run.runId);
    expect(await makeService().call(run.runId,id,call('once',true))).toMatchObject({ status: 'error',operationId: first.operationId,error: { code: 'REPLAY_UNAVAILABLE',effectState: 'completed' } }); expect(count).toBe(1); expect(f.sqlite.prepare('SELECT state FROM application_invocations').get()).toEqual({ state: 'succeeded' });
  });
  it('rechecks current binding even for cached responses and permits the same identity after recovery', async () => {
    const id = randomUUID(); expect((await service.call(run.runId,id,call())).status).toBe('ok'); connectionAllowed = false;
    expect(await service.call(run.runId,id,call())).toMatchObject({ status: 'error',error: { code: 'AUTH_REQUIRED' } }); connectionAllowed = true; expect((await service.call(run.runId,id,call())).status).toBe('ok'); expect(count).toBe(1);
  });
  it('allows at most two retries for an explicitly safe read, with one operation ID and unchanged scope', async () => {
    const original = execute, operations: ApplicationOperationContext[] = []; execute = async (context,args,operation) => { operations.push(operation); if (operation.attempt < 3) throw new ApplicationError('TRANSIENT_FAILURE','controlled transient'); return original(context,args,operation); };
    expect((await service.call(run.runId,randomUUID(),call())).status).toBe('ok'); expect(count).toBe(3); expect(new Set(operations.map(o => o.operationId)).size).toBe(1); expect(new Set(operations.map(o => o.deadline)).size).toBe(1); expect(f.sqlite.prepare('SELECT attempt_count,state FROM application_invocations').get()).toEqual({ attempt_count: 3,state: 'succeeded' });
  });
  it('ends exhausted safe reads and never retries explicit auth failures', async () => {
    execute = async () => { throw new ApplicationError('TRANSIENT_FAILURE','controlled failure'); };
    expect(await service.call(run.runId,randomUUID(),call())).toMatchObject({ status: 'error',error: { attemptCount: 3,retryExhausted: true,effectState: 'read-only' } }); expect(count).toBe(3);
    execute = async () => { throw new ApplicationError('AUTH_FAILED','controlled auth failure'); }; expect(await service.call(run.runId,randomUUID(),call('different'))).toMatchObject({ status: 'error',error: { code: 'AUTH_FAILED',attemptCount: 1,retryable: false } }); expect(count).toBe(4);
  });
  it('retries a busy safe read inside its original operation and deadline, then returns the recovered result', async () => {
    const original = execute, operations: ApplicationOperationContext[] = [];
    execute = async (context,args,operation) => { operations.push(operation); if (operation.attempt < 2) throw new ApplicationError('RESOURCE_BUSY','controlled source lock'); return original(context,args,operation); };
    expect(await service.call(run.runId,randomUUID(),call())).toMatchObject({ status: 'ok',value: { value: 'synthetic-body' } });
    expect(count).toBe(2); expect(new Set(operations.map(o => o.operationId)).size).toBe(1); expect(new Set(operations.map(o => o.deadline)).size).toBe(1);
    expect(f.sqlite.prepare('SELECT attempt_count,state FROM application_invocations').get()).toEqual({ attempt_count: 2,state: 'succeeded' });
  });
  it('exhausts a busy safe read after three attempts with one failed operation and no result payload', async () => {
    execute = async () => { throw new ApplicationError('RESOURCE_BUSY','controlled source lock'); };
    const response = await service.call(run.runId,randomUUID(),call());
    expect(response).toMatchObject({ status: 'error',error: { code: 'RESOURCE_BUSY',attemptCount: 3,retryable: true,retryExhausted: true,effectState: 'read-only' } }); expect(response).not.toHaveProperty('value'); expect(count).toBe(3);
    expect(f.sqlite.prepare('SELECT attempt_count,state,error_code FROM application_invocations').get()).toEqual({ attempt_count: 3,state: 'failed',error_code: 'RESOURCE_BUSY' });
  });
  it('rechecks current authorization before retrying a busy safe read', async () => {
    execute = async () => { connectionAllowed = false; throw new ApplicationError('RESOURCE_BUSY','controlled source lock'); };
    expect(await service.call(run.runId,randomUUID(),call())).toMatchObject({ status: 'error',error: { code: 'AUTH_REQUIRED',attemptCount: 1,retryable: false } }); expect(count).toBe(1);
  });
  it('cancels a busy read during backoff without another source attempt', async () => {
    const controller = new AbortController();
    execute = async () => { setTimeout(() => controller.abort(),0); throw new ApplicationError('RESOURCE_BUSY','controlled source lock'); };
    const delayed = new ApplicationToolService(f.store,f.runs,{ resolve: () => ({ semantics: 'read',retry: 'safe-read',authorize: () => undefined,execute: async (...args) => { count++; return execute(...args); } }) },{ retryDelays: [5000,5000] });
    expect(await delayed.call(run.runId,randomUUID(),call(),controller.signal)).toMatchObject({ status: 'error',error: { code: 'CANCELED',attemptCount: 1 } });
    await vi.waitFor(() => expect(f.sqlite.prepare('SELECT state FROM application_invocations').get()).toEqual({ state: 'failed' })); expect(count).toBe(1);
  });
  it('does not replay busy writes or reads whose trusted executor disallows retry', async () => {
    execute = async () => { throw new ApplicationError('RESOURCE_BUSY','controlled busy operation'); };
    expect(await service.call(run.runId,randomUUID(),call('write',true))).toMatchObject({ status: 'error',error: { code: 'RESOURCE_BUSY',attemptCount: 1,retryable: false,effectState: 'unknown' } });
    retry = 'never'; expect(await service.call(run.runId,randomUUID(),call())).toMatchObject({ status: 'error',error: { code: 'RESOURCE_BUSY',attemptCount: 1,retryExhausted: false } }); expect(count).toBe(2);
  });
  it('persists unknown before invoking a write and never retries it or leaks arbitrary thrown text', async () => {
    execute = async (_context,_args,op) => { expect(f.sqlite.prepare('SELECT effect_state,state FROM application_invocations WHERE operation_id=?').get(op.operationId)).toEqual({ effect_state: 'unknown',state: 'running' }); throw new Error('DO-NOT-LOG-SECRET'); };
    const response = await service.call(run.runId,randomUUID(),call('write',true)); expect(response).toMatchObject({ status: 'error',error: { effectState: 'unknown',retryable: false,attemptCount: 1 } }); expect(JSON.stringify(response)).not.toContain('DO-NOT-LOG-SECRET'); expect(count).toBe(1); expect(f.sqlite.prepare('SELECT state FROM application_invocations').get()).toEqual({ state: 'unknown' });
  });
  it('keeps fixed version routing after a new default is activated', async () => {
    const source = { manifest: structuredClone(f.applicationSource!.manifest),files: { ...f.applicationSource!.files } }; source.manifest.version = '2.0.0'; source.files['adapter/index.cjs'] = Buffer.from('module.exports = {version:"2"};\n'); source.manifest.files = Object.entries(source.files).map(([path,bytes]) => ({ path,size: bytes.length,sha256: digest(bytes),executable: false })); const next = await f.packageRegistry.install(source); await f.packageRegistry.activate(next.packageHash,1);
    expect(await service.call(run.runId,randomUUID(),call())).toMatchObject({ status: 'ok',value: { packageHash: f.application!.packageHash } }); expect(next.packageHash).not.toBe(f.application!.packageHash);
  });
  it('reports a damaged package without fake empty success and restores only the same original bytes', async () => {
    const file = join(f.store.root,f.application!.relativePath,'adapter/index.cjs'), bytes = readFileSync(file); writeFileSync(file,'damaged'); const unavailable = await makeService().list(run.runId); expect(unavailable.tools).toHaveLength(2); expect(unavailable.unavailable).toEqual([{ appId: 'zentao',code: 'HASH_MISMATCH' }]); expect(await service.call(run.runId,randomUUID(),call())).toMatchObject({ status: 'error',error: { code: 'HASH_MISMATCH' } }); writeFileSync(file,bytes); expect((await service.list(run.runId)).tools).toHaveLength(2);
  });
  it('does not trust corrupted saved schemas or overwrite them from a default or same-version reinstall', async () => {
    f.sqlite.prepare("UPDATE capability_package_contracts SET input_source='{}' WHERE package_hash=?").run(f.application!.packageHash);
    expect(await makeService().list(run.runId)).toEqual({ tools: [],unavailable: [{ appId: 'zentao',code: 'HASH_MISMATCH' }] });
    expect(await service.call(run.runId,randomUUID(),call())).toMatchObject({ status: 'error',error: { code: 'HASH_MISMATCH' } }); await expect(f.packageRegistry.install(f.applicationSource!)).rejects.toMatchObject({ code: 'HASH_MISMATCH' }); expect(count).toBe(0);
  });
  it('holds the activity until an executor ignoring cancellation settles and withholds its late result', async () => {
    let started!: () => void, finish!: () => void; const ready = new Promise<void>(resolve => { started = resolve; }); const original = execute;
    execute = async (...args) => { started(); await new Promise<void>(resolve => { finish = resolve; }); return original(...args); }; const result = service.call(run.runId,randomUUID(),call('write',true)); await ready; await run.cli.exited(); expect(f.runs.get(run.runId).state).toBe('stopping'); finish(); expect(await result).toMatchObject({ status: 'error',error: { effectState: 'unknown' } }); await vi.waitFor(() => expect(f.runs.get(run.runId).state).toBe('stopped'));
  });
  it('returns a bounded timeout receipt while keeping an ignoring write executor protected until real settlement', async () => {
    let finish!: () => void; const original = execute;
    const timed = new ApplicationToolService(f.store,f.runs,{ resolve: () => ({ semantics: 'write',retry: 'never',timeoutMs: 100,authorize: () => undefined,execute: async (...args) => { await new Promise<void>(resolve => { finish = resolve; }); return original(...args); } }) });
    const response = await timed.call(run.runId,randomUUID(),call('slow-write',true)); expect(response).toMatchObject({ status: 'error',error: { code: 'TIMEOUT',effectState: 'unknown',attemptCount: 1 } });
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM capability_run_activities WHERE state='active'").get()).toEqual({ n: 1 }); await run.cli.exited(); expect(f.runs.get(run.runId).state).toBe('stopping'); finish(); await vi.waitFor(() => expect(f.runs.get(run.runId).state).toBe('stopped'));
    expect(f.sqlite.prepare('SELECT state,effect_state FROM application_invocations').get()).toEqual({ state: 'unknown',effect_state: 'unknown' });
  });
  it('rejects invalid outputs and bounds recursive structures before hashing them', async () => {
    execute = async () => ({ wrong: true }); expect(await service.call(run.runId,randomUUID(),call())).toMatchObject({ status: 'error',error: { code: 'INVALID_RESPONSE' } }); let deep: unknown = null; for (let i = 0; i < 100; i++) deep = { value: deep }; expect(boundedJson(deep)).toBe(false); expect(boundedJson(JSON.parse('{"__proto__":{}}'))).toBe(false);
  });
});


describe('asynchronous current authorization for cached business receipts',()=>{
 it('awaits the real receipt check and never returns its old payload after asynchronous denial',async()=>{
  const host={resolve:()=>({semantics:'read' as const,retry:'never' as const,authorize:()=>{},execute,authorizeReceipt:async()=>{await Promise.resolve();throw new ApplicationError('SCOPE_DENIED','current object no longer assigned');}})};
  const current=new ApplicationToolService(f.store,f.runs,host),id=randomUUID(),first=await current.call(run.runId,id,call());expect(first.status).toBe('ok');
  expect(await current.call(run.runId,id,call())).toMatchObject({status:'error',operationId:first.operationId,error:{code:'SCOPE_DENIED',effectState:'read-only',attemptCount:1}});expect(f.sqlite.prepare('SELECT count(*) n FROM application_invocations').get()).toEqual({n:1});
 });
 it.each([false,true])('keeps the owned activity until an ignoring receipt checker settles with write=%s and never replays its effect',async(write)=>{
  let release!:()=>void,entered!:()=>void,checking=false;const ready=new Promise<void>(r=>entered=r);
  const current=new ApplicationToolService(f.store,f.runs,{resolve:()=>({semantics:write?'write':'read',retry:'never',timeoutMs:checking?80:5000,authorize:()=>{},execute,authorizeReceipt:async()=>{entered();await new Promise<void>(r=>release=r);}})}),id=randomUUID();
  const input=call('cached original',write),first=await current.call(run.runId,id,input);expect(first.status).toBe('ok');checking=true;const cached=current.call(run.runId,id,input);await ready;
  try{expect(await cached).toMatchObject({status:'error',operationId:first.operationId,error:{code:'TIMEOUT',attemptCount:1,effectState:write?'completed':'read-only',retryable:!write}});expect(f.sqlite.prepare('SELECT count(*) n FROM application_invocations').get()).toEqual({n:1});await run.cli.exited();expect(f.runs.get(run.runId).state).toBe('stopping');}
  finally{release();}await vi.waitFor(()=>expect(f.runs.get(run.runId).state).toBe('stopped'));
 });
});
