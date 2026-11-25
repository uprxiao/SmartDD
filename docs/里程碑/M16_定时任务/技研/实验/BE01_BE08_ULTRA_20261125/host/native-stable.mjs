// F36 development-candidate UI probe. Fixed local fixtures only; no model turn or external site.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile, readFile, cp, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const lab='/private/tmp/willyou-f36-lab-tljocnfp';
let mode='candidate';const oldName=process.argv[2]??'baseline-ui-pTkUvV';const phase='strict-native-fullscreen-event-composition';
assert(/^baseline-ui-[A-Za-z0-9]+$/.test(oldName));const oldRoot=join(lab,oldName);const old=JSON.parse(await readFile(join(oldRoot,'result.json'),'utf8'));assert(old.status==='passed-fixture-flow'&&old.exit.code===0&&old.mode==='baseline'&&old.fixture.site.startsWith('http://127.0.0.1:'));
const fixturePort=Number(new URL(old.fixture.site).port);
let source=join(lab,mode);const root=await mkdtemp('/private/tmp/willyou-f36-lab-ultra-');console.log('F36_ULTRA_ROUNDTRIP='+root);
const data=join(root,'data'),home=join(root,'home'),projectDir=join(root,'project');
for(const dir of [data,home,projectDir])await mkdir(dir,{mode:0o700});
await writeFile(join(projectDir,'fixture.txt'),'F36 local test file\n');
await writeFile(join(projectDir,'fixture.html'),'<!doctype html><title>F36 local preview</title><h2>F36 HTML preview</h2><p>Fixture only</p>');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const oldDbHash=sha(await readFile(join(oldRoot,'data','smartdd.db')));
const oldWalSize=await stat(join(oldRoot,'data','smartdd.db-wal')).then(s=>s.size,e=>{if(e.code==='ENOENT')return 0;throw e});assert.equal(oldWalSize,0,'original isolated DB must be checkpointed after exit');
const copied=['smartdd.db','Partitions','capabilities','backups','browser','plugin-data','plugins','imported-keys','app-data','Local Storage','Local State','Preferences'];
for(const name of copied)await cp(join(oldRoot,'data',name),join(data,name),{recursive:true,force:false,errorOnExist:true});
const copyDbHash=sha(await readFile(join(data,'smartdd.db')));assert.equal(oldDbHash,copyDbHash);
const ownerFile=JSON.parse(await readFile(join(data,'capabilities','.store-id.json'),'utf8'));const dbOwner=execFileSync('python3',['-c','import sqlite3,sys; c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro&immutable=1",uri=True); print("|".join(c.execute("SELECT store_id,maintenance_state FROM capability_store_state WHERE singleton=1").fetchone())); c.close()',join(data,'smartdd.db')],{encoding:'utf8'}).trim();const copiedOwnerMatches=dbOwner===ownerFile.storeId+'|ready';assert(copiedOwnerMatches,'old DB and resource ownership must remain consistent');
const {openElectron}=await import(pathToFileURL(join(source,'scripts/lib/electron-harness.mjs')).href);
const result={mode:'roundtrip',phase,root,source,launches:[],system:[],layer:'isolated development build with real renderer/preload; fixed local fixtures; not packaged A/S or real Agent R',startedAt:new Date().toISOString(),observations:{},checks:[],actions:[],requests:[],screenshots:[],oldDataSource:{oldRoot,oldDbHash,copyDbHash,copied,copiedOwnerMatches,oldWalSize,otherCachesAndRuntimeNotCopied:true}};
let stage='setup',app,taskIds=[],quitTriggered=false;
const persist=()=>writeFile(join(root,'result.json'),JSON.stringify({...result,stage},null,2)+'\n');
const check=(name,condition,details)=>{result.checks.push({name,ok:!!condition,details});assert(condition,name);};
const server=createServer((req,res)=>{
 const pathname=new URL(req.url,'http://fixture').pathname; result.requests.push({pathname,method:req.method,oldFixtureCookieSent:(req.headers.cookie??'').split(';').some(v=>v.trim()==='f36_fixture=stable')});
 if(!['/a','/b','/reopen','/roundtrip','/abrupt','/favicon.ico'].includes(pathname)){res.writeHead(404).end();return;}
 if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 const title='F36 Local '+pathname;
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(`<!doctype html><title>${title}</title><style>html,body{margin:0;background:#e1e1e1;font:16px system-ui}button{position:absolute;left:20px;top:20px;width:120px;height:50px}input{position:absolute;left:20px;top:88px;width:140px;height:30px}#marker{position:absolute;left:180px;top:140px;width:90px;height:80px;background:#111111}h3{position:absolute;left:20px;top:240px}</style><button id="count">Count 0</button><input id="memo" aria-label="Local fixture form"><div id="marker"></div><h3>${title}</h3><script>window.clicks=0;window.ticks=0;document.getElementById('count').addEventListener('click',()=>{window.clicks++;document.getElementById('count').textContent='Count '+window.clicks;document.getElementById('marker').style.background=window.clicks%2?'#ff0000':'#00ff00'});setInterval(()=>window.ticks++,100);</script>`);
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(fixturePort,'127.0.0.1',resolve);});
const site='http://127.0.0.1:'+server.address().port;assert.equal(site,old.fixture.site);
const literal=JSON.stringify;
const js=(fn,...args)=>`(${fn.toString()})(${args.map(literal).join(',')})`;
const ownPrefix=()=>`const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${literal(data)}||E.app.getAppPath()!==${literal(source)})throw Error('Expected isolated F36 App only');`;
const native=async()=>app.mainEvaluate(`(()=>{${ownPrefix()}const shell=E.webContents.getAllWebContents().find(w=>w.getURL().startsWith('file:')&&w.getURL().includes('/out/renderer/index.html'));return {shellId:shell?.id??null,shellURL:shell?.getURL()??'',webContents:E.webContents.getAllWebContents().filter(w=>w===shell||w.getURL().startsWith(${literal(site)})).map(w=>({id:w.id,url:w.getURL(),type:w.getType(),destroyed:w.isDestroyed()})),base:E.BaseWindow.getAllWindows().map(w=>({id:w.id,title:w.getTitle(),visible:w.isVisible(),focused:w.isFocused(),minimized:w.isMinimized(),fullScreen:w.isFullScreen(),bounds:w.getBounds(),children:w.contentView.children.map(v=>({id:v.webContents?.id??null,bounds:v.getBounds(),visible:v.getVisible?.()??null}))})),browserWindowIds:E.BrowserWindow.getAllWindows().map(w=>w.id)}})()`,{label:'f36-owned-native-state'});
const wait=async(fn,desc,timeout=15000)=>{const until=Date.now()+timeout;while(Date.now()<until){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,60));}throw new Error('Timed out: '+desc)};
let shellId;
async function identity(){const s=await native();assert(shellId===undefined||s.shellId===shellId,'same owned shell');assert(s.shellURL.startsWith(pathToFileURL(join(source,'out/renderer/index.html')).href),'isolated shell URL');return s}
async function click(selector,text){
 await identity();
 const locate=()=>app.evaluate(js((sel,txt)=>{const elements=[...document.querySelectorAll(sel)].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.disabled&&(txt===null||e.textContent.trim()===txt)});if(elements.length!==1)return null;const e=elements[0];const r=e.getBoundingClientRect();const x=Math.floor(r.x+r.width/2),y=Math.floor(r.y+r.height/2);if(!e.contains(document.elementFromPoint(x,y)))return null;return{x,y}},selector,text??null));
 let previous=null,stable=0;const point=await wait(async()=>{const next=await locate();if(next&&next.x===previous?.x&&next.y===previous?.y)stable++;else stable=0;previous=next;return stable>=3?next:null},'visible unobscured stable control '+selector,6500);assert.deepEqual(await locate(),point,'control layout stable at dispatch');
 for (const type of ['mousePressed','mouseReleased']) await app.cdp('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
 result.actions.push({stage,selector,text:text??null});await persist();
}
const browserSnapshot=id=>app.invoke('browser.snapshot',{taskId:id});
async function switchTo(id){
 const selector=`[data-testid="sidebar-agent-task"][data-task-id="${id}"]`;
 await app.waitFor(js(s=>!!document.querySelector(s),selector),16000,{navigation:true});await click(selector);await app.waitFor('!!document.querySelector(".agent-task-view textarea")',10000);
}
async function openBrowser(){
 if(!await app.evaluate('!!document.querySelector(".agent-panel-body")')){
  await click('button[title="打开右侧面板"]');await app.waitFor('!!document.querySelector(".agent-panel-body")',8000);
 }
 if(!await app.evaluate('!!document.querySelector(".agent-panel-empty button[title=\\"新建网页标签\\"]")')) await click('button[aria-label="打开面板"]');
 await click('button[title="新建网页标签"]');await app.waitFor('!!document.querySelector("[aria-label=网页地址]")',10000);
}
async function address(id,url){
 assert(url.startsWith(site+'/'));await click('[aria-label="网页地址"]');
 await app.cdp('Input.insertText',{text:url});
 const value=await app.evaluate('document.querySelector("[aria-label=网页地址]").value');check('address-entry-'+new URL(url).pathname,value===url,value);
 await app.cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await app.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 const tab=await wait(async()=>{const s=await browserSnapshot(id);return s.tabs.find(t=>t.id===s.activeId&&t.url===url&&!t.loading&&!t.failure);},'URL completed '+url);
 await wait(async()=>{const s=await native();return s.webContents.find(w=>w.url===url);},'native content present');return tab;
}
async function fixedPage(url,action='read'){
 assert([site+'/a',site+'/b',site+'/reopen',site+'/roundtrip',site+'/abrupt'].includes(url));const capture=['click-capture','capture'].includes(action);
 const response=await app.mainEvaluate(`(async()=>{${ownPrefix()}const w=E.webContents.getAllWebContents().find(v=>!v.isDestroyed()&&v.getURL()===${literal(url)});if(!w)throw Error('Expected fixed local fixture');const read=()=>w.executeJavaScript('({clicks:window.clicks,ticks:window.ticks,memo:document.getElementById("memo").value,cookie:document.cookie,origin:performance.timeOrigin,width:innerWidth,height:innerHeight})');const before=await read();const attachedBefore=w.debugger.isAttached();if(!attachedBefore)w.debugger.attach('1.3');try{if(${literal(action)}!=='read'){await w.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});if(${literal(action)}==='click-capture'||${literal(action)}==='memo'){const point=${literal(action)}==='memo'?{x:80,y:105}:{x:80,y:45};for(const type of ['mousePressed','mouseReleased'])await w.debugger.sendCommand('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});if(${literal(action)}==='memo')await w.debugger.sendCommand('Input.insertText',{text:'synthetic-memo'});}}const after=await read();const photo=${capture}?await w.debugger.sendCommand('Page.captureScreenshot',{format:'png'}):null;return{id:w.id,before,after,attachedBefore,photo:photo?.data??null,pageFocusEmulation:${literal(action)}!=='read'};}finally{if(!attachedBefore&&w.debugger.isAttached())w.debugger.detach();}})()`,{label:'f36-fixed-local-page',timeoutMs:10000});
 if(response.photo){const file=stage+'-'+new URL(url).pathname.slice(1)+'.png';await writeFile(join(root,file),Buffer.from(response.photo,'base64'));result.screenshots.push(file);delete response.photo;response.captureFile=file;}return response;
}
async function shellShot(name){await identity();await app.screenshot(join(root,name+'.png'));result.screenshots.push(name+'.png');}
const collector='/var/folders/xy/r637tyl545g2yc51_mf33l3h0000gn/T/willyou-f36-ultra-root-xfwic3y9/owned-windows';
let launchedMode=null;
async function launch(which){
 mode=which;source=which==='candidate'?'/private/tmp/willyou-f36-ultra-shell-zhom4g00':join(lab,which);shellId=undefined;launchedMode=which;
 app=await openElectron({cwd:source,userData:data,env:{HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),WY_F36_LAB_NONACTIVATE:'1'},inspectMain:true});
 const first=await identity();shellId=first.shellId;check(stage+'-shell',!!shellId);check(stage+'-isolation',(await app.invoke('app.getInfo')).userDataPath===data);
 const geometry=await app.mainEvaluate(`(()=>{${ownPrefix()}const w=E.BaseWindow.getAllWindows().find(x=>x.getTitle()==='WillYou');const ds=E.screen.getAllDisplays(),pri=E.screen.getPrimaryDisplay(),d=ds.find(x=>x.id!==pri.id)||pri;const r=d.workArea;w.setBounds({x:r.x+12,y:r.y+12,width:Math.min(1320,r.width-30),height:Math.min(850,r.height-30)});return {screen:d.id,count:ds.length,bounds:w.getBounds(),focused:w.isFocused(),visible:w.isVisible()}})()`,{label:'ultra-own-window-geometry'});
 await app.cdp('Emulation.setFocusEmulationEnabled',{enabled:true});result.launches.push({stage,mode,pid:app.processId,first,geometry});await persist();
}
async function finish(abrupt=false){
 if(!app)return;const current=app,record=result.launches.at(-1);record.rendererErrors=current.rendererErrors;await writeFile(join(root,`launch-${result.launches.length}.log`),current.logs());
 try{await current.cdp('Emulation.setFocusEmulationEnabled',{enabled:false})}catch{}
 try{await current.mainEvaluate(`(()=>{${ownPrefix()}setTimeout(()=>${abrupt?'E.app.exit(23)':'E.app.quit()'},70);return true})()`,{label:abrupt?'ultra-owned-abrupt-exit':'ultra-owned-normal-quit'});record.requestedExit=abrupt?'app.exit(23)':'app.quit';record.exit=await current.waitForExit(15000);check(stage+'-exit-code',record.exit.code===(abrupt?23:0)&&record.exit.signal===null,record.exit);}catch(e){record.exitError=String(e);try{await current.close();record.fallbackCleanup=true}catch{};throw e}finally{app=undefined;await persist();}
}
async function showSaved(id,url){await switchTo(taskIds[0]);await openBrowser();await click('button[role="tab"][title='+literal(url)+']');let st=await wait(async()=>{const s=await browserSnapshot(taskIds[0]);return s.activeId===id&&s.tabs.some(t=>t.id===id&&!t.loading&&!t.failure)&&!!(await native()).webContents.find(w=>w.url===url)?s:null},'saved tab really materialized');return st;}
async function currentTab(url){const st=await browserSnapshot(taskIds[0]);return st.tabs.find(t=>t.url===url);}
async function osRecord(label,capture=false){
 const state=await identity();const os=JSON.parse(execFileSync(collector,[String(app.processId)],{encoding:'utf8',timeout:3000}));assert.equal(os.ownerPid,app.processId);const item={label,stage,native:state,os};
 if(capture&&os.screenCapturePermission){const nativeMain=state.base.find(x=>x.title==='WillYou');const candidates=os.windows.filter(w=>w.kCGWindowLayer===0&&w.kCGWindowIsOnscreen===true&&w.kCGWindowBounds&&Math.abs(w.kCGWindowBounds.Width-nativeMain.bounds.width)<32&&Math.abs(w.kCGWindowBounds.Height-nativeMain.bounds.height)<32);const exact=candidates.find(x=>x.kCGWindowName==='WillYou')??(candidates.length===1?candidates[0]:null);if(exact){const path=join(root,label+'.png');try{execFileSync('/usr/sbin/screencapture',['-x','-o','-l'+String(exact.kCGWindowNumber),path],{timeout:5000});item.capture=label+'.png';result.screenshots.push(item.capture);}catch(e){item.captureError=String(e.message)}}else item.captureSkipped='owned visible native main window cannot be uniquely identified';}else if(capture)item.captureSkipped='screen recording permission not available; no prompt requested';
 result.system.push(item);await persist();return item;
}
async function stableOS(label,wantFull,capture=true){
 let prior='', streak=0;
 const observation=await wait(async()=>{const n=await identity();const m=n.base.find(x=>x.title==='WillYou');if(!m||m.fullScreen!==wantFull||!m.visible||m.minimized)return false;const os=JSON.parse(execFileSync(collector,[String(app.processId)],{encoding:'utf8',timeout:3000}));assert.equal(os.ownerPid,app.processId);const matches=os.windows.filter(w=>w.kCGWindowName==='WillYou'&&w.kCGWindowLayer===0&&w.kCGWindowIsOnscreen===true&&w.kCGWindowBounds&&Math.abs(w.kCGWindowBounds.Width-m.bounds.width)<6&&Math.abs(w.kCGWindowBounds.Height-m.bounds.height)<6&&Math.abs(w.kCGWindowBounds.X-m.bounds.x)<6&&Math.abs(w.kCGWindowBounds.Y-m.bounds.y)<6);const found=matches.length===1?matches[0]:null;const key=found?JSON.stringify([found.kCGWindowNumber,found.kCGWindowBounds,m.bounds]):'';if(key&&key===prior)streak++;else streak=0;prior=key;if(streak<3){await new Promise(r=>setTimeout(r,220));return false;}return {label,native:n,os,exact:found,streak};},'exact owned stable titled CG window '+label,12000);
 if(capture&&observation.os.screenCapturePermission){const file=label+'.png';execFileSync('/usr/sbin/screencapture',['-x','-o','-l'+String(observation.exact.kCGWindowNumber),join(root,file)],{timeout:5000});observation.capture=file;result.screenshots.push(file);}
 result.system.push(observation);await persist();return observation;
}
async function fullscreenEvent(enter){return app.mainEvaluate(`(async()=>{${ownPrefix()}const w=E.BaseWindow.getAllWindows().find(x=>x.getTitle()==='WillYou');if(!w)throw Error('owned host missing');const event=${literal(enter?'enter-full-screen':'leave-full-screen')};return new Promise((res,rej)=>{const timer=setTimeout(()=>rej(Error('native event timeout '+event)),15000);w.once(event,()=>{clearTimeout(timer);res({event,fullScreen:w.isFullScreen(),bounds:w.getBounds()})});w.setFullScreen(${enter});})})()`,{label:'ultra-owned-fullscreen-event',timeoutMs:20000});}

