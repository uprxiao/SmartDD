const describe=error=>String(error?.stack??error);
export async function recordCleanupStep({r,label,work,persist}){
 const row={label,at:new Date().toISOString()};r.cleanupSteps.push(row);
 try{row.value=await work();row.status='fulfilled';return row.value;}
 catch(error){row.status='failed';row.error=describe(error);r.cleanupErrors.push(row);return undefined;}
 finally{try{await persist();}catch(error){(r.recordingErrors??=[]).push({label:'persist-after-'+label,error:describe(error)});}}
}
export async function finishWithRaw({r,work,settle,persist,writeRaw}){
 try{await work();}
 catch(error){(r.finalizerErrors??=[]).push({label:'unhandled-app-finalizer',error:describe(error)});}
 finally{
  try{await settle();}
  catch(error){(r.finalizerErrors??=[]).push({label:'unhandled-resource-finalizer',error:describe(error)});}
  finally{
   r.finishedAt=new Date().toISOString();
   try{await persist();}catch(error){(r.recordingErrors??=[]).push({label:'final-persist',error:describe(error)});}
   finally{await writeRaw(r);}
  }
 }
}
