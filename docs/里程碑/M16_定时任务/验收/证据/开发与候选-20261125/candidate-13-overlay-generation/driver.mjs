// M16 B09.4 actual overlay generation regression, synthetic owned native page only.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,realpath,writeFile,cp,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {openElectron,pause} from '/Users/liubu/hx/4.uprxiao/SmartDD/scripts/lib/electron-harness.mjs';
const [candidateArg,pin,mode='overlay-race']=process.argv.slice(2);
assert.equal(mode,'overlay-race');assert(/^[a-f0-9]{64}$/.test(pin));
const root=await mkdtemp('/private/tmp/willyou-m16-f36-overlay-race-'),home=join(root,'home'),cliHome=join(root,'cli-home'),cwd=join(root,'project');
for(const p of [home,cliHome,cwd])await mkdir(p,{mode:0o700});
const userData=join(root,'data');await mkdir(userData,{mode:0o700});
const oldBundle='/private/tmp/willyou-m16-old-state-yUD0pJ/WillYou.app',oldPin='697bb2d273a743c22a2d2c2ebc3c509b0fcee3f9c4bbeeb34146c590b2d9afe2';
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex'),candidate=await realpath(candidateArg);assert(candidate==='/Users/liubu/hx/4.uprxiao/SmartDD/release/mac-arm64/WillYou.app'||candidate.startsWith('/private/tmp/willyou-')&&candidate.endsWith('/WillYou.app'));
assert.equal(await digest(join(candidate,'Contents/Resources/app.asar')),pin);
await writeFile(join(root,'fresh-import.json'),JSON.stringify({userData,source:'empty owned directory; no copied database, browser profile, coordination gate, provider, or key; old actual App generates all records, candidate uses same original path'},null,2));
const origin='http://127.0.0.1:3425',url=name=>origin+'/f36-seed/'+name;
const report={schema:'M16-F36-B09.4-overlay-race-a',root,userData,copyEvidence:join(root,'fresh-import.json'),candidate,pin,oldBundle,oldPin,mode,actions:[],checks:[],requests:[],launches:[],persistence:[],sourceBoundary:'fresh dedicated root, ordinary native page and UI; temporary read-only observation of exact real overlay IPC and bounded delay of only the first actual native capture result; no production source or authorization modified'};
const persist=()=>writeFile(join(root,'B09-overlay-result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
let app,executable,stage='setup',originToken='synthetic-f36-migration';
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
let t1;let restoreObserver;
try{
 await runApp(candidate,pin,'candidate-overlay-race');
 await app.invoke('agents.refreshTools');const tools=await app.invoke('agents.tools'),codex=tools.find(t=>t.kind==='codex'&&t.installed);assert(codex);
 const provider=await app.invoke('agents.saveProvider',{name:'M16 B09 owned fixture',preset:'magpie',endpoints:{responses:origin+'/v1',anthropic:origin+'/'},models:[{id:'m16-codex-one',name:'m16-codex-one',contextWindow:null,offline:false}]});
 const checked=await app.invoke('agents.checkProviderModel',provider.id,'codex','m16-codex-one');assert.equal(checked.models.find(m=>m.id==='m16-codex-one').availability.codex,'available');
 const profile=await app.invoke('agents.save',{name:'M16 B09 fixture',toolId:codex.id,source:'provider',providerId:provider.id,models:['m16-codex-one'],defaultModel:'m16-codex-one',isDefault:true});
 const project=await app.invoke('projects.create',{name:'M16 B09 overlay fixture',aliases:[],description:'',rulesPath:null},[{label:'owned synthetic project',path:cwd}]);const dir=(await app.invoke('projects.get',project.id)).dirs[0];t1=(await app.invoke('agentTasks.create',{projectId:project.id,dirId:dir.id,cwd,title:'M16 B09 actual overlay task',profileId:profile.id,model:'m16-codex-one',effort:'medium',tier:'ask',carryExtensions:false})).taskId;
 await app.cdp('Page.reload');await switchTask(t1);await openPanel();const a=await newTab(t1,url('A')),pre=await nativeState(a);report.before={a,pre,windows:await windows()};await persist();
 const installed=await observeMain((E,id,expected,taskId,pageId)=>{const w=E.webContents.fromId(id);if(!w||w.isDestroyed()||w.getURL()!==expected||new URL(expected).hostname!=='127.0.0.1')throw Error('only exact owned synthetic page');const key=Symbol.for('willyou.qa.b09.capture');if(globalThis[key])throw Error('already attached');const channel='browser.overlay',handlers=E.ipcMain._invokeHandlers,originalHandler=handlers?.get(channel);if(typeof originalHandler!=='function')throw Error('exact Electron handler observer unavailable');const oldDescriptor=Object.getOwnPropertyDescriptor(w,'capturePage'),actual=w.capturePage;const state={calls:[],captures:[],held:false,autoReleased:false};let resolver=null,timer=null;const release=()=>{if(timer)clearTimeout(timer);if(resolver){const r=resolver;resolver=null;r();}};
 E.ipcMain.removeHandler(channel);E.ipcMain.handle(channel,async(event,...args)=>{const input=args[0];let row;if(input?.taskId===taskId&&input?.tabId===pageId){row={seq:state.calls.length+1,open:input.open,owner:input.owner??null,instance:input.instance??null,capture:input.capture??null,at:Date.now(),sender:event.sender.id};state.calls.push(row);}try{const value=await originalHandler(event,...args);if(row){row.end=Date.now();row.result=typeof value==='string'?'image':value===null?'null':typeof value;}return value;}catch(error){if(row){row.end=Date.now();row.error=String(error?.message??error);}throw error;}});
 Object.defineProperty(w,'capturePage',{configurable:true,writable:true,value:function(...args){const row={index:state.captures.length+1,started:Date.now()};state.captures.push(row);return Promise.resolve(actual.apply(w,args)).then(image=>{row.captured=Date.now();row.size=image.getSize();if(row.index!==1)return image;state.held=true;return new Promise(resolve=>{resolver=()=>{row.released=Date.now();state.held=false;resolve(image)};timer=setTimeout(()=>{state.autoReleased=true;release()},8000);});});}});
 const restore=()=>{release();if(oldDescriptor)Object.defineProperty(w,'capturePage',oldDescriptor);else delete w.capturePage;E.ipcMain.removeHandler(channel);E.ipcMain.handle(channel,originalHandler);delete globalThis[key];};globalThis[key]={state,release,restore};return {wc:id,actualHandlerObserved:true,captureDeadlineMs:8000,onlyOwned:true};},a.wc,a.url,t1,a.id);
 report.instrumentation=installed;restoreObserver=()=>observeMain(()=>{const k=Symbol.for('willyou.qa.b09.capture'),v=globalThis[k];if(v)v.restore();return true});const observeRace=()=>observeMain(()=>{const v=globalThis[Symbol.for('willyou.qa.b09.capture')];return v?JSON.parse(JSON.stringify(v.state)):null});
 const isMenu=()=>app.evaluate('Boolean(document.querySelector(".bw-menu[role=menu]"))');
 const front=async()=>{const ws=await windows(),root=ws.find(r=>r.children.some(c=>/\/out\/renderer\/index\.html/.test(c.url))),j=root?.children.findIndex(c=>/\/out\/renderer\/index\.html/.test(c.url))??-1,k=root?.children.findIndex(c=>c.id===a.wc)??-1;return {root:root?.id,shellIndex:j,pageIndex:k,front:k>j&&j>=0&&root.children[k]?.visible!==false,children:root?.children};};
 const selector='button[aria-label="浏览器菜单"]';await shellClick(selector);
 await until(async()=>{const q=await observeRace();return q?.held&&q.calls.some(x=>x.open)&&q.captures[0]?.captured?q:null},'first real capture result held',4000);assert.equal(await isMenu(),false);
 await shellClick(selector);await until(()=>isMenu(),'second menu actually displayed',4000);const beforeRelease=await observeRace();assert(beforeRelease.held&&!beforeRelease.autoReleased);const currentOpen=beforeRelease.calls.filter(x=>x.open&&x.result==='image').at(-1);assert(currentOpen,'new actual open completed with actual image');const newestFront=await front();assert.equal(newestFront.front,false);const imageBefore=await app.evaluate('document.querySelector("img.bw-page-snapshot")?.getAttribute("src")');assert(imageBefore);await app.screenshot(join(root,'latest-menu-before-old-capture.png'));
 await observeMain(()=>{globalThis[Symbol.for('willyou.qa.b09.capture')].release();return true});
 const afterRelease=await until(async()=>{const q=await observeRace();return q?.captures[0]?.released&&q.calls.some(x=>!x.open&&x.end)?q:null},'old actual response and stale close returned',4000);const currentState=await front();const imageAfter=await app.evaluate('document.querySelector("img.bw-page-snapshot")?.getAttribute("src")');
 // Replay only actual arrival-order overlay identity fields against the public
 // holder contract for this known page, never synthesize an IPC invocation.
 const holds=new Map();for(const call of afterRelease.calls){const owner=call.owner??'surface';if(call.open)holds.set(owner,call.instance);else if(call.instance===null||holds.get(owner)===call.instance)holds.delete(owner);}
 const expectedOwner=currentOpen.owner??'surface',exactSurvives=holds.has(expectedOwner)&&holds.get(expectedOwner)===currentOpen.instance;report.race={beforeRelease,afterRelease,newestFront,currentState,menuStillVisible:await isMenu(),sameImage:imageBefore===imageAfter,exactSurvives,expectedOwner,currentInstance:currentOpen.instance,actualHoldReplay:[...holds.entries()]};await app.screenshot(join(root,'latest-menu-after-old-capture.png'));await persist();
 assert(exactSurvives,'old actual close removed latest menu acquisition');assert(report.race.menuStillVisible&&report.race.sameImage&&!currentState.front,'latest native overlay/menu image remains');
 await keypress('Escape');await until(async()=>!(await isMenu()),'actual menu closed');const active=await awaitPage(t1,a.url,a.id),current=await nativeState(active);assert.equal(active.wc,a.wc);assert.equal(current.page.marker,pre.page.marker);report.checks.push({name:'B09.4-real-double-menu-capture-and-release',status:'pass',actualSamePage:current});
 await restoreObserver();restoreObserver=null;
 // Normal settings/menu/find remains available on the same real page.
 await shellClick(selector);await until(()=>isMenu(),'actual menu reopened');await shellClick('.bw-menu [role="menuitem"]','页内查找⌘F');await until(()=>app.evaluate('Boolean(document.querySelector(".bw-find"))'),'actual find surface opened',5000);report.checks.push({name:'B09.4-normal-find-subset',status:'pass'});report.status='subset-pass';
}catch(error){report.error=String(error.stack??error);report.status='subset-fail';if(app){try{await app.screenshot(join(root,stage+'-failed.png'));}catch{}try{if(restoreObserver){await restoreObserver();restoreObserver=null;}}catch{}try{await quit();}catch{}}}
finally{if(app){try{if(restoreObserver)await restoreObserver();await quit();}catch{}}report.noCopiedOrEditedCoordinationGate=true;server.closeAllConnections();await new Promise(ok=>server.close(ok));report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({root,status:report.status,checks:report.checks.map(c=>c.name+':'+c.status),error:report.error}));if(report.status!=='subset-pass')process.exitCode=1;}
