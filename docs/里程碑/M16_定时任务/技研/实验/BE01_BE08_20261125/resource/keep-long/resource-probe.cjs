"use strict";

// Experimental fixed local fixture; no production renderer, store, credentials,
// target URLs, user browser, real OS focus or externally exposed debug port.
const { app, BaseWindow, BrowserWindow, WebContentsView, webContents, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { performance } = require("node:perf_hooks");

const root = process.env.WY_F36_RESOURCE_ROOT;
const mode = process.env.WY_F36_RESOURCE_MODE;
const length = process.env.WY_F36_RESOURCE_LENGTH;
if (!root || !/^\/private\/tmp\/willyou-f36-resource-run-[A-Za-z0-9_-]+$/.test(root) || fs.realpathSync(root) !== root) throw new Error("Expected fresh private run root");
if (process.env.HOME !== path.join(root,'home')) throw new Error("Expected private HOME");
if (process.versions.electron !== '42.11.14') throw new Error('Unexpected Electron version');
if (!['keep','idle'].includes(mode) || !['short','long'].includes(length)) throw new Error('Invalid trial mode');
if (fs.existsSync(path.join(root,'raw.jsonl'))) throw new Error('Refusing to overwrite a test ledger');
const checkpointMs = length === 'long' ? 300000 : 5000;
const sampleMs = length === 'long' ? 5000 : 1000;
const plannedDurationMs = checkpointMs * 6;
const pageCount = 5;
const colors = ['#e32636','#178847'];
const ledger = path.join(root,'raw.jsonl');
const preferences = {sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false};
const created = [];
let win, shell, shellWC;
let testStart;
let everShown = false;
let everFocused = false;
let hadFailure = false;
let watchdog;
const clock = () => performance.now();
const sleep = ms => new Promise(resolve=>setTimeout(resolve,Math.max(0,ms)));
const elapsed = () => testStart === undefined ? null : clock()-testStart;
function record(event, fields={}) {
  fs.appendFileSync(ledger, JSON.stringify({event,utc:new Date().toISOString(),monoMs:clock(),elapsedMs:elapsed(),...fields})+'\n');
}
function assert(condition, message) { if(!condition) throw new Error(message); }
async function bounded(name, run, ms=5000) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(run),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(name+' timed out')),ms);})]); }
  finally { clearTimeout(timer); }
}
async function waitFor(name, read, predicate, ms=3000) {
  const end=clock()+ms;
  while(clock()<end){ const x=await bounded(name+' read',read,1200); if(predicate(x))return x; await sleep(40); }
  throw new Error(name+' not observed before deadline');
}

