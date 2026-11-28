// Offline replay. All historical bytes come from the persisted synthetic B11
// evidence. A combined pending/terminal chain is explicitly a synthetic control.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {
  createNativeReceipt,parseNativeEnvelope,passivePollInput,acceptNativeEnvelope,
  exactNativeOutput,readSnapshotReceipt,
} from './native-passive-poll.mjs';

const base=dirname(fileURLToPath(import.meta.url));
const history='/Users/liubu/hx/4.uprxiao/SmartDD/docs/里程碑/M16_定时任务/验收/证据/开发与候选-20261125';
const c27Path=join(history,'candidate-27-schedule-active-query-reuse/B11-real-1800s-recheck/archive-safe/result.json.gz');
const c22Path=join(history,'candidate-22-notification-ownership-and-cold-paint/B11-native-pending-reply-driver-red/result.json');
const c27Raw=readFileSync(c27Path),c22Raw=readFileSync(c22Path);
const c27=JSON.parse(gunzipSync(c27Raw)),c22=JSON.parse(c22Raw);
const sha=value=>createHash('sha256').update(value).digest('hex');
const tested=[];
function check(name,fn){fn();tested.push(name)}
function rejects(name,fn){check(name,()=>assert.throws(fn))}

check('all 40 original C27 direct terminal receipts',()=>{
 assert.equal(c27.readReceipts.length,40);
 for(const original of c27.readReceipts){
  const terminal=original.nativeTerminal;
  assert.equal(terminal.firstPending,false);
  assert.equal(terminal.poll,0);
  assert.equal(terminal.actualHistory.length,1);
  const next=acceptNativeEnvelope(createNativeReceipt(),terminal.actualHistory[0]);
  assert.equal(next.kind,'terminal');
  assert.deepEqual(next.nativeTerminal,terminal);
  const result=readSnapshotReceipt(next.output,{id:original.data.browserPageId,url:original.data.url});
  for(const key of ['status','source','data','operation'])assert.deepEqual(result[key],original[key]);
 }
});
const pendingRaw=JSON.parse(c22.model.find(x=>x.actualToolReceipt).actualToolReceipt);
const pending=parseNativeEnvelope(pendingRaw);
const terminalRaw=c27.readReceipts[0].nativeTerminal.actualHistory[0];
const terminal=parseNativeEnvelope(terminalRaw);
const page={id:c27.readReceipts[0].data.browserPageId,url:c27.readReceipts[0].data.url};
const oldPendingPage=c22.model.find(x=>x.name==='exec_command').input.cmd.split(' ').at(-1);
const currentPublicContract={type:'function',name:'write_stdin',parameters:{type:'object',properties:{
 session_id:{type:'number'},chars:{type:'string'},yield_time_ms:{type:'number'},max_output_tokens:{type:'number'},
},required:['session_id','chars'],additionalProperties:false}};

