import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfPageWindow, beginPdfDelivery, finishPdfDeliveryItem, stopPdfDelivery, pdfDeliveryResult } from '../src/file-pdf-model.mjs';

test('2000 mixed-size PDF pages mount a viewport window and retain exact scroll offsets', () => {
  const sizes = Array.from({ length: 2000 }, (_, i) => ({ width: 595, height: i % 2 ? 842 : 600 }));
  const first = pdfPageWindow(sizes, 100, 0, 800);
  const last = pdfPageWindow(sizes, 100, first.offsets[1999], 800);
  assert.ok(first.numbers.length < 5); assert.ok(last.numbers.includes(2000)); assert.ok(last.numbers.length < 5);
  assert.equal(last.before + (last.offsets[2000] - last.before) + last.after, last.offsets[2000]);
});
test('PDF batch tracks each delivery, retains unknown and rejects late callbacks', () => {
  const base = { requests: [{ id: 'a' }, { id: 'b' }], phase: 'idle', operation: 0 };
  const begun = beginPdfDelivery(base);
  const first = finishPdfDeliveryItem(begun, 1, 'a', 'inserted');
  const unknown = finishPdfDeliveryItem(first, 1, 'b', 'unknown');
  assert.equal(unknown.requests[0].delivery, 'inserted'); assert.equal(unknown.requests[1].delivery, 'unknown');
  assert.equal(beginPdfDelivery(unknown), unknown); // no automatic duplicate
  assert.equal(finishPdfDeliveryItem(unknown, 1, 'b', 'inserted'), unknown);
  const stopped = stopPdfDelivery({ ...begun, requests: [{ id: 'a', delivery: 'inserting' }, { id: 'b' }] });
  assert.equal(stopped.requests[0].delivery, 'unknown'); assert.equal(stopped.requests[1].delivery, undefined);
  assert.equal(finishPdfDeliveryItem(stopped, 1, 'a', 'inserted'), stopped);
});
test('PDF delivery receipts describe insertion, including unavailable and ambiguous results', () => {
  assert.equal(pdfDeliveryResult({ ok: true }), 'inserted');
  assert.equal(pdfDeliveryResult({ ok: false, error: 'terminal-no-response' }), 'unknown');
  assert.equal(pdfDeliveryResult({ ok: false, error: 'task-not-running' }), 'failed');
});