try{
 taskIds=old.fixture.taskIds;const knownA=old.observations.reopened.newPageId;result.fixture={taskIds,knownA,site};
 for(const mode of ['candidate','baseline']){stage=mode;await launch(mode);await showSaved(knownA,site+'/reopen');const before=await fixedPage(site+'/reopen');await stableOS(mode+'-stable-before',false);if(result.launches.at(-1).geometry.count>1){try{const entered=await fullscreenEvent(true);result.system.push({mode,entered});check(mode+'-actual-enter-event',entered.event==='enter-full-screen'&&entered.fullScreen===true);try{await stableOS(mode+'-stable-fullscreen',true);}catch(e){result.system.push({mode,stableFullscreenMiss:String(e)});}}finally{const left=await fullscreenEvent(false);result.system.push({mode,left});check(mode+'-actual-leave-event',left.event==='leave-full-screen'&&!left.fullScreen);}await stableOS(mode+'-stable-after',false);const after=await fixedPage(site+'/reopen');check(mode+'-page-instance-preserved',before.id===after.id&&before.after.origin===after.after.origin);const clicked=await fixedPage(site+'/reopen','click-capture');check(mode+'-real-fixture-click-after',clicked.after.clicks===clicked.before.clicks+1);}await finish(false);}
 result.status='passed-native-events-and-owned-stability';

}catch(error){result.status='failed';result.failedStage=stage;result.error=String(error.stack??error);if(error.electronStartupLogs!==undefined)await writeFile(join(root,'startup.log'),String(error.electronStartupLogs));if(error.electronStartupProcess)result.startupProcess=error.electronStartupProcess;try{if(app)result.failureNative=await native()}catch{};}
finally{if(app)try{await finish(false)}catch(e){result.cleanupError=String(e)};server.closeAllConnections();await new Promise(r=>server.close(r));result.fixtureServerClosed=true;result.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({root,status:result.status,failedStage:result.failedStage,error:result.error?.slice(0,500),checks:result.checks.length,launches:result.launches.map(x=>({mode:x.mode,exit:x.exit})),system:result.system.filter(x=>x.completed!==undefined),reloadCoherent:result.observations.shellReload?.layoutCoherent}));}
