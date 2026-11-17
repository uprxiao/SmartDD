// M14 新任务区（阶段 2：单 Agent）。时间线、工作折叠、请求面板（输入框位置）、输入框（档位／模型／排队／停止）。
// 视觉以共享原型 prototypes/m6-codex/?preview=m14 为准，逐项对齐在原型评审基线上继续。
import MarkdownIt from 'markdown-it';
import { Archive, ChevronRight, CircleStop, Loader2, Send, SquareTerminal, Target, X, Zap } from 'lucide-react';
import { AgentTerminalDrawer } from './agent-terminal';
import { AttachmentChips, prepareChip, type Chip, type PreparedAttachment } from './attachment-chips';
import { applyItem, commandItems, fileItems, findTrigger, skillItems, type Catalog, type MenuItem, type MenuTrigger } from './composer-menu';
import { navigation } from '@renderer/core/navigation';
import { agentTasksStore } from '@renderer/core/agent-tasks-store';
import { useAppSettingsKey } from '@renderer/lib/hooks/useAppSettingsKey';
import { AgentDialog } from '@renderer/features/agents/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { agentTaskEvent, agentTaskLiveEvent } from '@shared/events';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { events, rpc } from '@renderer/lib/ipc';
import { buildTimeline, formatDuration, requestForm, requestOptions, requestTitle, workLabel, type RequestForm, type TimelineItem, type TimelineRequest } from './agent-timeline';
import './agent-tasks.css';

type Snapshot = Awaited<ReturnType<typeof rpc.agentTasks.snapshot>>;
type Profile = Awaited<ReturnType<typeof rpc.agentTasks.profiles>>[number];
const TIER_LABEL: Record<string, string> = { ask: '请求批准', auto: '帮我批准', full: '完全访问' };
const NOTICE_LABEL: Record<string, string> = { configWarning: '配置提示', warning: '提示', deprecationNotice: '弃用提示', guardianWarning: '自动审核提示' };
const STATUS_LABEL: Record<string, string> = { idle: '', working: '工作中', waiting: '等待你处理', completed: '已完成', stopped: '已停止', failed: '失败', limited: '受限' };
const LIMIT_LABEL: Record<string, string> = { usage: '额度已用完', rate: '请求过于频繁，已被限流', context: '上下文已达上限', output: '输出长度到上限' };

// 消息里的链接在阶段 5 按 T3 规则接入路由；此前只显示为文字，不打开任何地址。
const md = new MarkdownIt({ html: false, linkify: false, breaks: false });
// 本项目的 markdown-it 类型声明只含最小接口；这里只覆盖链接与图片的渲染规则。
const mdRules = (md as unknown as { renderer: { rules: Record<string, (tokens: { content: string }[], idx: number) => string> } }).renderer.rules;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
mdRules.link_open = () => '<span class="agent-link-text">';
mdRules.link_close = () => '</span>';
// 代码块带“在终端运行”：把完整命令送入本任务手动终端的输入行，不自动执行（用例 A52）。
mdRules.fence = (tokens, idx) => {
  const t = tokens[idx] as { content: string; info?: string };
  const lang = String(t.info ?? '').trim().split(/\s+/)[0];
  const runnable = !lang || /^(sh|bash|zsh|shell|console|fish)$/i.test(lang);
  return `<div class="agent-code">${runnable ? `<button type="button" class="agent-run-in-terminal" data-code="${escapeHtml(encodeURIComponent(t.content))}">在终端运行</button>` : ''}<pre><code>${escapeHtml(t.content)}</code></pre></div>`;
};
mdRules.image = (tokens, idx) => `<span class="agent-link-text">[${escapeHtml(tokens[idx].content)}]</span>`;

export { newClientInputId } from './agent-ids';
import { newClientInputId } from './agent-ids';

/** 由任务区提供：把代码块命令送进手动终端。 */
const RunInTerminal = { current: null as null | ((code: string) => void) };
function Markdown({ text }: { text: string }) {
  const html = useMemo(() => md.render(text), [text]);
  return <div className="agent-md" dangerouslySetInnerHTML={{ __html: html }} onClick={e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.agent-run-in-terminal');
    if (btn?.dataset.code) RunInTerminal.current?.(decodeURIComponent(btn.dataset.code));
  }} />;
}

const DEFAULT_COMMANDS: Record<string, string[]> = { 'codex-app-server': ['goal', 'compact', 'review'], 'claude-sdk': ['goal', 'compact', 'init'] };
/** 输入框选用菜单（/命令、@文件、$Skill）；方向键选择，Enter／Tab 选用，Esc 关闭。 */
function ComposerMenu({ items, index, onPick }: { items: MenuItem[]; index: number; onPick: (i: MenuItem) => void }) {
  if (!items.length) return null;
  return <div className="agent-menu" role="listbox">{items.map((it, i) => <button key={it.key} type="button" role="option" aria-selected={i === index} className={i === index ? 'on' : ''} onMouseDown={e => { e.preventDefault(); onPick(it); }}>
    <b>{it.label}</b>{it.detail && <small>{it.detail}</small>}</button>)}</div>;
}

