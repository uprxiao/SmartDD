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
// 现行档位合同（技术方案 T1.3 §7.2，用户 2026-11-17 决定只留三档；复核 RF02）。
// 2026-11-16 及以前的录制与回放使用旧映射（ask=untrusted＋readOnly，另有 edits 档），那些记录按当时参数保留，不代表现行合同。
export const TIERS=['ask','auto','full'];
export const codexPermissions={
 ask:{approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:{type:'workspaceWrite'}},
 auto:{approvalPolicy:'on-request',approvalsReviewer:'auto_review',sandboxPolicy:{type:'workspaceWrite'}},
 full:{approvalPolicy:'never',approvalsReviewer:'user',sandboxPolicy:{type:'dangerFullAccess'}},
};
export const claudePermissions={ask:{permissionMode:'default'},full:{permissionMode:'bypassPermissions'}}; // Claude 不提供帮我批准
// 按执行器解析档位：不在三档内的输入（含旧 edits）拒绝；执行器不支持的档位降为请求批准并给出原因。
export function resolveTier(executor,permission) {
 if(!TIERS.includes(permission))return {ok:false,reason:'unknown-tier'};
 const table=executor==='codex'?codexPermissions:executor==='claude'?claudePermissions:null;
 if(!table)return {ok:false,reason:'unknown-executor'};
 if(!table[permission])return {ok:true,tier:'ask',downgraded:true,reason:'tier-unsupported-by-executor',params:table.ask};
 return {ok:true,tier:permission,downgraded:false,params:table[permission]};
}
export function turnParams(selection,advertised,defaults) {
 const r=resolveTier('codex',selection.permission);
 if(!r.ok)throw new Error('rejected permission: '+r.reason);
 const options={},skipped=[];
 for(const [key,value] of Object.entries(selection.options??{})) {
  if(advertised.includes(key))options[key]=value;else skipped.push(key);
 }
 return {...r.params,model:selection.model==='default'?defaults.model:selection.model,
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
 release(id,{ownerExited=false,turnCompleted=false,inputFrozen=false,pendingTools=1,businessDrained=false,backgroundDrained=false}){
  if((!ownerExited&&(!turnCompleted||!inputFrozen||pendingTools!==0))||!businessDrained||!backgroundDrained)return false;
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
