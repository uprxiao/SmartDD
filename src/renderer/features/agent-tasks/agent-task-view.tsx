import { observer } from 'mobx-react-lite';
import { inlineCodeFilePathCandidate,absoluteFilePathMatches,markdownDestinationHostPath } from '@shared/t3-links/markdownLinks';
import { openMessageLink,resolveMessageLink } from './message-links';
import {VoiceButton} from '@renderer/views/voice-controls';
import {voiceStore,textareaVoiceTarget} from '@renderer/core/voice-store';
import {FILE_TERMINAL_DRAG_TYPE,dropFileToAgentComposer} from '@renderer/features/files/terminal-context/store';
import {agentComposerTargets} from './composer-target';
import { panelsFor } from './workspace-panels-store';
// M14 新任务区（阶段 2：单 Agent）。时间线、工作折叠、请求面板（输入框位置）、输入框（档位／模型／排队／停止）。
// 视觉以共享原型 prototypes/m6-codex/?preview=m14 为准，逐项对齐在原型评审基线上继续。
import MarkdownIt from 'markdown-it';
import { Archive, MoreHorizontal, Plug, PanelRight, Brain, ChevronRight, CircleAlert, CircleStop, Clock3, FilePenLine, FileSearch, Globe, Info, Loader2, Network, Pencil, Send, SquareTerminal, Target, Trash2, TriangleAlert, Wrench, X, Zap } from 'lucide-react';
import { AgentTerminalDrawer } from './agent-terminal';
import { AgentModelPicker } from './agent-model-picker';
import { AgentChildSummary, AgentLineage, AgentRelations, openRelatedTask, workspaceModeLabel, type Relations } from './agent-relations';
import { AttachmentChips, prepareChip, type Chip, type PreparedAttachment } from './attachment-chips';
import { applyItem, commandItems, fileItems, findTrigger, skillItems, type Catalog, type MenuItem, type MenuTrigger } from './composer-menu';
import { navigation } from '@renderer/core/navigation';
import { agentTasksStore } from '@renderer/core/agent-tasks-store';
import { useAppSettingsKey } from '@renderer/lib/hooks/useAppSettingsKey';
import { AgentDialog } from '@renderer/features/agents/ui';
import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MailSendReview } from '@shared/mail-execution';
import { BrowserAccessReview, MailReviewCard, mailEdits, type MailEdits } from './agent-business-review';
import { toast } from 'sonner';
import { agentTaskEvent, agentTaskLiveEvent,applicationsChangedEvent } from '@shared/events';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { events, rpc } from '@renderer/lib/ipc';
import { buildTimeline, turnSeconds, formatDuration, requestForm, requestOptions, requestTitle, workLabel, workSegments, summarizeTools, type RequestForm, type TurnGroup, type TurnInfo, type TimelineItem, type TimelineRequest } from './agent-timeline';
import './agent-tasks.css';

type Snapshot = Awaited<ReturnType<typeof rpc.agentTasks.snapshot>>;
type Profile = Awaited<ReturnType<typeof rpc.agentTasks.profiles>>[number];
const TIER_LABEL: Record<string, string> = { ask: '请求批准', auto: '帮我批准', full: '完全访问' };
const NOTICE_LABEL: Record<string, string> = { configWarning: '配置提示', warning: '提示', deprecationNotice: '弃用提示', guardianWarning: '自动审核提示' };
const STATUS_LABEL: Record<string, string> = { idle: '', working: '工作中', waiting: '等待你处理', needs_attention: '需要你处理', completed: '已完成', stopped: '已停止', failed: '失败', limited: '受限' };
const LIMIT_LABEL: Record<string, string> = { usage: '额度已用完', rate: '请求过于频繁，已被限流', context: '上下文已达上限', output: '输出长度到上限' };

// 消息里的链接在阶段 5 按 T3 规则接入路由；此前只显示为文字，不打开任何地址。
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
const validateMarkdownLink = md.validateLink.bind(md);
// File links are routed through the host's task-root checks; the link never navigates the renderer.
md.validateLink = url => validateMarkdownLink(url) || (/^file:\/\/(?:localhost)?\/(?![/\\])/i.test(url) && markdownDestinationHostPath(url) !== null);
// GFM-style automatic web links: explicit HTTP(S) and www., never fuzzy domains or emails.
type LinkMatch = { raw: string; url: string };
type Linkifier = {
  set(options: { fuzzyLink: boolean; fuzzyEmail: boolean }): Linkifier;
  add(prefix: string, rule: null | {
    validate(text: string, offset: number, parser: Linkifier): number;
    normalize(match: LinkMatch): void;
  }): Linkifier;
  testSchemaAt(text: string, schema: string, offset: number): number;
};
const linkifier = (md as unknown as { linkify: Linkifier }).linkify;
linkifier.set({ fuzzyLink: false, fuzzyEmail: false }).add('//', null).add('ftp:', null).add('mailto:', null).add('www.', {
  validate(text, offset, parser) {
    const prefix = '//www.';
    return Math.max(0, parser.testSchemaAt(prefix + text.slice(offset), 'http:', 0) - prefix.length);
  },
  normalize(match) { match.url = 'http://' + match.raw; },
});
// 本项目的 markdown-it 类型声明只含最小接口；这里只覆盖链接与图片的渲染规则。
const mdRules = (md as unknown as { renderer: { rules: Record<string, (tokens: { content: string }[], idx: number) => string> } }).renderer.rules;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const anchor=(href:string,label:string)=>`<a href="#" data-agent-link="${escapeHtml(encodeURIComponent(href))}">${label}</a>`;
mdRules.link_open = (tokens,idx) => `<a href="#" data-agent-link="${escapeHtml(encodeURIComponent((tokens[idx] as any).attrGet('href')??''))}">`;
mdRules.link_close = () => '</a>';
mdRules.code_inline=(tokens,idx)=>{const text=tokens[idx].content,path=inlineCodeFilePathCandidate(text);return '<code>'+(path?anchor(path,escapeHtml(text)):escapeHtml(text))+'</code>';};
mdRules.text=(tokens,idx)=>{const text=tokens[idx].content;if(tokens.slice(0,idx).reduce((n,t)=>n+((t as any).type==='link_open'?1:(t as any).type==='link_close'?-1:0),0)>0)return escapeHtml(text);const matches=absoluteFilePathMatches(text);let pos=0,out='';for(const m of matches){out+=escapeHtml(text.slice(pos,m.index))+anchor(m.path,escapeHtml(m.path));pos=m.index+m.path.length;}return out+escapeHtml(text.slice(pos));};
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
const ArchivedScope = createContext(false);
const NativeProcessScope = createContext<(item: TimelineItem) => void>(() => {});
const RelationsScope = createContext<Relations|null>(null);
const RunInTerminal = createContext<null|((code:string)=>void)>(null);
function Markdown({ text,itemId }: { text: string;itemId?:string }) {
  const archived=useContext(ArchivedScope),taskId=useContext(TaskScope),terminal=useContext(RunInTerminal);const [menu,setMenu]=useState<{href:string;x:number;y:number}|null>(null);
  const route=(href:string,external=false)=>{if(!itemId){toast.message('这条内容仍在生成，完成后再打开链接');return;}void openMessageLink(taskId,itemId,href,external).catch(e=>toast.error(rpcErrorMessage(e)));};
  const html = useMemo(() => {
    const rendered = md.render(text);
    return archived ? rendered.replace(/<button[^>]*class="agent-run-in-terminal"[^>]*>[\s\S]*?<\/button>/g,'') : rendered;
  }, [text,archived]);
  return <><div className="agent-md" onContextMenu={e=>{if(archived)return; const link=(e.target as HTMLElement).closest<HTMLElement>('[data-agent-link]');if(link?.dataset.agentLink){e.preventDefault();setMenu({href:decodeURIComponent(link.dataset.agentLink),x:Math.min(e.clientX,window.innerWidth-210),y:Math.min(e.clientY,window.innerHeight-180)});}}} dangerouslySetInnerHTML={{ __html: html }} onClick={e => {
    if (archived) { e.preventDefault(); return; }
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.agent-run-in-terminal');
    if (btn?.dataset.code) terminal?.(decodeURIComponent(btn.dataset.code));
    const link=(e.target as HTMLElement).closest<HTMLElement>('[data-agent-link]');if(link?.dataset.agentLink){e.preventDefault();route(decodeURIComponent(link.dataset.agentLink),e.metaKey||e.ctrlKey);}
  }} />{!archived&&menu&&<><button type='button' className='agent-context-scrim' aria-label='关闭链接菜单' onClick={()=>setMenu(null)}/><div className='agent-link-menu' style={{left:menu.x,top:menu.y}}><button type='button' onClick={()=>{route(menu.href);setMenu(null);}}>打开</button><button type='button' onClick={()=>{route(menu.href,true);setMenu(null);}}>在外部编辑器打开</button><button type='button' onClick={()=>{if(itemId)void resolveMessageLink(taskId,itemId,menu.href).then(r=>navigator.clipboard.writeText(r.kind==='file'?r.absolutePath:r.url)).then(()=>toast.success('已复制完整路径')).catch(e=>toast.error(rpcErrorMessage(e)));setMenu(null);}}>复制完整路径</button></div></>}</>;
}

const DEFAULT_COMMANDS: Record<string, string[]> = { 'codex-app-server': ['goal', 'compact', 'review'], 'claude-sdk': ['goal', 'compact', 'init'] };
/** 输入框选用菜单（/命令、@文件、$Skill）；方向键选择，Enter／Tab 选用，Esc 关闭。 */
function ComposerMenu({ items, index, onPick }: { items: MenuItem[]; index: number; onPick: (i: MenuItem) => void }) {
  if (!items.length) return null;
  return <div className="agent-menu" role="listbox">{items.map((it, i) => <button key={it.key} type="button" role="option" aria-selected={i === index} className={i === index ? 'on' : ''} onMouseDown={e => { e.preventDefault(); onPick(it); }}>
    <b>{it.label}</b>{it.detail && <small>{it.detail}</small>}</button>)}</div>;
}

type RangeChunk = { chunk: string; next: number; done: boolean; revision?: number };
/**
 * 按字节偏移分段读取完整正文并解析（复核 NR06、FR02）。首段带回修订号，后续段按该修订读取；
 * 读取中途内容被更新时服务端拒绝，从头按新修订重读，不拼接不同修订的片段（复核 SR05）。
 */
