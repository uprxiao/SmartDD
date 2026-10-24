import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, ChevronRight, Database, Mail, Package, SquareTerminal, Zap } from 'lucide-react';
import { demoZenTaoRuns, APP_DEFINITIONS, M10_STORAGE, initialIntegrationState, projectIntegrationState, packageVersion, connectionReady, projectPackages, snapshotCurrent, toggleProjectApplication, simulatePackageUpgrade, projectAppEnabled, selectedConnections, switchProjectZenTao, sessionApplicationState, packageRetention, upgradeBlockers, selectProjectMailConnection, sessionCapabilityDiagnostic, recoverSessionCapability } from './integration-model.mjs';
import './integration.css';

export function useIntegrationPreview() {
  const [data, setData] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(M10_STORAGE)); return projectIntegrationState(saved?.version === 2 ? saved : initialIntegrationState()); }
    catch { return projectIntegrationState(initialIntegrationState()); }
  });
  const [storageFailed, setStorageFailed] = useState(false);
  useEffect(() => {
    try { localStorage.setItem(M10_STORAGE, JSON.stringify(projectIntegrationState(data))); setStorageFailed(false); }
    catch { setStorageFailed(true); }
  }, [data]);
  return { data, setData, storageFailed };
}

export function ApplicationMark({ app }) {
  return <span className={'m10-appmark ' + app}>{app === 'mail' ? <Mail size={23} /> : <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M8 10h16L10 22h14M7 16h6" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>;
}

export function ApplicationPackage({ app, data, onUse, enabled = false }) {
  const [expanded, setExpanded] = useState(false);
  return <section className="m10-package-section" aria-label={app.name + '应用包'}>
    <div className="m10-package-heading"><Package size={17} /><h2>应用包</h2><span className="m10-pill">v{packageVersion(data, app.id)}</span><small>随 WillYou 交付</small></div>
    <p className="m10-package-description">连接、工具与 {app.skills.length} 个 Skill 一起提供，在项目中选用后即可使用。</p>
    <div className="m10-bundled-skills">{app.skills.map(skill => <article key={skill.id}><Zap size={16} /><div><strong>{skill.name}<span className="m10-inline-label">随应用启用</span></strong><p>{skill.description}</p><button className="m10-example" disabled={!enabled} onClick={() => onUse(skill.prompt)} title={!enabled ? '先在项目中启用应用' : undefined}><span>“{skill.prompt}”</span><ArrowUpRight size={13} /></button></div></article>)}</div>
    <button className="m10-package-disclosure" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>查看工具与包内容<ChevronRight size={13} className={expanded ? 'expanded' : ''} /></button>
    {expanded && <div className="m10-package-contents"><p>包含应用界面、连接表单、适配器、工具／MCP、配套 Skill、资源和数据迁移。</p>{app.capabilities.map(c => <div key={c.id}><Check size={13} /><span>{c.title}</span><small>{c.pending ? '待评审 · 当前不可调用' : c.effect === 'draft' ? '本地草稿 · 无需SMTP' : c.effect === 'write' ? '明确授权后通过SMTP发送' : '读取'}</small></div>)}<p>版本号为演示值；账号与业务数据保存在本地，独立于应用包。</p></div>}
  </section>;
}

function ReviewDialog({ title, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => { const before = document.activeElement; ref.current.showModal(); return () => { ref.current?.close(); before?.isConnected && before.focus(); }; }, []);
  return <dialog ref={ref} className="m10-dialog" aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }}><header><h2>{title}</h2><button onClick={onClose} aria-label="关闭">×</button></header>{children}</dialog>;
}

