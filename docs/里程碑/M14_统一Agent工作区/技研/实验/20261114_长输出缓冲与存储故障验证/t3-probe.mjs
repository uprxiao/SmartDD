import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as Effect from 'effect/Effect';
import * as Stream from 'effect/Stream';
import * as Queue from 'effect/Queue';
import * as Deferred from 'effect/Deferred';
import * as PubSub from 'effect/PubSub';
import {makeLiveStreamBudget,bufferLatestLiveStream,replayAndBufferProjectedLiveEvents} from './t3-budget.mjs';
const results=[];
const save=()=>writeFileSync(new URL('./t3-result.json',import.meta.url),JSON.stringify({scope:'Actual unchanged T3 LiveStreamBudget, pinned effect 4.1.3; synthetic in-memory events, no RPC server or UI.',results},null,2));
async function test(id,fn){console.log('start '+id);try{await Effect.runPromise(Effect.scoped(Effect.gen(fn)));results.push({id,passed:true});}catch(e){results.push({id,passed:false,error:String(e)});throw e;}finally{save();}}
await test('B01-utf8-byte-boundary-and-idempotent-release',function*(){
 const v={text:'中文🙂'};const size=Buffer.byteLength(JSON.stringify(v));assert(size>JSON.stringify(v).length);
 const b=yield* makeLiveStreamBudget({maxSerializedBytes:size,maxItems:2});const item=yield* b.retain(v);assert.equal((yield* b.usage).retainedSerializedBytes,size);b.release([item,item]);assert.deepEqual(yield* b.usage,{retainedItems:0,retainedSerializedBytes:0});
 const b2=yield* makeLiveStreamBudget({maxSerializedBytes:size-1});const r=yield* b2.retain(v).pipe(Effect.result);assert.equal(r._tag,'Failure');assert.equal(r.failure._tag,'LiveStreamBufferError');
});
await test('B02-dequeued-is-still-charged-until-next-pull-ACK',function*(){
 const b=yield* makeLiveStreamBudget({maxItems:3});const q=yield* Queue.unbounded();const closed=yield* Deferred.make();
 const retained=[];for(const text of ['one','two','three'])retained.push(yield* b.retain({text}));yield* Queue.offerAll(q,retained);
 yield* Effect.scoped(Effect.gen(function*(){const pull=yield* Stream.toPull(b.deliver(Stream.fromQueue(q).pipe(Stream.rechunk(1),Stream.ensuring(Deferred.succeed(closed,undefined)))));assert.deepEqual(yield* pull,[{text:'one'}]);assert.equal((yield* b.usage).retainedItems,3);const r=yield* b.retain({text:'four'}).pipe(Effect.result);assert.equal(r._tag,'Failure');yield* Deferred.await(closed);yield* b.closed;assert.equal((yield* b.usage).retainedItems,1);}));
 assert.deepEqual(yield* b.usage,{retainedItems:0,retainedSerializedBytes:0});
});
for(const limit of ['items','bytes'])await test('B03-'+limit+'-overflow-resume-no-loss',function*(){
 const pub=yield* PubSub.unbounded();const subscribed=yield* Deferred.make();const events=[{sequence:1,text:'one'},{sequence:2,text:'two'},{sequence:3,text:'three'}];
 const pull=yield* Stream.toPull(replayAndBufferProjectedLiveEvents({project:x=>x,subscribe:PubSub.subscribe(pub).pipe(Effect.tap(s=>Deferred.succeed(subscribed,s))),latestSequence:Effect.succeed(1),replay:()=>Stream.succeed(events[0])},limit==='items'?{maxItems:1}:{maxSerializedBytes:40}));
 const received=[...(yield* pull)];yield* PubSub.publishAll(pub,events.slice(1));yield* (yield* Deferred.await(subscribed)).shutdownHook.await;
 const r=yield* pull.pipe(Effect.result);assert.equal(r._tag,'Failure');assert.equal(r.failure._tag,'LiveStreamBufferError');
 const resumed=yield* replayAndBufferProjectedLiveEvents({project:x=>x,subscribe:PubSub.subscribe(pub),afterSequence:1,latestSequence:Effect.succeed(3),replay:through=>Stream.fromIterable(events.filter(x=>x.sequence>1&&x.sequence<=through))},{maxItems:1}).pipe(Stream.take(2),Stream.runCollect);
 assert.deepEqual([...received,...resumed],events);assert.equal(yield* PubSub.size(pub),0);
});
await test('B04-fast-reader-total-output-exceeds-budget',function*(){
 const pub=yield* PubSub.unbounded();const events=Array.from({length:100},(_,i)=>({sequence:i+1,text:'中文🙂'.repeat(20)}));
 const replayed=yield* replayAndBufferProjectedLiveEvents({project:x=>x,subscribe:PubSub.subscribe(pub),latestSequence:Effect.succeed(100),replay:()=>Stream.fromIterable(events)},{maxItems:2,maxSerializedBytes:1024}).pipe(Stream.take(100),Stream.runCollect);
 assert.deepEqual(replayed,events);assert(Buffer.byteLength(JSON.stringify(events))>20*1024);assert.equal(yield* PubSub.size(pub),0);
});
await test('B05-coalesce-full-states-not-deltas-negative-control',function*(){
 for(const delta of [false,true]){
 const closed=yield* Deferred.make();const values=[{sequence:1,text:delta?'a':'a'},{sequence:2,text:delta?'b':'ab'},{sequence:3,text:delta?'c':'abc'}];
 const pull=yield* Stream.toPull(bufferLatestLiveStream(Stream.fromIterable(values).pipe(Stream.ensuring(Deferred.succeed(closed,undefined))),()=> 'same-item',{maxItems:1}));
 const batch=yield* pull;yield* Deferred.await(closed);assert.deepEqual(batch,[values[2]]);assert.equal(batch[0].text,delta?'c':'abc');
 }
});
await test('B06-inflight-and-pending-same-key-both-count',function*(){
 const gate=yield* Deferred.make();const closed=yield* Deferred.make();
 const pull=yield* Stream.toPull(bufferLatestLiveStream(Stream.concat(Stream.succeed({sequence:1,text:'a'}),Stream.fromEffect(Deferred.await(gate)).pipe(Stream.map(()=>({sequence:2,text:'ab'})))).pipe(Stream.ensuring(Deferred.succeed(closed,undefined))),()=> 'item',{maxItems:1}));
 assert.deepEqual(yield* pull,[{sequence:1,text:'a'}]);yield* Deferred.succeed(gate,undefined);yield* Deferred.await(closed);const r=yield* pull.pipe(Effect.result);assert.equal(r._tag,'Failure');assert.equal(r.failure._tag,'LiveStreamBufferError');
});
console.log(JSON.stringify({passed:results.length}));
