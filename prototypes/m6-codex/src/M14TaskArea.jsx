// M14 统一任务区（原型 P0.5）。时间线的行规则移植自 T3 fe59fa44d0（MessagesTimeline.logic.ts、work-log/presentation.ts），
// 行样式对照 TimelineWorkGroupRows／TimelineWorkEntryRow／TimelineUserMessageRow／ChangedFilesTree／QueuedRunsControl；
// 模型选择器对照 ModelPickerContent／ModelPickerSidebar／TraitsPicker。输入框外壳、左侧栏、右侧文件／浏览器沿用 WillYou。全部为合成数据。
import { useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, GitMerge } from 'lucide-react';
import { AlertCircle, AlertTriangle, ArrowRightLeft, ArrowUp, Bell, Brain, Check, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Copy, FileDiff, FilePlus2, FileText, Globe, Hourglass, ListChecks, LoaderCircle, Pencil, Plus, Search, Settings, ShieldAlert, Square, SquareTerminal, Star, Wrench, X, Zap, Layers, ArrowUpLeft, Network, Lock, PlugZap, RefreshCw, WifiOff, Minimize2, Image as ImageIcon, Link2, Gauge } from 'lucide-react';
import { AgentIcon, PermIcon, ProviderIcon } from './m13-icons.jsx';
import { VoiceButton } from './VoicePreview';
import { FILE_DRAG_TYPE, resolveFileDrag } from './file-drag-model.mjs';
import { RequestPanel, buildRequests } from './M14Requests.jsx';
import { GoalRow, slashBlocked } from './M14Extras';
import { AttachmentChips, Banner, BackgroundWork, BusinessApprovalRow, CodeBlock, ComposerChips, CompactionRow, DiffStateNote, LinkMenu, MentionMenu, NativeDrawer, NativeSubagentRow, pasteToChips, PlanCard, SysNoteRow, TodoRow, mentionItems, mentionTrigger } from './M14Extras.jsx';
import { AGENTS, PERMISSIONS, SCENARIOS, TEAM_CHILDREN, clock, deriveRows, entryLabel, formatDuration, inlineSegments, routeLink, statusLine, thoughtHeading, goalLock } from './m14-model.mjs';

const ICON = { thought: Brain, read: FileText, edit: Pencil, command: SquareTerminal, search: Search, web: Globe, tool: Wrench, mixed: Layers };

// ---------- 正文 ----------
const UICtx = { taskId: 'demo', mailBase: null, toast: () => {}, runInTerminal: () => {}, linkMenu: () => {}, openDiff: () => {}, mail: null, openNative: () => {} }; // 由 M14TaskArea 每次渲染时赋值，供深层消息组件使用
const RootCtx = { root: '/workspace/SmartDD' }; // 当前任务的项目目录（App 传入）；示例消息中的根路径按它替换
function Inline({ text, onLink }) {
  return inlineSegments(text.replaceAll('/workspace/SmartDD', RootCtx.root)).map((s, i) => {
    if (s.t === 'bold') return <b key={i}>{s.v}</b>;
    if (s.t === 'code') return <code key={i}>{s.v}</code>;
    if (s.t !== 'link') return <span key={i}>{s.v}</span>;
    const r = routeLink(s.href, { projectRoot: RootCtx.root });
    // 不用原生 href／title：避免浏览器左下角网址预览和原生提示叠加闪烁；提示框悬停 0.4 秒后出现
    return <span key={i} role="link" tabIndex={0} className={'m14-link' + (s.code ? ' is-code' : '') + (r.ok ? '' : ' blocked')} data-tip={r.ok ? r.label + ' · ⌘ 点击用系统打开' : r.reason} onClick={e => onLink(s.href, e.metaKey || e.ctrlKey)} onContextMenu={e => { e.preventDefault(); UICtx.linkMenu({ x: Math.min(e.clientX, innerWidth - 220), y: Math.min(e.clientY, innerHeight - 180), href: s.href, route: r }); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onLink(s.href, e.metaKey || e.ctrlKey); } }}>{s.code ? <code>{s.v}</code> : s.v}</span>;
  });
}
function Markdown({ lines, onLink, streaming }) {
  const out = []; let list = [], code = null;
  const flush = () => { if (list.length) { out.push(<ul key={'l' + out.length}>{list}</ul>); list = []; } };
  lines.forEach((l, i) => {
    if (code) { if (l.startsWith('```')) { out.push(<CodeBlock key={'c' + i} lang={code.lang} code={code.body.join('\n')} onToast={UICtx.toast} onRunInTerminal={UICtx.runInTerminal} />); code = null; } else code.body.push(l); return; }
    if (l.startsWith('```')) { flush(); code = { lang: l.slice(3).trim(), body: [] }; return; }
    if (l.startsWith('- ')) list.push(<li key={i}><Inline text={l.slice(2)} onLink={onLink} />{streaming && i === lines.length - 1 && <span className="m14-caret" />}</li>); else { flush(); out.push(<p key={i}><Inline text={l} onLink={onLink} />{streaming && i === lines.length - 1 && <span className="m14-caret" />}</p>); } });
  flush();
  return <div className="m14-md">{out}</div>;
}

// ---------- 行组件 ----------
function UserRow({ user }) {
  const long = user.text.length > 280 || user.text.split('\n').length > 6;
  const [full, setFull] = useState(false);
  return <div className={'m14-user' + (user.failed ? ' failed' : '')}>
    {user.attachments && <AttachmentChips items={user.attachments} />}
    <div className={'m14-bubble' + (long && !full ? ' clamp' : '')}>{user.text}</div>
    {long && <button className="m14-showfull" onClick={() => setFull(!full)}>{full ? '收起' : '显示全文'}</button>}
    {user.failed ? <div className="m14-user-failed"><AlertTriangle size={12} />{user.failed}<button onClick={() => UICtx.toast('已重新发送 · 合成')}>重试</button><button onClick={() => UICtx.toast('已放回输入框，未发送（合成）')}>放回输入框</button></div>
      : <div className="m14-user-meta"><span>{user.time}</span><button aria-label="复制消息" title="复制" onClick={() => UICtx.toast('已复制消息')}><Copy size={12} /></button></div>}
  </div>;
}
// T3 WorkLogRow：h-6 行；图标 16px 次要色；标签 14px；右侧时间悬停出现
function LogRow({ icon, label, detail, time, chevron, expanded, onClick, tone, live, wrap }) {
  const Tag = onClick ? 'button' : 'div';
  return <Tag className={'m14-log' + (tone ? ' t-' + tone : '') + (wrap ? ' wrap' : '')} onClick={onClick} aria-expanded={onClick ? !!expanded : undefined}>
    <span className="m14-log-icon">{icon}</span>
    <span className={'m14-log-label' + (live ? ' m14-shine' : '')}>{label}</span>
    {detail && <span className="m14-log-detail">{detail}</span>}
    {time != null && <span className="m14-log-time">{clock(time)}</span>}
    {chevron && <ChevronRight size={12} className={'m14-chev' + (expanded ? ' open' : '')} />}
  </Tag>;
}
function EntryBody({ e }) {
  if (e.kind === 'thought') return <div className="m14-log-body thought"><Markdown lines={e.text.split('\n')} onLink={() => {}} /></div>;
  if (e.kind === 'command') return <div className="m14-log-body"><pre className="m14-output"><span className="m14-prompt">$ {e.cmd}</span>{'\n'}{e.output ?? '（等待输出）'}{e.exit != null && `\n\n退出码 ${e.exit}`}</pre></div>;
  if (e.kind === 'read' && e.output) return <div className="m14-log-body"><pre className="m14-output">{e.output}</pre></div>;
  if (e.kind === 'edit') return <div className="m14-log-body muted">{e.path}：<i className="add">+{e.add}</i> <i className="del">−{e.del}</i>，完整差异见本轮改动</div>;
  return null;
}
function WorkEntry({ e, onToggle, open }) {
  const Icon = ICON[e.kind] || Wrench;
  const canOpen = e.kind === 'thought' || e.kind === 'command' || e.kind === 'edit' || (e.kind === 'read' && e.output);
  const label = e.kind === 'thought' && open ? '思考' : entryLabel(e);
  const detail = e.kind === 'edit' ? <><i className="add">+{e.add}</i> <i className="del">−{e.del}</i></> : e.kind === 'command' && e.exit != null && e.exit !== 0 ? <span className="del">退出码 {e.exit}</span> : null;
  return <div className="m14-entry">
    <LogRow icon={<Icon size={14} />} label={label} detail={detail} chevron={canOpen} expanded={open} onClick={canOpen ? onToggle : undefined} tone={e.kind === 'command' ? 'mono' : undefined} />
    {open && <EntryBody e={e} />}
  </div>;
}
function useToggles() { const [set, setSet] = useState(() => new Set()); return [set, id => setSet(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })]; }

function GroupEntries({ entries, openEntries, toggleEntry }) {
  return <div className="m14-group-body">{entries.map(e => <WorkEntry key={e.id} e={e} open={openEntries.has(e.id)} onToggle={() => toggleEntry(e.id)} />)}</div>;
}