async function readRange(read: (offset: number, revision?: number) => Promise<RangeChunk>): Promise<{ value: any; revision?: number }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let off = 0, text = '', revision: number | undefined;
    try {
      for (let i = 0; i < 1000; i++) {
        const r = await read(off, revision);
        if (i === 0) revision = r.revision;
        text += r.chunk;
        if (r.done) return { value: JSON.parse(text), revision };
        if (r.next <= off) throw new Error('读取完整内容失败');
        off = r.next;
      }
    } catch (e) { if (attempt < 2 && /已更新/.test(rpcErrorMessage(e))) continue; throw e; }
  }
  throw new Error('读取完整内容失败');
}
/** 读取指定修订的条目全文；条目已推进到其他修订时服务端拒绝，不返回别的修订的内容。 */
const TaskScope = createContext('');
type TimelineActions = { unsent(turnId: string | null): boolean; retry(turnId: string): void; restore(turnId: string): void; continuation(itemId:string): (() => void) | undefined; busy: boolean };
const TimelineActionScope = createContext<TimelineActions | null>(null);
const fetchItemPayload = (taskId: string, itemId: string, revision: number) => readRange((off) => rpc.agentTasks.itemBody(taskId, itemId, off, revision));

/**
 * 截断条目的全文（复核 FR04）。缓存按条目＋修订有效（复核 SR05）：修订推进后旧全文作废，已展开的自动按新修订重取；
 * 迟到的旧读取结果不写回；复制等操作只用当前修订的全文。
 */
