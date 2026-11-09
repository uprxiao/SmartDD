import{within,disjoint}from'./host-metadata.mjs';
import assert from'node:assert/strict';import{assertFailureCapture}from'./failure-evidence.mjs';
export const originalTitleMessage='Tab title follows actual native document title, not prototype failure heading';
const originalModuleURL=new URL('./failure-evidence.mjs',import.meta.url).href;
export function isExactPendingTitleError(error,c){
 const tab=c.browserSnapshot?.tabs?.find(x=>x.id===c.pageId),actual=tab?.title,expected=c.native?.title;
 if(!(error instanceof assert.AssertionError)||error.name!=='AssertionError'||error.code!=='ERR_ASSERTION'||error.operator!=='strictEqual'||error.generatedMessage!==false||typeof actual!=='string'||typeof expected!=='string'||actual===expected||error.actual!==actual||error.expected!==expected)return false;
 let reference;try{assert.equal(actual,expected,originalTitleMessage);}catch(e){reference=e;}
 if(!reference||error.message!==reference.message)return false;
 const frame=error.stack?.split('\n').find(line=>line.startsWith('    at '));
 return typeof frame==='string'&&frame.startsWith('    at assertFailureAddressState ('+originalModuleURL+':');
}
function assertOriginalCaptureRemainder(c){
 // The exact Nativeidentity assertion that follows originaltitle equality must still execute after diagnostic recognition.
 assert.equal(c.native.contentsId,c.committed.contentsId,'Original Native WC identity retained');
 const f=c.hostFailure,u=c.failureUI,s=c.scenario,metadata=c.metadata;assert(f&&u);assert.equal(f.kind,s.kind);assert.equal(f.errorName,s.error);assert.equal(f.url,c.injection.url);assert.equal(u.title,f.title);assert.equal(u.error,f.errorName);assert.equal(u.clientWidth>=u.scrollWidth,true,'Failure must not overflow horizontally');assert.equal(metadata.fonts,'loaded');assert(c.navigation.selectedTask===c.taskId);const page=metadata.components.find(x=>x.selector==='.bw-page')?.rect,browser=metadata.components.find(x=>x.selector==='.bw-workspace')?.rect;assert(page&&browser&&within(u.rect,page)&&within(u.rect,browser),'Failure UI must stay inside original browser page');assert(metadata.terminal&&disjoint(u.rect,metadata.terminal),'Failure must not cover actual terminal');assert(u.buttons.some(x=>x.text.trim()==='重试'));assert.equal(c.native.destroyed,false);assert.equal(c.native.contentsId,c.contentsId);assert.equal(c.native.placements.length,1);const v=c.native.placements[0];assert(!v.mainParent&&v.parentOpacity===0&&v.parentFocusable===false,'Real Native failure page must be in invisible nonfocusable parking window');assert(c.injection.injected);assert.equal(c.injection.reason,s.reason);
}
export function collectFailureCapture(c){
 const key=c.combo+'|'+c.state;let equalityPassed=true,rawDifference=null;
 try{assertFailureCapture(c);}catch(error){
  if(!isExactPendingTitleError(error,c))throw error;
  equalityPassed=false;rawDifference={name:error.name,code:error.code,message:error.message,actual:error.actual,expected:error.expected,operator:error.operator,generatedMessage:error.generatedMessage,stack:error.stack};
  assertOriginalCaptureRemainder(c);
 }
 return{key,status:'user-title-decision-pending',finalCriterionPassed:false,originalEqualityPassed:equalityPassed,actual:c.browserSnapshot.tabs.find(x=>x.id===c.pageId).title,expectedByOriginal:c.native.title,rawDifference,postTitleNativeIdentityChecked:true,otherOriginalCaptureChecksCompleted:true,originalAssertionUnchanged:true,noAlternateExpectedTitleChosen:true};
}
