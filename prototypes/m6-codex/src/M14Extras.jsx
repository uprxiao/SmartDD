// M14 原型 P0.7 补充组件：对照《T3 对照遗漏清单》补齐的时间线条目、消息细节、输入框与任务级提示。全部为合成数据。
import { goalStatus, setGoalStatus } from './m14-model.mjs';
import { useEffect, useRef, useState } from 'react';
import { Pause, Target } from 'lucide-react';
import { AlertTriangle, ArrowRightLeft, Bell, Bot, Check, ChevronDown, ChevronRight, CircleDashed, Copy, Download, FileText, Globe, Hourglass, Image as ImageIcon, Info, ListTodo, LoaderCircle, Mail, Minimize2, Paperclip, Play, RefreshCw, Save, ShieldAlert, Slash, SquareTerminal, Terminal, WrapText, X, Zap, Link2, Activity, WifiOff } from 'lucide-react';

// ---------- 时间线条目 ----------
// 目标（/goal，照 T3 goal 条目）：显示目标、状态、时长与轮次（不显示 token）。Codex 可暂停／继续／清除；Claude 和 Gemini 只提供清除。
export function GoalComposerMode({ onExit }) {
  return <button type="button" className="m14-goal-mode" aria-label="退出目标模式" onClick={onExit}>
    <Target size={14} />目标<X size={12} />
  </button>;
}

export function GoalRow({ e, onToast, taskId = 'demo' }) {
  const [open, setOpen] = useState(false), [st, setStRaw] = useState(() => goalStatus(taskId, e));
  useEffect(() => { setStRaw(goalStatus(taskId, e)); }, [taskId, e.id, e.rev]);
  const setSt = v => { setGoalStatus(taskId, e, v); setStRaw(v); dispatchEvent(new Event('m14:goal')); };
  const codex = e.agent === 'codex';
  const name = e.agent === 'claude' ? 'Claude Code' : 'Gemini';
  // 停止键（评审 RV13）：Codex 停止＝暂停目标；Claude 只停本轮，目标保留
  useEffect(() => { const h = () => { if (codex && st === 'active') { setSt('paused'); onToast('已停止本轮并暂停目标（合成）'); } else if (!codex && st === 'active') onToast(`已停止本轮。${name} 的目标保留（合成）`); }; addEventListener('m14:stop', h); return () => removeEventListener('m14:stop', h); }, [codex, name, st]); // eslint-disable-line react-hooks/exhaustive-deps
  if (st === 'cleared') return <div className="m14-goal-cleared"><Target size={13} />目标已清除</div>;
  const label = { active: '进行中', paused: '已暂停', 'waiting-children': '等子任务 · 已自动暂停', complete: '已完成' }[st];
  const m = Math.floor(e.secs / 60), sec = e.secs % 60;
  return <div className={'m14-goal s-' + st}>
    <button className="m14-goal-head" aria-expanded={open} onClick={() => setOpen(!open)}>
      <Target size={14} /><b>目标</b><span className="m14-goal-obj">{e.objective}</span>
      <span className={'m14-goal-st' + (st === 'active' ? ' live' : '')}>{st === 'active' && e.working !== false && <LoaderCircle size={11} className="spin" />}{st === 'active' && e.working === false ? '已设定' : label}</span>
      <span className="m14-goal-meta">{m} 分 {sec} 秒 · 第 {e.turns} 轮</span><ChevronRight size={12} className={'m14-chev' + (open ? ' open' : '')} />
    </button>
    {open && <div className="m14-goal-body">
      <p>{e.objective}</p>
      {st === 'waiting-children' && <p className="m14-goal-note">主任务在等子任务结果，WillYou 已自动暂停目标；子任务结果回来会自动继续，不需要你操作。</p>}
      {!codex && <p className="m14-goal-note">{name} 提供清除。按停止会结束当前回合，目标保留。</p>}
      {codex && st === 'active' && <p className="m14-goal-note">按停止＝停止这一轮并暂停目标。</p>}
      <div className="m14-goal-actions">
        {codex && st === 'active' && <button onClick={() => { setSt('paused'); onToast('目标已暂停（合成）'); }}><Pause size={12} />暂停</button>}
        {codex && st === 'paused' && <button onClick={() => { setSt('active'); onToast('目标已继续，Codex 开始下一轮（合成）'); }}><Play size={12} />继续</button>}
        <button onClick={() => { setSt('cleared'); onToast('目标已清除（合成）'); }}><X size={12} />清除</button>
      </div>
    </div>}
  </div>;
}

