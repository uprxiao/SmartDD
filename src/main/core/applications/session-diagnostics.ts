import type {NativeUserMessages} from './native-user-messages';
import {nativeCapabilityPreparationSchema,assertNativeCapabilityPreparation} from './native-preparation-diagnostics';
import {readApplicationRunScope} from './application-run-scope';
import {readClaudeSlot} from './claude-delivery-state';
import {inspectClaudeDeliveryCopies} from './claude-delivery-copies';
import {lstatSync,openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import type {SkillReadTarget,SkillReadObservation} from './codex-skill-read-evidence';
import {join,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import type {ApplicationId,ApplicationProvider} from '@shared/application-connections';
import type {ApplicationSessionDiagnostic,SessionApplicationDiagnostic,SessionRunDiagnostic,SessionPreparationEvidence,SessionBridgeEvidence} from '@shared/application-session-diagnostics';
import type {ResourceRecord,ResourceStore} from './resource-store';
import type {CapabilityRunRegistry} from './run-registry';
import {CapabilitySessionRegistry,type StoredCapabilitySession} from './session-registry';
import type {CapabilitySessionSnapshotV2} from '@shared/application-session';
import type {ApplicationConnectionService} from './connection-service';
import type {ApplicationSelectionService} from './selection-service';
import {PackageRegistry} from './package-registry';
import {RuntimeRegistry} from './runtime-registry';
import {verifyPackageTree} from './package-files';
import {packageConnectionView} from './package-config-views';
import {canonicalJson,digest} from './manifest';
import {withResourceLock} from './resource-lock';
import {readLaunchRestriction} from './launch-restriction';
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),issue=z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/);
const skillObservationSchema=z.object({runId:id,appId:z.enum(['mail','zentao']),skillId:id,kind:z.enum(['discovery','read']),packageHash:hash,recordHash:hash,observedAt:z.iso.datetime(),cliVersion:z.string().min(1).max(128)}).strict();
const path=z.string().min(1).max(4096).refine(v=>v.startsWith('/')&&!/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(v));
const preparationV1=z.object({schema:z.literal(1),runId:z.uuid(),selectionHash:hash,cliVersion:z.string().min(1).max(128).regex(/^[\x20-\x7e]+$/).nullable(),adapterHash:hash,state:z.enum(['prepared','unavailable']),issueCode:issue.nullable(),manifestPath:path,configPaths:z.array(path).max(16),preparedAt:z.iso.datetime()}).strict();
const preparationSchema=z.discriminatedUnion('schema',[preparationV1,preparationV1.extend({schema:z.literal(2),capabilities:nativeCapabilityPreparationSchema})]).refine(v=>(v.state==='prepared')===(v.issueCode===null));
const bridgeSchema=z.object({schema:z.literal(1),runId:z.uuid(),bridgeId:z.uuid(),pid:z.number().int().positive(),startedAt:z.string().regex(/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/),observedAt:z.iso.datetime(),source:z.literal('kernel-peer')}).strict();
interface RunRow {run_id:string;task_id:string;project_id:string;pty_id:string|null;state:string;started_at:string;ended_at:string|null;}
interface Inspector {verify(resource:ResourceRecord,snapshot:CapabilitySessionSnapshotV2,home:string):void;channelConnected(runId:string):boolean;recoveryIssue?(runId:string):string|null;}
const code=(e:unknown)=>e instanceof ApplicationError?e.code:'RESOURCE_RECOVERY_REQUIRED';
function assertPreparationScope(store:ResourceStore,runId:string,snapshot:CapabilitySessionSnapshotV2,evidence:Extract<SessionPreparationEvidence,{schema:2}>){
 const scope=readApplicationRunScope(store,runId,snapshot);
 if(scope&&evidence.capabilities.some(item=>item.kind==='application'&&item.state==='prepared'&&!scope.applications.some(app=>app.appId===item.id)))throw new ApplicationError('SCOPE_DENIED','原运行范围排除的应用不能显示为已准备');
 return scope;
}

/** Display-only evidence: no discoveries inferred from files, no approvals inferred
 * from a tool call, and no current grants inferred from an older run. */
