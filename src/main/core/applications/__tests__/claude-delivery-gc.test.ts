import {existsSync,readFileSync,rmSync,mkdirSync,writeFileSync,symlinkSync,linkSync,lstatSync,readdirSync,rmdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {ClaudeDeliveryCoordinator,type ClaudeDeliveryCheckpoint} from '../claude-delivery';
import {digest,canonicalJson} from '../manifest';
import {writeOwnedBundle} from '../owned-bundle';
import type {OwnedCapabilityRun} from '../run-registry';
import {SessionCapabilityProjector} from '../session-projector';
import {verifyOwnedBundle} from '../owned-bundle';
import {readClaudeSlot} from '../claude-delivery-state';
import {FixtureProcessReader,runFixture} from './run-fixture';
let f:Awaited<ReturnType<typeof runFixture>>,reader:FixtureProcessReader,projector:SessionCapabilityProjector,c:ClaudeDeliveryCoordinator,checkpoint:((phase:ClaudeDeliveryCheckpoint)=>void)|undefined;const runs:OwnedCapabilityRun[]=[];
beforeEach(async()=>{reader=new FixtureProcessReader();f=await runFixture(reader,{application:true,secondApplication:true,fullProjection:true});projector=new SessionCapabilityProjector(f.store,f.sessions);checkpoint=undefined;c=new ClaudeDeliveryCoordinator(f.store,f.sessions,projector,reader,f.runs.instanceId,p=>checkpoint?.(p));});
afterEach(async()=>{for(const run of runs.splice(0)){await run.cli.exited();await run.stop();}await f.runs.dispose();f.cleanup();});
function completed(){const rows=f.sqlite.prepare("SELECT operation_id,plan_json FROM capability_resource_operations WHERE kind='claude-delivery-install' AND state='committed' ORDER BY rowid").all() as {operation_id:string;plan_json:string}[];return rows.map(r=>({id:r.operation_id,pending:JSON.parse(r.plan_json).completedPending}));}
describe('production Claude handoff reclaims only proven redundant copies',()=>{
 it.each([false,true])('reclaims a completed full backup on the next stopped preparation,same-hash=%s,without losing original history',async sameHash=>{
  const original=await f.sessions.get(f.snapshot.taskId),refs=await f.sessions.references(f.snapshot.taskId);if(!sameHash)rmSync(join(f.store.root,f.application!.relativePath),{recursive:true});
  const ids=sameHash?['zentao','mail']:['mail'],first=await c.prepare(f.snapshot.taskId,ids);await c.cancel(first);const origin=completed()[0],backup=join(f.store.root,origin.pending.backup);expect(existsSync(backup)).toBe(true);const bytes=readFileSync(join(backup,'bundle.json'));
  const next=await c.prepare(f.snapshot.taskId,ids);await c.cancel(next);expect(existsSync(backup)).toBe(false);expect((await f.sessions.get(f.snapshot.taskId)).snapshot).toEqual(original.snapshot);for(const ref of refs)expect(await f.sessions.references(f.snapshot.taskId)).toContainEqual(ref);
  const archive=(await f.sessions.references(f.snapshot.taskId)).find(r=>r.refKind==='claude-projection-archive')!;expect(readFileSync(join(f.store.directory(f.store.get(archive.refId)),'bundle.json'))).toEqual(bytes);verifyOwnedBundle(join(f.store.root,readClaudeSlot(f.store,f.snapshot.taskId)!.root),next.hash,f.store.storeId);
 });
});

async function initial(){rmSync(join(f.store.root,f.application!.relativePath),{recursive:true});const token=await c.prepare(f.snapshot.taskId,['mail']);await c.cancel(token);const origin=completed()[0];return{origin,backup:join(f.store.root,origin.pending.backup)};}
async function tick(){const token=await c.prepare(f.snapshot.taskId,['mail']);await c.cancel(token);return token;}
function gc(relativePath:string){const id='claude-copy-gc:'+completed()[0].id+':'+digest(relativePath);return f.sqlite.prepare('SELECT * FROM capability_resource_operations WHERE operation_id=?').get(id) as {operation_id:string;state:string;plan_json:string;error_code:string|null};}
function payload(path:string){const row=gc(path);return join(f.store.root,'trash/claude-delivery-copy-'+digest(row.operation_id),'payload');}
describe('copy proof,retention and persistent cleanup recovery',()=>{
 it('reclaims a known complete stage left after delivered recovery while retaining the independent source',async()=>{
  rmSync(join(f.store.root,f.application!.relativePath),{recursive:true});checkpoint=p=>{if(p==='delivered')throw Error('controlled delivery interruption');};await expect(c.prepare(f.snapshot.taskId,['mail'])).rejects.toThrow('controlled delivery interruption');const pending=readClaudeSlot(f.store,f.snapshot.taskId)!.pending!,source=await projector.readClaudeArtifact(f.snapshot.taskId,pending.sourceId);writeOwnedBundle(join(f.store.root,pending.stage),source.bundle,f.store.storeId);checkpoint=undefined;const token=await c.recover(f.snapshot.taskId);await c.cancel(token!);expect(existsSync(join(f.store.root,pending.stage))).toBe(true);await tick();expect(existsSync(join(f.store.root,pending.stage))).toBe(false);expect(gc(pending.stage).state).toBe('committed');verifyOwnedBundle(f.store.directory(source.resource),source.bundle.hash,f.store.storeId);
 });
 it('keeps unknown abandoned stage bytes while reclaiming the separate proven backup and allowing the next preparation',async()=>{
  rmSync(join(f.store.root,f.application!.relativePath),{recursive:true});checkpoint=p=>{if(p==='registered')throw Error('controlled interruption');};await expect(c.prepare(f.snapshot.taskId,['mail'])).rejects.toThrow();const pending=readClaudeSlot(f.store,f.snapshot.taskId)!.pending!,stage=join(f.store.root,pending.stage);mkdirSync(stage,{recursive:true});writeFileSync(join(stage,'user-canary'),'keep');checkpoint=undefined;const token=await c.recover(f.snapshot.taskId);await c.cancel(token!);await tick();expect(readFileSync(join(stage,'user-canary'),'utf8')).toBe('keep');expect(gc(pending.stage).state).toBe('held');expect(gc(pending.stage).error_code).toBeTruthy();expect(existsSync(join(f.store.root,pending.backup))).toBe(false);
 });
 it.each(['bytes','marker','link','hardlink','empty-directory'] as const)('keeps a backup with changed %s and never removes external or unrecognized content',async fault=>{
  const {origin,backup}=await initial(),name='.claude-plugin/plugin.json',file=join(backup,name),original=readFileSync(file),outside=join(f.root,'outside');
  if(fault==='bytes')writeFileSync(file,'changed');if(fault==='marker')writeFileSync(join(backup,'.willyou-owned-bundle.json'),'{}');if(fault==='link'){writeFileSync(outside,original);rmSync(file);symlinkSync(outside,file);}if(fault==='hardlink')linkSync(file,outside);if(fault==='empty-directory')mkdirSync(join(backup,'unknown-empty'));
  await tick();expect(existsSync(backup)).toBe(true);expect(gc(origin.pending.backup).state).toBe('held');if(fault==='link'||fault==='hardlink')expect(readFileSync(outside)).toEqual(original);if(fault==='empty-directory')expect(lstatSync(join(backup,'unknown-empty')).isDirectory()).toBe(true);
 });
 it('rechecks a previously held copy after exact bytes are restored instead of treating the old error as ownership authority',async()=>{
  const {origin,backup}=await initial(),file=join(backup,'.claude-plugin/plugin.json'),bytes=readFileSync(file);writeFileSync(file,'changed');await tick();expect(gc(origin.pending.backup).state).toBe('held');writeFileSync(file,bytes);await tick();expect(existsSync(backup)).toBe(false);expect(gc(origin.pending.backup)).toMatchObject({state:'committed',error_code:null});
 });
 it.each(['missing-file','changed-bytes','missing-reference','changed-dependencies'] as const)('keeps the original backup when its independent archive has %s',async fault=>{
  const {origin,backup}=await initial(),ref=(await f.sessions.references(f.snapshot.taskId)).find(r=>r.refKind==='claude-projection-archive')!,resource=f.store.get(ref.refId),file=join(f.store.directory(resource),'.claude-plugin/plugin.json'),before=readFileSync(join(backup,'bundle.json'));
  if(fault==='missing-file')rmSync(file);if(fault==='changed-bytes')writeFileSync(file,'changed');if(fault==='missing-reference')f.sqlite.prepare('DELETE FROM capability_session_refs WHERE task_id=? AND ref_id=?').run(f.snapshot.taskId,ref.refId);if(fault==='changed-dependencies')f.sqlite.prepare('INSERT INTO capability_resource_dependencies VALUES(?,?)').run(ref.refId,f.adapter.resourceId);
  await tick();expect(readFileSync(join(backup,'bundle.json'))).toEqual(before);expect(gc(origin.pending.backup).state).toBe('held');
 });
 it.each(['missing','ended-at','identity'] as const)('requires the original install lease proof when it has %s damage',async fault=>{
  const {origin,backup}=await initial(),id=origin.pending.participants[0].leaseId;if(fault==='missing')f.sqlite.prepare('DELETE FROM capability_resource_leases WHERE lease_id=?').run(id);if(fault==='ended-at')f.sqlite.prepare('UPDATE capability_resource_leases SET ended_at=NULL WHERE lease_id=?').run(id);if(fault==='identity')f.sqlite.prepare('UPDATE capability_resource_leases SET process_started_at=? WHERE lease_id=?').run('darwin-proc-v1:999:9',id);
  await tick();expect(existsSync(backup)).toBe(true);expect(gc(origin.pending.backup).state).toBe('held');
 });
 it('keeps the backup through a live run and an unknown armed CLI window,then reclaims only after its explicit fixture exit',async()=>{
  rmSync(join(f.store.root,f.application!.relativePath),{recursive:true});const token=await c.prepare(f.snapshot.taskId,['mail']),origin=completed()[0],backup=join(f.store.root,origin.pending.backup),run=await f.runs.reserveScoped({taskId:f.snapshot.taskId,snapshotHash:f.session.pointer.snapshotHash,bindings:[]},['mail'],[token.resourceId],undefined,token);runs.push(run);await run.prepare();c.proof(run.runId,token);await run.cli.arm();await run.stop();expect(f.runs.get(run.runId).state).toBe('stopping');await expect(tick()).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(existsSync(backup)).toBe(true);await run.cli.exited();await run.stop();await tick();expect(existsSync(backup)).toBe(false);
 });
 it('keeps a registered physical alias rather than relying on zero run counts',async()=>{
  const {origin,backup}=await initial();f.sqlite.prepare("INSERT INTO capability_resources(resource_id,kind,content_hash,owner_store_id,path_scope,relative_path,state,generation,integrity) VALUES(?,'fixture',?,?,'C',?,'ready',1,'valid')").run('negative-copy-alias','a'.repeat(64),f.store.storeId,origin.pending.backup);await tick();expect(existsSync(backup)).toBe(true);expect(gc(origin.pending.backup)).toMatchObject({state:'held',error_code:'RESOURCE_BUSY'});
 });
 it.each(['gc-marked','gc-renamed','gc-file-removed','gc-removed'] as const)('resumes the same durable cleanup after an injected %s interruption without deleting original archives',async phase=>{
  const {origin,backup}=await initial();let hit=false;checkpoint=p=>{if(p===phase&&!hit){hit=true;throw Error('controlled cleanup interruption');}};await tick();expect(hit).toBe(true);const before=gc(origin.pending.backup),plan=JSON.parse(before.plan_json).payload;expect(before.state).not.toBe('committed');checkpoint=undefined;await tick();expect(gc(origin.pending.backup)).toMatchObject({operation_id:before.operation_id,state:'committed',error_code:null});expect(existsSync(backup)).toBe(false);expect(existsSync(payload(origin.pending.backup))).toBe(false);expect(JSON.parse(gc(origin.pending.backup).plan_json).payload.files).toEqual(plan.files);const archive=f.store.get(plan.sourceId);verifyOwnedBundle(f.store.directory(archive),plan.hash,f.store.storeId);
 });
 it.each(['running','unknown'] as const)('does not claim another cleanup owner whose kernel identity is %s',async state=>{
  const {origin,backup}=await initial();checkpoint=p=>{if(p==='gc-marked')throw Error('controlled owner interruption');};await tick();checkpoint=undefined;const otherReader=new FixtureProcessReader(),other=new ClaudeDeliveryCoordinator(f.store,f.sessions,projector,otherReader,randomUUID());if(state==='unknown')otherReader.unknown.add(process.pid);const token=await other.prepare(f.snapshot.taskId,['mail']);await other.cancel(token);expect(existsSync(backup)).toBe(true);expect(gc(origin.pending.backup)).toMatchObject({state:'preparing',error_code:'RESOURCE_BUSY'});
 });
 it('retains a late foreign file in the trash and resumes neither deletion nor success from a changed remainder',async()=>{
  const {origin}=await initial();let hit=false;checkpoint=p=>{if(p==='gc-file-removed'&&!hit){hit=true;writeFileSync(join(payload(origin.pending.backup),'user-canary'),'keep');throw Error('controlled late content');}};await tick();checkpoint=undefined;await tick();expect(gc(origin.pending.backup).state).toBe('deleting');expect(readFileSync(join(payload(origin.pending.backup),'user-canary'),'utf8')).toBe('keep');
 });
 it('never deletes a recreated original path after a committed copy receipt',async()=>{
  const {origin,backup}=await initial();await tick();expect(existsSync(backup)).toBe(false);mkdirSync(backup);writeFileSync(join(backup,'canary'),'new user data');await tick();expect(readFileSync(join(backup,'canary'),'utf8')).toBe('new user data');expect(gc(origin.pending.backup)).toMatchObject({state:'committed',error_code:'OWNERSHIP_CONFLICT'});
 });
});

it('recovers deletion after a captured child directory was already removed before interruption',async()=>{
 const {origin}=await initial();let removed=0,hit=false;checkpoint=phase=>{if(phase!=='gc-file-removed')return;const plan=JSON.parse(gc(origin.pending.backup).plan_json).payload;if(++removed!==plan.files.length)return;const directory=[...plan.directories].filter(v=>v.path).sort((a,b)=>b.path.length-a.path.length)[0];rmdirSync(join(payload(origin.pending.backup),directory.path));hit=true;throw Error('controlled interruption after child directory removal');};await tick();expect(hit).toBe(true);checkpoint=undefined;await tick();expect(gc(origin.pending.backup).state).toBe('committed');expect(existsSync(payload(origin.pending.backup))).toBe(false);
});

it('keeps its verified archive choice when an additional equivalent full source appears during pending cleanup',async()=>{
 const {origin,backup}=await initial();checkpoint=p=>{if(p==='gc-marked')throw Error('controlled pending cleanup');};await tick();const selected=JSON.parse(gc(origin.pending.backup).plan_json).payload.sourceId;expect(selected).toContain('claude-projection-archive:');checkpoint=undefined;await f.packageRegistry.install(f.applicationSource!);await projector.claudeSource(f.snapshot.taskId,['zentao','mail']);await tick();expect(existsSync(backup)).toBe(false);expect(gc(origin.pending.backup).state).toBe('committed');expect(JSON.parse(gc(origin.pending.backup).plan_json).payload.sourceId).toBe(selected);
});
it('bounds one preparation cleanup batch and continues remaining registered copies on the next preparation',async()=>{
 const {origin,backup}=await initial(),p=origin.pending,source=await projector.readClaudeArtifact(f.snapshot.taskId,p.sourceId),stages=Array.from({length:6},()=>`claude-deliveries/${f.snapshot.taskId}/${origin.id}/stages/${randomUUID()}`);for(const stage of stages)writeOwnedBundle(join(f.store.root,stage),source.bundle,f.store.storeId);p.abandonedStages=stages;f.sqlite.prepare('UPDATE capability_resource_operations SET plan_json=? WHERE operation_id=?').run(canonicalJson({slotId:'claude-delivery-slot:'+f.snapshot.taskId,completedPending:p}),origin.id);const paths=[backup,...stages.map(v=>join(f.store.root,v))];expect(paths.filter(existsSync)).toHaveLength(7);await tick();expect(paths.filter(existsSync)).toHaveLength(3);await tick();expect(paths.filter(existsSync)).toHaveLength(0);
});
