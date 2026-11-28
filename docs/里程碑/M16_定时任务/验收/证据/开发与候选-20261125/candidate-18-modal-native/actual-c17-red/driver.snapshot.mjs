// M16 B10.3 C17 continuation of exact fresh synthetic-only mock-keychain fixture, normal renderer reload, real task deletion/navigation. No old DB or partition, no real keys.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,realpath,writeFile,cp,stat,lstat,readdir,unlink,copyFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {openElectron,pause} from '/Users/liubu/hx/4.uprxiao/SmartDD/scripts/lib/electron-harness.mjs';
const [candidateArg,pin,rootArg]=process.argv.slice(2);assert(process.argv.includes('--authorized-private-task-delete-late')&&process.argv.includes('--authorized-fresh-synthetic-mock-keychain'));assert.equal(pin,'8e0e01b1838417c505b864ddce9ac5a62fae0d579e2c31e978599c851ea7ac11');assert.equal(rootArg,'/private/tmp/willyou-m16-schedule-app-US7kWL/task-delete-fresh-c17-SpsuKe');
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex'),candidate=await realpath(candidateArg);assert.equal(candidate,'/Users/liubu/hx/4.uprxiao/SmartDD/release/mac-arm64/WillYou.app');assert.equal(await digest(join(candidate,'Contents/Resources/app.asar')),pin);
const root=await realpath(rootArg),home=join(root,'home'),cliHome=join(root,'cli-home'),cwd=join(root,'project'),userData=join(root,'data'),nonce=randomUUID(),lateMarker='M16_B10_LATE_'+nonce;
assert.equal(root,rootArg);for(const d of [home,cliHome,cwd,userData]){const st=await lstat(d);assert(st.isDirectory()&&!st.isSymbolicLink());assert.equal(await realpath(d),d)}
const originalEvidence=join(root,'evidence','result.json'),initial=JSON.parse(await readFile(originalEvidence,'utf8'));assert.equal(initial.root,root);assert.equal(initial.pin,pin);assert(initial.fixture.createdFresh&&initial.fixture.noOldDatabaseOrPartitions&&initial.fixture.noModelPrompt&&initial.fixture.anchorTask&&initial.fixture.projectId&&initial.fixture.agentId);assert.equal(initial.actions.length,0);assert.equal(initial.requests.length,1);assert.equal(initial.requests[0].path,'/v1/responses');assert(initial.error.includes('switchTask'));assert.equal(initial.launches.length,1);assert(initial.launches[0].actualMockKeychainSwitch);assert.deepEqual(initial.launches[0].exit,{pid:97134,code:0,signal:null});
const evidenceRoot=await mkdtemp(join(root,'evidence-continuation-')),realExecutable=join(candidate,'Contents/MacOS/WillYou'),launcher=join(root,'synthetic-mock-keychain-launcher.sh');
const launcherBody="#!/bin/sh\nexec '/Users/liubu/hx/4.uprxiao/SmartDD/release/mac-arm64/WillYou.app/Contents/MacOS/WillYou' --use-mock-keychain \"$@\"\n";const launcherStat=await lstat(launcher);assert(launcherStat.isFile()&&!launcherStat.isSymbolicLink());assert.equal(await realpath(launcher),launcher);assert.equal(await readFile(launcher,'utf8'),launcherBody);assert.equal(await digest(launcher),initial.launches[0].launcherSha);execFileSync('/bin/sh',['-n',launcher]);
const origin='http://127.0.0.1:3425',url=name=>origin+'/f36-seed/'+name;
const report={root,evidenceRoot,pin,fixture:{...initial.fixture,normalContinuationOfInitiallyEmptySyntheticRoot:true},initialActualSetupResultSha:await digest(originalEvidence),initialActualSetupFailure:initial.error,launcherSha:await digest(launcher),driverSha256:await digest(new URL(import.meta.url).pathname),launches:[],checks:[],actions:[],requests:[],status:'running',scope:'actual C17 fresh-only synthetic mock-keychain launch, actual native browser task deletion/late response, separate new anchor; no real provider/keys/OS permissions. This is not real secure storage, Cookie encryption or actual user auth acceptance.'};
const persist=()=>writeFile(join(evidenceRoot,'result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
await copyFile(new URL(import.meta.url).pathname,join(evidenceRoot,'driver.snapshot.mjs'));await persist();
const strippedEnvNames=Object.keys(process.env).filter(n=>/(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH_SOCK)/i.test(n));for(const name of strippedEnvNames)delete process.env[name];report.strippedEnvNames=strippedEnvNames;
let app,executable,stage='setup',originToken='synthetic-f36-profile-local-only',lateRequests=[];
const page=(path,title,logged=false)=>'<!doctype html><meta charset="utf-8"><title>'+title+'</title><style>body{font:16px system-ui;background:#d9faf4;padding:20px}input{width:240px}button{margin:8px}#mark{background:#119b89;color:white;padding:16px}</style><h1 id="mark">'+title+'</h1><label>表单 <input id="form" aria-label="未提交表单"></label><p id="session">'+(logged?'SYNTHETIC_LOGIN_OK':'SYNTHETIC_LOGIN_NONE')+'</p><button id="login" type="button">合成登录</button><button id="advance" type="button">进入历史页</button><button id="back" type="button">返回</button><button id="async" type="button">异步操作</button><p id="counter">0</p><p id="response">idle</p><script>window.docMarker=crypto.randomUUID();window.ticks=0;document.querySelector("#login").onclick=async()=>{const r=await fetch("/fixture-login",{method:"POST"});if(r.ok)document.querySelector("#session").textContent="SYNTHETIC_LOGIN_OK";};setInterval(()=>{document.querySelector("#counter").textContent=String(++window.ticks)},100);document.querySelector("#advance").onclick=()=>{history.pushState({test:1},"",location.pathname+"?step=2");document.querySelector("#mark").textContent+=" • step 2";};document.querySelector("#back").onclick=()=>history.back();document.querySelector("#async").onclick=async()=>{document.querySelector("#response").textContent="pending";const r=await fetch("/async/"+encodeURIComponent(location.pathname));document.querySelector("#response").textContent=await r.text()};</script>';
const server=createServer(async(req,res)=>{const u=new URL(req.url??'/',origin);if(u.origin!==origin){res.writeHead(403).end('isolated fixture only');return;}const p=u.pathname,logged=(req.headers.cookie??'').split(';').map(x=>x.trim()).includes('wy_fixture_login='+originToken);report.requests.push({stage,path:p,method:req.method,logged,at:Date.now()});
 if(p==='/v1/responses'&&req.method==='POST'){
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>100000){res.writeHead(413).end();return;}chunks.push(chunk);}
  const b=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(b.model!=='m16-codex-one'||b.input!=='Call the wy_ping tool exactly once.'||!(b.tools??[]).some(t=>t.name==='wy_ping')){res.writeHead(400).end('{}');return;}
  const item={type:'function_call',call_id:'call-probe',name:'wy_ping',arguments:'{}'},id='resp_'+randomUUID();
  res.writeHead(200,{'content-type':'text/event-stream'});const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
  event('response.created',{response:{id,status:'in_progress'}});event('response.output_item.done',{item});event('response.completed',{response:{id,status:'completed',output:[item]}});report.providerChecks??=[];report.providerChecks.push({model:b.model,probe:'synthetic loopback wy_ping only'});res.end();return;
 }
 if(p==='/f36-delete-late'&&req.method==='GET'){
  if(u.searchParams.get('nonce')!==nonce){res.writeHead(403).end('only exact private fixture navigation');return;}
  const entry={id:lateRequests.length+1,startedAt:Date.now(),path:u.pathname+u.search,finishedAt:null,closedAt:null,aborted:false,releasedAt:null,response:res};lateRequests.push(entry);
  res.on('finish',()=>entry.finishedAt=Date.now());res.on('close',()=>{entry.closedAt=Date.now();entry.aborted=!res.writableEnded});return;
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
 app=await openElectron({userData,executable:launcher,cwd:root,env:{HOME:home,SMARTDD_CLI_HOME:cliHome,CODEX_HOME:join(cliHome,'.codex'),CLAUDE_CONFIG_DIR:join(cliHome,'.claude'),XDG_CONFIG_HOME:join(home,'.config'),HTTP_PROXY:origin,HTTPS_PROXY:origin,ALL_PROXY:origin,NO_PROXY:'127.0.0.1,localhost'},inspectMain:true});
 const pid=await bind();const mock=await observeMain(E=>E.app.commandLine.hasSwitch('use-mock-keychain'));assert.equal(mock,true,'actual Chromium mock keychain test switch absent');await until(async()=>{const actual=await windows();return actual.some(w=>w.visible&&!w.minimized&&w.children.some(c=>/\/out\/renderer\/index\.html/.test(c.url)))},'actual isolated visible trusted shell',15000);report.launches.push({label,pid,bundle,expected,exeSha:await digest(executable),actualMockKeychainSwitch:mock,launcherSha:await digest(launcher),port:app.port??null,mainPort:app.mainPort??null,at:Date.now()});await persist();return pid;
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
let t1=null;
const lateUrl=origin+'/f36-delete-late?nonce='+nonce,fixtureTaskTitle='M16 B10.3 disposable '+nonce.slice(0,8);
let disposableTask=null,isolatedProfile=null,target=null,anchor=null,anchorBefore=null,held=null;
const durableRead=(taskId,profileId=null,offline=false)=>{const code=`import sqlite3,json,sys
p,tid,pid,mode=sys.argv[1:]
with sqlite3.connect('file:'+p+'?mode=ro'+('&immutable=1' if mode=='offline' else ''),uri=True) as c:
 row=c.execute('select id,project_id,dir_id,cwd,title from tasks where id=?',(tid,)).fetchone()
 state=c.execute('select value from app_settings where key=?',('browserWorkspace.v1:'+tid,)).fetchone()
 profiles=c.execute('select value from app_settings where key=?',('browserProfiles.v1',)).fetchone()
 print(json.dumps({'task':dict(zip(['id','project_id','dir_id','cwd','title'],row)) if row else None,'workspace':json.loads(state[0]) if state else None,'profile':next((x for x in json.loads(profiles[0])['profiles'] if x['id']==pid),None) if profiles and pid else None},ensure_ascii=False))`;return JSON.parse(execFileSync('/usr/bin/python3',['-c',code,join(userData,'smartdd.db'),taskId,profileId??'',offline?'offline':'live'],{encoding:'utf8'}));};
function exactPs(pids){assert(pids.length&&pids.every(n=>Number.isSafeInteger(n)&&n>0));try{return{status:0,output:execFileSync('/bin/ps',['-p',pids.join(','),'-o','pid=,ppid=,stat=,comm='],{encoding:'utf8'}).trim()}}catch(e){return{status:e.status??null,output:String(e.stdout??'').trim()}}}
const lateView=()=>lateRequests.map(({response,...row})=>({...row,responseDestroyed:response.destroyed,socketDestroyed:response.socket?.destroyed??null,socketReadyState:response.socket?.readyState??null,writableEnded:response.writableEnded}));
async function releaseLate(entry,reason){if(!entry||entry.closedAt||entry.response.destroyed||entry.response.writableEnded)return false;entry.releasedAt=Date.now();entry.releaseReason=reason;entry.response.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'}).end('<!doctype html><title>合成迟到导航</title><p>'+lateMarker+'</p>');return true}
async function selectSaved(task,p){
 const visible=await app.evaluate(js(u=>Array.from(document.querySelectorAll('[role=tab]')).some(e=>e.title===u&&e.getBoundingClientRect().width>0),p.url));let placeholder=null;
 if(!visible){placeholder=await newTab(task,null);assert.notEqual(placeholder,p.id);assert.equal((await snapshot(task)).tabs.find(t=>t.id===placeholder).url,'about:blank')}
 const actual=await chooseTab(task,p);assert.equal(actual.id,p.id);assert.equal(actual.profile,p.profileId);
 if(placeholder){await shellClick('button[aria-label="关闭网页 新标签页"]');await until(async()=>{const s=await snapshot(task);return !s.tabs.some(t=>t.id===placeholder)&&s.activeId===p.id},'close only exact self-created empty placeholder')}
 return actual;
}
function sameDoc(a,b){assert.equal(a.id,b.id);assert.equal(a.process,b.process);assert.equal(a.url,b.url);for(const k of ['marker','form','history','session','title'])assert.equal(a.page[k],b.page[k],k+' changed');}
async function targetNative(page,profileId){return observeMain(async(E,id,origin,profile,marker)=>{
 const w=E.webContents.fromId(id);if(!w||w.isDestroyed())return {exists:false,wc:id};
 const path=w.session.storagePath,actual=w.getURL();if(!path||!path.endsWith('/Partitions/wy-browser-'+profile)||!(actual.startsWith(origin+'/')||actual==='about:blank'))throw Error('owned target origin/partition changed');
 const loading=w.isLoading();let markerSeen=null;if(!loading&&actual.includes('/f36-delete-late?'))try{markerSeen=await w.executeJavaScript('document.body.innerText.includes('+JSON.stringify(marker)+')')}catch{}
 return{exists:true,wc:id,url:actual,process:w.getOSProcessId(),loading,partition:path,markerSeen};
 },page.wc,origin,profileId,lateMarker)}
async function actualDeleteUi(taskId,title){
 const current=durableRead(taskId).task;assert(current&&current.title===title&&taskId===disposableTask);assert(current.cwd.startsWith(root+'/project/'));
 const q=sidebar(taskId),point=await until(()=>app.evaluate(js((query,title)=>{const b=document.querySelector(query);if(!b||b.title!==title||b.innerText.trim()!==title)return null;b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect(),x=Math.floor(r.x+r.width/2),y=Math.floor(r.y+r.height/2);return b.contains(document.elementFromPoint(x,y))?{x,y}:null},q,title)),'exact unique disposable sidebar row visible',10000);
 const w=await windows();const shells=w.flatMap(win=>win.children.filter(c=>/\/out\/renderer\/index\.html(?:[?#]|$)/.test(c.url)).map(c=>({win,c})));assert.equal(shells.length,1);
 const shell=shells[0];assert(shell.win.visible&&!shell.win.minimized);const occlusion=shell.win.children.slice(shell.win.children.indexOf(shell.c)+1).some(c=>c.visible!==false&&point.x>=c.bounds.x&&point.x<c.bounds.x+c.bounds.width&&point.y>=c.bounds.y&&point.y<c.bounds.y+c.bounds.height);assert(!occlusion,'actual task row unobscured');
 for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,button:'right',clickCount:1,...point});
 await shellClick('[role="menuitem"]','永久删除');const dialog='[role=dialog]';const text=await until(()=>app.evaluate(js(q=>document.querySelector(q)?.innerText??null,dialog)),'exact actual permanent-delete dialog');assert(text.includes('永久删除任务')&&text.includes(title));const row=durableRead(taskId).task;assert(row?.id===disposableTask&&row.title===title);
 await app.screenshot(join(evidenceRoot,'exact-disposable-delete-confirmation.png'));await shellClick(dialog+' button','永久删除');report.actions.push({stage,kind:'exact-disposable-delete-ui-confirmation',taskId,title,taskPath:row.cwd,actualHttpBeforeAndAfterClick:lateView()});await persist();
 let result;
 try{result=await until(async()=>{if(!durableRead(taskId).task)return{kind:'deleted'};const toast=await app.evaluate(js(q=>({dialog:document.querySelector(q)?.innerText??null,button: Array.from(document.querySelectorAll(q+' button')).find(e=>e.textContent.trim()==='永久删除')?.disabled??null,toasts:Array.from(document.querySelectorAll('[data-sonner-toast]')).map(e=>e.innerText)}),dialog));const refusal=toast.toasts.find(t=>/正在运行|正在工作|请先关闭|正在处理|未结束|仍在运行|尚未结算|存在关联|无法删除|不能删除/.test(t));return toast.dialog?.includes(title)&&toast.button===false&&refusal?{kind:'explicit-refusal',refusal,toast}:null},'real task delete receipt or explicit busy/refusal',15000)}catch(e){report.deleteOutcomeUnknown={error:String(e),actualTask:durableRead(taskId),dialog:await app.evaluate(js(q=>document.querySelector(q)?.innerText??null,dialog))};await persist();throw e}
 return result;
}
async function waitNativeSettledAfterRelease(page,taskId,profileId){
 await until(async()=>{const s=await snapshot(taskId),row=s.tabs.find(t=>t.id===page.id);return row&&row.url===lateUrl&&!row.loading&&!row.failure?row:null},'actual held navigation completion after explicit refusal',15000);
 const actual=await targetNative(page,profileId);assert(actual.exists&&actual.url===lateUrl);return actual;
}
try{
 // Resume only the exact previous fresh synthetic root after its real normal exit.
 const db=join(userData,'smartdd.db'),sidecars=[];for(const suffix of ['-wal','-shm']){try{const f=db+suffix,st=await lstat(f);assert(st.isFile()&&!st.isSymbolicLink());assert.equal(await realpath(f),f);sidecars.push({suffix,size:st.size,path:f})}catch(e){if(e.code!=='ENOENT')throw e}}
 if(sidecars.length){assert.equal(sidecars.length,2);assert.equal(sidecars.find(x=>x.suffix==='-wal').size,0);assert.equal(sidecars.find(x=>x.suffix==='-shm').size,32768);}
 let unheld=false;try{execFileSync('/usr/sbin/lsof',['-nP',db,...sidecars.map(x=>x.path)],{encoding:'utf8'})}catch(e){unheld=e.status===1&&!String(e.stdout??'').trim()}assert(unheld);
 const oldOwner=exactPs([97134]);assert.equal(oldOwner.status,1);assert.equal(oldOwner.output,'');const existingDisk=diskState(true);assert.deepEqual(existingDisk.integrity,[['ok']]);assert.deepEqual(existingDisk.workspaces,{});t1=initial.fixture.anchorTask;const from=durableRead(t1,null,true).task;assert(from&&from.id===t1&&from.title==='M16 B10.3 fresh synthetic anchor'&&from.project_id===initial.fixture.projectId&&from.dir_id===initial.fixture.dirId);assert.equal(from.cwd,join(root,'project','fixture'));assert.equal(await realpath(from.cwd),from.cwd);
 report.priorSetupGuard={exactPriorFreshRoot:true,priorExit0:true,oldAppGone:true,dbUnheld:true,zeroWalOrAbsent:sidecars,integrity:existingDisk.integrity,priorWorkspaceCount:0,sourceInitialScreenshot:join(root,'evidence','failure-ui.png'),noCopiedOldDataOrCipher:true};await persist();
 await runApp(candidate,pin,'B10.3-c17-fresh-mock-resume');
 const existingTaskRows=await app.invoke('agentTasks.list');assert.equal(existingTaskRows.length,1);assert.equal(existingTaskRows[0].taskId??existingTaskRows[0].id,t1);
 const project=await app.invoke('projects.get',from.project_id),registered=project.dirs.find(d=>d.id===from.dir_id);assert(registered&&registered.path===from.cwd);
 const agent=await agentSnapshot(t1);assert(agent.selection.profileId===initial.fixture.agentId&&agent.selection.model==='m16-codex-one');
 const input={projectId:project.id,dirId:registered.id,cwd:from.cwd,profileId:initial.fixture.agentId,model:'m16-codex-one',effort:'medium',tier:'ask',carryExtensions:false};
 const made=await app.invoke('agentTasks.create',{...input,title:fixtureTaskTitle});disposableTask=made.taskId;assert(disposableTask&&disposableTask!==t1);assert.equal(durableRead(disposableTask).task.title,fixtureTaskTitle);report.disposable={taskId:disposableTask,title:fixtureTaskTitle,cwd:from.cwd,preparation:'normal actual API, no model prompt'};report.fixture.disposableTask=disposableTask;
 // A legitimate fixture precursor is already persisted; normal renderer reload updates real list stores, never mutating the store/DOM.
 const oldOrigin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor('performance.timeOrigin!=='+oldOrigin+'&&document.readyState==="complete"&&!!document.querySelector("button")',15000,{navigation:true});await bind();
 const actualRows=await until(()=>app.evaluate(js((a,b,title)=>{const x=document.querySelector('[data-testid="sidebar-agent-task"][data-task-id='+JSON.stringify(a)+']'),y=document.querySelector('[data-testid="sidebar-agent-task"][data-task-id='+JSON.stringify(b)+']');if(!x||!y||x.title!=='M16 B10.3 fresh synthetic anchor'||y.title!==title||!x.getBoundingClientRect().width||!y.getBoundingClientRect().width||!document.body.innerText.includes('M16 B10.3 fresh private project'))return null;return{project:true,anchor:x.dataset.taskId,disposable:y.dataset.taskId,timeOrigin:performance.timeOrigin}},t1,disposableTask,fixtureTaskTitle)),'actual project and both individually persisted synthetic sidebar tasks after normal Page.reload',15000);assert.notEqual(actualRows.timeOrigin,oldOrigin);await record('verified-real-project-task-lists-after-fixture-reload',{actualRows,oldOrigin,priorEmptyUiFailurePreserved:true,noStoreMutation:true});
 await switchTask(t1);await openPanel();anchor=await newTab(t1,url('A'));assert.equal((await nativeState(anchor)).page.session,'SYNTHETIC_LOGIN_NONE');await pageClick(anchor,'#login');await until(async()=>(await nativeState(anchor)).page.session==='SYNTHETIC_LOGIN_OK','actual local synthetic cookie on mock-keychain anchor',8000);
 await pageClick(anchor,'#form');await nativeInput(anchor,'Input.insertText',{text:'M16-B10.3-PRESERVE-ANCHOR-FORM'});anchorBefore=await nativeState(anchor);assert.equal(anchorBefore.page.form,'M16-B10.3-PRESERVE-ANCHOR-FORM');
 const prior=diskState(),priorA=prior.workspaces[t1].tabs.find(t=>t.id===anchor.id);assert(priorA&&priorA.profileId===anchor.profile);
 await switchTask(disposableTask);await openPanel();const own=await newTab(disposableTask,url('C')+'?disposable='+nonce);assert.equal(own.profile,anchor.profile);await openProfiles();const rows=await profileRows(disposableTask);const createText=await app.evaluate(js(q=>document.querySelector(q+' .bw-add')?.textContent.trim(),dlg));assert(createText?.includes('新建独立登录态'));isolatedProfile=await newProfileAction(disposableTask,rows,()=>true,createText);await done();await openProfiles();target=await apply(disposableTask,own,isolatedProfile);
 assert.equal(target.id,own.id);assert.equal(target.profile,isolatedProfile.id);assert.equal((await nativeState(target)).page.session,'SYNTHETIC_LOGIN_NONE');const targetBefore=await targetNative(target,isolatedProfile.id);assert(targetBefore.exists);const partition=join(userData,'Partitions','wy-browser-'+isolatedProfile.id);assert.equal(await realpath(partition),partition);assert.equal(targetBefore.partition,partition);
 assert(durableRead(disposableTask,isolatedProfile.id).profile.owner.id===disposableTask);assert(!(await profileRows(t1)).some(x=>x.id===isolatedProfile.id));await record('owned-disposable-task-profile-real-native-precondition',{disposable:report.disposable,anchor,anchorBefore,target,targetBefore,isolatedProfile,ownPartition:partition,actualOriginalNeighborTasks:[t1]});
 await field('[aria-label="网页地址"]',lateUrl);await keypress('Enter');held=await until(()=>lateRequests[0]&&!lateRequests[0].closedAt?lateRequests[0]:null,'real actual held navigation reaches local synthetic site',10000);assert.equal(held.id,1);const during=await snapshot(disposableTask);const tab=during.tabs.find(x=>x.id===target.id);assert(tab&&tab.loading);assert.equal(tab.profileId,isolatedProfile.id);const beforeDeleteNative=await targetNative(target,isolatedProfile.id);assert(beforeDeleteNative.exists&&beforeDeleteNative.loading);report.heldNavigation={actualTab:tab,actualHTTP:lateView(),native:beforeDeleteNative};await persist();
 await app.screenshot(join(evidenceRoot,'native-held-navigation-before-delete.png'));
 let deletion=await actualDeleteUi(disposableTask,fixtureTaskTitle);report.initialDeleteOutcome=deletion;
 if(deletion.kind==='explicit-refusal'){
  report.safeDeletionRefusedWhileNavigating=true;await record('actual-busy-delete-refusal-preserves-target',{refusal:deletion.refusal,actual:durableRead(disposableTask,isolatedProfile.id),native:await targetNative(target,isolatedProfile.id),http:lateView()});await shellClick('[role=dialog] button','取消');assert(await releaseLate(held,'explicit-normal-delete-refusal: settle actual navigation before normal retry'));await waitNativeSettledAfterRelease(target,disposableTask,isolatedProfile.id);deletion=await actualDeleteUi(disposableTask,fixtureTaskTitle);
 }
 assert.equal(deletion.kind,'deleted','actual permanent deletion must have real accepted task receipt');const deletedAt=Date.now();assert.equal(durableRead(disposableTask).task,null);assert((await app.invoke('agentTasks.list')).every(t=>(t.taskId??t.id)!==disposableTask));report.actualTaskDeleteAt=deletedAt;
 // Observe actual live WC/metadata and pending HTTP independently and boundedly. Never manually call reconcile or clear production data.
 const samples=[];let current;const deadline=Date.now()+10000;
 do{const m=durableRead(disposableTask,isolatedProfile.id),native=await targetNative(target,isolatedProfile.id);current={at:Date.now(),task:m.task,workspacePresent:!!m.workspace,profilePresent:!!m.profile,native,http:lateView()};samples.push(current);assert.equal(m.task,null,'deleted disposable task reappeared');if(!current.workspacePresent&&!current.profilePresent&&!current.native.exists&&(held.closedAt||held.finishedAt))break;await pause(250)}while(Date.now()<deadline)
 const immediateClean=!current.workspacePresent&&!current.profilePresent&&!current.native.exists&&Boolean(held.closedAt||held.finishedAt);report.immediateSamples=samples;report.immediatelySettled=immediateClean;await persist();
 // If still physically live after admitted delete, deliver only our own existing local late response. Capture whether stale native document actually commits. Never reissue any operation.
 let releasedAfterDelete=false;if(!held.closedAt&&!held.response.destroyed&&!held.response.writableEnded){releasedAfterDelete=await releaseLate(held,'actual task already deleted; observe original late native navigation response');}
 const lateSamples=[];const lateEnd=Date.now()+2500;do{const m=durableRead(disposableTask,isolatedProfile.id),native=await targetNative(target,isolatedProfile.id);assert.equal(m.task,null);lateSamples.push({at:Date.now(),workspacePresent:!!m.workspace,profilePresent:!!m.profile,native,http:lateView()});await pause(250)}while(Date.now()<lateEnd)
 let staleNativeLateMarker=lateSamples.some(x=>x.native.exists&&x.native.markerSeen===true);
 const after=lateSamples.at(-1);const noDuplicateLateRequest=lateRequests.length===1;const persistentClean=!after.workspacePresent&&!after.profilePresent&&!after.native.exists&&!staleNativeLateMarker&&noDuplicateLateRequest;
 let rejectedReadOnly=false;try{await snapshot(disposableTask)}catch(e){rejectedReadOnly=true;report.deletedReadOnlyRejection=String(e.message??e)}assert(rejectedReadOnly,'removed task must not expose a fresh browser workspace through ordinary readonly UI');
 await switchTask(t1);await openPanel();const anchorAfter=await chooseTab(t1,anchor);assert.equal(anchorAfter.wc,anchor.wc);const anchorResult=await nativeState(anchorAfter);sameDoc(anchorBefore,anchorResult);assert.deepEqual(durableRead(t1).workspace,prior.workspaces[t1]);assert((await profileRows(t1)).some(x=>x.id===anchor.profile));await app.screenshot(join(evidenceRoot,'original-anchor-after-disposable-task-delete.png'));
 await record('actual-disposable-delete-native-late-receipt-and-neighbor',{actualDelete:true,deletedAt,immediateClean,persistentClean,explicitRefusalThenSettled:!!report.safeDeletionRefusedWhileNavigating,releasedAfterDelete,staleNativeLateMarker,noDuplicateLateRequest,immediateSamples:samples,lateSamples,lastState:after,anchorBefore,anchorAfter:anchorResult,oldWorkspaceReadRejected:true,sourceAndNeighborWorkspaceUnchanged:true,nativeResourceScope:'real WC and actual local native navigation; no fabricated Agent helper/operation receipt'});
 const beforeFinal=diskState();report.beforeQuit=beforeFinal;await quit();let afterQuit=diskState(true);assert.deepEqual(afterQuit.integrity,[['ok']]);assert.deepEqual(afterQuit.workspaces[t1],prior.workspaces[t1]);
 if(!persistentClean||afterQuit.workspaces[disposableTask]){
  // Product startup recovery is a distinct observation, never a substitute for the original immediate failed cleanup.
  await runApp(candidate,pin,'B10.3-c17-actual-orphan-startup-recovery');const recovered=await until(()=>{const v=durableRead(disposableTask,isolatedProfile.id);return !v.task&&!v.workspace&&!v.profile?v:null},'actual normal startup orphan metadata recovery',15000);
  assert((await app.invoke('agentTasks.list')).every(t=>(t.taskId??t.id)!==disposableTask));await switchTask(t1);await openPanel();const revived=await selectSaved(t1,priorA);assert.equal(revived.profile,anchor.profile);assert.equal((await nativeState(revived)).page.session,'SYNTHETIC_LOGIN_OK');await quit();afterQuit=diskState(true);assert.deepEqual(afterQuit.integrity,[['ok']]);assert(!afterQuit.workspaces[disposableTask]);assert.deepEqual(afterQuit.workspaces[t1],prior.workspaces[t1]);await record('actual-normal-startup-orphan-recovery-separate-from-immediate-red',{recovered,integrity:afterQuit.integrity,originalNeighborsPreserved:true});
 }
 report.status=immediateClean&&persistentClean&&!report.safeDeletionRefusedWhileNavigating?'pass-B10.3-task-delete-late-native-subcase':'partial-or-red-B10.3-task-delete-native-cleanup';
 report.boundary='Actual disposable task deletion + native WC and late local HTTP, fresh synthetic root only and actual mock-keychain startup. Not real secure-storage or Cookie encryption, no actual Agent helper receipt substituted; B04/B06/B11 existing separate late tool/owner evidence.';
}catch(error){report.status='failed-or-incomplete';report.error=String(error.stack??error);if(app){try{await app.screenshot(join(evidenceRoot,'failure-ui.png'))}catch{}}}
finally{
 if(held&&!held.closedAt&&!held.response.destroyed&&!held.response.writableEnded)await releaseLate(held,'exact private fixture cleanup; not business success assertion');
 if(app){try{await quit()}catch(error){report.cleanupError=String(error);}}
 server.closeAllConnections();await new Promise(done=>server.close(done));report.lateRequests=lateView();report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({root,evidenceRoot,status:report.status,checks:report.checks.map(x=>x.name),error:report.error}));if(report.status!=='pass-B10.3-task-delete-late-native-subcase')process.exitCode=1;
}
