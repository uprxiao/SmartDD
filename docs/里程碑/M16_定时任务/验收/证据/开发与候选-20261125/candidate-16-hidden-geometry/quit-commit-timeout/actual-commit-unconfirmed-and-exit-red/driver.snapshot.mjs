// M16 B10.4 C16 actual normal app.quit with one exact lost commit delivery fault; ordinary native browser page and local pending read. No OS dialogs or fake reply.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,realpath,writeFile,cp,stat,lstat,readdir,unlink,copyFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {openElectron,pause} from '/Users/liubu/hx/4.uprxiao/SmartDD/scripts/lib/electron-harness.mjs';
const [candidateArg,pin,rootArg]=process.argv.slice(2);assert(process.argv.includes('--authorized-private-quit-commit-fault'));assert.equal(rootArg,'/private/tmp/willyou-m16-f36-profile-c12-PFTcb8');assert.equal(pin,'2146bbb1f62ed73f4b5b7c622958ee45cd68aa09f8e8b259bef07a7506bfedf7');
const root=await realpath(rootArg),home=join(root,'home'),cliHome=join(root,'cli-home'),cwd=join(root,'project'),userData=join(root,'data');assert.equal(root,rootArg);
for(const target of [home,cliHome,cwd,userData,join(userData,'Partitions')]){const s=await lstat(target);assert(s.isDirectory()&&!s.isSymbolicLink());assert.equal(await realpath(target),target);}
const earlierPath='/private/tmp/willyou-m16-schedule-app-US7kWL/profile-clone-fault-EEFs3h/result.json',previous=JSON.parse(await readFile(earlierPath,'utf8'));assert.equal(previous.root,root);assert.equal(previous.pin,pin);assert.equal(previous.status,'pass-B07.4-actual-clone-failure-retry-only');assert(previous.launches.length===2&&previous.launches.every(x=>x.exit.code===0&&x.exit.signal===null));const previouslyClean=JSON.parse(await readFile('/private/tmp/willyou-m16-schedule-app-US7kWL/profile-clone-fault-EEFs3h/independent-cleanup-and-boundaries.json','utf8'));assert(previouslyClean.independentExactPortsNoListeners.every(x=>x.lsofCode===1&&x.noListenerOutput));
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex'),candidate=await realpath(candidateArg);assert.equal(candidate,'/Users/liubu/hx/4.uprxiao/SmartDD/release/mac-arm64/WillYou.app');assert.equal(await digest(join(candidate,'Contents/Resources/app.asar')),pin);
const evidenceRoot=await mkdtemp('/private/tmp/willyou-m16-schedule-app-US7kWL/quit-commit-fault-');
const origin='http://127.0.0.1:3425',url=name=>origin+'/f36-seed/'+name;
const report={root,evidenceRoot,pin,fixture:previous.fixture,priorResultSha:await digest(earlierPath),driverSha256:await digest(new URL(import.meta.url).pathname),launches:[],checks:[],actions:[],requests:[],status:'running',scope:'actual C16, exact prior synthetic browser data; real normal app quit and one isolated commit event delivery fault, actual FileCloseCoordinator timeout/resume, original real UI/HTTP/native page persists, final normal quit. No native system choice, no fake replies.'};
const persist=()=>writeFile(join(evidenceRoot,'result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
await copyFile(new URL(import.meta.url).pathname,join(evidenceRoot,'driver.snapshot.mjs'));await persist();
const strippedEnvNames=Object.keys(process.env).filter(n=>/(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH_SOCK)/i.test(n));for(const name of strippedEnvNames)delete process.env[name];report.strippedEnvNames=strippedEnvNames;
let app,executable,stage='setup',originToken='synthetic-f36-profile-local-only',ownedHttpReads=[];
const page=(path,title,logged=false)=>'<!doctype html><meta charset="utf-8"><title>'+title+'</title><style>body{font:16px system-ui;background:#d9faf4;padding:20px}input{width:240px}button{margin:8px}#mark{background:#119b89;color:white;padding:16px}</style><h1 id="mark">'+title+'</h1><label>表单 <input id="form" aria-label="未提交表单"></label><p id="session">'+(logged?'SYNTHETIC_LOGIN_OK':'SYNTHETIC_LOGIN_NONE')+'</p><button id="login" type="button">合成登录</button><button id="advance" type="button">进入历史页</button><button id="back" type="button">返回</button><button id="async" type="button">异步操作</button><p id="counter">0</p><p id="response">idle</p><script>window.docMarker=crypto.randomUUID();window.ticks=0;document.querySelector("#login").onclick=async()=>{const r=await fetch("/fixture-login",{method:"POST"});if(r.ok)document.querySelector("#session").textContent="SYNTHETIC_LOGIN_OK";};setInterval(()=>{document.querySelector("#counter").textContent=String(++window.ticks)},100);document.querySelector("#advance").onclick=()=>{history.pushState({test:1},"",location.pathname+"?step=2");document.querySelector("#mark").textContent+=" • step 2";};document.querySelector("#back").onclick=()=>history.back();document.querySelector("#async").onclick=async()=>{document.querySelector("#response").textContent="pending";const r=await fetch("/async/"+encodeURIComponent(location.pathname));document.querySelector("#response").textContent=await r.text()};</script>';
const server=createServer(async(req,res)=>{const u=new URL(req.url??'/',origin);if(u.origin!==origin){res.writeHead(403).end('isolated fixture only');return;}const p=u.pathname,logged=(req.headers.cookie??'').split(';').map(x=>x.trim()).includes('wy_fixture_login='+originToken);report.requests.push({stage,path:p,method:req.method,logged,at:Date.now()});
 if(p==='/v1/responses'&&req.method==='POST'){
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>100000){res.writeHead(413).end();return;}chunks.push(chunk);}
  const b=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(b.model!=='m16-codex-one'||b.input!=='Call the wy_ping tool exactly once.'||!(b.tools??[]).some(t=>t.name==='wy_ping')){res.writeHead(400).end('{}');return;}
  const item={type:'function_call',call_id:'call-probe',name:'wy_ping',arguments:'{}'},id='resp_'+randomUUID();
  res.writeHead(200,{'content-type':'text/event-stream'});const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
  event('response.created',{response:{id,status:'in_progress'}});event('response.output_item.done',{item});event('response.completed',{response:{id,status:'completed',output:[item]}});report.providerChecks??=[];report.providerChecks.push({model:b.model,probe:'synthetic loopback wy_ping only'});res.end();return;
 }
 if(p.startsWith('/async/')&&req.method==='GET'){
  const target=decodeURIComponent(p.slice('/async/'.length));if(target!=='/f36-seed/A'){res.writeHead(403).end('only exact private browser page read');return;}
  const entry={id:ownedHttpReads.length+1,target,logged,startedAt:Date.now(),closedAt:null,aborted:false,releasedAt:null,response:res};ownedHttpReads.push(entry);
  res.on('close',()=>{entry.closedAt=Date.now();entry.aborted=!res.writableEnded});
  // Test fixture holds an actual HTTP read; no artificial product completion.
  return;
 }
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
  try{await app.screenshot(join(evidenceRoot,'native-occlusion-'+report.occlusion.length+'.png'));}catch{}
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
 const pid=await bind();await until(async()=>{const actual=await windows();return actual.some(w=>w.visible&&!w.minimized&&w.children.some(c=>/\/out\/renderer\/index\.html/.test(c.url)))},'actual isolated visible trusted shell',15000);report.launches.push({label,pid,bundle,expected,exeSha:await digest(executable),port:app.port??null,mainPort:app.mainPort??null,at:Date.now()});await persist();return pid;
}
async function quit(){const live=app;assert(live);await observeMain(E=>{setTimeout(()=>E.app.quit(),50);return true});try{const exit=await live.waitForExit(20000);report.launches.at(-1).exit=exit;assert.equal(exit.code,0);assert.equal(exit.signal,null);}catch(error){report.launches.at(-1).quitError=String(error.message);await live.close();throw error;}finally{await writeFile(join(evidenceRoot,stage+'-electron.log'),live.logs(),{mode:0o600});app=null;await persist();}}
function diskState(offline=false){const code=`import sqlite3,json,sys
p=sys.argv[1]
with sqlite3.connect('file:'+p+'?mode=ro'+('&immutable=1' if sys.argv[2]=='offline' else ''),uri=True) as db:
 print(json.dumps({'version':{(41,1795392000000,41):40,(42,1795617766866,42):41}.get(tuple(db.execute('select count(*),max(created_at),max(id) from __drizzle_migrations').fetchone())), 'userVersionPragma':db.execute('pragma user_version').fetchone()[0], 'migrationState':db.execute('select count(*),max(created_at),max(id) from __drizzle_migrations').fetchone(),'integrity':db.execute('pragma integrity_check').fetchall() if sys.argv[2]=='offline' else [],'workspaces':{k.split(':',1)[1]:json.loads(v) for k,v in db.execute("select key,value from app_settings where key like 'browserWorkspace.v1:%'")}},ensure_ascii=False))`;return JSON.parse(execFileSync('/usr/bin/python3',['-c',code,join(userData,'smartdd.db'),offline?'offline':'live'],{encoding:'utf8'}));}
const trimmed=(s,taskId)=>({activeId:s.activeId,tabs:s.tabs.map(({id,url,profileId,title})=>({id,url,profileId,title})),closed:diskState().workspaces[taskId].closed.map(({id,url,profileId,title})=>({id,url,profileId,title}))});
async function closePage(task,page,title){await shellClick('button[aria-label="关闭网页 '+title+'"]');await until(async()=>{const s=await snapshot(task);return !s.tabs.some(t=>t.id===page.id)&&(!s.activeId||s.tabs.some(t=>t.id===s.activeId))?s:null},'closed logical page and valid active selection');await until(async()=>!await observeMain((E,id)=>{const w=E.webContents.fromId(id);return Boolean(w&&!w.isDestroyed())},page.wc),'actual closed own page native disposed',15000);}
const profileRows=async task=>(await app.invoke('browser.profileSiteStates',{taskId:task})).map(x=>({id:x.profile.id,label:x.profile.label,scope:x.profile.scope,owner:x.profile.owner,importState:x.importState}));
const dlg='[role=dialog][aria-label="登录态管理"]';
async function openProfiles(){await shellClick('.bw-profile');await app.waitFor(js(q=>Boolean(document.querySelector(q)),dlg),15000);}
async function profilePick(row){const label=await app.evaluate(js((q,l)=>{const el=Array.from(document.querySelectorAll(q+' [role=option]')).filter(x=>x.querySelector('strong')?.textContent===l);if(el.length!==1)return null;return el[0].textContent.trim()},dlg,row.label));assert(label,'unique actual profile option');await shellClick(dlg+' [role=option]',label);await app.waitFor(js((q,l)=>document.querySelector(q+' [aria-selected=true] strong')?.textContent===l,dlg,row.label),10000);}
async function done(){await shellClick(dlg+' button','完成');await app.waitFor(js(q=>!document.querySelector(q),dlg),10000);}
async function actionButton(text){await shellClick(dlg+' button',text);}
async function sameNative(task,p,prior){const current=await chooseTab(task,p);const state=await nativeState(current);assert.equal(current.id,p.id);assert.equal(current.profile,p.profile);assert.equal(current.wc,p.wc);assert.equal(state.page.marker,prior.page.marker);assert.equal(state.page.form,prior.page.form);assert.equal(state.page.session,prior.page.session);return state;}
async function retired(p){await until(async()=>!await observeMain((E,id)=>{const w=E.webContents.fromId(id);return Boolean(w&&!w.isDestroyed());},p.wc),'old actual native WC physically retired',15000);}
async function newProfileAction(task,oldRows,predicate,text){await actionButton(text);const rows=await until(async()=>{const a=await profileRows(task);return a.length===oldRows.length+1&&a.find(x=>!oldRows.some(y=>x.id===y.id)&&predicate(x))?a:null},'new actual profile row',30000);const added=rows.find(x=>!oldRows.some(y=>x.id===y.id));assert.equal(added.scope,'isolated');assert.equal(added.owner.kind,'task');assert.equal(added.owner.id,task);await app.waitFor(js((q,l)=>Array.from(document.querySelectorAll(q+' [role=option] strong')).some(e=>e.textContent===l),dlg,added.label),15000);return added;}
async function apply(task,p,row){await profilePick(row);await actionButton('用于当前页面');await app.waitFor(js(q=>!document.querySelector(q+' button:disabled')||Array.from(document.querySelectorAll(q+' button')).some(x=>x.textContent.trim()==='完成'&&!x.disabled),dlg),45000);await until(async()=>{const s=await snapshot(task);return s.tabs.find(t=>t.id===p.id)?.profileId===row.id},'actual profile bound to same logical page',20000);await done();const rebound=await awaitPage(task,p.url,p.id);assert.equal(rebound.profile,row.id);assert.notEqual(rebound.wc,p.wc);await retired(p);return rebound;}
async function actionAvailable(text){return app.evaluate(js((q,t)=>Array.from(document.querySelectorAll(q+' button')).filter(e=>e.textContent.trim()===t).map(e=>({disabled:e.disabled,label:e.textContent.trim()})),dlg,text));}
async function record(name,data){report.checks.push({name,status:'pass',...data});await persist();}
const {t1,t2}=previous.fixture;assert.equal(t1,'f401d1a9-3370-4f03-907d-5efb9da3d627');assert.equal(t2,'b3797b6c-b5a6-438b-86cb-2f837011ad81');
const tracePath=join(evidenceRoot,'actual-close-handshake.json');
let gateInstalled=false,gateDisabled=false;
const plainHttp=()=>ownedHttpReads.map(({response,...row})=>row);
async function selectSaved(task,p){
 const visible=await app.evaluate(js(u=>Array.from(document.querySelectorAll('[role=tab]')).some(e=>e.title===u&&e.getBoundingClientRect().width>0),p.url));let placeholder=null;
 if(!visible){placeholder=await newTab(task,null);assert.notEqual(placeholder,p.id);assert.equal((await snapshot(task)).tabs.find(t=>t.id===placeholder).url,'about:blank')}
 const actual=await chooseTab(task,p);assert.equal(actual.id,p.id);assert.equal(actual.profile,p.profileId);
 if(placeholder){await shellClick('button[aria-label="关闭网页 新标签页"]');await until(async()=>{const s=await snapshot(task);return !s.tabs.some(t=>t.id===placeholder)&&s.activeId===p.id},'close only explicit own empty placeholder')}
 return actual;
}
function sameDoc(a,b){assert.equal(a.id,b.id);assert.equal(a.process,b.process);assert.equal(a.url,b.url);for(const k of ['marker','form','history','session','title'])assert.equal(a.page[k],b.page[k],k+' changed');}
async function heldRead(p,n){
 await pageClick(p,'#async');const entry=await until(()=>{const e=ownedHttpReads[n-1];return e&&e.target==='/f36-seed/A'&&!e.closedAt?e:null},'actual original browser read reaches exact local fixture',6000);assert.equal(entry.id,n);assert(entry.logged);assert.equal((await nativeState(p)).page.response,'pending');return entry;
}
async function sendQuit(){return observeMain(E=>{setTimeout(()=>E.app.quit(),30);return true})}
async function installGate(page){
 const state=await observeMain((E,traceFile,pageId,expectedPageUrl)=>{
  const fs=process.getBuiltinModule('fs'),path=process.getBuiltinModule('path'),base=path.dirname(traceFile);
  if(!/^\/private\/tmp\/willyou-m16-schedule-app-US7kWL\/quit-commit-fault-[A-Za-z0-9]+$/.test(base)||fs.realpathSync(base)!==base||path.basename(traceFile)!=='actual-close-handshake.json')throw Error('invalid private evidence path');
  const candidates=E.BaseWindow.getAllWindows().filter(w=>!w.isDestroyed()).flatMap(w=>w.contentView.children.filter(c=>c.webContents&&!c.webContents.isDestroyed()&&/\/out\/renderer\/index\.html(?:[?#]|$)/.test(c.webContents.getURL())).map(c=>({w,wc:c.webContents})));
  if(candidates.length!==1)throw Error('unique trusted test shell required');const {w,wc}=candidates[0],browser=E.webContents.fromId(pageId);
  if(!browser||browser.isDestroyed()||browser.getURL()!==expectedPageUrl||!w.contentView.children.some(v=>v.webContents===browser))throw Error('original private page identity unavailable');
  if(globalThis.__m16PrivateCommitGate)throw Error('private gate already installed');
  const frame=wc.mainFrame,owner={wc:wc.id,frameProcess:frame.processId,frameRouting:frame.routingId,root:w.id,pid:process.pid,page:pageId};
  const originalSend=wc.send,oldDescriptor=Object.getOwnPropertyDescriptor(wc,'send'),handlerName='files.answerClose',originalAnswer=E.ipcMain._invokeHandlers.get(handlerName);
  if(typeof originalSend!=='function'||typeof originalAnswer!=='function')throw Error('original IPC contract unavailable');
  const gate={rows:[],owner,faultEnabled:true,faultUsed:false,originalSend,oldDescriptor,originalAnswer,wc,w,browser,frame};
  const write=()=>fs.writeFileSync(traceFile,JSON.stringify({owner,rows:gate.rows,faultEnabled:gate.faultEnabled,faultUsed:gate.faultUsed},null,2),{mode:0o600});
  const append=row=>{gate.rows.push({at:Date.now(),...row});write()};
  const sendWrapper=function(channel,...args){
   if(this!==wc)return originalSend.call(this,channel,...args);
   if(channel==='files:close-request'&&args.length===1&&args[0]&&typeof args[0].id==='string'&&['save','discard','commit','resume'].includes(args[0].action)){
    if(wc.isDestroyed()||wc.mainFrame!==frame)throw Error('original test shell changed');
    const request=args[0],drop=gate.faultEnabled&&!gate.faultUsed&&request.action==='commit';if(drop)gate.faultUsed=true;
    append({kind:'delivery',id:request.id,action:request.action,dropped:drop,originalArgsUnchanged:!drop});
    if(drop)return undefined; // exact message omitted; don't invent any successful/failed reply.
   }
   return originalSend.call(this,channel,...args);
  };
  const answerWrapper=async(event,...args)=>{
   if(event.sender!==wc||event.senderFrame!==frame)return originalAnswer(event,...args);
   const reply=args[0];const row={kind:'actual-reply',id:reply?.id,ready:reply?.ready,failureCount:reply?.failures?.length,frameProcess:event.senderFrame.processId,frameRouting:event.senderFrame.routingId,at:Date.now(),originalReturned:false};
   gate.rows.push(row);write();try{const actual=await originalAnswer(event,...args);row.originalReturned=true;row.resultUnmodified=true;write();return actual}catch(error){row.originalError=String(error.message??error).slice(0,300);write();throw error}
  };
  gate.sendWrapper=sendWrapper;gate.answerWrapper=answerWrapper;
  const observeBefore=event=>append({kind:'app-before-quit',defaultPrevented:event.defaultPrevented??null});const observeWill=()=>append({kind:'app-will-quit'});const observePageDestroyed=()=>append({kind:'native-page-destroyed',wc:browser.id});const observeRootClosed=()=>append({kind:'root-closed',root:w.id});
  gate.observeBefore=observeBefore;gate.observeWill=observeWill;gate.observePageDestroyed=observePageDestroyed;gate.observeRootClosed=observeRootClosed;
  globalThis.__m16PrivateCommitGate=gate;
  Object.defineProperty(wc,'send',{configurable:true,writable:true,value:sendWrapper});
  E.ipcMain.removeHandler(handlerName);E.ipcMain.handle(handlerName,answerWrapper);
  E.app.on('before-quit',observeBefore);E.app.on('will-quit',observeWill);browser.on('destroyed',observePageDestroyed);w.on('closed',observeRootClosed);
  append({kind:'installed-private-one-commit-delivery-fault',owner});
  return {owner,sendBound:wc.send===sendWrapper,replyBound:E.ipcMain._invokeHandlers.get(handlerName)===answerWrapper};
 },tracePath,page.wc,page.url);
 assert(state.sendBound&&state.replyBound);assert.equal(state.owner.page,page.wc);gateInstalled=true;await record('exact-isolated-main-delivery-gate-installed',state);
}
const getTrace=async()=>JSON.parse(await readFile(tracePath,'utf8'));
async function disableGate(){
 const actual=await observeMain(E=>{const g=globalThis.__m16PrivateCommitGate;if(!g||!g.faultUsed||!g.faultEnabled||g.wc.isDestroyed()||g.wc.mainFrame!==g.frame)throw Error('original one-time gate state changed');g.faultEnabled=false;return {disabled:true,originalSendUsedForAllFuture:g.wc.send===g.sendWrapper,actualReplyPassthrough:E.ipcMain._invokeHandlers.get('files.answerClose')===g.answerWrapper}});
 assert(actual.disabled&&actual.actualReplyPassthrough);gateDisabled=true;await record('fault-disabled-before-normal-quit',actual);
}
async function restoreGate(){
 if(!gateInstalled||!app)return;
 const actual=await observeMain(E=>{const g=globalThis.__m16PrivateCommitGate;if(!g)return {alreadyAbsent:true};if(!g.wc.isDestroyed()&&g.wc.send===g.sendWrapper){if(g.oldDescriptor)Object.defineProperty(g.wc,'send',g.oldDescriptor);else delete g.wc.send}
  if(E.ipcMain._invokeHandlers.get('files.answerClose')===g.answerWrapper){E.ipcMain.removeHandler('files.answerClose');E.ipcMain.handle('files.answerClose',g.originalAnswer)}
  E.app.removeListener('before-quit',g.observeBefore);E.app.removeListener('will-quit',g.observeWill);if(!g.browser.isDestroyed())g.browser.removeListener('destroyed',g.observePageDestroyed);if(!g.w.isDestroyed())g.w.removeListener('closed',g.observeRootClosed);delete globalThis.__m16PrivateCommitGate;
  return {originalSendRestored:g.wc.isDestroyed()||g.wc.send===g.originalSend,originalAnswerRestored:E.ipcMain._invokeHandlers.get('files.answerClose')===g.originalAnswer}});
 gateInstalled=false;report.cleanupGate=actual;await persist();
}
try{
 const prior=diskState(true);assert.deepEqual(prior.integrity,[['ok']]);assert.deepEqual(prior.workspaces,previous.beforeFinalQuit.workspaces);report.priorPrivateWorkspaces=prior.workspaces;
 await runApp(candidate,pin,'quit-commit-unconfirmed-c16');
 for(const id of [t1,t2]){const task=await agentSnapshot(id);assert(!['working','waiting'].includes(task.status),'avoid native busy dialog; already-tested A26 intentionally not repeated');}
 const preflightFailure=JSON.parse(await readFile('/private/tmp/willyou-m16-schedule-app-US7kWL/quit-commit-fault-nQnNfZ/result.json','utf8'));assert(preflightFailure.error.includes("No handler registered for 'tasks.list'")&&preflightFailure.actions.length===0&&preflightFailure.launches[0].exit.code===0&&preflightFailure.httpReads.length===0);const currentTasks=await app.invoke('agentTasks.list');assert(Array.isArray(currentTasks));assert(currentTasks.length===2&&currentTasks.every(t=>[t1,t2].includes(t.taskId??t.id)),'exact original two synthetic tasks');assert(currentTasks.every(t=>!['working','waiting'].includes(t.status)),'no actual busy Agent task in isolated root');await record('current-real-agent-task-list-guard',{ids:currentTasks.map(t=>t.taskId??t.id),statuses:currentTasks.map(t=>t.status),priorExactOwnedAppNormalExitWithoutBusyDialog:true,noTerminalCreatedByDriver:true,priorAbsentLegacyRpcFailure:'quit-commit-fault-nQnNfZ'});
 await switchTask(t1);await openPanel();const a0=prior.workspaces[t1].tabs.find(x=>x.url===url('A'));assert(a0&&a0.profileId==='project-65e56a6b31b9e275107f1194');
 const A=await selectSaved(t1,a0);assert.equal((await nativeState(A)).page.session,'SYNTHETIC_LOGIN_OK');await pageClick(A,'#form');await nativeInput(A,'Input.insertText',{text:'C16-UNCONFIRMED-COMMIT-UNSUBMITTED-SYNTHETIC'});const before=await nativeState(A);assert.equal(before.page.form,'C16-UNCONFIRMED-COMMIT-UNSUBMITTED-SYNTHETIC');
 const rootBefore=await windows();const ordinaryRoot=rootBefore.find(w=>w.children.some(v=>v.id===A.wc));assert(ordinaryRoot?.visible&&!ordinaryRoot.minimized);
 await installGate(A);
 const first=await heldRead(A,1);await app.screenshot(join(evidenceRoot,'ordinary-page-before-quit-with-pending-read.png'));
 await sendQuit();
 const dropped=await until(async()=>{const t=await getTrace();return t.rows.find(x=>x.kind==='delivery'&&x.action==='commit'&&x.dropped)},'actual original commit delivery intercepted',10000);
 const initialTrace=await getTrace(),save=initialTrace.rows.find(x=>x.kind==='delivery'&&x.action==='save');assert(save);assert(initialTrace.rows.some(x=>x.kind==='actual-reply'&&x.id===save.id&&x.ready===true&&x.failureCount===0&&x.originalReturned));assert(!initialTrace.rows.some(x=>x.kind==='actual-reply'&&x.id===dropped.id));assert(await app.evaluate('Boolean(document.getElementById("root")?.inert)'));assert(!first.closedAt);
 const samples=[];const resumed=await until(async()=>{
  const t=await getTrace();const native=await nativeState(A),w=await windows();sameDoc(before,native);assert(!first.closedAt&&!first.releasedAt,'actual in-flight request ended before unconfirmed commit was rejected');assert(w.some(x=>x.id===ordinaryRoot.id&&x.children.some(v=>v.id===A.wc)));
  assert(!t.rows.some(x=>['native-page-destroyed','root-closed','app-will-quit'].includes(x.kind)),'real teardown before commit was confirmed');
  samples.push({at:Date.now(),sameNativeWC:native.id,sameNativeProcess:native.process,root:ordinaryRoot.id,readPending:true,inert:await app.evaluate('Boolean(document.getElementById("root")?.inert)')});
  const event=t.rows.find(x=>x.kind==='delivery'&&x.action==='resume');return event&&!samples.at(-1).inert?event:null
 },'actual FileCloseCoordinator commit timeout and original renderer resume',40000);
 assert(resumed.at-dropped.at>=29500,'expected the production 30s timeout, no artificial successful response');const afterTimeout=await getTrace();assert(!afterTimeout.rows.some(x=>x.kind==='actual-reply'&&x.id===dropped.id));assert(afterTimeout.faultUsed);const page=await awaitPage(t1,A.url,A.id);assert.equal(page.wc,A.wc);sameDoc(before,await nativeState(page));
 await app.screenshot(join(evidenceRoot,'ordinary-page-restored-after-unconfirmed-commit.png'));
 first.releasedAt=Date.now();first.response.writeHead(200,{'content-type':'text/plain','cache-control':'no-store'}).end('SYNTHETIC_READ_COMPLETED_AFTER_RESUME');await until(async()=>(await nativeState(A)).page.response==='SYNTHETIC_READ_COMPLETED_AFTER_RESUME','actual original pending browser fetch completed after aborted quit',6000);assert(!first.aborted);sameDoc(before,await nativeState(A));
 await record('actual-unconfirmed-commit-preserves-page-and-held-browser-helper',{pid:app.processId,root:ordinaryRoot.id,before,after:await nativeState(A),originalCommitId:dropped.id,actualSaveId:save.id,resumeEvent:resumed,actualTimeoutMs:resumed.at-dropped.at,samples,originalHeldHttp:plainHttp()[0],realCloseReply:afterTimeout.rows.find(x=>x.kind==='actual-reply'&&x.id===save.id),noSynthesizedReply:true});
 await disableGate();
 const second=await heldRead(A,2);const firstHistory=diskState();assert.deepEqual(firstHistory.workspaces,prior.workspaces);
 await quit();gateInstalled=false;await until(()=>second.closedAt,'actual final native quit closes second pending browser request',8000);assert(second.aborted&&!second.releasedAt);
 const final=await getTrace(),sends=final.rows.filter(x=>x.kind==='delivery'),saves=sends.filter(x=>x.action==='save'),commits=sends.filter(x=>x.action==='commit');assert.equal(saves.length,2);assert.equal(commits.length,2);assert(commits[0].dropped&&!commits[1].dropped);assert(final.rows.some(x=>x.kind==='actual-reply'&&x.id===saves[1].id&&x.ready===true&&x.originalReturned&&x.failureCount===0));const ack=final.rows.find(x=>x.kind==='actual-reply'&&x.id===commits[1].id&&x.ready===true&&x.originalReturned);assert(ack);assert(!final.rows.some(x=>x.kind==='actual-reply'&&x.id===commits[0].id));assert.equal(final.faultEnabled,false);
 assert(second.closedAt>=ack.at,'native browser read closed before genuine commit receipt');const teardown=final.rows.filter(x=>['native-page-destroyed','root-closed','app-will-quit'].includes(x.kind));assert(teardown.length>0&&teardown.every(x=>x.at>=ack.at),'real teardown must follow actual commit');
 const after=diskState(true);assert.deepEqual(after.integrity,[['ok']]);assert.deepEqual(after.workspaces,prior.workspaces);
 await record('actual-final-normal-quit-after-genuine-commit',{actualFinalSave:saves[1],actualFinalCommit:commits[1],actualCommitReply:ack,actualTeardown:teardown,actualSecondHeldHttp:plainHttp()[1],normalExit:report.launches.at(-1).exit,historyAndLogicalPagesPreserved:true,sqliteIntegrity:after.integrity});
 report.status='pass-B10.4-commit-unconfirmed-actual-subcase';report.remaining='Actual native busy/save/discard human confirmation and physical system S not exercised; no claim post-commit new-work racing test from this subcase.';
}catch(error){report.status='failed-or-incomplete';report.error=String(error.stack??error);if(app){try{await app.screenshot(join(evidenceRoot,'failure-ui.png'));}catch{}}}
finally{
 if(app){try{await restoreGate();await quit()}catch(error){report.cleanupError=String(error);}}
 for(const entry of ownedHttpReads)if(!entry.closedAt&&!entry.response.writableEnded)entry.response.destroy();
 server.closeAllConnections();await new Promise(done=>server.close(done));report.httpReads=plainHttp();report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({root,evidenceRoot,status:report.status,checks:report.checks.map(x=>x.name),error:report.error}));if(report.status!=='pass-B10.4-commit-unconfirmed-actual-subcase')process.exitCode=1;
}
