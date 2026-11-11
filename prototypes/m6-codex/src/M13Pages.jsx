// M13 原型 P0.5 新增页面与对话框：邮件“草稿”页、禅道“我的工作”页、连接全局默认／删除确认、AI 配置导入导出、
// “WillYou 内置”分组、项目页“插件”分区。依据需求 2026-11-11 补记（七项讨论结论）与审核 review-20261111-0030 P05／P10／P11。
// 全部为合成数据；“插入终端引用”写入原型的演示终端输入（不回车，P0.16），不连接真实终端；导出文件只含合成数据。
import React, { useState } from 'react';
import { ArrowRight, Check, Download, FileText, Info, KeyRound, Paperclip, RefreshCw, Sparkles, Server, TriangleAlert, Upload } from 'lucide-react';
import { sessionEffect, affectedSessions, DRAFT_STATUS, ZENTAO_ITEMS, ZENTAO_PAGE, SAMPLE_IMPORT, buildExport, connectionSummary, connectionTypesOf, effectiveConnection, importPreview, mailDraftState, projectBinding, zentaoDetail } from './m13-model.mjs';
import { Dialog, Mark, Pill } from './m13-ui.jsx';

// ================= 邮件“草稿”页 =================
/** 插件全局停用时，插件页面不再读取数据（P0.10，需求补记 3 B1）；已有数据保留，启用后照常显示。 */
function DisabledPage({ plugin, title, togglePlugin }) {
  return <div className="m13-subpage"><div className="m10-page-head"><div><h1>{title}</h1></div></div>
    <div className="m13-empty"><Info size={20} /><h3>{plugin.name}插件已停用</h3><p>停用期间不读取数据，也不能插入或发送；已有数据都保留，启用后照常显示。</p><button className="m10-button primary" onClick={() => togglePlugin(plugin)}>启用</button></div></div>;
}

