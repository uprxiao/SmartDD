// Acceptance-only guard. Yield this batch when its own window loses focus;
// never bring it back in front of another terminal's test automatically.
export const isAppFocusYield = error => error?.code === 'APP_FOCUS_YIELDED';
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
