import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {writeFileSync} from 'node:fs';
import {waitForSource} from './source-wait.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const empty={status:'unavailable',messages:[],issueCode:'SOURCE_UNAVAILABLE'},matched={status:'matched',messages:[{fixture:'source'}]};
const results=[];
async function scenario(name,body){const run=new AbortController(),deadline=new AbortController();let wake,opened=0,closed=0;const options={signal:run.signal,deadlineSignal:deadline.signal,subscribe:f=>{wake=f;opened++;return()=>closed++;}};await body(options,()=>wake(),run,deadline);assert.equal(opened,closed);assert.equal(getEventListeners(run.signal,'abort').length,0);assert.equal(getEventListeners(deadline.signal,'abort').length,0);results.push({name,status:'passed',subscriptionsClosed:closed});}
await scenario('change-during-read-is-not-lost',async(options,wake)=>{const first=deferred(),entered=deferred();let calls=0;const result=waitForSource({...options,read:async()=>{if(++calls===1){entered.resolve();return first.promise;}return matched;}});await entered.promise;wake();first.resolve(empty);assert.equal(await result,matched);});
await scenario('unsupported-does-not-wait-for-future-change',async options=>{await assert.rejects(waitForSource({...options,read:async()=>({...empty,status:'unsupported'})}),{code:'SOURCE_UNSUPPORTED'});});
await scenario('unrelated-change-storm-hits-read-budget',async(options,wake)=>{await assert.rejects(waitForSource({...options,maxReads:3,read:async()=>{queueMicrotask(wake);return empty;}}),{code:'SOURCE_READ_BUDGET'});});
await scenario('already-canceled-does-not-open-watch-or-read',async(options,wake,run)=>{run.abort();await assert.rejects(waitForSource({...options,read:async()=>assert.fail('read after cancellation')}),{code:'SOURCE_CANCELED'});});
writeFileSync(new URL('./wait-results.json',import.meta.url),JSON.stringify({scope:'Candidate wait helper only; synthetic observations and changes, no native or product acceptance',checks:results},null,2)+'\n');
console.log(JSON.stringify(results));
