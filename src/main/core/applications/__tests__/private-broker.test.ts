import {ApplicationError} from '@shared/applications';
import {BridgeSupervisor} from '../bridge-supervisor';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_LIMITS, type BridgeBootstrap, type BridgeResponse } from '@shared/application-bridge';
import { ApplicationToolService } from '../tool-service';
import { PrivateApplicationBroker } from '../private-broker';
import { ApplicationBridgeClient, consumeBridgeBootstrap } from '../bridge-client';
import { FixtureProcessReader, runFixture } from './run-fixture';
let f: Awaited<ReturnType<typeof runFixture>>, broker: PrivateApplicationBroker, run: Awaited<ReturnType<typeof f.create>>, time: number, count: number, onInvoke: (() => void) | undefined;
let ticketTtlMs:number|undefined;
let disconnected: ReturnType<typeof vi.fn<(runId:string,bridgeId:string)=>void>>;
const peers = new Set<Socket>();
async function peer(endpoint: string) {
  const socket = connect(endpoint); peers.add(socket); let buffer = ''; const waiting = new Map<string,{ resolve(value: BridgeResponse): void;reject(error: Error): void;timer: ReturnType<typeof setTimeout> }>();
  socket.on('error',() => undefined); socket.on('close',() => { peers.delete(socket); for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error('private fixture socket closed')); } waiting.clear(); });
  socket.on('data',data => { buffer += data.toString(); while (buffer.includes('\n')) { const end = buffer.indexOf('\n'), response = JSON.parse(buffer.slice(0,end)) as BridgeResponse; buffer = buffer.slice(end + 1); const pending = waiting.get(response.id); if (pending) { waiting.delete(response.id); clearTimeout(pending.timer); pending.resolve(response); } } }); await once(socket,'connect');
  return { socket,send: (data: Record<string,unknown>) => { const id = typeof data.id === 'string' ? data.id : randomUUID(); return new Promise<BridgeResponse>((resolve,reject) => { const timer = setTimeout(() => { waiting.delete(id); reject(new Error('private fixture response deadline')); },2000); waiting.set(id,{ resolve,reject,timer }); socket.write(JSON.stringify({ ...data,id }) + '\n'); }); } };
}
async function ticket() { const ticket = await broker.prepare(run,f.snapshot.mcp[0].serverName); await ticket.bridge.arm(); return { ...ticket,data: JSON.parse(readFileSync(ticket.bootstrapPath,'utf8')) as BridgeBootstrap }; }
const exchange = (data: BridgeBootstrap) => ({ schema: 1,method: 'exchange',runId: data.runId,bridgeId: data.bridgeId,secret: data.secret });
const valueToken = (response: BridgeResponse) => { expect(response.status).toBe('ok'); return (response as Extract<BridgeResponse,{ status: 'ok' }>).value as { token: string;hostGeneration: string }; };
describe.skipIf(process.platform !== 'darwin')('private Unix broker credentials, one-use files and request boundaries', () => {
  beforeEach(async () => { time = Date.now(); count = 0; ticketTtlMs=undefined; disconnected=vi.fn(); onInvoke = undefined; const reader = new FixtureProcessReader(); f = await runFixture(reader,{ application: true }); run = await f.create(); await run.prepare(); await run.cli.arm(); reader.identities.set(200001,'darwin-proc-v1:200:1'); await run.cli.attach(200001);
    const tools = new ApplicationToolService(f.store,f.runs,{ resolve: (_hash,name) => ({ semantics: name.includes('_write_') ? 'write' : 'read',retry: 'never',authorize: () => undefined,execute: async (ctx,args,op) => { count++; onInvoke?.(); return { value: String(args.value),packageHash: op.packageHash,projectId: ctx.run.projectId,taskId: ctx.run.taskId,operationId: op.operationId }; } }) }); broker = new PrivateApplicationBroker(f.runs,tools,{ now: () => time, disconnected, get ticketTtlMs(){return ticketTtlMs;} }); await broker.start(); f.setRevoke(() => broker.revokeRun(run.runId)); });
  afterEach(async () => { for (const socket of peers) socket.destroy(); await broker.close(); f.cleanup(); });
  it('persists redacted broker denials with only server-owned scope and a response audit reference',async()=>{
    const prepared=await ticket(),owned=await peer(broker.endpoint),token=valueToken(await owned.send(exchange(prepared.data))).token;
    const forgedProject=randomUUID(),canary='RAW_ARGUMENT_SECRET_MUST_NOT_PERSIST';
    const denied=await owned.send({schema:1,method:'tools/call',token,projectId:forgedProject,call:{operation:'smartdd_zentao_query_v1',contractMajor:1,connectionId:null,arguments:{value:canary}}});
    expect(denied).toMatchObject({status:'error',auditId:expect.any(String)});
    const external=await peer(broker.endpoint),untrusted=await external.send({schema:1,method:'tools/list',token:'f'.repeat(64)});
    expect(untrusted).toMatchObject({status:'error',auditId:expect.any(String)});
    const rows=f.sqlite.prepare('SELECT * FROM capability_broker_denials ORDER BY rowid').all();
    expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({run_id:run.runId,bridge_id:prepared.bridge.processId,method:'tools/call',error_code:'INVALID_INPUT'});expect(rows[1]).toMatchObject({run_id:null,bridge_id:null,method:'tools/list',error_code:'AUTH_REQUIRED'});
    for(const value of [token,'f'.repeat(64),canary,forgedProject])expect(JSON.stringify(rows)).not.toContain(value);
    expect(count).toBe(0);await broker.close();expect(f.sqlite.prepare('SELECT count(*) n FROM capability_broker_denials').get()).toEqual({n:2});
  });
  it('keeps refusing unauthenticated requests when denial storage fails and reports the missing audit',async()=>{
    f.sqlite.exec('CREATE TEMP VIEW capability_broker_denials AS SELECT * FROM main.capability_broker_denials');
    try{
      const client=await peer(broker.endpoint),response=await client.send({schema:1,method:'tools/list',token:'f'.repeat(64)});
      expect(response).toMatchObject({status:'error',auditUnavailable:true,error:{code:'AUTH_REQUIRED'}});expect(response).not.toHaveProperty('auditId');expect(count).toBe(0);
    }finally{f.sqlite.exec('DROP VIEW temp.capability_broker_denials');}
    const fresh=await peer(broker.endpoint);expect(await fresh.send({schema:1,method:'tools/list',token:'e'.repeat(64)})).toMatchObject({status:'error',auditId:expect.any(String)});expect(f.sqlite.prepare('SELECT count(*) n FROM capability_broker_denials').get()).toEqual({n:1});
  });
  it('waits for the exact replacement instance and ends its waiter on cancellation',async()=>{
    const first=await ticket(),second=await ticket(),controller=new AbortController();
    let settled=false;const waiting=broker.waitForAuthentication(run.runId,second.bridge.processId,controller.signal).then(value=>{settled=true;return value;});
    const client=await peer(broker.endpoint);valueToken(await client.send(exchange(first.data)));
    expect(settled).toBe(false);
    controller.abort();expect(await waiting).toBe(false);
    expect(await broker.waitForAuthentication(run.runId,first.bridge.processId,new AbortController().signal)).toBe(true);
    await first.bridge.exited();await second.bridge.exited();
  });
  it('resolves only a newly authenticated replacement and releases waiters on host close',async()=>{
    const first=await ticket(),second=await ticket();
    const waiting=broker.waitForAuthentication(run.runId,first.bridge.processId,new AbortController().signal);
    const closing=broker.waitForAuthentication(run.runId,second.bridge.processId,new AbortController().signal);
    const client=await peer(broker.endpoint);valueToken(await client.send(exchange(first.data)));
    expect(await waiting).toBe(true);
    await broker.close();expect(await closing).toBe(false);
    await first.bridge.exited();await second.bridge.exited();
  });
  it('expires an unconsumed ticket without a client request and releases only its reserved window',async()=>{
    ticketTtlMs=30;const prepared=await broker.prepare(run,f.snapshot.mcp[0].serverName);
    expect(existsSync(prepared.bootstrapPath)).toBe(true);
    await vi.waitFor(()=>expect(existsSync(prepared.bootstrapPath)).toBe(false));
    await vi.waitFor(()=>expect(f.sqlite.prepare('SELECT state FROM capability_run_processes WHERE process_id=?').get(prepared.bridge.processId)).toEqual({state:'canceled'}));
    expect(f.runs.get(run.runId).state).toBe('active');
  });
  it('expires an armed ticket without fabricating a native child exit',async()=>{
    ticketTtlMs=30;const prepared=await ticket();
    await vi.waitFor(()=>expect(existsSync(prepared.bootstrapPath)).toBe(false));
    expect(f.sqlite.prepare('SELECT state FROM capability_run_processes WHERE process_id=?').get(prepared.bridge.processId)).toEqual({state:'armed'});
    await prepared.bridge.exited();
  });
  it('cancels only its owned unconsumed ticket and leaves a later instance usable', async () => {
    const first=await broker.prepare(run,f.snapshot.mcp[0].serverName),second=await ticket();
    const old=JSON.parse(readFileSync(first.bootstrapPath,'utf8')) as BridgeBootstrap;
    await first.cancel();
    expect(existsSync(first.bootstrapPath)).toBe(false);
    expect(existsSync(second.bootstrapPath)).toBe(true);
    const client=await peer(broker.endpoint);
    expect(await client.send(exchange(old))).toMatchObject({status:'error'});
    valueToken(await client.send(exchange(second.data)));
    expect(broker.hasAuthenticated(run.runId)).toBe(true);
    await second.bridge.exited();
  });
  it('coordinates a controlled replacement through a fresh broker ticket without replaying business', async () => {
    const supervisor=new BridgeSupervisor(),server=f.snapshot.mcp[0].serverName;
    let replacement:Awaited<ReturnType<typeof ticket>>|undefined;
    supervisor.register(run.runId,server,{capability:'supported',evidence:'controlled adapter plus real Unix socket, not native CLI evidence',validate:async()=>{f.runs.bridgePreparation(run.runId);},replace:async attempt=>{
      replacement=await ticket();
      if(attempt.signal.aborted){await replacement.cancel();return false;}
      const client=await peer(broker.endpoint);valueToken(await client.send(exchange(replacement.data)));
      return broker.hasAuthenticated(run.runId);
    }});
    expect(await supervisor.prepareReplacement(run.runId,server,0)).toMatchObject({code:'CONNECTED',attempts:1});
    expect(count).toBe(0);
    expect(existsSync(replacement!.bootstrapPath)).toBe(false);
    expect(f.runs.get(run.runId).state).toBe('active');
    await replacement!.bridge.exited();
  });
  it('reports only authenticated bridge loss with the host-bound run and instance', async () => {
    const unknown=await peer(broker.endpoint);unknown.socket.destroy();
    await new Promise<void>(resolve=>setImmediate(resolve));
    expect(disconnected).not.toHaveBeenCalled();
    const prepared=await ticket(),client=await peer(broker.endpoint);
    valueToken(await client.send(exchange(prepared.data)));
    expect(broker.hasAuthenticated(run.runId)).toBe(true);
    client.socket.destroy();
    await vi.waitFor(()=>expect(disconnected).toHaveBeenCalledExactlyOnceWith(run.runId,prepared.bridge.processId));
    expect(broker.hasAuthenticated(run.runId)).toBe(false);
    expect(f.runs.get(run.runId).state).toBe('active');
    await prepared.bridge.exited();
  });
  it('classifies malformed JSON as an input failure without leaking it or losing the next authorized request',async()=>{
    const prepared=await ticket(),connection=await peer(broker.endpoint);
    expect(await connection.send({schema:1,method:'tools/list',token:'0'.repeat(64)})).toMatchObject({status:'error',error:{code:'AUTH_REQUIRED'}});
    const token=valueToken(await connection.send(exchange(prepared.data))).token;
    const lines=createInterface({input:connection.socket});
    try{
      const response=once(lines,'line',{signal:AbortSignal.timeout(2000)});
      connection.socket.write('{"private":"malformed-input-canary",\n');
      const error=JSON.parse(String((await response)[0]));
      expect(error).toMatchObject({schema:1,status:'error',error:{code:'INVALID_INPUT',layer:'bridge',effectState:'not-started',retryable:false}});
      expect(JSON.stringify(error)).not.toContain('malformed-input-canary');expect(count).toBe(0);
      expect(await connection.send({schema:1,method:'tools/call',token,call:{operation:'smartdd_zentao_query_v1',contractMajor:1,connectionId:null,arguments:{value:'after-invalid-json'}}})).toMatchObject({status:'ok',value:{value:'after-invalid-json',packageHash:f.application!.packageHash,projectId:'p1'}});
      expect(count).toBe(1);
    }finally{lines.close();}
  });
  it('rejects invalid method,missing and mistyped fields without invoking the adapter or revoking a valid socket',async()=>{
    const prepared=await ticket(),connection=await peer(broker.endpoint),token=valueToken(await connection.send(exchange(prepared.data))).token;
    for(const request of [{schema:1,method:'not-declared',token},{schema:1,method:'tools/call',token},{schema:1,method:'tools/list',token:12},{schema:1,method:'tools/list',token,approved:true},{schema:1,method:'tools/list',token,callerKind:'ui'}]){
      expect(await connection.send(request)).toMatchObject({status:'error',error:{code:'INVALID_INPUT',effectState:'not-started'}});expect(count).toBe(0);
    }
    expect(await connection.send({schema:1,method:'tools/list',token})).toMatchObject({status:'ok',value:{tools:expect.any(Array)}});expect(count).toBe(0);
  });
  it.each([false,true])('bounds an oversized request with newline=%s and keeps another authenticated socket usable',async newline=>{
    const rejected=await peer(broker.endpoint),rejectedToken=valueToken(await rejected.send(exchange((await ticket()).data))).token;
    const healthy=await peer(broker.endpoint),token=valueToken(await healthy.send(exchange((await ticket()).data))).token;
    const oversized=JSON.stringify({schema:1,id:randomUUID(),method:'tools/call',token:rejectedToken,call:{operation:'smartdd_zentao_query_v1',contractMajor:1,connectionId:null,arguments:{value:'x'.repeat(BRIDGE_LIMITS.requestBytes)}}});
    rejected.socket.write(oversized+(newline?'\n':''));
    await vi.waitFor(()=>expect(rejected.socket.destroyed).toBe(true),{timeout:2000});expect(count).toBe(0);
    const denials=f.sqlite.prepare('SELECT run_id,method,error_code FROM capability_broker_denials').all();expect(denials).toEqual([{run_id:run.runId,method:'unknown',error_code:'TOO_LARGE'}]);
    expect(JSON.stringify(f.sqlite.prepare('SELECT * FROM capability_broker_denials').all())).not.toContain(rejectedToken);
    expect(await healthy.send({schema:1,method:'tools/call',token,call:{operation:'smartdd_zentao_query_v1',contractMajor:1,connectionId:null,arguments:{value:'after-oversized-request'}}})).toMatchObject({status:'ok',value:{value:'after-oversized-request',projectId:'p1'}});expect(count).toBe(1);
  });
  it('allows one asynchronous peer claim and rejects concurrent use of its same ticket',async()=>{
    await broker.close();let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(done=>entered=done),gate=new Promise<void>(done=>release=done);let attempts=0;broker=new PrivateApplicationBroker(f.runs,new ApplicationToolService(f.store,f.runs,{resolve:()=>{throw new Error('unused');}}),{now:()=>time,attachPeer:async()=>{attempts++;entered();await gate;}});await broker.start();const prepared=await ticket(),a=await peer(broker.endpoint),b=await peer(broker.endpoint),first=a.send(exchange(prepared.data));await ready;
    try{expect(await b.send(exchange(prepared.data))).toMatchObject({status:'error',error:{code:'AUTH_REQUIRED'}});expect(attempts).toBe(1);}finally{release();}expect(valueToken(await first).token).toMatch(/^[a-f0-9]{64}$/);expect(attempts).toBe(1);
  });
  it('rejects a canceled replacement after late peer attachment without revoking a sibling ticket',async()=>{
    await broker.close();let entered!:()=>void,release!:()=>void;
    const ready=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve),rejected=vi.fn();
    broker=new PrivateApplicationBroker(f.runs,new ApplicationToolService(f.store,f.runs,{resolve:()=>{throw Error('unused');}}),{now:()=>time,attachPeer:async()=>{entered();await gate;},rejectedReplacement:rejected});
    await broker.start();const first=await ticket(),sibling=await ticket(),client=await peer(broker.endpoint);
    const waiting=broker.waitForAuthentication(run.runId,first.bridge.processId,new AbortController().signal),response=client.send(exchange(first.data));await ready;
    try{await expect(first.cancel()).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});expect(await waiting).toBe(false);expect(existsSync(sibling.bootstrapPath)).toBe(true);}finally{release();}
    expect(await response).toMatchObject({status:'error',error:{code:'AUTH_REQUIRED'}});
    expect(rejected).toHaveBeenCalledExactlyOnceWith(run.runId,first.bridge.processId);
    const healthy=await peer(broker.endpoint);valueToken(await healthy.send(exchange(sibling.data)));
    expect(broker.hasAuthenticated(run.runId)).toBe(true);expect(f.runs.get(run.runId).state).toBe('active');
    await first.bridge.exited();await sibling.bridge.exited();
  });
  it('denies a recovery token when application authorization is revoked during peer validation',async()=>{
    await broker.close();let entered!:()=>void,release!:()=>void,authorized=true;
    const ready=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve),rejected=vi.fn();
    broker=new PrivateApplicationBroker(f.runs,new ApplicationToolService(f.store,f.runs,{resolve:()=>{throw Error('unused');}}),{attachPeer:async()=>{entered();await gate;},rejectedReplacement:rejected});await broker.start();
    const prepared=await broker.prepare(run,f.snapshot.mcp[0].serverName,()=>{if(!authorized)throw new ApplicationError('SCOPE_DENIED','fixture policy revoked');});await prepared.bridge.arm();
    const data=JSON.parse(readFileSync(prepared.bootstrapPath,'utf8')) as BridgeBootstrap,client=await peer(broker.endpoint),waiting=broker.waitForAuthentication(run.runId,prepared.bridge.processId,new AbortController().signal),response=client.send(exchange(data));
    await ready;authorized=false;release();
    try{
      expect(await response).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});
      expect(await waiting).toBe(false);expect(broker.hasAuthenticated(run.runId)).toBe(false);
      expect(rejected).toHaveBeenCalledExactlyOnceWith(run.runId,prepared.bridge.processId);
      expect(f.runs.get(run.runId).state).toBe('active');
    }finally{await prepared.bridge.exited();}
  });
  it('rechecks recovery policy after asynchronous authentication diagnostics before returning a token',async()=>{
    await broker.close();let authorized=true;
    broker=new PrivateApplicationBroker(f.runs,new ApplicationToolService(f.store,f.runs,{resolve:()=>{throw Error('unused');}}),{attachPeer:async()=>{},authenticated:async()=>{authorized=false;}});await broker.start();
    const prepared=await broker.prepare(run,f.snapshot.mcp[0].serverName,()=>{if(!authorized)throw new ApplicationError('SCOPE_DENIED','revoked during diagnostic');});await prepared.bridge.arm();
    const waiting=broker.waitForAuthentication(run.runId,prepared.bridge.processId,new AbortController().signal),client=await peer(broker.endpoint),data=JSON.parse(readFileSync(prepared.bootstrapPath,'utf8')) as BridgeBootstrap;
    expect(await client.send(exchange(data))).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});expect(await waiting).toBe(false);expect(broker.hasAuthenticated(run.runId)).toBe(false);await prepared.bridge.exited();
  });
  it('does not revive a recovery credential after policy revocation and later reenablement',async()=>{
    let authorized=true;const prepared=await broker.prepare(run,f.snapshot.mcp[0].serverName,()=>{if(!authorized)throw new ApplicationError('SCOPE_DENIED','revoked');});await prepared.bridge.arm();
    const client=await peer(broker.endpoint),data=JSON.parse(readFileSync(prepared.bootstrapPath,'utf8')) as BridgeBootstrap,token=valueToken(await client.send(exchange(data))).token;
    authorized=false;expect(await client.send({schema:1,method:'tools/list',token})).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});
    authorized=true;expect(await client.send({schema:1,method:'tools/list',token})).toMatchObject({status:'error',error:{code:'AUTH_REQUIRED'}});
    expect(f.runs.get(run.runId).state).toBe('active');await prepared.bridge.exited();
  });
  it('does not issue credentials when the run is revoked while a peer identity probe is awaiting completion',async()=>{
    await broker.close();let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(done=>entered=done),gate=new Promise<void>(done=>release=done);broker=new PrivateApplicationBroker(f.runs,new ApplicationToolService(f.store,f.runs,{resolve:()=>{throw new Error('unused');}}),{now:()=>time,attachPeer:async()=>{entered();await gate;}});await broker.start();const prepared=await ticket(),a=await peer(broker.endpoint),first=a.send(exchange(prepared.data));await ready;try{await run.stop();}finally{release();}expect(await first).toMatchObject({status:'error',error:{code:'AUTH_REQUIRED'}});
  });
  it('creates a short 0700 endpoint root and 0600 socket/bootstrap, consuming a ticket exactly once', async () => {
    const prepared = await ticket(), connection = await peer(broker.endpoint); expect(Buffer.byteLength(broker.endpoint)).toBeLessThan(100); expect(lstatSync(join(broker.endpoint,'..')).mode & 0o777).toBe(0o700); expect(lstatSync(broker.endpoint).mode & 0o777).toBe(0o600); expect(lstatSync(prepared.bootstrapPath).mode & 0o777).toBe(0o600);
    const credential = valueToken(await connection.send(exchange(prepared.data))); expect(credential.token).toMatch(/^[a-f0-9]{64}$/); expect(existsSync(prepared.bootstrapPath)).toBe(false);
    const other = await peer(broker.endpoint); expect(await other.send(exchange(prepared.data))).toMatchObject({ status: 'error',error: { code: 'AUTH_REQUIRED' } });
    expect(await connection.send({ schema: 1,method: 'tools/list',token: credential.token })).toMatchObject({ status: 'ok',value: { tools: [{ name: 'smartdd_zentao_query_v1' },{ name: 'smartdd_zentao_write_v1' }] } });
    expect(JSON.stringify(f.sqlite.prepare('SELECT * FROM application_invocations').all())).not.toContain(credential.token);
  });
  it('keeps tokens bound to their authenticated socket and rejects scope fields or forged run IDs', async () => {
    const prepared = await ticket(), a = await peer(broker.endpoint), token = valueToken(await a.send(exchange(prepared.data))).token, b = await peer(broker.endpoint);
    expect(await b.send({ schema: 1,method: 'tools/list',token })).toMatchObject({ status: 'error',error: { code: 'AUTH_REQUIRED' } });
    expect(await a.send({ schema: 1,method: 'tools/call',token,projectId: 'another',call: { operation: 'smartdd_zentao_query_v1',contractMajor: 1,connectionId: null,arguments: { value: 'x' } } })).toMatchObject({ status: 'error',error: { code: 'INVALID_INPUT' } });
    expect(await a.send({ schema: 1,method: 'tools/call',token,call: { operation: 'smartdd_zentao_query_v1',contractMajor: 1,connectionId: null,arguments: { value: 'x',projectId: 'another' } } })).toMatchObject({ status: 'error',error: { code: 'INVALID_INPUT' } }); expect(count).toBe(0);
    expect(await a.send({ schema: 1,method: 'tools/list',token })).toMatchObject({ status: 'ok' });
  });
  it('rotates credentials without accepting the old token and expires unrenewed credentials', async () => {
    const prepared = await ticket(), a = await peer(broker.endpoint), first = valueToken(await a.send(exchange(prepared.data))).token;
    const second = valueToken(await a.send({ schema: 1,method: 'renew',token: first })).token; expect(second).not.toBe(first);
    expect(await a.send({ schema: 1,method: 'tools/list',token: second })).toMatchObject({ status: 'ok' }); time += 900001; expect(await a.send({ schema: 1,method: 'tools/list',token: second })).toMatchObject({ status: 'error',error: { code: 'AUTH_REQUIRED' } });
    const next = await ticket(), b = await peer(broker.endpoint); valueToken(await b.send(exchange(next.data))); expect(await b.send({ schema: 1,method: 'tools/list',token: first })).toMatchObject({ status: 'error',error: { code: 'AUTH_REQUIRED' } });
  });
  it('withholds expired delivery without misreporting a completed write as never started', async () => {
    const prepared = await ticket(), a = await peer(broker.endpoint), token = valueToken(await a.send(exchange(prepared.data))).token;
    onInvoke = () => { time += 900001; };
    const response = await a.send({ schema: 1,method: 'tools/call',token,call: { operation: 'smartdd_zentao_write_v1',contractMajor: 1,connectionId: null,arguments: { value: 'completed-but-not-delivered' } } });
    expect(response).toMatchObject({ status: 'error',error: { code: 'AUTH_REQUIRED',effectState: 'completed' } }); expect(response.operationId).toBeTruthy(); expect(JSON.stringify(response)).not.toContain('completed-but-not-delivered'); expect(count).toBe(1); expect(f.sqlite.prepare('SELECT state,effect_state FROM application_invocations').get()).toEqual({ state: 'succeeded',effect_state: 'completed' });
  });
  it('rejects an expired ticket and a ticket for a bridge that was never armed', async () => {
    const prepared = await ticket(); time += 30001; const a = await peer(broker.endpoint); expect(await a.send(exchange(prepared.data))).toMatchObject({ status: 'error',error: { code: 'AUTH_REQUIRED' } });
    const unarmed = await broker.prepare(run,f.snapshot.mcp[0].serverName), data = JSON.parse(readFileSync(unarmed.bootstrapPath,'utf8')) as BridgeBootstrap, b = await peer(broker.endpoint); expect(await b.send(exchange(data))).toMatchObject({ status: 'error',error: { code: 'SCOPE_DENIED' } }); expect(count).toBe(0);
  });
  it('the actual client consumes its one-use file, renews and returns structured results without storing credentials', async () => {
    const prepared = await ticket(), data = consumeBridgeBootstrap(prepared.bootstrapPath); expect(existsSync(prepared.bootstrapPath)).toBe(false); const client = new ApplicationBridgeClient(data);
    try { await client.start(); await Promise.all([client.renew(),client.renew()]); const response = await client.request('tools/call',{ operation: 'smartdd_zentao_query_v1',contractMajor: 1,connectionId: null,arguments: { value: 'controlled-value' } }); expect(response).toMatchObject({ status: 'ok',value: { value: 'controlled-value',projectId: 'p1',taskId: f.snapshot.taskId,packageHash: f.application!.packageHash } }); expect(count).toBe(1); const ledger = JSON.stringify(f.sqlite.prepare('SELECT * FROM application_invocations').all()); expect(ledger).not.toContain(data.secret); expect(ledger).not.toContain('controlled-value'); }
    finally { client.close(); }
  });
  it('rejects linked or over-permissioned bootstrap files without deleting other content', async () => {
    const prepared = await ticket(), original = readFileSync(prepared.bootstrapPath); chmodSync(prepared.bootstrapPath,0o644); expect(() => consumeBridgeBootstrap(prepared.bootstrapPath)).toThrow(); expect(existsSync(prepared.bootstrapPath)).toBe(true); chmodSync(prepared.bootstrapPath,0o600);
    const other = join(f.root,'foreign-data.json'); writeFileSync(other,original,{ mode: 0o600 }); unlinkSync(prepared.bootstrapPath); symlinkSync(other,prepared.bootstrapPath); expect(() => consumeBridgeBootstrap(prepared.bootstrapPath)).toThrow(); expect(readFileSync(other)).toEqual(original); unlinkSync(prepared.bootstrapPath);
  });
  it('invalidates old credentials immediately on host stop and on a different broker generation', async () => {
    const prepared = await ticket(), a = await peer(broker.endpoint), credential = valueToken(await a.send(exchange(prepared.data))), closed = once(a.socket,'close'); await run.stop(); await closed; expect(f.runs.get(run.runId).state).toBe('stopping');
    const tools = new ApplicationToolService(f.store,f.runs,{ resolve: () => { throw new Error('must not resolve stale run'); } }), next = new PrivateApplicationBroker(f.runs,tools); await next.start();
    try { expect(next.hostGeneration).not.toBe(credential.hostGeneration); const b = await peer(next.endpoint); expect(await b.send({ schema: 1,method: 'tools/list',token: credential.token })).toMatchObject({ status: 'error',error: { code: 'AUTH_REQUIRED' } }); } finally { await next.close(); }
  });
  it('cancels only a request on the authenticated connection and does not equate request with external rollback', async () => {
    const prepared = await ticket(), a = await peer(broker.endpoint), token = valueToken(await a.send(exchange(prepared.data))).token;
    expect(await a.send({ schema: 1,method: 'cancel',token,targetId: randomUUID() })).toMatchObject({ status: 'ok',value: { cancellationRequested: false } }); expect(count).toBe(0);
  });
});
