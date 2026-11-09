// Runtime own-App readonly reads only; no calls on import. Shared verifier remains byte-identical.
import assert from 'node:assert/strict';
import {readOwnedRunPlan,makePlanReadBody,verifyPlanRecord,canonical} from './plan-reader.mjs';
export async function captureActualPlan({own,userData,runId,taskId,projectId}){
 const expected={runId,taskId,projectId};
 const actual=await readOwnedRunPlan({own,userData,...expected});
 // Preserve the actual SQL row for offline independent owner/store/run/hash verification.
 const record=await own(makePlanReadBody({userData,runId}),'readonly-owned-run-plan-proof');
 const independent=verifyPlanRecord(record,expected);
 assert.equal(canonical(independent),canonical(actual.plan),'Immutable plan changed between two readonly snapshots');
 assert.equal(actual.binding.ownerStoreId,record.store.store_id);
 return {plan:actual.plan,binding:actual.binding,record};
}
