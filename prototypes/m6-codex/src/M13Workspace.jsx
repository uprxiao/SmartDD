// M13 原型：插件目录／详情、技能（Skill 与 MCP 统一管理）。智能体页面在“设置 › 智能体”（M13AgentSettings.jsx）。入口 ?preview=m13 或 #m13/plugins。
// 视觉沿用 M10 已按 Codex 插件目录复刻的 m10-* 样式，M13 新增部分在 m13.css。全部为合成数据，只在本次页面内存中生效。
import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Download, FileText, ListTodo, Upload, Settings, Blocks, Bot, Check, ChevronDown, ChevronRight, CircleCheck, CircleDashed, Copy, ExternalLink, FileArchive, FolderOpen, Globe, Info, KeyRound, Mail, Moon, MoreHorizontal, Plus, Puzzle, RefreshCw, Search, Server, Sparkles, Star, Sun, Terminal, TriangleAlert, X } from 'lucide-react';
import { AGENTS, ATTENTION, BUILTIN_CAPS, CAPABILITIES, CLAUDE_TIERS, DISCOVERY_QUEUE, INITIAL_BINDINGS, INITIAL_DEFAULTS, MAIL_DRAFTS, SESSION_STATE, checkToolPath, defaultChangeImpact, deleteImpact, removedCapabilities, INSTALL_CANDIDATES, PLUGINS, PRESETS, PROTOCOL_LABEL, PROVIDERS, RUN_CONFIGS, STATE_LABEL, STATE_TONE, TOOLS, autoName, compatible, connectionSummary, connectionTypesOf, countBy, filterCapabilities, globalModelNotice, manage, manageAll, pluginSkillCaps, probe, rebuildTiers, runNotes, scopeLabel, tiersValid, unmanage, validateConnection, validateInstall, affectedSessions, sessionEffect, updateDiff, applyPluginUpdate, runningPluginUses } from './m13-model.mjs';
import { pluginAccent } from './m13-icons.jsx';
import { Btn, Dialog, Mark, Menu, Pill } from './m13-ui.jsx';
import { MailDrafts, ZentaoWork, ConnectionDefaultDialog, ConnectionDeleteDialog, BuiltinGroup } from './M13Pages.jsx';
import './m13.css';

export const SCENES = [['normal', '正常'], ['loading', '插件目录加载中'], ['plugin-crash', '禅道插件进程异常'], ['zentao-partial', '禅道列表第 2 页读取失败'], ['magpie-down', 'Magpie 未运行'], ['model-changed', 'Codex 全局模型被会话修改'], ['codex-unverified', 'Codex 版本未验证'], ['login-api', 'Claude Code 改用 API Key 登录'], ['claude-logout', 'Claude Code 已退出登录'], ['codex-login', 'Codex 已登录订阅'], ['codex-missing', '没有安装 Codex']];

/** M13 原型共享状态（审核 P01）：在 App 层创建，M13 各页、首页运行配置选择共用；只存内存，刷新页面后重置。 */
export function useM13State() {
  const [plugins, setPlugins] = useState(() => PLUGINS.map(p => ({ ...p, enabled: true })));
  const [retained, setRetained] = useState({}); // 卸载时选择“保留数据”的插件：连接与项目授权
  const [caps, setCaps] = useState(CAPABILITIES);
  const [autoManage, setAutoManage] = useState(false);
  const [providers, setProviders] = useState(PROVIDERS);
  const [configs, setConfigs] = useState(RUN_CONFIGS);
  const [defaults, setDefaults] = useState(INITIAL_DEFAULTS); // 每个插件每种连接类型的全局默认
  const [bindings, setBindings] = useState(INITIAL_BINDINGS); // 项目：关闭／跟随全局／个性化
  const [drafts, setDrafts] = useState(MAIL_DRAFTS);
  const [builtins, setBuiltins] = useState(BUILTIN_CAPS);
  const [tools, setTools] = useState(TOOLS);
  const [scene, setScene] = useState('normal'); // 演示场景：插件页与“设置 › 智能体”共用
  return { plugins, setPlugins, retained, setRetained, caps, setCaps, autoManage, setAutoManage, providers, setProviders, configs, setConfigs, defaults, setDefaults, bindings, setBindings, drafts, setDrafts, builtins, setBuiltins, tools, setTools, scene, setScene };
}

