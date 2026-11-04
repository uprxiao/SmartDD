const {app, BrowserWindow, session} = require('electron');
const {writeFileSync} = require('node:fs');
const {createHash} = require('node:crypto');
const {createServer} = require('node:http');
const assert = require('node:assert/strict');
const root = '/private/tmp/willyou-m12-p063-prompt-probe-004';
const raw = {at: new Date().toISOString(), kind: 'native-prompt-callback-feasibility-not-formal-case', pid: process.pid, dialogs: [], cdp: [], errors: [], requests: [], versions: process.versions};
const save = () => writeFileSync(root + '/raw.json', JSON.stringify(raw, null, 2) + '\n');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const poll = async fn => {const end = Date.now() + 5000; do {const value = await fn(); if(value) return value; await pause(20);} while(Date.now() < end); throw Error('Bounded probe condition timed out');};
app.setActivationPolicy('prohibited');app.setPath('userData', root + '/userdata');app.setPath('logs', root + '/logs');
let window, ses, registration, original, wrapped, server, watchdog;
const pending = [];
const evaluate = source => {new Function(source);return window.webContents.executeJavaScript(source);};
app.on('web-contents-created', (_event, wc) => {wc.on('preload-error', (_event, path, error) => {raw.errors.push({path,error:String(error)});save();});});
app.on('will-quit', () => {raw.willQuit = {windows: BrowserWindow.getAllWindows().length};save();});
app.on('quit', (_event, code) => {raw.quitCode = code;save();});
watchdog = setTimeout(() => {raw.timeout = true;save();app.exit(7);}, 18000);
void app.whenReady().then(async () => {
 try {
  ses = session.fromPartition('persist:m12-p063-native-prompt-probe');
  registration = ses.registerPreloadScript({type:'frame',filePath:root+'/preload.cjs'});
  window = new BrowserWindow({show:false,title:'[I] M12-P063 native prompt callback probe',webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await window.loadURL('about:blank');raw.initialBlankLoaded=true;save();
  const wc = window.webContents, handlers = wc.listeners('-run-dialog');
  const send = async(method,params={},sessionId)=>{(raw.cdpStages??=[]).push({atMs:Date.now(),method,sessionId:sessionId??null});save();let timer;try{return await Promise.race([sessionId?wc.debugger.sendCommand(method,params,sessionId):wc.debugger.sendCommand(method,params),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('CDP initialization/command timed out: '+method)),3000);})]);}finally{clearTimeout(timer);}};
  assert.equal(handlers.length,1,'Pinned Electron must have exactly one default dialog handler');original = handlers[0];
  const originalSource = Function.prototype.toString.call(original);
  assert(originalSource.includes('prompt'),'Pinned dialog handler contract changed');
  raw.internalHandler = {count:handlers.length,arity:original.length,sha256:createHash('sha256').update(originalSource).digest('hex')};
  wrapped = function(info, callback) {
   if(info?.dialogType !== 'prompt')return Reflect.apply(original,wc,[info,callback]);
   raw.dialogs.push({atMs:Date.now(),type:info.dialogType,message:info.messageText,initial:info.defaultPromptText??info.defaultPrompt??null,frameUrl:info.frame.url,origin:info.frame.origin});pending.push(callback);save();
  };
  wc.removeListener('-run-dialog',original);wc.on('-run-dialog',wrapped);
  wc.debugger.attach('1.3');
  wc.debugger.on('message', (_event,method,params,sessionId) => {
   if(method==='Target.attachedToTarget') {
    raw.cdp.push({method,params,sessionId});
    void(async()=>{if(params.targetInfo?.type==='iframe')await send('Page.enable',{},params.sessionId);await send('Runtime.runIfWaitingForDebugger',{},params.sessionId);})().catch(error=>{raw.errors.push({method,error:String(error)});save();});
   }
   if(method==='Runtime.exceptionThrown'){raw.errors.push({method,params,sessionId});save();}
   if(method==='Page.javascriptDialogOpening'||method==='Page.javascriptDialogClosed') {
    raw.cdp.push({atMs:Date.now(),method,params,sessionId:sessionId??null});if(method==='Page.javascriptDialogClosed')pending.shift();save();
   }
  });
  await send('Page.enable');await send('Runtime.enable');await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true});
  const childSource = label => '<!doctype html><script>parent.postMessage({p063:{label:'+JSON.stringify(label)+',value:prompt('+JSON.stringify(label)+',"child-initial"),process:typeof process,require:typeof require}},"*")</script>';
  const mainHtml = '<title>P063 Native prompt</title><script>window.values=[];window.unsafe={process:typeof process,require:typeof require};addEventListener("message",e=>{if(e.data.p063)values.push(e.data.p063)})</script>';
  server = createServer((request,response)=>{raw.requests.push({url:request.url,atMs:Date.now()});response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end(request.url==='/main'?mainHtml:childSource('cross-http'));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});raw.httpPort = server.address().port;
  raw.mainUrl = 'http://localhost:'+raw.httpPort+'/main';await window.loadURL(raw.mainUrl);
  async function handle(label,accept) {
   const event = await poll(()=>raw.cdp.find(x=>x.method==='Page.javascriptDialogOpening'&&x.params.message===label));
   await poll(()=>raw.dialogs.some(x=>x.message===label));assert(pending.length>0);
   const params = {accept,...(accept?{promptText:'accepted-中文'}:{})};
   const result = event.sessionId ? await send('Page.handleJavaScriptDialog',params,event.sessionId) : await send('Page.handleJavaScriptDialog',params);
   (raw.handled??=[]).push({label,params,result,mechanism:'actual Page.handleJavaScriptDialog; no scripted host callback response'});save();
  }
  for(const label of ['accept','dismiss']) {
   await evaluate('setTimeout(()=>values.push({label:'+JSON.stringify(label)+',value:prompt('+JSON.stringify(label)+',"初始")}),0);"armed"');await handle(label,label==='accept');await poll(()=>evaluate('values.length').then(n=>n===(label==='accept'?1:2)));
  }
  await evaluate('const a=document.createElement("iframe");a.srcdoc='+JSON.stringify(childSource('srcdoc'))+';document.body.appendChild(a);"armed"');await handle('srcdoc',true);await poll(()=>evaluate('values.length').then(n=>n===3));
  await evaluate('const b=document.createElement("iframe");b.src='+JSON.stringify('http://127.0.0.1:')+'+'+raw.httpPort+'+"/child";document.body.appendChild(b);"armed"');await handle('cross-http',true);await poll(()=>evaluate('values.length').then(n=>n===4));
  raw.result = await evaluate('({values,unsafe})');const prefs = wc.getLastWebPreferences();raw.security = {sandbox:prefs.sandbox,contextIsolation:prefs.contextIsolation,nodeIntegration:prefs.nodeIntegration,nodeIntegrationInSubFrames:prefs.nodeIntegrationInSubFrames===true};
  raw.status='executed-unjudged';
 } catch(error) {raw.status='failed-or-partial';raw.error=String(error.stack||error);}
 finally {
  raw.metricsBeforeCleanup=app.getAppMetrics().map(value=>({pid:value.pid,type:value.type}));save();
  for(const callback of pending.splice(0))try{callback(false,'');}catch(error){raw.errors.push({cleanupCallback:String(error)});}
  if(window&&!window.isDestroyed()){const wc=window.webContents;if(wrapped){wc.removeListener('-run-dialog',wrapped);wc.on('-run-dialog',original);raw.defaultListenerRestored=wc.listeners('-run-dialog').length===1&&wc.listeners('-run-dialog')[0]===original;}if(wc.debugger.isAttached())wc.debugger.detach();window.destroy();}
  if(registration)ses.unregisterPreloadScript(registration);if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));raw.serverClosed=true;}clearTimeout(watchdog);save();app.quit();
 }
});
