import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapabilitySessionSnapshotV2 } from '@shared/application-session';
import type { SpawnOptions } from '../../pty-manager';
import * as schema from '../../db/schema';
import { SecretsStore } from '../../secrets';
import { ProjectService } from '../projects/project-service';
import { AiProfileService } from '../ai/ai-profile-service';
import { CapabilityService } from '../capabilities/capability-service';
import { CapabilityRunRegistry } from '../applications/run-registry';
import { DiscoveryCatalog } from '../applications/discovery-catalog';
import { agentFixture } from '../applications/__tests__/agent-fixture';
import { FixtureProcessReader } from '../applications/__tests__/run-fixture';
import { TaskService, type PtyHost } from './task-service';
import type { TaskCapabilityLaunch, TaskCapabilityLauncher } from './capability-lifecycle';
let f:Awaited<ReturnType<typeof agentFixture>>,svc:TaskService,capabilities:CapabilityService,projects:ProjectService,profiles:AiProfileService,reader:FixtureProcessReader,runs:CapabilityRunRegistry,catalog:DiscoveryCatalog,ptys:ControlledPtys;
let projectId:string,profileId:string,clock:number,gate:(()=>Promise<void>)|undefined,afterAttach:(()=>Promise<void>)|undefined,bindGate:(()=>Promise<void>)|undefined,calls:number;
const pending=new Set<Promise<unknown>>();
const trace:string[]=[];
const runIds:string[]=[];
const boundIds:string[]=[];
class ControlledPtys extends EventEmitter implements PtyHost {
  readonly live=new Map<string,number>();readonly launches:SpawnOptions[]=[];
  immediateExit=false;fail=false;
  spawn(opts:SpawnOptions):string{if(this.fail)throw new Error('controlled native fork failure');const id=opts.id!;expect(id).toMatch(/^[a-f0-9-]{36}$/);trace.push('fork');this.launches.push(opts);const pid=21000+this.launches.length;this.live.set(id,pid);reader.identities.set(pid,'darwin-proc-v1:200:'+pid);if(this.immediateExit)this.exit(id);return id;}
  nativePid(id:string):number|null{return this.live.get(id)??null;}
  exit(id:string):void{const pid=this.live.get(id);if(pid)reader.identities.delete(pid);this.live.delete(id);this.emit('exit',id,0);}
  kill(id:string):void{if(this.live.has(id))this.exit(id);}
}
const track=<T>(work:Promise<T>):Promise<T>=>{pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>undefined);return work;};
beforeEach(async()=>{
 f=await agentFixture();reader=new FixtureProcessReader();const db=drizzle(f.sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});projects=new ProjectService(db,secrets);profiles=new AiProfileService(db,secrets);
 const project=projects.createProject({name:'managed task fixture',aliases:[],description:'',rulesPath:null},[{label:'',path:f.cwd}]);projectId=project.id;
 profileId=profiles.create({name:'codex fixture',runner:'codex',executable:null,args:[],env:[],color:null,isDefault:true}).id;
 capabilities=new CapabilityService({db,projects,secrets,userData:f.root});for(const skill of capabilities.list(projectId))if(skill.id!==f.standard.id)capabilities.setEnabled(projectId,skill.id,false);
 runs=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{}});catalog=new DiscoveryCatalog(f.store,f.home,reader,{instanceId:runs.instanceId});f.setExtraVerifier((r,s)=>catalog.verifyReference(r,s));ptys=new ControlledPtys();gate=undefined;afterAttach=undefined;bindGate=undefined;calls=0;clock=Date.now();trace.length=0;runIds.length=0;boundIds.length=0;
 const launcher:TaskCapabilityLauncher={prepare:async input=>{
  calls++;let session:Awaited<ReturnType<typeof f.sessions.get>>,snapshot:CapabilitySessionSnapshotV2;
  if(input.previous?.sessionCapabilities){session=await f.sessions.get(input.taskId);snapshot=session.snapshot;await f.sessions.verifyNativeIdentity(input.taskId,{runner:'codex',stateRoot:input.stateRoot,cwd:input.cwd,sessionId:input.sessionId,home:input.home});}
  else{snapshot=f.plan('codex');snapshot.taskId=input.taskId;snapshot.projectId=input.projectId;snapshot.native={sessionId:input.sessionId,stateRoot:input.stateRoot,cwd:input.cwd};snapshot.packages=[];snapshot.adapterBinding.nativeToolNames={};snapshot.mcp=snapshot.mcp.filter(m=>m.kind==='legacy-project-context');const selected=capabilities.selection(projectId).filter(s=>s.enabled);snapshot.standardSkills=snapshot.standardSkills.filter(s=>selected.some(v=>v.skillId===s.skillId));for(const skill of snapshot.standardSkills)skill.versionId=selected.find(s=>s.skillId===skill.skillId)!.versionId;const collection=await catalog.publish(f.projector.sourceSkills(snapshot));snapshot.catalogGeneration=collection.generation;session=await f.sessions.create(snapshot,input.home);for(const e of collection.entries)await f.sessions.addProjectionReference(input.taskId,session.pointer.snapshotHash,e.resourceId);}
  const collection=await catalog.snapshot(),hold=await catalog.reserveRun(collection.generation,'codex',ids=>runs.reserve({taskId:input.taskId,snapshotHash:session.pointer.snapshotHash,bindings:[]},ids));runIds.push(hold.run.runId);
  const sources=f.projector.sourceSkills(snapshot),skills=capabilities.selection(projectId,input.previous),projections=Object.fromEntries(snapshot.standardSkills.map(s=>{const source=sources.find(v=>v.path===s.projectionPath)!;return[s.versionId,{path:source.path,nativeName:source.nativeName,files:source.files}];}));
  const runtime=capabilities.prepare({projectId,taskId:input.taskId,runner:'codex',cwd:input.cwd,home:input.home,profileArgs:input.profile.args,previous:input.previous,managed:{runId:hold.run.runId,runtimeHash:f.legacyHash,mcpName:snapshot.mcp[0].serverName,skills,projections}});runtime.snapshot.sessionCapabilities=session.pointer;
  writeFileSync(join(dirname(runtime.snapshot.manifestPath),'self-check.json'),JSON.stringify({status:'passed',issues:[],at:Date.now()}));
  const request=await f.request(snapshot,collection);request.runId=hold.run.runId;request.mcp[0].args[1]=join(f.store.root,'runs',projectId,input.taskId,hold.run.runId,'context.json');const plan=f.adapters.plan(snapshot.adapterBinding.hash,request);
  let release:Promise<void>|undefined;const releaseIfStopped=()=>{if(runs.get(hold.run.runId).state!=='stopped')return Promise.resolve();return release??=(async()=>{await hold.release();runtime.release();})();};
  const result:TaskCapabilityLaunch={ptyId:hold.run.ptyId,runtime,args:plan.args,env:runtime.env,beforeSpawn:()=>track((async()=>{trace.push('arm');await hold.run.prepare();await hold.activate();await hold.run.cli.arm();})()),spawned:pid=>track((async()=>{trace.push('attach');await hold.run.cli.attach(pid??0);await afterAttach?.();})()),spawnFailed:()=>track(hold.run.stop('native-fork-error').then(()=>releaseIfStopped())),exited:()=>track(hold.run.cli.exited().then(()=>releaseIfStopped())),stop:reason=>track(hold.run.stop(reason).then(()=>releaseIfStopped())),bindNative:id=>track((async()=>{boundIds.push(id);await bindGate?.();const known=await f.sessions.get(input.taskId),bound=await f.sessions.bindNativeSession(input.taskId,known.pointer.snapshotHash,{...snapshot.native,runner:'codex',sessionId:id});runtime.snapshot.sessionCapabilities=bound.pointer;})())};
  await gate?.();return result;
 },tombstone:id=>f.sessions.tombstone(id),activeTaskIds:id=>new Set((f.sqlite.prepare("SELECT task_id AS id FROM capability_runs WHERE project_id=? AND state NOT IN ('stopped','failed')").all(id) as {id:string}[]).map(r=>r.id))};
 svc=new TaskService({db,ptys,profiles,projects,capabilities,managedCapabilities:launcher,baseEnv:()=>({HOME:f.home,PATH:'/usr/bin:/bin'}),onChanged:()=>{},codexPollMs:10,now:()=>clock});
});
afterEach(async()=>{for(const id of [...ptys.live.keys()])ptys.exit(id);svc.dispose();while(pending.size)await Promise.allSettled([...pending]);capabilities.dispose();f.cleanup();});
const create=()=>svc.create({projectId,dirId:null,aiProfileId:profileId,firstMessage:''});
const consumers=()=>readdirSync(join(catalog.root,'catalog-consumers'));
describe('actual TaskService with fixed session/catalog/run registries and a controlled PTY',()=>{
 it('reserves one authoritative identity before forking and releases transient files only after the owned exit',async()=>{const result=await create(),runtime=result.task.runtimeSnapshot!;expect(trace).toEqual(['arm','fork','attach']);expect(result.ptyId).toBe(ptys.launches[0].id);expect(runs.get(runtime.runId).state).toBe('active');expect(consumers()).toHaveLength(1);expect(ptys.launches[0].args.join('\n')).toContain('skills.config=');expect(existsSync(runtime.manifestPath)).toBe(true);ptys.exit(result.ptyId);await vi.waitFor(()=>expect(consumers()).toEqual([]));expect(existsSync(runtime.manifestPath)).toBe(false);expect((await f.sessions.references(result.task.id)).length).toBeGreaterThan(2);});
 it('joins concurrent resume requests and refuses a competing profile while preparation is pending',async()=>{const first=await create();ptys.exit(first.ptyId);await vi.waitFor(()=>expect(consumers()).toEqual([]));let release!:()=>void;gate=()=>new Promise<void>(r=>{release=r;});const a=svc.open({taskId:first.task.id}),b=svc.open({taskId:first.task.id});expect(a).toBe(b);await vi.waitFor(()=>expect(release).toBeTypeOf('function'));expect(svc.runningInProject(projectId)).toBe(1);await expect(svc.open({taskId:first.task.id,aiProfileId:'different-profile'})).rejects.toThrow('正在准备');release();const second=await a;expect(calls).toBe(2);expect(ptys.launches).toHaveLength(2);expect(second.task.runtimeSnapshot?.sessionCapabilities).toEqual(first.task.runtimeSnapshot?.sessionCapabilities);});
 it('cancels a preparing resume without forking or releasing the fixed session source references',async()=>{const first=await create();ptys.exit(first.ptyId);await vi.waitFor(()=>expect(consumers()).toEqual([]));let release!:()=>void;gate=()=>new Promise<void>(r=>{release=r;});const opening=svc.open({taskId:first.task.id});await vi.waitFor(()=>expect(release).toBeTypeOf('function'));svc.kill(first.task.id);release();await expect(opening).rejects.toThrow('取消');expect(ptys.launches).toHaveLength(1);await vi.waitFor(()=>expect(consumers()).toEqual([]));expect((await f.sessions.get(first.task.id)).retention).toBe('active');expect(runs.get(runIds[1]).state).toBe('stopped');});
 it('does not show a dead PTY as running when the owned exit wins the PID-attachment race',async()=>{ptys.immediateExit=true;const result=await create();expect(result.task.ptyId).toBeNull();expect(svc.activePty(result.task.id)).toBeNull();expect(svc.runningCount()).toBe(0);await vi.waitFor(()=>expect(consumers()).toEqual([]));expect(runs.get(runIds[0]).state).toBe('stopped');});
 it('retains an armed fork-failure window instead of claiming an unknown child never existed',async()=>{ptys.fail=true;await expect(create()).rejects.toThrow('controlled native fork');expect(svc.list()).toEqual([]);expect(consumers()).toHaveLength(1);expect(runs.get(runIds[0]).state).toBe('stopping');});
 it('keeps transient resources while disposal waits for the actual native exit',async()=>{const first=await create(),path=first.task.runtimeSnapshot!.manifestPath;svc.dispose();expect(existsSync(path)).toBe(true);expect(consumers()).toHaveLength(1);ptys.exit(first.ptyId);await vi.waitFor(()=>expect(consumers()).toEqual([]));expect(existsSync(path)).toBe(false);});
 it('completes the first native ID in the authoritative registry and persists the new pointer without losing it to self-check writes',async()=>{const first=await create(),at=new Date(),root=join(first.task.runtimeSnapshot!.sessionCapabilities?f.home:'unexpected','.codex','sessions',String(at.getFullYear()),String(at.getMonth()+1).padStart(2,'0'),String(at.getDate()).padStart(2,'0'));mkdirSync(root,{recursive:true});writeFileSync(join(root,'rollout-fixture-native-owned-id.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'native-owned-id',cwd:f.cwd,timestamp:new Date(Date.now()+50).toISOString(),originator:'codex_cli_rs'}})+'\n');await vi.waitFor(()=>expect(svc.get(first.task.id).nativeSessionId).toBe('native-owned-id'));const stored=await f.sessions.get(first.task.id);await vi.waitFor(()=>expect(svc.get(first.task.id).runtimeSnapshot?.sessionCapabilities).toEqual(stored.pointer));expect(stored.snapshot.native.sessionId).toBe('native-owned-id');ptys.exit(first.ptyId);await vi.waitFor(()=>expect(consumers()).toEqual([]));const reopened=await svc.open({taskId:first.task.id});expect(reopened.task.nativeSessionId).toBe('native-owned-id');expect(ptys.launches[1].args).toContain('--cd');expect(ptys.launches[1].args).toContain('native-owned-id');});
 it('stops its own native child if task persistence fails after the fork',async()=>{f.sqlite.exec("CREATE TRIGGER fail_task_save BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'controlled task storage failure'); END");await expect(create()).rejects.toThrow('controlled task storage');expect(ptys.live.size).toBe(0);await vi.waitFor(()=>expect(consumers()).toEqual([]));expect(runs.get(runIds[0]).state).toBe('stopped');});
 it('does not leave a process or create a task when shutdown arrives while PID attachment is completing',async()=>{let release!:()=>void;afterAttach=()=>new Promise<void>(r=>{release=r;});const creating=create();await vi.waitFor(()=>expect(release).toBeTypeOf('function'));svc.dispose();release();await expect(creating).rejects.toThrow('取消');expect(ptys.live.size).toBe(0);await vi.waitFor(()=>expect(consumers()).toEqual([]));expect(svc.list()).toEqual([]);});


 it('does not bind two different rollouts while the first authoritative native identity is pending',async()=>{
   const first=await create();
   let release!:()=>void;
   const blocked=new Promise<void>(resolve=>{release=resolve;});
   bindGate=()=>blocked;
   const date=new Date(clock),root=join(f.home,'.codex/sessions',String(date.getFullYear()),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0'));
   mkdirSync(root,{recursive:true});
   for(const [offset,id] of [[50,'first-owned-native'],[100,'other-native-candidate']] as const){
     writeFileSync(join(root,'rollout-fixture-'+id+'.jsonl'),JSON.stringify({type:'session_meta',payload:{id,cwd:f.cwd,timestamp:new Date(clock+offset).toISOString(),originator:'codex_cli_rs'}})+'\n');
   }
   try{
     await vi.waitFor(()=>expect(boundIds).toEqual(['first-owned-native']));
     // Hold the authoritative write across several 10ms watcher ticks to exercise contention.
     await new Promise<void>(resolve=>setTimeout(resolve,80));
     expect(boundIds).toEqual(['first-owned-native']);
   }finally{release();}
   await vi.waitFor(()=>expect(svc.get(first.task.id).nativeSessionId).toBe('first-owned-native'));
   expect((await f.sessions.get(first.task.id)).snapshot.native.sessionId).toBe('first-owned-native');
 });

 it('discovers a native session flushed before a slow PID attachment completes by using the actual fork time',async()=>{const first=await create();ptys.exit(first.ptyId);await vi.waitFor(()=>expect(consumers()).toEqual([]));let release!:()=>void;afterAttach=()=>new Promise<void>(r=>{release=r;});const forkTime=clock,opening=svc.open({taskId:first.task.id});await vi.waitFor(()=>expect(release).toBeTypeOf('function'));const date=new Date(forkTime),root=join(f.home,'.codex/sessions',String(date.getFullYear()),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0'));mkdirSync(root,{recursive:true});writeFileSync(join(root,'rollout-fixture-before-attachment.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'native-before-attachment',cwd:f.cwd,timestamp:new Date(forkTime+50).toISOString(),originator:'codex_cli_rs'}})+'\n');clock+=5000;release();const second=await opening;expect(second.task.lastLaunchedAt).toBe(forkTime);await vi.waitFor(()=>expect(svc.get(first.task.id).nativeSessionId).toBe('native-before-attachment'));});

});
