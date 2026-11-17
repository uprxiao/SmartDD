// 输入框选用菜单的纯逻辑（需求 R01）：/命令只列当前执行器公布或宿主支持的项，@文件按任务目录查找，$Skill 列执行器公布的 Skill。
// 选用只把引用插入草稿，不自动发送。

export type MenuKind = '/' | '@' | '$';
export interface MenuTrigger { kind: MenuKind; query: string; start: number; end: number }
export interface MenuItem { key: string; label: string; detail?: string; insert: string; action?: 'terminal' | 'model' }

/** 找光标所在的触发词：/ 只在输入开头，@ 与 $ 需在行首或空白之后。 */
export function findTrigger(text: string, caret: number): MenuTrigger | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)([@$])([^\s@$]*)$/.exec(before);
  if (m) return { kind: m[2] as MenuKind, query: m[3], start: caret - m[3].length - 1, end: caret };
  const s = /^\/([^\s]*)$/.exec(before);
  if (s) return { kind: '/', query: s[1], start: 0, end: caret };
  return null;
}

export function applyItem(text: string, t: MenuTrigger, item: MenuItem): { text: string; caret: number } {
  const next = text.slice(0, t.start) + item.insert + text.slice(t.end);
  return { text: next, caret: t.start + item.insert.length };
}

export interface Catalog { commands: string[]; skills: { name: string; description?: string }[] }
const HOST: MenuItem[] = [
  { key: 'terminal', label: '/terminal', detail: '打开手动终端', insert: '', action: 'terminal' },
  { key: 'model', label: '/model', detail: '切换模型与权限', insert: '', action: 'model' },
];
const KNOWN: Record<string, string> = { goal: '设定目标，跨多轮工作直到完成', compact: '压缩上下文', review: 'Codex：审查当前改动', init: 'Claude Code：生成 CLAUDE.md' };

/** 命令菜单：宿主命令＋执行器公布的命令（Codex 为协议支持的 goal／compact／review；Claude 取初始化公布的 slash_commands）。 */
export function commandItems(catalog: Catalog, query: string): MenuItem[] {
  const q = query.toLowerCase();
  const native = catalog.commands.map(c => c.replace(/^\//, '')).filter(Boolean)
    .map(c => ({ key: `n:${c}`, label: `/${c}`, detail: KNOWN[c] ?? '执行器命令', insert: `/${c} ` }));
  // 命令按前缀匹配（输入 /in 只出 /init，不出 /terminal）。
  return [...HOST, ...native].filter(i => i.label.slice(1).toLowerCase().startsWith(q)).slice(0, 30);
}
export function skillItems(catalog: Catalog, query: string): MenuItem[] {
  const q = query.toLowerCase();
  return catalog.skills.filter(s => s.name.toLowerCase().includes(q)).slice(0, 30).map(s => ({ key: `s:${s.name}`, label: `$${s.name}`, detail: s.description, insert: `$${s.name} ` }));
}
export function fileItems(paths: string[]): MenuItem[] {
  return paths.map(p => ({ key: `f:${p}`, label: p.split('/').pop() ?? p, detail: p, insert: `@${p} ` }));
}
