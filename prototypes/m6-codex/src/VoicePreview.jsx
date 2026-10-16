import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUpRight, ChevronRight, Keyboard, LoaderCircle, Mic, RefreshCw, Settings, X } from 'lucide-react';
import { Dialog } from './PreviewUI';
import './voice.css';

// M7 interaction model only. No microphone, native shortcuts, Typeless process or network access.
export const VOICE_DEFAULTS = { enabled: true, globalEnabled: false, globalShortcut: 'Command+Shift+Space', shortcutOverride: '' };
export const VOICE_SCENARIOS = [
  ['ready', 'Typeless 已就绪'], ['cold', 'Typeless 尚未启动'], ['missing', '未安装 Typeless'],
  ['permission', '缺少辅助功能权限'], ['unknown', '未识别到听写键'], ['launch-failed', '启动失败'], ['unsupported', '非 macOS 平台'],
  ['focus-unavailable', '暂时无法确认输入位置'], ['focus-changed', '输入位置已切换'], ['secure-input', '受保护输入框'],
];
const SAMPLE = '请先梳理这个项目的主要模块，再列出需要验证的功能。';
const readableKey = value => value.replace(/CommandOrControl|Command|Cmd/g, '⌘').replace(/Control|Ctrl/g, '⌃').replace(/Option|Alt/g, '⌥').replace(/Shift/g, '⇧').replace(/Right⌥/g, '右 Option').replaceAll('+', ' ');
const canonical = value => value.toLowerCase().replace(/commandorcontrol|command|cmd|meta/g, 'meta').replace(/control|ctrl/g, 'ctrl').replace(/option|alt/g, 'alt').split('+').map(x => x.trim()).filter(Boolean).sort().join('+');
function validateDraft(draft) {
  if (draft.shortcutOverride && !/^(?:(?:Left|Right)?(?:Command|Cmd|Control|Ctrl|Option|Alt|Shift|Fn)\+)*(?:(?:Left|Right)?(?:Option|Alt|Control|Ctrl|Command|Cmd|Shift|Fn)|Space|[A-Z0-9]|F(?:[1-9]|1[0-2]))$/i.test(draft.shortcutOverride.trim())) return '无法识别 Typeless 听写键，请使用 RightOption 或 Control+Command+V 等格式。';
  if (!draft.globalEnabled) return '';
  const key = canonical(draft.globalShortcut);
  if (!/^(?:(?:Command|Cmd|Control|Ctrl|Option|Alt|Shift)\+)+(?:Space|[A-Z0-9]|F(?:[1-9]|1[0-2]))$/i.test(draft.globalShortcut.trim())) return '请使用组合键，例如 Command+Shift+Space；不使用单独的 Option 键。';
  if (['Command+K', 'Command+N', 'Command+B', 'Command+W', 'Command+Q', 'Command+Return'].map(canonical).includes(key)) return '这个快捷键已用于现有操作，请换一个。原来的设置仍然保留。';
  if (key === canonical(draft.shortcutOverride || 'RightOption')) return '全局唤起键和 Typeless 听写键需要不同，避免重复触发。';
  return '';
}

