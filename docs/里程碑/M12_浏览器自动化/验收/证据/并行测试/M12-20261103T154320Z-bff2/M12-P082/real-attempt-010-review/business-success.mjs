// Pure evidence predicates. Actual Host rows must come from the current own run, not cached claims.
import assert from 'node:assert/strict';
export function assertBusinessSuccess({receipt,host,scope,plan,carrier}){
 assert.equal(carrier.outerCompleted,true);assert(carrier.childExitCodeObserved===null||carrier.childExitCodeObserved===0,'Known nonzero child exit cannot pass');
 assert.equal(receipt.schema,'willyou-app-result-v2');assert.equal(receipt.contractMajor,2);assert.equal(receipt.status,'ok');assert.equal(receipt.operation.origin,'cli');assert(['completed','read-only'].includes(receipt.operation.effectState));
 assert.equal(receipt.source.appId,scope.appId);assert.equal(receipt.source.packageHash,scope.packageHash);
 assert.equal(plan.runId,scope.runId);assert.equal(plan.taskId,scope.taskId);assert.equal(plan.projectId,scope.projectId);
 assert(plan.applications.some(a=>a.appId===scope.appId&&a.packageHash===scope.packageHash&&a.effectiveEntry==='cli'));
 assert(plan.allowed.some(a=>a.appId===scope.appId&&a.packageHash===scope.packageHash&&a.capabilityId===receipt.capabilityId&&a.contractMajor===2&&a.entry==='cli'));
 for(const [key,value] of Object.entries({run_id:scope.runId,task_id:scope.taskId,project_id:scope.projectId,app_id:scope.appId,package_hash:scope.packageHash,tool_name:receipt.capabilityId,operation_id:receipt.operation.id,request_id:receipt.operation.requestId,state:'succeeded',effect_state:receipt.operation.effectState,attempt_count:1}))assert.equal(host[key],value,key);
 // The raw application_invocations schema has no callerKind column; activity API rows do.
 if(host.callerKind!==undefined)assert.equal(host.callerKind,'agent-run');if(host.caller_kind!==undefined)assert.equal(host.caller_kind,'agent-run');
 return{businessSuccess:true,authority:'AST-attributed actual CLI stdout plus exact current authenticated-run Host invocation',childExitCodeObserved:carrier.childExitCodeObserved};
}
