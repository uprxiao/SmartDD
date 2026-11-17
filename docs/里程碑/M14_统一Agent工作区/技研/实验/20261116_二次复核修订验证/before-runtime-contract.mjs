import {realpathSync} from 'node:fs';
export function capability(version,{minVersion,knownIncompatible=[],probe}) {
 const parts=x=>x.split('.').map(Number);
 if(!/^\d+\.\d+\.\d+$/.test(version))return {enabled:false,reason:'unparsed-version'};
 const a=parts(version),b=parts(minVersion);let compare=0;
 for(let i=0;i<3&&!compare;i++)compare=Math.sign(a[i]-b[i]);
 if(compare<0)return {enabled:false,reason:'below-minimum'};
 if(knownIncompatible.includes(version))return {enabled:false,reason:'known-incompatible'};
 return probe()?{enabled:true}:{enabled:false,reason:'probe-unavailable'};
}
export const codexPermissions={
 ask:{approvalPolicy:'untrusted',approvalsReviewer:'user',sandboxPolicy:{type:'readOnly'}},
 edits:{approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:{type:'workspaceWrite'}},
 auto:{approvalPolicy:'on-request',approvalsReviewer:'auto_review',sandboxPolicy:{type:'workspaceWrite'}},
 full:{approvalPolicy:'never',approvalsReviewer:'user',sandboxPolicy:{type:'dangerFullAccess'}},
};
export function turnParams(selection,advertised,defaults) {
 const options={},skipped=[];
 for(const [key,value] of Object.entries(selection.options??{})) {
  if(advertised.includes(key))options[key]=value;else skipped.push(key);
 }
 return {...codexPermissions[selection.permission],model:selection.model==='default'?defaults.model:selection.model,
   options,skipped};
}
export class PendingStop {
 pending=false;started=false;stops=0;
 stop(){this.pending=true;if(this.started)this.stops++;}
 turnStarted(){this.started=true;if(this.pending)this.stops++;}
}
export class DirectoryQueue {
 running=new Map();waiting=[];
 request({id,cwd,permission,hostAllowsReadOnly=false}) {
  const root=realpathSync(cwd),kind=permission==='read-only'&&hostAllowsReadOnly?'read':'write';
  const request={id,root,kind};
  this.waiting.push(request);this.pump();return this.running.has(id)?'running':'queued';
 }
 pump(){
  for(const r of [...this.waiting]){
   const active=[...this.running.values()].filter(a=>a.root===r.root);
   if(r.kind==='write'&&active.some(a=>a.kind==='write'))continue;
   // Read-only runs may overlap a writer; each write must revalidate its read basis.
   this.running.set(r.id,r);this.waiting.splice(this.waiting.indexOf(r),1);
  }
 }
 release(id,{ownerExited,pausedNoWrites=false,businessDrained,backgroundDrained}){
  if((!ownerExited&&!pausedNoWrites)||!businessDrained||!backgroundDrained)return false;
  this.running.delete(id);this.pump();return true;
 }
 cancel(id){const n=this.waiting.findIndex(x=>x.id===id);if(n>=0)this.waiting.splice(n,1);}
}
export function applyEvents(state,events){
 const next={...state,items:{...state.items}};
 for(const e of events){
  if(e.seq<=next.seq)continue;
  if(e.seq!==next.seq+1)return {snapshotRequired:true};
  if(!next.items[e.id]||next.items[e.id].revision<e.revision)next.items[e.id]=e;
  next.seq=e.seq;
 }
 return next;
}
