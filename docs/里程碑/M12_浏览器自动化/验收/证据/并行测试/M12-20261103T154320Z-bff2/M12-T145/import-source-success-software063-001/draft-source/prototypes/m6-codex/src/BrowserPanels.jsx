import { useEffect, useRef, useState } from 'react';
import {
  X, Download, FolderOpen, FileDown, Ban, ChevronUp, ChevronDown, MapPin, ExternalLink, KeyRound, ShieldAlert, UserRound, Copy, Trash2, Plus
} from 'lucide-react';
import { IMPORT_SOURCES, SEARCH_ENGINES, importOutcome } from './browser-prototype-model.mjs';

/** Shared modal shell; reuses the M9 right-workspace dialog classes. */
export function PanelDialog({ title, subtitle, onClose, children, footer, wide, dismissOnBackdrop = true, closeDisabled = false }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector('input, button:not([aria-label="关闭"])')?.focus(); }, []);
  return <div className="fw-modal-scrim bw-scrim" onMouseDown={event => { if (dismissOnBackdrop && event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={'fw-dialog bw-dialog' + (wide ? ' bw-dialog-wide' : '')} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
      <div className="bw-dialog-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="fw-icon" aria-label="关闭" disabled={closeDisabled} onClick={onClose}><X size={16} /></button></div>
      <div className="bw-dialog-body">{children}</div>
      {footer && <div className="fw-dialog-actions bw-dialog-actions">{footer}</div>}
    </div>
  </div>;
}

/** R04.6 JS dialog states. Values remain synthetic and in component memory. */
export function JavascriptDialog({ dialog, onRespond }) {
  const [value, setValue] = useState(dialog.defaultValue), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const input = useRef(null), confirm = useRef(null);
  useEffect(() => { if (dialog.kind === 'prompt') { input.current?.focus(); input.current?.select(); } else confirm.current?.focus(); }, [dialog.id, dialog.kind]);
  useEffect(() => { if (error && !busy) (dialog.kind === 'prompt' ? input.current : confirm.current)?.focus(); }, [error, busy, dialog.kind]);
  const respond = async accept => { if (busy) return; setBusy(true); setError(''); try { await onRespond(accept, accept && dialog.kind === 'prompt' ? value : undefined); } catch (failure) { setError(failure.message); } finally { setBusy(false); } };
  const title = dialog.kind === 'prompt' ? '网页输入' : dialog.kind === 'confirm' ? '网页确认' : '网页提示';
  return <PanelDialog title={title} subtitle="https://example.test · 演示合成页面" dismissOnBackdrop={false} closeDisabled={busy} onClose={() => respond(false)} footer={<>
    {dialog.kind !== 'alert' && <button type="button" disabled={busy} onClick={() => respond(false)}>取消</button>}
    <button ref={confirm} type="submit" form={'javascript-' + dialog.id} disabled={busy}>确定</button>
  </>}>
    <form id={'javascript-' + dialog.id} className="bw-form" onSubmit={event => { event.preventDefault(); respond(true); }}>
      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflowY: 'auto' }}>{dialog.message}</p>
      {dialog.kind === 'prompt' && <label>输入内容<input ref={input} aria-label="网页输入内容" disabled={busy} value={value} onChange={event => setValue(event.target.value)} /></label>}
      {error && <p role="alert" className="fw-form-error">{error}</p>}
    </form>
  </PanelDialog>;
}

