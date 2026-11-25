import { useEffect, useMemo, useState } from 'react';
import { Archive, ArrowLeft, ArrowUpRight, Bell, CalendarClock, ChevronLeft, ChevronRight, Clock3, Edit3, FileText, List, Monitor, Pause, Play, Plus, Search, ShieldCheck, Trash2, X, AlertCircle, Hourglass, ListChecks } from 'lucide-react';
import { AgentIcon } from './m13-icons.jsx';
import { M14RecordedOutput, M14RecordedTimeline } from './M14TaskArea.jsx';
import { ACTIVE_RUNS, DESTINATIONS, GRACE_OPTIONS, RUN_STATUS, SCHEDULE_TYPES, WEEKDAYS, WORKSPACES, usableAgents, agentById, permissionsFor, permissionLabel, defaultDraft, defaultDir, formatRunTime, formatDuration, nextOccurrence, schedulePreview, scheduleLabel, seedPlans, validateDraft, taskConfig, workspacePath, saveDraft, planDate, planEnded, planStatus, busyReason, launchDemo, settleDemo, recheckDemo, projectKey } from './m16-model.mjs';
import { REVIEW_RUNS, confirmedTurn, defaultRunTab, initialPreviewRecord, orderedPlanRuns, runRecord, runResultSummary } from './m16-run-view.mjs';
import './m16.css';

const provider = agent => agent.providerBadge ?? (agent.provider ? { catalog: 'deepseek', name: 'DeepSeek' } : null);
const agentTitle = id => agentById(id)?.name ?? '智能体不可用';
const modelTitle = (agentId, modelId) => agentById(agentId)?.models.find(model => model.id === modelId)?.name ?? modelId;
const projectName = (projects, id) => id ? projects.find(p => p.id === id)?.name ?? '项目不可用' : '未关联项目';
const workspaceTitle = p=>WORKSPACES.find(([id])=>id===p.workspace)?.[1]??'现有目录';
const stamp = () => Math.random().toString(36).slice(2, 10);
const isBound = d=>d.destination==='existing'||d.destination==='reuse'&&!!d.boundTask;

function AgentCaption({ agentId, modelId, effort }) {
  const agent = agentById(agentId);
  return <span className="m16-agent-caption">{agent && <AgentIcon tool={agent.tool} provider={provider(agent)} size={17}/>}<span>{agentTitle(agentId)}{modelId&&<small>{modelTitle(agentId,modelId)}{effort?` · ${effort}`:''}</small>}</span></span>;
}

function initialReviewData(projects,scenario){
  const data=seedPlans(projects);
  if(!['running','partial','unknown'].includes(scenario))return data;
  const original=data.runs.find(r=>r.id==='seed-4'),id=REVIEW_RUNS[scenario];
  const status=scenario==='partial'?'failed':scenario==='unknown'?'unknown':'running';
  const run={...original,id,status,approval:null,finishedAt:status==='failed'?original.startedAt+7000:null,turnId:status==='unknown'?null:`demo-turn-${id}`,startedAt:status==='unknown'?null:original.startedAt,reason:status==='failed'?'连接中断，已保留执行期间的输出':status==='unknown'?'提交回执未知，等待核对原任务，不能重发':''};
  run.previewRecord=initialPreviewRecord(run);
  const notifications=data.notifications.filter(n=>n.runId!==original.id);
  if(['failed','unknown'].includes(run.status))notifications.unshift({key:`${run.id}:${run.status}`,runId:run.id,planId:run.planId,text:`${run.title} · ${RUN_STATUS[run.status]}`,at:run.finishedAt??run.scheduledFor});
  return {...data,runs:data.runs.map(r=>r.id===original.id?run:r),notifications};
}

export function useM16SchedulePreview(projects,tasks,scenario='',enabled=true) {
  const [data,setData]=useState(()=>enabled?initialReviewData(projects,scenario):{plans:[],runs:[],notifications:[]});
  const [selected,changeSelected]=useState(()=>scenario==='detail'?'daily-digest':scenario==='standalone'?'monthly-common':data.runs.find(r=>r.id===REVIEW_RUNS[scenario])?.planId??null);
  const [filter,setFilter]=useState('all'),[editor,setEditor]=useState(()=>scenario==='create'?{id:null,draft:defaultDraft(projects)}:null);
  const [deleteId,setDeleteId]=useState(null),[runId,changeRunId]=useState(()=>REVIEW_RUNS[scenario]??null),[noticeOpen,setNoticeOpen]=useState(false),[repairId,setRepairId]=useState(null),[taskView,setTaskView]=useState(false);
  const currentRunStatus=data.runs.find(r=>r.id===runId)?.status;
  const [runTab,setRunTab]=useState(()=>defaultRunTab(currentRunStatus));
  useEffect(()=>setRunTab(defaultRunTab(currentRunStatus)),[runId,currentRunStatus]);
  const setSelected=id=>{changeSelected(id);changeRunId(null);setTaskView(false)};
  const setRunId=id=>{const run=data.runs.find(r=>r.id===id);if(run)changeSelected(run.planId);changeRunId(id);setTaskView(false)};
  const create=()=>setEditor({id:null,draft:defaultDraft(projects)});
  const edit=plan=>setEditor({id:plan.id,draft:{...plan,schedule:{...plan.schedule,days:[...plan.schedule.days]}}});
  const save=draft=>{
    const id=editor.id??stamp();
    setData(old=>{
      const previous=old.plans.find(p=>p.id===id),saved=saveDraft(draft,id,previous);
      return {...old,hint:'计划已保存（合成）',plans:previous?old.plans.map(p=>p.id===id?saved:p):[saved,...old.plans]};
    });
    setSelected(id);setFilter('all');setEditor(null);
  };
  const toggle=plan=>setData(old=>{
    const p=old.plans.find(x=>x.id===plan.id);
    if(!p||p.archived||p.ended||p.needsRepair)return old;
    const next=p.enabled?null:nextOccurrence(p.schedule);
    if(!p.enabled&&next===null)return {...old,hint:'没有未来执行时间，请编辑日程'};
    return {...old,hint:p.enabled?'已暂停自动调度，本次运行不受影响':'已恢复未来调度',plans:old.plans.map(x=>x.id===p.id?{...x,enabled:!p.enabled,nextAt:next,revision:p.revision+1}:x)};
  });
  const remove=()=>{
    setData(old=>({...old,hint:'计划已删除，历史和任务仍保留',plans:old.plans.map(p=>p.id===deleteId?{...p,archived:true,enabled:false,nextAt:null}:p)}));
    setDeleteId(null);setSelected(null);setFilter('deleted');
  };
  const launch=(plan,trigger,scenario='due')=>{
    const id=stamp();
    setData(old=>{const result=launchDemo(old,plan.id,trigger,id,Date.now(),scenario,projects,tasks);return {...result.data,hint:result.hint}});
  };
  const settle=(id,status,kind)=>setData(old=>({...settleDemo(old,id,status,Date.now(),kind),hint:''}));
  const reconfirm=()=>{setData(old=>({...recheckDemo(old,repairId),hint:'已重新确认绑定（合成）'}));setRepairId(null)};
  function openNotice(n){setSelected(n.planId);setRunId(n.runId);setNoticeOpen(false)}
  return {...data,projects,tasks,selected,setSelected,filter,setFilter,editor,setEditor,deleteId,setDeleteId,runId,setRunId,runTab,setRunTab,taskView,setTaskView,noticeOpen,setNoticeOpen,repairId,setRepairId,openNotice,reconfirm,create,edit,save,toggle,remove,launch,settle};
}

