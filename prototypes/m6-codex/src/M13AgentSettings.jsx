// M13 原型 P0.7 起：智能体页面放在“设置 › 智能体”（需求 2026-11-11 补记 2）。
// P0.12 起按演示场景模拟 CLI 登录与工具检测；P0.13：不自动生成智能体（新建为三步联动），列表可拖动／上移下移排序。
// 页面与弹窗在 M13CodeAgent.jsx；本组件负责状态变更、提示与演示场景。全部为合成数据，只在内存中生效。
import React, { useEffect, useRef, useState } from 'react';
import { AgentDialog, CodeAgentConfig, CatalogDialog, ProviderDialog, ToolPathDialog } from './M13CodeAgent.jsx';
import { ExportDialog, ImportDialog } from './M13Pages.jsx';
import { SCENES } from './M13Workspace.jsx';
import { AGENTS, LOGIN_LABEL, moveAgent, reconcileDefault, removeAgent, removeProviderImpact, reorderAgent, syncLogin, withDefault } from './m13-model.mjs';
import { clearLiveKey } from './m13-live.mjs';
import './m13.css';

/** 演示：各场景下的检测结果（正式版读取 `claude auth status`、`codex login status` 与可执行文件）。 */
export function detectByScene(scene) {
  return {
    claude: { installed: true, login: scene === 'login-api' ? 'api' : scene === 'claude-logout' ? 'none' : 'subscription' },
    codex: { installed: scene !== 'codex-missing', login: scene === 'codex-login' ? 'subscription' : 'none' },
  };
}