export function M13Workspace({ route, nav, projects, tasks = [], dark, onTheme, onTryPrompt, onInsertReference, store }) {
  const [, page = 'plugins', sub, sub2] = route.split('/');
  const { plugins, setPlugins, retained, setRetained, caps, setCaps, autoManage, setAutoManage, providers, setProviders, configs, setConfigs, defaults, setDefaults, bindings, setBindings, scene, setScene } = store;
  const SUBPAGES = { mail: ['drafts', '草稿', FileText], zentao: ['work', '我的工作', ListTodo] };
  const [modal, setModal] = useState(null);
  const [menu, setMenu] = useState(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const notify = text => { clearTimeout(toastTimer.current); setToast(text); toastTimer.current = setTimeout(() => setToast(''), 3200); };
  useEffect(() => { const close = e => { if (!e.target.closest?.('.m10-menu-wrap')) setMenu(null); }; document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close); }, []);
  const contentRef = useRef(null);
  useEffect(() => { setMenu(null); if (contentRef.current) contentRef.current.scrollTop = 0; }, [route]);
  const projectName = id => projects.find(p => p.id === id)?.name || id;
  // 受影响的运行中会话数（P0.10，需求补记 3 B3）与插件启停（全局）；各页共用同一套提示
  const affect = (kind, target) => affectedSessions(kind, target, tasks, bindings);
  const togglePlugin = p => { setPlugins(ps => ps.map(x => x.id === p.id ? { ...x, enabled: !x.enabled } : x)); notify(p.enabled ? `${p.name} 已停用：${sessionEffect('plugin-off', affect('plugin', p))}；连接与数据保留` : `${p.name} 已启用：${sessionEffect('plugin-on', affect('plugin', p))}`); };
  const close = () => setModal(null);
  /** 供应商一键搭配工具生成智能体；同一组合已存在时提示，不重复创建。 */

  return <div className="m10-shell m13-shell">
    <aside className="m10-sidebar">
      <div className="m10-sidebar-title"><h2>自定义</h2><Btn icon={Search} label="搜索插件" onClick={() => { nav('m13/plugins'); setTimeout(() => document.querySelector('[aria-label="搜索插件"].m13-search-input')?.focus(), 40); }} /></div>
      <button className={'m10-nav ' + (page === 'plugins' ? 'selected' : '')} onClick={() => nav('m13/plugins')}><Puzzle size={17} />插件</button>
      <button className={'m10-nav ' + (page === 'capabilities' ? 'selected' : '')} onClick={() => nav('m13/capabilities')}><Blocks size={17} />技能{countBy(caps, 'skill').new + countBy(caps, 'mcp').new > 0 && <span className="m13-nav-dot" aria-label="有新发现" />}</button>
      <div className="m10-sidebar-label">已安装</div>
      {plugins.map(p => <React.Fragment key={p.id}><button className={'m10-nav installed ' + (page === 'plugins' && sub === p.id && !sub2 ? 'selected ' : '') + (p.enabled ? '' : 'm13-disabled')} onClick={() => nav('m13/plugins/' + p.id)}><Mark id={p.id} name={p.name} size={16} /><span>{p.name}</span>{!p.enabled && <small className="m13-nav-note">已停用</small>}</button>
        {SUBPAGES[p.id] && page === 'plugins' && sub === p.id && (() => { const [k, t, Icon] = SUBPAGES[p.id]; return <button className={'m10-nav m13-nav-child ' + (sub2 === k ? 'selected ' : '') + (p.enabled ? '' : 'm13-disabled')} onClick={() => nav('m13/plugins/' + p.id + '/' + k)}><Icon size={16} />{t}</button>; })()}</React.Fragment>)}
      <div className="m10-sidebar-bottom"><img src="/assets/app-icon.png" alt="" /><span>WillYou</span><span className="m10-phase-tag">M13</span></div>
    </aside>
    <div className="m10-main">
      <div className="m10-previewbar m13-previewbar"><span>M13 原型 · 合成数据，不读取真实插件、CLI 配置或密钥；唯一例外是 SMG 供应商：经开发服务器真实请求，Key 只在页面内存</span><label>演示场景<select value={scene} onChange={e => setScene(e.target.value)}>{SCENES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label><Btn icon={dark ? Sun : Moon} label={dark ? '切换浅色主题' : '切换深色主题'} onClick={onTheme} /></div>
      {page === 'plugins' && sub && <div className="m13-detail-bar"><nav className="m13-crumb" aria-label="位置"><button onClick={() => nav('m13/plugins')}>插件</button><ChevronRight size={14} />{sub2 ? <><button onClick={() => nav('m13/plugins/' + sub)}>{plugins.find(p => p.id === sub)?.name}</button><ChevronRight size={14} /><span>{SUBPAGES[sub]?.[1]}</span></> : <span>{plugins.find(p => p.id === sub)?.name || '未找到'}</span>}</nav></div>}
      <div ref={contentRef} className={'m10-content m10-catalog-content m13-content' + (page === 'plugins' && sub ? ' detail' : '')}>
        {page === 'plugins' && !sub && <PluginCatalog {...{ plugins, scene, menu, setMenu, nav, setModal, togglePlugin, notify }} />}
        {page === 'plugins' && sub && !sub2 && <PluginDetail plugin={plugins.find(p => p.id === sub)} {...{ defaults, scene, menu, setMenu, nav, setModal, notify, projectName, onTryPrompt, togglePlugin, subpage: SUBPAGES[sub] }} />}
        {page === 'plugins' && sub === 'mail' && sub2 === 'drafts' && plugins.find(p => p.id === 'mail') && <MailDrafts plugin={plugins.find(p => p.id === 'mail')} {...{ store, projects, notify, nav, togglePlugin }} />}
        {page === 'plugins' && sub === 'zentao' && sub2 === 'work' && plugins.find(p => p.id === 'zentao') && <ZentaoWork plugin={plugins.find(p => p.id === 'zentao')} {...{ store, projects, tasks, scene, notify, nav, onTryPrompt, onInsertReference, togglePlugin }} />}
        {page === 'capabilities' && <Capabilities {...{ store, caps, setCaps, plugins, autoManage, setAutoManage, setModal, notify, projects, affect }} />}
      </div>
    </div>
    {modal?.type === 'install' && <InstallDialog source={modal.source} forPlugin={modal.forPlugin} plugins={plugins} affect={affect} onClose={close} onDone={(cand, kind) => {
      const kept = retained[cand.id];
      setPlugins(ps => kind === 'update' ? ps.map(p => p.id === cand.id ? applyPluginUpdate(p, cand) : p) /* P0.16（审核 N05）：新包元数据整体替换，本机状态保留 */ : [...ps, { ...(PLUGINS.find(x => x.id === cand.id) || {}), ...cand, mark: cand.id, builtin: false, enabled: true, source: { kind: cand.kind, path: cand.file }, description: (PLUGINS.find(x => x.id === cand.id)?.description) || cand.tagline + '。', examples: PLUGINS.find(x => x.id === cand.id)?.examples || [], projects: kept?.projects || [], connections: kept?.connections || [], dataDir: '~/Library/Application Support/SmartDD/plugins/' + cand.id }]);
      if (kept) { setRetained(r => { const n = { ...r }; delete n[cand.id]; return n; }); if (kept.defaults) setDefaults(d => ({ ...d, [cand.id]: kept.defaults })); if (kept.bindings) setBindings(b => ({ ...b, [cand.id]: kept.bindings })); }
      close(); const was = plugins.find(p => p.id === cand.id); notify(kind === 'update' ? (was.enabled ? `${cand.name} 已更新到 ${cand.version}：正在执行的调用按旧版完成，之后${sessionEffect('plugin-update', affect('plugin', was))}` : `${cand.name} 已更新到 ${cand.version}，仍为停用状态`) : kept ? `${cand.name} 已安装，已恢复保留的 ${kept.connections.length} 个连接、全局默认与项目设置` : `${cand.name} 已安装`); nav('m13/plugins/' + cand.id); }} />}
    {modal?.type === 'uninstall' && <UninstallDialog plugin={modal.plugin} onClose={close} onDone={keep => { const pl = modal.plugin; setRetained(r => { const n = { ...r }; if (keep) n[pl.id] = { connections: pl.connections || [], projects: pl.projects || [], defaults: defaults[pl.id], bindings: bindings[pl.id] }; else delete n[pl.id]; return n; }); setDefaults(d => { const n = { ...d }; delete n[pl.id]; return n; }); setBindings(b => { const n = { ...b }; delete n[pl.id]; return n; }); setPlugins(ps => ps.filter(p => p.id !== pl.id)); close(); notify(`${pl.name} 已卸载${pl.enabled ? '：' + sessionEffect('plugin-remove', affect('plugin', pl)) : ''}；${keep ? '连接、全局默认与项目设置已保留，重新安装后恢复' : '私有数据、连接、密钥与项目设置已删除'}`); nav('m13/plugins'); }} />}
    {modal?.type === 'connection' && <ConnectionDialog plugin={plugins.find(p => p.id === modal.pluginId)} connection={modal.connection} type={modal.connType} onClose={close} onSave={conn => { setPlugins(ps => ps.map(p => p.id !== modal.pluginId ? p : { ...p, connections: p.connections.some(c => c.id === conn.id) ? p.connections.map(c => c.id === conn.id ? conn : c) : [...p.connections, conn] })); const first = !plugins.find(p => p.id === modal.pluginId).connections.some(c => c.type === conn.type); if (first) setDefaults(d => ({ ...d, [modal.pluginId]: { ...(d[modal.pluginId] || {}), [conn.type]: conn.id } })); close(); notify(`连接“${conn.name}”已保存${first ? '，并设为全局默认' : ''}（原型不保存密码或 Token 原文）`); }} />}
    {modal?.type === 'conn-default' && (() => { const pl = plugins.find(p => p.id === modal.pluginId); const to = pl.connections.find(c => c.id === modal.connId); const from = pl.connections.find(c => c.id === defaults[pl.id]?.[to.type]); return <ConnectionDefaultDialog plugin={pl} from={from} to={to} impact={defaultChangeImpact(pl, bindings, projects, to.type)} onClose={close} onConfirm={() => { setDefaults(d => ({ ...d, [pl.id]: { ...(d[pl.id] || {}), [to.type]: to.id } })); close(); notify(`全局默认已改为“${to.name}”，跟随全局的项目已同步`); }} />; })()}
    {modal?.type === 'conn-delete' && (() => { const pl = plugins.find(p => p.id === modal.pluginId); const conn = pl.connections.find(c => c.id === modal.connId); return <ConnectionDeleteDialog plugin={pl} conn={conn} impact={deleteImpact(pl, defaults, bindings, projects, conn, runningPluginUses(tasks))} onClose={close} onConfirm={nextDefault => {
      setPlugins(ps => ps.map(p => p.id !== pl.id ? p : { ...p, connections: p.connections.filter(c => c.id !== conn.id) }));
      setDefaults(d => { const cur = { ...(d[pl.id] || {}) }; if (cur[conn.type] === conn.id) { if (nextDefault) cur[conn.type] = nextDefault; else delete cur[conn.type]; } return { ...d, [pl.id]: cur }; });
      setBindings(b => ({ ...b, [pl.id]: Object.fromEntries(Object.entries(b[pl.id] || {}).map(([pid, v]) => [pid, v[conn.type]?.connectionId === conn.id ? { ...v, [conn.type]: { mode: 'follow' } } : v])) }));
      close(); notify(`连接“${conn.name}”已删除`); }} />; })()}
    {modal?.type === 'capability' && <CapabilityDialog item={caps.find(c => c.id === modal.id)} projects={projects} affect={affect} onClose={close} onChange={next => setCaps(cs => cs.map(c => c.id === next.id ? next : c))} notify={notify} />}
    {toast && <div className="m10-toast m13-toast" role="status">{toast}</div>}
  </div>;
}

// ============ 插件目录 ============
function PluginCatalog({ plugins, scene, menu, setMenu, nav, setModal, togglePlugin, notify }) { // P0.16（审核 N09）：刷新按钮需要 notify
  const [query, setQuery] = useState(''), [tab, setTab] = useState('all'), [addOpen, setAddOpen] = useState(false), [refreshing, setRefreshing] = useState(false);
  const match = p => (p.name + (p.tagline || '')).toLowerCase().includes(query.trim().toLowerCase()) && (tab === 'all' || (tab === 'enabled' ? p.enabled : !p.enabled));
  const groups = [['内置', plugins.filter(p => p.builtin && match(p))], ['外部插件', plugins.filter(p => !p.builtin && match(p))]];
  const toggle = p => { setMenu(null); togglePlugin(p); };
  return <>
    <div className="m10-page-head"><div><h1>插件</h1><p>安装插件，让 Agent 在你的业务系统中协同工作。新增插件不需要重装 WillYou。</p></div>
      <div className="m10-head-actions"><label className="m10-search"><Search size={15} /><input className="m13-search-input" aria-label="搜索插件" placeholder="搜索插件" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <Btn icon={RefreshCw} label="重新读取插件" className={'m10-icon' + (refreshing ? ' m13-spin' : '')} onClick={() => { setRefreshing(true); setTimeout(() => { setRefreshing(false); notify('插件状态已刷新'); }, 700); }} />
        <div className="m10-menu-wrap"><button className="m10-button primary m13-add" aria-expanded={addOpen} onClick={() => setAddOpen(!addOpen)} onBlur={e => { if (!e.currentTarget.parentElement.contains(e.relatedTarget)) setAddOpen(false); }}>添加<ChevronDown size={16} /></button>
          {addOpen && <div className="m10-menu" role="menu"><button role="menuitem" onClick={() => { setAddOpen(false); setModal({ type: 'install', source: 'dir' }); }}><FolderOpen size={15} />从本地文件夹安装…</button><button role="menuitem" onClick={() => { setAddOpen(false); setModal({ type: 'install', source: 'zip' }); }}><FileArchive size={15} />从 .zip 文件安装…</button></div>}</div></div></div>
    <div className="m10-tabs" role="tablist">{[['all', '全部'], ['enabled', '已启用'], ['disabled', '已停用']].map(([v, t]) => <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)}>{t}</button>)}</div>
    {scene === 'loading' ? <div className="m13-skeleton" aria-busy="true" aria-label="正在读取插件">{[0, 1, 2, 3].map(i => <div key={i}><span /><div><i /><i /></div></div>)}</div> : <>
      {groups.map(([title, list]) => list.length > 0 && <section key={title} className="m13-group"><h2 className="m10-section-title">{title}<ChevronRight size={14} /></h2><div className="m10-catalog-grid">{list.map(p => <div className="m10-catalog-item" key={p.id}>
        <button className="m10-catalog-open" onClick={() => nav('m13/plugins/' + p.id)}><Mark id={p.id} name={p.name} /><span><strong title={p.name}>{p.name}</strong><small>{!p.enabled ? '已停用 · ' : scene === 'plugin-crash' && p.id === 'zentao' ? '进程异常 · ' : ''}{p.tagline}</small></span></button>
        <Menu open={menu === 'cat-' + p.id} onToggle={() => setMenu(menu === 'cat-' + p.id ? null : 'cat-' + p.id)} label={p.name + ' 更多操作'} items={[['查看详情', () => nav('m13/plugins/' + p.id)], [p.enabled ? '停用' : '启用', () => toggle(p)], !p.builtin && ['更新…', () => { setMenu(null); setModal({ type: 'install', forPlugin: p }); }], !p.builtin && ['卸载…', () => { setMenu(null); setModal({ type: 'uninstall', plugin: p }); }, true]]} />
      </div>)}</div></section>)}
      {groups.every(([, l]) => !l.length) && <div className="m13-empty"><Search size={20} /><h3>没有匹配的插件</h3><p>试试其他关键词，或切换到“全部”。</p></div>}
    </>}
  </>;
}

