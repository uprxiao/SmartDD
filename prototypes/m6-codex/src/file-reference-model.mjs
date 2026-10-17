// 文件引用 → 终端输入 的纯模型（M9 GAP-07）。不依赖 DOM，原型与隔离实验共用同一份实现。
// 约束：只“插入”文本，永不追加回车；不解析终端输出；不调用模型；来自文件的文本一律视为不可信。

export const REF_LIMITS = { maxSelectedChars: 4000, maxTotalChars: 8000, maxLines: 200 };

const BIDI = /[\u202A-\u202E\u2066-\u2069]/g; // 双向控制字符可伪装显示内容
// 允许 \t 与 \n；去掉其余 C0（含 ESC、^C、^D、^Z、BEL、BS、CR 单独出现）、DEL、C1（含 0x9B CSI）
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

export function sanitizeTerminalText(input) {
  const removed = {};
  const note = (key, n) => { if (n) removed[key] = (removed[key] || 0) + n; };
  let text = String(input ?? '').replace(/\r\n?/g, '\n');
  text = text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, () => { note('lone-surrogate', 1); return '�'; });
  text = text.replace(BIDI, () => { note('bidi', 1); return ''; });
  text = text.replace(CONTROL, ch => { note(ch === '\u001B' ? 'escape' : 'control', 1); return ''; });
  return { text, removed, changed: Object.keys(removed).length > 0 };
}

// 把文本变成要写给 PTY 的数据。bracketedPaste 来自 xterm 的 modes.bracketedPasteMode（目标程序是否启用 ESC[?2004h）。
// 括号粘贴模式下换行保留（按 xterm 惯例转为 \r，位于粘贴区内不会提交）；否则换行会被终端当回车提交，所以折叠为空格。
export function pasteData(text, { bracketedPaste }) {
  const clean = sanitizeTerminalText(text);
  if (bracketedPaste) return { data: '\u001B[200~' + clean.text.replace(/\n/g, '\r') + '\u001B[201~', mode: 'bracketed', collapsed: false, sanitized: clean };
  const collapsed = /\n/.test(clean.text);
  return { data: clean.text.replace(/\n+/g, ' ').trimEnd(), mode: 'plain', collapsed, sanitized: clean };
}

export const REF_KINDS = ['file', 'range', 'comment'];
const posix = value => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
export function normalizeReference(ref) {
  if (!ref || !REF_KINDS.includes(ref.kind)) return { ok: false, error: 'invalid-kind' };
  const path = posix(ref.relativePath);
  if (!path || path.split('/').includes('..') || /^[a-z]:/i.test(path) || path.includes('\0')) return { ok: false, error: 'invalid-path' };
  if (ref.kind !== 'file') {
    const r = ref.range;
    if (!r || !Number.isInteger(r.startLine) || !Number.isInteger(r.endLine) || r.startLine < 1 || r.endLine < r.startLine) return { ok: false, error: 'invalid-range' };
  }
  return { ok: true, ref: { ...ref, relativePath: path } };
}

const lineLabel = r => r.startLine === r.endLine ? 'L' + r.startLine : 'L' + r.startLine + '-' + r.endLine;
// style: 'plain'（通用，不依赖任何 CLI 的专有语法）| 'at'（@路径 提及，行号放在括号里；具体 CLI 是否识别需单独验证）
export function formatReference(ref, { style = 'plain', includeText = false, selectedText = '', note = '' } = {}) {
  const n = normalizeReference(ref); if (!n.ok) return { ok: false, error: n.error };
  const r = n.ref; const where = r.range ? ' (' + lineLabel(r.range) + ')' : '';
  const head = (style === 'at' ? '@' + r.relativePath : r.relativePath) + (style === 'at' ? where : r.range ? ':' + lineLabel(r.range) : '');
  const parts = [head];
  const comment = String(note || r.note || '').trim();
  if (comment) parts.push(comment.split('\n').map(l => '> ' + l).join('\n'));
  let truncated = false, text = '';
  if (includeText && selectedText) {
    text = selectedText; if (text.length > REF_LIMITS.maxSelectedChars) { text = text.slice(0, REF_LIMITS.maxSelectedChars); truncated = true; }
    const lines = text.split('\n'); if (lines.length > REF_LIMITS.maxLines) { text = lines.slice(0, REF_LIMITS.maxLines).join('\n'); truncated = true; }
    parts.push(text.split('\n').map(l => '    ' + l).join('\n') + (truncated ? '\n    …（已截断）' : '')); // 缩进引用，避免与围栏代码块冲突
  }
  const joined = parts.join('\n');
  if (joined.length > REF_LIMITS.maxTotalChars) return { ok: false, error: 'too-large', length: joined.length };
  return { ok: true, text: joined, truncated };
}

// 引用是否仍然指向同一内容。revision 变化只是提示，不阻止发送；文件缺失才阻止。
export function referenceStaleness(ref, current) {
  if (!current || current.missing) return 'missing';
  if (ref.revision && current.revision && ref.revision !== current.revision) return 'stale';
  if (ref.selectedTextHash && current.selectedTextHash && ref.selectedTextHash !== current.selectedTextHash) return 'stale';
  return 'fresh';
}

// 受控插入：给主进程“终端插入”RPC 用的校验。ptyId 必须属于运行中的任务；不是通用的 PTY 写入。
export function buildInsertion({ text, bracketedPaste, ptyId, taskId, owners, running }) {
  if (!taskId || !ptyId) return { ok: false, error: 'no-terminal' };
  if (owners?.get?.(ptyId) !== taskId) return { ok: false, error: 'pty-not-owned-by-task' };
  if (!running?.has?.(taskId)) return { ok: false, error: 'task-not-running' };
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'empty' };
  if (text.length > REF_LIMITS.maxTotalChars) return { ok: false, error: 'too-large' };
  const out = pasteData(text, { bracketedPaste: !!bracketedPaste });
  return { ok: true, data: out.data, mode: out.mode, collapsed: out.collapsed, removed: out.sanitized.removed, sanitized: out.sanitized.changed };
}

// 把文本中的 UTF-16 选区偏移换算为 1 起始的行号范围（选区以换行结尾时不把下一行算进去）。
export function selectionLineRange(text, start, end) {
  if (!(start >= 0) || !(end > start) || end > text.length) return null;
  const startLine = text.slice(0, start).split('\n').length;
  const last = text[end - 1] === '\n' && end - 1 > start ? end - 1 : end;
  const endLine = text.slice(0, last).split('\n').length;
  return { startLine, endLine: Math.max(startLine, endLine) };
}
// 选区文字的短哈希，用来判断引用是否仍指向同一内容（不是安全哈希用途）。
export function textFingerprint(value) { let h = 2166136261; for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); }
