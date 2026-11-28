// B07.4 C21: fresh only, actual native secure storage journal and benign local preference Cookie.
// SOURCE: the existing cookie-sources.test.ts plaintext synthetic fixture shape. No source decryption, no real browser, no auth tokens.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,realpath,writeFile,readdir,lstat,copyFile} from 'node:fs/promises';
import {watch,readFileSync,lstatSync,realpathSync} from 'node:fs';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {openElectron,pause} from '/Users/liubu/hx/4.uprxiao/SmartDD/scripts/lib/electron-harness.mjs';
const [candidateArg,pin,authorization]=process.argv.slice(2);
assert.equal(authorization,'--authorized-private-synthetic-preference-import');assert.equal(pin,'f46144e6f4ba924a30ffb5aa8ea08e15835a9cd8db0ec6e5b9595e20100c1060');
const candidate=await realpath(candidateArg);assert.equal(candidate,'/Users/liubu/hx/4.uprxiao/SmartDD/release/mac-arm64/WillYou.app');
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex');assert.equal(await digest(join(candidate,'Contents/Resources/app.asar')),pin);
const root=await mkdtemp('/private/tmp/willyou-m16-schedule-app-US7kWL/b07-c21-synthetic-import-'),home=homedir(),cliHome=join(root,'cli-home'),userData=join(root,'data'),evidenceRoot=join(root,'evidence');
assert.equal(process.env.HOME,home);assert(!home.startsWith('/private/tmp/')&&!home.startsWith('/var/folders/'));assert(root.startsWith('/private/tmp/willyou-m16-schedule-app-US7kWL/b07-c21-synthetic-import-')&&await realpath(root)===root);
for(const d of [cliHome,userData,evidenceRoot,join(cliHome,'.config'),join(cliHome,'.local/share'),join(cliHome,'.local/state'),join(cliHome,'.cache'),join(cliHome,'tmp'),join(cliHome,'.claude'),join(cliHome,'.codex'),join(root,'project-target'),join(root,'project-neighbor')]){await mkdir(d,{recursive:true,mode:0o700});assert.equal(await realpath(d),d)}
assert.equal((await readdir(userData)).length,0);
const origin='http://127.0.0.1:3425',url=n=>origin+'/fixture/'+n;
const fixtureLabel='M16-SYNTHETIC-PREFERENCE-ONLY',pref='wy_m16_fixture_preference';const targetBefore='PREFERENCE_TARGET_BEFORE',neighborBefore='PREFERENCE_NEIGHBOR_BEFORE',sourceAfter='PREFERENCE_SOURCE_AFTER';
const sourceDir=join(cliHome,'Library/Application Support/Google/Chrome/Default'),sourceDb=join(sourceDir,'Cookies'),sourceState=join(sourceDir,'../Local State');
await mkdir(sourceDir,{mode:0o700,recursive:true});assert.equal(await realpath(sourceDir),sourceDir);assert(sourceDir.startsWith(cliHome+'/'));assert(!sourceDir.startsWith(home+'/'));
await writeFile(sourceState,JSON.stringify({profile:{info_cache:{Default:{name:fixtureLabel}}}}),{mode:0o600,flag:'wx'});
// Write a NEW noncredential preference-only fixture, not a copy or read of any browser profile.
const fixtureSql=`import sqlite3,sys,time,os
p=sys.argv[1];assert p.startswith('/private/tmp/willyou-m16-schedule-app-US7kWL/b07-c21-synthetic-import-') and '/cli-home/Library/Application Support/' in p;assert not os.path.exists(p)
with sqlite3.connect(p) as c:
 c.executescript("CREATE TABLE meta(key TEXT,value TEXT);INSERT INTO meta VALUES('version','24');CREATE TABLE cookies(host_key TEXT,name TEXT,value TEXT,encrypted_value BLOB,path TEXT,is_secure INTEGER,is_httponly INTEGER,expires_utc INTEGER,samesite INTEGER)")
 expiry=int((time.time()+86400+11644473600)*1000000)
 values=[('wy_m16_fixture_preference','PREFERENCE_SOURCE_AFTER')]+[(f'wy_m16_fixture_color_{i:02d}',f'PREFERENCE_COLOR_{i:02d}') for i in range(1,48)]
 c.executemany('INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?)',[('127.0.0.1',name,value,b'','/',0,0,expiry,1) for name,value in values])
`;
execFileSync('/usr/bin/python3',['-c',fixtureSql,sourceDb]);const sourceStat=await lstat(sourceDb);assert(sourceStat.isFile()&&!sourceStat.isSymbolicLink()&&await realpath(sourceDb)===sourceDb);
const fixtureGuard=()=>{const code=`import sqlite3,sys,json,os\np=sys.argv[1];assert p.startswith('/private/tmp/willyou-m16-schedule-app-US7kWL/b07-c21-synthetic-import-') and '/cli-home/Library/Application Support/' in p;assert os.path.realpath(p)==p\nwith sqlite3.connect('file:'+p+'?mode=ro',uri=True) as c:\n print(json.dumps({'count':c.execute('select count(*) from cookies').fetchone()[0],'nonemptyEncrypted':c.execute('select count(*) from cookies where length(encrypted_value)<>0').fetchone()[0],'wrongDomain':c.execute(\"select count(*) from cookies where host_key<>'127.0.0.1'\").fetchone()[0],'nonFixtureNames':c.execute(\"select count(*) from cookies where name not like 'wy_m16_fixture_%'\").fetchone()[0]}))`;const a=JSON.parse(execFileSync('/usr/bin/python3',['-c',code,sourceDb],{encoding:'utf8'}));assert.deepEqual(a,{count:48,nonemptyEncrypted:0,wrongDomain:0,nonFixtureNames:0});return a};
const sourceSha=await digest(sourceDb),sourceStateSha=await digest(sourceState),sourceGuard=fixtureGuard();
const strip=Object.keys(process.env).filter(n=>/(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|ANTHROPIC_|OPENAI_|GEMINI_|DEEPSEEK_|CLAUDE_CODE_|RJMODEL_|AWS_|AZURE_|GCP_|GOOGLE_|GH_|GITHUB_|GIT_|KUBE|SSH_|PROXY|DYLD_|NODE_OPTIONS|PYTHONPATH|NPM_CONFIG_|BASH_ENV|ENV$|RCFILE|SMARTDD_|WILLYOU_|XDG_|ELECTRON_|CODEX_|CLAUDE_)/i.test(n));const sanitized=Object.fromEntries(strip.map(n=>[n,undefined]));
let app,executable,stage='setup',watcher,timer,server,observing=false,observePromise;
const report={root,evidenceRoot,pin,sourceSha,sourceStateSha,sourceGuard,realSafeStorage:true,noMock:true,allSyntheticPreferencesNotAuthentication:true,noDailyBrowserNoRealBrowserKeychainAccess:true,launches:[],actions:[],checks:[],journalReceipts:[],pauseReceipts:[],httpReceipts:[]};
const persist=()=>writeFile(join(evidenceRoot,'result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});await copyFile(new URL(import.meta.url).pathname,join(evidenceRoot,'driver.snapshot.mjs'));await persist();console.log(JSON.stringify({kind:'B07-private-root',root,pin}));
const record=async(name,data)=>{report.checks.push({name,...data});await persist();console.log(JSON.stringify({kind:'B07-progress',name}));};
const page=(title,value,which)=>'<!doctype html><meta charset="utf-8"><title>'+title+'</title><h1 id="mark">'+title+'</h1><label>未提交文本 <input id="form"></label><p id="session">'+value+'</p><button id="preference">设置合成展示偏好</button><p id="counter">0</p><p id="response">idle</p><script>window.docMarker=crypto.randomUUID();window.ticks=0;setInterval(()=>document.querySelector("#counter").textContent=String(++window.ticks),100);document.querySelector("#preference").onclick=async()=>{const r=await fetch("/set-preference/'+which+'",{method:"POST"});document.querySelector("#session").textContent=await r.text()};</script>';
server=createServer(async(req,res)=>{const u=new URL(req.url??'/',origin);if(u.origin!==origin){res.writeHead(403).end('isolated fixture only');return;}const p=u.pathname;
 if(p==='/v1/responses'&&req.method==='POST'){
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>100000){res.writeHead(413).end();return;}chunks.push(chunk);}
  const b=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(b.model!=='m16-codex-one'||b.input!=='Call the wy_ping tool exactly once.'||!(b.tools??[]).some(t=>t.name==='wy_ping')){res.writeHead(400).end('{}');return;}
  const item={type:'function_call',call_id:'call-probe',name:'wy_ping',arguments:'{}'},id='resp_'+randomUUID();
  res.writeHead(200,{'content-type':'text/event-stream'});const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
  event('response.created',{response:{id,status:'in_progress'}});event('response.output_item.done',{item});event('response.completed',{response:{id,status:'completed',output:[item]}});report.providerChecks??=[];report.providerChecks.push({model:b.model,probe:'synthetic loopback wy_ping only'});res.end();return;
 }
 if(req.method==='POST'&&['/set-preference/target','/set-preference/neighbor'].includes(p)){const value=p.endsWith('/target')?targetBefore:neighborBefore;res.writeHead(200,{'Set-Cookie':`${pref}=${value}; SameSite=Lax; Path=/; Max-Age=86400`,'Content-Type':'text/plain','Cache-Control':'no-store'}).end(value);return}
 if(req.method==='GET'&&['/fixture/target','/fixture/neighbor'].includes(p)){const found=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(pref+'='));let value='PREFERENCE_NONE';for(const known of [targetBefore,neighborBefore,sourceAfter])if(found===pref+'='+known)value=known;report.httpReceipts.push({path:p,preference:value,at:Date.now()});const which=p.endsWith('/target')?'target':'neighbor';res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'}).end(page('M16 preference '+which,value,which));return}
 if(p==='/favicon.ico'){res.writeHead(204).end();return}res.writeHead(404).end('own synthetic origin only');
});server.on('connect',(_req,socket)=>socket.destroy());server.listen({host:'127.0.0.1',port:3425,exclusive:true});await once(server,'listening');assert.equal(server.address().port,3425);
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
 await shellClick('button[aria-label="打开面板"]');const clicked=await shellClick('.agent-panel-menu button[title="新建网页标签"]');
 assert(clicked);
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


