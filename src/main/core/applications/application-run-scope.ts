import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import {capabilitySessionSnapshotSchema,type CapabilitySessionSnapshotV2} from '@shared/application-session';
import {canonicalJson,digest} from './manifest';
import {selectionHash} from './session-registry';
import type {ResourceStore} from './resource-store';
import type {RunContext} from './run-registry';
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().min(1).max(512);
const exclusionSchema=z.object({appId:z.string().min(1).max(20),packageHash:hash,code:z.enum(['CAPABILITY_UNAVAILABLE','AGENT_CAPABILITY_NAME_CONFLICT','HOST_INCOMPATIBLE'])}).strict();
export type ApplicationScopeExclusion=z.infer<typeof exclusionSchema>;
const scopeFields=z.object({schema:z.literal(1),runId:z.uuid(),taskId:id,projectId:id,runner:z.enum(['claude-code','codex']),snapshotHash:hash,selectionHash:hash,ownerInstanceId:z.uuid(),ownerPid:z.number().int().positive(),ownerStartedAt:z.string().min(1),applications:z.array(z.object({appId:z.string().min(1).max(20),packageHash:hash}).strict()).min(1).max(32),excludedApplications:z.array(exclusionSchema).max(32).optional(),roots:z.array(z.object({refId:id,refKind:id,refHash:hash,relativePath:id}).strict()).min(1).max(4096),createdAt:z.iso.datetime(),evidenceHash:hash}).strict();
export const applicationRunScopeSchema=z.discriminatedUnion('schema',[scopeFields,scopeFields.extend({schema:z.literal(2),mode:z.literal('independent-capabilities'),applications:z.array(scopeFields.shape.applications.element).length(0)})]);
export type ApplicationRunScope=z.infer<typeof applicationRunScopeSchema>;
export const applicationScopeOperationId=(runId:string)=>'application-run-scope:'+runId;
const invalid=()=>new ApplicationError('RESOURCE_RECOVERY_REQUIRED','本轮应用范围依据无法核验，保留原运行和资源');
/** An independent receipt cannot retain execution roots from an unavailable app.
 * Validate metadata edges only here;ordinary preparation still verifies all bytes. */
export function assertIndependentRoots(store:ResourceStore,roots:readonly {refId:string}[]):void{
 const done=new Set<string>(),visiting=new Set<string>();
 const visit=(id:string,depth:number):void=>{if(visiting.has(id)||depth>256||done.size+visiting.size>=10000)throw invalid();if(done.has(id))return;const r=store.get(id);if(r.kind==='application-package'||r.kind==='runtime')throw invalid();visiting.add(id);for(const edge of store.sqlite.prepare('SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=?').all(id) as {dependency_id:string}[])visit(edge.dependency_id,depth+1);visiting.delete(id);done.add(id);};
 for(const root of roots)visit(root.refId,0);
}
/** Immutable C operation receipt, not a caller-supplied permission. Never infer
 * a full grant if this receipt is missing from a scoped owned run. */
export function assertScopeExclusions(snapshot:CapabilitySessionSnapshotV2,scope:ApplicationRunScope):void{
 if(!scope.excludedApplications)return;
 const excluded=snapshot.packages.filter(p=>!scope.applications.some(a=>a.appId===p.appId));
 if(scope.excludedApplications.length!==excluded.length||new Set(scope.excludedApplications.map(p=>p.appId)).size!==excluded.length||scope.excludedApplications.some(p=>!excluded.some(e=>e.appId===p.appId&&e.packageHash===p.packageHash)))throw invalid();
}
export function readApplicationRunScope(store:ResourceStore,runId:string,snapshot:CapabilitySessionSnapshotV2,expectedHash?:string):ApplicationRunScope|null{
 const row=store.sqlite.prepare('SELECT kind,state,owner_store_id,plan_json,created_at,updated_at FROM capability_resource_operations WHERE operation_id=?').get(applicationScopeOperationId(runId)) as {kind:string;state:string;owner_store_id:string;plan_json:string;created_at:string;updated_at:string}|undefined;
 if(!row){if(expectedHash)throw invalid();return null;}
 try{
  const value=applicationRunScopeSchema.parse(JSON.parse(row.plan_json)),{evidenceHash,...payload}=value;
  if(row.kind!=='application-run-scope'||row.state!=='committed'||row.owner_store_id!==store.storeId||row.created_at!==value.createdAt||row.updated_at!==value.createdAt||digest(canonicalJson(payload))!==evidenceHash||expectedHash&&evidenceHash!==expectedHash||value.runId!==runId||value.taskId!==snapshot.taskId||value.projectId!==snapshot.projectId||value.runner!==snapshot.runner||value.selectionHash!==selectionHash(snapshot)||new Set(value.applications.map(p=>p.appId)).size!==value.applications.length||new Set(value.roots.map(r=>r.refId)).size!==value.roots.length||value.applications.some(p=>!snapshot.packages.some(s=>s.appId===p.appId&&s.packageHash===p.packageHash)))throw invalid();
  assertScopeExclusions(snapshot,value);if(value.schema===2)assertIndependentRoots(store,value.roots);
  const run=store.sqlite.prepare('SELECT task_id,project_id,runner,snapshot_hash,owner_instance_id,owner_pid,owner_started_at FROM capability_runs WHERE run_id=?').get(runId) as {task_id:string;project_id:string;runner:string;snapshot_hash:string;owner_instance_id:string;owner_pid:number;owner_started_at:string}|undefined;
  if(!run||run.task_id!==value.taskId||run.project_id!==value.projectId||run.runner!==value.runner||run.owner_instance_id!==value.ownerInstanceId||run.owner_pid!==value.ownerPid||run.owner_started_at!==value.ownerStartedAt||run.snapshot_hash!==digest(canonicalJson(snapshot)))throw invalid();
  if(value.snapshotHash!==run.snapshot_hash){const prior=store.sqlite.prepare('SELECT snapshot_json,selection_hash FROM capability_snapshot_versions WHERE task_id=? AND snapshot_hash=?').get(value.taskId,value.snapshotHash) as {snapshot_json:string;selection_hash:string}|undefined;if(!prior)throw invalid();const old=capabilitySessionSnapshotSchema.parse(JSON.parse(prior.snapshot_json));if(old.taskId!==snapshot.taskId||digest(canonicalJson(old))!==value.snapshotHash||selectionHash(old)!==value.selectionHash||prior.selection_hash!==value.selectionHash)throw invalid();}
  return value;
 }catch{throw invalid();}
}
export function assertRunApplication(context:RunContext,appId:string):void{
 if(context.applicationScope&&!context.applicationScope.includes(appId)){const reason=context.excludedApplications?.find(p=>p.appId===appId);throw new ApplicationError(reason?.code??'CAPABILITY_UNAVAILABLE',reason?.code==='AGENT_CAPABILITY_NAME_CONFLICT'?'本轮此应用与用户原生能力名称或启停配置冲突，保留用户配置及原选择':'本轮此应用能力暂不可用，原选择保留；修复后可正常停止并继续会话');}
}
