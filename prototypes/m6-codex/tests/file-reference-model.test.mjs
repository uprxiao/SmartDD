import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionLineRange, textFingerprint, sanitizeTerminalText, pasteData, normalizeReference, formatReference, referenceStaleness, buildInsertion, REF_LIMITS } from '../src/file-reference-model.mjs';

test('sanitizer keeps tab/newline and text, removes ESC, C0, DEL, C1 and bidi controls', () => {
  const r = sanitizeTerminalText('a\tb\nc\u001b[201~d\u0003e\u0004f\u007fg\u009bh\u202Ei\r\nj\rk');
  assert.equal(r.text, 'a\tb\nc[201~defghi\nj\nk'); assert.equal(r.changed, true);
  assert.equal(r.removed.escape, 1); assert.ok(r.removed.control >= 4); assert.equal(r.removed.bidi, 1);
});
test('sanitizer leaves normal Chinese, emoji and symbols untouched and replaces lone surrogates', () => {
  const ok = '中文 😀 ñ — “引号” `code` <b>&</b>'; assert.equal(sanitizeTerminalText(ok).text, ok); assert.equal(sanitizeTerminalText(ok).changed, false);
  const lone = sanitizeTerminalText('x\ud800y\udc00z'); assert.equal(lone.text, 'x\ufffdy\ufffdz'); assert.equal(lone.removed['lone-surrogate'], 2);
  assert.equal(sanitizeTerminalText(null).text, '');
});
test('an escape sequence cannot terminate the bracketed paste early', () => {
  const evil = 'x\u001b[201~\ntouch INJECTED\n';
  const p = pasteData(evil, { bracketedPaste: true });
  assert.equal(p.data.split('\u001b[201~').length, 2); assert.ok(p.data.endsWith('\u001b[201~')); assert.ok(p.data.startsWith('\u001b[200~'));
  assert.ok(!p.data.slice(6, -6).includes('\u001b'));
});
test('bracketed paste keeps line breaks; plain mode collapses them so it can never submit; no trailing CR in either', () => {
  const b = pasteData('a\nb', { bracketedPaste: true }); assert.equal(b.data, '\u001b[200~a\rb\u001b[201~'); assert.equal(b.collapsed, false);
  const q = pasteData('a\nb\n\nc\n', { bracketedPaste: false }); assert.equal(q.data, 'a b c'); assert.equal(q.collapsed, true); assert.ok(!q.data.includes('\r') && !q.data.includes('\n'));
  assert.ok(!b.data.endsWith('\r') && !b.data.slice(0, -6).endsWith('\r'));
});
test('reference normalisation rejects traversal, drive paths, bad kinds and ranges', () => {
  for (const bad of [{ kind: 'x', relativePath: 'a' }, { kind: 'file', relativePath: '../a' }, { kind: 'file', relativePath: 'a/../../b' }, { kind: 'file', relativePath: 'C:/x' }, { kind: 'file', relativePath: '' }, { kind: 'range', relativePath: 'a', range: { startLine: 0, endLine: 1 } }, { kind: 'range', relativePath: 'a', range: { startLine: 5, endLine: 4 } }, { kind: 'range', relativePath: 'a' }, null])
    assert.equal(normalizeReference(bad).ok, false, JSON.stringify(bad));
  assert.equal(normalizeReference({ kind: 'file', relativePath: '\\docs\\a.md' }).ref.relativePath, 'docs/a.md');
});
test('reference formatting: plain and @ styles, comment quoting, indented selected text, truncation and size cap', () => {
  const ref = { kind: 'range', relativePath: 'src/a.ts', range: { startLine: 12, endLine: 18 } };
  assert.equal(formatReference(ref).text, 'src/a.ts:L12-18');
  assert.equal(formatReference(ref, { style: 'at' }).text, '@src/a.ts (L12-18)');
  assert.equal(formatReference({ kind: 'file', relativePath: 'a.md' }, { style: 'at' }).text, '@a.md');
  assert.equal(formatReference({ kind: 'range', relativePath: 'a', range: { startLine: 3, endLine: 3 } }).text, 'a:L3');
  const withText = formatReference(ref, { includeText: true, selectedText: 'x\n```\ny', note: '改成 async\n并加测试' });
  assert.equal(withText.text, 'src/a.ts:L12-18\n> 改成 async\n> 并加测试\n    x\n    ```\n    y');
  const big = formatReference(ref, { includeText: true, selectedText: 'a'.repeat(REF_LIMITS.maxSelectedChars + 10) }); assert.equal(big.truncated, true); assert.match(big.text, /已截断/);
  const many = formatReference(ref, { includeText: true, selectedText: Array.from({ length: REF_LIMITS.maxLines + 5 }, () => 'l').join('\n') }); assert.equal(many.truncated, true);
  assert.equal(formatReference(ref, { note: 'n'.repeat(REF_LIMITS.maxTotalChars + 1) }).error, 'too-large');
  assert.equal(formatReference({ kind: 'file', relativePath: '../x' }).ok, false);
});
test('staleness: revision or text hash change is stale, missing blocks, unknown stays fresh', () => {
  const ref = { revision: 'r1', selectedTextHash: 'h1' };
  assert.equal(referenceStaleness(ref, { revision: 'r1', selectedTextHash: 'h1' }), 'fresh'); assert.equal(referenceStaleness(ref, { revision: 'r2' }), 'stale');
  assert.equal(referenceStaleness(ref, { revision: 'r1', selectedTextHash: 'h2' }), 'stale'); assert.equal(referenceStaleness(ref, { missing: true }), 'missing');
  assert.equal(referenceStaleness(ref, null), 'missing'); assert.equal(referenceStaleness({}, { revision: 'r9' }), 'fresh');
});
test('terminal insertion validates ownership, running state, size, emptiness and reports sanitising', () => {
  const owners = new Map([['p1', 't1']]), running = new Set(['t1']);
  const ok = buildInsertion({ text: 'hi\u001b', bracketedPaste: true, ptyId: 'p1', taskId: 't1', owners, running }); assert.equal(ok.ok, true); assert.equal(ok.sanitized, true); assert.equal(ok.mode, 'bracketed');
  assert.equal(buildInsertion({ text: 'hi', ptyId: 'p1', taskId: 't2', owners, running }).error, 'pty-not-owned-by-task');
  assert.equal(buildInsertion({ text: 'hi', ptyId: 'p9', taskId: 't1', owners, running }).error, 'pty-not-owned-by-task');
  assert.equal(buildInsertion({ text: 'hi', ptyId: 'p1', taskId: 't1', owners, running: new Set() }).error, 'task-not-running');
  assert.equal(buildInsertion({ text: '  ', ptyId: 'p1', taskId: 't1', owners, running }).error, 'empty');
  assert.equal(buildInsertion({ text: 'x'.repeat(REF_LIMITS.maxTotalChars + 1), ptyId: 'p1', taskId: 't1', owners, running }).error, 'too-large');
  assert.equal(buildInsertion({ text: 'x', ptyId: '', taskId: 't1', owners, running }).error, 'no-terminal');
});
test('selection line ranges use 1-based lines and ignore a trailing newline', () => {
  const text = 'a\nbb\nccc\nd';
  assert.deepEqual(selectionLineRange(text, 0, 1), { startLine: 1, endLine: 1 });
  assert.deepEqual(selectionLineRange(text, 2, 9), { startLine: 2, endLine: 3 });
  assert.deepEqual(selectionLineRange(text, 2, 5), { startLine: 2, endLine: 2 }); // 选到“bb\n”不应把第 3 行算进去
  assert.deepEqual(selectionLineRange(text, 2, 6), { startLine: 2, endLine: 3 }); // “bb\nc”确实跨到第 3 行
  assert.deepEqual(selectionLineRange(text, 0, text.length), { startLine: 1, endLine: 4 });
  for (const bad of [[-1, 2], [3, 3], [3, 2], [0, 99]]) assert.equal(selectionLineRange(text, ...bad), null);
  assert.deepEqual(selectionLineRange('😀\nx', 0, 2), { startLine: 1, endLine: 1 });
});
test('text fingerprint is stable, 8 hex chars, and sensitive to content', () => {
  assert.equal(textFingerprint('abc'), textFingerprint('abc')); assert.match(textFingerprint(''), /^[0-9a-f]{8}$/); assert.notEqual(textFingerprint('abc'), textFingerprint('abd'));
});