/** B07 download bar (R01.7, O5). Files are synthetic; actions only report what would happen. */
export function DownloadBar({ downloads, onAction, onHover = () => {}, onClose = () => {} }) {
  if (!downloads.length) return null;
  return <div className="bw-downloads" role="region" aria-label="下载" onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <div className="bw-downloads-head"><strong>下载</strong><span>系统下载目录</span><button type="button" className="fw-icon bw-mini-icon" aria-label="收起下载列表" onClick={onClose}><X size={14} /></button></div>
    {downloads.map(item => <div key={item.id} className={'bw-download bw-download-' + item.state}>
      <FileDown size={15} />
      <div className="bw-download-text"><strong title={item.name}>{item.name}</strong><span>{item.state === 'progress' ? `正在下载 · ${item.progress}%` : item.state === 'done' ? '已保存到 ~/Downloads' : item.state === 'failed' ? '下载失败：连接被中断' : '已取消'}</span>{item.state === 'progress' && <span className="bw-download-meter"><span style={{ width: item.progress + '%' }} /></span>}</div>
      {item.state === 'progress' && <button type="button" className="bw-mini" onClick={() => onAction(item, 'cancel')}><Ban size={13} />取消</button>}
      {item.state === 'done' && <><button type="button" className="bw-mini" onClick={() => onAction(item, 'open')}><Download size={13} />打开</button><button type="button" className="bw-mini" onClick={() => onAction(item, 'reveal')}><FolderOpen size={13} />在文件夹中显示</button></>}
      {item.state !== 'progress' && <button type="button" className="fw-icon bw-mini-icon" aria-label={'移除下载记录 ' + item.name} onClick={() => onAction(item, 'remove')}><X size={14} /></button>}
    </div>)}
  </div>;
}

/** B08 find in page (Cmd/Ctrl+F). Counts matches in the synthetic page text. */
export function FindBar({ pageRef, onClose }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);
  const text = (pageRef.current?.innerText || '').toLowerCase();
  const needle = query.trim().toLowerCase();
  const count = needle ? text.split(needle).length - 1 : 0;
  const current = count ? (index % count) + 1 : 0;
  return <div className="bw-find" role="search" aria-label="页内查找" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key === 'Enter') { event.preventDefault(); setIndex(value => value + (event.shiftKey ? count - 1 : 1)); }
  }}>
    <input ref={input} aria-label="查找内容" value={query} placeholder="在页面中查找" onChange={event => { setQuery(event.target.value); setIndex(0); }} />
    <span className="bw-find-count" role="status">{needle ? (count ? `第 ${current} / ${count} 个` : '无结果') : ''}</span>
    <button type="button" className="fw-icon" aria-label="上一个" disabled={!count} onClick={() => setIndex(value => value + count - 1)}><ChevronUp size={15} /></button>
    <button type="button" className="fw-icon" aria-label="下一个" disabled={!count} onClick={() => setIndex(value => value + 1)}><ChevronDown size={15} /></button>
    <button type="button" className="fw-icon" aria-label="关闭查找" onClick={onClose}><X size={15} /></button>
  </div>;
}

/** B06 inline prompts: site permission (O4) and external-app link (R01.6). */
export function PromptBar({ prompt, onResolve }) {
  if (!prompt) return null;
  if (prompt.type === 'permission') return <div className="bw-prompt" role="alertdialog" aria-label="站点权限请求">
    <MapPin size={15} /><span><strong>{prompt.host}</strong> 想要获取你的位置。你的选择会记在当前登录态中，可在登录态管理里撤销；Agent 无法代你允许。</span>
    <button type="button" className="bw-mini" onClick={() => onResolve('deny')}>拒绝</button><button type="button" className="bw-mini bw-mini-primary" onClick={() => onResolve('allow')}>允许</button>
  </div>;
  return <div className="bw-prompt" role="alertdialog" aria-label="外部应用请求">
    <ExternalLink size={15} /><span>此页面想用外部应用打开 <code>{prompt.url}</code>。原型不会真的打开任何应用。</span>
    <button type="button" className="bw-mini" onClick={() => onResolve('cancel')}>取消</button><button type="button" className="bw-mini bw-mini-primary" onClick={() => onResolve('open')}>打开</button>
  </div>;
}

