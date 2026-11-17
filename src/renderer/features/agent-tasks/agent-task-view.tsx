// M14 新任务区（阶段 2：单 Agent）。时间线、工作折叠、请求面板（输入框位置）、输入框（档位／模型／排队／停止）。
// 视觉以共享原型 prototypes/m6-codex/?preview=m14 为准，逐项对齐在原型评审基线上继续。
import MarkdownIt from 'markdown-it';
import { Archive, ChevronRight, CircleStop, Loader2, Send, Target, X, Zap } from 'lucide-react';
import { navigation } from '@renderer/core/navigation';
import { agentTasksStore } from '@renderer/core/agent-tasks-store';
import { useAppSettingsKey } from '@renderer/lib/hooks/useAppSettingsKey';
import { AgentDialog } from '@renderer/features/agents/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { agentTaskEvent, agentTaskLiveEvent } from '@shared/events';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { events, rpc } from '@renderer/lib/ipc';
import { buildTimeline, formatDuration, requestOptions, requestTitle, workLabel, type TimelineItem, type TimelineRequest } from './agent-timeline';
import './agent-tasks.css';

type Snapshot = Awaited<ReturnType<typeof rpc.agentTasks.snapshot>>;
type Profile = Awaited<ReturnType<typeof rpc.agentTasks.profiles>>[number];
const TIER_LABEL: Record<string, string> = { ask: '请求批准', auto: '帮我批准', full: '完全访问' };
const NOTICE_LABEL: Record<string, string> = { configWarning: '配置提示', warning: '提示', deprecationNotice: '弃用提示', guardianWarning: '自动审核提示' };
const STATUS_LABEL: Record<string, string> = { idle: '', working: '工作中', waiting: '等待你处理', completed: '已完成', stopped: '已停止', failed: '失败' };

// 消息里的链接在阶段 5 按 T3 规则接入路由；此前只显示为文字，不打开任何地址。
const md = new MarkdownIt({ html: false, linkify: false, breaks: false });
// 本项目的 markdown-it 类型声明只含最小接口；这里只覆盖链接与图片的渲染规则。
const mdRules = (md as unknown as { renderer: { rules: Record<string, (tokens: { content: string }[], idx: number) => string> } }).renderer.rules;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
mdRules.link_open = () => '<span class="agent-link-text">';
mdRules.link_close = () => '</span>';
mdRules.image = (tokens, idx) => `<span class="agent-link-text">[${escapeHtml(tokens[idx].content)}]</span>`;

export function newClientInputId() { return `in-${crypto.randomUUID().replace(/-/g, '')}`; }

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => md.render(text), [text]);
  return <div className="agent-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

function ItemRow({ item }: { item: TimelineItem }) {
  const p = item.payload ?? {};
  switch (item.type) {
    case 'user_message': return <div className="agent-user"><div className="agent-user-bubble">{p.text}</div></div>;
    case 'assistant_message': return <div className="agent-assistant"><Markdown text={String(p.text ?? '')} /></div>;
    case 'proposed_plan': return <div className="agent-plan"><div className="agent-plan-head">计划</div><Markdown text={String(p.plan ?? '')} />
      <div className="agent-plan-actions"><button type="button" onClick={() => { void navigator.clipboard.writeText(String(p.plan ?? '')); toast.success('已复制计划'); }}>复制</button>
        <button type="button" onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([String(p.plan ?? '')], { type: 'text/markdown' })); a.download = 'plan.md'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }}>下载</button></div></div>;
    case 'todo_list': return <div className="agent-todo">{(p.entries ?? []).map((e: any) => <div key={e.id} className={`agent-todo-row ${e.status}`}><span className="agent-todo-box" aria-hidden>{e.status === 'completed' ? '✓' : ''}</span>{e.subject}</div>)}</div>;
    case 'error': return <div className="agent-error" role="alert">{p.message ?? p.code}</div>;
    case 'compaction': return <div className="agent-divider">上下文已压缩</div>;
    case 'system_notice': return <details className="agent-notice"><summary>{NOTICE_LABEL[String(p.code)] ?? '提示'}</summary><pre>{String(p.detail ?? '')}</pre></details>;
    default: return null;
  }
}

