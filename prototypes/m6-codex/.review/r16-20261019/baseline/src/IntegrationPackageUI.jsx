import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, ChevronRight, Database, Mail, Package, SquareTerminal, Zap } from 'lucide-react';
import { APP_DEFINITIONS, M10_STORAGE, initialIntegrationState, projectIntegrationState, packageVersion, connectionReady, projectPackages, snapshotCurrent, toggleProjectApplication, simulatePackageUpgrade, projectAppEnabled, selectedConnections, switchProjectZenTao, sessionApplicationState, packageRetention, upgradeBlockers } from './integration-model.mjs';
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
  const related = tasks.filter(t => t.project === project.id && t.status === 'running' && (!t.integrationSnapshot || t.integrationSnapshot.packages.some(p => p.id === 'zentao')));
  const switchConnection = () => {
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
          <p className="m10-muted">{app.id === 'zentao' ? '每项目仅一个生效连接；停用或认证失败不会切换到其他账号。' : '本地草稿不依赖SMTP；读取和发送分别检查所选连接。邮件多来源与多发件账号规则待评审，暂保留已有选择。'}</p>
          {connections.length ? <div className="m10-project-connections">{connections.map(c => <label key={c.id}><input type={app.id === 'zentao' ? 'radio' : 'checkbox'} name={'connection-' + project.id + '-' + app.id} aria-label={'为' + project.id + '选用' + c.name} checked={app.id === 'zentao' ? chosen.some(x => x.id === c.id) : bound.includes(c.id)} disabled={project.archived || !installed} onChange={e => { if (app.id === 'zentao') { setSwitchTo(c); setSwitchResult(''); setFailure('none'); return; } const checked = e.target.checked; setData(d => ({ ...d, bindings: { ...d.bindings, [project.id]: checked ? [...new Set([...(d.bindings[project.id] || []), c.id])] : (d.bindings[project.id] || []).filter(id => id !== c.id) } })); }} /><span><strong title={c.name}>{c.name}</strong><small>{c.account || '本地来源'} · {c.url || c.host || c.path}<br />{connectionReady(c) ? '连接可用 · 示例' : c.enabled ? '连接不可用；不会阻止Agent启动' : '连接已停用'}</small></span></label>)}</div> : <p className="m10-muted">尚未配置连接。{app.id === 'mail' ? '启用后仍可在Agent中准备草稿。' : 'Agent仍可正常启动，查询时提示未配置。'}</p>}
          {selected && !health && <p className="m10-muted">{app.id === 'mail' ? '读取／发送暂不可用，本地草稿可用。' : '禅道查询暂不可用，其他能力照常使用。'}</p>}
          <div className="m10-project-skills"><Zap size={14} /><span>{app.skills.map(s => s.name).join('、')}</span><small>随应用启用</small></div>
          <footer><button onClick={() => nav('apps/' + app.id)}>查看应用与连接<ChevronRight size={13} /></button><button className="m10-button secondary" disabled={!selected || project.archived} onClick={() => onUse(app.skills[0].prompt, project.id, app.id)}><SquareTerminal size={14} />在 WillYou 终端使用</button></footer>
        </div>
      </section>;
    })}
    <div className="m10-project-session-note"><SquareTerminal size={17} /><div><strong>新会话采用当前版本，恢复会话保留原版本</strong><p>连接和权限按当前配置检查；暂时不可用不影响 Agent 启动。应用升级不会将新版替换进旧会话。</p><span>首版目标：macOS arm64 · Claude Code / Codex · 仅 WillYou 内启动／恢复。这里是合成演示，实际CLI版本适配待验证。</span></div><button className="m10-button secondary" disabled={project.archived} onClick={onNewTask}>新建任务<ArrowUpRight size={13} /></button></div>
    <div className="m10-local-data"><Database size={15} /><span>连接、草稿和记录独立保存在本地；程序包升级继续读取原数据。</span></div>
    {switchTo && <ReviewDialog title="切换项目禅道连接" onClose={() => setSwitchTo(null)}><p className="m10-modal-copy">{chosenZenName(data, project.id)} → {switchTo.name}（{switchTo.account}）<br />仅影响 {project.name}。停止相关运行后提交切换，旧引用仍保留原来源。</p><div className="m10-switch-runs">{related.length ? related.map(t => <p key={t.id}>{t.title} · {t.status === 'running' ? '运行中，需停止' : '已停止'}</p>) : <p>没有需要停止的运行。</p>}</div><label className="m10-field"><span>演示结果</span><select value={failure} onChange={e => setFailure(e.target.value)}><option value="none">切换成功</option><option value="stop">停止失败</option><option value="commit">停止后切换失败</option></select></label>{switchResult && <p role="status">{switchResult}</p>}<footer><button className="m10-button secondary" onClick={() => setSwitchTo(null)}>取消</button><button className="m10-button primary" onClick={switchConnection}>{related.length ? '停止相关运行并切换 · 模拟' : '切换连接 · 模拟'}</button></footer></ReviewDialog>}
  </div>;
}
function chosenZenName(data, projectId) { return selectedConnections(data, projectId, 'zentao')[0]?.name || '未选定唯一连接'; }