// T3 ChangedFilesTree：卡片列出改动文件，“查看差异”／点文件在右侧面板的“差异”标签打开（只读，无回退）
function ChangesCard({ files, label }) {
  const add = files.reduce((n, f) => n + f.add, 0), del = files.reduce((n, f) => n + f.del, 0);
  return <div className="m14-changes">
    <div className="m14-changes-head"><span>{files.length} 个文件已更改 <i className="add">+{add}</i> <i className="del">−{del}</i></span><span className="m14-changes-actions"><button onClick={() => UICtx.openDiff(files, files[0].path, label)}><FileDiff size={12} />查看差异</button></span></div>
    {files.map(f => <div key={f.path} className="m14-file">
      <button className="m14-file-row" onClick={() => UICtx.openDiff(files, f.path, label)} title="在右侧“差异”中查看">
        <span className={'m14-fstatus s-' + f.status}>{f.status}</span>
        <span className="m14-fpath">{f.path}</span>{f.external && <span className="m14-ext-tag">外部修改</span>}{f.binary ? <span className="m14-fmeta">二进制</span> : <span className="m14-fmeta"><i className="add">+{f.add}</i> <i className="del">−{f.del}</i></span>}
      </button>
    </div>)}
  </div>;
}

function SwitchDivider({ sw }) {
  const [open, setOpen] = useState(false);
  return <div className="m14-switch">
    <div className="m14-divider"><span /><button aria-expanded={open} onClick={() => setOpen(!open)}><ArrowRightLeft size={12} />此处切换到 {sw.to}<ChevronDown size={12} className={'m14-chev-d' + (open ? ' open' : '')} /></button><span /></div>
    {open && <div className="m14-handoff">
      <div><b>交接方式</b>{sw.mode === 'full' ? '新会话，交付全部可用摘要' : '恢复原会话，只补切走后的新增内容'}</div>
      <div><b>来自</b>{sw.from}</div><div><b>已覆盖</b>{sw.covered}</div><div><b>未包含</b>{sw.omitted}</div>
      <p>原消息保留不变；交接内容只作为上下文，不产生新的真人授权。</p>
    </div>}
  </div>;
}

const STATE_LABEL = { running: '运行中', queued: '排队中', done: '已完成', failed: '失败', stopped: '已停止', waiting: '等待你处理' };
function AgentGlyph({ r, size = 16 }) { return r.tool ? <AgentIcon tool={r.tool} provider={r.provider ? { catalog: 'deepseek', name: 'DeepSeek' } : null} size={size} /> : <span className="m14-glyph" style={{ width: size, height: size }}>{r.glyph || <SquareTerminal size={12} />}</span>; }
function StateMark({ state }) { return <span className={'m14-state s-' + state}>{state === 'running' ? <LoaderCircle size={11} className="spin" /> : state === 'queued' ? <Hourglass size={11} /> : state === 'waiting' ? <ShieldAlert size={11} /> : <Check size={11} />}{STATE_LABEL[state]}</span>; }
function Subagents({ e, onToast, onOpenChild }) {
  const [open, setOpen] = useState(!!e.team);
  const count = st => e.rows.filter(r => r.state === st).length;
  const sub = [count('running') && `${count('running')} 个运行中`, count('waiting') && `${count('waiting')} 个等待你处理`, count('queued') && `${count('queued')} 个排队`, count('done') && `${count('done')} 个已完成`].filter(Boolean).join(' · ');
  return <div className="m14-sub">
    <button className="m14-sub-head" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="m14-sub-stack">{e.rows.map(r => <span key={r.id}><AgentGlyph r={r} /></span>)}</span>
      <span className="m14-sub-title"><b>{e.rows.length} 个子任务</b><small className={count('running') ? 'live' : ''}>{sub}</small></span>
      <span className="m14-sub-time">{Math.max(...e.rows.map(r => r.secs))} 秒</span><ChevronDown size={14} className={'m14-chev-d' + (open ? ' open' : '')} />
    </button>
    {open && <div className="m14-sub-rows">{e.rows.map(r => <div key={r.id} className={'m14-sub-row' + (onOpenChild && r.turns ? ' clickable' : '')} onClick={() => r.turns && onOpenChild?.(r.id)} role={r.turns ? 'button' : undefined} tabIndex={r.turns ? 0 : undefined}>
      <AgentGlyph r={r} />
      <div className="m14-sub-main"><div><b>{r.title}</b><span className={'m14-pill ' + (r.access === '写入' ? 'write' : 'read')}>{r.access}</span><StateMark state={r.state} /></div>
        <small>{r.live && r.state !== 'done' ? <span className={r.state === 'running' ? 'm14-shine' : ''}>{r.live}</span> : null}{r.live && r.state !== 'done' ? ' · ' : ''}{r.target}{r.state === 'done' || r.state === 'queued' ? ' · ' + r.note : ''}<span className="m14-wt-chip m14-mode" title={workspaceLabel(r)}>{r.branch && <GitBranch size={10} />}{workspaceLabel(r)}</span></small></div>
      <span className="m14-sub-secs">{r.secs ? r.secs + ' 秒' : ''}</span>
      <div className="m14-sub-actions" onClick={ev => ev.stopPropagation()}>{r.state === 'queued' && <button onClick={() => onToast('已取消排队（合成）')}>取消排队</button>}{(r.state === 'running' || r.state === 'waiting') && <button onClick={() => onToast('已请求停止该子任务（合成）')}>停止</button>}{r.turns && <button onClick={() => onOpenChild?.(r.id)}>打开</button>}</div>
    </div>)}</div>}
  </div>;
}

// 任务关系（T3 ThreadDetailsCard 的 Lineage 区）：任务区右上角悬浮卡片，平时收起为一个胶囊，点开才展开
function workspaceLabel(child) {
  if (child.branch) return '工作副本 · ' + child.branch;
  return child.access === '写入' ? '共用目录 · 写入队列' : '共用目录 · 只读';
}

function LineagePanel({ kids, onOpenChild, onClose, current, vcs = 'git', merged }) {
  const running = kids.filter(c => c.state === 'running' || c.state === 'waiting').length;
  return <div className="m14-lineage" role="dialog" aria-label="任务关系">
    <div className="m14-lineage-head"><span>任务关系 · {running ? `${running} 个运行中` : '全部已结束'}</span><button aria-label="收起" onClick={onClose}><X size={14} /></button></div>
    <button className={'m14-lin-row' + (!current ? ' on' : '')} onClick={() => onOpenChild(null)}><AgentIcon tool="claude" size={16} /><span className="m14-lin-title">检查多平台安装包<small>主任务 · Claude Code · 订阅</small></span><span className="m14-lin-time">{running ? '52 秒' : '2 分 14 秒'}</span></button>
    {kids.map(c => <button key={c.id} className={'m14-lin-row child' + (current === c.id ? ' on' : '')} onClick={() => onOpenChild(c.id)}><AgentGlyph r={c} /><span className="m14-lin-title">{c.title}<small>{c.target} · {c.access}<br /><span className="m14-mode">{workspaceLabel(c)}</span></small></span><StateMark state={c.state} /><span className="m14-lin-time">{c.secs ? c.secs + ' 秒' : ''}</span></button>)}
    {kids.some(c => c.access === '写入' && !c.branch) && <>
      <div className="m14-lineage-sec"><Lock size={12} />目录写入队列 · {vcs === 'svn' ? 'SVN' : 'Git 共用目录'}</div>
      {running ? <><div className="m14-queue-line"><span className="n">1</span>主任务<span className="tag hold">写入中</span></div>
        <div className="m14-queue-line"><span className="n">2</span>补 node-pty 架构测试<span className="tag">等待</span></div></> : <div className="m14-queue-line"><span className="n">–</span>当前无人持有写入权</div>}
      <p className="m14-lineage-note">共用目录的写入委派依次交接，后拿到写入权的一方先收到“上一位改了哪些文件”，重新读取后再动手。只读子任务直接并行。</p>
    </>}
    {kids.some(c => c.branch) && <>
      <div className="m14-lineage-sec"><GitBranch size={12} />工作副本 · Git</div>
      <div className="m14-queue-line"><span className="n">⌂</span>主任务<span className="m14-wt-branch">feature/0.1.6</span><span className="tag">当前目录</span></div>
      {kids.filter(c => c.branch).map(c => <div key={c.id} className="m14-queue-line"><span className="n">⎇</span>{c.title}<span className="m14-wt-branch">{c.branch.replace('feature/0.1.6', '…')}</span><span className={'tag' + (c.state === 'running' ? ' hold' : '')}>{merged ? '已合并' : c.state === 'done' ? '待合并' : '工作中'}</span></div>)}
      <p className="m14-lineage-note">显式选择独立工作副本时从 HEAD 创建，子任务提交到子分支，由主任务检查和合并。</p>
    </>}
  </div>;
}

// 子任务视图底部（T3 ProviderSubagentBar）：执行器、模型、状态、“独立运行”、返回主任务
function SubagentBar({ c, onBack, onToast }) {
  return <div className="m14-subbar"><AgentGlyph r={c} /><b>{c.target}</b><span className="muted">{c.model}</span><span className={'m14-subbar-status' + (c.state === 'running' ? ' m14-shine' : '')}>{c.state === 'queued' ? '排队中 · 等主任务本轮结束' : `${STATE_LABEL[c.state]} ${c.secs} 秒`}</span><span className="muted push">独立运行</span>{(c.state === 'running' || c.state === 'waiting') && <button onClick={() => onToast('已请求停止该子任务（合成）')}>停止</button>}<button onClick={onBack}><ArrowUpLeft size={13} />返回主任务</button></div>;
}

