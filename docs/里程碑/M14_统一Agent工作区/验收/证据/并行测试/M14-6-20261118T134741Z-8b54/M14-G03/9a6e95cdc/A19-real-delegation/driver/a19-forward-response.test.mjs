import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { forwardResponse } from './a19-forward-response.mjs';

class FakeResponse extends EventEmitter {
  sent = [];
  writableFinished = false;
  writeHead(status) { this.status = status; }
  write(bytes) { this.sent.push(Buffer.from(bytes).toString()); return true; }
  end() { this.writableFinished = true; this.emit('close'); }
}

const response = body => ({status:200,headers:new Headers(),body});

test('the original model stream and final status are forwarded unchanged',async()=>{
  const res=new FakeResponse(), receipt={};
  const provider=async()=>response((async function*() {yield Buffer.from('red');yield Buffer.from('green');})());
  await forwardResponse(res,provider,receipt);
  assert.equal(res.writableFinished,true);
  assert.deepEqual(res.sent,['red','green']);
  assert.equal(receipt.upstreamCompleted,true);
  assert.equal(receipt.forwardedBytes,8);
  assert.equal(receipt.downstreamAbortAt,undefined);
});

test('actual downstream closure aborts only its own upstream request',async()=>{
  const res=new FakeResponse(), receipt={};
  const provider=async signal=>response((async function*() {
    yield Buffer.from('first');
    res.emit('close');
    signal.throwIfAborted();
  })());
  await forwardResponse(res,provider,receipt);
  assert.deepEqual(res.sent,['first']);
  assert(receipt.downstreamAbortAt);
  assert.equal(receipt.downstreamAbortHandled,true);
  assert.equal(receipt.upstreamCompleted,undefined);
});

test('an independently broken provider stream still fails the driver',async()=>{
  const res=new FakeResponse(), receipt={};
  const provider=async()=>response((async function*() {yield Buffer.from('first');throw new Error('upstream broken');})());
  await assert.rejects(forwardResponse(res,provider,receipt),/upstream broken/);
  assert.equal(receipt.downstreamAbortAt,undefined);
  assert.equal(receipt.upstreamCompleted,undefined);
});
