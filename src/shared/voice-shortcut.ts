/** Use physical codes: Shift+9 is still 9, and Option/IME must not change the shortcut. */
export interface ShortcutKeyEvent {
  code: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
}
export type RecordedShortcut = { kind: 'ignore' } | { kind: 'cancel' } | { kind: 'invalid' } | { kind: 'shortcut'; value: string };
export function recordVoiceShortcut(event: ShortcutKeyEvent): RecordedShortcut {
  if (event.code === 'Escape' || event.key === 'Escape') return { kind: 'cancel' };
  if (event.repeat || /^(Meta|Control|Alt|Shift|Fn)(Left|Right)?$/.test(event.code) || ['Meta', 'Control', 'Alt', 'Shift', 'Fn'].includes(event.key)) return { kind: 'ignore' };
  const modifiers = [event.metaKey && 'Command', event.ctrlKey && 'Control', event.altKey && 'Option', event.shiftKey && 'Shift'].filter(Boolean);
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3)
    : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5)
    : event.code === 'Space' ? 'Space'
    : /^F(?:[1-9]|1[0-9]|20)$/.test(event.code) ? event.code
    : !event.code && /^[a-z0-9]$/i.test(event.key) ? event.key.toUpperCase() : null;
  if (!modifiers.length || !key) return { kind: 'invalid' };
  return { kind: 'shortcut', value: [...modifiers, key].join('+') };
}
