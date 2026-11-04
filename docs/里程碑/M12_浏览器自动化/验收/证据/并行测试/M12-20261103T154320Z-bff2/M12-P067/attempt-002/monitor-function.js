function installP059Monitor(E, options) {
  const fs = process.getBuiltinModule('fs');
  const assert = process.getBuiltinModule('assert/strict');
  assert.equal(E.app.getPath('userData'), options.userData);
  assert(!globalThis.__P059Monitor, 'Fresh monitor only');
  const installedAtMs = Date.now(), restores = [], wcSeen = new Set(), windowsSeen = new Map();
  let sequence = 0, writesFailed = 0, quitting = false, timer;
  const log = (kind, value = {}) => {
    try { fs.appendFileSync(options.path, JSON.stringify({sequence: ++sequence, atMs:Date.now(), kind, quitting, ...value})+'\n', {mode:0o600}); }
    catch { writesFailed++; }
  };
  const safe = fn => { try { return fn(); } catch(error) { return {observationError:String(error)}; } };
  const wcState = w => ({id:w.id, destroyed:w.isDestroyed(), ...safe(()=>({url:w.getURL(), type:w.getType(), osPid:w.getOSProcessId(), debuggerAttached:w.debugger.isAttached(), sessionPath:w.session.storagePath??null}))});
  const windowState = w => ({id:w.id, destroyed:w.isDestroyed(), ...safe(()=>({visible:w.isVisible(), focused:w.isFocused(), opacity:w.getOpacity(), bounds:w.getBounds(), children:w.contentView.children.map(v=>({webContentsId:v.webContents?.id??null,bounds:v.getBounds()}))}))});
  const snapshot = () => ({atMs:Date.now(), quitting, sequence, writesFailed, contents:E.webContents.getAllWebContents().map(wcState), windows:E.BaseWindow.getAllWindows().map(windowState), metrics:safe(()=>E.app.getAppMetrics().map(x=>({pid:x.pid,type:x.type})))});
  const listen = (emitter, name, fn) => { const observer=(...args)=>safe(()=>fn(...args)); emitter.on(name,observer); restores.push(()=>emitter.removeListener(name,observer)); };
  function observeContents(w, source, stack) {
    if(wcSeen.has(w.id)) return; wcSeen.add(w.id);
    const id = w.id;
    log('web-contents-observed', {source, state:wcState(w), creationStack:stack??null});
    for(const name of ['will-destroy','destroyed','did-start-loading','did-stop-loading','dom-ready','did-finish-load'])
      listen(w,name,()=>log('web-contents-event',{id,event:name,state:wcState(w)}));
    listen(w,'did-start-navigation',(_event,url,inPlace,isMainFrame)=>log('web-contents-navigation',{id,event:'did-start-navigation',url,inPlace,isMainFrame}));
    listen(w,'did-navigate',(_event,url,httpResponseCode)=>log('web-contents-navigation',{id,event:'did-navigate',url,httpResponseCode}));
    listen(w,'render-process-gone',(_event,details)=>log('web-contents-event',{id,event:'render-process-gone',details}));
    const original = w.send;
    function observedSend(...args) {
      if(args[0]==='files:close-request')log('file-close-request',{webContentsId:id,channel:args[0],request:{id:args[1]?.id,action:args[1]?.action}});
      return Reflect.apply(original,this,args);
    }
    w.send = observedSend;
    restores.push(()=>{if(!w.isDestroyed()&&w.send===observedSend)w.send=original;});
  }
  listen(E.app,'web-contents-created',(_event,w)=>observeContents(w,'actual-web-contents-created',new Error('P059 synchronous native WC creation stack').stack));
  for(const w of E.webContents.getAllWebContents())observeContents(w,'existing-at-install',null);
  listen(E.app,'browser-window-created',(_event,w)=>{
    log('browser-window-created',{state:windowState(w),creationStack:new Error('P059 synchronous BrowserWindow creation stack').stack});
    listen(w,'close',event=>log('window-close',{id:w.id,defaultPrevented:event.defaultPrevented,state:windowState(w)}));
    listen(w,'closed',()=>log('window-closed',{id:w.id}));
  });
  for(const w of E.BrowserWindow.getAllWindows()){
    listen(w,'close',event=>log('window-close',{id:w.id,defaultPrevented:event.defaultPrevented,state:windowState(w)}));
    listen(w,'closed',()=>log('window-closed',{id:w.id}));
  }
  for(const name of ['before-quit','will-quit','quit'])listen(E.app,name,(event,exitCode)=>{
    if(name==='before-quit')quitting=true;
    log('app-lifecycle',{event:name,defaultPrevented:event?.defaultPrevented??null,exitCode:exitCode??null,snapshot:snapshot()});
  });
  listen(process,'exit',code=>log('process-exit',{code}));
  // Electron internal registry is observed only when present. The original handler
  // still receives the untouched Electron event; original Promise/value/throw is returned.
  const handlers=E.ipcMain._invokeHandlers;
  let rpcObservation='unavailable';
  if(handlers instanceof Map&&typeof handlers.get('files.answerClose')==='function'){
    const original=handlers.get('files.answerClose');
    function wrapped(event,...args){
      const reply=args[0];
      log('file-close-answer-called',{channel:'files.answerClose',senderId:event.sender.id,frame:safe(()=>({processId:event.senderFrame.processId,routingId:event.senderFrame.routingId})),reply:{id:reply?.id,ready:reply?.ready,failures:Array.isArray(reply?.failures)?reply.failures.map(x=>({name:x.name,message:x.message})):null}});
      let value;
      try{value=Reflect.apply(original,this,[event,...args]);}catch(error){log('file-close-answer-return',{replyId:reply?.id,state:'threw',error:String(error)});throw error;}
      if(value&&typeof value.then==='function')value.then(()=>log('file-close-answer-return',{replyId:reply?.id,state:'resolved'}),error=>log('file-close-answer-return',{replyId:reply?.id,state:'rejected',error:String(error)}));
      else log('file-close-answer-return',{replyId:reply?.id,state:'returned',valueType:typeof value});
      return value;
    }
    handlers.set('files.answerClose',wrapped);
    restores.push(()=>{if(handlers.get('files.answerClose')===wrapped)handlers.set('files.answerClose',original);});
    rpcObservation='delegating-original-handler-via-Electron-private-map';
  }
  function poll(){
    const current=new Map();
    for(const w of E.BaseWindow.getAllWindows()){
      const state=windowState(w),serialized=JSON.stringify(state);current.set(w.id,serialized);
      if(!windowsSeen.has(w.id))log('base-window-first-seen',{state,pollingBoundary:'First observed by 100ms inventory; not actual constructor event'});
      else if(windowsSeen.get(w.id)!==serialized)log('base-window-state-change',{state});
    }
    for(const id of windowsSeen.keys())if(!current.has(id))log('base-window-no-longer-listed',{id});
    windowsSeen.clear();for(const [id,value]of current)windowsSeen.set(id,value);
  }
  poll();timer=setInterval(poll,100);timer.unref();
  globalThis.__P059Monitor={snapshot,restore(){clearInterval(timer);for(const restore of restores.reverse())safe(restore);log('monitor-restored');delete globalThis.__P059Monitor;}};
  log('monitor-installed',{pid:process.pid,userData:options.userData,rpcObservation,boundary:'Passive listeners + delegating WC.send and exact original files.answerClose handler; no prevented event, no fake ready, no business action. 100ms unref window inventory. JSONL synchronous diagnostics may affect timing.'});
  return{installedAtMs,pid:process.pid,rpcObservation,snapshot:snapshot()};
}
