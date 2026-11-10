// M13 原型 P0.6：Code Agent 配置（需求 2026-11-11 补记）。替换 P0.5 的“AI 配置”页面：
// 页签 Code Agent／供应商／本机工具；通用供应商目录（原有登录、供应商、自定义）；接入表单参考 Magpie“自定义供应商”；
// 新建 Code Agent 为两栏弹窗，并支持在供应商上一键搭配工具。全部为合成数据，不发网络请求、不保存秘密原文。
import React, { useState } from 'react';
import { X, ArrowLeft, Check, CircleCheck, CircleDashed, Copy, Download, Eye, EyeOff, ExternalLink, Info, Plus, RefreshCw, Search, Star, Terminal, TriangleAlert, Upload } from 'lucide-react';
import { AGENTS, CATALOG, CATALOG_GROUPS, CLAUDE_TIERS, PROTOCOL_LABEL_FULL, PROTOCOL_TABS, autoName, catalogItem, checkToolPath, detectProtocols, globalModelNotice, pairingNote, probe, rebuildTiers, runNotes, tiersValid, toolsFor } from './m13-model.mjs';
import { ProviderIcon } from './m13-icons.jsx';
import { Dialog, Menu, Pill } from './m13-ui.jsx';

const toolIcon = t => <ProviderIcon catalog={t === 'claude' ? 'native-claude' : 'native-codex'} size={16} />;
const providerKind = p => p.type === 'native' ? '原有登录' : p.type === 'custom' ? '自定义' : '目录';
function ToolChips({ provider, size = 'sm' }) {
  const ts = toolsFor(provider);
  return <span className={'m13-toolchips ' + size}>{ts.length ? ts.map(t => <span key={t} className="m13-toolchip">{toolIcon(t)}{AGENTS[t]}</span>) : <span className="m13-toolchip none"><TriangleAlert size={12} />需经网关</span>}</span>;
}
/** 由供应商与工具生成 Code Agent（一键搭配与新建共用）。 */
export function makeAgent(provider, tool, extra = {}) {
  const model = provider.type === 'native' ? null : provider.models?.find(m => m.status !== 'rejected')?.id || null;
  return { id: 'rc-' + Math.random().toString(36).slice(2, 8), name: autoName(tool, provider), tool, provider: provider.id, model, tiers: tool === 'claude' && provider.type !== 'native' ? rebuildTiers(provider, model) : undefined, env: [], args: '', ...extra };
}