/** 按字节偏移分段读取完整正文并解析（复核 NR06、FR02）。 */
async function readRange(read: (offset: number) => Promise<{ chunk: string; next: number; done: boolean }>) {
  let off = 0, text = '';
  for (let i = 0; i < 1000; i++) { const r = await read(off); text += r.chunk; if (r.done) return JSON.parse(text); if (r.next <= off) break; off = r.next; }
  throw new Error('读取完整内容失败');
}
const fetchItemPayload = (itemId: string) => readRange(off => rpc.agentTasks.itemBody(CurrentTask.id, itemId, off));

/** 截断条目的全文：任何被预览的条目都能读取完整内容（复核 FR04）。 */
function useFullPayload(item: TimelineItem) {
  const [full, setFull] = useState<any>(null);
  const truncated = !!item.payload?.truncated && !full;
  const load = async () => { try { const p = await fetchItemPayload(item.itemId); setFull(p); return p; } catch (e) { toast.error(`读取完整内容失败：${rpcErrorMessage(e)}`); return null; } };
  return { payload: full ?? item.payload ?? {}, truncated, load };
}
function ExpandButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="agent-older" onClick={onClick}>内容较长，已截断显示 · 展开全文</button>;
}

function ItemRow({ item }: { item: TimelineItem }) {
  const { payload: p, truncated, load } = useFullPayload(item);
  // 复制／下载计划先取得全文；读不到就提示失败，不输出残缺内容（复核 FR04）。
  const planText = async (): Promise<string | null> => {
    if (!truncated) return String(p.plan ?? '');
    const f = await load(); return f && typeof f.plan === 'string' ? f.plan : null;
  };
  const copyPlan = async () => { const t = await planText(); if (t === null) return; try { await navigator.clipboard.writeText(t); toast.success('已复制计划'); } catch (e) { toast.error(`复制失败：${rpcErrorMessage(e)}`); } };
  const downloadPlan = async () => { const t = await planText(); if (t === null) return; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/markdown' })); a.download = 'plan.md'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  const more = truncated ? <ExpandButton onClick={() => void load()} /> : null;
  switch (item.type) {
    case 'user_message': return <div className="agent-user"><div className="agent-user-bubble">{p.text}{more}{p.attachments?.length ? <div className="agent-user-attachments">{p.attachments.map((a: any, i: number) => <span key={i} className="agent-chip-name">{a.kind === 'path' ? a.relativePath : a.name}</span>)}</div> : null}</div></div>;
    case 'assistant_message': return <div className="agent-assistant"><Markdown text={String(p.text ?? '')} />{more}</div>;
    case 'proposed_plan': return <div className="agent-plan"><div className="agent-plan-head">计划</div><Markdown text={String(p.plan ?? '')} />{more}
      <div className="agent-plan-actions"><button type="button" onClick={() => void copyPlan()}>复制</button>
        <button type="button" onClick={() => void downloadPlan()}>下载</button></div></div>;
    case 'todo_list': return <div className="agent-todo">{(p.entries ?? []).map((e: any) => <div key={e.id} className={`agent-todo-row ${e.status}`}><span className="agent-todo-box" aria-hidden>{e.status === 'completed' ? '✓' : ''}</span>{e.subject}</div>)}{more}</div>;
    case 'error': return <div className="agent-error" role="alert">{p.message ?? p.code}{more}</div>;
    case 'compaction': return <div className="agent-divider">上下文已压缩</div>;
    case 'system_notice': return <details className="agent-notice"><summary>{NOTICE_LABEL[String(p.code)] ?? '提示'}</summary><pre>{String(p.detail ?? '')}</pre>{more}</details>;
    default: return null;
  }
}
const CurrentTask = { id: '' };

function WorkItem({ it }: { it: TimelineItem }) {
  const { payload: p, truncated, load } = useFullPayload(it);
  return <details className={`agent-work-row ${p.status ?? ''}`}>
    <summary>{workLabel({ ...it, payload: p })}</summary>
    {p.output ? <pre>{String(p.output)}</pre> : it.type === 'reasoning' || it.type === 'assistant_message' ? <Markdown text={String(p.text ?? '')} /> : null}
    {truncated && <ExpandButton onClick={() => void load()} />}
  </details>;
}

function WorkRow({ items, running, seconds }: { items: TimelineItem[]; running: boolean; seconds: number }) {
  const [open, setOpen] = useState(false);
  return <div className="agent-work">
    <button type="button" className={`agent-work-head${running ? ' shine' : ''}`} aria-expanded={open} onClick={() => setOpen(o => !o)}>
      {running ? '工作中' : '已工作'} {formatDuration(seconds)}<ChevronRight size={13} className={open ? 'open' : ''} />
    </button>
    {open && <div className="agent-work-rows">{items.map(it => <WorkItem key={it.itemId} it={it} />)}</div>}
  </div>;
}

/** Agent 提问与 MCP 表单（复核 CR09）：按请求种类填写，答案按各自协议回传。 */
function RequestFormView({ form, busy, onSubmit }: { form: RequestForm; busy: boolean; onSubmit: (result: unknown) => void }) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, unknown>>({});
  if (form.kind === 'questions') {
    const final = () => Object.fromEntries(form.questions.map(q => [q.id, [...(answers[q.id] ?? []), ...(other[q.id]?.trim() ? [other[q.id].trim()] : [])]]));
    const missing = form.questions.some(q => !(final()[q.id]?.length));
    return <div className="agent-form">
      {form.questions.map(q => <fieldset key={q.id} className="agent-form-q"><legend>{q.header ? `${q.header} · ` : ''}{q.question}</legend>
        {q.options.map(o => { const on = (answers[q.id] ?? []).includes(o.label); return <label key={o.label} className={on ? 'on' : ''}>
          <input type={q.multi ? 'checkbox' : 'radio'} name={q.id} checked={on} onChange={() => setAnswers(a => ({ ...a, [q.id]: q.multi ? (on ? (a[q.id] ?? []).filter(x => x !== o.label) : [...(a[q.id] ?? []), o.label]) : [o.label] }))} />
          <span>{o.label}{o.description && <small>{o.description}</small>}</span></label>; })}
        {q.allowOther && <input className="agent-form-other" type={q.secret ? 'password' : 'text'} placeholder={q.options.length ? '其他（自己填写）' : '你的回答'} value={other[q.id] ?? ''} onChange={e => setOther(o => ({ ...o, [q.id]: e.target.value }))} />}
      </fieldset>)}
      <div className="agent-form-actions"><button type="button" disabled={busy} onClick={() => onSubmit(form.decline())}>不回答</button><button type="button" className="primary" disabled={busy || missing} onClick={() => onSubmit(form.toResult(final()))}>提交回答</button></div>
    </div>;
  }
  const missing = form.fields.some(f => f.required && (values[f.name] === undefined || values[f.name] === ''));
  return <div className="agent-form">
    <p className="agent-form-message">{form.message}</p>
    {form.url && <p className="agent-form-message">需要打开：<span className="agent-link-text">{form.url}</span></p>}
    {form.fields.map(f => <label key={f.name} className="agent-form-field"><span>{f.title}{f.required ? ' *' : ''}</span>
      {f.type === 'boolean' ? <input type="checkbox" checked={!!values[f.name]} onChange={e => setValues(v => ({ ...v, [f.name]: e.target.checked }))} />
        : f.type === 'enum' ? <select value={String(values[f.name] ?? '')} onChange={e => setValues(v => ({ ...v, [f.name]: e.target.value }))}><option value="">请选择</option>{f.options!.map(o => <option key={o} value={o}>{o}</option>)}</select>
          : <input type={f.type === 'number' ? 'number' : 'text'} value={String(values[f.name] ?? '')} onChange={e => setValues(v => ({ ...v, [f.name]: f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value }))} />}
    </label>)}
    <div className="agent-form-actions"><button type="button" disabled={busy} onClick={() => onSubmit(form.toResult('decline', null))}>拒绝</button><button type="button" className="primary" disabled={busy || missing} onClick={() => onSubmit(form.toResult('accept', values))}>提交</button></div>
  </div>;
}

