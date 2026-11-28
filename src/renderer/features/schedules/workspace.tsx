import {useEffect,useRef,useState} from 'react';
import {makeAutoObservable,runInAction,toJS} from 'mobx';
import {observer} from 'mobx-react-lite';
import {ArrowLeft,Bell,Clock,Edit2,List,Pause,Play,Plus,Trash2,X} from 'lucide-react';
import {rpc,events} from '@renderer/lib/ipc';
import {navigation} from '@renderer/core/navigation';
import {agentTasksStore} from '@renderer/core/agent-tasks-store';
import {useAgents} from '@renderer/lib/hooks/useAgents';
import {useProject,useProjectList} from '@renderer/lib/hooks/useProjects';
import {AgentModelPicker} from '@renderer/features/agent-tasks/agent-model-picker';
import {ScheduledReply} from '@renderer/features/agent-tasks/agent-task-view';
import {panelsFor} from '@renderer/features/agent-tasks/workspace-panels-store';
import {providerModelOptions,isClaudeSubscription} from '@shared/agent-model-choice';
import {scheduleConfigSchema,newScheduleConfig,newSchedule,defaultScheduleGrace,type Schedule,type ScheduleConfig,type SchedulePlan} from '@shared/schedule';
import {scheduleChangedEvent,scheduleOpenEvent} from '@shared/events';
import './workspace.css';

