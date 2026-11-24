import {ApplicationError} from '@shared/applications';
import type {BrowserLoginState} from '../browser/login';
import type {BrowserScope,BrowserService} from '../browser/service';
import type {AgentStore} from './agent-store';
import type {AgentTaskService} from './agent-task-service';
import {DriverError} from './driver';
import type {BusinessRecord,HostBusinessRequests} from './host-business-requests';

export function attachBrowserLoginRequests(options:{
  browser:BrowserService;requests:HostBusinessRequests;tasks:AgentTaskService;store:AgentStore;
  assertEnabled:(projectId:string)=>void;
  scriptScope?:(record:BusinessRecord,runId:string,signal:AbortSignal)=>BrowserScope;
}){
  const {browser,requests,tasks,store,assertEnabled}=options;
  browser.attachLoginGuard((taskId,pageId)=>requests.browserPageAwaitingLogin(taskId,pageId));
  const data=(record:BusinessRecord)=>record.payload.data as BrowserLoginState;
  const ready=(record:BusinessRecord)=>browser.checkLoginReady(record.row.task_id,data(record));
  requests.register('browser_login',{
    needsRun:true,
    assertSourceCurrent:record=>browser.assertLoginTabIdentity(record.row.task_id,data(record)),
    validate:async(record,_decision,run)=>{
      const input=data(record),task=store.task(record.row.task_id),binding=store.binding(record.origin.bindingId);
      assertEnabled(input.projectId);
      if(!task||task.project_id!==input.projectId||binding?.task_id!==task.id||
        run&&run.bindingId!==record.origin.bindingId)
        throw new ApplicationError('INTENT_STALE','原任务或执行器绑定已变化');
      const selection=JSON.parse(task.selection_json);
      if(selection.profileId!==binding.profile_id||selection.driverId!==binding.driver_id)
        throw new ApplicationError('INTENT_STALE','任务已切换执行器或智能体');
      browser.validateLoginTab(task.id,input);
    },
    confirm:async(record,_decision,sender)=>{
      if(sender.sender.isDestroyed()||sender.senderFrame!==sender.sender.mainFrame)
        throw new DriverError('REJECTED','请从 WillYou 的原任务窗口确认登录');
      const state=await ready(record);
      if(state!=='ready')throw new DriverError('STATE',state==='loading'?'原网页仍在加载，请稍候确认':'原业务页仍未就绪。请在右侧完成登录并返回原业务页后确认');
    },
    readiness:ready,
    retire:record=>{
      const input=data(record);
      if(input.scriptExecutionId)browser.cancelScriptLogin(record.row.task_id,input.scriptExecutionId);
    },
    execute:async(record,_decision,{run,signal})=>{
      signal.throwIfAborted();
      if(!run||run.bindingId!==record.origin.bindingId)throw new DriverError('REJECTED','没有同一绑定的宿主运行');
      const input=data(record);
      if(input.scriptExecutionId){
        if(!options.scriptScope)throw new DriverError('STATE','原浏览器测试接续暂不可用');
        const scope=options.scriptScope(record,run.runId,signal);
        return browser.resumeScriptAfterLogin(scope,input);
      }
      const notice=JSON.stringify({pageId:input.pageId,checkpoint:input.checkpoint});
      const turn=tasks.enqueueHost(record.row.task_id,`browser-login-${record.row.request_id}-${record.row.revision}`,
        'WillYou 宿主已核验本人登录及原业务页。只继续第一个未完成的依赖步骤，先观察原标签，避免重发旧动作。已核验的原标签和接续位置 '+notice,'system');
      return{status:'verified',pageId:input.pageId,turnId:turn.turn.turn_id};
    },
  });
  browser.attachLoginRequest((scope,input)=>{
    const run=store.run(scope.runId);
    if(!run?.binding_id||run.task_id!==scope.taskId)throw new ApplicationError('SCOPE_DENIED','登录接力需要原任务运行身份');
    assertEnabled(scope.projectId);
    return requests.create({taskId:scope.taskId,runId:scope.runId,bindingId:run.binding_id,generation:run.generation},{
      operationId:scope.operationId,kind:'browser_login',title:'请在原网页完成登录',
      review:{pageId:input.pageId,origin:input.origin,checkpoint:input.checkpoint,scriptExecutionId:input.scriptExecutionId},data:input,
      options:[{label:'已登录，继续',value:'allow'}],
    });
  });
}
