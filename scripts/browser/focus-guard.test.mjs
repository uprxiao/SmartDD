import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installAppFocusGuard} from '../lib/app-focus-guard.mjs';
import {focusNewInstalledWindow} from '../applications/fixtures/dmg-install-ui.mjs';
function fixture(documentFocused,nativeFocused){let delivered=0;const state={documentFocused,nativeFocused},app={processId:123,evaluate:async()=>({focused:state.documentFocused,visibility:'visible'}),mainEvaluate:async()=>state.nativeFocused,cdp:async()=>{delivered++;}};const record={};installAppFocusGuard(app,record,{allowOwnedViews:true});return{app,state,record,delivered:()=>delivered};}
test('a stale document-focus value cannot authorize input after the native App loses focus',async()=>{
  const f=fixture(true,false);await assert.rejects(()=>f.app.cdp('Input.insertText',{text:'must not send'}),{code:'APP_FOCUS_YIELDED'});assert.equal(f.delivered(),0);f.state.nativeFocused=true;await assert.rejects(()=>f.app.cdp('Input.insertText',{text:'must not replay'}),{code:'APP_FOCUS_YIELDED'});assert.equal(f.delivered(),0);assert(f.record.focusGuard.yieldedAt);
});
test('a focused owned native page may receive input while the main document is unfocused',async()=>{
  const f=fixture(false,true);await f.app.cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter'});assert.equal(f.delivered(),1);assert.equal(f.record.focusGuard.checkedInputs,1);
});
test('initial activation checks native focus even when the renderer already reports focus',async()=>{
  let native=false,requested=0;const codes=[],app={processId:456,evaluate:async()=>({focused:true,visibility:'visible'}),mainEvaluate:async code=>{codes.push(code);if(code.includes('windows[0].show()')){requested++;native=true;return true;}return native;}},record={};
  await focusNewInstalledWindow(app,'/private/tmp/willyou-m12-initial-focus-test/userdata',record);assert.equal(requested,1);assert.equal(record.installationInitialFocus[0].before.nativeWindowFocused,false);assert.equal(record.installationInitialFocus[0].after.nativeWindowFocused,true);assert(codes.every(code=>!code.includes('steal:true')));
});
test('initial renderer-only focus times out without granting input or repeating activation',async t=>{
  let ticks=0,requested=0;t.mock.method(Date,'now',()=>ticks++*5000);const app={processId:456,evaluate:async()=>({focused:true,visibility:'visible'}),mainEvaluate:async code=>{if(code.includes('windows[0].show()')){requested++;return true;}return false;}},record={};
  await assert.rejects(()=>focusNewInstalledWindow(app,'/private/tmp/willyou-m12-initial-focus-test/userdata',record),{code:'APP_FOCUS_YIELDED'});assert.equal(requested,1);assert.equal(record.installationInitialFocus[0].after.nativeWindowFocused,false);
});
