import {z} from 'zod';
import {agentLoadRequestSchema} from '@shared/agent-adapters';
import {constants,closeSync,fstatSync,lstatSync,openSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {ApplicationError} from '@shared/applications';
import type {AgentLoadRequest} from '@shared/agent-adapters';
import {canonicalJson,digest} from './manifest';
import {assertDiscoveryPath,legacyDiscoveryEntry,verifyLegacyDiscoveryEntry} from './legacy-discovery';
import {verifyOwnedBundle} from './owned-bundle';
import type {ResourceStore} from './resource-store';
type Entry=NonNullable<AgentLoadRequest['catalog']>['entries'][number];
const recovery=()=>new ApplicationError('RESOURCE_RECOVERY_REQUIRED','共享发现目录的当前占用或加载依据已变化');
function boundedJson(home:string,path:string,max=4*1024*1024):Record<string,unknown>{
 try{assertDiscoveryPath(home,path);const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>max)throw recovery();const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const before=fstatSync(fd),bytes=readFileSync(fd),after=fstatSync(fd),current=lstatSync(path);if(before.dev!==st.dev||before.ino!==st.ino||before.size!==st.size||bytes.length!==st.size||after.ctimeMs!==before.ctimeMs||after.mtimeMs!==before.mtimeMs||after.size!==before.size||current.dev!==before.dev||current.ino!==before.ino||current.ctimeMs!==before.ctimeMs)throw recovery();const value=JSON.parse(bytes.toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw recovery();return value;}finally{closeSync(fd);}
 }catch{throw recovery();}
}
/** Physical ownership only.No source readiness or execution grant is inferred. */
export function verifyModernDiscoveryProjection(entry:Entry,home:string):void{
 if(entry.format)throw new ApplicationError('HOST_INCOMPATIBLE','旧投影沿用原格式核验，不参与新格式排除');
 if(entry.path!==join(home,'.agents/skills',entry.nativeName,'SKILL.md'))throw new ApplicationError('OWNERSHIP_CONFLICT','投影越过实际发现根');
 try{const marker=boundedJson(home,join(dirname(entry.path),'.willyou-owned-bundle.json'),4096);if(marker.schema!==1||marker.storeId!==entry.storeId||marker.hash!==entry.projectionHash)throw Error('unknown owner');}
 catch{throw new ApplicationError('OWNERSHIP_CONFLICT','原投影路径当前不具有原受管归属');}
 const manifest=verifyOwnedBundle(dirname(entry.path),entry.projectionHash,entry.storeId);
 if(manifest.metadata.kind!=='codex-agent-projection-v1'||manifest.metadata.homeId!==digest(home)||manifest.metadata.nativeName!==entry.nativeName||manifest.metadata.sourceHash!==entry.sourceHash)throw new ApplicationError('HASH_MISMATCH','原投影内容或原生身份不同');
}

/** A retention candidate is not an ownership claim. Legacy identity must still
 * match the complete registered entry before any physical failure can be omitted. */
export function nativeGuardEntryUnavailable(entry:Entry,home:string,legacy=false):boolean{
 if(entry.format){
  if(!legacy)throw new ApplicationError('SCOPE_DENIED','旧格式目录不能使用现代加载排除');
  const match=/^smartdd-([a-z][a-z0-9-]{0,63})-([a-f0-9]{16})$/.exec(entry.nativeName);
  if(!match||canonicalJson(legacyDiscoveryEntry(entry.storeId,home,match[1],entry.sourceHash))!==canonicalJson(entry))throw recovery();
 }
 try{if(entry.format)verifyLegacyDiscoveryEntry(entry,home);else verifyModernDiscoveryProjection(entry,home);return false;}
 catch(error){
  if(error instanceof ApplicationError&&['HASH_MISMATCH','OWNERSHIP_CONFLICT',...(entry.format?['RESOURCE_RECOVERY_REQUIRED']:[])].includes(error.code))return true;
  if(entry.format&&['ENOENT','ENOTDIR','EACCES','EPERM','ELOOP'].includes((error as NodeJS.ErrnoException).code??''))return true;
  throw error;
 }
}