// ============ 插件详情 ============
function PluginDetail({ plugin: p, defaults, scene, menu, setMenu, nav, setModal, notify, projectName, onTryPrompt, togglePlugin, subpage }) {
  if (!p) return <div className="m13-empty"><Info size={20} /><h3>插件不存在或已卸载</h3><button className="m10-button secondary" onClick={() => nav('m13/plugins')}>返回插件</button></div>;
  const crashed = scene === 'plugin-crash' && p.id === 'zentao';
  const toggle = () => { setMenu(null); togglePlugin(p); };
  const kinds = [...new Set(p.capabilities.map(c => c.kind))];
  return <div className="m13-detail">
    <div className="m13-detail-head"><Mark id={p.id} name={p.name} large /><div className="m13-detail-title"><h1>{p.name}{p.builtin && <Pill>内置</Pill>}</h1><p><span className={'m13-state ' + (p.enabled ? 'on' : 'off')}>{p.enabled ? '已启用' : '已停用'}</span> · 版本 {p.version} · 由 {p.publisher} 发布</p></div>
      <div className="m13-detail-actions"><Menu open={menu === 'detail'} onToggle={() => setMenu(menu === 'detail' ? null : 'detail')} label="插件更多操作" items={[[p.enabled ? '停用' : '启用', toggle], !p.builtin && ['更新…', () => { setMenu(null); setModal({ type: 'install', forPlugin: p }); }], !p.builtin && ['卸载…', () => { setMenu(null); setModal({ type: 'uninstall', plugin: p }); }, true]]} />
        {subpage && (() => { const [k, t, Icon] = subpage; return <button className="m10-button secondary" disabled={!p.enabled} title={p.enabled ? '' : '插件已停用'} onClick={() => nav('m13/plugins/' + p.id + '/' + k)}><Icon size={15} />{t}</button>; })()}
        {connectionTypesOf(p).length > 0 && <button className="m10-button secondary" onClick={() => document.getElementById('m13-connections')?.scrollIntoView({ block: 'start' })}><Settings size={15} />管理</button>}
        {p.enabled ? <button className="m10-button primary m13-try" disabled={crashed || !p.examples?.length} onClick={() => onTryPrompt(p.examples[0])}><Sparkles size={15} />立即试用</button>
          : <button className="m10-button primary m13-try" onClick={toggle}>启用</button>}</div></div>
    {!p.enabled && <div className="m13-alert warn"><Info size={16} /><div><strong>已停用</strong><p>运行中的会话不能再调用它，新建或恢复的会话不再加载它的工具与 Skill；连接、项目设置都保留。</p></div></div>}
    {crashed && <div className="m13-alert danger"><TriangleAlert size={16} /><div><strong>插件进程异常退出</strong><p>1 分钟内连续退出 3 次，WillYou 已暂停调用它，不影响其他插件和正在运行的终端。</p></div><button className="m10-button secondary" onClick={() => notify('已重新启动插件进程（演示）')}>重新启动</button></div>}
    {p.examples?.length > 0 && <div className="m13-hero">{p.examples.map(ex => <button key={ex} className="m13-example" disabled={!p.enabled || crashed} onClick={() => onTryPrompt(ex)}><Mark id={p.id} name={p.name} size={14} /><span><b style={{ color: pluginAccent(p.id) }}>{p.name}</b> {ex}</span><ArrowRight size={16} /></button>)}</div>}
    <p className="m13-desc">{p.description}</p>
    <section className="m13-section"><h2>能力 <span>{p.capabilities.length}</span></h2>{p.capabilities.map(c => <div key={c.name} className="m13-row"><span className="m13-rowicon"><Terminal size={18} /></span><span>{c.name}<small>{c.kind === '写入' ? '会改变页面或外部系统的状态' : '只读取，不改变页面或外部系统'}</small></span><Pill tone={c.kind === '写入' ? 'warn' : 'muted'}>{c.kind}</Pill></div>)}{p.capabilities.some(c => c.kind === '写入') && <p className="m13-hint">读写分类以插件声明为准，写入类能力按 WillYou 的审批规则执行。</p>}</section>
    {p.skills?.length > 0 && <section className="m13-section"><h2>Skill <span>{p.skills.length}</span></h2>{p.skills.map(s => <div key={s} className="m13-row"><span className="m13-rowicon"><Sparkles size={18} /></span><span>{s}<small>随插件安装、更新和卸载</small></span></div>)}</section>}
    {connectionTypesOf(p).length > 0 && <section className="m13-section" id="m13-connections"><h2>连接 <span>{p.connections.length}</span></h2>
      {connectionTypesOf(p).map(def => { const list = p.connections.filter(c => c.type === def.type); return <div key={def.type} className="m13-conn-group">
        {connectionTypesOf(p).length > 1 && <h3 className="m13-sub">{def.label}</h3>}
        {list.map(c => { const isDefault = defaults[p.id]?.[def.type] === c.id; return <div key={c.id} className="m13-row"><span className="m13-rowicon"><KeyRound size={18} /></span><span>{c.name}<small>{connectionSummary(p, c)}</small></span>{isDefault && <Pill tone="ok"><Star size={11} />全局默认</Pill>}
          <Menu open={menu === 'conn-' + c.id} onToggle={() => setMenu(menu === 'conn-' + c.id ? null : 'conn-' + c.id)} label={c.name + ' 更多操作'} items={[['编辑', () => { setMenu(null); setModal({ type: 'connection', pluginId: p.id, connection: c, connType: def.type }); }], !isDefault && ['设为全局默认', () => { setMenu(null); setModal({ type: 'conn-default', pluginId: p.id, connId: c.id }); }], ['删除…', () => { setMenu(null); setModal({ type: 'conn-delete', pluginId: p.id, connId: c.id }); }, true]]} /></div>; })}
        {!list.length && <p className="m13-hint">还没有{def.label}。添加的第一个会自动成为全局默认，所有项目默认使用它。</p>}
        {list.length > 1 && <p className="m13-hint">所有项目默认使用全局默认；个别项目可在项目的“插件”分区单独选择。</p>}
        <button className="m13-link m13-add-conn" onClick={() => setModal({ type: 'connection', pluginId: p.id, connType: def.type })}><Plus size={13} />添加{def.label}</button>
      </div>; })}</section>}
    <section className="m13-section"><h2>在项目中使用</h2><p className="m13-hint m13-plain">插件装好后所有项目默认可用。要在某个项目关闭它，或为某个项目单独选择连接，请到该项目的“插件”分区。</p></section>
    <section className="m13-section"><h2>信息</h2><dl className="m13-info">
      <dt>功能</dt><dd>{kinds.join('、')}</dd><dt>开发者</dt><dd>{p.publisher}</dd>{p.category && <><dt>类别</dt><dd>{p.category}</dd></>}<dt>版本</dt><dd>{p.version}</dd>
      <dt>来源</dt><dd>{p.builtin ? '内置，随 WillYou 升级，可停用、不可卸载' : <code>{p.source?.path}</code>}</dd>
      {p.hostApi && <><dt>插件接口</dt><dd>{p.hostApi}</dd></>}
      {p.permissions && <><dt>权限</dt><dd><ul>{p.permissions.map(x => <li key={x}>{x}</li>)}</ul><span className="m13-hint">在独立进程中运行，不能读写 WillYou 数据目录与密钥。</span></dd></>}
      {p.dataDir && <><dt>数据目录</dt><dd><code>{p.dataDir}</code></dd></>}
      {p.migratedFrom && <><dt>迁移</dt><dd>{p.migratedFrom}</dd></>}
    </dl></section>
  </div>;
}

