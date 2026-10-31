import {ApplicationError} from '@shared/applications';
import {constants,lstatSync,openSync,readFileSync,closeSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {canonicalJson,compareCodePoints,digest} from './manifest';
import {CapabilitySessionRegistry} from './session-registry';
import type {ResourceRecord,ResourceStore} from './resource-store';
import {PackageRegistry} from './package-registry';
import {claudeGcFacts} from './resource-gc-claude';

/** A read-only observation made while the corresponding H coordinator is locked.
 * A plan is diagnostic data; execution must reacquire H -> C and recheck its hash. */
export interface ResourceGcCatalog {
 homeId:string;generation:string;pending:boolean;consumerIds:readonly string[];
 entries:readonly {resourceId:string;storeId:string;projectionHash:string;path:string}[];
}
export interface ResourceGcPlan {
 schema:1;storeId:string;rootResourceId:string;planHash:string;canCollect:boolean;
 resources:ResourceRecord[];deleteOrder:string[];
 retained:{resourceId:string;reasons:string[]}[];issues:string[];
 catalogs:{homeId:string;generation:string;consumerIds:string[];pending:boolean}[];
}
const supportedKinds=new Set(['application-package','runtime','legacy-runtime','agent-adapter','standard-skill','session-projection','agent-projection','legacy-agent-projection','claude-projection-source','claude-projection-archive','claude-delivery','claude-delivery-root']);
const sorted=(values:Iterable<string>)=>[...values].sort(compareCodePoints);

/** Expand consumers first, then dependencies. Never sweep unrelated unused packages,
 * infer release from age, or discard retained edges to make a package collectable. */
export function resourceGcPlan(store:ResourceStore,rootResourceId:string,catalogs:readonly ResourceGcCatalog[]=[]):ResourceGcPlan {
 return resourceGcPlans(store,catalogs)(rootResourceId);
}
/** One inventory call reads/validates its shared basis once. Do not reuse this
 * snapshot after releasing coordination, a DB mutation, or an awaited action. */
export function resourceGcPlans(store:ResourceStore,catalogs:readonly ResourceGcCatalog[]=[]):(rootResourceId:string)=>ResourceGcPlan {
 const db=store.sqlite;
 const raw=db.prepare('SELECT * FROM capability_resources ORDER BY resource_id').all() as {resource_id:string;state:string}[];
 const rawStates=new Map(raw.map(r=>[r.resource_id,r.state]));
 const edges=db.prepare('SELECT resource_id,dependency_id FROM capability_resource_dependencies ORDER BY resource_id,dependency_id').all() as {resource_id:string;dependency_id:string}[];
 const refs=db.prepare('SELECT * FROM capability_session_refs ORDER BY task_id,ref_kind,ref_id').all() as {task_id:string;ref_id:string;ref_kind:string;ref_hash:string;relative_path:string}[];
 const leases=db.prepare("SELECT * FROM capability_resource_leases WHERE state<>'released' ORDER BY lease_id").all() as {resource_id:string;lease_id:string}[];
 const active=db.prepare('SELECT * FROM capability_active_packages ORDER BY app_id').all() as {app_id:string;package_hash:string}[];
 const snapshots=db.prepare('SELECT * FROM capability_session_snapshots ORDER BY task_id').all() as {task_id:string}[];
 const histories=db.prepare('SELECT * FROM capability_session_identities ORDER BY task_id').all();
 const mcpNames=db.prepare('SELECT * FROM capability_session_mcp_names ORDER BY task_id,kind').all();
 const packages=db.prepare('SELECT * FROM capability_packages ORDER BY package_hash').all();
 const storeState=db.prepare('SELECT * FROM capability_store_state ORDER BY singleton').all() as {store_id:string;maintenance_state:string}[];
 const nativeUnknown=db.prepare("SELECT id FROM tasks WHERE (native_session_id IS NOT NULL OR runtime_snapshot IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM capability_session_snapshots s WHERE s.task_id=tasks.id) ORDER BY id").all() as {id:string}[];
 const holds=db.prepare('SELECT * FROM capability_session_holds ORDER BY task_id').all();
 const runs=db.prepare("SELECT * FROM capability_runs WHERE state NOT IN ('stopped','failed') ORDER BY run_id").all() as {task_id:string;run_id:string}[];
 const records=new Map<string,ResourceRecord>(),issues=new Set<string>(),reasons=new Map<string,Set<string>>();
 const retain=(id:string,reason:string)=>{let held=reasons.get(id);if(!held){held=new Set();reasons.set(id,held);}held.add(reason);};
 for(const row of raw)try{records.set(row.resource_id,store.get(row.resource_id));}catch{issues.add('resource-identity:'+row.resource_id);}
 const claude=claudeGcFacts(store,records);for(const issue of claude.issues)issues.add(issue);for(const root of claude.roots)retain(root.resourceId,root.reason);
 const dependencies=new Map<string,Set<string>>(),consumers=new Map<string,Set<string>>();
 const physicalAliases=new Map<string,Set<string>>();for(const group of claude.aliases){const ids=new Set(group);for(const id of group)physicalAliases.set(id,ids);}
 for(const edge of edges){
  if(rawStates.get(edge.resource_id)==='removed')continue;
  const parent=records.get(edge.resource_id),child=records.get(edge.dependency_id);
  if(!parent||!child||child.state==='removed'){issues.add('dependency-integrity:'+edge.resource_id+':'+edge.dependency_id);continue;}
  if(!dependencies.has(parent.resourceId))dependencies.set(parent.resourceId,new Set());dependencies.get(parent.resourceId)!.add(child.resourceId);
  if(!consumers.has(child.resourceId))consumers.set(child.resourceId,new Set());consumers.get(child.resourceId)!.add(parent.resourceId);
 }
 // Missing dependency rows must not turn a still-discoverable H projection into
 // an unrelated resource. Compare the graph with immutable source declarations.
 const registry=new PackageRegistry(store,'read-only-gc');
 for(const row of records.values()){
  if(row.state==='removed')continue;
  try{
   let expected:string[]|undefined;
   if(claude.declarations.has(row.resourceId))expected=claude.declarations.get(row.resourceId);
   else if(row.kind==='application-package')expected=['runtime:'+registry.get(row.contentHash).manifest.runtime.hash];
   else if(['agent-projection','session-projection','claude-projection-source'].includes(row.kind)){
    const directory=store.directory(row);if(realpathSync(directory)!==directory)throw Error('resource parent alias');
    const path=join(directory,'bundle.json'),stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>4*1024*1024)throw Error('unverified bundle metadata');
    const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);let manifest;try{manifest=JSON.parse(readFileSync(fd,'utf8'));}finally{closeSync(fd);}
    if(digest(canonicalJson(manifest))!==row.contentHash)throw Error('changed immutable metadata');
    if(row.kind==='agent-projection'){if(manifest.metadata?.kind!=='codex-agent-projection-v1'||typeof manifest.metadata.sourceResourceId!=='string')throw Error('projection source absent');expected=[manifest.metadata.sourceResourceId];}
    else {if(!Array.isArray(manifest.metadata?.sources)||!manifest.metadata.sources.every((s:{resourceId?:unknown})=>typeof s.resourceId==='string'))throw Error('projection sources absent');expected=sorted(new Set<string>(manifest.metadata.sources.map((s:{resourceId:string})=>s.resourceId)));}
   }
   else if(row.kind==='legacy-agent-projection'){const match=/^\.agents\/skills\/smartdd-([a-z][a-z0-9-]{0,63})-([a-f0-9]{16})$/.exec(row.relativePath);if(!match||match[2]!==row.contentHash.slice(0,16))throw Error('legacy projection identity');expected=['standard-skill:'+match[1]+':'+row.contentHash];}
   if(expected&&canonicalJson(sorted(dependencies.get(row.resourceId)??[]))!==canonicalJson(sorted(expected)))issues.add('dependency-declaration:'+row.resourceId);
  }catch{issues.add('dependency-declaration:'+row.resourceId);}
 }
 for(const state of storeState)if(state.store_id!==store.storeId||state.maintenance_state!=='ready')issues.add('store-maintenance');
 const expand=(initial:Iterable<string>,links:Map<string,Set<string>>)=>{const found=new Set(initial),queue=[...found];for(let at=0;at<queue.length;at++)for(const id of links.get(queue[at])??[])if(!found.has(id)){found.add(id);queue.push(id);}return found;};
 for(const row of records.values()){
  if(row.state==='removed')continue;
  if(row.state!=='ready'||row.integrity!=='valid')retain(row.resourceId,'resource-not-ready');
  if(!supportedKinds.has(row.kind))retain(row.resourceId,'resource-kind-unverified');
 }
 for(const row of active){const pkg=db.prepare('SELECT resource_id FROM capability_packages WHERE app_id=? AND package_hash=?').get(row.app_id,row.package_hash) as {resource_id:string}|undefined;if(!pkg||!records.has(pkg.resource_id))issues.add('active-identity:'+row.app_id);else retain(pkg.resource_id,'active-default');}
 const sessions=new CapabilitySessionRegistry(store,{assertInitialSelection:()=>{throw Error('read-only GC plan');},verifyExtraResource:()=>{throw Error('read-only GC plan');}});
 for(const snapshot of snapshots)try{if(sessions.inspectCoordinated(snapshot.task_id).retention==='hold')issues.add('history-unresolved:'+snapshot.task_id);}catch{issues.add('history-unresolved:'+snapshot.task_id);}
 for(const row of nativeUnknown)issues.add('history-unmapped:'+row.id);
 for(const ref of refs){const resource=records.get(ref.ref_id);retain(ref.ref_id,'session-reference:'+ref.task_id);if(!resource||resource.kind!==ref.ref_kind||resource.contentHash!==ref.ref_hash||resource.relativePath!==ref.relative_path||!snapshots.some(s=>s.task_id===ref.task_id))issues.add('reference-integrity:'+ref.task_id+':'+ref.ref_id);}
 for(const lease of leases){retain(lease.resource_id,'lease:'+lease.lease_id);if(!records.has(lease.resource_id))issues.add('lease-resource-missing:'+lease.lease_id);}
 for(const run of runs)if(!snapshots.some(s=>s.task_id===run.task_id)||!refs.some(r=>r.task_id===run.task_id))issues.add('run-history-unresolved:'+run.run_id);
 const catalogIds=new Set<string>();
 for(const catalog of catalogs){
  if(catalogIds.has(catalog.homeId))issues.add('catalog-duplicate:'+catalog.homeId);catalogIds.add(catalog.homeId);
  for(const entry of catalog.entries.filter(e=>e.storeId===store.storeId)){const row=records.get(entry.resourceId);if(!row||row.pathScope!=='H'||row.scopeIdentity!==catalog.homeId||row.contentHash!==entry.projectionHash||store.directory(row)+'/SKILL.md'!==entry.path)issues.add('catalog-identity:'+entry.resourceId);}
 }
 const baseReasons=reasons,baseIssues=issues;
 const observations=[...catalogs].sort((a,b)=>compareCodePoints(a.homeId,b.homeId)).map(c=>({...c,consumerIds:sorted(c.consumerIds),entries:[...c.entries].sort((a,b)=>compareCodePoints(a.resourceId,b.resourceId))}));
 const basisHash=digest(canonicalJson({storeId:store.storeId,raw,edges,refs,leases,active,snapshots,histories,mcpNames,packages,storeState,nativeUnknown,holds,runs,claude:claude.basis,issues:sorted(baseIssues),catalogs:observations}));
 return(rootResourceId:string)=>{
 const root=records.get(rootResourceId);
 if(!root||root.kind!=='application-package')throw new ApplicationError('NOT_FOUND','清理计划的原应用资源不存在或归属不符');
 const reasons=new Map([...baseReasons].map(([id,values])=>[id,new Set(values)])),issues=new Set(baseIssues);
 const retain=(id:string,reason:string)=>{let held=reasons.get(id);if(!held){held=new Set();reasons.set(id,held);}held.add(reason);};
 const derived=new Set([rootResourceId]),consumerQueue=[rootResourceId];for(let at=0;at<consumerQueue.length;at++)for(const id of [...(consumers.get(consumerQueue[at])??[]),...(physicalAliases.get(consumerQueue[at])??[])])if(!derived.has(id)){derived.add(id);consumerQueue.push(id);}
 const affected=expand(derived,dependencies);
 for(const id of affected){const row=records.get(id);if(!row||row.pathScope!=='H')continue;const catalog=catalogs.find(c=>c.homeId===row.scopeIdentity);
  if(!catalog)retain(id,'catalog-lock-required');
  else {if(catalog.pending)retain(id,'catalog-maintenance');if(catalog.consumerIds.length)retain(id,'catalog-consumers');if(!catalog.entries.some(e=>e.resourceId===id&&e.storeId===store.storeId&&e.projectionHash===row.contentHash))retain(id,'catalog-entry-missing');}
 }
 // A dependency shared by another package/projection remains outside this request.
 for(const id of affected)for(const parent of consumers.get(id)??[])if(!affected.has(parent))retain(id,'external-consumer:'+parent);
 // Every retained consumer protects its complete dependency closure, including
 // active roots outside this request and non-running historical/tombstone roots.
 const queue=[...reasons.keys()];for(let at=0;at<queue.length;at++)for(const child of dependencies.get(queue[at])??[]){if(!reasons.has(child)){reasons.set(child,new Set());queue.push(child);}reasons.get(child)!.add('retained-consumer:'+queue[at]);}
 const candidates=new Set([...affected].filter(id=>!reasons.has(id))),incoming=new Map([...candidates].map(id=>[id,0]));
 for(const id of candidates)for(const child of dependencies.get(id)??[])if(candidates.has(child))incoming.set(child,incoming.get(child)!+1);
 let available=sorted([...candidates].filter(id=>incoming.get(id)===0));const order:string[]=[];
 while(available.length){const id=available.shift()!;order.push(id);for(const child of dependencies.get(id)??[])if(candidates.has(child)){incoming.set(child,incoming.get(child)!-1);if(incoming.get(child)===0)available.push(child);}available.sort(compareCodePoints);}
 // Check the affected graph independently of retention, so a corrupt cycle
 // cannot become admissible merely because one of its vertices is protected.
 const degree=new Map([...affected].map(id=>[id,0]));for(const id of affected)for(const child of dependencies.get(id)??[])if(affected.has(child))degree.set(child,degree.get(child)!+1);
 const acyclic=[...affected].filter(id=>degree.get(id)===0);for(let at=0;at<acyclic.length;at++)for(const child of dependencies.get(acyclic[at])??[])if(affected.has(child)){degree.set(child,degree.get(child)!-1);if(degree.get(child)===0)acyclic.push(child);}
 if(acyclic.length!==affected.size)issues.add('dependency-cycle');
 if(issues.size)for(const id of affected)retain(id,'unresolved-authority');
 const canCollect=issues.size===0&&root.state==='ready'&&!reasons.has(rootResourceId);
 return{schema:1,storeId:store.storeId,rootResourceId,canCollect,resources:sorted(affected).map(id=>records.get(id)!).filter(Boolean),deleteOrder:canCollect?order:[],retained:sorted(affected).filter(id=>reasons.has(id)).map(resourceId=>({resourceId,reasons:sorted(reasons.get(resourceId)!)})),issues:sorted(issues),catalogs:observations.map(({homeId,generation,consumerIds,pending})=>({homeId,generation,consumerIds,pending})),planHash:digest(canonicalJson({basisHash,rootResourceId,issues:sorted(issues)}))};
 };
}