interface CatalogBinding {runId:string;taskId:string;projectId:string;runner:'claude-code'|'codex';home:string;catalog:NonNullable<AgentLoadRequest['catalog']>}
function boundCatalog(store:ResourceStore,input:CatalogBinding){
 const {catalog,home}=input,homeId=digest(home);if(digest(canonicalJson({homeId,entries:catalog.entries}))!==catalog.generation)throw recovery();
 const root=join(home,'.agents/smartdd-runtime'),marker=boundedJson(home,join(root,'.willyou-catalog-root.json'),4096),raw=boundedJson(home,join(root,'catalog.json'));
 if(marker.schema!==1||marker.owner!=='SmartDD'||marker.homeId!==homeId||marker.initialized!==true||raw.schema!==1||raw.homeId!==homeId||raw.generation!==catalog.generation||canonicalJson(raw.entries)!==canonicalJson(catalog.entries))throw recovery();
 const run=store.sqlite.prepare('SELECT task_id,project_id,runner,snapshot_hash,bindings_json,owner_instance_id,owner_pid,owner_started_at,pty_id,state,revocation_state FROM capability_runs WHERE run_id=?').get(input.runId) as {task_id:string;project_id:string;runner:string;snapshot_hash:string;bindings_json:string;owner_instance_id:string;owner_pid:number;owner_started_at:string;pty_id:string;state:string;revocation_state:string}|undefined;
 if(!run||run.task_id!==input.taskId||run.project_id!==input.projectId||run.runner!==input.runner||run.owner_pid!==process.pid||!['preparing','prepared','active'].includes(run.state)||run.revocation_state!=='open')throw recovery();
 const consumer=boundedJson(home,join(root,'catalog-consumers',store.storeId+'-'+input.runId+'.json'),16384),owner=consumer.owner as Record<string,unknown>|undefined;
 if(consumer.schema!==1||consumer.homeId!==homeId||consumer.generation!==catalog.generation||consumer.runner!==input.runner||consumer.runId!==input.runId||consumer.ptyId!==run.pty_id||!['preparing','active'].includes(String(consumer.phase))||!owner||owner.storeId!==store.storeId||owner.uFingerprint!==digest(dirname(store.root))||owner.instanceId!==run.owner_instance_id||owner.pid!==run.owner_pid||owner.startedAt!==run.owner_started_at)throw recovery();
 return run;
}
function unverifiedPaths(catalog:CatalogBinding['catalog'],home:string,paths:readonly string[],selectedPaths:readonly string[],legacy=false):Set<string>{
 if(new Set(paths).size!==paths.length)throw recovery();const excluded=new Set(paths);
 for(const path of excluded){const entry=catalog.entries.find(e=>e.path===path);if(!entry||entry.format&&!legacy||selectedPaths.includes(path))throw new ApplicationError('SCOPE_DENIED','不能排除旧格式、未知路径或本轮启用的受管Skill');if(!nativeGuardEntryUnavailable(entry,home,legacy))throw new ApplicationError('RESOURCE_STATE_CHANGED','原目录已恢复受管归属，须重新准备而非扩大本轮加载');}
 return excluded;
}
/** Explicit host-only omission of physically unverified modern entries.The raw
 * catalog and its generation stay complete;user paths are neither disabled nor
 * adopted.App authority still comes exclusively from the owned C run scope. */