function WorkRow({ items, running, seconds }: { items: TimelineItem[]; running: boolean; seconds: number }) {
  const [open, setOpen] = useState(false);
  return <div className="agent-work">
    <button type="button" className={`agent-work-head${running ? ' shine' : ''}`} aria-expanded={open} onClick={() => setOpen(o => !o)}>
      {running ? '工作中' : '已工作'} {formatDuration(seconds)}<ChevronRight size={13} className={open ? 'open' : ''} />
    </button>
    {open && <div className="agent-work-rows">{items.map(it => <details key={it.itemId} className={`agent-work-row ${it.payload?.status ?? ''}`}>
      <summary>{workLabel(it)}</summary>
      {it.payload?.output ? <pre>{String(it.payload.output)}</pre> : it.type === 'reasoning' || it.type === 'assistant_message' ? <Markdown text={String(it.payload?.text ?? '')} /> : null}
    </details>)}</div>}
  </div>;
}

function RequestPanel({ requests, driverId, onRespond, onStop }: { requests: TimelineRequest[]; driverId: string; onRespond: (r: TimelineRequest, result: unknown) => Promise<void>; onStop: () => void }) {
  const [index, setIndex] = useState(0);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const r = requests[Math.min(index, requests.length - 1)];
  const options = requestOptions(r, driverId);
  const head = requestTitle(r);
  const choose = useCallback(async (i: number) => {
    const o = options[i]; if (!o || busy) return;
    const why = reason[r.requestId] ?? '';
    if (o.key === 'revise' && !why.trim()) { toast.warning('先在下方写修改意见'); return; }
    setBusy(true);
    try { await onRespond(r, o.result(why)); setIndex(0); } catch (e) { toast.error(rpcErrorMessage(e)); } finally { setBusy(false); }
  }, [options, busy, reason, r, onRespond]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      const n = Number(e.key); if (n >= 1 && n <= options.length) { e.preventDefault(); void choose(n - 1); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [options.length, choose]);
  return <div className="agent-request" role="dialog" aria-label="待处理请求">
    <div className="agent-request-head"><b>{head.title}</b>{requests.length > 1 && <span className="agent-request-nav"><button type="button" onClick={() => setIndex(i => (i - 1 + requests.length) % requests.length)}>‹</button>{index + 1}/{requests.length}<button type="button" onClick={() => setIndex(i => (i + 1) % requests.length)}>›</button></span>}</div>
    {head.detail && <pre className="agent-request-detail">{head.detail}</pre>}
    <div className="agent-request-options">{options.map((o, i) => <button key={o.key} type="button" disabled={busy} className={o.deny ? 'deny' : ''} onClick={() => void choose(i)}><kbd>{i + 1}</kbd>{o.label}</button>)}</div>
    <textarea className="agent-request-reason" placeholder="可写原因或意见（可选）" value={reason[r.requestId] ?? ''} onChange={e => setReason(s => ({ ...s, [r.requestId]: e.target.value }))} rows={2} />
    <div className="agent-request-foot"><button type="button" className="agent-stop" onClick={onStop}><CircleStop size={14} />停止</button></div>
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
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [text, setText] = useState('');
  const [live, setLive] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  const permissionPref = useAppSettingsKey('agentPermissions');
  const [confirmFull, setConfirmFull] = useState(false);
  const draftRev = useRef(0), draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null), reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try {
      const s = await rpc.agentTasks.snapshot(taskId);
      setSnap(s);
      setLive({});
    } catch (e) { toast.error(rpcErrorMessage(e)); }
  }, [taskId]);

  useEffect(() => {
    let alive = true;
    // 先订阅再读快照，避免读快照与事件之间漏掉更新（技术方案 §3.1）。
    const offEvent = events.on(agentTaskEvent, e => { if (e.taskId === taskId && !reloadTimer.current) reloadTimer.current = setTimeout(() => { reloadTimer.current = null; if (alive) void reload(); }, 80); });
    const offLive = events.on(agentTaskLiveEvent, e => { if (e.taskId === taskId) setLive(m => ({ ...m, [e.itemKey]: (m[e.itemKey] ?? '') + e.text })); });
    void (async () => {
      const s = await rpc.agentTasks.snapshot(taskId).catch(e => { toast.error(rpcErrorMessage(e)); return null; });
      if (!alive || !s) return;
      setSnap(s); draftRev.current = s.draft?.revision ?? 0; setText(String((s.draft?.draft as any)?.text ?? ''));
    })();
    void rpc.agentTasks.profiles().then(p => alive && setProfiles(p)).catch(() => {});
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; offEvent(); offLive(); clearInterval(tick); if (reloadTimer.current) clearTimeout(reloadTimer.current); };
  }, [taskId, reload]);

  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [snap?.seq, Object.keys(live).length]);

  const saveDraft = (value: string) => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(async () => {
      const r = await rpc.agentTasks.saveDraft(taskId, { text: value }, draftRev.current).catch(() => null);
      if (r?.ok) draftRev.current = r.revision; else if (r) draftRev.current = r.revision; // 冲突：保留本地编辑，下次以服务端修订再写
    }, 400);
  };

  if (!snap) return <div className="agent-task-view loading"><Loader2 className="spin" size={18} /></div>;
  const profile = profiles.find(p => p.profileId === snap.selection.profileId);
  const groups = buildTimeline(snap.items as TimelineItem[], snap.turns as any, now);
  const requests = (snap.requests as TimelineRequest[]).filter(r => r.status === 'pending');
  const working = snap.status === 'working' || snap.status === 'waiting';
  const liveText = Object.values(live).join('');

  const send = async (mode: 'queue' | 'steer' = 'queue') => {
    const value = text.trim(); if (!value) return;
    try {
      // /goal 命令：只对声明支持的执行器开放（需求 R02）；/goal clear 清除。
      const goalCmd = /^\/goal(?:\s+([\s\S]*))?$/.exec(value);
      if (goalCmd) {
        const arg = (goalCmd[1] ?? '').trim();
        if (!arg) { toast.warning('在 /goal 后写目标，或用 /goal clear 清除'); return; }
        await rpc.agentTasks.goal(taskId, arg === 'clear' ? { kind: 'clear' } : { kind: 'set', objective: arg });
      } else {
        const r = await rpc.agentTasks.submit(taskId, { clientInputId: newClientInputId(), text: value, expectedSelectionRevision: snap.selectionRevision, mode });
        if ('steerRefused' in r && r.steerRefused) toast.warning(r.steerRefused);
        else if (r.status === 'queued') toast.message('已排队，本轮结束后发送');
      }
      setText(''); saveDraft('');
      void reload();
    } catch (e) { toast.error(rpcErrorMessage(e)); void reload(); }
  };
  const goalOp = async (op: 'pause' | 'resume' | 'clear') => { try { await rpc.agentTasks.goal(taskId, { kind: op }); void reload(); } catch (e) { toast.error(rpcErrorMessage(e)); } };
  const archive = async () => { try { await rpc.agentTasks.archive(taskId); void agentTasksStore.refresh(); navigation.newTask(snap.projectId ?? undefined); } catch (e) { toast.error(rpcErrorMessage(e)); } };
  const stop = async () => { try { await rpc.agentTasks.stop(taskId); } catch (e) { toast.error(rpcErrorMessage(e)); } };
  const setSelection = async (patch: { tier?: string; model?: string | null }) => {
    try { const r = await rpc.agentTasks.setSelection(taskId, patch as never, snap.selectionRevision); if (!r.ok) toast.warning('设置已在别处变更，已刷新'); void reload(); }
    catch (e) { toast.error(rpcErrorMessage(e)); }
  };

  return <section className="agent-task-view" aria-label="统一任务区">
    <header className="agent-task-head"><h1>{snap.title}</h1>{STATUS_LABEL[snap.status] && <span className={`agent-status ${snap.status}`}>{STATUS_LABEL[snap.status]}</span>}<span className="push" /><button type="button" className="agent-head-btn" title="归档任务" data-testid="agent-archive" onClick={() => void archive()}><Archive size={15} /></button></header>
    <div className="agent-scroll" ref={scroller}><div className="agent-timeline">
      {groups.map(g => <div key={g.turnId ?? 'host'} className="agent-turn">{g.rows.map(row =>
        row.kind === 'item' ? <ItemRow key={row.item.itemId} item={row.item} />
          : row.kind === 'work' ? <WorkRow key={row.id} items={row.items} running={row.running} seconds={row.seconds} />
            : <div key={row.id} className={`agent-turn-footer${row.failed ? ' failed' : ''}`}>{row.label}</div>)}</div>)}
      {working && liveText && <div className="agent-assistant streaming"><Markdown text={liveText} /></div>}
      {snap.goal && <GoalRow goal={snap.goal} driverId={snap.selection.driverId} onOp={op => void goalOp(op)} />}
      {snap.queued.length > 0 && <div className="agent-queue">{snap.queued.map(q => <div key={q.turnId} className="agent-queue-row"><span>排队中 · {q.text}</span><button type="button" title="取消排队" onClick={() => void rpc.agentTasks.cancelQueued(taskId, q.turnId).then(reload).catch(e => toast.error(rpcErrorMessage(e)))}><X size={13} /></button></div>)}</div>}
    </div></div>
    <div className="agent-bottom">
      {requests.length > 0 && snap.run
        ? <RequestPanel requests={requests} driverId={snap.run.driverId} onStop={() => void stop()} onRespond={async (r, result) => { await rpc.agentTasks.respond(taskId, r.requestId, r.revision, result); void reload(); }} />
        : <form className="agent-composer" onSubmit={e => { e.preventDefault(); void send(); }}>
          <textarea value={text} placeholder={working ? '继续输入，本轮结束后发送' : '随心输入'} rows={3}
            onChange={e => { setText(e.target.value); saveDraft(e.target.value); }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send((e.metaKey || e.ctrlKey) && working && snap.run?.steer ? 'steer' : 'queue'); } }} />
          <div className="agent-composer-bar">
            <select aria-label="权限档位" value={snap.selection.tier} onChange={e => { if (e.target.value === 'full' && !permissionPref.value?.fullConfirmed) setConfirmFull(true); else void setSelection({ tier: e.target.value }); }}>
              {(profile?.tiers ?? [snap.selection.tier]).map(t => <option key={t} value={t}>{TIER_LABEL[t] ?? t}</option>)}
            </select>
            <span className="agent-composer-agent">{profile?.name ?? snap.selection.profileId}</span>
            {profile && profile.models.length > 0 && <select aria-label="模型" value={snap.selection.model ?? profile.defaultModel ?? ''} onChange={e => void setSelection({ model: e.target.value || null })}>
              {!profile.models.includes(snap.selection.model ?? profile.defaultModel ?? '') && <option value="">执行器默认</option>}
              {profile.models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>}
            <span className="push" />
            {working && snap.run?.steer && <button type="button" className="agent-stop" disabled={!text.trim()} onClick={() => void send('steer')} title="插话：并入当前这一轮（⌘Enter）"><Zap size={14} />插话</button>}
            {working && snap.run && !snap.run.steer && <span className="agent-composer-agent" title="该执行器版本没有插话的验证证据">运行中发送会排队</span>}
            {working && <button type="button" className="agent-stop" onClick={() => void stop()} title="停止本轮"><CircleStop size={15} /></button>}
            <button type="submit" className="agent-send" disabled={!text.trim()} title="发送"><Send size={15} /></button>
          </div>
        </form>}
    </div>
    {confirmFull && <AgentDialog title="使用完全访问权限？" onClose={() => setConfirmFull(false)} footer={<><button className="m10-button" onClick={() => setConfirmFull(false)}>取消</button><button className="m10-button primary" data-testid="agent-confirm-full" onClick={() => { void permissionPref.update({ fullConfirmed: true }); setConfirmFull(false); void setSelection({ tier: 'full' }); }}>继续使用完全访问</button></>}>
      <p className="m13-perm-warn">智能体可以不经询问修改你电脑上的任何文件、访问互联网，也可以运行任意命令。只建议在你信任当前任务和项目时使用。</p>
      <div className="m13-note">Claude 交出的计划仍会请你批准。插件写操作按插件声明的上限处理（阶段 5 接入前仍逐次询问）。</div>
    </AgentDialog>}
  </section>;
}
