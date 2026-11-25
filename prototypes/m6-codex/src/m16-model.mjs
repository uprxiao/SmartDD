// F16-P1.0 审阅原型，全部为合成数据，绝不实际派发任务、访问文件或联网。
// 日历算法与隔离 E01 实验同源；业务状态只用于原型演示。
import { AGENTS, PERMISSIONS } from './m14-model.mjs';
import { nextOccurrence as calendarNext, lastOccurrence, previewOccurrences, resolveOnce, validateSchedule } from './m16-schedule.mjs';
import { initialPreviewRecord, transitionPreviewRecord } from './m16-run-view.mjs';

export const WEEKDAYS = ['日','一','二','三','四','五','六'];
export const SCHEDULE_TYPES = [
  ['interval','固定间隔'],['daily','每天'],['workdays','工作日'],['weekly','每周指定日期'],
  ['monthly','每月'],['once','仅一次'],['cron','自定义 Cron'],
];
export const GRACE_OPTIONS = [[0,'不补跑'],[10,'10 分钟'],[60,'1 小时'],[720,'12 小时']];
export const DESTINATIONS = [['new','每次新建任务'],['reuse','持续复用同一任务'],['existing','继续指定任务']];
export const WORKSPACES = [['existing','使用现有目录'],['dedicated','计划专属 Worktree'],['per_run','每次新建 Worktree']];
export const RUN_STATUS = {claimed:'待派发',running:'工作中',waiting:'等待处理',completed:'已完成',failed:'失败',skipped:'已跳过',stopped:'已停止',unknown:'结果待核对'};
export const ACTIVE_RUNS = new Set(['claimed','running','waiting','unknown']);
export const usableAgents = AGENTS.filter(a=>a.tool&&!a.placeholder&&a.status?.kind!=='unavailable');
export const agentById = id => usableAgents.find(a=>a.id===id);
export const permissionsFor = id => PERMISSIONS.filter(p=>p.id!=='auto'||agentById(id)?.tool==='codex');
export const permissionLabel = id => PERMISSIONS.find(p=>p.id===id)?.name??id;
export const projectKey = id => id || '';
export const planEnded = p => !!p.ended;
export const planDate = p => p.enabled&&!p.archived&&!p.ended&&!p.needsRepair?p.nextAt:null;
export const planStatus = p => p.archived?'已删除':p.needsRepair?p.needsRepair.unavailable?'需修正':'需重新确认':p.ended?'已结束':p.enabled?'已启用':'已暂停';
const MIN=60000;
const clone = x => JSON.parse(JSON.stringify(x));
const stableSchedule = (s,now) => ({...s,...(s.type==='interval'&&!Number.isSafeInteger(s.anchor)?{anchor:now}:{}),...(s.type==='once'?{onceAt:resolveOnce(s)}:{})});
export function nextOccurrence(schedule, now=Date.now()){
  try{return calendarNext(stableSchedule(schedule,now),now)}catch{return null}
}
export function schedulePreview(schedule, now=Date.now()){
  try{
    const prepared=stableSchedule(schedule,now), valid=validateSchedule(prepared,now);
    if(!valid.ok)return {times:[],error:valid.error};
    return {times:previewOccurrences(prepared,now,3),error:''};
  }catch(e){return{times:[],error:e.message}}
}
export function formatRunTime(value, zone){
  if(value===null||value===undefined)return '—';
  try{return new Intl.DateTimeFormat('zh-CN',{timeZone:zone||undefined,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(value)}
  catch{return '—'}
}
export function formatDuration(run){
  if(run.startedAt==null||run.finishedAt==null)return '—';
  const s=Math.max(0,Math.floor((run.finishedAt-run.startedAt)/1000));
  return s<60?`${s} 秒`:`${Math.floor(s/60)} 分 ${s%60} 秒`;
}
export function scheduleLabel(s){
  if(s.type==='interval')return `每 ${s.minutes} 分钟`;
  if(s.type==='once')return `${s.date} ${s.time} · 仅一次`;
  if(s.type==='cron')return `Cron · ${s.cron}`;
  if(s.type==='monthly')return `每月${s.monthDay==='last'?'最后一天':s.monthDay+' 日'} ${s.time}`;
  if(s.type==='weekly')return `周${[...(s.days??[])].sort((a,b)=>(a+6)%7-(b+6)%7).map(n=>WEEKDAYS[n]).join('、')} ${s.time}`;
  return `${s.type==='workdays'?'工作日':'每天'} ${s.time}`;
}
const defaultProject=projects=>projects.find(p=>p.id==='smartdd'&&!p.archived)??projects.find(p=>!p.archived);
export const defaultDir=p=>p?.dirs?.find(d=>d.isDefault&&d.available!==false)??p?.dirs?.find(d=>d.available!==false);
export function defaultDraft(projects, now=Date.now()){
  const p=defaultProject(projects),d=defaultDir(p),date=new Date(now+86400000);
  const day=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  return {name:'',prompt:'',projectId:p?.id??'',dirId:d?.id??'',standaloneMode:'managed',localPath:'',
    workspace:'existing',branch:'main',destination:'new',taskId:'',boundTask:null,
    agent:'cx-sub',model:'gpt-6.2-sol',effort:'中等',permission:'ask',delegation:false,successNotify:false,
    schedule:{type:'workdays',time:'09:00',days:[1],minutes:60,date:day,zone:'',monthDay:'last',cron:'0 9 * * 1-5'},
    grace:60,enabled:true,ended:false,needsRepair:null};
}
export function taskConfig(task, projects){
  const invalid=error=>({available:false,error,agent:'',model:'',effort:'',permission:'ask',cwd:task?.cwd??'',dirId:task?.dirId??''});
  if(!task||task.archived)return invalid('绑定任务不存在或已归档');
  const p=projects.find(x=>x.id===task?.project);
  const dir=p?.dirs?.find(x=>x.id===task.dirId);
  const explicit=task.agentId??task.m16Binding?.agent;
  const tool=task.runner??task.agent?.tool;
  const providerName=task.agent?.providerName??task.agent?.providerId;
  if(!explicit&&!providerName&&task.agent?.source&&task.agent.source!=='login'&&task.agent.method!=='subscription')return invalid('绑定任务供应商身份不可识别');
  const normalize=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const known=explicit?agentById(explicit):providerName?usableAgents.find(a=>a.tool===tool&&a.provider&&[a.providerBadge?.name,a.providerBadge?.catalog,a.provider&&!a.providerBadge?'DeepSeek':null].some(x=>x&&normalize(x)===normalize(providerName))):usableAgents.find(a=>a.tool===tool&&!a.provider);
  if(!known)return invalid('绑定任务的智能体或供应商不可用');
  const explicitModel=task.model??task.agent?.model??task.agent?.runModelName;
  const model=explicitModel?known.models.find(m=>m.id===explicitModel||m.name===explicitModel):known.models.find(m=>m.id==='default');
  if(!model)return invalid('绑定任务的真实模型不可用');
  const permission=task.permission??'ask',effort=task.effort??model.defaultEffort??known.defaultEffort??'';
  if(!permissionsFor(known.id).some(p=>p.id===permission)||(model.efforts??known.efforts??[]).length&&!(model.efforts??known.efforts).includes(effort))return invalid('绑定任务权限或推理档位不可用');
  if(typeof task.cwd!=='string'||!task.cwd.trim()||!(task.cwd.startsWith('/')||task.cwd.startsWith('~/')))return invalid('绑定任务实际工作目录不可用');
  return {available:true,agent:known.id,model:model.id,effort,permission,delegation:!!task.delegation,dirId:dir?.id??task.dirId??'',cwd:task.cwd};
}
export function workspacePath(plan,projects,runId){
  if((plan.destination==='existing'||plan.destination==='reuse'&&plan.boundTask)&&plan.cwd)return plan.cwd;
  if(plan.workspace==='dedicated')return `~/.willyou/worktrees/计划-${plan.id??'首次运行时创建'}`;
  if(plan.workspace==='per_run')return `~/.willyou/worktrees/计划-${plan.id??'新计划'}-${runId??'每次运行新建'}`;
  if(!plan.projectId)return plan.standaloneMode==='local'?plan.localPath:`~/.willyou/scheduled/${plan.id??'新计划'}`;
  return projects.find(p=>p.id===plan.projectId)?.dirs?.find(d=>d.id===plan.dirId)?.path??plan.cwd??'目录不可用';
}
export function validateDraft(d,projects,tasks,now=Date.now()){
  if(!d.name.trim())return '请输入计划名称';
  if(!d.prompt.trim())return '请输入任务提示词';
  const p=projects.find(p=>!p.archived&&p.id===d.projectId);
  if(d.projectId&&!p)return '请选择可用项目';
  if(d.projectId&&d.destination!=='existing'&&!p?.dirs.some(x=>x.id===d.dirId&&x.available!==false))return '请选择可用的工作目录';
  if(!d.projectId&&d.destination!=='existing'&&d.standaloneMode==='local'&&!(d.localPath??'').trim().startsWith('/'))return '请选择本机绝对目录（合成）';
  const dir=p?.dirs.find(d0=>d0.id===d.dirId);
  if(!['existing','dedicated','per_run'].includes(d.workspace))return '请选择工作区';
  if(d.workspace!=='existing'&&(!p||dir?.vcs!=='Git'||!d.branch.trim()))return '新建工作树需要 Git 目录和基准分支';
  if(d.workspace==='per_run'&&d.destination!=='new')return '每次新建 Worktree 只能每次新建任务';
  if(d.destination==='existing'){
    const target=tasks.find(t=>t.id===d.taskId&&projectKey(t.project)===projectKey(d.projectId)&&!t.archived);
    if(d.workspace!=='existing'||!target)return '请选择该归属下的已有任务，并沿用其实际目录';
    if(!taskConfig(target,projects).available)return taskConfig(target,projects).error;
  }
  if(d.destination==='reuse'&&d.boundTask){
    const target=tasks.find(t=>t.id===d.boundTask&&projectKey(t.project)===projectKey(d.projectId)&&!t.archived);
    if(!target)return '已绑定任务不可用，请修正任务去向';
    const config=taskConfig(target,projects);
    if(!config.available)return config.error;
  }
  if(d.destination!=='existing'&&d.boundTask&&d.workspace==='per_run')return '已绑定任务不能迁移到新工作树';
  const agent=agentById(d.agent), model=agent?.models?.find(m=>m.id===d.model);
  if(!agent||!model)return '智能体或模型不可用，请修正';
  if(!permissionsFor(d.agent).some(p=>p.id===d.permission))return '请选择该执行器支持的权限';
  const efforts=model.efforts??agent.efforts??[];
  if(efforts.length&&!efforts.includes(d.effort))return '请选择模型支持的推理强度';
  if(!GRACE_OPTIONS.some(([x])=>x===d.grace))return '请选择有效宽限期';
  if(d.ended&&d.schedule.type==='once'&&Number.isSafeInteger(d.schedule.onceAt)&&d.schedule.onceAt<=now)return '';
  return schedulePreview(d.schedule,now).error;
}
export function saveDraft(draft,id,previous,now=Date.now()){
  const schedule=stableSchedule(draft.schedule,now);
  const next=calendarNext(schedule,now);
  const ended=schedule.type==='once'&&next===null;
  return {...clone(draft),id,schedule,ended,enabled:!ended&&draft.enabled,nextAt:!ended&&draft.enabled?next:null,
    boundTask:draft.destination==='existing'?draft.taskId:draft.destination==='reuse'?draft.boundTask??null:null,
    revision:(previous?.revision??0)+1,archived:false,needsRepair:null};
}
export const activeForPlan=(data,p)=>data.runs.some(r=>r.planId===p.id&&ACTIVE_RUNS.has(r.status));
const targetFor=p=>p.destination==='existing'?p.taskId:p.destination==='reuse'?p.boundTask:null;
export function busyReason(data,p,tasks=[]){
  if(activeForPlan(data,p))return '前次运行尚未结束';
  const target=targetFor(p);
  if(target&&(data.runs.some(r=>r.taskId===target&&ACTIVE_RUNS.has(r.status))||tasks.some(t=>t.id===target&&['running','working','waiting','pending','queued'].includes(t.status))))return '绑定任务正忙，本次不排队';
  return '';
}
export function makeRun(plan,id,trigger,due,status,now=Date.now(),projects=[]){
  const dispatched=!['skipped'].includes(status);
  const taskId=dispatched?(targetFor(plan)??(plan.destination==='reuse'?`demo-task-${plan.id}`:`demo-task-${id}`)):null;
  return {id,planId:plan.id,title:plan.name,trigger,scheduledFor:due,startedAt:dispatched?now:null,
    finishedAt:ACTIVE_RUNS.has(status)?null:now,status,taskId,turnId:taskId?`demo-turn-${id}`:null,
    agent:plan.agent,model:plan.model,effort:plan.effort,permission:plan.permission,delegation:plan.delegation,
    projectId:plan.projectId,dirId:plan.dirId,prompt:plan.prompt,zone:plan.schedule.zone,successNotify:plan.successNotify,
    cwd:dispatched?workspacePath(plan,projects,id):null,branch:dispatched&&plan.workspace!=='existing'?`scheduled/${plan.id}${plan.workspace==='per_run'?'-'+id:''}`:null,
    baseCommit:dispatched&&plan.workspace!=='existing'?'示例：4ab8f21':null,attempts:dispatched?1:0,reason:'',approval:null};
}
const getPlan=(data,id)=>data.plans.find(p=>p.id===id);
function notice(data,run){
  if(!(['failed','waiting','unknown'].includes(run.status)||(run.status==='completed'&&run.successNotify)))return data.notifications??[];
  const event=run.approval?.id??run.status, key=`${run.id}:${event}`;
  const list=data.notifications??[];
  return list.some(n=>n.key===key)?list:[{key,runId:run.id,planId:run.planId,text:`${run.title} · ${RUN_STATUS[run.status]}`,at:run.finishedAt??run.startedAt},...list];
}
export function launchDemo(data,planId,trigger,id,now=Date.now(),scenario='due',projects=[],tasks=[]){
  const p=getPlan(data,planId);
  if(!p||p.archived||p.needsRepair||(trigger==='scheduled'&&(planDate(p)===null)))return{data,hint:'当前计划不能触发'};
  const busy=busyReason(data,p,tasks);
  if(trigger==='manual'&&busy)return{data,hint:busy};
  const firstDue=trigger==='manual'?now:p.nextAt;
  const delta=scenario==='outside'?(p.grace+1)*MIN:scenario==='within'?Math.max(1,p.grace/2)*MIN:0;
  const actualNow=trigger==='scheduled'?Math.max(now,firstDue+delta):now;
  // For simulated wake the ledger coalesces to the most recent occurrence.
  const due=trigger==='scheduled'?lastOccurrence(p.schedule,actualNow)??firstDue:firstDue;
  const missed=trigger==='scheduled'&&scenario!=='due'&&scenario!=='startup'&&scenario!=='unknown'&&scenario!=='binding'&&(p.grace===0||actualNow-due>p.grace*MIN);
  const reason=missed?'错过执行时间，已超过宽限期':busy;
  const targetId=targetFor(p);
  const target=targetId?(tasks.find(t=>t.id===targetId)??data.reuseTasks?.[targetId]):null;
  const raw=target?taskConfig(target,projects):null;
  const current=raw?.available?{...raw,...(data.bindingOverrides?.[targetId]??{})}:null;
  const bindingUnavailable=!!targetId&&(!current||target.archived||projectKey(target.project)!==projectKey(p.projectId));
  const bindingChanged=!!targetId&&!!current&&(current.agent!==p.agent||current.permission!==p.permission||current.cwd!==p.cwd||current.delegation!==p.delegation);
  const unavailable=bindingUnavailable||!!p.projectId&&!projects.some(x=>x.id===p.projectId&&!x.archived)||!targetId&&!!p.projectId&&!projects.find(x=>x.id===p.projectId)?.dirs?.some(x=>x.id===p.dirId&&x.available!==false);
  const needsRepair=scenario==='binding'||bindingChanged||unavailable;
  const launchConfig=current?{...p,...current}:p;
  const run=makeRun(launchConfig,id,trigger,due,reason?'skipped':needsRepair?'failed':scenario==='unknown'?'unknown':'running',actualNow,projects);
  run.missedFrom=due>firstDue?firstDue:null;
  if(reason)run.reason=reason;
  else if(needsRepair){
    run.reason='绑定配置已变更，等待重新确认；未发送任务';
    Object.assign(run,{taskId:null,turnId:null,startedAt:null,cwd:null,attempts:0,branch:null,baseCommit:null});
  }else if(scenario==='startup'){run.attempts=2;run.reason='已证明未提交：自动重试一次（同一运行身份）'}
  else if(scenario==='unknown'){
    run.reason='提交回执未知，暂停后续运行；先核对原任务，不能重发';run.turnId=null;run.startedAt=null;
  }else if(scenario==='within')run.reason='宽限期内，仅补最近一次';
  const nextAt=trigger==='scheduled'?nextOccurrence(p.schedule,actualNow):p.nextAt;
  const reuseTasks={...(data.reuseTasks??{})};
  if(p.destination==='reuse'&&run.taskId&&!targetId){reuseTasks[run.taskId]={id:run.taskId,project:p.projectId||null,dirId:p.dirId,cwd:run.cwd,agentId:run.agent,model:run.model,effort:run.effort,permission:run.permission,delegation:run.delegation}}
  const plans=data.plans.map(x=>x.id===p.id?{...x,nextAt,ended:x.ended||(x.schedule.type==='once'&&trigger==='scheduled'&&!ACTIVE_RUNS.has(run.status)),enabled:x.enabled&&!(x.schedule.type==='once'&&trigger==='scheduled'&&!ACTIVE_RUNS.has(run.status)),
    boundTask:x.destination==='reuse'&&run.taskId?run.taskId:x.boundTask,
    ...(x.destination==='reuse'&&run.cwd?{cwd:run.cwd}:{}),
    ...(current&&!bindingChanged?{model:current.model,effort:current.effort}:{}),
    needsRepair:needsRepair&&!reason?{reason:unavailable?(raw?.error??'原项目、目录或任务不可用，请编辑修正'):'Agent / Provider 或目录 / 权限变化',previous:x.agent,pendingAgent:scenario==='binding'?(x.agent==='cx-sub'?'cc-sub':'cx-sub'):current?.agent??x.agent,pending:scenario==='binding'?null:current,unavailable}:x.needsRepair}:x);
  run.previewRecord=initialPreviewRecord(run);
  const next={...data,plans,reuseTasks,runs:[run,...data.runs],notifications:notice(data,run)};
  return{data:next,hint:run.status==='skipped'?run.reason:''};
}
export function settleDemo(data,runId,status,now=Date.now(),approval='plugin'){
  const r=data.runs.find(x=>x.id===runId);
  if(!r||!ACTIVE_RUNS.has(r.status))return data;
  // An unknown receipt is not settled by blind retry. Only a simulated reconciliation can resolve it.
  if(r.status==='unknown'&&!['running','failed'].includes(status))return data;
  if(r.status===status)return data;
  const updated={...r,status,finishedAt:ACTIVE_RUNS.has(status)?null:Math.max(now,r.startedAt??r.scheduledFor),
    ...(r.status==='unknown'&&status==='running'?{startedAt:now,turnId:`demo-turn-${r.id}`}:{ }),
    approvalCount:(r.approvalCount??0)+(status==='waiting'?1:0),
    approval:status==='waiting'?{id:`approval-${(r.approvalCount??0)+1}`,type:approval,text:approval==='mail'?'邮件发送需本人逐次批准':approval==='login'?'等待本人登录／处理网页':'按原插件档位和上限请求本人审批'}:null,
    reason:status==='waiting'?'需要用户处理':status==='unknown'?'结果待核对，不重发':status==='failed'?'执行失败，保留任务及现场':status==='stopped'?'用户已停止本次运行':''};
  updated.previewRecord=transitionPreviewRecord(r,updated,Math.max(now,r.startedAt??now));
  const plans=data.plans.map(p=>p.id===r.planId&&p.schedule.type==='once'&&r.trigger==='scheduled'&&p.schedule.onceAt===r.scheduledFor&&!ACTIVE_RUNS.has(status)&&p.nextAt===null?{...p,enabled:false,ended:true}:p);
  return {...data,plans,runs:data.runs.map(x=>x.id===runId?updated:x),notifications:notice(data,updated)};
}
export function recheckDemo(data,planId,now=Date.now()){
  let overrides=data.bindingOverrides??{};
  const plans=data.plans.map(p=>{
    if(p.id!==planId||!p.needsRepair||p.needsRepair.unavailable)return p;
    const a=agentById(p.needsRepair.pendingAgent)??agentById(p.agent),m=a.models[0];
    const config=p.needsRepair.pending??{agent:a.id,model:m.id,effort:m.defaultEffort??a.defaultEffort??'',permission:'ask',cwd:p.cwd};
    if(targetFor(p))overrides={...overrides,[targetFor(p)]:config};
    return {...p,...config,needsRepair:null,
      revision:(p.revision??0)+1,nextAt:p.enabled&&!p.ended?nextOccurrence(p.schedule,now):null};
  });
  return {...data,plans,bindingOverrides:overrides};
}
export function seedPlans(projects,now=Date.now()){
  const base=defaultDraft(projects,now),other=projects.find(p=>p.id!==base.projectId&&!p.archived),otherDir=defaultDir(other);
  const plans=[
    {...base,id:'daily-digest',name:'每日研发摘要',prompt:'整理项目最近的提交和未完成事项，生成简明研发摘要。'},
    {...base,id:'weekly-review',name:'每周代码检查',prompt:'检查本周改动和构建状态，列出需要关注的事项。',workspace:'dedicated',enabled:false,schedule:{...base.schedule,type:'weekly',days:[1],time:'10:00'}},
    {...base,id:'follow-up',name:'需求进展核对',prompt:'核对当前需求进展，整理新增问题和下一步工作。',projectId:other?.id??base.projectId,dirId:otherDir?.id??base.dirId,cwd:otherDir?.path??defaultDir(defaultProject(projects))?.path,destination:'reuse',boundTask:'demo-task-follow-up',agent:'cc-sub',model:'sonnet',effort:'中',delegation:true,schedule:{...base.schedule,type:'interval',minutes:240}},
    {...base,id:'monthly-common',projectId:'',dirId:'',name:'每月知识整理',prompt:'在独立通用工作区整理本月公开信息和学习笔记。',schedule:{...base.schedule,type:'monthly',monthDay:'last',time:'17:00'},agent:agentById('agy-hub')?'agy-hub':'cx-sub',model:agentById('agy-hub')?.models[0]?.id??'gpt-6.2-sol',effort:agentById('agy-hub')?.models[0]?.defaultEffort??(agentById('agy-hub')?'低':'中等')},
  ].map(p=>saveDraft(p,p.id,null,now));
  const runs=[
    {...makeRun(plans[0],'seed-1','scheduled',now-86400000,'completed',now-86300000,projects),finishedAt:now-86284000},
    {...makeRun(plans[0],'seed-2','scheduled',now-172800000,'skipped',now-172800000,projects),reason:'前次运行尚未结束'},
    {...makeRun(plans[1],'seed-3','scheduled',now-3*86400000,'failed',now-3*86400000,projects),taskId:null,turnId:null,startedAt:null,cwd:null,branch:null,baseCommit:null,attempts:0,reason:'智能体配置不可用，任务未派发'},
    {...makeRun(plans[2],'seed-4','scheduled',now-7200000,'waiting',now-7100000,projects),reason:'需要用户处理审批',approval:{type:'plugin',text:'按原插件权限请求本人审批'}},
    {...makeRun(plans[3],'seed-5','manual',now-900000,'completed',now-899000,projects),finishedAt:now-890000},
  ].map(r=>({...r,previewRecord:initialPreviewRecord(r)}));
  const p=plans[2],reuseTasks={[p.boundTask]:{id:p.boundTask,project:p.projectId||null,dirId:p.dirId,cwd:p.cwd,agentId:p.agent,model:p.model,effort:p.effort,permission:p.permission,delegation:p.delegation}};
  return {plans,runs,reuseTasks,notifications:runs.filter(r=>['waiting','failed'].includes(r.status)).map(r=>({key:`${r.id}:${r.status}`,runId:r.id,planId:r.planId,text:`${r.title} · ${RUN_STATUS[r.status]}`,at:r.startedAt}))};
}
