// Acceptance-only guard. Yield this batch when its own window loses focus;
// never bring it back in front of another terminal's test automatically.
import assert from 'node:assert/strict';
export const isAppFocusYield = error => error?.code === 'APP_FOCUS_YIELDED';
// Opt-in only after the user confirms availability. Wait for their activation;
// never activate the window here or rearm an already-yielded input guard.
export async function waitForInitialAppFocus(app,record,{userData,timeoutMs=180000}={}){
  assert(typeof userData==='string'&&userData.startsWith('/private/tmp/willyou-m10-')&&/\/(?:userdata|light|dark)$/.test(userData));
  assert(Number.isInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=180000);
  assert(record.focusGuard?.enabled&&record.focusGuard.appPid===app.processId&&record.focusGuard.checkedInputs===0&&!record.focusGuard.yieldedAt,'Initial focus wait cannot resume a used or yielded guard');
  assert(await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');return E.app.getPath('userData')===${JSON.stringify(userData)}})()`,{label:'verify-own-initial-focus-wait'}),'Only this isolated instance may wait');
  const wait=record.initialFocusWait={status:'waiting-for-user-focus',appPid:app.processId,userData,startedAt:new Date().toISOString(),timeoutMs};
  console.log(JSON.stringify({root:userData.replace(/\/(?:userdata|light|dark)$/,''),initialFocusWait:wait}));
  try{
    await app.waitFor('document.hasFocus()&&document.visibilityState==="visible"',timeoutMs);
    wait.status='focused';
  }catch(error){wait.status='not-focused';throw error;}
  finally{wait.finishedAt=new Date().toISOString();}
}
export function installAppFocusGuard(app,record,{enabled=true,allowOwnedViews=false,onYield}={}) {
  if(!enabled)return;
  const cdp=app.cdp.bind(app);let yielded;
  record.focusGuard={enabled:true,appPid:app.processId,checkedInputs:0};record.focusGuards??=[];record.focusGuards.push(record.focusGuard);
  const check=async(method)=>{
      if(yielded)throw yielded;
      const state=await app.evaluate('({focused:document.hasFocus(),visibility:document.visibilityState,title:document.title})');
      if(allowOwnedViews&&state?.visibility==='visible'){
        // A WebContentsView takes document focus while its same-process native
        // window stays focused. An external App still makes this check false.
        state.ownedWindowFocused=await app.mainEvaluate("(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');return E.BaseWindow.getAllWindows().some(w=>!w.isDestroyed()&&w.isFocused())})()",{label:"readonly-owned-input-focus"});
      }
      const focused=allowOwnedViews?state?.ownedWindowFocused:state?.focused;
      if(!focused||state.visibility!=='visible'){
        yielded=Object.assign(new Error('This isolated App lost focus; yield the M10 UI batch for the other test.'),{code:'APP_FOCUS_YIELDED'});
        Object.assign(record.focusGuard,{yieldedAt:new Date().toISOString(),blockedMethod:method,state});
        // Sticky refusal is set before diagnostic reads. Later inputs immediately throw the same original error.
        if(onYield){record.focusGuard.yieldObserverStartedAt=new Date().toISOString();try{await onYield({method,state,guard:record.focusGuard,errorCode:yielded.code});}catch(observerError){record.focusGuard.yieldObserverError={name:observerError.name,message:observerError.message,code:observerError.code??null};}record.focusGuard.yieldObserverFinishedAt=new Date().toISOString();}
        throw yielded;
      }
      record.focusGuard.checkedInputs++;
  };
  app.checkInputFocus=check;
  app.cdp=async(method,...args)=>{
    if(method.startsWith('Input.')||method==='Page.bringToFront')await check(method);
    return cdp(method,...args);
  };
}
