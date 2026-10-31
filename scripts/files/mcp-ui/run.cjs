const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const {readFileSync,writeFileSync,mkdirSync,statSync,realpathSync}=require('node:fs');
const {join}=require('node:path');const {randomUUID,createHash}=require('node:crypto');
const base=process.env.SMARTDD_MCP_UI_BASE,root=process.env.SMARTDD_MCP_UI_ROOT;
const {FileMcpUiService,createViewerAppBridge,FileService,FileRootsService,FileRecoveryStore,NativeFileBroker}=require(join(base,'main/production.cjs'));
app.setPath('userData',join(base,'electron-userdata'));app.on('window-all-closed',()=>{});
const report={startedAt:new Date().toISOString(),layer:'I: actual native file broker + registered sandboxed stdio MCP + public App SDK + production bridge + Electron WebContentsView; no packaged App GUI',versions:process.versions,cases:[]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));const wait=async(pred,ms=5000)=>{const start=Date.now();while(!pred()){if(Date.now()-start>ms)throw Error('fixture wait timed out');await pause(10)}};
const digest=p=>createHash('sha256').update(readFileSync(p)).digest('hex');const probeHtml=code=>'<!doctype html><body>fixture<script>'+code+'</script>';
const initialized="parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*');";
const input=()=>({id:randomUUID(),uri:'fixture://current',generation:1});
let finishing=false;const watchdog=setTimeout(()=>finish(2,{timeout:true}),55000);
function finish(code,extra={}){if(finishing)return;finishing=true;clearTimeout(watchdog);Object.assign(report,extra,{finishedAt:new Date().toISOString()});writeFileSync(join(base,'result.json'),JSON.stringify(report,null,2)+'\n');for(const w of BrowserWindow.getAllWindows())w.destroy();app.exit(code)}
process.on('uncaughtException',e=>finish(1,{fatal:String(e.stack)}));process.on('unhandledRejection',e=>finish(1,{fatal:String(e?.stack||e)}));
async function test(name,fn){if(process.env.SMARTDD_MCP_UI_CASE&&!name.includes(process.env.SMARTDD_MCP_UI_CASE))return;const row={name,startedAt:new Date().toISOString()};report.cases.push(row);try{row.observed=await fn();row.pass=true}catch(e){row.pass=false;row.error=String(e.stack||e)}row.finishedAt=new Date().toISOString()}
async function windowFixture(){const parent=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await parent.loadURL('about:blank');return parent}
function fixtureHost(html){const abort=new AbortController();return{abort,ui:new FileMcpUiService(()=>({html,signal:abort.signal,assert:()=>abort.signal.throwIfAborted()}))}}
app.whenReady().then(async()=>{
 await test('S07 real SDK stays responsive through native heartbeat without inspector',async()=>{
  const parent=await windowFixture(),html=readFileSync(process.env.SMARTDD_MCP_S07_HTML,'utf8'),{ui}=fixtureHost(html),events=[],failures=[];
  const diagnostics={events,metrics:[],stacks:[],console:[]};let interval;const x=input(),session={...x,presentation:'mcp-app',initialArguments:{uri:x.uri,rootUri:'file:///s07-root',foreignUri:'file:///s07-foreign'},initialResult:{content:[{type:'text',text:'synthetic heartbeat I only'}],structuredContent:{probe:{credentialEnvPresent:false,configReadable:false}}}};
  const bridge=createViewerAppBridge(session,{readViewer:async()=>{throw Error('No resource read expected')},viewerTool:async()=>{throw Error('No tool expected')}},'light',error=>failures.push(String(error)));
  const transport={start:async()=>{},close:async()=>transport.onclose?.(),send:async payload=>ui.send('owner',x,payload)};
  try{
   interval=setInterval(()=>diagnostics.metrics.push({at:Date.now(),processes:app.getAppMetrics().map(m=>({pid:m.pid,type:m.type,cpu:m.cpu}))}),200);parent.setTitle('I · S07 heartbeat · isolated');parent.show();await bridge.connect(transport);await ui.open('owner',x,parent,event=>{events.push(event);if(event.error)failures.push(event.error);else transport.onmessage?.(event.payload)});ui.bounds('owner',{id:x.id,x:0,y:0,width:700,height:500,visible:true});
   const nativeView=parent.contentView.children[0];nativeView.webContents.on('console-message',(_event,...args)=>diagnostics.console.push({at:Date.now(),args}));
   await wait(()=>events.some(e=>e.payload?.method==='ui/notifications/initialized')||failures.length,12000);for(const f of nativeView.webContents.mainFrame.framesInSubtree)try{void f.collectJavaScriptCallStack().then(stack=>diagnostics.stacks.push({url:f.url,stack:String(stack)}),error=>diagnostics.stacks.push({error:String(error)}));}catch{}assert.deepEqual(failures,[]);
   const view=parent.contentView.children[0],metrics=[],report=()=>events.filter(e=>e.payload?.params?.data?.phase==='S07-fixture-report').at(-1)?.payload.params.data;
   const init=Date.now();await wait(()=>report()?.state==='Ready'||failures.length,12000);assert.deepEqual(failures,[]);assert.equal(report()?.state,'Ready');
   const start=Date.now();while(Date.now()-start<8200){metrics.push({elapsed:Date.now()-start,processes:app.getAppMetrics().map(m=>({pid:m.pid,type:m.type,cpu:m.cpu,memory:m.memory}))});if(failures.length)break;await pause(200)}
   const observed={readyMs:Date.now()-init,aliveMs:Date.now()-start,report:report(),failures,methods:events.map(e=>e.payload?.method),metrics,boundary:'I: actual native WebContentsView, public App SDK and production bridge with explicit synthetic session; no inspector, no external child executeJavaScript, no packaged App A claim, no UI interactions or capability requests.'};writeFileSync(join(base,'heartbeat-observed.json'),JSON.stringify(observed,null,2)+'\n');assert.deepEqual(failures,[]);return observed;
  }finally{clearInterval(interval);diagnostics.failures=failures;writeFileSync(join(base,'diagnostics.json'),JSON.stringify(diagnostics,null,2)+'\n');await bridge.close();ui.closeOwner('owner');parent.destroy()}
 });
 await test('S07 actual native outer source/origin filters reject controlled forged message events',async()=>{
  const parent=await windowFixture(),events=[],{ui}=fixtureHost(probeHtml(initialized+"parent.postMessage({jsonrpc:'2.0',method:'s07/actual-child'},'*');"));
  try{
   const x=input();await ui.open('owner',x,parent,event=>events.push(event));await wait(()=>events.some(e=>e.payload?.method==='s07/actual-child'));
   const view=parent.contentView.children[0],contents=view.webContents,before=events.length;
   const injected=await contents.executeJavaScript(`(()=>{const child=document.querySelector('iframe');const send=(source,origin,method,jsonrpc='2.0')=>dispatchEvent(new MessageEvent('message',{source,origin,data:{jsonrpc,method}}));send(window,'null','s07/wrong-source');send(child.contentWindow,'https://foreign.invalid','s07/wrong-origin');send(child.contentWindow,'null','s07/wrong-jsonrpc','1.0');return{sandbox:child.getAttribute('sandbox'),referrer:child.referrerPolicy}})()`);
   const child=contents.mainFrame.framesInSubtree.find(frame=>frame.url.startsWith('blob:'));assert.ok(child);await child.executeJavaScript("parent.postMessage({jsonrpc:'2.0',method:'s07/actual-barrier'},'*')");await wait(()=>events.some(e=>e.payload?.method==='s07/actual-barrier'));
   assert.ok(!events.some(e=>/^s07\/wrong-/.test(e.payload?.method||'')));assert.equal(injected.sandbox,'allow-scripts');assert.equal(injected.referrer,'no-referrer');assert.equal(events.length,before+1);ui.close('owner',x.id);assert.equal(parent.contentView.children.length,0);
   return{injected,forwarded:events.map(e=>e.payload?.method),childrenAfterClose:0,boundary:'I: actual production native WebContentsView and outer document. Forged MessageEvents are explicit synthetic transport fault inputs, never claimed trusted UI or normal A. Positive/barrier messages originate in actual opaque child.'};
  }finally{ui.closeOwner('owner');parent.destroy()}
 });
 await test('Actual registered MCP SDK handshake, input-before-result, native byte read, bounded tool and forbidden capabilities',async()=>{
  const project=join(base,'project'),userdata=join(base,'files-userdata');mkdirSync(project);mkdirSync(userdata);const path=join(project,'中文.foo');writeFileSync(path,'Native source 中文🙂\r\n');const before={sha256:digest(path),ino:statSync(path).ino,mtime:statSync(path).mtimeMs};
  const brokerPath=process.env.SMARTDD_FILES_NATIVE_PATH;if(!brokerPath)throw Error('SMARTDD_FILES_NATIVE_PATH must select an already verified broker');report.broker={path:brokerPath,sha256:digest(brokerPath)};
  const broker=new NativeFileBroker(brokerPath),sources={sources:()=>[{kind:'project-directory',id:'root',path:project,label:'fixture',projectId:'mcp'}]};
  const files=new FileService(new FileRootsService(sources,broker),broker,new FileRecoveryStore(broker,userdata,sources)),parent=await windowFixture();let bridge;
  try{
   const scope=await files.openScope('owner',{kind:'project',projectId:'mcp'}),r=scope.roots[0],doc=await files.open('owner',{lease:r.lease,generation:r.generation,relativePath:'中文.foo'}),host=files.viewers;
   const provider=join(root,'scripts/files/mcp-ui/provider.mjs'),html=join(base,'app.html');
   await host.configure({adapters:[{id:'sdk',name:'SDK acceptance',enabled:true,suffixes:['.foo'],sources:['project-directory'],provider:{kind:'stdio',command:'/opt/homebrew/bin/node',args:[provider,'${file}','fixture://${session}/resource',html],runtimePaths:['/opt/homebrew/Cellar','/opt/homebrew/opt',join(root,'node_modules'),provider,html],resourceUri:'fixture://${session}/resource',presentation:'mcp-app',uiResourceUri:'ui://fixture/view.html',initialTool:'initial',initialArguments:{uri:'fixture://${session}/resource'},appTools:[{name:'slice',arguments:{uri:'fixture://${session}/resource'},numericArguments:{offset:{min:0,max:1024,integer:true},length:{min:1,max:256,integer:true}}}]}}],preferred:{}});
   const s=await host.open('owner',{id:randomUUID(),ref:doc.ref,adapterId:'sdk',baseHash:doc.revision.hash}),ctx={id:s.id,uri:s.uri,generation:s.generation},failures=[],apiCalls=[];
   for(const bad of [{owner:'foreign',ctx},{owner:'owner',ctx:{...ctx,generation:ctx.generation+1}},{owner:'owner',ctx:{...ctx,uri:ctx.uri+'/other'}}])await assert.rejects(host.ui.open(bad.owner,bad.ctx,parent,()=>{}));assert.equal(parent.contentView.children.length,0);
   bridge=createViewerAppBridge(s,{readViewer:x=>{apiCalls.push('read');return host.read('owner',x)},viewerTool:(x,n,a)=>{apiCalls.push(n);return host.callTool('owner',x,n,a)}},'dark',e=>failures.push(String(e)));
   const transport={start:async()=>{},close:async()=>transport.onclose?.(),send:async payload=>host.ui.send('owner',ctx,payload)};await bridge.connect(transport);let observed;
   await host.ui.open('owner',ctx,parent,event=>{if(event.error)failures.push(event.error);else if(event.payload?.method==='fixture/report')observed=event.payload.params;else transport.onmessage?.(event.payload)});
   await wait(()=>observed||failures.length,12000);report.sdkObserved=observed;assert.deepEqual(failures,[]);assert.ok(observed);assert.equal(observed.error,undefined);assert.deepEqual(observed.order,['input','result']);assert.equal(observed.initialTheme,'dark');assert.equal(observed.parentAccess,false);assert.equal(observed.node,'undefined');assert.equal(observed.preload,'undefined');for(const key of ['tamperedPrototypesStillBlocked','fileClickPrevented','fileShowPickerDenied','fileShowPickerFixed','pickerGlobalsFixed','filePastePrevented','textPasteAllowed'])assert.equal(observed[key],true,key);assert.equal(observed.fileClickHandlers,0);
   assert.equal(Buffer.from(observed.read.contents[0].blob,'base64').toString(),readFileSync(path,'utf8'));assert.equal(observed.tool.structuredContent.name,'slice');assert.equal(observed.denied.length,7);assert.ok(observed.denied.every(x=>x.denied));assert.equal(apiCalls.filter(x=>x==='read').length,1);assert.equal(parent.contentView.children.length,1);
   host.close('owner',s.id);assert.equal(parent.contentView.children.length,0);assert.throws(()=>host.ui.send('owner',ctx,{jsonrpc:'2.0',method:'ping'}));const after={sha256:digest(path),ino:statSync(path).ino,mtime:statSync(path).mtimeMs};assert.deepEqual(after,before);
   return{observed,apiCalls,wrongOwnerGenerationUriRejected:true,before,after,childrenAfterClose:0};
  }finally{await bridge?.close();files.closeOwner('owner');await files.watcher.dispose();broker.dispose();parent.destroy()}
 });
 await test('Close-before-open and immediate close cancel late initialization without resurrecting a native view',async()=>{
  const parent=await windowFixture(),{ui}=fixtureHost(probeHtml(initialized));try{const first=input();ui.close('owner',first.id);await assert.rejects(ui.open('owner',first,parent,()=>{}));const second=input(),pending=ui.open('owner',second,parent,()=>{});const rejected=assert.rejects(pending);ui.close('owner',second.id);await rejected;assert.equal(parent.contentView.children.length,0);return{children:0}}finally{ui.closeOwner('owner');parent.destroy()}
 });
 await test('Delayed real session cleanup remains a serial barrier across B cancelled while waiting and C reopening',async()=>{
  const parent=await windowFixture(),{ui}=fixtureHost(probeHtml(initialized));let release;try{
   const a=input();await ui.open('owner',a,parent,()=>{});const slot=ui.sessions.get('owner'),actual=slot.session.clearStorageData.bind(slot.session);let clears=0;const sequence=[],gate=new Promise(r=>release=r);
   slot.session.clearStorageData=async(...args)=>{const call=++clears;sequence.push('start'+call);if(call===1)await gate;await actual(...args);sequence.push('end'+call)};
   ui.close('owner',a.id);await wait(()=>clears===1);const b=input(),pb=ui.open('owner',b,parent,()=>{}),rejected=assert.rejects(pb);ui.close('owner',b.id);const c=input();let opened=false;const pc=ui.open('owner',c,parent,()=>{}).then(()=>opened=true);
   await pause(80);assert.equal(clears,1);assert.equal(opened,false);assert.equal(parent.contentView.children.length,0);release();await rejected;await pc;assert.deepEqual(sequence.slice(0,4),['start1','end1','start2','end2']);assert.equal(parent.contentView.children.length,1);slot.session.clearStorageData=actual;ui.close('owner',c.id);return{sequence,blockedBeforeRelease:true,childrenAfterReopen:1,childrenAfterClose:parent.contentView.children.length};
  }finally{release?.();ui.closeOwner('owner');parent.destroy()}
 });
 await test('Owner changes reuse cleared isolated session, cookie state is removed, hidden geometry clamps and source abort destroys view',async()=>{
  const parent=await windowFixture(),{ui,abort}=fixtureHost(probeHtml(initialized));try{
   let slot;for(let i=0;i<6;i++){const owner='owner'+i,x=input();await ui.open(owner,x,parent,()=>{});slot=ui.sessions.get(owner);assert.equal(ui.sessions.size,1);assert.deepEqual(await slot.session.cookies.get({}),[]);await slot.session.cookies.set({url:'https://fixture.invalid',name:'fixture',value:'isolated'});ui.bounds(owner,{id:x.id,x:-100,y:-20,width:20000,height:20000,visible:true});const v=parent.contentView.children[0];assert.equal(v.getVisible(),false);assert.deepEqual(v.getBounds(),{x:0,y:0,width:parent.getContentSize()[0],height:parent.getContentSize()[1]});if(i<5)ui.close(owner,x.id);else abort.abort();assert.equal(parent.contentView.children.length,0)}return{owners:6,pooledSessions:ui.sessions.size,sourceAbortChildren:0};
  }finally{for(let i=0;i<6;i++)ui.closeOwner('owner'+i);parent.destroy()}
 });
 await test('Untrusted IPC flood exceeds actual per-second budget and removes its native view',async()=>{
  const parent=await windowFixture(),{ui}=fixtureHost(probeHtml(initialized+"for(let i=0;i<250;i++)parent.postMessage({jsonrpc:'2.0',method:'fixture/flood'},'*');")),events=[];
  try{await ui.open('owner',input(),parent,e=>events.push(e));await wait(()=>events.some(e=>e.error));assert.ok(events.some(e=>e.error?.includes('消息过多')));assert.ok(events.filter(e=>e.payload).length<=200);assert.equal(parent.contentView.children.length,0);return{forwarded:events.filter(e=>e.payload).length,error:events.find(e=>e.error).error,children:0}}finally{ui.closeOwner('owner');parent.destroy()}
 });
 await Promise.all([
  test('Silent application hits real 15-second initialization deadline and can subsequently reopen',async()=>{
   const parent=await windowFixture(),{ui}=fixtureHost('<body>Silent</body>'),events=[],start=Date.now();try{await ui.open('owner',input(),parent,e=>events.push(e));await wait(()=>events.some(e=>e.error),17000);assert.ok(events[0].error.includes('初始化'));const elapsed=Date.now()-start;assert.ok(elapsed>=14900&&elapsed<17500);assert.equal(parent.contentView.children.length,0);const retry=input();await ui.open('owner',retry,parent,()=>{});assert.equal(parent.contentView.children.length,1);ui.close('owner',retry.id);return{elapsed,error:events[0].error,reopened:true,children:parent.contentView.children.length}}finally{ui.closeOwner('owner');parent.destroy()}
  }),
  test('Infinite untrusted script is terminated by frame-subtree heartbeat and leaves parent alive',async()=>{
   const parent=await windowFixture(),{ui}=fixtureHost(probeHtml(initialized+'while(true){}')),events=[],start=Date.now();try{await ui.open('owner',input(),parent,e=>events.push(e));await wait(()=>events.some(e=>e.error),12000);assert.ok(events.some(e=>e.error?.includes('无响应')));assert.equal(parent.contentView.children.length,0);assert.equal(parent.webContents.isDestroyed(),false);return{elapsed:Date.now()-start,error:events.find(e=>e.error).error,parentAlive:true,children:0}}finally{ui.closeOwner('owner');parent.destroy()}
  })
 ]);
 report.pass=report.cases.every(c=>c.pass);finish(report.pass?0:1);
});
