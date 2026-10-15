import { describe, expect, it } from 'vitest';
import { buildTerminalFontFamily, CTRL_A, CTRL_E, CTRL_J, CTRL_U, DEFAULT_TERMINAL_FONT_FAMILY, ESC_B, ESC_F, terminalKeyAction } from './terminal-keys';

const down = (key: string, mods: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) => ({ type: 'keydown', key, ...mods });

describe('terminalKeyAction', () => {
  it('copies only with a selection', () => {
    expect(terminalKeyAction(down('c', { metaKey: true }), true)).toEqual({ kind: 'copy' });
    expect(terminalKeyAction(down('C', { ctrlKey: true, shiftKey: true }), true)).toEqual({ kind: 'copy' });
    // Without a selection ⌘C falls through; Ctrl+C stays an interrupt.
    expect(terminalKeyAction(down('c', { metaKey: true }), false)).toBeNull();
    expect(terminalKeyAction(down('c', { ctrlKey: true }), true)).toBeNull();
  });

  it('maps editing keys to readline sequences', () => {
    expect(terminalKeyAction(down('Enter', { shiftKey: true }), false)).toEqual({ kind: 'send', data: CTRL_J });
    expect(terminalKeyAction(down('Backspace', { metaKey: true }), false)).toEqual({ kind: 'send', data: CTRL_U });
    expect(terminalKeyAction(down('ArrowLeft', { altKey: true }), false)).toEqual({ kind: 'send', data: ESC_B });
    expect(terminalKeyAction(down('ArrowRight', { altKey: true }), false)).toEqual({ kind: 'send', data: ESC_F });
    expect(terminalKeyAction(down('ArrowLeft', { metaKey: true }), false)).toEqual({ kind: 'send', data: CTRL_A });
    expect(terminalKeyAction(down('ArrowRight', { metaKey: true }), false)).toEqual({ kind: 'send', data: CTRL_E });
  });

  it('leaves everything else to xterm', () => {
    expect(terminalKeyAction(down('Enter'), false)).toBeNull();
    expect(terminalKeyAction(down('Enter', { shiftKey: true, metaKey: true }), false)).toBeNull();
    expect(terminalKeyAction({ type: 'keyup', key: 'Enter', shiftKey: true }, false)).toBeNull();
    expect(terminalKeyAction(down('ArrowLeft', { altKey: true, shiftKey: true }), false)).toBeNull();
  });
});

describe('buildTerminalFontFamily', () => {
  it('puts the user font before the fallback stack', () => {
    expect(buildTerminalFontFamily(' Fira Code ')).toBe(`Fira Code, ${DEFAULT_TERMINAL_FONT_FAMILY}`);
    expect(buildTerminalFontFamily('')).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
  });
});
