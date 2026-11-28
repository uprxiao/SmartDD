import assert from 'node:assert/strict';

// Do not confuse committed page recovery with clearing a previously submitted
// but now canceled address draft. Both have independent, genuine UI guards.
export function addressRecoveryAction(actual,stoppedContext){
 const {task,page,committedUrl,submittedUrl}=stoppedContext;
 assert(actual?.taskId===task&&(!actual.pageId||actual.pageId===page)&&actual.workspaceVisible===true,
   'Wrong task/page while checking canceled address draft');
 assert(actual.stopVisible===false&&actual.refreshVisible===true,'Actual Stop did not return to Reload');
 if(actual.address===committedUrl)return 'already-committed-address';
 if(actual.address===submittedUrl)return 'click-exact-address-and-normal-Escape';
 throw Error('Unknown address after actual Stop: do not send a recovery action');
}
export function validateStopped({original,stopped,hold,stopStartedAt,beforeDocument,afterDocument,committedUrl}){
 const before=original.tabs.find(t=>t.id===original.activeId),after=stopped.tabs.find(t=>t.id===stopped.activeId);
 assert(before&&after&&original.activeId===stopped.activeId&&original.taskId===stopped.taskId);
 assert.equal(after.id,before.id);assert.equal(after.profileId,before.profileId);
 assert.equal(before.url,committedUrl);assert.equal(after.url,committedUrl);
 assert.equal(before.loading,false);assert.equal(after.loading,false);
 assert.equal(after.failure,null);assert.equal(hold.responseCompleted,false);assert(hold.closedAt>=stopStartedAt&&hold.closedAt>=hold.at);
 assert.equal(before.canGoBack,after.canGoBack);assert.equal(before.canGoForward,after.canGoForward);
 assert.deepEqual(afterDocument,beforeDocument,'Actual same original native WC/renderer/document required after cancellation');
 assert.equal(afterDocument.state.url,committedUrl);assert.equal(afterDocument.state.marker,'M16_VISUAL_PAIR_PAGE');
 return {task:stopped.taskId,page:after.id,committedUrl};
}
