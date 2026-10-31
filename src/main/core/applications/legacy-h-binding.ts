import {dirname,relative} from 'node:path';
import {ApplicationError} from '@shared/applications';
import {canonicalJson,digest} from './manifest';
import {legacyDiscoveryEntry} from './legacy-discovery';
import type {ResourceRecord,ResourceStore} from './resource-store';
import type {LegacyTaskEvidence} from './legacy-task-evidence';

export function originalHBinding(store:ResourceStore,taskId:string,home:string,sourceSnapshotHash:string,evidence:LegacyTaskEvidence){
 const aliases=evidence.skills.filter(s=>s.enabled).map(s=>{
  const entry=legacyDiscoveryEntry(store.storeId,home,s.skillId,s.hash);
  if(entry.path!==s.projectionPath)throw new ApplicationError('SNAPSHOT_CORRUPT','原Skill路径不是最初记录的位置');
  return{resourceId:entry.resourceId,relativePath:relative(home,dirname(entry.path)),hash:s.hash,sourceResourceId:`standard-skill:${s.skillId}:${s.hash}`};
 }).sort((a,b)=>a.resourceId<b.resourceId?-1:a.resourceId>b.resourceId?1:0);
 return{schema:'m4-h-alias-binding-v1',taskId,storeId:store.storeId,homeId:digest(home),sourceSnapshotHash,aliases} as const;
}

/** SQL metadata only; states may still be staged. Neither this receipt nor a
 * schema1 marker is native exit, publication, discovery or execution proof. */
export function readOriginalHBinding(store:ResourceStore,expected:ReturnType<typeof originalHBinding>,anchor:string|null):ResourceRecord[]|undefined{
 const row=store.sqlite.prepare('SELECT binding_json,binding_hash FROM capability_legacy_h_bindings WHERE task_id=?').get(expected.taskId) as {binding_json:string;binding_hash:string}|undefined;
 const refs=store.sqlite.prepare("SELECT ref_id,ref_hash,relative_path FROM capability_session_refs WHERE task_id=? AND ref_kind='legacy-agent-projection' ORDER BY ref_id").all(expected.taskId) as {ref_id:string;ref_hash:string;relative_path:string}[];
 const fail=():never=>{throw new ApplicationError('SNAPSHOT_CORRUPT','原共享Skill的长期引用或登记依据不同，保留原记录');};
 if(anchor===null){if(row||refs.length)return fail();return undefined;}
 const bytes=canonicalJson(expected),hash=digest(bytes);
 if(!row||anchor!==hash||row.binding_hash!==hash||row.binding_json!==bytes||canonicalJson(refs)!==canonicalJson(expected.aliases.map(a=>({ref_id:a.resourceId,ref_hash:a.hash,relative_path:a.relativePath}))))return fail();
 return expected.aliases.map(alias=>{
  const r=store.get(alias.resourceId);
  if(r.ownerStoreId!==store.storeId||r.kind!=='legacy-agent-projection'||r.pathScope!=='H'||r.scopeIdentity!==expected.homeId||r.relativePath!==alias.relativePath||r.contentHash!==alias.hash)return fail();
  return r;
 });
}