export function ProjectApplications({ project, integration, nav, onUse, onNewTask, tasks = [], onStopTasks }) {
  const { data, setData, storageFailed } = integration;
  const [switchTo, setSwitchTo] = useState(null), [switchResult, setSwitchResult] = useState(''), [failure, setFailure] = useState('none');
  const bound = data.bindings[project.id] || [];
  let related=[],scopeError='';try{related=demoZenTaoRuns(tasks,project.id);}catch(error){scopeError=error.message;}
  const switchConnection = () => {
    if(scopeError)return setSwitchResult(scopeError);
    if (failure === 'stop') return setSwitchResult('模拟停止失败：保留原连接，未提交切换。');
    onStopTasks?.(related.map(t => t.id));
    if (failure === 'commit') return setSwitchResult('模拟切换失败：原连接保留，已停止的运行不会自动重启。');
    const result = switchProjectZenTao(data, project.id, switchTo.id, tasks.map(t => related.some(r => r.id === t.id) ? { ...t, status: 'stopped' } : t));
    if (!result.ok) return setSwitchResult(result.reason);
    setData(result.state); setSwitchTo(null); setSwitchResult('连接已明确切换；原会话可手动恢复，固定应用版本保持不变。');
  };
  return <div className="m10-project-apps" aria-label={project.name + '的应用'}>
    <div className="m10-project-apps-intro"><div><h2>项目应用</h2><p>启用应用后，配套 Skill 与工具一起提供给本项目的会话。</p></div><button className="m10-button secondary" onClick={() => nav('apps')}>管理应用<ArrowUpRight size={13} /></button></div>
    {storageFailed && <p className="m10-note" role="alert">演示存储不可用；本次修改尚未保存。</p>}
    {switchResult && <p className="m10-note" role="status">{switchResult}</p>}
    {APP_DEFINITIONS.map(app => {
      const installed = data.installed.includes(app.id), connections = data.connections.filter(c => c.app === app.id);
      const selected = projectAppEnabled(data, project.id, app.id), chosen = selectedConnections(data, project.id, app.id);
      const health = chosen.some(connectionReady);
      return <section className="m10-project-application" key={app.id}>
        <header><ApplicationMark app={app.id} /><div><strong>{app.name}<span className="m10-package-version">v{packageVersion(data, app.id)} · 新会话默认</span></strong><p>{app.skills.length} 个 Skill · 旧会话保留创建时的版本</p></div><span className={'m10-state ' + (selected ? 'ready' : '')}>{!installed ? '尚未添加' : selected ? '项目已启用' : '未启用'}</span><button className={'m10-switch ' + (selected ? 'on' : '')} role="switch" aria-label={'为' + project.name + '启用' + app.name} aria-checked={selected} disabled={!installed || project.archived} onClick={() => setData(d => toggleProjectApplication(d, project.id, app.id, !selected))}><span /></button></header>
        <div className="m10-project-application-body">
          <p className="m10-muted">{app.id === 'zentao' ? '每项目仅一个生效连接；停用或认证失败不会切换到其他账号。' : '每项目最多选一个本地读取来源和一个SMTP发件账号，分别配置；不选发件账号也可保存草稿。'}</p>
          {app.id === 'mail' ? <MailProjectConnections data={data} project={project} installed={installed} setData={setData} /> : connections.length ? <div className="m10-project-connections">{connections.map(c => <label key={c.id}><input type="radio" name={'connection-' + project.id + '-' + app.id} aria-label={'为' + project.id + '选用' + c.name} checked={chosen.some(x => x.id === c.id)} disabled={project.archived || !installed} onChange={() => { setSwitchTo(c); setSwitchResult(''); setFailure('none'); }} /><span><strong title={c.name}>{c.name}</strong><small>{c.account || '本地来源'} · {c.url || c.host || c.path}<br />{connectionReady(c) ? '连接可用 · 示例' : c.enabled ? '连接不可用；不会阻止Agent启动' : '连接已停用'}</small></span></label>)}</div> : <p className="m10-muted">尚未配置连接。Agent仍可正常启动，查询时提示未配置。</p>}
          {selected && !health && <p className="m10-muted">{app.id === 'mail' ? '读取／发送暂不可用，本地草稿可用。' : '禅道查询暂不可用，其他能力照常使用。'}</p>}
          <div className="m10-project-skills"><Zap size={14} /><span>{app.skills.map(s => s.name).join('、')}</span><small>随应用启用</small></div>
          <footer><button onClick={() => nav('apps/' + app.id)}>查看应用与连接<ChevronRight size={13} /></button><button className="m10-button secondary" disabled={!selected || project.archived} onClick={() => onUse(app.skills[0].prompt, project.id, app.id)}><SquareTerminal size={14} />在 WillYou 终端使用</button></footer>
        </div>
      </section>;
    })}
    <div className="m10-project-session-note"><SquareTerminal size={17} /><div><strong>新会话采用当前版本，恢复会话保留原版本</strong><p>连接和权限按当前配置检查；暂时不可用不影响 Agent 启动。应用升级不会将新版替换进旧会话。</p><span>首版目标：macOS arm64 · Claude Code / Codex · 仅 WillYou 内启动／恢复。这里是合成演示，实际CLI版本适配待验证。</span></div><button className="m10-button secondary" disabled={project.archived} onClick={onNewTask}>新建任务<ArrowUpRight size={13} /></button></div>
    <div className="m10-local-data"><Database size={15} /><span>连接、草稿和记录独立保存在本地；程序包升级继续读取原数据。</span></div>
    {switchTo && <ReviewDialog title="切换项目禅道连接" onClose={() => setSwitchTo(null)}><p className="m10-modal-copy">{chosenZenName(data, project.id)} → {switchTo.name}（{switchTo.account}）<br />仅影响 {project.name}。停止相关运行后提交切换，旧引用仍保留原来源。</p>{scopeError?<p role="alert">{scopeError}</p>:<DemoImpact data={{kind:'switch',connections:data.connections.filter(c=>c.app==='zentao'&&bound.includes(c.id)).map(c=>({id:c.id,name:c.name,providerId:'zentao',enabled:c.enabled,authorization:c.validation==='disconnected'?'disconnected':'connected'})),projects:[{id:project.id,name:project.name,enabled:projectAppEnabled(data,project.id,'zentao'),archived:!!project.archived}],runs:related}}/>}<label className="m10-field"><span>演示结果</span><select value={failure} onChange={e => setFailure(e.target.value)}><option value="none">切换成功</option><option value="stop">停止失败</option><option value="commit">停止后切换失败</option></select></label>{switchResult && <p role="status">{switchResult}</p>}<footer><button className="m10-button secondary" onClick={() => setSwitchTo(null)}>取消</button><button className="m10-button primary" disabled={!!scopeError} onClick={switchConnection}>{related.length ? '停止相关运行并切换 · 模拟' : '切换连接 · 模拟'}</button></footer></ReviewDialog>}
  </div>;
}
function chosenZenName(data, projectId) { return selectedConnections(data, projectId, 'zentao')[0]?.name || '未选定唯一连接'; }