const stateName:Record<string,string>={claimed:'待派发',preparing:'准备中',dispatching:'待受理',running:'工作中',waiting:'等待处理',unknown:'待核对',completed:'已完成',failed:'失败',skipped:'已跳过',stopped:'已停止'};
const date=(n:number|null|undefined)=>n==null?'—':new Date(n).toLocaleString();
const frequency=(s:Schedule)=>s.type==='interval'?`每 ${s.minutes} 分钟`:s.type==='cron'?s.cron:s.type==='once'?`${s.date} ${s.time}`:s.type==='weekly'?`每周 ${s.days.map(n=>'日一二三四五六'[n]).join('、')} ${s.time}`:s.type==='monthly'?`每月 ${s.monthDay==='last'?'最后一天':s.monthDay+' 日'} ${s.time}`:`${s.type==='workdays'?'工作日':'每天'} ${s.time}`;
function planState(p:SchedulePlan){return p.archived?'已删除':p.repair?'需修正':p.ended?'已结束':p.enabled?'已启用':'已暂停';}
class ViewState{
  plans:Awaited<ReturnType<typeof rpc.schedule.list>>=[];notices:Awaited<ReturnType<typeof rpc.schedule.notices>>=[];showNotices=false;selectedPlan:SchedulePlan|null=null;planId:string|null=null;runId:string|null=null;editing:SchedulePlan|null|undefined=undefined;error='';
  constructor(){makeAutoObservable(this);}
  async refresh(){try{const [plans,notices]=await Promise.all([rpc.schedule.list(true),rpc.schedule.notices()]);runInAction(()=>{this.plans=plans;this.notices=notices;this.error='';});}catch(error){runInAction(()=>{this.error=String(error);});}}
  open(id:string|null,runId:string|null=null){this.showNotices=false;this.planId=id;this.runId=runId;this.editing=undefined;this.selectedPlan=null;if(id&&!this.plans.some(p=>p.id===id))void rpc.schedule.get(id).then(r=>runInAction(()=>{if(this.planId===id)this.selectedPlan=r.plan;})).catch(()=>runInAction(()=>{this.error='原计划已不可用';}));}
  openNotices(){this.open(null);this.showNotices=true;}
  edit(p:SchedulePlan|null){this.editing=p;this.error='';}
  dismiss(){this.editing=undefined;}
}
export const scheduleView=new ViewState();
export function useScheduleEvents(){useEffect(()=>{const off=events.on(scheduleChangedEvent,()=>void scheduleView.refresh()),open=events.on(scheduleOpenEvent,value=>{if(value.taskId&&value.turnId&&agentTasksStore.tasks.some(t=>t.taskId===value.taskId)){navigation.openAgentTask(value.taskId,false,{turnId:value.turnId,requestId:value.requestId});}else{scheduleView.open(value.planId,value.runId??null);navigation.navigate('scheduled');}});return()=>{off();open();};},[]);}
export const ScheduleSidebar=observer(function ScheduleSidebar(){
  useEffect(()=>{void scheduleView.refresh();},[]);
  return <aside className="sidebar scheduled-sidebar"><h2>定时任务</h2><button className="nav-row" onClick={()=>scheduleView.edit(null)}><Plus size={16}/>新建计划</button><button className="nav-row" onClick={()=>scheduleView.open(null)}><List size={16}/>全部计划 <span>{scheduleView.plans.filter(p=>!p.archived).length}</span></button><p>即将执行</p>{[...scheduleView.plans].filter(p=>!p.archived&&p.enabled&&p.nextDue!==null).sort((a,b)=>a.nextDue!-b.nextDue!).map(p=><button className={`schedule-side-entry ${scheduleView.planId===p.id?'selected':''}`} key={p.id} onClick={()=>scheduleView.open(p.id)}><Clock size={15}/><span className="schedule-side-copy"><span className="schedule-side-name" title={p.config.title}>{p.config.title}</span><small>{date(p.nextDue)}</small></span></button>)}<button className="nav-row" onClick={()=>scheduleView.openNotices()}><Bell size={16}/>通知与历史 <span>{scheduleView.notices.length}</span></button><p>计划与历史</p>{scheduleView.plans.filter(p=>!p.archived&&(!p.enabled||p.nextDue===null)).map(p=><button key={p.id} className="schedule-side-entry" onClick={()=>scheduleView.open(p.id)}><Clock size={15}/><span className="schedule-side-copy"><span className="schedule-side-name" title={p.config.title}>{p.config.title}</span><small>{planState(p)}</small></span></button>)}</aside>;
});
type ScheduleConfirmation={message:string;title:string;destructive:boolean;resolve:(allowed:boolean)=>void};
function useScheduleConfirmation(){
  const [value,setValue]=useState<ScheduleConfirmation|null>(null),pending=useRef<ScheduleConfirmation|null>(null);
  const answer=(allowed:boolean)=>{const q=pending.current;pending.current=null;setValue(null);q?.resolve(allowed);};
  useEffect(()=>()=>{pending.current?.resolve(false);pending.current=null;},[]);
  const ask=(message:string,title='确认操作',destructive=false)=>new Promise<boolean>(resolve=>{
    pending.current?.resolve(false);const q={message,title,destructive,resolve};pending.current=q;setValue(q);
  });
  const dialog=value&&<div className="schedule-confirm-overlay" onClick={e=>{if(e.target===e.currentTarget)answer(false);}}>
    <section className="schedule-confirm" role="alertdialog" aria-modal="true" aria-label={value.title} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();answer(false);}}}>
      <h3>{value.title}</h3><p>{value.message}</p><footer><button autoFocus onClick={()=>answer(false)}>取消</button><button className={value.destructive?'schedule-danger':'schedule-primary'} onClick={()=>answer(true)}>确认</button></footer>
    </section>
  </div>;
  return{ask,dialog};
}
function ScheduleForm({plan,onSaved}:{plan:SchedulePlan|null;onSaved:(p:SchedulePlan)=>void}){
  const confirmation=useScheduleConfirmation();
  const {data:projects}=useProjectList(),{data:agents}=useAgents();
  const [config,setConfig]=useState<ScheduleConfig>(()=>plan?toJS(plan.config):newScheduleConfig());
  const [schedule,setSchedule]=useState<Schedule>(()=>plan?toJS(plan.schedule):newSchedule());
  const [grace,setGrace]=useState<0|10|60|720>((plan?.grace??defaultScheduleGrace) as 0|10|60|720);const [enabled,setEnabled]=useState(plan?.enabled??true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState<number[]>([]);
  const {data:project}=useProject(config.projectId);const profiles=agents?.configs.filter(p=>p.source!=='legacy'&&p.available)??[];
  const patch=(v:Partial<ScheduleConfig>)=>setConfig(c=>({...c,...v}));
  const gitAvailable=project?.dirs.find(d=>d.id===config.dirId)?.status.vcs==='git';
  const bindingLocked=(config.destination==='existing'&&!!config.boundTask)||(config.destination==='reuse'&&plan?.config.destination==='reuse'&&!!plan.boundTask);
  const profile=profiles.find(p=>p.id===config.profileId),profileId=config.profileId||profiles[0]?.id||'';
  useEffect(()=>{if(!config.profileId&&profileId)patch({profileId});},[profileId]);
  useEffect(()=>{let current=true;rpc.schedule.preview({schedule,planId:plan?.id,revision:plan?.revision}).then(v=>{if(current){setPreview(v);setError('');}}).catch(error=>{if(current){setPreview([]);setError(String(error));}});return()=>{current=false;};},[schedule,plan?.id,plan?.revision]);
  const selectType=(type:Schedule['type'])=>{const zone=schedule.zone;const time='time'in schedule?schedule.time:'09:00';switch(type){case'interval':setSchedule({type,zone,minutes:60});break;case'once':setSchedule({type,zone,time,date:new Date(Date.now()+86400000).toLocaleDateString('en-CA')});break;case'weekly':setSchedule({type,zone,time,days:[1]});break;case'monthly':setSchedule({type,zone,time,monthDay:1});break;case'cron':setSchedule({type,zone,cron:'0 9 * * 1-5'});break;default:setSchedule({type,zone,time});}};
  const save=async()=>{setBusy(true);setError('');try{
    const checked=scheduleConfigSchema.parse(config);const confirmTier=(!plan&&checked.tier==='full'||!!plan&&plan.config.tier!==checked.tier);if(confirmTier&&!await confirmation.ask(`确认本次权限：${checked.tier==='full'?'完全访问':checked.tier==='auto'?'帮我批准':'请求批准'}？`,'确认执行权限'))return;
    const p=await rpc.schedule.save({id:plan?.id,revision:plan?.revision,schedule,config:checked,grace,enabled},confirmTier);onSaved(p);
  }catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  return <div className="schedule-modal-overlay"><section className="schedule-form" role="dialog" aria-label={plan?'编辑定时任务':'新建定时任务'}><header><strong>{plan?'编辑计划':'新建计划'}</strong><button aria-label="关闭" onClick={()=>scheduleView.dismiss()}><X size={16}/></button></header><div className="schedule-form-body"><div className="schedule-prompt"><label>计划名称<input value={config.title} placeholder="例如：每日研发摘要" onChange={e=>patch({title:e.target.value})}/></label><label className="schedule-prompt-text">提示词<textarea value={config.prompt} placeholder="每次执行需要 Agent 完成什么？" onChange={e=>patch({prompt:e.target.value})}/></label><small>支持普通任务的 Skill、@文件引用和工具能力。</small></div><div className="schedule-fields">
      <label>智能体{profileId?<AgentModelPicker modalOverlay profileId={profileId} model={config.model} effort={config.effort} locked={bindingLocked} disabled={bindingLocked} scope={config.boundTask||bindingLocked&&plan?.boundTask?{kind:'task',taskId:(config.boundTask??plan!.boundTask)!}:config.projectId&&config.dirId?{kind:'project',projectId:config.projectId,dirId:config.dirId}:{kind:'standalone'}} profiles={profiles.map(p=>{const provider=agents?.providers.find(v=>v.id===p.providerId);return{profileId:p.id,name:p.name,kind:p.kind,source:p.source,models:p.models,defaultModel:p.defaultModel,available:p.available,codexSubscription:p.kind==='codex'&&p.source==='login',claudeSubscription:isClaudeSubscription(p,agents?.tools.find(t=>t.id===p.toolId)?.login),provider:provider?{name:provider.name,catalog:provider.preset}:undefined,modelOptions:providerModelOptions(provider,p)};})} onPick={(profileId,model,effort)=>setConfig(c=>({...c,profileId,model:model??undefined,effort:effort??undefined,tier:c.tier==='auto'&&profiles.find(p=>p.id===profileId)?.kind!=='codex'?'ask':c.tier}))} onExtensions={()=>{}}/>:<span>请先配置智能体</span>}</label>
      <label>权限<select disabled={bindingLocked} value={config.tier} onChange={e=>patch({tier:e.target.value as ScheduleConfig['tier']})}><option value="ask">请求批准</option>{profile?.kind==='codex'&&<option value="auto">帮我批准</option>}<option value="full">完全访问</option></select></label>
      <label>项目<select disabled={bindingLocked} value={config.projectId??''} onChange={e=>patch({projectId:e.target.value||null,dirId:null,cwd:null,workspace:'directory',baseRef:null,boundTask:null,destination:'new'})}><option value="">未关联项目</option>{projects?.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
      {config.projectId?<label>项目目录<select disabled={bindingLocked} value={config.dirId??''} onChange={e=>patch({dirId:e.target.value||null,workspace:'directory',baseRef:null})}><option value="">选择目录</option>{project?.dirs.map(d=><option key={d.id} value={d.id}>{d.path}</option>)}</select></label>:<label>工作目录<button disabled={bindingLocked} onClick={async()=>{const path=await rpc.dialog.pickDirectory(config.cwd??undefined);if(path)patch({cwd:path});}}>{config.cwd??'自动分配独立目录'}</button>{config.cwd&&!bindingLocked&&<button onClick={()=>patch({cwd:null})}>使用自动目录</button>}</label>}
      <label>任务去向<select value={config.destination} onChange={e=>patch({destination:e.target.value as ScheduleConfig['destination'],boundTask:null,workspace:e.target.value==='new'?config.workspace:'directory'})}><option value="new">每次新建任务</option><option value="reuse">持续复用同一任务</option><option value="existing">继续指定任务</option></select></label>
      {config.destination==='existing'&&<label>指定任务<select value={config.boundTask??''} onChange={e=>{const t=agentTasksStore.tasks.find(t=>t.taskId===e.target.value);patch({boundTask:e.target.value||null,...(t?{cwd:t.cwd,dirId:t.dirId,profileId:t.selection.profileId,model:t.selection.model,effort:t.selection.effort,tier:t.selection.tier as ScheduleConfig['tier']}: {})});if(t)void rpc.agentTasks.relations(t.taskId).then(r=>setConfig(c=>c.boundTask===t.taskId?{...c,delegation:r.enabled}:c)).catch(()=>{});}}><option value="">选择任务</option>{agentTasksStore.tasks.filter(t=>t.projectId===config.projectId&&!t.parentTaskId).map(t=><option key={t.taskId} value={t.taskId}>{t.title}</option>)}</select></label>}
      {config.projectId&&config.destination!=='existing'&&<label>工作区<select disabled={bindingLocked} value={config.workspace} onChange={e=>patch({workspace:e.target.value as ScheduleConfig['workspace'],baseRef:e.target.value==='directory'?null:'HEAD'})}><option value="directory">使用现有目录</option>{gitAvailable&&<option value="plan-worktree">计划专属 Worktree</option>}{gitAvailable&&config.destination==='new'&&<option value="run-worktree">每次新建 Worktree</option>}</select></label>}
      {config.workspace!=='directory'&&<label>基准引用<input disabled={bindingLocked} value={config.baseRef??''} onChange={e=>patch({baseRef:e.target.value})}/></label>}
      <label>运行方式<select disabled={bindingLocked} value={String(config.delegation)} onChange={e=>patch({delegation:e.target.value==='true'})}><option value="false">单 Agent</option><option value="true">多 Agent</option></select></label>
      <label>日程<select value={schedule.type} onChange={e=>selectType(e.target.value as Schedule['type'])}>{[['interval','固定间隔'],['daily','每天'],['workdays','工作日'],['weekly','每周'],['monthly','每月'],['once','指定日期'],['cron','Cron']].map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
      {'time'in schedule&&<label>时间<input type="time" value={schedule.time} onChange={e=>setSchedule(s=>({...s,time:e.target.value}) as Schedule)}/></label>}
      {schedule.type==='interval'&&<label>间隔（分钟）<input type="number" min="1" value={schedule.minutes} onChange={e=>setSchedule({...schedule,minutes:Number(e.target.value)})}/></label>}
      {schedule.type==='once'&&<label>日期<input type="date" value={schedule.date} onChange={e=>setSchedule({...schedule,date:e.target.value,onceAt:undefined})}/></label>}
      {schedule.type==='weekly'&&<div className="schedule-days">{[0,1,2,3,4,5,6].map(n=><label key={n}><input type="checkbox" checked={schedule.days.includes(n)} onChange={e=>setSchedule({...schedule,days:e.target.checked?[...schedule.days,n]:schedule.days.filter(d=>d!==n)})}/>{'日一二三四五六'[n]}</label>)}</div>}
      {schedule.type==='monthly'&&<label>月日<select value={schedule.monthDay} onChange={e=>setSchedule({...schedule,monthDay:e.target.value==='last'?'last':Number(e.target.value)})}>{Array.from({length:31},(_,i)=>i+1).map(n=><option key={n}>{n}</option>)}<option value="last">最后一天</option></select></label>}
      {schedule.type==='cron'&&<label>Cron<input value={schedule.cron} onChange={e=>setSchedule({...schedule,cron:e.target.value})}/></label>}
      <label>时区<input placeholder="跟随本机（留空）" value={schedule.zone} onChange={e=>setSchedule({...schedule,zone:e.target.value})}/></label>
      <label>宽限期<select value={grace} onChange={e=>setGrace(Number(e.target.value) as typeof grace)}><option value={0}>不补跑</option><option value={10}>10 分钟</option><option value={60}>1 小时</option><option value={720}>12 小时</option></select></label>
      <div className="schedule-preview"><strong>接下来执行时间</strong>{preview.length?preview.map(n=><small key={n}>{date(n)}</small>):<small>暂无有效时间</small>}</div>
      <label className="schedule-check"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>保存后启用</label><label className="schedule-check"><input type="checkbox" checked={config.notifyCompleted} onChange={e=>patch({notifyCompleted:e.target.checked})}/>完成时通知</label>
    </div></div>{error&&<div className="schedule-error">{error}</div>}<footer><button onClick={()=>scheduleView.dismiss()}>取消</button><button className="schedule-primary" disabled={busy||!config.title.trim()||!config.prompt.trim()||!config.profileId} onClick={()=>void save()}>{busy?'保存中…':plan?'保存':'创建'}</button></footer></section>{confirmation.dialog}</div>;
}
export const ScheduleWorkspace=observer(function ScheduleWorkspace(){
  const confirmation=useScheduleConfirmation();
  const {data:agentData}=useAgents(),{data:projects}=useProjectList();
  const profileName=(id:string)=>agentData?.configs.find(p=>p.id===id)?.name??'智能体不可用';
  const providerName=(id:string)=>{const profile=agentData?.configs.find(p=>p.id===id);return agentData?.providers.find(p=>p.id===profile?.providerId)?.name??(profile?.source==='login'?'订阅':undefined);};
  const projectName=(id:string|null)=>id?projects?.find(p=>p.id===id)?.name??'原项目不可用':'未关联项目';
  const [resultTab,setResultTab]=useState<'result'|'process'|null>(null);
  const [workspaces,setWorkspaces]=useState<Awaited<ReturnType<typeof rpc.schedule.get>>['workspaces']>([]);
  const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[history,setHistory]=useState<Awaited<ReturnType<typeof rpc.schedule.get>>['history']>([]),[detail,setDetail]=useState<Awaited<ReturnType<typeof rpc.schedule.run>>|null>(null),[error,setError]=useState('');
  const plan=scheduleView.plans.find(p=>p.id===scheduleView.planId)??scheduleView.selectedPlan??undefined,runId=scheduleView.runId;
  const refresh=async()=>{if(plan){try{const d=await rpc.schedule.get(plan.id);if(scheduleView.planId!==plan.id)return;setHistory(d.history);setWorkspaces(d.workspaces);}catch(error){setError(String(error));}}if(runId){try{const d=await rpc.schedule.run(runId);if(scheduleView.runId===runId)setDetail(d);}catch(error){setError(String(error));}}};
  useEffect(()=>{void scheduleView.refresh();},[]);useEffect(()=>{setError('');setResultTab(null);setHistory([]);setWorkspaces([]);setDetail(null);void refresh();return events.on(scheduleChangedEvent,()=>{void refresh();});},[plan?.id,runId]);
  const action=async(fn:()=>Promise<unknown>)=>{setError('');try{await fn();await scheduleView.refresh();await refresh();}catch(error){setError(error instanceof Error?error.message:String(error));}};
  const confirmBinding=async()=>{if(!plan)return;await action(async()=>{
    const preview=await rpc.schedule.bindingPreview(plan.id,plan.revision);
    const keys=['profileId','compatibility','cwd','tier','delegation'] as const;
    const tierLabel={ask:'请求批准',auto:'帮我批准',full:'完全访问'};
    const lines=keys.filter(key=>preview.before[key]!==preview.after[key]).map(key=>{
      if(key==='compatibility')return '供应商连接身份发生变化（不显示凭据）';
      if(key==='profileId')return `智能体：${profileName(preview.before.profileId)} · ${providerName(preview.before.profileId)??'未关联供应商'} → ${profileName(preview.after.profileId)} · ${providerName(preview.after.profileId)??'未关联供应商'}`;
      if(key==='cwd')return `工作目录：${preview.before.cwd??'自动目录'} → ${preview.after.cwd??'自动目录'}`;
      if(key==='tier')return `权限：${tierLabel[preview.before.tier]} → ${tierLabel[preview.after.tier]}`;
      return `任务委派：${preview.before.delegation?'多 Agent':'单 Agent'} → ${preview.after.delegation?'多 Agent':'单 Agent'}`;
    });
    if(!await confirmation.ask('确认使用绑定任务的当前配置？\n'+lines.join('\n'),'重新确认绑定'))return;
    await rpc.schedule.reconfirm(plan.id,plan.revision,preview.token);
  });};
  const shown=scheduleView.plans.filter(p=>p.config.title.toLowerCase().includes(query.toLowerCase())&&(filter==='all'?!p.archived:planState(p)===filter));
  return <main className="schedule-content">{error&&<div className="schedule-error">{error}</div>}{scheduleView.error&&<div className="schedule-error">{scheduleView.error}</div>}
    {scheduleView.showNotices?<><div className="schedule-heading"><h1>通知与历史</h1></div>{scheduleView.notices.map(n=><div key={n.key} className="schedule-card"><strong>{n.title}</strong><p>{stateName[n.status]??'配置需修正'} · {date(n.createdAt)}</p><button onClick={()=>scheduleView.open(n.planId,n.runId)}>查看{n.runId?'运行记录':'计划修正'}</button></div>)}</>:plan&&runId&&detail?.run.id===runId?<section className="schedule-run-detail">
    <button className="schedule-back" onClick={()=>scheduleView.open(plan.id)}><ArrowLeft size={15}/><span className="schedule-back-title" title={plan.config.title}>{plan.config.title}</span><span className="schedule-back-tail">· 运行记录</span></button>
    <div className="schedule-heading">
      <div><h1 title={detail.run.snapshot.config.title}>{detail.run.snapshot.config.title}</h1><p>{stateName[detail.run.status]} · {detail.run.actualConfig?.profileName??profileName(detail.run.actualConfig?.profileId??detail.run.snapshot.config.profileId)} · {detail.run.actualConfig?.model??detail.run.snapshot.config.model??'默认模型'} {detail.run.actualConfig?.providerName?' · '+detail.run.actualConfig.providerName:''} {detail.run.actualConfig?.effort??''}</p><small>{date(detail.run.startedAt??detail.run.claimedAt)}{detail.run.finishedAt&&detail.run.startedAt?' · '+Math.max(0,Math.ceil((detail.run.finishedAt-detail.run.startedAt)/1000))+' 秒':''}</small></div>
      <div>
        {history[history.findIndex(r=>r.id===runId)+1]&&<button onClick={()=>scheduleView.open(plan.id,history[history.findIndex(r=>r.id===runId)+1].id)}>上一条</button>}
        {history.findIndex(r=>r.id===runId)>0&&<button onClick={()=>scheduleView.open(plan.id,history[history.findIndex(r=>r.id===runId)-1].id)}>下一条</button>}
        {['running','waiting'].includes(detail.run.status)&&<button onClick={()=>void action(()=>rpc.schedule.stop(runId))}>停止</button>}
        {detail.run.status==='unknown'&&<button onClick={()=>void action(()=>rpc.schedule.reconcile(runId))}>核对原结果</button>}
        {detail.target&&<button className="schedule-primary" onClick={()=>navigation.openAgentTask(detail.target!.taskId,detail.target!.archived,{turnId:detail.target!.turnId})}>查看完整任务</button>}
      </div>
    </div>
    {detail.missingTarget&&<p className="schedule-error">原任务或回合已不可用；以下仅为仍存在的运行记录。</p>}
    {detail.requests.map(r=><div className="schedule-card" key={r.requestId}><strong>等待你处理</strong><p>{r.kind}</p><button onClick={()=>navigation.openAgentTask(r.taskId,false,{turnId:r.turnId,requestId:r.requestId})}>查看原待处理请求</button></div>)}
    <nav className="schedule-run-tabs" aria-label="运行详情">
      <button className={(resultTab??(detail.run.status==='completed'?'result':'process'))==='result'?'selected':''} onClick={()=>setResultTab('result')}>运行结果</button>
      <button className={(resultTab??(detail.run.status==='completed'?'result':'process'))==='process'?'selected':''} onClick={()=>setResultTab('process')}>执行过程</button>
    </nav>
    {(resultTab??(detail.run.status==='completed'?'result':'process'))==='result'?<>
      {detail.result?<article className="schedule-card"><ScheduledReply taskId={detail.result.taskId} itemId={detail.result.itemId} archived={!!detail.target?.archived||!detail.target} text={typeof detail.result.payload?.text==='string'?detail.result.payload.text:JSON.stringify(detail.result.payload??'')}/></article>:<div className="schedule-card"><strong>暂无最终回复</strong><p>{detail.run.reason??(detail.run.status==='completed'?'本次运行没有可读取的最终父回合回复。':'本次运行尚无确认的最终结果，已知内容请查看执行过程。')}</p></div>}
      <section className="schedule-card"><strong>成果文件</strong>{detail.changes.length===0?<p>没有可读取的本次文件改动记录。</p>:detail.changes.map(c=><div className="schedule-output-files" key={c.turnId}>{c.files.map(file=><p key={file} title={file}>{file}</p>)}{c.status!=='complete'&&<small>{c.reason??'本轮文件差异尚未完整确认'}</small>}{c.total===0&&c.status==='complete'&&<small>本轮没有文件改动</small>}{c.total>0&&<button onClick={()=>{const panel=panelsFor({kind:'task',taskId:c.taskId});panel.diffTurn=c.turnId;panel.open('diff');navigation.openAgentTask(c.taskId,c.archived,{turnId:c.turnId});}}>查看本轮 {c.total} 个文件改动</button>}</div>)}</section>
    </>:<>
      <div className="schedule-card"><strong>{detail.run.turnId?'本次运行提示词':'计划提示词快照（尚无确认的任务输入）'}</strong><p>{detail.run.snapshot.config.prompt}</p>{detail.run.reason&&<p>{detail.run.reason}</p>}</div>
      {detail.items.length===0?<p>尚无可读取的实际执行记录。</p>:detail.items.map(i=><details key={i.itemId} className="schedule-item"><summary>{i.type} · {i.terminal??'执行中'}{detail.run.status!=='completed'?' · 非最终结果':''}</summary><pre>{JSON.stringify(i.payload,null,2)}</pre></details>)}
      {detail.hasMore&&<p>本次运行记录较多，完整内容可进入原任务查看对应回合。</p>}
    </>}
    <details className="schedule-card"><summary>本次运行配置</summary><dl>
      <dt>计划修订</dt><dd>{detail.run.revision}</dd><dt>触发来源</dt><dd>{detail.run.trigger==='manual'?'立即运行':'定时'}</dd>
      <dt>计划时间</dt><dd>{date(detail.run.due)}</dd><dt>实际开始</dt><dd>{date(detail.run.startedAt)}</dd><dt>结束</dt><dd>{date(detail.run.finishedAt)}</dd><dt>尝试次数</dt><dd>{detail.run.attempts}</dd>
      <dt>智能体</dt><dd>{detail.run.actualConfig?.profileName??profileName(detail.run.actualConfig?.profileId??detail.run.snapshot.config.profileId)}</dd><dt>供应商</dt><dd>{detail.run.actualConfig?.providerName??'未记录／订阅'}</dd><dt>模型</dt><dd>{detail.run.actualConfig?.model??detail.run.snapshot.config.model??'执行器默认'}</dd><dt>推理强度</dt><dd>{detail.run.actualConfig?.effort??detail.run.snapshot.config.effort??'执行器默认'}</dd>
      <dt>权限</dt><dd>{detail.run.actualConfig?.tier??detail.run.snapshot.config.tier}</dd><dt>委派</dt><dd>{(detail.run.actualConfig?.delegation??detail.run.snapshot.config.delegation)?'多 Agent':'单 Agent'}</dd>
      <dt>实际目录</dt><dd>{detail.run.actualConfig?.cwd??'尚未受理'}</dd>{detail.workspace&&<><dt>工作树</dt><dd>{detail.workspace.path}</dd><dt>基准引用</dt><dd>{detail.workspace.baseRef} · {detail.workspace.baseCommit}</dd><dt>分支</dt><dd>{detail.workspace.branch}</dd></>}
      <dt>实际任务</dt><dd>{detail.run.turnId?detail.run.taskId:'尚未受理'}</dd><dt>回合</dt><dd>{detail.run.turnId??'尚未受理'}</dd><dt>输入</dt><dd>{detail.run.turnId?detail.run.inputId:'尚未受理'}</dd>
    </dl></details>
  </section>:plan?<><button className="schedule-back" onClick={()=>scheduleView.open(null)}><ArrowLeft size={15}/> 全部计划</button><div className="schedule-heading"><div><h1 title={plan.config.title}>{plan.config.title}</h1><p>{planState(plan)}</p></div><div>{!plan.archived&&<><button onClick={()=>scheduleView.edit(plan)}><Edit2 size={14}/> 编辑</button><button onClick={()=>void action(()=>rpc.schedule.setEnabled(plan.id,plan.revision,!plan.enabled))}>{plan.enabled?<Pause size={14}/>:<Play size={14}/>} {plan.enabled?'暂停':'启用'}</button><button className="schedule-primary" onClick={()=>void action(async()=>{const c=await rpc.schedule.runNow(plan.id,plan.revision,crypto.randomUUID());if(!('run'in c))throw new Error(c.reason??c.kind);})}><Play size={14}/> 立即运行</button><button aria-label="删除计划" onClick={()=>void action(async()=>{if(await confirmation.ask('删除计划后停止未来触发，已接受运行及历史将保留。','删除计划',true)){await rpc.schedule.archive(plan.id,plan.revision);scheduleView.open(null);}})}><Trash2 size={14}/></button></>}</div></div><section className="schedule-card"><strong>计划配置</strong><dl><dt>执行频率</dt><dd>{frequency(plan.schedule)}</dd><dt>项目</dt><dd>{projectName(plan.config.projectId)}</dd><dt>智能体</dt><dd>{profileName(plan.config.profileId)}{providerName(plan.config.profileId)?' · '+providerName(plan.config.profileId):''}</dd><dt>运行方式</dt><dd>{plan.config.delegation?'多 Agent':'单 Agent'}</dd><dt>权限</dt><dd>{plan.config.tier}</dd><dt>下次执行</dt><dd>{date(plan.nextDue)}</dd><dt>时区</dt><dd>{plan.schedule.zone||'跟随本机'}</dd><dt>宽限期</dt><dd>{plan.grace} 分钟</dd><dt>任务去向</dt><dd>{plan.config.destination==='new'?'每次新建任务':plan.config.destination==='reuse'?'持续复用':'指定任务'}</dd><dt>工作区</dt><dd>{plan.config.workspace}</dd><dt>模型</dt><dd>{plan.config.model??'默认模型'}</dd><dt>推理强度</dt><dd>{plan.config.effort??'默认'}</dd><dt>提示词</dt><dd>{plan.config.prompt}</dd></dl>{plan.repair&&<><p className="schedule-error">{plan.repair}</p>{plan.boundTask&&<button onClick={()=>void confirmBinding()}>查看差异并重新确认</button>}</>}</section>{workspaces.length>0&&<details className="schedule-card"><summary>计划工作树</summary>{workspaces.map(w=><div key={w.id}><p>{w.path}<small>{w.branch} · {w.status}</small></p>{!plan.enabled&&w.status==='ready'&&<button onClick={()=>void action(async()=>{if(await confirmation.ask('仅移除这一个已登记工作树（不会强制删除、不会删除分支）。确认清理？','清理工作树',true))await rpc.schedule.cleanupWorkspace(plan.id,plan.revision,w.id);})}>清理工作树</button>}</div>)}</details>}<h2>运行记录 <small>{history.length}</small></h2><table><thead><tr><th>计划触发 / 实际开始</th><th>状态</th><th>结果</th><th>操作</th></tr></thead><tbody>{history.map(r=><tr key={r.id}><td>{date(r.due)}<small>{date(r.startedAt)}</small></td><td>{stateName[r.status]}</td><td><span className="schedule-summary" title={r.summary??undefined}>{r.summary??'—'}</span></td><td><button onClick={()=>scheduleView.open(plan.id,r.id)}>查看运行记录 ›</button></td></tr>)}</tbody></table></>:<><div className="schedule-heading"><div><h1>全部计划</h1><p>按指定时间自动执行 Agent 任务</p></div><button className="schedule-primary" onClick={()=>scheduleView.edit(null)}><Plus size={15}/> 新建计划</button></div><div className="schedule-filter"><input placeholder="搜索计划" value={query} onChange={e=>setQuery(e.target.value)}/><select value={filter} onChange={e=>setFilter(e.target.value)}>{['all','已启用','已暂停','需修正','已结束','已删除'].map(v=><option key={v} value={v}>{v==='all'?'全部状态':v}</option>)}</select></div><table><thead><tr><th>名称</th><th>执行频率</th><th>智能体</th><th>下次执行</th><th>最近结果</th><th>状态</th></tr></thead><tbody>{shown.map(p=><tr key={p.id} onClick={()=>scheduleView.open(p.id)} tabIndex={0} onKeyDown={e=>{if(e.key==='Enter'&&e.target===e.currentTarget)scheduleView.open(p.id);}}><td>{p.config.title}<small>{projectName(p.config.projectId)}</small></td><td>{frequency(p.schedule)}</td><td>{profileName(p.config.profileId)}{providerName(p.config.profileId)?' · '+providerName(p.config.profileId):''}<small>{p.config.model??'默认模型'} {p.config.effort??''}</small></td><td>{date(p.nextDue)}</td><td>{p.recent?<><span>{stateName[p.recent.status]??p.recent.status}</span><small className="schedule-summary" title={p.recent.summary??undefined}>{p.recent.summary??date(p.recent.claimedAt)}</small></>:'—'}</td><td>{planState(p)}{!p.archived&&!p.ended&&!p.repair&&<button className="schedule-list-toggle" aria-label={`${p.enabled?'暂停':'启用'} ${p.config.title}`} onClick={e=>{e.stopPropagation();void action(()=>rpc.schedule.setEnabled(p.id,p.revision,!p.enabled));}}>{p.enabled?<Pause size={13}/>:<Play size={13}/>}</button>}</td></tr>)}</tbody></table>{!shown.length&&<div className="schedule-empty">还没有计划。点击“新建计划”开始。</div>}</>}
    {confirmation.dialog}
    {scheduleView.editing!==undefined&&<ScheduleForm key={scheduleView.editing?.id??'new'} plan={scheduleView.editing} onSaved={p=>{void scheduleView.refresh();scheduleView.open(p.id);}}/>}
  </main>;
});
