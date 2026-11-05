import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {finishedCliText} from './finished-cli-text.mjs';
const ROOT='/private/tmp/willyou-m12-t131-t38-peer-ar-001';
assert.equal(process.env.WILLYOU_TEST_CACHE_DIR,ROOT+'/cache');
const r=JSON.parse(await readFile(ROOT+'/raw.private.json'));
function output(role,index){const rows=r.arms[role].originalPrefixes;assert.equal(rows.length,1);const json=readFile(rows[0].path,'utf8');return json.then(t=>{const a=t.split('\n').filter(Boolean).map(JSON.parse).filter(x=>x.type==='response_item'&&x.payload?.type==='function_call_output'&&x.payload?.call_id===`t38_${role.toLowerCase()}_${index}`);assert.equal(a.length,1);return a[0].payload.output;});}
const before=await output('A',2),after=await output('B',1),tests=[];
function pass(name,f){f();tests.push({name,passed:true});}
const parse=text=>finishedCliText({text,expectedCode:'PEER_MISMATCH',childExitCodeObserved:2});
pass('actual-before-json-terminal',()=>assert.equal(parse(before).carrier.diagnosticPosition,'before-json'));
pass('actual-after-json-terminal',()=>assert.equal(parse(after).carrier.diagnosticPosition,'after-json'));
for(const [name,change] of [
 ['two-json-objects',x=>x+'{}\n'],
 ['extra-text-after',x=>x+'extra\n'],
 ['wrong-footer-code',x=>x.replace(/willyou-app: PEER_MISMATCH\n$/,'willyou-app: AUTH_REQUIRED\n')],
 ['duplicate-footer',x=>x+'willyou-app: PEER_MISMATCH\n'],
 ['both-prefix-and-footer',x=>x.replace('Output:\n','Output:\nwillyou-app: PEER_MISMATCH\n')],
 ['running-not-terminal',x=>x.replace('Process exited with code 2','Process running with session ID 123')],
 ['exit-mismatch',x=>x.replace('Process exited with code 2','Process exited with code 0')],
 ['wrong-json-code',x=>x.replace('"code":"PEER_MISMATCH"','"code":"AUTH_REQUIRED"')],
 ['leading-extra-body',x=>x.replace('Output:\n','Output:\nextra\n')]
])pass(name,()=>assert.throws(()=>parse(change(after))));
await writeFile(ROOT+'/supplemental-review-001/finite-decoder-controls.json',JSON.stringify({at:new Date().toISOString(),passed:tests.length,tests,Native:0,model:0,boundary:'Finite observed terminal stdout/stderr order only; original request/call/source/time binding unchanged; strict one JSON object; no running inference or child exit fabrication.'},null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({passed:tests.length,Native:0}));