export function validateNativeDiscoveryExclusions(store:ResourceStore,input:AgentLoadRequest,selectedPaths:readonly string[]):Set<string>{
 const proof=input.catalogExclusions;if(!proof)return new Set();const catalog=input.catalog,home=input.native.home;
 if(input.snapshot.runner!=='codex'||input.snapshot.legacyBinding||!catalog||proof.generation!==catalog.generation)throw recovery();
 boundCatalog(store,{catalog,home,runId:input.runId,taskId:input.snapshot.taskId,projectId:input.snapshot.projectId,runner:'codex'});
 return unverifiedPaths(catalog,home,proof.paths,selectedPaths);
}
const hash=z.string().regex(/^[a-f0-9]{64}$/),absolute=z.string().min(1).max(4096).refine(s=>s.startsWith('/')&&!/[\x00\r\n]/.test(s));
const modernGuardSelectionSchema=z.object({schema:z.literal('native-guard-discovery-omissions-v1'),home:absolute,catalog:agentLoadRequestSchema.shape.catalog.unwrap(),paths:z.array(absolute.refine(p=>p.endsWith('/SKILL.md'))).min(1).max(4096).refine(p=>new Set(p).size===p.length)}).strict();
const guardSelectionSchema=z.discriminatedUnion('schema',[modernGuardSelectionSchema,modernGuardSelectionSchema.extend({schema:z.literal('native-guard-retention-omissions-v1')}).strict()]);
export type NativeGuardDiscoverySelection=z.infer<typeof guardSelectionSchema>;
const guardContextSchema=z.object({runId:z.uuid(),taskId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),projectId:z.string().min(1).max(128),runner:z.enum(['claude-code','codex']),snapshotHash:hash,kind:z.enum(['history','fixed'])}).strict();
export interface NativeGuardDiscoveryProof {readonly schema:'native-guard-discovery-proof-v1';readonly runId:string}
interface GuardRecord {store:ResourceStore;selection:NativeGuardDiscoverySelection;context:z.infer<typeof guardContextSchema>;assertOwnedGuard:()=>void}
const guards=new WeakMap<NativeGuardDiscoveryProof,GuardRecord>();
function guardRecord(store:ResourceStore,proof:NativeGuardDiscoveryProof):GuardRecord{
 const record=proof&&guards.get(proof);if(!record||record.store!==store)throw recovery();record.assertOwnedGuard();
 const {selection,context}=record,run=boundCatalog(store,{...context,home:selection.home,catalog:selection.catalog});
 if(run.snapshot_hash!==context.snapshotHash||run.bindings_json!=='[]'||store.sqlite.prepare("SELECT 1 FROM capability_run_processes WHERE run_id=? AND kind='bridge' LIMIT 1").get(context.runId))throw recovery();
 const lease=store.sqlite.prepare("SELECT host_instance_id,pid,process_started_at,state FROM capability_resource_leases WHERE owner_kind='run' AND owner_id=?").get(context.runId) as {host_instance_id:string;pid:number;process_started_at:string;state:string}|undefined;
 if(!lease||lease.host_instance_id!==run.owner_instance_id||lease.pid!==run.owner_pid||lease.process_started_at!==run.owner_started_at||!['preparing','active'].includes(lease.state))throw recovery();
 const source=store.sqlite.prepare('SELECT schema_version,snapshot_hash,snapshot_json,retention_state,legacy_status FROM capability_session_snapshots WHERE task_id=?').get(context.taskId) as {schema_version:number;snapshot_hash:string;snapshot_json:string;retention_state:string;legacy_status:string}|undefined;
 if(!source||source.snapshot_hash!==context.snapshotHash||digest(source.snapshot_json)!==context.snapshotHash)throw recovery();
 if(context.kind==='fixed'){if(source.schema_version!==2||source.retention_state!=='active'||!store.sqlite.prepare('SELECT 1 FROM capability_run_restrictions WHERE run_id=?').get(context.runId))throw recovery();}
 else if(source.schema_version!==0||source.retention_state!=='hold'||source.legacy_status!=='history-unknown')throw recovery();
 if(selection.schema==='native-guard-retention-omissions-v1'&&!selection.paths.some(path=>selection.catalog.entries.find(e=>e.path===path)?.format==='legacy-tree-v1'))throw recovery();
 unverifiedPaths(selection.catalog,selection.home,selection.paths,[],selection.schema==='native-guard-retention-omissions-v1');record.assertOwnedGuard();return record;
}
/** Mint only after the actual no-authority guard owns its complete C lease and H
 * consumer.The retained input is parsed/cloned;JSON copies are not receipts. */
