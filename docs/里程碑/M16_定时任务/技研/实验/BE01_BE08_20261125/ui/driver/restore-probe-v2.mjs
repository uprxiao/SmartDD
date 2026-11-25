// F36 development-candidate UI probe. Fixed local fixtures only; no model turn or external site.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile, readFile, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const lab='/private/tmp/willyou-f36-lab-tljocnfp';
const [mode='candidate', oldName='baseline-ui-pTkUvV']=process.argv.slice(2);const phase='restore';
assert(['baseline','candidate'].includes(mode));assert(/^baseline-ui-[A-Za-z0-9]+$/.test(oldName));const oldRoot=join(lab,oldName);const old=JSON.parse(await readFile(join(oldRoot,'result.json'),'utf8'));assert(old.status==='passed-fixture-flow'&&old.exit.code===0&&old.mode==='baseline'&&old.fixture.site.startsWith('http://127.0.0.1:'));
const fixturePort=Number(new URL(old.fixture.site).port);
const source=join(lab,mode), root=await mkdtemp(join(lab,mode+'-ui-'));
const data=join(root,'data'),home=join(root,'home'),projectDir=join(root,'project');
for(const dir of [data,home,projectDir])await mkdir(dir,{mode:0o700});
await writeFile(join(projectDir,'fixture.txt'),'F36 local test file\n');
await writeFile(join(projectDir,'fixture.html'),'<!doctype html><title>F36 local preview</title><h2>F36 HTML preview</h2><p>Fixture only</p>');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const oldDbHash=sha(await readFile(join(oldRoot,'data','smartdd.db')));
const copied=['smartdd.db','Partitions','capabilities','backups','browser','plugin-data','plugins','imported-keys','app-data','Local Storage','Local State','Preferences'];
for(const name of copied)await cp(join(oldRoot,'data',name),join(data,name),{recursive:true,force:false,errorOnExist:true});
const copyDbHash=sha(await readFile(join(data,'smartdd.db')));assert.equal(oldDbHash,copyDbHash);
const ownerFile=JSON.parse(await readFile(join(data,'capabilities','.store-id.json'),'utf8'));const dbOwner=execFileSync('/usr/bin/sqlite3',['-readonly',join(data,'smartdd.db'),'SELECT store_id,maintenance_state FROM capability_store_state WHERE singleton=1'],{encoding:'utf8'}).trim();const copiedOwnerMatches=dbOwner===ownerFile.storeId+'|ready';assert(copiedOwnerMatches,'old DB and resource ownership must remain consistent');
const {openElectron}=await import(pathToFileURL(join(source,'scripts/lib/electron-harness.mjs')).href);
const result={mode,phase,root,source,layer:'isolated development build with real renderer/preload; fixed local fixtures; not packaged A/S or real Agent R',startedAt:new Date().toISOString(),observations:{},checks:[],actions:[],requests:[],screenshots:[],oldDataSource:{oldRoot,oldDbHash,copyDbHash,copied,copiedOwnerMatches,otherCachesAndRuntimeNotCopied:true}};
let stage='setup',app,taskIds=[],quitTriggered=false;
const persist=()=>writeFile(join(root,'result.json'),JSON.stringify({...result,stage},null,2)+'\n');
const check=(name,condition,details)=>{result.checks.push({name,ok:!!condition,details});assert(condition,name);};
const server=createServer((req,res)=>{
 const pathname=new URL(req.url,'http://fixture').pathname; result.requests.push({pathname,method:req.method,oldFixtureCookieSent:(req.headers.cookie??'').split(';').some(v=>v.trim()==='f36_fixture=stable')});
 if(!['/a','/b','/reopen','/favicon.ico'].includes(pathname)){res.writeHead(404).end();return;}
 if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 const title=pathname==='/a'?'F36 Page A':pathname==='/b'?'F36 Page B':'F36 Reopened';
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(`<!doctype html><title>${title}</title><style>html,body{margin:0;background:#e1e1e1;font:16px system-ui}button{position:absolute;left:20px;top:20px;width:120px;height:50px}input{position:absolute;left:20px;top:88px;width:140px;height:30px}#marker{position:absolute;left:180px;top:140px;width:90px;height:80px;background:#111111}h3{position:absolute;left:20px;top:240px}</style><button id="count">Count 0</button><input id="memo" aria-label="Local fixture form"><div id="marker"></div><h3>${title}</h3><script>window.clicks=0;window.ticks=0;document.getElementById('count').addEventListener('click',()=>{window.clicks++;document.getElementById('count').textContent='Count '+window.clicks;document.getElementById('marker').style.background=window.clicks%2?'#ff0000':'#00ff00'});setInterval(()=>window.ticks++,100);</script>`);
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(fixturePort,'127.0.0.1',resolve);});
const site='http://127.0.0.1:'+server.address().port;assert.equal(site,old.fixture.site);
const literal=JSON.stringify;
const js=(fn,...args)=>`(${fn.toString()})(${args.map(literal).join(',')})`;
const ownPrefix=()=>`const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${literal(data)}||E.app.getAppPath()!==${literal(source)})throw Error('Expected isolated F36 App only');`;
const native=async()=>app.mainEvaluate(`(()=>{${ownPrefix()}const shell=E.webContents.getAllWebContents().find(w=>w.getURL().startsWith('file:')&&w.getURL().includes('/out/renderer/index.html'));return {shellId:shell?.id??null,shellURL:shell?.getURL()??'',webContents:E.webContents.getAllWebContents().filter(w=>w===shell||w.getURL().startsWith(${literal(site)})).map(w=>({id:w.id,url:w.getURL(),type:w.getType(),destroyed:w.isDestroyed()})),base:E.BaseWindow.getAllWindows().map(w=>({id:w.id,title:w.getTitle(),visible:w.isVisible(),focused:w.isFocused(),minimized:w.isMinimized(),bounds:w.getBounds(),children:w.contentView.children.map(v=>({id:v.webContents?.id??null,bounds:v.getBounds(),visible:v.getVisible?.()??null}))})),browserWindowIds:E.BrowserWindow.getAllWindows().map(w=>w.id)}})()`,{label:'f36-owned-native-state'});
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
 assert([site+'/a',site+'/b',site+'/reopen'].includes(url));const capture=['click-capture','capture'].includes(action);
 const response=await app.mainEvaluate(`(async()=>{${ownPrefix()}const w=E.webContents.getAllWebContents().find(v=>!v.isDestroyed()&&v.getURL()===${literal(url)});if(!w)throw Error('Expected fixed local fixture');const read=()=>w.executeJavaScript('({clicks:window.clicks,ticks:window.ticks,memo:document.getElementById("memo").value,cookie:document.cookie,origin:performance.timeOrigin,width:innerWidth,height:innerHeight})');const before=await read();const attachedBefore=w.debugger.isAttached();if(!attachedBefore)w.debugger.attach('1.3');try{if(${literal(action)}!=='read'){await w.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});if(${literal(action)}==='click-capture'||${literal(action)}==='memo'){const point=${literal(action)}==='memo'?{x:80,y:105}:{x:80,y:45};for(const type of ['mousePressed','mouseReleased'])await w.debugger.sendCommand('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});if(${literal(action)}==='memo')await w.debugger.sendCommand('Input.insertText',{text:'synthetic-memo'});}}const after=await read();const photo=${capture}?await w.debugger.sendCommand('Page.captureScreenshot',{format:'png'}):null;return{id:w.id,before,after,attachedBefore,photo:photo?.data??null,pageFocusEmulation:${literal(action)}!=='read'};}finally{if(!attachedBefore&&w.debugger.isAttached())w.debugger.detach();}})()`,{label:'f36-fixed-local-page',timeoutMs:10000});
 if(response.photo){const file=stage+'-'+new URL(url).pathname.slice(1)+'.png';await writeFile(join(root,file),Buffer.from(response.photo,'base64'));result.screenshots.push(file);delete response.photo;response.captureFile=file;}return response;
}
async function shellShot(name){await identity();await app.screenshot(join(root,name+'.png'));result.screenshots.push(name+'.png');}
try{
 stage='startup';await persist();app=await openElectron({cwd:source,userData:data,env:{HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),WY_F36_LAB_NONACTIVATE:'1'},inspectMain:true});result.appPid=app.processId;
 const first=await identity();shellId=first.shellId;check('shell-mounted',!!shellId);result.observations.startup=first;
 result.observations.appInfo=await app.invoke('app.getInfo');check('isolated-app-info',result.observations.appInfo.userDataPath===data);
 result.observations.display=await app.mainEvaluate(`(()=>{${ownPrefix()}const w=E.BaseWindow.getAllWindows().find(x=>x.getTitle()==='WillYou');const displays=E.screen.getAllDisplays(),primary=E.screen.getPrimaryDisplay();if(!w)throw Error('Own main window absent');const target=displays.find(d=>d.id!==primary.id)||primary;const r=target.workArea;w.setBounds({x:r.x+12,y:r.y+12,width:Math.min(1320,r.width-30),height:Math.min(850,r.height-30)});return{count:displays.length,screen:target.id,scale:target.scaleFactor,bounds:w.getBounds(),visible:w.isVisible(),focused:w.isFocused()}})()`,{label:'f36-own-window-geometry'});
 await app.cdp('Emulation.setFocusEmulationEnabled',{enabled:true});result.shellFocusEmulation=true;await shellShot('main-home');await persist();
 stage='restored-sqlite';taskIds=old.fixture.taskIds;result.fixture={taskIds,projectId:old.fixture.projectId,profileId:old.fixture.profileId,site};
 const before=await Promise.all(taskIds.map(browserSnapshot));result.observations.restoredLogical=before;
 const knownA=old.observations.reopened.newPageId,knownB=old.observations.bOpen.tab.id,closedA=old.observations.reopened.oldPageId;
 check('old-A-logical-id-restored',before[0].tabs.length===1&&before[0].activeId===knownA&&before[0].tabs[0].url===site+'/reopen');
 check('old-B-logical-id-restored',before[1].tabs.length===1&&before[1].activeId===knownB&&before[1].tabs[0].url===site+'/b');
 check('closed-A-not-reopened',!before[0].tabs.some(t=>t.id===closedA));check('same-old-profile-ids',before[0].tabs[0].profileId===old.observations.aOpen.tab.profileId&&before[1].tabs[0].profileId===old.observations.bOpen.tab.profileId);
 for (const [index,url,known] of [[0,site+'/reopen',knownA],[1,site+'/b',knownB]]){
   stage='restore-ui-task-'+index;await switchTo(taskIds[index]);await openBrowser(); // Existing UI exposes old tabs when opening the browser panel; this action intentionally adds one blank tab.
   await click('button[role="tab"][title='+literal(url)+']');await wait(async()=>{const s=await browserSnapshot(taskIds[index]);return s.activeId===known&&s.tabs.some(t=>t.id===known&&!t.loading&&!t.failure)&&!!(await native()).webContents.find(w=>w.url===url)},'materialized restored tab');
   await wait(async()=>{const p=await fixedPage(url,'read').catch(()=>null);return p?.after.width&&p},'restored fixture document');const page=await fixedPage(url,'read');
   check('old-cookie-from-disk-task-'+index,page.after.cookie.includes('f36_fixture=stable')&&result.requests.some(r=>r.pathname===new URL(url).pathname&&r.oldFixtureCookieSent),page.after);
   check('recreated-live-document-'+index,page.after.clicks===0&&page.after.memo==='');result.observations['restoredTask'+index]={page,native:await native()};await shellShot('restored-task-'+index);
 }
 stage='files-html-preview';await click('button[aria-label="打开面板"]');await click('button[title="文件"]');await click('button[role="treeitem"][data-file-path$="/fixture.html"]');
 await wait(async()=>await app.evaluate('!!document.querySelector(".fw-html-preview")||!!document.querySelector("button[aria-label=查看文档]")'), 'html file content');
 if(!await app.evaluate('!!document.querySelector(".fw-html-preview")'))await click('button[aria-label="查看文档"]');
 await app.waitFor('!!document.querySelector(".fw-html-preview .sr-only")',13000);
 const html=await app.mainEvaluate(`(async()=>{${ownPrefix()}const child=E.webContents.getAllWebContents().find(x=>!x.isDestroyed()&&x.getTitle()==='F36 local preview');if(!child)throw Error('Fixed HTML preview missing');const w=E.BaseWindow.getAllWindows().find(x=>x.getTitle()==='WillYou');const view=w.contentView.children.find(v=>v.webContents===child);if(!view)throw Error('HTML native view not attached');const page=await child.executeJavaScript('({text:document.body.innerText,width:innerWidth,height:innerHeight})');const photo=await child.capturePage();return {id:child.id,rect:view.getBounds(),page,photo:photo.toPNG().toString('base64')}})()`,{label:'f36-owned-html-preview-read',timeoutMs:10000});
 check('html-preview-actual-render',html.page.text.includes('F36 HTML preview')&&html.rect.width>1&&html.rect.height>1,html.page);await writeFile(join(root,'html-preview.png'),Buffer.from(html.photo,'base64'));result.screenshots.push('html-preview.png');delete html.photo;result.observations.htmlPreview={...html,native:await native()};await shellShot('files-html-shell');
 stage='browser-after-html';await click('button[role="tab"][title='+literal(site+'/b')+']');await app.waitFor('!!document.querySelector("[aria-label=网页地址]")',8000);const page=await fixedPage(site+'/b','read');check('browser-after-html-same-document',page.id===result.observations.restoredTask1.page.id&&page.after.origin===result.observations.restoredTask1.page.after.origin);result.observations.browserAfterHtml={page,native:await native()};
 result.status='passed-restore-compat';
}catch(error){result.status='failed';result.failedStage=stage;result.error=String(error.stack??error);if(error.electronStartupLogs!==undefined)await writeFile(join(root,'startup.log'),String(error.electronStartupLogs));if(error.electronStartupProcess)result.startupProcess=error.electronStartupProcess;if(app){try{result.failureDOM=await app.evaluate('document.body.innerText.slice(0,2500)');if(taskIds.length)result.failureBrowserStates=await Promise.all(taskIds.map(browserSnapshot));result.failureNative=await native();await shellShot('failure-shell');}catch(e){result.failureObservationError=String(e)}}}
finally{
 if(app){result.rendererErrors=app.rendererErrors;try{await writeFile(join(root,'electron.log'),app.logs());}catch{};try{await app.cdp('Emulation.setFocusEmulationEnabled',{enabled:false})}catch{};
 try{await app.mainEvaluate(`(()=>{${ownPrefix()}setTimeout(()=>E.app.quit(),50);return true})()`,{label:'f36-owned-normal-quit'});quitTriggered=true;}catch(error){result.quitRequestError=String(error)};
 try{result.exit=await app.waitForExit(15000);}catch(error){result.exitError=String(error);try{await app.close();result.fallbackCleanup=true;}catch(e){result.cleanupError=String(e)}}
 }
 server.closeAllConnections();await new Promise(r=>server.close(r));result.fixtureServerClosed=true;result.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({root,mode,status:result.status,stage:result.failedStage??stage,checks:result.checks.length,error:result.error?.slice(0,500),exit:result.exit,fallback:result.fallbackCleanup}));
}
