// M13 原型 P0.13：智能体（需求补记 5，2026-11-11）。智能体页平铺、和首页下拉一一对应、可排序、保留首页开关；
// 新建智能体为“Code Agent → 订阅或供应商（按协议过滤）→ 模型”三步联动，不填 Key；添加供应商不再自动生成智能体；供应商详情分概览／智能体两个页签。
// 除 SMG 真实接入外全部为合成数据，不读取真实 CLI 登录或配置、不保存秘密原文。
import React, { useState } from 'react';
import { ArrowLeft, Check, Copy, GripVertical, Download, Eye, EyeOff, ExternalLink, Info, Plus, RefreshCw, Search, Star, Terminal, TriangleAlert, Upload } from 'lucide-react';
import { AGENTS, AVAIL_LABEL, applyProviderKey, CATALOG, CODE_AGENTS, agentModels, canBeDefault, cleanPicked, reconcileModels, uniformTiers, existingAgent, nameTaken, agentName, providersForTool, providerSummary, recommendedModel, CATALOG_GROUPS, CLAUDE_TIERS, LOGIN_DESC, LOGIN_LABEL, PROTOCOL_LABEL_FULL, PROTOCOL_TABS, TOOL_PROTOCOL, applyTest, autoName, autoTest, availOf, catalogItem, checkToolPath, compatible, detectProtocols, globalModelNotice, modelsFor, pairingNote, probe, rebuildTiers, runNotes, tiersValid, toolsFor } from './m13-model.mjs';
import { AgentIcon, ProviderIcon, ToolIcon } from './m13-icons.jsx';
import { Dialog, Menu, Pill } from './m13-ui.jsx';
import { clearLiveKey, getLiveKey, isLive, liveClaudeTest, liveModels, liveProbe, setLiveKey } from './m13-live.mjs';

const TOOL_IDS = ['claude', 'codex'];
const providerKind = p => p.type === 'custom' ? '自定义' : '目录';
const availTone = s => s === 'ok' ? 'ok' : s === 'bad' ? 'warn' : 'muted';
const modelName = (p, id) => p?.models?.find(m => m.id === id)?.name || id;
const withDetail = (p, modelId, r) => ({ ...p, models: p.models.map(m => m.id === modelId ? { ...m, detail: r.result === 'bad' ? r.detail : undefined, lastTest: r.detail } : m) });
const recOf = (p, t) => typeof p?.recommended === 'object' ? p.recommended?.[t] : p?.recommended;
function Switch({ on, label, disabled, title, onChange }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} title={title} disabled={disabled} className={'m13-switch' + (on ? ' on' : '')} onClick={onChange}><i /></button>;
}
const loginState = t => !t.installed ? '未检测到' : t.login === 'none' ? '未登录' : t.login === 'api' ? '已登录（API Key）' : '已登录订阅';
function FitChips({ provider }) {
  const ts = toolsFor(provider);
  return TOOL_IDS.map(t => <span key={t} className={'m13-toolchip' + (ts.includes(t) ? '' : ' off')} title={ts.includes(t) ? '' : compatible(t, provider).reason}><ToolIcon tool={t} size={14} />{AGENTS[t]}{ts.includes(t) ? <Check size={12} /> : <span className="m13-dash">—</span>}</span>);
}