export function M13AgentSettings({ tab, focus, store, nav }) {
  const { providers, setProviders, configs, setConfigs, tools, setTools, scene, setScene } = store;
  const [modal, setModal] = useState(null);
  const [menu, setMenu] = useState(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const notify = text => { clearTimeout(toastTimer.current); setToast(text); toastTimer.current = setTimeout(() => setToast(''), 4200); };
  useEffect(() => { const close = e => { if (!e.target.closest?.('.m10-menu-wrap')) setMenu(null); }; document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close); }, []);
  useEffect(() => setMenu(null), [tab]);
  // 审核 Q03：首页／恢复的“去填写 Key”直接打开该供应商详情（路由 settings/ai/providers/<id>）
  useEffect(() => { if (tab === 'providers' && focus && store.providers.some(p => p.id === focus)) setModal({ type: 'provider', id: focus }); }, [tab, focus]);
  const close = () => setModal(null);

  /** 检测并同步：工具安装状态；已有订阅/API 智能体随登录状态改名、标记退出或恢复（不自动添加）。 */
  const detect = (manual, only) => {
    const d = detectByScene(scene), msgs = [];
    let cs = configs;
    const nextTools = tools.map(t => {
      if (only && t.id !== only) return t;
      const r = d[t.id];
      if (!t.installed && r.installed) msgs.push(`检测到 ${t.name}，新建智能体时可以选择它`);
      if (t.installed && !r.installed) msgs.push(`没有检测到 ${t.name}：它的智能体暂时不能使用，也不在首页显示`);
      if (t.installed && r.installed && t.login === 'none' && r.login !== 'none' && !cs.some(c => c.source === 'login' && c.tool === t.id)) msgs.push(`检测到 ${t.name} 已登录${LOGIN_LABEL[r.login]}，新建智能体时可以选“${LOGIN_LABEL[r.login]}”`);
      if (r.installed) {
        const s2 = syncLogin(cs, t.id, r.login); cs = s2.configs; const ev = s2.event;
        if (ev?.kind === 'switched') msgs.push(`${t.name} 改用${r.login === 'api' ? ' API Key ' : '订阅'}登录，${ev.agents.map(a => `“${a.name}”`).join('、')}已改名为“${ev.name}”`);
        if (ev?.kind === 'logout') msgs.push(`${t.name} 已退出登录：${ev.agents.map(a => `“${a.name}”`).join('、')}保留并标为已退出登录，不在首页显示${ev.newDefault ? `；默认改为“${ev.newDefault.name}”` : ''}`);
        if (ev?.kind === 'restored') msgs.push(`${t.name} 已重新登录，${ev.agents.map(a => `“${a.name}”`).join('、')}已恢复`);
      }
      return { ...t, installed: r.installed, login: r.login };
    });
    // P0.16（审核 N04，用户决定）：默认智能体不可用时，按当前顺序从上往下第一个可用的设为默认；恢复后不抢回
    const rd = reconcileDefault(cs, nextTools); cs = rd.configs;
    if (rd.newDefault && rd.previous) msgs.push(`“${rd.previous.name}”暂时不能使用，默认改为“${rd.newDefault.name}”`);
    if (rd.empty) msgs.push('没有可用的智能体，首页需要先新建智能体');
    setTools(nextTools); if (cs !== configs) setConfigs(cs);
    if (msgs.length) notify(msgs.join('；')); else if (manual) notify(`已重新检测${only ? ' ' + AGENTS[only] : ''}：没有变化`);
  };
  useEffect(() => { detect(false); }, [scene]); // 进入页面与切换演示场景时检测

  const ops = {
    redetect: t => detect(true, t.id),
    toggleVisible: rc => { setConfigs(cs => cs.map(c => c.id === rc.id ? { ...c, visible: !c.visible } : c)); notify(rc.visible ? `“${rc.name}”不在首页显示` : `“${rc.name}”会在首页显示`); },
    setDefault: rc => { setConfigs(cs => withDefault(cs, rc.id)); notify(`“${rc.name}”已设为默认，首页优先选择它`); },
    removeAgent: rc => { const r = removeAgent(configs, rc.id, tools); setConfigs(r.configs); notify(`已删除“${rc.name}”${r.newDefault ? `；默认改为“${r.newDefault.name}”` : ''}。使用过它的历史任务恢复时会提示重新选择`); },
    move: (rc, dir) => { setConfigs(cs => moveAgent(cs, rc.id, dir)); notify(`“${rc.name}”已${dir < 0 ? '上移' : '下移'}，首页下拉同步`); },
    reorder: (fromId, toId) => { setConfigs(cs => reorderAgent(cs, fromId, toId)); notify('顺序已调整，首页下拉同步'); },
  };
  const connect = p => setProviders(ps => ps.some(x => x.id === p.id) ? ps : [...ps, p]);
  /** 新建入口：同一个 Code Agent＋供应商已有智能体时直接打开它（P0.15 唯一性）。 */
  const newAgent = preset => { const ex = preset?.provider && configs.find(c => !c.legacy && c.tool === preset.tool && c.provider === preset.provider); setModal(ex ? { type: 'agent', config: ex } : { type: 'agent', preset }); nav('settings/ai/configs'); if (ex) notify(`已有“${ex.name}”，可以在这里勾选更多模型`); };

  return <div className="m13-shell m13-settings-embed">
    <div className="m13-scene-line"><span>M13 原型 · 合成数据（SMG 供应商例外：真实请求，Key 只在页面内存）</span><label>演示场景<select value={scene} onChange={e => setScene(e.target.value)}>{SCENES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label></div>
    <CodeAgentConfig tab={tab || 'configs'} {...{ store, nav, scene, setModal, notify, menu, setMenu, ops }} />
    {modal?.type === 'export' && <ExportDialog providers={providers} configs={configs} onClose={close} notify={notify} />}
    {modal?.type === 'import' && <ImportDialog providers={providers} configs={configs} onClose={close} onImport={pv => {
      const idMap = {}; const newProv = pv.providers.map(p => { const id = providers.some(x => x.id === p.id) ? p.id + '-imp-' + Math.random().toString(36).slice(2, 5) : p.id; idMap[p.id] = id; return { ...p, id, catalog: p.preset || p.id, name: p.finalName, key: p.needKey ? null : 'sk-•••• 已导入', needKey: p.needKey, refreshed: '导入', models: (p.models || []).map(m => ({ ...m, avail: {} })) }; });
      setProviders(ps => [...ps, ...newProv]); setConfigs(cs => [...cs, ...pv.runConfigs.map(c => ({ ...c, source: c.source || 'provider', visible: c.visible ?? true, id: 'rc-imp-' + Math.random().toString(36).slice(2, 7), name: c.finalName, provider: idMap[c.provider] ?? c.provider, default: false }))]);
      close(); notify(`已导入 ${pv.runConfigs.length} 个智能体、${newProv.length} 个供应商${newProv.some(p => p.needKey) ? '；有供应商需要填写 Key' : ''}`); }} />}
    {modal?.type === 'agent' && <AgentDialog key={modal.config?.id || 'new'} initial={modal.config} preset={modal.preset} copy={modal.copy} store={store} onClose={close} onEditExisting={ex => setModal({ type: 'agent', config: ex })} onRedetect={() => detect(true)} onToolPath={tool => setModal({ type: 'tool-path', tool, back: modal })} onAddProvider={tool => setModal({ type: 'catalog', forTool: tool })} onSave={rc => {
      if (!rc.id) { const a = { ...rc, id: 'rc-' + Math.random().toString(36).slice(2, 8) }; setConfigs(cs => reconcileDefault([...cs, a], tools).configs); notify(`已创建“${a.name}”，已加到列表末尾，可拖动调整顺序`); }
      else { setConfigs(cs => cs.map(c => c.id === rc.id ? rc : c)); notify(`“${rc.name}”已保存`); }
      close(); }} />}
    {modal?.type === 'provider' && providers.find(p => p.id === modal.id) && <ProviderDialog provider={providers.find(p => p.id === modal.id)} store={store} scene={scene} onClose={close} notify={notify} onNewAgent={newAgent} onRemove={() => {
      const p = providers.find(x => x.id === modal.id), r = removeProviderImpact(modal.id, configs, tools); clearLiveKey(modal.id);
      setProviders(ps => ps.filter(x => x.id !== modal.id)); setConfigs(r.configs); close();
      notify(`已删除 ${p.name}${r.removed.length ? ` 和使用它的 ${r.removed.length} 个智能体` : ''}${r.newDefault ? `；默认改为“${r.newDefault.name}”` : ''}`); }} />}
    {modal?.type === 'catalog' && <CatalogDialog store={store} scene={scene} forTool={modal.forTool} onClose={close} onConnect={p => { connect(p); notify(`${p.name} 已添加`); }} onNewAgent={newAgent} onOpenProvider={id => { setModal({ type: 'provider', id }); nav('settings/ai/providers'); }} />}
    {modal?.type === 'tool-path' && <ToolPathDialog tool={modal.tool} onClose={() => setModal(modal.back || null)} onSave={path => { setTools(ts => ts.map(t => t.id === modal.tool.id ? { ...t, path, installed: true } : t)); setModal(modal.back || null); notify('已检测：程序可启动，路径已保存（演示）'); }} />}
    {toast && <div className="m10-toast m13-toast" role="status">{toast}</div>}
  </div>;
}