export function createNativeGuardDiscoveryProof(store:ResourceStore,selection:NativeGuardDiscoverySelection,context:z.infer<typeof guardContextSchema>,assertOwnedGuard:()=>void):NativeGuardDiscoveryProof{
 const parsed=guardSelectionSchema.safeParse(selection),identity=guardContextSchema.safeParse(context);if(!parsed.success||!identity.success||typeof assertOwnedGuard!=='function')throw recovery();
 const proof=Object.freeze({schema:'native-guard-discovery-proof-v1' as const,runId:identity.data.runId});guards.set(proof,{store,selection:parsed.data,context:identity.data,assertOwnedGuard});try{guardRecord(store,proof);}catch(error){guards.delete(proof);throw error;}return proof;
}
export function nativeGuardCatalogOmissions(store:ResourceStore,proof:NativeGuardDiscoveryProof,home:string,catalog:CatalogBinding['catalog']):Set<string>{
 const record=guardRecord(store,proof);if(record.selection.home!==home||canonicalJson(record.selection.catalog)!==canonicalJson(catalog))throw recovery();return new Set(record.selection.paths);
}
export function nativeGuardResourceOmissions(store:ResourceStore,proof:NativeGuardDiscoveryProof):Set<string>{
 const {selection}=guardRecord(store,proof),ids=new Set<string>();
 for(const path of selection.paths){const entry=selection.catalog.entries.find(e=>e.path===path)!;if(entry.storeId!==store.storeId)continue;const r=store.get(entry.resourceId);
  if(r.kind!==(entry.format?'legacy-agent-projection':'agent-projection')||r.pathScope!=='H'||r.ownerStoreId!==store.storeId||r.scopeIdentity!==digest(selection.home)||r.relativePath!=='.agents/skills/'+entry.nativeName||r.contentHash!==entry.projectionHash)throw recovery();ids.add(r.resourceId);}
 return ids;
}
export function nativeGuardAdapterExclusions(store:ResourceStore,proof:NativeGuardDiscoveryProof):NonNullable<AgentLoadRequest['catalogExclusions']>{
 const {selection,context}=guardRecord(store,proof);if(context.runner!=='codex')throw recovery();if(selection.paths.some(path=>selection.catalog.entries.find(e=>e.path===path)?.format))throw new ApplicationError('SCOPE_DENIED','旧格式排除只能用于本轮零授权守护规划');return{schema:'native-discovery-exclusions-v1',generation:selection.catalog.generation,paths:[...selection.paths]};
}

/** Pure-false planning only. The opaque live guard is independent from the old
 * serialized modern-exclusion field, whose legacy rejection stays unchanged. */
export function nativeGuardPlanOmissions(store:ResourceStore,proof:NativeGuardDiscoveryProof,input:AgentLoadRequest):Set<string>{
 const {selection,context}=guardRecord(store,proof),snapshot=input.snapshot;
 if(context.runner!=='codex'||input.runId!==context.runId||snapshot.runner!==context.runner||snapshot.taskId!==context.taskId||snapshot.projectId!==context.projectId||snapshot.packages.length||snapshot.standardSkills.length||snapshot.mcp.length||Object.keys(snapshot.adapterBinding.nativeToolNames).length||snapshot.legacyBinding||input.mcp.length||input.pluginRoot!==null||input.pluginHash!==null||input.catalogExclusions||input.applicationScope||input.standardSkillScope||input.claudeDelivery||input.currentExecutable!==process.execPath||!input.catalog)throw recovery();
 const omitted=nativeGuardCatalogOmissions(store,proof,input.native.home,input.catalog);
 const row=store.sqlite.prepare('SELECT snapshot_json FROM capability_session_snapshots WHERE task_id=?').get(context.taskId) as {snapshot_json:string};
 const source=JSON.parse(row.snapshot_json),native=context.kind==='fixed'?source.native:source;
 if(input.native.runner!==context.runner||input.native.cwd!==native.cwd||input.native.stateRoot!==native.stateRoot||input.native.sessionId!==native.sessionId)throw recovery();
 const adapter=store.get('agent-adapter:'+context.runner+':'+snapshot.adapterBinding.hash);
 const held=store.sqlite.prepare("SELECT 1 FROM capability_lease_resources r JOIN capability_resource_leases l ON l.lease_id=r.lease_id WHERE l.owner_kind='run' AND l.owner_id=? AND r.resource_id=? AND r.content_hash=? AND r.generation=?").get(context.runId,adapter.resourceId,adapter.contentHash,adapter.generation);if(!held)throw recovery();
 return omitted;
}