export function useVoicePreview(route) {
  const [settings, setSettings] = useState(VOICE_DEFAULTS);
  const [scenario, setScenario] = useState('ready');
  const [notice, setNotice] = useState(null);
  const busy = useRef(false), timer = useRef(null), currentRoute = useRef(route), targetRef = useRef(null);
  const clear = () => { clearTimeout(timer.current); busy.current = false; targetRef.current = null; setNotice(null); };
  useEffect(() => { currentRoute.current = route; clear(); return () => clearTimeout(timer.current); }, [route]);
  const trigger = target => {
    if (busy.current) return;
    const errors = {
      missing: ['未找到 Typeless', '安装并完成 Typeless 的首次设置后，再回来检测。'],
      permission: ['需要辅助功能权限', '已有输入保持不变。完成系统授权后，回到 WillYou 会自动重新检测。'],
      unknown: ['请确认 Typeless 听写键', '在语音设置中选择听写快捷键，再试一次。'],
      'launch-failed': ['暂时无法唤起 Typeless', '尝试手动打开 Typeless，再重新触发。'],
      unsupported: ['当前平台暂不支持', 'M7 的 Typeless 接入先支持 macOS。'],
      disabled: ['语音输入已关闭', '在语音设置中开启后，即可使用麦克风按钮。'],
      'focus-unavailable': ['暂时无法确认输入位置。请点击目标输入框后重试。', '请在目标输入框中重试，无需修改快捷键配置。'],
      'focus-changed': ['输入位置已变化，请在目标输入框中重试。', '请在目标输入框中重试，无需修改快捷键配置。'],
      'secure-input': ['密码等受保护的输入框不支持语音唤起。请切换到普通输入框。', '请在目标输入框中重试，无需修改快捷键配置。'],
    };
    if (!target?.available()) return;
    target.focus(); targetRef.current = target;
    const problem = !settings.enabled ? 'disabled' : scenario === 'unknown' && settings.shortcutOverride ? null : scenario;
    if (errors[problem]) { setNotice({ kind: 'error', title: errors[problem][0], detail: errors[problem][1], focusIssue: ['focus-unavailable', 'focus-changed', 'secure-input'].includes(problem) }); return; }
    busy.current = true;
    const atRoute = currentRoute.current;
    setNotice({ kind: 'pending', title: scenario === 'cold' ? '正在后台打开 Typeless…' : '正在唤起 Typeless…', detail: '保留当前输入位置。' });
    timer.current = setTimeout(() => {
      busy.current = false;
      if (currentRoute.current !== atRoute || !target.available()) { clear(); return; }
      setNotice({ kind: 'sent', title: '已发送 Typeless 唤起请求', detail: '在 Typeless 中完成口述，文字会回到原输入位置。' });
    }, scenario === 'cold' ? 1400 : 450);
  };
  const fillExample = () => {
    const target = targetRef.current;
    if (!target?.available()) { clear(); return; }
    target.insert(SAMPLE); target.focus();
    setNotice({ kind: 'inserted', title: '示例文字已填入', detail: '保留为输入内容，由你决定何时发送。没有调用真实语音服务。' });
  };
  return { settings, setSettings, scenario, setScenario: value => { clear(); setScenario(value); }, notice, busy: notice?.kind === 'pending', trigger, clear, fillExample };
}

export function textareaTarget(element, onChange) {
  if (!element) return null;
  const start = element.selectionStart, end = element.selectionEnd;
  return {
    available: () => element.isConnected && !element.disabled,
    focus: () => { element.focus({ preventScroll: true }); element.setSelectionRange(start, end); },
    insert: text => {
      element.setRangeText(text, start, end, 'end');
      const value = element.value, caret = start + text.length;
      onChange?.(value);
      requestAnimationFrame(() => { if (element.isConnected) { element.focus({ preventScroll: true }); element.setSelectionRange(caret, caret); } });
    },
  };
}

export function VoiceButton({ busy, onClick, disabled = false, disabledHint = '任务停止后无法输入，请先恢复任务', label = '使用 Typeless 语音输入', compact = false }) {
  return <button type="button" className={'voice-button ' + (busy ? 'voice-busy ' : '') + (compact ? 'voice-compact' : '')} aria-label={label} title={disabled ? disabledHint : '使用 Typeless 语音输入 · M7'} aria-busy={busy} disabled={disabled || busy} onPointerDown={e => e.preventDefault()} onClick={onClick}>{busy ? <LoaderCircle size={17} className="spin" /> : <Mic size={17} strokeWidth={1.65} />}{!compact && <span>语音输入</span>}</button>;
}

export function VoiceFeedback({ voice, onSettings }) {
  const n = voice.notice;
  if (n?.kind !== 'error') return null;
  return <aside className="voice-feedback voice-feedback-error" aria-label="语音输入反馈">
    <div className="voice-feedback-title"><AlertCircle size={17} /><strong role="alert">{n.title}</strong><span className="m7-chip">演示</span><button type="button" className="icon-button" aria-label="关闭语音反馈" onClick={voice.clear}><X size={15} /></button></div>
    <p>{n.detail}</p>
    {!n.focusIssue && <div className="voice-feedback-actions"><button className="text-button" onClick={onSettings}><Settings size={13} />语音设置</button></div>}
  </aside>;
}

function Row({ title, detail, children }) {
  return <div className="setting-row"><div><h3>{title}</h3>{detail && <p>{detail}</p>}</div><div className="setting-control">{children}</div></div>;
}
function Switch({ value, onChange, label }) {
  return <button type="button" className={'toggle ' + (value ? 'checked' : '')} role="switch" aria-checked={value} aria-label={label} onClick={() => onChange(!value)}><span /></button>;
}

