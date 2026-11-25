import { useEffect, useState } from 'react';
import { Archive, ArrowLeft, CalendarClock, Check, ChevronRight, Clock3, Edit3, Folder, List, Monitor, Pause, Play, Plus, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import { AGENTS } from './m14-model.mjs';
import { AgentIcon } from './m13-icons.jsx';
import { ACTIVE_RUNS, DESTINATIONS, GRACE_OPTIONS, RUN_STATUS, SCHEDULE_TYPES, WEEKDAYS, defaultDraft, formatRunTime, makeRun, nextOccurrence, scheduleLabel, seedPlans, validateDraft } from './m16-model.mjs';
import './m16.css';

const usableAgents = AGENTS.filter(agent => agent.tool && !agent.placeholder && agent.status?.kind !== 'unavailable');
const provider = agent => agent.providerBadge ?? (agent.provider ? { catalog: 'deepseek', name: 'DeepSeek' } : null);
const agentTitle = id => usableAgents.find(agent => agent.id === id)?.name ?? '智能体不可用';
const modelTitle = (agentId, modelId) => usableAgents.find(agent => agent.id === agentId)?.models.find(model => model.id === modelId)?.name ?? modelId;
const projectName = (projects, id) => projects.find(project => project.id === id)?.name ?? '项目不可用';
const dirName = (projects, plan) => projects.find(project => project.id === plan.projectId)?.dirs.find(dir => dir.id === plan.dirId)?.label ?? '目录不可用';
const planDate = plan => plan.enabled && !plan.archived ? plan.nextAt : null;
const planEnded = plan => plan.schedule.type === 'once' && plan.nextAt === null;
const planStatus = plan => plan.archived ? '已删除' : planEnded(plan) ? '已结束' : plan.enabled ? '已启用' : '已暂停';
const stamp = () => Math.random().toString(36).slice(2, 10);

function AgentCaption({ agentId, modelId, effort }) {
  const agent = usableAgents.find(item => item.id === agentId);
  return <span className="m16-agent-caption">{agent && <AgentIcon tool={agent.tool} provider={provider(agent)} size={17} />}<span>{agentTitle(agentId)}{modelId && <small>{modelTitle(agentId, modelId)}{effort ? ` · ${effort}` : ''}</small>}</span></span>;
}

export function useM16SchedulePreview(projects, tasks, scenario = '', enabled = true) {
  const [data, setData] = useState(() => {
    if (!enabled) return { plans: [], runs: [] };
    const state = seedPlans(projects);
    return { ...state, plans: state.plans.map(plan => ({ ...plan, nextAt: nextOccurrence(plan.schedule) })) };
  });
  const [selected, setSelected] = useState(scenario === 'detail' ? 'daily-digest' : null), [filter, setFilter] = useState('all');
  const [editor, setEditor] = useState(() => scenario === 'create' ? { id: null, draft: defaultDraft(projects) } : null), [deleteId, setDeleteId] = useState(null), [runId, setRunId] = useState(null);
  const create = () => setEditor({ id: null, draft: defaultDraft(projects) });
  const edit = plan => setEditor({ id: plan.id, draft: { ...plan, schedule: { ...plan.schedule, days: [...plan.schedule.days] } } });
  const save = draft => {
    const id = editor.id ?? stamp();
    const saved = { ...draft, id, nextAt: nextOccurrence(draft.schedule) };
    setData(old => ({ ...old, plans: editor.id ? old.plans.map(plan => plan.id === id ? saved : plan) : [saved, ...old.plans] }));
    setSelected(id); setFilter('all'); setEditor(null);
  };
  const toggle = plan => setData(old => ({ ...old, plans: old.plans.map(item => {
    if (item.id !== plan.id || planEnded(item)) return item;
    const nextAt = item.enabled ? item.nextAt : nextOccurrence(item.schedule);
    return { ...item, enabled: !item.enabled && nextAt !== null, nextAt };
  }) }));
  const remove = () => {
    setData(old => ({ ...old, plans: old.plans.map(plan => plan.id === deleteId ? { ...plan, enabled: false, archived: true } : plan) }));
    setDeleteId(null); setSelected(null); setFilter('deleted');
  };
  const launch = (plan, trigger, scenario = 'due') => setData(old => {
    if (plan.archived || (trigger === 'scheduled' && !plan.enabled)) return old;
    const busy = old.runs.some(run => run.planId === plan.id && ACTIVE_RUNS.has(run.status));
    if (busy && trigger === 'manual') return old;
    const actualNow = Date.now();
    const scheduledFor = trigger === 'scheduled' ? plan.nextAt ?? actualNow : actualNow;
    const delay = scenario === 'outside' ? (plan.grace + 1) * 60000 : scenario === 'within' ? Math.max(1, plan.grace / 2) * 60000 : 0;
    const now = Math.max(actualNow, scheduledFor + delay);
    const missed = scenario !== 'due' && (plan.grace === 0 || delay > plan.grace * 60000);
    const run = makeRun(plan, stamp(), trigger, scheduledFor, busy || missed ? 'skipped' : 'running', now);
    if (missed) run.reason = '错过执行时间，已超过宽限期';
    const nextAt = trigger === 'scheduled' ? nextOccurrence(plan.schedule, Math.max(now, scheduledFor)) : plan.nextAt;
    const plans = old.plans.map(item => item.id === plan.id ? { ...item, nextAt, enabled: item.enabled && !(trigger === 'scheduled' && item.schedule.type === 'once') } : item);
    return { plans, runs: [run, ...old.runs] };
  });
  const settle = (id, status) => setData(old => ({ ...old, runs: old.runs.map(run => run.id === id && ACTIVE_RUNS.has(run.status) ? {
    ...run, status, finishedAt: ACTIVE_RUNS.has(status) ? null : Math.max(Date.now(), run.startedAt ?? run.scheduledFor), reason: status === 'waiting' ? '需要用户处理审批' : status === 'failed' ? '执行器返回错误（合成）' : status === 'stopped' ? '用户已停止' : '',
  } : run) }));
  return { ...data, projects, tasks, selected, setSelected, filter, setFilter, editor, setEditor, deleteId, setDeleteId, runId, setRunId, create, edit, save, toggle, remove, launch, settle };
}

function Status({ value }) {
  const classes = ['completed','running','waiting','failed','skipped','stopped'].includes(value) ? value : '';
  return <span className={`m16-run-status ${classes}`}><i />{RUN_STATUS[value] ?? value}</span>;
}

export function M16ScheduleSidebar({ state }) {
  const upcoming = state.plans.filter(p => planDate(p) != null).sort((a, b) => a.nextAt - b.nextAt);
  return <aside className="sidebar scheduled-sidebar m16-sidebar" aria-label="定时任务导航">
    <h2>定时任务</h2>
    <button className="m16-side-new" type="button" onClick={state.create}><Plus size={17}/>新建计划</button>
    <button type="button" className={`m16-side-link ${state.selected === null && state.filter !== 'deleted' ? 'selected' : ''}`} onClick={() => { state.setSelected(null); state.setFilter('all'); }}><List size={16}/>全部计划<span>{state.plans.filter(p => !p.archived).length}</span></button>
    <p>即将执行</p>
    {upcoming.length === 0 && <span className="scheduled-empty">暂无待执行计划</span>}
    {upcoming.map(plan => <button className={`m16-side-plan ${state.selected === plan.id ? 'selected' : ''}`} type="button" key={plan.id} onClick={() => state.setSelected(plan.id)}><Clock3 size={15}/><span>{plan.name}<small>{formatRunTime(plan.nextAt, plan.schedule.zone)}</small></span></button>)}
    {state.plans.some(p => p.archived) && <button className="m16-side-link m16-side-archived" type="button" onClick={() => { state.setSelected(null); state.setFilter('deleted'); }}><Archive size={16}/>已删除计划</button>}
  </aside>;
}

function Field({ label, children, note }) {
  return <label className="m16-field"><span>{label}</span>{children}{note && <small>{note}</small>}</label>;
}

function ScheduleFields({ draft, setSchedule }) {
  const schedule = draft.schedule;
  const timezones = [['', '跟随本机时区'], ['Asia/Shanghai', 'Asia/Shanghai · 北京'], ['Asia/Singapore', 'Asia/Singapore · 新加坡'], ['UTC', 'UTC'], ['America/Los_Angeles', 'America/Los_Angeles']];
  return <section className="m16-form-section">
    <h3><CalendarClock size={17}/>执行时间</h3>
    <Field label="频率"><select value={schedule.type} onChange={e => setSchedule({ type: e.target.value })}>{SCHEDULE_TYPES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
    {schedule.type === 'interval' ? <Field label="间隔"><div className="m16-input-unit"><input type="number" min="1" max="10080" value={schedule.minutes} onChange={e => setSchedule({ minutes: e.target.value })}/><span>分钟</span></div></Field> : <>
      {schedule.type === 'once' && <Field label="日期"><input type="date" value={schedule.date} onChange={e => setSchedule({ date: e.target.value })}/></Field>}
      {schedule.type === 'weekly' && <div className="m16-field"><span>星期</span><div className="m16-days">{[1,2,3,4,5,6,0].map(n => <button type="button" key={n} aria-pressed={schedule.days.includes(n)} onClick={() => setSchedule({ days: schedule.days.includes(n) ? schedule.days.filter(day => day !== n) : [...schedule.days,n] })}>{WEEKDAYS[n]}</button>)}</div></div>}
      <Field label="时间"><input type="time" value={schedule.time} onChange={e => setSchedule({ time: e.target.value })}/></Field>
    </>}
    <Field label="时区"><select value={schedule.zone} onChange={e => setSchedule({ zone: e.target.value })}>{timezones.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
    <div className="m16-next-box"><Clock3 size={15}/><span>下次执行</span><b>{formatRunTime(nextOccurrence(schedule), schedule.zone)}</b></div>
  </section>;
}

function Editor({ state }) {
  const [draft, setDraft] = useState(state.editor.draft), [submitted, setSubmitted] = useState(false);
  const set = patch => setDraft(old => ({ ...old, ...patch }));
  const setSchedule = patch => setDraft(old => ({ ...old, schedule: { ...old.schedule, ...patch } }));
  const projects = state.projects.filter(p => !p.archived), project = projects.find(p => p.id === draft.projectId);
  const dirs = project?.dirs?.filter(d => d.available !== false) ?? [], dir = dirs.find(d => d.id === draft.dirId);
  const tasks = state.tasks.filter(t => t.project === project?.id && !t.archived), boundTask = tasks.find(t => t.id === draft.taskId);
  const bound = draft.destination === 'existing';
  const selectedAgent = usableAgents.find(a => a.id === draft.agent) ?? usableAgents[0];
  const efforts = selectedAgent.models.find(m => m.id === draft.model)?.efforts ?? selectedAgent.efforts ?? [];
  const error = validateDraft(draft, projects, state.tasks);
  const close = () => state.setEditor(null);
  function selectProject(id) {
    const p = projects.find(item => item.id === id);
    const d = p?.dirs?.find(item => item.isDefault && item.available !== false) ?? p?.dirs?.find(item => item.available !== false);
    set({ projectId: id, dirId: d?.id ?? '', taskId: '', workspace: 'existing' });
  }
  function bindTask(id) {
    const task = tasks.find(item => item.id === id);
    const a = usableAgents.find(item => item.tool === (task?.runner ?? task?.agent?.tool ?? 'claude') && !item.provider) ?? selectedAgent;
    set({ taskId: id, workspace: 'existing', dirId: task?.dirId && dirs.some(d => d.id === task.dirId) ? task.dirId : project?.dirs?.find(d => d.isDefault)?.id ?? dirs[0]?.id ?? '', agent: a.id, model: a.models[0].id, effort: a.models[0].defaultEffort ?? a.defaultEffort ?? '' });
  }
  function changeAgent(id) {
    const agent = usableAgents.find(a => a.id === id);
    if (!agent) return;
    set({ agent: id, model: agent.models[0].id, effort: agent.models[0].defaultEffort ?? agent.defaultEffort ?? '' });
  }
  function changeModel(id) {
    const model = selectedAgent.models.find(m => m.id === id);
    set({ model: id, effort: model?.defaultEffort ?? selectedAgent.defaultEffort ?? '' });
  }
  useEffect(() => { const handle = event => { if (event.key === 'Escape') close(); }; addEventListener('keydown', handle); return () => removeEventListener('keydown', handle); }, []);
  return <div className="m16-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
    <form className="m16-dialog" role="dialog" aria-modal="true" aria-label={state.editor.id ? '编辑计划' : '新建计划'} onSubmit={e => { e.preventDefault(); setSubmitted(true); if (!error) state.save(draft); }}>
      <header className="m16-dialog-head"><div><h2>{state.editor.id ? '编辑计划' : '新建计划'}</h2><p>保存后，WillYou 按你指定的时间启动任务。</p></div><button type="button" className="m16-icon-button" aria-label="关闭" onClick={close}><X size={20}/></button></header>
      <div className="m16-dialog-grid">
        <div className="m16-form-main">
          <Field label="计划名称"><input autoFocus value={draft.name} onChange={e => set({ name: e.target.value })} placeholder="例如：每日研发摘要" maxLength={100}/></Field>
          <Field label="任务提示词"><textarea value={draft.prompt} onChange={e => set({ prompt: e.target.value })} placeholder="每次运行时，希望智能体做什么？" rows={5}/></Field>
          <ScheduleFields draft={draft} setSchedule={setSchedule}/>
          <div className="m16-policy-inline">
            <Field label="错过执行后的宽限期" note="宽限内仅补最近一次，超过则跳过。"><select value={draft.grace} onChange={e => set({ grace: Number(e.target.value) })}>{GRACE_OPTIONS.map(([n,label]) => <option key={n} value={n}>{label}</option>)}</select></Field>
            <div className="m16-detail-rule"><Clock3 size={14}/>前次尚未结束时跳过本次，并记录原因。</div>
          </div>
        </div>
        <div className="m16-form-settings">
          <section className="m16-form-section"><h3><Monitor size={17}/>任务配置</h3>
            <div className="m16-field"><span>运行主机</span><div className="m16-readonly"><Monitor size={16}/>此计算机</div></div>
            <Field label="任务去向"><select value={draft.destination} onChange={e => set({ destination: e.target.value, taskId: '', ...(e.target.value === 'existing' ? { workspace: 'existing' } : {}) })}>{DESTINATIONS.map(([id,name]) => <option value={id} key={id}>{name}</option>)}</select></Field>
            <Field label="项目"><select value={draft.projectId} onChange={e => selectProject(e.target.value)}><option value="" disabled>选择项目</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            {bound && <Field label="继续的任务" note="沿用任务当前配置；配置变化需要重新确认。"><select value={draft.taskId} onChange={e => bindTask(e.target.value)}><option value="">请选择任务</option>{tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></Field>}
            <Field label="工作目录"><select disabled={bound} value={draft.dirId} onChange={e => set({ dirId: e.target.value, workspace: 'existing' })}>{dirs.map(d => <option key={d.id} value={d.id}>{d.label} · {d.vcs ?? '普通目录'}</option>)}</select></Field>
            {dir && <div className="m16-dir-path" title={dir.path}>{dir.path}</div>}
            <Field label="工作区" note={draft.destination === 'reuse' && draft.workspace === 'worktree' ? '首次创建工作树，后续沿用该任务的工作区。' : null}><select disabled={bound} value={draft.workspace} onChange={e => set({ workspace: e.target.value })}><option value="existing">使用项目目录</option>{dir?.vcs === 'Git' && <option value="worktree">新建 Git 工作树</option>}</select></Field>
            {draft.workspace === 'worktree' && <Field label="基准分支"><select value={draft.branch} onChange={e => set({ branch: e.target.value })}><option value="main">main</option><option value="develop">develop</option><option value="feature/0.1.7">feature/0.1.7</option></select></Field>}
            <Field label="智能体"><div className="m16-select-icon"><AgentIcon tool={selectedAgent.tool} provider={provider(selectedAgent)} size={18}/><select value={draft.agent} disabled={bound} onChange={e => changeAgent(e.target.value)}>{usableAgents.map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></div></Field>
            <div className="m16-form-pair"><Field label="模型"><select value={draft.model} disabled={bound} onChange={e => changeModel(e.target.value)}>{selectedAgent.models.map(m => <option value={m.id} key={m.id}>{m.name}</option>)}</select></Field><Field label="推理强度"><select value={draft.effort} disabled={bound || efforts.length === 0} onChange={e => set({ effort: e.target.value })}>{(!efforts.includes(draft.effort) || !efforts.length) && <option value={draft.effort}>默认</option>}{efforts.map(e => <option key={e}>{e}</option>)}</select></Field></div>
          </section>
          <section className="m16-form-section m16-policy"><h3><ShieldCheck size={17}/>运行规则</h3>
            <div className="m16-field"><span>权限</span><div className="m16-readonly"><ShieldCheck size={16}/>请求批准</div><small>需要本人处理时暂停本次任务。</small></div>
            <label className="m16-checkbox"><input type="checkbox" checked={draft.enabled} onChange={e => set({ enabled: e.target.checked })}/>保存后启用</label>
          </section>
        </div>
      </div>
      <footer className="m16-dialog-foot"><span className="m16-form-error" role="status">{submitted && error ? error : bound && boundTask ? `将继续「${boundTask.title}」` : '演示 · 合成数据'}</span><button type="button" className="m16-button" onClick={close}>取消</button><button type="submit" className="m16-button primary">{state.editor.id ? '保存修改' : '创建计划'}</button></footer>
    </form>
  </div>;
}

function PlanList({ state }) {
  const [query, setQuery] = useState('');
  const plans = state.plans.filter(plan => (state.filter === 'deleted' ? plan.archived : !plan.archived && (state.filter === 'all' || (state.filter === 'enabled' ? plan.enabled : !plan.enabled))) && `${plan.name} ${projectName(state.projects, plan.projectId)}`.includes(query.trim()));
  const counts = [state.plans.filter(p => !p.archived).length, state.plans.filter(p => p.enabled && !p.archived).length, state.runs.filter(r => ACTIVE_RUNS.has(r.status)).length];
  return <><div className="m16-page-head"><div><h1>定时任务</h1><p>让重复工作按计划完成，并在任务记录中查看结果。</p></div><button className="m16-button primary" onClick={state.create}><Plus size={16}/>新建计划</button></div>
    <div className="m16-overview">{[['计划',counts[0]],['已启用',counts[1]],['正在运行或等待处理',counts[2]]].map(([label, count]) => <div key={label}><span>{label}</span><b>{count}</b></div>)}</div>
    <div className="m16-list-tools"><div className="m16-filter">{[['all','全部'],['enabled','已启用'],['paused','已暂停'],['deleted','已删除']].map(([id,name]) => <button key={id} className={state.filter === id ? 'selected' : ''} onClick={() => state.setFilter(id)}>{name}</button>)}</div><label className="m16-search"><Search size={16}/><input aria-label="搜索计划" placeholder="搜索计划" value={query} onChange={e => setQuery(e.target.value)}/></label></div>
    <div className="m16-plan-list">{plans.length ? plans.map(plan => {
      const last = state.runs.find(run => run.planId === plan.id);
      return <article className="m16-plan-row" key={plan.id}><button className="m16-plan-main" onClick={() => state.setSelected(plan.id)}><span className="m16-clock-icon"><CalendarClock size={20}/></span><span><strong>{plan.name}</strong><small>{projectName(state.projects, plan.projectId)} · {scheduleLabel(plan.schedule)}</small></span></button><div className="m16-plan-agent"><AgentCaption agentId={plan.agent} modelId={plan.model}/></div><div className="m16-next"><small>下次执行</small>{formatRunTime(planDate(plan), plan.schedule.zone)}</div><div className="m16-last"><small>最近运行</small>{last ? <Status value={last.status}/> : '尚未运行'}</div>{plan.archived || planEnded(plan) ? <span className="m16-state-text">{planStatus(plan)}</span> : <button className={`m16-switch ${plan.enabled ? 'on' : ''}`} role="switch" aria-label={`${plan.name}启用`} aria-checked={plan.enabled} onClick={() => state.toggle(plan)}><i/></button>}<button className="m16-icon-button" aria-label={`查看${plan.name}`} onClick={() => state.setSelected(plan.id)}><ChevronRight size={16}/></button></article>;
    }) : <div className="m16-empty"><CalendarClock size={32}/><h3>{query ? '没有匹配的计划' : '暂无计划'}</h3>{!query && state.filter === 'all' && <button className="m16-button" onClick={state.create}>创建第一个计划</button>}</div>}</div>
  </>;
}

function PlanDetail({ state, plan }) {
  const runs = state.runs.filter(run => run.planId === plan.id);
  const busy = runs.some(run => ACTIVE_RUNS.has(run.status));
  const [simulation, setSimulation] = useState('due');
  return <><button className="m16-back" onClick={() => state.setSelected(null)}><ArrowLeft size={15}/>全部计划</button>
    <div className="m16-page-head m16-detail-head"><div><h1>{plan.name}</h1><p><span className={`m16-plan-dot ${plan.enabled ? 'enabled' : ''}`}/>{planStatus(plan)} · {projectName(state.projects,plan.projectId)}</p></div>{!plan.archived && <div className="m16-actions"><button className="m16-button" onClick={() => state.edit(plan)}><Edit3 size={15}/>编辑</button>{!planEnded(plan) && <button className="m16-button" onClick={() => state.toggle(plan)}>{plan.enabled ? <Pause size={15}/> : <Play size={15}/>} {plan.enabled ? '暂停' : '恢复'}</button>}<button className="m16-button primary" disabled={busy} onClick={() => state.launch(plan,'manual')}><Play size={15}/>立即运行</button><button className="m16-icon-button danger" aria-label="删除计划" onClick={() => state.setDeleteId(plan.id)}><Trash2 size={17}/></button></div>}</div>
    <div className="m16-detail-grid"><section className="m16-detail-card"><h3>计划配置</h3><dl><dt>执行时间</dt><dd>{scheduleLabel(plan.schedule)}</dd><dt>下次执行</dt><dd>{formatRunTime(planDate(plan),plan.schedule.zone)}</dd><dt>时区</dt><dd>{plan.schedule.zone || '跟随本机'}</dd><dt>宽限期</dt><dd>{GRACE_OPTIONS.find(([n]) => n === plan.grace)?.[1]}</dd><dt>任务去向</dt><dd>{DESTINATIONS.find(([n]) => n === plan.destination)?.[1]}</dd><dt>目录与工作区</dt><dd>{dirName(state.projects,plan)} · {plan.workspace === 'worktree' ? `Git 工作树 / ${plan.branch}` : '项目目录'}</dd><dt>运行主机</dt><dd>此计算机</dd><dt>智能体</dt><dd><AgentCaption agentId={plan.agent} modelId={plan.model} effort={plan.effort}/></dd></dl></section>
      <section className="m16-detail-card"><h3>任务提示词</h3><p className="m16-detail-prompt">{plan.prompt}</p><div className="m16-detail-rule"><ShieldCheck size={15}/>请求批准 · 前次未结束时跳过</div></section></div>
    <div className="m16-history-head"><h2>运行记录 <small>{runs.length}</small></h2>{plan.enabled && !plan.archived && <div className="m16-sim-controls"><select aria-label="模拟调度场景" value={simulation} onChange={e => setSimulation(e.target.value)}><option value="due">准时到达</option><option value="within">宽限期内唤醒</option><option value="outside">超出宽限期</option></select><button className="m16-button m16-sim-button" onClick={() => state.launch(plan,'scheduled',simulation)}>模拟触发</button></div>}</div>
    {runs.length ? <div className="m16-history"><div className="m16-history-row header"><span>触发时间</span><span>执行状态</span><span>任务去向／原因</span><span>操作</span></div>{runs.map(run => <div className="m16-history-row" key={run.id}><span>{formatRunTime(run.scheduledFor,plan.schedule.zone)}<small>{run.trigger === 'manual' ? '手动触发' : '定时触发'}</small></span><Status value={run.status}/><span className="m16-history-reason">{run.reason || run.title}</span><button className="m16-text-button" onClick={() => state.setRunId(run.id)}>{run.taskId ? '查看任务记录' : '查看原因'}<ChevronRight size={14}/></button></div>)}</div> : <div className="m16-empty history"><List size={28}/><p>暂无运行记录，首次执行后将在这里显示。</p></div>}
  </>;
}

function RunDetail({ state, run }) {
  return <div className="m16-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) state.setRunId(null); }}><section className="m16-dialog m16-run-dialog" role="dialog" aria-modal="true" aria-label="任务运行记录"><header className="m16-dialog-head"><div><h2>{run.title}</h2><p>任务运行记录 · 合成数据</p></div><button className="m16-icon-button" aria-label="关闭" onClick={() => state.setRunId(null)}><X size={20}/></button></header><div className="m16-run-body"><div className="m16-run-meta"><Status value={run.status}/><AgentCaption agentId={run.agent} modelId={run.model}/></div><dl><dt>计划触发时间</dt><dd>{formatRunTime(run.scheduledFor)}</dd><dt>实际开始</dt><dd>{formatRunTime(run.startedAt)}</dd><dt>结束</dt><dd>{formatRunTime(run.finishedAt)}</dd><dt>关联任务</dt><dd>{run.taskId ?? '未派发任务'}</dd></dl><div className="m16-run-prompt">{run.prompt}</div><p>{run.reason || (run.status === 'completed' ? '智能体已完成本次计划任务（示例）。' : '等待执行结果。')}</p>{ACTIVE_RUNS.has(run.status) && <div className="m16-simulation"><span>模拟运行结果</span><div>{[['completed','完成'],['waiting','等待审批'],['failed','失败'],['stopped','停止']].map(([status,label]) => <button className="m16-button" key={status} disabled={run.status === status} onClick={() => state.settle(run.id,status)}>{label}</button>)}</div></div>}</div><footer className="m16-dialog-foot"><button className="m16-button" onClick={() => state.setRunId(null)}>关闭</button></footer></section></div>;
}

export function M16ScheduleWorkspace({ state, dark, onTheme }) {
  const plan = state.plans.find(p => p.id === state.selected), run = state.runs.find(r => r.id === state.runId);
  return <section className="m16-workspace" aria-label="M16 定时任务原型"><div className="m16-topline"><span>定时任务 · 初始原型（合成）</span><button className="m16-text-button" onClick={onTheme}>{dark ? '浅色' : '深色'}主题</button></div><div className="m16-content">{plan ? <PlanDetail key={plan.id} state={state} plan={plan}/> : <PlanList state={state}/>}</div>
    {state.editor && <Editor state={state}/>}
    {run && <RunDetail state={state} run={run}/>}
    {state.deleteId && <div className="m16-backdrop"><section className="m16-dialog m16-delete-dialog" role="alertdialog" aria-label="删除定时计划"><header className="m16-dialog-head"><h2>删除定时计划？</h2></header><p>后续将停止触发，已产生的任务和运行记录继续保留。</p><footer className="m16-dialog-foot"><button className="m16-button" onClick={() => state.setDeleteId(null)}>取消</button><button className="m16-button danger-fill" onClick={state.remove}>删除计划</button></footer></section></div>}
  </section>;
}
