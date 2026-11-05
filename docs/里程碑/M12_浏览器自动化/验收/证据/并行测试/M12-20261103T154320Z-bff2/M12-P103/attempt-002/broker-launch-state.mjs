// Pure decision logic. No App, process, API, filesystem, or timer calls.
export function brokerLaunchState(events,exit){
 const launched=events.find(x=>x.kind==='launched');if(launched)return{kind:'launched',event:launched};
 const launchError=events.find(x=>x.kind==='launch-error');if(launchError)return{kind:'launch-error',terminal:true,noLaunchProven:false,cleanupUnresolved:false};
 if(exit){
  // In the pinned broker source return3 is exclusively before NSApplication/NSWorkspace.
  const beforeGuard=exit.code===3&&exit.signal===null&&events.length===0;
  return {kind:beforeGuard?'prelaunch-exact-root-guard-exit':'broker-terminal-without-launch-callback',terminal:true,noLaunchProven:beforeGuard,beforeNSWorkspace:beforeGuard,cleanupUnresolved:!beforeGuard,brokerCode:exit.code,brokerSignal:exit.signal};
 }
 return {kind:'pending-callback',terminal:false,noLaunchProven:false,cleanupUnresolved:false};
}
