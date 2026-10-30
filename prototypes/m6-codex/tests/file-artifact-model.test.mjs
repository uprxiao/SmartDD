import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNotebook, notebookOutput, notebookFixture, notebookFrameDocument, NOTEBOOK_CSP, pdfPoint, pdfRegion,
  initialPdfComments, savePdfComment, removePdfComment, beginPdfBatch, finishPdfBatch, stopPdfBatch } from '../src/file-artifact-model.mjs';

const display = data => ({ output_type: 'display_data', data });
test('Notebook schema accepts optional fields and unknown cell types become raw', () => {
  const result = parseNotebook({ cells: [{ cell_type: 'future', source: ['a', 'b'] }, { cell_type: 'code' }] }, 'A.IPYNB');
  assert.equal(result.status, 'ready'); assert.equal(result.title, 'A');
  assert.equal(result.cells[0].type, 'raw'); assert.equal(result.cells[0].source, 'ab'); assert.equal(result.cells[1].source, '');
});
test('malformed JSON and schema values give an explicit error, not an empty success', () => {
  for (const value of ['{', {}, { cells: null }, { cells: [{ cell_type: 'code', source: 7 }] },
    { cells: [{ cell_type: 'code', execution_count: 1.5 }] }, { cells: [{ cell_type: 'code', outputs: [null] }] }]) assert.equal(parseNotebook(value).status, 'error');
  assert.equal(parseNotebook({ cells: [] }).status, 'ready');
});
test('code disclosure is controlled by description, not the presence of outputs', () => {
  const result = parseNotebook({ cells: [
    { cell_type: 'code', source: 'x', outputs: [{ output_type: 'stream', text: 'x' }] },
    { cell_type: 'code', source: 'x', metadata: { description: 'An explanation' } }
  ] });
  assert.equal(result.cells[0].sourceCollapsed, false); assert.equal(result.cells[1].sourceCollapsed, true);
});
test('metadata namespace and property priority preserves cell title, description, and output summary', () => {
  const result = parseNotebook({ metadata: { title: 'Book' }, cells: [{ cell_type: 'code', metadata: {
    title: 'root', codex: { cellTitle: 'nested', description: ['first', ' second'], outputSummaries: [{ summaryMarkdown: 'summary' }] }
  }, outputs: [{ output_type: 'stream', text: 'value' }] }] });
  assert.equal(result.title, 'Book'); assert.equal(result.cells[0].title, 'nested');
  assert.equal(result.cells[0].description, 'first second'); assert.equal(result.cells[0].outputs[0].summaryMarkdown, 'summary');
  const ignored = parseNotebook({cells:[{cell_type:'code',metadata:{outputSummaries:{0:{summaryMarkdown:'invalid record'}}},outputs:[{output_type:'stream',text:'value'}]}]});
  assert.equal(ignored.cells[0].outputs[0].summaryMarkdown,null);
});
test('MIME priority is image png, jpeg, svg, html, markdown, plain, json, vega', () => {
  const values = { 'image/png': ' a\nb ', 'image/jpeg': 'jpeg', 'image/svg+xml': '<svg/>', 'text/html': '<b>x</b>',
    'text/markdown': '# x', 'text/plain': '', 'application/json': { a: 1 }, 'application/vnd.vega.v5+json': { b: 2 } };
  const expected = ['image', 'image', 'image', 'html', 'markdown', 'text', 'json', 'json'];
  Object.keys(values).forEach((key, i) => { const result = notebookOutput(display(values)); assert.equal(result.type, expected[i], key); if (i === 0) assert.equal(result.dataUrl, 'data:image/png;base64,ab'); delete values[key]; });
  assert.equal(notebookOutput(display(values)), null);
});
test('blank html/markdown falls through but blank text is a real output', () => {
  assert.equal(notebookOutput(display({ 'text/html': ' ', 'text/markdown': '\n', 'text/plain': '' })).type, 'text');
  assert.equal(notebookOutput(display({ 'text/html': ['a', 2] })), null);
});
test('streams, error defaults, traceback, execute_result and unsupported branches', () => {
  assert.equal(notebookOutput({ output_type: 'stream' }), null);
  assert.equal(notebookOutput({ output_type: 'stream', text: ['a', 'b'] }).text, 'ab');
  assert.deepEqual(notebookOutput({ output_type: 'error', traceback: ['a\n', 'b'] }), { type: 'error', ename: 'Error', evalue: '', traceback: 'a\nb', summaryMarkdown: null });
  assert.equal(notebookOutput({ output_type: 'execute_result', data: { 'text/plain': 'yes' } }).text, 'yes');
  assert.equal(notebookOutput({ output_type: 'update_display_data', data: { 'text/plain': 'no' } }), null);
});
test('Notebook fixture covers all cell/output categories and invalid/empty states', () => {
  const document = parseNotebook(notebookFixture());
  assert.equal(document.cells.length, 8);
  assert.deepEqual([...new Set(document.cells.flatMap(cell => cell.outputs.map(output => output.type)))].sort(), ['error', 'html', 'image', 'json', 'markdown', 'stream', 'text']);
  assert.equal(parseNotebook(notebookFixture('empty')).cells.length, 0);
  assert.equal(parseNotebook(notebookFixture('invalid-json')).status, 'error');
  assert.equal(parseNotebook(notebookFixture('invalid-schema')).status, 'error');
});
test('frame policy explicitly denies scripts, connections, frames, forms, objects and base changes', () => {
  for (const directive of ['default-src', 'base-uri', 'connect-src', 'form-action', 'frame-src', 'object-src', 'script-src']) assert.ok(NOTEBOOK_CSP.includes(directive + " 'none'"));
  const fallback = notebookFrameDocument('<script>alert(1)</script><img src="https://example.invalid">', undefined);
  assert.ok(fallback.includes('&lt;script&gt;')); assert.ok(!fallback.includes('<script>'));
  assert.ok(fallback.indexOf('Content-Security-Policy') < fallback.indexOf('<body>'));
});
test('PDF client coordinates scale to page coordinates and clamp at every edge', () => {
  assert.deepEqual(pdfPoint({ x: 160, y: 250 }, { left: 10, top: 50, width: 300, height: 400 }, { width: 600, height: 800 }), { x: 300, y: 400 });
  assert.deepEqual(pdfPoint({ x: -20, y: 500 }, { left: 10, top: 50, width: 300, height: 400 }, { width: 600, height: 800 }), { x: 0, y: 800 });
  assert.equal(pdfPoint({ x: 0, y: 0 }, { left: 0, top: 0, width: 0, height: 0 }, { width: 600, height: 800 }), null);
});
test('PDF reverse-direction drag yields a bounded positive rectangle', () => {
  assert.deepEqual(pdfRegion({ x: 500, y: 500 }, { x: -10, y: 20 }, { width: 600, height: 800 }), { x: 0, y: 20, width: 500, height: 480 });
});
const comment = { body: '  Fix this  ', page: 2, pageSize: { width: 600, height: 800 }, anchor: { kind: 'region', rect: { x: 10, y: 20, width: 30, height: 40 }, selectedText: 'text' } };
test('queued comments keep page/region/text context and can be edited or deleted', () => {
  const initial = initialPdfComments('task-A:file.pdf');
  const added = savePdfComment(initial, comment);
  assert.equal(initial.requests.length, 0); assert.equal(added.requests[0].body, 'Fix this');
  assert.deepEqual(added.requests[0].anchor, comment.anchor);
  const edited = savePdfComment(added, { ...comment, body: 'Changed', id: added.requests[0].id });
  assert.equal(edited.requests.length, 1); assert.equal(edited.requests[0].body, 'Changed');
  assert.equal(removePdfComment(edited, edited.requests[0].id).phase, 'idle');
});
test('blank/invalid annotation cannot be queued', () => {
  const state = initialPdfComments();
  assert.equal(savePdfComment(state, { ...comment, body: '  ' }), state);
  assert.equal(savePdfComment(state, { ...comment, page: 0 }), state);
  assert.equal(savePdfComment(state, { ...comment, anchor: null }), state);
});
test('failed batches retain comments; retries deliver once and clear only the queue', () => {
  const working = beginPdfBatch(savePdfComment(initialPdfComments(), comment));
  const failed = finishPdfBatch(working, { scope: working.scope, operation: working.operation, failed: true });
  assert.equal(failed.requests.length, 1); assert.equal(failed.phase, 'failed');
  const retry = beginPdfBatch(failed), sent = finishPdfBatch(retry, { scope: retry.scope, operation: retry.operation });
  assert.equal(sent.phase, 'sent'); assert.equal(sent.requests.length, 0); assert.equal(sent.delivered.length, 1);
  assert.equal(finishPdfBatch(sent, { scope: retry.scope, operation: retry.operation }), sent);
});
test('stopped or foreign-scope completion cannot consume current comments', () => {
  const working = beginPdfBatch(savePdfComment(initialPdfComments('a'), comment));
  assert.equal(finishPdfBatch(working, { scope: 'b', operation: working.operation }), working);
  const stopped = stopPdfBatch(working);
  assert.equal(finishPdfBatch(stopped, { scope: working.scope, operation: working.operation }), stopped);
  assert.equal(stopped.requests.length, 1);
});
test('working batch locks edits/deletion and cannot be submitted a second time', () => {
  const working = beginPdfBatch(savePdfComment(initialPdfComments(), comment));
  assert.equal(beginPdfBatch(working), working); assert.equal(savePdfComment(working, comment), working);
  assert.equal(removePdfComment(working, working.requests[0].id), working);
});
