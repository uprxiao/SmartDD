// M16 B07 real old-data browser migration — dedicated sealed A42 synthetic copy only. No credentials or live sites.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,realpath,writeFile,cp,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {openElectron,pause} from '/Users/liubu/hx/4.uprxiao/SmartDD/scripts/lib/electron-harness.mjs';
const [candidateArg,pin,mode='fresh-root-v1-roundtrip']=process.argv.slice(2);
assert.equal(mode,'fresh-root-v1-roundtrip');assert(process.argv.includes('--coordinator-authorized-isolated'));assert.equal(process.platform,'darwin');assert.equal(process.arch,'arm64');assert(/^[a-f0-9]{64}$/.test(pin));
const sourceRoot=await realpath('/private/tmp/willyou-m16-f36-migration-inplace-PqjkL6'),root=await realpath('/private/tmp/willyou-m16-f36-b07-fresh-2gJCYe');let home,cliHome,userData;async function side(name){assert(['old','new'].includes(name));const r=join(root,name);home=join(r,'home');cliHome=join(r,'cli-home');userData=join(r,'data');for(const p of [home,cliHome,userData,join(home,'.config'),join(cliHome,'.codex'),join(cliHome,'.claude')])await mkdir(p,{recursive:true,mode:0o700});assert.equal(await realpath(userData),userData);}
const prior=JSON.parse(await readFile(join(sourceRoot,'B07-migration-result.json'),'utf8'));assert.equal(prior.checks[0].status,'pass');assert.equal(prior.launches.every(l=>l.exit?.code===0),true);assert.equal(prior.oldEnriched.t1!==prior.oldEnriched.t2,true);
const oldBundle='/private/tmp/willyou-m16-old-state-yUD0pJ/WillYou.app',oldPin='697bb2d273a743c22a2d2c2ebc3c509b0fcee3f9c4bbeeb34146c590b2d9afe2';
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex'),candidate=await realpath(candidateArg);assert(candidate==='/Users/liubu/hx/4.uprxiao/SmartDD/release/mac-arm64/WillYou.app'||candidate.startsWith('/private/tmp/willyou-')&&candidate.endsWith('/WillYou.app'));
assert.equal(await digest(join(oldBundle,'Contents/Resources/app.asar')),oldPin);assert.equal(await digest(join(candidate,'Contents/Resources/app.asar')),pin);
const origin='http://127.0.0.1:3425',url=name=>origin+'/f36-seed/'+name;
const report={schema:'M16-F36-B07-fresh-root-v1-roundtrip-a',root,sourceRoot,candidate,pin,oldBundle,oldPin,mode,actions:[],checks:[],requests:[],launches:[],persistence:[],transfers:[],priorResultSha:await digest(join(sourceRoot,'B07-migration-result.json')),sourceBoundary:'Two distinct fresh native App roots, both original sealed sources readonly; project exact 5 v1 browser rows, 2 own synthetic partition dirs and no-secret unlaunched business FK graph; old real UI writes and new actual reads; never copy database/gates/runtime. Historical evidence:  unchanged 0041 destination. Migration ledger and physical gate inode untouched; not whole application downgrade or independent product build.'};
await cp(new URL(import.meta.url),join(root,'driver.resume.snapshot.mjs'));await cp('/private/tmp/willyou-m16-f36-qa/b07-v1-fresh-root-fixture.py',join(root,'fixture.resume.snapshot.py'));
const persist=()=>writeFile(join(root,'B07-v1-roundtrip-resume-result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
for(const n of Object.keys(process.env).filter(n=>/(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH_SOCK)/i.test(n)))delete process.env[n];
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
const t1=prior.oldEnriched.t1,t2=prior.oldEnriched.t2;let prepared=false;
function fixture(mode){return JSON.parse(execFileSync('python3',['/private/tmp/willyou-m16-f36-qa/b07-v1-fresh-root-fixture.py',mode,root],{encoding:'utf8',maxBuffer:2*1024*1024}));}
try{
 report.transfers.push(fixture('preflight'));await persist();
 const initial=JSON.parse(await readFile(join(root,'B07-v1-roundtrip-result.json'),'utf8')),diagnostic=JSON.parse(await readFile(join(root,'new/private-readiness-diagnostic.json'),'utf8'));assert.equal(initial.launches.length,1);assert.equal(initial.launches[0].label,'fresh-old-native-init');assert.equal(initial.launches[0].exit.code,0);assert(diagnostic.ready&&diagnostic.trusted.api&&diagnostic.trusted.navSettings&&diagnostic.normalExit.code===0);report.priorInitialFailure={sha:await digest(join(root,'B07-v1-roundtrip-result.json')),error:initial.error};report.priorNewDiagnostic={sha:await digest(join(root,'new/private-readiness-diagnostic.json')),normalExit:diagnostic.normalExit};report.launches.push(...initial.launches,{label:'fresh-new-native-init-diagnostic',pid:diagnostic.pid,bundle:candidate,expected:pin,exit:diagnostic.normalExit});await persist();
 await side('old');report.transfers.push(fixture('seed-old'));await persist();assert.equal(diskState(true).version,40);
 const projected=prior.candidateWrites.disk;
 await runApp(oldBundle,oldPin,'v1-old-reverse');const legacy1=await verifyTask(t1,projected.workspaces[t1],true,'legacy-read-current-written');const legacy2=await verifyTask(t2,projected.workspaces[t2],false,'legacy-independent');const independent=trimmed(diskState().workspaces[t2]);assert.equal(report.requests.filter(r=>r.path==='/fixture-login').length,0);assert.equal(legacy1.url,url('D'));const oldClosed=prior.candidateWrites.c.id;assert(!diskState().workspaces[t1].tabs.some(t=>t.id===oldClosed));assert.equal(diskState().workspaces[t1].closed.filter(t=>t.id===oldClosed).length,1);
 await switchTask(t1);await openPanel();const d=await chooseTab(t1,projected.workspaces[t1].tabs.find(t=>t.id===projected.workspaces[t1].activeId));const reopened=await newTab(t1,url('C'));assert.notEqual(reopened.id,oldClosed);assert.equal((await nativeState(reopened)).page.session,'SYNTHETIC_LOGIN_OK');await closePage(t1,d,'测试页面 D');await chooseTab(t1,reopened);const legacyState=diskState();assert.deepEqual(trimmed(legacyState.workspaces[t2]),independent);assert.equal(legacyState.workspaces[t1].activeId,reopened.id);assert.equal(legacyState.workspaces[t1].closed.filter(t=>t.id===d.id).length,1);report.legacy={read:{legacy1,legacy2},reopened,closedCurrentId:d.id,state:legacyState};await app.screenshot(join(root,'B07-v1-old-written.png'));await quit();assert.deepEqual(diskState(true).integrity,[['ok']]);report.checks.push({name:'old-real-reader-and-writer-scoped-v1',status:'pass'});await persist();
 await side('new');report.transfers.push(fixture('seed-new'));await persist();assert.equal(diskState(true).version,41);
 await runApp(candidate,pin,'v1-new-return');const returned1=await verifyTask(t1,legacyState.workspaces[t1],true,'C16-read-old-written');const returned2=await verifyTask(t2,legacyState.workspaces[t2],false,'C16-independent');assert.equal(returned1.url,url('C'));assert.equal(report.requests.filter(r=>r.path==='/fixture-login').length,0);assert.equal(diskState().workspaces[t1].activeId,reopened.id);assert(!diskState().workspaces[t1].tabs.some(t=>t.id===d.id));assert.equal(diskState().workspaces[t1].closed.filter(t=>t.id===d.id).length,1);report.returned={returned1,returned2,state:diskState()};await app.screenshot(join(root,'B07-v1-new-return.png'));await quit();assert.deepEqual(diskState(true).integrity,[['ok']]);report.checks.push({name:'C14-real-reader-old-written-scoped-v1',status:'pass'});report.status='actual-scoped-v1-roundtrip-pass';
}catch(error){report.error=String(error.stack??error);report.status='subset-fail';if(app){try{await app.screenshot(join(root,stage+'-failed.png'));}catch{}try{await quit();}catch{}}}
finally{server.closeAllConnections();await new Promise(ok=>server.close(ok));report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({root,status:report.status,checks:report.checks.map(c=>c.name+':'+c.status),error:report.error}));if(report.status!=='actual-scoped-v1-roundtrip-pass')process.exitCode=1;}