function Row({ row, ui, onLink, onToast, onOpenChild }) {
  const { openEntries, toggleEntry, toggleGroup, toggleTurn } = ui;
  switch (row.kind) {
    case 'working': return <div className={'m14-working' + (row.stopping ? ' stopping' : '')}><span className="m14-shine">{row.label}</span></div>;
    case 'business': return <BusinessApprovalRow e={row.entry} mail={UICtx.mail} />;
    case 'sysnote': return <SysNoteRow e={row.entry} />;
    case 'plan': return <PlanCard e={row.entry} onToast={onToast} />;
    case 'goal': return <GoalRow e={row.entry} onToast={onToast} taskId={UICtx.taskId} />;
    case 'todo': return <TodoRow e={row.entry} />;
    case 'compaction': return <CompactionRow e={row.entry} />;
    case 'native': return <NativeSubagentRow e={row.entry} onOpen={UICtx.openNative} />;
    case 'turn-footer': return <div className={'m14-turn-footer' + (row.failed ? ' failed' : '')}>{row.label}</div>;
    case 'turn-fold': return <button className="m14-working fold" aria-expanded={row.expanded} onClick={() => toggleTurn(row.turnId)}>{row.label}<ChevronRight size={13} className={'m14-chev' + (row.expanded ? ' open' : '')} /></button>;
    case 'turn-header': return <div className={'m14-working' + (row.failed ? ' failed' : '')}>{row.label}</div>;
    case 'thinking': return row.label.startsWith('等待') ? <div className="m14-waiting-row"><CircleDashed size={14} /><span className="m14-shine">{row.label}</span>{ui.waiting && <span className="m14-waiting-names">{ui.waiting.join('、')}</span>}<button onClick={() => onToast('停止范围：主任务及其全部子任务（合成）')}>停止</button></div> : <LogRow icon={<Brain size={14} />} label={row.label} live />;
    case 'work': return <WorkEntry e={row.entry} open={openEntries.has(row.entry.id)} onToggle={() => toggleEntry(row.entry.id)} />;
    case 'work-toggle': { const Icon = ICON[row.icon] || Layers; return <div className="m14-entry"><LogRow icon={<Icon size={14} />} label={row.summary} chevron expanded={row.expanded} onClick={() => toggleGroup(row.id)} />{row.expanded && <GroupEntries entries={row.entries} openEntries={openEntries} toggleEntry={toggleEntry} />}</div>; }
    case 'work-live': {
      const Icon = ICON[row.entry.kind] || Wrench;
      const thoughtLine = row.thought && !row.expanded ? thoughtHeading(row.thought.text) : '';
      const isThought = row.entry.kind === 'thought';
      return <div className="m14-entry">
        <button className="m14-live" aria-expanded={row.expanded} onClick={() => toggleGroup(row.id)}>
          {thoughtLine && !isThought && <span className="m14-log wrap"><span className="m14-log-icon"><Brain size={14} /></span><span className="m14-log-label m14-thought-line">{thoughtLine}</span></span>}
          <span className="m14-log"><span className="m14-log-icon">{isThought ? <Brain size={14} /> : <Icon size={14} />}</span><span className="m14-log-label m14-shine">{isThought ? (thoughtLine || '思考中') : entryLabel(row.entry, true)}</span></span>
        </button>
        {row.expanded && <GroupEntries entries={row.entries} openEntries={openEntries} toggleEntry={toggleEntry} />}
      </div>;
    }
    case 'message': return <div className="m14-assistant"><Markdown lines={row.entry.lines} onLink={onLink} /></div>;
    case 'final': return <div className={'m14-assistant' + (row.partial ? ' partial' : '')}>{row.agent && <div className="m14-agent-tag"><AgentIcon tool={row.agent} size={14} />Codex · DeepSeek · deepseek-flash</div>}<Markdown lines={row.lines} onLink={onLink} streaming={row.streaming} />{!row.streaming && <div className="m14-assistant-meta"><button aria-label="复制回答" title="复制回答" onClick={() => onToast('已复制回答')}><Copy size={12} /></button><span>14:04</span></div>}</div>;
    case 'changes': return <>{row.diffState && <><DiffStateNote st={row.diffState} onToast={onToast} />{['reclaimed', 'storage-full'].includes(row.diffState.kind) && <button type="button" className="text-button" onClick={() => UICtx.openDiff(row.files, undefined, row.turnId)}>查看记录</button>}</>}{row.files.length > 0 && <ChangesCard files={row.files} label={row.turnId} />}</>;
    case 'subagents': return <Subagents e={row.entry} onToast={onToast} onOpenChild={onOpenChild} />;
    case 'created': return <LogRow icon={<FilePlus2 size={14} />} label={`创建子任务「${row.entry.title}」`} detail={`${row.entry.target} · ${row.entry.access}${row.entry.branch ? ' · 工作副本 ' + row.entry.branch : ''}`} />;
    case 'notice': return <LogRow icon={<Bell size={14} />} label={row.entry.text} detail={row.entry.sub} />;
    case 'error': return <details className="m14-error"><summary><AlertCircle size={14} />{row.entry.title}<span>详情</span></summary><p>{row.entry.detail}</p><p className="m14-error-actions"><button onClick={() => onToast('已复制请求 ID：req_01HZX…（合成）')}>复制请求 ID</button><button onClick={() => onToast('已重新发送上一条消息（合成）')}>重试</button></p></details>;
    case 'approval': return <div className="m14-approval-row"><LogRow icon={<ShieldAlert size={14} />} label={row.entry.title} tone="warn" /><div className="m14-approval-detail"><pre>{row.entry.command}</pre><span>目录 {row.entry.cwd}</span><span className="warn"><AlertTriangle size={12} />{row.entry.reason}</span></div></div>;
    case 'length': return <div className="m14-length"><AlertTriangle size={13} />回答达到输出长度上限，已保留上面的部分内容。<button onClick={() => onToast('将以“继续”发起新一轮（合成）')}>继续</button></div>;
    default: return null;
  }
}

