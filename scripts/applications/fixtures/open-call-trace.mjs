// Own renderer only. Conditional function breakpoint records the original caller;
// no IPC arguments, authorization or business return values are changed.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function traceTaskOpenCalls(app,root){
 const record={status:'installing',fixtureSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),scope:'Own renderer conditional breakpoint;pauses original tasks.open call only;diagnostic timing change;0argument/auth/return replacement',calls:[],driverCalls:[],errors:[]};
 let breakpoint,off,queue=Promise.resolve(),originalInvoke=app.invoke;
 const save=()=>writeFile(join(root,'nl-open-call-trace.json'),JSON.stringify(record,null,2));
 try{
  await app.cdp('Debugger.enable');await app.cdp('Debugger.setAsyncCallStackDepth',{maxDepth:8});
  const fn=await app.cdp('Runtime.evaluate',{expression:'window.electronAPI.invoke',returnByValue:false});assert(fn.result.type==='function'&&fn.result.objectId);
  const target=await app.cdp('Debugger.setBreakpointOnFunctionCall',{objectId:fn.result.objectId,condition:'arguments[0] === "tasks.open"'});breakpoint=target.breakpointId;
  off=app.onCDP('Debugger.paused',pause=>{
   queue=queue.then(async()=>{
    try{
     const matched=pause.hitBreakpoints?.includes(breakpoint),frames=pause.callFrames.map(f=>({functionName:f.functionName,url:f.url,scriptId:f.location.scriptId,lineNumber:f.location.lineNumber,columnNumber:f.location.columnNumber}));
     const row={at:new Date().toISOString(),reason:pause.reason,matched,frames,asyncStack:pause.asyncStackTrace??null};
     if(matched&&pause.callFrames[0]){
      const frame=pause.callFrames[0],source=await app.cdp('Debugger.getScriptSource',{scriptId:frame.location.scriptId}),bytes=source.scriptSource;
      row.callerSource={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:Buffer.byteLength(bytes),url:frame.url,lineNumber:frame.location.lineNumber,columnNumber:frame.location.columnNumber};
      const own=/^window\.electronAPI\.invoke\("tasks\.open", \.\.\.(\[.*\])\)$/.exec(bytes);
      if(own)row.callerSource.driverEvaluationRequest=JSON.parse(own[1]);
      else row.callerSource.boundary='Non-driver script identified by original frame/location/hash only;no fabricated arguments or unrelated source export';
     }
     record.calls.push(row);
    }catch(error){record.errors.push(String(error));}
    finally{try{await app.cdp('Debugger.resume');}catch(error){record.errors.push('resume:'+String(error));}await save();}
   });
  });
  app.invoke=(channel,...args)=>{if(channel==='tasks.open')record.driverCalls.push({at:new Date().toISOString(),channel,args,stack:new Error().stack});return originalInvoke(channel,...args);};
  record.status='installed-original-function-breakpoint';await save();
 }catch(error){record.status='install-failed';record.errors.push(String(error));await save();app.invoke=originalInvoke;off?.();try{await app.cdp('Debugger.disable');}catch{}throw error;}
 return{record,async close(){
  app.invoke=originalInvoke;await queue;if(breakpoint)await app.cdp('Debugger.removeBreakpoint',{breakpointId:breakpoint});off?.();await app.cdp('Debugger.setAsyncCallStackDepth',{maxDepth:0});await app.cdp('Debugger.disable');record.status='closed';record.finishedAt=new Date().toISOString();await save();return record;
 }};
}
