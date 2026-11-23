// M14 统一任务区原型的合成数据与纯逻辑。不读本机文件、不连模型、不发网络请求。
// 依据：需求 R1.1（R01–R13）、技术方案 T1.1 §4/§5/§6/§9/§10/§11、原型说明 P0.3 的 S01–S15。

export const PROJECT_ROOT = '/workspace/SmartDD';
// 原型文件区中“不存在”的路径（真实 App 由文件服务核对存在性）
const MISSING = new Set(['fixtures/已删除.md', 'src/missing.ts']);
const DIRECTORIES = new Set(['docs', 'src', 'src/renderer', 'fixtures', 'resources', 'scripts']);

// ---------- 智能体与权限（合成） ----------
export const AGENTS = [
  { id: 'cc-sub', tool: 'claude', caps: { goal: true, compact: true, init: true }, name: 'Claude Code · 订阅', short: 'Claude Code', source: '本机登录（订阅）', models: [{ id: 'default', name: '默认模型', note: '执行器当前默认' }, { id: 'opus', name: 'Opus' }, { id: 'sonnet', name: 'Sonnet' }, { id: 'haiku', name: 'Haiku' }, { id: 'opus-1m', name: 'Opus（1M 上下文）', more: true }], efforts: ['低', '中', '高'], defaultEffort: '中', steer: true },
  { id: 'cc-ds', tool: 'claude', caps: { goal: true, compact: true, init: true }, provider: true, name: 'Claude Code · DeepSeek', short: 'DeepSeek', source: 'WillYou 托管 · 隔离配置', models: [{ id: 'deepseek-flash', name: 'deepseek-flash' }, { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' }], efforts: ['低', '高', '最高'], defaultEffort: '高', steer: true },
  { id: 'cx-sub', tool: 'codex', caps: { goal: true, compact: true, review: true }, name: 'Codex · 订阅', short: 'Codex', source: '本机登录（订阅）', models: [{ id: 'gpt-6.2-sol', name: 'GPT-6.2-Sol' }, { id: 'default', name: '执行器默认' }], efforts: ['低', '中等', '高'], defaultEffort: '中等', steer: true },
  { id: 'cx-ds', tool: 'codex', caps: { goal: true, compact: true, review: true }, provider: true, name: 'Codex · DeepSeek', short: 'Codex', source: 'WillYou 托管 · 隔离配置', models: [{ id: 'deepseek-flash', name: 'deepseek-flash' }], efforts: ['低', '中', '高'], defaultEffort: '中', steer: true },
  { id: 'cx-hub', tool: 'codex', caps: { goal: true, compact: true, review: true }, provider: true, providerBadge: { catalog: 'ultracloud', name: 'Model Hub' }, name: 'Codex · Model Hub', short: 'Codex · Model Hub', source: 'WillYou 托管 · 合成目录', models: [{ id: 'gpt-6.1-sol', name: 'gpt-6.1-sol', efforts: ['低', '中等', '高', '更高', '最高'], defaultEffort: '中等' }, { id: 'gpt-6-astra', name: 'gpt-6-astra' }], efforts: [], steer: true },
  { id: 'cc-hub', tool: 'claude', caps: { goal: true, compact: true, init: true }, provider: true, providerBadge: { catalog: 'ultracloud', name: 'Model Hub' }, name: 'Claude Code · Model Hub', short: 'Claude Code · Model Hub', source: 'WillYou 托管 · 合成目录', models: [{ id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5' }, { id: 'declared-claude-effort', name: '档位声明示例（合成）', efforts: ['低', '中等', '高'] }], efforts: [], steer: true },
  { id: 'cc-rj', tool: null, name: 'CC-rj', short: 'CC-rj', source: '本机程序 · 旧版配置', status: { kind: 'unavailable', label: '不可用', reason: '本机 claude 2.0.1 低于已验证的最低版本 2.1.321，请升级后重新检测' }, models: [{ id: 'default', name: '默认模型', note: '执行器当前默认' }], efforts: [], steer: false, steerReason: '未验证运行中插话，只能排队' },
  { id: 'oc', name: 'OpenCode', placeholder: '后续接入', models: [] },
];
export const PERMISSIONS = [
  { id: 'ask', name: '请求批准', icon: 'hand', desc: '编辑外部文件和使用互联网时始终询问' },
  { id: 'auto', name: '帮我批准', icon: 'shield', desc: '由执行器自动审核；插件写操作仍由 WillYou 询问' },
  { id: 'full', name: '完全访问', icon: 'alert', danger: true, desc: '不再询问（发送邮件除外），首次使用需确认' },
];

// ---------- 链接识别与路由（D2：按 T3 规则；只有文件名不做链接） ----------
// 识别：Markdown 链接、http(s)、file://、绝对路径、含“/”的相对路径（可带 :行:列）、以“/”结尾的目录。
const URL_RE = /^(?:https?:\/\/|www\.)[^\s)]+$/;
const PATH_RE = /^(?:file:\/\/)?(\/|\.{1,2}\/)?[\w.\-一-龥]+(?:\/[\w.\-一-龥]*)*(?::\d+(?::\d+)?)?$/;
export function classifyToken(raw) {
  const text = raw.trim();
  if (!text) return null;
  if (/^(javascript|mailto|data|vbscript):/i.test(text)) return { kind: 'protocol', href: text };
  if (URL_RE.test(text)) return { kind: 'url', href: text.startsWith('www.') ? 'http://' + text : text };
  if (!PATH_RE.test(text)) return null;
  const body = text.replace(/^file:\/\//, '');
  const isFileUrl = text.startsWith('file://');
  // 只有文件名（不含路径分隔符、不是 file://）按纯文本处理，即使项目里真有这个文件
  if (!isFileUrl && !body.includes('/')) return null;
  return { kind: 'path', href: text };
}
function normalize(parts) {
  const out = [];
  for (const p of parts) { if (!p || p === '.') continue; if (p === '..') out.pop(); else out.push(p); }
  return out.join('/');
}
// 返回打开动作或拒绝原因。项目 null 表示“无项目任务”。
export function routeLink(href, { projectRoot = PROJECT_ROOT, hasProject = true } = {}) {
  const c = classifyToken(href) ?? (URL_RE.test(href) ? { kind: 'url', href } : { kind: 'path', href });
  if (c.kind === 'protocol') return { ok: false, reason: `不支持的链接协议「${href.split(':')[0]}:」，已阻止打开` };
  if (c.kind === 'url') {
    if (!hasProject) return { ok: false, reason: '内置浏览器需要任务关联项目，请先关联项目' };
    return { ok: true, action: 'browser', url: c.href, label: '在内置浏览器新标签打开' };
  }
  let body = c.href.replace(/^file:\/\//, '');
  const m = body.match(/^(.*?)(?::(\d+))?(?::(\d+))?$/);
  body = m[1]; const line = m[2] ? Number(m[2]) : undefined, column = m[3] ? Number(m[3]) : undefined;
  const directory = body.endsWith('/');
  let rel;
  if (body.startsWith('/')) {
    if (body !== projectRoot && !body.startsWith(projectRoot + '/')) return { ok: false, reason: `「${body}」不在项目授权目录 ${projectRoot} 内，未打开` };
    rel = normalize(body.slice(projectRoot.length).split('/'));
  } else {
    const joined = normalize(body.split('/'));
    if (body.split('/').filter(p => p === '..').length > body.split('/').filter(p => p && p !== '..' && p !== '.').length - 1) return { ok: false, reason: `「${body}」越出项目授权目录，未打开` };
    rel = joined;
  }
  if (MISSING.has(rel)) return { ok: false, reason: `「${rel}」不存在或已被删除` };
  if (directory || DIRECTORIES.has(rel)) return { ok: true, action: 'reveal', path: rel, label: '在文件树中定位目录' };
  return { ok: true, action: 'file', path: rel, line, column, label: line ? `打开并定位到第 ${line} 行${column ? ` 第 ${column} 列` : ''}` : '在右侧文件区打开' };
}

// 把一行文本切成片段：**粗体**、`代码`、[文字](链接)、自动识别的路径／URL。
export function inlineSegments(text) {
  const segs = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(file:\/\/[^\s)，。、]*|https?:\/\/[^\s)，。、]+|www\.[^\s)，。、]+|(?<![^\s(["'：，、；。！？（）【】《》“”‘’])\/[^\s，。、)）]+)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) segs.push({ t: 'text', v: text.slice(last, m.index) });
    if (m[1]) segs.push({ t: 'bold', v: m[1] });
    else if (m[2]) { const c = classifyToken(m[2]); segs.push(c ? { t: 'link', v: m[2], href: m[2], code: true } : { t: 'code', v: m[2] }); }
    else if (m[3]) segs.push({ t: 'link', v: m[3], href: m[4] });
    else if (m[5]) { const c = m[5].startsWith('file://') ? null : classifyToken(m[5]); segs.push(c ? { t: 'link', v: m[5], href: m[5] } : { t: 'text', v: m[5] }); }
    last = re.lastIndex;
  }
  if (last < text.length) segs.push({ t: 'text', v: text.slice(last) });
  return segs;
}


// ---------- 时长 ----------
export function unionSeconds(intervals) {
  let total = 0, end = -Infinity;
  for (const [a, b] of [...intervals].sort((x, y) => x[0] - y[0])) { total += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b); }
  return total;
}
export function formatDuration(s) {
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m} 分 ${r} 秒` : `${m} 分钟`;
}
export function clock(t) { const base = 14 * 60 + 2; const m = base + Math.floor(t / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; }

// ---------- 工作记录的展示规则（移植自 T3 fe59fa44d0：MessagesTimeline.logic.ts、client-runtime/work-log/presentation.ts） ----------
// 记录种类：thought 思考、read 读文件、edit 改文件、command 命令、search 搜代码、web 搜网页、tool 其他工具（MCP 等）。
// 打断分组的独立行：message 中间正文、notice 通知、error 错误、todo 待办、approval 待审批（T3 同样把这些作为单独行）。
const ACTION = { read: 'read', edit: 'edit', command: 'command', search: 'code-search', web: 'search', tool: 'other' };
const PRIORITY = { command: 0, edit: 0, other: 2 };
const ACTION_LABEL = {
  read: n => `读取了 ${n} 个文件`, edit: n => `修改了 ${n} 个文件`, command: n => `运行了 ${n} 条命令`,
  'code-search': n => `搜索代码 ${n} 次`, search: n => `搜索网页 ${n} 次`, other: n => `使用了 ${n} 个工具`,
};
// T3 summarizeToolGroup：思考不计入；只有思考时为“思考”／“思考（×N）”；取优先级最高的两类动作，其余写“及其他 N 项操作”。
export function summarizeGroup(entries) {
  const tools = entries.filter(e => e.kind !== 'thought');
  if (!tools.length) return entries.length === 1 ? '思考' : `思考（×${entries.length}）`;
  const groups = new Map();
  for (const e of tools) { const a = ACTION[e.kind] ?? 'other'; if (!groups.has(a)) groups.set(a, []); groups.get(a).push(e); }
  const list = [...groups].map(([a, es], index) => ({ a, index, count: a === 'edit' ? new Set(es.map(e => e.path)).size : es.length, n: es.length, p: PRIORITY[a] ?? 1 }));
  const picked = [...list].sort((x, y) => x.p - y.p || x.index - y.index).slice(0, 2).sort((x, y) => x.index - y.index);
  const labels = picked.map(g => ACTION_LABEL[g.a](g.count));
  const rest = tools.length - picked.reduce((n, g) => n + g.n, 0);
  if (rest > 0) labels.push(`其他 ${rest} 项操作`);
  return labels.length < 3 ? labels.join('，') : labels.slice(0, -1).join('，') + '，以及' + labels.at(-1);
}
export function groupIcon(entries) {
  const tools = entries.filter(e => e.kind !== 'thought');
  if (!tools.length) return 'thought';
  const kinds = new Set(tools.map(e => e.kind));
  return kinds.size === 1 ? [...kinds][0] : 'mixed';
}
// T3 workEntryDisplayLabel／liveWorkEntryLabel 的中文对应
export function entryLabel(e, live = false) {
  switch (e.kind) {
    case 'thought': return live ? '思考中' : thoughtHeading(e.text) || '思考';
    case 'read': return (live ? '正在读取 ' : '读取 ') + e.path;
    case 'edit': return (live ? '正在修改 ' : '修改 ') + e.path;
    case 'command': return live ? `正在运行 ${e.cmd.split(/\s+/)[0]}` : e.cmd;
    case 'search': return (live ? '正在搜索 ' : '搜索 ') + `“${e.query}”`;
    case 'web': return (live ? '正在搜索网页 ' : '搜索网页 ') + `“${e.query}”`;
    case 'tool': return (live ? '正在调用 ' : '调用 ') + e.name;
    default: return e.label || '';
  }
}
// T3 liveThoughtLine：取思考开头的 **标题**，否则取第一句
export function thoughtHeading(md = '') {
  const h = /^\s*\*\*([^*\n]+)\*\*/.exec(md)?.[1];
  if (h) return h.trim();
  const t = md.replace(/\s+/g, ' ').trim(); const end = t.search(/[。！？.!?]/);
  return end > 0 ? t.slice(0, end + 1) : t;
}
const STANDALONE = new Set(['message', 'notice', 'error', 'todo', 'approval', 'subagents', 'created', 'sysnote', 'plan', 'compaction', 'native', 'business', 'goal']);
// 折叠后仍露出的独立行（T3 deriveTurnFolds：通知、子任务卡、最近一次压缩等不进折叠；计划是交付物，同样保留）
const KEEP_WHEN_FOLDED = ['notice', 'subagents', 'error', 'created', 'plan', 'compaction', 'goal'];

// 把一轮的记录换成时间线行。规则对应 T3 deriveMessagesTimelineRows／deriveTurnFolds：
// 1. 运行中：轮首显示“工作中 N 秒”（下方分隔线）；记录按时间顺序展示，不折叠。
// 2. 连续的工作记录合成一组：一组只有 1 条工具记录时直接显示那一行；多条时显示汇总行（默认收起，可展开）。
// 3. 末尾仍在进行的一组显示为“实时行”：最新一条带流光；组内有思考时，上方先显示思考标题。
// 4. 没有任何实时行、也没有待审批时，末尾显示“思考中”；有子任务在跑则改为“等待 N 个子任务”。
// 5. 正常结束：整轮折叠成“已工作 N 秒”，只露出最终回答；通知、子任务卡、待办、错误不进折叠。展开后与第 1–3 条相同。
// 6. 被停止或失败的轮次不折叠（T3：interrupted／failed 轮次跳过折叠），轮首显示“你在 N 秒后停止了”／“工作 N 秒后失败”。
export function deriveRows(turn, ui = {}) {
  const rows = [];
  const { state } = turn;
  const entries = (turn.entries ?? []).filter(entry => !entry.diagnostic);
  const live = state === 'live';
  const elapsed = turn.elapsed ?? unionSeconds(entries.filter(e => e.at).map(e => e.at));
  const pendingApproval = entries.some(e => e.kind === 'approval' || e.kind === 'business' || (e.kind === 'plan' && turn.state === 'live'));
  const foldable = state === 'done';
  const waitingSeconds = foldable ? turn.waitingSeconds ?? 0 : 0;
  const unfolded = !foldable || (!!ui.expandedTurns?.has(turn.id) !== !!turn.openFold); // openFold：演示时默认展开，点击可收起
  if (live && turn.stopping) rows.push({ kind: 'working', id: turn.id + ':working', label: '正在停止…', stopping: true });
  else if (live) rows.push({ kind: 'working', id: turn.id + ':working', label: `工作中 ${formatDuration(elapsed)}` });
  else if (state === 'stopped') rows.push({ kind: 'turn-header', id: turn.id + ':h', label: `你在 ${formatDuration(elapsed)}后停止了` });
  else if (state === 'failed') rows.push({ kind: 'turn-header', id: turn.id + ':h', label: `工作 ${formatDuration(elapsed)}后失败`, failed: true });
  else if (state === 'limited') rows.push({ kind: 'turn-header', id: turn.id + ':h', label: `额度用完，已暂停（工作 ${formatDuration(elapsed)}）`, warn: true });
  else if (foldable && (entries.length || waitingSeconds > 0)) rows.push({ kind: 'turn-fold', id: turn.id + ':fold', turnId: turn.id, label: `已工作 ${formatDuration(elapsed)}`, expanded: !!unfolded });
  const visible = unfolded ? entries : entries.filter(e => (KEEP_WHEN_FOLDED.includes(e.kind) || e.keep) && !e.foldable);
  for (let i = 0; i < visible.length; i++) {
    const e = visible[i];
    if (STANDALONE.has(e.kind)) { rows.push({ kind: e.kind, id: e.id, entry: e }); continue; }
    const group = [e];
    while (i + 1 < visible.length && !STANDALONE.has(visible[i + 1].kind)) group.push(visible[++i]);
    const gid = 'g:' + group[0].id;
    const activeEntries = live ? group.filter(x => x.live) : [];
    if (activeEntries.length && i === visible.length - 1) {
      const thought = [...group].reverse().find(x => x.kind === 'thought');
      rows.push({ kind: 'work-live', id: gid, entry: activeEntries.at(-1), thought, entries: group, expanded: !!ui.expandedGroups?.has(gid) });
    } else if (group.length === 1) rows.push({ kind: 'work', id: group[0].id, entry: group[0] });
    else rows.push({ kind: 'work-toggle', id: gid, summary: summarizeGroup(group), icon: groupIcon(group), at: group[0].at?.[0] ?? 0, entries: group, expanded: !!ui.expandedGroups?.has(gid) });
  }
  const tailLive = rows.at(-1)?.kind === 'work-live';
  const footer = state === 'stopped' ? { kind: 'turn-footer', id: turn.id + ':f', label: `已停止 · 共工作 ${formatDuration(elapsed)}` } : state === 'failed' ? { kind: 'turn-footer', id: turn.id + ':f', failed: true, label: `已失败 · 共工作 ${formatDuration(elapsed)}` } : null;
  if (live && !tailLive && !pendingApproval && !turn.question && !turn.streaming && !turn.stopping) rows.push({ kind: 'thinking', id: turn.id + ':thinking', label: turn.waitingLabel ?? (turn.waitingOn ? `等待 ${turn.waitingOn} 个子任务` : '思考中') });
  if (unfolded && waitingSeconds > 0) rows.push({ kind: 'turn-footer', id: turn.id + ':user-wait', label: `用户处理耗时 ${formatDuration(waitingSeconds)}` });
  if (turn.final && (!live || turn.streaming)) rows.push({ kind: 'final', id: turn.id + ':final', lines: turn.final, streaming: turn.streaming, partial: turn.partial, agent: turn.agent, showActions: state === 'done' });
  if (!live && !turn.diffState && turn.changes?.length) rows.push({ kind: 'changes', id: turn.id + ':changes', files: turn.changes, turnId: turn.id });
  if (turn.length) rows.push({ kind: 'length', id: turn.id + ':len' });
  if (footer) rows.push(footer);
  return rows;
}

// ---------- 合成数据 ----------
export const CHANGED_FILES = [
  { path: 'scripts/build.mjs', status: 'M', add: 58, del: 2, diff: [[' ', 'const targets = ['], ['-', "  { platform: 'mac', arch: 'arm64' },"], ['+', "  { platform: 'mac', arch: ['arm64', 'x64'] },"], ['+', "  { platform: 'win', arch: ['x64'] },"], [' ', '];'], [' ', ''], ['+', 'export function assertArch(file, arch) {'], ['+', '  // 解包后核对原生模块架构'], ['+', '  …'], ['+', '}']] },
  { path: 'tests/release/arch.test.mjs', status: 'A', add: 13, del: 0, diff: [['+', "import { test } from 'node:test';"], ['+', "import { assertArch } from '../../scripts/build.mjs';"], ['+', '…']] },
  { path: 'resources/dmg-background.png', status: 'M', add: 0, del: 0, binary: true },
];
const T = {
  think1: { id: 'e1', kind: 'thought', at: [0, 6], text: '**检查打包配置**\n先看打包脚本和各平台配置，确认 mac 现在只出了哪种架构，再决定改哪里。' },
  msg1: { id: 'e2', kind: 'message', lines: ['我先看一下现有的打包目标和发布测试。'] },
  read1: { id: 'e3', kind: 'read', path: 'package.json', at: [6, 7], output: '"package:release": "node scripts/build.mjs"' },
  read2: { id: 'e4', kind: 'read', path: 'scripts/build.mjs', at: [7, 8], output: "const targets = [\n  { platform: 'mac', arch: 'arm64' },\n];" },
  read3: { id: 'e5', kind: 'read', path: 'src/main.ts', at: [7, 9] },
  grep: { id: 'e6', kind: 'command', cmd: "rg -n \"arch\" scripts/", exit: 0, at: [9, 10], output: "scripts/build.mjs:12:  { platform: 'mac', arch: 'arm64' },\nscripts/build.mjs:40:  // TODO arch check" },
  msgMid: { id: 'e6b', kind: 'message', lines: ['现在 mac 只出 arm64。先跑一遍发布测试，看看基线。'] },
  test1: { id: 'e7', kind: 'command', cmd: 'pnpm test:release', exit: 0, at: [10, 52], output: '> willyou@0.1.6 test:release\n> node --test tests/release/*.test.mjs\n\n✔ version carry rules (3.1ms)\n✔ tag must be annotated (1.2ms)\n…\nℹ tests 14\nℹ pass 14\nℹ fail 0' },
  msgMid2: { id: 'e7b', kind: 'message', lines: ['基线 14 项全部通过。接下来改构建目标并补架构核对。'] },
  think2: { id: 'e8', kind: 'thought', at: [52, 58], text: '**确定改动范围**\n要改两处：构建目标加 x64；打包后读取原生模块的架构做核对，不一致就失败。另外补一个测试。' },
  edit1: { id: 'e9', kind: 'edit', path: 'scripts/build.mjs', add: 58, del: 2, at: [58, 70] },
  edit2: { id: 'e10', kind: 'edit', path: 'tests/release/arch.test.mjs', add: 13, del: 0, at: [62, 75] },
  msg2: { id: 'e11', kind: 'message', lines: ['改完了，再跑一遍发布测试确认。'] },
  test2: { id: 'e12', kind: 'command', cmd: 'pnpm test:release', exit: 0, at: [75, 134], output: 'ℹ tests 15\nℹ pass 15\nℹ fail 0' },
};
const USER1 = { id: 'u1', text: '检查多平台安装包：mac 要同时出 arm64 和 x64，打包后核对原生模块架构。', time: '14:02' };
const FINAL1 = [
  '已补上 mac x64 目标，并在打包后核对原生模块架构。',
  '- **构建目标**：在 scripts/build.mjs:12 增加 x64；Windows 保持 x64。',
  '- **架构核对**：新增 assertArch，解包后读取 better-sqlite3 与 node-pty 的架构，不一致直接失败。',
  '- **测试**：tests/release/arch.test.mjs 覆盖两种架构，pnpm test:release 15 项通过。',
  '入口在 `src/main.ts:40:5`，相关说明见 [需求文档](docs/需求.md)、目录 docs/ 和 https://qa.example.test/ 。`notes.txt` 只是文件名，不会变成链接。',
];
const DONE_TURN = { id: 't1', user: USER1, state: 'done', entries: [T.think1, T.msg1, T.read1, T.read2, T.read3, T.grep, T.msgMid, T.test1, T.msgMid2, T.think2, T.edit1, T.edit2, T.msg2, T.test2], final: FINAL1, changes: CHANGED_FILES };
const live = e => ({ ...e, live: true });

export const SCENARIOS = [
  { id: 'done', group: '基础', name: 'S02 一轮完成', desc: '整轮折叠成“已工作”，只露最终回答和改动；展开可逐条看', status: 'done', turns: [DONE_TURN] },
  { id: 'starting', group: '基础', name: 'S02 刚开始（思考中）', desc: '“工作中”计时＋末尾“思考中”', status: 'running', turns: [{ id: 't1', user: USER1, state: 'live', elapsed: 0, entries: [] }] },
  { id: 'running', group: '基础', name: 'S02 工作中＋排队', desc: '思考、中间正文、已完成的一组和实时行；排队消息可“立即发送”', status: 'running', turns: [{ id: 't1', user: USER1, state: 'live', elapsed: 38, entries: [T.think1, T.msg1, T.read1, T.read2, T.read3, T.grep, T.msgMid, live({ id: 'e7t', kind: 'thought', at: [10, 12], text: '**跑基线测试**\n先确认现有发布测试全部通过，再动构建脚本。' }), live({ ...T.test1, output: undefined })] }], queued: [{ id: 'q1', text: '顺便把 Linux 的 deb 也检查一下', time: '14:03' }] },
  { id: 'streaming', group: '基础', name: 'S02 输出最终回答中', desc: '工作结束、回答流式输出时不折叠', status: 'running', turns: [{ ...DONE_TURN, state: 'live', elapsed: 136, streaming: true, final: FINAL1.slice(0, 2) }] },
  { id: 'approval', group: '请求', name: 'S03 命令审批', desc: '时间线显示待批准内容；批准／拒绝在输入框上方，发送文字即拒绝并说明原因（对齐 T3）', status: 'waiting', turns: [{ id: 't1', user: USER1, state: 'live', elapsed: 12, entries: [T.think1, T.msg1, T.read1, T.read2, { id: 'r1', kind: 'approval', title: '命令审批', command: 'pnpm package:release --platform mac --arch x64', cwd: '/workspace/SmartDD', reason: '需要在沙箱外写入 release/ 目录' }] }], pending: 'approval' },
  { id: 'question', group: '请求', name: 'S03 Agent 提问', desc: '问题出现在输入框位置，选项可用数字键选择', status: 'waiting', turns: [{ id: 't1', user: USER1, state: 'live', elapsed: 8, entries: [T.think1, T.read1, T.read2], question: true }], pending: 'question', question: { title: 'Windows 安装包要出哪几种格式？', options: [['只出 EXE', '最快，与旧版一致'], ['EXE＋MSI', '与现有发布流程一致'], ['暂不改 Windows', '本次只改 mac']] } },
  { id: 'switch', group: '切换', name: 'S04/S05 切换 Provider', desc: '切换分隔与交接摘要；Codex 的回答标出来源', status: 'done', turns: [DONE_TURN,
    { id: 't2', switchBefore: { from: 'Claude Code · 订阅 · 默认模型', to: 'Codex · DeepSeek · deepseek-flash', mode: 'full', covered: '全部 3 条消息、1 轮工作结果', omitted: '命令完整输出（超出预算，可在右侧打开原记录）' }, user: { id: 'u2', text: '再审一遍 scripts/build.mjs 的改动。', time: '14:06' }, state: 'done', agent: 'codex', entries: [{ id: 'x1', kind: 'read', path: 'scripts/build.mjs', at: [0, 2] }, { id: 'x2', kind: 'thought', at: [2, 9], text: '**复查架构核对**\n检查失败时的错误信息是否足够定位问题。' }], final: ['改动没有问题。建议 assertArch 失败时把实际架构写进错误信息，方便排查。'] },
    { id: 't3', switchBefore: { from: 'Codex · DeepSeek · deepseek-flash', to: 'Claude Code · 订阅 · 默认模型', mode: 'delta', covered: '切走后新增的 2 条消息', omitted: '无' } },
  ] },
  { id: 'stopped', group: '终态', name: 'S07 已停止', desc: '停止的轮次不折叠，轮首写明停止时长', status: 'stopped', turns: [{ id: 't1', user: USER1, state: 'stopped', elapsed: 63, entries: [T.think1, T.msg1, T.read1, T.read2, T.read3, { ...T.test1, exit: null, output: '（已停止）' }] }] },
  { id: 'failed', group: '终态', name: 'S07 失败／接收未知', desc: '错误为独立行；断线后不自动重发', status: 'failed', turns: [
    { id: 't1', user: USER1, state: 'failed', elapsed: 9, entries: [T.think1, T.read1, { id: 'err', kind: 'error', title: '运行失败', detail: 'Provider 返回 500：upstream connect error（已收口本轮工具和请求）' }] },
    { id: 't2', user: { id: 'u2', text: '再试一次', time: '14:05' }, state: 'unknown' },
  ] },
  { id: 'limited', group: '终态', name: 'S11 额度用完（照 T3）', desc: '这一轮按“暂停”显示、工作过程保留；输入框上方黄色提示＋到点自动继续', status: 'limited', turns: [{ id: 't1', user: USER1, state: 'limited', elapsed: 52, entries: [T.think1, T.msg1, T.read1, T.read2, T.read3, T.grep] }], limit: { agent: 'Claude Code 订阅', resetAt: '15:30' } },
  { id: 'length', group: '终态', name: 'S11 输出长度上限', desc: '回答达到输出长度上限：保留部分回答，可手动继续', status: 'done', turns: [{ id: 't1', user: USER1, state: 'done', entries: [T.think1, T.read1, T.read2], final: ['已确认需要改动的三处位置：构建目标、解包检查和发布测试。下面逐项说明第一处……'], partial: true, length: true }] },
  { id: 'links', group: '联动', name: 'S10 消息链接', desc: '点击路径／URL：文件、行列、目录、网页；不可打开的显示原因', status: 'done', turns: [{ id: 't1', user: { id: 'u1', text: '列一下这次涉及的文件和地址。', time: '14:20' }, state: 'done', entries: [], final: [
    '**可以打开**', '- 绝对路径带行号：/workspace/SmartDD/src/main.ts:12', '- 相对路径带行列：`src/renderer/App.tsx:40:5`', '- Markdown 链接：[验收 PDF](docs/验收.pdf)', '- 显式 file 链接：[package.json](file:///workspace/SmartDD/package.json)', '- 显式目录链接：[docs](docs/)', '- 网页：https://qa.example.test/ 或 www.example.com',
    '**不会打开（点击后提示原因）**', '- 项目外：/etc/hosts', '- 已删除：fixtures/已删除.md', '- 越界：../../secret/key.txt', '- 协议：[执行脚本](javascript:run)',
    '**不是链接**：裸写的 docs/、file:///workspace/SmartDD/package.json、CHANGELOG.md、main.py、deploy.sh 保持纯文本。'] }] },
];

// 多 Agent 协作（S06/S12）：主任务 Claude Code·订阅；三个子任务分别在 Codex·DeepSeek（只读审查）、Codex·订阅（只读查文档）、Claude Code·DeepSeek（写测试，排队）。
// 对照 T3：时间线子任务卡、末尾“等待 N 个子任务”、任务关系面板（Lineage）、子任务审批浮到主任务输入框上方、点进子任务看它自己的时间线。
export const TEAM_CHILDREN = [
  { id: 'k1', title: '审查构建脚本改动', tool: 'codex', agent: 'cx-ds', target: 'Codex · DeepSeek', model: 'deepseek-flash 中', access: '只读', state: 'running', secs: 48, live: '正在运行 rg', note: '只读，与主任务并行',
    turns: [{ id: 'kt1', user: { id: 'ku', text: '【主任务委派】审查 scripts/build.mjs 的架构核对改动，只读，给出问题清单。', time: '14:11' }, state: 'live', elapsed: 48, entries: [
      { id: 'k1a', kind: 'thought', at: [0, 4], text: '**读改动范围**\n先看 diff 涉及的函数，再查调用方。' },
      { id: 'k1b', kind: 'read', path: 'scripts/build.mjs', at: [4, 6] }, { id: 'k1c', kind: 'read', path: 'tests/release/arch.test.mjs', at: [5, 7] },
      { id: 'k1m', kind: 'message', lines: ['assertArch 只检查了 better-sqlite3，还要确认 node-pty。'] },
      { id: 'k1d', kind: 'command', cmd: 'rg -n "node-pty" scripts/ src/', at: [40, 48], live: true }] }] },
  { id: 'k2', title: '核对打包文档', tool: 'codex', target: 'Codex · 订阅', model: '默认模型', access: '只读', state: 'waiting', secs: 31, live: '等待你批准', note: '需要批准：访问网页',
    approval: { title: '访问网页', command: 'GET https://www.electron.build/configuration/mac', reason: '查阅 electron-builder 的 mac 多架构配置说明' },
    turns: [{ id: 'kt2', user: { id: 'ku2', text: '【主任务委派】核对 docs/多平台构建与发版方案.md 是否需要同步 x64 说明，只读。', time: '14:11' }, state: 'live', elapsed: 31, entries: [
      { id: 'k2a', kind: 'read', path: 'docs/多平台构建与发版方案.md', at: [0, 3] },
      { id: 'k2b', kind: 'approval', title: '访问网页', command: 'GET https://www.electron.build/configuration/mac', cwd: '—', reason: '查阅 electron-builder 的 mac 多架构配置说明' }] }] },
  { id: 'k3', title: '补 node-pty 架构测试', tool: 'claude', provider: true, agent: 'cc-ds', target: 'Claude Code · DeepSeek', model: 'deepseek-flash', access: '写入', state: 'running', secs: 22, live: '正在写测试', branch: 'feature/0.1.6_willyou_node-pty-arch-test', note: '在单独工作副本里写，与主任务同时进行',
    turns: [{ id: 'kt3', user: { id: 'ku3', text: '【主任务委派】在 tests/release/arch.test.mjs 补 node-pty 的架构断言。', time: '14:12' }, state: 'live', elapsed: 22, entries: [
      { id: 'k3s', kind: 'sysnote', level: 'info', text: '在单独工作副本中运行 · feature/0.1.6_willyou_node-pty-arch-test', detail: '目录 /Users/demo/.willyou/worktrees/smartdd-a1b2c3/feature/0.1.6_willyou_node-pty-arch-test；从主任务最新提交建出；依赖已安装（pnpm install --frozen-lockfile，38 秒）。只在本机，不推送。' },
      { id: 'k3a', kind: 'read', path: 'tests/release/arch.test.mjs', at: [0, 2] },
      { id: 'k3m', kind: 'message', lines: ['先看构建入口 `/workspace/SmartDD/scripts/build.mjs:1`，再在测试里补断言。'] },
      { id: 'k3b', kind: 'edit', path: 'tests/release/arch.test.mjs', add: 18, del: 0, at: [14, 22], live: true }] }] },
];
const K3_SVN = { id: 'k3', title: '补 node-pty 架构测试', tool: 'claude', provider: true, agent: 'cc-ds', target: 'Claude Code · DeepSeek', model: 'deepseek-flash', access: '写入', state: 'queued', secs: 0, live: '排队第 1 位', note: '排队中：SVN 目录同一时间只有一个 Agent 写，等主任务这一轮结束后启动',
  turns: [{ id: 'kt3', user: { id: 'ku3', text: '【主任务委派】在 tests/release/arch.test.mjs 补 node-pty 的架构断言。', time: '14:12' }, state: 'queued', entries: [] }] };
const TEAM_PARENT = { id: 't1', user: { id: 'u1', text: '把 arch 检查补完整：让 Codex·DeepSeek 审一下改动、Codex·订阅核对文档，再派一个 Agent 补 node-pty 的测试。', time: '14:10' }, state: 'live', elapsed: 52, waitingOn: 3, entries: [
  { id: 'p1', kind: 'thought', at: [0, 5], text: '**拆分任务**\n审查和查文档是只读，在当前目录并行；补测试要写文件，这是 Git 项目，WillYou 会给它建单独的工作副本，三份同时开始。' },
  { id: 'p2', kind: 'message', lines: ['我把工作拆成三份，同时开始：两份只读的在当前目录，写测试的在单独工作副本里做，做完我来合并。'] },
  { id: 'c1', kind: 'created', title: '审查构建脚本改动', target: 'Codex · DeepSeek', access: '只读' },
  { id: 'c2', kind: 'created', title: '核对打包文档', target: 'Codex · 订阅', access: '只读' },
  { id: 'c3', kind: 'created', title: '补 node-pty 架构测试', target: 'Claude Code · DeepSeek', access: '写入', branch: 'feature/0.1.6_willyou_node-pty-arch-test' },
  { id: 'wt', kind: 'sysnote', level: 'info', text: '已为「补 node-pty 架构测试」建工作副本 · feature/0.1.6_willyou_node-pty-arch-test', detail: '基于 HEAD 7cb4e21。主目录有 2 个未提交文件，没有带进子任务。' },
  { id: 'sa', kind: 'subagents', team: true, rows: TEAM_CHILDREN },
] };
SCENARIOS.splice(SCENARIOS.findIndex(s => s.id === 'stopped'), 0, { id: 'team-worktree', group: '协作', name: 'S06/S12 独立工作副本（Git 并行）', desc: '写入子任务在单独工作副本里与主任务同时进行；子任务审批浮到主任务、点进子任务', status: 'running', teamPanel: true, vcs: 'git', children: TEAM_CHILDREN, turns: [TEAM_PARENT], waiting: TEAM_CHILDREN.map(c => c.title), childApprovals: TEAM_CHILDREN.filter(c => c.approval) });

// 同一次协作的完成阶段：子任务全部完成，结果以通知回到主任务，主任务重新取得写入权后自动继续
export const TEAM_CHILDREN_DONE = TEAM_CHILDREN.map(c => ({ ...c, state: 'done', live: null, approval: null,
  note: { k1: '发现 2 个平台专属包，均已在白名单', k2: '文档无需同步，已核对 x64 说明', k3: '已提交到分支，等待主任务合并' }[c.id],
  secs: { k1: 71, k2: 52, k3: 88 }[c.id],
  turns: c.turns.map(t => ({ ...t, state: 'done', elapsed: { k1: 71, k2: 52, k3: 88 }[c.id], entries: t.entries.filter(e => e.kind !== 'approval').map(e => ({ ...e, live: false })),
    final: { k1: ['发现 2 个平台专属依赖（better-sqlite3、node-pty），均已在打包白名单中，无需处理。'], k2: ['docs/多平台构建与发版方案.md 已提到 x64，不需要同步。'], k3: ['已在 tests/release/arch.test.mjs 增加 node-pty 的架构断言，pnpm test:release 15 项通过。'] }[c.id] })) }));
SCENARIOS.splice(SCENARIOS.findIndex(s => s.id === 'stopped'), 0, { id: 'team-done', vcs: 'git', group: '协作', name: 'S06 多 Agent 协作（结果回收与合并）', desc: '子任务都完成，主 Agent 检查后把工作副本分支 cherry-pick 合并，宿主核对通过；每个子任务仍可点开', status: 'done', teamPanel: true, children: TEAM_CHILDREN_DONE, turns: [
  { id: 't1', user: TEAM_PARENT.user, state: 'done', entries: [TEAM_PARENT.entries[0], TEAM_PARENT.entries[1], TEAM_PARENT.entries[2], TEAM_PARENT.entries[3], TEAM_PARENT.entries[4], { id: 'sa', kind: 'subagents', team: true, rows: TEAM_CHILDREN_DONE }], final: ['三个子任务已同时开始：两份只读在当前目录，写测试的在单独工作副本里。'] },
  { id: 't2', auto: true, state: 'done', entries: [{ id: 'n1', kind: 'notice', text: '子任务「审查构建脚本改动」已完成', sub: '结果已交给主任务' }, { id: 'n2', kind: 'notice', text: '子任务「核对打包文档」已完成', sub: '结果已交给主任务' }, { id: 'n3', kind: 'notice', text: '子任务「补 node-pty 架构测试」已完成', sub: 'WillYou 已把改动提交到分支 feature/0.1.6_willyou_node-pty-arch-test（2 个提交），等待合并' }, { id: 'y1', kind: 'tool', name: 'wy_observe（读取子任务结果）', at: [0, 1] }, { id: 'y2', kind: 'command', cmd: 'git diff HEAD...feature/0.1.6_willyou_node-pty-arch-test', exit: 0, at: [1, 2] }, { id: 'y3', kind: 'command', cmd: 'git cherry-pick 1a2b3c4 5d6e7f8', exit: 0, at: [2, 3] }, { id: 'y3r', kind: 'sysnote', level: 'info', text: '自动审核已批准：git cherry-pick 1a2b3c4 5d6e7f8', detail: '帮我批准档：Codex 申请在沙箱外写 .git，由执行器自带的自动审核批准（风险：低，授权：高）。请求批准档会请你逐条批准，完全访问档直接执行。' }, { id: 'y4', kind: 'command', cmd: 'pnpm test:release', exit: 0, at: [3, 41] }, { id: 'y5', kind: 'sysnote', keep: true, level: 'info', text: '合并核对通过', detail: '子任务的 2 个提交已进入 feature/0.1.6；没有未完成的 cherry-pick 或合并，没有冲突标记，当前分支未变。分支 feature/0.1.6_willyou_node-pty-arch-test 保留。' }], final: ['三个子任务都完成了：依赖没有问题，文档无需同步；测试分支已检查并合并到 feature/0.1.6，pnpm test:release 15 项通过。'] },
] });

// SVN 项目：没有 worktree，写入子任务按方案 B 串行
const TEAM_CHILDREN_SVN = TEAM_CHILDREN.map(c => c.id === 'k3' ? K3_SVN : c);
const TEAM_PARENT_SVN = { ...TEAM_PARENT, entries: [
  { id: 'p1', kind: 'thought', at: [0, 5], text: '**拆分任务**\n这是 SVN 目录，同一时间只能一个 Agent 写；审查和查文档是只读，可以并行，补测试等我这一轮结束再开始。' },
  { id: 'p2', kind: 'message', lines: ['我把工作拆成三份：两份只读的马上开始，写测试的那份排在我这一轮之后。'] },
  ...TEAM_PARENT.entries.filter(e => e.kind === 'created').map(e => ({ ...e, branch: undefined })),
  { id: 'sa', kind: 'subagents', team: true, rows: TEAM_CHILDREN_SVN }] };
SCENARIOS.splice(SCENARIOS.findIndex(s => s.id === 'stopped'), 0, { id: 'team-svn', group: '协作', name: 'S06 多 Agent 协作（SVN 项目：写入串行）', desc: 'SVN／普通目录不建工作副本，写入子任务排在主任务之后', status: 'running', teamPanel: true, vcs: 'svn', children: TEAM_CHILDREN_SVN, turns: [TEAM_PARENT_SVN], waiting: TEAM_CHILDREN_SVN.map(c => c.title), childApprovals: TEAM_CHILDREN_SVN.filter(c => c.approval) });

const sharedTeam = SCENARIOS.find(s => s.id === 'team-svn');
SCENARIOS.splice(SCENARIOS.findIndex(s => s.id === 'stopped'), 0, {
  ...sharedTeam, id: 'team', vcs: 'git', name: 'S06 多 Agent 协作（Git 共用目录）',
  desc: '子任务能读取本轮未提交改动，等父任务交出写入资格后继续。',
  children: sharedTeam.children.map(c => ({ ...c, note: c.note?.replace('SVN 目录', '共用目录') })),
  turns: sharedTeam.turns.map(t => ({ ...t, entries: t.entries.map(e => e.kind === 'thought' ? { ...e, text: '**拆分任务**\n先在当前目录安排只读核对。补测试的子任务等本轮结束再拿写入资格。' } : e) })),
});

const worktreeTeam = SCENARIOS.find(s => s.id === 'team-worktree');
const sharedWriter = { ...K3_SVN, id: 'shared-writer', title: '核对当前未提交的修改', note: '共用目录；取得写入资格后开始' };
worktreeTeam.children = [...worktreeTeam.children, sharedWriter];
worktreeTeam.turns = worktreeTeam.turns.map(t => ({ ...t, entries: t.entries.map(e => e.kind === 'subagents' ? { ...e, rows: [...e.rows, sharedWriter] } : e) }));
const U = (id, text, time = '14:30', extra = {}) => ({ id, text, time, ...extra });
const sharedReview = { ...K3_SVN, title: '审查构建脚本改动', state: 'done', live: null, note: '第 3 轮复核完成，改动保留在共用目录', turns: [
  { id: 'review-1', user: U('review-u1', '审查未提交的设计。', '14:20'), state: 'done', entries: [], final: ['第一轮发现缺少 arm64 的构建断言。'] },
  { id: 'review-2', user: U('review-u2', '在原目录补断言后再核对。', '14:25'), state: 'done', entries: [], final: ['第二轮已经补上断言。'] },
  { id: 'review-3', user: U('review-u3', '针对前两轮意见做最后一次复核。', '14:32'), state: 'done', entries: [], final: ['第三轮复核完成，前两轮问题已解决。'] },
] };
SCENARIOS.splice(SCENARIOS.findIndex(s => s.id === 'stopped'), 0, {
  id: 'team-rework', vcs: 'git', group: '协作', name: 'S06 共用目录多轮复核', desc: '原会话承接审查、修改与再审查。',
  status: 'done', teamPanel: true, children: [sharedReview], turns: [
    { id: 'parent-review', user: U('review-parent', '审查、修正并复核当前改动。', '14:20'), state: 'done', entries: [
      { id: 'r1', kind: 'tool', name: 'wy_delegate（共用目录审查）', at: [0, 4] },
      { id: 'r2', kind: 'tool', name: 'wy_send（原子任务修正）', at: [5, 8] },
      { id: 'r3', kind: 'tool', name: 'wy_send（原会话再审查）', at: [9, 12] },
      { id: 'sa', kind: 'subagents', team: true, rows: [sharedReview] },
    ], final: ['复核完成，改动保留在当前目录。'] },
  ],
});

// 合并后宿主核对没通过 → 提醒主 Agent，连续处理不了标“需要你处理”
SCENARIOS.splice(SCENARIOS.findIndex(s => s.id === 'stopped'), 0, { id: 'merge-check', group: '协作', name: 'S06 合并核对未通过', desc: '主 Agent 合并时冲突没解决完，宿主核对发现并提醒；连续两次未处理好，标“需要你处理”', status: 'waiting', teamPanel: true, children: TEAM_CHILDREN_DONE, mergeIssue: true, turns: [
  { id: 't2', auto: true, state: 'done', entries: [
    { id: 'n3', kind: 'notice', text: '子任务「补 node-pty 架构测试」已完成', sub: '分支 feature/0.1.6_willyou_node-pty-arch-test，2 个提交，等待合并' },
    { id: 'm1', kind: 'command', cmd: 'git cherry-pick 1a2b3c4 5d6e7f8', exit: 1, at: [0, 2], output: 'CONFLICT (content): Merge conflict in tests/release/arch.test.mjs\nerror: could not apply 5d6e7f8... add node-pty arch assertion' },
    { id: 'm2', kind: 'edit', path: 'tests/release/arch.test.mjs', add: 4, del: 9, at: [3, 9] },
    { id: 'm3', kind: 'sysnote', keep: true, level: 'warn', text: '合并核对未通过（第 1 次），已提醒主 Agent 继续处理', detail: '仍有未完成的 cherry-pick（存在 CHERRY_PICK_HEAD）；tests/release/arch.test.mjs 第 41 行残留冲突标记。' }], final: ['冲突已处理。'] },
  { id: 't3', auto: true, autoLabel: '合并核对未通过，WillYou 提醒主 Agent 继续处理', state: 'done', entries: [
    { id: 'm4', kind: 'read', path: 'tests/release/arch.test.mjs', at: [0, 1] },
    { id: 'm5', kind: 'sysnote', keep: true, level: 'warn', text: '合并核对未通过（第 2 次），已标记“需要你处理”', detail: '子任务的第 2 个提交仍未进入 feature/0.1.6；冲突标记仍在。WillYou 不会执行 reset／checkout／clean。' }], final: ['这个冲突涉及两种不同的断言写法，我不确定该保留哪种，请你看一下。'] },
] });

// ---------- P0.7 补充状态（对照 T3 遗漏清单） ----------

SCENARIOS.push(
  { id: 'business', group: '请求', name: 'S03 业务审批（插件／邮件）', desc: '用合成的邮件内容展示审阅和批准选项', status: 'waiting', pending: 'business', turns: [{ id: 't1', user: U('u1', '把这次修复的结果发邮件给测试组。'), state: 'live', elapsed: 9, entries: [
    { id: 'b0', kind: 'thought', at: [0, 3], text: '**准备邮件**\n用 WillYou 邮件插件起草，收件人取项目配置里的测试组。' },
    { id: 'b1', kind: 'tool', name: 'willyou-mail.draft_create', at: [3, 5] },
    { id: 'b2', kind: 'business', plugin: '内置邮件', pluginIcon: 'mail', action: '发送邮件', fields: [['发件账号', 'dev@example.com（项目 SMTP）'], ['收件人', 'qa-team@example.com'], ['主题', '【WillYou 0.1.6】mac 多架构安装包修复'], ['正文', '已补上 mac x64 目标并在打包后核对原生模块架构，发布测试 15 项通过……']], note: '由 WillYou 邮件插件审阅并执行；Agent 无法代为批准，也不能改用其他账号' }] }] },
  { id: 'access', group: '请求', name: 'S03 跨任务网页授权（M12）', desc: 'Agent 申请控制另一个任务的网页，可按原申请批准控制，或降级为观察', status: 'waiting', pending: 'access', turns: [{ id: 't1', user: U('u1', '参考「梳理项目结构」任务里打开的接口文档页，补全这里的调用。'), state: 'live', elapsed: 6, entries: [
    { id: 'w0', kind: 'thought', at: [0, 3], text: '**需要读取另一个任务的网页**\n接口文档页开在任务「梳理项目结构和关键模块」里，先申请控制权限。' },
    { id: 'w1', kind: 'tool', name: 'willyou-browser access request --task structure --mode control', at: [3, 4] }] }],
    access: { target: '梳理项目结构和关键模块', mode: '控制', pageUrl: 'https://qa.example.test/api/' } },
  { id: 'extensions', group: '基础', name: 'S15 系统提示与用户扩展', desc: 'Hook、MCP 启动与配置提示可在运行诊断查看，自动审核记录可展开', status: 'done', turns: [{ id: 't1', user: USER1, state: 'done', openFold: true, entries: [
    { id: 'n1', kind: 'sysnote', level: 'info', diagnostic: true, text: 'hooks · PreToolUse 已执行 2 个', detail: '~/.claude/settings.json：lint-check（0.3 秒）、secret-scan（0.1 秒）' },
    { id: 'n2', kind: 'sysnote', level: 'warn', diagnostic: true, text: 'MCP 服务器 zentao-personal 启动失败', detail: '来自你的 ~/.codex/config.toml；连接 127.0.0.1:7788 超时。本任务其他能力不受影响。可在选择器里关闭“沿用我的扩展”。' },
    T.think1, T.read1, T.read2,
    { id: 'n3', kind: 'sysnote', level: 'info', text: '自动审核已批准：pnpm test:release', detail: '执行器自带的自动审核（auto_review）。WillYou 托管的业务写操作仍需你在任务区批准。' },
    T.test1,
    { id: 'n4', kind: 'sysnote', level: 'warn', diagnostic: true, text: '配置告警：model_reasoning_effort = "max" 不被当前模型支持，已按“高”运行', detail: '来自你的 ~/.codex/config.toml' },
  ], final: ['发布测试通过，基线正常。'] }] },
  { id: 'stopping', group: '终态', name: 'S07 正在停止／强制停止', desc: '点停止后“正在停止…”；执行器不响应时出现强制停止', status: 'stopping', turns: [{ id: 't1', user: USER1, state: 'live', stopping: true, elapsed: 40, entries: [T.think1, T.msg1, T.read1, T.read2, { ...T.test1, live: true, output: undefined }] }] },
  { id: 'plan', group: '基础', name: 'S02 计划卡（Claude 自己交计划）', desc: '不做计划开关；Claude 进入它的计划模式交出计划，显示计划卡，批准在输入框位置处理', status: 'waiting', pending: 'plan', turns: [
    { id: 't1', user: U('u1', '先出个计划，确认后再改。', '14:20'), state: 'live', elapsed: 18, entries: [T.think1, T.read1, T.read2, { id: 'pl', kind: 'plan', title: 'mac 多架构安装包', source: 'Claude Code 计划模式', steps: ['1. 构建目标增加 mac x64（scripts/build.mjs）', '2. 打包后解包，核对 better-sqlite3、node-pty 的架构', '3. 补 tests/release/arch.test.mjs', '4. 跑 pnpm test:release 与 pnpm package:release --platform mac'] }] },
  ] },
  { id: 'todo', group: '基础', name: 'S02 待办清单', desc: '执行器提供任务清单时显示（Claude TaskCreate／TaskUpdate），随进度更新', status: 'running', turns: [
    { id: 't2', user: U('u2', '按计划执行。', '14:22'), state: 'live', elapsed: 64, entries: [
      { id: 'td', kind: 'todo', items: [['构建目标增加 mac x64', 'done'], ['打包后核对原生模块架构', 'doing'], ['补 arch 测试', 'todo'], ['跑发布测试与打包', 'todo']] },
      T.edit1, live({ id: 'e9t', kind: 'thought', at: [60, 64], text: '**写架构核对**\n解包后用 file 命令读取 .node 文件的架构。' }), live({ id: 'e9e', kind: 'edit', path: 'scripts/build.mjs', add: 20, del: 0, at: [62, 64] })] },
  ] },
  { id: 'goal', agent: 'cx-ds', group: '目标', name: 'S16 目标进行中（Codex）', desc: '/goal 设定后跨多轮工作；条目显示时长和轮次，可暂停、清除；停止键＝暂停目标', status: 'running', turns: [
    { id: 't1', user: U('u1', '/goal 让 pnpm test:release 全部通过，并补齐 mac x64 的打包检查', '15:10'), state: 'done', entries: [T.read1, T.edit1, T.test1], final: ['第 1 轮：构建目标已加 x64，发布测试 14／15 通过，继续处理剩下 1 项。'] },
    { id: 't2', auto: true, state: 'live', elapsed: 26, entries: [T.read2, live({ id: 'g2e', kind: 'edit', path: 'tests/release/arch.test.mjs', add: 7, del: 1, at: [20, 26] }), { id: 'goal-cx', kind: 'goal', rev: 1, agent: 'codex', status: 'active', objective: '让 pnpm test:release 全部通过，并补齐 mac x64 的打包检查', secs: 734, turns: 7 }] },
  ] },
  { id: 'goal-wait', agent: 'cx-ds', group: '目标', name: 'S16 目标＋子任务（自动暂停）', desc: '主任务等子任务结果时宿主自动暂停目标，结果回来自动继续，不需要你操作', status: 'running', teamPanel: true, vcs: 'git', children: TEAM_CHILDREN, waiting: TEAM_CHILDREN.map(c => c.title), childApprovals: TEAM_CHILDREN.filter(c => c.approval), turns: [
    { ...TEAM_PARENT, user: U('u1', '/goal 把 arch 检查补完整：Codex·DeepSeek 审改动、Codex·订阅核对文档、再派一个 Agent 补 node-pty 测试，全部通过为止', '14:10'), entries: [...TEAM_PARENT.entries, { id: 'goal-wait', kind: 'goal', rev: 1, agent: 'codex', status: 'waiting-children', objective: '把 arch 检查补完整，全部通过为止', secs: 312, turns: 3 }] },
  ] },
  { id: 'goal-claude', agent: 'cc-sub', group: '目标', name: 'S16 目标（Claude：只能清除）', desc: 'Claude 的目标不能暂停或继续，只提供清除；状态从它的回复识别', status: 'running', turns: [
    { id: 't1', user: U('u1', '/goal 修完 arch.test.mjs 里所有失败的断言', '15:30'), state: 'live', elapsed: 40, entries: [T.read1, live({ id: 'gce', kind: 'edit', path: 'tests/release/arch.test.mjs', add: 3, del: 3, at: [34, 40] }), { id: 'goal-cc', kind: 'goal', rev: 1, agent: 'claude', status: 'active', objective: '修完 arch.test.mjs 里所有失败的断言', secs: 205, turns: 3 }] },
  ] },
  { id: 'compaction', group: '基础', name: 'S09 上下文压缩', desc: '执行器自动压缩后显示“上下文已压缩”分隔线；/compact 仅在执行器支持时出现', status: 'done', turns: [
    { ...DONE_TURN, id: 't0' },
    { id: 't1', user: U('u1', '再把 Windows 的安装包也检查一遍。', '15:01'), state: 'done', entries: [{ id: 'cp', kind: 'compaction' }, T.read1, T.read2], final: ['Windows 目标已是 x64，无需改动。'] },
  ] },
  { id: 'native', group: '协作', name: 'S06 执行器内置子 Agent', desc: 'Claude Task／Codex 协作工具：与 WillYou 子任务区分，可查看过程', status: 'running', turns: [{ id: 't1', user: U('u1', '梳理一下打包相关的代码都在哪。'), state: 'live', elapsed: 26, waitingLabel: '等待内置子 Agent', entries: [T.think1,
    { id: 'nv', kind: 'native', title: '探索打包相关代码', agentKind: 'Claude Code 内置子 Agent（Task · Explore）', state: 'running', secs: 18, steps: ['读取 scripts/build.mjs', '搜索 “electron-builder”', '读取 electron-builder.config.cjs', '正在读取 scripts/release/*.mjs'], note: '由执行器自己创建和管理；WillYou 只显示过程，停止范围为整个主任务' }] }], background: [{ id: 'bg1', name: 'pnpm dev', kind: '后台命令', state: 'running', secs: 186 }, { id: 'bg2', name: '监视 tests/release/', kind: '监视', state: 'waiting', secs: 40 }] },
  { id: 'diff-states', group: '联动', name: 'S13 改动记录的其他状态', desc: '首次准备中、记录不完整、不可用（原因）', status: 'done', turns: [
    { id: 't1', user: U('u1', '（SVN 项目，首次）把版本号改成 0.1.7。', '15:10'), state: 'done', entries: [{ ...T.edit1, path: 'package.json', add: 1, del: 1 }], final: ['已改。'], changes: [{ path: 'package.json', status: 'M', add: 1, del: 1, diff: [['-', '  "version": "0.1.6",'], ['+', '  "version": "0.1.7",']] }], diffState: { kind: 'preparing', pct: 38, note: '首次为这个 SVN 目录建立改动记录（WillYou 私有记录，不改动 .svn），可以继续工作' } },
    { id: 't2', user: U('u2', '再更新一下 CHANGELOG。', '15:12'), state: 'done', entries: [{ ...T.edit2, path: 'CHANGELOG.md', add: 4, del: 0 }], final: ['已更新。'], changes: [{ path: 'CHANGELOG.md', status: 'M', add: 4, del: 0, diff: [['+', '## 0.1.7'], ['+', '- mac 增加 x64']] }, { path: 'docs/发布说明.md', status: 'M', add: 2, del: 1, external: true, diff: [['-', '旧说明'], ['+', '新说明（来源未确认）'], ['+', '…']] }], diffState: { kind: 'incomplete', note: '这一轮期间另有程序修改了 docs/发布说明.md（已标“外部修改”）；它的来源无法确认是 Agent' } },
    { id: 't3', user: U('u3', '把 resources/ 下的大文件也整理一下。', '15:20'), state: 'done', entries: [], final: ['已整理。'], changes: [], diffState: { kind: 'unavailable', note: '目录超出已验证规模（10 GiB／2 万个文件），本轮改动记录不可用；任务不受影响，可用 svn status 查看' } },
  ] },
  { id: 'message-ui', group: '联动', name: 'S08 消息细节（代码块、附件、发送失败、草稿冲突）', desc: '代码块复制／换行／在终端运行；长消息折叠；附件标签；发送失败重试；草稿冲突', status: 'done', draftConflict: true, turns: [
    { id: 't1', user: U('u1', '这是复现日志和截图，帮我看看为什么 x64 包启动就崩溃。\n\n' + Array.from({ length: 14 }, (_, i) => `[${String(i).padStart(2, '0')}:12:0${i % 10}] dyld: Library not loaded: @rpath/better_sqlite3.node (arch mismatch: have arm64, need x86_64)`).join('\n'), '15:30', { attachments: [{ kind: 'file', name: 'crash.log', path: 'fixtures/large.log' }, { kind: 'image', name: '启动崩溃截图.png' }, { kind: 'ref', name: '禅道 Bug #1234 · x64 启动崩溃' }] }), state: 'done', entries: [T.read1],
      final: ['原因是 x64 包里混入了 arm64 的 better-sqlite3。重建原生模块即可：', '```bash', 'pnpm exec electron-rebuild -f -w better-sqlite3 --arch x64', 'pnpm package:release --platform mac --arch x64', '```', '重建后再跑一次架构核对。'] },
    { id: 't2', user: U('u2', '好的，顺便把 arm64 也重建一下。', '15:33', { failed: '发送失败：执行器连接中断，消息未送达（已确认未发出）' }) },
  ] },
);

export function statusLine(s) {
  return null;
}

// 目标状态（复核 RF01）：按 任务 ID＋目标 ID＋修订 保存，清除某任务的目标不影响其他任务；新设目标（新 ID 或新修订）不继承旧状态。
export const GOAL_STATE = new Map();
export const goalKey = (taskId, e) => `${taskId}::${e.id}::${e.rev ?? 1}`;
export const goalStatus = (taskId, e) => GOAL_STATE.get(goalKey(taskId, e)) ?? e.status;
export const setGoalStatus = (taskId, e, status) => { GOAL_STATE.set(goalKey(taskId, e), status); };
// 有未清除、未完成的目标时锁定切换执行器（用户 2026-11-17 决定）
export function goalLock(taskId, scenario) {
  for (const t of scenario?.turns || []) for (const e of t.entries || []) if (e.kind === 'goal') { const st = goalStatus(taskId, e); if (st !== 'cleared' && st !== 'complete') return { status: st, agent: e.agent, goalId: e.id }; }
  return null;
}

const diffHistory = Array.from({ length: 54 }, (_, index) => {
  const number = index + 1;
  const path = 'notes/round-' + number + '.md';
  const unavailable = number === 2 || number === 3;
  return {
    id: 'history-' + number, diffLabel: '第 ' + number + ' 轮', state: 'done', entries: [],
    user: U('history-input-' + number, '更新第 ' + number + ' 轮的检查记录。', '10:24'),
    final: ['已更新检查记录。'],
    diffState: number === 2 ? { kind: 'reclaimed' } : number === 3 ? { kind: 'storage-full' } : null,
    changes: unavailable ? [] : [{ path, status: 'M', add: 1, del: 0, diff: [['+', '检查记录 ' + number]] }],
  };
});
SCENARIOS.push({ id: 'diff-history', group: '联动', name: 'S13 历史差异与空间回收', desc: '从指定轮次进入差异，选择全部 54 条记录。', status: 'done', turns: diffHistory });
