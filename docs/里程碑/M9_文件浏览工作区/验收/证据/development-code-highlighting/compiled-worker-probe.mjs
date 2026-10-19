import { Worker } from 'node:worker_threads';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const assets='/private/tmp/willyou-dev038-prototype-final-build/assets';
const file=readdirSync(assets).find(f=>/^worker-.*\.js$/.test(f)&&readFileSync(join(assets,f),'utf8').includes('代码高亮超过'));
assert(file);const compiled=readFileSync(join(assets,file),'utf8');
const header=`const {parentPort}=require('node:worker_threads');globalThis.self={addEventListener:(_,callback)=>parentPort.on('message',data=>callback({data})),postMessage:(data,options)=>parentPort.postMessage(data,options?.transfer)};`;
const worker=new Worker(header+compiled,{eval:true});
const messages=[],waiters=[];worker.on('message',data=>{messages.push(data);for(const f of [...waiters])f(data);});
const wait=(predicate,timeout=15000)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiters.splice(waiters.indexOf(listener),1);reject(new Error('Worker timeout'));},timeout);const listener=data=>{if(!predicate(data))return;clearTimeout(timer);waiters.splice(waiters.indexOf(listener),1);resolve(data);};waiters.push(listener);});
const started=performance.now(),source='import x from "<script>🙂</script>";\nconst count = 42; // exact source';
try{
 let next=wait(d=>d.type==='ready');worker.postMessage({type:'parse',revision:7,source,filename:'sample.ts'});assert.equal((await next).revision,7);
 const tokenizedMs=performance.now()-started;
 next=wait(d=>d.type==='window');worker.postMessage({type:'window',revision:7,request:1,from:0,to:source.length});const result=await next;assert(result.tokens instanceof Uint32Array);assert.equal(result.tokens.length%6,0);assert.equal(result.request,1);
 const pieces=[];for(let i=0;i<result.tokens.length;i+=6){const t=result.tokens;assert(t[i]<t[i+1]&&t[i+1]<=source.length);pieces.push({text:source.slice(t[i],t[i+1]),light:t[i+2],dark:t[i+3]});}
 assert(pieces.some(p=>p.text==='import'&&p.light===0xd53538&&p.dark===0xf67576));
 worker.postMessage({type:'window',revision:6,request:99,from:0,to:source.length});await new Promise(r=>setTimeout(r,60));assert(!messages.some(m=>m.request===99));
 next=wait(d=>d.type==='error');worker.postMessage({type:'parse',revision:8,source:'x'.repeat(20*1024*1024+1),filename:'sample.ts'});assert.match((await next).message,/20 MiB/);
 const terminated=await worker.terminate();
 const evidence={at:new Date().toISOString(),layer:'Compiled production Worker running in a real Node worker_thread with a Web Worker message API adapter; not browser/App E2E.',artifact:join(assets,file),sha256:createHash('sha256').update(compiled).digest('hex'),bytes:Buffer.byteLength(compiled),tokenizedMs,sourceSha256:createHash('sha256').update(source).digest('hex'),tokens:pieces,checks:{dualThemeTokens:true,typedTransfer:true,staleRevisionIgnored:true,oversizedInputRejected:true,workerTerminated:true},terminationCode:terminated};
 writeFileSync('/private/tmp/willyou-dev038-research/compiled-worker-probe.json',JSON.stringify(evidence,null,2)+'\n');console.log({tokenizedMs,tokens:pieces.length,checks:evidence.checks});
}finally{await worker.terminate();}