app.setName('WillYou F36 isolated resource probe');
app.commandLine.appendSwitch('disable-background-networking');
const privatePaths=[['home','home'],['appData','app-data'],['userData','user-data'],['sessionData','session-data'],['logs','logs'],['temp','temp'],['crashDumps','crash-dumps']];
for (const [name,dirname] of privatePaths) {
  const location=path.join(root,dirname);
  fs.mkdirSync(location,{recursive:true});
  app.setPath(name,location);
}
// Fixture contains only file URLs. No remote debugging listener or outbound page actions.
const shellHtml=path.join(root,'shell.html');
fs.writeFileSync(shellHtml,'<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#224e68;color:white;font:18px system-ui}</style><p>Isolated resource shell</p>');
for(let page=0;page<pageCount;page++){
  fs.writeFileSync(path.join(root,`fixture-${page}.html`),`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:#a8a8a8;overflow:hidden;font:18px system-ui}button{position:absolute;left:30px;top:30px;width:130px;height:75px}#marker{position:absolute;left:240px;top:160px;width:120px;height:95px;background:#111111}</style><button id="counter">Count 0</button><span style="position:absolute;left:200px;top:45px">Fixture ${page}</span><div id="marker"></div><script>window.fixtureId=${page};window.documentId=String(performance.timeOrigin)+'-'+Math.random();window.clicks=0;window.ticks=0;document.querySelector("#counter").addEventListener("click",()=>{window.clicks++;document.querySelector("#counter").textContent="Count "+window.clicks;document.querySelector("#marker").style.background=${JSON.stringify(colors)}[(window.clicks-1)%2];});setInterval(()=>window.ticks++,100);</script>`);
}
fs.mkdirSync(path.join(root,'screenshots'));
// getOSProcessId is direct WebContents->OS renderer identity, not Chromium frame PID.
function topology() {
  const owned=[...created.map(p=>({role:`page${p.n}`,view:p.view,wc:p.wc})),...(shellWC?[{role:'shell',view:shell,wc:shellWC}]:[])];
  return {baseWindowCount:BaseWindow.getAllWindows().length,browserWindowCount:BrowserWindow.getAllWindows().length,hostVisible:!win?.isDestroyed()&&win?.isVisible(),hostFocused:!win?.isDestroyed()&&win?.isFocused(),everShown,everFocused,
    hostId:win&&!win.isDestroyed()?win.id:null,
    owned:owned.map(x=>({role:x.role,viewVisible:x.view.getVisible(),destroyed:x.wc.isDestroyed(),contentsId:x.wc.isDestroyed()?null:x.wc.id,osProcessId:x.wc.isDestroyed()?null:x.wc.getOSProcessId()})),
    appWebContentsIds:webContents.getAllWebContents().map(w=>w.id).sort((a,b)=>a-b),
    layers:win&&!win.isDestroyed()?win.contentView.children.map(x=>x===shell?'shell':`page${created.find(p=>p.view===x)?.n??'?'}`):[]};
}
function metric(phase, checkpoint=null, scheduledElapsedMs=null) {
  // app.getAppMetrics provides all Electron-associated processes, not just the owner.
  // Keep raw numbers and each PID/creationTime. Claim only this documented scope.
  const sampleStart=clock();
  const processes=app.getAppMetrics();
  const snapshot=topology();
  const expectedPids=[...new Set([process.pid,...snapshot.owned.filter(x=>!x.destroyed).map(x=>x.osProcessId)])].sort((a,b)=>a-b);
  record('metric',{phase,checkpoint,scheduledElapsedMs,sampledMonoMs:sampleStart,samplingMs:clock()-sampleStart,
    sampleElapsedMs:elapsed(),mainPid:process.pid,expectedPids,missingExpectedPids:expectedPids.filter(pid=>!processes.some(p=>p.pid===pid)),topology:snapshot,processes});
}
function checkTopology(stage) {
  const value=topology();
  assert(value.baseWindowCount===1 && value.browserWindowCount===0, stage+' window topology changed');
  assert(!value.hostVisible && !value.hostFocused && !value.everShown && !value.everFocused, stage+' hidden host changed');
  assert(value.owned.length===6 && value.appWebContentsIds.length===6 && value.owned.every(x=>!x.destroyed), stage+' WebContents topology changed');
  assert(value.layers.join(',')==='page0,page1,page2,page3,page4,shell',stage+' layer order changed');
  assert(value.owned.filter(x=>x.role!=='shell').every(x=>x.viewVisible===(mode==='keep')),stage+' page drawable state differs from selected strategy');
  return value;
}
function state(wc) {
  return wc.executeJavaScript('({fixtureId:window.fixtureId,documentId:window.documentId,clicks:window.clicks,ticks:window.ticks,performanceMs:performance.now(),width:innerWidth,height:innerHeight,documentVisibility:document.visibilityState})');
}
function checkFixture(p, value) {
  assert(value && value.fixtureId===p.n && !!value.documentId, 'wrong local fixture');
  assert(value.width===440 && value.height===300, 'changed fixture geometry');
  assert(Number.isInteger(value.clicks) && Number.isInteger(value.ticks), 'invalid fixture counters');
  if(p.documentId)assert(value.documentId===p.documentId,'local document replaced');
}

