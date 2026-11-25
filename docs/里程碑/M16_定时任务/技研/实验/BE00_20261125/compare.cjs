
'use strict';
const {app,BaseWindow,BrowserWindow,WebContentsView,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const root=process.env.WY_ARCH_PROBE_DIR;
if(!root||!root.startsWith('/private/tmp/willyou-render-architecture.'))throw Error('Expected own trial directory');
app.setName('WillYou architecture probe 2');
for(const [key,dir] of [['userData','data2'],['sessionData','session2'],['logs','logs2']]){
 const p=path.join(root,dir);fs.mkdirSync(p,{recursive:true});app.setPath(key,p);
}
const output=path.join(root,'comparison.jsonl'),palette=['#111111','#ff0000','#00ff00','#0000ff','#ffff00','#ff00ff','#00ffff','#ececec'];
function log(event,value){const line=JSON.stringify({event,...value});fs.appendFileSync(output,line+'\n');console.log(line);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function bounded(label,operation,ms=3500){
 let timer;try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),ms);})]);}
 finally{clearTimeout(timer);}
}
const guestPath=path.join(root,'fixture2.html'),hostPath=path.join(root,'host2.html'),guestUrl=pathToFileURL(guestPath).href;
fs.writeFileSync(guestPath,'<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;background:#a8a8a8;overflow:hidden}button{position:absolute;left:30px;top:30px;width:130px;height:75px;font:18px monospace}#beacon{position:absolute;left:240px;top:160px;width:120px;height:95px;background:#111111}</style></head><body><button id="counter">Count 0</button><div id="beacon"></div><script>window.clicks=0;window.ticks=0;const palette='+JSON.stringify(palette)+';const button=document.querySelector("#counter"),beacon=document.querySelector("#beacon");button.addEventListener("click",()=>{window.clicks++;button.textContent="Count "+window.clicks;beacon.style.background=palette[window.clicks%palette.length];});setInterval(()=>window.ticks++,100);</script></body></html>');
fs.writeFileSync(hostPath,'<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#224e68}#cover{position:absolute;inset:0;z-index:2;background:#224e68;color:white;padding:15px;font:18px system-ui}#webslot{position:absolute;left:30px;top:60px;width:440px;height:300px;z-index:3}webview{display:flex;width:100%;height:100%}</style></head><body><div id="cover">WillYou isolated two-view probe</div><div id="webslot"></div></body></html>');
const prefs={sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false};
const wins=[];
function options(title){
 const primary=screen.getPrimaryDisplay(),d=screen.getAllDisplays().find(display=>display.id!==primary.id)||primary,a=d.workArea;
 return {title:'WillYou architecture probe · '+title,x:a.x+Math.max(0,a.width-740),y:a.y+Math.max(0,a.height-520),width:720,height:500,show:false,fullscreenable:false,skipTaskbar:true,hiddenInMissionControl:true};
}
function track(win){wins.push(win);return win;}
async function read(contents){return bounded('fixture state',()=>contents.executeJavaScript('({clicks:window.clicks,ticks:window.ticks,visibility:document.visibilityState,width:innerWidth,height:innerHeight})'));}
async function debug(contents){contents.debugger.attach('1.3');await bounded('focus emulation',()=>contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true}));}
async function measure(contents,win,carrier,state,extra={}){
 await sleep(200);
 const result={carrier,state,windowVisible:win.isVisible(),windowMinimized:win.isMinimized(),...extra};
 try{
  result.before=await read(contents);
  const start=Date.now();
  try{
   await bounded('fixture click',async()=>{
    const common={x:80,y:65,button:'left',clickCount:1};
    await contents.debugger.sendCommand('Input.dispatchMouseEvent',{...common,type:'mousePressed'});
    await contents.debugger.sendCommand('Input.dispatchMouseEvent',{...common,type:'mouseReleased'});
   },2800);
   await sleep(70);
   result.after=await read(contents);result.clickDelta=result.after.clicks-result.before.clicks;
  }catch(error){result.inputError=String(error);}
  result.inputMs=Date.now()-start;
  const captureStart=Date.now();
  try{
   const reply=await bounded('CDP screenshot',()=>contents.debugger.sendCommand('Page.captureScreenshot',{format:'png'}),3000);
   const bytes=Buffer.from(reply.data,'base64'),name='comparison-'+carrier+'-'+state+'.png';
   fs.writeFileSync(path.join(root,name),bytes);
   result.capture={ms:Date.now()-captureStart,file:name,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),expected:palette[(result.after?.clicks??result.before.clicks)%palette.length]};
  }catch(error){result.capture={ms:Date.now()-captureStart,error:String(error)};}
 }catch(error){result.error=String(error);}
 log('phase',result);
}
function closeContents(contents){if(contents&&!contents.isDestroyed()){if(contents.debugger.isAttached())contents.debugger.detach();contents.close({waitForBeforeUnload:false});}}
async function nativeTrial(){
 const win=track(new BaseWindow(options('native composition')));
 const shell=new WebContentsView({webPreferences:prefs}),page=new WebContentsView({webPreferences:prefs});
 let second;
 try{
  const bounds=win.getContentBounds();
  win.contentView.addChildView(shell);shell.setBounds({x:0,y:0,width:bounds.width,height:bounds.height});
  await bounded('load shell',()=>shell.webContents.loadFile(hostPath));
  win.contentView.addChildView(page);page.setBounds({x:30,y:60,width:440,height:300});
  win.showInactive();
  await bounded('load page',()=>page.webContents.loadFile(guestPath));await debug(page.webContents);
  const layerOrder=()=>win.contentView.children.map(v=>v===shell?'shell':v===page?'page-A':v===second?'page-B':'other');
  await measure(page.webContents,win,'base-native','displayed',{order:layerOrder()});
  win.contentView.addChildView(shell);
  if(win.contentView.children.at(-1)!==shell||win.contentView.children.length!==2)throw Error('Did not prove explicit shell above page');
  await measure(page.webContents,win,'base-native','behind-shell',{order:layerOrder()});
  page.setVisible(false);await sleep(200);page.setVisible(true);
  await measure(page.webContents,win,'base-native','paint-reacquired',{order:layerOrder()});
  second=new WebContentsView({webPreferences:prefs});
  win.contentView.addChildView(second);second.setBounds({x:30,y:60,width:440,height:300});
  await bounded('load second independent page',()=>second.webContents.loadFile(guestPath));await debug(second.webContents);
  await measure(second.webContents,win,'base-native','second-page-visible',{order:layerOrder()});
  await measure(page.webContents,win,'base-native','behind-another-page',{order:layerOrder()});
  win.hide();
  await measure(page.webContents,win,'base-native','host-hidden',{order:layerOrder()});
  win.showInactive();
  win.contentView.addChildView(page);
  await measure(page.webContents,win,'base-native','host-redisplayed',{order:layerOrder()});
  win.minimize();await sleep(450);
  await measure(page.webContents,win,'base-native','host-minimized',{order:layerOrder()});
 }finally{closeContents(second?.webContents);closeContents(page.webContents);closeContents(shell.webContents);if(!win.isDestroyed())win.destroy();}
}
async function webviewTrial(state){
 const win=track(new BrowserWindow({...options('WebView '+state),webPreferences:{...prefs,webviewTag:true}}));
 let guest;
 try{
  win.webContents.on('will-attach-webview',(event,webPreferences,params)=>{
   if(params.src!==guestUrl){event.preventDefault();return;}
   Object.assign(webPreferences,prefs);delete webPreferences.preload;
  });
  await bounded('load webview shell',()=>win.loadFile(hostPath));win.showInactive();
  const attached=new Promise((resolve,reject)=>{
   win.webContents.once('did-attach-webview',(_e,contents)=>{
    guest=contents;
    if(contents.getURL()===guestUrl&&!contents.isLoading()){resolve(contents);return;}
    contents.once('did-finish-load',()=>resolve(contents));
    contents.once('did-fail-load',(_e,code)=>reject(Error('Guest load '+code)));
   });
  });
  await bounded('attach guest',()=>win.webContents.executeJavaScript('(()=>{const e=document.createElement("webview");e.setAttribute("webpreferences","backgroundThrottling=false");e.src='+JSON.stringify(guestUrl)+';document.querySelector("#webslot").appendChild(e);return true})()'));
  await bounded('guest ready',()=>attached,8000);await debug(guest);
  if(state==='orca-opacity-hold'){
   await bounded('transparent guest',()=>win.webContents.executeJavaScript('(()=>{const s=document.querySelector("#webslot").style;s.opacity="0";s.pointerEvents="none";return true})()'));
  }else if(state==='t3-behind-shell'){
   await bounded('behind shell',()=>win.webContents.executeJavaScript('(()=>{const s=document.querySelector("#webslot").style;s.zIndex="1";s.pointerEvents="none";return true})()'));
  }else if(state==='orca-idle-return'){
   await bounded('idle',()=>win.webContents.executeJavaScript('document.querySelector("#webslot").style.display="none";true'));
   await sleep(250);
   await bounded('hold again',()=>win.webContents.executeJavaScript('(()=>{const s=document.querySelector("#webslot").style;s.display="block";s.opacity="0";s.pointerEvents="none";return true})()'));
  }else if(state==='host-hidden'){win.hide();}
  await measure(guest,win,'webview',state,{freshGuest:true});
 }finally{if(guest&&!guest.isDestroyed()&&guest.debugger.isAttached())guest.debugger.detach();if(!win.isDestroyed())win.destroy();}
}
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const watchdog=setTimeout(()=>{log('watchdog',{reason:'probe exceeded time limit'});for(const win of wins)if(!win.isDestroyed())win.destroy();app.exit(2);},85000);
 log('environment',{electron:process.versions.electron,chromium:process.versions.chrome,platform:process.platform,arch:process.arch,displays:screen.getAllDisplays().length,fixtureOnly:true});
 let failed=0;
 const tests=[['base-native',nativeTrial],...['displayed','orca-opacity-hold','t3-behind-shell','orca-idle-return','host-hidden'].map(state=>['webview-'+state,()=>webviewTrial(state)])];
 for(const [name,body] of tests){try{await body();}catch(error){failed++;log('experiment-error',{trial:name,error:String(error)});}}
 clearTimeout(watchdog);log('complete',{driverFailures:failed});app.exit(failed?1:0);
}).catch(error=>{log('startup-error',{error:String(error)});app.exit(1);});
