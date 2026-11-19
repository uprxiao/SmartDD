import assert from 'node:assert/strict';
import test from 'node:test';
import { browserCall, browserToolName, createRequestFlow, nativePrompt, nativeQuestion, nativeType, question, rootPrompt, answers, nativeAnswer } from './request-flow.mjs';

const model={parent:'parent',browser:'browser',one:'one',two:'two'};
const siblings=[{id:'one',title:'first child',model:'one',marker:'OWN_ONE'},{id:'two',title:'second child',model:'two',marker:'OWN_TWO'}];
const tools=[{name:'mcp__wy__wy_targets'},{name:'mcp__wy__wy_delegate',input_schema:{properties:{profileRevision:{type:'string'}}}},
  {name:'mcp__wy__'+browserToolName},{name:'Agent'},{name:'AskUserQuestion'}];
const use=(id,value,root=false,error=false)=>[...(root?[{role:'user',content:rootPrompt}]:[]),
  {role:'user',content:[{type:'tool_result',tool_use_id:id,is_error:error,content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]}]}];
const target={profileId:'profile-1',revision:'a'.repeat(64),available:true};
const flowFixture=()=>createRequestFlow({profiles:{claude:target.profileId},models:model,browserTaskId:'browser-owner',
  origin:'http://127.0.0.1:3425',siblings});
const ownerTick=(flow,messages)=>flow.next({model:model.parent,tools,messages});
async function parentSpawns(flow) {
  const list=await ownerTick(flow,[{role:'user',content:rootPrompt}]);
  const one=await ownerTick(flow,use(list.id,{targets:[target]},true));
  assert.equal(one.args.profileRevision,target.revision);
  const two=await ownerTick(flow,use(one.id,{childTaskId:'one',workspaceMode:'worktree'},true));
  assert.equal(two.args.profileRevision,target.revision);
  assert.notEqual(one.args.requestKey,two.args.requestKey);
  const business=await ownerTick(flow,use(two.id,{childTaskId:'two',workspaceMode:'worktree'},true));
  assert.deepEqual(business.args,{task:'browser-owner',mode:'observe'});
  const native=await ownerTick(flow,use(business.id,{status:'awaiting_user'},true));
  assert.equal(native.args.subagent_type,nativeType);
  return native;
}
test('both identical real host question routes bind replies to their own tool IDs, cancel and answer separately',async()=>{
  const flow=flowFixture();
  const calls=await Promise.all(siblings.map(s=>flow.next({model:s.model,tools,messages:[{role:'user',content:s.marker}]})));
  assert.deepEqual(calls.map(a=>a.args.questions[0].question),[question,question]);
  assert.equal(new Set(calls.map(a=>a.id)).size,2);
  await assert.rejects(()=>flow.next({model:'one',tools,messages:use(calls[1].id,answers[1])}),/exact one native receipt/);
  await flow.next({model:'one',tools,messages:use(calls[0].id,'用户没有回答',false,true)});
  await flow.next({model:'two',tools,messages:use(calls[1].id,answers[1])});
  assert.equal(flow.records.siblings.one.reply.isError,true);
  assert.equal(flow.records.siblings.two.reply.text,answers[1]);
});
test('reports an actually advertised native child question and the exact independent business receipt',async()=>{
  const flow=flowFixture();
  const agent=await parentSpawns(flow);
  const history=[{role:'user',content:rootPrompt},{role:'user',content:[{type:'text',text:nativePrompt}]}];
  const ask=await flow.next({model:'native-alias',tools:[{name:'AskUserQuestion'}],messages:history});
  assert.equal(ask.args.questions[0].question,nativeQuestion);
  assert.equal(flow.records.business.isError,false);
  assert.equal(flow.records.native.notExposed,undefined);
  await flow.next({model:'native-alias',tools:[{name:'AskUserQuestion'}],messages:[...history,...use(ask.id,nativeAnswer)]});
  const pending=ownerTick(flow,[...use(agent.id,'native completed',true),
    {role:'assistant',content:[{type:'tool_use',input:{prompt:nativePrompt}}]}]);
  flow.releaseParent();
  await pending;
  assert.equal(flow.records.native.reply.text,nativeAnswer);
});
test('does not fabricate a child question when the real tool is omitted',async()=>{
  const flow=flowFixture();
  const agent=await parentSpawns(flow);
  const missing=await flow.next({model:'native-alias',tools:[{name:'Read'}],messages:[{role:'user',content:nativePrompt}]});
  assert(!missing.tool);
  assert.equal(flow.records.native.notExposed,true);
  const pending=ownerTick(flow,use(agent.id,'native unavailable',true));
  flow.releaseParent();
  await pending;
  assert.deepEqual(flow.records.native.toolNames,['Read']);
  assert.equal(flow.records.native.agentReturned,true);
});

test('supports the actual CLI-only browser binding using one literal private observe operation',()=>{
  const id='00000000-1111-2222-3333-444444444444';
  const lane=browserCall([{name:'Bash'}],id);
  assert.equal(lane.transport,'cli');
  assert.equal(lane.args.command,'willyou-app browser access request --task '+id+' --mode observe');
  assert.throws(()=>browserCall([{name:'Bash'}],id+' extra'),/only a literal isolated target identifier/);
});
