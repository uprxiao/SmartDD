// Diagnostic only: false conditional function breakpoint, no renderer pause,
// argument/result/authorization replacement or business state writes.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function traceTaskOpenLogpoint(app,root){
 const tag='M10_OPEN_LOG_'+randomUUID(),record={schema:'m10-open-logpoint-v1',scope:'Owned renderer original invoke;false condition logs caller without pausing;timing overhead recorded',calls:[],driverCalls:[],paused:0,errors:[]};
 const originalInvoke=app.invoke;let breakpoint,offConsole,offPause;
 const save=()=>writeFile(join(root,'open-logpoint.json'),JSON.stringify(record,null,2)+'\n');
 try{
  await app.cdp('Runtime.enable');await app.cdp('Debugger.enable');
  offConsole=app.onCDP('Runtime.consoleAPICalled',e=>{if(e.args?.[0]?.value!==tag)return;try{const value=JSON.parse(e.args[1]?.value);record.calls.push({...value,frames:e.stackTrace?.callFrames??[]});}catch(error){record.errors.push(String(error));}});
  offPause=app.onCDP('Debugger.paused',()=>record.paused++);
  const fn=await app.cdp('Runtime.evaluate',{expression:'window.electronAPI.invoke',returnByValue:false});assert(fn.result.objectId);
  const condition='arguments[0]==="tasks.open"&&(()=>{console.debug('+JSON.stringify(tag)+',JSON.stringify({at:Date.now(),channel:arguments[0],args:Array.from(arguments).slice(1),stack:String(new Error().stack)}));return false;})()';
  breakpoint=(await app.cdp('Debugger.setBreakpointOnFunctionCall',{objectId:fn.result.objectId,condition})).breakpointId;
  app.invoke=(channel,...args)=>{if(channel==='tasks.open')record.driverCalls.push({at:Date.now(),args,stack:new Error().stack});return originalInvoke(channel,...args);};
  const missing='m10-logpoint-control-'+randomUUID();
  await assert.rejects(app.invoke('tasks.open',{taskId:missing,cols:80,rows:24}),/任务不存在或已被删除/);
  const until=Date.now()+3000;while(!record.calls.length&&Date.now()<until)await new Promise(r=>setTimeout(r,25));
  assert.equal(record.calls.length,1);assert.equal(record.calls[0].args[0].taskId,missing);assert.equal(record.paused,0);record.control={taskId:missing,originalRejection:true,records:1};record.status='installed';await save();
 }catch(error){app.invoke=originalInvoke;offConsole?.();offPause?.();if(breakpoint)await app.cdp('Debugger.removeBreakpoint',{breakpointId:breakpoint});await app.cdp('Debugger.disable');record.status='install-failed';record.errors.push(String(error));await save();throw error;}
 return{record,async close(){app.invoke=originalInvoke;await app.cdp('Debugger.removeBreakpoint',{breakpointId:breakpoint});offConsole?.();offPause?.();await app.cdp('Debugger.disable');assert.equal(record.paused,0);assert.deepEqual(record.errors,[]);record.status='closed';record.finishedAt=new Date().toISOString();await save();return record;}};
}