// A1 业务审批卡（M13 插件写操作／邮件／浏览器访问）：时间线显示审阅内容，按钮在输入框位置
export function BusinessApprovalRow({ e, mail }) {
  const Icon = e.pluginIcon === 'mail' ? Mail : e.pluginIcon === 'globe' ? Globe : Zap;
  const fields = mail?.values || e.fields;
  const [draft, setDraft] = useState(fields);
  useEffect(() => { if (mail?.editing) setDraft(fields); }, [mail?.editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const editable = k => k !== '发件账号'; // 发件账号由项目配置决定，审批时不能改用其他账号
  return <div className={'m14-biz' + (mail?.editing ? ' editing' : '')}>
    <div className="m14-biz-head"><span className="m14-biz-icon"><Icon size={14} /></span><b>{e.plugin}</b><span>请求：{e.action}</span>{mail?.edited && !mail.editing && <span className="m14-biz-edited">已修改</span>}<span className="m14-biz-tag">需要批准</span></div>
    {mail?.editing ? <div className="m14-biz-form">
      {draft.map(([k, v], i) => <label key={k}><span>{k}</span>{!editable(k) ? <em>{v}</em> : k === '正文' ? <textarea value={v} rows={4} onChange={ev => setDraft(d => d.map((x, j) => j === i ? [x[0], ev.target.value] : x))} /> : <input value={v} onChange={ev => setDraft(d => d.map((x, j) => j === i ? [x[0], ev.target.value] : x))} />}</label>)}
      <div className="m14-biz-form-actions"><button onClick={() => mail.cancel()}>取消</button><button className="primary" onClick={() => mail.save(draft)}>保存修改</button></div>
    </div> : <dl>{fields.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
    <p><ShieldAlert size={12} />{e.note}</p>
  </div>;
}
// A5 系统提示（hooks、MCP 启动、配置告警、自动审核）：单行、低打扰，点开看详情
export function SysNoteRow({ e }) {
  const [open, setOpen] = useState(false);
  const warn = e.level === 'warn';
  return <div className={'m14-sysnote' + (warn ? ' warn' : '')}>
    <button aria-expanded={open} onClick={() => setOpen(!open)}>{warn ? <AlertTriangle size={13} /> : <Info size={13} />}<span>{e.text}</span><ChevronRight size={11} className={'m14-chev' + (open ? ' open' : '')} /></button>
    {open && <p>{e.detail}</p>}
  </div>;
}
// A2 计划卡（T3 ProposedPlanCard）
export function PlanCard({ e, onToast }) {
  const [open, setOpen] = useState(true), [menu, setMenu] = useState(false);
  return <div className="m14-plan">
    <div className="m14-plan-head"><button className="m14-plan-toggle" aria-expanded={open} onClick={() => setOpen(!open)}><ChevronRight size={13} className={'m14-chev' + (open ? ' open' : '')} /><b>计划</b><span>{e.title}</span>{e.source && <small className="m14-plan-src">{e.source}</small>}</button>
      <div className="m14-plan-actions"><button aria-label="复制计划" title="复制" onClick={() => onToast('已复制计划')}><Copy size={13} /></button><div className="reference-home-picker"><button aria-label="更多" aria-expanded={menu} onClick={() => setMenu(!menu)}><ChevronDown size={13} /></button>
        {menu && <div className="reference-home-menu down-right" role="menu"><button role="menuitem" onClick={() => { setMenu(false); onToast('已下载 计划.md（合成）'); }}><Download size={14} />下载为 Markdown</button><button role="menuitem" onClick={() => { setMenu(false); onToast('已保存到 docs/计划.md（合成，需写入授权）'); }}><Save size={14} />保存到项目</button></div>}</div></div></div>
    {open && <ol>{e.steps.map(x => <li key={x}>{x.replace(/^\d+\.\s*/, '')}</li>)}</ol>}
  </div>;
}
// A3 待办清单（T3 todo_list：独立行，列表图标）
export function TodoRow({ e }) {
  const [open, setOpen] = useState(true);
  const done = e.items.filter(i => i[1] === 'done').length;
  return <div className="m14-entry">
    <button className="m14-log" aria-expanded={open} onClick={() => setOpen(!open)}><span className="m14-log-icon"><ListTodo size={14} /></span><span className="m14-log-label">待办 {done}／{e.items.length}</span><ChevronRight size={12} className={'m14-chev' + (open ? ' open' : '')} /></button>
    {open && <ul className="m14-todo">{e.items.map(([t, st]) => <li key={t} className={'s-' + st}>{st === 'done' ? <Check size={12} /> : st === 'doing' ? <LoaderCircle size={12} className="spin" /> : <CircleDashed size={12} />}{t}</li>)}</ul>}
  </div>;
}
// A4 上下文压缩分隔（T3 context-compaction）
export function CompactionRow({ e }) {
  return <div className="m14-divider m14-compact"><span /><em><Minimize2 size={12} />上下文已压缩</em><span /></div>;
}
// A9 执行器内置子 Agent（provider_native）：时间线上一行，点开后在主任务区从左向右滑出抽屉，只读查看过程
export function NativeSubagentRow({ e, onOpen }) {
  return <div className="m14-native">
    <button className="m14-native-head" onClick={() => onOpen(e)}><Bot size={14} /><span><b>{e.title}</b><small>{e.agentKind}</small></span><span className="m14-state s-running"><LoaderCircle size={11} className="spin" />运行中 {e.secs} 秒</span><span className="m14-native-open">查看过程</span></button>
  </div>;
}
export function NativeDrawer({ e, onClose, onToast }) {
  useEffect(() => { const k = ev => ev.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  return <div className="m14-ndrawer-wrap">
    <aside className="m14-ndrawer" role="complementary" aria-label="内置子 Agent 过程">
      <div className="m14-ndrawer-head"><Bot size={15} /><span><b>{e.title}</b><small>{e.agentKind}</small></span><span className="m14-state s-running"><LoaderCircle size={11} className="spin" />运行中 {e.secs} 秒</span><button aria-label="关闭抽屉" onClick={onClose}><X size={15} /></button></div>
      <p className="m14-ndrawer-note">{e.note}。只读查看，更早的步骤执行器没有公开。</p>
      <ol className="m14-native-steps">{e.steps.map((x, i) => <li key={x} className={i === e.steps.length - 1 ? 'live' : ''}>{i === e.steps.length - 1 ? <LoaderCircle size={12} className="spin" /> : <Check size={12} />}<span className={i === e.steps.length - 1 ? 'm14-shine' : ''}>{x}</span></li>)}</ol>
      <div className="m14-ndrawer-foot"><button onClick={() => onToast('已请求停止（整个主任务一起停止，合成）')}>停止主任务</button></div>
    </aside></div>;
}
// D8 改动记录的其他状态
export function DiffStateNote({ st, onToast }) {
  if (!st) return null;
  if (st.kind === 'preparing') return <div className="m14-diffstate"><LoaderCircle size={13} className="spin" /><span><b>正在准备改动记录 {st.pct}%</b><small>{st.note}</small></span><button onClick={() => onToast('已取消本次准备，本轮差异标为不可用（合成）')}>取消</button></div>;
  if (st.kind === 'incomplete') return <div className="m14-diffstate warn"><AlertTriangle size={13} /><span><b>改动记录不完整</b><small>{st.note}</small></span></div>;
  return <div className="m14-diffstate warn"><AlertTriangle size={13} /><span><b>{st.kind === 'reclaimed' ? '快照已清理（空间回收）' : st.kind === 'storage-full' ? '影子库空间已满' : '本轮改动记录不可用'}</b><small>{st.note}</small></span></div>;
}

// ---------- 消息细节 ----------
// B2 代码块（T3 MarkdownCodeBlock：复制、换行、在终端运行）
export function CodeBlock({ lang, code, onToast, onRunInTerminal }) {
  const [wrap, setWrap] = useState(false);
  return <div className="m14-code">
    <div className="m14-code-head"><span>{lang || '代码'}</span><div>
      {['bash', 'sh', 'zsh', 'shell'].includes(lang) && <button title="送到手动终端（不自动执行）" onClick={() => onRunInTerminal(code)}><Play size={12} />在终端运行</button>}
      <button title={wrap ? '不换行' : '自动换行'} onClick={() => setWrap(!wrap)}><WrapText size={12} /></button>
      <button title="复制代码" onClick={() => onToast('已复制代码')}><Copy size={12} /></button></div></div>
    <pre className={wrap ? 'wrap' : ''}><code>{code}</code></pre>
  </div>;
}
// B5 链接右键菜单（T3 MarkdownFileLink／OpenInPicker）
export function LinkMenu({ menu, onClose, onAction }) {
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  if (!menu) return null;
  const isUrl = menu.route.action === 'browser';
  return <><button className="m14-fixed-scrim" style={{ background: 'transparent' }} aria-label="关闭菜单" onClick={onClose} /><div className="reference-popup m14-linkmenu" role="menu" style={{ left: menu.x, top: menu.y }}>
    {menu.route.ok ? <>
      <button role="menuitem" onClick={() => onAction('open')}>{isUrl ? <Globe size={14} /> : <FileText size={14} />}{isUrl ? '在内置浏览器打开' : menu.route.action === 'reveal' ? '在文件树中定位' : '在文件区打开'}</button>
      <button role="menuitem" onClick={() => onAction('external')}><ArrowRightLeft size={14} />{isUrl ? '用系统浏览器打开' : '用编辑器打开…'}</button>
      {!isUrl && <><div className="popup-divider" /><button role="menuitem" onClick={() => onAction('copy-full')}><Copy size={14} />复制完整路径</button><button role="menuitem" onClick={() => onAction('copy-rel')}><Copy size={14} />复制相对路径</button></>}
      {isUrl && <button role="menuitem" onClick={() => onAction('copy-full')}><Copy size={14} />复制链接</button>}
    </> : <div className="m14-linkmenu-blocked"><AlertTriangle size={13} />{menu.route.reason}</div>}
  </div></>;
}
// B3 用户消息的附件／引用标签
export function AttachmentChips({ items, small }) {
  return <div className={'m14-chips' + (small ? ' small' : '')}>{items.map(a => <span key={a.name} className={'m14-chip k-' + a.kind}>{a.kind === 'image' ? <span className="m14-thumb"><ImageIcon size={14} /></span> : a.kind === 'ref' ? <Link2 size={12} /> : <FileText size={12} />}<span>{a.name}</span></span>)}</div>;
}

// ---------- 输入框 ----------
// C1 “@ 文件／$ Skill／/ 命令”菜单（T3 ComposerCommandMenu）
const FILES = ['scripts/build.mjs', 'scripts/release/notes.mjs', 'src/main.ts', 'src/renderer/App.tsx', 'tests/release/arch.test.mjs', 'docs/', 'docs/需求.md', 'package.json', 'electron-builder.config.cjs'];
const SKILLS = [['项目', 'willyou-project-db-diagnostics', '按项目配置做只读数据库诊断'], ['项目', 'willyou-remote-password-ssh', '使用项目服务器配置执行 SSH 排查'], ['WillYou 插件', 'willyou-browser-reproduce-bug', '在内置浏览器复现并验证 Bug'], ['WillYou 纳管', 'source-driven-ui-test', '从源码生成页面测试'], ['执行器自带', 'code-review', 'Claude Code 自带的代码审查']];
const COMMANDS = [['执行器自带', '/compact', '压缩上下文（执行器公布时才出现）', 'compact'], ['WillYou', '/model', '切换智能体与模型'], ['WillYou', '/terminal', '打开手动终端'], ['WillYou', '/delegate', '把一项工作委派给子任务'], ['执行器自带', '/goal', '设定目标，跨多轮工作直到完成', 'goal'], ['执行器自带', '/review', 'Codex 自带：审查当前改动', 'review'], ['执行器自带', '/init', 'Claude Code 自带：生成 CLAUDE.md', 'init']];
// 手输命令与菜单共用同一能力判定（评审 RR08）：返回被拦下的命令名，或 null
export function slashBlocked(text, caps) { const m = /^(\/[a-z]+)\b/.exec(text.trim()); if (!m) return null; const c = COMMANDS.find(x => x[1] === m[1]); return c && c[3] && !caps?.[c[3]] ? m[1] : null; }
export function mentionTrigger(text) { const m = /(^|\s)([@$/])([^\s@$/]*)$/.exec(text); return m ? { ch: m[2], q: m[3], start: text.length - m[3].length - 1 } : null; }
// 命令只列当前执行器支持的项（caps 来自执行器能力声明；评审 RV14）
const cmdOk = (c, caps) => !c[3] || !!caps?.[c[3]];
function matchSkills(query) {
  const rank = name => name === query ? 0 : name.startsWith(query) ? 1 : 2;
  return SKILLS.filter(([, name]) => name.includes(query)).sort((a, b) =>
    rank(a[1]) - rank(b[1]) || Number(b[0] === 'WillYou 纳管') - Number(a[0] === 'WillYou 纳管') || a[1].localeCompare(b[1]));
}
export function MentionMenu({ trig, onPick, active, setActive, caps }) {
  const q = trig.q.toLowerCase();
  const items = trig.ch === '@' ? FILES.filter(f => f.toLowerCase().includes(q)).map(f => ({ group: f.endsWith('/') ? '文件夹' : '文件', label: f, insert: '@' + f, chip: { kind: 'file', name: f } }))
    : trig.ch === '$' ? matchSkills(q).map(([g, n, d]) => ({ group: g, label: n, desc: d, insert: '$' + n, chip: { kind: 'skill', name: n } }))
    : COMMANDS.filter(c => cmdOk(c, caps) && c[1].includes('/' + q)).map(([g, n, d]) => ({ group: g, label: n, desc: d, insert: n }));
  useEffect(() => { setActive(0); }, [trig.ch, trig.q]); // eslint-disable-line react-hooks/exhaustive-deps
  if (trig.ch === '$') {
    return items.length ? <div className="m14-mention m14-mention-skills" role="listbox" aria-label="选择技能">
      {items.map((it, i) => <button key={it.label} type="button" role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); onPick(it); }}>
        <Zap size={14} aria-hidden /><span title={it.insert}>{it.insert}</span>
        {it.desc && <small title={it.desc}>{it.desc}</small>}<span className="m14-mention-skill-source">{it.group}</span>
      </button>)}
    </div> : <div className="m14-mention" role="status"><p>没有匹配的技能</p></div>;
  }
  const title = trig.ch === '@' ? '文件和文件夹' : '命令';
  let last = null;
  return <div className="m14-mention" role="listbox" aria-label={title}>
    <div className="m14-mention-title">{title}<span>↑↓ 选择 · Enter 插入 · Esc 关闭</span></div>
    {items.length ? items.map((it, i) => { const head = it.group !== last ? (last = it.group) : null; return <div key={it.label}>{head && <div className="m14-mention-group">{head}</div>}
      <button role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); onPick(it); }}>
        {trig.ch === '@' ? <FileText size={13} /> : <Slash size={13} />}<span>{it.label}</span>{it.desc && <small>{it.desc}</small>}</button></div>; })
      : <p>{trig.ch === '@' ? '没有匹配的文件或文件夹' : '没有匹配的命令'}</p>}
  </div>;
}
export function mentionItems(trig, caps) { const q = trig.q.toLowerCase(); return trig.ch === '@' ? FILES.filter(f => f.toLowerCase().includes(q)).map(f => ({ insert: '@' + f, chip: { kind: 'file', name: f } })) : trig.ch === '$' ? matchSkills(q).map(s => ({ insert: '$' + s[1], chip: { kind: 'skill', name: s[1] } })) : COMMANDS.filter(c => cmdOk(c, caps) && c[1].includes('/' + q)).map(c => ({ insert: c[1] })); }
// C2／C3 输入框里的附件（照 Codex）：图片是缩略图卡片，文件是“预览＋文件名”卡片；技能、插件引用是小标签
export function ComposerChips({ chips, onRemove, onRetry }) {
  if (!chips.length) return null;
  const cards = chips.filter(c => c.kind === 'image' || c.attach), tags = chips.filter(c => !(c.kind === 'image' || c.attach));
  return <div className="m14-attach">
    {cards.length > 0 && <div className="m14-acards">{cards.map(c => <div key={c.id} className={'m14-acard k-' + (c.kind === 'image' ? 'image' : 'file') + (c.state ? ' st-' + c.state : '')} title={c.name}>
      <div className="m14-acard-preview">{c.kind === 'image' ? <span className="m14-acard-img" /> : <span className="m14-acard-doc">{[70, 90, 55, 80, 40, 65].map((w, i) => <i key={i} style={{ width: w + '%' }} />)}</span>}
        {c.state === 'preparing' && <span className="m14-acard-over"><LoaderCircle size={16} className="spin" /></span>}
        {c.state === 'failed' && <span className="m14-acard-over fail"><button type="button" onClick={() => onRetry(c.id)}><RefreshCw size={12} />重新添加</button></span>}</div>
      {c.kind !== 'image' && <div className="m14-acard-name"><FileText size={13} /><span>{c.name}</span></div>}
      {c.note && <small className="m14-acard-note">{c.note}</small>}
      <button type="button" className="m14-acard-x" aria-label={'移除 ' + c.name} onClick={() => onRemove(c.id)}><X size={12} /></button></div>)}</div>}
    {tags.length > 0 && <div className="m14-cchips">{tags.map(c => <span key={c.id} className={'m14-cchip k-' + c.kind}>{c.kind === 'skill' ? <Zap size={12} /> : c.kind === 'ref' ? <Link2 size={12} /> : <FileText size={12} />}<span className="m14-cchip-name" title={c.name}>{c.name}</span><button type="button" aria-label={'移除 ' + c.name} onClick={() => onRemove(c.id)}><X size={11} /></button></span>)}</div>}
  </div>;
}
// ⌘V 粘贴：图片→缩略图卡片；文件→目录内按路径引用，目录外复制为附件（浏览器拿不到真实路径，原型一律按“项目外文件”演示）
export function pasteToChips(e, setChips, onToast) {
  return addFilesToChips(Array.from(e.clipboardData?.files ?? []), setChips, onToast);
}
export function addFilesToChips(files, setChips, onToast) {
  if (!files.length) return false;
  for (const f of files) {
    const id = 'p' + Date.now() + Math.random();
    const image = f.type.startsWith('image/');
    setChips(cs => [...cs, { id, kind: image ? 'image' : 'file', attach: !image, name: f.name || (image ? '粘贴的图片.png' : '粘贴的文件'), state: 'preparing', note: image ? null : '项目外文件，已复制为附件' }]);
    setTimeout(() => setChips(cs => cs.map(c => c.id === id ? { ...c, state: null } : c)), 900);
  }
  onToast?.(`已添加 ${files.length} 个${files.every(f => f.type.startsWith('image/')) ? '图片' : '文件'}（未发送）`);
  return true;
}
// C4 执行器状态横幅（T3 ProviderStatusBanner）／C6 新会话提示（ComposerFreshSession）／D4 错误与断线（ThreadErrorBanner、系统横幅）／C11 草稿冲突
export function Banner({ tone = 'info', icon, children, actions, onClose }) {
  return <div className={'m14-banner2 t-' + tone}>{icon}<span className="m14-banner2-text">{children}</span>{actions}{onClose && <button className="m14-banner2-x" aria-label="关闭提示" onClick={onClose}><X size={12} /></button>}</div>;
}
// C8 上下文用量环（T3 ThreadDetailsUsage／ComposerUsageLimits）
export function UsageRing({ value, onClick }) {
  const r = 7, c = 2 * Math.PI * r, warn = value >= 0.85;
  return <button type="button" className={'m14-usage' + (warn ? ' warn' : '')} title={`上下文已用 ${Math.round(value * 100)}% · ${Math.round(value * 200)}k／200k tokens；订阅额度本周剩余 40%，周一 09:00 重置`} onClick={onClick} aria-label="上下文用量">
    <svg width="16" height="16" viewBox="0 0 18 18"><circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2.4" /><circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeWidth="2.4" strokeDasharray={c} strokeDashoffset={c * (1 - value)} transform="rotate(-90 9 9)" /></svg><span>{Math.round(value * 100)}%</span>
  </button>;
}
// A10 后台工作（T3 BackgroundWorkDetails）
export function BackgroundWork({ items, onToast }) {
  const [open, setOpen] = useState(false);
  return <div className="m14-bgwork">
    <button className="m14-bgwork-btn" aria-expanded={open} onClick={() => setOpen(!open)}><Activity size={12} />后台工作 {items.length}<ChevronDown size={11} className={'m14-chev-d' + (open ? ' open' : '')} /></button>
    {open && <div className="m14-bgwork-pop" role="dialog" aria-label="后台工作">{items.map(b => <div key={b.id} className="m14-bgwork-row"><Terminal size={13} /><span><b>{b.name}</b><small>{b.kind} · {b.state === 'running' ? '运行中' : '等待'} {Math.floor(b.secs / 60) ? Math.floor(b.secs / 60) + ' 分 ' : ''}{b.secs % 60} 秒</small></span><button onClick={() => onToast(`已停止后台工作「${b.name}」（合成）`)}>停止</button></div>)}<p>后台工作独立于回合；回合结束后仍会继续，停止主任务时一并停止。</p></div>}
  </div>;
}
// D2 系统通知（示意）
export function MockNotification({ text, sub, onClose, shifted }) {
  useEffect(() => { const t = setTimeout(onClose, 6000); return () => clearTimeout(t); }, [onClose]);
  return <div className={'m14-notify' + (shifted ? ' shifted' : '')} role="status"><img src="/assets/app-icon.png" alt="" /><span><b>WillYou</b><small className="m14-notify-tag">系统通知（示意）</small><em>{text}</em><small>{sub}</small></span><button aria-label="关闭" onClick={onClose}><X size={12} /></button></div>;
}

// 右侧面板的“终端”（手动终端，与 Agent 运行分离；底部抽屉是同一能力的另一个位置）
export function ManualTerminal({ cwd }) {
  return <div className="m14-term surface" aria-label="手动终端">
    <div className="m14-term-tabs"><button className="on"><SquareTerminal size={13} />zsh</button><button aria-label="新建终端" title="新建终端"><Play size={12} style={{ display: 'none' }} />＋</button><span className="m14-term-note">手动终端 · 与 Agent 运行分离，停止 Agent 不会关闭它</span></div>
    <pre className="m14-term-body">{`liubu@mac ${cwd.split('/').pop()} % git status --short\n M scripts/build.mjs\n?? tests/release/arch.test.mjs\nliubu@mac ${cwd.split('/').pop()} % `}<span className="m14-caret" /></pre>
  </div>;
}
