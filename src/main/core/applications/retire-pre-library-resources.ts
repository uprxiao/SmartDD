import {existsSync,lstatSync,renameSync,rmSync} from 'node:fs';
import {join,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {withResourceLock} from './resource-lock';
import type {ResourceStore} from './resource-store';

/** Resource kinds only pre-R1.0 launches produced: shared-catalog projections (H) and per-task projections / Claude plugins (C). */
export const PRE_LIBRARY_RESOURCE_KINDS:readonly string[]=Object.freeze(['agent-projection','legacy-agent-projection','session-projection','claude-projection-source','claude-projection-archive','claude-delivery','claude-delivery-root']);

export interface PreLibraryRetirement {
 /** Records marked removed. */
 retired:string[];
 /** H records whose copy still exists under HOME (another owner's or not yet cleaned); left unchanged. */
 kept:string[];
}

/**
 * R1.0 S3d-c2: nothing launches from pre-R1.0 projections any more. Retire this store's records once, at startup and
 * before any run exists, so version cleanup is no longer held by copies that S3d-b already removed:
 * - C records live in this store's own data directory: their directory is removed, then the record;
 * - H records live under HOME: S3d-b removes our marked copies; a record is retired only once its copy is gone.
 * Session references to retired records and leases on them are released; old sessions are adopted on resume (S4).
 */
export async function retirePreLibraryResources(store:ResourceStore):Promise<PreLibraryRetirement>{
 return withResourceLock(store.root,()=>{
  const marks=PRE_LIBRARY_RESOURCE_KINDS.map(()=>'?').join(',');
  const rows=store.sqlite.prepare(`SELECT resource_id AS id,kind,path_scope AS scope,COALESCE(scope_relative_path,relative_path) AS path FROM capability_resources WHERE owner_store_id=? AND state<>'removed' AND kind IN (${marks}) ORDER BY resource_id`).all(store.storeId,...PRE_LIBRARY_RESOURCE_KINDS) as {id:string;kind:string;scope:'C'|'H';path:string}[];
  const retired:string[]=[],kept:string[]=[];
  for(const row of rows){
   if(row.scope==='C'){
    const target=join(store.root,row.path),inside=relative(store.root,target);
    // Old projections sit at least three levels below the store root (e.g. sessions/<task>/claude/plugin); never a session directory itself.
    if(!inside||inside.startsWith('..')||inside.startsWith('/')||inside.split('/').length<3)continue;
    if(existsSync(target)&&!lstatSync(target).isSymbolicLink()){const trash=target+'.retired-'+randomUUID();renameSync(target,trash);rmSync(trash,{recursive:true,force:true});}
   }else{
    let present=true;try{present=existsSync(store.directory(store.get(row.id)));}catch{present=false;}
    if(present){kept.push(row.id);continue;}
   }
   retired.push(row.id);
  }
  if(retired.length)store.sqlite.transaction(()=>{
   const now=new Date().toISOString();
   for(const id of retired){
    store.sqlite.prepare("UPDATE capability_resources SET state='removed',integrity='unknown',generation=generation+1 WHERE resource_id=? AND state<>'removed'").run(id);
    store.sqlite.prepare('DELETE FROM capability_session_refs WHERE ref_id=?').run(id);
    store.sqlite.prepare("UPDATE capability_resource_leases SET state='released',ended_at=? WHERE resource_id=? AND state<>'released'").run(now,id);
   }
  }).immediate();
  return{retired,kept};
 });
}
