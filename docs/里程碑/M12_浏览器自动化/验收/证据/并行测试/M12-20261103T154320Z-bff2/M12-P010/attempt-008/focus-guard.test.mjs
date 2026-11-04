import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installAppFocusGuard} from '../lib/app-focus-guard.mjs';
function fixture(documentFocused,nativeFocused){let delivered=0;const state={documentFocused,nativeFocused},app={processId:123,evaluate:async()=>({focused:state.documentFocused,visibility:'visible'}),mainEvaluate:async()=>state.nativeFocused,cdp:async()=>{delivered++;}};const record={};installAppFocusGuard(app,record,{allowOwnedViews:true});return{app,state,record,delivered:()=>delivered};}
test('a stale document-focus value cannot authorize input after the native App loses focus',async()=>{
  const f=fixture(true,false);await assert.rejects(()=>f.app.cdp('Input.insertText',{text:'must not send'}),{code:'APP_FOCUS_YIELDED'});assert.equal(f.delivered(),0);f.state.nativeFocused=true;await assert.rejects(()=>f.app.cdp('Input.insertText',{text:'must not replay'}),{code:'APP_FOCUS_YIELDED'});assert.equal(f.delivered(),0);assert(f.record.focusGuard.yieldedAt);
});
test('a focused owned native page may receive input while the main document is unfocused',async()=>{
  const f=fixture(false,true);await f.app.cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter'});assert.equal(f.delivered(),1);assert.equal(f.record.focusGuard.checkedInputs,1);
});