// ---------- 模型选择器（T3 ModelPickerContent：左侧执行器栏 w-11、中间搜索＋模型列表、右侧推理强度；底部设置） ----------
const EXT = {}; // “沿用我的扩展”开关：按 任务＋智能体 保存（评审 RV09，原型内存）
// 首页（taskId=home）的扩展开关在创建任务时复制给新任务，并作为新建原生会话的冻结输入（复核 AR03）
export function carryHomeExtensions(taskId) { const snap = {}; for (const k of Object.keys(EXT)) if (k.startsWith('home:')) { EXT[taskId + ':' + k.slice(5)] = EXT[k]; snap[k.slice(5)] = EXT[k]; } return snap; }
const DRAFTS = new Map(); // 每任务草稿文字（原型内存；生产为 agent_tasks.draft_json）
const TASK_STATE = new Map(); // 每任务选择、档位与草稿附件（评审 RR05；原型内存，生产为 agent_tasks.selection_json／draft_json）
const taskState = (id, patch) => { const cur = TASK_STATE.get(id) || {}; if (patch) TASK_STATE.set(id, { ...cur, ...patch }); return TASK_STATE.get(id) || cur; };
export function ModelPicker({ agent, model, effort, onPick, onClose, onToast, running, align = 'right', taskId = 'home', goal = null }) {
  const [rail, setRail] = useState(agent);
  const extKey = taskId + ':' + rail;
  const [q, setQ] = useState(''), [more, setMore] = useState(false), [ext, setExtState] = useState(EXT[extKey] ?? true);
  const setExt = v => { EXT[extKey] = v; setExtState(v); };
  useEffect(() => { setExtState(EXT[extKey] ?? true); }, [extKey]);
  const a = AGENTS.find(x => x.id === rail);
  const remembered = taskState(taskId).profileChoices?.[rail];
  const preview = rail === agent ? { model, effort } : remembered ?? (rail === 'cx-sub'
    ? { model: 'gpt-6.2-sol', effort: '中等' } : null);
  const modelEffort = id => id === preview?.model ? preview.effort : id === 'default' ? null : a.defaultEffort ?? null;
  const pick = (id, intensity) => {
    if (rail !== agent) taskState(taskId, { profileChoices: { ...taskState(taskId).profileChoices, [agent]: { model, effort } } });
    onPick(rail, id, intensity, true);
  };
  const models = a.models.filter(m => (more || !m.more) && m.name.toLowerCase().includes(q.toLowerCase()));
  const hidden = a.models.filter(m => m.more).length;
  const cur = AGENTS.find(x => x.id === agent);
  useEffect(() => { const k = e => { if (e.metaKey && /^[1-9]$/.test(e.key)) { const m = models[Number(e.key) - 1]; if (m) { e.preventDefault(); pick(m.id, modelEffort(m.id)); } } if (e.key === 'Escape') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); });
  return <div className={'m14-picker ' + align} role="dialog" aria-label="选择智能体与模型">
    <div className="m14-picker-main">
      <div className="m14-picker-rail" aria-label="智能体">
        <button type="button" title="收藏" className={rail === 'fav' ? 'on' : ''} onClick={() => onToast('收藏的模型（合成）')}><Star size={16} /></button>
        {AGENTS.map(x => {
          if (x.placeholder) {
            const label = x.name + ' · ' + x.placeholder;
            return <button type="button" key={x.id} disabled className="m14-picker-placeholder" title={label} aria-label={label}>
              <ProviderIcon catalog="agent-opencode" size={20} /><small>{x.placeholder}</small>
            </button>;
          }
          const locked = goal && x.id !== agent;
          return <button type="button" key={x.id} title={locked ? x.name + '：当前任务有目标，清除目标后才能切换执行器' : x.name} aria-pressed={rail === x.id} disabled={locked} className={(rail === x.id ? 'on' : '') + (locked ? ' locked' : '')} onClick={() => { setRail(x.id); setQ(''); setMore(false); }}>
            {x.tool ? <AgentIcon tool={x.tool} provider={x.provider ? { catalog: 'deepseek', name: 'DeepSeek' } : null} size={20} /> : <span className="m14-glyph">{x.glyph || <SquareTerminal size={14} />}</span>}
            {x.status && <i className={'m14-rail-badge k-' + x.status.kind} title={x.status.label} />}
          </button>;
        })}
      </div>
      <div className="m14-picker-list">
        <div className="m14-picker-head"><b>{a.name}</b><small>{a.source}</small></div>
        {goal && <div className="m14-goal-lock" role="note"><Lock size={12} /><span>当前任务有目标（{goal.status === 'active' ? '进行中' : goal.status === 'waiting-children' ? '等子任务，已自动暂停' : '已暂停'}），不能切换到其他执行器；可在本执行器内换模型。清除目标后才能切换。</span></div>}
        {a.status && <div className={'m14-agent-status k-' + a.status.kind}><AlertTriangle size={12} /><span><b>{a.status.label}</b>{a.status.reason}</span>{a.status.kind !== 'limited' && <button type="button" onClick={() => onToast('正在重新检测本机程序…（合成）')}>重新检测</button>}</div>}
        <label className="m14-picker-search"><Search size={14} /><input autoFocus placeholder="搜索模型…" value={q} onChange={e => setQ(e.target.value)} /></label>
        {!a.provider ? <label className="m14-ext-toggle" title="关闭后，从下一个新会话起不加载你在 Claude／Codex 里自己装的 MCP、hooks、插件和 Skill；WillYou 插件与项目 Skill 不受影响"><PlugZap size={13} /><span>沿用我的扩展<small>MCP · hooks · 插件 · Skill</small></span><input type="checkbox" role="switch" checked={ext} onChange={e => { setExt(e.target.checked); onToast(e.target.checked ? '已沿用你的扩展（下一个新会话起生效）' : '本任务不加载你的扩展（下一个新会话起生效）'); }} /><i className="m14-switch-ui" /></label>
          : <div className="m14-ext-toggle off"><Lock size={13} /><span>托管配置已隔离<small>不加载你的个人扩展</small></span></div>}
        {models.map((m, i) => { const on = preview?.model === m.id; return <button type="button" key={m.id} disabled={a.status?.kind === 'unavailable'} className={'m14-model-row' + (on ? ' on' : '')} onClick={() => pick(m.id, modelEffort(m.id))}>
          {a.tool ? <AgentIcon tool={a.tool} size={16} /> : <SquareTerminal size={14} />}<span className="m14-model-name">{m.name}</span>{m.note && <small>{m.note}</small>}
          <span className="m14-kbd">⌘{i + 1}</span>{on && <Check size={14} />}</button>; })}
        {!more && hidden > 0 && !q && <button type="button" className="m14-model-more" onClick={() => setMore(true)}>显示更多（{hidden}）</button>}
        {!models.length && <p className="m14-picker-empty">没有匹配的模型</p>}
      </div>
      <div className="m14-picker-traits">
        <div className="m14-traits-head"><span>推理强度</span><small>{a.models.find(m => m.id === (preview?.model ?? a.models[0].id))?.name}</small></div>
        {a.efforts.length ? a.efforts.map(x => <button type="button" key={x} className={preview?.effort === x ? 'on' : ''} onClick={() => pick(preview?.model ?? a.models[0].id, x)}>{x}{x === a.defaultEffort && <small>默认</small>}{preview?.effort === x && <Check size={13} />}</button>)
          : <p className="m14-traits-none">该执行器未公布推理强度选项</p>}
      </div>
    </div>
    <div className="m14-picker-foot">
      <span className="m14-picker-note">{running ? '本轮结束后生效；时间线会显示切换点' : a.steer ? '支持运行中插话' : a.steerReason}{cur.id !== rail && !running && ' · 切换后新建或恢复该执行器的会话'}</span>
      <button type="button" onClick={() => onToast('打开“管理智能体”（M13 设置页）')}><Settings size={13} />管理智能体</button>
    </div>
  </div>;
}
export function ModelPill({ agent, model, effort, onClick, open }) {
  const a = AGENTS.find(x => x.id === agent); const m = a.models.find(x => x.id === model);
  return <button type="button" className="m14-pill-btn" aria-haspopup="dialog" aria-expanded={open} onClick={onClick}>
    {a.tool ? <AgentIcon tool={a.tool} provider={a.provider ? { catalog: 'deepseek', name: 'DeepSeek' } : null} size={16} /> : <SquareTerminal size={14} />}
    <span>{a.short}</span><span className="m14-pill-model">{m?.name}{effort ? ' ' + effort : ''}</span><ChevronDown size={12} />
  </button>;
}