export class ApplicationSessionDiagnostics {
 private readonly sessions:CapabilitySessionRegistry;private readonly packages:PackageRegistry;private inspector?:Inspector;
 constructor(private readonly store:ResourceStore,private readonly connections:ApplicationConnectionService,private readonly selections:ApplicationSelectionService,private readonly deps:{runs:()=>CapabilityRunRegistry|undefined;activePty?:(taskId:string)=>string|null;prepareStoppedSkillRead?:NativeUserMessages['prepareStoppedSkillRead'];skillReads?:(runId:string,targets:readonly SkillReadTarget[])=>Promise<SkillReadObservation[]>;skillDiscoveries?:(runId:string,targets:readonly SkillReadTarget[])=>Promise<SkillReadObservation[]>}){
  this.sessions=new CapabilitySessionRegistry(store,{assertInitialSelection:()=>{throw new Error('read only');},verifyExtraResource:()=>{throw new Error('read only');}});this.packages=new PackageRegistry(store,'diagnostic-reader');
 }
 attach(inspector:Inspector){if(this.inspector&&this.inspector!==inspector)throw new ApplicationError('RESOURCE_BUSY','会话诊断已有所属宿主');this.inspector=inspector;}
 async prepared(value:SessionPreparationEvidence):Promise<void>{
  const evidence=preparationSchema.parse(value),text=canonicalJson(evidence);
  await withResourceLock(this.store.root,()=>{const run=this.store.sqlite.prepare('SELECT task_id FROM capability_runs WHERE run_id=?').get(evidence.runId) as {task_id:string}|undefined;if(!run)throw new ApplicationError('NOT_FOUND','运行记录不存在');const session=this.sessions.inspectCoordinated(run.task_id);if(session.selectionHash!==evidence.selectionHash||session.snapshot.adapterBinding.hash!==evidence.adapterHash)throw new ApplicationError('SCOPE_DENIED','准备证据不属于固定会话');
   if(evidence.schema===2){
    assertNativeCapabilityPreparation(session.snapshot,evidence.capabilities);
    const runtime=this.deps.runs(),owner=this.store.sqlite.prepare('SELECT owner_instance_id,owner_pid,owner_started_at FROM capability_runs WHERE run_id=?').get(evidence.runId) as {owner_instance_id:string;owner_pid:number;owner_started_at:string};
    if(!runtime||runtime.store!==this.store||owner.owner_instance_id!==runtime.instanceId||owner.owner_pid!==runtime.host.pid||owner.owner_started_at!==runtime.host.startedAt)throw new ApplicationError('SCOPE_DENIED','逐项准备证据不属于当前宿主运行');
    const scope=assertPreparationScope(this.store,evidence.runId,session.snapshot,evidence),restriction=readLaunchRestriction(this.store,evidence.runId,session.snapshot.taskId,session.selectionHash);
    if(evidence.capabilities.some(item=>item.state==='prepared'&&(!!restriction||item.kind==='application'&&scope&&!scope.applications.some(app=>app.appId===item.id))))throw new ApplicationError('SCOPE_DENIED','未加载或已停用的能力不能记录为本轮已准备');
   }
   const previous=this.store.sqlite.prepare('SELECT evidence_json FROM capability_run_preparations WHERE run_id=?').get(evidence.runId) as {evidence_json:string}|undefined;if(previous&&previous.evidence_json!==text)throw new ApplicationError('RESOURCE_STATE_CHANGED','本次准备证据已经固定');if(!previous)this.store.sqlite.prepare('INSERT INTO capability_run_preparations VALUES(?,?,?,?)').run(evidence.runId,text,digest(text),evidence.preparedAt);
  });
 }
 async bridgeAuthenticated(runId:string,bridgeId:string):Promise<void>{
  const runs=this.deps.runs();if(!runs)throw new ApplicationError('CAPABILITY_UNAVAILABLE','没有当前运行宿主');runs.assertBridge(runId,bridgeId);
  await withResourceLock(this.store.root,()=>{runs.assertBridge(runId,bridgeId);const child=this.store.sqlite.prepare("SELECT pid,process_started_at FROM capability_run_processes WHERE run_id=? AND process_id=? AND kind='bridge' AND state='active'").get(runId,bridgeId) as {pid:number;process_started_at:string}|undefined;if(!child)throw new ApplicationError('SCOPE_DENIED','没有实际核验的工具桥进程');
   const evidence=bridgeSchema.parse({schema:1,runId,bridgeId,pid:child.pid,startedAt:child.process_started_at,observedAt:new Date().toISOString(),source:'kernel-peer'}),text=canonicalJson(evidence);this.store.sqlite.prepare('INSERT OR IGNORE INTO capability_bridge_observations VALUES(?,?,?,?,?)').run(runId,bridgeId,text,digest(text),evidence.observedAt);
  });
 }
 private run(row:RunRow,session:StoredCapabilitySession|null):SessionRunDiagnostic{
  const runtime=this.deps.runs();let current=false;try{current=!!row.pty_id&&this.deps.activePty?.(row.task_id)===row.pty_id&&runtime?.currentNativeRun(row.task_id,row.pty_id)?.runId===row.run_id;}catch{/* An orphaned or damaged run is not the current owned terminal. */}
  const prep=this.store.sqlite.prepare('SELECT * FROM capability_run_preparations WHERE run_id=?').get(row.run_id) as {evidence_json:string;evidence_hash:string;prepared_at:string}|undefined;
  let preparation:SessionPreparationEvidence|null=null,preparationIssue:string|null=null;
  if(prep)try{const parsed=preparationSchema.parse(JSON.parse(prep.evidence_json));if(digest(canonicalJson(parsed))!==prep.evidence_hash||parsed.runId!==row.run_id||parsed.preparedAt!==prep.prepared_at||!session||parsed.selectionHash!==session.selectionHash||parsed.adapterHash!==session.snapshot.adapterBinding.hash)throw new Error();if(parsed.schema===2){assertNativeCapabilityPreparation(session.snapshot,parsed.capabilities);assertPreparationScope(this.store,row.run_id,session.snapshot,parsed);}preparation=parsed;}catch{preparationIssue='RESOURCE_RECOVERY_REQUIRED';}
  let restriction:SessionRunDiagnostic['restriction']=null,restrictionIssue:string|null=null;
  try{const basis=session?.selectionHash??(this.store.sqlite.prepare('SELECT snapshot_hash FROM capability_session_snapshots WHERE task_id=? AND schema_version=0').get(row.task_id) as {snapshot_hash:string}|undefined)?.snapshot_hash;if(basis)restriction=readLaunchRestriction(this.store,row.run_id,row.task_id,basis);else if(this.store.sqlite.prepare('SELECT 1 FROM capability_run_restrictions WHERE run_id=?').get(row.run_id))throw new Error();}catch{restrictionIssue='RESOURCE_RECOVERY_REQUIRED';}
  const observations=this.store.sqlite.prepare('SELECT * FROM capability_bridge_observations WHERE run_id=? ORDER BY observed_at DESC,bridge_id').all(row.run_id) as {bridge_id:string;evidence_json:string;evidence_hash:string;observed_at:string}[];
  let observedAt:string|null=null,bridgeIssue:string|null=null;
  for(const observation of observations)try{const parsed=bridgeSchema.parse(JSON.parse(observation.evidence_json));const child=this.store.sqlite.prepare("SELECT pid,process_started_at FROM capability_run_processes WHERE run_id=? AND process_id=? AND kind='bridge'").get(row.run_id,observation.bridge_id) as {pid:number;process_started_at:string}|undefined;if(parsed.runId!==row.run_id||parsed.bridgeId!==observation.bridge_id||parsed.observedAt!==observation.observed_at||digest(canonicalJson(parsed))!==observation.evidence_hash||!child||parsed.pid!==child.pid||parsed.startedAt!==child.process_started_at)throw new Error();observedAt??=parsed.observedAt;}catch{bridgeIssue='RESOURCE_RECOVERY_REQUIRED';}
  let connected=false;try{connected=current&&!!this.inspector?.channelConnected(row.run_id);}catch{/* display unknown, never infer liveness */}
  if(current&&!connected&&!bridgeIssue)try{bridgeIssue=this.inspector?.recoveryIssue?.(row.run_id)??null;}catch{/* Missing recovery evidence stays unknown. */}
  const skillObservations:NonNullable<SessionRunDiagnostic['skillObservations']>=[];let skillObservationIssue:string|null=null;
  const skillRows=this.store.sqlite.prepare('SELECT * FROM capability_skill_observations WHERE run_id=? LIMIT 513').all(row.run_id) as {app_id:string;skill_id:string;kind:string;evidence_json:string;evidence_hash:string;observed_at:string}[];
  if(skillRows.length>512)skillObservationIssue='RESOURCE_RECOVERY_REQUIRED';
  for(const record of skillRows.slice(0,512))try{
   const value=skillObservationSchema.parse(JSON.parse(record.evidence_json)),fixed=session?.snapshot.packages.find(p=>p.appId===value.appId);
   if(value.cliVersion!==preparation?.cliVersion||value.runId!==row.run_id||value.appId!==record.app_id||value.skillId!==record.skill_id||value.kind!==record.kind||value.observedAt!==record.observed_at||digest(canonicalJson(value))!==record.evidence_hash||fixed?.packageHash!==value.packageHash||!fixed.skills.some(s=>s.skillId===value.skillId)||Date.parse(value.observedAt)<Date.parse(row.started_at)||(row.ended_at&&Date.parse(value.observedAt)>Date.parse(row.ended_at)))throw new Error('invalid historical observation');
   skillObservations.push(value);
  }catch{skillObservationIssue='RESOURCE_RECOVERY_REQUIRED';}
  return{skillObservations,skillObservationIssue,id:row.run_id,state:row.state,startedAt:row.started_at,endedAt:row.ended_at,current,preparation,preparationIssue,restriction,restrictionIssue,bridge:{connected,observedAt,issueCode:bridgeIssue}};
 }
 private directory(resource:ResourceRecord):string{
  const path=this.store.directory(resource),root=path.slice(0,-resource.relativePath.length).replace(/\/$/,'');let current=root;for(const part of ['',...resource.relativePath.split('/')]){if(part)current=join(current,part);const st=lstatSync(current);if(st.isSymbolicLink()||!st.isDirectory())throw new ApplicationError('OWNERSHIP_CONFLICT','原资源目录包含链接或异常归属');}return path;
 }
 private resourceIssue(session:StoredCapabilitySession,appId?:string):string|null{
  let refs=this.store.sqlite.prepare('SELECT ref_id FROM capability_session_refs WHERE task_id=? ORDER BY ref_id').all(session.snapshot.taskId) as {ref_id:string}[];
  try{
  const delivery=session.snapshot.runner==='claude-code'&&!session.snapshot.legacyBinding?readClaudeSlot(this.store,session.snapshot.taskId):null;
  const scoped=!!delivery?.current||appId!==undefined&&session.snapshot.runner==='codex'&&!session.snapshot.legacyBinding;
  const skills=[...session.snapshot.packages.filter(p=>!scoped||appId===undefined||p.appId===appId).flatMap(p=>p.skills),...(appId!==undefined&&session.snapshot.runner==='codex'&&!session.snapshot.legacyBinding?[]:session.snapshot.standardSkills)];
   if(scoped){
    const projectionIds=delivery?.current?[delivery.current.resourceId]:refs.filter(ref=>{const resource=this.store.get(ref.ref_id);if(!['session-projection','agent-projection'].includes(resource.kind))return false;const root=this.store.directory(resource);return skills.some(skill=>{const suffix=relative(root,skill.projectionPath);return !!suffix&&!suffix.startsWith('..')&&!isAbsolute(suffix);});}).map(r=>r.ref_id);
    refs=this.sessions.scopedReferencesCoordinated(session.snapshot.taskId,appId?[appId]:session.snapshot.packages.map(p=>p.appId),projectionIds).map(r=>({ref_id:r.refId}));
   }
   const projectionRoots:string[]=[];for(const ref of refs){const resource=this.store.get(ref.ref_id);const directory=this.directory(resource);if(['session-projection','agent-projection','standard-skill','legacy-static-plugin','legacy-agent-projection','claude-delivery'].includes(resource.kind))projectionRoots.push(directory);if(resource.state!=='ready'||resource.integrity!=='valid')throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原资源未就绪');if(resource.kind==='application-package'){const pack=this.packages.get(resource.contentHash);verifyPackageTree(directory,pack,this.store.storeId);}else if(resource.kind==='runtime')new RuntimeRegistry(this.store).verify(resource.contentHash);else if(this.inspector)this.inspector.verify(resource,session.snapshot,session.discoveryHome);else throw new ApplicationError('CAPABILITY_UNAVAILABLE','完整投影核验尚无所属宿主');}
   for(const skill of skills){const owned=projectionRoots.some(root=>{const suffix=relative(root,skill.projectionPath);return !!suffix&&!suffix.startsWith('..')&&!isAbsolute(suffix);});if(!owned)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原Skill缺少所属投影引用');const st=lstatSync(skill.projectionPath);if(st.isSymbolicLink()||!st.isFile())throw new ApplicationError('OWNERSHIP_CONFLICT','原Skill投影不是受管文件');}return null;}catch(e){return code(e);}
 }
 /** Prepare synchronously before stop revokes the run. Completion writes only
  * the captured historical run, never a current-run display or authorization. */
 prepareStop(taskId:string,runId:string):()=>Promise<void>{
  const noop=async()=>{};
  try{
   const runtime=this.deps.runs();
   if(!runtime||!this.deps.prepareStoppedSkillRead)return noop;
   // The task UI hides a stopping PTY before it invokes this host-owned hook.
   // Authenticate the captured run itself, never a renderer/current-PTY claim.
   const context=runtime.assertActive(runId);
   if(context.run.taskId!==taskId)return noop;
   const session=this.sessions.inspectCoordinated(taskId),through=Date.now();
   const row=this.store.sqlite.prepare('SELECT * FROM capability_runs WHERE run_id=? AND task_id=?').get(runId,taskId) as RunRow|undefined;
   if(!row)return noop;
   const preparation=this.run(row,session).preparation;
   if(!preparation?.cliVersion||preparation.state!=='prepared')return noop;
   const captures=session.snapshot.packages.filter(p=>!context.applicationScope||context.applicationScope.includes(p.appId)).flatMap(pack=>{
    if(this.resourceIssue(session,pack.appId))return [];
    const targets=pack.skills.map(skill=>{const fd=openSync(skill.projectionPath,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>1024*1024)throw new Error('bounded Skill required');const bytes=Buffer.alloc(stat.size);if(readSync(fd,bytes,0,bytes.length,0)!==bytes.length||fstatSync(fd).size!==stat.size)throw new Error('changed Skill');return{id:skill.skillId,nativeName:skill.nativeName,path:skill.projectionPath,content:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};}finally{closeSync(fd);}});
    return [{pack,read:this.deps.prepareStoppedSkillRead!(runId,targets)}];
   });
   let consumed=false;
   return async()=>{
    if(consumed)return;consumed=true;
    if(!context.signal.aborted)return;
    for(const capture of captures){
     try{
      const result=await capture.read();
      await withResourceLock(this.store.root,()=>{
       const current=this.sessions.inspectCoordinated(taskId),stored=this.store.sqlite.prepare('SELECT * FROM capability_runs WHERE run_id=? AND task_id=? AND owner_instance_id=?').get(runId,taskId,runtime.instanceId) as RunRow|undefined;
       if(!stored||stored.started_at!==row.started_at||!['stopping','stopped','failed'].includes(stored.state)||current.pointer.snapshotHash!==session.pointer.snapshotHash||this.resourceIssue(current,capture.pack.appId))return;
       const history=this.run(stored,current);
       if(history.preparationIssue||history.preparation?.cliVersion!==preparation.cliVersion||history.skillObservationIssue)return;
       const upper=Math.min(through,stored.ended_at?Date.parse(stored.ended_at):through);
       for(const [kind,observations] of [['read',result.reads],['discovery',result.discoveries]] as const)for(const observation of observations){
        const value=skillObservationSchema.parse({runId,appId:capture.pack.appId,skillId:observation.skillId,kind,packageHash:capture.pack.packageHash,recordHash:observation.recordHash,observedAt:observation.observedAt,cliVersion:preparation.cliVersion});
        if(!capture.pack.skills.some(s=>s.skillId===value.skillId)||Date.parse(value.observedAt)<Date.parse(stored.started_at)||Date.parse(value.observedAt)>upper)continue;
        const text=canonicalJson(value);this.store.sqlite.prepare('INSERT OR IGNORE INTO capability_skill_observations VALUES(?,?,?,?,?,?,?)').run(runId,value.appId,value.skillId,kind,text,digest(text),value.observedAt);
       }
      });
     }catch{/* Failed diagnostic collection must not interfere with stop. */}
    }
   };
  }catch{return noop;}
 }
 async inspect(taskId:string,expectedRunId?:string):Promise<ApplicationSessionDiagnostic>{
  const before=await this.inspectBase(taskId),runId=before.currentRun?.id;
  if(!runId||(expectedRunId!==undefined&&runId!==expectedRunId)||!this.deps.skillReads)return before;
  const observed=new Map<string,SkillReadObservation[]>(),discovered=new Map<string,SkillReadObservation[]>();
  for(const app of before.applications){
   if(app.resourceState!=='verified'||!app.skills.length)continue;
   try{
    const targets=app.skills.map(skill=>{const fd=openSync(skill.projectionPath,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>1024*1024)throw new Error('bounded Skill source required');const bytes=Buffer.alloc(stat.size);if(readSync(fd,bytes,0,bytes.length,0)!==bytes.length||fstatSync(fd).size!==stat.size)throw new Error('Skill source changed');return {id:skill.id,nativeName:skill.name,path:skill.projectionPath,content:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};}finally{closeSync(fd);}});
    observed.set(app.appId,await this.deps.skillReads(runId,targets));
    if(this.deps.skillDiscoveries)discovered.set(app.appId,await this.deps.skillDiscoveries(runId,targets));
   }catch{/* Unavailable evidence remains unverified. */}
  }
  // Native IO is outside the resource coordinator; reacquire it for a fresh view.
  const fresh=await this.inspectBase(taskId);
  if(fresh.currentRun?.id!==runId||fresh.snapshotHash!==before.snapshotHash)return fresh;
  for(const app of fresh.applications){
   const original=before.applications.find(a=>a.appId===app.appId);
   if(app.resourceState!=='verified'||original?.packageHash!==app.packageHash||JSON.stringify(original.skills)!==JSON.stringify(app.skills))continue;
   // Retain already verified evidence only from this still-owned run. Bounded
   // log tails can move past a successful read; that does not undo the event.
   // Stored metadata intentionally omits native call IDs; never invent one.
   const retained=fresh.currentRun.skillObservationIssue?[]:(fresh.currentRun.skillObservations??[]).filter(item=>item.runId===runId&&item.appId===app.appId&&item.packageHash===app.packageHash&&Date.parse(item.observedAt)<=Date.now());
   const merge=(kind:'read'|'discovery',latest:SkillReadObservation[])=>{
    const bySkill=new Map<string,{skillId:string;observedAt:string;callId:string|null;recordHash:string;runId:string}>();
    for(const item of retained.filter(item=>item.kind===kind))bySkill.set(item.skillId,{skillId:item.skillId,observedAt:item.observedAt,recordHash:item.recordHash,runId,callId:null});
    for(const item of latest)bySkill.set(item.skillId,{...item,runId});
    return [...bySkill.values()];
   };
   const reads=merge('read',observed.get(app.appId)??[]);
   app.evidence.skillReadObservations=reads;
   if(app.skills.length&&app.skills.every(s=>reads.some(r=>r.skillId===s.id)))app.evidence.skillRead='verified';
   const discovery=merge('discovery',discovered.get(app.appId)??[]);app.evidence.skillDiscoveryObservations=discovery;
   if(app.skills.length&&app.skills.every(s=>discovery.some(r=>r.skillId===s.id)))app.evidence.skillDiscovery='verified';
  }
  await withResourceLock(this.store.root,()=>{
   const pty=this.deps.activePty?.(taskId),run=pty?this.deps.runs()?.currentNativeRun(taskId,pty):null;if(run?.runId!==runId)return;
   const session=this.sessions.inspectCoordinated(taskId);
   for(const app of fresh.applications){
    if(app.resourceState!=='verified'||this.resourceIssue(session,app.appId))continue;
    const fixed=session.snapshot.packages.find(p=>p.appId===app.appId);if(fixed?.packageHash!==app.packageHash)continue;
    const version=fresh.currentRun?.preparation?.cliVersion;if(!version)continue;
    for(const [kind,observations] of [['read',app.evidence.skillReadObservations],['discovery',app.evidence.skillDiscoveryObservations]] as const)for(const item of observations??[]){
     const value=skillObservationSchema.parse({runId,appId:app.appId,skillId:item.skillId,kind,packageHash:app.packageHash,recordHash:item.recordHash,observedAt:item.observedAt,cliVersion:version});
     if(!fixed.skills.some(s=>s.skillId===value.skillId)||Date.parse(value.observedAt)<Date.parse(run.startedAt)||Date.parse(value.observedAt)>Date.now())continue;
     const text=canonicalJson(value);this.store.sqlite.prepare('INSERT OR IGNORE INTO capability_skill_observations VALUES(?,?,?,?,?,?,?)').run(runId,app.appId,value.skillId,kind,text,digest(text),value.observedAt);
    }
   }
  });
  return fresh;
 }
 private inspectBase(taskId:string):Promise<ApplicationSessionDiagnostic>{id.parse(taskId);return withResourceLock(this.store.root,()=>{
  const db=this.store.sqlite,task=db.prepare('SELECT id,project_id,title,runner,CASE WHEN native_session_id IS NOT NULL OR runtime_snapshot IS NOT NULL THEN 1 ELSE 0 END AS has_history FROM tasks WHERE id=?').get(taskId) as {id:string;project_id:string|null;title:string;runner:string;has_history:number}|undefined;if(!task)throw new ApplicationError('NOT_FOUND','该任务已删除，不能把其他会话当作原任务');
  const row=db.prepare('SELECT schema_version,snapshot_hash,legacy_status FROM capability_session_snapshots WHERE task_id=?').get(taskId) as {schema_version:number;snapshot_hash:string;legacy_status:string}|undefined;
  let session:StoredCapabilitySession|null=null,selection:ApplicationSessionDiagnostic['selection']=row||task.has_history?'unknown-history':'not-recorded';const issues:string[]=[];
  if(row&&row.schema_version!==2&&!(row.schema_version===0&&row.legacy_status==='history-unknown')){selection=row.schema_version===0?'corrupt':'unsupported-schema';issues.push(row.schema_version===0?'SNAPSHOT_CORRUPT':'HOST_INCOMPATIBLE');}
  if(row?.schema_version===2)try{session=this.sessions.inspectCoordinated(taskId);if(session.snapshot.projectId!==task.project_id||session.snapshot.runner!==(task.runner==='claude'?'claude-code':'codex'))throw new ApplicationError('SNAPSHOT_CORRUPT','任务与原会话身份不符');selection='fixed';if(session.retention==='hold')issues.push('SESSION_ON_HOLD');}catch(e){session=null;selection='corrupt';issues.push(code(e));}
  // Find the owned terminal independently of wall-clock order. A clock rollback
  // must not let future-dated history hide the live run or reuse its call counts.
  let ownedRunId:string|null=null;try{const ptyId=this.deps.activePty?.(taskId);if(ptyId)ownedRunId=this.deps.runs()?.currentNativeRun(taskId,ptyId)?.runId??null;}catch{/* unknown ownership stays unverified */}
  const currentRow=ownedRunId?db.prepare('SELECT * FROM capability_runs WHERE task_id=? AND run_id=?').get(taskId,ownedRunId) as RunRow|undefined:undefined;
  const candidate=currentRow?this.run(currentRow,session):null,currentRun=candidate?.current?candidate:null;
  const runRows=db.prepare('SELECT * FROM capability_runs WHERE task_id=? AND (? IS NULL OR run_id<>?) ORDER BY started_at DESC,run_id DESC LIMIT 5').all(taskId,currentRun?.id??null,currentRun?.id??null) as RunRow[],runs=runRows.map(r=>this.run(r,session));
  const resourceIssue=session?this.resourceIssue(session):null;if(resourceIssue)issues.push(resourceIssue);
  const selected=task.project_id?db.prepare('SELECT app_id FROM application_project_settings WHERE project_id=? AND enabled=1').all(task.project_id) as {app_id:string}[]:[];
  const appIds=new Set([...selected.map(s=>s.app_id),...session?.snapshot.packages.map(p=>p.appId)??[]]);
  let excluded:ReturnType<typeof readApplicationRunScope>=null;
  if(currentRun&&session)try{excluded=readApplicationRunScope(this.store,currentRun.id,session.snapshot);}catch{issues.push('RESOURCE_RECOVERY_REQUIRED');}
  const applications:SessionApplicationDiagnostic[]=[];
  for(const name of appIds){if(name!=='mail'&&name!=='zentao')continue;const appId:ApplicationId=name,fixed=session?.snapshot.packages.find(p=>p.appId===appId);let defaultVersion:string|null=null;try{const active=this.packages.active(appId);if(active)defaultVersion=this.packages.get(active.packageHash).version;}catch{/* keep fixed identity, do not substitute default */}
   let policy:SessionApplicationDiagnostic['policy']='unverified';try{if(task.project_id){this.selections.requireEnabled(task.project_id,appId);policy='enabled';}}catch{policy='disabled';}
   const connections:SessionApplicationDiagnostic['connections']=[];
   for(const slot of (appId==='mail'?['foxmail','smtp']:['zentao']) as ApplicationProvider[]){
    const original=fixed?.bindings.find(b=>b.bindingId.endsWith(':'+slot));let originalName:string|null=null;if(original)try{originalName=this.connections.get(original.connectionId).name;}catch{/* preserve original id even if metadata is missing */}
    let connectionId:string|null=null,selectionState:'same'|'changed'|'missing'|'unverified'='unverified';try{if(task.project_id){const selected=this.selections.connectionSlot(task.project_id,appId,slot);connectionId=selected.connectionId;selectionState=connectionId?(original?.connectionId===connectionId&&original.identityRevision===selected.identityRevision?'same':'changed'):'missing';}}catch{/* disabled or corrupt slot does not grant */}
    let label:string|null=null,health='unverified',testedAt:string|null=null,compatibility:'compatible'|'incompatible'|'unverified'='unverified',issueCode:string|null=null;
    if(connectionId)try{const c=this.connections.get(connectionId);label=c.name;health=!c.enabled?'disabled':c.authorization!=='connected'?'disconnected':c.health;testedAt=c.testedAt;if(fixed){packageConnectionView(this.store,fixed.packageHash,c);compatibility='compatible';}}catch(e){issueCode=code(e);if(issueCode==='CONFIG_INCOMPATIBLE')compatibility='incompatible';}
    connections.push({slot,id:connectionId,name:label,originalId:original?.connectionId??null,originalName,health,testedAt,selection:selectionState,compatibility,issueCode});
   }
   const usage=currentRun&&fixed?db.prepare('SELECT COUNT(*) AS total,SUM(CASE WHEN state=\'succeeded\' THEN 1 ELSE 0 END) AS successes,MAX(started_at) AS latest FROM application_invocations WHERE task_id=? AND project_id=? AND run_id=? AND app_id=? AND package_hash=?').get(taskId,task.project_id,currentRun.id,appId,fixed.packageHash) as {total:number;successes:number|null;latest:string|null}:null;
   const latest=currentRun&&fixed?db.prepare('SELECT error_code,effect_state FROM application_invocations WHERE task_id=? AND project_id=? AND run_id=? AND app_id=? AND package_hash=? ORDER BY started_at DESC,operation_id DESC LIMIT 1').get(taskId,task.project_id,currentRun.id,appId,fixed.packageHash) as {error_code:string|null;effect_state:string|null}|undefined:undefined;
   const appResourceIssue=session&&fixed?this.resourceIssue(session,appId):null;if(appResourceIssue)issues.push(appResourceIssue);
   applications.push({appId,name:appId==='mail'?'邮件':'禅道',fixedVersion:fixed?.version??null,defaultVersion,packageHash:fixed?.packageHash??null,policy,resourceState:fixed?(appResourceIssue?'unavailable':'verified'):'unverified',issueCode:excluded?.excludedApplications?.find(p=>p.appId===appId)?.code??(currentRun?.preparation?.issueCode==='RESOURCE_BUSY'&&!currentRun.restrictionIssue?'RESOURCE_BUSY':appResourceIssue??currentRun?.restrictionIssue??currentRun?.restriction?.issueCode??currentRun?.preparation?.issueCode??null),skills:fixed?.skills.map(s=>({id:s.skillId,name:s.nativeName,sourceHash:s.contentHash,projectionPath:s.projectionPath}))??[],permissions:fixed?.allowedOperations??[],connections,evidence:{skillDiscovery:'unverified',skillRead:'unverified',toolRequests:usage?.total??0,successfulToolRequests:usage?.successes??0,latestToolAt:usage?.latest??null,latestErrorCode:latest?.error_code??null,latestEffectState:latest?.effect_state??null}});
  }
  const deliveryCopies=task.runner==='claude'?inspectClaudeDeliveryCopies(this.store,taskId):null;
  return{taskId,projectId:task.project_id,title:task.title,runner:task.runner,selection,snapshotHash:row?.snapshot_hash??null,agentState:this.deps.activePty?(this.deps.activePty(taskId)?'running':'stopped'):'unverified',canNewSession:!!task.project_id&&!!db.prepare('SELECT 1 FROM projects WHERE id=? AND archived_at IS NULL').get(task.project_id),createdCliVersion:session?.snapshot.agentAtCreation.version??null,currentRun,recentRuns:runs.filter(r=>!r.current).slice(0,5),applications,deliveryCopies,issues:[...new Set(issues)],checkedAt:new Date().toISOString()};
 });}
}