export function VoiceSettings({ voice, notify }) {
  const [draft, setDraft] = useState(voice.settings), [error, setError] = useState(''), [detecting, setDetecting] = useState(false), [recordingKey, setRecordingKey] = useState(false), [help, setHelp] = useState(null);
  const sampleRef = useRef(null), detectTimer = useRef(null), keyRef = useRef(null);
  useEffect(() => () => clearTimeout(detectTimer.current), []);
  const dirty = JSON.stringify(draft) !== JSON.stringify(voice.settings);
  const update = patch => { setDraft(old => ({ ...old, ...patch })); setError(''); };
  const available = !['missing', 'unsupported'].includes(voice.scenario);
  const detection = detecting ? '正在检测…' : !available ? (voice.scenario === 'missing' ? '未安装 · 示例' : '平台不支持 · 示例') : voice.scenario === 'permission' ? '需要授权 · 示例' : voice.scenario === 'unknown' ? '待确认听写键 · 示例' : '已检测到 · 示例';
  const save = () => { const message = validateDraft(draft); setError(message); if (message) return; voice.clear(); voice.setSettings({ ...draft, globalShortcut: draft.globalShortcut.trim(), shortcutOverride: draft.shortcutOverride.trim() }); notify('语音设置已保存在本次预览中'); };
  return <div className="settings-inner voice-settings">
    <div className="page-heading"><h1>语音输入 <span className="m7-chip">M7</span></h1></div>
    <p className="voice-intro">把想法说出来，直接落在你正在输入的位置。</p>
    <section className="settings-group"><h2>语音工具</h2><div className="settings-card">
      <Row title="Typeless" detail="使用这台 Mac 上的 Typeless，沿用已有账号和词库。"><span className={'voice-detection ' + (available && voice.scenario === 'ready' ? 'available' : '')}>{detection}</span><button className="icon-button" title="重新检测" aria-label="重新检测 Typeless" disabled={detecting} onClick={() => { setDetecting(true); detectTimer.current = setTimeout(() => { setDetecting(false); notify('演示检测完成；未读取本机配置'); }, 600); }}><RefreshCw size={15} className={detecting ? 'spin' : ''} /></button></Row>
      <Row title="启用语音输入" detail="新建任务使用麦克风按钮，终端使用全局唤起快捷键。"><Switch value={draft.enabled} onChange={value => update({ enabled: value })} label="启用语音输入" /></Row>
      <Row title="Typeless 听写键" detail={draft.shortcutOverride ? '手动指定；请与 Typeless 设置中的听写键保持一致。' : voice.scenario === 'unknown' ? '暂未识别，请展开下方高级设置手动指定。' : '跟随 Typeless 配置，不会修改它的设置。'}><kbd className="voice-key">{voice.scenario === 'unknown' && !draft.shortcutOverride ? '待确认' : readableKey(draft.shortcutOverride || 'RightOption')}</kbd></Row>
      <Row title="使用准备" detail={voice.scenario === 'permission' ? '允许 WillYou 触发键盘操作。麦克风权限由 Typeless 管理。' : !available ? '先在 Mac 上安装 Typeless，完成登录和听写设置。' : '辅助功能权限已就绪。Typeless 完成首次设置后，即可试用。'}><button className="button small secondary" onClick={() => setHelp(!available ? 'install' : 'permission')}>{!available ? '安装指引' : '权限指引'}<ChevronRight size={13} /></button></Row>
    </div></section>
    <section className="settings-group"><h2>快捷键</h2><div className="settings-card">
      <Row title="全局唤起" detail="WillYou 在后台运行时，也能在其他应用中唤起语音输入。"><Switch value={draft.globalEnabled} onChange={value => update({ globalEnabled: value })} label="启用全局唤起" /></Row>
      <Row title="WillYou 全局唤起键" detail={draft.globalEnabled ? '文字进入当前应用，WillYou 保持后台。' : '开启后使用；与 Typeless 听写键分别设置。'}><div className="voice-key-editor"><input ref={keyRef} aria-label="WillYou 全局唤起键" disabled={!draft.globalEnabled} value={recordingKey ? '按下组合键…' : draft.globalShortcut} readOnly={recordingKey} onBlur={() => setRecordingKey(false)} onChange={e => update({ globalShortcut: e.target.value })} onKeyDown={e => {
        if (!recordingKey) return;
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') { setRecordingKey(false); return; }
        if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;
        const key = e.code === 'Space' ? 'Space' : e.code.startsWith('Key') ? e.code.slice(3) : e.key.toUpperCase();
        update({ globalShortcut: [e.metaKey && 'Command', e.ctrlKey && 'Control', e.altKey && 'Option', e.shiftKey && 'Shift', key].filter(Boolean).join('+') }); setRecordingKey(false);
      }} /><button className="button small secondary" disabled={!draft.globalEnabled} onClick={() => { setRecordingKey(!recordingKey); keyRef.current?.focus(); }}>{recordingKey ? '取消' : '录制'}</button></div></Row>
    </div><p className="voice-caption">退出 WillYou 后释放全局键。默认关闭，可随时启用。</p></section>
    <details className="voice-advanced"><summary>高级设置<ChevronRight size={14} /></summary><label className="field">手动指定 Typeless 听写键<input aria-label="手动指定 Typeless 听写键" value={draft.shortcutOverride} onChange={e => update({ shortcutOverride: e.target.value })} placeholder="留空时自动读取，例如 RightOption" /></label><p className="voice-caption">只使用已确认能开始／结束听写的键。其他模式和按住说话的键，需要先在 Typeless 中核对。</p><button className="text-button" onClick={() => update({ shortcutOverride: '' })}>恢复自动读取</button></details>
    {error && <div className="voice-form-error" role="alert"><AlertCircle size={16} />{error}</div>}
    <div className="voice-save"><span aria-live="polite">{dirty ? '有未保存的更改' : '设置已保存 · 本次预览'}</span><button className="button secondary" disabled={!dirty} onClick={() => { setDraft(voice.settings); setError(''); setRecordingKey(false); }}>撤销更改</button><button className="button primary" disabled={!dirty || recordingKey} onClick={save}>保存设置</button></div>
    <section className="settings-group voice-try"><h2>试一下</h2><div className="settings-card"><p>把光标放在下面，再点击麦克风。结束后，文字应回到这里。</p><div className="voice-test-input"><textarea ref={sampleRef} aria-label="语音试用输入框" placeholder="在这里试用语音输入…" /><VoiceButton compact busy={voice.busy} label="试用 Typeless 语音输入" disabled={dirty} disabledHint="请先保存语音设置，再试用" onClick={() => voice.trigger(textareaTarget(sampleRef.current))} /></div><small>{dirty ? '请先保存设置，再试用。' : '原型演示：不录音、不唤起本机软件；可在顶部预览控件中演示回填。'}</small></div></section>
    <p className="voice-caption">录音、结束／取消、文字整理和词库由 Typeless 提供。WillYou 不另存音频或转写历史。</p>
    {help && <Dialog title={help === 'install' ? '准备好 Typeless' : '允许语音唤起'} subtitle="操作指引 · 原型不会更改系统设置" onClose={() => setHelp(null)}><div className="voice-demo-note">{help === 'install' ? <p>从 Typeless 官方渠道安装客户端，完成登录、麦克风和辅助功能设置，并确认你使用的听写快捷键。</p> : <p>在 macOS「系统设置 → 隐私与安全性 → 辅助功能」中允许当前运行的 WillYou。QA 版按实际安装包名称选择；开发版可能显示为 Electron。录音权限由 Typeless 管理。临时签名测试包更新后，旧授权可能失效；若开关已开但仍无法使用，请为当前包重新添加授权。</p>}<p>完成后回到 WillYou 会自动重新检测。原型中的结果由顶部的 M7 演示场景控制。</p></div><div className="dialog-footer"><button className="button primary" onClick={() => setHelp(null)}>知道了</button></div></Dialog>}
  </div>;
}

