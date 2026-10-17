import test from 'node:test';
import assert from 'node:assert/strict';
import { viewerAvailability, resourceUriAllowed, decodeResourceContents, interpretWriteResult, createNotificationLimiter, VIEWER_LIMITS } from '../src/file-viewer-policy.mjs';

test('configured server is not a viewer: availability follows declared capabilities', () => {
  assert.deepEqual(viewerAvailability({ capabilities: { resources: { subscribe: true } } }), { available: true, canSubscribe: true, canList: true });
  assert.equal(viewerAvailability({ capabilities: { resources: {} } }).canSubscribe, false);
  assert.equal(viewerAvailability({ capabilities: { tools: {} } }).reason, 'resources-not-declared');
  assert.equal(viewerAvailability({}).reason, 'no-capabilities'); assert.equal(viewerAvailability(null).available, false);
});
test('only the session resource URI may be read or written', () => {
  const s = 'viewer://doc/a.pptx';
  assert.equal(resourceUriAllowed('viewer://doc/a.pptx', s).ok, true); assert.equal(resourceUriAllowed('viewer://doc/a.pptx#slide=2', s).ok, true);
  for (const bad of ['viewer://doc/b.pptx', 'file:///etc/passwd', 'viewer://doc/../secret', 'http://evil.invalid/a.pptx', 'viewer://doc/a.pptx?x=1', 'not a uri', '']) assert.equal(resourceUriAllowed(bad, s).ok, false, bad);
  assert.equal(resourceUriAllowed('x', 'also bad').error, 'invalid-uri');
});
test('resource contents: size is measured on decoded bytes, base64 is validated, shapes are strict', () => {
  assert.equal(decodeResourceContents([{ text: 'héllo' }]).bytes, 6);
  assert.equal(decodeResourceContents([{ text: 'x'.repeat(11) }], { maxBytes: 10 }).error, 'too-large');
  const b = Buffer.from('abc').toString('base64'); const d = decodeResourceContents([{ blob: b, mimeType: 'application/octet-stream' }]); assert.equal(d.kind, 'blob'); assert.equal(d.data.toString(), 'abc'); assert.equal(d.bytes, 3);
  assert.equal(decodeResourceContents([{ blob: Buffer.alloc(30).toString('base64') }], { maxBytes: 20 }).error, 'too-large');
  assert.equal(decodeResourceContents([{ blob: 'a$b=' }]).error, 'invalid-base64'); assert.equal(decodeResourceContents([{ blob: 'abc' }]).error, 'invalid-base64');
  assert.equal(decodeResourceContents([]).error, 'expected-single-content'); assert.equal(decodeResourceContents([{ text: 'a' }, { text: 'b' }]).error, 'expected-single-content');
  assert.equal(decodeResourceContents([{ uri: 'x' }]).error, 'no-text-or-blob'); assert.equal(decodeResourceContents('x').error, 'expected-single-content');
  assert.equal(decodeResourceContents([{ text: 'x', size: 1, mimeType: 't' }]).mimeType, 't');
  assert.equal(VIEWER_LIMITS.maxResourceBytes, 20 * 1024 * 1024);
});
test('write results: only well-formed saved updates the baseline', () => {
  assert.deepEqual(interpretWriteResult({ state: 'saved', etag: 'e2' }), { ok: true, state: 'saved', etag: 'e2' });
  assert.equal(interpretWriteResult({ state: 'saved' }).ok, false); assert.equal(interpretWriteResult({ state: 'conflict', etag: 'e3' }).state, 'conflict');
  assert.equal(interpretWriteResult({ state: 'too-large' }).state, 'too-large'); assert.equal(interpretWriteResult({}).state, 'invalid-response'); assert.equal(interpretWriteResult(null).state, 'invalid-response');
});
test('notification limiter drops over-limit bursts and recovers after the window', () => {
  let t = 0; const l = createNotificationLimiter({ limit: 3, now: () => t });
  assert.deepEqual([1, 2, 3, 4, 5].map(() => l.accept()), [true, true, true, false, false]); assert.equal(l.dropped, 2);
  t = 1001; assert.equal(l.accept(), true); assert.equal(l.dropped, 2);
});