// ---------- 输入框（WillYou reference-composer 外壳；待处理请求时按 T3 换成审批／提问面板） ----------
function Composer({ scenario, sel, setSel, bound, permission, setPermission, fullConfirmed, requestFullAccess, queued, setQueued, onToast, onDecide, requests = [], reqIndex = 0, setReqIndex, statusNode, taskId, ptyId, delegation, setDelegation }) {
  const [text, setTextRaw] = useState(() => DRAFTS.get(taskId) ?? '');
  const setTextState = v => { DRAFTS.set(taskId, v); setTextRaw(v); };
  const [menu, setMenu] = useState(null), [pick, setPick] = useState(null);
  const [trig, setTrig] = useState(null), [active, setActive] = useState(0), [chips, setChipsRaw] = useState(() => taskState(taskId).chips ?? []), [fresh, setFresh] = useState(null), [dismissed, setDismissed] = useState({}), [dragOver, setDragOver] = useState(false);
  const setChips = v => setChipsRaw(cur => { const next = typeof v === 'function' ? v(cur) : v; taskState(taskId, { chips: next }); return next; });
  const setText = v => { const next = typeof v === 'function' ? v(text) : v; setTextState(next); setTrig(mentionTrigger(next)); };
  const addChip = c => setChips(cs => [...cs.filter(x => x.name !== c.name), { id: 'c' + Date.now() + Math.random(), ...c }]);
  const pickMention = it => { setTextState(text.slice(0, trig.start) + it.insert + ' '); if (it.chip) addChip(it.chip); setTrig(null); box.current?.focus(); };
  const onDrop = e => { setDragOver(false); if (!e.dataTransfer.types.includes(FILE_DRAG_TYPE)) return; e.preventDefault(); const f = resolveFileDrag(e.dataTransfer.getData(FILE_DRAG_TYPE), taskId, ptyId); if (!f.ok) { onToast(f.error === 'foreign-task' ? '拖入的文件不属于当前任务，未添加' : '拖动已失效，请重新拖动'); return; } const rel = f.path.replace(RootCtx.root + '/', ''); addChip({ kind: 'file', name: rel }); onToast(`已添加引用：${rel}（未发送）`); };
  const box = useRef(null);
  const running = scenario.status === 'running' || scenario.status === 'stopping', stopping = scenario.status === 'stopping';
  const a = AGENTS.find(x => x.id === sel.agent);
  const ba = AGENTS.find(x => x.id === (running ? (bound?.agent ?? sel.agent) : sel.agent)); // 本轮实际执行器：插话按它判断（评审 RV09）
  const perms = PERMISSIONS.filter(p => !(p.id === 'auto' && a.tool !== 'codex')); // Claude 等没有“帮我批准”（评审 RV08）
  const pickPerm = p => { setMenu(null); if (p.id === 'full' && !fullConfirmed) { requestFullAccess?.(() => setPermission(p)); return; } setPermission(p); };
  useEffect(() => { if (!perms.some(p => p.id === permission.id)) setPermission(PERMISSIONS[0]); }, [a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const el = box.current; if (!el) return; el.style.height = '0px'; el.style.height = Math.max(42, Math.min(el.scrollHeight, 220)) + 'px'; }, [text]);
  const lastScenario = useRef(null); // 只在演示状态真的切换时重置附件；StrictMode 下重复执行挂载副作用不清空任务草稿
  useEffect(() => { setPick(null); if (lastScenario.current === null) { if (!taskState(taskId).chips) setChips(scenario.chips || []); } else if (lastScenario.current !== scenario.id) setChips(scenario.chips || []); lastScenario.current = scenario.id; setFresh(null); setDismissed({}); }, [scenario.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const unavailable = !!a.status;
  const req = requests[reqIndex] || null;
  useEffect(() => { setPick(null); }, [req?.id]);
  // 请求说明按请求身份（含修订）单独保存，不消费普通消息草稿（复核 AR02）
  const [reasons, setReasons] = useState({});
  const rtext = req ? (reasons[req.id] ?? '') : '';
  const setRtext = v => req && setReasons(r => ({ ...r, [req.id]: v }));
  // 2026-11-20 对齐 T3：只有本任务的原生请求（命令审批、提问、计划）占用输入框；业务／网页授权／子任务请求不阻塞，输入框照常发消息。
  const blocking = !!req && !req.childId && ['approval', 'question', 'plan'].includes(req.kind);
  const decide = (key = pick) => { if (!req) return; const opt = req.options.find(o => o.key === key); if (opt?.disabled) { onToast(opt.desc || '该选项当前不可用'); return; } if (opt?.needsText && !rtext.trim()) { onToast(blocking ? '请先在下方输入框写下要怎么改' : '请先在请求面板里写下要怎么改'); return; } if (!opt && !(req.kind === 'question' && rtext.trim())) { onToast('请先选择一项'); return; } onDecide(req, key, rtext.trim()); setPick(null); if (key !== 'edit' && key !== 'open') setReasons(r => { const n = { ...r }; delete n[req.id]; return n; }); };
  const submit = () => {
    if (blocking) { if (!rtext.trim() && !pick) return; decide(req.kind === 'question' ? (pick ?? 'text') : req.kind === 'plan' ? (pick ?? 'revise') : (pick ?? 'deny')); return; }
    if (!text.trim()) return;
    if (unavailable) { onToast(`${a.name}${a.status.label}，消息未发送；请重新检测或换一个智能体`); return; }
    const blocked = slashBlocked(text, a.caps); if (blocked) { onToast(`${a.name} 没有公布 ${blocked} 命令，消息未发送`); return; } // 评审 RR08
    const notReady = chips.filter(c => c.state === 'preparing' || c.state === 'failed'); if (notReady.length) { onToast(notReady.some(c => c.state === 'failed') ? '有附件准备失败：重试或移除后再发送' : '附件还在准备中，准备好后再发送'); return; } // 评审 RR06
    if (running) { setQueued(q => [...q, { id: 'q' + Date.now(), text, time: '14:04', chips }]); setText(''); setChips([]); return; } // 附件随所属输入一起排队（评审 RV10）
    onToast('已发送 · 合成'); setText(''); setChips([]); setFresh(null);
  };
  const items = trig ? mentionItems(trig, a.caps) : [];
  const pending = req?.kind;
  return <div className="m14-composer-wrap">
    {queued.length > 0 && <div className="m14-queue" aria-label="排队消息">{queued.map(q => <div key={q.id} className="m14-queued">
      {q.chips?.length > 0 && <div className="m14-queued-chips"><AttachmentChips items={q.chips} small /></div>}
      <div className="m14-queued-bubble">{q.text}</div>
      <div className="m14-queued-meta"><span>{q.time}</span>
        <button disabled={!ba.steer} title={ba.steer ? '插入当前这一轮，不等本轮结束' : ba.steerReason} onClick={() => { setQueued(qs => qs.filter(x => x.id !== q.id)); onToast(`已插入当前这一轮${q.chips?.length ? `（含 ${q.chips.length} 个附件）` : ''} · 合成`); }}><ArrowUp size={12} />立即发送</button>
        <button aria-label="编辑" title="编辑" onClick={() => { setText(q.text); setChips(q.chips || []); setQueued(qs => qs.filter(x => x.id !== q.id)); }}><Pencil size={12} /></button>
        <button aria-label="删除" title="删除" onClick={() => setQueued(qs => qs.filter(x => x.id !== q.id))}><X size={12} /></button>
      </div></div>)}</div>}
    {statusNode}
    {scenario.background && <div className="m14-composer-above"><BackgroundWork items={scenario.background} onToast={onToast} /></div>}
    {scenario.status === 'stopping' && <Banner tone="warn" icon={<LoaderCircle size={14} className="spin" />} actions={<button className="danger" onClick={() => onToast('已强制停止：结束执行器进程及其子进程（合成）')}>强制停止</button>}><b>Agent 未响应停止</b>（已等待 12 秒）· 可能内存不足，强制停止会结束它的进程</Banner>}
    {scenario.status === 'failed' && !dismissed.conn && <Banner tone="error" icon={<WifiOff size={14} />} actions={<button onClick={() => onToast('正在重新连接…（合成）')}>立即重试</button>} onClose={() => setDismissed(d => ({ ...d, conn: true }))}>与 Codex 的连接已断开，正在重新连接（第 2 次）…</Banner>}
    {unavailable && <Banner tone="warn" icon={<AlertTriangle size={14} />} actions={<><button onClick={() => onToast('正在重新检测本机程序…（合成）')}><RefreshCw size={12} />重新检测</button><button onClick={() => onToast('打开“管理智能体”（M13 设置页）')}>打开设置</button></>}><b>{a.name} {a.status.label}</b> · {a.status.reason}</Banner>}
    {fresh && !running && <Banner tone="info" icon={<RefreshCw size={14} />} actions={<button onClick={() => { setSel(fresh); setFresh(null); onToast('已保持原会话'); }}>保持原会话</button>}>下一条消息会在 <b>{a.name}</b> 开新会话，并把当前任务的上下文交接过去</Banner>}
    {scenario.mergeIssue && !dismissed.merge && <Banner tone="warn" icon={<GitMerge size={14} />} actions={<><button onClick={() => onToast('已让主 Agent 再处理一次（合成）')}>让主 Agent 再试</button><button onClick={() => onToast('打开手动终端，目录 /workspace/SmartDD（合成）')}>打开终端</button></>} onClose={() => setDismissed(d => ({ ...d, merge: true }))}><b>合并未完成，需要你处理</b>：tests/release/arch.test.mjs 还有冲突，cherry-pick 停在一半。WillYou 不会自动回滚。</Banner>}
    {scenario.draftConflict && !dismissed.draft && <Banner tone="warn" icon={<AlertTriangle size={14} />} actions={<><button onClick={() => { setDismissed(d => ({ ...d, draft: true })); setText('（另一窗口的草稿）把 arm64 和 x64 都重建一遍'); }}>使用另一份</button><button onClick={() => setDismissed(d => ({ ...d, draft: true }))}>保留当前</button></>}>这个任务的草稿在另一个窗口被修改过</Banner>}
    {trig && <MentionMenu trig={trig} caps={a.caps} active={active} setActive={setActive} onPick={pickMention} />}
    {scenario.limit && <Banner tone="warn" icon={<Gauge size={14} />}><b>{scenario.limit.agent}额度已用完</b> · 这一轮已暂停，{scenario.limit.resetAt} 重置后可手动继续，不会自动换账号</Banner>}
    <form className={'reference-composer m14-composer' + (pending ? ' has-request' : '') + (dragOver ? ' drag-over' : '')} onSubmit={e => { e.preventDefault(); submit(); }} onDragOver={e => { if (e.dataTransfer.types.includes(FILE_DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true); } }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
      {req && <RequestPanel requests={requests} index={reqIndex} setIndex={setReqIndex} pick={pick} setPick={setPick} note={blocking ? null : rtext} setNote={setRtext} />}
      {req && <div className="m14-approve-actions m14-req-actions">{req.kind === 'question' && <button type="button" className="outline" onClick={() => decide('skip')}>跳过</button>}<button type="button" className="primary" disabled={(!pick && !(req.kind === 'question' && rtext.trim())) || (req.options.find(o => o.key === pick)?.needsText && !rtext.trim())} onClick={() => decide(pick ?? 'text')}>{req.kind === 'question' ? '提交' : '确认'}</button><button type="button" className="reference-send m14-stop" aria-label="停止" title="停止本轮（挂起的请求随之作废）" onClick={() => dispatchEvent(new Event('m14:stop'))}><Square size={11} fill="currentColor" /></button></div>}
      {!blocking && <ComposerChips chips={chips} onRemove={id => setChips(cs => cs.filter(c => c.id !== id))} onRetry={id => { setChips(cs => cs.map(c => c.id === id ? { ...c, state: 'preparing' } : c)); setTimeout(() => setChips(cs => cs.map(c => c.id === id ? { ...c, state: null } : c)), 1200); }} />}
      <textarea ref={box} aria-label="消息输入" placeholder={blocking ? (pending === 'question' ? '输入自己的回答…' : pending === 'plan' ? '发送文字即请 Claude 按意见继续修改计划' : '发送文字即拒绝这次请求并说明原因') : req ? '随心输入；待批准的请求会继续保留' : running ? '继续输入，发送后排队；排队消息可“立即发送”' : '随心输入，@ 引用文件，$ 选用 Skill'} value={blocking ? rtext : text} onChange={e => { const v = e.target.value; if (blocking) setRtext(v); else setText(v); }} onPaste={e => { if (!req && pasteToChips(e, setChips, onToast)) e.preventDefault(); }} onKeyDown={e => {
        if (trig && items.length && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key) && !e.nativeEvent.isComposing) { e.preventDefault(); if (e.key === 'ArrowDown') setActive(i => (i + 1) % items.length); else if (e.key === 'ArrowUp') setActive(i => (i - 1 + items.length) % items.length); else if (e.key === 'Escape') setTrig(null); else pickMention(items[active]); return; }
        if (e.key === 'Escape' && trig) { setTrig(null); return; }
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (blocking && pick) decide(); else submit(); } if (blocking && !rtext && !e.nativeEvent.isComposing && /^[1-9]$/.test(e.key) && req.options[Number(e.key) - 1] && !req.options[Number(e.key) - 1].disabled) { e.preventDefault(); setPick(req.options[Number(e.key) - 1].key); } }} />
      <div className="reference-composer-toolbar">
        <div className="reference-home-picker"><button type="button" className="composer-add" aria-label="添加" aria-expanded={menu === 'add'} onClick={() => setMenu(menu === 'add' ? null : 'add')}><Plus size={20} /></button>
          {menu === 'add' && <div className="reference-home-menu" role="menu"><button role="menuitem" type="button" onClick={() => { setText(t => t + '@'); setMenu(null); }}><FileText size={15} />引用文件（@）</button><button role="menuitem" type="button" onClick={() => { setText(t => t + '$'); setMenu(null); }}><Zap size={15} />选用 Skill（$）</button><button role="menuitem" type="button" onClick={() => { setMenu(null); const id = 'img' + Date.now(); setChips(cs => [...cs, { id, kind: 'image', name: '启动崩溃截图.png', state: 'preparing' }]); setTimeout(() => setChips(cs => cs.map(c => c.id === id ? { ...c, state: null } : c)), 1200); }}><ImageIcon size={15} />添加图片（演示：准备中→完成）</button><button role="menuitem" type="button" onClick={() => { setMenu(null); addChip({ kind: 'file', name: 'fixtures/不可读.txt', state: 'failed', note: '读取失败' }); }}><Plus size={15} />添加附件（演示：失败可重试）</button><div className="popup-divider" /><button role="menuitem" type="button" onClick={() => { setMenu(null); addChip({ kind: 'ref', name: '禅道 Bug #1234 · x64 启动崩溃' }); onToast('已从禅道插入引用到输入框，未发送'); }}><Link2 size={15} />（演示）从插件插入引用</button><p className="m14-menu-note">也可从右侧文件树把文件拖进输入框</p></div>}</div>
        <div className="reference-home-picker m13-perm-picker"><button type="button" className={'m13-perm-trigger' + (permission.danger ? ' danger' : '')} aria-expanded={menu === 'perm'} onClick={() => setMenu(menu === 'perm' ? null : 'perm')}><PermIcon icon={permission.icon} size={16} />{permission.name}</button>
          {menu === 'perm' && <div className="m13-perm-menu" role="menu"><div className="m13-perm-head"><span>应如何批准 {a.name} 的操作？</span><span className="m14-perm-note">每轮发送时显式下发</span></div>{perms.map(p => <button key={p.id} type="button" role="menuitemradio" aria-checked={permission.id === p.id} className={p.danger ? 'danger' : undefined} onClick={() => pickPerm(p)}><PermIcon icon={p.icon} size={16} /><span className="m13-perm-text"><b>{p.name}</b><small>{p.desc}</small></span>{permission.id === p.id && <Check size={16} className="m13-perm-check" />}</button>)}</div>}</div>
        {<button type="button" className={'m14-deleg' + (delegation ? ' on' : '')} aria-pressed={delegation} title={delegation ? '允许 Agent 委派子任务（点击关闭）' : '不允许新委派，单 Agent 工作（点击开启）'} onClick={() => { const next = !delegation; setDelegation(next); onToast(next ? '已允许委派子任务' : scenario.id === 'team' ? '已关闭新委派：现有 3 个子任务完成后回到单 Agent' : '已关闭新委派，本任务以单 Agent 工作'); }}><Network size={14} />{delegation ? '可委派' : '单 Agent'}</button>}
        <>
          <div className="reference-home-picker composer-profile"><ModelPill agent={sel.agent} model={sel.model} effort={sel.effort} open={menu === 'model'} onClick={() => setMenu(menu === 'model' ? null : 'model')} />
            {menu === 'model' && <ModelPicker taskId={taskId} goal={goalLock(taskId, scenario)} agent={sel.agent} model={sel.model} effort={sel.effort} running={running} onToast={onToast} onClose={() => setMenu(null)} onPick={(agentId, modelId, eff, keep) => { const changed = agentId !== sel.agent; if (changed && !running) setFresh(sel); setSel({ agent: agentId, model: modelId, effort: eff }); if (!keep) setMenu(null); if (changed && running) onToast(`本轮仍由 ${ba.name} 执行，本轮结束后切换到 ${AGENTS.find(x => x.id === agentId).name}`); }} />}</div>
          <VoiceButton compact onClick={() => onToast('语音输入（沿用 M7）')} />
          {stopping && !text.trim() ? <button type="button" className="reference-send m14-stop" aria-label="正在停止" title="正在停止，等待执行器确认" disabled><LoaderCircle size={13} className="spin" /></button>
            : running && !text.trim() ? <button type="button" className="reference-send m14-stop" aria-label="停止" title="停止本轮" onClick={() => { dispatchEvent(new Event('m14:stop')); onToast('正在停止…（合成）'); }}><Square size={11} fill="currentColor" /></button>
            : <button type="submit" className="reference-send" aria-label={running ? '排队发送' : '发送'} title={running ? '发送后排队' : '发送 · Enter'} disabled={!text.trim() || unavailable}><ArrowUp size={19} /></button>}
        </>
      </div>
    </form>
    {menu && menu !== 'model' && <button className="home-menu-scrim" aria-label="关闭菜单" tabIndex={-1} onClick={() => setMenu(null)} />}
    {menu === 'model' && <button className="home-menu-scrim" aria-label="关闭菜单" tabIndex={-1} onClick={() => setMenu(null)} />}
  </div>;
}

function TerminalDrawer({ onClose, pending = [] }) {
  return <div className="m14-term" aria-label="手动终端">
    <div className="m14-term-tabs"><button className="on"><SquareTerminal size={13} />zsh</button><button aria-label="新建终端" title="新建终端"><Plus size={13} /></button><span className="m14-term-note">手动终端 · 与 Agent 运行分离，停止 Agent 不会关闭它</span><button aria-label="关闭终端" title="关闭终端（⌃`）" onClick={onClose}><X size={14} /></button></div>
    <pre className="m14-term-body">{'liubu@mac SmartDD % git status --short\n M scripts/build.mjs\n?? tests/release/arch.test.mjs\nliubu@mac SmartDD % '}{pending.length > 0 && <span className="m14-term-pending" title="已送入，未执行">{pending.at(-1)}</span>}<span className="m14-caret" />{pending.length > 0 && <span className="m14-term-hint">{'\n'}↑ 已送入输入行，未执行 · 按回车执行或修改后再执行</span>}</pre>
  </div>;
}

function ScenarioPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const cur = SCENARIOS.find(s => s.id === value);
  const groups = [...new Set(SCENARIOS.map(s => s.group))];
  return <div className="m14-demo">
    <button className="m14-demo-trigger" aria-expanded={open} onClick={() => setOpen(!open)}><ListChecks size={13} />演示状态 · 合成：{cur.name}<ChevronDown size={12} /></button>
    {open && <div className="m14-demo-menu" role="menu">{groups.map(g => <div key={g}><span>{g}</span>{SCENARIOS.filter(s => s.group === g).map(s => <button key={s.id} role="menuitemradio" aria-checked={s.id === value} onClick={() => { onChange(s.id); setOpen(false); }}><b>{s.name}</b><small>{s.desc}</small>{s.id === value && <Check size={13} />}</button>)}</div>)}
      <p>新任务页：左侧“新建任务”，输入框的智能体选择同样改为此选择器。</p></div>}
  </div>;
}

