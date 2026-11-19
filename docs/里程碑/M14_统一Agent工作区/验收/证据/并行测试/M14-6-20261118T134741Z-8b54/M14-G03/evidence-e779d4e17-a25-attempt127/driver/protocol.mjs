import assert from 'node:assert/strict';
import { codexToolCall, codexToolReply, listedAvailable } from '../a26-recheck/codex-mcp.mjs';
import { defer, latestUserText } from '../a32-recheck/protocol.mjs';
import { businessFixture } from '../a32-recheck/business/harness.mjs';

export const fixture={
  title:'A25 same Codex tree and goal',childTitle:'A25 held Codex read-only child',
  objective:'A25 prove original task tree idle before native goal is completed',
  warmup:'A25_SAME_TREE_WARMUP',background:'A25_SAME_TREE_NATIVE_BACKGROUND',child:'A25_SAME_TREE_HOST_CHILD',
  rootFinished:'A25_SAME_TREE_PARENT_TURN_FINISHED',nativeFinished:'A25_SAME_TREE_NATIVE_NODE_FINISHED',
  childFinished:'A25_SAME_TREE_HOST_CHILD_FINISHED',goalFinished:'A25_SAME_TREE_GOAL_COMPLETED',
  models:{parent:'a25-same-codex-parent',child:'a25-same-codex-reader'},
};

export function createSameTree(childProfileId) {
  const state={startRequested:false,resumeRequested:false,phase:'targets',nativeGate:defer(),childGate:defer(),parentGate:defer(),
    actions:[],notifications:[],childCount:0,nativeCount:0};
  let previous;
  function action(body,name,args){
    const call=codexToolCall(body,name,args);
    previous=call.callId;
    state.actions.push({name,callId:call.callId});
    return {call,type:name};
  }
  async function next(body){
    if(state.closed)return {answer:'A25 cleanup',type:'cleanup'};
    const latest=latestUserText('codex',body);
    if(body.model===fixture.models.child){
      assert(latest.includes(fixture.child));
      assert.equal(++state.childCount,1);
      state.childHeld=true;
      await state.childGate.promise;
      return {answer:fixture.childFinished,type:'hosted-child'};
    }
    assert.equal(body.model,fixture.models.parent);
    if(latest.includes(fixture.background)){
      assert(state.spawnCall,'native child provider reached before spawn_agent');
      assert.equal(++state.nativeCount,1);
      state.nativeHeld=true;
      await state.nativeGate.promise;
      return {answer:fixture.nativeFinished,type:'native-background'};
    }
    if(!state.startRequested){
      assert(latest.includes(fixture.warmup),'unexpected parent request before A25 goal was set');
      return {answer:'A25 same tree warmup',type:'warmup'};
    }
    if(state.phase==='targets'){
      assert(JSON.stringify(body).includes(fixture.objective),'actual goal must be present in the native start request');
      state.phase='delegate';
      return action(body,'wy_targets',{});
    }
    if(state.phase==='delegate'){
      const target=listedAvailable(codexToolReply(body,previous),childProfileId);
      assert.equal(target.trustedRead,true);
      state.phase='spawn';
      return action(body,'wy_delegate',{requestKey:'a25-same-tree-reader',profileId:target.profileId,
        profileRevision:target.revision,title:fixture.childTitle,instructions:fixture.child,model:fixture.models.child,access:'read'});
    }
    if(state.phase==='spawn'){
      state.delegation=codexToolReply(body,previous);
      assert.equal(typeof state.delegation.childTaskId,'string');
      state.phase='business';
      const init=action(body,'spawn_agent',{message:fixture.background+' Return the exact local marker when allowed.',fork_context:false});
      assert.equal(init.call.tool.namespace,'multi_agent_v1');
      state.spawnCall=init.call.callId;
      return init;
    }
    if(state.phase==='business'){
      state.nativeSpawn=codexToolReply(body,previous);
      assert.match(state.nativeSpawn.agent_id??'',/^[a-f0-9-]{36}$/i,'exact Codex native node identity from spawn_agent');
      state.phase='parent-finish';
      return action(body,businessFixture.tool,{marker:businessFixture.marker});
    }
    if(state.phase==='parent-finish'){
      state.businessAck=codexToolReply(body,previous);
      assert.match(JSON.stringify(state.businessAck),/awaiting_user|等待用户|等待批准/,'real business call must be asynchronous and waiting for human approval');
      state.phase='waiting-release';
      await state.parentGate.promise;
      state.phase='after-parent';
      return {answer:fixture.rootFinished,type:'parent-completed'};
    }
    const notification=latest.includes('宿主业务结果通知')?'business':latest.includes('宿主子任务结果通知')?'child':null;
    if(notification){
      state.notifications.push({type:notification});
      return {answer:'A25 checked '+notification+' notification',type:'host-notification'};
    }
    assert.equal(state.phase,'after-parent');
    assert(state.resumeRequested,'unexpected Codex request while observing the paused original goal and the tree');
    if(!state.goalCall){
      const complete=action(body,'update_goal',{status:'complete'});
      const schema=complete.call.tool.parameters?.properties?.status;
      assert(schema?.enum?.includes('complete')||schema?.type==='string');
      state.goalCall=complete.call.callId;
      return complete;
    }
    assert(!state.goalReceipt,'extra automatic native goal round after completed receipt');
    state.goalReceipt=codexToolReply(body,state.goalCall);
    assert.equal(state.goalReceipt?.goal?.status,'complete');
    assert.equal(state.goalReceipt.goal.objective,fixture.objective);
    return {answer:fixture.goalFinished,type:'goal-completed'};
  }
  return {state,next,close(){state.closed=true;state.nativeGate.release();state.childGate.release();state.parentGate.release();}};
}