check('retained C22 actual running reply is pending, never a terminal receipt',()=>{
 assert.equal(pending.kind,'running');
 assert.equal(pending.session,66729);
 assert.equal(pending.payload,'');
 const s=createNativeReceipt();
 assert.deepEqual(acceptNativeEnvelope(s,pendingRaw),{kind:'pending',session:66729,poll:1});
 assert.equal(s.terminal,false);
 assert.deepEqual(passivePollInput(currentPublicContract,pending.session),{session_id:66729,chars:'',yield_time_ms:5000,max_output_tokens:3000});
});
check('synthetic control combining retained C22 running frame with C27 terminal frame',()=>{
 const s=createNativeReceipt();
 acceptNativeEnvelope(s,pendingRaw);
 const next=acceptNativeEnvelope(s,terminalRaw);
 assert.equal(next.kind,'terminal');
 assert.deepEqual(next.nativeTerminal,{code:0,poll:1,session:66729,firstPending:true,actualHistory:[pendingRaw,terminalRaw]});
 assert.deepEqual(readSnapshotReceipt(next.output,page).data,c27.readReceipts[0].data);
});
check('synthetic control for two successive same-session polls',()=>{
 const s=createNativeReceipt();
 acceptNativeEnvelope(s,pendingRaw);
 assert.deepEqual(acceptNativeEnvelope(s,pendingRaw),{kind:'pending',session:66729,poll:2});
 assert.equal(acceptNativeEnvelope(s,terminalRaw).nativeTerminal.poll,2);
});
check('synthetic split bytes reconstructed before result validation',()=>{
 const s=createNativeReceipt();
 const split=terminal.payload.indexOf('"source"');
 const first=pendingRaw+terminal.payload.slice(0,split);
 const last=terminalRaw.slice(0,terminalRaw.length-terminal.payload.length)+terminal.payload.slice(split);
 assert.equal(acceptNativeEnvelope(s,first).kind,'pending');
 const next=acceptNativeEnvelope(s,last);
 assert.equal(next.output,terminal.payload);
 assert.deepEqual(readSnapshotReceipt(next.output,page).data,c27.readReceipts[0].data);
});
check('exact current call output selected with earlier call outputs retained in history',()=>{
 assert.equal(exactNativeOutput([{type:'function_call_output',call_id:'earlier',output:pendingRaw},{type:'function_call_output',call_id:'current',output:terminalRaw}],'current'),terminalRaw);
});
rejects('old actual C22 empty output cannot count as CLI success',()=>readSnapshotReceipt(pending.payload,page));
rejects('actual C27 terminal from another page cannot satisfy C22 command',()=>readSnapshotReceipt(terminal.payload,{id:oldPendingPage,url:page.url}));
rejects('native exit nonzero even with otherwise valid original JSON',()=>acceptNativeEnvelope(createNativeReceipt(),terminalRaw.replace('Process exited with code 0','Process exited with code 1')));
rejects('unrecognized terminal header',()=>parseNativeEnvelope(terminalRaw.replace('Process exited with code 0','Process terminated by signal 1')));
rejects('session ID must be positive',()=>parseNativeEnvelope(pendingRaw.replace('66729','0')));
rejects('invalid session ID cannot be polled',()=>passivePollInput(currentPublicContract,0));
rejects('native session changed while polling',()=>{const s=createNativeReceipt();acceptNativeEnvelope(s,pendingRaw);acceptNativeEnvelope(s,pendingRaw.replace('66729','66730'))});
rejects('native pending timeout/poll count is bounded',()=>{const s=createNativeReceipt();for(let i=0;i<7;i++)acceptNativeEnvelope(s,pendingRaw)});
rejects('duplicate terminal response rejected',()=>{const s=createNativeReceipt();acceptNativeEnvelope(s,terminalRaw);acceptNativeEnvelope(s,terminalRaw)});
rejects('stale call output must never be accepted',()=>exactNativeOutput([{type:'function_call_output',call_id:'old',output:terminalRaw}],'current'));
rejects('duplicated exact output is ambiguous',()=>exactNativeOutput([{type:'function_call_output',call_id:'current',output:terminalRaw},{type:'function_call_output',call_id:'current',output:terminalRaw}],'current'));
rejects('missing write_stdin native tool must not fall back to exec',()=>passivePollInput({name:'exec_command',type:'function',parameters:currentPublicContract.parameters},pending.session));
rejects('unknown required native poll field',()=>passivePollInput({...currentPublicContract,parameters:{...currentPublicContract.parameters,required:['session_id','chars','unknown']}},pending.session));
rejects('non-string chars rejected',()=>passivePollInput({...currentPublicContract,parameters:{...currentPublicContract.parameters,properties:{...currentPublicContract.parameters.properties,chars:{type:'number'}}}},pending.session));
rejects('wrong page URL',()=>readSnapshotReceipt(terminal.payload,{id:page.id,url:'http://127.0.0.1:3425/not-this-page'}));
rejects('ambiguous duplicate CLI result',()=>readSnapshotReceipt(terminal.payload+'\n'+terminal.payload,page));
rejects('wrong operation origin',()=>readSnapshotReceipt(terminal.payload.replace('"origin":"cli"','"origin":"mcp"'),page));
rejects('wrong operation effect',()=>readSnapshotReceipt(terminal.payload.replace('"effectState":"read-only"','"effectState":"applied"'),page));
check('valid JSON already printed while running does not certify the command',()=>{
 const s=createNativeReceipt();
 const next=acceptNativeEnvelope(s,pendingRaw+terminal.payload);
 assert.equal(next.kind,'pending');
 assert.equal(s.terminal,false);
});

const out={staticOnly:true,originalC27:{source:c27Path,sha256:sha(c27Raw),directTerminalReceipts:40,firstPendingTrue:0,realCompletedPollChains:0},originalC22:{source:c22Path,sha256:sha(c22Raw),retainedActualRunningSession:pending.session,priorDriverFailed:true,actualSuccessfulPollResultAvailable:false},boundary:'C22 retained actual running frame and C27 retained actual terminal frames are verified independently. Synthetic concatenation and malformed controls do not claim a prior or current actual completed pending chain. Current runtime write_stdin schema is validated before issuing only the empty-input poll.',tests:tested,passed:tested.length,failed:0};
writeFileSync(join(base,'native-passive-poll-replay.json'),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({passed:out.passed,failed:0,actualC27TerminalReceipts:40,actualC22RetainedPending:1,actualCompletedPollChainsInArchives:0}));