/** B06 HTTP basic authentication: user types credentials; nothing is stored (D3). */
export function HttpAuthDialog({ host, onSubmit, onCancel }) {
  return <PanelDialog title="需要登录" subtitle={`${host} 要求输入用户名和密码（HTTP 基本认证）`} onClose={onCancel}
    footer={<><button type="button" onClick={onCancel}>取消</button><button type="button" onClick={onSubmit}>登录</button></>}>
    <form className="bw-form" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
      <label>用户名<input aria-label="基本认证用户名" autoComplete="off" /></label>
      <label>密码<input aria-label="基本认证密码" type="password" autoComplete="off" /></label>
      <p className="bw-hint"><KeyRound size={13} />演示：不校验、不保存。应用不保存站点密码（D3）。</p>
    </form>
  </PanelDialog>;
}

/** B11 cross-task authorization (P4): same project only, per run, user decides. */
export function CrossTaskDialog({ request, onDecide }) {
  const [mode, setMode] = useState(request.mode);
  return <PanelDialog title="Agent 请求访问其他任务的网页" subtitle={`当前运行：${request.fromTitle}`} onClose={() => onDecide(null)}
    footer={<><button type="button" onClick={() => onDecide(null)}>拒绝</button><button type="button" onClick={() => onDecide(mode)}>允许本次运行</button></>}>
    <div className="bw-kv"><span>目标任务</span><strong>{request.targetTitle}</strong><span>所属项目</span><strong>{request.projectName}（与当前任务相同）</strong></div>
    <fieldset className="bw-radios"><legend>允许的范围</legend>
      <label><input type="radio" name="cross-mode" checked={mode === 'observe'} onChange={() => setMode('observe')} />仅观察（快照、截图、读取）</label>
      <label><input type="radio" name="cross-mode" checked={mode === 'control'} onChange={() => setMode('control')} />可以操作（点击、输入、导航）</label>
    </fieldset>
    <p className="bw-hint"><ShieldAlert size={13} />授权只在本次运行内有效，运行结束、终端退出或你撤销后立即失效；跨项目请求一律拒绝。两个任务共用同一项目登录态。</p>
  </PanelDialog>;
}

export function GrantsDialog({ grants, onRevoke, onClose }) {
  return <PanelDialog title="跨任务授权" subtitle="本次运行中你已允许的访问" onClose={onClose} footer={<button type="button" onClick={onClose}>完成</button>}>
    {grants.length ? <ul className="bw-list">{grants.map(item => <li key={item.taskId}><span><strong>{item.title}</strong><small>{item.mode === 'control' ? '可以操作' : '仅观察'} · 仅本次运行</small></span><button type="button" className="bw-mini" onClick={() => onRevoke(item.taskId)}>撤销</button></li>)}</ul> : <p className="bw-empty-note">本次运行没有授予任何跨任务访问。</p>}
  </PanelDialog>;
}

