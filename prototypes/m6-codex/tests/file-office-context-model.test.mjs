import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficeContexts, addOfficeContext, beginOfficeContexts, startOfficeContext, finishOfficeContext, officeContextResult, formatOfficeContext, deliverOfficeContext } from '../src/file-office-context-model.mjs';
const queued = () => addOfficeContext(createOfficeContexts('pptx:deck.pptx'), { body: ' 修改中文 😀\n第二行 ', page: 2, elementId: 'title', selectedText: '原文' });
const started = () => startOfficeContext(beginOfficeContexts(queued()), 1, 'office-comment-1');

test('Office context captures exact draft/page/selection independently of document edits', () => {
  const state = queued(), text = formatOfficeContext('材料/计划.pptx', state.requests[0]);
  assert.equal(text, '材料/计划.pptx · 第 2 页\n对象：title\n所选文字：原文\n评论： 修改中文 😀\n第二行 ');
  assert.equal(state.requests[0].delivery, 'queued'); assert.equal(addOfficeContext(state, { body: ' ', page: 1 }), state);
});
test('inserted receipt ends delivery without CLI review or resend', () => {
  const state = started(), next = finishOfficeContext(state, state.scope, 1, 'office-comment-1', 'inserted');
  assert.equal(next.phase, 'inserted'); assert.equal(beginOfficeContexts(next), next); assert.equal(next.requests[0].body, state.requests[0].body);
  assert.deepEqual(Object.keys(next).sort(), ['error','nextId','operation','pendingIds','phase','requests','scope']);
});
test('failed receipt retains content and permits one explicit retry', () => {
  const state = started(), failed = finishOfficeContext(state, state.scope, 1, 'office-comment-1', 'failed');
  const retry = beginOfficeContexts(failed); assert.equal(retry.operation, 2); assert.deepEqual(retry.pendingIds, ['office-comment-1']);
  assert.equal(retry.requests[0].body, state.requests[0].body); assert.equal(beginOfficeContexts(retry), retry);
});
test('unknown is retained and excluded from retry while a new queued comment remains eligible', () => {
  const state = started(), unknown = finishOfficeContext(state, state.scope, 1, 'office-comment-1', 'unknown');
  assert.equal(beginOfficeContexts(unknown), unknown);
  const next = beginOfficeContexts(addOfficeContext(unknown, { body: '新的评论', page: 3 }));
  assert.deepEqual(next.pendingIds, ['office-comment-2']); assert.equal(next.requests[0].delivery, 'unknown');
});
test('late scope/operation/duplicate receipts cannot update another delivery', () => {
  const state = started();
  assert.equal(finishOfficeContext(state, 'docx:other.docx', 1, 'office-comment-1', 'inserted'), state);
  assert.equal(finishOfficeContext(state, state.scope, 0, 'office-comment-1', 'inserted'), state);
  const done = finishOfficeContext(state, state.scope, 1, 'office-comment-1', 'unknown');
  assert.equal(finishOfficeContext(done, state.scope, 1, 'office-comment-1', 'inserted'), done);
});
test('a newly added draft is not implicitly appended to an in-flight batch', () => {
  const state = started(), withNew = addOfficeContext(state, { body: '下一条', page: 1 });
  const done = finishOfficeContext(withNew, state.scope, 1, 'office-comment-1', 'inserted');
  assert.equal(done.phase, 'inserted'); assert.equal(done.requests[1].delivery, 'queued'); assert.deepEqual(beginOfficeContexts(done).pendingIds, ['office-comment-2']);
});
test('terminal receipt classifier treats absent/timeout as unknown and explicit rejection as failed', () => {
  assert.equal(officeContextResult({ ok: true }), 'inserted');
  assert.equal(officeContextResult({ ok: false, error: 'task-not-running' }), 'failed');
  assert.equal(officeContextResult({ ok: false, error: 'terminal-no-response' }), 'unknown');
  assert.equal(officeContextResult(undefined), 'unknown'); assert.equal(officeContextResult({ status: 'unknown' }), 'unknown');
});
test('delivery uses the Promise adapter without appending Enter or changing metadata', async () => {
  const text = '材料/计划.pptx · 第 1 页\n评论：请修改', metadata = { source: 'office-comment', path: '材料/计划.pptx', page: 1 }; let calls = 0;
  const result = await deliverOfficeContext((actual, context) => { calls++; assert.equal(actual, text); assert.equal(context, metadata); return Promise.resolve({ ok: true }); }, text, metadata);
  assert.equal(officeContextResult(result), 'inserted'); assert.equal(calls, 1);
});
test('transport rejection and timeout are unknown, no adapter is explicit failure', async () => {
  assert.equal(officeContextResult(await deliverOfficeContext(() => { throw Error('receipt lost'); }, 'x', {})), 'unknown');
  assert.equal(officeContextResult(await deliverOfficeContext(() => new Promise(() => {}), 'x', {}, 5)), 'unknown');
  assert.equal(officeContextResult(await deliverOfficeContext(null, 'x', {})), 'failed');
});
