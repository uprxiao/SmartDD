import test from 'node:test';
import assert from 'node:assert/strict';
import { notebookCssSafe, NOTEBOOK_CSP } from '../src/file-artifact-model.mjs';

test('Notebook keeps static styles and rejects tested resource-loading CSS forms', () => {
  for (const css of ['color:red;background-color:#fff', 'table { border-collapse:collapse }', 'font-weight:bold; padding:4px']) assert.equal(notebookCssSafe(css), true, css);
  for (const css of ['background:URL(https://example.invalid/a)', '@import "https://example.invalid/a"', 'background:image-set("https://example.invalid/a" 1x)', '@font-face {src:local(test)}', 'background:u\\72l(https://example.invalid/a)', 'width:expression(x)', 'behavior:url(a)']) assert.equal(notebookCssSafe(css), false, css);
  assert.match(NOTEBOOK_CSP, /script-src 'none'/); assert.match(NOTEBOOK_CSP, /connect-src 'none'/); assert.match(NOTEBOOK_CSP, /default-src 'none'/);
});