export function SessionApplications({ task, integration, onUse, onNewTask, nav }) {
  const { data } = integration, current = projectPackages(data, task.project), snapshot = task.integrationSnapshot;
  const apps = APP_DEFINITIONS.filter(a => current.some(p => p.id === a.id) || snapshot?.packages?.some(p => p.id === a.id));
  const supported = ['claude','codex'].includes(task.runner || 'claude');
  return <div className="m10-session-apps">
    <p className="section-description">固定版本与当前使用条件分别展示。应用不可用时，Agent继续工作。</p>
    {!snapshot && <p className="m10-note">历史能力未知：不自动补入当前应用。可继续原任务，或使用当前应用新建会话。</p>}
    {!apps.length && <p className="m10-note">本会话未选用应用。</p>}
    {apps.map(app => { const fixed = snapshot?.packages?.find(a => a.id === app.id), status = sessionApplicationState(snapshot, data, task.project, app.id); const original = fixed?.connections?.map(c => c.id).join(', '), now = selectedConnections(data, task.project, app.id).map(c => c.id).join(', '); return <section className="m10-session-app" key={app.id}><header><ApplicationMark app={app.id} /><div><strong>{app.name}<span className="m10-package-version">{fixed ? '会话固定 v' + fixed.version : '本会话未选用'}</span></strong><small>新会话默认 v{packageVersion(data, app.id)} · {status.label}</small></div><span className="m10-state">{supported ? '准备状态 · 模拟' : '此Agent应用适配未支持'}</span></header>{fixed && <><p>{fixed.skills.length} 个 Skill · {fixed.tools.length} 个工具<br />文件准备：模拟已准备 · Agent发现：未验证 · 实际调用：未验证</p>{app.id === 'zentao' && original !== now && <p className="m10-note">当前连接已变化：{original || '未选用'} → {now || '未选用'}。恢复时核对旧包兼容性；历史对象仍属原来源。</p>}{app.skills.map(skill => <button key={skill.id} className="m10-example" disabled={!supported || task.status !== 'running'} onClick={() => onUse(skill.prompt)}><span>“{skill.prompt}”</span><ArrowUpRight size={13} /></button>)}</>}</section>; })}
    <div className="m10-session-footer"><button className="button secondary" onClick={() => nav('project/' + task.project + '/apps')}>项目应用</button><button className="button primary" onClick={onNewTask}>使用当前版本新建会话</button></div>
    <p className="m10-muted">恢复时继续引用原包，不同步替换新版。用户自行安装的 Skill / MCP 保持原配置。示例只插入输入，不自动发送；真实加载与隔离仍需CLI验证。</p>
  </div>;
}