function useFullPayload(item: TimelineItem) {
  const taskId = useContext(TaskScope);
  const key = `${taskId}:${item.itemId}:${item.revision}`;
  const [full, setFull] = useState<{ key: string; payload: any } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const current = useRef(key); current.current = key;
  const valid = full && full.key === key ? full.payload : null;
  const truncated = !!item.payload?.truncated && !valid;
  const load = async (): Promise<any> => {
    const want = key;
    try {
      const { value } = await fetchItemPayload(taskId, item.itemId, item.revision);
      // 读取期间条目已更新：旧结果不写回，也不交给复制／下载。
      if (current.current !== want) { toast.message('内容已更新，请重试'); return null; }
      // 旧版本只剩前缀与摘要的截断记录不是全文：不缓存，明确失败（复核 T02）。
      if (isLegacyTruncated(value)) { toast.error('历史只保留了开头部分，无法读取全文'); return null; }
      setFull({ key: want, payload: value }); setExpanded(true); return value;
    } catch (e) { toast.error(`读取完整内容失败：${rpcErrorMessage(e)}`); return null; }
  };
  useEffect(() => { if (expanded && item.payload?.truncated && !valid) void load(); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { payload: valid ?? item.payload ?? {}, truncated, load };
}
/** 历史正文是否不完整：超过保存上限按结构截短（storedTruncated），或旧版本的通用截断记录。 */
const isLegacyTruncated = (v: any) => !!v && v.truncated === true && typeof v.sha256 === 'string' && 'head' in v && !v.storedTruncated;
const isIncomplete = (v: any) => !!v && (v.storedTruncated === true || isLegacyTruncated(v));
/**
 * 正文完整性的统一展示（复核 U02）：预览→“展开全文”；不可恢复的部分内容→明确提示；完整→不显示。
 * 普通条目与工作过程条目共用，避免展开后把残缺内容呈现为已经完整。
 */
function Completeness({ truncated, payload, onExpand }: { truncated: boolean; payload: any; onExpand: () => void }) {
  if (truncated) return <ExpandButton onClick={onExpand} />;
  if (isIncomplete(payload)) return <div className="agent-limited" role="note">内容超过保存上限，只保留了开头部分，后面的内容无法恢复</div>;
  return null;
}
function ExpandButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="agent-older" onClick={onClick}>内容较长，已截断显示 · 展开全文</button>;
}

function ItemRow({ item }: { item: TimelineItem }) {
  const useTaskId=useContext(TaskScope);
  const archived=useContext(ArchivedScope);
  const relations=useContext(RelationsScope);
  const actions = useContext(TimelineActionScope);
  const [showMessage, setShowMessage] = useState(false);
  const { payload: p, truncated, load } = useFullPayload(item);
  // 复制／下载计划先取得全文；读不到就提示失败，不输出残缺内容（复核 FR04）。
  // 正文不完整（超过保存上限）或读不到计划字段时提示失败，不复制／下载空的或残缺的内容（复核 T02）。
  const planText = async (): Promise<string | null> => {
    const src = truncated ? await load() : p;
    if (!src) return null;
    if (isIncomplete(src)) { toast.error('计划超过保存上限，历史只保留了开头部分，无法复制或下载全文'); return null; }
    if (typeof src.plan !== 'string') { toast.error('读取完整计划失败'); return null; }
    return src.plan;
  };
  const copyPlan = async () => { const t = await planText(); if (t === null) return; try { await navigator.clipboard.writeText(t); toast.success('已复制计划'); } catch (e) { toast.error(`复制失败：${rpcErrorMessage(e)}`); } };
  const downloadPlan = async () => { const t = await planText(); if (t === null) return; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/markdown' })); a.download = 'plan.md'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  const more = <Completeness truncated={truncated} payload={p} onExpand={() => void load()} />;
  switch (item.type) {
    case 'user_message': {
      const message = String(p.text ?? '');
      const fold = !truncated && !isIncomplete(p) && (message.length > 600 || message.split('\n', 9).length > 8);
      const preview = message.slice(0, 600).split('\n').slice(0, 8).join('\n').replace(/[\uD800-\uDBFF]$/, '');
      return <div className="agent-user"><div className="agent-user-bubble">{fold && !showMessage ? preview + '…' : message}
        {fold && <button type="button" className="agent-inline-action agent-fold" aria-expanded={showMessage} onClick={() => setShowMessage(!showMessage)}>{showMessage ? '收起全文' : '显示全文'}</button>}
        <Completeness truncated={truncated} payload={p} onExpand={() => { setShowMessage(true); void load(); }}/>
        {p.attachments?.length ? <div className="agent-user-attachments">{p.attachments.map((a: any, i: number) => <span key={i} className="agent-chip-name">{a.kind === 'path' ? a.relativePath : a.name}</span>)}</div> : null}
        {!archived && item.turnId && actions?.unsent(item.turnId) && <div className="agent-inline-actions"><span>发送失败</span>
          <button type="button" disabled={actions.busy} onClick={() => actions.retry(item.turnId!)}>重试</button>
          <button type="button" disabled={actions.busy} onClick={() => actions.restore(item.turnId!)}>放回输入框</button>
        </div>}
      </div></div>;
    }
    case 'assistant_message': return <div className="agent-assistant"><Markdown itemId={item.itemId} text={String(p.text ?? '')} />{more}</div>;
    case 'proposed_plan': return <div className="agent-plan"><div className="agent-plan-head">计划</div><Markdown itemId={item.itemId} text={String(p.plan ?? '')} />{more}
      <div className="agent-plan-actions"><button type="button" onClick={() => void copyPlan()}>复制</button>
        <button type="button" onClick={() => void downloadPlan()}>下载</button></div></div>;
    case 'todo_list': {
      const entries: {id:string;status:string;subject:string}[] = p.entries ?? [];
      return <div className="agent-todo"><header><b>待办清单</b><span>{entries.filter(e => e.status === 'completed').length}/{entries.length}{truncated ? '（预览）' : ''}</span></header>
        {entries.map(e => <div key={e.id} className={`agent-todo-row ${e.status}`}><span className="agent-todo-box" aria-hidden>{e.status === 'completed' ? '✓' : ''}</span>{e.subject}</div>)}{more}</div>;
    }
    case 'subtask': {
      const child = relations?.children.find(value=>value.childTaskId===p.childTaskId);
      const mode = workspaceModeLabel(child?.workspaceMode??p.workspaceMode,child?.access??p.access,child?.workspace?.branch);
      return <div className="agent-child-result">
        <button type="button" onClick={()=>openRelatedTask(useTaskId,p.childTaskId,child?.archived??archived)}>宿主子任务 · {p.title}</button>
        <small>{mode??'已接受委派'}{p.notice ? ` · ${p.notice}` : ''}</small>{more}
      </div>;
    }
    case 'files_changed': return <ChangeCard payload={p} />;
    case 'notification': return <div className="agent-child-result"><b>{p.title ?? '任务结果'} · {p.status ?? '已收到'}</b>{p.childTaskId && <button type="button" onClick={() => openRelatedTask(useTaskId,p.childTaskId,archived)}>查看子任务</button>}<small>来源：{p.sourceKind === 'child_result' ? '子任务结果' : '宿主业务通知'}</small>{(p.summary||p.error||p.result)&&<pre>{p.summary??p.error??JSON.stringify(p.result,null,2)}</pre>}{more}</div>;
    case 'error': {
      if (!p.limited) return <div className="agent-error agent-error-details">
        <details><summary><CircleAlert size={15} aria-hidden/>查看错误详情</summary>
          <pre>{String(p.message ?? p.code ?? '未提供错误详情')}</pre>
          {p.code && p.message && <small>{String(p.code)}</small>}{more}
        </details>
      </div>;
      const { kind, resetAt } = p.limited;
      const resume = actions?.continuation(item.itemId);
      return <div className="agent-limit-card" role="status"><TriangleAlert size={16}/><div><b>{LIMIT_LABEL[kind] ?? '受限'}</b>
        <small>{kind === 'output' ? '部分回答已保留，可手动继续。' : `本轮已暂停，部分结果已保留。${resetAt ? `可在 ${resetAt} 后` : '稍后'}手动继续（不会自动换账号或到点重跑）。`}</small>{more}</div>
        {resume && <button type="button" className="agent-inline-action" disabled={actions?.busy} onClick={resume}>继续</button>}
      </div>;
    }
    case 'compaction': return <div className="agent-divider">上下文已压缩</div>;
    case 'provider_switch': return <div className="agent-divider">此处切换到 {p.toName ?? p.to}{more}</div>;
    case 'handoff': return <details className="agent-notice"><summary>{p.kind === 'full' ? '已准备全量交接' : '已准备增量交接'}{p.omissions?.length ? ` · ${p.omissions.length} 项因预算未覆盖` : ''}</summary><pre>{p.text}</pre>{p.omissions?.map((x: any) => <div key={x.itemId}>{x.itemId}：{x.reason}</div>)}{more}</details>;
    case 'omission_notice': return <div className="agent-limited">{p.detail}{more}</div>;
    case 'system_notice': {
      const severity = p.severity === 'error' ? 'error' : p.severity === 'warning' || ['warning','configWarning','guardianWarning','deprecationNotice'].includes(p.code) ? 'warning' : 'info';
      const Icon = severity === 'error' ? CircleAlert : severity === 'warning' ? TriangleAlert : Info;
      return <details className={`agent-notice agent-system-notice ${severity}`}><summary><Icon size={15}/>{p.title ?? NOTICE_LABEL[String(p.code)] ?? '提示'}</summary><pre>{String(p.detail ?? '')}</pre>{more}</details>;
    }
    default: return null;
  }
}

type ChangedFile = { path: string; added: number | null; removed: number | null; binary: boolean };
function ChangeCard({ payload }: { payload: {turnId:string; status:string; reason?:string; fileCount:number; files?:ChangedFile[]} }) {
  const taskId = useContext(TaskScope);
  const {turnId, status, reason, fileCount, files} = payload;
  const [loaded, setLoaded] = useState<{turnId:string; files:ChangedFile[]}>();
  useEffect(() => {
    if (files || status !== 'complete' || !fileCount) return;
    let current = true;
    void rpc.agentTasks.changeFiles(taskId, turnId).then(result => {
      if (current) setLoaded({ turnId, files: result.files.slice(0, 8) });
    }).catch(() => {});
    return () => { current = false; };
  }, [taskId, turnId, fileCount, status, files]);
  const rows = files ?? (loaded?.turnId === turnId ? loaded.files : []);
  return <button type="button" className="agent-change-card" onClick={() => {
    const panel = panelsFor({ kind: 'task', taskId }); panel.diffTurn = turnId; panel.open('diff');
  }}>
    <span className="agent-change-head"><b>本轮改动 · {reason ?? (status === 'incomplete' ? '差异不完整' : fileCount + ' 个文件')}</b><span>查看差异 <ChevronRight size={12}/></span></span>
    {rows.length > 0 && <span className="agent-change-files">{rows.map(file => <span key={file.path}><code title={file.path}>{file.path}</code>{file.binary ? <span>二进制</span> : <><em className="added">{file.added === null ? '—' : '+' + file.added}</em><em className="removed">{file.removed === null ? '—' : '−' + file.removed}</em></>}</span>)}</span>}
    {rows.length > 0 && fileCount > rows.length && <small>另有 {fileCount - rows.length} 个文件</small>}
    <small>观察到的变化可能包含用户或外部写入</small>
  </button>;
}


function NativeMessage({ item }: { item: TimelineItem }) {
  const { payload: p, truncated, load } = useFullPayload(item);
  const content = p.message?.content ?? p.content;
  const text = p.text ?? p.summary ?? (Array.isArray(content) ? content.map((b: any) => b.text ?? (b.type === 'tool_use' ? `调用 ${b.name}\n${JSON.stringify(b.input)}` : b.content ?? '')).join('\n') : typeof content === 'string' ? content : JSON.stringify(p));
  return <div className="agent-native-message"><pre>{String(text)}</pre><Completeness truncated={truncated} payload={p} onExpand={() => void load()} /></div>;
}
function NativeProcess({ item, onClose }: { item: TimelineItem; onClose(): void }) {
  const {payload:p,truncated,load}=useFullPayload(item);
  const taskId=useContext(TaskScope), archived=useContext(ArchivedScope);
  const [value, setValue] = useState<Awaited<ReturnType<typeof rpc.agentTasks.nativeHistory>> | null>(null);
  const [error, setError] = useState('');
  const epoch = useRef(0), reading = useRef(false), pendingRefresh = useRef(false);
  const read = async (before?: number) => {
    const mine = ++epoch.current; reading.current = true;
    try {
      const r = await rpc.agentTasks.nativeHistory(taskId, item.itemId, before);
      if (mine !== epoch.current) return;
      setValue(v => {
        const map = new Map((v?.items ?? []).map(i => [i.itemId, i]));
        for (const i of r.items) if (!map.has(i.itemId) || map.get(i.itemId)!.revision <= i.revision) map.set(i.itemId, i);
        return { ...r, hasMore: map.size < r.total, items: [...map.values()].sort((a,b) => a.ordinal - b.ordinal) };
      }); setError('');
    } catch (e) { if (mine === epoch.current) setError(rpcErrorMessage(e)); }
    finally { if (mine === epoch.current) { reading.current = false; if (pendingRefresh.current) { pendingRefresh.current = false; void read(); } } }
  };
  useEffect(() => {
    setValue(null); void read();
    const off = events.on(agentTaskEvent, e => { if (e.taskId === taskId) { if (reading.current) pendingRefresh.current = true; else void read(); } });
    return () => { ++epoch.current; pendingRefresh.current = false; off(); };
  }, [taskId, item.itemId]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (event.target instanceof Element && event.target.closest('dialog, [role="dialog"], [role="menu"]')) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const stateLabels: Record<string,string> = {running:'工作中',needs_attention:'需要你处理',completed:'已完成',interrupted:'已停止',failed:'失败'};
  const states = value?.states.length ? value.states : typeof p.status === 'string' ? [p.status] : [];
  const state = states.length ? states.map(status => stateLabels[status] ?? status).join('、') : '状态未知';
  const stopRunId = value?.stopRunId;
  return <section className="agent-native-process" aria-label="执行器原生子 Agent">
    <header><b><Network size={15}/> 执行器原生子 Agent</b><button type="button" aria-label="关闭过程" onClick={onClose}><X size={14}/></button></header>
    <div className="agent-native-process-body">
    <p>{p.input?.description ?? p.tool ?? p.name} · {state}</p>
    {p.prompt && <pre>{p.prompt}</pre>}
    {p.childLog?.length > 0 && <ol className="agent-native-steps">{p.childLog.map((line: string, i: number) => <li key={i}><Info size={13}/><pre>{line}</pre></li>)}</ol>}
    {p.childLogPreviewOnly && <small>以上为最近消息预览；完整记录如下。</small>}
    <div className="agent-native-messages">
      {error && <p role="alert">子消息读取失败：{error}<button type="button" onClick={() => void read()}>重试</button></p>}
      {value?.hasMore && <button type="button" className="agent-older" onClick={() => void read(value.nextOrdinal ?? undefined)}>加载更早的子消息</button>}
      {value?.items.map(item => <NativeMessage item={item} key={item.itemId} />)}
      {value && !value.items.length && <p>{value.partial ? '这份旧记录仅保留了子消息预览，没有可恢复的完整记录。' : '执行器尚未返回子消息。'}</p>}
    </div>
    {p.output && <pre>{String(p.output)}</pre>}
    <Completeness truncated={truncated} payload={p} onExpand={() => void load()} />
    </div>
    {!archived && stopRunId && <footer><button type="button" className="agent-stop agent-stop-run" onClick={() => void rpc.agentTasks.stop(taskId,false,stopRunId).then(onClose).catch(e=>toast.error(rpcErrorMessage(e)))}><CircleStop size={14}/>停止所属运行</button></footer>}
  </section>;
}

const WORK_ICONS: Record<string, typeof Brain> = {
  reasoning:Brain, command_execution:SquareTerminal, file_change:FilePenLine, file_search:FileSearch,
  web_search:Globe, tool_call:Wrench, subagent:Network,
};

function WorkItem({ it }: { it: TimelineItem }) {
  const { payload: p, truncated, load } = useFullPayload(it);
  const viewProcess = useContext(NativeProcessScope);
  const Icon = WORK_ICONS[it.type] ?? Info;
  return <details className={`agent-work-row ${p.status ?? ''}`}>
    <summary><Icon size={14}/><span>{workLabel({ ...it, payload: p })}</span></summary>
    {p.output ? <pre>{String(p.output)}</pre> : it.type === 'reasoning' ? <Markdown itemId={it.itemId} text={String(p.text ?? '')} /> : null}
    {it.type === 'subagent' && <button type="button" className="agent-older" onClick={() => viewProcess(it)}>查看过程</button>}
    <Completeness truncated={truncated} payload={p} onExpand={() => void load()} />
  </details>;
}

type WorkHeading = { text: string; tone: 'stop' | 'failed' };
type TurnWorkFold = { heading?: WorkHeading; open: boolean; toggle(): void };

function WorkHeadingLabel({ heading }: { heading: WorkHeading }) {
  const Icon = heading.tone === 'failed' ? CircleAlert : CircleStop;
  return <><Icon size={15} aria-hidden/>{heading.text}</>;
}

function WorkRow({ items, running, seconds, expanded, turnFold }: { items: TimelineItem[]; running: boolean; seconds: number; expanded: boolean; turnFold?: TurnWorkFold }) {
  const [choice, setChoice] = useState<boolean>();
  const open = turnFold?.open ?? choice ?? expanded;
  const heading = turnFold?.heading;
  const tone = heading?.tone === 'failed' ? ' agent-turn-failed' : '';
  return <div className="agent-work">
    {(!turnFold || heading) && <button type="button" className={`agent-work-head${tone}${!heading && running ? ' shine' : ''}`} aria-expanded={open} onClick={turnFold?.toggle ?? (() => setChoice(!open))}>
      {heading ? <WorkHeadingLabel heading={heading}/> : `${running ? '工作中' : '已工作'} ${formatDuration(seconds)}`}
      <ChevronRight size={13} className={open ? 'open' : ''} aria-hidden/>
    </button>}
    {open && <div className="agent-work-rows">{workSegments(items).map(segment => {
      if (segment.kind === 'single') return segment.item.type === 'assistant_message'
        ? <ItemRow key={segment.item.itemId} item={segment.item}/>
        : <WorkItem key={segment.item.itemId} it={segment.item}/>;
      const [first] = segment.items;
      if (segment.items.length === 1) return <WorkItem key={first.itemId} it={first}/>;
      return <details className="agent-work-row agent-work-group" key={first.itemId}>
        <summary><Wrench size={14} aria-hidden/><span>{summarizeTools(segment.items)}</span><ChevronRight size={13} aria-hidden/></summary>
        {segment.items.map(item => <WorkItem key={item.itemId} it={item}/>)}
      </details>;
    })}</div>}
  </div>;
}

function TurnRows({ group, stopping }: { group: TurnGroup; stopping: boolean }) {
  const [workOpen, setWorkOpen] = useState(true);
  const duration = formatDuration(group.seconds);
  let heading: WorkHeading | undefined;
  if (stopping) heading = { text:'正在停止…', tone:'stop' };
  else if (group.status === 'interrupted') heading = { text:`你在 ${duration}后停止了`, tone:'stop' };
  else if (group.failed) heading = { text:`工作 ${duration}后失败`, tone:'failed' };

  const firstWork = heading ? group.rows.findIndex(row => row.kind === 'work') : -1;
  const toggle = () => setWorkOpen(open => !open);
  const rows = group.rows.map((row, index) => {
    if (row.kind === 'item') return <ItemRow key={row.item.itemId} item={row.item}/>;
    if (row.kind === 'footer') return <div key={row.id} className={`agent-turn-footer${row.failed ? ' failed' : ''}`}>{row.label}</div>;
    return <WorkRow key={row.id} items={row.items} running={row.running} seconds={row.seconds}
      expanded={row.running || ['started','interrupted','failed'].includes(group.status ?? '')}
      turnFold={heading ? { heading:index === firstWork ? heading : undefined, open:workOpen, toggle } : undefined}/>;
  });
  if (heading && firstWork < 0) {
    const userRow = group.rows.findIndex(row => row.kind === 'item' && row.item.type === 'user_message');
    rows.splice(userRow + 1, 0, <div key="work-status" className={`agent-turn-start${heading.tone === 'failed' ? ' agent-turn-failed' : ''}`}>
      <WorkHeadingLabel heading={heading}/>
    </div>);
  }
  return <div className="agent-turn" data-turn-id={group.turnId ?? undefined} data-status={group.status ?? undefined}>
    {rows}
    {group.failed && !group.rows.some(row => row.kind === 'item' && row.item.type === 'error') && <div className="agent-error agent-error-details"><details>
      <summary><CircleAlert size={15} aria-hidden/>查看错误详情</summary><pre>{group.failureCode ?? '未提供错误详情'}</pre>
    </details></div>}
    {group.status === 'unknown' && <div className="agent-unknown-result" role="note"><TriangleAlert size={15} aria-hidden/><div>
      <b>接收未知</b><p>无法确认执行器是否收到这条输入。WillYou 不会自动重发。</p>
    </div></div>}
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
    const select = (q: typeof form.questions[number], label: string) => setAnswers(a => {
      const current = a[q.id] ?? [];
      return { ...a, [q.id]: !q.multi ? [label] : current.includes(label) ? current.filter(x => x !== label) : [...current, label] };
    });
    const confirm = () => { if (!missing && !busy) onSubmit(form.toResult(final())); };
    return <div className="agent-form" tabIndex={0} aria-label="回答 Agent 的问题" onKeyDown={e => {
      if (busy || e.nativeEvent.isComposing || e.keyCode === 229 || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement;
      if (target.matches('button, textarea, input:not([type=radio]):not([type=checkbox])')) return;
      if (e.key === 'Enter' && !missing) { e.preventDefault(); confirm(); return; }
      if (!/^[1-9]$/.test(e.key)) return;
      const index = target.closest<HTMLElement>('[data-question]')?.dataset.question;
      const question = index !== undefined ? form.questions[Number(index)] : form.questions.find(q => !final()[q.id]?.length) ?? form.questions.at(-1);
      const option = question?.options[Number(e.key) - 1];
      if (question && option) { e.preventDefault(); select(question, option.label); }
    }}>
      {form.questions.map((q, i) => <fieldset key={q.id} data-question={i} className="agent-form-q"><legend>{q.header ? `${q.header} · ` : ''}{q.question}</legend>
        {q.options.map((o, j) => { const on = (answers[q.id] ?? []).includes(o.label); return <label key={o.label} className={on ? 'on' : ''}>
          <input type={q.multi ? 'checkbox' : 'radio'} name={q.id} checked={on} disabled={busy} onChange={() => select(q, o.label)} />
          {j < 9 && <kbd aria-hidden>{j + 1}</kbd>}<span>{o.label}{o.description && <small>{o.description}</small>}</span></label>; })}
        {q.allowOther && <input className="agent-form-other" type={q.secret ? 'password' : 'text'} placeholder={q.options.length ? '其他（自己填写）' : '你的回答'} value={other[q.id] ?? ''} onChange={e => setOther(o => ({ ...o, [q.id]: e.target.value }))} />}
      </fieldset>)}
      <div className="agent-form-actions"><span className="agent-request-hint">数字键选择 · Enter 确认</span><button type="button" disabled={busy} onClick={() => onSubmit(form.decline())}>不回答</button><button type="button" className="primary" disabled={busy || missing} onClick={confirm}>提交回答</button></div>
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

function RequestPanel({ requests, more = 0, driverId, visiblePlans, cwd: taskCwd, mailSlot, onRespond, onStop }: { requests: TimelineRequest[]; more?: number; driverId: string; visiblePlans: ReadonlyMap<string,string>; cwd:string; mailSlot:HTMLDivElement | null; onRespond: (r: TimelineRequest, result: unknown) => Promise<void>; onStop: (r: TimelineRequest) => void }) {
  const [index, setIndex] = useState(0);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [selection, setSelection] = useState<{ request: string; option: string } | null>(null);
  const taskId = useContext(TaskScope);
  const panel = useRef<HTMLDivElement>(null);
  const shown = requests[Math.min(index, requests.length - 1)];
  const effectiveDriver = shown.driverId ?? driverId;
  // 过大的关键请求：先读完整内容再开放批准（复核 NR06）；读不全只能拒绝或停止。
  const [full, setFull] = useState<Record<string, TimelineRequest['payload'] | 'error'>>({});
  const reqKey = `${shown.requestId}:${shown.revision}`;
  useEffect(() => {
    if (!(shown as any).detailTruncated || full[reqKey]) return;
    void (async () => {
      try { const { value } = await readRange(off => rpc.agentTasks.requestBody(shown.ownerTaskId ?? taskId, shown.requestId, off, shown.revision)); setFull(f => ({ ...f, [reqKey]: value?.truncated ? 'error' : value })); }
      catch { setFull(f => ({ ...f, [reqKey]: 'error' })); }
    })();
  }, [reqKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const loaded = full[reqKey];
  const incomplete = !!(shown as any).detailTruncated && (loaded === undefined || loaded === 'error');
  const r = loaded && loaded !== 'error' ? { ...shown, payload: loaded } : shown;
  const form = incomplete ? null : requestForm(r, effectiveDriver);
  const nativeOptions = form ? [] : incomplete ? requestOptions(r, effectiveDriver).filter(o => o.deny) : requestOptions(r, effectiveDriver);
  const options = [...nativeOptions, ...(r.ownerTaskId && !form ? [{ key: 'open-child', label: '打开子任务查看', result: () => null, deny: false }] : [])];
  const selected = selection?.request === reqKey ? options.find(o => o.key === selection.option) : undefined;
  const hostBusiness = r.kind === 'host_business';
  const isMail = hostBusiness && r.payload.businessKind === 'mail_send';
  const isBrowser = hostBusiness && r.payload.businessKind === 'browser_access';
  const phase = r.payload.phase;
  const review = isMail && phase === 'waiting_user' && r.payload.review?.content ? r.payload.review as MailSendReview : undefined;
  const unknownExecutions = review?.priorUnknownExecutionIds ?? [];
  const [mailDisplay, setMailDisplay] = useState<{key:string; state:'ready' | 'error'}>();
  const [mailDraft, setMailDraft] = useState<{key:string; edits:MailEdits}>();
  const [checkedUnknown, setCheckedUnknown] = useState<string | null>(null);
  const unknownConfirmed = checkedUnknown === reqKey;
  const edits = mailDraft?.key === reqKey ? mailDraft.edits : null;
  const mailState = mailDisplay?.key === reqKey ? mailDisplay.state : 'loading';
  const currentRequest = useRef(reqKey);
  currentRequest.current = reqKey;
  const readReview = () => rpc.agentTasks.businessReview(r.ownerTaskId ?? taskId, r.requestId, r.revision);
  useEffect(() => {
    let active = true;
    if (review && !incomplete) void readReview().then(() => {
      if (active) setMailDisplay({ key:reqKey, state:'ready' });
    }).catch(error => {
      if (active) {
        setMailDisplay({ key:reqKey, state:'error' });
        toast.error(rpcErrorMessage(error));
      }
    });
    return () => { active = false; };
  }, [reqKey, Boolean(review), incomplete]);
  const hostStatus = phase === 'queued_for_slot' ? '已批准，正在等待宿主放行。你可以撤销本次批准。'
    : phase === 'approved_pending_bind' ? '已批准，待新运行登记后重新核对并绑定；目前尚无可用权限。'
    : phase === 'executing' ? '业务正在执行，结果以业务回执为准。'
    : undefined;
  const head = hostBusiness ? {
    title: isBrowser ? `需要授权：访问${r.targetTaskTitle ? `任务「${r.targetTaskTitle}」` : '另一任务'}的网页` : r.payload.title ?? '宿主业务请求',
    detail: !isMail && !isBrowser ? hostStatus ?? JSON.stringify(r.payload.review, null, 2) : undefined,
  } : requestTitle(r);

  useEffect(() => {
    (panel.current?.querySelector<HTMLElement>('[aria-label="回答 Agent 的问题"]') ?? panel.current)?.focus();
  }, [reqKey, incomplete]);
  const send = async (result: unknown) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const response = typeof result === 'function' ? await result() : result;
      if (currentRequest.current !== reqKey) return;
      await onRespond(r, response);
      if (!isMail || (response as {choice?: string} | null)?.choice !== 'edit') setIndex(0);
      setSelection(null);
    } catch (e) { toast.error(rpcErrorMessage(e)); }
    finally { submitting.current = false; setBusy(false); }
  };
  const canReviewMail = !!review && !!mailSlot && mailState === 'ready';
  const disabled = (key: string) => (busy && key !== 'revoke')
    || isMail && key === 'edit' && (!canReviewMail || !!edits)
    || isMail && key === 'allow' && (!canReviewMail || !!edits || (unknownExecutions.length > 0 && !unknownConfirmed));
  const choose = () => {
    const o = selected; if (!o || disabled(o.key)) return;
    if (o.key === 'open-child' && r.ownerTaskId) { openRelatedTask(taskId, r.ownerTaskId, false); return; }
    const why = reason[r.requestId] ?? '';
    if (o.key === 'revoke') { void onRespond(r, o.result(why)).catch(e => toast.error(rpcErrorMessage(e))); return; }
    if (isMail && o.key === 'edit' && review) { setMailDraft({ key:reqKey, edits:mailEdits(review.content) }); return; }
    if (isMail && o.key === 'agentedit') {
      if (!why.trim()) { toast.warning('请先写邮件修改要求'); return; }
      void send({ choice:'agentedit', instructions:why }); return;
    }
    if (isMail && o.key === 'allow' && review) {
      void send(async () => {
        const display = await readReview() as { displayReceiptId?: string };
        if (!display?.displayReceiptId) throw new Error('无法确认当前邮件的审阅回执');
        return { choice:'allow', displayReceiptId:display.displayReceiptId, reviewedUnknownExecutionIds:unknownConfirmed ? unknownExecutions : [] };
      });
      return;
    }
    if (o.key === 'revise' && !why.trim()) { toast.warning('先在下方写修改意见'); return; }
    void send(o.result(why));
  };
  // 数字键只选中，Enter 确认（复核 CR10）；只在面板内生效，输入框里与组合输入时不处理。
  const onKey = (e: React.KeyboardEvent) => {
    if (!panel.current?.contains(e.target as Node)) return;
    const tag = (e.target as HTMLElement).tagName;
    if (e.nativeEvent.isComposing || e.keyCode === 229 || e.altKey || e.ctrlKey || e.metaKey || ['TEXTAREA','INPUT','SELECT'].includes(tag) || form) return;
    const option = /^[1-9]$/.test(e.key) ? options[Number(e.key) - 1] : undefined;
    if (option && !disabled(option.key)) { e.preventDefault(); setSelection({ request: reqKey, option: option.key }); return; }
    if (e.key === 'Enter' && selected && (tag !== 'BUTTON' || (e.target as HTMLElement).role === 'option')) { e.preventDefault(); choose(); }
  };
  const cwd = r.payload.params?.cwd ?? r.payload.input?.cwd ?? (!r.ownerTaskId && ['command_approval','file_approval'].includes(r.kind) ? taskCwd : undefined);
  const optionNote = (key: string, deny: boolean | undefined) => {
    const native = key.split(':').at(-1);
    if (key === 'open-child') return '查看子任务的上下文，当前请求继续等待';
    if (key === 'revoke') return '取消此前的批准';
    if (isBrowser && key === 'observe') return '只读，可查看页面、截图和读取内容';
    if (isBrowser && key === 'control') return '可点击、输入和执行页面脚本';
    if (isMail && key === 'edit') return '在上方卡片修改收件人、主题或正文';
    if (isMail && key === 'agentedit') return '在下方填写要求，Agent 修改后会重新请你批准';
    if (isMail && deny) return '邮件不会发送';
    if (key === 'revise') return '把填写的修改意见交回 Agent';
    if (deny) return '拒绝当前请求';
    if (native === 'acceptForSession' || key === 'session') return '当前原生会话中同类操作无需再次批准';
    if (key === 'turn') return '授权范围为当前这一轮';
    if (['once', 'accept'].includes(native ?? '')) return '仅批准这次请求';
    if (key === 'approve') return '按时间线中的计划开始执行';
    return undefined;
  };
  return <div className="agent-request" role="dialog" aria-label="待处理请求" tabIndex={-1} ref={panel} onKeyDown={onKey}>
    <div className="agent-request-head"><b>{head.title}</b>{r.ownerTaskId && <small>来自子任务 · {r.ownerName}</small>}{r.origin.nodeId && <small>来自执行器原生子 Agent</small>}{requests.length > 1 && <span className="agent-request-nav"><button type="button" onClick={() => setIndex(i => (i - 1 + requests.length) % requests.length)}>‹</button>{Math.min(index + 1, requests.length)}/{requests.length}<button type="button" onClick={() => setIndex(i => (i + 1) % requests.length)}>›</button></span>}{more > 0 && <small className="agent-request-more">另有 {more} 个请求，处理完前面的会继续显示</small>}</div>
    {incomplete && <div className="agent-limited">{loaded === 'error' ? '请求内容过大或读取失败，只能拒绝或停止' : '正在读取完整内容，读完后才能批准…'}</div>}
    {!form && head.detail && (r.kind !== 'plan_approval' || r.ownerTaskId || !r.origin.turnId || visiblePlans.get(r.origin.turnId) !== head.detail) && <pre className="agent-request-detail">{head.detail}</pre>}
    {(isMail || isBrowser) && hostStatus && <p className="agent-business-status" role="status">{hostStatus}</p>}
    {isBrowser && !incomplete && <BrowserAccessReview pages={r.payload.review?.pages} waitingForUser={phase === 'waiting_user'} />}
    {review && mailSlot && createPortal(<MailReviewCard key={reqKey} review={review} state={mailState} edits={edits} busy={busy} unknownConfirmed={unknownConfirmed}
      onField={(field, value) => setMailDraft(draft => draft?.key === reqKey ? { ...draft, edits:{ ...draft.edits, [field]:value } } : draft)}
      onUnknown={checked => setCheckedUnknown(checked ? reqKey : null)}
      onCancel={() => { setMailDraft(undefined); panel.current?.focus(); }}
      onSave={value => void send({ choice:'edit', edits:value })}/>, mailSlot)}
    {review && <p className="agent-business-status">{edits ? '正在编辑邮件，保存修改并重新审阅后才能批准。' : '邮件内容见上方卡片。'}</p>}
    {typeof cwd === 'string' && cwd && <small className="agent-request-cwd">工作目录 · <code>{cwd}</code></small>}
    {form ? <RequestFormView key={reqKey} form={form} busy={busy} onSubmit={result => void send(result)} /> : <>
      <div className="agent-request-options" role="listbox">{options.map((o, i) => <button key={o.key} type="button" role="option" aria-label={o.label} aria-selected={selected?.key === o.key} disabled={disabled(o.key)} className={`${o.deny ? 'deny' : ''}${selected?.key === o.key ? ' on' : ''}${o.key === 'open-child' ? ' agent-child-request-link' : ''}`} onClick={() => setSelection({ request: reqKey, option: o.key })}><kbd>{i + 1}</kbd><span>{o.label}{optionNote(o.key, o.deny) && <small>{optionNote(o.key, o.deny)}</small>}</span></button>)}</div>
      <textarea className="agent-request-reason" placeholder="可写原因或意见（可选）" value={reason[r.requestId] ?? ''} onChange={e => setReason(s => ({ ...s, [r.requestId]: e.target.value }))} rows={2} />
    </>}
    <div className="agent-request-foot">
      {!form && options.length > 0 && <span className="agent-request-hint">数字键选择 · Enter 确认</span>}
      <button type="button" className="agent-stop agent-stop-run" onClick={() => onStop(r)}><CircleStop size={14} />{r.origin.nodeId ? '停止所属运行' : r.ownerTaskId ? '停止子任务本轮' : '停止'}</button>
      {!form && options.length > 0 && <button type="button" className="agent-confirm-choice" disabled={!selected || disabled(selected.key)} onClick={choose}>确认</button>}
    </div>
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

export const AgentTaskView=observer(function AgentTaskView({ taskId }: { taskId: string }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [mailSlot, setMailSlot] = useState<HTMLDivElement | null>(null);
  const [relations, setRelations] = useState<Relations | null>(null);
  const [parentRelations, setParentRelations] = useState<Relations | null>(null);
  const [nativeProcess, setNativeProcess] = useState<TimelineItem | null>(null);
  const [childRequests, setChildRequests] = useState<TimelineRequest[]>([]);
  const [childRequestsMore, setChildRequestsMore] = useState(0);
  const loadRelations = useCallback(() => {
    void rpc.agentTasks.relations?.(taskId)?.then(async value=>{
      setRelations(value);
      setParentRelations(value.parentTaskId ? await rpc.agentTasks.relations(value.parentTaskId) : null);
    }).catch(() => {});
    void rpc.agentTasks.treeRequests?.(taskId)?.then(v => { setChildRequests(v.requests as TimelineRequest[]); setChildRequestsMore(v.more); }).catch(() => {});
  }, [taskId]);
  const [plugins,setPlugins]=useState<{id:string;name:string}[]>([]),[pluginsOpen,setPluginsOpen]=useState(false);
  useEffect(()=>{let alive=true;const load=()=>void rpc.agentTasks.plugins?.(taskId)?.then(v=>{if(alive)setPlugins(v);}).catch(()=>{});load();const off=events.on(applicationsChangedEvent,load);return()=>{alive=false;off();};},[taskId]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [text, setText] = useState('');
  const [chips, setChips] = useState<Chip[]>([]);
  const removedWhilePreparing = useRef(new Set<string>());
  const [sending, setSending] = useState(false);
  const [queueEdit, setQueueEdit] = useState<{taskId:string; turnId:string; version:string; text:string}>();
  const [action, setAction] = useState<string | null>(null);
  const actionRef = useRef(false);
  const actionInputs = useRef(new Map<string, string>());
  const sendingRef = useRef(false);
  const pendingInput = useRef<{ text: string; chips: string; clientInputId: string } | null>(null);
  const [live, setLive] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  const permissionPref = useAppSettingsKey('agentPermissions');
  const [confirmFull, setConfirmFull] = useState(false);
  const panels=panelsFor({kind:'task',taskId}),terminalOpen=panels.drawer,setTerminalOpen=(value:boolean|((v:boolean)=>boolean))=>{panels.drawer=typeof value==='function'?value(panels.drawer):value;};const[moreMenu,setMoreMenu]=useState(false);
  const [trigger, setTrigger] = useState<MenuTrigger | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [fileHits, setFileHits] = useState<string[]>([]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const modelSelect = useRef<HTMLButtonElement>(null);
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
  const [draftConflict, setDraftConflict] = useState<number | null>(null);
  const [confirmOtherDraft, setConfirmOtherDraft] = useState(false);
  const [resolvingDraft, setResolvingDraft] = useState(false);
  const conflictRevision = useRef<number | null>(null);
  const draftWrite = useRef<Promise<boolean> | null>(null);
  const localDraftVersion = useRef(0);
  const draftDirty = useRef(false);

  // 首份被采纳的快照完成一次草稿初始化（不论它来自初始化还是事件补拉）；本地已编辑则保留本地内容（复核 FR05）。
  const draftInit = useRef(false);
  const [draftReady, setDraftReady] = useState(false);
  const adoptDraft = useCallback(async (s: Snapshot) => {
    if (draftInit.current || s.archivedAt) return;
    draftInit.current = true;
    draftRev.current = s.draft?.revision ?? 0;
    try {
      if (editedRef.current || !s.draft) return;
      // 旧版本截断写入的草稿已无法还原：明确提示，不当作空草稿静默加载（复核 SR02）。
      if ('damaged' in s.draft && s.draft.damaged) { toast.warning('上次保存的草稿不完整（旧版本超长截断），已无法恢复'); return; }
      let draft = s.draft.draft as any;
      let bodyRevision: number | undefined;
      if ((s.draft as any).truncated) { try { const r = await readRange((off, rev) => rpc.agentTasks.draftBody(taskId, off, rev)); draft = r.value; bodyRevision = r.revision; } catch (e) { toast.error(`草稿读取失败：${rpcErrorMessage(e)}`); return; } }
      // 兜底：读到的仍是旧版本的截断记录（只剩前缀与摘要），同样提示无法恢复，不当作空草稿。
      if (draft && draft.truncated === true && typeof draft.sha256 === 'string') { toast.warning('上次保存的草稿不完整（旧版本超长截断），已无法恢复'); return; }
      // 读取期间已开始编辑：保留本地内容，修订仍按快照比较，真实冲突交给 CAS（复核 T01）。
      if (editedRef.current) return;
      // 采纳正文的同时采纳它实际所属的修订，首次保存才不会带着旧修订被拒（复核 T01）。
      if (bodyRevision !== undefined) draftRev.current = bodyRevision;
      setText(String(draft?.text ?? ''));
      const saved = (draft?.attachments ?? []) as PreparedAttachment[];
      setChips(saved.map(a => ({ localId: a.id, name: a.name, status: 'ready', data: a })));
    } finally { setDraftReady(true); }
  }, [taskId]);

  const reload = useCallback(async () => {
    try {
      const s = await rpc.agentTasks.snapshot(taskId);
      // 旧请求晚到的快照不覆盖新水位。
      if (s.seq < seqRef.current) return;
      seqRef.current = s.seq;
      setSnap(s);
      setLive({});
      void adoptDraft(s); loadRelations();
    } catch (e) { toast.error(rpcErrorMessage(e)); }
  }, [taskId, adoptDraft, loadRelations]);

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
      void adoptDraft(s); loadRelations();
    })();
    void rpc.agentTasks.profiles().then(p => alive && setProfiles(p)).catch(() => {});
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; offEvent(); offLive(); clearInterval(tick); window.removeEventListener('focus', onVisible); document.removeEventListener('visibilitychange', onVisible); if (reloadTimer.current) clearTimeout(reloadTimer.current); };
  }, [taskId, reload, adoptDraft, loadRelations]);

  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [snap?.seq, Object.keys(live).length, relations?.childrenTotal, childRequests.length]);

  const chipsRef = useRef<Chip[]>([]); chipsRef.current = chips;
  const textRef = useRef(''); textRef.current = text;
  const editedRef = useRef(false);
  const draftError = useRef<string | null>(null);
  const updateDraftConflict = (revision: number | null) => {
    conflictRevision.current = revision;
    setDraftConflict(revision);
  };
  const scheduleDraftSave = () => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = null;
    if (conflictRevision.current !== null) return;
    draftTimer.current = setTimeout(() => {
      draftTimer.current = null;
      void persistDraft();
    }, 400);
  };
  const persistDraft = async (chooseLocalAt: number | null = null): Promise<boolean> => {
    while (draftWrite.current) await draftWrite.current;
    if (conflictRevision.current !== chooseLocalAt) return false;
    if (!draftDirty.current) return true;
    const version = localDraftVersion.current;
    const value = textRef.current;
    const write = (async () => {
      const attachments = chipsRef.current.filter(c => c.status === 'ready' && c.data).map(c => c.data!);
      try {
        const r = await rpc.agentTasks.saveDraft(taskId, { text: value, attachments }, chooseLocalAt ?? draftRev.current);
        draftError.current = null;
        if (!r.ok) { updateDraftConflict(r.revision); return false; }
        draftRev.current = r.revision;
        updateDraftConflict(null);
        draftDirty.current = version !== localDraftVersion.current;
        if (draftDirty.current) scheduleDraftSave();
        return true;
      } catch (e) {
        const message = rpcErrorMessage(e);
        if (draftError.current !== message) { draftError.current = message; toast.error(`草稿未保存：${message}`); }
        return false;
      }
    })();
    draftWrite.current = write;
    try { return await write; }
    finally { if (draftWrite.current === write) draftWrite.current = null; }
  };
  const saveDraft = (value: string) => {
    editedRef.current = true;
    textRef.current = value;
    localDraftVersion.current++;
    draftDirty.current = true;
    scheduleDraftSave();
  };
  useEffect(() => () => {
    if (!draftTimer.current) return;
    clearTimeout(draftTimer.current);
    draftTimer.current = null;
    void persistDraft();
  }, [taskId]);
  const resolveDraft = async (useOther: boolean) => {
    const revision = conflictRevision.current;
    if (revision === null || resolvingDraft || sendingRef.current) return;
    setResolvingDraft(true);
    try {
      if (!useOther) {
        await persistDraft(revision);
        return;
      }
      const version = localDraftVersion.current, currentChips = chipsRef.current;
      const draft = await readRange(offset => rpc.agentTasks.draftBody(taskId, offset, revision));
      if (draft.revision !== revision) throw new Error('草稿已更新，请重新读取');
      if (version !== localDraftVersion.current || currentChips !== chipsRef.current || conflictRevision.current !== revision || sendingRef.current) {
        toast.warning('本地草稿在读取期间有修改，请重新确认');
        return;
      }
      if (draft.value?.truncated) throw new Error('另一份草稿不完整');
      const nextText = String(draft.value?.text ?? '');
      const attachments: PreparedAttachment[] = draft.value?.attachments ?? [];
      const nextChips: Chip[] = attachments.map(a => ({ localId:a.id, name:a.name, status:'ready', data:a }));
      for (const chip of currentChips) {
        if (chip.status === 'preparing') removedWhilePreparing.current.add(chip.localId);
        if (chip.preview) URL.revokeObjectURL(chip.preview);
      }
      textRef.current = nextText; setText(nextText);
      chipsRef.current = nextChips; setChips(nextChips);
      draftRev.current = revision;
      draftDirty.current = false;
      updateDraftConflict(null);
    } catch (e) {
      const message = rpcErrorMessage(e);
      if (/已更新/.test(message)) {
        const latest = await rpc.agentTasks.snapshot(taskId).catch(() => null);
        const latestRevision = latest?.draft?.revision;
        if (latestRevision !== undefined && conflictRevision.current === revision) updateDraftConflict(latestRevision);
      }
      toast.error(`没有替换当前草稿：${message}`);
    } finally {
      setConfirmOtherDraft(false);
      setResolvingDraft(false);
    }
  };

  const insertDraftRef=useRef<(value:string)=>void>(()=>{});
  insertDraftRef.current=value=>{const start=textarea.current?.selectionStart??textRef.current.length,end=textarea.current?.selectionEnd??start,next=textRef.current.slice(0,start)+value+textRef.current.slice(end);textRef.current=next;setText(next);saveDraft(next);requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(start+value.length,start+value.length);});};
  useEffect(() => {
    if (snap) navigation.setAgentTaskReadOnly(taskId,!!snap.archivedAt);
  }, [taskId,snap?.archivedAt]);
  const requests = [...(snap?.requests ?? []) as TimelineRequest[], ...childRequests].filter(r => r.status === 'pending' || r.status === 'approved_pending_bind');
  const composerReady = draftReady && snap?.taskId === taskId && !snap.archivedAt && !navigation.agentTaskReadOnly && !requests.length;
  const composerProject = snap?.projectId ?? null;
  useEffect(()=>{
    if (!composerReady) return;
    const target={taskId,projectId:composerProject,insert:(value:string)=>insertDraftRef.current(value),focus:()=>textarea.current?.focus(),attachFile:async(file:import('@shared/files').FileDocument,baseHash:string,signal:AbortSignal)=>{
      const original=await rpc.files.read(file.ref);signal.throwIfAborted();if(agentComposerTargets.current!==target)throw Error('目标任务已经切换');if(original.document.revision.hash!==baseHash)throw Error('图片内容已变化，请重新打开后附加');
      const data=await rpc.agentTasks.prepareAttachment(taskId,null,{name:file.name,mime:file.content?.kind==='image'?file.content.mime:undefined,dataBase64:original.base64});signal.throwIfAborted();if(agentComposerTargets.current!==target)throw Error('目标任务已经切换');editedRef.current=true;setChips(value=>[...value,{localId:data.id,name:data.name,status:'ready',data}]);saveDraft(textRef.current);
    }};return agentComposerTargets.register(target);
  },[taskId,composerProject,composerReady]);

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
  const turns = [...olderTurns, ...snap.turns] as TurnInfo[];
  const turnById = new Map(turns.map(t => [t.turn_id, t]));
  const items = [...older, ...(snap.items as TimelineItem[])];
  const coveredChildren = new Set(relations?.children.map(child => child.childTaskId));
  const groups = buildTimeline(items.filter(it => {
    if (it.type === 'user_message' && it.turnId && turnById.get(it.turnId)?.status === 'accepted') return false;
    return it.type !== 'subtask' || !coveredChildren.has(it.payload?.childTaskId);
  }), turns, now);
  const visiblePlans = new Map<string,string>(items.filter(it => it.type === 'proposed_plan' && !it.payload?.truncated && !isIncomplete(it.payload) && it.turnId).map(it => [it.turnId!, it.payload.plan]));
  const hasOlder = olderMore ?? snap.hasOlder;
  const loadOlder = async () => {
    const first = older[0] ?? (snap.items as TimelineItem[])[0]; if (!first) return;
    try { const page = await rpc.agentTasks.history(taskId, first.ordinal); setOlder(o => [...(page.items as TimelineItem[]), ...o]); setOlderTurns(t => [...page.turns, ...t]); setOlderMore(page.hasOlder); } catch (e) { toast.error(rpcErrorMessage(e)); }
  };
  const working = snap.status === 'working' || snap.status === 'waiting';
  const stopping = snap.stopping;
  const stopElapsed = stopping ? Math.max(0, Math.floor((now - stopping.requestedAt) / 1000)) : 0;
  const canForceStop = stopping && !stopping.closing && now >= stopping.forceAt;
  const recentTurn = [...snap.turns as TurnInfo[]].reverse().find(t => ['dispatching','started'].includes(t.status));
  const waitingForWork = working && snap.status === 'working' && !stopping &&
    recentTurn && ['dispatching','started'].includes(recentTurn.status) &&
    !snap.items.some(item => item.turnId === recentTurn.turn_id && item.type !== 'user_message');
  const liveText = Object.values(live).join('');

  const addFiles = (files: File[]) => {
    for (const file of files) {
      const localId = crypto.randomUUID();
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      editedRef.current = true;
      setChips(cs => [...cs, { localId, name: file.name || '粘贴的图片', status: 'preparing', preview, file }]);
      void prepareChip(file, f => rpc.agentTasks.prepareAttachment(taskId, null, f))
        .then(data => {
          if (removedWhilePreparing.current.delete(localId)) {
            if (data.storedPath) void rpc.agentTasks.discardAttachment(taskId,data).catch(e=>toast.error(rpcErrorMessage(e)));
            return;
          }
          setChips(cs=>cs.map(c=>c.localId===localId?{...c,status:'ready',data,name:data.name}:c));
          setTimeout(()=>saveDraft(textRef.current),0);
        })
        .catch(e=>{
          if (!removedWhilePreparing.current.delete(localId)) setChips(cs=>cs.map(c=>c.localId===localId?{...c,status:'failed',error:rpcErrorMessage(e)}:c));
        });
    }
  };
  const retryChip = (localId: string) => {
    const chip = chips.find(c => c.localId === localId); if (!chip?.file) { toast.warning('原文件已不可用，请重新粘贴'); return; }
    setChips(cs => cs.filter(c => c.localId !== localId)); addFiles([chip.file]);
  };
  const removeChip = (localId: string) => {
    const chip=chipsRef.current.find(item=>item.localId===localId);
    if(chip?.status==='preparing')removedWhilePreparing.current.add(localId);
    if(chip?.preview)URL.revokeObjectURL(chip.preview);
    if(chip?.data?.storedPath)void rpc.agentTasks.discardAttachment(taskId,chip.data).catch(e=>toast.error(rpcErrorMessage(e)));
    setChips(cs=>cs.filter(c=>c.localId!==localId));
    setTimeout(()=>saveDraft(textRef.current),0);
  };

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
  const restore = async () => {
    try {
      await rpc.agentTasks.unarchive(taskId);
      await agentTasksStore.refresh();
      navigation.openAgentTask(taskId);
      await reload();
    } catch(e) { toast.error(rpcErrorMessage(e)); }
  };
  const archive = async () => {
    try {
      if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null; }
      if (!await persistDraft() || draftDirty.current) throw Error('当前草稿还未保存，请处理后再归档');
      await rpc.agentTasks.archive(taskId);
      await agentTasksStore.refresh();
      navigation.newTask(snap.projectId ?? undefined);
      toast.success('已归档', { action: { label: '撤销', onClick: () => void restore() } });
    } catch (e) { toast.error(rpcErrorMessage(e)); }
  };
  const stop = async () => { try { await rpc.agentTasks.stop(taskId); } catch (e) { toast.error(rpcErrorMessage(e)); } };
  const actOnInput = async (name: string, callback: () => Promise<unknown>) => {
    if (actionRef.current) return;
    actionRef.current = true; setAction(name);
    try { await callback(); await reload(); }
    catch (e) { toast.error(rpcErrorMessage(e)); void reload(); }
    finally { actionRef.current = false; setAction(null); }
  };
  const followUp = (key: string, value: string) => void actOnInput(key, async () => {
    const clientInputId = actionInputs.current.get(key) ?? newClientInputId();
    actionInputs.current.set(key, clientInputId);
    await rpc.agentTasks.submit(taskId, { clientInputId, text: value, expectedSelectionRevision: snap.selectionRevision });
  });
  const readInput = (turnId: string, version: string | null) => readRange(off => rpc.agentTasks.readUserInput(taskId, turnId, off, version));
  const activeEdit = queueEdit?.taskId === taskId ? queueEdit : undefined;
  const lastLimit = [...snap.items].reverse().find(i => i.type === 'error' && i.payload?.limited);
  const timelineActions: TimelineActions = {
    busy: !!action,
    unsent: turnId => {
      const t = turnId && turnById.get(turnId);
      return !!t && t.source_kind === 'user' && t.status === 'failed' && !t.native_turn_id && !t.started_at && (!t.run_id || t.error_code === 'REJECTED');
    },
    retry: turnId => void actOnInput('retry:' + turnId, () => rpc.agentTasks.retryFailedInput(taskId, turnId, snap.selectionRevision)),
    restore: turnId => void actOnInput('restore:' + turnId, async () => {
      if (sendingRef.current || textRef.current || chipsRef.current.length) { toast.warning('请先处理输入框里的草稿'); return; }
      const { value } = await readInput(turnId, null);
      if (sendingRef.current || textRef.current || chipsRef.current.length) { toast.warning('请先处理输入框里的草稿'); return; }
      const restored: Chip[] = value.attachments.map((attachment: PreparedAttachment) => ({ localId: attachment.id, data: attachment, name: attachment.name, status: 'ready' }));
      textRef.current = value.text; setText(value.text);
      chipsRef.current = restored; setChips(restored);
      saveDraft(value.text); textarea.current?.focus();
    }),
    continuation: itemId => !snap.archivedAt && !stopping && !working && !requests.length && lastLimit?.itemId === itemId && turns.at(-1)?.turn_id === lastLimit.turnId
      ? () => followUp('continue:' + itemId, '继续') : undefined,
  };
  const setSelection = async (patch: { tier?: string; model?: string | null; effort?: string | null; carryExtensions?: boolean }) => {
    try { const r = await rpc.agentTasks.setSelection(taskId, patch as never, snap.selectionRevision); if (!r.ok) toast.warning('设置已在别处变更，已刷新'); void reload(); }
    catch (e) { toast.error(rpcErrorMessage(e)); }
  };

  const archived = !!snap.archivedAt;
  const parentId=relations?.parentTaskId ?? taskId;
  const family=relations?.parentTaskId ? parentRelations : relations;
  const lineage=panelsFor({kind:'task',taskId:parentId});
  const showLineage=!!family?.childrenTotal && lineage.lineage;
  const openNativeProcess = (item: TimelineItem) => {
    lineage.setLineage(false);
    setNativeProcess(item);
  };
  const lineageToggle=family?.childrenTotal ? <button type="button" className="agent-head-btn agent-lineage-toggle" aria-expanded={lineage.lineage}
    onClick={()=>{if(!lineage.lineage)setNativeProcess(null);lineage.setLineage(!lineage.lineage);}}><Network size={14}/>任务关系 · {family.childrenTotal}</button> : null;
  const activeProcess=nativeProcess && (snap.items.find(item=>item.itemId===nativeProcess.itemId) ?? nativeProcess);

  return <RelationsScope.Provider value={relations}><ArchivedScope.Provider value={archived}><RunInTerminal.Provider value={archived ? null : code=>{setTerminalOpen(true);void rpc.agentTasks.pasteToTerminal(taskId,code).then(()=>toast.message('已送入终端输入行，按回车执行')).catch(e=>toast.error(rpcErrorMessage(e)));}}><TaskScope.Provider value={taskId}><section className="agent-task-view agent-task-layout" aria-label="统一任务区"><NativeProcessScope.Provider value={openNativeProcess}><div className="agent-task-main">
    {archived ? <header className="agent-task-head"><h1>{snap.title}</h1><span className="agent-status">已归档 · 只读</span><span className="push"/>{lineageToggle}<button type="button" className="agent-head-btn" onClick={()=>void restore()}>恢复</button><button type="button" className="agent-head-btn" title="打开差异面板" onClick={()=>panels.open('diff')}><PanelRight size={15}/></button></header> :
    <header className="agent-task-head"><h1>{snap.title}</h1>{(stopping || STATUS_LABEL[snap.status]) && <span className={`agent-status ${snap.status}`}>{stopping ? '正在停止…' : STATUS_LABEL[snap.status]}</span>}<span className="push" />{lineageToggle}<button type="button" className="agent-head-btn agent-plugin-btn" title="项目插件" onClick={()=>setPluginsOpen(true)}><Plug size={15}/>插件 {plugins.length}</button><button type="button" className="agent-head-btn" title="更多" aria-expanded={moreMenu} onClick={()=>setMoreMenu(v=>!v)}><MoreHorizontal size={16}/></button><button type="button" className="agent-head-btn" title="打开右侧面板" onClick={()=>navigation.toggleFilePanel()}><PanelRight size={15}/></button>{moreMenu&&<div className="agent-head-menu"><button type="button" data-testid="agent-terminal-toggle" onClick={()=>{panels.terminalDrawer();setMoreMenu(false);}}>底部终端</button><button type="button" data-testid="agent-archive" onClick={()=>{setMoreMenu(false);void archive();}}>归档任务</button></div>}</header>}
    <AgentRelations taskId={taskId} value={relations} readOnly={archived} reload={() => { loadRelations(); void reload(); }} />
    <div className="agent-scroll" ref={scroller}><div className="agent-timeline"><TimelineActionScope.Provider value={timelineActions}>
      {hasOlder && <button type="button" className="agent-older" onClick={() => void loadOlder()}>加载更早的记录</button>}
      {groups.map(group => <TurnRows key={group.key} group={group} stopping={!!stopping && !!group.turnId && group.turnId === recentTurn?.turn_id}/>)}
      {!archived && waitingForWork && !liveText && <div className="agent-starting" role="status"><div className="agent-work-head shine"><Clock3 size={14}/>工作中 {formatDuration(turnSeconds(recentTurn, now))}</div><div><Brain size={14}/>思考中</div></div>}
      {working && liveText && <div className="agent-assistant streaming"><Markdown text={liveText} /></div>}
      {!!relations?.childrenTotal && <AgentChildSummary taskId={taskId} value={relations} readOnly={archived} reload={() => void reload()} />}
      {!archived && snap.goal && <GoalRow goal={snap.goal} driverId={snap.selection.driverId} onOp={op => void goalOp(op)} />}
      {!archived && snap.goalPending && <div className="agent-goal pending" data-testid="agent-goal-pending"><Target size={14} /><div className="agent-goal-body"><b>{snap.goalPending.kind === 'set' ? snap.goalPending.objective : '清除目标'}</b><small>已发给执行器，等待确认</small></div></div>}
      {snap.selection.pendingSwitch && <div className="agent-limited">本轮和已有排队输入结束后切换到 {profiles.find(p => p.profileId === snap.selection.pendingSwitch?.profileId)?.name ?? snap.selection.pendingSwitch.profileId}</div>}
      {snap.switching && <div className="agent-limited">正在切换执行器，等待原运行退出…</div>}
      <div ref={setMailSlot} className="agent-mail-slot"/>
    </TimelineActionScope.Provider></div></div>
    <div className="agent-bottom">
      {!archived && draftConflict !== null && <div className="agent-limit-card agent-draft-conflict" role="alert">
        <TriangleAlert size={16} aria-hidden/><div><b>草稿已在别处更新</b><small>当前文字和附件仍保留在输入框，请选择要保留的草稿。</small></div>
        <button type="button" className="agent-inline-action" disabled={resolvingDraft || sending} onClick={() => setConfirmOtherDraft(true)}>用另一份</button>
        <button type="button" className="agent-inline-action" disabled={resolvingDraft || sending} onClick={() => void resolveDraft(false)}>保留当前</button>
      </div>}
      {!archived && stopping && <div className={`agent-stop-banner${canForceStop ? ' unresponsive' : ''}`}>
        {canForceStop ? <TriangleAlert size={14} aria-hidden /> : <CircleStop size={14} aria-hidden />}
        <div role="status"><b>{stopping.closing ? '正在关闭执行器，等待退出…' : canForceStop ? 'Agent 未响应停止' : '正在停止…'}</b>
          <span className="elapsed">（已等待 {stopElapsed} 秒）</span>
          {canForceStop && ' · 可能内存不足，强制停止会结束它的进程'}
        </div>
        {canForceStop && <button type="button" className="agent-force-stop" onClick={() => void rpc.agentTasks.forceStop(taskId, stopping.runId, stopping.requestedAt).catch(e => toast.error(rpcErrorMessage(e)))}>强制停止</button>}
      </div>}
      {!archived && snap.queuedTotal > 0 && <div className="agent-queue" aria-label="排队消息">
        {snap.queued.map(q => <div key={q.turnId} className="agent-queue-entry">
          <div className="agent-queue-row"><Clock3 size={14}/><span className="agent-queue-text" title={q.text}>{q.text || '附件消息'}{q.attachmentCount > 0 && <small> · {q.attachmentCount} 个附件</small>}</span>
            {q.acceptedAt && <time dateTime={q.acceptedAt}>{new Date(q.acceptedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</time>}
            {q.editable && <div className="agent-queue-actions">
              <button type="button" disabled={!!action} title="编辑排队消息" onClick={() => void actOnInput('edit:' + q.turnId, async () => {
                const { value } = await readInput(q.turnId, q.version); setQueueEdit({ taskId, turnId:q.turnId, version:q.version, text:value.text });
              })}><Pencil size={13}/></button>
              <button type="button" title="立即发送" disabled={!!action || activeEdit?.turnId === q.turnId || !!stopping || !!snap.switching || requests.length > 0 || (snap.run?.busy ? !snap.run?.steer : q.turnId !== snap.queued[0]?.turnId)} onClick={() => void actOnInput('send:' + q.turnId, async () => {
                const result = await rpc.agentTasks.sendQueued(taskId, q.turnId, q.version, snap.selectionRevision);
                if (result.status === 'unknown') toast.warning('无法确认插话是否已送达，请查看回答后再决定');
              })}><Send size={13}/></button>
              <button type="button" disabled={!!action} title="删除排队消息" onClick={() => void actOnInput('delete:' + q.turnId, async () => { await rpc.agentTasks.cancelQueued(taskId, q.turnId); if (activeEdit?.turnId === q.turnId) setQueueEdit(undefined); })}><Trash2 size={13}/></button>
            </div>}
          </div>
          {activeEdit?.turnId === q.turnId && <div className="agent-queue-edit">
            <textarea aria-label="编辑排队消息" value={activeEdit.text} onChange={e => setQueueEdit({ ...activeEdit, text:e.target.value })} rows={3} />
            <div><button type="button" onClick={() => setQueueEdit(undefined)}>取消</button><button type="button" disabled={!!action} onClick={() => void actOnInput('save:' + q.turnId, async () => {
              await rpc.agentTasks.editQueued(taskId, q.turnId, activeEdit.version, activeEdit.text); setQueueEdit(undefined);
            })}>保存</button></div>
          </div>}
        </div>)}
        {snap.queuedTotal > snap.queued.length && <small>另有 {snap.queuedTotal - snap.queued.length} 条排队</small>}
      </div>}
      {!archived && relations?.needsHandling && <div className="agent-limit-card agent-merge-banner" role="alert"><TriangleAlert size={16}/><div><b>需要你处理</b><small>子任务提交连续两轮未能核实合入，请核对分支与冲突。</small></div>
        <button type="button" className="agent-inline-action" disabled={!!action || !!requests.length || !!stopping} onClick={() => void actOnInput('merge', async () => {
          const key = 'merge:' + (relations.children.filter(child => child.needsHandling).map(child => child.delegationId + ':' + child.attempts).join(',') || 'pending');
          const clientInputId = actionInputs.current.get(key) ?? newClientInputId();
          actionInputs.current.set(key, clientInputId);
          await rpc.agentTasks.submit(taskId, { clientInputId, text: '请核对当前分支与子任务的提交并重试合并。遇到冲突或需要批准时，请说明情况。', expectedSelectionRevision: snap.selectionRevision });
          actionInputs.current.delete(key);
        })}>让 Agent 再试</button>
        <button type="button" className="agent-inline-action" onClick={() => setTerminalOpen(true)}>打开终端</button>
      </div>}
      {archived ? <div className="agent-composer agent-archive-composer"><textarea rows={3} disabled aria-label="已归档任务输入" placeholder="恢复后可以继续此会话" /></div> : requests.length > 0
        ? <RequestPanel requests={requests} more={Math.max(0, (snap.requestsTotal ?? snap.requests.length) - snap.requests.length) + childRequestsMore} driverId={snap.selection.driverId} cwd={snap.cwd} visiblePlans={visiblePlans} mailSlot={mailSlot} onStop={r => void rpc.agentTasks.stop(r.ownerTaskId ?? taskId).then(reload).catch(e => toast.error(rpcErrorMessage(e)))} onRespond={async (r, result) => { await rpc.agentTasks.respond(r.ownerTaskId ?? taskId, r.requestId, r.revision, result); void reload(); }} />
        : <form className="agent-composer" onSubmit={e => { e.preventDefault(); void send(); }}>
          <AttachmentChips chips={chips} onRemove={removeChip} onRetry={retryChip} />
          <ComposerMenu items={menuItems} index={Math.min(menuIndex, Math.max(0, menuItems.length - 1))} onPick={pick} />
          <textarea ref={textarea} value={text} onSelect={e => refreshTrigger(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)} onBlur={() => setTimeout(() => setTrigger(null), 150)} onPaste={e => { const files = [...e.clipboardData.files]; if (files.length) { e.preventDefault(); addFiles(files); } }}
            onDragOver={e => { if (e.dataTransfer.types.includes('Files')||e.dataTransfer.types.includes(FILE_TERMINAL_DRAG_TYPE)) e.preventDefault(); }} onDrop={e => { const token=e.dataTransfer.getData(FILE_TERMINAL_DRAG_TYPE);if(token){e.preventDefault();void dropFileToAgentComposer(token,taskId,m=>toast.message(m));return;}const files = [...e.dataTransfer.files]; if (files.length) { e.preventDefault(); addFiles(files); } }} placeholder={working ? '继续输入，本轮结束后发送' : '随心输入'} rows={3}
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
            <select aria-label="权限档位" value={snap.selection.tier} disabled={!!snap.parentTaskId} title={snap.parentTaskId ? '跟随主任务的权限档位' : undefined} onChange={e => { if (e.target.value === 'full' && !permissionPref.value?.fullConfirmed) setConfirmFull(true); else void setSelection({ tier: e.target.value }); }}>
              {(profile?.tiers ?? [snap.selection.tier]).map(t => <option key={t} value={t}>{TIER_LABEL[t] ?? t}</option>)}
            </select>
            <AgentModelPicker triggerRef={modelSelect} profiles={profiles} profileId={snap.selection.profileId} model={snap.selection.model} effort={snap.selection.effort} defaultModel={snap.run?.defaultModel} nativeModels={snap.run?.models} onEffort={effort => void setSelection({ effort })} disabled={snap.switching} locked={!!snap.goal && snap.goal.status !== 'complete'} busy={working} extensions={snap.selection.extensionPreferences} carryExtensions={snap.selection.carryExtensions}
              onPick={async (id, model) => { try { const r = await rpc.agentTasks.switchProfile(taskId, id, snap.selectionRevision, model); if (!r.ok) toast.warning('选择已在别处变化，请重试'); else if (r.selection.pendingSwitch) toast.message('本轮和已有排队输入结束后切换'); void reload(); return r.ok; } catch (e) { toast.error(rpcErrorMessage(e)); return false; } }}
              onExtensions={async (id, enabled) => { try { const r = await rpc.agentTasks.setExtensions(taskId, id, enabled, snap.selectionRevision); if (!r.ok) toast.warning('选择已在别处变化，请重试'); void reload(); } catch (e) { toast.error(rpcErrorMessage(e)); } }} />
            <span className="push" />
            <VoiceButton compact disabled={sending} onClick={()=>void voiceStore.trigger(textareaVoiceTarget(textarea.current),'home')}/>
            {working && snap.run?.steer && <button type="button" className="agent-stop" disabled={!text.trim()} onClick={() => void send('steer')} title="插话：并入当前这一轮（⌘Enter）"><Zap size={14} />插话</button>}
            {working && snap.run && !snap.run.steer && <span className="agent-composer-agent" title="该执行器版本没有插话的验证证据">运行中发送会排队</span>}
            {working && <button type="button" className="agent-stop agent-stop-run" onClick={() => void stop()} title="停止本轮" disabled={!!stopping}><CircleStop size={15} /></button>}
            <button type="submit" className="agent-send" disabled={sending || (!text.trim() && !chips.length)} title="发送"><Send size={15} /></button>
          </div>
        </form>}
    </div>
    {!archived && terminalOpen && <AgentTerminalDrawer taskId={taskId} onClose={() => setTerminalOpen(false)} />}
    {!archived && draftConflict !== null && confirmOtherDraft && <AgentDialog title="用另一份草稿？" onClose={() => { if (!resolvingDraft) setConfirmOtherDraft(false); }} footer={<>
      <button type="button" className="m10-button" disabled={resolvingDraft} onClick={() => setConfirmOtherDraft(false)}>取消</button>
      <button type="button" className="m10-button primary" disabled={resolvingDraft} onClick={() => void resolveDraft(true)}>确认替换</button>
    </>}>
      <p>将替换输入框中尚未保存的文字和附件。</p>
    </AgentDialog>}
    {!archived&&pluginsOpen&&<AgentDialog title='项目插件' sub='业务操作仍按当前档位和插件最高档位裁定；等待中的请求会重新核对版本与账号。' onClose={()=>setPluginsOpen(false)} footer={<button type='button' className='m10-button' onClick={()=>{setPluginsOpen(false);if(snap.projectId)navigation.openProject(snap.projectId,'applications');else toast.message('先关联项目以配置插件');}}>管理项目插件</button>}>{plugins.length?<ul>{plugins.map(p=><li key={p.id}>{p.name}</li>)}</ul>:<p>当前任务没有可用的项目插件</p>}</AgentDialog>}
    {!archived && confirmFull && <AgentDialog title="使用完全访问权限？" onClose={() => setConfirmFull(false)} footer={<><button className="m10-button" onClick={() => setConfirmFull(false)}>取消</button><button className="m10-button primary" data-testid="agent-confirm-full" onClick={() => { void permissionPref.update({ fullConfirmed: true }); setConfirmFull(false); void setSelection({ tier: 'full' }); }}>继续使用完全访问</button></>}>
      <p className="m13-perm-warn">智能体可以不经询问修改你电脑上的任何文件、访问互联网，也可以运行任意命令。只建议在你信任当前任务和项目时使用。</p>
      <div className="m13-note">插件的写操作也不再询问，发送邮件仍会每次询问。插件声明了更低权限上限时仍按该上限处理；Claude 交出的计划仍需批准。</div>
    </AgentDialog>}
    </div>
    {(showLineage || activeProcess) && <aside className="agent-task-aux">
      {showLineage && family && <AgentLineage parentId={parentId} title={family.taskTitle} parentArchived={relations?.parentTaskId ? relations.parentArchived : archived}
        currentId={taskId} value={family} close={()=>{lineage.setLineage(false);}} reload={loadRelations} readOnly={archived} />}
      {activeProcess && <NativeProcess key={activeProcess.itemId} item={activeProcess} onClose={()=>setNativeProcess(current=>current?.itemId===activeProcess.itemId?null:current)} />}
    </aside>}
  </NativeProcessScope.Provider></section></TaskScope.Provider></RunInTerminal.Provider></ArchivedScope.Provider></RelationsScope.Provider>;
});
