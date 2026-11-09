import {z} from 'zod';
import {canonicalJson} from './manifest';
import type {ResourceStore} from './resource-store';
import type {ProcessIdentityReader} from './process-identity';
import {withResourceLock} from './resource-lock';
type SqlRow=Record<string,string|number|null>;
interface Candidate {lease:SqlRow;operation:SqlRow;resource:SqlRow;package:SqlRow;parent:SqlRow|null}
export interface ReadContextRecovery {released:string[];pending:{leaseId:string;reason:string}[]}
/** Only host-local read consumers are recovered here. Agent/native runs,
 * installers and writes keep their dedicated lifetime/outcome protocols.
 * These mail/ZenTao Workers/native readers consume the packaged program and
 * read-only sources, not this C package; host death ends its C consumer. */
export async function recoverApplicationReads(store:ResourceStore,processes:ProcessIdentityReader):Promise<ReadContextRecovery>{
 const report:ReadContextRecovery={released:[],pending:[]};
 // This also runs before migrations. An absent pre-M10 table means there are
 // no such recorded consumers; incomplete ownership schemas remain on hold.
 const shapes=new Map<string,Set<string>>();
 const columns=(table:string)=>{let known=shapes.get(table);if(!known){known=new Set((store.sqlite.prepare('PRAGMA table_info('+table+')').all() as {name:string}[]).map(c=>c.name));shapes.set(table,known);}return known;};
 const leaseColumns=columns('capability_resource_leases');
 if(!leaseColumns.size)return report;
 const needed:Record<string,string[]>={
  capability_resource_leases:['lease_id','resource_id','owner_kind','owner_id','host_instance_id','pid','process_started_at','state','ended_at'],
  application_data_operations:['operation_id','caller_kind','scope_kind','project_id','task_id','run_id','job_id','parent_operation_id','app_id','package_hash','action','semantics','state','error_code','ended_at'],
  capability_resources:['resource_id','owner_store_id','kind','path_scope','content_hash','relative_path'],
  capability_packages:['package_hash','app_id','resource_id','relative_path'],
  capability_lease_resources:['lease_id'],
 };
 const waiters=columns('application_index_waiters');
 if(Object.entries(needed).some(([table,names])=>names.some(name=>!columns(table).has(name)))||(waiters.size>0&&!['index_operation_id','parent_operation_id','state','ended_at'].every(name=>waiters.has(name)))){
  // Do not attempt reads of columns whose historical meaning is unknown.
  if(['lease_id','owner_kind','state'].every(name=>leaseColumns.has(name)))for(const row of store.sqlite.prepare("SELECT lease_id FROM capability_resource_leases WHERE state<>'released' AND owner_kind IN ('ui','index-job')").all() as {lease_id:string}[])report.pending.push({leaseId:row.lease_id,reason:'schema-unverified'});
  else if(store.sqlite.prepare('SELECT 1 FROM capability_resource_leases LIMIT 1').get())report.pending.push({leaseId:'unverified-schema',reason:'schema-unverified'});
  return report;
 }
 const snapshot=(leaseId:string):Candidate|null=>{
  const lease=store.sqlite.prepare('SELECT * FROM capability_resource_leases WHERE lease_id=?').get(leaseId) as SqlRow|undefined;
  if(!lease||lease.state!=='active'||!['ui','index-job'].includes(String(lease.owner_kind)))return null;
  if(!z.uuid().safeParse(lease.host_instance_id).success||!z.uuid().safeParse(lease.owner_id).success||!Number.isSafeInteger(lease.pid)||Number(lease.pid)<1||typeof lease.process_started_at!=='string'||!/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/.test(lease.process_started_at))return null;
  const operation=store.sqlite.prepare('SELECT * FROM application_data_operations WHERE operation_id=?').get(lease.owner_id) as SqlRow|undefined;
  if(!operation||operation.caller_kind!==lease.owner_kind||operation.semantics!=='read'||!['running','succeeded','failed','cancelled'].includes(String(operation.state))||!['mail','zentao'].includes(String(operation.app_id))||operation.run_id!==null||operation.task_id!==null||lease.resource_id!=='app:'+operation.package_hash)return null;
  if(lease.owner_kind==='ui'&&(operation.job_id!==null||operation.scope_kind==='internal-index'||!String(operation.action).startsWith('ui.')))return null;
  if(store.sqlite.prepare('SELECT 1 FROM capability_lease_resources WHERE lease_id=?').get(leaseId))return null;
  const resource=store.sqlite.prepare('SELECT * FROM capability_resources WHERE resource_id=?').get(lease.resource_id) as SqlRow|undefined;
  const pack=store.sqlite.prepare('SELECT * FROM capability_packages WHERE package_hash=?').get(operation.package_hash) as SqlRow|undefined;
  if(!resource||!pack||resource.owner_store_id!==store.storeId||resource.kind!=='application-package'||resource.path_scope!=='C'||resource.content_hash!==operation.package_hash||pack.resource_id!==lease.resource_id||pack.app_id!==operation.app_id||pack.relative_path!==resource.relative_path)return null;
  let parent:SqlRow|null=null;
  if(lease.owner_kind==='index-job'){
   if(operation.scope_kind!=='internal-index'||operation.job_id!==operation.operation_id||operation.action!==operation.app_id+'.refresh'||!z.uuid().safeParse(operation.parent_operation_id).success)return null;
   parent=store.sqlite.prepare('SELECT * FROM application_data_operations WHERE operation_id=?').get(operation.parent_operation_id) as SqlRow|undefined??null;
   if(!parent||parent.semantics!=='read'||!['ui','agent-run'].includes(String(parent.caller_kind))||parent.app_id!==operation.app_id||parent.package_hash!==operation.package_hash)return null;
  }
  return{lease,operation,resource,package:pack,parent};
 };
 const captured=await withResourceLock(store.root,()=>{
  const rows=store.sqlite.prepare("SELECT lease_id FROM capability_resource_leases WHERE state<>'released' AND owner_kind IN ('ui','index-job') ORDER BY lease_id").all() as {lease_id:string}[];
  return rows.map(row=>({id:row.lease_id,proof:snapshot(row.lease_id)}));
 });
 // Native kernel probes may wait. Never run one under C or a SQLite transaction.
 const states=new Map<string,ReturnType<ProcessIdentityReader['state']>>();
 const eligible:typeof captured=[];
 for(const item of captured){
  if(!item.proof){report.pending.push({leaseId:item.id,reason:'unverified-read-owner'});continue;}
  const identity={pid:Number(item.proof.lease.pid),startedAt:String(item.proof.lease.process_started_at)},key=identity.pid+':'+identity.startedAt;
  if(!states.has(key)){try{states.set(key,processes.state(identity));}catch{states.set(key,'unknown');}}
  const state=states.get(key)!;
  if(state!=='stopped'){report.pending.push({leaseId:item.id,reason:'owner-'+state});continue;}
  eligible.push(item);
 }
 if(!eligible.length)return report;
 await withResourceLock(store.root,()=>store.sqlite.transaction(()=>{
  const proved:{id:string;proof:Candidate}[]=[];
  // Validate the entire group before cancelling any parent. Otherwise our own
  // parent cancellation would invalidate the child's original captured proof.
  for(const item of eligible){
   const current=snapshot(item.id);
   if(!current||canonicalJson(current)!==canonicalJson(item.proof)){report.pending.push({leaseId:item.id,reason:'record-changed'});continue;}
   proved.push({id:item.id,proof:current});
  }
  for(const item of proved){
   const current=item.proof;
   const now=new Date().toISOString(),id=current.operation.operation_id;
   if(current.operation.state==='running')store.sqlite.prepare("UPDATE application_data_operations SET state='cancelled',error_code='CANCELED',ended_at=? WHERE operation_id=? AND state='running' AND semantics='read'").run(now,id);
   if(waiters.size)store.sqlite.prepare("UPDATE application_index_waiters SET state='cancelled',ended_at=? WHERE state='waiting' AND (index_operation_id=? OR parent_operation_id=?)").run(now,id,id);
   store.sqlite.prepare("UPDATE capability_resource_leases SET state='released',ended_at=? WHERE lease_id=? AND state='active'").run(now,item.id);report.released.push(item.id);
  }
 }).immediate());
 return report;
}
