import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { codexToolCall, codexToolReply, listedAvailable } from '../a26-recheck/codex-mcp.mjs';
import { defer, latestUserText } from '../a32-recheck/protocol.mjs';

export const models={parent:'a67-parent',child:'a67-child'};
export const title='A67 isolated explicit Git child';
export const file='merge-target.txt';
export const values={base:'A67_BASE_LINE\n',child:'A67_CHILD_LINE\n',parent:'A67_PARENT_LINE\n',
  resolved:'A67_PARENT_LINE\nA67_CHILD_LINE\n'};
export const markers={parent:'A67_DELEGATE_ONLY_EXPLICIT_WORKTREE',child:'A67_WRITE_ONE_LOCAL_FILE',
  delegated:'A67_PARENT_DELEGATED',finished:'A67_PARENT_GIT_DONE',childDone:'A67_CHILD_FILE_WRITTEN',
  rejected:'A67_GIT_DENIED_NO_RETRY',left:'A67_CHERRY_PICK_UNRESOLVED',retry:'A67_SECOND_CHECK_NO_NEW_WRITES'};

export function quote(value){return "'"+value.replaceAll("'","'\\''")+"'";}

export function getCall(body,kind,short,args){
  if(kind==='codex')return codexToolCall(body,short,args);
  const tool=(body.tools??[]).find(t=>t.name===short||t.name.endsWith('__'+short));
  assert(tool,'Actual Claude tool not advertised: '+short);
  return {tool,args,callId:'toolu_'+randomUUID().replaceAll('-','')};
}
function output(body,kind,id){
  if(kind==='claude'){
    const found=(body.messages??[]).flatMap(row=>Array.isArray(row.content)?row.content:[])
      .filter(part=>part.type==='tool_result'&&part.tool_use_id===id);
    assert.equal(found.length,1,'Original Claude result is absent');
    return {error:!!found[0].is_error,text:typeof found[0].content==='string'?found[0].content:
      found[0].content.flatMap(part=>part.type==='text'?[part.text]:[]).join('\n')};
  }
  const found=(body.input??[]).filter(row=>row.type==='function_call_output'&&row.call_id===id);
  assert.equal(found.length,1,'Original Codex result is absent');
  return {error:false,text:typeof found[0].output==='string'?found[0].output:JSON.stringify(found[0].output)};
}
function mcpJson(body,kind,id){
  return kind==='codex'?codexToolReply(body,id):JSON.parse(output(body,kind,id).text);
}
export function childWrite(cwd){
  return "printf 'A67_CHILD_LINE\\n' > "+quote(join(cwd,file))+' && pwd -P';
}
export function mergeCommand(scenario,step,cwd,sha){
  assert.match(sha,/^[a-f0-9]{40}$/);
  assert.match(cwd,/^\/private\/tmp\/willyou-m14-stage6\.WRvdST\/g03\/(?:attempt-[0-9]+|prep-next\/a67-tier-matrix\/preflight-[A-Za-z0-9]+)\/runtime-[A-Za-z0-9]+\/(?:repo|linked)$/);
  const git='/usr/bin/git -C '+quote(cwd);
  const pick=git+' cherry-pick -x '+sha;
  if(scenario==='overlap'){
    return [git+' add -- '+file,git+" commit -m 'Preserve local A67 parent change'",pick,
      "printf 'A67_PARENT_LINE\\nA67_CHILD_LINE\\n' > "+quote(join(cwd,file)),git+' add -- '+file,
      git+' -c core.editor=true cherry-pick --continue'][step]??null;
  }
  if(scenario==='conflict'||scenario==='staged'){
    const conflictRecovery=[pick,"printf 'A67_PARENT_LINE\\nA67_CHILD_LINE\\n' > "+quote(join(cwd,file)),
      git+' add -- '+file];
    if(scenario==='conflict')conflictRecovery.push(git+' -c core.editor=true cherry-pick --continue');
    return conflictRecovery[step]??null;
  }
  assert(['clean','reject','leave'].includes(scenario));
  return step===0?pick:null;
}
export function needsApproval(command){
  return command.startsWith('/usr/bin/git ');
}
export const nativeSuggestion=/git cherry-pick -x ([a-f0-9]{40})(?:[^0-9a-f]|$)/;

export function codexCommandArgs(tool, command, cwd, tier, gitWrite) {
  assert(['ask','auto','full'].includes(tier));
  const args={cmd:command,workdir:cwd,max_output_tokens:300};
  if(!gitWrite||tier==='full')return args;
  assert(command.startsWith('/usr/bin/git -C '+quote(cwd)+' '),'Only the exact isolated parent Git command may ask native approval');
  const supported=tool.parameters?.properties??{};
  assert(supported.sandbox_permissions,'Installed Codex did not advertise the native sandbox_permissions approval parameter');
  assert(supported.justification,'Installed Codex did not advertise native justification');
  const choices=supported.sandbox_permissions.enum;
  if(Array.isArray(choices))assert(choices.includes('require_escalated'),'Installed Codex does not offer the documented approval request option');
  return {...args,sandbox_permissions:'require_escalated',
    justification:'A67 fixture only: allow this exact Git command in the isolated local verification worktree.'};
}

export function isRealCherryPickConflict(receipt) {
  const text=receipt?.text??'';
  return /(?:\bCONFLICT\b|could not apply|发生冲突|冲突于)/i.test(text) &&
    !/(?:Operation not permitted|Permission denied|index\.lock|in sandbox)/i.test(text);
}

