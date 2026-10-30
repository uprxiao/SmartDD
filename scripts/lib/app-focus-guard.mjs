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
export function installAppFocusGuard(app,record,{enabled=true}={}) {
  if(!enabled)return;
  const cdp=app.cdp.bind(app);let yielded;
  record.focusGuard={enabled:true,appPid:app.processId,checkedInputs:0};record.focusGuards??=[];record.focusGuards.push(record.focusGuard);
  app.cdp=async(method,...args)=>{
    if(method.startsWith('Input.')||method==='Page.bringToFront'){
      if(yielded)throw yielded;
      const state=await app.evaluate('({focused:document.hasFocus(),visibility:document.visibilityState,title:document.title})');
      if(!state?.focused||state.visibility!=='visible'){
        yielded=Object.assign(new Error('This isolated App lost focus; yield the M10 UI batch for the other test.'),{code:'APP_FOCUS_YIELDED'});
        Object.assign(record.focusGuard,{yieldedAt:new Date().toISOString(),blockedMethod:method,state});throw yielded;
      }
      record.focusGuard.checkedInputs++;
    }
    return cdp(method,...args);
  };
}
