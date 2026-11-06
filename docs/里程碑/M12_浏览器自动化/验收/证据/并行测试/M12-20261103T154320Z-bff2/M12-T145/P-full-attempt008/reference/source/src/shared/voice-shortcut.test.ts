import { describe, expect, it } from 'vitest';
import { recordVoiceShortcut, type ShortcutKeyEvent } from './voice-shortcut';

const key = (patch: Partial<ShortcutKeyEvent>): ShortcutKeyEvent => ({ code: '', key: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...patch });
describe('voice shortcut recording with physical keys', () => {
  it.each([
    [{ code: 'Digit9', key: '(', ctrlKey: true, shiftKey: true }, 'Control+Shift+9'],
    [{ code: 'KeyV', key: '√', altKey: true }, 'Option+V'],
    [{ code: 'KeyK', key: 'Process', ctrlKey: true, shiftKey: true }, 'Control+Shift+K'],
    [{ code: 'Space', key: ' ', metaKey: true, shiftKey: true }, 'Command+Shift+Space'],
    [{ code: 'F12', key: 'F12', ctrlKey: true }, 'Control+F12'],
    [{ key: 'a', metaKey: true }, 'Command+A'],
  ] as const)('normalizes %j', (event, value) => {
    expect(recordVoiceShortcut(key(event))).toEqual({ kind: 'shortcut', value });
  });
  it.each(['ControlLeft', 'ShiftRight', 'AltRight', 'MetaLeft', 'Fn'])('waits for a main key after %s', code => {
    expect(recordVoiceShortcut(key({ code, ctrlKey: true }))).toEqual({ kind: 'ignore' });
  });
  it('ignores autorepeat and lets Escape cancel even with modifiers held', () => {
    expect(recordVoiceShortcut(key({ code: 'KeyV', ctrlKey: true, repeat: true }))).toEqual({ kind: 'ignore' });
    expect(recordVoiceShortcut(key({ code: 'Escape', ctrlKey: true }))).toEqual({ kind: 'cancel' });
  });
  it.each([
    { code: 'KeyA', key: 'a' }, { code: 'ArrowLeft', ctrlKey: true },
    { code: 'Slash', key: '?', shiftKey: true }, { code: 'F21', ctrlKey: true },
    { code: 'Unidentified', key: 'Process', ctrlKey: true },
  ])('keeps recording instead of accepting unsupported input %j', event => {
    expect(recordVoiceShortcut(key(event))).toEqual({ kind: 'invalid' });
  });
});