// 停用判断放在外层组件，避免内层 hooks 数量随启停变化
export const MailDrafts = props => props.plugin.enabled ? <MailDraftsPage {...props} /> : <DisabledPage plugin={props.plugin} title="草稿" togglePlugin={props.togglePlugin} />;
function MailDraftsPage({ plugin, store, projects, notify, nav }) {
  const { drafts, setDrafts } = store;
  const [filter, setFilter] = useState('all'), [open, setOpen] = useState(null), [editing, setEditing] = useState(null), [checking, setChecking] = useState(false);
  // P0.16（审核 N06，用户 2026-11-11 决定）：按草稿所属项目判断——项目关闭邮件插件时只读；发件账号用本项目生效的 SMTP 连接
  const anySmtp = plugin.connections.some(c => c.type === 'smtp');
  const stateOf = x => mailDraftState(x, plugin, store.defaults, store.bindings);
  const list = drafts.filter(d => filter === 'all' || d.status === filter);
  const d = drafts.find(x => x.id === open); const ds = d ? stateOf(d) : null; const hasSender = !!ds?.sender && !ds.projectClosed;
  const update = (id, patch) => setDrafts(ds => ds.map(x => x.id === id ? { ...x, ...patch } : x));
  const send = x => { const st = stateOf(x); if (st.projectClosed || !st.sender) return; update(x.id, { status: 'sent', sentAt: '刚刚', sentVia: st.sender.name, error: undefined }); notify(`“${x.subject}”已用“${st.sender.name}”发送（演示）`); setOpen(null); };
  const projectName = id => projects.find(p => p.id === id)?.name || id;
  return <div className="m13-subpage">
    <div className="m10-page-head"><div><h1>草稿</h1><p>Agent 起草的邮件保存在这里，发送前由你确认；结果未知时不会自动重发。</p></div></div>
    {!anySmtp && <div className="m13-alert warn"><Info size={16} /><div><strong>还没有发件账号</strong><p>可以查看和编辑草稿；发送前需要先在邮件插件里添加 SMTP 发件账号。</p></div><button className="m10-button secondary" onClick={() => nav('m13/plugins/mail')}>去添加</button></div>}
    <div className="m10-tabs" role="tablist">{[['all', '全部'], ['draft', '草稿'], ['sent', '已发送'], ['failed', '发送失败'], ['unknown', '结果未知']].map(([v, t]) => <button key={v} role="tab" aria-selected={filter === v} onClick={() => setFilter(v)}>{t}<span className="m13-count">{v === 'all' ? drafts.length : drafts.filter(x => x.status === v).length}</span></button>)}</div>
    <div className="m13-cap-list">{list.map(x => <button key={x.id} className="m13-cap" onClick={() => { setOpen(x.id); setEditing(null); setChecking(false); }}>
      <span className="m13-cap-icon"><FileText size={16} /></span>
      <span className="m13-cap-main"><b>{x.subject}</b><small>收件人 {x.to} · {projectName(x.project)}{x.attachments.length ? ` · ${x.attachments.length} 个附件` : ''}</small><small className="m13-cap-scope">{x.status === 'sent' ? `${x.sentAt} 发送` : `${x.updated} 更新`}{x.error ? ' · ' + x.error : ''}</small></span>
      {stateOf(x).projectClosed && <Pill tone="warn">本项目已关闭邮件插件</Pill>}<Pill tone={DRAFT_STATUS[x.status][1]}>{DRAFT_STATUS[x.status][0]}</Pill>
    </button>)}{!list.length && <div className="m13-empty"><FileText size={20} /><h3>没有这类邮件</h3><p>Agent 起草的邮件会出现在这里。</p></div>}</div>
    {d && <Dialog title={d.subject} sub={`收件人 ${d.to} · ${DRAFT_STATUS[d.status][0]}`} wide onClose={() => setOpen(null)}
      footer={ds?.projectClosed ? <button className="m10-button primary" onClick={() => setOpen(null)}>关闭</button> : editing !== null ? <><button className="m10-button secondary" onClick={() => setEditing(null)}>取消</button><button className="m10-button primary" onClick={() => { update(d.id, { body: editing, updated: '刚刚' }); setEditing(null); notify('草稿已保存'); }}>保存</button></>
        : d.status === 'sent' ? <button className="m10-button primary" onClick={() => setOpen(null)}>关闭</button>
          : d.status === 'unknown' ? <><button className="m10-button secondary" onClick={() => setChecking(true)}>核对结果</button><button className="m10-button primary" onClick={() => setOpen(null)}>关闭</button></>
            : <><button className="m10-button secondary m13-danger-text" onClick={() => { setDrafts(ds => ds.filter(x => x.id !== d.id)); setOpen(null); notify('草稿已删除'); }}>删除</button><button className="m10-button secondary" onClick={() => setEditing(d.body)}>编辑</button><button className="m10-button primary" disabled={!hasSender} title={hasSender ? '' : '本项目还没有可用的发件账号'} onClick={() => send(d)}>{d.status === 'failed' ? '重新发送' : '发送'}</button></>}>
      {ds?.projectClosed ? <div className="m13-alert warn" data-mail-closed><Info size={16} /><div><strong>{projectName(d.project)} 已关闭邮件插件</strong><p>可以查看这封邮件，不能编辑和发送；在项目页重新打开邮件插件后恢复。</p></div></div>
        : <div className="m13-row m13-sender" data-mail-sender><span className="m13-rowicon"><Info size={16} /></span><span>{ds?.sender ? <>发件账号：{ds.sender.name}<small>{projectName(d.project)} 当前生效（{ds.mode === 'custom' ? '本项目个性化' : '跟随全局默认'}）</small></> : <>本项目还没有可用的发件账号<small>在邮件插件里添加 SMTP 发件账号，或在项目页为 {projectName(d.project)} 选择一个</small></>}</span></div>}
      {d.status === 'sent' && d.sentVia && <p className="m13-hint">已用“{d.sentVia}”发送。</p>}
      {d.status === 'failed' && <div className="m13-alert danger"><TriangleAlert size={16} /><div><strong>发送失败</strong><p>{d.error}。修复发件账号后可重新发送。</p></div></div>}
      {d.status === 'unknown' && <div className="m13-alert warn"><TriangleAlert size={16} /><div><strong>无法确认是否已发出</strong><p>发送时连接中断。WillYou 不会自动重发，以免重复发送。</p></div></div>}
      {checking && <div className="m13-alert info"><Info size={16} /><div><p>请到发件邮箱的“已发送”中核对这封邮件。</p></div><div className="m13-notice-actions"><button className="m10-button secondary" onClick={() => { update(d.id, { status: 'sent', sentAt: '已核对' }); setOpen(null); notify('已标记为已发送'); }}>已发出，标记为已发送</button><button className="m10-button secondary" disabled={!hasSender} onClick={() => send(d)}>确认未发出，重新发送</button></div></div>}
      {editing !== null ? <textarea className="m13-textarea" rows={8} value={editing} onChange={e => setEditing(e.target.value)} /> : <pre className="m13-mail-body">{d.body}</pre>}
      {d.attachments.length > 0 && <><h3 className="m13-sub">附件</h3>{d.attachments.map(a => <div key={a} className="m13-row"><span className="m13-rowicon"><Paperclip size={16} /></span><span>{a}<small>合成附件，原型不打开真实文件</small></span><button className="m10-button secondary m13-row-btn" onClick={() => notify(`已打开 ${a}（演示）`)}>查看</button></div>)}</>}
    </Dialog>}
  </div>;
}