export function PackageUpgradePreview({ data, setData, tasks = [] }) {
  const [result, setResult] = useState(null), [phase, setPhase] = useState('idle'), [simulateOccupied, setSimulateOccupied] = useState(false);
  const activeRuns = useRef(tasks); activeRuns.current = simulateOccupied ? [...tasks, { id: 'shared-root-demo', title: '共享Skill目录使用中 · 合成运行', runner: 'codex', status: 'running' }] : tasks;
  const blocked = upgradeBlockers(activeRuns.current);
  const timer = useRef(null); useEffect(() => () => clearTimeout(timer.current), []);
  const upgraded = APP_DEFINITIONS.every(a => packageVersion(data, a.id) === '1.1.0');
  const run = fail => { if (blocked.length) { setResult(simulatePackageUpgrade(data, fail, activeRuns.current)); return; } setPhase('preparing'); setResult(null); timer.current = setTimeout(() => { setData(current => { const upgrade = simulatePackageUpgrade(current, fail, activeRuns.current); setResult(upgrade); return upgrade.state; }); setPhase('idle'); }, 450); };
  return <div className="m10-upgrade-preview"><p className="m10-modal-copy">模拟新版包完整准备、校验后切换默认版本。旧会话引用原版本，未打开的历史会话也保留引用。仅合成状态，不更新程序或真实SQLite。</p><label className="m10-check"><input type="checkbox" checked={simulateOccupied} onChange={e => setSimulateOccupied(e.target.checked)} />模拟共享Skill目录仍有运行占用</label>{blocked.length > 0 && <p className="m10-note">等待以下运行释放共享目录：{blocked.map(t => t.title || t.id).join('、')}。可保留此状态；解除模拟占用后再执行升级。</p>}{phase === 'preparing' && <p className="m10-note" role="status">正在准备和校验…新会话暂沿用原默认版本。</p>}<div className="m10-upgrade-versions">{APP_DEFINITIONS.map(app => <div key={app.id}><ApplicationMark app={app.id} /><strong>{app.name}</strong><span>新会话默认 v{packageVersion(data, app.id)}</span></div>)}</div><div className="m10-version-list">{APP_DEFINITIONS.flatMap(app => (data.installedVersions?.[app.id] || ['1.0.0']).map(version => { const retained = packageRetention(data, tasks, app.id, version); return <div key={app.id + version}><strong>{app.name} v{version}</strong><span>{retained.references.length}个会话引用 · {retained.running}个运行中</span><small>{retained.reasons.join('；') || '无引用，可进入清理检查'} · 大小未测量</small><button className="m10-button secondary" disabled={!retained.cleanable || phase !== 'idle'} onClick={() => { setResult({ ok: true, message: '模拟清理二次核对：无引用时才删除。此预览保留文件；真实租约与崩溃恢复待工程验证。' }); }}>演示清理检查</button></div>; }))}</div><div className="m10-data-retention">{[['连接配置', data.connections.length], ['项目选用关系', Object.values(data.bindings).reduce((n, ids) => n + ids.length, 0)], ['草稿', data.drafts?.length || 0], ['调用记录', data.activity.length]].map(([label, count]) => <div key={label}><Check size={14} /><span>{label}</span><strong>{count} 项 · 保留</strong></div>)}</div><p className="m10-muted">共享Skill目录被运行占用时等待相关终端结束；不强制打断。中断后恢复检查未完成安装；不回退业务数据。</p>{result && <p className="m10-note" role="status">{result.message}</p>}<div className="m10-session-footer"><button className="button secondary" disabled={upgraded || phase !== 'idle'} onClick={() => run(true)}>模拟准备失败</button><button className="button primary" disabled={upgraded || phase !== 'idle'} onClick={() => run(false)}>{upgraded ? '已模拟升级' : '模拟升级并保留数据'}</button></div></div>;
}
