import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { capability, marker, manifest } from './build.mjs';

const dir=fileURLToPath(new URL('.',import.meta.url));
const runtime=fileURLToPath(new URL('./runtime.mjs',import.meta.url));
const wait=async(predicate)=>{
  const deadline=Date.now()+2000;
  while(Date.now()<deadline){if(predicate())return; await pause(15);}
  throw Error('Fixture did not reach expected stage');
};
async function run(t,{outside=false}={}){
 const base=mkdtempSync(join(dir,'raw-'));
 const root=join(base,outside?'wrong-dir':'plugin-data',manifest.id);
 mkdirSync(root,{recursive:true});
 const child=spawn(process.execPath,[runtime],{env:{WILLYOU_PLUGIN_DATA:root},stdio:['pipe','pipe','pipe']});
 const exit=once(child,'exit');
 let raw='';
 child.stdout.setEncoding('utf8').on('data',chunk=>raw+=chunk);
 const send=(method,id,params={})=>child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
 const frames=()=>raw.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 t.after(async()=>{child.stdin.end();await exit;rmSync(base,{recursive:true});});
 send('initialize',1);
 await wait(()=>frames().length===1);
 assert.deepEqual(frames()[0].result,{protocol:'jsonrpc-stdio/1',plugin:manifest.id,version:manifest.version});
 return {child,root,send,frames,check:path=>existsSync(join(root,path))};
}
function input(){return{capability,input:{marker},connection:{},scope:{callerKind:'agent',operationId:randomUUID(),runId:randomUUID(),projectId:'private-project'}};}
test('durable effect is visible while the original actor remains alive and sends no result',async t=>{
 const p=await run(t), value=input();
 p.send('execute',2,value);
 await wait(()=>p.check('effect-flushed.json'));
 await pause(120);
 const effect=JSON.parse(readFileSync(join(p.root,'effect.json'),'utf8'));
 assert.deepEqual(effect,{marker,operationId:value.scope.operationId,runId:value.scope.runId,projectId:'private-project',pid:p.child.pid});
 assert.deepEqual(JSON.parse(readFileSync(join(p.root,'effect-flushed.json'),'utf8')),{operationId:value.scope.operationId,runId:value.scope.runId});
 assert.equal(p.child.exitCode,null);
 assert.deepEqual(p.frames().map(frame=>frame.id),[1]);
 p.send('execute',3,value);
 await wait(()=>p.frames().some(frame=>frame.id===3));
 assert(p.frames().find(frame=>frame.id===3)?.error);
 assert.equal(readFileSync(join(p.root,'attempts.jsonl'),'utf8').trim().split('\n').length,2);
 assert.deepEqual(JSON.parse(readFileSync(join(p.root,'effect.json'),'utf8')),effect);
});
test('bad origin, credentials or marker never write an effect',async t=>{
 const p=await run(t);
 const mutations=[{...input(),input:{marker:'other'}},{...input(),connection:{external:true}},{...input(),scope:{callerKind:'ui'}}];
 mutations.forEach((v,i)=>p.send('execute',2+i,v));
 await wait(()=>p.frames().length===4);
 assert(p.frames().slice(1).every(frame=>frame.error));
 assert.equal(p.check('effect.json'),false);
 assert.equal(p.check('attempts.jsonl'),false);
});
test('prevents writing to a path outside the current private plugin data root',async t=>{
 const p=await run(t,{outside:true});
 p.send('execute',2,input());
 await wait(()=>p.frames().length===2);
 assert(p.frames()[1].error);
 assert.equal(p.check('effect.json'),false);
});
