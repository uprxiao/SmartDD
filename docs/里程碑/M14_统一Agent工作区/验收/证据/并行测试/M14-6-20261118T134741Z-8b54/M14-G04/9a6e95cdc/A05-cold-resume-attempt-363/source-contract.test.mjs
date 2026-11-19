import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { evidencePath, expectedAnswer, known, model, modelRequest, nativeId, newPrompt, resumeFlag, sha, verifySse } from './contract.mjs';
import { verifySource } from './source-proof.mjs';
import { isM14PreEntryRun } from '../helpers/scripts/lib/electron-isolation-paths.mjs';
import { executable, home, userData } from './contract.mjs';

const prompt=newPrompt('a0'.repeat(16));
const encode=value=>Buffer.from(JSON.stringify(value));
const frames=(events)=>Buffer.from(events.map(event=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n').join(''));
const messages=[
  {role:'user',content:[{type:'text',text:'First persisted input'}]},
  {role:'assistant',content:[{type:'text',text:known[0]}]},
  {role:'user',content:[{type:'text',text:'Second persisted input'}]},
  {role:'assistant',content:[{type:'text',text:known[1]}]},
  {role:'user',content:[{type:'text',text:prompt.text}]},
];
const body={model,stream:true,messages};
test('uses the exact saved source, data after 361, three terminal generations, and recorded main Claude history',()=>{
  const proof=verifySource();
  assert.equal(proof.state.turns.length,6);
  assert.equal(proof.state.runs.length,3);
  assert.equal(proof.originalProcesses.length,6);
  assert.equal(proof.state.node.length,2);
  const transcript=readFileSync(proof.transcript,'utf8');
  // Use message bodies produced by the real CLI in 357, excluding queue/history bookkeeping records.
  const records=transcript.trimEnd().split('\n').map(line=>JSON.parse(line)).filter(row=>
    row.sessionId===nativeId&&['user','assistant'].includes(row.type)&&row.message?.role===row.type);
  const history=records.map(row=>row.message);
  // The real CLI request also carries its text-only system context (api-request-blob role system), which 361 wrongly refused.
  const system=transcript.trimEnd().split('\n').map(line=>JSON.parse(line)).find(row=>row.type==='api-request-blob'&&row.message?.role==='system').message;
  assert(system);
  const raw=encode({...body,messages:[history[0],system,...history.slice(1),messages.at(-1)]});
  const actual=modelRequest(raw,prompt);
  assert.equal(actual.sha256,sha(raw));
  assert.deepEqual(actual.historyFacts.map(item=>item.sourceRole),['assistant','assistant']);
  assert.deepEqual([actual.pastToolCalls,actual.pastToolReceipts],[1,1]);
});
test('history guard refuses only quoting source tokens in a request, stale marker, mislabeled model, duplicate marker and transport omissions',()=>{
  const raw=encode(body);
  assert.equal(modelRequest(raw,prompt).marker,prompt.marker);
  assert.equal(modelRequest(raw,prompt).sha256,sha(raw));
  assert.throws(()=>modelRequest(encode({...body,model:'other'}),prompt));
  assert.throws(()=>modelRequest(encode({...body,messages:messages.slice(0,-1)}),prompt),/Latest actual native/);
  assert.throws(()=>modelRequest(encode({...body,messages:[...messages,messages.at(-1)]}),prompt),/Unique fixture/);
  assert.throws(()=>modelRequest(encode({...body,messages:messages.map(row=>({...row,role:'user'}))}),prompt),/persisted native history/);
  assert.throws(()=>modelRequest(encode({...body,messages:[{role:'user',content:'[WillYou 历史交接 ...]'},...messages]}),prompt),/without a WillYou handoff/);
  assert.throws(()=>modelRequest(encode({...body,messages:[{role:'assistant',content:[{type:'tool_use',id:'unexpected',name:'Bash'}]},...messages]}),prompt),/Unexpected historical tool request/);
});
const start={type:'message_start'};
const end={type:'message_stop'};
const delta={type:'message_delta',delta:{stop_reason:'end_turn'}};
const dataText={type:'content_block_start',index:0,content_block:{type:'text',text:''}};
const payload={type:'content_block_delta',index:0,delta:{type:'text_delta',text:expectedAnswer}};
test('real Anthropic stream includes both known historical answers and rejects all new tools, truncation and wrong text',()=>{
  const positive=frames([start,dataText,payload,delta,end]);
  assert.equal(verifySse(positive).text,expectedAnswer);
  assert.equal(verifySse(positive).sha256,sha(positive));
  assert.throws(()=>verifySse(frames([start,dataText,payload,delta])));
  assert.throws(()=>verifySse(frames([start,dataText,{...payload,delta:{type:'text_delta',text:'HISTORY_UNAVAILABLE'}},delta,end])),/did not recall/);
  assert.throws(()=>verifySse(frames([start,{type:'content_block_start',index:0,content_block:{type:'tool_use',name:'Bash'}},delta,end])),/offered a tool/);
});
test('only canonical 357 paths can be reused and neither 357 nor 358 can be a new result directory',()=>{
  assert.equal(isM14PreEntryRun(executable,userData,home),true);
  assert.equal(isM14PreEntryRun(executable,userData,home.replace('357','358')),false);
  assert.equal(isM14PreEntryRun('/Applications/WillYou.app/Contents/MacOS/WillYou',userData,home),false);
  assert.throws(()=>evidencePath('attempt-357'));
  assert.throws(()=>evidencePath('attempt-358'));
  assert.throws(()=>evidencePath('../attempt-359'));
  assert.match(evidencePath('attempt-359'),/\/g04\/attempt-359$/);
  assert.deepEqual(resumeFlag('/isolated/fixture --resume '+nativeId+' --output-format stream-json'),
    {sessionId:nativeId,generatedSessionOption:false});
  assert.deepEqual(resumeFlag('/isolated/fixture --session-id '+nativeId),{sessionId:null,generatedSessionOption:true});
});


test('system context must stay text only',()=>{
  const ok=[messages[0],{role:'system',content:[{type:'text',text:'# Environment'}]},...messages.slice(1)];
  assert.equal(modelRequest(encode({...body,messages:ok}),prompt).marker,prompt.marker);
  const bad=[messages[0],{role:'system',content:[{type:'tool_use',name:'Bash',id:'x',input:{}}]},...messages.slice(1)];
  assert.throws(()=>modelRequest(encode({...body,messages:bad}),prompt),/System context must be text only/);
});
