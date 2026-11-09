import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{assertFailureAddressState}from'./failure-evidence.mjs';import{collectFailureCapture,isExactPendingTitleError}from'./pending-title-evidence.mjs';
const seedPath='/private/tmp/willyou-m12-t145-App056-failures56-R002/A-light-rw480-win1440x900-B04-not-running.json';
export async function verifyPendingTitleControls(){
 const seed=JSON.parse(await readFile(seedPath,'utf8')),pending=collectFailureCapture(seed);
 assert.equal(pending.originalEqualityPassed,false);assert.equal(pending.finalCriterionPassed,false);
 assert(pending.rawDifference&&pending.postTitleNativeIdentityChecked&&pending.otherOriginalCaptureChecksCompleted);
 assert.equal(pending.rawDifference.actual,seed.browserSnapshot.tabs.find(t=>t.id===seed.pageId).title);
 assert.equal(pending.rawDifference.expected,seed.native.title);
 const getError=()=>{try{assertFailureAddressState(seed);}catch(e){return e;}throw Error('Original known title assertion must remain red');};
 assert(isExactPendingTitleError(getError(),seed));
 let classifierNegative=0;
 for(const mutate of[e=>e.code='SOME_OTHER_ASSERTION',e=>e.operator='deepStrictEqual',e=>e.message='Different assertion',e=>e.actual='unrelated actual',e=>e.expected='unrelated expected',e=>e.stack=e.stack.replace('at assertFailureAddressState (','at otherFunction (')]){const e=getError();mutate(e);assert.equal(isExactPendingTitleError(e,seed),false);classifierNegative++;}
 assert.equal(isExactPendingTitleError(Object.assign(Error('same text'),{code:'ERR_ASSERTION'}),seed),false);classifierNegative++;
 let otherCriterionNegative=0;
 for(const mutate of[c=>c.browserSnapshot.tabs.find(t=>t.id===c.pageId).url=c.injection.url,c=>c.navigation.address=c.injection.url,c=>c.browserSnapshot.tabs.find(t=>t.id===c.pageId).failure.url='http://wrong.test/',c=>c.native.contentsId++,c=>c.failureUI.scrollWidth=c.failureUI.clientWidth+1,c=>c.hostFailure.kind='wrong',c=>c.native.destroyed=true,c=>c.injection.reason='wrong']){const c=structuredClone(seed);mutate(c);assert.throws(()=>collectFailureCapture(c));otherCriterionNegative++;}
 // Equal titles are a separate pure control, not a new expected production title.
 const equal=structuredClone(seed);equal.native.title=equal.browserSnapshot.tabs.find(t=>t.id===equal.pageId).title;const v=collectFailureCapture(equal);assert(v.originalEqualityPassed&&v.rawDifference===null);assert.equal(v.finalCriterionPassed,false);
 return{passed:true,positive:2,classifierNegative,otherCriterionNegative,knownOriginalAssertionStillFalse:true,postTitleNativeIdentityNegativeRejected:true,titleCriterionRemainsPending:true,actualAppNativeHTTPOS:0,seedPath};
}