async function runApp(label){
 assert(!app);assert.equal(await digest(join(candidate,'Contents/Resources/app.asar')),pin);executable=join(candidate,'Contents/MacOS/WillYou');stage=label;
 app=await openElectron({userData,executable,cwd:root,env:{...sanitized,SMARTDD_USER_DATA:userData,HOME:home,SMARTDD_CLI_HOME:cliHome,ZDOTDIR:cliHome,USERPROFILE:cliHome,CODEX_HOME:join(cliHome,'.codex'),CLAUDE_CONFIG_DIR:join(cliHome,'.claude'),XDG_CONFIG_HOME:join(cliHome,'.config'),XDG_DATA_HOME:join(cliHome,'.local/share'),XDG_STATE_HOME:join(cliHome,'.local/state'),XDG_CACHE_HOME:join(cliHome,'.cache'),NPM_CONFIG_USERCONFIG:join(cliHome,'.npmrc'),GIT_CONFIG_GLOBAL:join(cliHome,'.gitconfig'),TMPDIR:join(cliHome,'tmp'),HTTP_PROXY:origin,HTTPS_PROXY:origin,ALL_PROXY:origin,NO_PROXY:'127.0.0.1,localhost'},inspectMain:true});
 const pid=await bind();const ident=await observeMain(E=>({mock:E.app.commandLine.hasSwitch('use-mock-keychain'),cliHome:process.env.SMARTDD_CLI_HOME,home:process.env.HOME,zDotDir:process.env.ZDOTDIR,userData:E.app.getPath('userData')}));assert.deepEqual(ident,{mock:false,cliHome,home,zDotDir:cliHome,userData});
 await until(async()=>{const w=await windows();return w.some(x=>x.visible&&!x.minimized&&x.children.some(c=>/\/out\/renderer\/index\.html/.test(c.url)))},'unique isolated visible shell',15000);
 report.launches.push({label,pid,pin,ident,port:app.port??null,mainPort:app.mainPort??null,at:Date.now()});await persist();console.log(JSON.stringify({kind:'B07-owned-PID',pid,root,phase:'safeStorage nonsecret preflight',neverApproveSourceBrowserKeychain:true}));
 const safe=await app.mainEvaluate(shellGuard(E=>{if(!E.safeStorage.isEncryptionAvailable())return {available:false};const marker='M16_B07_PRIVATE_NONSECRET_PROBE';let c;try{c=E.safeStorage.encryptString(marker);return {available:true,roundtrip:E.safeStorage.decryptString(c)===marker,cipherBytes:c.length}}finally{if(c)c.fill(0)}}),{label:'genuine-normal-os-synthetic-preflight',timeoutMs:120000});assert(safe.available&&safe.roundtrip&&safe.cipherBytes>0);report.launches.at(-1).safeStorage=safe;await persist();
}
async function quit(){const live=app;assert(live);await observeMain(E=>{setTimeout(()=>E.app.quit(),50);return true});const exit=await live.waitForExit(20000);report.launches.at(-1).exit=exit;assert.equal(exit.code,0);assert.equal(exit.signal,null);app=null;await persist()}
const profileRows=async task=>(await app.invoke('browser.profileSiteStates',{taskId:task})).map(x=>({id:x.profile.id,label:x.profile.label,scope:x.profile.scope,owner:x.profile.owner,importState:x.importState}));
const dlg='[role=dialog][aria-label="登录态管理"]';
async function openProfiles(){await shellClick('.bw-profile');await app.waitFor(js(q=>Boolean(document.querySelector(q)),dlg),15000);}
async function profilePick(row){const label=await app.evaluate(js((q,l)=>{const el=Array.from(document.querySelectorAll(q+' [role=option]')).filter(x=>x.querySelector('strong')?.textContent===l);if(el.length!==1)return null;return el[0].textContent.trim()},dlg,row.label));assert(label,'unique actual profile option');await shellClick(dlg+' [role=option]',label);await app.waitFor(js((q,l)=>document.querySelector(q+' [aria-selected=true] strong')?.textContent===l,dlg,row.label),10000);}
async function done(){await shellClick(dlg+' button','完成');await app.waitFor(js(q=>!document.querySelector(q),dlg),10000);}
async function actionButton(text){await shellClick(dlg+' button',text);}

