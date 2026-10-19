import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, ChevronRight, Database, Mail, Package, SquareTerminal, Zap } from 'lucide-react';
import { APP_DEFINITIONS, M10_STORAGE, initialIntegrationState, projectIntegrationState, packageVersion, connectionReady, projectPackages, snapshotCurrent, toggleProjectApplication, simulatePackageUpgrade } from './integration-model.mjs';
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
    <div className="m10-bundled-skills">{app.skills.map(skill => <article key={skill.id}><Zap size={16} /><div><strong>{skill.name}<span className="m10-inline-label">随应用启用</span></strong><p>{skill.description}</p><button className="m10-example" disabled={!enabled} onClick={() => onUse(skill.prompt)} title={!enabled ? '先在项目中选用可用连接' : undefined}><span>“{skill.prompt}”</span><ArrowUpRight size={13} /></button></div></article>)}</div>
    <button className="m10-package-disclosure" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>查看工具与包内容<ChevronRight size={13} className={expanded ? 'expanded' : ''} /></button>
    {expanded && <div className="m10-package-contents"><p>包含应用界面、连接表单、适配器、工具／MCP、配套 Skill、资源和数据迁移。</p>{app.capabilities.map(c => <div key={c.id}><Check size={13} /><span>{c.title}</span><small>{c.pending ? '待评审 · 当前不可调用' : c.effect === 'draft' ? '草稿准备 · 需发件连接' : '读取'}</small></div>)}<p>版本号为演示值；账号与业务数据保存在本地，独立于应用包。</p></div>}
  </section>;
}

export function ProjectApplications({ project, integration, nav, onUse, onNewTask, tasks = [] }) {
  const { data, setData, storageFailed } = integration;
  const bound = data.bindings[project.id] || [], ready = projectPackages(data, project.id);
  const sessions = tasks.filter(t => t.project === project.id && !t.archived && t.status === 'running');
  return <div className="m10-project-apps" aria-label={project.name + '的应用'}>
    <div className="m10-project-apps-intro"><div><h2>项目应用</h2><p>选用已连接的应用，工具与配套 Skill 一并提供给终端 Agent。</p></div><button className="m10-button secondary" onClick={() => nav('apps')}>管理应用<ArrowUpRight size={13} /></button></div>
    {storageFailed && <p className="m10-note" role="alert">演示存储不可用；刷新后可能无法恢复本次选用。</p>}
    {APP_DEFINITIONS.map(app => {
      const installed = data.installed.includes(app.id), connections = data.connections.filter(c => c.app === app.id);
      const selected = installed && connections.some(c => bound.includes(c.id)), available = ready.find(a => a.id === app.id);
      const usable = connections.some(connectionReady) && installed && !project.archived;
      return <section className="m10-project-application" key={app.id}>
        <header><ApplicationMark app={app.id} /><div><strong>{app.name}<span className="m10-package-version">v{packageVersion(data, app.id)}</span></strong><p>{app.skills.length} 个 Skill · 工具与连接一起使用</p></div><span className={'m10-state ' + (available ? 'ready' : '')}>{!installed ? '尚未添加' : selected ? available ? '项目已启用' : '连接不可用' : '未启用'}</span><button className={'m10-switch ' + (selected ? 'on' : '')} role="switch" aria-label={'为' + project.name + '启用' + app.name} aria-checked={selected} disabled={!selected && !usable || project.archived} onClick={() => setData(d => toggleProjectApplication(d, project.id, app.id, !selected))}><span /></button></header>
        <div className="m10-project-application-body">
          {connections.length ? <div className="m10-project-connections">{connections.map(c => <label key={c.id}><input type="checkbox" aria-label={'为' + project.id + '选用' + c.name} checked={bound.includes(c.id)} disabled={project.archived || !installed || !bound.includes(c.id) && !connectionReady(c)} onChange={e => { const checked = e.target.checked; setData(d => ({ ...d, bindings: { ...d.bindings, [project.id]: checked ? [...new Set([...(d.bindings[project.id] || []), c.id])] : (d.bindings[project.id] || []).filter(id => id !== c.id) } })); }} /><span><strong title={c.name}>{c.name}</strong><small>{c.kind === 'local' ? '本地邮件读取' : c.kind === 'smtp' ? '发件通道 · 发送规则待评审' : 'Bug 与研发需求读取'} · {connectionReady(c) ? '已连接' : '不可用'}</small></span></label>)}</div> : <p className="m10-muted">先配置{app.name}连接，再为项目启用。</p>}
          <div className="m10-project-skills"><Zap size={14} /><span>{app.skills.map(s => s.name).join('、')}</span><small>随应用启用</small></div>
          <footer><button onClick={() => nav('apps/' + app.id)}>查看应用与连接<ChevronRight size={13} /></button><button className="m10-button secondary" disabled={!available || project.archived} onClick={() => onUse(app.skills[0].prompt, project.id, app.id)}><SquareTerminal size={14} />在终端使用</button></footer>
        </div>
      </section>;
    })}
    <div className="m10-project-session-note"><SquareTerminal size={17} /><div><strong>项目启用后，在终端交代任务</strong><p>{sessions.length ? `${sessions.length} 个运行中会话 · 已加载情况可在终端的「会话应用」中查看。` : '新建任务时带入当前项目选用的应用。'} 配置有变化时，已有会话会提示待同步。</p><span>本页为合成演示，不运行真实 Agent。</span></div><button className="m10-button secondary" disabled={project.archived} onClick={onNewTask}>新建任务<ArrowUpRight size={13} /></button></div>
    <div className="m10-local-data"><Database size={15} /><span>连接、项目选用与历史记录保留在本地，应用升级后继续使用。</span></div>
  </div>;
}