function MailProjectConnections({ data, project, installed, setData }) {
  const bound = data.bindings[project.id] || [];
  return <div className="m10-mail-connections">{[['local', '本地读取来源'], ['smtp', 'SMTP发件账号']].map(([kind, title]) => {
    const choices = data.connections.filter(c => c.app === 'mail' && c.kind === kind);
    const raw = choices.filter(c => bound.includes(c.id));
    const selected = raw.length === 1 ? raw[0].id : '';
    return <fieldset key={kind}><legend>{title} · 最多一个</legend>{raw.length > 1 && <p className="m10-note" role="alert">旧选择包含多个{title}，当前不使用其中任何一个；请明确选择。</p>}<div className="m10-project-connections">
      <label><input type="radio" name={'mail-' + project.id + '-' + kind} aria-label={'不选用' + title} checked={!raw.length} disabled={project.archived || !installed} onChange={() => setData(d => selectProjectMailConnection(d, project.id, kind, ''))} /><span><strong>不选用</strong><small>{kind === 'smtp' ? '仍可保存草稿；发送时提示未配置' : '本地邮件查询暂不可用'}</small></span></label>
      {choices.map(c => <label key={c.id}><input type="radio" name={'mail-' + project.id + '-' + kind} aria-label={'为' + project.id + '选用' + c.name} checked={selected === c.id} disabled={project.archived || !installed} onChange={() => setData(d => selectProjectMailConnection(d, project.id, kind, c.id))} /><span><strong title={c.name}>{c.name}</strong><small>{c.account || '本地来源'} · {c.host || c.path}<br />{connectionReady(c) ? '连接可用 · 示例' : '当前不可用，不会自动选择其他账号'}</small></span></label>)}
    </div></fieldset>;
  })}</div>;
}