async function sourceGuardActual(taskId){assert.deepEqual(fixtureGuard(),sourceGuard);assert.equal(await digest(sourceDb),sourceSha);assert.equal(await digest(sourceState),sourceStateSha);const source=await app.invoke('browser.importCookieSources',{taskId});const all=source.browsers.flatMap(b=>b.profiles);assert.equal(all.length,1,'Do not use any other browser/source profile');assert.equal(all[0].family,'chrome');assert.equal(all[0].profileName,fixtureLabel);assert(all[0].hasCookies);return {family:'chrome',onlySyntheticProfile:true,profileName:fixtureLabel,sourceGuard}};
const importDlg='[role=dialog][data-browser-panel="cookie-import"]';
function captureJournal(journalDir,profile){
 const file=join(journalDir,profile+'.bin');assert(file.startsWith(userData+'/browser/import-journal/'));try{const st=lstatSync(file);assert(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<=2*1024*1024);assert.equal(realpathSync(file),file);const bytes=readFileSync(file);try{const entry={at:Date.now(),profile,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),syntheticPlaintextAbsent:![targetBefore,sourceAfter,pref].some(v=>bytes.includes(Buffer.from(v)))};if(!report.journalReceipts.some(x=>x.sha256===entry.sha256))report.journalReceipts.push(entry)}finally{bytes.fill(0)}}catch(e){if(e.code!=='ENOENT')report.journalObservationError=String(e.message)}
}
async function observePause(task,own,neighbor){
 while(observing){try{const rows=await profileRows(task);const state=rows.find(x=>x.id===own.profile)?.importState;const native=await observeMain((E,a,b)=>{const own=E.webContents.fromId(a),neighbor=E.webContents.fromId(b);return {own:own&&!own.isDestroyed()?{id:own.id,url:own.getURL()}:null,neighbor:neighbor&&!neighbor.isDestroyed()?{id:neighbor.id,url:neighbor.getURL()}:null}},own.wc,neighbor.wc);if(state==='importing'||native.own?.url==='about:blank'){report.pauseReceipts.push({at:Date.now(),state,native});if(report.pauseReceipts.length>100)report.pauseReceipts.shift()}}catch(e){report.pauseObservationError=String(e.message)}await pause(12)}
}
async function setPref(p,expected,formValue){assert.equal((await nativeState(p)).page.session,'PREFERENCE_NONE');await pageClick(p,'#preference');await until(async()=>(await nativeState(p)).page.session===expected,'own benign preference marker');await pageClick(p,'#form');await nativeInput(p,'Input.insertText',{text:formValue});const state=await nativeState(p);assert.equal(state.page.session,expected);assert.equal(state.page.form,formValue);return state}
let t1,t2,a,b;
try{
 await runApp('actual-fresh-c21-import');assert.equal((await app.invoke('agentTasks.list')).length,0);
 // Only non-acceptance task setup; actual browser page create/import/confirm UI follows.
 await app.invoke('agents.refreshTools');const detected=(await app.invoke('agents.tools')).find(t=>t.kind==='codex'&&t.installed);assert(detected);
 let provider=await app.invoke('agents.saveProvider',{name:'M16 B07 local keyless fixture',preset:'magpie',endpoints:{responses:origin+'/v1',anthropic:origin+'/'},models:[{id:'m16-codex-one',name:'m16-codex-one',contextWindow:null,offline:false}]});
 assert.equal(provider.preset,'magpie');assert.equal(provider.endpoints.responses,origin+'/v1');const anthropic=new URL(provider.endpoints.anthropic);assert.equal(anthropic.origin,origin);assert.equal(anthropic.pathname,'/');assert(!anthropic.search&&!anthropic.hash&&!anthropic.username&&!anthropic.password);assert.equal(provider.keyHint,null);const countPrivateSecrets=()=>Number(execFileSync('/usr/bin/sqlite3',['-readonly',join(userData,'smartdd.db'),'SELECT count(*) FROM app_secrets'],{encoding:'utf8'}).trim());assert.equal(countPrivateSecrets(),0,'public local Magpie needs no stored secret');provider=await app.invoke('agents.checkProviderModel',provider.id,'codex','m16-codex-one');assert.equal(provider.models.find(m=>m.id==='m16-codex-one')?.availability.codex,'available');assert.equal(countPrivateSecrets(),0);report.keylessSetup={endpoint:origin,secretCount:0,credentialHintNull:true};await persist();
 const agent=await app.invoke('agents.save',{name:'M16 B07 synthetic Codex',toolId:detected.id,source:'provider',providerId:provider.id,models:['m16-codex-one'],defaultModel:'m16-codex-one',isDefault:true});
 async function task(which){const cwd=join(root,'project-'+which),project=await app.invoke('projects.create',{name:'M16 B07 private '+which,aliases:[],description:'',rulesPath:null},[{label:'fixture',path:cwd}]),dir=(await app.invoke('projects.get',project.id)).dirs[0];const result=await app.invoke('agentTasks.create',{projectId:project.id,dirId:dir.id,cwd,profileId:agent.id,model:'m16-codex-one',effort:'medium',tier:'ask',carryExtensions:false,title:'M16 B07 private '+which});assert(result.taskId);return result.taskId}
 t1=await task('target');t2=await task('neighbor');const oldTimeOrigin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor('performance.timeOrigin!=='+oldTimeOrigin+'&&document.readyState==="complete"&&!!document.querySelector("button")',15000,{navigation:true});await bind();
 stage='two-profile-preconditions';await switchTask(t1);a=await newTab(t1,url('target'));const initialA=await setPref(a,targetBefore,'TARGET_UNSAVED');await switchTask(t2);b=await newTab(t2,url('neighbor'));assert.notEqual(a.profile,b.profile);const initialB=await setPref(b,neighborBefore,'NEIGHBOR_UNSAVED');await switchTask(t1);assert.equal((await awaitPage(t1,a.url,a.id)).wc,a.wc);await record('two-distinct-native-owned-synthetic-profiles',{t1,t2,a,b,initialA,initialB});
 stage='ordinary-user-ui-import';const source=await sourceGuardActual(t1);await openProfiles();const row=(await profileRows(t1)).find(x=>x.id===a.profile);assert(row?.importState==='ready');await profilePick(row);await actionButton('导入 Chrome／Edge 登录态');await app.waitFor(js(q=>!!document.querySelector(q),importDlg),10000);const exactSource=await until(()=>app.evaluate(js((q,name)=>{const rows=[...document.querySelectorAll(q+' input[name="import-source"]')];if(rows.length!==1)return null;const e=rows[0];return !e.disabled&&e.parentElement.textContent.includes(name)&&e.checked?{label:e.parentElement.textContent.trim(),selected:true}:null},importDlg,fixtureLabel)),'exactly one selected synthetic source');
 await shellClick(importDlg+' button','下一步');await app.waitFor(js(q=>document.querySelector(q)?.getAttribute('aria-label')==='确认导入',importDlg),10000);const confirm=await app.evaluate(js(q=>document.querySelector(q)?.innerText,importDlg));assert(confirm.includes(fixtureLabel)&&confirm.includes(row.label));await app.screenshot(join(evidenceRoot,'ordinary-confirm-synthetic-source.png'));
 const journalDir=join(userData,'browser/import-journal');const st=await lstat(journalDir);assert(st.isDirectory()&&!st.isSymbolicLink()&&await realpath(journalDir)===journalDir);assert(a.profile.match(/^[A-Za-z0-9_-]+$/));
 watcher=watch(journalDir,()=>captureJournal(journalDir,a.profile));timer=setInterval(()=>captureJournal(journalDir,a.profile),3);observing=true;observePromise=observePause(t1,a,b);
 await shellClick(importDlg+' button','确认导入');await app.waitFor(js(q=>['导入完成','导入未完成'].includes(document.querySelector(q)?.getAttribute('aria-label')),importDlg),45000);observing=false;await observePromise;watcher.close();watcher=null;clearInterval(timer);timer=null;captureJournal(journalDir,a.profile);await persist();
 const result=await app.evaluate(js(q=>{const e=document.querySelector(q);return {title:e?.getAttribute('aria-label'),pairs:[...e.querySelectorAll('.bw-kv span')].map(x=>[x.textContent.trim(),x.nextElementSibling?.textContent.trim()]),errors:[...e.querySelectorAll('[role=alert]')].map(x=>x.textContent.trim())}},importDlg));assert.equal(result.title,'导入完成');assert.equal(result.errors.length,0);const pairs=Object.fromEntries(result.pairs);assert.equal(Number(pairs['已导入']),48);assert.equal(Number(pairs['重新加载的页面']),1);await app.screenshot(join(evidenceRoot,'ordinary-import-real-result.png'));await record('actual-normal-import-completed',{source,exactSource,result,journalReceipts:report.journalReceipts,pauseReceipts:report.pauseReceipts});
 await shellClick(importDlg+' button','完成');await app.waitFor(js(q=>!document.querySelector(q),importDlg),10000);if(await app.evaluate(js(q=>!!document.querySelector(q),dlg)))await done();
 stage='same-owner-native-recovery';const actualA=await awaitPage(t1,a.url,a.id);assert.equal(actualA.wc,a.wc);assert.equal(actualA.profile,a.profile);const afterA=await until(async()=>{const n=await nativeState(actualA);return n.page.session===sourceAfter?n:null},'actual site observes source replacement preference');assert.notEqual(afterA.page.marker,initialA.page.marker);assert.equal(afterA.page.form,'');assert.equal((await profileRows(t1)).find(x=>x.id===a.profile)?.importState,'ready');await switchTask(t2);const actualB=await awaitPage(t2,b.url,b.id);assert.equal(actualB.wc,b.wc);assert.equal(actualB.profile,b.profile);const afterB=await nativeState(actualB);assert.equal(afterB.page.marker,initialB.page.marker);assert.equal(afterB.page.form,'NEIGHBOR_UNSAVED');assert.equal(afterB.page.session,neighborBefore);assert.equal(await digest(sourceDb),sourceSha);assert.equal(await digest(sourceState),sourceStateSha);assert.deepEqual(fixtureGuard(),sourceGuard);assert(!(await readdir(journalDir)).includes(a.profile+'.bin'));await record('original-page-native-WC-restored-and-neighbor-untouched',{actualA,afterA,actualB,afterB,sourceUnmodified:true,journalRemoved:true});
 await quit();
 stage='normal-cold-reopen-existing-synthetic-root';await runApp(stage);await switchTask(t1);const reopenedA=await awaitPage(t1,a.url,a.id);assert.equal(reopenedA.profile,a.profile);assert.equal((await nativeState(reopenedA)).page.session,sourceAfter);await switchTask(t2);const reopenedB=await awaitPage(t2,b.url,b.id);assert.equal(reopenedB.profile,b.profile);assert.equal((await nativeState(reopenedB)).page.session,neighborBefore);await record('cold-reopen-original-tab-profile-and-preference-isolation',{reopenedA,reopenedB});await quit();
 assert.equal(countPrivateSecrets(),0);const realJournal=report.journalReceipts.length>0&&report.journalReceipts.every(x=>x.syntheticPlaintextAbsent);const realPause=report.pauseReceipts.some(x=>x.state==='importing'&&x.native.own?.id===a.wc&&x.native.own.url==='about:blank'&&x.native.neighbor?.id===b.wc&&x.native.neighbor.url===b.url);report.completeNormalA=realJournal&&realPause;report.status=report.completeNormalA?'pass-normal-import-A':'partial-observation-missing';report.realJournalObserved=realJournal;report.realPauseObserved=realPause;await persist();
}catch(e){report.status='failed-or-incomplete';report.error=String(e.stack??e);if(app)try{await app.screenshot(join(evidenceRoot,'failure.png'))}catch{};await persist()}
finally{observing=false;if(watcher)watcher.close();if(timer)clearInterval(timer);if(observePromise)try{await observePromise}catch{};if(app){try{await quit()}catch(e){report.quitFailure=String(e.message);console.log(JSON.stringify({kind:'B07-owned-cleanup-needed',pid:app.processId,root}));await app.close();report.fallbackExit=await app.waitForExit(1000);app=null}}if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}await persist();console.log(JSON.stringify({kind:'B07-end',root,status:report.status,realPause:report.realPauseObserved,realJournal:report.realJournalObserved}));}