export function SessionApplications({ task, integration, onLoad, onUse, nav }) {
  const { data } = integration, current = projectPackages(data, task.project), snapshot = task.integrationSnapshot;
  const currentIds = new Set(current.map(a => a.id));
  const apps = APP_DEFINITIONS.filter(a => currentIds.has(a.id) || snapshot?.packages.some(p => p.id === a.id));
  return <div className="m10-session-apps">
    <p className="section-description">项目选用与本次会话加载分别显示；这里的加载结果均为模拟。</p>
    {!apps.length && <p className="m10-note">当前项目没有选用应用，先到项目中启用。</p>}
    {apps.map(app => { const active = current.find(a => a.id === app.id), loaded = snapshot?.projectId === task.project && snapshot.packages.find(a => a.id === app.id); const matches = !!active && !!loaded && JSON.stringify(active) === JSON.stringify(loaded); return <section className="m10-session-app" key={app.id}><header><ApplicationMark app={app.id} /><div><strong>{app.name}<span className="m10-package-version">v{active?.version || loaded?.version}</span></strong><small>{!active ? '项目已停用或连接不可用 · 原加载已失效' : matches ? '本次会话已模拟加载' : loaded ? `原会话 v${loaded.version} · 待同步` : '项目已启用 · 本次会话待加载'}</small></div><span className={'m10-state ' + (matches ? 'ready' : '')}>{matches ? '已加载 · 模拟' : !active ? '已失效' : '待加载'}</span></header>{active && <><p>{app.skills.map(s => s.name).join(' · ')}<br />{active.tools.length} 个工具 · {active.connections.length} 个连接</p>{app.skills.map(s => <button key={s.id} className="m10-example" disabled={!matches || task.status !== 'running'} onClick={() => onUse(s.prompt)}><span>“{s.prompt}”</span><ArrowUpRight size={13} /></button>)}</>}</section>; })}
    <div className="m10-session-footer"><button className="button secondary" onClick={() => nav('project/' + task.project + '/apps')}>项目应用</button><button className="button primary" disabled={task.status !== 'running' || snapshotCurrent(snapshot, data, task.project)} onClick={onLoad}>演示加载当前应用</button></div>
    <p className="m10-muted">示例指令只插入终端输入，不自动发送。真实应用需核对 CLI 的加载结果。</p>
  </div>;
}

export function PackageUpgradePreview({ data, setData }) {
  const [result, setResult] = useState(null);
  const [before, setBefore] = useState(() => ({ packages: { ...data.packages }, dataSchema: data.dataSchema || 1 }));
  const upgraded = APP_DEFINITIONS.every(a => packageVersion(data, a.id) === '1.1.0');
  const resetDemo = () => { const packages = Object.fromEntries(APP_DEFINITIONS.map(a => [a.id, '1.0.0'])); setData(d => ({ ...d, packages, dataSchema: 1 })); setBefore({ packages, dataSchema: 1 }); setResult({ ok: true, message: '已重置演示版本；连接、项目选用和记录均保留。未执行真实数据库降级。' }); };
  const run = fail => { const upgrade = simulatePackageUpgrade(data, fail); if (upgrade.ok) setData(upgrade.state); setResult(upgrade); };
  return <div className="m10-upgrade-preview"><p className="m10-modal-copy">模拟安装新版 WillYou 后，应用包更新、原本地数据继续保留。仅操作合成演示状态，不更新程序或读写真实 SQLite。</p><div className="m10-upgrade-versions">{APP_DEFINITIONS.map(a => <div key={a.id}><ApplicationMark app={a.id} /><strong>{a.name}</strong><span>{packageVersion(before, a.id) === '1.1.0' ? '当前 v1.1.0' : 'v' + packageVersion(before, a.id) + ' → v1.1.0'}</span></div>)}</div><p className="m10-muted">演示数据结构版本 {before.dataSchema}{before.dataSchema === 2 ? ' · 已是示例新版' : ' → 2'} · 工具与配套 Skill 随包更新</p><div className="m10-data-retention">{[['连接配置', data.connections.length], ['项目选用关系', Object.values(data.bindings).reduce((n, ids) => n + ids.length, 0)], ['调用记录', data.activity.length]].map(([label, count]) => <div key={label}><Check size={14} /><span>{label}</span><strong>{count} 项 · 保留</strong></div>)}</div>{result && <p className={'m10-note ' + (result.ok ? 'ready' : '')} role="status">{result.message}</p>}<div className="m10-session-footer">{upgraded && <button className="button secondary" onClick={resetDemo}>重置演示版本</button>}<button className="button secondary" disabled={upgraded} onClick={() => run(true)}>模拟迁移失败</button><button className="button primary" disabled={upgraded} onClick={() => run(false)}>{upgraded ? '已模拟升级' : '模拟升级并保留数据'}</button></div></div>;
}