export function VoiceDemoDialog({ voice, onClose, onNavigate }) {
  const external = useRef(null);
  return <Dialog title="M7 · 语音输入预览" subtitle="复用 Typeless，让现有工作区支持语音输入。" onClose={onClose} className="voice-demo-dialog">
    <p className="voice-demo-note">这是交互原型，不会录音、注册全局快捷键或启动本机 Typeless。演示状态不会改变系统权限。</p>
    <div className="voice-demo-links"><button className="button secondary" onClick={() => onNavigate('home')}><Mic size={15} />首页语音入口</button><button className="button secondary" onClick={() => onNavigate('task/research')}>终端快捷键预览<ArrowUpRight size={14} /></button><button className="button secondary" onClick={() => onNavigate('settings/voice')}><Settings size={15} />语音设置</button></div>
    <label className="field">演示场景<select aria-label="语音演示场景" value={voice.scenario} onChange={e => voice.setScenario(e.target.value)}>{VOICE_SCENARIOS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    <section className="voice-global-demo"><h3><Keyboard size={16} />跨应用使用</h3><p>真实桌面版会保留外部应用焦点。这里用一个独立输入框演示文字落点。</p><textarea ref={external} aria-label="模拟外部应用输入框" defaultValue="今天的开发计划：" /><button className="button secondary" disabled={!voice.settings.globalEnabled || voice.busy} onPointerDown={e => e.preventDefault()} onClick={() => voice.trigger(textareaTarget(external.current))}>演示全局唤起 <kbd>{readableKey(voice.settings.globalShortcut)}</kbd></button>{!voice.settings.globalEnabled && <small>先在语音设置中开启全局唤起并保存。</small>}
      {voice.notice && <div className="voice-demo-result" role="status"><p>{voice.notice.title}</p>{voice.notice.kind === 'sent' && <button className="text-button" onClick={voice.fillExample}>演示回填到外部输入框</button>}</div>}
    </section>
    <div className="dialog-footer"><button className="button primary" onClick={onClose}>开始查看</button></div>
  </Dialog>;
}