function InstallDialog({ source, forPlugin, plugins, affect, onClose, onDone }) {
  // P0.8（需求补记 3）：“添加”进入安装页，插件“更新…”进入更新页；从“添加”选到已安装插件的新版本时自动切到更新页。
  const list = forPlugin ? INSTALL_CANDIDATES : INSTALL_CANDIDATES.filter(c => c.kind === source);
  const [pick, setPick] = useState(null), [checked, setChecked] = useState(null);
  const cand = list.find(c => c.file === pick);
  const res = checked && cand ? validateInstall(cand, plugins, forPlugin) : null;
  const diff = res?.kind === 'update' ? updateDiff(res.existing, cand) : null;
  const title = res?.ok ? (res.kind === 'update' ? `更新 ${cand.name}` : `安装 ${cand.name}`) : forPlugin ? `更新 ${forPlugin.name}` : source === 'zip' ? '从 .zip 文件安装' : '从本地文件夹安装';
  const sub = res?.ok ? (res.kind === 'update' ? '只列出与当前版本相比的变化' : '安装前请确认它能做什么、会获得哪些权限') : forPlugin ? `选择${forPlugin.name}更高版本的插件文件夹或 .zip（原型列出合成示例，不打开系统文件选择器）` : '原型不会打开系统文件选择器，请从下列合成示例中选择';
  const row = (icon, text, tone) => <li key={text} className={tone || ''}>{icon}{text}</li>;
  return <Dialog title={title} sub={sub} onClose={onClose} wide
    footer={!res ? <><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary" disabled={!cand} onClick={() => setChecked(true)}>检查插件</button></> : res.ok ? <><button className="m10-button secondary" onClick={() => setChecked(null)}>返回</button><button className="m10-button primary" onClick={() => onDone(cand, res.kind)}>{res.kind === 'update' ? '更新' : '安装'}</button></> : <><button className="m10-button secondary" onClick={() => setChecked(null)}>重新选择</button><button className="m10-button primary" onClick={onClose}>关闭</button></>}>
    {!res && <div className="m13-radios" role="radiogroup">{list.map(c => <label key={c.file} className={'m13-radio' + (pick === c.file ? ' selected' : '')}><input type="radio" name="m13-pkg" checked={pick === c.file} onChange={() => setPick(c.file)} />{c.kind === 'zip' ? <FileArchive size={16} /> : <FolderOpen size={16} />}<span><b>{c.file}</b><small>{c.broken ? '结构异常的示例包' : `${c.name} ${c.version} · ${c.tagline}`}</small></span></label>)}</div>}
    {res && !res.ok && <div className="m13-alert danger"><TriangleAlert size={16} /><div><strong>{res.kind === 'same' ? '无需更新' : res.kind === 'downgrade' ? '不能安装更低的版本' : res.kind === 'mismatch' ? '插件包不匹配' : '无法安装'}</strong><ul>{res.errors.map(e => <li key={e}>{e}</li>)}</ul><p>未做任何改动。</p></div></div>}
    {res?.ok && res.kind === 'install' && <div className="m13-install-review">
      <div className="m13-detail-head small"><Mark id={cand.id} name={cand.name} large /><div className="m13-detail-title"><h1>{cand.name}</h1><p>由 {cand.publisher} 发布 · 版本 {cand.version} · 插件接口 {cand.hostApi}</p></div></div>
      <p className="m13-desc">{PLUGINS.find(x => x.id === cand.id)?.description || cand.tagline + '。'}</p>
      {cand.capabilities.length > 0 && <><h3>能力</h3><ul className="m13-perms">{cand.capabilities.map(c => row(<Terminal size={14} />, `${c.name}（${c.kind}）`, 'cap'))}</ul></>}
      {cand.skills?.length > 0 && <><h3>自带 Skill</h3><ul className="m13-perms">{cand.skills.map(x => row(<Sparkles size={14} />, x, 'cap'))}</ul></>}
      <h3>它会获得的权限</h3><ul className="m13-perms">{cand.permissions.map(x => row(<Check size={14} />, x))}</ul>
      <div className="m13-alert info"><Info size={16} /><div><p>插件在独立进程中运行，不能读写 WillYou 数据目录与密钥；你电脑上的其他文件不在保护范围内，请只安装你信任来源的插件。</p></div></div>
    </div>}
    {res?.ok && res.kind === 'update' && <div className="m13-install-review">
      <div className="m13-detail-head small"><Mark id={cand.id} name={cand.name} large /><div className="m13-detail-title"><h1>{cand.name}</h1><p>由 {cand.publisher} 发布 · <b>{res.existing.version} → {cand.version}</b> · 插件接口 {cand.hostApi}</p></div></div>
      {!forPlugin && <div className="m13-alert info"><Info size={16} /><div><p>已安装{cand.name} {res.existing.version}，这个包是它的新版本，将按更新处理。</p></div></div>}
      {diff.broken.length > 0 && <div className="m13-alert warn"><TriangleAlert size={16} /><div><strong>新版本删除了能力</strong><p>{diff.broken.join('、')} 在新版本中不存在，也没有旧名称映射。老任务调用这些能力会失败。</p></div></div>}
      {diff.addedPerms.length > 0 && <div className="m13-alert warn"><TriangleAlert size={16} /><div><strong>新增权限，点“更新”即表示同意</strong><ul>{diff.addedPerms.map(x => <li key={x}>{x}</li>)}</ul></div></div>}
      {diff.empty ? <p className="m13-hint">能力、权限与 Skill 都没有变化。</p> : <>
        {(diff.addedCaps.length > 0 || diff.droppedCaps.length > 0) && <><h3>能力变化</h3><ul className="m13-perms m13-diff">{diff.addedCaps.map(x => row(<Plus size={14} />, '新增：' + x, 'add'))}{diff.droppedCaps.map(x => row(<X size={14} />, '删除：' + x, 'del'))}</ul></>}
        {(diff.addedSkills.length > 0 || diff.removedSkills.length > 0) && <><h3>Skill 变化</h3><ul className="m13-perms m13-diff">{diff.addedSkills.map(x => row(<Plus size={14} />, '新增：' + x, 'add'))}{diff.removedSkills.map(x => row(<X size={14} />, '删除：' + x, 'del'))}</ul></>}
        {diff.removedPerms.length > 0 && <><h3>不再需要的权限</h3><ul className="m13-perms m13-diff">{diff.removedPerms.map(x => row(<X size={14} />, x, 'del'))}</ul></>}
      </>}
      {!res.existing.enabled && <div className="m13-alert info"><Info size={16} /><div><p>{cand.name}当前已停用，更新后仍保持停用，启用后才会生效。新增权限在这里确认后，启用时不再询问。</p></div></div>}
      <p className="m13-hint">{res.existing.enabled ? `正在执行的调用按 ${res.existing.version} 完成，之后${sessionEffect('plugin-update', affect('plugin', res.existing))}；` : ''}旧版本随即删除。更新失败会自动回到 {res.existing.version}，连接与数据保留。不支持更新到更低的版本。</p>
    </div>}
  </Dialog>;
}
function UninstallDialog({ plugin, onClose, onDone }) {
  const [keep, setKeep] = useState(true);
  return <Dialog title={`卸载 ${plugin.name}`} onClose={onClose} footer={<><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary m13-danger-btn" onClick={() => onDone(keep)}>卸载</button></>}>
    <div className="m13-radios" role="radiogroup">
      <label className={'m13-radio' + (keep ? ' selected' : '')}><input type="radio" checked={keep} onChange={() => setKeep(true)} /><span><b>保留数据</b><small>保留私有数据目录、连接、全局默认与各项目的设置，重新安装后恢复。新版本有问题时，可以这样卸载后重新安装旧版本；旧版本可能读不了新版本写入的数据。</small></span></label>
      <label className={'m13-radio' + (!keep ? ' selected' : '')}><input type="radio" checked={!keep} onChange={() => setKeep(false)} /><span><b>删除数据</b><small>删除私有数据目录、连接、密钥与各项目的设置。项目授权和调用记录标记为“插件已卸载”，历史任务仍可查看记录，但不能再调用。</small></span></label>
    </div>
    <p className="m13-hint">正在执行的调用完成后，插件即不可再调用。</p>
  </Dialog>;
}
function ConnectionDialog({ plugin, connection, type, onClose, onSave }) {
  const def = connectionTypesOf(plugin).find(d => d.type === (connection?.type || type)) || connectionTypesOf(plugin)[0];
  const init = Object.fromEntries(def.fields.filter(f => f.kind !== 'secret').map(f => [f.key, connection?.values?.[f.key] ?? f.default ?? '']));
  const [name, setName] = useState(connection?.name || ''), [values, setValues] = useState(init), [tested, setTested] = useState(null), [errors, setErrors] = useState([]);
  const set = (k, v) => { setValues(o => ({ ...o, [k]: v })); setTested(null); };
  const all = { ...values };
  const check = () => { const e = [...(name.trim() ? [] : ['请填写名称']), ...validateConnection(def, all)]; setErrors(e); return !e.length; };
  return <Dialog title={(connection ? '编辑' : '添加') + def.label} sub={`${plugin.name} · 表单由插件声明，WillYou 渲染并加密保存密码与 Token`} onClose={onClose}
    footer={<><button className="m10-button secondary" onClick={() => { if (check()) setTested('ok'); }}>测试连接</button><button className="m10-button primary" onClick={() => { if (check()) onSave({ id: connection?.id || def.type + '-' + Math.random().toString(36).slice(2, 7), type: def.type, name: name.trim(), values: all, status: 'ok' }); }}>保存</button></>}>
    <label className="m13-field"><span>名称</span><input value={name} onChange={e => setName(e.target.value)} placeholder={'例如 公司' + plugin.name} /></label>
    {def.fields.map(f => f.kind === 'choice' ? <div key={f.key} className="m13-field"><span>{f.label}</span><div className="m13-seg">{f.options.map(([v, t]) => <button key={v} type="button" aria-pressed={values[f.key] === v} onClick={() => set(f.key, v)}>{t}</button>)}</div></div>
      : <label key={f.key} className="m13-field"><span>{f.kind === 'secret' && f.key === 'secret' && values.auth ? (values.auth === 'password' ? '密码' : 'Token') : f.label}</span><input type={f.kind === 'secret' ? 'password' : f.kind === 'number' ? 'number' : 'text'} value={f.kind === 'secret' ? undefined : values[f.key]} defaultValue={f.kind === 'secret' ? '' : undefined} placeholder={f.kind === 'secret' ? (connection ? '已保存，留空表示不修改' : '原型不保存输入的秘密值') : f.placeholder} onChange={f.kind === 'secret' ? () => setTested(null) : e => set(f.key, e.target.value)} /></label>)}
    {errors.length > 0 && <div className="m13-alert danger"><TriangleAlert size={16} /><div><ul>{errors.map(e => <li key={e}>{e}</li>)}</ul></div></div>}
    {tested && <p className="m13-ok"><CircleCheck size={15} />连接成功（演示）：{def.type === 'zentao' ? '可读取指派给我的 Bug 与研发需求' : def.type === 'source' ? '可读取本机 Foxmail 邮件' : '可登录 SMTP 服务器'}</p>}
  </Dialog>;
}

// ============ Skill 与 MCP ============
function TargetChip({ agent, t, short = false }) {
  if (!t) return null;
  const map = { source: ['来源', 'muted'], configured: ['已配置', 'ok'], onrun: ['运行时注入', 'ok'], pending: ['待纳管', 'info'], blocked: [short ? '不可用' : t.reason, 'warn'] };
  const [text, tone] = map[t.s];
  return <span className={'m13-target ' + tone} title={t.at || t.reason || ''}>{t.s === 'source' ? <CircleDashed size={12} /> : t.s === 'blocked' ? <TriangleAlert size={12} /> : t.s === 'pending' ? <CircleDashed size={12} /> : <Check size={12} />}<b>{AGENTS[agent]}</b>{text}</span>;
}
function Capabilities({ store, caps, setCaps, plugins, autoManage, setAutoManage, setModal, notify, projects, affect }) {
  const [type, setType] = useState('skill'), [filter, setFilter] = useState('all'), [query, setQuery] = useState(''), [scanning, setScanning] = useState(false);
  const all = [...caps, ...pluginSkillCaps(plugins)];
  const counts = countBy(all, type), totalNew = countBy(caps, 'skill').new + countBy(caps, 'mcp').new;
  const list = filterCapabilities(all, { type, filter, query });
  return <>
    <div className="m10-page-head"><div><h1>技能</h1><p>你在 Claude Code 或 Codex 中安装的 Skill、配置的 MCP，会被自动发现；纳管后同步配置给另一个工具，所有项目默认可用。安装与首次认证仍在来源 CLI 中完成。</p></div>
      <div className="m10-head-actions"><label className="m10-search"><Search size={15} /><input aria-label="搜索技能" placeholder="搜索" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <button className="m10-button secondary" disabled={scanning} onClick={() => { setScanning(true); setTimeout(() => {
          setScanning(false);
          const fresh = DISCOVERY_QUEUE.filter(d => !caps.some(c => c.id === d.id));
          if (!fresh.length) return notify('扫描完成：没有新发现；只读取了配置与目录，未启动任何 MCP 或脚本');
          const added = fresh.map(d => autoManage && d.state === 'new' ? manage(d) : d);
          setCaps(cs => [...cs, ...added]);
          const auto = added.filter(d => d.state === 'managed').map(d => d.name), stop = added.filter(d => d.state === 'conflict').map(d => d.name);
          notify(autoManage ? `发现 ${fresh.length} 项：已自动纳管 ${auto.join('、') || '无'}${stop.length ? `；${stop.join('、')} 同名冲突，等待你处理` : ''}` : `发现 ${fresh.length} 个新项，等待纳管`);
        }, 800); }}><RefreshCw size={14} className={scanning ? 'm13-spin' : ''} />{scanning ? '正在扫描…' : '重新扫描'}</button></div></div>
    <BuiltinGroup store={store} notify={notify} affect={affect} />
    <h2 className="m10-section-title m13-ext-title">从 CLI 发现</h2>
    {totalNew > 0 && <div className="m13-discover"><Sparkles size={18} /><div><strong>发现 {totalNew} 个新项</strong><p>纳管后会同步配置到另一个工具；同名冲突等需要处理的项不会被一起纳管。</p></div><button className="m10-button primary" onClick={() => { const r = manageAll(caps); setCaps(r.items); notify(`已纳管：${r.managed.join('、')}；${sessionEffect('cap-on', affect('manage', caps.filter(c => r.managed.includes(c.name))))}`); }}>一键纳管</button></div>}
    <div className="m13-toolbar"><div className="m10-tabs" role="tablist">{[['skill', 'Skill'], ['mcp', 'MCP']].map(([v, t]) => <button key={v} role="tab" aria-selected={type === v} onClick={() => setType(v)}>{t}<span className="m13-count">{countBy(all, v).all}</span></button>)}</div>
      <label className="m13-switch-row"><span>以后自动纳管</span><button role="switch" aria-checked={autoManage} className={'m13-switch' + (autoManage ? ' on' : '')} onClick={() => { setAutoManage(!autoManage); notify(autoManage ? '已关闭自动纳管' : '已开启：新发现项自动纳管，同名冲突仍会停下来让你选择'); }}><i /></button></label></div>
    <div className="m13-filters">{[['all', '全部', counts.all], ['new', '新发现', counts.new], ['managed', '已纳管', counts.managed], ['attention', '需处理', counts.attention]].map(([v, t, n]) => <button key={v} aria-pressed={filter === v} onClick={() => setFilter(v)}>{t}<span>{n}</span></button>)}</div>
    <div className="m13-cap-list">{list.map(c => <button key={c.id} className="m13-cap" onClick={() => c.state === 'plugin' ? notify(`${c.name} 随${c.pluginName}插件安装、更新和卸载，请在插件详情中管理`) : setModal({ type: 'capability', id: c.id })}>
      <span className="m13-cap-icon">{c.type === 'skill' ? <Sparkles size={16} /> : <Server size={16} />}</span>
      <span className="m13-cap-main"><b>{c.name}</b><small>{c.desc}</small><small className="m13-cap-scope">{scopeLabel(c, projects)}</small></span>
      <span className="m13-cap-targets">{['claude', 'codex'].map(a => <TargetChip key={a} agent={a} t={c.targets[a]} />)}{c.state === 'plugin' && <span className="m13-target muted">{c.path}</span>}</span>
      <Pill tone={STATE_TONE[c.state]}>{STATE_LABEL[c.state]}</Pill><ChevronRight size={15} className="m13-chev" />
    </button>)}{!list.length && <div className="m13-empty"><Blocks size={20} /><h3>{filter === 'attention' ? '没有需要处理的项' : '没有匹配的项'}</h3><p>{filter === 'new' ? '在 Claude Code 或 Codex 中安装后，任务结束或回到本页时会自动发现。' : '试试其他筛选或关键词。'}</p></div>}</div>
    <p className="m13-footnote"><Info size={14} />这里不提供安装 Skill 或添加 MCP 的入口。取消纳管只移除 WillYou 为另一个工具做的配置，不删除来源原件。</p>
  </>;
}
function CapabilityDialog({ item: c, projects, affect, onClose, onChange, notify }) {
  const [approval, setApproval] = useState(c.approval || 'source');
  const [resolve, setResolve] = useState('skip');
  const act = (next, msg) => { onChange(next); notify(msg); onClose(); };
  const footer = c.state === 'new' ? <><button className="m10-button secondary" onClick={onClose}>稍后</button><button className="m10-button primary" onClick={() => act(manage(c), `${c.name} 已纳管：${sessionEffect('cap-on', affect('manage', c))}`)}>纳管</button></>
    : c.state === 'managed' ? <><button className="m10-button secondary" onClick={() => act(unmanage(c), `已取消纳管 ${c.name}：${sessionEffect('cap-off', affect('manage', c))}；来源原件未改动`)}>取消纳管</button><button className="m10-button primary" onClick={() => { onChange({ ...c, approval }); notify('已保存'); onClose(); }}>完成</button></>
      : c.state === 'conflict' ? <><button className="m10-button secondary" onClick={onClose}>暂不处理</button><button className="m10-button primary" onClick={() => act({ ...c, state: 'managed', targets: { ...c.targets, codex: { s: 'blocked', reason: '已跳过（保留你的同名 Skill）' } } }, '已跳过 Codex，保留你的同名 Skill')}>确认</button></>
        : c.state === 'dangling' ? <button className="m10-button primary" onClick={() => act({ ...c, state: 'new', hidden: true }, '已清理失效链接')}>清理失效链接</button>
          : <button className="m10-button primary" onClick={onClose}>知道了</button>;
  return <Dialog title={c.name} sub={`${c.type === 'skill' ? 'Skill' : 'MCP'} · ${STATE_LABEL[c.state]}`} onClose={onClose} wide footer={footer}>
    <dl className="m13-info compact"><dt>来源</dt><dd>{scopeLabel(c, projects)}<code>{c.path}</code></dd>{c.transport && <><dt>传输</dt><dd>{c.transport}</dd></>}{c.env && <><dt>环境变量</dt><dd>{c.env.map(e => <div key={e}>{e}</div>)}<span className="m13-hint">只显示变量名，值在启动时注入，不写入配置文件。</span></dd></>}</dl>
    {(c.reason || c.conflict) && <div className="m13-alert warn"><TriangleAlert size={16} /><div><strong>{c.conflict ? '同名冲突' : c.reason}</strong><p>{c.conflict || c.fix}</p></div></div>}
    {Object.keys(c.targets).length > 0 && <><h3 className="m13-sub">各 Agent 的配置</h3><div className="m13-table targets" role="table"><div role="row" className="m13-th"><span>Agent</span><span>状态</span><span>位置／说明</span></div>{Object.entries(c.targets).map(([a, t]) => <div role="row" key={a}><span>{AGENTS[a]}</span><span><TargetChip agent={a} t={t} short /></span><span>{t.s === 'source' ? '来源，WillYou 不改动' : t.at || t.reason}</span></div>)}</div></>}
    {c.state === 'managed' && (() => { const ss = SESSION_STATE[c.id]; return <><h3 className="m13-sub">会话中的状态</h3><p className="m13-hint m13-plain">{ss ? <>运行中的任务：{ss.loaded} 个已加载{ss.pending ? `，${ss.pending} 个在纳管前启动、恢复后生效` : ''}{ss.verified ? '；已有实际调用成功' : '；尚未实际调用'}。</> : '当前没有运行中的任务；新任务启动时加载。'}配置成功不代表会话已加载或调用成功，三者分别显示。</p></>; })()}
    {c.scope === 'project' && <p className="m13-hint">项目级能力只在该项目的任务中生效，不会扩成全局，也不会出现在其他项目里。</p>}
    {c.type === 'skill' && c.targets.codex?.at?.includes('.agents') && c.scope === 'project' && <p className="m13-hint">写入项目目录的链接会记入 Git 的 info/exclude，只影响 Git 显示，不提供隔离。</p>}
    {c.type === 'mcp' && c.state === 'managed' && <><h3 className="m13-sub">工具审批</h3><div className="m13-radios" role="radiogroup">
      <label className={'m13-radio' + (approval === 'source' ? ' selected' : '')}><input type="radio" checked={approval === 'source'} onChange={() => setApproval('source')} /><span><b>沿用来源设置</b><small>来源未设置时，每次调用在终端询问。</small></span></label>
      <label className={'m13-radio' + (approval === 'auto' ? ' selected' : '')}><input type="radio" checked={approval === 'auto'} onChange={() => setApproval('auto')} /><span><b>自动批准</b><small>该 MCP 的工具调用不再询问。来源中已禁用的工具仍然禁用。</small></span></label></div></>}
    {c.state === 'conflict' && <><h3 className="m13-sub">如何处理</h3><div className="m13-radios" role="radiogroup"><label className="m13-radio selected"><input type="radio" checked={resolve === 'skip'} onChange={() => setResolve('skip')} /><span><b>跳过 Codex</b><small>保留你自己的同名 Skill，不覆盖、不改名。</small></span></label></div></>}
  </Dialog>;
}

// 智能体页面与弹窗见 M13CodeAgent.jsx，在设置中的外壳见 M13AgentSettings.jsx。
