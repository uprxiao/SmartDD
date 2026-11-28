// M16 B07 real old-data browser migration — dedicated sealed A42 synthetic copy only. No credentials or live sites.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,realpath,writeFile,cp,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {openElectron,pause} from '/Users/liubu/hx/4.uprxiao/SmartDD/scripts/lib/electron-harness.mjs';
const [candidateArg,pin,mode='forward-only']=process.argv.slice(2);
assert.equal(mode,'forward-only','fresh-root variant is strictly old-to-new and current normal restart; never force a database downgrade');
assert(['forward-only','browser-only-bidirectional','v1-transfer'].includes(mode));assert(/^[a-f0-9]{64}$/.test(pin));
const sealedRoot='/private/tmp/willyou-m16-f36-migration-q727bg0j',root=await mkdtemp('/private/tmp/willyou-m16-f36-migration-fresh-'),home=join(root,'home'),cliHome=join(root,'cli-home'),cwd=join(root,'project');
for(const p of [home,cliHome,cwd])await mkdir(p,{mode:0o700});
let userData=join(root,'old-working-data');
const copy=JSON.parse(await readFile(join(sealedRoot,'copy-evidence.json'),'utf8')),oldBundle='/private/tmp/willyou-m16-old-state-yUD0pJ/WillYou.app',oldPin='697bb2d273a743c22a2d2c2ebc3c509b0fcee3f9c4bbeeb34146c590b2d9afe2';
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex'),candidate=await realpath(candidateArg);assert(candidate==='/Users/liubu/hx/4.uprxiao/SmartDD/release/mac-arm64/WillYou.app'||candidate.startsWith('/private/tmp/willyou-')&&candidate.endsWith('/WillYou.app'));
const sealed=join(sealedRoot,'sealed-old-source-copy'),sourceGate=join(sealed,'.database-access.sqlite'),sourceGateSha=await digest(sourceGate);
const allow=['smartdd.db','Partitions','browser','agents','agent-diffs','app-data','backups','capabilities','imported-keys','plugin-data','plugins','m9-office-jobs','m9-tex-jobs'];
await mkdir(userData,{mode:0o700});
for(const name of allow)await cp(join(sealed,name),join(userData,name),{recursive:true,errorOnExist:true,force:false,dereference:false});
assert.equal(await digest(join(userData,'smartdd.db')),copy.sourceDbSha,'original sealed synthetic business database exact');
assert.equal(await digest(sourceGate),sourceGateSha,'original bound gate preserved');
await writeFile(join(root,'fresh-import.json'),JSON.stringify({sealed,userData,allow,sourceDbSha:copy.sourceDbSha,sourceGateSha,message:'fresh never-initialized root, original gate not copied or altered; old package creates its own'},null,2));
assert.equal(await digest(join(oldBundle,'Contents/Resources/app.asar')),oldPin);assert.equal(await digest(join(candidate,'Contents/Resources/app.asar')),pin);
const seed=JSON.parse(await readFile('/private/tmp/willyou-m16-schedule-app-US7kWL/migration-qRwq6b/old-data-evidence.json','utf8'));
const origin='http://127.0.0.1:3425',url=name=>origin+'/f36-seed/'+name;
const report={schema:'M16-F36-B07-migration-a',root,userData,copyEvidence:join(root,'fresh-import.json'),candidate,pin,oldBundle,oldPin,mode,actions:[],checks:[],requests:[],launches:[],persistence:[],sourceBoundary:'sealed A42 isolated actual old seed; byte-exact synthetic business DB and allowlisted persistent folders in a new never-initialized root; original path/inode gate retained and old App creates its own; actual old UI generates new data; combined whole-app downgrade excluded'};
const persist=()=>writeFile(join(root,'B07-migration-result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
let app,executable,stage='setup',originToken='synthetic-f36-migration';
const page=(path,title,logged=false)=>'<!doctype html><meta charset="utf-8"><title>'+title+'</title><style>body{font:16px system-ui;background:#d9faf4;padding:20px}input{width:240px}button{margin:8px}#mark{background:#119b89;color:white;padding:16px}</style><h1 id="mark">'+title+'</h1><label>表单 <input id="form" aria-label="未提交表单"></label><p id="session">'+(logged?'SYNTHETIC_LOGIN_OK':'SYNTHETIC_LOGIN_NONE')+'</p><button id="login" type="button">合成登录</button><button id="advance" type="button">进入历史页</button><button id="back" type="button">返回</button><button id="async" type="button">异步操作</button><p id="counter">0</p><p id="response">idle</p><script>window.docMarker=crypto.randomUUID();window.ticks=0;document.querySelector("#login").onclick=async()=>{const r=await fetch("/fixture-login",{method:"POST"});if(r.ok)document.querySelector("#session").textContent="SYNTHETIC_LOGIN_OK";};setInterval(()=>{document.querySelector("#counter").textContent=String(++window.ticks)},100);document.querySelector("#advance").onclick=()=>{history.pushState({test:1},"",location.pathname+"?step=2");document.querySelector("#mark").textContent+=" • step 2";};document.querySelector("#back").onclick=()=>history.back();document.querySelector("#async").onclick=async()=>{document.querySelector("#response").textContent="pending";const r=await fetch("/async/"+encodeURIComponent(location.pathname));document.querySelector("#response").textContent=await r.text()};</script>';
const server=createServer(async(req,res)=>{const u=new URL(req.url??'/',origin);if(u.origin!==origin){res.writeHead(403).end('isolated fixture only');return;}const p=u.pathname,logged=(req.headers.cookie??'').split(';').map(x=>x.trim()).includes('wy_fixture_login='+originToken);report.requests.push({stage,path:p,method:req.method,logged,at:Date.now()});
 if(p==='/fixture-login'&&req.method==='POST'){res.writeHead(200,{'Set-Cookie':'wy_fixture_login='+originToken+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400','Content-Type':'text/plain','Cache-Control':'no-store'}).end('SYNTHETIC_LOGIN_OK');return;}
 if(p==='/a42-browser'){res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'}).end(page(p,'A42 migration page',logged));return;}
 const matched=p.match(/^\/f36-seed\/([ABCD])$/);if(matched){res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'}).end(page(p,'测试页面 '+matched[1],logged));return;}if(p==='/favicon.ico'){res.writeHead(404).end();return;}res.writeHead(404).end('only isolated synthetic page');});
server.on('connect',(_req,socket)=>socket.destroy());
server.listen({host:'127.0.0.1',port:3425,exclusive:true});await once(server,'listening');assert.equal(server.address().port,3425);
const js=(fn,...args)=>'('+fn.toString()+')(...'+JSON.stringify(args)+')';
async function until(fn,label,ms=12000){const limit=Date.now()+ms;let last;while(Date.now()<limit){last=await fn();if(last)return last;await pause(60);}throw Error('Timeout: '+label+' last='+JSON.stringify(last));}
const snapshot=id=>app.invoke('browser.snapshot',{taskId:id});
const agentSnapshot=id=>app.invoke('agentTasks.snapshot',id);
const sidebar=id=>'[data-testid="sidebar-agent-task"][data-task-id="'+id+'"]';
const shellGuard=(fn,...args)=>js((pid,exe,data,homePath,source,args)=>{
 const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');
 if(process.pid!==pid||process.execPath!==exe||E.app.getPath('userData')!==data||process.env.HOME!==homePath)throw Error('isolated candidate identity mismatch');
 return (0,eval)('('+source+')')(E,...args);
},app.processId,executable,userData,home,fn.toString(),args);
const observeMain=(fn,...args)=>app.mainEvaluate(shellGuard(fn,...args),{label:'f36-candidate-observation'});
async function windows(){return observeMain(E=>E.BaseWindow.getAllWindows().filter(w=>!w.isDestroyed()).map(w=>{const children=w.contentView.children.filter(v=>v.webContents&&!v.webContents.isDestroyed()).map(v=>({id:v.webContents.id,url:v.webContents.getURL(),visible:v.getVisible?.()??null,bounds:v.getBounds()}));const native=w.webContents;if(native&&!native.isDestroyed()&&/\/out\/renderer\/index\.html(?:[?#]|$)/.test(native.getURL())&&!children.some(c=>c.id===native.id)){const b=w.getContentBounds();children.unshift({id:native.id,url:native.getURL(),visible:w.isVisible(),bounds:{x:0,y:0,width:b.width,height:b.height},source:'actual pre-M16 BrowserWindow native shell webContents'});}return {id:w.id,title:w.getTitle(),visible:w.isVisible(),minimized:w.isMinimized(),bounds:w.getBounds(),children};}))}
async function bind(){report.pid=await observeMain(()=>process.pid);return report.pid;}
async function shellClick(selector,label=null,{allowKeyboardAlternative=false}={}){
 const getPoint=()=>app.evaluate(js((query,text)=>{
  const nodes=[...document.querySelectorAll(query)].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.matches(':disabled')&&(text===null||e.textContent.trim()===text);});
  if(nodes.length!==1)return null;
  const e=nodes[0];e.scrollIntoView({behavior:'instant',block:'nearest'});const r=e.getBoundingClientRect(),x=Math.floor(r.x+r.width/2),y=Math.floor(r.y+r.height/2);
  return e.contains(document.elementFromPoint(x,y))?{x,y}:null;
 },selector,label));
 let previous=null;const point=await until(async()=>{const value=await getPoint();const stable=Boolean(value&&previous&&value.x===previous.x&&value.y===previous.y);previous=value;return stable?value:null},'own visible UI two stable geometry observations '+selector+':'+label,8000);assert.deepEqual(await getPoint(),point);
 // The shell view must still be anchored in an actively visible root; verify front overlap when a native page is present.
 let occlusion=null;const checkOcclusion=async()=>{const native=await windows();const shell=native.flatMap(w=>w.children.filter(c=>/\/out\/renderer\/index\.html(?:[?#]|$)/.test(c.url)).map(c=>({w,c})));
  assert.equal(shell.length,1,'unique shell');assert(shell[0].w.visible&&!shell[0].w.minimized);
  occlusion=shell[0].w.children.slice(shell[0].w.children.indexOf(shell[0].c)+1).filter(child=>{const r=child.bounds;return child.visible!==false&&point.x>=r.x&&point.x<r.x+r.width&&point.y>=r.y&&point.y<r.y+r.height;});
  return !occlusion.length;
 };
 const guardStart=Date.now();
 try{await until(checkOcclusion,'native view clear for shell hit test '+selector,1500);}catch(error){
  report.occlusion??=[];report.occlusion.push({stage,selector,label,point,elapsedMs:Date.now()-guardStart,occlusion,native:await windows(),at:Date.now()});await persist();
  try{await app.screenshot(join(root,'native-occlusion-'+report.occlusion.length+'.png'));}catch{}
  if(allowKeyboardAlternative&&occlusion?.length)return false;
  throw error;
 }
 assert.deepEqual(await getPoint(),point,'same real UI click target after native clearance');
 if(selector.includes('agent-panel-menu')){report.menuHitTests??=[];report.menuHitTests.push({stage,selector,label,point,elapsedMs:Date.now()-guardStart,native:await windows(),at:Date.now()});await persist();}
 for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});
 report.actions.push({stage,kind:'UI-click',selector,label,point,at:Date.now()});await persist();return true;
}
async function keypress(key,modifiers=0,code=key){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,modifiers,...(key==='Enter'?{windowsVirtualKeyCode:13,...(type==='keyDown'?{text:'\r'}:{})}:/^[bfdt]$/i.test(key)?{windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0),...(type==='keyDown'?{text:key}:{})}:{})});}
async function field(selector,text){
 await shellClick(selector);for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:4,...(type==='keyDown'?{commands:['selectAll']}:{})});await app.cdp('Input.insertText',{text});
 await app.waitFor(js((s,t)=>document.querySelector(s)?.value===t,selector,text),8000);
}
async function switchTask(id){await app.waitFor(js(s=>!!document.querySelector(s),sidebar(id)),15000,{navigation:true});await shellClick(sidebar(id));await app.waitFor('!!document.querySelector(".agent-task-view textarea")',10000);}
async function openPanel(){if(!await app.evaluate('Boolean(document.querySelector("[data-testid=agent-workspace-panel]"))'))await shellClick('button[title="打开右侧面板"]');await app.waitFor('Boolean(document.querySelector("[data-testid=agent-workspace-panel]"))',5000);}
async function newTab(id,expected){
 await openPanel();
 const n=(await snapshot(id)).tabs.length;
 await shellClick('button[aria-label="打开面板"]');const clicked=await shellClick('.agent-panel-menu button[title="新建网页标签"]',null,{allowKeyboardAlternative:true});
 if(!clicked){await keypress('b',0,'KeyB');report.actions.push({stage,kind:'existing-menu-shortcut',key:'B',reason:'native occlusion recorded as independent B09.4 failure',at:Date.now()});await persist();}
 const created=await until(async()=>{const s=await snapshot(id);return s.tabs.length===n+1&&s.activeId?s:null;},'new UI tab');
 if(expected){await field('[aria-label="网页地址"]',expected);await keypress('Enter');await until(async()=>{const s=await snapshot(id);const t=s.tabs.find(t=>t.id===s.activeId);return (t?.pendingUrl===expected||t?.url===expected)?t:null},'URL submitted',3000);return await awaitPage(id,expected);}
 return created.activeId;
}
async function awaitPage(id,expected,requiredPageId=null){
 const state=await until(async()=>{const s=await snapshot(id),t=s.tabs.find(t=>t.id===s.activeId);return t?.url===expected&&!t.loading&&!t.failure&&(!requiredPageId||t.id===requiredPageId)?t:null;},'selected browser page '+expected,20000);
 await app.waitFor(js((url,task)=>{const w=document.querySelector('.bw-workspace');return w?.dataset.browserTask===task&&w.querySelector('[aria-label="网页地址"]')?.value===url&&w.getBoundingClientRect().width>0;},expected,id),10000);
 const native=await until(async()=>{const views=await windows();const w=views.find(w=>w.children.some(v=>/\/out\/renderer\/index\.html/.test(v.url)));const j=w?.children.findIndex(v=>/\/out\/renderer\/index\.html/.test(v.url));const front=j>=0?w.children.slice(j+1).filter(v=>v.url===expected&&v.visible!==false&&v.bounds.width>0):[];return front.length===1?front[0]:null;},'actual front view '+expected,15000);
 return {id:state.id,url:expected,profile:state.profileId,wc:native.id,bounds:native.bounds};
}
async function nativeState(page){
 return observeMain(async(E,id,expected)=>{const w=E.webContents.fromId(id);if(!w||w.isDestroyed()||!w.getURL().startsWith(expected))throw Error('Fixture native WC changed');return {id:w.id,process:w.getOSProcessId(),url:w.getURL(),page:await w.executeJavaScript('({marker:window.docMarker,ticks:window.ticks,form:document.querySelector("#form")?.value,history:history.length,response:document.querySelector("#response")?.textContent,session:document.querySelector("#session")?.textContent,title:document.title})')};},page.wc,origin);
}
async function nativeInput(page,method,params){
 assert(method.startsWith('Input.'),'Native page input only');
 return observeMain(async(E,id,expected,method,params)=>{
  const w=E.webContents.fromId(id);if(!w||w.isDestroyed()||!w.getURL().startsWith(expected))throw Error('Fixture native identity mismatch');
  const front=E.BaseWindow.getAllWindows().some(root=>{const c=root.contentView.children;let widx=c.findIndex(v=>v.webContents?.id===id);let shell=c.findIndex(v=>/\/out\/renderer\/index\.html/.test(v.webContents?.getURL?.()??''));const nativeShell=root.webContents&&!root.webContents.isDestroyed()&&/\/out\/renderer\/index\.html/.test(root.webContents.getURL());return root.isVisible()&&!root.isMinimized()&&widx>=0&&(widx>shell&&(shell>=0||nativeShell))&&c[widx].getVisible?.()!==false&&c.slice(widx+1).every(v=>v.getVisible?.()===false);});
  if(!front||!w.debugger.isAttached())throw Error('Fixture page is not active front native view');
  return w.debugger.sendCommand(method,params);
 },page.wc,origin,method,params);
}
async function pageClick(p,selector){
 const point=await observeMain(async(E,id,expected,selector)=>{const w=E.webContents.fromId(id);if(!w||w.isDestroyed()||!w.getURL().startsWith(expected))throw Error('wrong own site');return w.executeJavaScript('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)return null;const r=e.getBoundingClientRect(),x=Math.floor(r.x+r.width/2),y=Math.floor(r.y+r.height/2);return r.width>0&&r.height>0&&e.contains(document.elementFromPoint(x,y))?{x,y}:null})()');},p.wc,origin,selector);assert(point,'page control visible');
 for(const type of ['mouseMoved','mousePressed','mouseReleased'])await nativeInput(p,'Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});
 report.actions.push({stage,kind:'native-page-click',wc:p.wc,selector,point,at:Date.now()});await persist();
}
async function chooseTab(id,p){await shellClick('[role="tab"][title='+JSON.stringify(p.url)+']');return awaitPage(id,p.url);}
async function useBrowserControl(names){
 const actual=await until(()=>app.evaluate(js(names=>{const all=[...document.querySelectorAll('.bw-workspace button')];const valid=all.filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.disabled&&names.includes(e.title||e.getAttribute('aria-label')||e.textContent.trim())});if(valid.length!==1)return null;const e=valid[0];return e.title?{attribute:'title',value:e.title}:e.getAttribute('aria-label')?{attribute:'aria-label',value:e.getAttribute('aria-label')}:{attribute:'text',value:e.textContent.trim()};},names)),'one normal browser control '+names.join('/'),6000);
 if(actual.attribute==='text')await shellClick('.bw-workspace button',actual.value);else await shellClick('.bw-workspace button['+actual.attribute+'='+JSON.stringify(actual.value)+']');
}

async function runApp(bundle,expected,label){
 assert(!app);assert.equal(await digest(join(bundle,'Contents/Resources/app.asar')),expected);executable=join(bundle,'Contents/MacOS/WillYou');stage=label;
 app=await openElectron({userData,executable,cwd:root,env:{HOME:home,SMARTDD_CLI_HOME:cliHome,CODEX_HOME:join(cliHome,'.codex'),CLAUDE_CONFIG_DIR:join(cliHome,'.claude'),XDG_CONFIG_HOME:join(home,'.config'),HTTP_PROXY:origin,HTTPS_PROXY:origin,ALL_PROXY:origin,NO_PROXY:'127.0.0.1,localhost'},inspectMain:true});
 const pid=await bind();await until(async()=>{const actual=await windows();return actual.some(w=>w.visible&&!w.minimized&&w.children.some(c=>/\/out\/renderer\/index\.html/.test(c.url)))},'actual isolated visible trusted shell',15000);report.launches.push({label,pid,bundle,expected,exeSha:await digest(executable),at:Date.now()});await persist();return pid;
}
async function quit(){const live=app;assert(live);await observeMain(E=>{setTimeout(()=>E.app.quit(),50);return true});try{const exit=await live.waitForExit(20000);report.launches.at(-1).exit=exit;assert.equal(exit.code,0);assert.equal(exit.signal,null);}catch(error){report.launches.at(-1).quitError=String(error.message);await live.close();throw error;}finally{await writeFile(join(root,stage+'-electron.log'),live.logs(),{mode:0o600});app=null;await persist();}}
function diskState(offline=false){const code=`import sqlite3,json,sys
p=sys.argv[1]
with sqlite3.connect('file:'+p+'?mode=ro'+('&immutable=1' if sys.argv[2]=='offline' else ''),uri=True) as db:
 print(json.dumps({'version':{(41,1795392000000,41):40,(42,1795617766866,42):41}.get(tuple(db.execute('select count(*),max(created_at),max(id) from __drizzle_migrations').fetchone())), 'userVersionPragma':db.execute('pragma user_version').fetchone()[0], 'migrationState':db.execute('select count(*),max(created_at),max(id) from __drizzle_migrations').fetchone(),'integrity':db.execute('pragma integrity_check').fetchall() if sys.argv[2]=='offline' else [],'workspaces':{k.split(':',1)[1]:json.loads(v) for k,v in db.execute("select key,value from app_settings where key like 'browserWorkspace.v1:%'")}},ensure_ascii=False))`;return JSON.parse(execFileSync('/usr/bin/python3',['-c',code,join(userData,'smartdd.db'),offline?'offline':'live'],{encoding:'utf8'}));}
const trimmed=s=>({version:s.version,activeId:s.activeId,tabs:s.tabs.map(({id,url,profileId,title})=>({id,url,profileId,title})),closed:s.closed.map(({id,url,profileId,title})=>({id,url,profileId,title}))});
async function closePage(task,page,title){await shellClick('button[aria-label="关闭网页 '+title+'"]');await until(async()=>{const s=await snapshot(task);return !s.tabs.some(t=>t.id===page.id)&&(!s.activeId||s.tabs.some(t=>t.id===s.activeId))?s:null},'closed logical page and valid active selection');await until(async()=>!await observeMain((E,id)=>{const w=E.webContents.fromId(id);return Boolean(w&&!w.isDestroyed())},page.wc),'actual closed own page native disposed',15000);}
async function exactSaved(task,state,stageLabel){const live=await snapshot(task),d=diskState().workspaces[task];assert.deepEqual(trimmed(d),trimmed(state));assert.deepEqual(live.tabs.map(t=>t.id),state.tabs.map(t=>t.id));assert.equal(live.activeId,state.activeId);report.persistence.push({label:stageLabel,task,disk:trimmed(d),actualTabIds:live.tabs.map(t=>t.id)});await persist();return live;}
async function revealSaved(task,target,label){
 const original=diskState().workspaces[task];assert(original.tabs.some(t=>t.id===target.id));
 const prior=await snapshot(task);assert.deepEqual(prior.tabs.map(t=>t.id),original.tabs.map(t=>t.id));assert.equal(prior.activeId,original.activeId);
 const visible=await app.evaluate(js(url=>Array.from(document.querySelectorAll('[role=tab]')).some(el=>el.title===url&&el.getBoundingClientRect().width>0),target.url));
 let added=null,blankBefore=null;
 if(!visible){ // The old UI only reveals saved browser tabs after the explicit browser add control.
  added=await newTab(task,null);assert(!original.tabs.some(t=>t.id===added));
  const withBlank=await snapshot(task);const blank=withBlank.tabs.find(t=>t.id===added);assert.equal(blank.url,'about:blank');blankBefore={id:blank.id,url:blank.url,profileId:blank.profileId,title:blank.title};
 }
 const page=await chooseTab(task,target);assert.equal(page.id,target.id);assert.equal(page.profile,target.profileId);
 if(added){const c=await snapshot(task);assert.equal(c.activeId,target.id);await shellClick('button[aria-label="关闭网页 新标签页"]');await until(async()=>{const a=await snapshot(task);return !a.tabs.some(t=>t.id===added)&&a.activeId===target.id?a:null},'explicitly closed only UI created placeholder');}
 const observed=diskState().workspaces[task];assert.deepEqual(trimmed(observed).tabs,trimmed(original).tabs);assert.equal(observed.activeId,target.id);
 const expectedHistory=added?[...trimmed(original).closed,blankBefore].slice(-10):trimmed(original).closed;
 assert.deepEqual(trimmed(observed).closed,expectedHistory);report.revealActions??=[];report.revealActions.push({label,task,existingTarget:target.id,original:trimmed(original),explicitPlaceholder:added,observed:trimmed(observed)});await persist();return page;
}
async function verifyTask(task,saved,expectLogin,label){await switchTask(task);await openPanel();await exactSaved(task,saved,label+'-before-select');const target=saved.tabs.find(t=>t.id===saved.activeId);const loaded=await revealSaved(task,target,label);assert.equal(loaded.id,target.id);assert.equal(loaded.profile,target.profileId);const actual=await nativeState(loaded);assert.equal(actual.page.session,expectLogin?'SYNTHETIC_LOGIN_OK':'SYNTHETIC_LOGIN_NONE');assert.equal(actual.url,target.url);return actual;}
let t1=seed.task.id,t2,oldState,afterCandidate,oldVersion;
try{
 await runApp(oldBundle,oldPin,'old-enrich');oldVersion=diskState().version;assert.equal(oldVersion,40);
 await switchTask(t1);await openPanel();const oldBaseline=await revealSaved(t1,seed.oldTab,'old-seed-real-ui-reveal');assert.equal(oldBaseline.id,seed.oldTab.id);assert.equal(oldBaseline.profile,seed.oldTab.profileId);
 const a=await newTab(t1,url('A'));await pageClick(a,'#login');await until(async()=>{const s=await nativeState(a);return s.page.session==='SYNTHETIC_LOGIN_OK'?s:null},'actual synthetic login cookie only');const b=await newTab(t1,url('B'));assert.equal((await nativeState(b)).page.session,'SYNTHETIC_LOGIN_OK');await closePage(t1,b,'测试页面 B');await chooseTab(t1,a);
 const p=await app.invoke('projects.create',{name:'F36 migration second identity',aliases:[],description:'',rulesPath:null},[{label:'independent synthetic project',path:cwd}]);const {dirs}=await app.invoke('projects.get',p.id);
 t2=(await app.invoke('agentTasks.create',{projectId:p.id,dirId:dirs[0].id,cwd,title:'F36 independent migration task',profileId:seed.profileId,tier:'ask',carryExtensions:false})).taskId;
 await app.cdp('Page.reload');await switchTask(t2);const second=await newTab(t2,url('A'));const read2=await nativeState(second);assert.notEqual(second.profile,a.profile);assert.equal(read2.page.session,'SYNTHETIC_LOGIN_NONE');
 oldState=diskState();assert.equal(oldState.workspaces[t1].closed.filter(t=>t.id===b.id).length,1);assert(!oldState.workspaces[t1].tabs.some(t=>t.id===b.id));assert.equal(oldState.workspaces[t1].activeId,a.id);report.oldEnriched={t1,t2,oldBaseline,a,b,second,read2,disk:oldState};await app.screenshot(join(root,'B07-old-enriched.png'));await persist();await quit();
 const oldOffline=diskState(true);assert.deepEqual(oldOffline.integrity,[['ok']]);assert.deepEqual(oldOffline.workspaces,oldState.workspaces);await cp(userData,join(root,'sealed-old-enriched'),{recursive:true,errorOnExist:true,force:false,dereference:false});report.oldEnrichedDbSha=await digest(join(userData,'smartdd.db'));await persist();
 const seedLoginCount=report.requests.filter(r=>r.path==='/fixture-login').length;
 await runApp(candidate,pin,'candidate-forward');const actual1=await verifyTask(t1,oldState.workspaces[t1],true,'candidate-positive');const actual2=await verifyTask(t2,oldState.workspaces[t2],false,'candidate-independent');assert.equal(report.requests.filter(r=>r.path==='/fixture-login').length,seedLoginCount,'candidate did not resend login');report.checks.push({name:'B07.1-forward-real-old-state-cookie-history',status:'pass',actual1,actual2});const forwardAfterReveal=diskState();await persist();
 // Legitimate candidate writes and closure; second task unchanged. Retain both schema and true old-app boundary.
 await switchTask(t1);await openPanel();const c=await newTab(t1,url('C'));const d=await newTab(t1,url('D'));await chooseTab(t1,c);await closePage(t1,c,'测试页面 C');await chooseTab(t1,d);afterCandidate=diskState();assert.equal(afterCandidate.workspaces[t1].closed.filter(t=>t.id===c.id).length,1);assert(!afterCandidate.workspaces[t1].tabs.some(t=>t.id===c.id));assert.deepEqual(trimmed(afterCandidate.workspaces[t2]),trimmed(forwardAfterReveal.workspaces[t2]));report.candidateWrites={c,d,disk:afterCandidate};await persist();await quit();
 const finalOffline=diskState(true);assert.deepEqual(finalOffline.integrity,[['ok']]);assert.deepEqual(finalOffline.workspaces,afterCandidate.workspaces);report.candidateDbSha=await digest(join(userData,'smartdd.db'));await cp(userData,join(root,'sealed-candidate-written'),{recursive:true,errorOnExist:true,force:false,dereference:false});await persist();
 let expectedRestart=afterCandidate;
 if(mode==='browser-only-bidirectional'&&afterCandidate.version===oldVersion){await runApp(oldBundle,oldPin,'old-read-candidate');const legacy1=await verifyTask(t1,afterCandidate.workspaces[t1],true,'legacy-positive');const legacy2=await verifyTask(t2,afterCandidate.workspaces[t2],false,'legacy-independent');await quit();report.checks.push({name:'B07.2-old-readable-browser-only-schema',status:'pass',legacy1,legacy2});}
 else if(mode==='v1-transfer'){
  const oldClone=join(root,'old-v1-transfer'),candidateClone=join(root,'candidate-v1-reimport');await cp(join(root,'sealed-old-enriched'),oldClone,{recursive:true,errorOnExist:true,force:false,dereference:false});await cp(join(root,'sealed-candidate-written'),candidateClone,{recursive:true,errorOnExist:true,force:false,dereference:false});
  const keys=['browserWorkspace.v1:'+t1,'browserWorkspace.v1:'+t2,'browserRecent.v1:'+seed.projectId,'browserRecent.v1:'+p.id,'browserProfiles.v1'],profiles=[oldState.workspaces[t1].tabs[0].profileId,oldState.workspaces[t2].tabs[0].profileId];
  const transplant=(from,to,backup,version)=>JSON.parse(execFileSync('/usr/bin/python3',['/private/tmp/willyou-m16-f36-qa/transfer-v1-fixture.py',from,to,backup,JSON.stringify(keys),JSON.stringify(profiles),String(version)],{encoding:'utf8'}));
  report.transfers=[transplant(join(root,'sealed-candidate-written'),oldClone,join(root,'pre-v1-old'),oldVersion)];await persist();
  userData=oldClone;await runApp(oldBundle,oldPin,'old-read-v1-transfer');const legacy1=await verifyTask(t1,afterCandidate.workspaces[t1],true,'legacy-v1-positive');const legacy2=await verifyTask(t2,afterCandidate.workspaces[t2],false,'legacy-v1-independent');
  await switchTask(t1);await openPanel();const oldNew=await newTab(t1,url('B'));assert.notEqual(oldNew.id,b.id);await chooseTab(t1,d);await closePage(t1,d,'测试页面 D');await chooseTab(t1,oldNew);const legacyWritten=diskState();assert.equal(legacyWritten.workspaces[t1].closed.filter(t=>t.id===d.id).length,1);assert.deepEqual(trimmed(legacyWritten.workspaces[t2]),trimmed(oldState.workspaces[t2]));await quit();
  report.transfers.push(transplant(oldClone,candidateClone,join(root,'pre-v1-candidate'),afterCandidate.version));userData=candidateClone;expectedRestart=legacyWritten;
  report.checks.push({name:'B07.2-scoped-v1-read-and-old-written-return',status:'pending-final-candidate-read',legacy1,legacy2,oldNew,legacyWritten,boundary:'exact isolated fixture v1 rows/partition transfer, old and candidate schema remain respective versions; no whole-App downgrade claim'});await persist();
 }else report.checks.push({name:'B07.2-reverse',status:'not-run',reason:'whole M16 candidate is not approved old whole-app downgrade; F36 standalone schema-compatible build required',oldVersion,candidateVersion:afterCandidate.version});
 await runApp(candidate,pin,'candidate-normal-restart');const restored1=await verifyTask(t1,expectedRestart.workspaces[t1],true,'candidate-restart-positive');const restored2=await verifyTask(t2,expectedRestart.workspaces[t2],false,'candidate-restart-independent');if(mode==='v1-transfer'){const c=report.checks.find(c=>c.name==='B07.2-scoped-v1-read-and-old-written-return');c.status='pass';c.candidateReturned={restored1,restored2};await persist();}assert.equal(report.requests.filter(r=>r.path==='/fixture-login').length,seedLoginCount);await app.screenshot(join(root,'B07-candidate-restart.png'));await quit();const endState=diskState(true);assert.deepEqual(endState.integrity,[['ok']]);report.checks.push({name:'B07.3-normal-restart-subset',status:'pass',restored1,restored2,integrity:endState.integrity,coverage:'normal restart only; controlled physical-close-in-progress abort/stale refs and profile import separate'});report.status='subset-pass';
}catch(error){report.error=String(error.stack??error);report.status='subset-fail';if(app){try{await app.screenshot(join(root,stage+'-failed.png'));}catch{}try{await quit();}catch{}}}
finally{report.sourceGateUnchanged=await digest(sourceGate)===sourceGateSha;server.closeAllConnections();await new Promise(ok=>server.close(ok));report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({root,status:report.status,checks:report.checks.map(c=>c.name+':'+c.status),error:report.error}));if(report.status!=='subset-pass')process.exitCode=1;}
