import assert from 'node:assert/strict';
const U='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const finished=new RegExp('^宿主业务结果通知：跨任务浏览器授权，finished。详情引用 ('+U+')；这不是新的真人授权。$','i');
export const exactFinishedText=id=>'宿主业务结果通知：跨任务浏览器授权，finished。详情引用 '+id+'；这不是新的真人授权。';
export function latestUserText(input){
 if(!Array.isArray(input))return null;const last=[...input].reverse().find(x=>x?.role==='user');if(!last)return null;
 if(typeof last.content==='string')return last.content;const c=last.content;if(!Array.isArray(c)||c.length!==1||c[0]?.type!=='input_text'||typeof c[0].text!=='string')return null;return c[0].text;
}
export function exactFinishedNotice(input){const text=latestUserText(input),match=typeof text==='string'&&finished.exec(text);return match?{itemId:match[1],text}:null;}
export function assertApprovedNoticeProof({notice,expected,record,notification,turn,hostItem,run,grantState,target}){
 assert(notice?.text===exactFinishedText(notice.itemId));
 const x=record.row,p=record.payload,o=record.origin;assert.equal(x.request_id,expected.requestId);assert.equal(x.operation_id,expected.operationId);assert.equal(x.task_id,expected.taskId);assert.equal(x.status,'resolved');assert.equal(JSON.parse(x.decision_ref).choice,'control');assert.equal(p.phase,'finished');assert.equal(p.resultItemId,notice.itemId);
 assert(p.businessKind==='browser_access'&&o.taskId===expected.taskId&&o.bindingId===expected.bindingId);assert(p.review.requester===expected.taskId&&p.review.targetTaskId===expected.targetTaskId&&p.review.mode==='control');assert.deepEqual(p.review.pages.map(v=>({id:v.id,url:v.url})),[{id:expected.targetPageId,url:expected.targetUrl}]);
 const n=notification.payload;assert(notification.item_id===notice.itemId&&notification.task_id===expected.taskId&&notification.type==='notification');assert(n.sourceKind==='system'&&n.title==='跨任务浏览器授权'&&n.status==='finished'&&n.requestId===expected.requestId&&n.operationId===expected.operationId);assert(n.result?.status==='authorized'&&n.result.boundRunId===x.bound_run_id&&n.result.grantId===expected.requestId);
 assert(turn.task_id===expected.taskId&&turn.client_input_id==='business-result-'+expected.requestId&&turn.source_kind==='notification'&&turn.run_id===x.bound_run_id&&['dispatching','started'].includes(turn.status)&&!turn.ended_at);
 assert(hostItem.task_id===expected.taskId&&hostItem.turn_id===turn.turn_id&&hostItem.type==='user_message'&&hostItem.text===notice.text);
 assert(run.run_id===x.bound_run_id&&run.task_id===expected.taskId&&run.project_id===expected.projectId&&run.binding_id===expected.bindingId&&run.state==='active');
 assert.deepEqual(grantState.requests,[]);assert.equal(grantState.grants.length,1);const g=grantState.grants[0];assert(g.id===expected.requestId&&g.runId===run.run_id&&g.requesterTaskId===expected.taskId&&g.targetTaskId===expected.targetTaskId&&g.projectId===expected.projectId&&g.mode==='control');
 assert(target.task===expected.targetTaskId&&target.id===expected.targetPageId&&target.url===expected.targetUrl);
 return {requestId:expected.requestId,resultItemId:notice.itemId,runId:run.run_id,grantId:g.id,requesterTaskId:expected.taskId,targetTaskId:expected.targetTaskId,projectId:expected.projectId,bindingId:expected.bindingId,actualNotificationTurn:turn.turn_id,actualTurnState:turn.status,actualControlApproval:true,neverAccessedTarget:true};
}
