import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import type {CapabilitySessionSnapshot} from '@shared/application-session';
import {cliFixture} from './cli-fixture';

/** M11 R1.0 S4: pre-R1.0 sessions become library sessions on resume, never while running and never under another identity. */
let f:Awaited<ReturnType<typeof cliFixture>>;
const library=(base:CapabilitySessionSnapshot,hash:string):CapabilitySessionSnapshot=>{
 const adapter=f.installedAdapters.find(a=>a.metadata.agentId==='codex'&&a.metadata.version==='1.4.0')!;
 return{...base,schema:3,catalogGeneration:'library',adapterBinding:{...base.adapterBinding,version:'1.4.0',hash:adapter.hash},standardSkills:[],packages:(base.schema===3?base.packages:[]).map(p=>({...p,skills:[]})),createdAt:new Date().toISOString(),...(hash?{}:{})} as CapabilitySessionSnapshot;
};
beforeEach(async()=>{f=await cliFixture();});
afterEach(async()=>{await f?.cleanup();});

describe('M11 R1.0 S4 session adoption',()=>{
 it('refuses while a run of the task is live, then adopts after it stops, keeping the native identity',async()=>{
  const before=await f.sessions.get(f.snapshot.taskId),next=library(before.snapshot,'');
  await expect(f.sessions.adoptLibrary(f.snapshot.taskId,before.pointer.snapshotHash,next)).rejects.toMatchObject({code:'RESOURCE_BUSY'});
  await f.run.cli.exited();
  const adopted=await f.sessions.adoptLibrary(f.snapshot.taskId,before.pointer.snapshotHash,next);
  expect(adopted.snapshot.adapterBinding.version).toBe('1.4.0');expect(adopted.snapshot.native).toEqual(before.snapshot.native);expect(adopted.pointer.snapshotHash).not.toBe(before.pointer.snapshotHash);
  expect((await f.sessions.references(f.snapshot.taskId)).some(r=>r.refKind==='agent-adapter'&&r.refHash===next.adapterBinding.hash)).toBe(true);
  await expect(f.sessions.adoptLibrary(f.snapshot.taskId,before.pointer.snapshotHash,next)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});
 });
 it('refuses another native identity or project',async()=>{
  await f.run.cli.exited();const before=await f.sessions.get(f.snapshot.taskId),next=library(before.snapshot,'');
  await expect(f.sessions.adoptLibrary(f.snapshot.taskId,before.pointer.snapshotHash,{...next,native:{...next.native,cwd:next.native.cwd+'-other'}})).rejects.toMatchObject({code:'NATIVE_IDENTITY_CONFLICT'});
  await expect(f.sessions.adoptLibrary(f.snapshot.taskId,before.pointer.snapshotHash,{...next,projectId:'p2'})).rejects.toMatchObject({code:'NATIVE_IDENTITY_CONFLICT'});
  expect((await f.sessions.get(f.snapshot.taskId)).pointer).toEqual(before.pointer);
 });
});
