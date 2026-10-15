/**
 * The size a new PTY should start with. A TUI such as Claude Code draws its first screen at the
 * spawn size, so starting at a fixed 120×32 and resizing a moment later leaves a garbled banner.
 * Every fitted terminal records its size here; before the first one, it is estimated from the
 * terminal area and the font's cell width.
 */
let last: { cols: number; rows: number } | null = null;
let font = { fontFamily: 'Menlo, monospace', fontSize: 13 };

/** The terminal settings in effect, set by the task view. */
export function recordTerminalFont(f: { fontFamily: string; fontSize: number }): void {
  font = f;
}

export function recordTerminalSize(cols: number, rows: number): void {
  if (cols > 1 && rows > 1) last = { cols, rows };
}

/** Padding of the terminal host (p-2) on each side. */
const PAD = 8;

export function terminalSize(): { cols?: number; rows?: number } {
  if (last) return last;
  // From the home page the task area is hidden: use the main area minus the runtime bar (h-8).
  const task = document.querySelector<HTMLElement>('[data-testid=task-area]');
  const main = document.querySelector<HTMLElement>('[data-testid=main-body]');
  const box = task && task.clientWidth > 0 ? { w: task.clientWidth, h: task.clientHeight } : main ? { w: main.clientWidth, h: main.clientHeight - 32 } : null;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!box || !ctx || box.w <= 0 || box.h <= 0) return {};
  ctx.font = `${font.fontSize}px ${font.fontFamily}`;
  const cell = ctx.measureText('W'.repeat(50)).width / 50;
  // xterm rounds the cell height of lineHeight 1.0 to whole device pixels of about 1.2 × size.
  const lineHeight = Math.ceil(font.fontSize * 1.2);
  if (!cell) return {};
  return {
    cols: Math.max(20, Math.floor((box.w - 2 * PAD) / cell)),
    rows: Math.max(5, Math.floor((box.h - 2 * PAD) / lineHeight)),
  };
}