async function operate(p, index) {
  const value={mode,checkpoint:index,fixture:p.n,contentsId:p.wc.id,osProcessId:p.wc.getOSProcessId(),expectedClickCount:index+2,scheduledElapsedMs:index>=0?index*checkpointMs:null};
  const start=clock();
  let attached=false, enabled=false;
  try {
    // Read timer only at checkpoints; do not wake hidden pages between samples.
    value.beforeDrawable=p.view.getVisible();
    value.before=await bounded('checkpoint fixture state',()=>state(p.wc),3000);
    checkFixture(p,value.before);
    if(p.previous) {
      value.idleTickDelta=value.before.ticks-p.previous.ticks;
      value.documentTimeDeltaMs=value.before.performanceMs-p.previous.performanceMs;
      assert(value.before.clicks===p.previous.clicks,'unexpected extra click');
    }
    p.view.setVisible(true);
    value.duringDrawable=p.view.getVisible();
    assert(value.duringDrawable,'view did not become drawable');
    p.wc.debugger.attach('1.3'); attached=true;
    await bounded('page-only focus emulation',()=>p.wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})); enabled=true;
    const clickStart=clock();
    await bounded('fixed local click',async()=>{
      await p.wc.debugger.sendCommand('Input.dispatchMouseEvent',{x:80,y:65,button:'left',clickCount:1,type:'mousePressed'});
      await p.wc.debugger.sendCommand('Input.dispatchMouseEvent',{x:80,y:65,button:'left',clickCount:1,type:'mouseReleased'});
    },3000);
    value.after=await waitFor('fixed local click effect',()=>state(p.wc),x=>x.clicks===value.before.clicks+1);
    checkFixture(p,value.after);
    value.inputMs=clock()-clickStart;
    assert(value.after.clicks===value.expectedClickCount,'checkpoint click ledger mismatch');
    // Capture once using the same local page compositor path as BE02. The PNG
    // verifier must observe the new alternating marker; a stale frame fails.
    const captureStart=clock();
    const reply=await bounded('fixed local capture',()=>p.wc.debugger.sendCommand('Page.captureScreenshot',{format:'png'}),3500);
    const file=`screenshots/${index===-1?'warmup':String(index).padStart(2,'0')}-page${p.n}.png`;
    const bytes=Buffer.from(reply.data,'base64');
    fs.writeFileSync(path.join(root,file),bytes);
    value.capture={file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,ms:clock()-captureStart,expectedMarker:colors[(value.after.clicks-1)%2]};
    value.finalState=await bounded('fixture state after capture',()=>state(p.wc),2000);
    checkFixture(p,value.finalState);
    assert(value.finalState.clicks===value.expectedClickCount,'click changed during capture');
    assert(value.finalState.ticks>=value.after.ticks,'timer reset during capture');
    p.previous=value.finalState;
    value.success=true;
  } catch(error) { hadFailure=true;value.success=false;value.error=String(error); }
  finally {
    try {
      if(enabled && p.wc.debugger.isAttached())await bounded('clear page focus emulation',()=>p.wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:false}),1500);
    } catch(error) { hadFailure=true;value.success=false;value.focusResetError=String(error); }
    try { if(attached&&p.wc.debugger.isAttached())p.wc.debugger.detach(); }
    catch(error) { hadFailure=true;value.success=false;value.detachError=String(error); }
    try { p.view.setVisible(index===-1||mode==='keep');value.afterDrawable=p.view.getVisible();value.attachedAfter=p.wc.debugger.isAttached(); }
    catch(error) { hadFailure=true;value.success=false;value.restoreError=String(error); }
    value.durationMs=clock()-start;
    record('operation',value);
  }
  assert(value.success,'fixture operation failed; see raw ledger');
}

