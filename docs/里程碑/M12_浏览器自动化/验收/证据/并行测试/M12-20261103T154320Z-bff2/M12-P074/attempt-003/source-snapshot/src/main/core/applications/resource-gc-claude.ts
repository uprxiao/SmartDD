import {z} from 'zod';
import {digest} from './manifest';
import type {ResourceRecord,ResourceStore} from './resource-store';
import {CapabilitySessionRegistry} from './session-registry';
import {SessionCapabilityProjector} from './session-projector';
import {readClaudeSlot,claudeSlotId,claudeRoot,normalizedSelection,verifyClaudeDelivery,assertClaudeInstallLease,claudeDeliveryPendingSchema} from './claude-delivery-state';
import {verifyOwnedBundle} from './owned-bundle';
import {claudeProjectionSelection} from './claude-projection-selection';
export interface ClaudeGcFacts {
 roots:{resourceId:string;reason:string}[];
 declarations:Map<string,string[]>;
 aliases:string[][];
 issues:string[];basis:unknown;
}
/** A stable slot is retained history, not an unreferenced physical directory.
 * Its old logical aliases are verified through original immutable archives;
 * reading today's partial view under yesterday's hash is not a GC proof. */
export function claudeGcFacts(store:ResourceStore,records:ReadonlyMap<string,ResourceRecord>):ClaudeGcFacts{
 const db=store.sqlite,operations=db.prepare("SELECT operation_id,kind,owner_store_id,state,plan_json FROM capability_resource_operations WHERE kind IN ('claude-delivery-slot','claude-delivery-install') ORDER BY operation_id").all() as {operation_id:string;kind:string;owner_store_id:string;state:string;plan_json:string}[],byId=new Map(operations.map(o=>[o.operation_id,o]));
 const roots:ClaudeGcFacts['roots']=[],declarations=new Map<string,string[]>(),groups:string[][]=[],issues=new Set<string>(),tasks=new Set<string>();
 for(const operation of operations)if(operation.kind==='claude-delivery-slot'){if(!operation.operation_id.startsWith('claude-delivery-slot:'))issues.add('claude-slot:invalid-operation');else tasks.add(operation.operation_id.slice('claude-delivery-slot:'.length));}
 for(const row of records.values())if(row.kind==='claude-delivery-root'||row.kind==='claude-delivery'){
  const match=/^sessions\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/claude\/plugin$/.exec(row.relativePath);if(!match)issues.add('claude-slot:'+row.resourceId);else tasks.add(match[1]);
 }
 const sessions=new CapabilitySessionRegistry(store,{assertInitialSelection:()=>{throw Error('read-only GC slot inspection');},verifyExtraResource:()=>{throw Error('read-only GC slot inspection');}}),projector=new SessionCapabilityProjector(store,sessions);
 for(const taskId of tasks)try{
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(taskId))throw Error('invalid slot task');
  const slot=readClaudeSlot(store,taskId),session=sessions.inspectCoordinated(taskId);if(!slot||session.retention==='hold'||session.snapshot.runner!=='claude-code'||slot.selectionHash!==normalizedSelection(session.snapshot))throw Error('unknown retained history');
  const refs=db.prepare('SELECT ref_id,ref_hash,ref_kind FROM capability_session_refs WHERE task_id=?').all(taskId) as {ref_id:string;ref_hash:string;ref_kind:string}[];
  const aliases=[...records.values()].filter(r=>r.pathScope==='C'&&r.state!=='removed'&&r.relativePath===claudeRoot(taskId));
  groups.push(aliases.map(r=>r.resourceId));
  for(const row of aliases){
   if(!['session-projection','claude-delivery','claude-delivery-root'].includes(row.kind)||row.ownerStoreId!==store.storeId)throw Error('unrecognized physical alias');
   roots.push({resourceId:row.resourceId,reason:'claude-stable-history:'+taskId});
   if(row.kind==='claude-delivery-root')continue;
   if(!refs.some(r=>r.ref_id===row.resourceId&&r.ref_hash===row.contentHash&&r.ref_kind===row.kind)&&row.resourceId!==slot.pending?.resourceId&&row.resourceId!==slot.current?.resourceId)throw Error('unattributed retained alias');
   if(row.kind==='session-projection'){
    if(row.resourceId!==`session-projection:${taskId}:${row.contentHash}`)throw Error('original plugin identity');
    const archiveId=`claude-projection-archive:${taskId}:${row.contentHash}`;
    if(!refs.some(r=>r.ref_id===archiveId&&r.ref_kind==='claude-projection-archive'&&r.ref_hash===row.contentHash))throw Error('original full archive ref missing');
    const archive=store.get(archiveId);projector.verify(archive,session.snapshot);
    const manifest=verifyOwnedBundle(store.directory(archive),row.contentHash,store.storeId);claudeProjectionSelection(manifest,session.snapshot,true);
    declarations.set(row.resourceId,[...new Set((manifest.metadata.sources as {resourceId:string}[]).map(s=>s.resourceId))].sort());
    roots.push({resourceId:archiveId,reason:'claude-stable-history:'+taskId});
   }else{
    if(row.resourceId!==`claude-delivery:${taskId}:${row.contentHash}`||!row.operationId)throw Error('delivery identity');
    const origin=byId.get(row.operationId);if(!origin||origin.owner_store_id!==store.storeId||origin.kind!=='claude-delivery-install')throw Error('delivery origin missing');
    let sourceId:string;
    if(origin.state==='committed'){
     const originPlan=z.object({slotId:z.string(),completedPending:claudeDeliveryPendingSchema}).strict().parse(JSON.parse(origin.plan_json)),p=originPlan.completedPending;
     if(originPlan.slotId!==claudeSlotId(taskId)||p.id!==origin.operation_id||p.resourceId!==row.resourceId||p.hash!==row.contentHash||p.generation!==row.generation||p.sourceId!==`claude-projection-source:${taskId}:${p.hash}`)throw Error('delivery origin differs');sourceId=p.sourceId;
    }else{
     const p=slot.pending,originPlan=z.object({slotId:z.string(),resourceId:z.string(),sourceId:z.string(),hash:z.string(),generation:z.number(),root:z.string()}).strict().parse(JSON.parse(origin.plan_json));
     if(origin.state!=='preparing'||!p||p.id!==origin.operation_id||p.resourceId!==row.resourceId||p.hash!==row.contentHash||p.generation!==row.generation||originPlan.slotId!==claudeSlotId(taskId)||originPlan.resourceId!==p.resourceId||originPlan.sourceId!==p.sourceId||originPlan.hash!==p.hash||originPlan.generation!==p.generation||originPlan.root!==slot.root)throw Error('pending delivery origin differs');sourceId=p.sourceId;
    }
    const source=store.get(sourceId);projector.verify(source,session.snapshot);if(source.contentHash!==row.contentHash)throw Error('delivery immutable source differs');declarations.set(row.resourceId,[sourceId]);roots.push({resourceId:sourceId,reason:'claude-stable-history:'+taskId});
   }
  }
  if(!aliases.some(r=>r.resourceId===slot.anchorId))throw Error('stable anchor missing');
  if(slot.pending)assertClaudeInstallLease(store,slot);
  else if(slot.current)verifyClaudeDelivery(store,store.get(slot.current.resourceId),session.snapshot);
 }catch{issues.add('claude-slot:'+taskId);}
 return{roots,declarations,aliases:groups,issues:[...issues].sort(),basis:operations.map(({plan_json,...o})=>({...o,planHash:digest(plan_json)}))};
}
