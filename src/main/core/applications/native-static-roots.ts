import {nativeGuardResourceOmissions,type NativeGuardDiscoveryProof} from './native-discovery-exclusions';
import {basename,join} from 'node:path';
import {ApplicationError} from '@shared/applications';
import {canonicalJson,digest} from './manifest';
import {assertDiscoveryPath,verifyLegacyDiscoveryEntry} from './legacy-discovery';
import {verifyOwnedBundle} from './owned-bundle';
import type {ResourceRecord,ResourceStore} from './resource-store';

export interface NativeStaticRoot {readonly resource:Readonly<ResourceRecord>;readonly sourceId:string}
const invalid=()=>new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原生静态投影的原身份或依赖无法核验，保留原占用');
const dependencies=(store:ResourceStore,id:string)=>(store.sqlite.prepare('SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=? ORDER BY dependency_id').all(id) as {dependency_id:string}[]).map(d=>d.dependency_id);
/** Metadata only, before the run lease. This grants no execution or byte trust.
 * Actual complete H bytes are checked after retention and before preparation. */
export function captureNativeStaticRoots(store:ResourceStore,ids:readonly string[]):readonly NativeStaticRoot[]{
 const roots:NativeStaticRoot[]=[];
 for(const id of new Set(ids)){
  const r=store.get(id);if(r.pathScope!=='H'||!['agent-projection','legacy-agent-projection'].includes(r.kind))continue;
  const name=r.relativePath.slice('.agents/skills/'.length),legacy=r.kind==='legacy-agent-projection';
  if(r.state!=='ready'||r.integrity!=='valid'||r.relativePath!=='.agents/skills/'+name||name.length>(legacy?100:64)||!(legacy?/^smartdd-[a-z][a-z0-9-]{0,63}-[a-f0-9]{16}$/:/^smartdd-[as]-[a-z0-9]+(?:-[a-z0-9]+)*$/).test(name)||r.resourceId!=='h-projection:'+digest(canonicalJson({homeId:r.scopeIdentity,storeId:store.storeId,nativeName:name,hash:r.contentHash})))throw invalid();
  const deps=dependencies(store,id);if(deps.length!==1)throw invalid();const source=store.get(deps[0]);
  if(source.pathScope!=='C'||!['application-package','standard-skill'].includes(source.kind)||legacy&&(source.kind!=='standard-skill'||source.contentHash!==r.contentHash))throw invalid();
  roots.push(Object.freeze({resource:Object.freeze({...r}),sourceId:source.resourceId}));
 }
 return Object.freeze(roots);
}
/** Called outside C, only after the ordinary native run holds every source.
 * A full static copy does not make its C source executable or give App access. */
export function verifyNativeStaticRoots(store:ResourceStore,roots:readonly NativeStaticRoot[],discovery?:NativeGuardDiscoveryProof):void{
 const omitted=discovery?nativeGuardResourceOmissions(store,discovery):new Set<string>();
 for(const proof of roots){
  const [current]=captureNativeStaticRoots(store,[proof.resource.resourceId]);
  if(!current||canonicalJson(current)!==canonicalJson(proof))throw invalid();
  const r=proof.resource,home=(store.sqlite.prepare('SELECT canonical_home AS home FROM capability_discovery_roots WHERE home_id=?').get(r.scopeIdentity) as {home:string}|undefined)?.home;
  if(!home||digest(home)!==r.scopeIdentity)throw invalid();const directory=store.directory(r),name=basename(directory),path=join(directory,'SKILL.md');if(omitted.has(r.resourceId)){if(r.kind!=='agent-projection')throw invalid();continue;}assertDiscoveryPath(home,path);
  if(r.kind==='legacy-agent-projection'){
   const identity=verifyLegacyDiscoveryEntry({resourceId:r.resourceId,storeId:store.storeId,path,nativeName:name,sourceHash:r.contentHash,projectionHash:r.contentHash,format:'legacy-tree-v1'},home);if(identity.sourceResourceId!==proof.sourceId)throw invalid();
  }else{
   const manifest=verifyOwnedBundle(directory,r.contentHash,store.storeId),m=manifest.metadata;
   if(m.kind!=='codex-agent-projection-v1'||m.homeId!==r.scopeIdentity||m.nativeName!==name||m.sourceResourceId!==proof.sourceId||typeof m.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(m.sourceHash))throw invalid();
  }
 }
}
/** Keep the entire original C lineage leased. Execution roots always win if a
 * source is also reached by the actual adapter or another executable root. */
export function nativeStaticSourceIds(store:ResourceStore,resources:readonly string[],proofs:readonly NativeStaticRoot[]):ReadonlySet<string>{
 if(!proofs.length)return new Set();
 const current=captureNativeStaticRoots(store,proofs.map(p=>p.resource.resourceId));if(canonicalJson(current)!==canonicalJson(proofs))throw invalid();
 const walk=(roots:readonly string[],onlyC:boolean)=>{
  const seen=new Set<string>(),visiting=new Set<string>();
  const visit=(id:string,depth:number):void=>{if(visiting.has(id)||depth>256||seen.size+visiting.size>=10000)throw invalid();if(seen.has(id))return;const r=store.get(id);if(onlyC&&r.pathScope!=='C')throw invalid();visiting.add(id);for(const child of dependencies(store,id))visit(child,depth+1);visiting.delete(id);seen.add(id);};
  for(const root of roots)visit(root,0);return seen;
 };
 const inert=walk(proofs.map(p=>p.sourceId),true),staticIds=new Set(proofs.map(p=>p.resource.resourceId)),executed=walk(resources.filter(id=>!staticIds.has(id)),false);
 for(const id of executed)inert.delete(id);return inert;
}
