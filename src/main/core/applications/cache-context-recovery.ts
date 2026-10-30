import {z} from 'zod';
import {canonicalJson,digest} from './manifest';
import {withResourceLock} from './resource-lock';
import type {ResourceStore} from './resource-store';
import type {ProcessIdentityReader} from './process-identity';
type Row=Record<string,string|number|null>;
export interface CacheContextRecovery {released:string[];pending:{leaseId:string;reason:string}[]}
/** Both cache management actions run entirely in their host. Cache clear may
 * have a partial write effect; an interrupted inventory is only a cancelled
 * read. Cache file ownership recovery remains a separate protocol. */
export function recoverApplicationCacheClears(store:ResourceStore,processes:ProcessIdentityReader):Promise<CacheContextRecovery>{
 return recoverCacheContext(store,processes,'clear');
}
export function recoverApplicationCacheStatus(store:ResourceStore,processes:ProcessIdentityReader):Promise<CacheContextRecovery>{
 return recoverCacheContext(store,processes,'status');
}
async function recoverCacheContext(store:ResourceStore,processes:ProcessIdentityReader,kind:'clear'|'status'):Promise<CacheContextRecovery>{
 const action='application.cache.'+kind,semantics=kind==='clear'?'write':'read';
 const report:CacheContextRecovery={released:[],pending:[]};
 const columns=(table:string)=>new Set((store.sqlite.prepare('PRAGMA table_info('+table+')').all() as {name:string}[]).map(c=>c.name));
 const leases=columns('capability_resource_leases');if(!leases.size)return report;
 const shapes={capability_resource_leases:['lease_id','resource_id','owner_kind','owner_id','host_instance_id','pid','process_started_at','state','ended_at'],application_data_operations:['operation_id','caller_kind','scope_kind','project_id','task_id','run_id','job_id','parent_operation_id','app_id','package_hash','data_api','action','semantics','scope_hash','targets_json','state','error_code','ended_at'],capability_resources:['resource_id','owner_store_id','kind','path_scope','content_hash','relative_path'],capability_packages:['package_hash','app_id','resource_id','relative_path'],capability_lease_resources:['lease_id']};
 if(Object.entries(shapes).some(([table,required])=>{const found=columns(table);return required.some(c=>!found.has(c));})){
  if(['lease_id','state','owner_kind'].every(c=>leases.has(c)))for(const row of store.sqlite.prepare("SELECT lease_id FROM capability_resource_leases WHERE owner_kind='ui' AND state<>'released'").all() as {lease_id:string}[])report.pending.push({leaseId:row.lease_id,reason:'schema-unverified'});
  return report;
 }
 const snapshot=(id:string)=>{
  const lease=store.sqlite.prepare('SELECT * FROM capability_resource_leases WHERE lease_id=?').get(id) as Row|undefined;
  if(!lease||lease.owner_kind!=='ui'||lease.state!=='active'||!z.uuid().safeParse(lease.owner_id).success||!z.uuid().safeParse(lease.host_instance_id).success||!Number.isSafeInteger(lease.pid)||Number(lease.pid)<1||typeof lease.process_started_at!=='string'||!/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/.test(lease.process_started_at))return null;
  const op=store.sqlite.prepare('SELECT * FROM application_data_operations WHERE operation_id=?').get(lease.owner_id) as Row|undefined;
  if(!op||op.caller_kind!=='ui'||op.scope_kind!=='connection-management'||op.app_id!=='mail'||op.data_api!==1||op.action!==action||op.semantics!==semantics||op.targets_json!=='[]'||['project_id','task_id','run_id','job_id','parent_operation_id'].some(k=>op[k]!==null)||!['running','succeeded','failed','cancelled','unknown'].includes(String(op.state))||lease.resource_id!=='app:'+op.package_hash)return null;
  const scope=digest(canonicalJson({callerKind:'ui',scopeKind:'connection-management',projectId:null,taskId:null,runId:null,jobId:null,parentOperationId:null,appId:'mail',packageHash:op.package_hash,action,semantics,policy:null}));
  if(op.scope_hash!==scope||store.sqlite.prepare('SELECT 1 FROM capability_lease_resources WHERE lease_id=?').get(id))return null;
  const resource=store.sqlite.prepare('SELECT * FROM capability_resources WHERE resource_id=?').get(lease.resource_id) as Row|undefined,pack=store.sqlite.prepare('SELECT * FROM capability_packages WHERE package_hash=?').get(op.package_hash) as Row|undefined;
  if(!resource||!pack||resource.owner_store_id!==store.storeId||resource.kind!=='application-package'||resource.path_scope!=='C'||resource.content_hash!==op.package_hash||pack.app_id!=='mail'||pack.resource_id!==lease.resource_id||pack.relative_path!==resource.relative_path)return null;
  return{lease,op,resource,pack};
 };
 const captured=await withResourceLock(store.root,()=>{
  const rows=store.sqlite.prepare("SELECT l.lease_id FROM capability_resource_leases l JOIN application_data_operations o ON o.operation_id=l.owner_id WHERE l.owner_kind='ui' AND l.state<>'released' AND o.action=? ORDER BY l.lease_id").all(action) as {lease_id:string}[];
  return rows.map(r=>({id:r.lease_id,proof:snapshot(r.lease_id)}));
 });
 const eligible:typeof captured=[],states=new Map<string,ReturnType<ProcessIdentityReader['state']>>();
 for(const c of captured){
  if(!c.proof){report.pending.push({leaseId:c.id,reason:'unverified-cache-'+kind+'-owner'});continue;}
  const identity={pid:Number(c.proof.lease.pid),startedAt:String(c.proof.lease.process_started_at)},key=identity.pid+':'+identity.startedAt;
  if(!states.has(key)){try{states.set(key,processes.state(identity));}catch{states.set(key,'unknown');}}
  const state=states.get(key)!;if(state!=='stopped'){report.pending.push({leaseId:c.id,reason:'owner-'+state});continue;}eligible.push(c);
 }
 if(!eligible.length)return report;
 await withResourceLock(store.root,()=>store.sqlite.transaction(()=>{
  const proved:typeof eligible=[];
  for(const c of eligible){const current=snapshot(c.id);if(!current||canonicalJson(current)!==canonicalJson(c.proof)){report.pending.push({leaseId:c.id,reason:'record-changed'});continue;}proved.push(c);}
  for(const c of proved){const now=new Date().toISOString();
   if(c.proof!.op.state==='running')store.sqlite.prepare("UPDATE application_data_operations SET state=?,error_code=?,ended_at=? WHERE operation_id=? AND state='running'").run(kind==='clear'?'unknown':'cancelled',kind==='clear'?'RESOURCE_RECOVERY_REQUIRED':'CANCELED',now,c.proof!.op.operation_id);
   store.sqlite.prepare("UPDATE capability_resource_leases SET state='released',ended_at=? WHERE lease_id=? AND state='active'").run(now,c.id);report.released.push(c.id);
  }
 }).immediate());return report;
}
