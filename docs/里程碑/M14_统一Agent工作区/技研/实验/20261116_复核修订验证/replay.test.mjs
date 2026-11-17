import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {normalizer,itemTypes,workDuration} from './timeline.mjs';
import {readT3Baseline,coverageGaps,exclusions,renames} from './t3-baseline.mjs';
const t3=readT3Baseline(process.env.M14_T3_ROOT);
writeFileSync(join(import.meta.dirname,'results/t3-baseline.json'),JSON.stringify({...t3,exclusions,renames},null,2)+'\n');
const root=import.meta.dirname, rows=[], coverage={}, allItems=new Set();
const read=name=>JSON.parse(readFileSync(join(root,'fixtures',name),'utf8'));
const lines=name=>gunzipSync(readFileSync(join(root,'fixtures',name))).toString().trim().split('\n').map(JSON.parse);
function test(id,fn){try{fn();rows.push({id,status:'passed'});}catch(e){rows.push({id,status:'failed',error:e.message});}}
for(const recording of read('recordings-manifest.json')) test('real:'+recording.run,()=>{
  const path=join(root,'fixtures',recording.fixture), bytes=readFileSync(path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),recording.fixtureSha256);
  const instances=new Map(), stats={events:0,visibleEvents:0,diagnosticEvents:0,unmapped:[],types:new Set()};
  for(const e of lines(recording.fixture)) {
    if(!instances.has(e.actor))instances.set(e.actor,normalizer(e.actor));
    const out=instances.get(e.actor)(e); stats.events++;
    const key=e.driver+':'+(e.method??e.type??'response')+(e.subtype?':'+e.subtype:'')+(e.params?.item?.type?':'+e.params.item.type:'');
    const classified=out.length>0 && out.every(x=>x.kind!=='unmapped');
    if(!classified)stats.unmapped.push({line:e.recordingLine,key,out});
    if(out.some(x=>x.kind!=='diagnostic'))stats.visibleEvents++;else stats.diagnosticEvents++;
    for(const x of out)if(x.type){stats.types.add(x.type);allItems.add(x.type);}
  }
  coverage[recording.run]={...stats,types:[...stats.types]};
  assert.deepEqual(stats.unmapped,[],'unclassified event types are failures, not blanket diagnostics');
});
test('stream final replaces accumulated text; late delta cannot reopen',()=>{
 const n=normalizer('stream');
 n({driver:'codex',method:'item/agentMessage/delta',params:{itemId:'1',delta:'hel'}});
 n({driver:'codex',method:'item/agentMessage/delta',params:{itemId:'1',delta:'lo'}});
 const final=n({driver:'codex',method:'item/completed',params:{item:{id:'1',type:'agentMessage',text:'hello'}}})[0];
 assert.equal(final.text,'hello');assert.equal(final.revision,3);assert.equal(final.ordinal,1);
 assert.equal(n({driver:'codex',method:'item/agentMessage/delta',params:{itemId:'1',delta:'bad'}})[0].kind,'diagnostic');
});
test('same tool ID in independent runs never shares state',()=>{
 const a=normalizer('A'),b=normalizer('B');
 a({driver:'claude',type:'assistant',uuid:'a',message:{content:[{type:'tool_use',id:'same',name:'Bash',input:{}}]}});
 const item=b({driver:'claude',type:'assistant',uuid:'b',message:{content:[{type:'tool_use',id:'same',name:'Write',input:{}}]}})[0];
 assert.equal(item.type,'file_change');assert.equal(item.id,'B:same');
});
test('all fixed T3 source union members have an explicit inclusion or exclusion',()=>{
 assert.equal(t3.types.length,25);
 assert.deepEqual(coverageGaps(t3.types,itemTypes,exclusions,renames),[]);
 assert.deepEqual(Object.keys(exclusions).filter(t=>!t3.types.includes(t)),[]);
 assert(itemTypes.every(t=>t==='provider_switch'||t3.types.some(native=>(renames[native]??native)===t)));
});
test('negative control detects original five missing T3 policies',()=>{
 const old=itemTypes.filter(t=>!['notification','thread_created'].includes(t));
 assert.deepEqual(coverageGaps(t3.types,old,{},renames).sort(),['fork','secret_request','link_request','notification','thread_created'].sort());
});
test('all included items have an exercised source path',()=>{
 const sources={userMessage:'user_message',agentMessage:'assistant_message',reasoning:'reasoning',plan:'assistant_message',fileChange:'file_change',commandExecution:'command_execution',fileSearch:'file_search',webSearch:'web_search',contextCompaction:'compaction',collabAgentToolCall:'subagent',mcpToolCall:'tool_call'};
 const exercised=new Set();
 for(const [native,type] of Object.entries(sources)){
  const out=normalizer(native)({driver:'codex',method:'item/completed',params:{item:{id:'item',type:native,text:'content'}}});
  assert.equal(out[0].type,type);exercised.add(type);
 }
 for(const [tool,type] of Object.entries({TodoWrite:'todo_list',AskUserQuestion:'user_input_request',ExitPlanMode:'proposed_plan'})){ // 计划卡只来自 Claude ExitPlanMode（复核 AR04）
  const out=normalizer(tool)({driver:'claude',type:'assistant',uuid:'1',message:{content:[{type:'tool_use',id:'call',name:tool,input:{}}]}});
  assert.equal(out[0].type,type);exercised.add(type);
 }
 for(const [method,type] of [['item/commandExecution/requestApproval','approval_request'],['warning','system_notice'],['error','error']]){
  assert.equal(normalizer(method)({driver:'codex',method,id:1,params:{message:'test'}})[0].type,type);exercised.add(type);
 }
 for(const type of ['checkpoint','run_interrupt_request','run_interrupt_result','handoff','provider_switch','notification','thread_created']){
  assert.equal(normalizer(type)({driver:'host',type,id:type,data:{source:'host-contract-fixture'}})[0].type,type);exercised.add(type);
 }
 assert.deepEqual([...exercised].sort(),[...itemTypes].sort());
 assert.equal(normalizer('unknown')({driver:'codex',method:'new_visible_type'})[0].kind,'unmapped');
});
for(const [reason,status] of Object.entries({end_turn:'completed',cancelled:'stopped',max_turn_requests:'failed',refusal:'failed',max_tokens:'limited',unknown_reason:'failed'}))test('ACP stop reason:'+reason,()=>{
 const out=normalizer('acp')({driver:'acp',result:{stopReason:reason}}).at(-1);
 assert.equal(out.status,status);assert.equal(out.reason,reason);
 if(reason==='max_tokens'){assert.equal(out.limitKind,'output_tokens');assert.equal(out.automaticRetry,false);assert.equal(out.resetAt,undefined);}
});
test('Claude native child input and stream remain nested; child result cannot complete parent',()=>{
 const n=normalizer('parent');
 const out=n({driver:'claude',type:'user',uuid:'prompt',parent_tool_use_id:'task-1',message:{content:'child prompt'}})[0];
 assert.equal(out.type,'user_message');assert.equal(out.nodeId,'task-1');assert.equal(out.id,'parent:task-1:prompt');
 const stream=n({driver:'claude',type:'stream_event',uuid:'stream',parent_tool_use_id:'task-1',event:{type:'content_block_delta',index:0,delta:{text:'child'}}})[0];assert.equal(stream.nodeId,'task-1');
 const result=n({driver:'claude',type:'result',uuid:'end',parent_tool_use_id:'task-1',result:'done'});
 assert.equal(result.some(x=>x.kind==='turn'),false);assert.equal(result[0].type,'notification');assert.equal(result[0].nodeId,'task-1');
 const parent=n({driver:'claude',type:'user',uuid:'prompt',message:{content:'top level'}})[0];assert.equal(parent.nodeId,undefined);assert.notEqual(parent.id,out.id);
});
for(const terminal of ['completed','interrupted','failed','process_exit'])test('terminal settles open tools/requests:'+terminal,()=>{
 const n=normalizer('terminal');n({driver:'codex',method:'turn/started',params:{turn:{id:'t'}}});
 n({driver:'codex',method:'item/started',params:{turnId:'t',item:{id:'open',type:'commandExecution'}}});
 n({driver:'codex',method:'item/commandExecution/requestApproval',id:2,params:{turnId:'t'}});
 const out=terminal==='process_exit'?n({driver:'host',type:'process_exit',data:{}}):n({driver:'codex',method:'turn/completed',params:{turn:{id:'t',status:terminal}}});
 assert.equal(out.filter(x=>x.kind==='item'&&x.final).length,2);
 assert.equal(out.at(-1).kind,'turn');
});
test('overlapping work intervals counted once',()=>assert.equal(workDuration([[0,10],[5,20],[30,40]]),30));
test('recorded delegation becomes visible subagent nodes',()=>{
 const host=lines('v01-b-host.jsonl.gz'), calls=host.filter(x=>x.event==='delegate-call');
 assert.equal(calls.length,4);
 for(const [i,call] of calls.entries())assert.equal(normalizer(call.parent)({driver:'host',type:'subagent',id:'delegate:'+i,data:call})[0].data.target,call.target);
});
test('recorded A-B-A transfers keep native IDs and visible handoff',()=>{
 const r=read('v02-a-result.json');assert.equal(r.steps.every(x=>x.ok),true);
 for(const run of [2,3,4]) {
  const h=r.history.filter(x=>x.run===run);
  assert.equal(h.length,2);
  const n=normalizer('switch');
  assert.equal(n({driver:'host',type:'provider_switch',id:'switch:'+run,data:{provider:h[0].provider}})[0].type,'provider_switch');
  assert.equal(n({driver:'host',type:'handoff',id:'handoff:'+run,data:{source:'recorded history',run,history:h}})[0].type,'handoff');
 }
});
test('inherited auto_review is explicitly overridden for approve and deny',()=>{
 const a=read('approval-evidence.json').cases;
 assert.equal(a.accept.requestCount,1);assert.equal(a.accept.fileExists,true);
 assert.equal(a.decline.requestCount,1);assert.equal(a.decline.fileExists,false);
 assert.equal(a.inherit.requestCount,0);
});
test('original Claude maxTurns failure retained as a terminal failure',()=>{
 const r=read('v08-b-result.json');assert.equal(r.steps.some(x=>x.ok===false),true);
 const es=lines('v08-b.jsonl.gz');const n=normalizer('claude-denied');
 assert.equal(es.flatMap(n).some(x=>x.kind==='turn'&&x.status==='failed'),true);
});
for(const run of ['v01-b','v07-R5','v07-R6','v07-R7'])test('original real-model result:'+run,()=>assert.equal(read(run+'-result.json').results.every(x=>x.status==='passed'),true));
mkdirSync(join(root,'results'),{recursive:true});
const result={scope:'offline replay of real model recordings + labeled semantic unit fixtures; no real App',
 tests:rows,coverage,visibleItemTypes:[...allItems],failed:rows.filter(x=>x.status==='failed').length};
writeFileSync(join(root,'results','timeline-replay.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({tests:rows.length,failed:result.failed,failures:rows.filter(x=>x.status==='failed'),coverage:Object.fromEntries(Object.entries(coverage).map(([k,v])=>[k,{events:v.events,unmapped:v.unmapped.length}]))},null,2));
process.exitCode=result.failed?1:0;
