import {ApplicationError} from '@shared/applications';
import type {ApplicationCapability,ApplicationEntry,ApplicationPackageManifest} from '@shared/application-capabilities';
import {applicationRunPlanSchema,type ApplicationRunPlan,type RunPlanAllowedCapability} from '@shared/application-run-plan';
import type {CapabilitySessionSnapshot} from '@shared/application-session';
import {storedCapabilitySessionSnapshotSchema} from '@shared/application-session-v3';
import type {ResourceStore} from './resource-store';
import {canonicalJson,compareCodePoints,digest} from './manifest';

export interface RunPlanAvailability {mcp:boolean;cli:boolean;reason?:string}
export interface RunPlanApplication {manifest:ApplicationPackageManifest;packageHash:string;capabilities:readonly ApplicationCapability[]}
export function selectCapabilityEntry(capability:ApplicationCapability,available:RunPlanAvailability):{entry:ApplicationEntry|null;fallback:boolean;reason:string|null}{
  const primary:ApplicationEntry=capability.binding.cli?'cli':'mcp';
  if(available[primary])return{entry:primary,fallback:false,reason:null};
  const fallback=capability.binding.fallback,entry=fallback&&('mcp'in fallback?'mcp':'cli');
  if(capability.semantics==='read'&&entry&&available[entry])return{entry,fallback:true,reason:available.reason??`${primary} unavailable`};
  return{entry:null,fallback:false,reason:available.reason??`${primary} unavailable; no permitted fallback`};
}
export interface SkillRenderParameters {appId:string;entrypoints:readonly {capabilityId:string;entry:ApplicationEntry;invocation:string}[]}
/** Explicit, data-only substitutions. Secrets, endpoints and arbitrary environment values are never inputs. */
export function renderSkillTemplate(template:Buffer,parameters:SkillRenderParameters):{bytes:Buffer;templateHash:string;parametersHash:string;renderedHash:string}{
  const text=template.toString('utf8');if(!Buffer.from(text).equals(template))throw new ApplicationError('INVALID_PACKAGE','Skill模板必须为完整UTF-8');
  const values:Record<string,string>={WILLYOU_APPLICATION:parameters.appId,WILLYOU_ENTRYPOINTS:parameters.entrypoints.map(c=>`- ${c.capabilityId}: ${c.invocation}`).join('\n')||'本次运行没有可调用的应用能力。'};
  const rendered=text.replace(/\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g,(_match,key:string)=>{if(!Object.hasOwn(values,key))throw new ApplicationError('INVALID_PACKAGE','Skill模板包含未支持的占位符');return values[key];});
  const bytes=Buffer.from(rendered);return{bytes,templateHash:digest(template),parametersHash:digest(canonicalJson(parameters)),renderedHash:digest(bytes)};
}
export const skillFilesHash=(files:Readonly<Record<string,Buffer>>):string=>digest(canonicalJson(Object.entries(files).sort(([a],[b])=>compareCodePoints(a,b)).map(([path,bytes])=>({path,size:bytes.length,sha256:digest(bytes)}))));
export function createApplicationRunPlan(input:{runId:string;snapshotHash:string;snapshot:CapabilitySessionSnapshot;applications:readonly RunPlanApplication[];available:RunPlanAvailability;skills:ApplicationRunPlan['skills'];cliVersion?:string;sandbox?:ApplicationRunPlan['sandbox'];now?:string}):ApplicationRunPlan{
  const {snapshot}=input,allowed:RunPlanAllowedCapability[]=[],applications:ApplicationRunPlan['applications']=[];
  for(const selected of snapshot.packages){
    const source=input.applications.find(a=>a.packageHash===selected.packageHash&&a.manifest.appId===selected.appId);
    if(!source)throw new ApplicationError('SCOPE_DENIED','运行计划缺少原固定应用');
    const choices=source.capabilities.filter(c=>selected.allowedOperations.includes(c.permission)).map(capability=>({capability,...selectCapabilityEntry(capability,input.available)}));
    const entries=new Set(choices.flatMap(c=>c.entry?[c.entry]:[]));
    applications.push({appId:selected.appId,packageHash:selected.packageHash,primaryEntry:source.manifest.schema==='smartdd-app-package-v2'?source.manifest.entry:'mcp',effectiveEntry:entries.size>1?'mixed':entries.values().next().value??'unavailable',fallback:choices.some(c=>c.fallback),reason:choices.find(c=>c.reason)?.reason??null});
    for(const choice of choices){
      if(!choice.entry)continue;
      const bindings=[choice.capability.binding,choice.capability.binding.fallback].filter(b=>!!b);
      const mcpTool=bindings.flatMap(b=>'mcp'in b&&b.mcp?[b.mcp.tool]:[])[0],cliCommand=bindings.flatMap(b=>'cli'in b&&b.cli?[b.cli.command]:[])[0];
      allowed.push({capabilityId:choice.capability.id,contractMajor:choice.capability.contractMajor,appId:selected.appId,packageHash:selected.packageHash,entry:choice.entry,...(mcpTool?{mcpTool}:{}),...(cliCommand?{cliCommand}:{})});
    }
  }
  const binding={id:snapshot.adapterBinding.id,version:snapshot.adapterBinding.version,hash:snapshot.adapterBinding.hash};
  const payload={schema:'willyou-application-run-plan-v1' as const,runId:input.runId,taskId:snapshot.taskId,projectId:snapshot.projectId,snapshotHash:input.snapshotHash,runner:binding,capabilityAdapter:binding,cliVersion:input.cliVersion??snapshot.agentAtCreation.version,grades:{skill:true,mcp:input.available.mcp,cli:input.available.cli,configuration:true,discoveryObserved:false,userMessageObserved:false,evidence:[`agent-adapter:${binding.id}:${binding.hash}`]},applications,allowed,skills:input.skills,sandbox:input.sandbox??{source:'unchanged-user-policy',digest:null},createdAt:input.now??new Date().toISOString()};
  return verifyApplicationRunPlan({...payload,planHash:digest(canonicalJson(payload))});
}
export function verifyApplicationRunPlan(value:unknown,expectedHash?:string):ApplicationRunPlan{
  const parsed=applicationRunPlanSchema.safeParse(value);if(!parsed.success)throw new ApplicationError('HASH_MISMATCH','运行计划结构无法核验');
  const {planHash,...payload}=parsed.data;
  if(planHash!==digest(canonicalJson(payload))||expectedHash!==undefined&&planHash!==expectedHash)throw new ApplicationError('HASH_MISMATCH','运行计划摘要不符，拒绝应用能力');
  const freeze=(value:unknown):void=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}};freeze(parsed.data);return parsed.data;
}
const operationId=(runId:string)=>'application-run-plan:'+runId;
/** Called inside the coordinator's existing transaction; plans are immutable audit records. */
export function storeApplicationRunPlan(store:ResourceStore,plan:ApplicationRunPlan):void{
  verifyApplicationRunPlan(plan);const id=operationId(plan.runId),bytes=canonicalJson(plan),known=store.sqlite.prepare('SELECT kind,owner_store_id,state,plan_json FROM capability_resource_operations WHERE operation_id=?').get(id) as {kind:string;owner_store_id:string;state:string;plan_json:string}|undefined;
  if(known){if(known.kind!=='application-run-plan'||known.owner_store_id!==store.storeId||known.state!=='committed'||known.plan_json!==bytes)throw new ApplicationError('SNAPSHOT_IMMUTABLE','运行计划已固定，不能替换');return;}
  store.sqlite.prepare("INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at) VALUES(?,'application-run-plan',?,'committed',?,?,?)").run(id,store.storeId,bytes,plan.createdAt,plan.createdAt);
}
export function readApplicationRunPlan(store:ResourceStore,runId:string,expectedHash:string):ApplicationRunPlan{
  const row=store.sqlite.prepare('SELECT kind,owner_store_id,state,plan_json FROM capability_resource_operations WHERE operation_id=?').get(operationId(runId)) as {kind:string;owner_store_id:string;state:string;plan_json:string}|undefined;
  if(!row||row.kind!=='application-run-plan'||row.owner_store_id!==store.storeId||row.state!=='committed')throw new ApplicationError('HASH_MISMATCH','固定运行计划缺失');
  let value:unknown;try{value=JSON.parse(row.plan_json);}catch{throw new ApplicationError('HASH_MISMATCH','固定运行计划无法解析');}
  const plan=verifyApplicationRunPlan(value,expectedHash);if(plan.runId!==runId)throw new ApplicationError('SCOPE_DENIED','运行计划不属于当前运行');return plan;
}
/** A first native session id is host-bound once; it does not replace the fixed source selection. */
export function assertRunPlanSnapshotSource(store:ResourceStore,plan:ApplicationRunPlan,snapshot:CapabilitySessionSnapshot,currentHash:string):void{
  if(plan.taskId!==snapshot.taskId||plan.projectId!==snapshot.projectId)throw new ApplicationError('SCOPE_DENIED','运行计划不能替换固定会话身份');
  if(plan.snapshotHash===currentHash)return;
  const row=store.sqlite.prepare('SELECT snapshot_json FROM capability_snapshot_versions WHERE task_id=? AND snapshot_hash=?').get(snapshot.taskId,plan.snapshotHash) as {snapshot_json:string}|undefined;
  try{
    const original=storedCapabilitySessionSnapshotSchema.parse(JSON.parse(row?.snapshot_json??''));
    if(digest(canonicalJson(original))!==plan.snapshotHash||original.native.sessionId!==null||!snapshot.native.sessionId||canonicalJson({...snapshot,native:{...snapshot.native,sessionId:null}})!==canonicalJson(original))throw Error();
  }catch{throw new ApplicationError('SCOPE_DENIED','运行计划来源与原固定选择不同');}
}
export function requirePlanEntry(plan:ApplicationRunPlan,capabilityId:string,contractMajor:number,entry:ApplicationEntry):RunPlanAllowedCapability{
  const capability=plan.allowed.find(c=>c.capabilityId===capabilityId&&c.contractMajor===contractMajor);
  if(!capability)throw new ApplicationError('SCOPE_DENIED','能力不在本次运行允许表中');
  if(capability.entry!==entry)throw new ApplicationError('ENTRY_NOT_ACTIVE','本次运行未启用该入口');return capability;
}
