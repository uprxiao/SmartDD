import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { toolReceipt } from '../a20-packaged/native-delegation-flow.mjs';

export const rootPrompt='A26_COMPOSED_OWNER_START';
export const browserPrompt='A26_PRIVATE_BROWSER_START';
export const nativeType='a26-private-question';
export const nativePrompt='A26_COMPOSED_NATIVE_NODE_ONLY';
export const nativeDone='A26_COMPOSED_NATIVE_NODE_FINISHED';
const noNativeTool='A26_COMPOSED_NATIVE_ASK_NOT_EXPOSED';
export const rootDone='A26_COMPOSED_OWNER_FINISHED';
export const browserDone='A26_PRIVATE_BROWSER_READY';
export const question='A26 同文问题，请选私有标记';
export const nativeQuestion='A26 原生节点自己的选择';
export const answers=['A26_OPTION_ONE','A26_OPTION_TWO'];
export const nativeAnswer='A26_NATIVE_YES';
export const browserLabel='A26 私有浏览器页面';
export const browserToolName='browser_access_request';
const fixtureTaskId=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export function browserCall(tools,browserTaskId){
  const direct=findTool(tools,browserToolName);
  assert(direct.length<=1,'browser access tool must be unique');
  if(direct.length)return {transport:'mcp',tool:direct[0],args:{task:browserTaskId,mode:'observe'}};
  // Browser 0.1.2 declares only the CLI binding at this capability, including in candidate 051.
  assert.match(browserTaskId,fixtureTaskId,'only a literal isolated target identifier is permitted');
  const command='willyou-app browser access request --task '+browserTaskId+' --mode observe';
  return {transport:'cli',tool:named(tools,'Bash'),args:{command,description:'Request observation of the isolated A26 browser page'}};
}

const findTool=(tools,name)=>tools.filter(t=>t.name===name||t.name?.endsWith('__'+name));
function named(tools,name) {
  const exact=findTool(tools,name);
  assert.equal(exact.length,1,'expected actual native tool '+name);
  return exact[0];
}
function issue(tool,args) { return {tool,args,id:'toolu_'+randomUUID()}; }
function ask(tools,kind){
  const same=kind==='native'?{question:nativeQuestion,header:'A26 原生来源',answers:[nativeAnswer,'A26_NATIVE_NO']}
    :{question,header:'A26 同文来源',answers};
  return issue(named(tools,'AskUserQuestion'),{questions:[{question:same.question,header:same.header,
    options:same.answers.map((label,i)=>({label,description:i?'第二项':'第一项'})),multiSelect:false}]});
}

export function createRequestFlow({ profiles, models, browserTaskId, origin, siblings }) {
  let releaseParent;
  const parentGate=new Promise(resolve=>{releaseParent=resolve;});
  const records={siblings:{},native:{},business:{},host:{},calls:[]};
  let step=0;
  let closing=false;
  let parentPrior;
  let sequence;
  const note=(lane,call)=>{records.calls.push({lane,tool:call.tool.name,id:call.id,args:call.args});return call;};
  function parentCall(tool,args){
    parentPrior=issue(tool,args);
    return note('parent',parentPrior);
  }
  function ownAnswer(observed,messages){
    const receipt=toolReceipt(messages,observed.call.id);
    return {callId:receipt.toolUseId,isError:receipt.isError,text:receipt.text.slice(0,1600)};
  }
  async function next({model,tools,messages}){
    const input=JSON.stringify(messages);
    if(closing)return {answer:'A26_CLEANUP'};
    if(model===models.browser){
      assert(input.includes(browserPrompt));
      return {answer:browserDone+'\n\n['+browserLabel+']('+origin+'/a26-page)'};
    }
    const sibling=siblings.find(item=>item.model===model);
    if(sibling){
      const state=records.siblings[sibling.id]??= {};
      if(!state.call){
        assert(input.includes(sibling.marker),'real delegated input marker expected');
        state.call=ask(tools,'sibling');
        return note(sibling.id,state.call);
      }
      state.reply??=ownAnswer(state,messages);
      return {answer:sibling.marker+'_DONE'};
    }
    if(input.includes(nativePrompt)&&!input.includes(rootPrompt)){
      const state=records.native;
      state.providerReached=true;
      state.model=model;
      state.toolNames=tools.map(tool=>tool.name);
      if(!state.call){
        if(!findTool(tools,'AskUserQuestion').length){
          state.notExposed=true;
          return {answer:noNativeTool};
        }
        state.call=ask(tools,'native');
        return note('native',state.call);
      }
      state.reply??=ownAnswer(state,messages);
      return {answer:nativeDone};
    }
    assert.equal(model,models.parent);
    if(step>5)return {answer:rootDone};
    const stage=step++;
    if(stage===0){
      assert(input.includes(rootPrompt));
      return parentCall(named(tools,'wy_targets'),{});
    }
    const receipt=toolReceipt(messages,parentPrior.id);
    if(stage===1){
      assert.equal(receipt.isError,false);
      const targets=receipt.value?.targets?.filter(t=>t.profileId===profiles.claude);
      assert.equal(targets?.length,1);
      [sequence]=targets;
      assert.equal(sequence.available,true);
      assert.match(sequence.revision,/^[0-9a-f]{64}$/);
    }
    if(stage===1||stage===2){
      if(stage===2){
        assert.equal(receipt.isError,false);
        assert.equal(receipt.value?.workspaceMode,'worktree');
        records.host[siblings[0].id]=receipt.value;
      }
      const target=siblings[stage-1];
      const delegate=named(tools,'wy_delegate');
      assert.equal(delegate.input_schema?.properties?.profileRevision?.type,'string');
      return parentCall(delegate,{requestKey:'a26-request-'+target.id,profileId:sequence.profileId,profileRevision:sequence.revision,
        title:target.title,model:target.model,instructions:target.marker+' Ask the one fixed synthetic question.',
        access:'write',workspaceMode:'worktree'});
    }
    if(stage===3){
      assert.equal(receipt.isError,false);
      assert.equal(receipt.value?.workspaceMode,'worktree');
      records.host[siblings[1].id]=receipt.value;
      const call=browserCall(tools,browserTaskId);
      records.businessPlan={transport:call.transport,command:call.args.command,toolNames:tools.map(t=>t.name)};
      return parentCall(call.tool,call.args);
    }
    if(stage===4){
      records.business={isError:receipt.isError,text:receipt.text,callId:receipt.toolUseId};
      assert.equal(receipt.isError,false,receipt.text);
      assert.match(receipt.text,/awaiting_user|等待用户|等待授权/, 'business invocation must return a real pending receipt');
      const native=tools.filter(t=>t.name==='Agent'||t.name==='Task');
      assert.equal(native.length,1,'native Agent tool needed');
      return parentCall(native[0],{description:'A26 本地原生问题',prompt:nativePrompt+' 请发出指定的本机测试问题。',
        subagent_type:nativeType});
    }
    records.native.agentReply={isError:receipt.isError,text:receipt.text.slice(0,1600),callId:receipt.toolUseId};
    records.native.agentReturned=true;
    await parentGate;
    return {answer:rootDone};
  }
  return {next,records,releaseParent,stop(){closing=true;releaseParent();}};
}
