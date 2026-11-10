// M13 原型：插件目录／详情、能力统一管理（Skill 与 MCP）、AI 配置。入口 ?preview=m13 或 #m13/plugins。
// 视觉沿用 M10 已按 Codex 插件目录复刻的 m10-* 样式，M13 新增部分在 m13.css。全部为合成数据，只在本次页面内存中生效。
import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Download, FileText, ListTodo, Upload, Settings, Blocks, Bot, Check, ChevronDown, ChevronRight, CircleCheck, CircleDashed, Copy, ExternalLink, FileArchive, FolderOpen, Globe, Info, KeyRound, Mail, Moon, MoreHorizontal, Plus, Puzzle, RefreshCw, Search, Server, Sparkles, Star, Sun, Terminal, TriangleAlert, X } from 'lucide-react';
import { AGENTS, ATTENTION, BUILTIN_CAPS, CAPABILITIES, CLAUDE_TIERS, DISCOVERY_QUEUE, INITIAL_BINDINGS, INITIAL_DEFAULTS, MAIL_DRAFTS, SESSION_STATE, checkToolPath, defaultChangeImpact, deleteImpact, removedCapabilities, INSTALL_CANDIDATES, PLUGINS, PRESETS, PROTOCOL_LABEL, PROVIDERS, RUN_CONFIGS, STATE_LABEL, STATE_TONE, TOOLS, autoName, compatible, connectionSummary, connectionTypesOf, countBy, filterCapabilities, globalModelNotice, manage, manageAll, pluginSkillCaps, probe, rebuildTiers, runNotes, scopeLabel, tiersValid, unmanage, validateConnection, validateInstall } from './m13-model.mjs';
import { pluginAccent } from './m13-icons.jsx';
import { Btn, Dialog, Mark, Menu, Pill } from './m13-ui.jsx';
import { MailDrafts, ZentaoWork, ConnectionDefaultDialog, ConnectionDeleteDialog, ExportDialog, ImportDialog, BuiltinGroup } from './M13Pages.jsx';
import './m13.css';

const SCENES = [['normal', '正常'], ['loading', '插件目录加载中'], ['plugin-crash', '禅道插件进程异常'], ['zentao-partial', '禅道列表第 2 页读取失败'], ['magpie-down', 'Magpie 未运行'], ['model-changed', 'Codex 全局模型被会话修改'], ['codex-unverified', 'Codex 版本未验证']];

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
  return { plugins, setPlugins, retained, setRetained, caps, setCaps, autoManage, setAutoManage, providers, setProviders, configs, setConfigs, defaults, setDefaults, bindings, setBindings, drafts, setDrafts, builtins, setBuiltins, tools, setTools };
}