export function m14TaskStatus(s, resolved) {
  if (s.pending && !resolved) return { kind: 'waiting', label: s.pending === 'question' ? '等待回答' : '等待批准' };
  if (s.childApprovals?.length && !resolved) return { kind: 'waiting', label: '等待批准' };
  return { running: { kind: 'running', label: '工作中' }, stopping: { kind: 'running', label: '正在停止' }, waiting: { kind: 'waiting', label: '等待批准' }, failed: { kind: 'failed', label: '失败' }, limited: { kind: 'limited', label: '受限 15:30' }, stopped: { kind: 'stopped', label: '已停止' } }[s.status] || { kind: 'done', label: '已完成' };
}
export function M14TaskArea({ onOpenFile, onRevealDir, onOpenUrl, onOpenDiff, terminalOpen, onTerminal, hasProject = true, projectRoot = '/workspace/SmartDD', taskId, archived = false, onRestore, ptyId, onStatus, initialSel, initialPermission, initialMessage, onChildChange, fullConfirmed, requestFullAccess }) {
  const [linkMenu, setLinkMenu] = useState(null), [delegation, setDelegation] = useState(true), [reqIndex, setReqIndex] = useState(0), [mail, setMail] = useState({ editing: false, edited: false, values: null }), [native, setNative] = useState(null);
  const [diagnostics, setDiagnostics] = useState(false);
  useEffect(() => { const open = () => setDiagnostics(true); addEventListener('m14:diagnostics', open); return () => removeEventListener('m14:diagnostics', open); }, []);
  const [scenarioId, setScenarioId] = useState(() => new URLSearchParams(location.search).get('m14') || 'done');
  const scenario = SCENARIOS.find(s => s.id === (archived ? 'done' : scenarioId)) || SCENARIOS[0];
  const [sel, setSelRaw] = useState(() => taskState(taskId).sel ?? initialSel ?? { agent: 'cc-sub', model: 'default', effort: '中' }); // 首页所选用于新任务，之后归属任务（评审 RV09／RR05）
  const setSel = v => setSelRaw(cur => { const next = typeof v === 'function' ? v(cur) : v; taskState(taskId, { sel: next }); return next; });
  const [bound, setBound] = useState(sel); // 当前一轮实际绑定的执行器；切换只在本轮结束后生效
  const [permission, setPermissionRaw] = useState(() => taskState(taskId).permission ?? PERMISSIONS.find(p => p.id === initialPermission) ?? PERMISSIONS[0]);
  const setPermission = p => { taskState(taskId, { permission: p }); setPermissionRaw(p); };
  const [stopped, setStopped] = useState(false), [termTick, setTermTick] = useState(0); // 停止后挂起请求作废（评审 RR07）
  const [queued, setQueued] = useState(scenario.queued || []);
  const [resolved, setResolved] = useState(false);
  const [openChild, setOpenChild] = useState(null), [lineage, setLineage] = useState(false), [childResolved, setChildResolved] = useState({}), [childStopped, setChildStopped] = useState({});
  const [toast, setToast] = useState(null);
  UICtx.toast = text => setToast({ text }); UICtx.linkMenu = setLinkMenu; UICtx.openDiff = (files, path, turnId) => onOpenDiff?.({ files, path, turnId, revisions: UICtx.revisions ?? [] });
  UICtx.openNative = e => { setLineage(false); setNative(e); };
  UICtx.mail = { ...mail, save: values => { setMail(m => ({ editing: false, edited: true, values, revision: (m.revision ?? 1) + 1 })); setToast({ text: '已保存修改，旧审阅已作废，请再次确认' }); }, cancel: () => setMail(m => ({ ...m, editing: false })) };
  // 代码块送入本任务的手动终端输入区：完整显示、待用户执行，不自动执行（复核 AR08；原型为合成缓冲，未接真实 PTY）
  UICtx.taskId = taskId;
  UICtx.runInTerminal = code => { const prev = taskState(taskId).term ?? []; taskState(taskId, { term: [...prev, code] }); setTermTick(t => t + 1); onTerminal(true); setToast({ text: '已送到手动终端，等待你按回车执行' }); };
  const [openEntries, toggleEntry] = useToggles(), [expandedGroups, toggleGroup] = useToggles(), [expandedTurns, toggleTurn] = useToggles();
  const scroller = useRef(null);
  useEffect(() => { setStopped(false); if (scenario.agent) { const ag = AGENTS.find(x => x.id === scenario.agent); const s2 = { agent: ag.id, model: ag.models[0].id, effort: ag.defaultEffort ?? null }; setSel(s2); setBound(s2); } else setBound(sel); }, [scenario.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setQueued(scenario.queued || []); setResolved(false); setOpenChild(null); setLineage(false); setChildResolved({}); setChildStopped({}); setReqIndex(0); setNative(null); setMail({ editing: false, edited: false, values: null }); const u = new URL(location.href); u.searchParams.set('m14', scenario.id); history.replaceState(null, '', u); requestAnimationFrame(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }); }, [scenario.id]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { const k = e => { if (!archived && e.ctrlKey && e.key === '`') { e.preventDefault(); onTerminal(!terminalOpen); } }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [terminalOpen, onTerminal, archived]);
  const onLink = (href, external) => {
    if (archived) return;
    const r = routeLink(href, { hasProject, projectRoot: ctxRoot });
    if (!r.ok) { setToast({ tone: 'warn', text: r.reason }); return; }
    if (external) { setToast({ text: `系统外部打开：${r.path || r.url}（合成，未启动外部程序）` }); return; }
    if (r.action === 'file') { onOpenFile(r.path, r.line, r.column); setToast({ text: `${r.label}：${r.path}` }); }
    else if (r.action === 'reveal') { onRevealDir(r.path); setToast({ text: `${r.label}：${r.path}/` }); }
    else onOpenUrl(r.url), setToast({ text: `${r.label}：${r.url}` });
  };
  // 停止与批准是不同的状态转移：停止后侧栏、输入框、时间线同为已停止（复核 RR07）
  useEffect(() => { onStatus?.(stopped ? { kind: 'stopped', label: '已停止' } : m14TaskStatus(scenario, resolved)); }, [scenario.id, resolved, stopped]); // eslint-disable-line react-hooks/exhaustive-deps
  const linkAction = act => { const m = linkMenu; setLinkMenu(null); if (!m) return; if (act === 'open') onLink(m.href, false); else if (act === 'external') onLink(m.href, true); else if (act === 'copy-rel') setToast({ text: `已复制相对路径：${m.route.path}` }); else setToast({ text: `已复制：${m.route.url || ctxRoot + '/' + m.route.path}` }); }; // 完整路径按当前工作目录（复核 RR04）
  const eff0 = resolved ? { ...scenario, pending: null, turns: scenario.turns.map(t => ({ ...t, entries: t.entries?.filter(e => e.kind !== 'approval' && e.kind !== 'business'), question: false })) } : scenario;
  const eff = stopped ? { ...eff0, status: 'stopped', pending: null, childApprovals: [] } : eff0;
  const ui = { openEntries, toggleEntry, expandedGroups, toggleGroup, expandedTurns, toggleTurn, waiting: scenario.waiting };
  const line = statusLine(eff);
  useEffect(() => { const h = e => enterChild(e.detail.id); addEventListener('m14:open-child', h); return () => removeEventListener('m14:open-child', h); }, []);
  // 从时间线／请求进入子任务时自动展开任务关系并选中该子任务；任务关系的展开／收起只由右上角按钮控制（用户 2026-11-17 原型评审）
  const enterChild = id => { setOpenChild(id); if (id) setLineage(true); };
  const kids = scenario.children ?? TEAM_CHILDREN;
  const child = openChild && kids.find(c => c.id === openChild);
  // 子任务视图：消息链接按子任务工作目录解析（评审 RR04）
  const ctxRoot = child?.branch ? '/Users/demo/.willyou/worktrees/smartdd-a1b2c3/' + child.branch : projectRoot;
  RootCtx.root = ctxRoot;
  useEffect(() => { onChildChange?.(child ? { id: child.id, title: child.title, branch: child.branch ?? null } : null); }, [child?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onChildChange?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps
  const childState0 = c => childStopped[c.id] ? { ...c, state: 'stopped' } : childResolved[c.id] ? { ...c, state: 'running' } : c;
  const childState = c => childStopped[c.id] ? { ...c, state: 'stopped', live: '已停止本轮', approval: null } : childResolved[c.id] ? { ...c, state: 'running', live: '继续工作', approval: null } : c;
  const lineageCard = lineage && <LineagePanel kids={kids.map(childState0)} vcs={scenario.vcs} merged={scenario.id === 'team-done'} current={openChild} onOpenChild={setOpenChild} onClose={() => setLineage(false)} />;
  UICtx.mailBase = scenario.turns?.[0]?.entries?.find(e => e.kind === 'business')?.fields;
  const requests = stopped ? [] : buildRequests(scenario, { resolved, childResolved: { ...childResolved, ...childStopped }, mailEdited: mail.edited, mailEditing: mail.editing, mailRevision: mail.revision });
  useEffect(() => { const h = () => { if (child) return; setStopped(true); setReqIndex(0); setToast({ text: requests.length ? `已停止本轮，${requests.length} 个挂起请求已作废，旧批准不能再用（合成）` : '正在停止…（合成）' }); }; addEventListener('m14:stop', h); return () => removeEventListener('m14:stop', h); }, [requests.length, child?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const onDecide = (r, key, text) => {
    const extra = text ? `；说明：“${text}”` : '';
    if (r.childId) { if (key === 'open') { enterChild(r.childId); return; } resolveChild(r.childId, (key === 'deny' ? '已拒绝子任务的请求' : '已批准子任务的请求') + extra); setReqIndex(0); return; }
    if (r.kind === 'business' && key === 'agentedit') { setMail(m => ({ ...m, edited: true, revision: (m.revision ?? 1) + 1, values: (m.values || UICtx.mailBase).map(([k, v]) => k === '正文' ? [k, `（Agent 已按你的说明改写）${text || ''}：已补上 mac x64 目标并核对原生模块架构，发布测试 15 项通过。`] : [k, v]) })); setToast({ text: 'Agent 已按你的说明重新起草，请再次确认 · 合成' }); return; }
    if (r.kind === 'business' && key === 'edit') { setMail(m => ({ ...m, editing: true })); setToast({ text: '在上方邮件卡片里修改；保存前不能批准发送' }); return; }
    if (r.kind === 'business' && key === 'approve' && mail.editing) { setToast({ tone: 'warn', text: '邮件还在编辑，先保存再批准' }); return; }
    if (r.kind === 'plan') { if (key === 'revise' && !text) { setToast({ text: '先在下方写修改意见', tone: 'warn' }); return; } setResolved(true); setReqIndex(0); setToast({ text: { approve: '已批准计划，Claude 退出计划模式开始修改', revise: 'Claude 将按意见修改计划后再请你确认', deny: '已拒绝，Claude 不执行' }[key] + extra + ' · 合成' }); return; }
    const label = { once: '已批准一次', session: '本会话内同类命令将自动允许', deny: '已拒绝', approve: '已批准发送，由邮件插件执行', observe: '已允许观察（只读），本次运行有效', control: '已允许控制，本次运行有效', skip: '已跳过该问题', text: '已提交你的回答' }[key] || ('已选择：' + (r.options.find(o => o.key === key)?.label ?? key));
    setResolved(true); setReqIndex(0); setToast({ text: label + extra + ' · 合成' });
  };
  const resolveChild = (cid, text) => { setChildResolved(r => ({ ...r, [cid]: true })); setToast({ text: text + ' · 合成' }); };
  UICtx.revisions = (child ? child.turns : eff.turns).filter(t => t.changes || t.diffState).map((t, idx) => ({ id: t.id, title: t.diffLabel || '改动记录 ' + (idx + 1), files: t.changes || [], status: t.diffState?.kind }));
  const renderTurns = (turns, key) => turns.map(t => <div key={key + t.id} className="m14-turn">
    {t.switchBefore && <SwitchDivider sw={t.switchBefore} />}
    {t.user && <UserRow user={t.user} />}
    {t.auto && <LogRow icon={<CornerIcon />} label={t.autoLabel ?? "子任务完成，主任务自动继续"} />}
    {t.state === 'unknown' ? <div className="m14-unknown"><CircleDashed size={14} /><div><b>发送后连接中断，无法确认 Codex 是否收到这条消息</b><small>正在核对原生记录；确认前不会自动重发</small></div><button onClick={() => setToast({ text: '已重新核对（合成）' })}>重新核对</button></div>
      : t.state === 'queued' ? <div className="m14-queued-turn"><Hourglass size={14} /><div><b>排队中，尚未启动</b><small>主任务本轮结束并交出共用目录的写入资格后，子任务将继续。</small></div></div>
      : <div className="m14-turn-rows">{deriveRows(t, { expandedGroups, expandedTurns }).map(r => <Row key={r.id} row={r} ui={ui} onLink={onLink} onToast={text => setToast({ text })} onOpenChild={archived ? undefined : enterChild} />)}</div>}
  </div>);
  if (child) {
    const c = childState(child);
    const turns = childResolved[c.id] ? c.turns.map(t => ({ ...t, entries: t.entries.filter(e => e.kind !== 'approval') })) : c.turns;
    return <section className={'m14-area' + (lineage ? ' side-lineage' : '')} aria-label="子任务">
      <div className="m14-crumb"><button onClick={() => setOpenChild(null)}><ArrowUpLeft size={13} />检查多平台安装包</button><ChevronRight size={12} /><AgentGlyph r={c} size={14} /><b>{c.title}</b><span className={'m14-pill ' + (c.access === '写入' ? 'write' : 'read')}>{c.access}</span><span className="muted">子任务 · {c.target}</span><button className="m14-lineage-btn" aria-expanded={lineage} onClick={() => setLineage(!lineage)}><Network size={13} />任务关系</button></div>
      {lineageCard}
      <div className="m14-scroll"><div className="m14-timeline">{renderTurns(turns, 'child-' + c.id)}</div></div>
      <div className="m14-bottom"><div className="m14-composer-wrap">
        {c.approval && !childResolved[c.id] && !childStopped[c.id] ? <ChildRequest c={c} onToast={text => setToast({ text })} onStop={() => { setChildStopped(r => ({ ...r, [c.id]: true })); setToast({ text: '已停止该子任务本轮，挂起的请求已作废 · 合成' }); }} onDecide={(key, text) => { const extra = text ? `；说明：“${text}”` : ''; resolveChild(c.id, (key === 'deny' ? '已拒绝子任务的请求' : '已批准子任务的请求') + extra); }} /> : null}
        <SubagentBar c={c} onBack={() => setOpenChild(null)} onToast={text => setToast({ text })} />
      </div></div>
      {toast && <div className={'m14-toast' + (toast.tone === 'warn' ? ' warn' : '')} role="status">{toast.tone === 'warn' ? <AlertTriangle size={14} /> : <Check size={14} />}{toast.text}</div>}
      <LinkMenu menu={linkMenu} onClose={() => setLinkMenu(null)} onAction={linkAction} />
    </section>;
  }
  const effTurns = scenario.children ? eff.turns.map(t => ({ ...t, entries: t.entries.map(e => e.kind === 'subagents' ? { ...e, rows: e.rows.map(childState) } : e) })) : eff.turns;
  return <section className={'m14-area' + (native ? ' side-drawer' : lineage ? ' side-lineage' : '')} aria-label="统一任务区">
    {archived ? <div className="m14-archive-readonly"><span>已归档 · 只读</span><button type="button" className="button secondary" onClick={onRestore}>恢复</button></div> : <div className="m14-demobar"><ScenarioPicker value={scenario.id} onChange={setScenarioId} />{scenario.teamPanel && <button className="m14-lineage-btn" aria-expanded={lineage} onClick={() => setLineage(!lineage)}><Network size={13} />任务关系 · {kids.length}</button>}</div>}
    {lineageCard}
    <div className="m14-scroll" ref={scroller}>
      <div className="m14-timeline">
        {initialMessage && <div className="m14-turn"><UserRow user={{ text: initialMessage.text || '（只有附件）', attachments: initialMessage.chips?.length ? initialMessage.chips : undefined }} /><LogRow icon={<Check size={14} />} label="新任务的第一条消息（含附件）已发送 · 下方为演示状态" /></div>}
        {renderTurns(effTurns, scenario.id)}
        {resolved && !stopped && <LogRow icon={<CheckCircle2 size={14} />} label="请求已处理，Agent 继续工作" />}
        {stopped && <LogRow icon={<Square size={12} />} label="已停止本轮 · 挂起的请求已作废" />}
      </div>
    </div>
    <div className="m14-bottom">
      {archived ? <div className="m14-archive-composer"><textarea aria-label="已归档任务输入" disabled placeholder="恢复后可以继续此会话" /></div> : <Composer requests={requests} reqIndex={Math.min(reqIndex, Math.max(0, requests.length - 1))} setReqIndex={setReqIndex} onDecide={onDecide} taskId={taskId} ptyId={ptyId} delegation={delegation} setDelegation={setDelegation} scenario={eff} sel={sel} setSel={setSel} bound={bound} fullConfirmed={fullConfirmed} requestFullAccess={requestFullAccess} permission={permission} setPermission={setPermission} queued={queued} setQueued={setQueued} onToast={text => setToast({ text })}
        statusNode={line && <div className={'m14-statusline t-' + line.tone}><CircleDashed size={13} /><span>{line.text}</span><span className="m14-statusline-detail">{line.detail}</span><button onClick={() => setToast({ text: '停止范围：主任务及其子任务（合成）' })}>停止</button></div>} />}
      {!archived && terminalOpen && <TerminalDrawer key={termTick} pending={taskState(taskId).term ?? []} onClose={() => onTerminal(false)} />}
    </div>
    {toast && <div className={'m14-toast' + (toast.tone === 'warn' ? ' warn' : '')} role="status">{toast.tone === 'warn' ? <AlertTriangle size={14} /> : <Check size={14} />}{toast.text}</div>}
    {diagnostics && <div className="m14-diagnostics" role="dialog" aria-label="运行诊断">
      <header><strong>运行诊断</strong> <button type="button" onClick={() => setDiagnostics(false)}>关闭</button></header>
      {effTurns.flatMap(t => t.entries.filter(e => e.diagnostic)).map(e => <SysNoteRow key={e.id} e={e} />)}
    </div>}
    {native && <NativeDrawer e={native} onClose={() => setNative(null)} onToast={text => setToast({ text })} />}
    <LinkMenu menu={linkMenu} onClose={() => setLinkMenu(null)} onAction={linkAction} />
  </section>;
}
function CornerIcon() { return <Bell size={14} />; }
// 子任务页的请求：与主任务同一请求面板交互（输入框写原因、数字键选择、Enter 确认；评审 RV11）
function ChildRequest({ c, onDecide, onToast, onStop }) {
  const [pick, setPick] = useState(null), [text, setText] = useState('');
  const reqs = buildRequests({ childApprovals: [c], turns: [] }, {}).map(r => ({ ...r, source: null, options: r.options.filter(o => o.key !== 'open') }));
  const go = (key = pick) => { if (!key) { onToast('请先选择一项'); return; } onDecide(key, text.trim()); };
  return <div className="reference-composer m14-composer has-request m14-child-req"><RequestPanel requests={reqs} index={0} setIndex={() => {}} pick={pick} setPick={setPick} inChild />
    <textarea aria-label="子任务请求说明" placeholder="可选：写下原因或补充说明…" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => {
      if (!text && !e.nativeEvent.isComposing && /^[1-9]$/.test(e.key) && reqs[0].options[Number(e.key) - 1]) { e.preventDefault(); setPick(reqs[0].options[Number(e.key) - 1].key); }
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); go(); } }} />
    <div className="reference-composer-toolbar"><div className="m14-approve-actions"><button type="button" className="primary" disabled={!pick} onClick={() => go()}>确认</button><button type="button" className="reference-send m14-stop" aria-label="停止子任务" title="停止该子任务本轮（请求作废）" onClick={onStop}><Square size={11} fill="currentColor" /></button></div></div></div>;
}

// 新任务页（WillYou 首页）的智能体／模型选择：与任务内同一选择器
export function M14HomeModelPicker({ value, onChange }) {
  const [sel, setSelRaw] = useState(value ?? { agent: 'cc-sub', model: 'default', effort: '中' }); // 回显 App 保存的首页选择（复核 RR05）
  const setSel = v => { setSelRaw(v); onChange?.(v); }; // 首页所选交给创建任务（评审 RV09）
  const [open, setOpen] = useState(false), [toast, setToast] = useState(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2500); return () => clearTimeout(t); }, [toast]);
  return <div className="reference-home-picker composer-profile m14-home-picker">
    <ModelPill agent={sel.agent} model={sel.model} effort={sel.effort} open={open} onClick={() => setOpen(!open)} />
    {open && <><button type="button" className="home-menu-scrim m14-fixed-scrim" aria-label="关闭菜单" tabIndex={-1} onClick={() => setOpen(false)} /><ModelPicker agent={sel.agent} model={sel.model} effort={sel.effort} onToast={setToast} onClose={() => setOpen(false)} onPick={(agent, model, effort, keep) => { setSel({ agent, model, effort }); if (!keep) setOpen(false); }} /></>}
    {toast && <div className="m14-toast home" role="status"><Check size={14} />{toast}</div>}
  </div>;
}