function RequestPanel({ requests, driverId, onRespond, onStop }: { requests: TimelineRequest[]; driverId: string; onRespond: (r: TimelineRequest, result: unknown) => Promise<void>; onStop: () => void }) {
  const [index, setIndex] = useState(0);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const shown = requests[Math.min(index, requests.length - 1)];
  // 过大的关键请求：先读完整内容再开放批准（复核 NR06）；读不全只能拒绝或停止。
  const [full, setFull] = useState<Record<string, TimelineRequest['payload'] | 'error'>>({});
  useEffect(() => {
    if (!(shown as any).detailTruncated || full[shown.requestId]) return;
    void (async () => {
      try { const payload = await readRange(off => rpc.agentTasks.requestBody(CurrentTask.id, shown.requestId, off)); setFull(f => ({ ...f, [shown.requestId]: payload?.truncated ? 'error' : payload })); }
      catch { setFull(f => ({ ...f, [shown.requestId]: 'error' })); }
    })();
  }, [shown.requestId]); // eslint-disable-line react-hooks/exhaustive-deps
  const loaded = full[shown.requestId];
  const incomplete = !!(shown as any).detailTruncated && (loaded === undefined || loaded === 'error');
  const r = loaded && loaded !== 'error' ? { ...shown, payload: loaded } : shown;
  const form = incomplete ? null : requestForm(r, driverId);
  const options = form ? [] : incomplete ? requestOptions(r, driverId).filter(o => o.deny) : requestOptions(r, driverId);
  const head = requestTitle(r);
  useEffect(() => { setSelected(null); panel.current?.focus(); }, [r.requestId]);
  const send = async (result: unknown) => {
    setBusy(true);
    try { await onRespond(r, result); setIndex(0); setSelected(null); } catch (e) { toast.error(rpcErrorMessage(e)); } finally { setBusy(false); }
  };
  const choose = (i: number) => {
    const o = options[i]; if (!o || busy) return;
    const why = reason[r.requestId] ?? '';
    if (o.key === 'revise' && !why.trim()) { toast.warning('先在下方写修改意见'); return; }
    void send(o.result(why));
  };
  // 数字键只选中，Enter 确认（复核 CR10）；只在面板内生效，输入框里与组合输入时不处理。
  const onKey = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.nativeEvent.isComposing || tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || form) return;
    const n = Number(e.key);
    if (n >= 1 && n <= options.length) { e.preventDefault(); setSelected(n - 1); return; }
    if (e.key === 'Enter' && selected !== null) { e.preventDefault(); choose(selected); }
  };
  return <div className="agent-request" role="dialog" aria-label="待处理请求" tabIndex={-1} ref={panel} onKeyDown={onKey}>
    <div className="agent-request-head"><b>{head.title}</b>{requests.length > 1 && <span className="agent-request-nav"><button type="button" onClick={() => setIndex(i => (i - 1 + requests.length) % requests.length)}>‹</button>{index + 1}/{requests.length}<button type="button" onClick={() => setIndex(i => (i + 1) % requests.length)}>›</button></span>}</div>
    {incomplete && <div className="agent-limited">{loaded === 'error' ? '请求内容过大或读取失败，只能拒绝或停止' : '正在读取完整内容，读完后才能批准…'}</div>}
    {!form && head.detail && <pre className="agent-request-detail">{head.detail}</pre>}
    {form ? <RequestFormView key={r.requestId} form={form} busy={busy} onSubmit={result => void send(result)} /> : <>
      <div className="agent-request-options" role="listbox">{options.map((o, i) => <button key={o.key} type="button" role="option" aria-selected={selected === i} disabled={busy} className={`${o.deny ? 'deny' : ''}${selected === i ? ' on' : ''}`} onClick={() => choose(i)}><kbd>{i + 1}</kbd>{o.label}</button>)}</div>
      <textarea className="agent-request-reason" placeholder="可写原因或意见（可选）" value={reason[r.requestId] ?? ''} onChange={e => setReason(s => ({ ...s, [r.requestId]: e.target.value }))} rows={2} />
    </>}
    <div className="agent-request-foot">{selected !== null && !form && <span className="agent-request-hint">按 Enter 确认“{options[selected]?.label}”</span>}<button type="button" className="agent-stop" onClick={onStop}><CircleStop size={14} />停止</button></div>
  </div>;
}

