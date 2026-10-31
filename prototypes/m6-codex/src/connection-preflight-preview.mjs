// Synthetic prototype only. These public keys are change detectors, not host
// authorization, credential hashes or proofs of actual adapter compatibility.
import {connectionIdentityChanged,packageVersion,saveConnection,validateConnection,projectIntegrationState} from './integration-model.mjs';

const fields=['id','app','kind','name','url','path','account','auth','host','port','transport','tls','credentialPresent','queryDays','fromAddress'];
const publicDraft=draft=>Object.fromEntries(fields.filter(key=>draft[key]!==undefined).map(key=>[key,draft[key]]));
const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);

export function previewConnectionReferences(state,tasks,draft){
 const rows=[{kind:'default',version:packageVersion(state,draft.app),taskId:null,projectId:null,unknown:false}];
 for(const task of tasks){
  const selected=(state.bindings[task.project]??[]).includes(draft.id),snapshot=task.integrationSnapshot;
  if(!snapshot||!Array.isArray(snapshot.packages)){
   if(selected)rows.push({kind:'history',version:null,taskId:task.id,projectId:task.project,unknown:true});
   continue;
  }
  for(const pack of snapshot.packages){
   if(pack.id!==draft.app)continue;
   if(Array.isArray(pack.connections)&&!pack.connections.some(ref=>ref.id===draft.id))continue;
   if(!Array.isArray(pack.connections)&&!selected)continue;
   rows.push({kind:'history',version:typeof pack.version==='string'?pack.version:null,taskId:task.id,projectId:task.project,unknown:typeof pack.version!=='string'||!Array.isArray(pack.connections)});
  }
 }
 return rows.sort((a,b)=>stable(a).localeCompare(stable(b)));
}

function referenceKey(state,tasks,draft){
 return stable({installed:state.installed.includes(draft.app),version:packageVersion(state,draft.app),rows:previewConnectionReferences(state,tasks,draft),projects:Object.entries(state.bindings).filter(([,ids])=>ids.includes(draft.id)).map(([id])=>id).sort()});
}
export function preparePreviewConnection(state,tasks,draft,{generation=0,scene='compatible',now=Date.now()}={}){
 if(!['compatible','incompatible','unverified'].includes(scene))throw Error('Unknown synthetic compatibility scene');
 const old=state.connections.find(connection=>connection.id===draft.id),rows=previewConnectionReferences(state,tasks,draft),identityChanged=connectionIdentityChanged(old,draft);
 const impacts=rows.filter(row=>row.unknown||scene!=='compatible').map(row=>({...row,status:row.unknown?'unverified':scene,reason:row.unknown?'原示例会话未记录完整连接／版本，无法核验；不猜测兼容。':scene==='incompatible'?'合成示例：此包无法等价读取本次配置；该应用能力不可用，Agent其他工作继续。':'合成示例：尚无此配置与原包的验证依据，不能标为兼容。'}));
 return{schema:'m10-preview-connection-plan-v1',generation,scene,draftKey:stable(publicDraft(draft)),connectionRevision:old?.revision??0,referenceKey:referenceKey(state,tasks,draft),expiresAt:now+600000,rows,impacts,status:identityChanged?'identity-change':impacts.some(row=>row.status==='incompatible')?'incompatible':impacts.length?'unverified':'compatible'};
}
export function commitPreviewConnection(state,tasks,draft,hasCredential,plan,{generation=0,scene='compatible',accepted=false,now=Date.now()}={}){
 const fail=(code,reason)=>({ok:false,code,reason,state});
 if(!plan||plan.schema!=='m10-preview-connection-plan-v1')return fail('NOT_TESTED','保存前请测试当前配置。');
 if(plan.expiresAt<=now)return fail('PLAN_EXPIRED','测试结果已过期，请重新测试。');
 const current=preparePreviewConnection(state,tasks,draft,{generation,scene,now});
 if(plan.generation!==generation||plan.draftKey!==current.draftKey||plan.scene!==scene)return fail('CANDIDATE_CHANGED','配置或认证已变化，请重新测试。');
 if(plan.connectionRevision!==current.connectionRevision||plan.referenceKey!==current.referenceKey)return fail('PLAN_STALE','配置或历史引用已变化，请重新测试并核对影响。');
 if(current.status==='identity-change')return fail('IDENTITY_CHANGED','账号或服务身份变化不能直接覆盖；请添加新连接，再到项目侧切换。');
 if(plan.status!==current.status||stable(plan.impacts)!==stable(current.impacts))return fail('PLAN_STALE','预检结果已变化，请重新测试。');
 const issue=validateConnection(draft,hasCredential?'synthetic-presence':'');if(issue)return fail('INVALID_INPUT',issue);
 if(current.impacts.length&&!accepted)return fail('IMPACT_NOT_REVIEWED','请先核对受影响的历史版本。');
 const saved=saveConnection(state,publicDraft(draft),hasCredential),connection=saved.connections.find(connection=>connection.id===draft.id);
 const report={revision:connection.revision,versions:current.rows.filter(row=>row.version).map(row=>({version:row.version,status:current.impacts.find(impact=>impact.kind===row.kind&&impact.taskId===row.taskId&&impact.version===row.version)?.status??'compatible'}))};
 const next=projectIntegrationState({...saved,connectionCompatibility:{...saved.connectionCompatibility,[connection.id]:report}});return{ok:true,state:next,connection:next.connections.find(row=>row.id===draft.id)};
}

// The response owner outlives a form, so cancellation really exercises the late
// callback guard. Dispose only when the prototype workspace itself unmounts.
export function createPreviewConnectionChecks(changed=()=>{}){
 let sequence=0,completed=0,ignored=0;const jobs=new Map();
 const snapshot=()=>({started:sequence,pending:jobs.size,held:[...jobs.values()].filter(job=>job.held).length,completed,ignored});
 const publish=()=>changed(snapshot());
 const finish=id=>{const job=jobs.get(id);if(!job)return;clearTimeout(job.timer);jobs.delete(id);try{if(job.receive()!==true)ignored++;}finally{completed++;publish();}};
 return{snapshot,request(receive,{hold=false}={}){const id=++sequence,job={receive,held:hold,timer:null};jobs.set(id,job);if(!hold)job.timer=setTimeout(()=>finish(id),450);publish();return id;},release(){const next=[...jobs].find(([,job])=>job.held);if(!next)return false;finish(next[0]);return true;},dispose(){for(const job of jobs.values())clearTimeout(job.timer);jobs.clear();}};
}