/** B12 profile management (R05, O10, C1) with certificate exceptions (O3) and site permissions (O4). */
export function ProfilesDialog({ store, currentProfile, taskTitle, onUse, onCreate, onClone, onDelete, onRevokeCert, onRevokePermission, onImport, onRetryRecovery, onClearLogin, onClose }) {
  const [selected, setSelected] = useState(currentProfile);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmClear, setConfirmClear] = useState(null);
  const profile = store.profiles.find(item => item.id === selected) ?? store.profiles[0];
  const certs = store.certExceptions[profile.id] ?? [];
  const perms = Object.entries(store.permissions[profile.id] ?? {}).flatMap(([host, values]) => Object.entries(values).map(([name, decision]) => ({ host, name, decision })));
  const source = store.sources[profile.id];
  return <PanelDialog wide title="登录态管理" subtitle="每个 profile 独立保存 Cookie、本地存储与缓存。默认使用项目登录态；任务需要不同账号时新建独立登录态。" onClose={onClose} footer={<button type="button" onClick={onClose}>完成</button>}>
    <div className="bw-profiles">
      <ul className="bw-profile-list" role="listbox" aria-label="登录态列表">
        {store.profiles.map(item => <li key={item.id}><button type="button" role="option" aria-selected={item.id === profile.id} className={item.id === profile.id ? 'selected' : ''} onClick={() => setSelected(item.id)}><UserRound size={14} /><span><strong>{item.label}</strong><small>{item.scope === 'project' ? '项目默认' : '任务独立'}{item.id === currentProfile ? ' · 当前页面使用中' : ''}</small></span></button></li>)}
        <li><button type="button" className="bw-add" onClick={onCreate}><Plus size={14} />为「{taskTitle}」新建独立登录态</button></li>
      </ul>
      <div className="bw-profile-detail">
        <h3>{profile.label}</h3>
        <p className="bw-hint">{source ? `已从 ${source.browser} · ${source.profileName} 导入 Cookie` : '没有导入记录'}</p>
        {store.attention?.[profile.id] && <div className="bw-attention" role="alert"><ShieldAlert size={15} /><div><strong>需要处理：上次导入的恢复没有完成</strong><p>使用这个登录态的页面暂时不可用，Agent 的浏览器命令会返回 <code>BROWSER_UNAVAILABLE</code>。可以重试恢复，或清空这个登录态的 Cookie、存储与缓存后继续使用。</p>
          <div className="bw-row-actions"><button type="button" className="bw-mini" onClick={() => onRetryRecovery(profile.id)}>重试恢复</button>
          {confirmClear === profile.id ? <><span className="bw-danger-text">将清空此登录态的全部 Cookie、存储与缓存，需要重新登录。</span><button type="button" className="bw-mini bw-mini-danger" onClick={() => { onClearLogin(profile.id); setConfirmClear(null); }}>确认清空</button><button type="button" className="bw-mini" onClick={() => setConfirmClear(null)}>取消</button></>
            : <button type="button" className="bw-mini" onClick={() => setConfirmClear(profile.id)}>清空该登录态</button>}</div></div></div>}
        <div className="bw-row-actions">
          <button type="button" className="bw-mini" disabled={profile.id === currentProfile || Boolean(store.attention?.[profile.id])} onClick={() => onUse(profile.id)}>用于当前页面</button>
          <button type="button" className="bw-mini" disabled={Boolean(store.attention?.[profile.id])} onClick={() => onClone(profile.id)}><Copy size={13} />克隆</button>
          <button type="button" className="bw-mini" disabled={Boolean(store.attention?.[profile.id])} title={store.attention?.[profile.id] ? '处理完“需要处理”后才能再次导入' : undefined} onClick={() => onImport(profile.id)}>导入 Chrome／Edge 登录态</button>
          {profile.scope !== 'project' && (confirmDelete === profile.id
            ? <><span className="bw-danger-text">删除后其登录态一并清除，使用它的页面改用项目登录态。</span><button type="button" className="bw-mini bw-mini-danger" onClick={() => { onDelete(profile.id); setSelected('project'); setConfirmDelete(null); }}>确认删除</button><button type="button" className="bw-mini" onClick={() => setConfirmDelete(null)}>取消</button></>
            : <button type="button" className="bw-mini" disabled={Boolean(store.attention?.[profile.id])} onClick={() => setConfirmDelete(profile.id)}><Trash2 size={13} />删除</button>)}
        </div>
        <h4>证书例外</h4>
        {certs.length ? <ul className="bw-list">{certs.map(host => <li key={host}><span><strong>{host}</strong><small>你曾选择继续访问</small></span><button type="button" className="bw-mini" onClick={() => onRevokeCert(profile.id, host)}>撤销</button></li>)}</ul> : <p className="bw-empty-note">无</p>}
        <h4>站点权限</h4>
        {perms.length ? <ul className="bw-list">{perms.map(item => <li key={item.host + item.name}><span><strong>{item.host}</strong><small>{item.name === 'geolocation' ? '位置' : item.name} · {item.decision === 'allow' ? '允许' : '拒绝'}</small></span><button type="button" className="bw-mini" onClick={() => onRevokePermission(profile.id, item.host, item.name)}>撤销</button></li>)}</ul> : <p className="bw-empty-note">无</p>}
      </div>
    </div>
  </PanelDialog>;
}

