// M16 B07.4 actual built App profile lifecycle using fresh private root, synthetic cookie only. No Chrome/Edge import.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,realpath,writeFile,cp,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {openElectron,pause} from '/Users/liubu/hx/4.uprxiao/SmartDD/scripts/lib/electron-harness.mjs';
const [candidateArg,pin,rootArg]=process.argv.slice(2);assert.equal(rootArg,'/private/tmp/willyou-m16-f36-profile-c12-PFTcb8');assert.equal(pin,'b6429477169b628747fd1d6f6d837bd08b30accadf395041c2b9c58b191649b5');assert(/^[a-f0-9]{64}$/.test(pin));
const root=await realpath(rootArg),home=join(root,'home'),cliHome=join(root,'cli-home'),cwd=join(root,'project'),userData=join(root,'data');assert.equal(root,rootArg);const previous=JSON.parse(await readFile(join(root,'B07-profile-result.json'),'utf8'));assert.equal(previous.root,root);assert.equal(previous.pin,pin);assert(previous.error.includes("Cannot read properties of undefined (reading 'filter')"));assert.equal(previous.checks.length,5);assert(JSON.parse(await readFile(join(root,'first-independent-cleanup.json'),'utf8')).allGone);
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex'),candidate=await realpath(candidateArg);assert(candidate==='/Users/liubu/hx/4.uprxiao/SmartDD/release/mac-arm64/WillYou.app'||candidate.startsWith('/private/tmp/willyou-')&&candidate.endsWith('/WillYou.app'));
assert.equal(await digest(join(candidate,'Contents/Resources/app.asar')),pin);
const origin='http://127.0.0.1:3425',url=name=>origin+'/f36-seed/'+name;
const report={...previous,previousResultSha:await digest(join(root,'B07-profile-result.json')),driverSha256:await digest(new URL(import.meta.url).pathname),launches:[],previousError:previous.error,continuationBoundary:'same exact root from normal exit, history via real persisted workspace snapshot; no copy or coordination gate changes',status:'continuing'};delete report.error;
const persist=()=>writeFile(join(root,'B07-profile-continuation-result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
let app,executable,stage='setup',originToken='synthetic-f36-profile-local-only';
const page=(path,title,logged=false)=>'<!doctype html><meta charset="utf-8"><title>'+title+'</title><style>body{font:16px system-ui;background:#d9faf4;padding:20px}input{width:240px}button{margin:8px}#mark{background:#119b89;color:white;padding:16px}</style><h1 id="mark">'+title+'</h1><label>表单 <input id="form" aria-label="未提交表单"></label><p id="session">'+(logged?'SYNTHETIC_LOGIN_OK':'SYNTHETIC_LOGIN_NONE')+'</p><button id="login" type="button">合成登录</button><button id="advance" type="button">进入历史页</button><button id="back" type="button">返回</button><button id="async" type="button">异步操作</button><p id="counter">0</p><p id="response">idle</p><script>window.docMarker=crypto.randomUUID();window.ticks=0;document.querySelector("#login").onclick=async()=>{const r=await fetch("/fixture-login",{method:"POST"});if(r.ok)document.querySelector("#session").textContent="SYNTHETIC_LOGIN_OK";};setInterval(()=>{document.querySelector("#counter").textContent=String(++window.ticks)},100);document.querySelector("#advance").onclick=()=>{history.pushState({test:1},"",location.pathname+"?step=2");document.querySelector("#mark").textContent+=" • step 2";};document.querySelector("#back").onclick=()=>history.back();document.querySelector("#async").onclick=async()=>{document.querySelector("#response").textContent="pending";const r=await fetch("/async/"+encodeURIComponent(location.pathname));document.querySelector("#response").textContent=await r.text()};</script>';
const server=createServer(async(req,res)=>{const u=new URL(req.url??'/',origin);if(u.origin!==origin){res.writeHead(403).end('isolated fixture only');return;}const p=u.pathname,logged=(req.headers.cookie??'').split(';').map(x=>x.trim()).includes('wy_fixture_login='+originToken);report.requests.push({stage,path:p,method:req.method,logged,at:Date.now()});
 if(p==='/v1/responses'&&req.method==='POST'){
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>100000){res.writeHead(413).end();return;}chunks.push(chunk);}
  const b=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(b.model!=='m16-codex-one'||b.input!=='Call the wy_ping tool exactly once.'||!(b.tools??[]).some(t=>t.name==='wy_ping')){res.writeHead(400).end('{}');return;}
  const item={type:'function_call',call_id:'call-probe',name:'wy_ping',arguments:'{}'},id='resp_'+randomUUID();
  res.writeHead(200,{'content-type':'text/event-stream'});const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
  event('response.created',{response:{id,status:'in_progress'}});event('response.output_item.done',{item});event('response.completed',{response:{id,status:'completed',output:[item]}});report.providerChecks??=[];report.providerChecks.push({model:b.model,probe:'synthetic loopback wy_ping only'});res.end();return;
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
const {t1,t2}=previous.fixture;
const source=previous.checks[0].source,empty=previous.checks[1].newProfile,copy=previous.checks[3].copy;
try{
 const priorSaved=diskState(true);assert.deepEqual(priorSaved.integrity,[['ok']]);const p1=priorSaved.workspaces[t1],p2=priorSaved.workspaces[t2];assert.equal(p1.closed.length,1);const cc=p1.closed[0];assert.equal(cc.url,url('C'));assert.equal(cc.profileId,copy.id);assert(!p1.tabs.some(t=>t.id===cc.id));assert.equal(p1.activeId,p1.tabs.find(t=>t.url===url('A')).id);report.originalPersistedBeforeContinuation=priorSaved;
 await runApp(candidate,pin,'profile-c12-same-root-continuation');await persist();await switchTask(t1);await openPanel();const a0=p1.tabs.find(t=>t.url===url('A')),b0=p1.tabs.find(t=>t.url===url('B'));assert.equal(a0.profileId,copy.id);assert.equal(b0.profileId,source.id);
 async function selectSaved(task,p){const visible=await app.evaluate(js(u=>Array.from(document.querySelectorAll('[role=tab]')).some(e=>e.title===u&&e.getBoundingClientRect().width>0),p.url));let placeholder=null;if(!visible){placeholder=await newTab(task,null);assert.notEqual(placeholder,p.id);assert.equal((await snapshot(task)).tabs.find(t=>t.id===placeholder).url,'about:blank');}const actual=await chooseTab(task,p);assert.equal(actual.id,p.id);assert.equal(actual.profile,p.profileId);if(placeholder){await shellClick('button[aria-label="关闭网页 新标签页"]');await until(async()=>{const s=await snapshot(task);return !s.tabs.some(t=>t.id===placeholder)&&s.activeId===p.id},'close only explicit empty placeholder');}return actual;}
 const ca=await selectSaved(t1,a0);assert.equal((await nativeState(ca)).page.session,'SYNTHETIC_LOGIN_OK');const pb=await chooseTab(t1,b0);assert.equal(pb.id,b0.id);assert.equal(pb.profile,source.id);assert.equal((await nativeState(pb)).page.session,'SYNTHETIC_LOGIN_OK');await pageClick(pb,'#form');await nativeInput(pb,'Input.insertText',{text:'SECOND-NEW-PROCESS-UNSAVED-FORM'});const originalB=await nativeState(pb);assert.equal(originalB.page.form,'SECOND-NEW-PROCESS-UNSAVED-FORM');
 await switchTask(t2);await openPanel();const second=await selectSaved(t2,p2.tabs[0]);assert.equal(second.profile,p2.tabs[0].profileId);const secondOriginal=await nativeState(second);assert.equal(secondOriginal.page.session,'SYNTHETIC_LOGIN_NONE');await switchTask(t1);await chooseTab(t1,ca);assert.equal(report.requests.filter(r=>r.path==='/fixture-login').length,1);await record('actual-closed-history-and-clone-login-restored-normal-restart',{closed:cc,clonePage:ca,otherPage:pb,otherTask:second});
 const beforeCancel=await nativeState(ca);await openProfiles();await profilePick(copy);await actionButton('删除');await app.waitFor(js(q=>Array.from(document.querySelectorAll(q+' button')).some(x=>x.textContent.trim()==='确认删除'),dlg),8000);await actionButton('取消');await done();assert((await profileRows(t1)).some(x=>x.id===copy.id));assert.equal((await nativeState(ca)).page.marker,beforeCancel.page.marker);assert.equal(diskState().workspaces[t1].closed.filter(t=>t.id===cc.id).length,1);await record('destructive-confirmation-cancel-no-effect',{profile:copy.id,page:ca.id,wc:ca.wc});
 await openProfiles();await profilePick(copy);await actionButton('删除');await actionButton('确认删除');await until(async()=>!(await profileRows(t1)).some(x=>x.id===copy.id),'actual clone profile retired',45000);await app.waitFor(js(q=>Array.from(document.querySelectorAll(q+' button')).some(x=>x.textContent.trim()==='完成'&&!x.disabled),dlg),15000);await done();
 const restored=await awaitPage(t1,ca.url,ca.id);assert.equal(restored.profile,source.id);assert.notEqual(restored.wc,ca.wc);await retired(ca);const restoredState=await nativeState(restored);assert.equal(restoredState.page.session,'SYNTHETIC_LOGIN_OK');const s=diskState().workspaces[t1];assert.equal(s.closed.filter(t=>t.id===cc.id).length,1);assert.equal(s.closed.find(t=>t.id===cc.id).profileId,source.id);assert(!s.tabs.some(t=>t.id===cc.id));const keepB=await sameNative(t1,pb,originalB);await record('confirmed-delete-rebinds-actual-live-page-and-history',{deleted:copy.id,restored,restoredState,history:s.closed.filter(t=>t.id===cc.id),unchangedB:keepB});
 await chooseTab(t1,restored);await openProfiles();const againEmpty=await apply(t1,restored,empty);assert.equal((await nativeState(againEmpty)).page.session,'SYNTHETIC_LOGIN_NONE');await openProfiles();const back=await apply(t1,againEmpty,source);assert.equal((await nativeState(back)).page.session,'SYNTHETIC_LOGIN_OK');await sameNative(t1,pb,originalB);
 await switchTask(t2);const secondAgain=await sameNative(t2,second,secondOriginal);assert(!(await profileRows(t2)).some(x=>[source.id,empty.id,copy.id].includes(x.id)));assert.equal(report.requests.filter(r=>r.path==='/fixture-login').length,1);await record('two-identities-remain-isolated-no-relogin',{secondOriginal,secondAgain,first:await profileRows(t1),second:await profileRows(t2),loginPosts:1});
 await switchTask(t1);await chooseTab(t1,back);await openProfiles();await app.screenshot(join(root,'B07-profile-current.png'));await done();const beforeQuit=diskState();assert.equal(beforeQuit.workspaces[t1].closed.filter(t=>t.id===cc.id).length,1);report.beforeQuit={browserWorkspaces:beforeQuit.workspaces,first:await profileRows(t1),second:await profileRows(t2)};await quit();const after=diskState(true);assert.deepEqual(after.integrity,[['ok']]);assert.deepEqual(after.workspaces,beforeQuit.workspaces);await record('clean-exit-disk-v1-integrity',{integrity:after.integrity,workspaces:after.workspaces});
 report.checks.push({name:'cookie-import-pause-recovery',status:'not-executed',reason:'No authorized synthetic Chrome/Edge source and system Keychain; no import-source discovery or genuine credential access. Existing isolated import U/I evidence separate.'});report.status='partial-B07.4-profile-lifecycle-passed';
}catch(error){report.status='failed-or-incomplete';report.error=String(error.stack??error);if(app){try{await app.screenshot(join(root,'continuation-failed-ui.png'));}catch{}try{await quit();}catch{}}}
finally{server.closeAllConnections();await new Promise(done=>server.close(done));report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({root,status:report.status,checks:report.checks.map(x=>x.name+':'+x.status),error:report.error}));if(report.status!=='partial-B07.4-profile-lifecycle-passed')process.exitCode=1;}