export function M13Workspace({ route, nav, projects, tasks = [], dark, onTheme, onTryPrompt, store }) {
  const [, page = 'plugins', sub, sub2] = route.split('/');
  const { plugins, setPlugins, retained, setRetained, caps, setCaps, autoManage, setAutoManage, providers, setProviders, configs, setConfigs, defaults, setDefaults, bindings, setBindings } = store;
  const SUBPAGES = { mail: ['drafts', '草稿', FileText], zentao: ['work', '我的工作', ListTodo] };
  const [scene, setScene] = useState('normal');
  const [modal, setModal] = useState(null);
  const [menu, setMenu] = useState(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const notify = text => { clearTimeout(toastTimer.current); setToast(text); toastTimer.current = setTimeout(() => setToast(''), 3200); };
  useEffect(() => { const close = e => { if (!e.target.closest?.('.m10-menu-wrap')) setMenu(null); }; document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close); }, []);
  const contentRef = useRef(null);
  useEffect(() => { setMenu(null); if (contentRef.current) contentRef.current.scrollTop = 0; }, [route]);
  const projectName = id => projects.find(p => p.id === id)?.name || id;
  const close = () => setModal(null);

  return <div className="m10-shell m13-shell">
    <aside className="m10-sidebar">
      <div className="m10-sidebar-title"><h2>自定义</h2><Btn icon={Search} label="搜索插件" onClick={() => { nav('m13/plugins'); setTimeout(() => document.querySelector('[aria-label="搜索插件"].m13-search-input')?.focus(), 40); }} /></div>
      <button className={'m10-nav ' + (page === 'plugins' ? 'selected' : '')} onClick={() => nav('m13/plugins')}><Puzzle size={17} />插件</button>
      <button className={'m10-nav ' + (page === 'capabilities' ? 'selected' : '')} onClick={() => nav('m13/capabilities')}><Blocks size={17} />Skill 与 MCP{countBy(caps, 'skill').new + countBy(caps, 'mcp').new > 0 && <span className="m13-nav-dot" aria-label="有新发现" />}</button>
      <button className={'m10-nav ' + (page === 'ai' ? 'selected' : '')} onClick={() => nav('m13/ai')}><Bot size={17} />AI 配置</button>
      <div className="m10-sidebar-label">已安装</div>
      {plugins.map(p => <React.Fragment key={p.id}><button className={'m10-nav installed ' + (page === 'plugins' && sub === p.id && !sub2 ? 'selected ' : '') + (p.enabled ? '' : 'm13-disabled')} onClick={() => nav('m13/plugins/' + p.id)}><Mark id={p.id} name={p.name} size={16} /><span>{p.name}</span>{!p.enabled && <small className="m13-nav-note">已停用</small>}</button>
        {SUBPAGES[p.id] && page === 'plugins' && sub === p.id && (() => { const [k, t, Icon] = SUBPAGES[p.id]; return <button className={'m10-nav m13-nav-child ' + (sub2 === k ? 'selected' : '')} onClick={() => nav('m13/plugins/' + p.id + '/' + k)}><Icon size={16} />{t}</button>; })()}</React.Fragment>)}
      <div className="m10-sidebar-bottom"><img src="/assets/app-icon.png" alt="" /><span>WillYou</span><span className="m10-phase-tag">M13</span></div>
    </aside>
    <div className="m10-main">
      <div className="m10-previewbar m13-previewbar"><span>M13 原型 · 合成数据，不读取真实插件、CLI 配置或密钥</span><label>演示场景<select value={scene} onChange={e => setScene(e.target.value)}>{SCENES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label><Btn icon={dark ? Sun : Moon} label={dark ? '切换浅色主题' : '切换深色主题'} onClick={onTheme} /></div>
      {page === 'plugins' && sub && <div className="m13-detail-bar"><nav className="m13-crumb" aria-label="位置"><button onClick={() => nav('m13/plugins')}>插件</button><ChevronRight size={14} />{sub2 ? <><button onClick={() => nav('m13/plugins/' + sub)}>{plugins.find(p => p.id === sub)?.name}</button><ChevronRight size={14} /><span>{SUBPAGES[sub]?.[1]}</span></> : <span>{plugins.find(p => p.id === sub)?.name || '未找到'}</span>}</nav></div>}
      <div ref={contentRef} className={'m10-content m10-catalog-content m13-content' + (page === 'plugins' && sub ? ' detail' : '')}>
        {page === 'plugins' && !sub && <PluginCatalog {...{ plugins, setPlugins, scene, menu, setMenu, nav, setModal, notify }} />}
        {page === 'plugins' && sub && !sub2 && <PluginDetail plugin={plugins.find(p => p.id === sub)} {...{ setPlugins, defaults, scene, menu, setMenu, nav, setModal, notify, projectName, onTryPrompt, subpage: SUBPAGES[sub] }} />}
        {page === 'plugins' && sub === 'mail' && sub2 === 'drafts' && plugins.find(p => p.id === 'mail') && <MailDrafts plugin={plugins.find(p => p.id === 'mail')} {...{ store, projects, notify, nav }} />}
        {page === 'plugins' && sub === 'zentao' && sub2 === 'work' && plugins.find(p => p.id === 'zentao') && <ZentaoWork plugin={plugins.find(p => p.id === 'zentao')} {...{ store, projects, tasks, scene, notify, nav }} />}
        {page === 'capabilities' && <Capabilities {...{ store, caps, setCaps, plugins, autoManage, setAutoManage, setModal, notify, projects }} />}
        {page === 'ai' && <AiConfig tab={sub || 'configs'} {...{ store, nav, scene, providers, setProviders, configs, setConfigs, setModal, notify, menu, setMenu }} />}
      </div>
    </div>
    {modal?.type === 'install' && <InstallDialog source={modal.source} plugins={plugins} onClose={close} onDone={(cand, kind) => {
      const kept = retained[cand.id];
      setPlugins(ps => kind === 'update' ? ps.map(p => p.id === cand.id ? { ...p, version: cand.version, capabilities: cand.capabilities.length ? cand.capabilities : p.capabilities, skills: cand.skills.length ? cand.skills : p.skills } : p) : [...ps, { ...(PLUGINS.find(x => x.id === cand.id) || {}), ...cand, mark: cand.id, builtin: false, enabled: true, source: { kind: cand.kind, path: cand.file }, description: (PLUGINS.find(x => x.id === cand.id)?.description) || cand.tagline + '。', examples: PLUGINS.find(x => x.id === cand.id)?.examples || [], projects: kept?.projects || [], connections: kept?.connections || [], dataDir: '~/Library/Application Support/SmartDD/plugins/' + cand.id }]);
      if (kept) { setRetained(r => { const n = { ...r }; delete n[cand.id]; return n; }); if (kept.defaults) setDefaults(d => ({ ...d, [cand.id]: kept.defaults })); if (kept.bindings) setBindings(b => ({ ...b, [cand.id]: kept.bindings })); }
      close(); notify(kind === 'update' ? `${cand.name} 已更新到 ${cand.version}：正在执行的调用完成后，所有任务使用新版本` : kept ? `${cand.name} 已安装，已恢复保留的 ${kept.connections.length} 个连接、全局默认与项目设置` : `${cand.name} 已安装`); nav('m13/plugins/' + cand.id); }} />}
    {modal?.type === 'uninstall' && <UninstallDialog plugin={modal.plugin} onClose={close} onDone={keep => { const pl = modal.plugin; setRetained(r => { const n = { ...r }; if (keep) n[pl.id] = { connections: pl.connections || [], projects: pl.projects || [], defaults: defaults[pl.id], bindings: bindings[pl.id] }; else delete n[pl.id]; return n; }); setDefaults(d => { const n = { ...d }; delete n[pl.id]; return n; }); setBindings(b => { const n = { ...b }; delete n[pl.id]; return n; }); setPlugins(ps => ps.filter(p => p.id !== pl.id)); close(); notify(`${pl.name} 已卸载${keep ? '，连接、全局默认与项目设置已保留，重新安装后恢复' : '，私有数据、连接、密钥与项目设置已删除'}`); nav('m13/plugins'); }} />}
    {modal?.type === 'connection' && <ConnectionDialog plugin={plugins.find(p => p.id === modal.pluginId)} connection={modal.connection} type={modal.connType} onClose={close} onSave={conn => { setPlugins(ps => ps.map(p => p.id !== modal.pluginId ? p : { ...p, connections: p.connections.some(c => c.id === conn.id) ? p.connections.map(c => c.id === conn.id ? conn : c) : [...p.connections, conn] })); const first = !plugins.find(p => p.id === modal.pluginId).connections.some(c => c.type === conn.type); if (first) setDefaults(d => ({ ...d, [modal.pluginId]: { ...(d[modal.pluginId] || {}), [conn.type]: conn.id } })); close(); notify(`连接“${conn.name}”已保存${first ? '，并设为全局默认' : ''}（原型不保存密码或 Token 原文）`); }} />}
    {modal?.type === 'conn-default' && (() => { const pl = plugins.find(p => p.id === modal.pluginId); const to = pl.connections.find(c => c.id === modal.connId); const from = pl.connections.find(c => c.id === defaults[pl.id]?.[to.type]); return <ConnectionDefaultDialog plugin={pl} from={from} to={to} impact={defaultChangeImpact(pl, bindings, projects, to.type)} onClose={close} onConfirm={() => { setDefaults(d => ({ ...d, [pl.id]: { ...(d[pl.id] || {}), [to.type]: to.id } })); close(); notify(`全局默认已改为“${to.name}”，跟随全局的项目已同步`); }} />; })()}
    {modal?.type === 'conn-delete' && (() => { const pl = plugins.find(p => p.id === modal.pluginId); const conn = pl.connections.find(c => c.id === modal.connId); return <ConnectionDeleteDialog plugin={pl} conn={conn} impact={deleteImpact(pl, defaults, bindings, projects, conn)} onClose={close} onConfirm={nextDefault => {
      setPlugins(ps => ps.map(p => p.id !== pl.id ? p : { ...p, connections: p.connections.filter(c => c.id !== conn.id) }));
      setDefaults(d => { const cur = { ...(d[pl.id] || {}) }; if (cur[conn.type] === conn.id) { if (nextDefault) cur[conn.type] = nextDefault; else delete cur[conn.type]; } return { ...d, [pl.id]: cur }; });
      setBindings(b => ({ ...b, [pl.id]: Object.fromEntries(Object.entries(b[pl.id] || {}).map(([pid, v]) => [pid, v[conn.type]?.connectionId === conn.id ? { ...v, [conn.type]: { mode: 'follow' } } : v])) }));
      close(); notify(`连接“${conn.name}”已删除`); }} />; })()}
    {modal?.type === 'export' && <ExportDialog providers={providers} configs={configs} onClose={close} notify={notify} />}
    {modal?.type === 'import' && <ImportDialog providers={providers} configs={configs} onClose={close} onImport={pv => {
      const idMap = {}; const newProv = pv.providers.filter(p => !p.existsNative).map(p => { const id = providers.some(x => x.id === p.id) ? p.id + '-imp-' + Math.random().toString(36).slice(2, 5) : p.id; idMap[p.id] = id; return { ...p, id, name: p.finalName, key: p.needKey ? null : 'sk-•••• 已导入', needKey: p.needKey, refreshed: '导入', models: (p.models || []).map(m => ({ ...m, status: 'untested' })) }; });
      pv.providers.filter(p => p.existsNative).forEach(p => { idMap[p.id] = p.id; });
      setProviders(ps => [...ps, ...newProv]); setConfigs(cs => [...cs, ...pv.runConfigs.map(c => ({ ...c, id: 'rc-imp-' + Math.random().toString(36).slice(2, 7), name: c.finalName, provider: idMap[c.provider] ?? c.provider, default: false }))]);
      close(); notify(`已导入 ${pv.runConfigs.length} 个运行配置、${newProv.length} 个 Provider${newProv.some(p => p.needKey) ? '；有 Provider 需要填写 Key' : ''}`); }} />}
    {modal?.type === 'capability' && <CapabilityDialog item={caps.find(c => c.id === modal.id)} projects={projects} onClose={close} onChange={next => setCaps(cs => cs.map(c => c.id === next.id ? next : c))} notify={notify} />}
    {modal?.type === 'runconfig' && <RunConfigDialog initial={modal.config} providers={providers} configs={configs} scene={scene} onClose={close} onSave={rc => { setConfigs(cs => cs.some(c => c.id === rc.id) ? cs.map(c => c.id === rc.id ? rc : c) : [...cs, rc]); close(); notify('运行配置已保存'); }} />}
    {modal?.type === 'provider' && <ProviderDialog provider={providers.find(p => p.id === modal.id)} setProviders={setProviders} configs={configs} scene={scene} onClose={close} notify={notify} onRemove={() => { setProviders(ps => ps.filter(p => p.id !== modal.id)); setConfigs(cs => cs.map(c => c.provider === modal.id ? { ...c, provider: null, broken: true } : c)); close(); notify('Provider 已删除；引用它的运行配置需要改选'); }} />}
    {modal?.type === 'add-provider' && <AddProviderDialog providers={providers} scene={scene} onClose={close} onDone={(prov, gen) => { setProviders(ps => [...ps, prov]); setConfigs(cs => [...cs, ...gen]); close(); notify(`${prov.name} 已接入，生成 ${gen.length} 个运行配置`); nav('m13/ai/providers'); }} />}
    {modal?.type === 'tool-path' && <ToolPathDialog tool={modal.tool} onClose={close} onSave={path => { store.setTools(ts => ts.map(t => t.id === modal.tool.id ? { ...t, path } : t)); close(); notify('已检测：程序可启动，路径已保存（演示）'); }} />}
    {toast && <div className="m10-toast m13-toast" role="status">{toast}</div>}
  </div>;
}

// ============ 插件目录 ============
function PluginCatalog({ plugins, setPlugins, scene, menu, setMenu, nav, setModal, notify }) {
  const [query, setQuery] = useState(''), [tab, setTab] = useState('all'), [addOpen, setAddOpen] = useState(false), [refreshing, setRefreshing] = useState(false);
  const match = p => (p.name + (p.tagline || '')).toLowerCase().includes(query.trim().toLowerCase()) && (tab === 'all' || (tab === 'enabled' ? p.enabled : !p.enabled));
  const groups = [['内置', plugins.filter(p => p.builtin && match(p))], ['外部插件', plugins.filter(p => !p.builtin && match(p))]];
  const toggle = p => { setMenu(null); setPlugins(ps => ps.map(x => x.id === p.id ? { ...x, enabled: !x.enabled } : x)); notify(p.enabled ? `${p.name} 已停用：新任务不再加载其工具与 Skill，连接与数据保留` : `${p.name} 已启用`); };
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
        <Menu open={menu === 'cat-' + p.id} onToggle={() => setMenu(menu === 'cat-' + p.id ? null : 'cat-' + p.id)} label={p.name + ' 更多操作'} items={[['查看详情', () => nav('m13/plugins/' + p.id)], [p.enabled ? '停用' : '启用', () => toggle(p)], !p.builtin && ['卸载…', () => { setMenu(null); setModal({ type: 'uninstall', plugin: p }); }, true]]} />
      </div>)}</div></section>)}
      {groups.every(([, l]) => !l.length) && <div className="m13-empty"><Search size={20} /><h3>没有匹配的插件</h3><p>试试其他关键词，或切换到“全部”。</p></div>}
      <div className="m10-onboarding m13-dev"><Puzzle size={22} /><h3>开发自己的插件</h3><p>插件是一个包含 <code>.willyou-plugin/plugin.json</code> 的文件夹或 .zip：声明身份、版本、权限、能力与界面，WillYou 统一渲染、授权和审批。首期不支持自带原生模块。</p></div>
    </>}
  </>;
}