const GOAL_STATUS: Record<string, string> = { active: '进行中', paused: '已暂停', complete: '已完成' };
/** 目标条目（照 T3 goal 条目）：目标、状态、时长与轮次，不显示 token；Codex 可暂停／继续，Claude 只能清除。 */
function GoalRow({ goal, driverId, onOp }: { goal: NonNullable<Snapshot['goal']>; driverId: string; onOp: (op: 'pause' | 'resume' | 'clear') => void }) {
  const reason = goal.status === 'paused' ? (goal.pausedReason === 'waiting_children' ? '等子任务，已自动暂停' : goal.pausedReason === 'limit' ? '额度受限，已暂停' : '已暂停') : GOAL_STATUS[goal.status] ?? goal.status;
  return <div className="agent-goal" data-testid="agent-goal">
    <Target size={14} /><div className="agent-goal-body"><b>{goal.objective}</b><small>{reason} · {formatDuration(goal.timeUsedSeconds ?? 0)} · {goal.turns} 轮</small></div>
    <div className="agent-goal-actions">
      {driverId === 'codex-app-server' && goal.status === 'active' && <button type="button" onClick={() => onOp('pause')}>暂停</button>}
      {driverId === 'codex-app-server' && goal.status === 'paused' && goal.pausedReason !== 'waiting_children' && <button type="button" onClick={() => onOp('resume')}>继续</button>}
      <button type="button" onClick={() => onOp('clear')}>清除</button>
    </div>
  </div>;
}

