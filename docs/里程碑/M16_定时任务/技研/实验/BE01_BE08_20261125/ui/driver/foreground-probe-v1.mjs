// F36 development-candidate UI probe. Fixed local fixtures only; no model turn or external site.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const lab='/private/tmp/willyou-f36-lab-tljocnfp';
const [mode='candidate', phase='fresh']=process.argv.slice(2);
assert(['baseline','candidate'].includes(mode));assert(['fresh','startup'].includes(phase));
const source=join(lab,mode), root=await mkdtemp(join(lab,mode+'-ui-'));
const data=join(root,'data'),home=join(root,'home'),projectDir=join(root,'project');
for(const dir of [data,home,projectDir])await mkdir(dir,{mode:0o700});
await writeFile(join(projectDir,'fixture.txt'),'F36 local test file\n');
await writeFile(join(projectDir,'fixture.html'),'<!doctype html><title>F36 local preview</title><h2>F36 HTML preview</h2><p>Fixture only</p>');
const {openElectron}=await import(pathToFileURL(join(source,'scripts/lib/electron-harness.mjs')).href);
const result={mode,phase,variant:'foreground-confirm+native-hide-restore',root,source,layer:'isolated development build with real renderer/preload; fixed local fixtures; not packaged A/S or real Agent R',startedAt:new Date().toISOString(),observations:{},checks:[],actions:[],requests:[],screenshots:[]};
let stage='setup',app,taskIds=[],quitTriggered=false;
const persist=()=>writeFile(join(root,'result.json'),JSON.stringify({...result,stage},null,2)+'\n');
const check=(name,condition,details)=>{result.checks.push({name,ok:!!condition,details});assert(condition,name);};
const server=createServer((req,res)=>{
 const pathname=new URL(req.url,'http://fixture').pathname; result.requests.push({pathname,method:req.method});
 if(!['/a','/b','/reopen','/favicon.ico'].includes(pathname)){res.writeHead(404).end();return;}
 if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 const title=pathname==='/a'?'F36 Page A':pathname==='/b'?'F36 Page B':'F36 Reopened';
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Set-Cookie':'f36_fixture=stable; Path=/; Max-Age=3600; SameSite=Lax'}).end(`<!doctype html><title>${title}</title><style>html,body{margin:0;background:#e1e1e1;font:16px system-ui}button{position:absolute;left:20px;top:20px;width:120px;height:50px}input{position:absolute;left:20px;top:88px;width:140px;height:30px}#marker{position:absolute;left:180px;top:140px;width:90px;height:80px;background:#111111}h3{position:absolute;left:20px;top:240px}</style><button id="count">Count 0</button><input id="memo" aria-label="Local fixture form"><div id="marker"></div><h3>${title}</h3><script>window.clicks=0;window.ticks=0;document.getElementById('count').addEventListener('click',()=>{window.clicks++;document.getElementById('count').textContent='Count '+window.clicks;document.getElementById('marker').style.background=window.clicks%2?'#ff0000':'#00ff00'});setInterval(()=>window.ticks++,100);</script>`);
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const site='http://127.0.0.1:'+server.address().port;
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
async function nativeFront(url){const resolve=async()=>{const n=await identity(),target=n.webContents.find(w=>w.url===url),host=n.base.find(w=>w.title==='WillYou');return target&&host&&host.children.at(-1)?.id===target.id?{n,id:target.id}:null};let last=null;return wait(async()=>{const value=await resolve();const ok=value&&last===value.id;last=value?.id??null;return ok?value:null},'actual active native page '+url,10000);}
async function nativeBehind(url){const resolve=async()=>{const n=await identity(),target=n.webContents.find(w=>w.url===url),host=n.base.find(w=>w.title==='WillYou');if(!target||!host)return null;const demoted=mode==='candidate'?host.children.at(-1)?.id===n.shellId:!host.children.some(v=>v.id===target.id);return demoted?n:null};return wait(resolve,'active native page demoted behind UI',10000);}
async function address(id,url){
 assert(url.startsWith(site+'/'));await click('[aria-label="网页地址"]');
 await app.cdp('Input.insertText',{text:url});
 const value=await app.evaluate('document.querySelector("[aria-label=网页地址]").value');check('address-entry-'+new URL(url).pathname,value===url,value);
 await app.cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await app.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 const tab=await wait(async()=>{const s=await browserSnapshot(id);return s.tabs.find(t=>t.id===s.activeId&&t.url===url&&!t.loading&&!t.failure);},'URL completed '+url);
 await wait(async()=>{const s=await native();return s.webContents.find(w=>w.url===url);},'native content present');const front=await nativeFront(url);check('actual-foreground-'+new URL(url).pathname,!!front,front.n);return tab;
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
 if(phase==='startup'){result.status='passed-startup';}else{
  stage='fixture-setup';
  // A controlled test executable is solely a fixture for idle agent-task records. It never invokes a model or real account.
  const toolPath=join(root,'fixture-codex');await writeFile(toolPath,`#!/bin/sh
case "$*" in
  "--version") printf '%s\\n' 'codex-cli 99.0.0';;
  "login status") printf '%s\\n' 'F36 local fixture (no external account or credentials)';;
  *) printf '%s\\n' 'F36 fixture: runtime commands disabled' >&2; exit 77;;
esac
`,{mode:0o700});
  const detected=await app.invoke('agents.customToolPath','codex',toolPath);const tool=detected.tool;check('local-synthetic-task-fixture',tool?.installed&&tool.login==='local',{kind:tool?.kind,login:tool?.login,version:tool?.version});
  const profile=await app.invoke('agents.save',{name:'F36 UI Fixture',toolId:tool.id,source:'login',isDefault:true});
  const project=await app.invoke('projects.create',{name:'F36 isolated project',aliases:[],description:'local fixture only',rulesPath:null},[{label:'work',path:projectDir}]);const {dirs}=await app.invoke('projects.get',project.id);
  for(const title of ['F36 task A','F36 task B']){const t=await app.invoke('agentTasks.create',{projectId:project.id,dirId:dirs[0].id,cwd:projectDir,title,profileId:profile.id,model:'fixture-model',tier:'ask',carryExtensions:false});taskIds.push(t.taskId);}
  result.fixture={taskIds,projectId:project.id,profileId:profile.id,site};const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${origin}&&!!document.querySelector('[data-testid=sidebar-agent-task]')`,20000,{navigation:true});shellId=(await native()).shellId;await app.cdp('Emulation.setFocusEmulationEnabled',{enabled:true});
  stage='task-a-open';await switchTo(taskIds[0]);await openBrowser();const a=await address(taskIds[0],site+'/a');const aNative=await native();result.observations.aOpen={tab:a,native:aNative};await shellShot('a-shell');
  stage='a-visible-click';let p=await fixedPage(site+'/a','click-capture');check('visible-click-A',p.after.clicks===p.before.clicks+1,p);const aDoc=p.after.origin,aWc=p.id;let memo=await fixedPage(site+'/a','memo');check('fixture-form-input',memo.after.memo==='synthetic-memo',memo.after.memo);result.observations.aForeground=p;
  stage='task-b-open';await switchTo(taskIds[1]);await openBrowser();const b=await address(taskIds[1],site+'/b');result.observations.bOpen={tab:b,native:await native()};await shellShot('b-shell');
  stage='a-background-click';p=await fixedPage(site+'/a','click-capture');check('background-click-A',p.after.clicks===p.before.clicks+1,p);check('A-keeps-native-document',p.id===aWc&&p.after.origin===aDoc&&p.after.memo==='synthetic-memo',p);result.observations.aBackground={page:p,native:await native()};
  stage='a-restore';await switchTo(taskIds[0]);await app.waitFor(js(url=>document.querySelector('[aria-label="网页地址"]')?.value===url,site+'/a'),10000);const frontA=await nativeFront(site+'/a');check('actual-foreground-restore-A',!!frontA,frontA.n);p=await fixedPage(site+'/a','read');check('restore-A-same-page',p.id===aWc&&p.after.origin===aDoc&&p.after.memo==='synthetic-memo',p);result.observations.restored={page:p,native:await native()};
  stage='overlay';await click('[aria-label="浏览器菜单"]');await app.waitFor('!!document.querySelector(".bw-menu")',6000);const parked=await nativeBehind(site+'/a');check('menu-native-demoted',!!parked,parked);result.observations.overlay={native:parked,menu:await app.evaluate('document.querySelector(".bw-menu")?.innerText')};await shellShot('menu-shell');await click('[aria-label="关闭菜单"]');await app.waitFor('!document.querySelector(".bw-menu")',6000);const menuClosed=await nativeFront(site+'/a');check('menu-close-restores-native-front',!!menuClosed,menuClosed.n);
  stage='close-last';await click('.agent-surface-tab button[aria-label^="关闭网页 "]');await wait(async()=>!(await browserSnapshot(taskIds[0])).tabs.length,'closed logical tab');await wait(async()=>!(await native()).webContents.some(w=>w.id===aWc),'old native page disposed');check('closed-tab-not-restored',!(await browserSnapshot(taskIds[0])).tabs.some(t=>t.id===a.id));result.observations.closed={state:await browserSnapshot(taskIds[0]),native:await native()};
  stage='manual-reopen';await openBrowser();const fresh=await address(taskIds[0],site+'/reopen');check('new-logical-id',fresh.id!==a.id);p=await fixedPage(site+'/reopen','read');check('same-profile-cookie-persists',p.after.cookie.includes('f36_fixture=stable'));check('new-native-id',p.id!==aWc);result.observations.reopened={oldPageId:a.id,newPageId:fresh.id,page:p,native:await native()};await shellShot('reopened-shell');
  stage='owned-main-window-hide';const hiddenBefore=await fixedPage(site+'/reopen','read');
  await app.mainEvaluate(`(()=>{${ownPrefix()}const w=E.BaseWindow.getAllWindows().find(x=>x.getTitle()==='WillYou');if(!w)throw Error('owned main host absent');w.hide();return true})()`,{label:'owned-fixture-hide-only'});
  const hidden=await wait(async()=>{const n=await native();const host=n.base.find(x=>x.title==='WillYou');return host&&!host.visible&&!host.focused?n:null},'owned main window hidden');check('owned-window-hide-keeps-page',hidden.webContents.some(x=>x.id===hiddenBefore.id),hidden);
  const hiddenPage=await fixedPage(site+'/reopen','click-capture');check('hidden-page-actual-click-same-document',hiddenPage.id===hiddenBefore.id&&hiddenPage.after.origin===hiddenBefore.after.origin&&hiddenPage.after.clicks===hiddenPage.before.clicks+1,hiddenPage);result.observations.hidden={native:await native(),page:hiddenPage};
  stage='owned-main-window-restore';await app.mainEvaluate(`(()=>{${ownPrefix()}const w=E.BaseWindow.getAllWindows().find(x=>x.getTitle()==='WillYou');if(!w)throw Error('owned main host absent');w.showInactive();return true})()`,{label:'owned-fixture-showInactive-only'});
  const visible=await wait(async()=>{const n=await native();const host=n.base.find(x=>x.title==='WillYou');return host&&host.visible&&!host.focused?n:null},'owned main window visible without activation');const restored=await nativeFront(site+'/reopen');const restoredPage=await fixedPage(site+'/reopen','read');check('own-hide-restore-keeps-native-page',!!restored&&restoredPage.id===hiddenBefore.id&&restoredPage.after.origin===hiddenBefore.after.origin&&restoredPage.after.clicks===hiddenPage.after.clicks);result.observations.windowRestored={native:visible,page:restoredPage};
  result.status='passed-fixture-flow';
 }
}catch(error){result.status='failed';result.failedStage=stage;result.error=String(error.stack??error);if(error.electronStartupLogs!==undefined)await writeFile(join(root,'startup.log'),String(error.electronStartupLogs));if(error.electronStartupProcess)result.startupProcess=error.electronStartupProcess;if(app){try{result.failureDOM=await app.evaluate('document.body.innerText.slice(0,2500)');if(taskIds.length)result.failureBrowserStates=await Promise.all(taskIds.map(browserSnapshot));result.failureNative=await native();await shellShot('failure-shell');}catch(e){result.failureObservationError=String(e)}}}
finally{
 if(app){result.rendererErrors=app.rendererErrors;try{await writeFile(join(root,'electron.log'),app.logs());}catch{};try{await app.cdp('Emulation.setFocusEmulationEnabled',{enabled:false})}catch{};
 try{await app.mainEvaluate(`(()=>{${ownPrefix()}setTimeout(()=>E.app.quit(),50);return true})()`,{label:'f36-owned-normal-quit'});quitTriggered=true;}catch(error){result.quitRequestError=String(error)};
 try{result.exit=await app.waitForExit(15000);}catch(error){result.exitError=String(error);try{await app.close();result.fallbackCleanup=true;}catch(e){result.cleanupError=String(e)}}
 }
 server.closeAllConnections();await new Promise(r=>server.close(r));result.fixtureServerClosed=true;result.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({root,mode,status:result.status,stage:result.failedStage??stage,checks:result.checks.length,error:result.error?.slice(0,500),exit:result.exit,fallback:result.fallbackCleanup}));
}
