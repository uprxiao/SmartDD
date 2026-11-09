// Exact self-owned harness only. No PID lookup/kill substitute, UI input or focus change.
export async function settleOwnedApp({app,requestNormalQuit,writePrivateLogs,onError}){
 const record={normalQuitRequested:false,normalWaitExit:null,normalExitConfirmed:false,finalWaitExit:null,observedProcess:null,steps:[]};
 const step=async(label,fn)=>{const row={label,at:new Date().toISOString()};record.steps.push(row);try{const value=await fn();row.ok=true;return{ok:true,value};}catch(error){row.ok=false;try{await onError(label,error);}catch(sinkError){row.privateErrorSinkFailed=true;row.privateErrorSinkName=sinkError.name;}return{ok:false};}};
 try{
  const request=await step('request-own-normal-quit',requestNormalQuit);record.normalQuitRequested=request.ok;
  if(request.ok){const waited=await step('wait-own-normal-exit',()=>app.waitForExit(45000));if(waited.ok)record.normalWaitExit=waited.value;}
 }finally{
  await step('save-own-private-app-logs',writePrivateLogs);
  try{
   // Frozen harness.close targets its original ChildProcess and records SIGTERM,
   // then (only if still alive after3s) SIGKILL. No claim that these are normal exit.
   await step('close-exact-owned-harness',()=>app.close());
   const final=await step('wait-final-owned-process-exit',()=>app.waitForExit(10000));if(final.ok)record.finalWaitExit=final.value;
  }finally{
   const observed=await step('capture-final-owned-process-observation',()=>app.observedProcess());if(observed.ok)record.observedProcess=observed.value;
  }
 }
 record.normalExitConfirmed=record.normalWaitExit?.code===0&&record.normalWaitExit?.signal===null&&Array.isArray(record.observedProcess?.signals)&&record.observedProcess.signals.length===0;
 return record;
}
