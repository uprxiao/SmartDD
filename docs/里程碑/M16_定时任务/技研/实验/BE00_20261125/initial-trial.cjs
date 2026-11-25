
'use strict';
const {app,BrowserWindow,WebContentsView,screen,nativeImage}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=process.env.WY_ARCH_PROBE_DIR;
if(!root || !root.startsWith('/private/tmp/willyou-render-architecture.')) throw new Error('Expected own temp root');
app.setName('WillYou architecture probe');
for(const [key,dir] of [['userData','data'],['sessionData','session'],['logs','logs']]){
  const p=path.join(root,dir);fs.mkdirSync(p,{recursive:true});app.setPath(key,p);
}
const report=path.join(root,'results.jsonl');
function log(event,value){
  const line=JSON.stringify({event, ...value});
  fs.appendFileSync(report,line+'\n');
  console.log(line);
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(label,operation,ms=4500){
  let timer;
  try{
    return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),ms)})]);
  }finally{clearTimeout(timer);}
}
const fixture=path.join(root,'fixture.html');
const hostFile=path.join(root,'host.html');
fs.writeFileSync(fixture,'<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#a8a8a8;width:100%;height:100%;overflow:hidden}button{position:absolute;left:30px;top:30px;width:130px;height:75px;font:18px monospace}</style></head><body><button id="counter" onclick="window.clicks++;this.textContent=\'Count \'+window.clicks">Count 0</button><script>window.clicks=0;window.ticks=0;setInterval(()=>window.ticks++,100);</script></body></html>');
fs.writeFileSync(hostFile,'<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#224e68}#cover{position:absolute;inset:0;z-index:2;background:#224e68;color:white;padding:15px;font:18px system-ui}#webslot{position:absolute;left:30px;top:60px;width:440px;height:300px;z-index:3}webview{display:flex;width:100%;height:100%}</style></head><body><div id="cover">WillYou isolated rendering probe</div><div id="webslot"></div></body></html>');
const fixtureUrl=pathToFileURL(fixture).href;
const windows=[];
let watchdog;
function makeHost(webviewTag=false){
  const displays=screen.getAllDisplays();
  const primary=screen.getPrimaryDisplay();
  const chosen=displays.find(d=>d.id!==primary.id)||primary;
  const area=chosen.workArea;
  const win=new BrowserWindow({
    title:'WillYou architecture probe '+(webviewTag?'WebView':'WebContentsView'),
    x:Math.round(area.x+Math.max(0,area.width-740)),
    y:Math.round(area.y+Math.max(0,area.height-520)),
    width:720,height:500,show:false,fullscreenable:false,skipTaskbar:true,hiddenInMissionControl:true,
    webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,webviewTag}
  });
  windows.push(win);
  return win;
}
function stats(contents){
  return bounded('read fixture state',()=>contents.executeJavaScript('({clicks:window.clicks,ticks:window.ticks,visible:document.visibilityState,width:innerWidth,height:innerHeight})'));
}
async function setDebugger(contents){
  if(!contents.debugger.isAttached())contents.debugger.attach('1.3');
  await bounded('focus emulation',()=>contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true}));
}
async function phase(contents,win,carrier,state,extra={}){
  const result={carrier,state,windowVisible:win.isVisible(),...extra};
  await sleep(180);
  let before;
  try{before=await stats(contents);result.before=before;}catch(e){result.stateError=String(e);}
  if(before){
    const started=Date.now();
    try{
      await bounded('fixture input',async()=>{
        const common={x:80,y:65,button:'left',clickCount:1};
        await contents.debugger.sendCommand('Input.dispatchMouseEvent',{...common,type:'mousePressed'});
        await contents.debugger.sendCommand('Input.dispatchMouseEvent',{...common,type:'mouseReleased'});
      },2800);
      await sleep(100);
      const after=await stats(contents);
      result.clickDelta=after.clicks-before.clicks;result.inputMs=Date.now()-started;
    }catch(e){result.inputMs=Date.now()-started;result.inputError=String(e);}
  }
  const started=Date.now();
  try{
    const snap=await bounded('CDP screenshot',()=>contents.debugger.sendCommand('Page.captureScreenshot',{format:'png'}),3000);
    const png=Buffer.from(snap.data,'base64');
    const image=nativeImage.createFromBuffer(png);
    const dim=image.getSize();
    const bitmap=image.toBitmap();
    const pixelOffset=(Math.floor(dim.height*0.82)*dim.width+Math.floor(dim.width*0.82))*4;
    const sample=[...bitmap.subarray(pixelOffset,pixelOffset+4)];
    result.capture={ms:Date.now()-started,size:dim,sample,pixelsCorrect:sample.length===4&&sample.slice(0,3).every(v=>Math.abs(v-168)<8)};
    fs.writeFileSync(path.join(root,carrier+'-'+state+'.png'),png);
  }catch(e){result.capture={ms:Date.now()-started,error:String(e),pixelsCorrect:false};}
  log('phase',result);
}
async function nativeTrial(){
  const win=makeHost();
  await bounded('load host',()=>win.loadFile(hostFile));
  const view=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  let original;
  try{
    original=win.contentView.children.slice();
    win.contentView.addChildView(view);
    view.setBounds({x:30,y:60,width:440,height:300});
    win.showInactive();
    await bounded('load native fixture',()=>view.webContents.loadFile(fixture));
    await setDebugger(view.webContents);
    await phase(view.webContents,win,'native','displayed',{childCount:win.contentView.children.length});
    win.contentView.addChildView(view,0);
    await phase(view.webContents,win,'native','behind-ui',{firstChildIsPage:win.contentView.children[0]===view,originalChildren:original.length});
    view.setVisible(false);
    await sleep(250);
    view.setVisible(true);
    await phase(view.webContents,win,'native','restored-paint-hold',{firstChildIsPage:win.contentView.children[0]===view});
    win.hide();
    await phase(view.webContents,win,'native','host-hidden');
    win.showInactive();
    await phase(view.webContents,win,'native','host-restored');
  }finally{
    if(!view.webContents.isDestroyed()){
      if(view.webContents.debugger.isAttached())view.webContents.debugger.detach();
      view.webContents.close({waitForBeforeUnload:false});
    }
    if(!win.isDestroyed())win.destroy();
  }
}
async function webviewTrial(){
  const win=makeHost(true);
  let guest;
  try{
    win.webContents.on('will-attach-webview',(event,prefs,params)=>{
      if(params.src!==fixtureUrl){event.preventDefault();return;}
      prefs.sandbox=true;prefs.contextIsolation=true;prefs.nodeIntegration=false;prefs.backgroundThrottling=false;
      delete prefs.preload;
    });
    await bounded('load webview host',()=>win.loadFile(hostFile));
    win.showInactive();
    const attached=new Promise((resolve,reject)=>{
      win.webContents.once('did-attach-webview',(_event,contents)=>{
        guest=contents;
        if(contents.getURL()===fixtureUrl&&!contents.isLoading()){resolve(contents);return;}
        contents.once('did-finish-load',()=>resolve(contents));
        contents.once('did-fail-load',(_e,code,description)=>reject(new Error('guest load '+code+' '+description)));
      });
    });
    await bounded('mount fixture webview',()=>win.webContents.executeJavaScript(
      '(()=>{const w=document.createElement("webview");w.id="guest";w.setAttribute("webpreferences","backgroundThrottling=false");w.src='+JSON.stringify(fixtureUrl)+';document.querySelector("#webslot").appendChild(w);return true})()'
    ));
    await bounded('guest ready',()=>attached,10000);
    await setDebugger(guest);
    await phase(guest,win,'webview','displayed');
    await bounded('put behind opaque host',()=>win.webContents.executeJavaScript('document.querySelector("#webslot").style.zIndex="1";document.querySelector("#webslot").style.pointerEvents="none";true'));
    await phase(guest,win,'webview','behind-ui');
    await bounded('hide webview',()=>win.webContents.executeJavaScript('document.querySelector("#webslot").style.display="none";true'));
    await sleep(250);
    await bounded('restore transparent paint hold',()=>win.webContents.executeJavaScript('(()=>{const s=document.querySelector("#webslot").style;s.display="block";s.opacity="0";return true})()'));
    await phase(guest,win,'webview','restored-paint-hold');
    win.hide();
    await phase(guest,win,'webview','host-hidden');
    win.showInactive();
    await phase(guest,win,'webview','host-restored');
  }finally{
    if(guest&&!guest.isDestroyed()&&guest.debugger.isAttached())guest.debugger.detach();
    if(!win.isDestroyed())win.destroy();
  }
}
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  watchdog=setTimeout(()=>{log('watchdog',{reason:'local probe time limit'});for(const win of windows)if(!win.isDestroyed())win.destroy();app.exit(2);},65000);
  log('environment',{electron:process.versions.electron,chromium:process.versions.chrome,platform:process.platform,arch:process.arch,displays:screen.getAllDisplays().length,fixtureOnly:true});
  let failed=0;
  for(const [name,trial] of [['native',nativeTrial],['webview',webviewTrial]]){
    try{await trial();}catch(e){failed++;log('experiment-error',{carrier:name,error:String(e)});}
  }
  clearTimeout(watchdog);
  log('complete',{failures:failed});
  app.exit(failed?1:0);
}).catch(error=>{log('startup-error',{error:String(error)});app.exit(1);});