/** B13 cookie import flow (D2, O11, R06.4). Keychain prompt and results are simulated. */
export function ImportDialog({ store, targetProfile, onImported, onClose, sourceUnavailable = false }) {
  // R06.4: every import entry checks the target; a profile that needs attention cannot be imported into.
  const [step, setStep] = useState(() => sourceUnavailable ? 'result' : 'source');
  const [source, setSource] = useState('chrome:Default');
  const [target, setTarget] = useState(targetProfile);
  const [outcome, setOutcome] = useState(() => sourceUnavailable ? importOutcome('missing') : null);
  const [family, profileName] = source.split(':');
  const browser = IMPORT_SOURCES.find(item => item.family === family);
  const targetLabel = store.profiles.find(item => item.id === target)?.label;
  const blocked = Boolean(store.attention?.[target]);
  function keychain(result) {
    const value = importOutcome(result);
    setOutcome(value);
    setStep('result');
    if (value.ok && value.summary.importedCookies > 0) onImported(target, browser.label, profileName);
  }
  if (step === 'source') return <PanelDialog title="导入 Chrome／Edge 登录态" subtitle="只能由你在这里发起；Agent 没有导入命令。" onClose={onClose} footer={<><button type="button" onClick={onClose}>取消</button><button type="button" disabled={blocked} onClick={() => setStep('confirm')}>下一步</button></>}>
    {blocked && <p className="bw-danger-text" role="alert">「{targetLabel}」上次导入的恢复没有完成，需要先在登录态管理里处理，才能再次导入。</p>}
    <fieldset className="bw-radios"><legend>来源（本机已安装的浏览器，合成）</legend>
      {IMPORT_SOURCES.map(item => <div className="bw-import-browser-group" key={item.family}><strong>{item.label}</strong>{item.profiles.map(name => <label key={item.family + name}><input type="radio" name="import-source" checked={source === item.family + ':' + name} onChange={() => setSource(item.family + ':' + name)} />{item.label} · {name}</label>)}</div>)}
    </fieldset>
    <fieldset className="bw-radios"><legend>导入到</legend>
      {store.profiles.map(item => <label key={item.id}><input type="radio" name="import-target" checked={target === item.id} onChange={() => setTarget(item.id)} />{item.label}</label>)}
    </fieldset>
  </PanelDialog>;
  if (step === 'confirm') return <PanelDialog title="确认导入" onClose={onClose} footer={<><button type="button" onClick={() => setStep('source')}>返回</button><button type="button" disabled={blocked} onClick={() => setStep('keychain')}>确认导入</button></>}>
    <ul className="bw-warn-list">
      <li>将导入 <strong>{browser.label} · {profileName}</strong> 的<strong>全部 Cookie</strong>（Google 登录除外），写入「{targetLabel}」。导入站点按域名整体替换，其他站点不受影响。</li>
      <li><strong>Agent 将能读取这些站点的会话令牌</strong>（<code>cookie get</code> 返回明文值），并可在不设域名护栏的情况下使用它们。</li>
      <li><strong>导入期间，使用「{targetLabel}」的页面会暂时卸载</strong>，页面上未保存的内容会丢失；导入完成后自动重新加载。</li>
      <li>macOS 会请求访问钥匙串中的「{browser.keychain}」。请只在你本人发起导入时允许。</li>
    </ul>
  </PanelDialog>;
  if (step === 'keychain') return <PanelDialog title="模拟 macOS 钥匙串请求" subtitle={`“WillYou”想要使用钥匙串中的“${browser.keychain}”（演示，不会访问真实钥匙串）`} onClose={onClose}
    footer={<><button type="button" onClick={() => keychain('denied')}>模拟拒绝</button><button type="button" onClick={() => keychain('timeout')}>模拟超时</button><button type="button" onClick={() => keychain('undecryptable')}>模拟无法解密</button><button type="button" onClick={() => keychain('allow')}>模拟允许</button></>}>
    <p className="bw-hint"><KeyRound size={13} />真实环境中系统弹窗等待 30 秒；拒绝或超时都不会写入任何 Cookie。</p>
  </PanelDialog>;
  return <PanelDialog title={outcome.ok && outcome.summary.importedCookies > 0 ? '导入完成' : '导入未完成'} onClose={onClose} footer={<button type="button" onClick={onClose}>完成</button>}>
    {!outcome.ok ? <p className="bw-danger-text" role="alert">{outcome.reason}</p>
      : <><div className="bw-kv"><span>总数</span><strong>{outcome.summary.totalCookies}</strong><span>已导入</span><strong>{outcome.summary.importedCookies}</strong><span>已跳过</span><strong>{outcome.summary.skippedCookies}</strong><span>其中 Google</span><strong>{outcome.summary.googleCookiesSkipped}</strong><span>因分区不可读而保留</span><strong>{outcome.summary.partitionSkippedCookies}</strong><span>目标原有保留</span><strong>{outcome.summary.preservedTargetCookies ?? 0}</strong><span>重新加载的页面</span><strong>{outcome.summary.reloadedPages ?? 0}</strong></div>
        {outcome.summary.warning && <p className="bw-danger-text" role="alert">{outcome.summary.warning}</p>}
        {outcome.summary.domains.length > 0 && <p className="bw-hint">涉及站点：{outcome.summary.domains.join('、')}</p>}</>}
  </PanelDialog>;
}