// ================= 主页面（P0.13：平铺，和首页下拉一一对应，可排序） =================
export function CodeAgentConfig({ store, tab, nav, scene, setModal, notify, menu, setMenu, ops }) {
  const { providers, configs, tools } = store;
  const [noticeOpen, setNoticeOpen] = useState(true);
  const [drag, setDrag] = useState(null), [over, setOver] = useState(null);
  const notice = scene === 'model-changed' && noticeOpen ? globalModelNotice({ model: 'gpt-5.5', effort: 'high' }, { model: 'deepseek-v4-pro', effort: 'high' }) : null;
  const view = tab === 'providers' ? 'providers' : 'configs';
  const menuOf = (key, label, items) => <Menu open={menu === key} onToggle={() => setMenu(menu === key ? null : key)} label={label} items={items.map(it => it && [it[0], () => { setMenu(null); it[1](); }, it[2]])} />;

  const agentRow = (rc, idx) => {
    const prov = providers.find(p => p.id === rc.provider), tool = tools.find(t => t.id === rc.tool);
    const m = prov?.models?.find(x => x.id === rc.model), av = m ? availOf(m, rc.tool) : null;
    const missingTool = tool && !tool.installed;
    const ams = agentModels(rc);
    const sub = rc.legacy ? `${AGENTS[rc.tool]} · 保留原环境变量与参数` : rc.source === 'login' ? (rc.loggedOut ? 'CLI 已退出登录，重新登录后自动恢复' : `CLI 默认模型 · ${LOGIN_DESC[rc.method || 'subscription'].replace(/^使用 CLI 里登录的(订阅账号|API Key)，/, '')}`) : prov ? <>{m?.name || rc.model}{av && av !== 'ok' && <span className={'m13-avail-tag ' + av}> · {AVAIL_LABEL[av]}</span>}{ams.length > 1 && <span className="m13-more-models" title={ams.slice(1).map(id => modelName(prov, id)).join('、')}> · 另 {ams.length - 1} 个模型可切换</span>}</> : '供应商已删除';
    const visTitle = rc.default ? '默认智能体必须在首页显示' : rc.loggedOut ? '重新登录后才能在首页显示' : missingTool ? `${AGENTS[rc.tool]} 未安装` : '';
    return <div key={rc.id} className={'m13-agent-row m13-agent-item' + (rc.loggedOut || missingTool ? ' dim' : '') + (drag === rc.id ? ' dragging' : '') + (over === rc.id && drag && drag !== rc.id ? ' drop-target' : '')} data-agent={rc.id}
      draggable={!rc.default} onDragStart={e => { setDrag(rc.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', rc.id); }} onDragOver={e => { e.preventDefault(); setOver(rc.id); }} onDragLeave={() => setOver(o => o === rc.id ? null : o)} onDrop={e => { e.preventDefault(); if (drag) ops.reorder(drag, rc.id); setDrag(null); setOver(null); }} onDragEnd={() => { setDrag(null); setOver(null); }}>
      <span className={'m13-grip' + (rc.default ? ' locked' : '')} title={rc.default ? '默认智能体固定排在第一位' : '拖动调整顺序（即首页下拉中的顺序）'} aria-hidden="true"><GripVertical size={14} /></span>
      <AgentIcon tool={rc.tool} provider={prov} legacy={rc.legacy} size={28} />
      <span className="m13-cap-main"><b>{rc.name}{rc.default && <Pill tone="ok"><Star size={11} />默认</Pill>}{rc.loggedOut && <Pill tone="warn">已退出登录</Pill>}{prov?.needKey && <Pill tone="warn">供应商需要 Key</Pill>}{missingTool && <Pill tone="warn">{AGENTS[rc.tool]} 未安装</Pill>}{m?.offline && <Pill tone="warn">默认模型已下线，请改选</Pill>}{rc.legacy && <Pill>旧配置</Pill>}</b>
        <small>{sub}</small></span>
      <span className="m13-home-toggle" title={visTitle}><span>首页</span><Switch on={!!rc.visible && !rc.loggedOut && !missingTool} label={(rc.visible ? '不在首页显示 ' : '在首页显示 ') + rc.name} disabled={rc.default || rc.loggedOut || missingTool} title={visTitle} onChange={() => ops.toggleVisible(rc)} /></span>
      {menuOf('rc-' + rc.id, rc.name + ' 更多操作', [
        !rc.default && canBeDefault(rc) && !missingTool && ['设为默认', () => ops.setDefault(rc)],
        ['编辑', () => setModal({ type: 'agent', config: rc })],
        !rc.default && idx > (configs[0]?.default ? 1 : 0) && ['上移', () => ops.move(rc, -1)],
        !rc.default && idx < configs.length - 1 && ['下移', () => ops.move(rc, 1)],
        ['删除', () => ops.removeAgent(rc), true],
      ])}
    </div>;
  };

  return <>
    <div className="m10-page-head"><div><h1>智能体</h1><p>智能体＝Code Agent＋订阅或供应商。这里的列表就是首页的智能体下拉，默认的排第一，其余可拖动调整顺序；每次运行按需注入，不修改 CLI 的全局配置。</p></div>
      <div className="m10-head-actions"><button className="m10-button secondary" onClick={() => setModal({ type: 'import' })}><Upload size={14} />导入</button><button className="m10-button secondary" onClick={() => setModal({ type: 'export' })}><Download size={14} />导出</button>
        {view === 'configs' ? <button className="m10-button primary" onClick={() => setModal({ type: 'agent' })}><Plus size={14} />新建智能体</button> : <button className="m10-button primary" onClick={() => setModal({ type: 'catalog' })}><Plus size={14} />添加供应商</button>}</div></div>
    {notice && <div className="m13-alert info m13-model-notice"><Info size={16} /><div><strong>上次 Codex 会话修改了全局默认模型</strong><p>原来是 <code>{notice.before.model}</code>，现在是 <code>{notice.after.model}</code>。这会影响你在终端里直接运行的 Codex。WillYou 不会自动改回。</p><p>需要还原时，打开 <code>~/.codex/config.toml</code>，把对应行改为：</p><pre>{notice.restore.join('\n')}</pre><p className="m13-hint">下次在会话里切换模型时，按 s 只对本次会话生效。</p></div><div className="m13-notice-actions"><button className="m10-button secondary" onClick={() => notify('已复制还原内容（演示）')}><Copy size={14} />复制</button><button className="m10-button secondary" onClick={() => notify('已在默认编辑器中打开（演示）')}><ExternalLink size={14} />打开配置文件</button><button className="m10-button secondary" onClick={() => setNoticeOpen(false)}>知道了</button></div></div>}
    <div className="m10-tabs" role="tablist">{[['configs', '智能体', configs.length], ['providers', '供应商', providers.length]].map(([v, t, n]) => <button key={v} role="tab" aria-selected={view === v} onClick={() => nav('settings/ai/' + v)}>{t}<span className="m13-count">{n}</span></button>)}</div>

    {view === 'configs' && (configs.length ? <div className="m13-agent-list m13-sortable">{configs.map(agentRow)}</div>
      : <div className="m13-empty"><Terminal size={20} /><h3>还没有智能体</h3><p>选一个 Code Agent，再选订阅或供应商。</p><button className="m10-button primary" onClick={() => setModal({ type: 'agent' })}><Plus size={14} />新建智能体</button></div>)}

    {view === 'providers' && <div className="m13-agent-list">{providers.map(p => { const down = scene === 'magpie-down' && p.catalog === 'magpie'; const used = configs.filter(c => c.provider === p.id).length; return <button key={p.id} className="m13-agent-row clickable" data-provider={p.id} onClick={() => setModal({ type: 'provider', id: p.id })}>
      <span className="m13-agent-icon"><ProviderIcon catalog={p.catalog} name={p.name} size={36} /></span>
      <span className="m13-cap-main"><b>{p.name}<Pill>{providerKind(p)}</Pill>{p.needKey && <Pill tone="warn">需要填写 Key</Pill>}{down && <Pill tone="warn">未运行</Pill>}</b>
        <small>{p.models.length} 个模型 · {used ? `${used} 个智能体在用` : '还没有智能体使用'}</small></span>
      <span className="m13-fit"><span className="m13-fit-label">适用</span><FitChips provider={p} /></span>
    </button>; })}<button className="m13-agent-row m13-add-row" onClick={() => setModal({ type: 'catalog' })}><span className="m13-cap-icon big"><Plus size={18} /></span><span className="m13-cap-main"><b>添加供应商</b><small>从目录选择，或填写自定义地址与 Key；Key 与模型可用性保存在供应商上</small></span></button></div>}
  </>;
}

function ExistingOpt({ icon, title, agent, onEdit }) {
  return <div className="m13-prov-opt disabled exists" data-existing={agent.id}><span className="m13-radio-dot" />{icon}<span><b>{title}</b><small>已有“{agent.name}”，同一组合只能有一个；想用更多模型请编辑它</small></span><button className="m13-link" onClick={() => onEdit(agent)}>编辑它</button></div>;
}
// ================= 新建／编辑智能体（P0.13）：① Code Agent → ② 订阅或供应商（按协议过滤）→ ③ 模型，三步联动，不填 Key =================
export function AgentDialog({ initial, preset, copy, store, onClose, onSave, onAddProvider, onEditExisting, onRedetect, onToolPath }) {
  const { providers, setProviders, tools, configs } = store;
  const editing = !!initial && !copy, legacy = initial?.legacy;
  const firstTool = () => initial?.tool || preset?.tool || tools.find(t => t.installed)?.id || 'claude';
  const loginOf = t => { const x = tools.find(y => y.id === t); return x?.installed && x.login !== 'none' ? x.login : null; };
  const taken = (t, id) => existingAgent(configs, t, id, initial?.id);
  const defaultProv = t => { if (preset?.provider && compatible(t, providers.find(p => p.id === preset.provider) || {}).ok && !taken(t, preset.provider)) return preset.provider; if (loginOf(t) && !taken(t, 'login')) return 'login'; return providersForTool(t, providers).compat.find(p => !taken(t, p.id))?.id || null; };
  const [tool, setTool] = useState(firstTool);
  const [prov, setProv] = useState(() => initial ? (initial.source === 'login' ? 'login' : initial.provider) : defaultProv(firstTool()));
  const provider = providers.find(p => p.id === prov);
  const [model, setModel] = useState(() => initial?.model ?? (provider ? recommendedModel(provider, tool) : null));
  const [picked, setPicked] = useState(() => initial && !legacy ? agentModels(initial) : (provider ? [recommendedModel(provider, tool)].filter(Boolean) : []));
  const [name, setName] = useState(initial?.name || ''), [touched, setTouched] = useState(!!initial);
  const [visible, setVisible] = useState(initial ? (initial.default ? true : !!initial.visible) : true);
  const [env, setEnv] = useState(() => initial?.env || []), [args, setArgs] = useState(initial?.args || '');
  const [testing, setTesting] = useState(null);
  const pickTool = t => { setTool(t); const p = defaultProv(t); setProv(p); const pp = providers.find(x => x.id === p); const rm = pp ? recommendedModel(pp, t) : null; setModel(rm); setPicked(rm ? [rm] : []); };
  const pickProv = id => { setProv(id); const pp = providers.find(x => x.id === id); const rm = pp ? recommendedModel(pp, tool) : null; setModel(rm); setPicked(rm ? [rm] : []); };
  const toggleModel = id => setPicked(ps => { const next = ps.includes(id) ? ps.filter(x => x !== id) : [...ps, id]; if (!next.includes(model)) setModel(next[0] || null); if (!model && next.length) setModel(next[0]); return next; });
  const { compat, incompat } = providersForTool(tool, providers);
  const login = prov === 'login', method = loginOf(tool) || initial?.method;
  const options = provider ? modelsFor(provider, tool) : [];
  const hiddenBad = provider ? provider.models.length - options.length : 0;
  const thirdClaude = !legacy && !login && tool === 'claude' && provider;
  // P0.16（审核 N02）：勾选只保留当前可选的模型，默认模型随之校正；Claude 五个档位一律等于默认模型
  const cp = provider ? cleanPicked(provider, tool, picked, model) : { picked: [], model: null };
  const effTiers = thirdClaude ? uniformTiers(cp.model) : undefined;
  const toolReady = tools.find(t => t.id === tool)?.installed !== false;
  const rec = recOf(provider, tool);
  const others = configs.filter(c => c.id !== initial?.id);
  const autoN = legacy ? initial.name : (login || provider) ? agentName(others, tool, login ? null : provider, model, method) : '';
  const effName = touched ? name : autoN;
  const dupName = !legacy && effName.trim() ? nameTaken(configs, effName, initial?.id) : null;
  const dupAgent = !legacy && prov ? taken(tool, prov) : null;
  const ready = legacy || (CODE_AGENTS.find(a => a.id === tool)?.supported && (login ? !!method : !!provider && cp.picked.length > 0 && !!cp.model) && toolReady && !dupName && !dupAgent);
  const save = () => onSave({ ...(initial || {}), id: editing ? initial.id : null, name: effName.trim() || autoN, customName: touched && effName.trim() !== autoN ? true : undefined, tool,
    source: legacy ? 'legacy' : login ? 'login' : 'provider', provider: legacy || login ? null : prov, method: login ? method : undefined, model: legacy || login ? null : cp.model, models: legacy || login ? undefined : [cp.model, ...cp.picked.filter(x => x !== cp.model)], tiers: effTiers, visible, env, args, loggedOut: login ? initial?.loggedOut : undefined, default: editing ? initial.default : false });
  const test = async mid => {
    setTesting(mid);
    const r = isLive(provider) ? (getLiveKey(provider.id) ? await liveClaudeTest(provider.catalog, getLiveKey(provider.id), mid) : { result: 'bad', detail: '原型刷新后不保留 Key，请在供应商详情里重新填写' }) : await new Promise(res => setTimeout(() => res({ result: 'ok' }), 700));
    setTesting(null); setProviders(ps => ps.map(p => p.id === provider.id ? withDetail(applyTest(p, { [tool]: { model: mid, result: r.result } }), mid, r) : p));
  };
  const envEditor = <div className="m13-field"><span>环境变量（秘密值只显示“已加密”，原型不保存秘密原文）</span>
    {env.map((e, i) => <div key={i} className="m13-env-row"><input aria-label="变量名" value={e.key} onChange={ev => setEnv(l => l.map((x, j) => j === i ? { ...x, key: ev.target.value } : x))} /><input aria-label="变量值" value={e.secret ? '' : e.value || ''} placeholder={e.secret ? '已加密，留空不修改' : '值或 ${引用}'} onChange={ev => setEnv(l => l.map((x, j) => j === i ? { ...x, value: ev.target.value, secret: false } : x))} /><button type="button" className="m13-link" onClick={() => setEnv(l => l.filter((_, j) => j !== i))}>删除</button></div>)}
    <button type="button" className="m13-link m13-add-conn" onClick={() => setEnv(l => [...l, { key: '', value: '' }])}><Plus size={13} />添加变量</button></div>;
  const footer = <><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary" disabled={!ready} onClick={save}>{editing ? '保存' : '创建'}</button></>;
  if (legacy) return <Dialog title="编辑智能体" sub={initial.name + ' · 旧配置'} wide onClose={onClose} footer={footer}>
    <div className="m13-alert info"><Info size={16} /><div><p>{initial.legacyNote}。可以继续维护环境变量与启动参数。</p></div></div>
    <label className="m13-field"><span>名称</span><input value={effName} onChange={e => { setTouched(true); setName(e.target.value); }} /></label>
    <div className="m13-field"><span>首页显示</span><span className="m13-switch-row m13-plain"><Switch on={visible} label="在首页显示" disabled={initial.default} onChange={() => setVisible(v => !v)} /><span>{initial.default ? '默认智能体必须在首页显示' : visible ? '在首页的智能体下拉中显示' : '不在首页显示'}</span></span></div>
    {envEditor}<label className="m13-field"><span>附加启动参数</span><input value={args} onChange={e => setArgs(e.target.value)} placeholder="一般不需要填写" /></label>
  </Dialog>;
  return <Dialog title={editing ? '编辑智能体' : copy ? '复制智能体' : '新建智能体'} sub={editing ? initial.name : '选 Code Agent，再选订阅或供应商，最后勾选模型；Key 已保存在供应商上'} wide onClose={onClose} footer={footer}>
    <section className="m13-step" data-step="1"><h3 className="m13-step-h"><i>1</i>Code Agent{editing && <small>编辑时不能更换</small>}</h3>
      <div className="m13-agent-cards" role="radiogroup" aria-label="Code Agent">{CODE_AGENTS.map(a => { const t = tools.find(x => x.id === a.id); const can = a.supported && t?.installed && !(editing && a.id !== tool);
        const state = !a.supported ? '暂不支持' : !t?.installed ? '未检测到 · 安装后重新检测' : `v${t.version} · ${loginState(t)}`;
        return <button key={a.id} role="radio" aria-checked={tool === a.id} disabled={!can} className={'m13-agent-card' + (tool === a.id ? ' selected' : '')} onClick={() => pickTool(a.id)} title={!a.supported ? `${a.name} 暂不支持，后续版本接入` : ''}>
          {a.supported ? <ToolIcon tool={a.id} size={24} /> : <ProviderIcon catalog={'agent-' + a.id} name={a.name} size={24} />}<span><b>{a.name}</b><small>{state}</small></span>{tool === a.id && <Check size={14} className="m13-card-check" />}</button>; })}</div>
      <div className="m13-tool-status" aria-label="本机检测"><span className="m13-ts-label">本机检测</span>{tools.map(t => { const v = store.scene === 'codex-unverified' && t.id === 'codex' ? '0.167.0' : t.version; return <span key={t.id} className="m13-ts-item" data-tool={t.id}><b>{t.name}</b>{!t.installed ? <span className="warn"><TriangleAlert size={12} />未检测到</span> : <span className="m13-checks"><span><Check size={12} />检测到程序</span><span><Check size={12} />程序可启动</span>{t.verified.includes(v) ? <span><Check size={12} />版本已验证</span> : <span className="warn"><TriangleAlert size={12} />未验证版本 {v}，可继续使用</span>}</span>}<button className="m13-link" onClick={() => onToolPath(t)}>自定义路径…</button></span>; })}<button className="m13-link" onClick={onRedetect}>重新检测</button></div></section>
    <section className="m13-step" data-step="2"><h3 className="m13-step-h"><i>2</i>订阅或供应商<small>只列支持 {AGENTS[tool]} 的</small></h3>
      <div className="m13-prov-list" role="radiogroup" aria-label="订阅或供应商">
        {taken(tool, 'login') ? <ExistingOpt icon={<ToolIcon tool={tool} size={22} />} title={LOGIN_LABEL[method || 'subscription']} agent={taken(tool, 'login')} onEdit={onEditExisting} />
          : loginOf(tool) || (initial?.source === 'login') ? <button role="radio" aria-checked={login} className={'m13-prov-opt' + (login ? ' selected' : '')} onClick={() => pickProv('login')}><span className="m13-radio-dot" /><ToolIcon tool={tool} size={22} /><span><b>{LOGIN_LABEL[method || 'subscription']}</b><small>{loginOf(tool) ? LOGIN_DESC[method] : 'CLI 已退出登录，重新登录后可用'}</small></span></button>
          : <div className="m13-prov-opt disabled"><span className="m13-radio-dot" /><ToolIcon tool={tool} size={22} /><span><b>订阅</b><small>{AGENTS[tool]} 未登录。在终端运行 <code>{tool}</code> 登录后即可选择</small></span></div>}
        {compat.map(p => { const sm = providerSummary(p, tool); const ex = taken(tool, p.id); if (ex) return <ExistingOpt key={p.id} icon={<ProviderIcon catalog={p.catalog} name={p.name} size={22} />} title={p.name} agent={ex} onEdit={onEditExisting} />; return <button key={p.id} role="radio" aria-checked={prov === p.id} className={'m13-prov-opt' + (prov === p.id ? ' selected' : '')} onClick={() => pickProv(p.id)} data-provider={p.id}><span className="m13-radio-dot" /><ProviderIcon catalog={p.catalog} name={p.name} size={22} /><span><b>{p.name}{p.needKey && <Pill tone="warn">需要填写 Key</Pill>}</b><small>{sm.text}</small></span></button>; })}
        {incompat.length > 0 && <details className="m13-incompat-list"><summary>不支持 {AGENTS[tool]} 的供应商（{incompat.length}）</summary>{incompat.map(x => <div key={x.provider.id} className="m13-prov-opt disabled"><span className="m13-radio-dot" /><ProviderIcon catalog={x.provider.catalog} name={x.provider.name} size={22} /><span><b>{x.provider.name}</b><small>{x.reason}</small></span></div>)}</details>}
        <button className="m13-link m13-add-conn" onClick={() => onAddProvider(tool)}><Plus size={13} />添加供应商</button>
      </div></section>
    <section className="m13-step" data-step="3"><h3 className="m13-step-h"><i>3</i>模型与名称</h3>
      {login ? <p className="m13-hint m13-plain">使用 {AGENTS[tool]} 自己的默认模型，可在会话里切换。WillYou 拿不到 CLI 的凭据，不能获取模型列表或测试可用性。</p>
        : provider ? <div className="m13-field"><span>模型<small className="m13-field-note">可多选，会话里可以在勾选的模型之间切换；★ 为启动时的默认模型</small></span>
          <div className="m13-model-checks" role="group" aria-label="模型">{options.map(m => { const a = availOf(m, tool), on = cp.picked.includes(m.id); return <div key={m.id} className={'m13-model-check' + (on ? ' on' : '')} data-model={m.id}>
            <label><input type="checkbox" checked={on} onChange={() => toggleModel(m.id)} /><span className="m13-mc-name">{m.name}</span></label>
            {m.id === rec && <Pill tone="info">推荐</Pill>}<Pill tone={availTone(a)}>{testing === m.id ? '测试中…' : AVAIL_LABEL[a]}</Pill>
            {a === 'untested' && testing !== m.id && <button className="m13-link" onClick={() => test(m.id)}>测试</button>}
            <span className="m13-mc-default">{on && (cp.model === m.id ? <span className="m13-mc-star"><Star size={12} />默认</span> : <button className="m13-link" onClick={() => setModel(m.id)}>设为默认</button>)}</span>
          </div>; })}</div>
          {hiddenBad > 0 && <small className="m13-hint">{hiddenBad} 个模型在 {AGENTS[tool]} 中不可用，已隐藏；可在供应商详情里重新测试。</small>}
          {!cp.picked.length && <small className="m13-hint m13-err">至少勾选一个模型。</small>}{!toolReady && <small className="m13-hint m13-err">没有检测到 {AGENTS[tool]}，不能保存。</small>}
        </div> : <p className="m13-hint m13-plain">{compat.every(p => taken(tool, p.id)) && (!loginOf(tool) || taken(tool, 'login')) ? `${AGENTS[tool]} 的订阅和已添加的供应商都已经有智能体了。想用更多模型，点第 2 步里的“编辑它”勾选；或添加新的供应商。` : '先在第 2 步选订阅或供应商。'}</p>}
      {(login || provider) && <>
      <label className="m13-field"><span>名称</span><input aria-label="名称" value={effName} onChange={e => { setTouched(true); setName(e.target.value); }} placeholder={autoN} />{dupName && <small className="m13-hint m13-err">名称已被“{dupName.name}”使用，请换一个。</small>}</label>
      <div className="m13-field"><span>首页显示</span><span className="m13-switch-row m13-plain"><Switch on={visible} label="在首页显示" disabled={initial?.default} onChange={() => setVisible(v => !v)} /><span>{initial?.default ? '默认智能体必须在首页显示' : visible ? '在首页的智能体下拉中显示' : '不在首页显示'}</span></span></div>
      </>}
      {!login && tool === 'codex' && provider && <div className="m13-alert info"><Info size={16} /><div><strong>第三方 Provider 下 Codex 原生插件不可用</strong><p>插件自带的 Skill／MCP 可在“技能”页发现并纳管；新建或重启会话后生效。</p></div></div>}
    </section>
  </Dialog>;
}

// ================= 添加供应商：选择 → 填写 Key 并获取模型 → 完成（P0.13 起不自动生成智能体，完成页提供“用它新建智能体”） =================
const STEPS = ['catalog', 'form', 'done'];
export function CatalogDialog({ store, scene, onClose, onConnect, onOpenProvider, onNewAgent, forTool }) {
  const { providers } = store;
  const [step, setStep] = useState('catalog'), [item, setItem] = useState(null), [query, setQuery] = useState('');
  const [key, setKey] = useState(''), [showKey, setShowKey] = useState(false);
  const [context,setContext]=useState(''),[efforts,setEfforts]=useState(''),[reasoning,setReasoning]=useState('');
  const [cName, setCName] = useState(''), [proto, setProto] = useState('responses'), [url, setUrl] = useState(''), [more, setMore] = useState({}), [detected, setDetected] = useState(null), [demo, setDemo] = useState('ok'), [manual, setManual] = useState('');
  const [result, setResult] = useState(null), [models, setModels] = useState([]), [busy, setBusy] = useState(false), [done, setDone] = useState(null), [err, setErr] = useState('');
  const connected = id => providers.find(p => p.catalog === id);
  const custom = item?.group === 'custom', live = !!item?.live;
  const endpoints = custom ? Object.fromEntries([[proto, url], ...Object.entries(more).filter(([, v]) => v.trim())].filter(([, v]) => v)) : item?.endpoints || {};
  const protocols = Object.keys(endpoints);
  const choose = c => { setErr(''); setItem(c); setKey(c.defaultKey || ''); setResult(null); setStep('form'); };
  const fetchModels = () => {
    setErr('');
    if (custom && !cName.trim()) return setErr('请填写名称');
    if (custom && !url.trim()) return setErr('请填写服务地址');
    if (!key.trim()) return setErr(`请填写${item.keyLabel || 'API 密钥'}`);
    if (item.id === 'magpie' && scene === 'magpie-down') return setErr('Magpie 未运行：无法连接 http://127.0.0.1:3425。请先打开 Magpie。');
    if (live) return (async () => { setBusy('fetch'); const r = await liveModels(item.id, key.trim()); setBusy(false); if (!r.ok) return setErr(r.error); setResult({ models: r.models, note: r.models.length ? null : '网关返回的模型列表为空' }); setModels(r.models.map(m => m.id)); })();
    const r = custom ? (manual.trim() ? { ok: true, models: manual.split(/[,，\s]+/).filter(Boolean).map(id => ({ id, name: id, ctx: '—' })) } : probe(url, key, demo === 'model-fail' || demo === 'partial' || demo === 'tools-fail' ? 'ok' : demo)) : { ok: true, models: item.models };
    if (!r.ok) return setErr(r.error);
    setResult({ models: r.models, note: r.note }); setModels(r.models.map(m => m.id));
  };
  const connectLive = async () => {
    setErr(''); setBusy('connect');
    const k = key.trim(), chosen = result.models.filter(m => models.includes(m.id));
    const probed = await liveProbe(item.id, k);
    let protos = Object.keys(item.endpoints).filter(pr => probed[pr]);
    const rec = (chosen.find(m => m.id === item.recommended) || chosen.find(m => m.id.startsWith(item.recommended || '\0')) || chosen[0])?.id; // 网关的模型 ID 可能带版本后缀
    const tests = {};
    if (protos.includes('anthropic') && rec) { const t = await liveClaudeTest(item.id, k, rec); if (t.protocolMissing) protos = protos.filter(x => x !== 'anthropic'); else tests.claude = { model: rec, result: t.result, detail: t.detail }; }
    setBusy(false);
    if (!protos.length) return setErr('没有可用的协议：网关不支持 Anthropic 与 OpenAI 兼容接口，不会接入。');
    let p = { id: item.id, name: item.name, type: 'preset', catalog: item.id, live: true, url: item.endpoints[protos[0]], endpoints: Object.fromEntries(protos.map(k2 => [k2, item.endpoints[k2]])), protocols: protos, key: 'sk-•••• ' + k.slice(-4), refreshed: '刚刚', recommended: rec, models: chosen.map(m => ({ ...m, avail: {} })) };
    p = applyTest(p, tests); if (tests.claude) p = withDetail(p, tests.claude.model, tests.claude);
    setLiveKey(p.id, k);
    onConnect(p);
    setDone({ provider: p, tests, probed }); setStep('done');
  };
  const connect = () => {
    if (live) return connectLive();
    setErr(''); setBusy(true);
    setTimeout(() => {
      setBusy(false);
      // 接入前用最小流式＋工具调用确认接口（自定义演示：tools-fail 全部失败，partial 只有 Responses 通过；OpenAI 兼容只保存，不确认）
      const passed = protocols.filter(pr => pr === 'openai' || !(custom && (demo === 'tools-fail' || (demo === 'partial' && pr === 'anthropic'))));
      if (!passed.length) return setErr('没有可用的协议：模型列表可读，但最小工具调用失败（400 tools not supported）。这个服务不能作为智能体的模型服务，不会接入。');
      const chosen = models.length ? result.models.filter(m => models.includes(m.id)) : [{ id: manual.trim(), name: manual.trim(), ctx: '—' }];
      let p = { id: custom ? 'custom-' + Math.random().toString(36).slice(2, 6) : item.id, name: custom ? cName.trim() : item.name, type: custom ? 'custom' : 'preset', catalog: custom ? 'custom-' + cName.trim() : item.id, url: endpoints[passed[0]] || url, endpoints: Object.fromEntries(passed.map(k => [k, endpoints[k]])), protocols: passed, key: item.id === 'magpie' ? key : 'sk-•••• ' + key.slice(-4), refreshed: '刚刚', recommended: custom ? chosen[0]?.id : item.recommended, models: chosen.map(m => ({ ...m, avail: {} })) };
      if(custom&&(context||efforts||reasoning)){
        const window=context?Number(context):null,levels=efforts.split(/[,，\s]+/).filter(Boolean);
        if(window!==null&&(!Number.isSafeInteger(window)||window<=0)){setErr('上下文窗口必须是正整数');setBusy(false);return;}
        if(reasoning&&!levels.includes(reasoning)){setErr('默认推理档位必须在支持档位中');setBusy(false);return;}
        p={...p,models:p.models.map(m=>({...m,...(window?{ctx:String(window)}:{}),reasoningLevels:levels,defaultReasoning:reasoning||null}))};
      }
      const tests = autoTest(p, demo === 'model-fail' ? 'tools-fail' : 'ok');
      p = applyTest(p, tests);
      onConnect(p);
      setDone({ provider: p, tests }); setStep('done');
    }, 800);
  };
  const q = query.trim().toLowerCase(), si = STEPS.indexOf(step);
  const title = step === 'catalog' ? '添加供应商' : step === 'done' ? '已添加' : (custom ? cName || '自定义供应商' : item?.name);
  const sub = { catalog: '选择目录中的供应商，或添加自定义供应商', form: custom ? '填写服务地址与 Key，获取模型' : '地址与协议已预填，填写 Key 并获取模型', done: '供应商已保存，可以用它创建智能体' }[step];
  return <Dialog title={title} sub={sub} wide onClose={onClose}
    footer={step === 'catalog' ? <button className="m10-button secondary" onClick={onClose}>取消</button>
      : step === 'done' ? <>{toolsFor(done.provider).length > 0 && <button className="m10-button secondary" onClick={() => onNewAgent({ tool: forTool && toolsFor(done.provider).includes(forTool) ? forTool : toolsFor(done.provider)[0], provider: done.provider.id })}><Plus size={14} />创建智能体</button>}<button className="m10-button primary" onClick={onClose}>完成</button></>
        : <><button className="m10-button secondary m13-foot-left" onClick={() => { setErr(''); setStep('catalog'); }}><ArrowLeft size={14} />返回</button><button className="m10-button secondary" onClick={onClose}>取消</button>
          {!result ? <button className="m10-button primary" disabled={!!busy} onClick={fetchModels}>{busy === 'fetch' ? '获取中…' : '获取模型'}</button> : <button className="m10-button primary" disabled={busy || (!models.length && !manual.trim())} onClick={connect}>{busy ? '正在确认…' : '接入'}</button>}</>}>
    <ol className="m13-steps" aria-label="步骤">{['选择', '填写 Key 并获取模型', '完成'].map((s, i) => <li key={s} className={(si >= i ? 'on' : '') + (si === i ? ' cur' : '')} aria-current={si === i ? 'step' : undefined}><i>{si > i ? <Check size={11} /> : i + 1}</i>{s}</li>)}</ol>
    {step === 'catalog' && <>
      <label className="m10-search m13-cat-search"><Search size={14} /><input aria-label="查找供应商" placeholder="查找供应商" value={query} onChange={e => setQuery(e.target.value)} /></label>
      {CATALOG_GROUPS.map(([g, gt, hint]) => { const items = g === 'custom' ? [{ id: 'custom', group: 'custom', name: '自定义供应商', desc: '填写地址与 Key' }] : CATALOG.filter(c => c.group === g && c.name.toLowerCase().includes(q)).sort((a, b) => forTool ? toolsFor(b).includes(forTool) - toolsFor(a).includes(forTool) : 0); if (!items.length) return null; return <section key={g} className="m13-cat-group"><h3>{gt}<span>{hint}{forTool && g === 'vendor' ? `；适用 ${AGENTS[forTool]} 的排在前面` : ''}</span></h3><div className="m13-cat-grid">
        {items.map(c => { const has = c.group !== 'custom' && connected(c.id); return <button key={c.id} className="m13-cat-item" disabled={!!has} onClick={() => choose(c)}>
          {c.group === 'custom' ? <span className="m13-cap-icon big"><Plus size={16} /></span> : <ProviderIcon catalog={c.id} name={c.name} size={28} />}
          <span><b>{c.name}{has && <i className="m13-dot-ok" aria-label="已接入" />}</b><small>{has ? '已接入' : c.group === 'custom' ? c.desc : `${c.desc} · ${pairingNote(c)}`}</small>{c.verified === false && <small className="m13-unverified">占位，待核实</small>}{c.live && <small className="m13-live-tag">原型中真实接入</small>}</span></button>; })}
      </div></section>; })}
      <p className="m13-hint m13-cat-foot">订阅或 CLI 里登录的 API Key 不需要在这里添加：在终端登录后，新建智能体时可以直接选“订阅”。</p>
    </>}
    {step === 'form' && !custom && <>
      {live && <div className="m13-alert info"><Info size={16} /><div><strong>原型中真实接入</strong><p>这一家会真的请求 SMG 网关：获取模型列表、探测接口，并用推荐模型做一次 Claude Code 工具调用测试（会产生少量用量）。Key 只保存在本页内存，刷新即丢失，不写入任何文件。</p></div></div>}
      {item.verified === false && <div className="m13-alert warn"><Info size={16} /><div><strong>占位数据</strong><p>{item.name} 的地址与协议尚未核实，正式版以官方资料或你提供的信息为准。</p></div></div>}
      <div className="m13-form-grid">
        <span className="m13-form-label">服务地址</span><div>{Object.entries(item.endpoints).map(([k, v]) => <div key={k} className="m13-endpoint"><Pill tone={k === 'openai' ? 'muted' : 'info'}>{PROTOCOL_LABEL_FULL[k]}</Pill><code>{v}</code></div>)}<small className="m13-hint">{pairingNote(item)}</small></div>
        <span className="m13-form-label">{item.keyLabel}</span><div className="m13-key"><input type={showKey ? 'text' : 'password'} aria-label={item.keyLabel} value={key} onChange={e => { setKey(e.target.value); setResult(null); }} placeholder="粘贴 Key，加密保存，只在启动时注入" /><button type="button" className="m13-link" onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}{showKey ? '隐藏' : '显示'}</button></div>
      </div>
    </>}
    {step === 'form' && custom && <div className="m13-form-grid">
      <span className="m13-form-label">名称</span><input className="m13-input" aria-label="名称" value={cName} onChange={e => setCName(e.target.value)} placeholder="例如 我的中转" />
      <span className="m13-form-label">服务地址</span><div>
        <div className="m13-proto-tabs" role="tablist">{PROTOCOL_TABS.map(([k, t]) => <button key={k} role="tab" aria-selected={proto === k} onClick={() => { setProto(k); setDetected(null); }}>{t}</button>)}</div>
        <input className="m13-input" aria-label="服务地址" value={url} onChange={e => { setUrl(e.target.value); setDetected(null); setResult(null); }} placeholder={proto === 'anthropic' ? 'https://…/anthropic' : 'https://…/v1'} />
        <div className="m13-inline-actions"><button className="m10-button secondary m13-row-btn" onClick={() => setDetected(detectProtocols(url))}>检测协议</button>{detected && (detected.ok ? <span className="m13-hint">候选：{detected.candidates.map(c => PROTOCOL_LABEL_FULL[c]).join('、')}（接入时以最小调用确认）</span> : <span className="m13-hint m13-err">{detected.error}</span>)}</div>
        <details className="m13-adv"><summary>更多端点</summary>{PROTOCOL_TABS.filter(([k]) => k !== proto).map(([k, t]) => <label key={k} className="m13-field"><span>{t}</span><input value={more[k] || ''} onChange={e => setMore(m => ({ ...m, [k]: e.target.value }))} placeholder="可选" /></label>)}</details>
        <small className="m13-hint">Codex 需要 OpenAI Responses，Claude Code 需要 Anthropic；只有 OpenAI 兼容时两个工具都不能直接使用。</small></div>
      <span className="m13-form-label">API 密钥</span><div className="m13-key"><input type={showKey ? 'text' : 'password'} aria-label="API 密钥" value={key} onChange={e => { setKey(e.target.value); setResult(null); }} placeholder="粘贴 API 密钥" /><button type="button" className="m13-link" onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}{showKey ? '隐藏' : '显示'}</button></div>
      <span className="m13-form-label">图标</span><div className="m13-inline-actions"><ProviderIcon catalog={'custom-' + cName} name={cName || '?'} size={28} /><span className="m13-hint">默认使用名称首字母</span></div>
      <span className="m13-form-label">模型</span><div><input className="m13-input" aria-label="模型 ID" value={manual} onChange={e => setManual(e.target.value)} placeholder="模型 ID，逗号分隔；留空则从服务获取" /></div>
      <span className="m13-form-label">高级设置</span><details className="m13-adv"><summary>Codex 模型元数据</summary><label className="m13-field"><span>上下文窗口（tokens）</span><input inputMode="numeric" value={context} onChange={e=>setContext(e.target.value)} placeholder="使用目录或通用默认值" /></label><label className="m13-field"><span>支持的推理档位</span><input value={efforts} onChange={e=>setEfforts(e.target.value)} placeholder="例如 low, medium, high" /></label><label className="m13-field"><span>默认推理档位</span><input value={reasoning} onChange={e=>setReasoning(e.target.value)} /></label></details>
      <span className="m13-form-label m13-demo-label">结果</span><select className="m13-select" aria-label="演示结果" value={demo} onChange={e => { setDemo(e.target.value); setResult(null); }}><option value="ok">成功</option><option value="empty">模型列表为空</option><option value="bad-key">Key 无效（401）</option><option value="unreachable">服务不可达</option><option value="partial">只有 Responses 确认通过</option><option value="tools-fail">能列出模型但工具调用失败</option><option value="model-fail">推荐模型在 Claude Code 中测试失败</option></select>
    </div>}
    {step === 'form' && result && <section className="m13-fetched"><h3 className="m13-sub">已获取 {result.models.length} 个模型{result.models.length > 0 && <span>取消勾选的不会接入</span>}</h3>
      {result.models.length ? <div className="m13-checks-list">{result.models.map(m => <label key={m.id}><input type="checkbox" checked={models.includes(m.id)} onChange={e => setModels(ms => e.target.checked ? [...ms, m.id] : ms.filter(x => x !== m.id))} />{m.name}<small>{m.ctx}</small></label>)}</div>
        : <><div className="m13-alert info"><Info size={16} /><div><p>{result.note || '没有获取到模型列表'}，请手动填写模型 ID。</p></div></div><label className="m13-field"><span>模型 ID</span><input value={manual} onChange={e => setManual(e.target.value)} placeholder="例如 acme-coder-large" /></label></>}
      <p className="m13-hint">接入时先用一次最小的流式＋工具调用确认接口，再用推荐模型为每个适用的工具各测试一次，可能产生少量费用。</p></section>}
    {busy && <p className="m13-desc"><RefreshCw size={14} className="m13-spin" /> {busy === 'fetch' ? '正在获取模型列表…' : '正在确认接口并测试推荐模型…'}</p>}
    {err && <div className="m13-alert danger"><TriangleAlert size={16} /><div><p>{err}</p></div></div>}
    {step === 'done' && done && <div className="m13-done">
      <div className="m13-right-head"><ProviderIcon catalog={done.provider.catalog} name={done.provider.name} size={44} /><div><b>{done.provider.name} 已添加</b><small>{pairingNote(done.provider)} · {done.provider.models.length} 个模型</small></div></div>
      {done.probed && <p className="m13-hint m13-probe-line">接口探测：{[['anthropic', 'Anthropic'], ['openai', 'OpenAI 兼容'], ['responses', 'OpenAI Responses']].map(([k, l]) => <span key={k} className={done.probed[k] ? 'ok' : 'no'}>{done.probed[k] ? <Check size={12} /> : '✕'}{l}</span>)}</p>}
      {(() => { const ts2 = toolsFor(done.provider); return <><h3 className="m13-sub">模型（{done.provider.models.length}）</h3>
        <div className="m13-table matrix done-models" role="table" aria-label="模型"><div role="row" className="m13-th"><span>模型</span><span>上下文</span>{ts2.map(t => <span key={t} className="m13-th-tool"><ToolIcon tool={t} size={14} />{AGENTS[t]}</span>)}</div>
          {done.provider.models.map(m => <div role="row" key={m.id} data-model={m.id}><span className="m13-cell-name">{m.name}{recOf(done.provider, ts2[0]) === m.id && <Pill tone="info">推荐</Pill>}</span><span>{m.ctx}</span>{ts2.map(t => { const a = availOf(m, t); return <span key={t} className="m13-cell" title={m.lastTest || ''}><Pill tone={availTone(a)}>{AVAIL_LABEL[a]}</Pill></span>; })}</div>)}</div>
        {!ts2.length && <div className="m13-alert warn"><Info size={16} /><div><p>这个供应商只提供 OpenAI 兼容协议，两个 Code Agent 都不能直接使用。可以把它接入 Magpie，再在这里添加 Magpie。</p></div></div>}
        <p className="m13-hint">已用推荐模型做过一次测试，其他模型可在供应商详情中测试。Key 与测试结果保存在供应商上，创建智能体时不需要再填。</p></>; })()}
    </div>}
  </Dialog>;
}

// ================= 供应商详情：模型 × 工具可用性 =================
export function ProviderDialog({ provider: p, store, scene, onClose, notify, onRemove, onNewAgent }) {
  const { configs, setProviders } = store;
  const [keyEdit, setKeyEdit] = useState(p.needKey ? '' : null), [refreshing, setRefreshing] = useState(false), [confirmDel, setConfirmDel] = useState(false), [ptab, setPtab] = useState('overview');
  const [editingAddress,setEditingAddress]=useState(false),[addresses,setAddresses]=useState({...p.endpoints});
  const refs = configs.filter(c => c.provider === p.id);
  const down = scene === 'magpie-down' && p.catalog === 'magpie';
  const cat = catalogItem(p.catalog), ts = toolsFor(p);
  const patch = fn => setProviders(ps => ps.map(x => x.id === p.id ? fn(x) : x));
  const setAvail = (m, t, v) => patch(x => ({ ...x, models: x.models.map(y => y.id === m.id ? { ...y, avail: { ...(y.avail || {}), [t]: v } } : y) }));
  /** 演示：带 detail 且原来不可用的模型重测仍不可用，其余测试通过。 */
  const live = isLive(p);
  const test = async (m, t) => {
    if (live) {
      const k = getLiveKey(p.id); if (!k) { notify('原型刷新后不保留 Key，请先点“更换”重新填写'); return; }
      setAvail(m, t, 'testing'); const r = await liveClaudeTest(p.catalog, k, m.id);
      patch(x => withDetail({ ...x, models: x.models.map(y => y.id === m.id ? { ...y, avail: { ...(y.avail || {}), [t]: r.result } } : y) }, m.id, r)); return;
    }
    const res = m.detail && m.avail?.[t] === 'bad' ? 'bad' : 'ok'; setAvail(m, t, 'testing'); setTimeout(() => setAvail(m, t, res), 700);
  };
  const untested = p.models.flatMap(m => ts.filter(t => availOf(m, t) === 'untested').map(t => [m, t]));
  const refresh = () => {
    if (live) return (async () => { const k = getLiveKey(p.id); if (!k) { notify('原型刷新后不保留 Key，请先点“更换”重新填写'); return; } setRefreshing(true); const r = await liveModels(p.catalog, k); setRefreshing(false); if (!r.ok) { notify(r.error); return; } const rec = reconcileModels(p.models, r.models); patch(x => ({ ...x, refreshed: '刚刚', models: rec.models })); const hit = refs.filter(a => rec.removed.some(m => (a.models || [a.model]).includes(m.id))); notify([rec.added.length && `新增 ${rec.added.map(e => e.name).join('、')}（未测试）`, rec.removed.length && `已下线 ${rec.removed.map(e => e.name).join('、')}`, hit.length && `${hit.map(a => `“${a.name}”`).join('、')}用到了已下线的模型，请改选`].filter(Boolean).join('；') || '模型列表已刷新：没有变化'); })();
    setRefreshing(true); setTimeout(() => { setRefreshing(false); const extra = p.catalog === 'deepseek' && !p.models.some(m => m.id === 'deepseek-v4-lite') ? [{ id: 'deepseek-v4-lite', name: 'DeepSeek V4 Lite', ctx: '64K', avail: {} }] : []; patch(x => ({ ...x, refreshed: '刚刚', models: [...x.models, ...extra] })); notify(extra.length ? `模型列表已刷新：新增 ${extra.map(e => e.name).join('、')}（未测试）` : '模型列表已刷新：没有变化'); }, 700); };
  const isDefaultOf = (m, t) => refs.some(r => r.tool === t && r.model === m.id);
  const recs = typeof p.recommended === 'object' ? Object.values(p.recommended || {}) : [p.recommended];
  const def = refs.find(r => r.default);
  if (confirmDel) return <Dialog title={`删除 ${p.name}？`} sub="供应商与它的 Key 会一并删除" onClose={() => setConfirmDel(false)} footer={<><button className="m10-button secondary" onClick={() => setConfirmDel(false)}>取消</button><button className="m10-button primary m13-danger-btn" onClick={onRemove}>删除</button></>}>
    {refs.length ? <><p className="m13-desc">使用它的 {refs.length} 个智能体会一起删除：</p><ul className="m13-gen-list">{refs.map(r => <li key={r.id}><ToolIcon tool={r.tool} size={16} /><b>{r.name}</b>{r.default && <Pill tone="ok"><Star size={11} />默认</Pill>}</li>)}</ul>
      {def && <p className="m13-hint">“{def.name}”是默认智能体，删除后默认改为首页显示中的下一个。</p>}<p className="m13-hint">使用过这些智能体的历史任务恢复时会提示重新选择，不会悄悄换成别的账号。</p></> : <p className="m13-desc">还没有智能体使用它。</p>}
  </Dialog>;
  return <Dialog title={p.name} sub={providerKind(p) + (cat?.verified === false ? ' · 占位数据，待核实' : '')} wide onClose={onClose}
    footer={<><button className="m10-button secondary m13-danger-text m13-foot-left" onClick={() => setConfirmDel(true)}>删除</button><button className="m10-button primary" onClick={onClose}>完成</button></>}>
    <div className="m13-right-head"><ProviderIcon catalog={p.catalog} name={p.name} size={44} /><div><b>{p.name}</b><small>{pairingNote(p)}</small></div></div>
    <div className="m10-tabs m13-ptabs" role="tablist">{[['overview', '概览'], ['agents', '智能体', refs.length]].map(([v, t, n]) => <button key={v} role="tab" aria-selected={ptab === v} onClick={() => setPtab(v)}>{t}{n !== undefined && <span className="m13-count">{n}</span>}</button>)}</div>
    {ptab === 'overview' && <>
    {down && <div className="m13-alert warn"><TriangleAlert size={16} /><div><strong>Magpie 未运行</strong><p>启动任务前会先提示，不会让 CLI 卡在重连。请先打开 Magpie。</p></div></div>}
    {p.needKey && <div className="m13-alert warn"><Info size={16} /><div><strong>需要填写 Key</strong><p>这个供应商从导入文件创建，文件里不含 Key。填写后才能启动任务和测试模型。</p></div></div>}
    <dl className="m13-info compact">
      <dt>适用工具</dt><dd className="m13-fit-line"><FitChips provider={p} />{ts.length < 2 && <small className="m13-hint">{TOOL_IDS.filter(t => !ts.includes(t)).map(t => compatible(t, p).reason).join('；')}</small>}</dd>
      <dt>服务地址</dt><dd>{editingAddress?<><div className="m13-form-grid">{Object.keys(PROTOCOL_LABEL_FULL).map(k=><label key={k} className="m13-field"><span>{PROTOCOL_LABEL_FULL[k]}</span><input aria-label={PROTOCOL_LABEL_FULL[k]+' 地址'} value={addresses[k]||''} onChange={e=>setAddresses(a=>({...a,[k]:e.target.value}))}/></label>)}</div><button className="m10-button secondary m13-row-btn" onClick={()=>{const next=Object.fromEntries(Object.entries(addresses).filter(([,v])=>v.trim()));if(!Object.keys(next).length)return notify('至少填写一个服务地址');try{for(const v of Object.values(next)){const u=new URL(v);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error();}}catch{return notify('请填写不含凭据的 HTTP(S) 地址');}patch(x=>({...x,endpoints:next,protocols:Object.keys(next),url:Object.values(next)[0],rev:(x.rev||0)+(JSON.stringify(x.endpoints)!==JSON.stringify(next)?1:0)}));setEditingAddress(false);notify('地址已保存（原型合成数据）');}}>保存地址</button><button className="m13-link" onClick={()=>setEditingAddress(false)}>取消</button></>:<>{Object.entries(p.endpoints || { [p.protocols[0]]: p.url }).map(([k,v])=><div key={k} className="m13-endpoint"><Pill tone={k==='openai'?'muted':'info'}>{PROTOCOL_LABEL_FULL[k]}</Pill><code>{v}</code></div>)}<button className="m13-link" onClick={()=>{setAddresses({...p.endpoints});setEditingAddress(true);}}>编辑地址</button></>}</dd>
      <dt>Key</dt><dd>{keyEdit === null ? <><code>{p.key || '未填写'}</code><button className="m13-link" onClick={() => setKeyEdit('')}>{p.key ? '更换' : '填写'}</button></> : <span className="m13-inline-edit"><input type="password" aria-label="新的 Key" value={keyEdit} onChange={e => setKeyEdit(e.target.value)} placeholder="加密保存，只在启动时注入" /><button className="m10-button secondary m13-row-btn" disabled={!keyEdit.trim()} onClick={() => { if (live) setLiveKey(p.id, keyEdit.trim()); patch(x => applyProviderKey(x, keyEdit)); setKeyEdit(null); notify('Key 已更新（原型只保留脱敏后四位）'); }}>保存</button>{!p.needKey && <button className="m13-link" onClick={() => setKeyEdit(null)}>取消</button>}</span>}</dd>
      <dt>模型目录</dt><dd>{p.refreshed} 刷新 · 每次启动任务前自动比对<button className="m13-link" disabled={refreshing || down} onClick={refresh}>{refreshing ? '刷新中…' : '刷新模型'}</button></dd></dl>
    <h3 className="m13-sub m13-sub-row">模型在各工具中的可用性{untested.length > 0 && <button className="m13-link" disabled={down || p.needKey} onClick={() => untested.forEach(([m, t]) => test(m, t))}>测试全部未测试（{untested.length}）</button>}</h3>
    <div className="m13-table matrix" role="table" aria-label="模型可用性"><div role="row" className="m13-th"><span>模型</span><span>上下文</span>{TOOL_IDS.map(t => <span key={t} className="m13-th-tool"><ToolIcon tool={t} size={14} />{AGENTS[t]}</span>)}</div>
      {p.models.map(m => <div role="row" key={m.id} data-model={m.id}><span className="m13-cell-name">{m.name}{recs.includes(m.id) && <Pill tone="info">推荐</Pill>}</span><span>{m.ctx}</span>
        {TOOL_IDS.map(t => { if (!ts.includes(t)) return <span key={t} className="m13-cell-na" title={compatible(t, p).reason}>—</span>; const a = availOf(m, t); return <span key={t} className="m13-cell" data-tool={t} data-avail={a} title={m.lastTest || (a === 'bad' ? m.detail || '' : '')}><Pill tone={availTone(a)}>{AVAIL_LABEL[a]}</Pill>{isDefaultOf(m, t) && <Star size={12} className="m13-star" aria-label="默认模型" />}{a !== 'ok' && a !== 'testing' && <button className="m13-link" disabled={down || p.needKey} onClick={() => test(m, t)}>{a === 'bad' ? '重测' : '测试'}</button>}</span>; })}</div>)}</div>
    <p className="m13-hint">★ 是对应智能体的默认模型；“—”表示供应商没有这个工具需要的接口。测试会发起一次最小的流式＋工具调用，可能产生少量费用，结果按工具分别保留。能列出的模型不一定能调用。</p>
    </>}
    {ptab === 'agents' && <>
      {refs.length ? <ul className="m13-gen-list">{refs.map(r => <li key={r.id}><ToolIcon tool={r.tool} size={16} /><b>{r.name}</b><small>{modelName(p, r.model)}{r.visible ? '' : ' · 不在首页显示'}</small>{r.default && <Pill tone="ok"><Star size={11} />默认</Pill>}</li>)}</ul> : <p className="m13-hint">还没有智能体使用这个供应商。</p>}
      {ts.filter(t => !refs.some(r => r.tool === t)).map(t => <button key={t} className="m10-button secondary m13-regen" disabled={p.needKey} onClick={() => onNewAgent({ tool: t, provider: p.id })}><Plus size={14} />用它创建 {AGENTS[t]} 智能体</button>)}
      {ts.length > 0 && ts.every(t => refs.some(r => r.tool === t)) && <p className="m13-hint">适用的 Code Agent 都已经有智能体了，想用更多模型请编辑对应的智能体。</p>}
    </>}
  </Dialog>;
}

export function ToolPathDialog({ tool, onClose, onSave }) {
  const [path, setPath] = useState(tool.path), [err, setErr] = useState('');
  return <Dialog title="自定义可执行路径" sub={tool.name + ' · 高级'} onClose={onClose} footer={<><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary" onClick={() => { const r = checkToolPath(path); if (!r.ok) setErr(r.error); else onSave(path.trim()); }}>检测并保存</button></>}>
    <label className="m13-field"><span>可执行文件</span><input value={path} onChange={e => { setPath(e.target.value); setErr(''); }} /></label>
    {err && <div className="m13-alert danger"><TriangleAlert size={16} /><div><p>{err}，未保存。</p></div></div>}
    <p className="m13-hint">一般不需要修改。WillYou 会检测该文件能否启动并读取版本（原型中路径含“missing”视为不存在，以 .txt 结尾视为不可执行）。</p>
  </Dialog>;
}