function Status({ value }) { return <span className={`m16-run-status ${value??''}`}><i/>{RUN_STATUS[value]??value}</span> }

export function M16ScheduleSidebar({state}){
  const upcoming=state.plans.filter(p=>planDate(p)!=null).sort((a,b)=>a.nextAt-b.nextAt);
  const commonTasks=state.runs.filter(r=>!r.projectId&&r.taskId).filter((r,i,all)=>all.findIndex(x=>x.taskId===r.taskId)===i);
  return <aside className="sidebar scheduled-sidebar m16-sidebar" aria-label="定时任务导航"><h2>定时任务</h2>
    <button className="m16-side-new" type="button" onClick={state.create}><Plus size={17}/>新建计划</button>
    <button type="button" className={`m16-side-link ${state.selected===null&&state.filter!=='deleted'?'selected':''}`} onClick={()=>{state.setSelected(null);state.setFilter('all')}}><List size={16}/>全部计划<span>{state.plans.filter(p=>!p.archived).length}</span></button>
    <p>即将执行</p>{upcoming.length===0&&<span className="scheduled-empty">暂无待执行计划</span>}
    {upcoming.map(p=><button className={`m16-side-plan ${state.selected===p.id?'selected':''}`} type="button" key={p.id} onClick={()=>state.setSelected(p.id)}><Clock3 size={15}/><span>{p.name}<small>{formatRunTime(p.nextAt,p.schedule.zone)}</small></span></button>)}
    {commonTasks.length>0&&<><p>未关联项目 · 通用任务（合成）</p>{commonTasks.map(r=><button className="m16-side-plan" type="button" key={r.taskId} onClick={()=>{state.setSelected(r.planId);state.setRunId(r.id)}}><Clock3 size={15}/><span>{r.title}<small>{RUN_STATUS[r.status]}</small></span></button>)}</>}
    <p>通知与历史</p><button className="m16-side-link" onClick={()=>state.setNoticeOpen(true)}><Bell size={16}/>通知演示<span>{state.notifications?.length??0}</span></button>
    {state.plans.some(p=>p.archived)&&<button className="m16-side-link m16-side-archived" type="button" onClick={()=>{state.setSelected(null);state.setFilter('deleted')}}><Archive size={16}/>已删除计划</button>}
  </aside>;
}
function Field({label,children,note}){return <label className="m16-field"><span>{label}</span>{children}{note&&<small>{note}</small>}</label>}
function ScheduleFields({draft,setSchedule}){
  const s=draft.schedule;
  const zones=[['','跟随本机时区'],['Asia/Shanghai','Asia/Shanghai · 北京'],['Asia/Singapore','Asia/Singapore · 新加坡'],['UTC','UTC'],['America/New_York','America/New_York'],['America/Los_Angeles','America/Los_Angeles']];
  const custom=!!s.customZone||!!s.zone&&!zones.some(([id])=>id===s.zone);
  const preview=useMemo(()=>schedulePreview(s),[s]);
  return <section className="m16-form-section">
    <h3><CalendarClock size={17}/>执行时间</h3>
    <Field label="频率"><select value={s.type} onChange={e=>setSchedule({type:e.target.value})}>{SCHEDULE_TYPES.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></Field>
    {s.type==='interval'?<Field label="间隔" note="从保存日程的时点起算，不因手动运行改变。"><div className="m16-input-unit"><input type="number" min="1" step="1" value={s.minutes} onChange={e=>setSchedule({minutes:e.target.value})}/><span>分钟</span></div></Field>:s.type==='cron'?<Field label="Cron 表达式" note="5 字段：分钟 小时 日 月 星期；支持列表、范围、步长。"><input value={s.cron} onChange={e=>setSchedule({cron:e.target.value})} placeholder="0 9 * * 1-5"/></Field>:<>
      {s.type==='once'&&<Field label="日期"><input type="date" value={s.date} onChange={e=>setSchedule({date:e.target.value})}/></Field>}
      {s.type==='weekly'&&<div className="m16-field"><span>星期</span><div className="m16-days">{[1,2,3,4,5,6,0].map(n=><button type="button" key={n} aria-pressed={s.days.includes(n)} onClick={()=>setSchedule({days:s.days.includes(n)?s.days.filter(d=>d!==n):[...s.days,n]})}>{WEEKDAYS[n]}</button>)}</div></div>}
      {s.type==='monthly'&&<Field label="每月日期" note="选择 29–31 日时，没有该日的月份自动跳过。"><select value={s.monthDay} onChange={e=>setSchedule({monthDay:e.target.value})}><option value="last">每月最后一天</option>{Array.from({length:31},(_,i)=><option key={i+1} value={i+1}>{i+1} 日</option>)}</select></Field>}
      <Field label="时间"><input type="time" value={s.time} onChange={e=>setSchedule({time:e.target.value})}/></Field>
    </>}
    <Field label="时区" note={s.type==='once'?'保存后固定为具体时刻。':s.type==='interval'?'仅影响时间展示，间隔按实际经过时间计算。':'夏令时不存在的时刻跳过；重复时刻只运行第一次。'}><select value={custom?'custom':s.zone} onChange={e=>{const z=e.target.value;setSchedule(z==='custom'?{customZone:true,zone:s.zone||'UTC'}:{zone:z,customZone:false})}}>{zones.map(([id,name])=><option key={id} value={id}>{name}</option>)}<option value="custom">其他 IANA 时区</option></select></Field>
    {custom&&<Field label="IANA 时区"><input value={s.zone} onChange={e=>setSchedule({zone:e.target.value,customZone:true})} placeholder="Europe/London"/></Field>}
    <div className="m16-next-box m16-next-preview"><Clock3 size={15}/><div><span>接下来{preview.times.length>1?' '+preview.times.length+' 次':'的'}执行</span>{preview.error?<small className="m16-warn">{preview.error}</small>:preview.times.map(t=><b key={t}>{formatRunTime(t,s.zone)}</b>)}</div></div>
  </section>;
}
function Editor({state}){
  const [draft,setDraft]=useState(state.editor.draft),[submitted,setSubmitted]=useState(false),[confirmTier,setConfirmTier]=useState(false);
  const priorTier=state.editor.id?state.editor.draft.permission:'ask';
  const set=patch=>setDraft(old=>({...old,...patch}));
  const setSchedule=patch=>setDraft(old=>{
    const changed={...old.schedule,...patch};
    if('type'in patch||'minutes'in patch)delete changed.anchor;
    if(['type','date','time','zone'].some(k=>k in patch&&patch[k]!==old.schedule[k]))delete changed.onceAt;
    return {...old,schedule:changed,ended:old.ended&&changed.type==='once'&&Number.isSafeInteger(changed.onceAt)};
  });
  const projects=state.projects.filter(p=>!p.archived),project=projects.find(p=>p.id===draft.projectId),dirs=project?.dirs?.filter(d=>d.available!==false)??[],dir=dirs.find(d=>d.id===draft.dirId);
  const sourceTasks=[...state.tasks,...Object.values(state.reuseTasks??{}).filter(t=>!state.tasks.some(x=>x.id===t.id))];
  const tasks=sourceTasks.filter(t=>projectKey(t.project)===projectKey(draft.projectId)&&!t.archived);
  const bound=isBound(draft),reuseBound=draft.destination==='reuse'&&!!draft.boundTask;
  const boundAgent=agentById(draft.agent),selectedAgent=boundAgent??usableAgents[0],efforts=selectedAgent.models.find(m=>m.id===draft.model)?.efforts??selectedAgent.efforts??[];
  const error=validateDraft(draft,projects,sourceTasks);
  const close=()=>state.setEditor(null);
  function selectProject(id){const p=projects.find(x=>x.id===id);set({projectId:id,dirId:defaultDir(p)?.id??'',taskId:'',boundTask:null,cwd:null,workspace:'existing'})}
  function bindTask(id){
    const t=tasks.find(x=>x.id===id);
    set({taskId:id,workspace:'existing',...(t?taskConfig(t,projects):{cwd:null})});
  }
  function changeAgent(id){const a=agentById(id);if(!a)return;const m=a.models[0];set({agent:id,model:m.id,effort:m.defaultEffort??a.defaultEffort??'',permission:permissionsFor(id).some(p=>p.id===draft.permission)?draft.permission:'ask'})}
  function changeModel(id){const m=selectedAgent.models.find(m=>m.id===id);set({model:id,effort:m?.defaultEffort??selectedAgent.defaultEffort??''})}
  useEffect(()=>{const handle=e=>{if(e.key==='Escape')close()};addEventListener('keydown',handle);return()=>removeEventListener('keydown',handle)},[]);
  return <div className="m16-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}>
    <form className="m16-dialog" role="dialog" aria-modal="true" aria-label={state.editor.id?'编辑计划':'新建计划'} onSubmit={e=>{e.preventDefault();setSubmitted(true);if(!error){if((state.editor.id&&draft.permission!==priorTier)||(!state.editor.id&&draft.permission==='full'))setConfirmTier(true);else state.save(draft)}}}>
      <header className="m16-dialog-head"><div><h2>{state.editor.id?'编辑计划':'新建计划'}</h2><p>WillYou 运行期间，将按计划启动任务。此界面仅为合成演示。</p></div><button type="button" className="m16-icon-button" aria-label="关闭" onClick={close}><X size={20}/></button></header>
      <div className="m16-dialog-grid">
        <div className="m16-form-main">
          <Field label="计划名称"><input autoFocus value={draft.name} onChange={e=>set({name:e.target.value})} placeholder="例如：每日研发摘要" maxLength={100}/></Field>
          <Field label="任务提示词" note="使用普通任务支持的 Skill、文件引用和工具，不另建任务执行体系。"><textarea value={draft.prompt} onChange={e=>set({prompt:e.target.value})} rows={6} placeholder="每次运行时，希望智能体做什么？"/></Field>
          <ScheduleFields draft={draft} setSchedule={setSchedule}/>
          <div className="m16-policy-inline"><Field label="错过执行后的宽限期" note="唤醒、重开时仅补最近一次；超过宽限则跳过。"><select value={draft.grace} onChange={e=>set({grace:Number(e.target.value)})}>{GRACE_OPTIONS.map(([n,label])=><option key={n} value={n}>{label}</option>)}</select></Field><div className="m16-detail-rule"><Clock3 size={14}/>前次或绑定任务尚未完成时跳过，不积压执行。</div></div>
        </div>
        <div className="m16-form-settings">
          <section className="m16-form-section"><h3><Monitor size={17}/>任务配置</h3>
            <div className="m16-field"><span>运行主机</span><div className="m16-readonly"><Monitor size={16}/>此计算机</div></div>
            <Field label="项目（可选）" note={!draft.projectId?'归入未关联项目，使用适用的全局 Skill/MCP 和独立浏览器身份。':null}><select disabled={reuseBound} value={draft.projectId} onChange={e=>selectProject(e.target.value)}><option value="">不关联项目</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="任务去向"><select value={draft.destination} onChange={e=>{const dest=e.target.value;set({destination:dest,taskId:'',boundTask:null,cwd:null,...(dest==='existing'||dest==='reuse'&&draft.workspace==='per_run'?{workspace:'existing'}:{})})}}>{DESTINATIONS.map(([id,name])=><option value={id} key={id} disabled={draft.workspace==='per_run'&&id!=='new'}>{name}</option>)}</select></Field>
            {draft.destination==='existing'&&<Field label="继续的任务" note="沿用真实任务的当前配置与目录；重要配置变化需要重新确认。"><select value={draft.taskId} onChange={e=>bindTask(e.target.value)}><option value="">请选择任务</option>{tasks.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></Field>}
            {reuseBound&&<div className="m16-field"><span>已绑定任务</span><div className="m16-readonly">{draft.boundTask}</div></div>}
            {bound?<div className="m16-field"><span>实际工作目录</span><div className="m16-readonly m16-wrap">{workspacePath(draft,projects)}</div><small>沿用绑定目录，不迁移工作树。</small></div>:project?<><Field label="工作目录"><select value={draft.dirId} onChange={e=>set({dirId:e.target.value,workspace:'existing'})}>{dirs.map(d=><option key={d.id} value={d.id}>{d.label} · {d.vcs??'普通目录'}</option>)}</select></Field>{dir&&<div className="m16-dir-path" title={dir.path}>{dir.path}</div>}
              <Field label="工作区" note={draft.workspace==='dedicated'?'第一次实际运行时创建并保留，后续使用同一工作树。':draft.workspace==='per_run'?'每次运行从选定分支建立独立工作树。':null}><select value={draft.workspace} onChange={e=>set({workspace:e.target.value})}>{WORKSPACES.filter(([id])=>id==='existing'||dir?.vcs==='Git').map(([id,name])=><option key={id} value={id} disabled={id==='per_run'&&draft.destination!=='new'}>{name}</option>)}</select></Field>
              {draft.workspace!=='existing'&&<Field label="基准分支"><select value={draft.branch} onChange={e=>set({branch:e.target.value})}>{['main','develop','feature/0.1.7'].map(b=><option key={b}>{b}</option>)}</select></Field>}
            </>:<><Field label="通用工作目录"><select value={draft.standaloneMode} onChange={e=>set({standaloneMode:e.target.value})}><option value="managed">系统分配独立目录</option><option value="local">选择本机已有目录</option></select></Field>{draft.standaloneMode==='local'?<Field label="本机目录（合成路径）"><input value={draft.localPath} onChange={e=>set({localPath:e.target.value})} placeholder="/workspace/我的资料"/></Field>:<div className="m16-dir-path">首次运行时分配独立目录（合成）</div>}</>}
            <Field label="智能体"><div className="m16-select-icon">{boundAgent&&<AgentIcon tool={selectedAgent.tool} provider={provider(selectedAgent)} size={18}/>}<select value={draft.agent} disabled={bound} onChange={e=>changeAgent(e.target.value)}>{!boundAgent&&<option value="">智能体或供应商不可用</option>}{usableAgents.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select></div></Field>
            <div className="m16-form-pair"><Field label="模型"><select value={draft.model} disabled={bound} onChange={e=>changeModel(e.target.value)}>{selectedAgent.models.map(m=><option value={m.id} key={m.id}>{m.name}</option>)}</select></Field><Field label="推理强度"><select value={draft.effort} disabled={bound||!efforts.length} onChange={e=>set({effort:e.target.value})}>{(!efforts.includes(draft.effort)||!efforts.length)&&<option value={draft.effort}>由执行器／供应商决定</option>}{efforts.map(e=><option key={e}>{e}</option>)}</select></Field></div>
          </section>
          <section className="m16-form-section m16-policy"><h3><ShieldCheck size={17}/>执行与通知</h3>
            <Field label="权限" note="沿用普通任务及插件最高允许档位；邮件发送始终需本人批准。"><select disabled={bound} value={draft.permission} onChange={e=>set({permission:e.target.value})}>{permissionsFor(draft.agent).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <label className="m16-checkbox"><input disabled={bound} type="checkbox" checked={draft.delegation} onChange={e=>set({delegation:e.target.checked})}/>启用多 Agent 委派</label>
            <label className="m16-checkbox"><input type="checkbox" checked={draft.successNotify} onChange={e=>set({successNotify:e.target.checked})}/>完成时也通知我</label>
            <small className="m16-form-note">失败、待处理和配置异常默认通知；开始、正常跳过不通知。</small>
            <label className="m16-checkbox"><input type="checkbox" checked={draft.enabled} onChange={e=>set({enabled:e.target.checked})}/>保存后启用</label>
          </section>
        </div>
      </div>
      <footer className="m16-dialog-foot">{confirmTier?<><span className="m16-form-error m16-warn" role="status">请确认权限：{permissionLabel(priorTier)} → {permissionLabel(draft.permission)}。仅影响未来运行，不代替业务审批。</span><button type="button" className="m16-button" onClick={()=>{set({permission:priorTier});setConfirmTier(false)}}>取消权限变更</button><button type="button" className="m16-button primary" onClick={()=>{if(!error)state.save(draft)}}>确认并保存</button></>:<><span className={`m16-form-error ${submitted&&error?'m16-warn':''}`} role="status">{submitted&&error?error:bound?'绑定任务配置跟随，关键变更需重新确认。':'保存后只影响未来执行。'}</span><button type="button" className="m16-button" onClick={close}>取消</button><button className="m16-button primary" type="submit">{state.editor.id?'保存修改':'创建计划'}</button></>}</footer>
    </form>
  </div>;
}
function PlanList({state}){
  const [query,setQuery]=useState('');
  const all=state.plans.filter(p=>!p.archived),plans=state.plans.filter(p=>state.filter==='deleted'?p.archived:!p.archived&&(state.filter==='all'||state.filter==='enabled'&&p.enabled&&!p.ended&&!p.needsRepair||state.filter==='paused'&&!p.enabled&&!p.ended&&!p.needsRepair||state.filter==='ended'&&p.ended||state.filter==='repair'&&p.needsRepair)).filter(p=>[p.name,projectName(state.projects,p.projectId),agentTitle(p.agent)].join(' ').toLowerCase().includes(query.toLowerCase()));
  return <><div className="m16-page-head"><div><h1>定时任务</h1><p>使用普通智能体在计划时间执行任务，随时查看运行和结果。</p></div><button className="m16-button primary" onClick={state.create}><Plus size={17}/>新建计划</button></div>
    <div className="m16-overview"><div><span>启用的计划</span><b>{all.filter(p=>planDate(p)!=null).length}</b></div><div><span>进行中的运行</span><b>{state.runs.filter(r=>ACTIVE_RUNS.has(r.status)).length}</b></div><div><span>需处理或核对</span><b>{all.filter(p=>p.needsRepair).length+state.runs.filter(r=>['waiting','unknown'].includes(r.status)).length}</b></div></div>
    <div className="m16-list-tools"><div className="m16-filter">{[['all','全部'],['enabled','已启用'],['paused','已暂停'],['ended','已结束'],['repair','需确认'],['deleted','已删除']].map(([id,name])=><button key={id} className={state.filter===id?'selected':''} onClick={()=>state.setFilter(id)}>{name}</button>)}</div><label className="m16-search"><Search size={16}/><input aria-label="搜索计划" placeholder="搜索计划" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
    <div className="m16-plan-list">{plans.length?plans.map(p=>{
      const last=state.runs.find(r=>r.planId===p.id);
      return <article className="m16-plan-row" key={p.id}><button className="m16-plan-main" onClick={()=>state.setSelected(p.id)}><span className="m16-clock-icon"><CalendarClock size={20}/></span><span><strong title={p.name}>{p.name}</strong><small>{projectName(state.projects,p.projectId)} · {scheduleLabel(p.schedule)}</small></span></button><div className="m16-plan-agent"><AgentCaption agentId={p.agent} modelId={p.model} effort={p.effort}/></div><div className="m16-next"><small>下次执行</small>{formatRunTime(planDate(p),p.schedule.zone)}</div><div className="m16-last"><small>最近运行</small>{last?<Status value={last.status}/>:'尚未运行'}</div>{p.archived||p.ended||p.needsRepair?<span className="m16-state-text">{planStatus(p)}</span>:<button className={`m16-switch ${p.enabled?'on':''}`} role="switch" aria-label={`${p.name}启用`} aria-checked={p.enabled} onClick={()=>state.toggle(p)}><i/></button>}<button className="m16-icon-button" aria-label={`查看${p.name}`} onClick={()=>state.setSelected(p.id)}><ChevronRight size={16}/></button></article>
    }):<div className="m16-empty"><CalendarClock size={32}/><h3>{query?'没有匹配的计划':'暂无计划'}</h3>{!query&&state.filter==='all'&&<button className="m16-button" onClick={state.create}>创建第一个计划</button>}</div>}</div>
  </>;
}
function PlanDetail({state,plan}){
  const runs=orderedPlanRuns(state.runs,plan.id),busy=busyReason(state,plan,state.tasks),[simulation,setSimulation]=useState('due');
  return <><button className="m16-back" onClick={()=>state.setSelected(null)}><ArrowLeft size={15}/>全部计划</button>
    <div className="m16-page-head m16-detail-head"><div><h1>{plan.name}</h1><p><span className={`m16-plan-dot ${planDate(plan)!=null?'enabled':''}`}/>{planStatus(plan)} · {projectName(state.projects,plan.projectId)}</p></div>{!plan.archived&&<div className="m16-actions"><button className="m16-button" onClick={()=>state.edit(plan)}><Edit3 size={15}/>编辑</button>{!planEnded(plan)&&!plan.needsRepair&&<button className="m16-button" onClick={()=>state.toggle(plan)}>{plan.enabled?<Pause size={15}/>:<Play size={15}/>} {plan.enabled?'暂停':'恢复'}</button>}<button className="m16-button primary" disabled={!!plan.needsRepair} title={busy||''} onClick={()=>state.launch(plan,'manual')}><Play size={15}/>立即运行</button><button className="m16-icon-button danger" aria-label="删除计划" onClick={()=>state.setDeleteId(plan.id)}><Trash2 size={17}/></button></div>}</div>
    {plan.needsRepair&&<div className="m16-repair"><div><b>需要重新确认计划配置</b><p>{plan.needsRepair.reason}。新触发已暂停，历史不变。</p></div><button className="m16-button" onClick={()=>plan.needsRepair.unavailable?state.edit(plan):state.setRepairId(plan.id)}>{plan.needsRepair.unavailable?'编辑并修正':'查看并重新确认'}</button></div>}
    {busy&&<p className="m16-inline-note">{busy}。立即运行不会重复启动。</p>}
    <div className="m16-detail-grid"><section className="m16-detail-card"><h3>计划配置</h3><dl>
      <dt>执行频率</dt><dd>{scheduleLabel(plan.schedule)}</dd><dt>下次执行</dt><dd>{formatRunTime(planDate(plan),plan.schedule.zone)}</dd><dt>时区</dt><dd>{plan.schedule.zone||'跟随本机'}</dd><dt>宽限期</dt><dd>{GRACE_OPTIONS.find(([n])=>n===plan.grace)?.[1]}</dd>
      <dt>任务去向</dt><dd>{DESTINATIONS.find(([id])=>id===plan.destination)?.[1]}{plan.boundTask&&<small className="m16-form-note">{plan.boundTask}</small>}</dd>
      <dt>工作区</dt><dd>{workspaceTitle(plan)}{plan.workspace!=='existing'?` · 基准 ${plan.branch}`:''}<small className="m16-form-note">{workspacePath(plan,state.projects)}</small></dd>
      <dt>运行主机</dt><dd>此计算机</dd><dt>智能体</dt><dd><AgentCaption agentId={plan.agent} modelId={plan.model} effort={plan.effort}/></dd>
    </dl></section><section className="m16-detail-card"><h3>任务提示词</h3><p className="m16-detail-prompt">{plan.prompt}</p><div className="m16-detail-rule"><ShieldCheck size={15}/>{permissionLabel(plan.permission)} · {plan.delegation?'开启多 Agent 委派':'单 Agent'}</div><p className="m16-form-note">完成通知：{plan.successNotify?'开启':'关闭'}；失败／待处理／配置异常默认通知。</p><p className="m16-form-note">暂停或删除仅影响未来触发。停止当前运行请进入对应记录。</p></section></div>
    <div className="m16-history-head"><h2>运行记录 <small>{runs.length}</small></h2>{planDate(plan)!=null&&<div className="m16-sim-controls"><select aria-label="模拟调度场景" value={simulation} onChange={e=>setSimulation(e.target.value)}>{[['due','准时到达'],['within','宽限期内唤醒'],['outside','长时间离线后唤醒'],['startup','启动失败后安全重试'],['unknown','提交结果未知'],['binding','绑定配置失效']].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select><button className="m16-button m16-sim-button" onClick={()=>state.launch(plan,'scheduled',simulation)}>模拟触发</button></div>}</div>
    {runs.length?<div className="m16-history"><div className="m16-history-row header"><span>计划触发 / 实际开始</span><span>执行状态 / 耗时</span><span>结果摘要／原因</span><span>操作</span></div>{runs.map(r=><div className="m16-history-row" key={r.id}><span>{formatRunTime(r.scheduledFor,r.zone)}<small>{r.trigger==='manual'?'手动':'定时'} · {formatRunTime(r.startedAt,r.zone)}</small></span><span><Status value={r.status}/><small>{formatDuration(r)}</small></span><span className="m16-history-reason" title={runResultSummary(r)}>{runResultSummary(r)}</span><button className="m16-text-button" onClick={()=>state.setRunId(r.id)}>{r.status==='completed'?'查看结果':['running','waiting','claimed'].includes(r.status)?'查看执行':'查看原因'}<ChevronRight size={14}/></button></div>)}</div>:<div className="m16-empty history"><List size={28}/><p>暂无运行记录，首次执行后将在这里显示。</p></div>}
  </>;
}
function RecordedArtifact({artifact}){
  const [open,setOpen]=useState(false);
  return <div className="m16-artifact"><button className="m16-artifact-link" aria-expanded={open} onClick={()=>setOpen(!open)}><span className="m16-artifact-icon"><FileText size={19}/></span><span><b>{artifact.name}</b><small>{artifact.path} · 合成文件</small></span><span className="m16-artifact-action">{open?'收起':'查看文件'}<ChevronRight size={14}/></span></button>{open&&<pre>{artifact.text}</pre>}</div>;
}
function RunOutput({run}){
  const {result}=runRecord(run);
  const final=run.status==='completed'&&result?.kind==='final';
  const {status}=run;
  const messages={
    claimed:['等待派发','任务尚未开始，暂时没有执行结果。'],
    running:['任务正在执行','完成后可在这里查看最终结果。'],
    waiting:['等待你处理','完成本人操作后，智能体将继续本次任务。'],
    failed:['本次运行失败',run.reason||'执行失败，暂无最终结果。'],
    skipped:['本次未执行',run.reason||'本次计划未派发任务。'],
    stopped:['本次运行已停止',run.reason||'不会继续执行本次任务。'],
    unknown:['运行结果待核对',run.reason||'需先核对原提交结果，不能重复派发。'],
    completed:['任务已完成','本次运行暂无可显示的结果。可前往原任务核对记录。'],
  };
  return <section className="m16-run-output" aria-label="本次运行结果">
    {!final&&<div className={'m16-output-state '+status}><div className="m16-output-state-icon">{status==='failed'?<AlertCircle size={21}/>:<Hourglass size={21}/>}</div><div><b>{(messages[status]??[])[0]}</b><p>{(messages[status]??[])[1]}</p></div></div>}
    {result?.markdown?.length>0&&<><div className="m16-output-title"><h2>{final?'最终回复':'执行期间输出'}</h2><span>{final?'本次回合 · 最终结果':'部分内容 · 非最终结论'}</span></div><div className="m16-output-message"><M14RecordedOutput lines={result.markdown}/></div></>}
    {result?.artifacts?.length>0&&<div className="m16-run-artifacts"><h3>生成的文件 <span>{result.artifacts.length}</span></h3>{result.artifacts.map(artifact=><RecordedArtifact artifact={artifact} key={artifact.path}/>)}</div>}
  </section>;
}
function RunProcess({run}){
  const {events,result}=runRecord(run);
  const confirmed=confirmedTurn(run);
  return <div className="m16-run-process" aria-label="本次执行过程">
    {!confirmed&&<p className="m16-inline-note">尚无已确认的任务回合，以下只显示调度记录，不把计划提示词当作已发送的消息。</p>}
    <M14RecordedTimeline prompt={confirmed?run.prompt:null} startedLabel={formatRunTime(run.startedAt,run.zone)} events={events.map(e=>{const timeLabel=e.at==null?null:new Intl.DateTimeFormat('zh-CN',{timeZone:run.zone||undefined,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(e.at);return {...e,timeLabel}})} lines={result?.markdown??[]} partial={result?.kind==='partial'}/>
    {!events.length&&<div className="m16-empty">暂无执行过程</div>}
  </div>;
}
function RunConfiguration({run}){
  return <details className="m16-run-config"><summary><ChevronRight size={15}/>本次运行配置 <span>时间、工作区、权限等</span></summary><div><dl>
    <dt>计划触发时间</dt><dd>{formatRunTime(run.scheduledFor,run.zone)}</dd><dt>实际开始</dt><dd>{formatRunTime(run.startedAt,run.zone)}</dd><dt>结束时间</dt><dd>{formatRunTime(run.finishedAt,run.zone)}</dd><dt>运行身份</dt><dd>{run.id} · 尝试 {run.attempts} 次</dd><dt>关联任务</dt><dd>{confirmedTurn(run)?run.taskId:run.taskId?'尚无确认回执':'未派发任务'}</dd><dt>本次回合</dt><dd>{run.turnId??'尚无确认回执'}</dd><dt>工作目录</dt><dd>{run.cwd??'—'}</dd>{run.branch&&<><dt>工作树分支</dt><dd>{run.branch}</dd><dt>基准提交</dt><dd>{run.baseCommit}</dd></>}<dt>权限</dt><dd>{permissionLabel(run.permission)} · {run.delegation?'委派开启':'单 Agent'}</dd><dt>提示词快照</dt><dd>{run.prompt}</dd>
    </dl>{run.missedFrom&&<p className="m16-form-note">离线期间更早时点合并跳过：{formatRunTime(run.missedFrom,run.zone)} 起</p>}</div></details>;
}
function RunActions({run,state,plan}){
  const safeRetry=!!plan&&run.status==='failed'&&!plan.archived&&!plan.needsRepair&&!busyReason(state,plan,state.tasks);
  return <div className="m16-actions">
    {ACTIVE_RUNS.has(run.status)&&run.status!=='unknown'&&<button className="m16-button" onClick={()=>state.settle(run.id,'stopped')}><X size={15}/>停止本次运行</button>}
    {safeRetry&&<button className="m16-button" onClick={()=>{state.launch(plan,'manual');state.setRunId(null)}}><Play size={15}/>再次运行（新记录）</button>}
    {confirmedTurn(run)&&<button className="m16-button primary" onClick={()=>state.setTaskView(true)}>查看完整任务<ArrowUpRight size={16}/></button>}
  </div>;
}
function RunInteraction({state,run}){
  return <>
    {run.status==='waiting'&&<div className="m16-repair m16-run-wait"><div><b>{run.approval?.text??'待用户处理'}</b><p>未处理前不会自行批准或执行等待中的操作。</p></div><button className="m16-button primary" onClick={()=>state.settle(run.id,'running')}>本人处理完成（合成）</button></div>}
    {run.status==='unknown'&&<div className="m16-repair m16-run-wait"><div><b>核对原提交结果</b><p>只查询原回执，不能再次派发原请求。</p></div><div className="m16-actions"><button className="m16-button" onClick={()=>state.settle(run.id,'running')}>原回执已确认</button><button className="m16-button" onClick={()=>state.settle(run.id,'failed')}>已核明终态失败</button></div></div>}
  </>;
}
function RunSimulation({state,run}){
  if(!['claimed','running'].includes(run.status))return null;
  return <details className="m16-run-config m16-simulation-panel"><summary><ChevronRight size={15}/>原型演示控制 <span>仅改变合成记录</span></summary><div className="m16-actions">
    <button className="m16-button" onClick={()=>state.settle(run.id,'waiting','plugin')}>插件审批</button><button className="m16-button" onClick={()=>state.settle(run.id,'waiting','mail')}>邮件审批</button><button className="m16-button" onClick={()=>state.settle(run.id,'waiting','login')}>等待本人登录</button><button className="m16-button" onClick={()=>state.settle(run.id,'completed')}>完成</button><button className="m16-button" onClick={()=>state.settle(run.id,'failed')}>失败</button>
  </div></details>;
}
function RunDetail({state,run}){
  const tab=state.runTab,setTab=state.setRunTab;
  const plan=state.plans.find(p=>p.id===run.planId),history=orderedPlanRuns(state.runs,run.planId),index=history.findIndex(r=>r.id===run.id),running=ACTIVE_RUNS.has(run.status);
  return <section className="m16-run-page" aria-label="运行详情">
    <div className="m16-run-navigation"><button className="m16-back" onClick={()=>state.setRunId(null)}><ArrowLeft size={15}/>返回计划</button><div className="m16-run-pagination"><button aria-label="上一条运行记录" title="较新的运行记录" className="m16-icon-button" disabled={index<=0} onClick={()=>state.setRunId(history[index-1].id)}><ChevronLeft size={18}/></button><span>第 {index+1} / {history.length} 条</span><button aria-label="下一条运行记录" title="较早的运行记录" className="m16-icon-button" disabled={index>=history.length-1} onClick={()=>state.setRunId(history[index+1].id)}><ChevronRight size={18}/></button></div></div>
    <div className="m16-run-heading"><div><div className="m16-run-kicker">运行详情 · {run.trigger==='manual'?'手动运行':'定时运行'}</div><h1>{run.title}</h1><div className="m16-run-summary"><Status value={run.status}/><span>{formatRunTime(run.scheduledFor,run.zone)}</span>{run.startedAt!=null&&<span>{running?'尚未结束':formatDuration(run)}</span>}</div></div><RunActions run={run} state={state} plan={plan}/></div>
    <div className="m16-run-facts"><div><small>智能体 · 模型</small><AgentCaption agentId={run.agent} modelId={run.model} effort={run.effort}/></div><div><small>实际开始</small><b>{formatRunTime(run.startedAt,run.zone)}</b></div><div><small>结束时间</small><b>{formatRunTime(run.finishedAt,run.zone)}</b></div></div>
    <RunInteraction state={state} run={run}/>
    <div role="tablist" aria-label="查看本次运行" className="m16-run-tabs">
      <button type="button" role="tab" id="m16-result-tab" aria-controls="m16-run-panel" aria-selected={tab==='result'} onClick={()=>setTab('result')}><FileText size={16}/>运行结果</button>
      <button type="button" role="tab" id="m16-process-tab" aria-controls="m16-run-panel" aria-selected={tab==='process'} onClick={()=>setTab('process')}><ListChecks size={16}/>执行过程</button>
      <span>本次运行 · 合成示例</span>
    </div>
    <div role="tabpanel" id="m16-run-panel" aria-labelledby={tab==='result'?'m16-result-tab':'m16-process-tab'} className="m16-run-panel">{tab==='result'?<RunOutput run={run}/>:<RunProcess run={run}/>}</div>
    <RunConfiguration run={run}/><RunSimulation state={state} run={run}/>
  </section>;
}
function LinkedRunTask({state,run}){
  return <section className="m16-run-page m16-linked-task" aria-label="本次任务回合预览"><button className="m16-back" onClick={()=>state.setTaskView(false)}><ArrowLeft size={15}/>返回运行记录</button><div className="m16-run-heading"><div><div className="m16-run-kicker">统一任务区 · 本次回合预览（合成）</div><h1>{run.title}</h1><div className="m16-run-summary"><Status value={run.status}/><span>{projectName(state.projects,run.projectId)}</span></div></div></div><div className="m16-inline-note">定位到原任务中的本次定时运行。这里展示同一回合的原消息与结果，不是新建会话。</div><RunProcess run={run}/><RunConfiguration run={run}/></section>;
}
function Notices({state}){
  return <div className="m16-backdrop"><section className="m16-dialog m16-run-dialog" role="dialog" aria-modal="true" aria-label="通知演示"><header className="m16-dialog-head"><div><h2>通知演示</h2><p>合成通知记录，仅展示定位关系。</p></div><button className="m16-icon-button" aria-label="关闭" onClick={()=>state.setNoticeOpen(false)}><X size={20}/></button></header><div className="m16-run-body">{state.notifications?.length?state.notifications.map(n=><button key={n.key} className="m16-notice-row" onClick={()=>state.openNotice(n)}><Bell size={15}/><span>{n.text}<small>{formatRunTime(n.at)}</small></span><ChevronRight size={15}/></button>):<p>暂无通知</p>}</div></section></div>;
}
export function M16ScheduleWorkspace({state,dark,onTheme}){
  const plan=state.plans.find(p=>p.id===state.selected),run=state.runs.find(r=>r.id===state.runId),repair=state.plans.find(p=>p.id===state.repairId);
  return <section className="m16-workspace" aria-label="M16 定时任务原型"><div className="m16-topline"><span>定时任务 · P1.1 评审原型（合成）</span><button className="m16-text-button" onClick={onTheme}>{dark?'浅色':'深色'}主题</button></div><div className="m16-content">{state.hint&&<div className="m16-hint" role="status">{state.hint}</div>}{run?(state.taskView&&confirmedTurn(run)?<LinkedRunTask key={run.id} state={state} run={run}/>:<RunDetail key={run.id} state={state} run={run}/>):plan?<PlanDetail key={plan.id} state={state} plan={plan}/>:<PlanList state={state}/>}</div>
    {state.editor&&<Editor state={state}/>}
    {state.noticeOpen&&<Notices state={state}/>}
    {repair&&<div className="m16-backdrop"><section className="m16-dialog m16-delete-dialog" role="alertdialog" aria-label="重新确认计划"><header className="m16-dialog-head"><h2>重新确认计划配置</h2></header><p>当前绑定配置已变化（合成）。原智能体：{agentTitle(repair.needsRepair.previous)}；新智能体：{agentTitle(repair.needsRepair.pendingAgent)}；权限：{permissionLabel(repair.permission)} → {permissionLabel(repair.needsRepair.pending?.permission??'ask')}。目录：{repair.cwd??workspacePath(repair,state.projects)} → {repair.needsRepair.pending?.cwd??workspacePath(repair,state.projects)}。确认后按新配置和未来日程运行，不改写历史。</p><footer className="m16-dialog-foot"><button className="m16-button" onClick={()=>state.setRepairId(null)}>暂不确认</button><button className="m16-button primary" onClick={state.reconfirm}>确认变化</button></footer></section></div>}
    {state.deleteId&&<div className="m16-backdrop"><section className="m16-dialog m16-delete-dialog" role="alertdialog" aria-label="删除定时计划"><header className="m16-dialog-head"><h2>删除定时计划？</h2></header><p>停止未来触发，不中断已开始的运行。历史、实际任务、文件及工作树保留。</p><footer className="m16-dialog-foot"><button className="m16-button" onClick={()=>state.setDeleteId(null)}>取消</button><button className="m16-button danger-fill" onClick={state.remove}>删除计划</button></footer></section></div>}
  </section>;
}
