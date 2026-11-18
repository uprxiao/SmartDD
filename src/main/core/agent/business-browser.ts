import type {BrowserService} from '../browser/service';
import type {RunContext} from '../applications/run-registry';
import type {AgentStore} from './agent-store';import type {HostBusinessRequests} from './host-business-requests';
export function attachAgentBrowserRequests(d:{store:AgentStore;requests:HostBusinessRequests;browser:Pick<BrowserService,'accessTarget'|'attachTaskAccess'|'bindTaskAccess'|'access'>;context(runId:string):RunContext;enabled(taskId:string):void}){
 d.requests.register('browser_access',{needsRun:true,stop:taskId=>d.browser.access.revokeTaskGrants(taskId),
  validate:async(record,decision)=>{
    const data=record.payload.data as {targetTaskId:string;target:ReturnType<BrowserService['accessTarget']>;mode:string};
    d.enabled(record.row.task_id);
    const target=d.browser.accessTarget(data.targetTaskId,data.target.pages.map(page=>page.id));
    if(JSON.stringify(target)!==JSON.stringify(data.target))throw Error('目标页面、地址或项目已变化，请重新申请授权');
    const task=d.store.task(record.row.task_id);
    if(!task?.project_id||target.projectId!==task.project_id||!target.pages.length)throw Error('授权页面已关闭或不属于本项目');
    const mode=(decision as {choice:string}).choice;
    if(!['observe','control'].includes(mode)||data.mode==='observe'&&mode==='control')throw Error('授权不能超过原申请范围');
  },
  execute:async(record,decision,{run})=>{if(!run)throw Error('尚无已登记运行，授权不可用');const context=d.context(run.runId);if(context.run.taskId!==record.row.task_id||context.signal.aborted)throw Error('新运行身份已经失效');const data=record.payload.data as {targetTaskId:string};const grant=d.browser.bindTaskAccess({runId:context.run.runId,taskId:context.run.taskId,projectId:context.run.projectId,signal:context.signal},data.targetTaskId,(decision as {choice:'observe'|'control'}).choice,record.row.request_id);return{status:'authorized',message:'浏览器授权已绑定当前运行并可用',boundRunId:run.runId,grantId:grant.id};},
  retire:record=>{try{d.browser.access.revoke(record.row.request_id);}catch{/* Unbound or already ended grants grant nothing. */}},
 });
 d.browser.attachTaskAccess({accept:(scope,targetTaskId,mode)=>{
  const run=d.store.run(scope.runId);if(!run?.binding_id)return undefined;
  if(run.task_id!==scope.taskId)throw Error('浏览器申请来源不符');d.enabled(scope.taskId);const target=d.browser.accessTarget(targetTaskId);if(!target.pages.length||target.projectId!==scope.projectId)throw Error('目标页面不存在或不属于本项目');
  return d.requests.create({taskId:scope.taskId,bindingId:run.binding_id,runId:scope.runId,generation:run.generation},{operationId:scope.operationId,kind:'browser_access',title:'跨任务浏览器授权',review:{requester:scope.taskId,targetTaskId,mode,pages:target.pages},data:{targetTaskId,mode,target},options:mode==='control'?[{label:'允许观察',value:'observe'},{label:'允许控制',value:'control'}]:[{label:'允许观察',value:'observe'}]});
 },revoke:id=>{const r=d.store.request(id);if(!r||r.class!=='host_business'||JSON.parse(r.payload_ref).businessKind!=='browser_access')return false;if(['pending','approved_pending_bind'].includes(r.status))d.requests.retire(id,'用户撤销浏览器授权');else d.browser.access.revoke(id);return true;}});
}
