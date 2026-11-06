import { describe, expect, it } from 'vitest';
import { FILE_LIMITS } from './files';
import { decodeFileText, encodeFileText, preferredEol, textOffsetMap } from './file-text';
import { EditorState } from '@codemirror/state';
import { history, redo, undo } from '@codemirror/commands';
import { createSourceField } from '../renderer/features/files/editor-source';

describe('lossless file text and editor transactions', () => {
  it('roundtrips UTF-8, BOM, mixed EOLs, Chinese and astral code points exactly', () => {
    const raw = '中文 😀\r\none\rtwo\n';
    for (const bom of [false, true]) {
      const bytes = encodeFileText(raw, bom), decoded = decodeFileText(bytes);
      expect(decoded).toEqual({ kind: 'text', raw, bom, editable: true });
      if (decoded.kind === 'text') expect(encodeFileText(decoded.raw, decoded.bom)).toEqual(bytes);
    }
  });
  it('does not replace invalid UTF-8, unknown encodings or incomplete surrogate pairs', () => {
    expect(decodeFileText(new Uint8Array([0xc3, 0x28])).kind).toBe('unsupported-encoding');
    expect(decodeFileText(new Uint8Array([0xff, 0xfe, 0x61, 0])).kind).toBe('unsupported-encoding');
    expect(decodeFileText(new Uint8Array([97, 0, 98])).kind).toBe('binary');
    expect(() => encodeFileText('bad \ud800', false)).toThrow('Unicode');
    expect(() => encodeFileText('\udc00', false)).toThrow('Unicode');
  });
  it('checks editing and reading budgets using bytes, including a BOM', () => {
    const input = new Uint8Array(FILE_LIMITS.editableText).fill(97);
    expect(decodeFileText(input).editable).toBe(true);
    expect(decodeFileText(new Uint8Array(FILE_LIMITS.editableText + 1).fill(97)).editable).toBe(false);
    expect(decodeFileText(new Uint8Array(FILE_LIMITS.readableText + 1)).kind).toBe('too-large');
    expect(() => encodeFileText('a'.repeat(FILE_LIMITS.editableText), true)).toThrow('TOO_LARGE');
    expect(encodeFileText('a'.repeat(FILE_LIMITS.editableText), true, 'checkpoint').byteLength).toBe(FILE_LIMITS.editableText + 3);
    expect(() => encodeFileText('a'.repeat(FILE_LIMITS.readableText), true, 'checkpoint')).toThrow('20 MiB');
  });
  it('maps every editor position without conflating UTF-16 offsets with bytes', () => {
    const raw = '甲😀\r\n乙\r丙\n末', map = textOffsetMap(raw);
    expect(map.normalized).toBe('甲😀\n乙\n丙\n末');
    for (let p = 0; p <= map.normalized.length; p++) expect(map.rawToCm(map.cmToRaw(p))).toBe(p);
    expect(() => map.cmToRaw(-1)).toThrow(); expect(() => map.rawToCm(raw.length + 1)).toThrow();
    expect(preferredEol('a\r\nb\rc\n')).toBe('\r\n');
    expect(preferredEol('a\rb\n')).toBe('\r'); expect(preferredEol('one line')).toBe('\n');
  });
  it('preserves untouched endings and restores them on real CodeMirror undo/redo', () => {
    const raw = 'first\r\nsecond\rthird\n中文😀', source = createSourceField(raw);
    let state = EditorState.create({ doc: source.normalized, extensions: [source.extensions, history()] });
    const edited = state.update({ changes: [{ from: 0, to: 5, insert: 'NEW\nROW' }, { from: 13, to: 18, insert: 'THIRD' }] });
    state = edited.state;
    expect(state.field(source.field).raw).toBe('NEW\r\nROW\r\nsecond\rTHIRD\n中文😀');
    const after = state.field(source.field).raw;
    expect(undo({ state, dispatch: (transaction) => { state = transaction.state; } })).toBe(true);
    expect(state.field(source.field).raw).toBe(raw);
    expect(redo({ state, dispatch: (transaction) => { state = transaction.state; } })).toBe(true);
    expect(state.field(source.field).raw).toBe(after);
  });
  it('keeps concurrent editor fields independent', () => {
    const a = createSourceField('A\r\n'), b = createSourceField('B\n');
    const aState = EditorState.create({ doc: a.normalized, extensions: a.extensions });
    const bState = EditorState.create({ doc: b.normalized, extensions: b.extensions });
    expect(aState.update({ changes: { from: 0, insert: 'a\n' } }).state.field(a.field).raw).toBe('a\r\nA\r\n');
    expect(bState.update({ changes: { from: 0, insert: 'b\n' } }).state.field(b.field).raw).toBe('b\nB\n');
  });
});