export function createFlow({scenario,kind,tier,targetId,cwd,workFor,recordNotice}){
  const state={parentStep:'initial',childStep:'initial',gate:defer(),mergeStep:0,commands:[],retryNotices:[],
    done:false,closed:false};
  function call(body,side,short,args){
    const caller=side==='parent'?kind:'codex';
    const value=getCall(body,caller,short,args);
    state[side+'Id']=value.callId;
    return {type:side+'-'+short,call:value};
  }
  function shell(body,side,command,workdir){
    const caller=side==='parent'?kind:'codex';
    if(caller==='claude')return call(body,side,'Bash',{command,description:'A67 isolated Git merge fixture'});
    const request=getCall(body,'codex','exec_command',{});
    request.args=codexCommandArgs(request.tool,command,workdir,tier,side==='parent'&&needsApproval(command));
    state[side+'Id']=request.callId;
    return {type:side+'-exec_command',call:request};
  }
  function sendNext(body){
    const command=mergeCommand(scenario,state.mergeStep,cwd,state.sha);
    if(command===null){
      state.done=true;
      return {type:'merge-end',answer:['leave','staged'].includes(scenario)?markers.left:scenario==='reject'?markers.rejected:markers.finished};
    }
    const response=shell(body,'parent',command,cwd);
    state.commands.push({command,callId:response.call.callId,approvalExpected:needsApproval(command)&&tier==='ask',
      autoReviewExpected:needsApproval(command)&&tier==='auto',
      requestedNativeEscalation:response.call.args.sandbox_permissions==='require_escalated'});
    state.mergeStep++;
    return response;
  }
  return {state,release(){state.gate.release();},close(){state.closed=true;state.gate.release();},async next(protocol,body){
    if(state.closed)return {type:'cleanup',answer:'A67 isolated cleanup'};
    // r3: Codex auto_review opens a separate guardian session whose prompt asks for {"outcome":"allow"} on low-risk actions.
    // r2 mistook that request for the parent's tool result. Answer it as the reviewer and record what was reviewed.
    if(protocol==='codex'&&JSON.stringify(body).includes('give the final answer directly: {\\"outcome\\":\\"allow\\"}')){
      (state.guardianReviews??=[]).push({at:Date.now(),model:body.model??null,commands:state.commands.length});
      return {type:'guardian-allow',answer:'{"outcome":"allow"}'};
    }
    const latest=latestUserText(protocol,body);
    if(body.model===models.child){
      assert.equal(protocol,'codex');
      if(state.childStep==='initial'){
        assert(latest.includes(markers.child));
        state.childStep='gated';
        await state.gate.promise;
        assert(!state.closed);
        const work=await workFor(state.receipt.childTaskId);
        state.childStep='writing';
        return shell(body,'child',childWrite(work),work);
      }
      assert.equal(state.childStep,'writing');
      state.childOutput=output(body,'codex',state.childId);
      assert(!state.childOutput.error);
      const work=await workFor(state.receipt.childTaskId);
      assert(state.childOutput.text.includes(work));
      state.childStep='finished';
      return {type:'child-end',answer:markers.childDone};
    }
    assert.equal(protocol,kind);
    assert.equal(body.model,models.parent);
    if(state.parentStep==='initial'){
      assert(latest.includes(markers.parent));
      state.parentStep='targets';
      return call(body,'parent','wy_targets',{});
    }
    if(state.parentStep==='targets'){
      const target=listedAvailable(mcpJson(body,kind,state.parentId),targetId);
      state.parentStep='delegate';
      return call(body,'parent','wy_delegate',{requestKey:'a67-merge-'+scenario,profileId:target.profileId,
        profileRevision:target.revision,title,instructions:markers.child,model:models.child,access:'write',workspaceMode:'worktree'});
    }
    if(state.parentStep==='delegate'){
      state.receipt=mcpJson(body,kind,state.parentId);
      assert.equal(state.receipt.workspaceMode,'worktree');
      assert.match(state.receipt.baseCommit,/^[a-f0-9]{40}$/);
      state.parentStep='notice';
      return {type:'parent-original-end',answer:markers.delegated};
    }
    if(latest.includes('宿主合并核对失败：')&&state.done){
      assert(latest.includes('不是新的真人授权'));
      state.retryNotices.push(latest.slice(0,1500));
      return {type:'no-retry-after-failure',answer:markers.retry};
    }
    if(state.parentStep==='notice'){
      assert(latest.includes('宿主子任务结果通知')&&latest.includes(state.receipt.childTaskId));
      assert(latest.includes('不要 reset --hard、checkout -- .、clean -fd 或强制推送。'));
      state.sha=nativeSuggestion.exec(latest)?.[1];
      assert(state.sha,'A67 actual result notification must ask for precise cherry-pick -x');
      await recordNotice(state.receipt,state.sha,latest);
      state.parentStep='merge';
      return sendNext(body);
    }
    assert.equal(state.parentStep,'merge');
    assert(!state.done,'Unexpected additional original response after merge');
    const receipt=output(body,kind,state.parentId);
    state.commands.at(-1).receipt=receipt;
    if(scenario==='reject')assert(receipt.error||/reject|denied|declined|not approved|cancel|拒绝|取消/i.test(receipt.text),'Expected explicit native denial');
    if(['leave','staged'].includes(scenario)&&state.mergeStep===1)assert(isRealCherryPickConflict(receipt),'Expected actual Git conflict, not a sandbox rejection or unrelated process failure');
    return sendNext(body);
  }};
}