/** B14 browser settings (O2 search engine, O12 identity, O5 download location). */
export function SettingsDialog({ settings, onChange, onClose }) {
  const [confirmClean, setConfirmClean] = useState(false);
  const bytes = settings.artifactBytes ?? 13002342;
  return <PanelDialog title="浏览器设置" onClose={onClose} footer={<button type="button" onClick={onClose}>完成</button>}>
    <fieldset className="bw-radios"><legend>默认搜索引擎（地址栏输入非网址时使用）</legend>
      {Object.entries(SEARCH_ENGINES).map(([id, item]) => <label key={id}><input type="radio" name="engine" checked={settings.engine === id} onChange={() => onChange(current => ({ ...current, engine: id }))} />{item.label}</label>)}
    </fieldset>
    <fieldset className="bw-radios"><legend>浏览器身份（整个应用生效，重启后生效）</legend>
      <label><input type="radio" name="identity" checked={(settings.pendingIdentity ?? settings.identity) === 'clean'} onChange={() => onChange(current => ({ ...current, pendingIdentity: current.identity === 'clean' ? null : 'clean' }))} />清理后的身份（兼容导入的登录态）</label>
      <label><input type="radio" name="identity" checked={(settings.pendingIdentity ?? settings.identity) === 'native'} onChange={() => onChange(current => ({ ...current, pendingIdentity: current.identity === 'native' ? null : 'native' }))} />Electron 原生身份（部分站点需要；Google 登录不可用）</label>
      {settings.pendingIdentity && <p className="bw-hint bw-restart" role="status">已更改，重启 WillYou 后生效。Agent 也可以用 <code>browser identity set</code> 改这一项。</p>}
    </fieldset>
    <div className="bw-kv"><span>下载位置</span><strong>系统下载目录（~/Downloads），不弹保存对话框</strong></div>
    <div className="bw-kv"><span>浏览器文件</span><strong aria-label="浏览器文件占用">{bytes ? (bytes / 1048576).toFixed(1) + ' MB（截图、PDF、HAR 与超限结果，合成）' : '0 MB'}</strong></div>
    <div className="bw-row-actions">{confirmClean
      ? <><span className="bw-danger-text">将删除所有任务的浏览器截图、PDF、HAR 与超限结果文件；系统“下载”目录不受影响。</span><button type="button" className="bw-mini bw-mini-danger" onClick={() => { onChange(current => ({ ...current, artifactBytes: 0 })); setConfirmClean(false); }}>确认清理</button><button type="button" className="bw-mini" onClick={() => setConfirmClean(false)}>取消</button></>
      : <button type="button" className="bw-mini" disabled={!bytes} onClick={() => setConfirmClean(true)}>清理全部浏览器文件</button>}</div>
  </PanelDialog>;
}