export function SessionApplications({ task, integration, onUse, onNewTask, onContinue, nav }) {
  const { data, setData } = integration, current = projectPackages(data, task.project), snapshot = task.integrationSnapshot;
  const [faults, setFaults] = useState({}), [outcomes, setOutcomes] = useState({}), [messages, setMessages] = useState({}), [copyState,setCopyState] = useState('held'), [readStates,setReadStates] = useState({}), [discoveryStates,setDiscoveryStates] = useState({});
  useEffect(() => { setFaults({}); setOutcomes({}); setMessages({}); setReadStates({}); setDiscoveryStates({}); }, [task.id]);
  const apps = APP_DEFINITIONS.filter(a => current.some(p => p.id === a.id) || snapshot?.packages?.some(p => p.id === a.id));
  const supported = ['claude','codex'].includes(task.runner || 'claude');
  const recover = appId => {
    const result = recoverSessionCapability(snapshot, data, task.project, appId, faults[appId], outcomes[appId] !== 'failed', { userResolvedConflict: outcomes[appId] === 'user-resolved' });
    setData(result.state); setFaults(value => ({ ...value, [appId]: result.fault })); setMessages(value => ({ ...value, [appId]: result.message }));
  };
  return <div className="m10-session-apps">
    <p className="section-description">固定版本与当前使用条件分别展示。应用不可用时，Agent继续工作。</p>
    {!snapshot && <p className="m10-note">历史能力未知：不自动补入当前应用。可继续原任务，或使用当前应用新建会话。</p>}
    {!apps.length && <p className="m10-note">本会话未选用应用。</p>}
    {apps.map(app => {
      const fixed = snapshot?.packages?.find(a => a.id === app.id), status = sessionCapabilityDiagnostic(snapshot, data, task.project, app.id, faults[app.id]);
      const original = fixed?.connections?.map(c => c.id).join(', '), now = selectedConnections(data, task.project, app.id).map(c => c.id).join(', ');
      return <section className="m10-session-app" key={app.id}>
        <header><ApplicationMark app={app.id} /><div><strong>{app.name}<span className="m10-package-version">{fixed ? '会话固定 v' + fixed.version : '本会话未选用'}</span></strong><small>新会话默认 v{packageVersion(data, app.id)} · {status.title}</small></div><span className="m10-state">{supported ? '准备状态 · 模拟' : '此Agent应用适配未支持'}</span></header>
        {fixed && <><p>{fixed.skills.length} 个 Skill · {fixed.tools.length} 个工具<br />文件准备：{status.usable ? '模拟已准备' : '应用能力不可用'} · Agent发现：{discoveryStates[app.id]==='verified'?'已核验本次原生清单 · 合成示例':'未验证'} · Agent读取：{readStates[app.id]==='verified'?'已核验本次原生读取 · 合成示例':'未验证'} · 实际调用：未验证</p><details className="m10-runtime-demo"><summary>Skill 读取证据 · 合成演示</summary><label>发现状态<select aria-label={app.name+' Skill发现状态'} value={discoveryStates[app.id]||'unverified'} onChange={e=>setDiscoveryStates(v=>({...v,[app.id]:e.target.value}))}><option value="unverified">未验证</option><option value="verified">本次清单已核验 · 合成</option></select></label><label>读取状态<select aria-label={app.name+' Skill读取状态'} value={readStates[app.id]||'unverified'} onChange={e=>setReadStates(v=>({...v,[app.id]:e.target.value}))}><option value="unverified">未验证</option><option value="verified">本次读取已核验 · 合成</option></select></label><p className="m10-muted">演示当前运行的完整读取记录；不证明目录发现或工具使用。停止恢复后不能沿用旧运行证据。此处没有读取本机日志。</p></details>
          {original !== now && <p className="m10-note">当前连接已变化：{original || '未选用'} → {now || '未选用'}。恢复时核对旧包兼容性；历史对象仍属原来源。</p>}
          <details className="m10-runtime-demo"><summary>应用故障与恢复 · 合成演示</summary><label>故障场景<select aria-label={app.name + '应用故障场景'} value={faults[app.id] || 'none'} onChange={e => { setFaults(value => ({ ...value, [app.id]: e.target.value })); setOutcomes(value => ({ ...value, [app.id]: e.target.value === 'nameConflict' ? 'failed' : 'success' })); setMessages(value => ({ ...value, [app.id]: '' })); }}><option value="none">无额外故障</option><option value="missing">固定应用包缺失</option><option value="corrupt">固定应用包损坏</option><option value="incompatible">固定版本与当前配置不兼容</option><option value="nameConflict">用户能力名称冲突 · 不注入此应用</option><option value="bridge">能力桥中断 · 可原地恢复</option><option value="bridgeRestart">能力桥中断 · 需下次启动</option></select></label>{status.action && <label>恢复结果<select aria-label={app.name + '应用恢复结果'} value={status.fault === 'nameConflict' ? (outcomes[app.id] === 'user-resolved' ? 'user-resolved' : 'failed') : outcomes[app.id] === 'failed' ? 'failed' : 'success'} onChange={e => setOutcomes(value => ({ ...value, [app.id]: e.target.value }))}>{status.fault === 'nameConflict' ? <><option value="failed">用户配置仍有冲突</option><option value="user-resolved">用户已处理冲突 · 模拟重新检查通过</option></> : <><option value="success">条件已修复 · 模拟成功</option><option value="failed">条件仍不满足 · 模拟失败</option></>}</select></label>}</details>
          {(status.fault !== 'none' || !status.usable) && <div className="m10-capability-alert" role="status"><strong>{status.title}</strong><p>{status.reason}</p><small>{status.code} · 本会话 v{fixed.version} · Agent可以继续</small><div className="m10-capability-actions">{supported && status.action && <button className="m10-button secondary" onClick={() => recover(app.id)}>{status.action} · 模拟</button>}{status.fault === 'nameConflict' && <button className="m10-button secondary" onClick={() => setMessages(value => ({ ...value, [app.id]: '合成冲突示例：plugin namespace = willyou-' + app.id + '；完整 Skill 名称 = willyou-' + app.id + ':' + app.skills[0].id + '；MCP key = willyou-' + app.id + '。实际产品列出真实冲突项和来源配置位置；此处未读取或更改用户文件。' }))}>查看冲突</button>}{status.fault === 'incompatible' && <button className="m10-button secondary" onClick={() => nav('apps/' + app.id)}>检查当前连接配置</button>}<button className="m10-button secondary" onClick={onContinue}>继续使用 Agent</button></div>{['missing','corrupt'].includes(status.fault) && <p className="m10-muted">同版本号也必须校验相同内容标识；无可信副本时保持不可用。需要新版请另建会话，原会话保留。</p>}</div>}
          {messages[app.id] && <p className="m10-note" role="status">{messages[app.id]}</p>}
          {app.skills.map(skill => <button key={skill.id} className="m10-example" disabled={!supported || task.status !== 'running' || !status.usable} onClick={() => onUse(skill.prompt)}><span>“{skill.prompt}”</span><ArrowUpRight size={13} /></button>)}
        </>}
      </section>;
    })}
    <details className="m10-runtime-demo"><summary>本次能力准备与冲突来源</summary><p className="m10-muted">仅记录准备结果，不证明 Agent 已发现或读取。当前原型使用合成数据，不读取或修改本机配置。</p>{apps.map(app=>{const fixed=snapshot?.packages?.find(p=>p.id===app.id),status=sessionCapabilityDiagnostic(snapshot,data,task.project,app.id,faults[app.id]);return <section key={app.id}><strong>{app.name}</strong><p>{fixed?(status.usable?'合成文件准备可用 · 使用未验证':'模拟未准备 · '+status.code):'未记录本会话选用'}</p>{status.fault==='nameConflict'&&<p className="m10-message-id">配置文件：/示例/.codex/config.toml<br/>来源：应用同名能力或启停配置 · 合成路径，未读取本机</p>}</section>;})}<p className="m10-muted">独立 Skill／项目 MCP 沿用既有管理入口。当前合成会话未记录其逐项准备证据，不从项目默认配置推断。</p></details>
    <details className="m10-runtime-demo"><summary>历史 Skill 观察记录 · 合成演示</summary><p className="m10-muted">仅表示原运行曾观察到的证据，不作为当前运行就绪依据；不由清单发现推导正文读取。</p><p className="m10-message-id">示例原运行：previous-run<br/>Skill：示例应用助手 · 正文读取<br/>时间：2026-10-23T08:00:00Z<br/>记录校验：合成摘要</p><p className="m10-muted">实际产品从本会话原运行记录读取；缺失不推断成功，损坏明确提示待核查。此处不读取本机记录。</p></details>
    {(task.runner || 'claude') === 'claude' && <details className="m10-runtime-demo"><summary>交付副本保留与清理记录</summary><p className="m10-muted">只读展示最近处理记录，不触发清理或重启。仅有完成记录不证明当前路径已不存在，也不表示原版本可以删除。</p><label>副本记录场景 · 合成演示<select aria-label="副本记录场景" value={copyState} onChange={e=>setCopyState(e.target.value)}><option value="held">占用中，保留</option><option value="deleting">中断后待核查</option><option value="committed">原回收记录已完成</option><option value="unverified">记录未核实</option></select></label><p>{copyState==='held'?'保留：仍有占用或引用待核查':copyState==='deleting'?'部分清理，待恢复核查':copyState==='committed'?'原回收记录已完成':'处理记录未核实，保留原内容'}</p><p className="m10-message-id">示例相对路径：claude-deliveries/示例任务/示例交付/previous</p><p className="m10-muted">合成记录，未读取本机文件或执行清理。实际产品展示本会话原操作账、内容标识与保留原因；截断或损坏明确标为未完整核对。</p></details>}
    <div className="m10-session-footer"><button className="button secondary" onClick={() => nav('project/' + task.project + '/apps')}>项目应用</button><button className="button primary" onClick={onNewTask}>使用当前版本新建会话</button></div>
    <p className="m10-muted">恢复时继续引用原包，不同步替换新版。用户自行安装的 Skill / MCP 保持原配置。故障切换与修复仅模拟，不修改真实文件、连接、终端或邮件。示例只插入输入，不自动发送。</p>
  </div>;
}

