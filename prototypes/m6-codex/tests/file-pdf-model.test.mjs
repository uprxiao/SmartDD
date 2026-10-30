import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfRenderPlan, fitWidthZoom, classifyPdfError, resolveDestinationPage, pagesToRender, MAX_CANVAS_PIXELS, MAX_CANVAS_SIDE } from '../src/file-pdf-model.mjs';

test('normal letter page at 100% keeps full resolution within the canvas budget', () => {
  const p = pdfRenderPlan(612, 792, 100, 2);
  assert.equal(p.downscaled, false); assert.equal(p.cssWidth, 816); assert.equal(p.canvasWidth, 1632);
  assert.ok(p.canvasWidth * p.canvasHeight <= MAX_CANVAS_PIXELS);
});
test('huge page is downscaled below the area and side caps and reports it', () => {
  const p = pdfRenderPlan(14400, 14400, 100, 2);
  assert.equal(p.downscaled, true);
  assert.ok(p.canvasWidth * p.canvasHeight <= MAX_CANVAS_PIXELS * 1.001); assert.ok(Math.max(p.canvasWidth, p.canvasHeight) <= MAX_CANVAS_SIDE);
});
test('long thin page is limited by the side cap, not only by area', () => {
  const p = pdfRenderPlan(50, 14400, 100, 2);
  assert.ok(Math.max(p.canvasWidth, p.canvasHeight) <= MAX_CANVAS_SIDE);
});
test('zoom scales the display size; DPR never goes below 1', () => {
  assert.equal(pdfRenderPlan(100, 100, 200, 0.5).ratio, 1); assert.ok(Math.abs(pdfRenderPlan(100, 100, 50, 1).cssWidth - 100 * 0.5 * 96 / 72) < 1e-9);
});
test('fit width never upscales beyond max and respects the lower clamp', () => {
  assert.equal(fitWidthZoom(612, 5000), 100); assert.equal(fitWidthZoom(612, 600), 73); assert.equal(fitWidthZoom(612, 1), 10);
});
test('error classification distinguishes password states from corruption', () => {
  assert.deepEqual(classifyPdfError({ name: 'PasswordException', code: 1 }), { kind: 'password', wrong: false });
  assert.deepEqual(classifyPdfError({ name: 'PasswordException', code: 2 }), { kind: 'password', wrong: true });
  assert.equal(classifyPdfError({ name: 'InvalidPDFException' }).kind, 'invalid'); assert.equal(classifyPdfError({ name: 'MissingPDFException' }).kind, 'missing');
  assert.equal(classifyPdfError({ name: 'AbortException' }).kind, 'aborted'); assert.equal(classifyPdfError(new Error('x')).kind, 'unknown'); assert.equal(classifyPdfError(null).kind, 'unknown');
});
test('destination resolution handles refs, integers, named destinations and bad input', async () => {
  const idx = async ref => ref.num === 7 ? 4 : -1;
  assert.equal(await resolveDestinationPage([{ num: 7, gen: 0 }, { name: 'Fit' }], null, idx), 4);
  assert.equal(await resolveDestinationPage([2, { name: 'Fit' }], null, idx), 2);
  assert.equal(await resolveDestinationPage('chapter', async () => [{ num: 7, gen: 0 }], idx), 4);
  assert.equal(await resolveDestinationPage('missing', async () => null, idx), null);
  assert.equal(await resolveDestinationPage([{ num: 9, gen: 0 }], null, idx), null);
  assert.equal(await resolveDestinationPage([-1], null, idx), null); assert.equal(await resolveDestinationPage([], null, idx), null);
  assert.equal(await resolveDestinationPage([{ num: 7 }], null, async () => { throw new Error('bad'); }), null);
});
test('render window covers visible pages plus margin and stays in range', () => {
  assert.deepEqual(pagesToRender([5, 6], 100), [4, 5, 6, 7]); assert.deepEqual(pagesToRender([1], 3), [1, 2]); assert.deepEqual(pagesToRender([3], 3), [2, 3]); assert.deepEqual(pagesToRender([], 3), []);
});
