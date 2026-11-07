// Pure fake-object delegation/finite-plan controls; no Native/production body.
import assert from'node:assert/strict';
import{installG3ClearObservation}from'./g3-clear-observation.mjs';
import{g3CliPlan}from'./g3-cli-plan.mjs';
export async function runG3Controls(){
 const checks=[],g={partition:'synthetic-only',profileId:'synthetic-only'},calls=[],value=Promise.resolve('original-return');
 const session={clearData(...args){calls.push({method:'clearData',thisValue:this,args});return value},clearAuthCache(...args){calls.push({method:'clearAuthCache',thisValue:this,args});return value}};
 const original={...session},E={session:{fromPartition(partition){assert.equal(partition,g.partition);return session}}};
 const installed=installG3ClearObservation(g,E);assert(installed.installed);assert.equal(calls.length,0);checks.push('install-makes-zero-calls');
 const arg={synthetic:true};assert.equal(session.clearData(arg),value);assert.equal(calls[0].thisValue,session);assert.equal(calls[0].args[0],arg);assert.equal(calls.length,1);checks.push('same-this-args-exact-original-return-once');
 const other={};assert.equal(Reflect.apply(session.clearAuthCache,other,[]),value);assert.equal(g.g3ClearObservation.records.length,1);assert.equal(calls[1].thisValue,other);checks.push('other-this-delegated-not-observed');
 await value;assert.equal(g.g3ClearObservation.records[0].stage,'fulfilled');checks.push('read-only-fulfilled-observation');
 assert(g.g3ClearObservation.restore().restored);assert.equal(session.clearData,original.clearData);assert.equal(session.clearAuthCache,original.clearAuthCache);checks.push('original-references-restored');
 const thrown=Error('known synthetic throw'),bad={clearData(){throw thrown},clearAuthCache(){return value}},g2={partition:'x',profileId:'x'};
 installG3ClearObservation(g2,{session:{fromPartition(){return bad}}});assert.throws(()=>bad.clearData(),error=>error===thrown);assert.equal(g2.g3ClearObservation.records[0].stage,'threw');assert(g2.g3ClearObservation.restore().restored);checks.push('exact-original-throw-not-swallowed');
 const p=g3CliPlan({pageId:'page',formPageId:'form',url:'http://127.0.0.1/writer',formURL:'http://127.0.0.1/form'});assert.equal(p.length,19);assert.equal(new Set(p.map(x=>x.tag)).size,19);assert.equal(p.filter(x=>x.expectedCode===2).length,2);assert(p.filter(x=>x.expectedCode===2).every(x=>x.expectedError==='BROWSER_UNAVAILABLE'&&x.effect==='read-only'));checks.push('original-g3-finite-19-cli-plan');
 return{checks,allPassed:true,NativeAppOSModelExecuted:false,scope:'Only finite G3 transport plan and fake-object this/args/return/throw/delegate restoration; not business evidence'};
}
