// Private I diagnosis only. Original production service/heartbeat remains active.
const {app,BrowserWindow}=require('electron');
const {readFileSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const {randomUUID}=require('node:crypto');
const base=process.env.WILLYOU_MCP_DIAG_BASE;
const {FileMcpUiService,createViewerAppBridge}=require(process.env.WILLYOU_MCP_DIAG_PRODUCTION);
app.setPath('userData',join(base,'userdata'));app.on('window-all-closed',()=>{});
const r={pid:process.pid,startedAt:new Date().toISOString(),layer:'I diagnostic, original production UI service and public SDK; explicit synthetic session/API, not normal packaged A',cases:[]};
const save=()=>writeFileSync(join(base,'result.json'),JSON.stringify(r,null,2)+'\n');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const wait=async(test,ms)=>{const start=Date.now();while(!test()){if(Date.now()-start>ms)throw Error('Diagnostic condition timed out');await pause(50)}};
const watchdog=setTimeout(()=>{r.fatal='Global 65s diagnostic deadline';save();app.exit(2)},65000);
app.whenReady().then(async()=>{
 app.setActivationPolicy('regular');await app.dock.show();
 for(const mode of process.env.WILLYOU_MCP_DIAG_MODES?.split(',')??['plain-idle','sdk-idle','sdk-timer']){
  const c={mode,startedAt:Date.now(),events:[],console:[],states:[],failures:[]};r.cases.push(c);save();
  const parent=new BrowserWindow({show:true,width:760,height:560,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  parent.setTitle('I · S07 · '+mode+' · isolated');await parent.loadURL('about:blank');
  const x={id:randomUUID(),uri:'fixture://current',generation:1},abort=new AbortController();
  const plain=`<!doctype html><body><button id="read-current" style="margin:16px;padding:12px">Read</button><script>
   const emit=(method,params)=>parent.postMessage({jsonrpc:'2.0',method,params},'*');
   const button=document.querySelector('button'),b=button.getBoundingClientRect();
   button.onclick=e=>emit('diag/click',{trusted:e.isTrusted});
   emit('ui/notifications/initialized',{});emit('diag/ready',{x:b.x+b.width/2,y:b.y+b.height/2});
  </script>`;
  let html=mode==='plain-idle'?plain:readFileSync(process.env.WILLYOU_MCP_DIAG_HTML,'utf8');
  if(mode==='sdk-noop-timer')html+='<script>setInterval(()=>{},200)</script>';
  if(mode==='sdk-timer')html+="<script>setInterval(()=>parent.postMessage({jsonrpc:'2.0',method:'diag/tick',params:{at:Date.now()}},'*'),200)</script>";
  const ui=new FileMcpUiService(()=>({html,signal:abort.signal,assert:()=>abort.signal.throwIfAborted()}));let bridge,transport,interval;
  const ctx={...x,presentation:'mcp-app',initialArguments:{uri:x.uri,rootUri:'file:///diag-root',foreignUri:'file:///diag-foreign'},initialResult:{content:[{type:'text',text:'synthetic I only'}],structuredContent:{probe:{credentialEnvPresent:false,configReadable:false}}}};
  const telemetry=()=>c.events.filter(e=>e.payload?.method==='notifications/message').at(-1)?.payload.params.data;
  try{
   if(mode!=='plain-idle'){
    bridge=createViewerAppBridge(ctx,{readViewer:async()=>({uri:x.uri,mimeType:'text/plain',base64:Buffer.from('Synthetic I\n').toString('base64')}),viewerTool:async()=>{throw Error('No tools')}},'light',e=>c.failures.push(String(e)));
    transport={start:async()=>{},close:async()=>transport.onclose?.(),send:async payload=>ui.send('owner',x,payload)};
    await bridge.connect(transport);
   }
   await ui.open('owner',x,parent,event=>{c.events.push({at:Date.now(),...event});if(event.error)c.failures.push(event.error);else if(bridge)transport.onmessage?.(event.payload);});
  }catch(error){c.openError=String(error)}
  const view=parent.contentView.children[0];
  if(view){
   view.webContents.on('console-message',(_event,...args)=>c.console.push({at:Date.now(),args}));
   ui.bounds('owner',{id:x.id,x:0,y:0,width:700,height:480,visible:true});parent.setAlwaysOnTop(true,'floating');parent.setFocusable(true);parent.show();app.focus({steal:true});parent.focus();view.webContents.focus();
   interval=setInterval(()=>{if(view.webContents.isDestroyed())return;try{c.states.push({at:Date.now(),windowFocused:parent.isFocused(),viewFocused:view.webContents.isFocused(),visible:view.getVisible(),backgroundThrottling:view.webContents.getBackgroundThrottling(),frames:view.webContents.mainFrame.framesInSubtree.map(f=>({url:f.url,visibility:f.visibilityState,pid:f.osProcessId,destroyed:f.isDestroyed()}))});save()}catch{}},400);
  }
  try{
   await wait(()=>c.failures.length||(mode==='plain-idle'?c.events.some(e=>e.payload?.method==='diag/ready'):telemetry()?.state==='Ready'),12000);
   if(c.failures.length)throw Error(c.failures.join(';'));
   c.readyAt=Date.now();const point=mode==='plain-idle'?c.events.find(e=>e.payload?.method==='diag/ready').payload.params:telemetry().controls['#read-current'];
   if(process.env.WILLYOU_MCP_DIAG_CDP==='true'){c.inputRoute='Original native debugger Input.dispatchMouseEvent';for(const type of ['mouseMoved','mousePressed','mouseReleased'])await view.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type,x:Math.round(point.x),y:Math.round(point.y),...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});}
   else{c.inputRoute='Native sendInputEvent';for(const type of ['mouseMove','mouseDown','mouseUp'])view.webContents.sendInputEvent({type,x:Math.round(point.x),y:Math.round(point.y),...(type==='mouseMove'?{}:{button:'left',clickCount:1})});}
   try{await wait(()=>c.failures.length||(mode==='plain-idle'?c.events.some(e=>e.payload?.method==='diag/click'):telemetry()?.state==='Complete'),3000)}catch(error){c.clickWaitError=String(error)}
   c.click=mode==='plain-idle'?c.events.find(e=>e.payload?.method==='diag/click')?.payload.params:telemetry();
   const start=Date.now();while(Date.now()-start<8500&&!c.failures.length)await pause(100);
   c.aliveAfterClickMs=Date.now()-start;
  }catch(error){c.error=String(error)}
  finally{clearInterval(interval);await bridge?.close();ui.closeOwner('owner');parent.destroy();c.finishedAt=Date.now();save();}
 }
 clearTimeout(watchdog);r.finishedAt=new Date().toISOString();save();console.log('DIAGNOSTIC-DONE '+base);app.quit();
}).catch(error=>{r.fatal=String(error.stack);clearTimeout(watchdog);save();app.exit(1)});
