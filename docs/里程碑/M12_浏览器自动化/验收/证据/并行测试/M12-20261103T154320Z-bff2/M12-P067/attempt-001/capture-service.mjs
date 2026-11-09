import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import WebSocket from'ws';
export async function captureService(app,{userData,taskId,sourcePath,trigger}){
 const source=await readFile(sourcePath,'utf8'),needle='async execute(scope, command, args)',at=source.indexOf(needle,source.indexOf('class BrowserService'));
 assert(at>0);const lineNumber=source.slice(0,source.indexOf('\n',at)+1).split('\n').length-1;
 const url=/Debugger listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/.exec(app.logs())?.[1];assert(url);
 const socket=new WebSocket(url),pending=new Map(),events=[],scripts=[];let next=0,paused=null,breakpoint=null,resumed=false,closed=false;
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('Narrow inspector timeout:'+method));},8000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 socket.on('message',data=>{const m=JSON.parse(String(data));if(m.id){const q=pending.get(m.id);if(!q)return;pending.delete(m.id);clearTimeout(q.timer);m.error?q.reject(Error(JSON.stringify(m.error))):q.resolve(m.result);return;}if(m.method==='Debugger.scriptParsed')scripts.push(m.params);if(m.method==='Debugger.paused')paused=m.params;events.push({method:m.method,atMs:Date.now(),reason:m.params?.reason??null});});
 await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)});
 try{
  await send('Debugger.enable');const script=scripts.find(x=>x.url.endsWith('/app.asar/out/main/index.js'));assert(script,'Exact packaged main script required');
  const installedAtMs=Date.now();const bp=await send('Debugger.setBreakpointByUrl',{url:script.url,lineNumber,condition:"command === 'tab list' && scope.taskId === "+JSON.stringify(taskId)});breakpoint=bp.breakpointId;assert(bp.locations.length>0,'Narrow breakpoint must resolve before triggering readonly CLI');
  const command=trigger();let completed=false;void command.finally(()=>completed=true).catch(()=>{});
  const end=Date.now()+10000;while(!paused&&Date.now()<end){assert(!completed,'Readonly trigger completed without expected narrow breakpoint');await new Promise(r=>setTimeout(r,15));}
  assert(paused,'Readonly precondition breakpoint missing');const frame=paused.callFrames.find(x=>x.functionName==='execute');assert(frame);
  const expression="(()=>{const service=this;if(service.options.userData!=="+JSON.stringify(userData)+")throw Error('Own service only');if(globalThis.__P067ReadOnly)throw Error('Fresh observer only');globalThis.__P067ReadOnly={snapshot:()=>({atMs:Date.now(),queue:service.pages.all().map(p=>({id:p.id,taskId:p.taskId,contentsId:p.contents.id,url:p.contents.getURL(),pending:p.queue.pending.size,helperActivePid:p.helper.active?.pid??null,helperDaemonPid:p.helper.daemon?.pid??null,proxyPort:Number(new URL(p.proxy.discoveryEndpoint).port)})),readWaits:[...service.readWaits].map(([taskId,set])=>({taskId,size:set.size})),access:service.accessState(),automation:[...service.automation.activities].map(([pageId,v])=>({pageId,taskId:v.taskId,running:v.running.size,endedAt:v.endedAt,deadlineMs:v.endedAt+20000}))}),restore:()=>{delete globalThis.__P067ReadOnly;return true;}};return {captured:true,taskId:scope.taskId,command,readOnly:true}})()";
  new Function(expression);const captured=await send('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression,returnByValue:true});assert(!captured.exceptionDetails);assert.equal(captured.result.value.captured,true);
  await send('Debugger.removeBreakpoint',{breakpointId:breakpoint});breakpoint=null;await send('Debugger.resume');resumed=true;await send('Debugger.disable');
  const result=await command;return{installedAtMs,resumedAtMs:Date.now(),scriptUrl:script.url,lineNumber,captured:captured.result.value,events,result,breakpointRemoved:true,debuggerDisabled:true,narrowConnectionClosed:true,boundary:'One readonly tab list before queue/pause/timing; capture this to private readonly snapshots, no service mutation; breakpoint removed before resume'};
 }finally{
  if(breakpoint)try{await send('Debugger.removeBreakpoint',{breakpointId:breakpoint})}catch{}
  if(paused&&!resumed)try{await send('Debugger.resume')}catch{}
  try{await send('Debugger.disable')}catch{}
  socket.close();closed=true;for(const q of pending.values()){clearTimeout(q.timer);q.reject(Error('Inspector closed'))}pending.clear();
 }
}
