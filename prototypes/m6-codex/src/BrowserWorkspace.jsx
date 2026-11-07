import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, RotateCw, X, Lock, Info, FileText, Globe, MoreHorizontal, FlaskConical,
  Pause, Play, Bot, Search, Server, AlertTriangle, WifiOff, UserRound, ShieldAlert, Download, KeyRound, Files
} from 'lucide-react';
import { DownloadBar, FindBar, PromptBar, HttpAuthDialog, CrossTaskDialog, GrantsDialog, ProfilesDialog, ImportDialog, SettingsDialog, JavascriptDialog } from './BrowserPanels';
import {
  BLANK_URL, AGENT_HOLD_MS, LOAD_FAILURES, RECOVERY_TEXT, resolveAddress, resolvePage, securityState, hostLabel,
  currentUrl, navigateTab, goBack, goForward, canGoBack, canGoForward, updateTab,
  agentCommandStart, agentCommandEnd, agentMarked, agentHoldRemaining, pauseAgent, resumeAgent, endRun,
  uniqueDownloadName, addCertException, removeCertException, permissionDecision, rememberPermission, revokePermission,
  crossTaskDecision, grantCrossTask, revokeCrossTask, createTaskProfile, cloneProfile, recordImport, projectProfiles, markRecoveryFailed, needsAttention, resolveRecovery, clearProfileLogin
} from './browser-prototype-model.mjs';

const LOAD_MS = 650;

const ToolButton = ({ icon: C, label, onClick, disabled }) => (
  <button type="button" className="fw-icon" title={label} aria-label={label} onClick={onClick} disabled={disabled}><C size={17} strokeWidth={1.65} /></button>
);

const SECURITY = {
  secure: { icon: Lock, label: '安全连接（合成示例）' },
  local: { icon: Server, label: '本机地址' },
  insecure: { icon: Info, label: '非安全连接（http）' },
  file: { icon: FileText, label: '本机文件' },
  certificate: { icon: ShieldAlert, label: '证书不受信任（非安全连接）' },
  none: { icon: Globe, label: '新标签页' }
};