export function AgentTaskView({ taskId }: { taskId: string }) {
  CurrentTask.id = taskId;
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [text, setText] = useState('');
  const [chips, setChips] = useState<Chip[]>([]);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const pendingInput = useRef<{ text: string; chips: string; clientInputId: string } | null>(null);
  const [live, setLive] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  const permissionPref = useAppSettingsKey('agentPermissions');
  const [confirmFull, setConfirmFull] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [trigger, setTrigger] = useState<MenuTrigger | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [fileHits, setFileHits] = useState<string[]>([]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const modelSelect = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    RunInTerminal.current = code => { setTerminalOpen(true); void rpc.agentTasks.pasteToTerminal(taskId, code).then(() => toast.message('已送入终端输入行，按回车执行')).catch(e => toast.error(rpcErrorMessage(e))); };
    return () => { RunInTerminal.current = null; };
  }, [taskId]);
  useEffect(() => {
    if (trigger?.kind !== '@') return;
    const q = trigger.query, h = setTimeout(() => { void rpc.agentTasks.searchFiles(taskId, null, q).then(setFileHits).catch(() => setFileHits([])); }, 120);
    return () => clearTimeout(h);
  }, [trigger?.kind, trigger?.query, taskId]);
  const draftRev = useRef(0), draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null), reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const [older, setOlder] = useState<TimelineItem[]>([]);
  const [olderTurns, setOlderTurns] = useState<unknown[]>([]);
  const [olderMore, setOlderMore] = useState<boolean | null>(null);

  // 首份被采纳的快照完成一次草稿初始化（不论它来自初始化还是事件补拉）；本地已编辑则保留本地内容（复核 FR05）。
  const draftInit = useRef(false);
  const adoptDraft = useCallback(async (s: Snapshot) => {
    if (draftInit.current) return;
    draftInit.current = true;
    draftRev.current = s.draft?.revision ?? 0;
    if (editedRef.current || !s.draft) return;
    let draft = s.draft.draft as any;
    if ((s.draft as any).truncated) { try { draft = await readRange(off => rpc.agentTasks.draftBody(taskId, off)); } catch (e) { toast.error(`草稿读取失败：${rpcErrorMessage(e)}`); return; } }
    if (editedRef.current) return;
    setText(String(draft?.text ?? ''));
    const saved = (draft?.attachments ?? []) as PreparedAttachment[];
    setChips(saved.map(a => ({ localId: a.id, name: a.name, status: 'ready', data: a })));
  }, [taskId]);

  const reload = useCallback(async () => {
    try {
      const s = await rpc.agentTasks.snapshot(taskId);
      // 旧请求晚到的快照不覆盖新水位。
      if (s.seq < seqRef.current) return;
      seqRef.current = s.seq;
      setSnap(s);
      setLive({});
      void adoptDraft(s);
    } catch (e) { toast.error(rpcErrorMessage(e)); }
  }, [taskId, adoptDraft]);

  useEffect(() => {
    let alive = true;
    // 先订阅再读快照，避免读快照与事件之间漏掉更新（技术方案 §3.1）。
    // 按序号合并：不比当前水位新的事件（重复或迟到）忽略；其余触发补拉一致快照（技术方案 §3.1）。
    const offEvent = events.on(agentTaskEvent, e => { if (e.taskId === taskId && e.seq > seqRef.current && !reloadTimer.current) reloadTimer.current = setTimeout(() => { reloadTimer.current = null; if (alive) void reload(); }, 80); });
    // 窗口恢复或页面重新可见时查询最新水位，弥补尾部通知丢失。
    const onVisible = () => { if (document.visibilityState === 'visible' && alive) void reload(); };
    window.addEventListener('focus', onVisible); document.addEventListener('visibilitychange', onVisible);
    const offLive = events.on(agentTaskLiveEvent, e => { if (e.taskId === taskId) setLive(m => ({ ...m, [e.itemKey]: (m[e.itemKey] ?? '') + e.text })); });
    void (async () => {
      const s = await rpc.agentTasks.snapshot(taskId).catch(e => { toast.error(rpcErrorMessage(e)); return null; });
      if (!alive || !s) return;
      // 初始化同样做水位保护：已有更新的快照不覆盖；用户已开始编辑则不用服务端草稿覆盖本地内容（复核 NR07）。
      if (s.seq < seqRef.current) return;
      seqRef.current = s.seq; setSnap(s);
      void adoptDraft(s);
    })();
    void rpc.agentTasks.profiles().then(p => alive && setProfiles(p)).catch(() => {});
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; offEvent(); offLive(); clearInterval(tick); window.removeEventListener('focus', onVisible); document.removeEventListener('visibilitychange', onVisible); if (reloadTimer.current) clearTimeout(reloadTimer.current); };
  }, [taskId, reload, adoptDraft]);

  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [snap?.seq, Object.keys(live).length]);

  const chipsRef = useRef<Chip[]>([]); chipsRef.current = chips;
  const textRef = useRef(''); textRef.current = text;
  const editedRef = useRef(false);
  const saveDraft = (value: string) => {
    editedRef.current = true;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(async () => {
      // 草稿中的附件归属任务：只存已就绪的元数据（需求 R01）。
      const attachments = chipsRef.current.filter(c => c.status === 'ready' && c.data).map(c => c.data!);
      const r = await rpc.agentTasks.saveDraft(taskId, { text: value, attachments }, draftRev.current).catch(() => null);
      if (r?.ok) draftRev.current = r.revision; else if (r) draftRev.current = r.revision; // 冲突：保留本地编辑，下次以服务端修订再写
    }, 400);
  };

  if (!snap) return <div className="agent-task-view loading"><Loader2 className="spin" size={18} /></div>;
  const rawCatalog: Catalog = snap.run?.catalog ?? { commands: DEFAULT_COMMANDS[snap.selection.driverId] ?? ['goal'], skills: [] };
  // 目标命令只在运行冻结的能力允许时出现（复核 CR15）。
  const catalog: Catalog = snap.run && !snap.run.goal ? { ...rawCatalog, commands: rawCatalog.commands.filter(c => c.replace(/^\//, '') !== 'goal') } : rawCatalog;
  const menuItems: MenuItem[] = !trigger ? [] : trigger.kind === '/' ? commandItems(catalog, trigger.query) : trigger.kind === '$' ? skillItems(catalog, trigger.query) : fileItems(fileHits);
  const refreshTrigger = (value: string, caret: number) => { const t = findTrigger(value, caret); setTrigger(t); setMenuIndex(0); };
  const pick = (item: MenuItem) => {
    if (!trigger) return;
    editedRef.current = true;
    if (item.action === 'terminal') { setTerminalOpen(true); const r = applyItem(text, trigger, item); setText(r.text); setTrigger(null); return; }
    if (item.action === 'model') { const r = applyItem(text, trigger, item); setText(r.text); setTrigger(null); modelSelect.current?.focus(); return; }
    const r = applyItem(text, trigger, item);
    setText(r.text); saveDraft(r.text); setTrigger(null);
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(r.caret, r.caret); });
  };
  const profile = profiles.find(p => p.profileId === snap.selection.profileId);
  const groups = buildTimeline([...older, ...(snap.items as TimelineItem[])], [...olderTurns, ...snap.turns] as any, now);
  const hasOlder = olderMore ?? snap.hasOlder;
  const loadOlder = async () => {
    const first = older[0] ?? (snap.items as TimelineItem[])[0]; if (!first) return;
    try { const page = await rpc.agentTasks.history(taskId, first.ordinal); setOlder(o => [...(page.items as TimelineItem[]), ...o]); setOlderTurns(t => [...page.turns, ...t]); setOlderMore(page.hasOlder); } catch (e) { toast.error(rpcErrorMessage(e)); }
  };
  const requests = (snap.requests as TimelineRequest[]).filter(r => r.status === 'pending');
  const working = snap.status === 'working' || snap.status === 'waiting';
  const liveText = Object.values(live).join('');

  const addFiles = (files: File[]) => {
    for (const file of files) {
      const localId = crypto.randomUUID();
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      editedRef.current = true;
      setChips(cs => [...cs, { localId, name: file.name || '粘贴的图片', status: 'preparing', preview, file }]);
      void prepareChip(file, f => rpc.agentTasks.prepareAttachment(taskId, null, f))
        .then(data => { setChips(cs => cs.map(c => c.localId === localId ? { ...c, status: 'ready', data, name: data.name } : c)); setTimeout(() => saveDraft(textRef.current), 0); })
        .catch(e => setChips(cs => cs.map(c => c.localId === localId ? { ...c, status: 'failed', error: rpcErrorMessage(e) } : c)));
    }
  };
  const retryChip = (localId: string) => {
    const chip = chips.find(c => c.localId === localId); if (!chip?.file) { toast.warning('原文件已不可用，请重新粘贴'); return; }
    setChips(cs => cs.filter(c => c.localId !== localId)); addFiles([chip.file]);
  };
  const removeChip = (localId: string) => { setChips(cs => cs.filter(c => c.localId !== localId)); setTimeout(() => saveDraft(textRef.current), 0); };

  const send = async (mode: 'queue' | 'steer' = 'queue') => {
    const value = text.trim();
    // 准备中或失败的附件不能发送也不能排队，给出原因且不清空输入（用例 A75）。
    if (chips.some(c => c.status === 'preparing')) { toast.warning('附件还在准备中，准备好后再发送'); return; }
    if (chips.some(c => c.status === 'failed')) { toast.warning('有附件准备失败，请重试或移除后再发送'); return; }
    const attachments = chips.map(c => c.data!).filter(Boolean);
    if (!value && !attachments.length) return;
    // 同一次发送冻结草稿与输入标识（复核 CR08）：回执前不重复提交；失败后同一内容重试沿用原标识，宿主按标识去重。
    if (sendingRef.current) return;
    const frozenChipIds = new Set(chips.map(c => c.localId));
    const prior = pendingInput.current;
    const clientInputId = prior && prior.text === value && prior.chips === [...frozenChipIds].join(',') ? prior.clientInputId : newClientInputId();
    pendingInput.current = { text: value, chips: [...frozenChipIds].join(','), clientInputId };
    sendingRef.current = true; setSending(true);
    try {
      // /goal 命令：只对声明支持的执行器开放（需求 R02）；/goal clear 清除。
      const goalCmd = /^\/goal(?:\s+([\s\S]*))?$/.exec(value);
      const nativeCmd = !goalCmd && /^\/([A-Za-z0-9_:.-]+)(?:\s+([\s\S]*))?$/.exec(value);
      // 命令不支持附件：提示并完整保留，不能成功后把附件丢掉（复核 NR10）。
      if ((goalCmd || (nativeCmd && catalog.commands.map(c => c.replace(/^\//, '')).includes(nativeCmd[1]))) && attachments.length) { toast.warning('命令不能带附件，附件已保留；请去掉命令或附件后再发送'); return; }
      if (nativeCmd && catalog.commands.map(c => c.replace(/^\//, '')).includes(nativeCmd[1])) {
        await rpc.agentTasks.command(taskId, nativeCmd[1], (nativeCmd[2] ?? '').trim() || undefined);
      } else if (goalCmd) {
        const arg = (goalCmd[1] ?? '').trim();
        if (!arg) { toast.warning('在 /goal 后写目标，或用 /goal clear 清除'); return; }
        await rpc.agentTasks.goal(taskId, arg === 'clear' ? { kind: 'clear' } : { kind: 'set', objective: arg });
      } else {
        const r = await rpc.agentTasks.submit(taskId, { clientInputId, text: value, expectedSelectionRevision: snap.selectionRevision, mode, attachments });
        if ('steerRefused' in r && r.steerRefused) toast.warning(r.steerRefused);
        else if (r.status === 'queued') toast.message('已排队，本轮结束后发送');
      }
      pendingInput.current = null;
      // 只清除这次发出的内容：回执期间新写的文字与新加的附件保留。
      const rest = chipsRef.current.filter(c => !frozenChipIds.has(c.localId));
      setChips(rest); chipsRef.current = rest;
      if (textRef.current.trim() === value) { setText(''); saveDraft(''); } else saveDraft(textRef.current);
      void reload();
    } catch (e) { toast.error(rpcErrorMessage(e)); void reload(); }
    finally { sendingRef.current = false; setSending(false); }
  };
  const goalOp = async (op: 'pause' | 'resume' | 'clear') => { try { await rpc.agentTasks.goal(taskId, { kind: op }); void reload(); } catch (e) { toast.error(rpcErrorMessage(e)); } };
  const archive = async () => { try { await rpc.agentTasks.archive(taskId); void agentTasksStore.refresh(); navigation.newTask(snap.projectId ?? undefined); } catch (e) { toast.error(rpcErrorMessage(e)); } };
  const stop = async () => { try { await rpc.agentTasks.stop(taskId); } catch (e) { toast.error(rpcErrorMessage(e)); } };
  const setSelection = async (patch: { tier?: string; model?: string | null }) => {
    try { const r = await rpc.agentTasks.setSelection(taskId, patch as never, snap.selectionRevision); if (!r.ok) toast.warning('设置已在别处变更，已刷新'); void reload(); }
    catch (e) { toast.error(rpcErrorMessage(e)); }
  };

  return <section className="agent-task-view" aria-label="统一任务区">
    <header className="agent-task-head"><h1>{snap.title}</h1>{STATUS_LABEL[snap.status] && <span className={`agent-status ${snap.status}`}>{STATUS_LABEL[snap.status]}</span>}<span className="push" /><button type="button" className="agent-head-btn" title="底部终端" data-testid="agent-terminal-toggle" aria-pressed={terminalOpen} onClick={() => setTerminalOpen(o => !o)}><SquareTerminal size={15} /></button><button type="button" className="agent-head-btn" title="归档任务" data-testid="agent-archive" onClick={() => void archive()}><Archive size={15} /></button></header>
    <div className="agent-scroll" ref={scroller}><div className="agent-timeline">
      {hasOlder && <button type="button" className="agent-older" onClick={() => void loadOlder()}>加载更早的记录</button>}
      {groups.map(g => <div key={g.turnId ?? 'host'} className="agent-turn">{g.rows.map(row =>
        row.kind === 'item' ? <ItemRow key={row.item.itemId} item={row.item} />
          : row.kind === 'work' ? <WorkRow key={row.id} items={row.items} running={row.running} seconds={row.seconds} />
            : <div key={row.id} className={`agent-turn-footer${row.failed ? ' failed' : ''}`}>{row.label}</div>)}</div>)}
      {working && liveText && <div className="agent-assistant streaming"><Markdown text={liveText} /></div>}
      {snap.goal && <GoalRow goal={snap.goal} driverId={snap.selection.driverId} onOp={op => void goalOp(op)} />}
      {snap.goalPending && <div className="agent-goal pending" data-testid="agent-goal-pending"><Target size={14} /><div className="agent-goal-body"><b>{snap.goalPending.kind === 'set' ? snap.goalPending.objective : '清除目标'}</b><small>已发给执行器，等待确认</small></div></div>}
      {snap.queued.length > 0 && <div className="agent-queue">{snap.queued.map(q => <div key={q.turnId} className="agent-queue-row"><span>排队中 · {q.text}</span><button type="button" title="取消排队" onClick={() => void rpc.agentTasks.cancelQueued(taskId, q.turnId).then(reload).catch(e => toast.error(rpcErrorMessage(e)))}><X size={13} /></button></div>)}{snap.queuedTotal > snap.queued.length && <div className="agent-queue-row"><span>另有 {snap.queuedTotal - snap.queued.length} 条排队</span></div>}</div>}
    </div></div>
    <div className="agent-bottom">
      {snap.status === 'limited' && (() => { const err = [...snap.items].reverse().find(i => i.type === 'error' && i.payload?.limited); return err ? <div className="agent-limited" role="status">{LIMIT_LABEL[err.payload.limited.kind] ?? '受限'}：本轮已暂停，部分结果已保留。{err.payload.limited.resetAt ? `可在 ${err.payload.limited.resetAt} 后` : '稍后'}手动继续（不会自动换账号或到点重跑）。</div> : null; })()}
      {requests.length > 0 && snap.run
        ? <RequestPanel requests={requests} driverId={snap.run.driverId} onStop={() => void stop()} onRespond={async (r, result) => { await rpc.agentTasks.respond(taskId, r.requestId, r.revision, result); void reload(); }} />
        : <form className="agent-composer" onSubmit={e => { e.preventDefault(); void send(); }}>
          <AttachmentChips chips={chips} onRemove={removeChip} onRetry={retryChip} />
          <ComposerMenu items={menuItems} index={Math.min(menuIndex, Math.max(0, menuItems.length - 1))} onPick={pick} />
          <textarea ref={textarea} value={text} onSelect={e => refreshTrigger(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)} onBlur={() => setTimeout(() => setTrigger(null), 150)} onPaste={e => { const files = [...e.clipboardData.files]; if (files.length) { e.preventDefault(); addFiles(files); } }}
            onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={e => { const files = [...e.dataTransfer.files]; if (files.length) { e.preventDefault(); addFiles(files); } }} placeholder={working ? '继续输入，本轮结束后发送' : '随心输入'} rows={3}
            onChange={e => { setText(e.target.value); saveDraft(e.target.value); refreshTrigger(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
            onKeyDown={e => {
              if (menuItems.length && !e.nativeEvent.isComposing) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setMenuIndex(i => (i + 1) % menuItems.length); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); setMenuIndex(i => (i - 1 + menuItems.length) % menuItems.length); return; }
                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(menuItems[Math.min(menuIndex, menuItems.length - 1)]); return; }
                if (e.key === 'Escape') { e.preventDefault(); setTrigger(null); return; }
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send((e.metaKey || e.ctrlKey) && working && snap.run?.steer ? 'steer' : 'queue'); } }} />
          <div className="agent-composer-bar">
            <select aria-label="权限档位" value={snap.selection.tier} onChange={e => { if (e.target.value === 'full' && !permissionPref.value?.fullConfirmed) setConfirmFull(true); else void setSelection({ tier: e.target.value }); }}>
              {(profile?.tiers ?? [snap.selection.tier]).map(t => <option key={t} value={t}>{TIER_LABEL[t] ?? t}</option>)}
            </select>
            <span className="agent-composer-agent">{profile?.name ?? snap.selection.profileId}</span>
            {profile && profile.models.length > 0 && <select ref={modelSelect} aria-label="模型" value={snap.selection.model ?? ''} onChange={e => void setSelection({ model: e.target.value || null })}>
              <option value="">{profile.defaultModel ? `默认（${profile.defaultModel}）` : '执行器默认'}</option>
              {profile.models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>}
            <span className="push" />
            {working && snap.run?.steer && <button type="button" className="agent-stop" disabled={!text.trim()} onClick={() => void send('steer')} title="插话：并入当前这一轮（⌘Enter）"><Zap size={14} />插话</button>}
            {working && snap.run && !snap.run.steer && <span className="agent-composer-agent" title="该执行器版本没有插话的验证证据">运行中发送会排队</span>}
            {working && <button type="button" className="agent-stop" onClick={() => void stop()} title="停止本轮"><CircleStop size={15} /></button>}
            <button type="submit" className="agent-send" disabled={sending || (!text.trim() && !chips.length)} title="发送"><Send size={15} /></button>
          </div>
        </form>}
    </div>
    {terminalOpen && <AgentTerminalDrawer taskId={taskId} onClose={() => setTerminalOpen(false)} />}
    {confirmFull && <AgentDialog title="使用完全访问权限？" onClose={() => setConfirmFull(false)} footer={<><button className="m10-button" onClick={() => setConfirmFull(false)}>取消</button><button className="m10-button primary" data-testid="agent-confirm-full" onClick={() => { void permissionPref.update({ fullConfirmed: true }); setConfirmFull(false); void setSelection({ tier: 'full' }); }}>继续使用完全访问</button></>}>
      <p className="m13-perm-warn">智能体可以不经询问修改你电脑上的任何文件、访问互联网，也可以运行任意命令。只建议在你信任当前任务和项目时使用。</p>
      <div className="m13-note">Claude 交出的计划仍会请你批准。插件写操作按插件声明的上限处理（阶段 5 接入前仍逐次询问）。</div>
    </AgentDialog>}
  </section>;
}
