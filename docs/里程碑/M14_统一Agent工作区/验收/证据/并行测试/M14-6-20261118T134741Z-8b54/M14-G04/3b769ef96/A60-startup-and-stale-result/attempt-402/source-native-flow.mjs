import assert from 'node:assert/strict';
import {codexToolCall,codexToolReply,listedAvailable} from '../../g03/prep-next/a26-recheck/codex-mcp.mjs';
import {defer,latestUserText} from '../../g03/prep-next/a32-recheck/protocol.mjs';
export const models={parent:'a60-old-parent',next:'a60-current-parent',child:'a60-original-child'};
export const start='A60_PARENT_DELEGATE';
export const restart='A60_CURRENT_RUN_EXPLICIT_REWORK';
export const original='A60_CHILD_FIRST_NATIVE_BODY';
export const rework='A60_CHILD_REAL_REWORK_BODY';
export const title='A60 exact registered Git child';
export const firstDone='A60_PARENT_ORIGINAL_DONE';
export const nextDone='A60_PARENT_REWORK_ACCEPTED';
export const delivered='A60_PARENT_LEGAL_CHILD_RESULT_RECEIVED';

export function createFlow({targetId}){
  const state={firstPhase:'initial',nextPhase:'initial',childInitial:defer(),childRework:defer(),routes:[],closed:false};
  function tool(body,side,name,args){
    const call=codexToolCall(body,name,args);
    state[side+'Call']=call.callId;
    return {type:name,call};
  }
  return {state,async next(protocol,body){
    assert.equal(protocol,'codex');
    if(state.closed)return {type:'cleanup',answer:'A60 isolated cleanup'};
    const text=latestUserText(protocol,body);
    if(text.includes('宿主子任务结果通知')){
      const match=/attempt (\d+) 状态 (\w+)/.exec(text);
      assert(match&&text.includes(state.firstReceipt.childTaskId));
      const observation={attemptOrdinal:Number(match[1]),status:match[2],model:body.model,text};
      state.routes.push(observation);
      assert.equal(body.model,models.next);
      assert.equal(observation.attemptOrdinal,2,'stale attempt was delivered into the current native run');
      assert.equal(observation.status,'completed');
      return {type:'legal-child-result',answer:delivered};
    }
    if(body.model===models.child){
      if(text.includes(rework)){
        state.reworkEntered=true;
        await state.childRework.promise;
        return {type:'rework-child-done',answer:rework};
      }
      assert(text.includes(original));
      state.initialEntered=true;
      await state.childInitial.promise;
      return {type:'original-child-done',answer:original};
    }
    if(body.model===models.parent){
      if(state.firstPhase==='initial'){
        assert(text.includes(start));
        state.firstPhase='targets';
        return tool(body,'first','wy_targets',{});
      }
      if(state.firstPhase==='targets'){
        const target=listedAvailable(codexToolReply(body,state.firstCall),targetId);
        state.firstPhase='delegate';
        return tool(body,'first','wy_delegate',{requestKey:'a60-stale-old-delegate',profileId:target.profileId,
          profileRevision:target.revision,title,instructions:original,model:models.child,access:'write',workspaceMode:'worktree'});
      }
      assert.equal(state.firstPhase,'delegate');
      state.firstReceipt=codexToolReply(body,state.firstCall);
      assert.equal(state.firstReceipt.workspaceMode,'worktree');
      state.firstPhase='done';
      return {type:'first-parent-done',answer:firstDone};
    }
    assert.equal(body.model,models.next);
    if(state.nextPhase==='initial'){
      assert(text.includes(restart));
      state.nextPhase='sending';
      return tool(body,'next','wy_send',{requestKey:'a60-exact-rework-after-cancel',childTaskId:state.firstReceipt.childTaskId,text:rework});
    }
    assert.equal(state.nextPhase,'sending');
    state.secondReceipt=codexToolReply(body,state.nextCall);
    assert.ok(state.secondReceipt.attemptId&&!state.secondReceipt.duplicate);
    state.nextPhase='done';
    return {type:'next-parent-done',answer:nextDone};
  },close(){state.closed=true;state.childInitial.release();state.childRework.release();}};
}