async function run() {
  // Local fixture pages have no network resources. Block unexpected network
  // requests on the trial's session, without recording arbitrary URLs.
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_detail,callback)=>{record('blocked-network-request');callback({cancel:true});});
  const resolvedPaths=Object.fromEntries(privatePaths.map(([name])=>[name,app.getPath(name)]));
  assert(privatePaths.every(([name,dirname])=>resolvedPaths[name]===path.join(root,dirname)),'app private path did not resolve as configured');
  record('environment',{electron:process.versions.electron,chromium:process.versions.chrome,node:process.versions.node,platform:process.platform,arch:process.arch,release:os.release(),logicalCPUs:os.cpus().length,mode,length,pageCount,checkpointMs,sampleMs,plannedDurationMs,fixedLocalFixtureOnly:true,metricSource:'app.getAppMetrics()',memoryUnit:'KiB as Electron process metric working set',profileRoot:root,resolvedPaths,backgroundThrottling:false,pageFocusEmulationDuringOperation:true,neverShowHost:true});
  win=new BaseWindow({width:800,height:600,show:false,title:'WillYou F36 isolated resource probe',backgroundColor:'#111111'});
  win.on('show',()=>{everShown=true;});win.on('focus',()=>{everFocused=true;});
  shell=new WebContentsView({webPreferences:preferences});shellWC=shell.webContents;
  win.contentView.addChildView(shell);shell.setBounds({x:0,y:0,width:800,height:600});
  await bounded('load local shell',()=>shellWC.loadFile(shellHtml),8000);
  for(let n=0;n<pageCount;n++) {
    const view=new WebContentsView({webPreferences:preferences});
    const p={n,view,wc:view.webContents};created.push(p);
    win.contentView.addChildView(view,n);view.setBounds({x:30,y:60,width:440,height:300});
    view.setVisible(true);
    await bounded('load local fixed fixture',()=>p.wc.loadFile(path.join(root,`fixture-${n}.html`)),8000);
    const s=await bounded('verify fixture identity',()=>state(p.wc),3000);
    checkFixture(p,s);assert(s.clicks===0,'nonempty fixture');p.documentId=s.documentId;
  }
  record('loaded',{topology:topology()});
  // Same warm-up action on every page before starting measurement clock.
  for(const p of created)await operate(p,-1);
  for(const p of created)p.view.setVisible(mode==='keep');
  record('warmup-complete',{topology:checkTopology('after warmup')});
  // Allow all views the same fixed settling time. This is warm-up, not data.
  await sleep(1000);
  testStart=clock();
  let nextIdleSample=sampleMs;
  for(let index=0;index<=6;index++) {
    const scheduled=index*checkpointMs;
    while(nextIdleSample<scheduled) {
      const target=testStart+nextIdleSample;
      if(clock()>target+(sampleMs/2)) { record('skipped-sample',{scheduledElapsedMs:nextIdleSample,reason:'elapsed during preceding operation or delayed scheduler'}); }
      else { await sleep(target-clock());metric('idle',null,nextIdleSample); }
      nextIdleSample+=sampleMs;
    }
    await sleep(testStart+scheduled-clock());
    checkTopology('checkpoint '+index+' before');
    metric('checkpoint-before',index,scheduled);
    record('checkpoint-start',{checkpoint:index,scheduledElapsedMs:scheduled,lateMs:Math.max(0,clock()-testStart-scheduled)});
    for(const p of created)await operate(p,index);
    record('checkpoint-end',{checkpoint:index,topology:checkTopology('checkpoint '+index+' after')});
    metric('checkpoint-after',index,scheduled);
    if(nextIdleSample===scheduled)nextIdleSample+=sampleMs;
  }
  record('measurement-complete',{activeElapsedMs:elapsed(),topology:checkTopology('measurement complete')});
}

async function cleanup() {
  const started=clock();
  const errors=[];
  const owned=[...created.map(p=>p.wc),...(shellWC?[shellWC]:[])];
  for(const wc of owned) {
    try{if(!wc.isDestroyed()&&wc.debugger.isAttached())wc.debugger.detach();if(!wc.isDestroyed())wc.close({waitForBeforeUnload:false});}
    catch(error){errors.push(String(error));}
  }
  try{if(win&&!win.isDestroyed())win.destroy();}catch(error){errors.push(String(error));}
  try{await waitFor('close all owned views/window',async()=>({allDestroyed:owned.every(w=>w.isDestroyed()),windowDestroyed:!win||win.isDestroyed(),remainingWindows:BaseWindow.getAllWindows().length,remainingWebContents:webContents.getAllWebContents().map(w=>w.id)}),x=>x.allDestroyed&&x.windowDestroyed&&x.remainingWindows===0&&x.remainingWebContents.length===0,4000);}
  catch(error){errors.push(String(error));}
  const result={ownedCount:owned.length,allDestroyed:owned.every(w=>w.isDestroyed()),windowDestroyed:!win||win.isDestroyed(),remainingWindows:BaseWindow.getAllWindows().length,remainingWebContents:webContents.getAllWebContents().map(w=>w.id),errors,durationMs:clock()-started};
  record('cleanup',result);
  return result.allDestroyed&&result.windowDestroyed&&result.remainingWindows===0&&result.remainingWebContents.length===0&&!errors.length;
}

app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  watchdog=setTimeout(()=>{
    // Observe local failure honestly; do not label timeout as successful cleanup.
    record('watchdog',{reason:'local experimental runtime deadline'});
    for(const p of created)try{if(!p.wc.isDestroyed())p.wc.close({waitForBeforeUnload:false});}catch{}
    try{if(shellWC&&!shellWC.isDestroyed())shellWC.close({waitForBeforeUnload:false});}catch{}
    try{if(win&&!win.isDestroyed())win.destroy();}catch{}
    app.exit(3);
  },plannedDurationMs+120000);
  try{await run();}catch(error){hadFailure=true;record('driver-error',{error:String(error),stack:error.stack});}
  const clean=await cleanup();
  clearTimeout(watchdog);
  record('complete',{success:!hadFailure&&clean});
  app.exit(!hadFailure&&clean?0:1);
}).catch(error=>{record('startup-error',{error:String(error)});app.exit(2);});