export function PackageUpgradePreview({ data, setData, tasks = [] }) {
  const [result, setResult] = useState(null), [phase, setPhase] = useState('idle'), [simulateOccupied, setSimulateOccupied] = useState(false), [preflightScene,setPreflightScene]=useState('ready');
  const activeRuns = useRef(tasks); activeRuns.current = simulateOccupied ? [...tasks, { id: 'shared-root-demo', title: '共享Skill目录使用中 · 合成运行', runner: 'codex', status: 'running' }] : tasks;
  const blocked = upgradeBlockers(activeRuns.current);
  const timer = useRef(null); useEffect(() => () => clearTimeout(timer.current), []);
  const upgraded = APP_DEFINITIONS.every(a => packageVersion(data, a.id) === '1.1.0');
  const run = fail => { if(preflightScene!=='ready'){setResult({message:'预检尚未通过，原默认版本和历史保留。'});return;} if (blocked.length) { setResult(simulatePackageUpgrade(data, fail, activeRuns.current)); return; } setPhase('preparing'); setResult(null); timer.current = setTimeout(() => { setData(current => { const upgrade = simulatePackageUpgrade(current, fail, activeRuns.current); setResult(upgrade); return upgrade.state; }); setPhase('idle'); }, 450); };
  return <div className="m10-upgrade-preview"><p className="m10-modal-copy">模拟新版包完整准备、校验后切换默认版本。旧会话引用原版本，未打开的历史会话也保留引用。仅合成状态，不更新程序或真实SQLite。</p><label>升级预检场景<select aria-label="升级预检场景" value={preflightScene} onChange={e=>setPreflightScene(e.target.value)}><option value="ready">预检通过</option><option value="blocked">连接契约待核验</option><option value="unavailable">无法核验</option></select></label>{preflightScene!=='ready'&&<section className="m10-note m10-upgrade-report" aria-label="升级预检"><strong>{preflightScene==='blocked'?'升级暂未执行':'升级状态无法核验'}</strong><p>本次整组目标：邮件 v1.1.0、禅道 v1.1.0。</p>{preflightScene==='blocked'&&<p>连接配置与所用版本的兼容性尚未核验 · 会话 demo-history · 连接 demo-mail。</p>}<p>原默认版本、历史会话和业务数据保留。检查不会执行升级。仅合成示例。</p></section>}<label className="m10-check"><input type="checkbox" checked={simulateOccupied} onChange={e => setSimulateOccupied(e.target.checked)} />模拟共享Skill目录仍有运行占用</label>{blocked.length > 0 && <p className="m10-note">等待以下运行释放共享目录：{blocked.map(t => t.title || t.id).join('、')}。可保留此状态；解除模拟占用后再执行升级。</p>}{phase === 'preparing' && <p className="m10-note" role="status">正在准备和校验…新会话暂沿用原默认版本。</p>}<div className="m10-upgrade-versions">{APP_DEFINITIONS.map(app => <div key={app.id}><ApplicationMark app={app.id} /><strong>{app.name}</strong><span>新会话默认 v{packageVersion(data, app.id)}</span></div>)}</div><div className="m10-version-list">{APP_DEFINITIONS.flatMap(app => (data.installedVersions?.[app.id] || ['1.0.0']).map(version => { const retained = packageRetention(data, tasks, app.id, version); return <div key={app.id + version}><strong>{app.name} v{version}</strong><span>{retained.references.length}个会话引用 · {retained.running}个运行中</span><small>{retained.reasons.join('；') || '无引用，可进入清理检查'} · 大小未测量</small><button className="m10-button secondary" disabled={!retained.cleanable || phase !== 'idle'} onClick={() => { setResult({ ok: true, message: '模拟清理二次核对：无引用时才删除。此预览保留文件；真实租约与崩溃恢复待工程验证。' }); }}>演示清理检查</button></div>; }))}</div><div className="m10-data-retention">{[['连接配置', data.connections.length], ['项目选用关系', Object.values(data.bindings).reduce((n, ids) => n + ids.length, 0)], ['草稿', data.drafts?.length || 0], ['调用记录', data.activity.length]].map(([label, count]) => <div key={label}><Check size={14} /><span>{label}</span><strong>{count} 项 · 保留</strong></div>)}</div><p className="m10-muted">共享Skill目录被运行占用时等待相关终端结束；不强制打断。中断后恢复检查未完成安装；不回退业务数据。</p>{result && <p className="m10-note" role="status">{result.message}</p>}<div className="m10-session-footer"><button className="button secondary" disabled={upgraded || phase !== 'idle'} onClick={() => run(true)}>模拟准备失败</button><button className="button primary" disabled={upgraded || phase !== 'idle'} onClick={() => run(false)}>{upgraded ? '已模拟升级' : '模拟升级并保留数据'}</button></div></div>;
}