// ================= 主页面 =================
export function CodeAgentConfig({ store, tab, nav, scene, setModal, notify, menu, setMenu }) {
  const { providers, configs, setConfigs, tools } = store;
  const [noticeOpen, setNoticeOpen] = useState(true);
  const notice = scene === 'model-changed' && noticeOpen ? globalModelNotice({ model: 'gpt-5.5', effort: 'high' }, { model: 'deepseek-v4-pro', effort: 'high' }) : null;
  const primary = tab === 'configs' ? <button className="m10-button primary" onClick={() => setModal({ type: 'agent' })}><Plus size={14} />新建 Code Agent</button>
    : tab === 'providers' ? <button className="m10-button primary" onClick={() => setModal({ type: 'catalog' })}><Plus size={14} />接入供应商</button> : null;
  return <>
    <div className="m10-page-head"><div><h1>Code Agent 配置</h1><p>选一个供应商，再搭配 Codex 或 Claude Code，就是一个可以在首页直接选择的 Code Agent。每次运行按需注入，不修改 CLI 的全局配置。</p></div>
      <div className="m10-head-actions"><button className="m10-button secondary" onClick={() => setModal({ type: 'import' })}><Upload size={14} />导入</button><button className="m10-button secondary" onClick={() => setModal({ type: 'export' })}><Download size={14} />导出</button>{primary}</div></div>
    {notice && <div className="m13-alert info m13-model-notice"><Info size={16} /><div><strong>上次 Codex 会话修改了全局默认模型</strong><p>原来是 <code>{notice.before.model}</code>，现在是 <code>{notice.after.model}</code>。这会影响你在终端里直接运行的 Codex。WillYou 不会自动改回。</p><p>需要还原时，打开 <code>~/.codex/config.toml</code>，把对应行改为：</p><pre>{notice.restore.join('\n')}</pre><p className="m13-hint">下次在会话里切换模型时，按 s 只对本次会话生效。</p></div><div className="m13-notice-actions"><button className="m10-button secondary" onClick={() => notify('已复制还原内容（演示）')}><Copy size={14} />复制</button><button className="m10-button secondary" onClick={() => notify('已在默认编辑器中打开（演示）')}><ExternalLink size={14} />打开配置文件</button><button className="m10-button secondary" onClick={() => setNoticeOpen(false)}>知道了</button></div></div>}
    <div className="m10-tabs" role="tablist">{[['configs', 'Code Agent', configs.length], ['providers', '供应商', providers.length], ['tools', '本机工具', tools.length]].map(([v, t, n]) => <button key={v} role="tab" aria-selected={tab === v} onClick={() => nav('m13/ai/' + v)}>{t}<span className="m13-count">{n}</span></button>)}</div>

    {tab === 'configs' && (configs.length ? <div className="m13-agent-list">{configs.map(rc => { const prov = providers.find(p => p.id === rc.provider); return <div key={rc.id} className="m13-agent-row">
      <span className="m13-agent-icon">{prov ? <ProviderIcon catalog={prov.catalog} name={prov.name} size={36} /> : <span className="m13-cap-icon big"><Terminal size={18} /></span>}{prov?.type !== 'native' && <span className="m13-agent-tool" title={AGENTS[rc.tool]}>{toolIcon(rc.tool)}</span>}</span>
      <span className="m13-cap-main"><b>{rc.name}{rc.default && <Pill tone="ok"><Star size={11} />默认</Pill>}{rc.legacy && <Pill>高级配置</Pill>}{rc.broken && <Pill tone="warn">供应商已删除</Pill>}{prov?.needKey && <Pill tone="warn">供应商需要 Key</Pill>}</b>
        <small>{rc.legacy ? `${AGENTS[rc.tool]} · 保留原环境变量与参数` : prov?.type === 'native' ? `${prov.name} · 使用 CLI 默认模型` : `${AGENTS[rc.tool]} · ${prov ? prov.name : '需要重新选择供应商'} · ${rc.model || 'CLI 默认模型'}`}</small>
        {rc.legacy && <small className="m13-cap-scope">{rc.legacyNote}</small>}</span>
      <Menu open={menu === 'rc-' + rc.id} onToggle={() => setMenu(menu === 'rc-' + rc.id ? null : 'rc-' + rc.id)} label={rc.name + ' 更多操作'} items={[['编辑', () => { setMenu(null); setModal({ type: 'agent', config: rc }); }], !rc.default && ['设为默认', () => { setMenu(null); setConfigs(cs => cs.map(c => ({ ...c, default: c.id === rc.id }))); notify(`${rc.name} 已设为默认，首页优先选择它`); }], ['复制', () => { setMenu(null); setConfigs(cs => [...cs, { ...rc, id: 'rc-' + Math.random().toString(36).slice(2, 8), name: rc.name + ' 副本', default: false }]); notify('已复制'); }], !rc.default && ['删除', () => { setMenu(null); setConfigs(cs => cs.filter(c => c.id !== rc.id)); notify('已删除；使用过它的历史任务恢复时会提示重新选择'); }, true]]} />
    </div>; })}</div> : <div className="m13-empty"><Terminal size={20} /><h3>还没有 Code Agent</h3><p>先接入一个供应商，再搭配 Codex 或 Claude Code。</p><button className="m10-button primary" onClick={() => setModal({ type: 'agent' })}><Plus size={14} />新建 Code Agent</button></div>)}

    {tab === 'providers' && <div className="m13-agent-list">{providers.map(p => { const down = scene === 'magpie-down' && p.catalog === 'magpie'; const used = configs.filter(c => c.provider === p.id).length; return <button key={p.id} className="m13-agent-row clickable" onClick={() => setModal({ type: 'provider', id: p.id })}>
      <span className="m13-agent-icon"><ProviderIcon catalog={p.catalog} name={p.name} size={36} /></span>
      <span className="m13-cap-main"><b>{p.name}<Pill>{providerKind(p)}</Pill>{p.needKey && <Pill tone="warn">需要填写 Key</Pill>}{down && <Pill tone="warn">未运行</Pill>}</b>
        <small>{p.type === 'native' ? p.note : `${p.models.length} 个模型 · ${used ? `被 ${used} 个 Code Agent 使用` : '尚未搭配'}`}</small></span>
      <ToolChips provider={p} />
    </button>; })}<button className="m13-agent-row m13-add-row" onClick={() => setModal({ type: 'catalog' })}><span className="m13-cap-icon big"><Plus size={18} /></span><span className="m13-cap-main"><b>接入供应商</b><small>从目录选择，或填写自定义地址与 Key</small></span></button></div>}

    {tab === 'tools' && <div className="m13-agent-list">{tools.map(t => { const version = scene === 'codex-unverified' && t.id === 'codex' ? '0.167.0' : t.version; const ok = t.verified.includes(version); return <div key={t.id} className="m13-agent-row tool">
      <span className="m13-agent-icon">{<ProviderIcon catalog={t.id === 'claude' ? 'native-claude' : 'native-codex'} size={36} />}</span>
      <span className="m13-cap-main"><b>{t.name}<span className="m10-package-version">{version}</span></b><small><code>{t.path}</code></small>
        <span className="m13-checks"><span><Check size={12} />检测到程序</span><span><Check size={12} />程序可启动</span>{ok ? <span><Check size={12} />版本已验证</span> : <span className="warn"><TriangleAlert size={12} />未验证版本，可继续使用</span>}<span className="muted"><CircleDashed size={12} />模型连接在 Code Agent 中测试</span></span></span>
      <div className="m13-item-actions"><button className="m10-button secondary" onClick={() => notify(`${t.name} 已重新检测`)}>重新检测</button><Menu open={menu === 'tool-' + t.id} onToggle={() => setMenu(menu === 'tool-' + t.id ? null : 'tool-' + t.id)} label={t.name + ' 更多操作'} items={[['自定义路径…', () => { setMenu(null); setModal({ type: 'tool-path', tool: t }); }]]} /></div>
    </div>; })}</div>}
  </>;
}