// ============ 插件详情 ============
function PluginDetail({ plugin: p, setPlugins, defaults, scene, menu, setMenu, nav, setModal, notify, projectName, onTryPrompt, subpage }) {
  if (!p) return <div className="m13-empty"><Info size={20} /><h3>插件不存在或已卸载</h3><button className="m10-button secondary" onClick={() => nav('m13/plugins')}>返回插件</button></div>;
  const crashed = scene === 'plugin-crash' && p.id === 'zentao';
  const toggle = () => { setMenu(null); setPlugins(ps => ps.map(x => x.id === p.id ? { ...x, enabled: !x.enabled } : x)); notify(p.enabled ? `${p.name} 已停用` : `${p.name} 已启用`); };
  const kinds = [...new Set(p.capabilities.map(c => c.kind))];
  return <div className="m13-detail">
    <div className="m13-detail-head"><Mark id={p.id} name={p.name} large /><div className="m13-detail-title"><h1>{p.name}{p.builtin && <Pill>内置</Pill>}{!p.enabled && <Pill tone="warn">已停用</Pill>}</h1><p>由 {p.publisher} 发布 · {p.tagline}</p></div>
      <div className="m13-detail-actions"><Menu open={menu === 'detail'} onToggle={() => setMenu(menu === 'detail' ? null : 'detail')} label="插件更多操作" items={[[p.enabled ? '停用' : '启用', toggle], !p.builtin && ['从文件更新…', () => { setMenu(null); setModal({ type: 'install', source: 'dir' }); }], !p.builtin && ['卸载…', () => { setMenu(null); setModal({ type: 'uninstall', plugin: p }); }, true]]} />
        {subpage && (() => { const [k, t, Icon] = subpage; return <button className="m10-button secondary" onClick={() => nav('m13/plugins/' + p.id + '/' + k)}><Icon size={15} />{t}</button>; })()}
        {connectionTypesOf(p).length > 0 && <button className="m10-button secondary" onClick={() => document.getElementById('m13-connections')?.scrollIntoView({ block: 'start' })}><Settings size={15} />管理</button>}
        <button className="m10-button primary m13-try" disabled={!p.enabled || crashed || !p.examples?.length} onClick={() => onTryPrompt(p.examples[0])}><Sparkles size={15} />立即试用</button></div></div>
    {!p.enabled && <div className="m13-alert warn"><Info size={16} /><div><strong>已停用</strong><p>新任务不再加载它的工具与 Skill；已有连接、项目授权和调用历史都保留。</p></div><button className="m10-button secondary" onClick={toggle}>启用</button></div>}
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

function InstallDialog({ source, plugins, onClose, onDone }) {
  const list = INSTALL_CANDIDATES.filter(c => c.kind === source);
  const [pick, setPick] = useState(null), [checked, setChecked] = useState(null);
  const cand = list.find(c => c.file === pick);
  const res = checked && cand ? validateInstall(cand, plugins) : null;
  return <Dialog title={source === 'zip' ? '从 .zip 文件安装' : '从本地文件夹安装'} sub="原型不会打开系统文件选择器，请从下列合成示例中选择" onClose={onClose} wide
    footer={!res ? <><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary" disabled={!cand} onClick={() => setChecked(true)}>检查插件</button></> : res.ok ? <><button className="m10-button secondary" onClick={() => setChecked(null)}>返回</button><button className="m10-button primary" onClick={() => onDone(cand, res.kind)}>{res.kind === 'update' ? '更新' : '安装'}</button></> : <><button className="m10-button secondary" onClick={() => setChecked(null)}>重新选择</button><button className="m10-button primary" onClick={onClose}>关闭</button></>}>
    {!res && <div className="m13-radios" role="radiogroup">{list.map(c => <label key={c.file} className={'m13-radio' + (pick === c.file ? ' selected' : '')}><input type="radio" name="m13-pkg" checked={pick === c.file} onChange={() => setPick(c.file)} />{source === 'zip' ? <FileArchive size={16} /> : <FolderOpen size={16} />}<span><b>{c.file}</b><small>{c.broken ? '结构异常的示例包' : `${c.name} ${c.version} · ${c.tagline}`}</small></span></label>)}</div>}
    {res && !res.ok && <div className="m13-alert danger"><TriangleAlert size={16} /><div><strong>{res.kind === 'same' || res.kind === 'downgrade' ? '无需安装' : '无法安装'}</strong><ul>{res.errors.map(e => <li key={e}>{e}</li>)}</ul><p>未做任何改动。</p></div></div>}
    {res?.ok && <div className="m13-install-review">
      <div className="m13-detail-head small"><Mark id={cand.id} name={cand.name} large /><div className="m13-detail-title"><h1>{cand.name}</h1><p>由 {cand.publisher} 发布 · {res.kind === 'update' ? `${res.existing.version} → ${cand.version}` : `版本 ${cand.version}`} · 插件接口 {cand.hostApi}</p></div></div>
      {res.kind === 'update' && removedCapabilities(res.existing, cand).length > 0 && <div className="m13-alert warn"><TriangleAlert size={16} /><div><strong>新版本删除了能力</strong><p>{removedCapabilities(res.existing, cand).join('、')} 在新版本中不存在，也没有旧名称映射。老任务调用这些能力会失败。</p></div></div>}
      {res.kind === 'update' && <p className="m13-hint">正在执行的调用按 {res.existing.version} 完成，之后所有任务（包括运行中与恢复的任务）都使用 {cand.version}，旧版本随即删除。更新失败会自动回到原版本，连接与数据保留。</p>}
      <h3>它会获得的权限</h3><ul className="m13-perms">{cand.permissions.map(x => <li key={x}><Check size={14} />{x}</li>)}</ul>
      {cand.capabilities.length > 0 && <><h3>能力</h3><p>{cand.capabilities.map(c => `${c.name}（${c.kind}）`).join('、')}</p></>}
      <div className="m13-alert info"><Info size={16} /><div><p>插件在独立进程中运行，不能读写 WillYou 数据目录与密钥；你电脑上的其他文件不在保护范围内，请只安装你信任来源的插件。</p></div></div>
    </div>}
  </Dialog>;
}
function UninstallDialog({ plugin, onClose, onDone }) {
  const [keep, setKeep] = useState(true);
  return <Dialog title={`卸载 ${plugin.name}`} onClose={onClose} footer={<><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary m13-danger-btn" onClick={() => onDone(keep)}>卸载</button></>}>
    <div className="m13-radios" role="radiogroup">
      <label className={'m13-radio' + (keep ? ' selected' : '')}><input type="radio" checked={keep} onChange={() => setKeep(true)} /><span><b>保留数据</b><small>保留私有数据目录、连接、全局默认与各项目的设置，重新安装后恢复。</small></span></label>
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
function Capabilities({ store, caps, setCaps, plugins, autoManage, setAutoManage, setModal, notify, projects }) {
  const [type, setType] = useState('skill'), [filter, setFilter] = useState('all'), [query, setQuery] = useState(''), [scanning, setScanning] = useState(false);
  const all = [...caps, ...pluginSkillCaps(plugins)];
  const counts = countBy(all, type), totalNew = countBy(caps, 'skill').new + countBy(caps, 'mcp').new;
  const list = filterCapabilities(all, { type, filter, query });
  return <>
    <div className="m10-page-head"><div><h1>Skill 与 MCP</h1><p>你在 Claude Code 或 Codex 中安装的 Skill、配置的 MCP，会被自动发现；纳管后统一配置给另一个 Agent。安装与首次认证仍在来源 CLI 中完成。</p></div>
      <div className="m10-head-actions"><label className="m10-search"><Search size={15} /><input aria-label="搜索 Skill 与 MCP" placeholder="搜索" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <button className="m10-button secondary" disabled={scanning} onClick={() => { setScanning(true); setTimeout(() => {
          setScanning(false);
          const fresh = DISCOVERY_QUEUE.filter(d => !caps.some(c => c.id === d.id));
          if (!fresh.length) return notify('扫描完成：没有新发现；只读取了配置与目录，未启动任何 MCP 或脚本');
          const added = fresh.map(d => autoManage && d.state === 'new' ? manage(d) : d);
          setCaps(cs => [...cs, ...added]);
          const auto = added.filter(d => d.state === 'managed').map(d => d.name), stop = added.filter(d => d.state === 'conflict').map(d => d.name);
          notify(autoManage ? `发现 ${fresh.length} 项：已自动纳管 ${auto.join('、') || '无'}${stop.length ? `；${stop.join('、')} 同名冲突，等待你处理` : ''}` : `发现 ${fresh.length} 个新项，等待纳管`);
        }, 800); }}><RefreshCw size={14} className={scanning ? 'm13-spin' : ''} />{scanning ? '正在扫描…' : '重新扫描'}</button></div></div>
    <BuiltinGroup store={store} notify={notify} />
    <h2 className="m10-section-title m13-ext-title">从 CLI 发现</h2>
    {totalNew > 0 && <div className="m13-discover"><Sparkles size={18} /><div><strong>发现 {totalNew} 个新项</strong><p>纳管后会为另一个 Agent 配置；同名冲突等需要处理的项不会被一起纳管。</p></div><button className="m10-button primary" onClick={() => { const r = manageAll(caps); setCaps(r.items); notify(`已纳管：${r.managed.join('、')}`); }}>一键纳管</button></div>}
    <div className="m13-toolbar"><div className="m10-tabs" role="tablist">{[['skill', 'Skill'], ['mcp', 'MCP']].map(([v, t]) => <button key={v} role="tab" aria-selected={type === v} onClick={() => setType(v)}>{t}<span className="m13-count">{countBy(all, v).all}</span></button>)}</div>
      <label className="m13-switch-row"><span>以后自动纳管</span><button role="switch" aria-checked={autoManage} className={'m13-switch' + (autoManage ? ' on' : '')} onClick={() => { setAutoManage(!autoManage); notify(autoManage ? '已关闭自动纳管' : '已开启：新发现项自动纳管，同名冲突仍会停下来让你选择'); }}><i /></button></label></div>
    <div className="m13-filters">{[['all', '全部', counts.all], ['new', '新发现', counts.new], ['managed', '已纳管', counts.managed], ['attention', '需处理', counts.attention]].map(([v, t, n]) => <button key={v} aria-pressed={filter === v} onClick={() => setFilter(v)}>{t}<span>{n}</span></button>)}</div>
    <div className="m13-cap-list">{list.map(c => <button key={c.id} className="m13-cap" onClick={() => c.state === 'plugin' ? notify(`${c.name} 随${c.pluginName}插件安装、更新和卸载，请在插件详情中管理`) : setModal({ type: 'capability', id: c.id })}>
      <span className="m13-cap-icon">{c.type === 'skill' ? <Sparkles size={16} /> : <Server size={16} />}</span>
      <span className="m13-cap-main"><b>{c.name}</b><small>{c.desc}</small><small className="m13-cap-scope">{scopeLabel(c, projects)}</small></span>
      <span className="m13-cap-targets">{['claude', 'codex'].map(a => <TargetChip key={a} agent={a} t={c.targets[a]} />)}{c.state === 'plugin' && <span className="m13-target muted">{c.path}</span>}</span>
      <Pill tone={STATE_TONE[c.state]}>{STATE_LABEL[c.state]}</Pill><ChevronRight size={15} className="m13-chev" />
    </button>)}{!list.length && <div className="m13-empty"><Blocks size={20} /><h3>{filter === 'attention' ? '没有需要处理的项' : '没有匹配的项'}</h3><p>{filter === 'new' ? '在 Claude Code 或 Codex 中安装后，任务结束或回到本页时会自动发现。' : '试试其他筛选或关键词。'}</p></div>}</div>
    <p className="m13-footnote"><Info size={14} />这里不提供安装 Skill 或添加 MCP 的入口。取消纳管只移除 WillYou 为另一个 Agent 做的配置，不删除来源原件。</p>
  </>;
}
function CapabilityDialog({ item: c, projects, onClose, onChange, notify }) {
  const [approval, setApproval] = useState(c.approval || 'source');
  const [resolve, setResolve] = useState('skip');
  const act = (next, msg) => { onChange(next); notify(msg); onClose(); };
  const footer = c.state === 'new' ? <><button className="m10-button secondary" onClick={onClose}>稍后</button><button className="m10-button primary" onClick={() => act(manage(c), `${c.name} 已纳管`)}>纳管</button></>
    : c.state === 'managed' ? <><button className="m10-button secondary" onClick={() => act(unmanage(c), `已取消纳管 ${c.name}；来源原件未改动`)}>取消纳管</button><button className="m10-button primary" onClick={() => { onChange({ ...c, approval }); notify('已保存'); onClose(); }}>完成</button></>
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

// ============ AI 配置 ============
function AiConfig({ store, tab, nav, scene, providers, setProviders, configs, setConfigs, setModal, notify, menu, setMenu }) {
  const [noticeOpen, setNoticeOpen] = useState(true);
  const notice = scene === 'model-changed' && noticeOpen ? globalModelNotice({ model: 'gpt-5.5', effort: 'high' }, { model: 'deepseek-v4-pro', effort: 'high' }) : null;
  const provName = id => providers.find(p => p.id === id)?.name;
  return <>
    <div className="m10-page-head"><div><h1>AI 配置</h1><p>把本机工具和模型服务组合成运行配置，首页直接选择。按每次运行注入，WillYou 不修改 CLI 的全局配置。</p></div>
      <div className="m10-head-actions"><button className="m10-button secondary" onClick={() => setModal({ type: 'import' })}><Upload size={14} />导入</button><button className="m10-button secondary" onClick={() => setModal({ type: 'export' })}><Download size={14} />导出</button>{tab === 'configs' && <button className="m10-button primary" onClick={() => setModal({ type: 'runconfig' })}><Plus size={14} />新建运行配置</button>}{tab === 'providers' && <button className="m10-button primary" onClick={() => setModal({ type: 'add-provider' })}><Plus size={14} />接入 Provider</button>}</div></div>
    {notice && <div className="m13-alert info m13-model-notice"><Info size={16} /><div><strong>上次 Codex 会话修改了全局默认模型</strong><p>原来是 <code>{notice.before.model}</code>，现在是 <code>{notice.after.model}</code>。这会影响你在终端里直接运行的 Codex。WillYou 不会自动改回。</p><p>需要还原时，打开 <code>~/.codex/config.toml</code>，把对应行改为：</p><pre>{notice.restore.join('\n')}</pre><p className="m13-hint">下次在会话里切换模型时，按 s 只对本次会话生效。</p></div><div className="m13-notice-actions"><button className="m10-button secondary" onClick={() => notify('已复制还原内容（演示）')}><Copy size={14} />复制</button><button className="m10-button secondary" onClick={() => notify('已在默认编辑器中打开（演示）')}><ExternalLink size={14} />打开配置文件</button><button className="m10-button secondary" onClick={() => setNoticeOpen(false)}>知道了</button></div></div>}
    <div className="m10-tabs" role="tablist">{[['configs', '运行配置'], ['providers', 'Provider'], ['tools', '本机工具']].map(([v, t]) => <button key={v} role="tab" aria-selected={tab === v} onClick={() => nav('m13/ai/' + v)}>{t}</button>)}</div>
    {tab === 'configs' && <>
      <div className="m13-list">{configs.map(rc => { const prov = providers.find(p => p.id === rc.provider); return <div key={rc.id} className="m13-item">
        <span className="m13-cap-icon"><Terminal size={16} /></span>
        <span className="m13-cap-main"><b>{rc.name}{rc.default && <Pill tone="ok"><Star size={11} />默认</Pill>}{rc.legacy && <Pill>高级配置</Pill>}{rc.broken && <Pill tone="warn">Provider 已删除</Pill>}</b>
          <small>{AGENTS[rc.tool]} · {rc.legacy ? '保留原环境变量与参数' : prov ? prov.name : '需要重新选择 Provider'} · {rc.model || 'CLI 默认模型'}{prov?.needKey ? ' · Provider 需要填写 Key 后才能启动' : ''}</small>
          {rc.legacy && <small className="m13-cap-scope">{rc.legacyNote}</small>}</span>
        <Menu open={menu === 'rc-' + rc.id} onToggle={() => setMenu(menu === 'rc-' + rc.id ? null : 'rc-' + rc.id)} label={rc.name + ' 更多操作'} items={[['编辑', () => { setMenu(null); setModal({ type: 'runconfig', config: rc }); }], !rc.default && ['设为默认', () => { setMenu(null); setConfigs(cs => cs.map(c => ({ ...c, default: c.id === rc.id }))); notify(`${rc.name} 已设为默认`); }], !rc.default && ['删除', () => { setMenu(null); setConfigs(cs => cs.filter(c => c.id !== rc.id)); notify('已删除；使用过它的历史任务恢复时会提示重新选择'); }, true]]} />
      </div>; })}</div>
      <section className="m13-section"><h2>首页显示效果</h2><div className="m13-home-picker"><div className="m13-picker-trigger"><Terminal size={14} />{configs.find(c => c.default)?.name}<ChevronDown size={14} /></div><div className="m13-picker-menu">{configs.map(c => <div key={c.id} className={c.default ? 'selected' : ''}><span>{c.name}</span>{c.default && <Check size={14} />}</div>)}</div></div><p className="m13-hint">首页按名称选择，常用流程不显示环境变量与启动参数。</p></section>
    </>}
    {tab === 'providers' && <div className="m13-list">{providers.map(p => { const down = scene === 'magpie-down' && p.id === 'magpie'; return <button key={p.id} className="m13-item clickable" onClick={() => setModal({ type: 'provider', id: p.id })}>
      <span className="m13-cap-icon">{p.type === 'native' ? <KeyRound size={16} /> : <Server size={16} />}</span>
      <span className="m13-cap-main"><b>{p.name}<Pill>{p.type === 'native' ? '原有登录' : p.type === 'preset' ? '预设' : '自定义'}</Pill>{p.needKey && <Pill tone="warn">需要填写 Key</Pill>}</b>
        <small>{p.type === 'native' ? p.note : `${p.url} · ${p.protocols.map(x => PROTOCOL_LABEL[x]).join('、')} · ${p.models.length} 个模型`}</small></span>
      {down ? <Pill tone="warn">未运行</Pill> : p.needKey ? null : p.type !== 'native' && <Pill tone="ok">可用</Pill>}<ChevronRight size={15} className="m13-chev" /></button>; })}</div>}
    {tab === 'tools' && <div className="m13-list">{store.tools.map(t => { const version = scene === 'codex-unverified' && t.id === 'codex' ? '0.167.0' : t.version; const ok = t.verified.includes(version); return <div key={t.id} className="m13-item tool">
      <span className="m13-cap-icon"><Terminal size={16} /></span>
      <span className="m13-cap-main"><b>{t.name}<span className="m10-package-version">{version}</span></b><small><code>{t.path}</code></small>
        <span className="m13-checks"><span><Check size={12} />检测到程序</span><span><Check size={12} />程序可启动</span>{ok ? <span><Check size={12} />版本已验证</span> : <span className="warn"><TriangleAlert size={12} />未验证版本，可继续使用，遇到问题请反馈</span>}<span className="muted"><CircleDashed size={12} />模型连接在运行配置中测试</span></span></span>
      <div className="m13-item-actions"><button className="m10-button secondary" onClick={() => notify(`${t.name} 已重新检测`)}>重新检测</button><Menu open={menu === 'tool-' + t.id} onToggle={() => setMenu(menu === 'tool-' + t.id ? null : 'tool-' + t.id)} label={t.name + ' 更多操作'} items={[['自定义路径…', () => { setMenu(null); setModal({ type: 'tool-path', tool: t }); }]]} /></div>
    </div>; })}</div>}
  </>;
}
function RunConfigDialog({ initial, providers, configs, scene, onClose, onSave }) {
  const legacy = initial?.legacy;
  const [tool, setTool] = useState(initial?.tool || 'claude');
  const [prov, setProv] = useState(initial?.provider || (initial ? null : 'native-claude'));
  const provider = providers.find(p => p.id === prov);
  const [model, setModel] = useState(initial?.model || null);
  const [tiers, setTiers] = useState(() => initial?.tiers || {});
  const [name, setName] = useState(initial?.name || '');
  const [touched, setTouched] = useState(!!initial);
  const [env, setEnv] = useState(() => initial?.env || []);
  const [args, setArgs] = useState(initial?.args || '');
  const effName = touched ? name : provider ? autoName(tool, provider) : '';
  const okProv = provider && compatible(tool, provider).ok;
  const thirdClaude = !legacy && tool === 'claude' && provider && provider.type !== 'native';
  const effTiers = thirdClaude ? rebuildTiers(provider, model, tiers) : undefined;
  const tierOk = !thirdClaude || tiersValid(provider, effTiers);
  const [testRes, setTestRes] = useState(null);
  const runTest = () => { setTestRes('testing'); setTimeout(() => setTestRes(provider?.type === 'native' ? { ok: true, text: `使用 ${AGENTS[tool]} 的原有登录，按 CLI 自身登录状态运行` } : provider?.needKey ? { ok: false, text: '这个 Provider 还没有 Key' } : scene === 'magpie-down' && provider?.id === 'magpie' ? { ok: false, text: 'Magpie 未运行，无法连接' } : { ok: true, text: `流式与工具调用正常 · ${model}（演示）` }), 700); };
  const pickProvider = p => { setProv(p.id); const m = p.models?.find(x => x.status === 'ok')?.id || null; setModel(m); setTiers({}); };
  const save = () => onSave({ ...(initial || {}), id: initial?.id || 'rc-' + Math.random().toString(36).slice(2, 8), name: effName || '未命名配置', tool, provider: legacy ? null : prov, model: legacy || provider?.type === 'native' ? null : model, tiers: effTiers, env, args, broken: false });
  const envEditor = <div className="m13-field"><span>环境变量（值为秘密的只显示“已加密”，原型不保存秘密原文）</span>
    {env.map((e, i) => <div key={i} className="m13-env-row"><input aria-label="变量名" value={e.key} onChange={ev => setEnv(list => list.map((x, j) => j === i ? { ...x, key: ev.target.value } : x))} /><input aria-label="变量值" value={e.secret ? '' : e.value || ''} placeholder={e.secret ? '已加密，留空不修改' : '值或 ${引用}'} onChange={ev => setEnv(list => list.map((x, j) => j === i ? { ...x, value: ev.target.value, secret: false } : x))} /><button type="button" className="m13-link" onClick={() => setEnv(list => list.filter((_, j) => j !== i))}>删除</button></div>)}
    <button type="button" className="m13-link m13-add-conn" onClick={() => setEnv(list => [...list, { key: '', value: '' }])}><Plus size={13} />添加变量</button></div>;
  return <Dialog title={initial ? '编辑运行配置' : '新建运行配置'} onClose={onClose} wide footer={<>{!legacy && <button className="m10-button secondary m13-foot-left" disabled={!okProv || testRes === 'testing'} onClick={runTest}>{testRes === 'testing' ? '测试中…' : '测试连接'}</button>}<button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary" disabled={!legacy && (!okProv || !tierOk)} onClick={save}>保存</button></>}>
    {testRes && testRes !== 'testing' && <div className={'m13-alert ' + (testRes.ok ? 'info' : 'danger')}>{testRes.ok ? <CircleCheck size={16} /> : <TriangleAlert size={16} />}<div><p>{testRes.text}{provider?.type !== 'native' ? '。测试会发起一次最小调用，可能产生少量费用。' : ''}</p></div></div>}
    {legacy ? <>
      <div className="m13-alert info"><Info size={16} /><div><strong>高级配置</strong><p>{initial.legacyNote}。可以继续维护环境变量与启动参数；如需拆成工具＋Provider，可新建运行配置。</p></div></div>
      <label className="m13-field"><span>名称</span><input value={effName} onChange={e => { setTouched(true); setName(e.target.value); }} /></label>
      <h3 className="m13-sub">本机工具</h3><div className="m13-seg">{TOOLS.map(t => <button key={t.id} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}><Terminal size={14} />{t.name}<small>{t.version}</small></button>)}</div>
      {envEditor}
      <label className="m13-field"><span>附加启动参数</span><input value={args} onChange={e => setArgs(e.target.value)} placeholder="一般不需要填写" /></label>
    </> : <>
      <h3 className="m13-sub">1. 本机工具</h3><div className="m13-seg">{TOOLS.map(t => <button key={t.id} aria-pressed={tool === t.id} onClick={() => { setTool(t.id); if (provider && !compatible(t.id, provider).ok) setProv(null); }}><Terminal size={14} />{t.name}<small>{t.version}</small></button>)}</div>
      <h3 className="m13-sub">2. 模型服务</h3><div className="m13-radios" role="radiogroup">{providers.map(p => { const c = compatible(tool, p); return <label key={p.id} className={'m13-radio' + (prov === p.id ? ' selected' : '') + (c.ok ? '' : ' disabled')}><input type="radio" disabled={!c.ok} checked={prov === p.id} onChange={() => pickProvider(p)} /><span><b>{p.name}</b><small>{c.ok ? (p.type === 'native' ? p.note : p.url) : c.reason}</small></span></label>; })}</div>
      {provider && provider.type !== 'native' && <><h3 className="m13-sub">3. 默认模型</h3><select className="m13-select" value={model || ''} onChange={e => setModel(e.target.value || null)}>{provider.models.map(m => <option key={m.id} value={m.id} disabled={m.status === 'rejected'}>{m.name}{m.status === 'rejected' ? '（调用被拒绝）' : m.status === 'untested' ? '（未测试）' : ''}</option>)}</select>
        {thirdClaude && <p className="m13-hint">Opus／Sonnet／Haiku、small-fast 与子 Agent 档位都只能选 {provider.name} 的模型；更换模型服务时会重新设置，可在高级设置中逐项调整。</p>}</>}
      <label className="m13-field"><span>名称</span><input value={effName} onChange={e => { setTouched(true); setName(e.target.value); }} placeholder="选择工具和服务后自动生成" /></label>
      {okProv && <ul className="m13-notes">{runNotes({ tool, provider: prov }, provider).map(n => <li key={n}><Info size={13} />{n}</li>)}</ul>}
      <details className="m13-adv"><summary>高级设置</summary>
        {thirdClaude && <div className="m13-tiers">{CLAUDE_TIERS.map(([k, label]) => <label key={k} className="m13-field"><span>{label}</span><select className="m13-select" value={effTiers[k]} onChange={e => setTiers(t => ({ ...rebuildTiers(provider, model, t), [k]: e.target.value }))}>{provider.models.filter(m => m.status !== 'rejected').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>)}</div>}
        {envEditor}
        <label className="m13-field"><span>附加启动参数</span><input value={args} onChange={e => setArgs(e.target.value)} placeholder="一般不需要填写" /></label>
      </details>
      {!tierOk && <div className="m13-alert danger"><TriangleAlert size={16} /><div><p>有档位使用了不属于 {provider?.name} 的模型，请在高级设置中重新选择。</p></div></div>}
    </>}
  </Dialog>;
}
function ProviderDialog({ provider: p, setProviders, configs, scene, onClose, notify, onRemove }) {
  const [keyEdit, setKeyEdit] = useState(p.needKey ? '' : null), [refreshing, setRefreshing] = useState(false);
  const refs = configs.filter(c => c.provider === p.id);
  const down = scene === 'magpie-down' && p.id === 'magpie';
  const patch = fn => setProviders(ps => ps.map(x => x.id === p.id ? fn(x) : x));
  const test = m => { patch(x => ({ ...x, models: x.models.map(y => y.id === m.id ? { ...y, status: 'testing' } : y) })); setTimeout(() => patch(x => ({ ...x, models: x.models.map(y => y.id === m.id ? { ...y, status: m.status === 'rejected' ? 'rejected' : 'ok', tested: '刚刚' } : y) })), 700); };
  const refresh = () => { setRefreshing(true); setTimeout(() => { setRefreshing(false); const extra = p.preset === 'deepseek' && !p.models.some(m => m.id === 'deepseek-v4-lite') ? [{ id: 'deepseek-v4-lite', name: 'DeepSeek V4 Lite', ctx: '64K', status: 'untested' }] : []; patch(x => ({ ...x, refreshed: '刚刚', models: [...x.models, ...extra] })); notify(extra.length ? `模型列表已刷新：新增 ${extra.map(e => e.name).join('、')}` : '模型列表已刷新：没有变化'); }, 700); };
  return <Dialog title={p.name} sub={p.type === 'native' ? '原有登录' : p.url} onClose={onClose} wide footer={<>{p.type !== 'native' && <button className="m10-button secondary m13-danger-text" onClick={onRemove}>删除</button>}<button className="m10-button primary" onClick={onClose}>完成</button></>}>
    {p.type === 'native' ? <p className="m13-desc">{p.note}。如需切换账号，请在终端中用 {AGENTS[p.tool]} 自己的登录命令完成。</p> : <>
      {down && <div className="m13-alert warn"><TriangleAlert size={16} /><div><strong>Magpie 未运行</strong><p>启动任务前会先提示，不会让 CLI 卡在重连。请先打开 Magpie。</p></div></div>}
      {p.needKey && <div className="m13-alert warn"><Info size={16} /><div><strong>需要填写 Key</strong><p>这个 Provider 从导入文件创建，文件里不含 Key。填写后才能启动任务。</p></div></div>}
      <dl className="m13-info compact"><dt>协议</dt><dd>{p.protocols.map(x => PROTOCOL_LABEL[x]).join('、')}</dd>
        <dt>Key</dt><dd>{keyEdit === null ? <><code>{p.key || '未填写'}</code><button className="m13-link" onClick={() => setKeyEdit('')}>{p.key ? '更换' : '填写'}</button></> : <span className="m13-inline-edit"><input type="password" aria-label="新的 Key" value={keyEdit} onChange={e => setKeyEdit(e.target.value)} placeholder="加密保存，只在启动时注入" /><button className="m10-button secondary m13-row-btn" disabled={!keyEdit.trim()} onClick={() => { patch(x => ({ ...x, key: 'sk-•••• ' + keyEdit.slice(-4), needKey: false })); setKeyEdit(null); notify('Key 已更新（原型只保留脱敏后四位）'); }}>保存</button>{!p.needKey && <button className="m13-link" onClick={() => setKeyEdit(null)}>取消</button>}</span>}</dd>
        <dt>模型目录</dt><dd>{p.refreshed} 刷新 · 每次启动任务前自动比对<button className="m13-link" disabled={refreshing || down} onClick={refresh}>{refreshing ? '刷新中…' : '刷新模型'}</button></dd>
        <dt>被引用</dt><dd>{refs.length ? refs.map(r => r.name).join('、') : '暂无运行配置使用'}</dd></dl>
      <h3 className="m13-sub">模型</h3><div className="m13-table models" role="table"><div role="row" className="m13-th"><span>模型</span><span>上下文</span><span>可用性</span><span /></div>{p.models.map(m => <div role="row" key={m.id}><span>{m.name}</span><span>{m.ctx}</span><span>{m.status === 'ok' ? <Pill tone="ok">可用</Pill> : m.status === 'rejected' ? <Pill tone="warn">调用被拒绝</Pill> : m.status === 'testing' ? <Pill>测试中…</Pill> : <Pill>未测试</Pill>}</span><span><button className="m13-link" disabled={down || p.needKey || m.status === 'testing'} onClick={() => test(m)}>测试可用性</button></span></div>)}</div>
      <p className="m13-hint">“测试可用性”会发起一次最小的流式＋工具调用，可能产生少量费用；结果会保留在这里。能列出的模型不一定能调用。</p>
      {refs.length > 0 && <p className="m13-hint">删除后，引用它的 {refs.length} 个运行配置需要重新选择 Provider；历史任务恢复时会提示改选，不会静默换账号。</p>}
    </>}
  </Dialog>;
}
function ToolPathDialog({ tool, onClose, onSave }) {
  const [path, setPath] = useState(tool.path), [err, setErr] = useState('');
  return <Dialog title="自定义可执行路径" sub={tool.name + ' · 高级'} onClose={onClose} footer={<><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary" onClick={() => { const r = checkToolPath(path); if (!r.ok) setErr(r.error); else onSave(path.trim()); }}>检测并保存</button></>}>
    <label className="m13-field"><span>可执行文件</span><input value={path} onChange={e => { setPath(e.target.value); setErr(''); }} /></label>
    {err && <div className="m13-alert danger"><TriangleAlert size={16} /><div><p>{err}，未保存。</p></div></div>}
    <p className="m13-hint">一般不需要修改。WillYou 会检测该文件能否启动并读取版本（原型中路径含“missing”视为不存在，以 .txt 结尾视为不可执行）。</p>
  </Dialog>;
}
function AddProviderDialog({ providers, scene, onClose, onDone }) {
  const [step, setStep] = useState('choose'), [kind, setKind] = useState(null), [url, setUrl] = useState('https://api.acme.example/v1'), [key, setKey] = useState(''), [demo, setDemo] = useState('ok');
  const [result, setResult] = useState(null), [models, setModels] = useState([]), [manual, setManual] = useState(''), [confirm, setConfirm] = useState(null), [gen, setGen] = useState({ codex: true, claude: true });
  const has = id => providers.some(p => p.id === id);
  const preset = kind && kind !== 'custom' ? PRESETS[kind] : null;
  const name = preset ? preset.name : 'Acme 服务';
  const choose = k => { setKind(k); setResult(null); if (PRESETS[k]) { setUrl(PRESETS[k].url); setKey(PRESETS[k].defaultKey || ''); } else setUrl('https://api.acme.example/v1'); };
  const runProbe = () => {
    let r;
    if (preset) r = kind === 'magpie' && scene === 'magpie-down' ? { ok: false, error: 'Magpie 未运行：无法连接 http://127.0.0.1:3425。请先打开 Magpie。' } : !key.trim() ? { ok: false, error: `请填写${preset.keyLabel}` } : { ok: true, candidates: preset.protocols, models: preset.models };
    else r = probe(url, key, demo);
    setResult(r); if (r.ok) { setModels(r.models.map(m => m.id)); setStep('models'); }
  };
  const runConfirm = () => { setConfirm('testing'); setTimeout(() => setConfirm(preset || demo === 'ok' || demo === 'empty' ? { responses: true, anthropic: true } : demo === 'partial' ? { responses: true, anthropic: false } : { responses: false, anthropic: false }), 800); };
  const passed = confirm && confirm !== 'testing' ? result.candidates.filter(x => confirm[x]) : [];
  const finish = () => { const prov = { id: preset ? kind : 'custom-' + Math.random().toString(36).slice(2, 6), name, type: preset ? 'preset' : 'custom', preset: preset ? kind : undefined, url, protocols: passed, key: preset && kind === 'magpie' ? key : 'sk-•••• ' + (key.slice(-4) || '0000'), refreshed: '刚刚', models: (models.length ? result.models.filter(m => models.includes(m.id)) : [{ id: manual, name: manual, ctx: '—' }]).map(m => ({ ...m, status: 'ok' })) };
    const first = prov.models[0]?.id; const out = []; if (gen.codex && prov.protocols.includes('responses')) out.push({ id: 'rc-' + prov.id + '-codex-' + Math.random().toString(36).slice(2, 5), name: autoName('codex', prov), tool: 'codex', provider: prov.id, model: first }); if (gen.claude && prov.protocols.includes('anthropic')) out.push({ id: 'rc-' + prov.id + '-claude-' + Math.random().toString(36).slice(2, 5), name: autoName('claude', prov), tool: 'claude', provider: prov.id, model: first, tiers: rebuildTiers(prov, first) }); onDone(prov, out); };
  return <Dialog title="接入 Provider" sub={{ choose: '选择预设或填写地址与 Key', form: preset ? name : '自定义地址', models: '选择要接入的模型', confirm: '确认可用', gen: '生成运行配置' }[step]} onClose={onClose} wide
    footer={step === 'choose' ? <><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary" disabled={!kind} onClick={() => setStep('form')}>下一步</button></>
      : step === 'form' ? <><button className="m10-button secondary" onClick={() => setStep('choose')}>返回</button><button className="m10-button primary" onClick={runProbe}>获取模型</button></>
        : step === 'models' ? <><button className="m10-button secondary" onClick={() => setStep('form')}>返回</button><button className="m10-button primary" disabled={!models.length && !manual.trim()} onClick={() => { setStep('confirm'); runConfirm(); }}>下一步</button></>
          : step === 'confirm' ? <><button className="m10-button secondary" onClick={() => setStep('models')}>返回</button><button className="m10-button primary" disabled={confirm === 'testing' || !passed.length} onClick={() => setStep('gen')}>下一步</button></>
            : <><button className="m10-button secondary" onClick={() => setStep('confirm')}>返回</button><button className="m10-button primary" onClick={finish}>完成接入</button></>}>
    {step === 'choose' && <div className="m13-radios" role="radiogroup">
      {[['magpie', 'http://127.0.0.1:3425/v1 · 真实 Key 与路由留在 Magpie'], ['deepseek', 'https://api.deepseek.com/ · 同时支持 Codex 与 Claude Code']].map(([id, d]) => <label key={id} className={'m13-radio' + (kind === id ? ' selected' : '') + (has(id) ? ' disabled' : '')}><input type="radio" disabled={has(id)} checked={kind === id} onChange={() => choose(id)} /><span><b>{PRESETS[id].name}</b><small>{has(id) ? '已接入，可在 Provider 详情中管理' : d}</small></span></label>)}
      <label className={'m13-radio' + (kind === 'custom' ? ' selected' : '')}><input type="radio" checked={kind === 'custom'} onChange={() => choose('custom')} /><span><b>自定义地址＋Key</b><small>OpenAI Responses 或 Anthropic Messages 兼容的服务</small></span></label></div>}
    {step === 'form' && <>{preset ? <dl className="m13-info compact"><dt>服务地址</dt><dd><code>{preset.url}</code></dd><dt>协议</dt><dd>{preset.protocols.map(x => PROTOCOL_LABEL[x]).join('、')}</dd></dl> : <label className="m13-field"><span>服务地址</span><input value={url} onChange={e => setUrl(e.target.value)} /></label>}
      <label className="m13-field"><span>{preset ? preset.keyLabel : 'Key'}</span><input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="加密保存，只在启动时注入" /></label>
      {!preset && <label className="m13-field demo"><span>演示结果（原型）</span><select value={demo} onChange={e => setDemo(e.target.value)}><option value="ok">成功</option><option value="empty">模型列表为空</option><option value="bad-key">Key 无效（401）</option><option value="unreachable">服务不可达</option><option value="partial">仅 Responses 确认通过</option><option value="tools-fail">能列出模型但工具调用失败</option></select></label>}
      {result && !result.ok && <div className="m13-alert danger"><TriangleAlert size={16} /><div><p>{result.error}</p></div></div>}</>}
    {step === 'models' && <>{!preset && <><p className="m13-desc">候选协议：{result.candidates.map(x => <Pill key={x} tone="info">{PROTOCOL_LABEL[x]}（候选）</Pill>)}</p><p className="m13-hint">候选协议只是初步判断，下一步用一次最小调用确认后才算可用。</p></>}
      {result.models.length ? <div className="m13-checks-list">{result.models.map(m => <label key={m.id}><input type="checkbox" checked={models.includes(m.id)} onChange={e => setModels(ms => e.target.checked ? [...ms, m.id] : ms.filter(x => x !== m.id))} />{m.name}<small>{m.ctx}</small></label>)}</div>
        : <><div className="m13-alert info"><Info size={16} /><div><p>{result.note}</p></div></div><label className="m13-field"><span>模型 ID</span><input value={manual} onChange={e => setManual(e.target.value)} placeholder="例如 acme-coder-large" /></label></>}</>}
    {step === 'confirm' && <>{confirm === 'testing' ? <p className="m13-desc"><RefreshCw size={14} className="m13-spin" /> 正在用一次最小的流式＋工具调用确认…</p> : <div className="m13-list">{result.candidates.map(x => <div key={x} className="m13-item"><span className="m13-cap-icon">{confirm[x] ? <CircleCheck size={16} /> : <TriangleAlert size={16} />}</span><span className="m13-cap-main"><b>{PROTOCOL_LABEL[x]}</b><small>{confirm[x] ? `流式与工具调用正常 · 可用于 ${x === 'responses' ? 'Codex' : 'Claude Code'}` : '模型列表可读，但最小工具调用失败：返回 400 tools not supported'}</small></span><Pill tone={confirm[x] ? 'ok' : 'warn'}>{confirm[x] ? '可用' : '不可用'}</Pill></div>)}</div>}
      {confirm && confirm !== 'testing' && !passed.length && <div className="m13-alert danger"><TriangleAlert size={16} /><div><strong>没有可用的协议</strong><p>这个服务不能作为代码 Agent 的模型服务使用，不会接入。可检查地址或联系服务提供方。</p></div></div>}
      <p className="m13-hint">确认调用可能产生少量费用。</p></>}
    {step === 'gen' && <><p className="m13-desc">按确认可用的协议生成运行配置，之后可以在首页直接选择：</p><div className="m13-checks-list">{[['codex', 'responses'], ['claude', 'anthropic']].filter(([, pr]) => passed.includes(pr)).map(([t]) => <label key={t}><input type="checkbox" checked={gen[t]} onChange={e => setGen(g => ({ ...g, [t]: e.target.checked }))} />{AGENTS[t]} · {name.replace(/（.*）/, '')}</label>)}</div></>}
  </Dialog>;
}
