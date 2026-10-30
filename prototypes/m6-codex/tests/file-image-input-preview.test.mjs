import test from 'node:test';
import assert from 'node:assert/strict';
import { createImagePreviewDelivery } from '../src/file-image-input-preview.mjs';

const image = () => ({ kind: 'synthetic-image', sourceId: 'owned-catalog/root/image1', mime: 'image/png', src: '/assets/app-icon.png', name: '图片' });
const request = (extra = {}) => ({ taskId: 'task1', requestId: crypto.randomUUID(), capability: 'supported', image: image(), ...extra });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function fixture(transport) {
  const attachments = [{ sourceId: 'old-image' }], states = [], timers = new Set(); let running = true, input = 'old-prefix';
  const clock = { setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); } };
  const receiver = createImagePreviewDelivery({ available: () => running, accept: payload => { attachments.push(payload); input += '[Image 2]'; }, transport, clock });
  return { receiver, attachments, states, req: extra => request({ onState: s => states.push(s), ...extra }), input: () => input,
    stop: () => { running = false; receiver.invalidate(); }, expire: () => { for (const fn of [...timers]) fn(); }, timers };
}
for (const capability of ['unknown', 'unsupported']) test(capability + ' never calls an image transport or changes existing input', async () => {
  let calls = 0; const f = fixture(() => { calls++; });
  const result = await f.receiver.insert(f.req({ capability }));
  assert.equal(result.state, 'failed'); assert.match(result.message, capability === 'unknown' ? /未知/ : /不支持/);
  assert.equal(calls, 0); assert.equal(f.attachments.length, 1); assert.equal(f.input(), 'old-prefix'); f.receiver.dispose();
});
test('retains actual synthetic payload identity separately from the visible token, idempotently and without submission', async () => {
  const f = fixture(), r = f.req(), first = f.receiver.insert(r), duplicate = f.receiver.insert(r);
  assert.equal(first, duplicate); assert.equal((await first).state, 'inserted');
  assert.deepEqual(f.attachments[1], r.image); assert.ok(Object.isFrozen(f.attachments[1]));
  r.image.src = '/assets/other.png'; assert.equal(f.attachments[1].src, '/assets/app-icon.png');
  assert.equal(f.input(), 'old-prefix[Image 2]'); assert.doesNotMatch(f.input(), /[\r\n]/); assert.equal(f.attachments[0].sourceId, 'old-image');
  assert.equal(f.timers.size, 0); f.receiver.dispose();
});
test('an adapter rejection clears only this pending request', async () => {
  const f = fixture(() => ({ state: 'failed', message: 'fixture refusal' }));
  assert.equal((await f.receiver.insert(f.req())).state, 'failed'); assert.equal(f.attachments.length, 1); assert.equal(f.input(), 'old-prefix');
  assert.equal(f.timers.size, 0); f.receiver.dispose();
});
for (const boundary of ['source', 'task']) test(boundary + ' invalidation rejects a delayed acceptance and preserves old input/images', async () => {
  let release, delivery; const gate = new Promise(resolve => { release = resolve; });
  const f = fixture(async r => { delivery = r; await gate; return { state: r.accept() ? 'inserted' : 'failed' }; });
  const owner = new AbortController(), result = f.receiver.insert(f.req({ signal: owner.signal })); await flush();
  if (boundary === 'source') owner.abort(); else f.stop();
  assert.equal((await result).state, 'failed'); release(); await flush(); assert.equal(delivery.accept(), false);
  assert.equal(f.attachments.length, 1); assert.equal(f.input(), 'old-prefix'); assert.equal(f.timers.size, 0); f.receiver.dispose();
});
test('uncertain post-acceptance failure retains the image and never repeats the write', async () => {
  let writes = 0; const f = fixture(r => { assert.equal(r.accept(), true); writes++; throw Error('reply lost'); }), r = f.req();
  const first = await f.receiver.insert(r); assert.equal(first.state, 'unknown'); assert.equal(await f.receiver.insert(r), first);
  assert.equal(writes, 1); assert.equal(f.attachments.length, 2); assert.equal(f.input(), 'old-prefix[Image 2]');
  assert.equal((await f.receiver.insert(f.req())).state, 'failed'); assert.equal(writes, 1); f.receiver.dispose();
});
test('receipt timeout prevents late acceptance after the original 1500ms boundary', async () => {
  let release, delivery; const gate = new Promise(resolve => { release = resolve; });
  const f = fixture(async r => { delivery = r; await gate; return { state: r.accept() ? 'inserted' : 'failed' }; });
  const owner = new AbortController(), result = f.receiver.insert(f.req({ signal: owner.signal })); await flush(); f.expire();
  assert.equal((await result).state, 'unknown'); release(); await flush(); assert.equal(delivery.accept(), false);
  assert.equal(f.attachments.length, 1); owner.abort(); assert.equal(f.timers.size, 0); f.receiver.dispose();
});
test('a bare path cannot be accepted as an image payload', async () => {
  const f = fixture(); assert.equal((await f.receiver.insert(f.req({ image: { path: '/workspace/picture.png' } }))).state, 'failed');
  assert.equal(f.attachments.length, 1); assert.equal(f.input(), 'old-prefix'); f.receiver.dispose();
});