// ================= 新建／编辑 Code Agent（两栏） =================
export function CodeAgentDialog({ initial, store, scene, onClose, onSave, onConnect }) {
  const { providers } = store;
  const legacy = initial?.legacy;
  const [prov, setProv] = useState(initial?.provider || providers.find(p => toolsFor(p).length)?.id || null);
  const provider = providers.find(p => p.id === prov);
  const [tool, setTool] = useState(initial?.tool || (provider ? toolsFor(provider)[0] : 'claude'));
  const [model, setModel] = useState(initial?.model ?? (provider?.models?.find(m => m.status !== 'rejected')?.id || null));
  const [tiers, setTiers] = useState(() => initial?.tiers || {});
  const [name, setName] = useState(initial?.name || ''), [touched, setTouched] = useState(!!initial);
  const [env, setEnv] = useState(() => initial?.env || []), [args, setArgs] = useState(initial?.args || '');
  const [query, setQuery] = useState(''), [testRes, setTestRes] = useState(null);
  const tools = provider ? toolsFor(provider) : [];
  const okTool = provider && tools.includes(tool);
  const thirdClaude = !legacy && tool === 'claude' && provider && provider.type !== 'native';
  const effTiers = thirdClaude ? rebuildTiers(provider, model, tiers) : undefined;
  const tierOk = !thirdClaude || tiersValid(provider, effTiers);
  const effName = touched ? name : provider && okTool ? autoName(tool, provider) : '';
  const pick = p => { setProv(p.id); const ts = toolsFor(p); if (!ts.includes(tool)) setTool(ts[0] || tool); setModel(p.type === 'native' ? null : p.models?.find(m => m.status !== 'rejected')?.id || null); setTiers({}); setTestRes(null); };
  const runTest = () => { setTestRes('testing'); setTimeout(() => setTestRes(provider.type === 'native' ? { ok: true, text: `使用 ${AGENTS[tool]} 的原有登录，按 CLI 自身登录状态运行` } : provider.needKey ? { ok: false, text: '这个供应商还没有 Key' } : scene === 'magpie-down' && provider.catalog === 'magpie' ? { ok: false, text: 'Magpie 未运行，无法连接' } : { ok: true, text: `流式与工具调用正常 · ${model}（演示）。测试会发起一次最小调用，可能产生少量费用` }), 700); };
  const save = () => onSave({ ...(initial || {}), id: initial?.id || 'rc-' + Math.random().toString(36).slice(2, 8), name: effName || '未命名 Code Agent', tool, provider: legacy ? null : prov, model: legacy || provider?.type === 'native' ? null : model, tiers: effTiers, env, args, broken: false });
  const envEditor = <div className="m13-field"><span>环境变量（秘密值只显示“已加密”，原型不保存秘密原文）</span>
    {env.map((e, i) => <div key={i} className="m13-env-row"><input aria-label="变量名" value={e.key} onChange={ev => setEnv(l => l.map((x, j) => j === i ? { ...x, key: ev.target.value } : x))} /><input aria-label="变量值" value={e.secret ? '' : e.value || ''} placeholder={e.secret ? '已加密，留空不修改' : '值或 ${引用}'} onChange={ev => setEnv(l => l.map((x, j) => j === i ? { ...x, value: ev.target.value, secret: false } : x))} /><button type="button" className="m13-link" onClick={() => setEnv(l => l.filter((_, j) => j !== i))}>删除</button></div>)}
    <button type="button" className="m13-link m13-add-conn" onClick={() => setEnv(l => [...l, { key: '', value: '' }])}><Plus size={13} />添加变量</button></div>;
  if (legacy) return <Dialog title="编辑 Code Agent" sub={initial.name + ' · 高级配置'} wide onClose={onClose} footer={<><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary" onClick={save}>保存</button></>}>
    <div className="m13-alert info"><Info size={16} /><div><p>{initial.legacyNote}。可以继续维护环境变量与启动参数；如需拆成供应商＋工具，可新建 Code Agent。</p></div></div>
    <label className="m13-field"><span>名称</span><input value={effName} onChange={e => { setTouched(true); setName(e.target.value); }} /></label>
    <div className="m13-field"><span>工具</span><div className="m13-seg">{['claude', 'codex'].map(t => <button key={t} aria-pressed={tool === t} onClick={() => setTool(t)}>{toolIcon(t)}{AGENTS[t]}</button>)}</div></div>
    {envEditor}<label className="m13-field"><span>附加启动参数</span><input value={args} onChange={e => setArgs(e.target.value)} placeholder="一般不需要填写" /></label>
  </Dialog>;
  const list = providers.filter(p => (p.name + (p.url || '')).toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="m13-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="m13-dialog m13-agent-dialog" role="dialog" aria-modal="true" aria-label={initial ? '编辑 Code Agent' : '新建 Code Agent'}>
    <div className="m13-dialog-head"><div><h2>{initial ? '编辑 Code Agent' : '新建 Code Agent'}</h2><p>选一个供应商，再搭配工具。</p></div><button type="button" className="m10-icon" aria-label="关闭" onClick={onClose}><X size={16} /></button></div>
    <div className="m13-agent-panes">
      <aside className="m13-agent-left">
        <label className="m10-search m13-pane-search"><Search size={14} /><input aria-label="搜索供应商" placeholder="搜索供应商" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <div className="m13-pane-list" role="listbox" aria-label="供应商">{list.map(p => <button key={p.id} role="option" aria-selected={prov === p.id} className={'m13-pane-item' + (prov === p.id ? ' selected' : '')} onClick={() => pick(p)}>
          <ProviderIcon catalog={p.catalog} name={p.name} size={28} /><span><b>{p.name}</b><small>{pairingNote(p)}</small></span>{p.needKey && <TriangleAlert size={13} className="m13-warn-ic" />}</button>)}
          {!list.length && <p className="m13-hint m13-pad">没有匹配的供应商</p>}</div>
        <button className="m13-pane-add" onClick={onConnect}><Plus size={14} />接入新供应商</button>
      </aside>
      <section className="m13-agent-right">{!provider ? <div className="m13-empty"><Info size={20} /><h3>从左侧选择供应商</h3><p>还没有合适的？点“接入新供应商”。</p></div> : <>
        <div className="m13-right-head"><ProviderIcon catalog={provider.catalog} name={provider.name} size={36} /><div><b>{provider.name}</b><small>{provider.type === 'native' ? provider.note : Object.entries(provider.endpoints || {}).map(([k, v]) => `${PROTOCOL_LABEL_FULL[k]}：${v}`).join(' · ')}</small></div></div>
        {provider.needKey && <div className="m13-alert warn"><Info size={16} /><div><p>这个供应商还没有 Key，保存后要先在供应商详情里填写，才能启动任务。</p></div></div>}
        <div className="m13-field"><span>工具</span><div className="m13-seg">{['claude', 'codex'].map(t => { const ok = tools.includes(t); return <button key={t} aria-pressed={tool === t} disabled={!ok} title={ok ? '' : `${provider.name} 不提供 ${t === 'codex' ? 'OpenAI Responses' : 'Anthropic'} 协议`} onClick={() => { setTool(t); setTestRes(null); }}>{toolIcon(t)}{AGENTS[t]}{!ok && <small>不可用</small>}</button>; })}</div>
          {!tools.length && <small className="m13-hint">{provider.name} 只提供 OpenAI 兼容协议，两个工具都不能直接使用；可经 Magpie 等网关接入。</small>}
          {tools.length === 1 && provider.type !== 'native' && <small className="m13-hint">{provider.name} 只提供 {PROTOCOL_LABEL_FULL[provider.protocols.find(x => x !== 'openai')]} 协议，只能搭配 {AGENTS[tools[0]]}。</small>}</div>
        {okTool && (provider.type === 'native' ? <div className="m13-field"><span>模型</span><p className="m13-hint m13-plain">使用 {AGENTS[tool]} 自己的默认模型，可在会话里切换。</p></div>
          : <label className="m13-field"><span>默认模型</span><select className="m13-select" value={model || ''} onChange={e => { setModel(e.target.value); setTestRes(null); }}>{provider.models.map(m => <option key={m.id} value={m.id} disabled={m.status === 'rejected'}>{m.name}{m.status === 'rejected' ? '（调用被拒绝）' : m.status === 'untested' ? '（未测试）' : ''}</option>)}</select></label>)}
        {okTool && <label className="m13-field"><span>名称</span><input value={effName} onChange={e => { setTouched(true); setName(e.target.value); }} /></label>}
        {okTool && <ul className="m13-notes">{runNotes({ tool, provider: prov }, provider).map(n => <li key={n}><Info size={13} />{n}</li>)}</ul>}
        {okTool && <details className="m13-adv"><summary>高级设置</summary>
          {thirdClaude && <><p className="m13-hint">Claude Code 的各档位只能选 {provider.name} 的模型，更换供应商时会重新设置。</p><div className="m13-tiers">{CLAUDE_TIERS.map(([k, label]) => <label key={k} className="m13-field"><span>{label}</span><select className="m13-select" value={effTiers[k]} onChange={e => setTiers(t => ({ ...rebuildTiers(provider, model, t), [k]: e.target.value }))}>{provider.models.filter(m => m.status !== 'rejected').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>)}</div></>}
          {envEditor}<label className="m13-field"><span>附加启动参数</span><input value={args} onChange={e => setArgs(e.target.value)} placeholder="一般不需要填写" /></label></details>}
        {testRes && testRes !== 'testing' && <div className={'m13-alert ' + (testRes.ok ? 'info' : 'danger')}>{testRes.ok ? <CircleCheck size={16} /> : <TriangleAlert size={16} />}<div><p>{testRes.text}</p></div></div>}
        {!tierOk && <div className="m13-alert danger"><TriangleAlert size={16} /><div><p>有档位使用了不属于 {provider.name} 的模型，请在高级设置中重新选择。</p></div></div>}
      </>}</section>
    </div>
    <div className="m13-dialog-foot"><button className="m10-button secondary m13-foot-left" disabled={!okTool || testRes === 'testing'} onClick={runTest}>{testRes === 'testing' ? '测试中…' : '测试连接'}</button><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary" disabled={!okTool || !tierOk} onClick={save}>保存</button></div>
  </div></div>;
}

// ================= 接入供应商：目录 → 表单 → 模型 → 确认 → 完成（可一键搭配） =================
export function CatalogDialog({ store, scene, onClose, onSaved, onPair }) {
  const { providers } = store;
  const [step, setStep] = useState('catalog'), [item, setItem] = useState(null), [query, setQuery] = useState('');
  const [key, setKey] = useState(''), [showKey, setShowKey] = useState(false);
  const [cName, setCName] = useState(''), [proto, setProto] = useState('responses'), [url, setUrl] = useState(''), [more, setMore] = useState({}), [detected, setDetected] = useState(null), [demo, setDemo] = useState('ok'), [manual, setManual] = useState('');
  const [result, setResult] = useState(null), [models, setModels] = useState([]), [confirm, setConfirm] = useState(null), [saved, setSaved] = useState(null), [err, setErr] = useState('');
  const connected = id => providers.find(p => p.catalog === id);
  const custom = item?.group === 'custom';
  const endpoints = custom ? Object.fromEntries([[proto, url], ...Object.entries(more).filter(([, v]) => v.trim())].filter(([, v]) => v)) : item?.endpoints || {};
  const protocols = Object.keys(endpoints);
  const choose = c => {
    setErr(''); setItem(c);
    if (c.group === 'native') { if (connected(c.id)) return; const p = { id: c.id, name: c.name, type: 'native', catalog: c.id, tool: c.tool, note: c.desc + '，WillYou 不读取凭据' }; setSaved(p); onSaved(p); setStep('done'); return; }
    setKey(c.defaultKey || ''); setStep('form');
  };
  const fetchModels = () => {
    setErr('');
    if (custom && !cName.trim()) return setErr('请填写名称');
    if (custom && !url.trim()) return setErr('请填写服务地址');
    if (!key.trim()) return setErr(`请填写${item.keyLabel || 'API 密钥'}`);
    if (item.id === 'magpie' && scene === 'magpie-down') return setErr('Magpie 未运行：无法连接 http://127.0.0.1:3425。请先打开 Magpie。');
    const r = custom ? (manual.trim() ? { ok: true, models: manual.split(/[,，\s]+/).filter(Boolean).map(id => ({ id, name: id, ctx: '—' })) } : probe(url, key, demo)) : { ok: true, models: item.models };
    if (!r.ok) return setErr(r.error);
    setResult({ models: r.models, note: r.note }); setModels(r.models.map(m => m.id)); setStep('models');
  };
  const runConfirm = () => { setStep('confirm'); setConfirm('testing'); setTimeout(() => setConfirm(Object.fromEntries(protocols.map(pr => [pr, pr === 'openai' ? 'n/a' : !(custom && (demo === 'tools-fail' || (demo === 'partial' && pr === 'anthropic')))]))), 800); };
  const passed = confirm && confirm !== 'testing' ? protocols.filter(pr => confirm[pr] === true) : [];
  const finish = () => {
    const keep = [...passed, ...(protocols.includes('openai') ? ['openai'] : [])];
    const p = { id: custom ? 'custom-' + Math.random().toString(36).slice(2, 6) : item.id, name: custom ? cName.trim() : item.name, type: custom ? 'custom' : 'preset', catalog: custom ? 'custom-' + cName.trim() : item.id, url: endpoints[keep[0]] || url, endpoints: Object.fromEntries(keep.map(k => [k, endpoints[k]])), protocols: keep, key: item.id === 'magpie' ? key : 'sk-•••• ' + key.slice(-4), refreshed: '刚刚', models: (models.length ? result.models.filter(m => models.includes(m.id)) : [{ id: manual, name: manual, ctx: '—' }]).map(m => ({ ...m, status: 'ok' })) };
    setSaved(p); onSaved(p); setStep('done');
  };
  const back = { form: 'catalog', models: 'form', confirm: 'models' }[step];
  const q = query.trim().toLowerCase();
  return <Dialog title={step === 'catalog' ? '接入供应商' : step === 'done' ? '已接入' : (custom ? cName || '自定义供应商' : item?.name)} sub={{ catalog: '选择目录中的供应商，或添加自定义供应商', form: custom ? '填写服务地址与 Key' : '地址与协议已预填，填写 Key 即可', models: '选择要接入的模型', confirm: '确认可用', done: '可以直接搭配工具生成 Code Agent' }[step]} wide onClose={onClose}
    footer={step === 'catalog' ? <button className="m10-button secondary" onClick={onClose}>取消</button>
      : step === 'done' ? <button className="m10-button primary" onClick={onClose}>完成</button>
        : <><button className="m10-button secondary m13-foot-left" onClick={() => { setErr(''); setStep(back); }}><ArrowLeft size={14} />返回</button><button className="m10-button secondary" onClick={onClose}>取消</button>
          {step === 'form' && <button className="m10-button primary" onClick={fetchModels}>获取模型</button>}
          {step === 'models' && <button className="m10-button primary" disabled={!models.length && !manual.trim()} onClick={runConfirm}>下一步</button>}
          {step === 'confirm' && <button className="m10-button primary" disabled={confirm === 'testing' || (!passed.length && !protocols.includes('openai'))} onClick={finish}>保存</button>}</>}>
    {step === 'catalog' && <>
      <label className="m10-search m13-cat-search"><Search size={14} /><input aria-label="查找供应商" placeholder="查找供应商" value={query} onChange={e => setQuery(e.target.value)} /></label>
      {CATALOG_GROUPS.map(([g, title, hint]) => { const items = g === 'custom' ? [{ id: 'custom', group: 'custom', name: '自定义供应商', desc: '填写地址与 Key' }] : CATALOG.filter(c => c.group === g && c.name.toLowerCase().includes(q)); if (!items.length) return null; return <section key={g} className="m13-cat-group"><h3>{title}<span>{hint}</span></h3><div className="m13-cat-grid">
        {items.map(c => { const has = c.group !== 'custom' && connected(c.id); return <button key={c.id} className="m13-cat-item" disabled={!!has} onClick={() => choose(c)}>
          {c.group === 'custom' ? <span className="m13-cap-icon big"><Plus size={16} /></span> : <ProviderIcon catalog={c.id} name={c.name} size={28} />}
          <span><b>{c.name}{has && <i className="m13-dot-ok" aria-label="已接入" />}</b><small>{has ? '已接入' : c.group === 'custom' ? c.desc : c.group === 'native' ? c.desc : pairingNote(c)}</small>{c.verified === false && <small className="m13-unverified">占位，待核实</small>}</span></button>; })}
      </div></section>; })}
    </>}
    {step === 'form' && !custom && <>
      {item.verified === false && <div className="m13-alert warn"><Info size={16} /><div><strong>占位数据</strong><p>{item.name} 的地址与协议尚未核实，正式版以官方资料或你提供的信息为准。</p></div></div>}
      <div className="m13-form-grid">
        <span className="m13-form-label">服务地址</span><div>{Object.entries(item.endpoints).map(([k, v]) => <div key={k} className="m13-endpoint"><Pill tone={k === 'openai' ? 'muted' : 'info'}>{PROTOCOL_LABEL_FULL[k]}</Pill><code>{v}</code></div>)}<small className="m13-hint">{pairingNote(item)}</small></div>
        <span className="m13-form-label">{item.keyLabel}</span><div className="m13-key"><input type={showKey ? 'text' : 'password'} aria-label={item.keyLabel} value={key} onChange={e => setKey(e.target.value)} placeholder="粘贴 Key，加密保存，只在启动时注入" /><button type="button" className="m13-link" onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}{showKey ? '隐藏' : '显示'}</button></div>
      </div>
      {err && <div className="m13-alert danger"><TriangleAlert size={16} /><div><p>{err}</p></div></div>}
    </>}
    {step === 'form' && custom && <>
      <div className="m13-form-grid">
        <span className="m13-form-label">名称</span><input className="m13-input" aria-label="名称" value={cName} onChange={e => setCName(e.target.value)} placeholder="例如 我的中转" />
        <span className="m13-form-label">服务地址</span><div>
          <div className="m13-proto-tabs" role="tablist">{PROTOCOL_TABS.map(([k, t]) => <button key={k} role="tab" aria-selected={proto === k} onClick={() => { setProto(k); setDetected(null); }}>{t}</button>)}</div>
          <input className="m13-input" aria-label="服务地址" value={url} onChange={e => { setUrl(e.target.value); setDetected(null); }} placeholder={proto === 'anthropic' ? 'https://…/anthropic' : 'https://…/v1'} />
          <div className="m13-inline-actions"><button className="m10-button secondary m13-row-btn" onClick={() => setDetected(detectProtocols(url))}>检测协议</button>{detected && (detected.ok ? <span className="m13-hint">候选：{detected.candidates.map(c => PROTOCOL_LABEL_FULL[c]).join('、')}（最终以确认步骤为准）</span> : <span className="m13-hint m13-err">{detected.error}</span>)}</div>
          <details className="m13-adv"><summary>更多端点</summary>{PROTOCOL_TABS.filter(([k]) => k !== proto).map(([k, t]) => <label key={k} className="m13-field"><span>{t}</span><input value={more[k] || ''} onChange={e => setMore(m => ({ ...m, [k]: e.target.value }))} placeholder="可选" /></label>)}</details>
          <small className="m13-hint">Codex 需要 OpenAI Responses，Claude Code 需要 Anthropic；只有 OpenAI 兼容时两个工具都不能直接使用。</small></div>
        <span className="m13-form-label">API 密钥</span><div className="m13-key"><input type={showKey ? 'text' : 'password'} aria-label="API 密钥" value={key} onChange={e => setKey(e.target.value)} placeholder="粘贴 API 密钥" /><button type="button" className="m13-link" onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}{showKey ? '隐藏' : '显示'}</button></div>
        <span className="m13-form-label">图标</span><div className="m13-inline-actions"><ProviderIcon catalog={'custom-' + cName} name={cName || '?'} size={28} /><span className="m13-hint">默认使用名称首字母</span></div>
        <span className="m13-form-label">模型</span><div><input className="m13-input" aria-label="模型 ID" value={manual} onChange={e => setManual(e.target.value)} placeholder="模型 ID，逗号分隔；留空则在下一步从服务获取" /></div>
        <span className="m13-form-label m13-demo-label">结果</span><select className="m13-select" value={demo} onChange={e => setDemo(e.target.value)}><option value="ok">成功</option><option value="empty">模型列表为空</option><option value="bad-key">Key 无效（401）</option><option value="unreachable">服务不可达</option><option value="partial">只有 Responses 确认通过</option><option value="tools-fail">能列出模型但工具调用失败</option></select>
      </div>
      {err && <div className="m13-alert danger"><TriangleAlert size={16} /><div><p>{err}</p></div></div>}
    </>}
    {step === 'models' && (result.models.length ? <div className="m13-checks-list">{result.models.map(m => <label key={m.id}><input type="checkbox" checked={models.includes(m.id)} onChange={e => setModels(ms => e.target.checked ? [...ms, m.id] : ms.filter(x => x !== m.id))} />{m.name}<small>{m.ctx}</small></label>)}</div>
      : <><div className="m13-alert info"><Info size={16} /><div><p>{result.note || '没有获取到模型列表'}，请手动填写模型 ID。</p></div></div><label className="m13-field"><span>模型 ID</span><input value={manual} onChange={e => setManual(e.target.value)} placeholder="例如 acme-coder-large" /></label></>)}
    {step === 'confirm' && <>{confirm === 'testing' ? <p className="m13-desc"><RefreshCw size={14} className="m13-spin" /> 正在用一次最小的流式＋工具调用确认…</p> : <div className="m13-agent-list">{protocols.map(pr => <div key={pr} className="m13-agent-row">
      <span className="m13-cap-icon big">{confirm[pr] === true ? <CircleCheck size={18} /> : <TriangleAlert size={18} />}</span>
      <span className="m13-cap-main"><b>{PROTOCOL_LABEL_FULL[pr]}</b><small>{confirm[pr] === true ? `流式与工具调用正常 · 可用于 ${pr === 'responses' ? 'Codex' : 'Claude Code'}` : confirm[pr] === 'n/a' ? '可以保存，但 Codex、Claude Code 都不能直接使用；可经 Magpie 等网关接入' : '模型列表可读，但最小工具调用失败：返回 400 tools not supported'}</small></span>
      <Pill tone={confirm[pr] === true ? 'ok' : confirm[pr] === 'n/a' ? 'muted' : 'warn'}>{confirm[pr] === true ? '可用' : confirm[pr] === 'n/a' ? '需经网关' : '不可用'}</Pill></div>)}</div>}
      {confirm && confirm !== 'testing' && !passed.length && !protocols.includes('openai') && <div className="m13-alert danger"><TriangleAlert size={16} /><div><strong>没有可用的协议</strong><p>这个服务不能作为代码 Agent 的模型服务使用，不会接入。</p></div></div>}
      <p className="m13-hint">确认调用可能产生少量费用。</p></>}
    {step === 'done' && saved && <div className="m13-done">
      <div className="m13-right-head"><ProviderIcon catalog={saved.catalog} name={saved.name} size={44} /><div><b>{saved.name}</b><small>{pairingNote(saved)}</small></div></div>
      {toolsFor(saved).length ? <><h3 className="m13-sub">搭配工具，生成 Code Agent</h3><div className="m13-pair">{toolsFor(saved).map(t => <button key={t} className="m13-pair-btn" onClick={() => onPair(saved, t)}>{toolIcon(t)}<span><b>搭配 {AGENTS[t]}</b><small>生成“{autoName(t, saved)}”</small></span><Plus size={15} /></button>)}</div></>
        : <div className="m13-alert warn"><Info size={16} /><div><p>这个供应商只提供 OpenAI 兼容协议，暂时不能搭配工具。可以把它接入 Magpie，再在这里接入 Magpie。</p></div></div>}
    </div>}
  </Dialog>;
}

// ================= 供应商详情 =================
export function ProviderDialog({ provider: p, store, scene, onClose, notify, onRemove, onPair }) {
  const { configs, setProviders } = store;
  const [keyEdit, setKeyEdit] = useState(p.needKey ? '' : null), [refreshing, setRefreshing] = useState(false);
  const refs = configs.filter(c => c.provider === p.id);
  const down = scene === 'magpie-down' && p.catalog === 'magpie';
  const cat = catalogItem(p.catalog);
  const patch = fn => setProviders(ps => ps.map(x => x.id === p.id ? fn(x) : x));
  const test = m => { patch(x => ({ ...x, models: x.models.map(y => y.id === m.id ? { ...y, status: 'testing' } : y) })); setTimeout(() => patch(x => ({ ...x, models: x.models.map(y => y.id === m.id ? { ...y, status: m.status === 'rejected' ? 'rejected' : 'ok' } : y) })), 700); };
  const refresh = () => { setRefreshing(true); setTimeout(() => { setRefreshing(false); const extra = p.catalog === 'deepseek' && !p.models.some(m => m.id === 'deepseek-v4-lite') ? [{ id: 'deepseek-v4-lite', name: 'DeepSeek V4 Lite', ctx: '64K', status: 'untested' }] : []; patch(x => ({ ...x, refreshed: '刚刚', models: [...x.models, ...extra] })); notify(extra.length ? `模型列表已刷新：新增 ${extra.map(e => e.name).join('、')}` : '模型列表已刷新：没有变化'); }, 700); };
  return <Dialog title={p.name} sub={providerKind(p) + (cat?.verified === false ? ' · 占位数据，待核实' : '')} wide onClose={onClose}
    footer={<>{p.type !== 'native' && <button className="m10-button secondary m13-danger-text m13-foot-left" onClick={onRemove}>删除</button>}{toolsFor(p).map(t => <button key={t} className="m10-button secondary" disabled={p.needKey} onClick={() => onPair(p, t)}>{toolIcon(t)}搭配 {AGENTS[t]}</button>)}<button className="m10-button primary" onClick={onClose}>完成</button></>}>
    <div className="m13-right-head"><ProviderIcon catalog={p.catalog} name={p.name} size={44} /><div><b>{p.name}</b><small>{pairingNote(p)}</small></div></div>
    {p.type === 'native' ? <p className="m13-desc">{p.note}。如需切换账号，请在终端中用 {AGENTS[p.tool]} 自己的登录命令完成。</p> : <>
      {down && <div className="m13-alert warn"><TriangleAlert size={16} /><div><strong>Magpie 未运行</strong><p>启动任务前会先提示，不会让 CLI 卡在重连。请先打开 Magpie。</p></div></div>}
      {p.needKey && <div className="m13-alert warn"><Info size={16} /><div><strong>需要填写 Key</strong><p>这个供应商从导入文件创建，文件里不含 Key。填写后才能启动任务和搭配工具。</p></div></div>}
      <dl className="m13-info compact">
        <dt>服务地址</dt><dd>{Object.entries(p.endpoints || { [p.protocols[0]]: p.url }).map(([k, v]) => <div key={k} className="m13-endpoint"><Pill tone={k === 'openai' ? 'muted' : 'info'}>{PROTOCOL_LABEL_FULL[k]}</Pill><code>{v}</code></div>)}</dd>
        <dt>Key</dt><dd>{keyEdit === null ? <><code>{p.key || '未填写'}</code><button className="m13-link" onClick={() => setKeyEdit('')}>{p.key ? '更换' : '填写'}</button></> : <span className="m13-inline-edit"><input type="password" aria-label="新的 Key" value={keyEdit} onChange={e => setKeyEdit(e.target.value)} placeholder="加密保存，只在启动时注入" /><button className="m10-button secondary m13-row-btn" disabled={!keyEdit.trim()} onClick={() => { patch(x => ({ ...x, key: 'sk-•••• ' + keyEdit.slice(-4), needKey: false })); setKeyEdit(null); notify('Key 已更新（原型只保留脱敏后四位）'); }}>保存</button>{!p.needKey && <button className="m13-link" onClick={() => setKeyEdit(null)}>取消</button>}</span>}</dd>
        <dt>模型目录</dt><dd>{p.refreshed} 刷新 · 每次启动任务前自动比对<button className="m13-link" disabled={refreshing || down} onClick={refresh}>{refreshing ? '刷新中…' : '刷新模型'}</button></dd>
        <dt>被使用</dt><dd>{refs.length ? refs.map(r => r.name).join('、') : '尚未搭配任何 Code Agent'}</dd></dl>
      <h3 className="m13-sub">模型</h3><div className="m13-table models" role="table"><div role="row" className="m13-th"><span>模型</span><span>上下文</span><span>可用性</span><span /></div>{p.models.map(m => <div role="row" key={m.id}><span>{m.name}</span><span>{m.ctx}</span><span>{m.status === 'ok' ? <Pill tone="ok">可用</Pill> : m.status === 'rejected' ? <Pill tone="warn">调用被拒绝</Pill> : m.status === 'testing' ? <Pill>测试中…</Pill> : <Pill>未测试</Pill>}</span><span><button className="m13-link" disabled={down || p.needKey || m.status === 'testing'} onClick={() => test(m)}>测试可用性</button></span></div>)}</div>
      <p className="m13-hint">“测试可用性”会发起一次最小的流式＋工具调用，可能产生少量费用；结果会保留。能列出的模型不一定能调用。</p>
      {refs.length > 0 && <p className="m13-hint">删除后，使用它的 {refs.length} 个 Code Agent 需要重新选择供应商；历史任务恢复时会提示改选，不会静默换账号。</p>}
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