/** One task's web tab content. Tab strip lives in the shared right workspace (FileWorkspace). */
export function BrowserWorkspace({ state, onChange, projectName = '示例项目', taskTitle = '当前任务', profileStore, onProfileStore, onDeleteProfile, settings = { engine: 'bing', identity: 'clean', pendingIdentity: null }, onSettings = () => {}, peerTask, recentSites = [], onOpenFiles }) {
  const store = profileStore ?? projectProfiles(projectName);
  const setStore = onProfileStore ?? (() => {});
  const engine = settings.engine;
  const tab = state.tabs.find(item => item.id === state.active);
  const url = tab ? currentUrl(tab) : BLANK_URL;
  const [draft, setDraft] = useState(url);
  const [editing, setEditing] = useState(false);
  const [loadingTab, setLoadingTab] = useState(null); // loading is per tab, so a new or switched tab never inherits it
  const [offline, setOffline] = useState(false);
  const [startedServers, setStartedServers] = useState([]);
  const [menu, setMenu] = useState(false);
  const [demo, setDemo] = useState(true);
  const [status, setStatus] = useState('');
  const [now, setNow] = useState(Date.now());
  const [findOpen, setFindOpen] = useState(false);
  const [prompt, setPrompt] = useState(null);
  const [javascriptDialog, setJavascriptDialog] = useState(null);
  const [dialog, setDialog] = useState(null); // 'profiles' | 'import' | 'settings' | 'grants' | { cross request }
  const [importTarget, setImportTarget] = useState('project');
  const [authed, setAuthed] = useState([]);
  const [authCancelled, setAuthCancelled] = useState([]);
  const pageRef = useRef(null);
  const rootRef = useRef(null);
  const downloadTimers = useRef(new Map());
  const address = useRef(null);
  const justFocused = useRef(false); // first click selects the whole address, like Chromium
  const loadTimer = useRef(null);
  const commandTimer = useRef(null);

  useEffect(() => { if (!editing) setDraft(url === BLANK_URL ? '' : url); }, [url, editing, tab?.id]);
  useEffect(() => { setJavascriptDialog(null); }, [tab?.id]);
  function shortcut(event) {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
    const key = event.key.toLowerCase();
    if (key === 'f') { event.preventDefault(); setFindOpen(true); return true; }
    if (key === 'l') { event.preventDefault(); address.current?.focus(); address.current?.select(); return true; }
    return false;
  }
  // Keys inside the web layer are handled by its own onKeyDown (which also stops them reaching the file area).
  // After clicking non-focusable page content, focus is on <body>; handle only that case at window level so the
  // terminal, file editor and other controls keep their own shortcuts.
  useEffect(() => {
    const onKey = event => { if (event.target === document.body) shortcut(event); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => () => { clearTimeout(loadTimer.current); clearTimeout(commandTimer.current); for (const timer of downloadTimers.current.values()) clearInterval(timer); }, []);
  const holding = state.agent && !state.agent.running && agentHoldRemaining(state, now) > 0;
  useEffect(() => {
    if (!state.agent) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.agent]);

  if (!tab) return <div className="bw-root"><div className="fw-empty"><Globe size={22} /><p>这个任务还没有打开网页。</p></div></div>;

  const loading = loadingTab === tab.id;
  const marked = agentMarked(state, tab.id, now);
  const profileId = store.profiles.some(item => item.id === tab.profile) ? tab.profile : 'project';
  const profileLabel = store.profiles.find(item => item.id === profileId)?.label ?? '项目登录态';
  const page = tab.invalid ? null : resolvePage(url, { offline, startedServers, certAllowed: store.certExceptions[profileId] ?? [], authed });
  const downloads = state.downloads ?? [];
  const grants = state.grants ?? [];

  function startLoad() {
    clearTimeout(loadTimer.current);
    setLoadingTab(tab.id);
    loadTimer.current = setTimeout(() => setLoadingTab(null), LOAD_MS);
  }
  function go(nextUrl) {
    onChange(current => updateTab(current, tab.id, item => ({ ...navigateTab(item, nextUrl), invalid: null })));
    startLoad();
  }
  function submit(event) {
    event.preventDefault();
    const result = resolveAddress(draft, engine);
    if (result.status === 'invalid') {
      // Keep focus and the typed text (selected) so the user can correct it; do not reset it to the old address.
      onChange(current => updateTab(current, tab.id, item => ({ ...item, invalid: { input: draft.trim(), message: result.message } })));
      address.current?.select();
      return;
    }
    setEditing(false);
    setDraft(result.url === BLANK_URL ? '' : result.url); // show the normalized address immediately
    go(result.url);
    address.current?.blur();
  }
  function reload() {
    if (loading) { clearTimeout(loadTimer.current); setLoadingTab(null); setStatus('已停止加载'); return; }
    if (tab.invalid) { onChange(current => updateTab(current, tab.id, item => ({ ...item, invalid: null }))); }
    startLoad();
  }
  function history(step) {
    onChange(current => updateTab(current, tab.id, item => ({ ...(step < 0 ? goBack(item) : goForward(item)), invalid: null })));
    startLoad();
  }
  function agentCommand(kind) {
    const started = agentCommandStart(state, tab.id, Date.now(), { kind, unavailable: needsAttention(store, profileId) });
    if (started.outcome === 'BROWSER_UNAVAILABLE') { setStatus('演示：Agent 的命令被拒绝，返回 BROWSER_UNAVAILABLE（当前登录态需要处理）'); return; }
    if (started.outcome === 'BROWSER_PAUSED') { setStatus('演示：Agent 的命令被拒绝，返回 BROWSER_PAUSED（用户已暂停）'); return; }
    onChange(() => started.state);
    setStatus(kind === 'read' ? '演示：Agent 正在执行只读等待（wait，约 8 秒）' : '演示：Agent 正在执行一条写命令（如 click，约 1.5 秒）');
    clearTimeout(commandTimer.current);
    commandTimer.current = setTimeout(() => {
      onChange(current => (current.agent?.running ? agentCommandEnd(current, Date.now()) : current));
      setNow(Date.now());
      setStatus('演示：命令已结束，活动标记保持 20 秒后清除');
    }, kind === 'read' ? 8000 : 1500);
  }
  function pause() {
    const result = pauseAgent(state);
    onChange(() => result.state);
    if (result.interrupted) { clearTimeout(commandTimer.current); setStatus('已暂停：正在进行的只读等待立即结束，返回 BROWSER_PAUSED'); }
    else setStatus(state.agent?.running ? '已暂停：正在执行的写命令会执行完这一条，之后的命令返回 BROWSER_PAUSED' : '已暂停 Agent 的浏览器操作');
  }
  function resume() { onChange(current => resumeAgent(current)); setStatus('已恢复，Agent 可以继续操作'); }
  function endDemoRun() { clearTimeout(commandTimer.current); onChange(current => ({ ...endRun(current), grants: [] })); setStatus('演示：运行已结束，暂停状态、活动标记与跨任务授权已清除'); }

  const [downloadsOpen, setDownloadsOpen] = useState(false), [downloadsHover, setDownloadsHover] = useState(false);
  function dismissDownloads(event) {
    if (!downloadsOpen || event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.nativeEvent?.isComposing || event.target.closest?.('[role="dialog"]')) return;
    event.preventDefault();
    setDownloadsOpen(false);
  }
  // R0.8: downloads live behind a toolbar button; a new download pops the list open, and it folds away 6 s after the last change unless hovered.
  useEffect(() => {
    if (!downloadsOpen || downloadsHover) return undefined;
    const timer = setTimeout(() => setDownloadsOpen(false), 6000);
    return () => clearTimeout(timer);
  }, [downloadsOpen, downloadsHover, downloads]);
  useEffect(() => {
    if (!downloadsOpen) return undefined;
    const outside = event => { if (!event.target.closest?.('.bw-downloads, .bw-dl-anchor')) setDownloadsOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', dismissDownloads);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', dismissDownloads);
    };
  }, [downloadsOpen]);
  function startDownload(name, fail = false) {
    setDownloadsOpen(true);
    const id = 'dl-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const fileName = uniqueDownloadName(name, downloads.map(item => item.name));
    onChange(current => ({ ...current, downloads: [{ id, name: fileName, state: 'progress', progress: 0 }, ...(current.downloads ?? [])] }));
    const timer = setInterval(() => {
      onChange(current => ({ ...current, downloads: (current.downloads ?? []).map(item => {
        if (item.id !== id || item.state !== 'progress') return item;
        const progress = item.progress + 25;
        if (fail && progress >= 50) { clearInterval(downloadTimers.current.get(id)); return { ...item, state: 'failed', progress }; }
        if (progress >= 100) { clearInterval(downloadTimers.current.get(id)); return { ...item, state: 'done', progress: 100 }; }
        return { ...item, progress };
      }) }));
    }, 300);
    downloadTimers.current.set(id, timer);
    setStatus(`开始下载 ${fileName}（保存到系统下载目录，合成）`);
  }
  function downloadAction(item, action) {
    if (action === 'cancel') { clearInterval(downloadTimers.current.get(item.id)); onChange(current => ({ ...current, downloads: current.downloads.map(entry => (entry.id === item.id ? { ...entry, state: 'canceled' } : entry)) })); setStatus('已取消下载 ' + item.name); }
    if (action === 'remove') onChange(current => ({ ...current, downloads: current.downloads.filter(entry => entry.id !== item.id) }));
    if (action === 'open') setStatus('演示：会用系统默认应用打开 ' + item.name);
    if (action === 'reveal') setStatus('演示：会在访达中显示 ~/Downloads/' + item.name);
  }
  function requestPermission() {
    const host = hostLabel(url) || '新标签页';
    const decision = permissionDecision(store, profileId, host, 'geolocation');
    if (decision !== 'ask') { setStatus(`站点再次申请位置：按记住的选择自动${decision === 'allow' ? '允许' : '拒绝'}（${profileLabel}）`); return; }
    setPrompt({ type: 'permission', host });
  }
  function resolvePrompt(choice) {
    if (prompt?.type === 'permission') { setStore(current => rememberPermission(current, profileId, prompt.host, 'geolocation', choice)); setStatus(`已${choice === 'allow' ? '允许' : '拒绝'} ${prompt.host} 获取位置，并记在「${profileLabel}」中`); }
    else setStatus(choice === 'open' ? '演示：会交给系统处理 zoommtg:// 链接（原型不打开）' : '已取消打开外部应用');
    setPrompt(null);
  }
  function crossRequest(kind) {
    if (kind === 'other-project') { const d = crossTaskDecision({ sameProject: false, unattended: false }); setStatus(`演示：跨项目请求被拒绝，返回 ${d.code}（${d.reason}），不弹窗`); return; }
    if (kind === 'unattended') { const d = crossTaskDecision({ sameProject: true, unattended: true }); setStatus(`演示：无人值守运行的跨任务请求被拒绝，返回 ${d.code}（${d.reason}）`); return; }
    setDialog({ type: 'cross', fromTitle: taskTitle, targetTitle: peerTask?.title ?? '复现 Bug #1025（同项目示例任务，合成）', targetId: peerTask?.id ?? 'peer-demo', projectName, mode: 'observe' });
  }

  // A page reached through (or blocked by) a certificate problem is never shown as a secure connection.
  const securityKey = tab.invalid ? 'none' : page?.kind === 'cert-error' || page?.kind === 'cert-continued' ? 'certificate' : securityState(url);
  const security = SECURITY[securityKey];
  const SecurityIcon = security.icon;
  const holdSeconds = Math.ceil(agentHoldRemaining(state, now) / 1000);

  return <div ref={rootRef} className="bw-root" onKeyDown={event => { dismissDownloads(event); shortcut(event); event.stopPropagation(); }}>
    <div className="fw-toolbar bw-toolbar">
      <div className="bw-nav">
        <ToolButton icon={ArrowLeft} label="后退" onClick={() => history(-1)} disabled={!canGoBack(tab)} />
        <ToolButton icon={ArrowRight} label="前进" onClick={() => history(1)} disabled={!canGoForward(tab)} />
        <ToolButton icon={loading ? X : RotateCw} label={loading ? '停止加载' : tab.invalid || page?.kind === 'failure' ? '重试' : '刷新'} onClick={reload} />
      </div>
      <form className="fw-breadcrumb bw-address" onSubmit={submit} role="search">
        <span className={'bw-security bw-' + securityKey} title={security.label} aria-label={security.label}><SecurityIcon size={13} /></span>
        <input ref={address} aria-label="地址栏" value={draft} placeholder="输入网址或搜索内容" spellCheck={false}
          onFocus={event => { setEditing(true); justFocused.current = true; event.currentTarget.select(); }}
          onMouseUp={event => { if (justFocused.current) { event.preventDefault(); event.currentTarget.select(); justFocused.current = false; } }}
          onBlur={() => { setEditing(false); justFocused.current = false; }}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Escape') { setDraft(url === BLANK_URL ? '' : url); event.currentTarget.blur(); } }} />
        <button type="button" className="bw-profile" title={'当前页面的登录态：' + profileLabel} onClick={() => setDialog('profiles')}><UserRound size={12} />{profileId === 'project' ? '项目登录态' : '独立登录态'}</button>
      </form>
      <div className="fw-tools">
        {state.paused
          ? <button type="button" className="fw-pill bw-resume" onClick={resume}><Play size={13} />恢复 Agent</button>
          : (marked || holding) && <button type="button" className="fw-pill bw-pause" onClick={pause}><Pause size={13} />暂停 Agent</button>}
        {downloads.length > 0 && <span className="bw-dl-anchor"><button type="button" className={'fw-icon' + (downloadsOpen ? ' active' : '')} title={`下载（${downloads.length}）`} aria-label={`下载（${downloads.length}）`} aria-expanded={downloadsOpen} onClick={() => setDownloadsOpen(!downloadsOpen)}><Download size={17} strokeWidth={1.65} /></button>{downloads.some(item => item.state === 'progress') && <i className="bw-dl-busy" aria-hidden="true" />}</span>}
        <ToolButton icon={FlaskConical} label={demo ? '隐藏演示控制' : '显示演示控制'} onClick={() => setDemo(!demo)} />
        <ToolButton icon={MoreHorizontal} label="浏览器菜单" onClick={() => setMenu(!menu)} />
      </div>
    </div>
    {menu && <><button className="fw-dismiss" aria-label="关闭菜单" tabIndex={-1} onClick={() => setMenu(false)} /><div className="fw-menu bw-menu" role="menu" onClick={() => setMenu(false)}>
      <button role="menuitem" onClick={() => setFindOpen(true)}><Search size={14} />页内查找<kbd>⌘F</kbd></button>
      <button role="menuitem" onClick={() => setDownloadsOpen(true)}><Download size={14} />下载（{downloads.length}）</button>
      <button role="menuitem" onClick={() => setDialog('profiles')}><UserRound size={14} />登录态管理</button>
      <button role="menuitem" disabled={needsAttention(store, profileId)} title={needsAttention(store, profileId) ? '当前登录态需要处理，处理完后才能再次导入' : undefined} onClick={() => { setImportTarget(profileId); setDialog('import'); }}><KeyRound size={14} />导入 Chrome／Edge 登录态</button>
      <button role="menuitem" onClick={() => setDialog('grants')}><ShieldAlert size={14} />跨任务授权（{grants.length}）</button>
      <button role="menuitem" onClick={() => setDialog('settings')}><Info size={14} />浏览器设置</button>
    </div></>}
    {needsAttention(store, profileId) && <div className="bw-banner bw-attention-banner" role="alert"><ShieldAlert size={14} /><span>当前登录态需要处理：上次导入的恢复没有完成，页面暂时不可用，Agent 的浏览器命令返回 <code>BROWSER_UNAVAILABLE</code>。</span><button type="button" className="bw-mini" onClick={() => setDialog('profiles')}>去处理</button></div>}
    {state.paused && <div className="bw-banner bw-paused" role="status"><Pause size={14} /><span>已暂停 Agent 的浏览器操作。暂停期间 Agent 的浏览器命令会返回 <code>BROWSER_PAUSED</code>；你可以在页面里手动登录或处理弹窗，完成后点“恢复 Agent”。</span></div>}
    {!state.paused && marked && <div className="bw-banner bw-agent" role="status"><Bot size={14} /><span>{state.agent?.running ? 'Agent 正在操作此页面' : `Agent 最近操作过此页面 · ${holdSeconds} 秒后清除标记`}</span></div>}
    <PromptBar prompt={prompt} onResolve={resolvePrompt} />
    {findOpen && <FindBar pageRef={pageRef} onClose={() => { setFindOpen(false); address.current?.blur(); }} />}
    {downloadsOpen && downloads.length > 0 && <DownloadBar downloads={downloads} onAction={downloadAction} onHover={setDownloadsHover} onClose={() => setDownloadsOpen(false)} />}
    <div className={'bw-frame' + (marked && !state.paused ? ' bw-agent-glow' : '')}><div ref={pageRef} className="bw-page" aria-busy={loading}>
      {loading && <div className="bw-progress" aria-hidden="true" />}
      {tab.invalid ? <InvalidPage invalid={tab.invalid} />
        : page.kind === 'failure' ? <FailurePage page={page} onRetry={reload} onStartServer={() => { setStartedServers(list => [...new Set([...list, page.host])]); startLoad(); setStatus('演示：服务已启动，页面自动重新加载'); }} onOnline={() => { setOffline(false); startLoad(); setStatus('演示：网络已恢复，页面自动重新加载'); }} />
        : <SyntheticPage page={page} url={url} onGo={go} recentSites={recentSites} onOpenFiles={onOpenFiles} onBack={() => history(-1)} canBack={canGoBack(tab)} onDownload={() => startDownload('订单导出.csv')} authCancelled={authCancelled.includes(page.host)} onRetryAuth={() => setAuthCancelled(list => list.filter(host => host !== page.host))} onContinueCert={() => { setStore(current => addCertException(current, profileId, page.host)); startLoad(); setStatus(`已为 ${page.host} 添加证书例外（记在「${profileLabel}」中，可撤销）`); }} />}
    </div></div>
    {demo && <div className="fw-demo bw-demo" aria-label="演示控制（合成）">
      <strong>演示 · 合成</strong>
      <button type="button" onClick={() => agentCommand('write')}>模拟 Agent 写命令</button>
      <button type="button" onClick={() => agentCommand('read')}>模拟 Agent 只读等待</button>
      <button type="button" onClick={endDemoRun}>模拟运行结束</button>
      <label><input type="checkbox" checked={offline} onChange={event => { setOffline(event.target.checked); startLoad(); }} />离线</label>
      <span className="bw-demo-break" />
      {['alert', 'confirm', 'prompt', 'error'].map(kind => <button key={kind} type="button" onClick={() => setJavascriptDialog({ id: 'javascript-' + Date.now(), kind: kind === 'error' ? 'prompt' : kind, fail: kind === 'error', message: kind === 'alert' ? '这是一条合成网页提示。' : kind === 'confirm' ? '确认继续这个合成操作？' : '请输入合成内容。', defaultValue: '合成输入' })}>演示 JS {kind === 'alert' ? '提示' : kind === 'confirm' ? '确认' : kind === 'prompt' ? '输入' : '失败'}</button>)}
      <button type="button" onClick={requestPermission}>模拟站点申请位置</button>
      <button type="button" onClick={() => setPrompt({ type: 'external', url: 'zoommtg://zoom.us/join?confno=000' })}>模拟外部应用链接</button>
      <button type="button" onClick={() => startDownload('日志.zip', true)}>模拟下载失败</button>
      <button type="button" onClick={() => crossRequest('same-project')}>模拟跨任务请求（同项目）</button>
      <button type="button" onClick={() => crossRequest('other-project')}>模拟跨项目请求</button>
      <button type="button" onClick={() => crossRequest('unattended')}>模拟无人值守跨任务请求</button>
      <button type="button" onClick={() => { setStore(current => markRecoveryFailed(current, profileId, 1)); setStatus('演示：导入恢复失败，当前登录态需要处理'); }}>模拟导入恢复失败</button>
      <button type="button" disabled={needsAttention(store, profileId)} onClick={() => { setImportTarget(profileId); setDialog('import-missing'); }}>模拟找不到浏览器</button>
      <span role="status" className="bw-demo-status">{status}</span>
    </div>}
    {javascriptDialog && <JavascriptDialog key={javascriptDialog.id} dialog={javascriptDialog} onRespond={async (accept, value) => { if (javascriptDialog.fail && accept) throw new Error('演示：原提示已失效，请取消后重新打开。'); setJavascriptDialog(null); setStatus(accept ? '演示：JS 对话框已接受' + (value === undefined ? '' : ' · ' + JSON.stringify(value)) : '演示：JS 对话框已取消'); }} />}
    {page?.kind === 'http-auth' && !authCancelled.includes(page.host) && <HttpAuthDialog host={page.host} onCancel={() => { setAuthCancelled(list => [...list, page.host]); setStatus('已取消基本认证'); }} onSubmit={() => { setAuthed(list => [...list, page.host]); startLoad(); setStatus('已提交基本认证（演示，未保存账号密码）'); }} />}
    {dialog?.type === 'cross' && <CrossTaskDialog request={dialog} onDecide={mode => { if (mode) { onChange(current => grantCrossTask(current, { taskId: dialog.targetId, title: dialog.targetTitle, mode })); setStatus(`已允许本次运行${mode === 'control' ? '操作' : '观察'}「${dialog.targetTitle}」的网页`); } else setStatus('已拒绝跨任务请求，Agent 收到 SCOPE_DENIED'); setDialog(null); }} />}
    {dialog === 'grants' && <GrantsDialog grants={grants} onRevoke={taskId => { onChange(current => revokeCrossTask(current, taskId)); setStatus('已撤销跨任务授权'); }} onClose={() => setDialog(null)} />}
    {dialog === 'profiles' && <ProfilesDialog store={store} currentProfile={profileId} taskTitle={taskTitle}
      onUse={id => { onChange(current => updateTab(current, tab.id, item => ({ ...item, profile: id }))); startLoad(); setStatus('当前页面已改用「' + (store.profiles.find(item => item.id === id)?.label ?? '') + '」'); }}
      onCreate={() => { const created = createTaskProfile(store, taskTitle); setStore(() => created.store); setStatus('已新建本任务的独立登录态（C1）'); }}
      onClone={id => { const cloned = cloneProfile(store, id); setStore(() => cloned.store); setStatus('已克隆登录态'); }}
      onDelete={id => { onDeleteProfile?.(id); setStatus('已删除登录态，使用它的页面改用项目登录态'); }}
      onRevokeCert={(id, host) => setStore(current => removeCertException(current, id, host))}
      onRevokePermission={(id, host, name) => setStore(current => revokePermission(current, id, host, name))}
      onImport={id => { setImportTarget(id); setDialog('import'); }}
      onRetryRecovery={id => { setStore(current => resolveRecovery(current, id)); setStatus('已重试恢复：导入前的 Cookie 已恢复（合成）'); }}
      onClearLogin={id => { setStore(current => clearProfileLogin(current, id)); setStatus('已清空该登录态，需要重新登录（合成）'); }}
      onClose={() => setDialog(null)} />}
    {(dialog === 'import' || dialog === 'import-missing') && <ImportDialog store={store} targetProfile={importTarget} sourceUnavailable={dialog === 'import-missing'} onImported={(id, browser, name) => { if (needsAttention(store, id)) { setStatus('导入被拒绝：目标登录态需要先处理'); return; } setStore(current => recordImport(current, id, browser, name, Date.now())); setStatus(`已从 ${browser} · ${name} 导入登录态（合成）`); }} onClose={() => setDialog(null)} />}
    {dialog === 'settings' && <SettingsDialog settings={settings} onChange={onSettings} onClose={() => setDialog(null)} />}
  </div>;
}

function InvalidPage({ invalid }) {
  return <div className="bw-failure"><AlertTriangle size={26} /><h2>{invalid.message}</h2><p>你输入的是：<code>{invalid.input}</code></p></div>;
}

function FailurePage({ page, onRetry, onStartServer, onOnline }) {
  const info = LOAD_FAILURES[page.failure];
  const host = page.host || '';
  return <div className="bw-failure">
    {page.failure === 'offline' ? <WifiOff size={26} /> : <AlertTriangle size={26} />}
    <h2>{info.title(host)}</h2>
    {info.description && <p>{info.description}</p>}
    {info.recovery && <p className="bw-recovery"><span className="fw-loading" />{RECOVERY_TEXT[info.recovery]}</p>}
    <small className="bw-error-name">{info.error}</small>
    <div className="bw-failure-actions">
      <button type="button" className="fw-pill" onClick={onRetry}><RotateCw size={13} />重试</button>
      {info.recovery === 'poll' && <button type="button" className="bw-demo-link" onClick={onStartServer}>演示：模拟服务已启动</button>}
      {info.recovery === 'online' && <button type="button" className="bw-demo-link" onClick={onOnline}>演示：模拟网络恢复</button>}
    </div>
  </div>;
}

const EXAMPLES = [
  { label: '测试环境（合成）', url: 'https://qa.example.test/' },
  { label: '本地开发服务', url: 'http://localhost:5173/' },
  { label: '本地服务未启动', url: 'http://localhost:3000/' },
  { label: '连接被拒绝', url: 'https://refused.example.test/' },
  { label: '域名解析失败', url: 'https://nxdomain.example.test/' },
  { label: '响应超时', url: 'https://timeout.example.test/' },
  { label: '连接被中断', url: 'https://reset.example.test/' },
  { label: '其他错误', url: 'https://other.example.test/' },
  { label: '证书不受信任', url: 'https://selfsigned.example.test/' },
  { label: '需要基本认证', url: 'https://auth.example.test/' }
];

function SyntheticPage({ page, url, onGo, recentSites = [], onOpenFiles, onBack, canBack, onDownload, onContinueCert, authCancelled, onRetryAuth }) {
  if (page.kind === 'blank') return <div className="bw-launcher" aria-label="新标签页">
    <section>
      <h2>工具</h2>
      <div className="bw-launcher-tools">
        <button type="button" className="bw-launcher-tool" disabled={!onOpenFiles} onClick={onOpenFiles}><Files size={17} strokeWidth={1.65} /><span>文件</span><kbd>⌘P</kbd></button>
      </div>
    </section>
    <section>
      <h2>推荐</h2>
      {recentSites.length
        ? <div className="bw-launcher-sites">{recentSites.map(site => <button key={site.host} type="button" className="bw-launcher-site" title={site.title + ' · ' + site.host} onClick={() => onGo(site.url)}><span className="bw-launcher-icon"><Globe size={26} strokeWidth={1.4} /></span><span className="bw-launcher-name">{site.title}</span></button>)}</div>
        : <p className="bw-launcher-empty">本项目还没有访问记录。在上方地址栏输入网址或搜索内容，访问过的网站会出现在这里。</p>}
    </section>
    <section className="bw-launcher-demo">
      <h2>原型示例（合成，不访问网络）</h2>
      <div className="bw-examples">{EXAMPLES.map(item => <button key={item.url} type="button" onClick={() => onGo(item.url)}><span>{item.label}</span><code>{hostLabel(item.url)}</code></button>)}</div>
    </section>
  </div>;
  if (page.kind === 'qa-login') return <form className="bw-site" onSubmit={event => { event.preventDefault(); onGo('https://qa.example.test/orders/1024'); }}>
    <div className="bw-site-head">订单系统 · 测试环境<span>合成示例站点</span></div>
    <div className="bw-site-card">
      <h2>登录</h2>
      <label>用户名<input name="user" defaultValue="tester01" autoComplete="off" /></label>
      <label>密码<input name="pass" type="password" defaultValue="" placeholder="演示，任意输入" autoComplete="off" /></label>
      <button type="submit" className="bw-site-primary">登录</button>
      <small>演示页面不校验、不保存任何输入。</small>
    </div>
  </form>;
  if (page.kind === 'qa-order') return <div className="bw-site">
    <div className="bw-site-head">订单系统 · 测试环境<span>当前用户：tester01（合成）</span></div>
    <div className="bw-site-card bw-wide">
      <h2>订单 #1024</h2>
      <table><tbody>
        <tr><th>商品单价</th><td>100.00</td></tr>
        <tr><th>数量</th><td>2</td></tr>
        <tr><th>优惠</th><td>-10.00</td></tr>
        <tr><th>应付金额</th><td className="bw-wrong">200.00</td></tr>
      </tbody></table>
      <p className="bw-note">合成 Bug：应付金额应为 190.00，优惠未参与计算。用于演示“复现 Bug”场景。</p>
      <button type="button" className="bw-site-link" onClick={onDownload}>导出订单 CSV</button>
    </div>
  </div>;
  if (page.kind === 'cert-error') return <div className="bw-failure bw-cert">
    <ShieldAlert size={26} />
    <h2>此连接不受信任</h2>
    <p><strong>{page.host}</strong> 的证书不是由受信任的机构签发的（常见于内网测试环境的自签名证书）。继续访问时，你与该站点之间的通信可能被他人读取或篡改。</p>
    <small className="bw-error-name">ERR_CERT_AUTHORITY_INVALID</small>
    <div className="bw-failure-actions"><button type="button" className="fw-pill" onClick={onBack} disabled={!canBack}>返回</button><button type="button" className="bw-danger-link" onClick={onContinueCert}>我了解风险，继续访问</button></div>
    <p className="bw-hint">只有你可以在这里放行；Agent 命令无法添加证书例外。例外按站点记在当前登录态中，可在登录态管理里撤销。</p>
  </div>;
  if (page.kind === 'cert-continued') return <div className="bw-site"><div className="bw-site-head">内部系统（合成）<span>按证书例外访问</span></div><div className="bw-site-card bw-wide"><h2>{page.host}</h2><p>你已为此站点添加证书例外。地址栏显示为非安全连接。</p></div></div>;
  if (page.kind === 'http-auth') return <div className="bw-failure">{authCancelled ? <><KeyRound size={26} /><h2>401 · 需要认证</h2><p>你取消了 {page.host} 的登录。</p><div className="bw-failure-actions"><button type="button" className="fw-pill" onClick={onRetryAuth}><RotateCw size={13} />重新登录</button></div></> : <><KeyRound size={26} /><h2>{page.host} 要求登录</h2></>}</div>;
  if (page.kind === 'auth-ok') return <div className="bw-site"><div className="bw-site-head">受保护的站点（合成）<span>HTTP 基本认证</span></div><div className="bw-site-card bw-wide"><h2>{page.host}</h2><p>已通过基本认证。原型没有保存你输入的账号和密码。</p></div></div>;
  if (page.kind === 'local-dev') return <div className="bw-site"><div className="bw-site-head">本地开发服务<span>{hostLabel(url)}</span></div><div className="bw-site-card bw-wide"><h2>Vite 开发服务器（合成）</h2><p>修复后在终端重启本地服务，再在这里验证。原型不会连接真实端口。</p></div></div>;
  if (page.kind === 'search') return <div className="bw-site"><div className="bw-site-head"><Search size={14} />{page.engine} 搜索（合成）</div><div className="bw-site-card bw-wide"><h2>{page.query}</h2><p>原型不会把搜索词发给搜索引擎。默认引擎可在浏览器设置中更改（第二批原型）。</p></div></div>;
  if (page.kind === 'file') return <div className="bw-site"><div className="bw-site-head"><FileText size={14} />本机文件</div><div className="bw-site-card bw-wide"><h2>{page.title}</h2><code className="bw-path">{page.path}</code><p>合成示例：不会读取本机文件内容。网页发起的跳转不能打开本机文件。</p></div></div>;
  return <div className="bw-site"><div className="bw-site-head">{page.host}<span>合成示例站点</span></div><div className="bw-site-card bw-wide"><h2>{page.title}</h2><p>原型没有发起网络请求，这里只显示占位内容。</p></div></div>;
}

export { AGENT_HOLD_MS };
