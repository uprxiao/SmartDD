import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtempSync,realpathSync,rmSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CodexInitializationCoordinator,type CodexInitializationLease} from '../codex-initialization';
import type {ProcessIdentityReader,NativeSqliteFile} from '../process-identity';
import type {CodexDdlObservation} from '../codex-database-readiness';
import type {ResolvedProfile} from '../../ai/ai-profile-service';
import metadata from '../codex-ddl-0.167.1.json';

let root:string;
beforeEach(()=>root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-codex-init-U-'))));
afterEach(()=>rmSync(root,{recursive:true,force:true}));
const profile:ResolvedProfile={id:'public-U',name:'public-U',runner:'codex',command:'/public/native/codex',args:[],env:{},isolatePrefixes:[]};
const process={pid:12345,startedAt:'darwin-proc-v1:123:456'};
const image={path:profile.command,sha256:metadata.binarySha256};
const input=(signal=new AbortController().signal)=>({profile,cwd:root,environment:{},signal});
function setup(){
  let state:'running'|'stopped'|'unknown'='running',complete=true;
  let files:NativeSqliteFile[]=metadata.databases.filter(d=>d.eager).map((d,i)=>({path:join(root,d.root,d.name),dev:'1',ino:String(9007199254740993n+BigInt(i))}));
  const processes:ProcessIdentityReader={read:()=>({...process}),state:()=>state,nativeChild:(r,path)=>state==='running'?{...process,root:r,executable:path}:null,sqliteFiles:()=>files};
  const readDdl=vi.fn(():CodexDdlObservation=>({status:complete?'ready':'pending',scope:'synthetic-unit-only',issue:complete?null:'pending-db',opened:5,roots:[],databases:files.map(f=>({name:f.path.split('/').at(-1)!,path:f.path,exists:true,readonly:true,queryOnly:true,snapshotComplete:true,identity:{dev:f.dev,ino:f.ino}}))}));
  const options={resolveImage:()=>image,verifyImage:()=>{},readDdl,timeoutMs:200,pollMs:1};
  return {gate:new CodexInitializationCoordinator(root,processes,options),processes,options,readDdl,setState:(v:typeof state)=>state=v,setComplete:(v:boolean)=>complete=v,setFiles:(v:NativeSqliteFile[])=>files=v,files:()=>files};
}
function attach(lease:CodexInitializationLease,slot:'terminal'|'backend'='terminal'){
  lease.arm(slot);lease.observe(slot,{attempted:true,root:process,executable:image.path});
}
const marker=()=>join(root,'codex-initialization','unresolved.json');

it('holds the second startup until all owned eager DB metadata is ready, including big inode strings',async()=>{
  const s=setup();s.setComplete(false);const steps:string[]=[];
  const first=s.gate.coordinate(input(),async lease=>{attach(lease!);steps.push('first-fork');await lease!.waitReady('terminal');steps.push('first-ready');});
  await vi.waitFor(()=>expect(s.readDdl).toHaveBeenCalled());
  const second=s.gate.coordinate(input(),async lease=>{steps.push('second-fork');attach(lease!);await lease!.waitReady('terminal');});
  await new Promise<void>(r=>setTimeout(r,5));expect(steps).toEqual(['first-fork']);s.setComplete(true);
  await Promise.all([first,second]);expect(steps).toEqual(['first-fork','first-ready','second-fork']);expect(existsSync(marker())).toBe(false);
});
it('cancels a queued startup without executing its fork callback',async()=>{
  const s=setup();let release!:()=>void;const held=new Promise<void>(r=>release=r);
  const first=s.gate.coordinate(input(),async()=>held);
  await vi.waitFor(()=>expect(existsSync(join(root,'codex-initialization','catalog.lock'))).toBe(true));
  const abort=new AbortController(),fork=vi.fn();const second=s.gate.coordinate(input(abort.signal),fork);abort.abort();
  await expect(second).rejects.toMatchObject({code:'CANCELED'});expect(fork).not.toHaveBeenCalled();release();await first;
});
it('retains an armed unknown fork across gate release and a new coordinator',async()=>{
  const s=setup();await expect(s.gate.coordinate(input(),async lease=>{lease!.arm('backend');throw Error('injected-interruption');})).rejects.toThrow('injected-interruption');
  expect(JSON.parse(readFileSync(marker(),'utf8')).slots.backend.state).toBe('armed');
  const next=new CodexInitializationCoordinator(root,s.processes,s.options),fork=vi.fn();await expect(next.coordinate(input(),fork)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(fork).not.toHaveBeenCalled();
});
it('recovers a failed startup only after the exact observed initializer is stopped',async()=>{
  const s=setup();s.setComplete(false);
  await expect(s.gate.coordinate(input(),async lease=>{attach(lease!);throw Error('failed-after-fork');})).rejects.toThrow('failed-after-fork');
  const fork=vi.fn();await expect(s.gate.coordinate(input(),fork)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(fork).not.toHaveBeenCalled();
  s.setState('stopped');await s.gate.coordinate(input(),async()=>{});expect(existsSync(marker())).toBe(false);
});
it('does not treat a stopped wrapper with no captured native child as a confirmed exit',async()=>{
  const s=setup();s.processes.nativeChild=()=>null;
  await expect(s.gate.coordinate(input(),async lease=>{attach(lease!);s.setState('stopped');throw Error('unknown-child');})).rejects.toThrow('unknown-child');
  await expect(s.gate.coordinate(input(),async()=>{})).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});
});
it('checks backend ownership and rejects ambiguous same-name files before opening DDL',async()=>{
  const s=setup();s.setFiles([...s.files(),{path:join(root,'other','state_5.sqlite'),dev:'2',ino:'100'}]);
  await expect(s.gate.coordinate(input(),async lease=>{attach(lease!,'backend');await lease!.waitReady('backend');})).rejects.toMatchObject({code:'TIMEOUT'});
  expect(s.readDdl).not.toHaveBeenCalled();expect(existsSync(marker())).toBe(true);
});
it('requires the same FD inode after metadata reads, not a ready result by itself',async()=>{
  const s=setup();const original=s.processes.sqliteFiles!;let n=0;s.processes.sqliteFiles=(...args)=>{const f=original(...args)!;return ++n%2===0?f.map(x=>({...x,ino:'5'})):f;};
  await expect(s.gate.coordinate(input(),async lease=>{attach(lease!);await lease!.waitReady('terminal');})).rejects.toMatchObject({code:'TIMEOUT'});expect(existsSync(marker())).toBe(true);
});
it('a confirmed no-fork backend slot is cleared while an aborted caller keeps its task cleanup responsibility',async()=>{
  const s=setup();await expect(s.gate.coordinate(input(),async lease=>{lease!.arm('backend');lease!.observe('backend',{attempted:false,root:null,executable:image.path});throw Error('canceled-before-fork');})).rejects.toThrow('canceled-before-fork');expect(existsSync(marker())).toBe(false);
});
it('unknown native images retain ordinary behavior but cannot bypass a prior unresolved marker',async()=>{
  const s=setup(),unknown=new CodexInitializationCoordinator(root,s.processes,{...s.options,resolveImage:()=>null});const work=vi.fn(async lease=>expect(lease).toBeUndefined());await unknown.coordinate(input(),work);expect(work).toHaveBeenCalledOnce();
  writeFileSync(marker(),JSON.stringify({schema:1,token:'f615ca73-b990-453b-83e2-a734a4450cc0',image,slots:{terminal:{state:'armed'}}}));
  await expect(unknown.coordinate(input(),work)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(work).toHaveBeenCalledOnce();
});
