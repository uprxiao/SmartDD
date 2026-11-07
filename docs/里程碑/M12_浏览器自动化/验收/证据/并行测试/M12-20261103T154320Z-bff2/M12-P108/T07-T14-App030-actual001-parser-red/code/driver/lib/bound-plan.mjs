import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readOwnedRunPlan,makePlanReadBody,verifyPlanRecord,canonical} from './plan-reader.mjs';
const root='/private/tmp/willyou-m12-t131-T07-T14-App030-A-R-prep-001';
const pin=JSON.parse(await readFile(root+'/package-pin.json'));
export async function readBoundPlan({app,userData,projectId,taskId,excludeTaskIds=[],result}){
 assert.equal(pin.role,'App030');assert(projectId);assert(userData.startsWith(root+'/runs/'));
 const deadline=Date.now()+20000;let expectedTaskId=taskId;
 while(Date.now()<deadline){
  if(!expectedTaskId){const list=await app.invoke('tasks.list',{includeArchived:true}),eligible=list.filter(t=>t.projectId===projectId&&t.ptyId&&!excludeTaskIds.includes(t.id));assert(eligible.length<=1,'Ambiguous real UI task; never use latest plan');expectedTaskId=eligible[0]?.id;}
  if(expectedTaskId){const task=await app.invoke('tasks.get',expectedTaskId);assert.equal(task.projectId,projectId);const session=await app.invoke('applications.session',expectedTaskId);assert(session.ok);const runId=session.value.currentRun?.id;if(runId){
   const own=(code,label)=>app.mainEvaluate("(()=>{const E=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron');if(process.pid!=="+app.processId+"||process.execPath!=="+JSON.stringify(pin.executable)+"||E.app.getPath('userData')!=="+JSON.stringify(userData)+")throw Error('Exact owned App030 required');"+code+"})()",{label});
   const actual=await readOwnedRunPlan({own,userData,runId,taskId:expectedTaskId,projectId});
   assert.equal(actual.plan.runId,runId);assert.equal(actual.plan.taskId,expectedTaskId);assert.equal(actual.plan.projectId,projectId);
   const record=await own(makePlanReadBody({userData,runId}),'readonly-owned-run-plan');
   const expected={runId,taskId:expectedTaskId,projectId},independent=verifyPlanRecord(record,expected);assert.equal(canonical(independent),canonical(actual.plan));
   result.boundPlans??=[];result.boundPlans.push({at:new Date().toISOString(),plan:actual.plan,actualRecord:record,expected,binding:actual.binding,uiSummary:session.value.currentRun.runPlan});
   // Keep the UI summary separate. It has no Skills/allowed/planHash fields.
   return actual.plan;
  }}
  await new Promise(resolve=>setTimeout(resolve,35));
 }
 throw Error('Exact actual task/current-run plan was not ready within20s');
}
