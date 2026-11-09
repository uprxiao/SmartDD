import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const sha=value=>createHash('sha256').update(value).digest('hex');
export function compareCodePoints(a,b){const aa=Array.from(a,c=>c.codePointAt(0)),bb=Array.from(b,c=>c.codePointAt(0));for(let i=0;i<Math.min(aa.length,bb.length);i++)if(aa[i]!==bb[i])return aa[i]-bb[i];return aa.length-bb.length;}
export function canonical(value){if(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);if(Array.isArray(value)){assert(!Array.from(value).some(x=>x===undefined));return '['+value.map(canonical).join(',')+']';}assert(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype);return '{'+Object.keys(value).sort(compareCodePoints).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}
export function verifyPlanRecord(record,expected){
 assert(record&&record.operation&&record.store&&record.run,'Complete actual readonly record required');const {operation,store,run}=record;
 assert.equal(operation.kind,'application-run-plan');assert.equal(operation.state,'committed');assert.equal(operation.owner_store_id,store.store_id);assert.equal(store.maintenance_state,'ready');assert.equal(operation.operation_id,'application-run-plan:'+expected.runId);
 assert.equal(run.run_id,expected.runId);assert.equal(run.task_id,expected.taskId);assert.equal(run.project_id,expected.projectId);
 assert(typeof operation.plan_json==='string'&&Buffer.byteLength(operation.plan_json)<=4*1024*1024);
 const plan=JSON.parse(operation.plan_json),{planHash,...payload}=plan;assert.equal(plan.schema,'willyou-application-run-plan-v1');assert.equal(planHash,sha(canonical(payload)));assert.equal(plan.runId,expected.runId);assert.equal(plan.taskId,expected.taskId);assert.equal(plan.projectId,expected.projectId);assert.equal(plan.cliVersion,'0.166.0');assert(Array.isArray(plan.skills)&&Array.isArray(plan.allowed)&&Array.isArray(plan.applications));
 for(const skill of plan.skills){assert(typeof skill.appId==='string'&&typeof skill.skillId==='string'&&typeof skill.nativeName==='string');assert(/^[a-f0-9]{64}$/.test(skill.renderedHash));}
 return plan;
}
export function makePlanReadBody({userData,runId}){
 assert(userData.startsWith('/private/tmp/willyou-m12-')&&userData.endsWith('/runtime-001/userdata'));assert(/^[a-f0-9-]{36}$/.test(runId));
 return `const request=process.getBuiltinModule('module').createRequire(E.app.getAppPath()+'/package.json'),DB=request('better-sqlite3'),db=new DB(${JSON.stringify(userData+'/smartdd.db')},{readonly:true,fileMustExist:true});try{db.pragma('query_only=ON');return{operation:db.prepare('SELECT operation_id,kind,owner_store_id,state,plan_json FROM capability_resource_operations WHERE operation_id=?').get(${JSON.stringify('application-run-plan:'+runId)}),store:db.prepare('SELECT store_id,maintenance_state FROM capability_store_state WHERE singleton=1').get(),run:db.prepare('SELECT run_id,task_id,project_id,runner,snapshot_hash FROM capability_runs WHERE run_id=?').get(${JSON.stringify(runId)})}}finally{db.close()}`;
}
export async function readOwnedRunPlan({own,userData,runId,taskId,projectId}){const body=makePlanReadBody({userData,runId});new Function('E',body);const record=await own(body,'readonly-owned-run-plan');return {plan:verifyPlanRecord(record,{runId,taskId,projectId}),binding:{operationId:record.operation.operation_id,ownerStoreId:record.operation.owner_store_id,runId,taskId,projectId,source:'Actual own-App SQLite readonly committed operation, not applications.session presentation summary'}};}