// ================= 禅道“我的工作”页 =================
export const ZentaoWork = props => props.plugin.enabled ? <ZentaoWorkPage {...props} /> : <DisabledPage plugin={props.plugin} title="我的工作" togglePlugin={props.togglePlugin} />;
function ZentaoWorkPage({ plugin, store, projects, tasks, scene, notify, nav, onTryPrompt, onInsertReference }) {
  const { defaults, bindings } = store;
  const [projectId, setProjectId] = useState(projects[0]?.id), [kind, setKind] = useState('bug'), [pages, setPages] = useState({ bug: 1, story: 1 }), [failed, setFailed] = useState(false), [refreshing, setRefreshing] = useState(false), [open, setOpen] = useState(null), [target, setTarget] = useState(null);
  const eff = effectiveConnection(plugin, defaults, bindings, projectId, 'zentao');
  const items = ZENTAO_ITEMS[kind], shown = items.slice(0, pages[kind] * ZENTAO_PAGE), more = shown.length < items.length;
  const running = tasks.filter(t => t.project === projectId && t.status === 'running' && !t.archived);
  const projectName = projects.find(p => p.id === projectId)?.name || '该项目';
  const item = open && [...ZENTAO_ITEMS.bug, ...ZENTAO_ITEMS.story].find(x => x.kind + x.id === open);
  const next = () => { if (scene === 'zentao-partial' && !failed && pages[kind] === 1) { setFailed(true); return; } setFailed(false); setPages(p => ({ ...p, [kind]: p[kind] + 1 })); };
  return <div className="m13-subpage">
    <div className="m10-page-head"><div><h1>我的工作</h1><p>当前项目所选禅道中指派给你的 Bug 与研发需求。选中一条可插入终端引用，交给 Agent 处理。</p></div>
      <div className="m10-head-actions"><select className="m13-select m13-project-select" aria-label="项目" value={projectId} onChange={e => { setProjectId(e.target.value); setPages({ bug: 1, story: 1 }); setFailed(false); }}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <button className="m10-button secondary" disabled={refreshing || !eff.connection} onClick={() => { setRefreshing(true); setTimeout(() => { setRefreshing(false); setFailed(false); notify('列表已刷新'); }, 600); }}><RefreshCw size={14} className={refreshing ? 'm13-spin' : ''} />刷新列表</button></div></div>
    {eff.disabled ? <div className="m13-empty"><Info size={20} /><h3>该项目已关闭禅道插件</h3><p>到项目的“插件”分区重新启用。</p><button className="m10-button secondary" onClick={() => nav('project/' + projectId + '/apps')}>去项目设置</button></div>
      : !eff.connection ? <div className="m13-empty"><KeyRound size={20} /><h3>还没有可用的禅道连接</h3><p>先在禅道插件里添加连接。</p><button className="m10-button secondary" onClick={() => nav('m13/plugins/zentao')}>去添加连接</button></div> : <>
      <p className="m13-hint m13-conn-line"><KeyRound size={13} />使用连接：{eff.connection.name}（{eff.mode === 'custom' ? '本项目个性化' : '跟随全局默认'}）· {connectionSummary(plugin, eff.connection)}<span className="m13-decl">由插件声明，WillYou 渲染</span></p>
      <div className="m10-tabs" role="tablist">{[['bug', 'Bug'], ['story', '研发需求']].map(([v, t]) => <button key={v} role="tab" aria-selected={kind === v} onClick={() => { setKind(v); setFailed(false); }}>{t}<span className="m13-count">{ZENTAO_ITEMS[v].length}</span></button>)}</div>
      <div className="m13-table m13-zt" role="table"><div role="row" className="m13-th"><span>编号</span><span>标题</span><span>{kind === 'bug' ? '严重程度' : '优先级'}</span><span>状态</span></div>
        {shown.map(x => <button role="row" key={x.id} className={'m13-zt-row' + (open === x.kind + x.id ? ' selected' : '')} onClick={() => { setOpen(x.kind + x.id); setTarget(running[0]?.id || null); }}><span>#{x.id}</span><span>{x.title}</span><span>{x.severity || x.priority}</span><span>{x.status}</span></button>)}</div>
      {failed ? <div className="m13-alert warn"><TriangleAlert size={16} /><div><strong>列表读取未完成</strong><p>第 2 页读取超时，已显示的内容保留。</p></div><button className="m10-button secondary" onClick={() => { setFailed(false); setPages(p => ({ ...p, [kind]: p[kind] + 1 })); }}>重试</button></div>
        : more ? <button className="m10-button secondary m13-more" onClick={next}>读取下一页</button> : <p className="m13-hint">已显示全部 {items.length} 条。</p>}
    </>}
    {item && (() => { const det = zentaoDetail(item); return <Dialog title={`#${item.id} ${item.title}`} sub={`${item.kind === 'bug' ? 'Bug' : '研发需求'} · ${item.product} · ${item.status}`} wide onClose={() => setOpen(null)}
      footer={<><button className="m10-button secondary" onClick={() => setOpen(null)}>关闭</button>{running.length ? <button className="m10-button primary" disabled={!target} onClick={() => { const t = running.find(r => r.id === target); const text = `禅道${item.kind === 'bug' ? ' Bug' : '研发需求'} #${item.id} ${item.title}：`; setOpen(null); if (onInsertReference?.(t.id, text)) notify(`已插入会话“${t.title}”的终端输入（未回车）`); else notify('目标会话已不存在，请重新选择'); }}>插入终端引用</button>
        : <button className="m10-button primary" onClick={() => { setOpen(null); onTryPrompt?.(`禅道${item.kind === 'bug' ? ' Bug' : '研发需求'} #${item.id} ${item.title}：`, projectId); }}>新建会话并插入</button>}</>}>
      <pre className="m13-mail-body">{det.body}</pre>
      {det.attachments.length > 0 && <><h3 className="m13-sub">附件</h3>{det.attachments.map(a => <div key={a} className="m13-row"><span className="m13-rowicon"><Paperclip size={16} /></span><span>{a}<small>合成附件</small></span></div>)}</>}
      <h3 className="m13-sub">历史</h3>{det.history.map(h => <p key={h.at} className="m13-hint">{h.at} · {h.who} · {h.what}</p>)}
      <h3 className="m13-sub">插入到</h3>{running.length ? <select className="m13-select" aria-label="插入到会话" value={target || ''} onChange={e => setTarget(e.target.value)}>{running.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select> : <p className="m13-hint">{projectName}没有运行中的会话。可以新建一个会话，引用会放进新会话的输入框。</p>}
      <p className="m13-hint">{running.length ? `只列出${projectName}运行中的会话（这条 Bug 属于${projectName}所选的禅道，其他项目可能用不同的连接或已关闭禅道）。` : ''}只放进输入框，不会自动回车；你补充说明后再发送，Agent 会读取这条{item.kind === 'bug' ? ' Bug' : '需求'}。</p>
    </Dialog>; })()}
  </div>;
}

// ================= 连接：改全局默认、删除 =================
export function ConnectionDefaultDialog({ plugin, from, to, impact, onConfirm, onClose }) {
  return <Dialog title="更换全局默认连接" sub={`${plugin.name} · ${from?.name || '无'} → ${to.name}`} wide onClose={onClose} footer={<><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary" onClick={onConfirm}>确认更换</button></>}>
    <h3 className="m13-sub">将同步改为“{to.name}”的项目（跟随全局默认）<span className="m13-count"> {impact.follow.length}</span></h3>
    {impact.follow.length ? <div className="m13-chips">{impact.follow.map(p => <span key={p.id} className="m13-chip">{p.name}</span>)}</div> : <p className="m13-hint">没有。</p>}
    <h3 className="m13-sub">保持不变的项目（已个性化）<span className="m13-count"> {impact.custom.length}</span></h3>
    {impact.custom.length ? <div className="m13-chips">{impact.custom.map(p => <span key={p.id} className="m13-chip">{p.name}</span>)}</div> : <p className="m13-hint">没有。</p>}
    <p className="m13-hint">正在运行的任务继续使用启动时的连接直到结束；新建或恢复的任务使用新连接。</p>
  </Dialog>;
}
export function ConnectionDeleteDialog({ plugin, conn, impact, onConfirm, onClose }) {
  const [next, setNext] = useState(impact.others[0]?.id);
  return <Dialog title={`删除连接“${conn.name}”`} sub={plugin.name} onClose={onClose}
    footer={impact.blocked ? <button className="m10-button primary" onClick={onClose}>知道了</button> : <><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary m13-danger-btn" onClick={() => onConfirm(impact.needNewDefault ? next : null)}>删除</button></>}>
    {impact.blocked ? <div className="m13-alert warn"><TriangleAlert size={16} /><div><strong>有任务正在使用这个连接</strong><p>删除会同时删除凭据，运行中的任务将无法继续。请等以下任务结束或先停止：</p><ul>{impact.runningUse.map(t => <li key={t.id}>{t.title}</li>)}</ul></div></div> : <>
      {impact.needNewDefault && <><h3 className="m13-sub">它是全局默认，请先选新的全局默认</h3><div className="m13-radios">{impact.others.map(c => <label key={c.id} className={'m13-radio' + (next === c.id ? ' selected' : '')}><input type="radio" checked={next === c.id} onChange={() => setNext(c.id)} /><span><b>{c.name}</b><small>{connectionSummary(plugin, c)}</small></span></label>)}</div><p className="m13-hint">跟随全局默认的项目会同步改用新的默认连接。</p></>}
      {impact.customProjects.length > 0 && <><h3 className="m13-sub">单独选了它的项目将改为跟随全局默认</h3><div className="m13-chips">{impact.customProjects.map(p => <span key={p.id} className="m13-chip">{p.name}</span>)}</div></>}
      {impact.last && <div className="m13-alert warn"><Info size={16} /><div><p>这是唯一的连接，删除后{plugin.name}插件暂不可用，直到再添加连接。</p></div></div>}
      <p className="m13-hint">连接与加密保存的凭据会一起删除。</p>
    </>}
  </Dialog>;
}

// ================= AI 配置导入导出 =================
export function ExportDialog({ providers, configs, onClose, notify }) {
  const exportable = configs.filter(c => c.source !== 'login');
  const [cfgs, setCfgs] = useState(exportable.filter(c => !c.legacy).map(c => c.id)), [provs, setProvs] = useState([]), [withKey, setWithKey] = useState(false), [pass, setPass] = useState(''), [pass2, setPass2] = useState(''), [err, setErr] = useState('');
  const data = buildExport({ providers, configs, selectedConfigs: cfgs, selectedProviders: provs, includeKey: withKey });
  const auto = new Set(configs.filter(c => cfgs.includes(c.id)).map(c => c.provider));
  const toggle = (list, set, id) => set(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const go = () => {
    if (!data.runConfigs.length && !data.providers.length) return setErr('请至少选择一项');
    if (withKey && [...pass].length < 8) return setErr('口令至少 8 个字符');
    if (withKey && pass !== pass2) return setErr('两次输入的口令不一致');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'willyou-ai-config.json'; a.click(); URL.revokeObjectURL(url);
    notify(`已导出 ${data.runConfigs.length} 个智能体、${data.providers.length} 个供应商${withKey ? '（含加密的 Key）' : '（不含 Key）'}`); onClose();
  };
  return <Dialog title="导出智能体配置" sub="生成 JSON 文件，别人导入后可直接使用" wide onClose={onClose} footer={<><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary" onClick={go}><Download size={14} />导出</button></>}>
    <h3 className="m13-sub">智能体</h3><div className="m13-checks-list">{exportable.map(c => <label key={c.id}><input type="checkbox" checked={cfgs.includes(c.id)} onChange={() => toggle(cfgs, setCfgs, c.id)} />{c.name}<small>{c.legacy ? '高级配置' : ''}</small></label>)}</div>
    <h3 className="m13-sub">供应商</h3><div className="m13-checks-list">{providers.map(p => <label key={p.id}><input type="checkbox" checked={auto.has(p.id) || provs.includes(p.id)} disabled={auto.has(p.id)} onChange={() => toggle(provs, setProvs, p.id)} />{p.name}<small>{auto.has(p.id) ? '随所选智能体带上' : ''}</small></label>)}</div>
    <label className="m13-check"><input type="checkbox" checked={withKey} onChange={e => setWithKey(e.target.checked)} />包含 Key（用口令加密，导入时需输入口令）</label>
    {withKey && <div className="m13-tiers"><label className="m13-field"><span>口令（至少 8 个字符）</span><input type="password" value={pass} onChange={e => setPass(e.target.value)} /></label><label className="m13-field"><span>再次输入</span><input type="password" value={pass2} onChange={e => setPass2(e.target.value)} /></label></div>}
    <p className="m13-hint">不导出工具可执行路径与本机目录；订阅/API 智能体跟随本机 CLI 登录，不导出，对方登录后会自动添加。{withKey ? '' : '默认不含 Key，文件可以放心分享。'}</p>
    {err && <div className="m13-alert danger"><TriangleAlert size={16} /><div><p>{err}</p></div></div>}
  </Dialog>;
}
export function ImportDialog({ providers, configs, onImport, onClose }) {
  const samples = [['plain', '同事分享的配置.json（不含 Key）', SAMPLE_IMPORT], ['enc', '我的另一台电脑.json（含加密的 Key）', { ...SAMPLE_IMPORT, includesKeys: true, providers: SAMPLE_IMPORT.providers.map(p => ({ ...p, key: { encrypted: true } })) }], ['bad', '其他软件的文件.json', { foo: 1 }]];
  const [pick, setPick] = useState('plain'), [pass, setPass] = useState(''), [err, setErr] = useState('');
  const file = samples.find(s => s[0] === pick)[2];
  const pv = importPreview(file, { providers, configs });
  const go = () => { if (!pv.ok) return; if (pv.encrypted && pass !== 'demo-pass-8') return setErr('口令不正确，未导入任何内容'); onImport(pv); };
  return <Dialog title="导入智能体配置" sub="原型不打开系统文件选择器，请从示例文件中选择" wide onClose={onClose} footer={<><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary" disabled={!pv.ok} onClick={go}><Upload size={14} />导入</button></>}>
    <div className="m13-radios">{samples.map(([v, t]) => <label key={v} className={'m13-radio' + (pick === v ? ' selected' : '')}><input type="radio" checked={pick === v} onChange={() => { setPick(v); setErr(''); }} /><span><b>{t}</b></span></label>)}</div>
    {!pv.ok ? <div className="m13-alert danger"><TriangleAlert size={16} /><div><p>{pv.error}</p></div></div> : <>
      <h3 className="m13-sub">将导入</h3>
      {pv.providers.map(p => <div key={p.id} className="m13-row"><span className="m13-rowicon"><Server size={16} /></span><span>{p.finalName}<small>{p.url}</small></span>{p.needKey ? <Pill tone="warn">需要填写 Key</Pill> : <Pill tone="ok">含 Key</Pill>}</div>)}
      {pv.runConfigs.map(c => <div key={c.id} className="m13-row"><span className="m13-rowicon"><Sparkles size={16} /></span><span>{c.finalName}<small>{c.finalName !== c.name ? '已有同名配置，不覆盖' : '新配置'}</small></span></div>)}
      {pv.skipped > 0 && <p className="m13-hint">文件里有 {pv.skipped} 个订阅/API 智能体，已跳过：它们跟随本机 CLI 登录，登录后会自动添加。</p>}
      {pv.encrypted && <label className="m13-field"><span>口令（演示口令 demo-pass-8）</span><input type="password" value={pass} onChange={e => { setPass(e.target.value); setErr(''); }} /></label>}
      {err && <div className="m13-alert danger"><TriangleAlert size={16} /><div><p>{err}</p></div></div>}
    </>}
  </Dialog>;
}

// ================= “WillYou 内置”分组 =================
export function BuiltinGroup({ store, notify, affect }) {
  const { builtins, setBuiltins } = store;
  return <section className="m13-builtin"><h2 className="m10-section-title">WillYou 内置</h2>
    <div className="m13-cap-list">{builtins.map(b => <div key={b.id} className="m13-cap static">
      <span className="m13-cap-icon">{b.type === 'skill' ? <Sparkles size={16} /> : <Server size={16} />}</span>
      <span className="m13-cap-main"><b>{b.name}<span className="m10-package-version">{b.version}</span></b><small>{b.desc}</small><small className="m13-cap-scope">{b.type === 'skill' ? 'Skill · 随 WillYou 安装到 ~/.agents/skills，所有项目可用' : 'MCP · 每个会话自动提供'}</small></span>
      <label className="m13-switch-row"><span>{b.enabled ? '已启用' : '已停用'}</span><button role="switch" aria-checked={b.enabled} aria-label={(b.enabled ? '停用 ' : '启用 ') + b.name} className={'m13-switch' + (b.enabled ? ' on' : '')} onClick={() => { setBuiltins(bs => bs.map(x => x.id === b.id ? { ...x, enabled: !x.enabled } : x)); notify(b.enabled ? `${b.name} 已停用：${sessionEffect('cap-off', affect('cap', b))}` : `${b.name} 已启用：${sessionEffect('cap-on', affect('cap', b))}`); }}><i /></button></label>
    </div>)}</div></section>;
}

// ================= 项目页“插件”分区（审核 P05；需求“插件连接与项目使用”） =================
export function ProjectPlugins({ project, store, nav, notify, tasks = [] }) {
  const { plugins, defaults, bindings, setBindings } = store;
  const set = (pid, patch) => setBindings(b => ({ ...b, [pid]: { ...(b[pid] || {}), [project.id]: { ...projectBinding(b, pid, project.id), ...patch } } }));
  // P0.11：按“内置／外部”页签分开（用户 2026-11-11 提出）
  const [tab, setTab] = useState('builtin');
  const groups = { builtin: plugins.filter(p => p.builtin), external: plugins.filter(p => !p.builtin) };
  return <div className="m13-shell m13-project-plugins">
    <div className="m10-tabs m13-pp-tabs" role="tablist" aria-label="插件类型">{[['builtin', '内置'], ['external', '外部']].map(([v, t]) => <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)}>{t}<span className="m13-count">{groups[v].length}</span></button>)}</div>
    {tab === 'external' && !groups.external.length && <div className="m13-empty"><Info size={20} /><h3>还没有安装外部插件</h3><p>在“插件”页通过“添加”安装后，会出现在这里。</p><button className="m10-button secondary" onClick={() => nav('m13/plugins')}>去插件页</button></div>}
    {groups[tab].map(pl => { const b = projectBinding(bindings, pl.id, project.id), types = connectionTypesOf(pl); return <div key={pl.id} className="m13-pp-card">
      <div className="m13-pp-head"><Mark id={pl.id} name={pl.name} size={28} /><span className="m13-cap-main"><b>{pl.name}{!pl.enabled && <Pill tone="warn">插件已停用</Pill>}</b><small>{pl.tagline}</small></span>
        <label className="m13-switch-row"><span>{b.disabled ? '本项目已关闭' : '本项目可用'}</span><button role="switch" aria-checked={!b.disabled} aria-label={(b.disabled ? '启用 ' : '关闭 ') + pl.name} className={'m13-switch' + (b.disabled ? '' : ' on')} onClick={() => { set(pl.id, { disabled: !b.disabled }); const n = affectedSessions('project', project.id, tasks); notify(!pl.enabled ? `${pl.name} 已在本项目${b.disabled ? '启用' : '关闭'}；插件当前已全局停用，全局启用后按本项目设置生效` : b.disabled ? `${pl.name} 已在本项目启用：${sessionEffect('project-on', n)}` : `${pl.name} 已在本项目关闭：${sessionEffect('project-off', n)}`); }}><i /></button></label></div>
      {!b.disabled && types.map(def => { const eff = effectiveConnection(pl, defaults, bindings, project.id, def.type), list = pl.connections.filter(c => c.type === def.type), dflt = list.find(c => c.id === defaults[pl.id]?.[def.type]); return <div key={def.type} className="m13-pp-slot">
        <span className="m13-pp-label">{def.label}</span>
        {list.length ? <select className="m13-select" aria-label={pl.name + def.label} value={b[def.type]?.mode === 'custom' ? b[def.type].connectionId : 'follow'} onChange={e => { const v = e.target.value; set(pl.id, { [def.type]: v === 'follow' ? { mode: 'follow' } : { mode: 'custom', connectionId: v } }); notify(v === 'follow' ? '已改为跟随全局默认' : '已为本项目单独选择连接；运行中的任务继续用原连接'); }}>
          <option value="follow">跟随全局默认{dflt ? `（当前：${dflt.name}）` : ''}</option>{list.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          : <span className="m13-hint">还没有连接 · <button className="m13-link" onClick={() => nav('m13/plugins/' + pl.id)}>去插件详情添加</button></span>}
        {eff.connection && <small className="m13-hint">生效：{eff.connection.name}（{eff.mode === 'custom' ? '本项目个性化' : '跟随全局'}）</small>}
      </div>; })}
    </div>; })}
    <p className="m13-hint m13-pp-foot">插件默认对所有项目可用，连接在插件详情里配置；这里可关闭插件或为本项目单独选择连接。切换连接后，运行中的任务仍用原连接，新建或恢复的任务用新连接。</p>
  </div>;
}
