// Cleanup/error persistence orchestration. Injected file functions make failure controls pure.
export function cleanupLedger({record,save,writePrivateLog,now=()=>new Date().toISOString()}){record.cleanupSteps??=[];record.cleanupErrors??=[];record.persistenceErrors??=[];
 const note=(label,error)=>{record.persistenceErrors.push({at:now(),label,errorType:error?.name??'Error'});};
 const snapshot=async label=>{for(const path of['raw.private.json','live.json'])try{await save(path,{...record,stage:'cleanup:'+label});}catch(error){note(path+':'+label,error);}};
 const step=async(label,fn)=>{const row={label,at:now()};record.cleanupSteps.push(row);try{row.value=await fn();row.status='fulfilled';return row.value;}catch(error){row.status='failed';row.errorType=error?.name??'Error';record.cleanupErrors.push(row);try{await writePrivateLog(label,String(error?.stack??error));}catch(logError){note('private-log:'+label,logError);}return undefined;}finally{await snapshot(label);}};
 const finish=async cleanupValue=>{await snapshot('terminal-before-cleanup-record');try{await save('runtime-001/cleanup.actual.json',cleanupValue());}catch(error){note('cleanup-actual',error);}finally{await snapshot('terminal-final');}};
 return{step,snapshot,finish,note};}
