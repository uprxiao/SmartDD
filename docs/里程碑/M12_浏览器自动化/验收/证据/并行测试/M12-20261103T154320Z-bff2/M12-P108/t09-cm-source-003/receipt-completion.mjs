// Read-only original operation completion fence. Never writes state or reissues a call.
import assert from 'node:assert/strict';
export async function waitForOriginalOperationEnd({record:r,role,spec,call,value,readHost,poll,persist}){
 const operationId=value?.operation?.id??value?.operationId;
 assert(typeof operationId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(operationId),'Actual MCP output must identify its original operation');
 const before=r.issueBefore.filter(x=>x.role===role&&x.spec.id===spec.id);assert.equal(before.length,1);
 assert(!before[0].host.some(x=>x.operation_id===operationId),'Never wait a historical operation');
 const arm=r.arms[role],trace={role,job:spec.id,callId:call.call_id,operationId,runId:arm.runId,taskId:arm.taskId,projectId:r.projects[role],startedAt:new Date().toISOString(),budgetMs:10000,samples:[],completed:false};
 (r.receiptCompletionWaits??=[]).push(trace);const start=Date.now();await persist();
 try{const final=await poll(async()=>{const host=await readHost(),rows=host.filter(x=>x.operation_id===operationId);assert.equal(rows.length,1,'Exactly the original new operation row');const row=rows[0];assert.equal(row.run_id,arm.runId);assert.equal(row.task_id,arm.taskId);assert.equal(row.project_id,r.projects[role]);assert.equal(row.app_id,'sample-kv');assert.equal(row.tool_name,'smartdd_sample_kv_read_v2');assert.equal(row.package_hash,arm.actualPlan.applications.find(x=>x.appId==='sample-kv').packageHash);assert(['running','succeeded','failed','unknown'].includes(row.state));if(value?.operation?.requestId)assert.equal(row.request_id,value.operation.requestId);if(value?.requestId)assert.equal(row.request_id,value.requestId);trace.samples.push({at:new Date().toISOString(),elapsedMs:Date.now()-start,row:{...row}});await persist();return row.state!=='running'&&typeof row.ended_at==='string'?host:null;},10000);trace.completed=true;trace.finishedAt=new Date().toISOString();trace.elapsedMs=Date.now()-start;await persist();return final;
 }catch(error){trace.finishedAt=new Date().toISOString();trace.elapsedMs=Date.now()-start;trace.timedOut=trace.elapsedMs>=10000;trace.error=String(error);await persist();throw error;}
}
