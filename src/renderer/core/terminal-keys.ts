// Key mapping of the task terminal, after Yoda (Apache-2.0) src/renderer/lib/pty/pty-keybindings.ts
// and the custom key handler in use-pty.ts. macOS only, like SmartDD.

export type KeyEventLike = {
  type: string;
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
};

/** Ctrl+J (LF): CLI agents read it as a newline inside the prompt. */
export const CTRL_J = '\x0A';
/** Ctrl+U (unix-line-discard): kill to the start of the line. */
export const CTRL_U = '\x15';
/** Ctrl+A / Ctrl+E: start / end of line. */
export const CTRL_A = '\x01';
export const CTRL_E = '\x05';
/** Esc+b / Esc+f: readline word navigation. */
export const ESC_B = '\x1bb';
export const ESC_F = '\x1bf';

export type KeyAction = { kind: 'copy' } | { kind: 'send'; data: string } | null;

const only = (e: KeyEventLike, mod: 'meta' | 'alt' | 'shift') =>
  (e.metaKey === true) === (mod === 'meta') &&
  (e.altKey === true) === (mod === 'alt') &&
  (e.shiftKey === true) === (mod === 'shift') &&
  !e.ctrlKey;

/** What a key press in the terminal turns into; null: let xterm handle it. */
export function terminalKeyAction(e: KeyEventLike, hasSelection: boolean): KeyAction {
  if (e.type !== 'keydown') return null;
  if (hasSelection && e.key.toLowerCase() === 'c' && (only(e, 'meta') || (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey))) {
    return { kind: 'copy' };
  }
  if (e.key === 'Enter' && only(e, 'shift')) return { kind: 'send', data: CTRL_J };
  if (e.key === 'Backspace' && only(e, 'meta')) return { kind: 'send', data: CTRL_U };
  if (e.key === 'ArrowLeft' && only(e, 'alt')) return { kind: 'send', data: ESC_B };
  if (e.key === 'ArrowRight' && only(e, 'alt')) return { kind: 'send', data: ESC_F };
  if (e.key === 'ArrowLeft' && only(e, 'meta')) return { kind: 'send', data: CTRL_A };
  if (e.key === 'ArrowRight' && only(e, 'meta')) return { kind: 'send', data: CTRL_E };
  return null;
}

/** Yoda's fallback stack: a user font first, then monospace fonts with CJK coverage. */
export const DEFAULT_TERMINAL_FONT_FAMILY = [
  'Menlo',
  'Monaco',
  'Consolas',
  '"Liberation Mono"',
  '"Noto Sans Mono CJK SC"',
  '"Noto Sans Mono CJK TC"',
  '"Noto Sans Mono CJK JP"',
  '"PingFang SC"',
  '"Microsoft YaHei UI"',
  'monospace',
].join(', ');

export function buildTerminalFontFamily(fontFamily?: string): string {
  const trimmed = fontFamily?.trim();
  return trimmed ? `${trimmed}, ${DEFAULT_TERMINAL_FONT_FAMILY}` : DEFAULT_TERMINAL_FONT_FAMILY;
}