export function DemoImpact({data}){
 const list=(label,items,content)=><><h3>{label}（{items.length}）</h3>{items.length?<ul className="m10-impact-list" aria-label={label}>{items.map(content)}</ul>:<p>{label==='需要停止的运行'?'没有需要停止的运行。':label==='关联项目'?'没有关联项目。':'没有受影响的连接。'}</p>}</>;
 return <section className="m10-impact" aria-label="本次操作影响范围">{list('受影响连接',data.connections,c=><li key={c.id}><strong title={c.name}>{c.name}</strong><small>{c.providerId==='smtp'?'SMTP 发件账号':c.providerId==='foxmail'?'本地读取来源':'禅道连接'} · {c.authorization==='disconnected'?'已断开':c.enabled?'连接已启用':'连接已停用'}</small></li>)}{list('关联项目',data.projects,p=><li key={p.id}><strong title={p.name}>{p.name}</strong><small>{p.archived?'已归档 · ':''}{p.enabled?'项目已启用':'项目已停用'}</small></li>)}{data.kind==='switch'&&list('需要停止的运行',data.runs,r=><li key={r.id}><strong title={r.title}>{r.title}</strong><small>{r.status==='running'?'运行中，需停止':r.status==='preparing'?'正在准备，需停止':'正在停止，待确认'}</small></li>)}<p className="m10-muted">{data.kind==='switch'?'执行时再次核对当前相关运行；无关任务继续运行。':'已停用或归档项目仍保留连接选择；此操作不停止 Agent 的其他工作。'} · 合成原型</p></section>;
}
