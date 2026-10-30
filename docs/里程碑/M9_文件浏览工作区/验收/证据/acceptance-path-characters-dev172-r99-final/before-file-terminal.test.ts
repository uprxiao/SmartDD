import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { formatTerminalReferences, sanitizeTerminalText, terminalBodyData, terminalPathData, truncateSelection, validateReferencePath } from './file-terminal';

describe('controlled terminal payloads', () => {
  it('cleans every C0/DEL/C1/bidi class, preserves CJK/TAB/LF and replaces lone surrogates', () => {
    const controls = [...Array(160).keys()].filter(code => code < 32 && code !== 9 && code !== 10 && code !== 13 || code >= 127).map(code => String.fromCharCode(code)).join('');
    const bidi = '\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069';
    expect(sanitizeTerminalText(controls + bidi + '中文🙂\t\r\n\rA\ud800B\udc00')).toEqual({ text: '中文🙂\t\n\nA�B�', removed: controls.length + bidi.length, replaced: 2 });
    expect(terminalBodyData('one\n\x1b[201~\x03two', false)).toBe('one [201~two');
    expect(terminalBodyData('one\ntwo', true)).toBe('\x1b[200~one\rtwo\x1b[201~');
  });
  it('truncates selection limits without splitting UTF-16 pairs', () => {
    expect(truncateSelection('中'.repeat(4000))).toEqual({ text: '中'.repeat(4000), truncated: false });
    expect(truncateSelection('中'.repeat(4001))).toEqual({ text: '中'.repeat(4000), truncated: true });
    expect(truncateSelection('a'.repeat(3999) + '🙂')).toEqual({ text: 'a'.repeat(3999), truncated: true });
    expect(truncateSelection(Array(200).fill('x').join('\n')).truncated).toBe(false);
    expect(truncateSelection(Array(201).fill('x').join('\n'))).toEqual({ text: Array(200).fill('x').join('\n'), truncated: true });
  });
  it('formats range/comment consistently and rejects aggregate 8001 while allowing 8000', () => {
    const sourceId = randomUUID();
    expect(formatTerminalReferences([{ sourceId, relativePath: '目录/a.ts', kind: 'comment', range: { startLine: 2, endLine: 3 }, comment: ' note ', text: 'one\ntwo' }], { includeText: true, style: 'at' }).text).toBe('@目录/a.ts (L2-3)\n> note\n    one\n    two');
    const ref = [{ sourceId, relativePath: 'a', kind: 'file' as const }];
    expect(formatTerminalReferences(ref, { includeText: false, style: 'plain', instruction: 'x'.repeat(7997) }).text.length).toBe(8000);
    expect(() => formatTerminalReferences(ref, { includeText: false, style: 'plain', instruction: 'x'.repeat(7998) })).toThrow('8001');
  });
  it('keeps exact safe absolute paths and rejects unsafe/oversize identity rather than sanitizing it', () => {
    const path = '/tmp/中文 空格🙂\'\"();`$().png'; expect(terminalPathData(path)).toBe(path + ' ');
    for (const suffix of ['\n', '\r', '\t', '\x1b', '\u009b', '\u202e', '\ud800']) expect(() => terminalPathData('/tmp/a' + suffix)).toThrow('不能安全');
    expect(terminalPathData('/' + 'a'.repeat(7997)).length).toBe(7999);
    expect(terminalPathData('/' + 'a'.repeat(7998)).length).toBe(8000);
    expect(() => terminalPathData('/' + 'a'.repeat(7999))).toThrow('8001');
    for (const path of ['../x', 'a/../x', 'C:x', '/absolute', '\\absolute', 'a\0b']) expect(() => validateReferencePath(path)).toThrow();
  });
  it.each([7999, 8000, 8001])('counts multiple range headers, comment and separators in the %i total', total => {
    const first = '中'.repeat(3990), comment = 'note 中文🙂', second = 'i'.repeat(total - first.length - comment.length - 23);
    const refs = [{ sourceId: randomUUID(), relativePath: 'a', kind: 'comment' as const, range: { startLine: 1, endLine: 1 }, text: first, comment }, { sourceId: randomUUID(), relativePath: 'b', kind: 'range' as const, range: { startLine: 1, endLine: 1 }, text: second }];
    const expected = 'a:L1\n> ' + comment + '\n    ' + first + '\n\nb:L1\n    ' + second; expect(expected.length).toBe(total);
    if (total > 8000) expect(() => formatTerminalReferences(refs, { includeText: true, style: 'plain' })).toThrow('8001');
    else expect(formatTerminalReferences(refs, { includeText: true, style: 'plain' }).text).toBe(expected);
  });
});
