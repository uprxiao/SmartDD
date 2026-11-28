// M16 F36 candidate acceptance driver. Private local fixtures; no application source edits.
// Actual browser and shell actions use CDP Input. Read-only main inspector observes app identity/native view.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,realpath,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {join,dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {arch,release} from 'node:os';
import {openElectron,pause} from '/Users/liubu/hx/4.uprxiao/SmartDD/scripts/lib/electron-harness.mjs';
const [bundleArg,pin,cliArg,mode="manual",scope="full"] = process.argv.slice(2);
assert(["visible-destroy","visible-crash-still-wc","hidden-destroy"].includes(mode));assert(["full","skip-known-green"].includes(scope));
assert(bundleArg && cliArg && /^[a-f0-9]{64}$/.test(pin ?? ''),'Run only explicitly allocated bundle, asar SHA256 and local Claude CLI');
const bundle=await realpath(bundleArg);
assert(bundle==='/Users/liubu/hx/4.uprxiao/SmartDD/release/mac-arm64/WillYou.app'||bundle.startsWith('/private/tmp/willyou-')&&bundle.endsWith('/WillYou.app'),'Must use coordinator-allocated build, not installed app');
const executable=join(bundle,'Contents/MacOS/WillYou');
const asar=join(bundle,'Contents/Resources/app.asar');
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
assert.equal(await digest(asar),pin);
const cli=await realpath(cliArg);
const root=await mkdtemp('/private/tmp/willyou-m16-f36-run-');
const userData=join(root,'data'),home=join(root,'home'),cliHome=join(root,'cli-home'),cwd=join(root,'project');
for(const path of [userData,home,cliHome,cwd])await mkdir(path,{mode:0o700});
await writeFile(join(cwd,'fixture.txt'),'M16 F36 isolated file control\n');
console.log('F36 evidence: '+root);
const report={schema:'M16-F36-candidate-a-v1',unit:'F36',mode,scope,sourceBaseline:'coordinator allocated candidate; working tree not inferred from later changes',layer:'Packaged A and read-only native observations; synthetic model cannot certify real provider or S',pin,bundle,executableSha256:await digest(executable),cliSha256:await digest(cli),driverSha256:await digest(new URL(import.meta.url)),root,userData,host:{arch:arch(),release:release()},startedAt:new Date().toISOString(),actions:[],checks:[],requests:[],model:[]};
const priorEvidence='/private/tmp/willyou-m16-f36-run-8OuZcP/result.json';
const priorRed=JSON.parse(await readFile(priorEvidence,'utf8'));
report.pairedCandidate01={source:priorEvidence,sha256:await digest(priorEvidence),screenshot:'/private/tmp/willyou-m16-f36-run-8OuZcP/B02-1-ui-switch-document-history.png',asar:priorRed.pin,driver:priorRed.driverSha256,pid:priorRed.pid,at:priorRed.finishedAt,lastAction:priorRed.actions.at(-1),check:priorRed.checks[0],windowState:priorRed.windowsBeforeQuit,exit:priorRed.exit,boundary:'first red was stopped at an instant native overlap observation (no obscured click); not a proven 1.5s persistent failure'};
const c2menu='/private/tmp/willyou-m16-f36-run-sOiyvD/result.json',c2agent='/private/tmp/willyou-m16-f36-run-seZ3Ix/result.json';
const previousMenu=JSON.parse(await readFile(c2menu,'utf8')),previousAgent=JSON.parse(await readFile(c2agent,'utf8'));
report.pairedCandidate02={asar:previousMenu.pin,menu:{path:c2menu,sha256:await digest(c2menu),observation:previousMenu.pairedMenu,screenshot:'/private/tmp/willyou-m16-f36-run-sOiyvD/paired-menu-fail-shell.png'},fastShow:{path:c2agent,sha256:await digest(c2agent),observation:previousAgent.checks.find(c=>c.name.startsWith('B06.1')).evidence.fast}};
const c3manual='/private/tmp/willyou-m16-f36-run-PU0VDk/result.json',c3agent='/private/tmp/willyou-m16-f36-run-gclRU4/result.json';
const previousManual3=JSON.parse(await readFile(c3manual,'utf8')),previousAgent3=JSON.parse(await readFile(c3agent,'utf8'));
report.pairedCandidate03={asar:previousManual3.pin,manual:{path:c3manual,sha256:await digest(c3manual),checks:previousManual3.checks.map(c=>({name:c.name,status:c.status,error:c.error})),menu:previousManual3.pairedMenu,screenshot:'/private/tmp/willyou-m16-f36-run-PU0VDk/paired-menu-shell.png'},agent:{path:c3agent,sha256:await digest(c3agent),checks:previousAgent3.checks.map(c=>({name:c.name,status:c.status,error:c.error})),fast:previousAgent3.fastAndSlow.fast,normalNavigation:previousAgent3.normalNavigation,nativeRebuild:previousAgent3.nativeRebuild}};
const candidate04Rebuild='/private/tmp/willyou-m16-f36-run-lw9BX2/result.json';
const priorNative04=JSON.parse(await readFile(candidate04Rebuild,'utf8'));
report.pairedCandidate04={asar:priorNative04.pin,driver:priorNative04.driverSha256,path:candidate04Rebuild,sha256:await digest(candidate04Rebuild),nativeLoss:priorNative04.nativeRebuild,visibleText:priorNative04.visibleText,actualLocalRequests:priorNative04.requests,exit:priorNative04.exit,error:priorNative04.checks[0]?.error,coverage:'same independent normal user navigation/back, strict target native close, actual user refresh; candidate04 old native is verified destroyed but registry failed to create new instance; actual UI says 网页身份已经存在. No stale helper reference test in this scope.'};
const persist=()=>writeFile(join(root,'result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
let app,stage='setup',scenario=null,modelSeq=0;
const gate=new Map(),arrived=new Set();
const model='claude-sonnet-5-5';
const key='m16-browser-local-fixture-no-live-secret';
const page=(path,title)=>'<!doctype html><meta charset="utf-8"><title>'+title+'</title><style>body{font:16px system-ui;background:#d9faf4;padding:20px}input{width:240px}button{margin:8px}#mark{background:#119b89;color:white;padding:16px}</style><h1 id="mark">'+title+'</h1><label>表单 <input id="form" aria-label="未提交表单"></label><button id="advance" type="button">进入历史页</button><button id="back" type="button">返回</button><button id="async" type="button">异步操作</button><p id="counter">0</p><p id="response">idle</p><script>window.docMarker=crypto.randomUUID();window.ticks=0;setInterval(()=>{document.querySelector("#counter").textContent=String(++window.ticks)},100);document.querySelector("#advance").onclick=()=>{history.pushState({test:1},"",location.pathname+"?step=2");document.querySelector("#mark").textContent+=" • step 2";};document.querySelector("#back").onclick=()=>history.back();document.querySelector("#async").onclick=async()=>{document.querySelector("#response").textContent="pending";const r=await fetch("/async/"+encodeURIComponent(location.pathname));document.querySelector("#response").textContent=await r.text()};</script>';
const server=createServer(async(req,res)=>{
 try{
  const requestPath=new URL(req.url??'/', 'http://127.0.0.1').pathname;
  if(requestPath.endsWith('/count_tokens')){res.writeHead(200,{'Content-Type':'application/json'}).end('{"input_tokens":40}');return;}
  if(requestPath==='/v1/messages'){
   const parts=[];let size=0;for await(const chunk of req){parts.push(chunk);size+=chunk.length;assert(size<4_000_000);}
   const body=JSON.parse(Buffer.concat(parts).toString());
   assert.equal(req.headers['x-api-key'],key);
   const id='msg_m16_'+ ++modelSeq;
   const msg={id,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:40,output_tokens:1,cache_creation_input_tokens:0,cache_read_input_tokens:0}};
   if(!body.stream){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({...msg,content:[{type:'text',text:'本地合成模型准备'}],stop_reason:'end_turn'}));return;}
   const tools=(body.tools??[]).filter(t=>/browser_tab_open_v2$/.test(t.name));
   const text=JSON.stringify(body.messages);
   let block=null;const answer='M16 fixture acknowledgement';
   if(scenario&&text.includes(scenario.marker)&&!scenario.dispatched){assert(tools.length===1,'Expected one normal browser open tool');scenario.dispatched=true;scenario.dispatchedAt=Date.now();block={name:tools[0].name,input:scenario.input};}
   else if(scenario?.dispatched){await scenario.continuation.promise;}
   report.model.push({id,at:Date.now(),tool:block?.name??null,input:block?.input??null,contract:block?tools[0].input_schema??null:null});
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','request-id':'req_'+modelSeq});
   const send=(type,fields={})=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...fields})+'\n\n');
   send('message_start',{message:msg});send('content_block_start',{index:0,content_block:block?{type:'tool_use',id:'tool_'+modelSeq,name:block.name,input:{}}:{type:'text',text:''}});
   send('content_block_delta',{index:0,delta:block?{type:'input_json_delta',partial_json:JSON.stringify(block.input)}:{type:'text_delta',text:answer}});
   send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:block?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}});send('message_stop');res.end();return;
  }
  const u=new URL(req.url,'http://127.0.0.1');
  report.requests.push({at:Date.now(),path:u.pathname,search:u.search});
  if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  if(u.pathname.startsWith('/async/')){arrived.add(u.pathname);if(gate.has(u.pathname))await gate.get(u.pathname).promise;res.writeHead(200,{'Content-Type':'text/plain'}).end('M16 ASYNC COMPLETE');return;}
  if(!/^\/(?:A|B|C|D|E|F|G|H|I)$/.test(u.pathname)){res.writeHead(404).end('missing synthetic route');return;}
  if(gate.has(u.pathname)){arrived.add(u.pathname);await gate.get(u.pathname).promise;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(page(u.pathname,'测试页面 '+u.pathname.slice(1)));
 }catch(error){report.modelError=String(error.message);if(!res.headersSent)res.writeHead(500);res.end('{}');}
});
await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)});
const origin='http://127.0.0.1:'+server.address().port;
const url=name=>origin+'/'+name;
const wrapper=join(root,'claude-fixture');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const cliEnv={HOME:cliHome,CLAUDE_CONFIG_DIR:join(cliHome,'config'),PATH:'/usr/bin:/bin:/usr/sbin:/sbin',TMPDIR:root,SHELL:'/bin/zsh',LANG:'en_US.UTF-8',NO_PROXY:'127.0.0.1,localhost',ANTHROPIC_BASE_URL:origin,ANTHROPIC_API_KEY:key,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'};
await writeFile(wrapper,'#!/bin/sh\nexec /usr/bin/env -i '+Object.entries(cliEnv).map(([k,v])=>quote(k+'='+v)).join(' ')+' '+quote(cli)+' "$@"\n',{mode:0o700});
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
let freshWs=null,freshTargetEvidence=null;
const trustedBase=u=>{const x=new URL(u);assert(x.protocol==='file:'&&/\/out\/renderer\/index\.html$/.test(x.pathname));x.hash='';return x.href;};
async function exactTrustedTarget(url){const base=trustedBase(url);const port=Number((await readFile(join(userData,'DevToolsActivePort'),'utf8')).split('\n')[0]);assert(Number.isInteger(port)&&port>1024&&port<65536);const response=await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1500)});assert(response.ok);const rows=await response.json();const matches=rows.filter(t=>t.type==='page'&&t.url.startsWith('file:')&&/\/out\/renderer\/index\.html(?:[?#]|$)/.test(t.url)&&trustedBase(t.url)===base);assert.equal(matches.length,1,'exact unique trusted App debug target on own endpoint');const t=matches[0],ws=new URL(t.webSocketDebuggerUrl);assert(ws.protocol==='ws:'&&ws.hostname==='127.0.0.1'&&Number(ws.port)===port&&ws.pathname==='/devtools/page/'+t.id);return {...t,port};}
async function boundTrustedRoot(rootId,id,url){return observeMain((E,rootId,id,url)=>{const r=E.BaseWindow.fromId(rootId),s=E.webContents.fromId(id);if(!r||r.isDestroyed()||!s||s.isDestroyed()||s.getURL()!==url||!r.contentView.children.some(v=>v.webContents===s))throw Error('expected bound trusted shell changed');return{rootId,wc:id,visible:r.isVisible(),focused:r.isFocused(),minimized:r.isMinimized(),rootCount:E.BaseWindow.getAllWindows().filter(x=>!x.isDestroyed()).length,rendererPid:s.getOSProcessId(),url:s.getURL()};},rootId,id,url);}
async function trustedLoaded(rootId,id,url,oldOrigin){return observeMain(async(E,rootId,id,url,oldOrigin)=>{const r=E.BaseWindow.fromId(rootId),w=E.webContents.fromId(id);if(!r||r.isDestroyed()||!w||w.isDestroyed()||w.getURL()!==url||!r.contentView.children.some(v=>v.webContents===w)||w.isLoading())return null;let d;try{d=await w.executeJavaScript('(()=>({timeOrigin:performance.timeOrigin,ready:document.readyState,taskCount:document.querySelectorAll("[data-testid=sidebar-agent-task]").length,body:!!document.body?.children.length,hasApi:!!window.electronAPI}))()')}catch{return null}return d&&d.timeOrigin!==oldOrigin&&d.ready==='complete'&&d.taskCount&&d.body&&d.hasApi?{...d,rendererPid:w.getOSProcessId(),rootCount:E.BaseWindow.getAllWindows().filter(x=>!x.isDestroyed()).length}:null;},rootId,id,url,oldOrigin);}
async function attachFreshTrusted(rootId,wc,url,oldOrigin,oldTargetId,mode){
 const originalHarness=app,base=trustedBase(url);const live=await boundTrustedRoot(rootId,wc,url);assert(live.rootCount===1&&live.visible&&!live.minimized);const target=await exactTrustedTarget(url);if(mode!=='visible-crash-still-wc')assert.notEqual(target.id,oldTargetId,'physically destroyed WC must use new DevTools target');
 const ws=new WebSocket(target.webSocketDebuggerUrl);freshWs=ws;let seq=0,crashed=false;const pending=new Map(),errors=[];
 const closed=()=>{for(const v of pending.values()){clearTimeout(v.timer);v.reject(Error('fresh explicit trusted session closed'));}pending.clear();};
 await new Promise((ok,no)=>{const id=setTimeout(()=>no(Error('fresh target open timed out')),4000);ws.addEventListener('open',()=>{clearTimeout(id);ok();},{once:true});ws.addEventListener('error',()=>{clearTimeout(id);no(Error('fresh target open error'));},{once:true});});
 ws.addEventListener('close',closed);ws.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.method==='Inspector.targetCrashed')crashed=true;if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);const item=pending.get(m.id);if(item){clearTimeout(item.timer);pending.delete(m.id);m.error?item.reject(Error(m.error.message)):item.resolve(m.result);}});
 const raw=(method,params={},timeout=12000)=>new Promise((resolve,reject)=>{if(ws.readyState!==WebSocket.OPEN||crashed)return reject(Error('fresh target no longer usable'));const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('fresh target method timeout '+method));},timeout);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const verifyInput=async()=>{const same=await observeMain((E,rootId,wc,base)=>{const r=E.BaseWindow.fromId(rootId),s=E.webContents.fromId(wc);if(!r||r.isDestroyed()||!s||s.isDestroyed()||!r.contentView.children.some(v=>v.webContents===s)||!r.isVisible()||r.isMinimized())return false;const actual=new URL(s.getURL());actual.hash='';return actual.href===base&&E.BaseWindow.getAllWindows().filter(x=>!x.isDestroyed()).length===1;},rootId,wc,base);assert(same,'fresh trusted native identity/visibility changed before input');};
 const cdp=async(method,params={},timeout)=>{if(method.startsWith('Input.'))await verifyInput();return raw(method,params,timeout);};
 const evaluate=async(expression,timeout)=>{const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},timeout);if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value;};
 await raw('Runtime.enable');await raw('Inspector.enable');const targetInfo=(await raw('Target.getTargetInfo')).targetInfo;assert.equal(targetInfo.targetId,target.id);assert.equal(trustedBase(targetInfo.url),base);const doc=await evaluate('({timeOrigin:performance.timeOrigin,href:location.href,ready:document.readyState,hasApi:!!window.electronAPI})');assert(doc.ready==='complete'&&doc.hasApi&&doc.timeOrigin!==oldOrigin&&trustedBase(doc.href)===base);freshTargetEvidence={targetId:target.id,oldTargetId,port:target.port,rootId,wc,actualNative:live,actualDocument:doc,boundary:'explicit new connection after old loss; no stale session reused, no auto retries' };
 app={...originalHarness,cdp,evaluate,invoke:(channel,...args)=>evaluate('window.electronAPI.invoke('+JSON.stringify(channel)+', ...'+JSON.stringify(args)+')',70000),waitFor:async(expression,ms=10000)=>{const untilAt=Date.now()+ms;while(Date.now()<untilAt){if(await evaluate(expression,Math.max(1,Math.min(3000,untilAt-Date.now()))))return;await pause(50);}throw Error('fresh trusted read-only condition timed out');},screenshot:async file=>{const {data}=await raw('Page.captureScreenshot',{format:'png'});await writeFile(file,Buffer.from(data,'base64'),{mode:0o600});},rendererErrors:[...originalHarness.rendererErrors,...errors],close:async()=>{ws.close();await originalHarness.close();}};
}

async function windows(){return observeMain(E=>E.BaseWindow.getAllWindows().filter(w=>!w.isDestroyed()).map(w=>({id:w.id,title:w.getTitle(),visible:w.isVisible(),minimized:w.isMinimized(),bounds:w.getBounds(),children:w.contentView.children.filter(v=>v.webContents&&!v.webContents.isDestroyed()).map(v=>({id:v.webContents.id,url:v.webContents.getURL(),visible:v.getVisible?.()??null,bounds:v.getBounds()}))})))}
async function bind(){report.pid=await observeMain(()=>process.pid);return report.pid;}
async function shellClick(selector,label=null,{allowKeyboardAlternative=false}={}){
 const getPoint=()=>app.evaluate(js((query,text)=>{
  const nodes=[...document.querySelectorAll(query)].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.matches(':disabled')&&(text===null||e.textContent.trim()===text);});
  if(nodes.length!==1)return null;
  const e=nodes[0];e.scrollIntoView({behavior:'instant',block:'nearest'});const r=e.getBoundingClientRect(),x=Math.floor(r.x+r.width/2),y=Math.floor(r.y+r.height/2);
  return e.contains(document.elementFromPoint(x,y))?{x,y}:null;
 },selector,label));
 let previousPoint=null;const point=await until(async()=>{const fresh=await getPoint();if(!fresh){previousPoint=null;return null;}if(previousPoint?.x===fresh.x&&previousPoint?.y===fresh.y)return fresh;previousPoint=fresh;return null;},'own visible stable UI '+selector+':'+label,8000);assert.deepEqual(await getPoint(),point);
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
 return observeMain(async(E,id,expected)=>{const w=E.webContents.fromId(id);if(!w||w.isDestroyed()||!w.getURL().startsWith(expected))throw Error('Fixture native WC changed');return {id:w.id,process:w.getOSProcessId(),url:w.getURL(),page:await w.executeJavaScript('({marker:window.docMarker,ticks:window.ticks,form:document.querySelector("#form")?.value,history:history.length,response:document.querySelector("#response")?.textContent,title:document.title})')};},page.wc,origin);
}
async function nativeInput(page,method,params){
 assert(method.startsWith('Input.'),'Native page input only');
 return observeMain(async(E,id,expected,method,params)=>{
  const w=E.webContents.fromId(id);if(!w||w.isDestroyed()||!w.getURL().startsWith(expected))throw Error('Fixture native identity mismatch');
  const front=E.BaseWindow.getAllWindows().some(root=>{const c=root.contentView.children;let widx=c.findIndex(v=>v.webContents?.id===id);let shell=c.findIndex(v=>/\/out\/renderer\/index\.html/.test(v.webContents?.getURL?.()??''));return root.isVisible()&&!root.isMinimized()&&widx>shell&&c[widx].getVisible?.()!==false&&c.slice(widx+1).every(v=>v.getVisible?.()===false);});
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
async function inspectMenu(){
 const shell=await app.evaluate(`(()=>{const menu=document.querySelector('.agent-panel-menu');if(!menu)return null;const r=menu.getBoundingClientRect();const image=document.querySelector('.bw-page-snapshot');const b=menu.querySelector('[title="新建网页标签"]');if(!b)return null;const br=b.getBoundingClientRect(),x=Math.floor(br.x+br.width/2),y=Math.floor(br.y+br.height/2);return {menu:{x:r.x,y:r.y,width:r.width,height:r.height},point:{x,y},menuHit:b.contains(document.elementFromPoint(x,y)),snapshot:image?{loaded:image.complete&&image.naturalWidth>0,width:image.naturalWidth,height:image.naturalHeight}:null};})()`);
 if(!shell?.menu.width||!shell.menu.height||!shell.menuHit)return null;
 const native=await windows();const w=native.find(w=>w.children.some(c=>/\/out\/renderer\/index\.html/.test(c.url)));assert(w&&w.visible&&!w.minimized);
 const shellIndex=w.children.findIndex(c=>/\/out\/renderer\/index\.html/.test(c.url));const {x,y}=shell.point;
 const dominates=w.children.slice(shellIndex+1).filter(c=>c.visible!==false&&x>=c.bounds.x&&x<c.bounds.x+c.bounds.width&&y>=c.bounds.y&&y<c.bounds.y+c.bounds.height);
 const pageStillVisible=w.children.slice(shellIndex+1).some(c=>c.url.startsWith(origin)&&c.visible!==false&&c.bounds.width>0&&c.bounds.height>0);
 return {shell,native,dominates,pageStillVisible,at:Date.now()};
}
async function inspectMenuCycle(id,expected){
 const before=await nativeState(expected);const navBefore=report.requests.filter(r=>r.path===new URL(expected.url).pathname).length;
 await shellClick('button[aria-label="打开面板"]');const began=Date.now();let latest;
 try{
  await until(async()=>{latest=await inspectMenu();return latest&&!latest.dominates.length&&(latest.pageStillVisible||latest.shell.snapshot?.loaded)?latest:null},'real native clearance of ordinary plus menu',2500);
  await app.screenshot(join(root,'paired-menu-shell.png'));
  const parked=await nativeState(expected);assert.equal(parked.id,before.id);assert.equal(parked.page.marker,before.page.marker);assert.equal(parked.page.form,before.page.form);assert.equal(parked.page.history,before.page.history);
  report.pairedMenu={before,parked,menu:latest,latencyMs:Date.now()-began,coverage:'shell image and actual native stacking/retained live document; not a desktop-composite screenshot'};await persist();
 }catch(error){report.pairedMenu={status:'fail',before,latest,error:String(error.message),elapsedMs:Date.now()-began};await persist();try{await app.screenshot(join(root,'paired-menu-fail-shell.png'));}catch{}throw error;}
 finally{if(await app.evaluate('Boolean(document.querySelector(".agent-panel-menu"))'))await shellClick('button[aria-label="打开面板"]');}
 const restored=await awaitPage(id,expected.url),after=await nativeState(restored);assert.equal(restored.id,expected.id);assert.equal(after.id,before.id);assert.equal(after.page.marker,before.page.marker);assert.equal(after.page.form,before.page.form);assert.equal(after.page.history,before.page.history);assert.equal(report.requests.filter(r=>r.path===new URL(expected.url).pathname).length,navBefore);
 report.pairedMenu={...report.pairedMenu,status:'pass',restored,after,navBefore,navAfter:navBefore};await persist();return report.pairedMenu;
}
async function check(name,fn,keepIndependent=false){stage=name;try{const evidence=await fn();report.checks.push({name,status:'pass',evidence});await persist();return true;}catch(error){report.checks.push({name,status:'fail',error:String(error.stack??error)});try{await app.screenshot(join(root,name.replace(/[^a-z0-9]/gi,'-')+'.png'))}catch{}await persist();if(!keepIndependent)throw error;await bind();return false;}}
function hold(path){let resolve;const promise=new Promise(r=>{resolve=r});gate.set(path,{promise,resolve});return()=>{resolve();gate.delete(path);}}
async function launch(){app=await openElectron({userData,executable,cwd:root,env:{HOME:home,SMARTDD_CLI_HOME:cliHome,CLAUDE_CONFIG_DIR:join(cliHome,'config'),NO_PROXY:'127.0.0.1,localhost'},inspectMain:true});await bind();}
let t1,t2,tClose,tPanel,tReload,tRebuild,a,b,c,closedIds=[];
const uiState=()=>app.evaluate(`(()=>{const w=document.querySelector('.bw-workspace');const input=w?.querySelector('[aria-label="网页地址"]');const v=Boolean(w?.getBoundingClientRect().width&&input?.getBoundingClientRect().width);return {taskId:v?w.dataset.browserTask:null,address:v?input.value:null,loading:v&&Boolean(w.querySelector('.bw-progress[role=status]')),selected:[...document.querySelectorAll('.agent-panel-tabs [role=tab][aria-selected="true"]')].map(e=>e.textContent.trim())};})()`);
function operationRows(task){
 assert(/^[a-f0-9-]{36}$/.test(task));
 const sql='SELECT request_id,page_id,state,effect_state,summary,error_code,created_at,updated_at FROM browser_operations WHERE task_id='+"'"+task+"'"+" AND command='tab open' AND request_id NOT LIKE 'audit:%' ORDER BY created_at,request_id";
 const value=execFileSync('/usr/bin/sqlite3',['-readonly','-json',join(userData,'smartdd.db'),sql],{encoding:'utf8'}).trim();return value?JSON.parse(value).map(r=>({...r,summary:r.summary?JSON.parse(r.summary):null})):[];
}
async function beginAgent(id,input){
 const before=operationRows(id),marker='WY_F36_'+randomUUID();let finish;const promise=new Promise(ok=>{finish=ok});
 const local={marker,input,dispatched:false,continuation:{promise,finish},before};scenario=local;
 try{
  await switchTask(id);await field('.agent-task-view textarea','请用内置浏览器正常打开这条合成测试网页。'+marker);await shellClick('.agent-task-view button[type="submit"]');
  local.request=await until(async()=>{const state=await agentSnapshot(id);return state.requests?.find(row=>row.payload?.businessKind==='browser_write'&&row.status==='pending')},'normal model browser write approval',30000);
  const choices=await app.evaluate('[...document.querySelectorAll(".agent-request-options button")].map(node=>node.textContent.trim())');const allow=choices.find(text=>/批准|允许/.test(text));assert(allow,'real approval UI');
  await shellClick('.agent-request-options button',allow);await shellClick('.agent-confirm-choice:enabled');local.approvedAt=Date.now();
  local.requestOriginal=local.request.payload?.data?.requestId;
  local.read=()=>operationRows(id).find(row=>!local.before.some(old=>old.request_id===row.request_id)&&(!local.requestOriginal||row.request_id===local.requestOriginal));
  local.accepted=await until(()=>local.read(),'original durable opening operation accepted',30000);
  const expected=local.requestOriginal;if(expected)assert.equal(local.accepted.request_id,expected);
  local.pageId=local.accepted.page_id;
  report.agentSamples??=[];report.agentSamples.push({marker,input,request:local.request.requestId,accepted:local.accepted,approvedAt:local.approvedAt});await persist();
  return local;
 }catch(error){finish();throw error;}
}
async function finishAgent(id,local,expected='ready'){
 try{
  const row=await until(()=>{const r=local.read();return r&&r.summary?.phase!=='loading'&&r.state!=='running'?r:null},'original browser opening terminal receipt',18000);
  assert.equal(row.summary?.phase,expected);assert.equal(row.page_id,local.pageId);
  const notice=await until(async()=>{const state=await agentSnapshot(id);return state.items.find(item=>item.type==='notification'&&item.payload?.requestId===local.request.requestId&&item.payload.status==='finished')},'normal origin host notification',20000);
  return {row,notice:notice.payload,ui:await uiState(),at:Date.now()};
 }finally{local.continuation.finish();await until(async()=>{const state=await agentSnapshot(id),label=await app.evaluate(js(sel=>document.querySelector(sel)?.innerText??'',sidebar(id)));return !state.turns.some(turn=>['dispatching','started','queued','accepted'].includes(turn.status))&&!/工作中|等待批准|等待处理|等待你处理/.test(label)},'synthetic model and actual task UI idle',18000);scenario=null;}
}
async function showAgent(id,expectedUrl,{input={},held=false,assertBeforeReady=true}={}){
 const target=new URL(expectedUrl),holdRelease=held?hold(target.pathname):()=>{};let local;
 try{
  local=await beginAgent(id,{url:expectedUrl,intent:'reuse-or-new',presentation:'show',...input});
  const shown=await until(async()=>{const readStartedAt=Date.now(),observation=await uiState(),current=await snapshot(id);return observation.taskId===id&&observation.address===expectedUrl&&current.activeId===local.pageId?{...observation,readStartedAt,at:Date.now()}:null},'automatic selection in actual right panel',18000);
  if(held){await until(()=>arrived.has(target.pathname),'held real local navigation');assert(shown.loading);assert.equal(local.read().summary?.phase,'loading');holdRelease();}
  const native=await awaitPage(id,expectedUrl,local.pageId);const final=await finishAgent(id,local);
  assert.equal(native.id,local.pageId);assert.equal(final.row.page_id,native.id);
  if(assertBeforeReady&&held)assert(shown.at<=final.row.updated_at);
  return {accepted:local.accepted,shown,native,final};
 }finally{holdRelease();local?.continuation.finish();}
}
async function normalShellReload(tReload){
  await switchTask(tReload);let reloadPage=await newTab(tReload,url('B'));await pageClick(reloadPage,'#form');await nativeInput(reloadPage,'Input.insertText',{text:'重载保留 '+randomUUID()});const before=await nativeState(reloadPage),timeOrigin=await app.evaluate('performance.timeOrigin');assert(before.page.form.startsWith('重载保留 '));
  await app.cdp('Page.reload');await app.waitFor(js(t=>performance.timeOrigin!==t&&!!document.querySelector('[data-testid="sidebar-agent-task"]'),timeOrigin),15000,{navigation:true});
  const hidden=await windows();
  for(const w of hidden){let i=w.children.findIndex(v=>/\/out\/renderer\/index\.html/.test(v.url));if(i!==-1)assert(w.children.slice(i+1).every(v=>!v.url.startsWith(origin)||v.visible===false),'stale browser page covers reloaded shell');}
  await switchTask(tReload);await openPanel();const same=await snapshot(tReload);assert(same.tabs.some(t=>t.id===reloadPage.id));
  // Existing browser panel may restore automatically; if not, reopen panel, not new page.
  report.shellReload={before,hidden,logical:same,uiBeforeSelect:await uiState()};await persist();
  const tabVisible=await until(()=>app.evaluate(js(u=>[...document.querySelectorAll('[role=tab]')].some(e=>e.title===u),reloadPage.url)),'existing saved browser tab available to reselect after reload',5000);assert(tabVisible);
  reloadPage=await chooseTab(tReload,reloadPage);const after=await nativeState(reloadPage);assert.equal(after.id,before.id);assert.equal(after.page.marker,before.page.marker);assert.equal(after.page.form,before.page.form);
  return {before,hidden,after};
}
async function normalRebuild(tRebuild){
   await switchTask(tRebuild);const original=await newTab(tRebuild,url('H'));const initial=await nativeState(original);
   await field('[aria-label="网页地址"]',url('I'));await keypress('Enter');const navigated=await awaitPage(tRebuild,url('I'),original.id);const second=await nativeState(navigated);assert.equal(navigated.id,original.id);assert.equal(navigated.wc,original.wc);assert.notEqual(second.page.marker,initial.page.marker);
   await useBrowserControl(['后退','返回','上一页','后退（⌘[）','后退 (⌘[)']);const returned=await awaitPage(tRebuild,url('H'),original.id);const before=await nativeState(returned);assert.equal(returned.id,original.id);assert.equal(returned.wc,original.wc);
   report.normalNavigation={original,initial,navigated,second,returned,before};await persist();
   // Fault injection is limited to this independent ordinary synthetic fixture page; not a security test.
   const injection=await observeMain((E,id,expected)=>{const w=E.webContents.fromId(id);if(!w||w.isDestroyed()||w.getURL()!==expected||!URL.parse(expected)||URL.parse(expected).hostname!=='127.0.0.1')throw Error('not our current synthetic page');if(typeof w.close!=='function')return{available:false};w.close({waitForBeforeUnload:false});return{available:true,id};},returned.wc,returned.url);
   assert(injection.available,'native lifecycle test method available');
   await until(async()=>!await observeMain((E,id)=>{const w=E.webContents.fromId(id);return Boolean(w&&!w.isDestroyed())},returned.wc),'old synthetic native destroyed');
   report.nativeRebuild={injection,old:before,state:await snapshot(tRebuild),immediatelyAfterDestroy:await windows()};await persist();
   // Recover through a normally visible UI control. The same saved logical page must be retained.
   assert((await snapshot(tRebuild)).tabs.some(t=>t.id===original.id),'original logical page survives native instance loss');
   await useBrowserControl(['刷新网页']);
   let rebuilt;try{rebuilt=await awaitPage(tRebuild,url('H'),original.id);}catch(error){report.nativeRebuild={...report.nativeRebuild,afterRefresh:{state:await snapshot(tRebuild),native:await windows()},failure:String(error.message)};await persist();throw error;}const after=await nativeState(rebuilt);assert.notEqual(rebuilt.wc,returned.wc);assert.notEqual(after.page.marker,before.page.marker);assert.equal(rebuilt.id,original.id);
   return {normal:report.normalNavigation,injection,rebuilt,after,coverage:'actual ordinary navigation/back + deliberately closed synthetic native and normal UI reload; stale agent helper reference rejection and original login session not exercised'};
}

try{
 await launch();
 stage='fixture-setup';
 const tool=await app.invoke('agents.customToolPath','claude',wrapper);
 assert(tool.tool.installed&&tool.tool.login==='api');
 const profile=await app.invoke('agents.save',{name:'F36 local synthetic',toolId:tool.tool.id,source:'login'});
 const project=await app.invoke('projects.create',{name:'F36 isolated project',aliases:[],description:'',rulesPath:null},[{label:'fixture',path:cwd}]);
 const {dirs}=await app.invoke('projects.get',project.id);
 const task=async title=>(await app.invoke('agentTasks.create',{projectId:project.id,dirId:dirs[0].id,cwd,title,profileId:profile.id,tier:'ask',model,carryExtensions:false})).taskId;
 t1=await task('F36 task one');t2=await task('F36 task two');tClose=mode==='manual'?await task('F36 close fixture'):null;tPanel=mode==='manual'?await task('F36 panel fixture'):null;tReload=['visible-destroy','visible-crash-still-wc','hidden-destroy'].includes(mode)?await task('F36 reload fixture'):null;tRebuild=['agent','rebuild'].includes(mode)?await task('F36 native recovery fixture'):null;
 report.fixture={project:project.id,t1,t2,tClose,tPanel,tReload,tRebuild,profile:profile.id,origin};
 await app.cdp('Page.reload');
 await switchTask(t1);
 if(['visible-destroy','visible-crash-still-wc','hidden-destroy'].includes(mode)){
  await check('B10.2-actual-trusted-shell-'+mode,async()=>{
   await switchTask(tReload);const page=await newTab(tReload,url('B'));await pageClick(page,'#form');await nativeInput(page,'Input.insertText',{text:'C11 可信壳恢复应保留 '+randomUUID()});const before=await nativeState(page);assert(before.page.form.startsWith('C11 可信壳恢复应保留 '));
   const oldWindows=await windows(),rootWindow=oldWindows.find(w=>w.children.some(c=>/\/out\/renderer\/index\.html/.test(c.url)));assert(rootWindow&&rootWindow.visible&&!rootWindow.minimized);const shell=rootWindow.children.find(c=>/\/out\/renderer\/index\.html/.test(c.url));assert(shell&&shell.id!==page.wc);
   const oldShellOrigin=await app.evaluate('performance.timeOrigin');const trustedBefore=await boundTrustedRoot(rootWindow.id,shell.id,shell.url);assert(trustedBefore.rootCount===1&&trustedBefore.visible&&trustedBefore.wc===shell.id);assert.notEqual(trustedBefore.rendererPid,before.process,'trusted own shell renderer must not share ordinary page process before controlled crash');const oldTarget=await exactTrustedTarget(shell.url);
   const previous='/private/tmp/willyou-m16-f36-run-F8y164/result.json',prev=JSON.parse(await readFile(previous,'utf8'));report.pairedC10ShellLoss={path:previous,sha256:await digest(previous),pin:prev.pin,last:prev.windowsBeforeQuit,exit:prev.exit,guard:'C10 actual failed same-root recovery after native hide/raise attempt; old user show not established. Preserve original evidence.'};
   report.shellRecovery={mode,oldRoot:rootWindow.id,oldShell:shell.id,oldPage:page,before,oldWindows,oldShellOrigin,trustedBefore,oldTarget:{id:oldTarget.id,url:oldTarget.url}};await persist();
   if(mode==='hidden-destroy'){
    const hide=await observeMain((E,rootId,wc,url)=>{const r=E.BaseWindow.fromId(rootId),s=E.webContents.fromId(wc);if(!r||r.isDestroyed()||!s||s.isDestroyed()||s.getURL()!==url||!r.contentView.children.some(v=>v.webContents===s))throw Error('own hide fixture identity changed');r.hide();return{root:rootId,visible:r.isVisible(),focused:r.isFocused()};},rootWindow.id,shell.id,shell.url);assert(!hide.visible&&!hide.focused);report.shellRecovery.hide=hide;await persist();
   }
   // Fault-injection observation ONLY: exact own trusted WC, not real user action, no ordinary page crash.
   const injected=await observeMain(async(E,rootId,shellId,shellUrl,crash,ordinaryWC)=>{const r=E.BaseWindow.fromId(rootId),s=E.webContents.fromId(shellId),p=E.webContents.fromId(ordinaryWC);if(!r||r.isDestroyed()||!s||s.isDestroyed()||!p||p.isDestroyed()||s.getURL()!==shellUrl||!shellUrl.startsWith('file:')||!shellUrl.includes('/out/renderer/index.html')||!r.contentView.children.some(v=>v.webContents===s)||!r.contentView.children.some(v=>v.webContents===p)||s.getOSProcessId()===p.getOSProcessId())throw Error('exact private fault fixture identity changed');const oldRendererPid=s.getOSProcessId(),pageRendererPid=p.getOSProcessId(),visible=r.isVisible(),at=Date.now();if(crash){return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('actual trusted render-process-gone not observed')),5000);s.once('render-process-gone',(_event,details)=>{clearTimeout(timer);resolve({rootId,shellId,oldRendererPid,pageRendererPid,visible,at,observedAt:Date.now(),nativeEvent:'render-process-gone',reason:details.reason,exitCode:details.exitCode,oldWcStillExists:!s.isDestroyed()&&E.webContents.fromId(shellId)===s,oldPageStillExists:!p.isDestroyed()});});s.forcefullyCrashRenderer();});}s.close({waitForBeforeUnload:false});return{rootId,shellId,oldRendererPid,pageRendererPid,visible,at,nativeAction:'own WebContents.close'};},rootWindow.id,shell.id,shell.url,mode==='visible-crash-still-wc',page.wc);report.shellRecovery.injection=injected;await persist();
   if(mode==='visible-crash-still-wc'){assert.equal(injected.nativeEvent,'render-process-gone');assert(injected.oldWcStillExists&&injected.oldPageStillExists);}else await until(async()=>!await observeMain((E,id)=>{const s=E.webContents.fromId(id);return Boolean(s&&!s.isDestroyed())},shell.id),'actual old trusted native instance destroyed',8000);
   if(mode==='hidden-destroy'){
    const hiddenStart=Date.now(),observations=[];while(Date.now()-hiddenStart<950){const state=await observeMain((E,id,ordinary)=>{const w=E.BaseWindow.fromId(id);if(!w||w.isDestroyed())throw Error('original hidden root lost');return {rootCount:E.BaseWindow.getAllWindows().filter(x=>!x.isDestroyed()).length,id,visible:w.isVisible(),focused:w.isFocused(),children:w.contentView.children.filter(v=>v.webContents&&!v.webContents.isDestroyed()).map(v=>({id:v.webContents.id,url:v.webContents.getURL()})),ordinary:Boolean(E.webContents.fromId(ordinary)&&!E.webContents.fromId(ordinary).isDestroyed())};},rootWindow.id,page.wc);assert.equal(state.rootCount,1);assert(!state.visible&&!state.focused&&state.ordinary&&!state.children.some(c=>/\/out\/renderer\/index\.html/.test(c.url)),'lost hidden root must neither be shown nor recreate a shell before real native show');observations.push(state);await pause(80);}report.shellRecovery.hiddenObservations={durationMs:Date.now()-hiddenStart,samples:observations};await persist();
    const shown=await observeMain((E,id,ordinary)=>{const w=E.BaseWindow.fromId(id),p=E.webContents.fromId(ordinary);if(!w||w.isDestroyed()||w.isVisible()||!p||p.isDestroyed()||!w.contentView.children.some(v=>v.webContents===p))throw Error('own hidden-show fixture identity changed');w.showInactive();return{id,visible:w.isVisible(),focused:w.isFocused(),at:Date.now()};},rootWindow.id,page.wc);assert(shown.visible);report.shellRecovery.nativeShow={...shown,boundary:'actual native showInactive event in controlled A fixture; not physical user S, no synthetic event or business API'};await persist();
   }
   const replacement=await until(async()=>{const roots=await windows();assert.equal(roots.length,1,'must never create second native root');const w=roots.find(w=>w.id===rootWindow.id);const matches=w?.children.filter(v=>/\/out\/renderer\/index\.html/.test(v.url))??[];if(matches.length!==1||!w.visible||w.minimized)return null;const next=matches[0];if(mode==='visible-crash-still-wc'?next.id!==shell.id:next.id===shell.id)return null;const info=await trustedLoaded(rootWindow.id,next.id,next.url,oldShellOrigin);return info?{root:w,next,roots,info}:null;},'same-root actual recovered trusted shell/new document',18000);
   assert(replacement.info.rendererPid>0);if(mode==='visible-crash-still-wc')assert.notEqual(replacement.info.rendererPid,trustedBefore.rendererPid,'crashed trusted renderer genuinely has a new OS process');assert.equal(replacement.info.rootCount,1);const after=await nativeState(page);assert.equal(after.id,before.id);assert.equal(after.process,before.process);assert.equal(after.page.marker,before.page.marker);assert.equal(after.page.form,before.page.form);report.shellRecovery.replacement=replacement;report.shellRecovery.afterNative=after;await persist();
   // A new explicit CDP connection to the actually observed current trusted target. Old destroyed/crashed session is never used or replayed.
   await attachFreshTrusted(rootWindow.id,replacement.next.id,replacement.next.url,oldShellOrigin,oldTarget.id,mode);report.shellRecovery.freshTarget=freshTargetEvidence;await persist();
   await switchTask(tReload);await openPanel();const selected=await chooseTab(tReload,page);const original=await nativeState(selected);assert.equal(selected.id,page.id);assert.equal(selected.wc,before.id);assert.equal(original.page.marker,before.page.marker);assert.equal(original.page.form,before.page.form);report.shellRecovery.actualUiOriginalReselected={selected,original,ui:await uiState(),nativeWindows:await windows()};await app.screenshot(join(root,'B10-C11-recovered-original-ui.png'));await persist();
   const newOperation=await showAgent(tReload,url('C'),{input:{intent:'new'}});assert.notEqual(newOperation.native.id,page.id);assert.equal(newOperation.native.url,url('C'));assert.equal(newOperation.final.row.state,'succeeded');const finalAgain=await chooseTab(tReload,page),finalOriginal=await nativeState(finalAgain);assert.equal(finalAgain.id,page.id);assert.equal(finalOriginal.id,before.id);assert.equal(finalOriginal.page.marker,before.page.marker);assert.equal(finalOriginal.page.form,before.page.form);assert.equal(report.requests.filter(r=>r.path==='/B').length,1,'old ordinary page not silently navigated/replayed');assert.equal(report.requests.filter(r=>r.path==='/C').length,1,'new explicit normal operation single page fetch');
   report.shellRecovery.newLegalUiOperation={newOperation,finalAgain,finalOriginal,requestCounts:{old:1,new:1},nativeWindows:await windows(),boundary:'Actual task input/approval/browser tool + new durable result after recovered trusted shell; original reselected via fresh normal UI.'};await persist();return report.shellRecovery;
  });
 }else if(mode==='reload'){
  await check('B10.2-normal-shell-reload-keeps-live-page',()=>normalShellReload(tReload));
 }else if(mode==='rebuild'){
  await check('B02.3-isolated-native-rebuild-keeps-other-page',async()=>{
   await switchTask(t1);let anchor=await newTab(t1,url('A'));await pageClick(anchor,'#form');await nativeInput(anchor,'Input.insertText',{text:'本轮锚点 '+randomUUID()});const before=await nativeState(anchor);assert(before.page.form?.startsWith('本轮锚点 '));
   const recovered=await normalRebuild(tRebuild);await switchTask(t1);anchor=await chooseTab(t1,anchor);const after=await nativeState(anchor);assert.equal(after.id,before.id);assert.equal(after.page.marker,before.page.marker);assert.equal(after.page.form,before.page.form);assert.equal(report.requests.filter(r=>r.path==='/A').length,1);
   return {recovered,anchor:{before,after},coverage:'same new independent app, ordinary navigation/back + actual physical native close, UI refresh recovery, untouched other task anchor and its actual form; old helper references not tested'};
  });
 }else if(mode==='fast'){
  await check('B06.1-paired-fast-user-approved-show',async()=>{
   const fast=await showAgent(t1,url('D'));report.pairedFast=fast;await persist();assert.equal(fast.final.row.summary.presentationState,'shown','ordinary fast user-approved opening must not self-supersede');assert(fast.shown.at<=fast.final.row.updated_at,'timing observation missing: first driver UI poll ended after persisted ready; actual shown ack independently observed, not proof of product failure');return {fast,coverage:'exact prior red: first fast page with actual real Claude CLI/local deterministic provider, actual UI approval and matching actual front WC; no user switching between approval and visible receipt'};
  });
 }else if(mode==='manual'){
 const fullSwitch=await check('B02.1-ui-switch-document-history',async()=>{
  a=await newTab(t1,url('A'));await pageClick(a,'#form');await nativeInput(a,'Input.insertText',{text:'未提交 '+randomUUID()});await pageClick(a,'#advance');
  const before=await until(async()=>{const s=await nativeState(a);return s.page.form?.startsWith('未提交 ')&&s.url.endsWith('?step=2')?s:null},'native input and history');
  a.url=before.url;
  const menuCycle=await inspectMenuCycle(t1,a);
  report.checks.push({name:'B09.4-paired-candidate01-plus-menu-cycle',status:'pass',evidence:menuCycle});await persist();
  b=await newTab(t1,url('B'));await switchTask(t2);c=await newTab(t2,url('C'));await switchTask(t1);
  assert.equal((await snapshot(t1)).activeId,b.id);a=await chooseTab(t1,a);
  const after=await nativeState(a);assert.equal(after.id,before.id);assert.equal(after.page.marker,before.page.marker);assert.equal(after.page.form,before.page.form);assert.equal(after.page.history,before.page.history);assert(after.page.ticks>=before.page.ticks);
  await switchTask(t2);assert.equal((await snapshot(t2)).activeId,c.id);await switchTask(t1);assert.equal((await snapshot(t1)).activeId,a.id);
  await app.screenshot(join(root,'B02-1-shell.png'));
  assert.deepEqual(report.requests.filter(r=>r.path==='/A').map(r=>r.path),['/A'],'same original page, no unexpected A network reload');
  return {before,after,a,b,c,draw:await windows(),menuCycle};
 },true);
 if(scope==='full'&&(fullSwitch||(a&&a.url?.startsWith(origin))))await check('B02.2-ui-inflight-panel-switch',async()=>{
  await switchTask(t1);await openPanel();a=await chooseTab(t1,a);const before=await nativeState(a),holdPath='/async/'+encodeURIComponent('/A'),releaseGate=hold(holdPath);
  try{
   await pageClick(a,'#async');await until(()=>arrived.has(holdPath),'accepted real page fetch');
   await shellClick('button[title="收起右侧面板"]');
   await app.waitFor('!document.querySelector("[data-testid=agent-workspace-panel]")',10000);
   releaseGate();const completed=await until(async()=>{const state=await nativeState(a);return state.page.response==='M16 ASYNC COMPLETE'?state:null},'in-flight page response while panel hidden');
   await openPanel();await awaitPage(t1,a.url);const after=await nativeState(a);
   assert.equal(after.id,before.id);assert.equal(after.page.marker,before.page.marker);assert.equal(after.page.form,before.page.form);assert.equal(after.page.response,completed.page.response);
   return {before,completed,after,draw:await windows(),coverage:'real local-page HTTP operation, not native agent helper operation or system hide/minimize'};
  }finally{releaseGate();}
 },true);
 await check('B09.1-browser-file-terminal-diff-maximize',async()=>{
  await switchTask(tPanel);let panelPage=await newTab(tPanel,url('H'));const evidence=[];
  for(const kind of ['文件','终端','差异']){
   const button=await app.evaluate(js(text=>[...document.querySelectorAll('.agent-panel-tabs [role=tab]')].some(e=>e.textContent.trim()===text),kind));
   if(button)await shellClick('.agent-panel-tabs [role=tab]',kind);
   else {await shellClick('[aria-label="打开面板"]');const label=await until(()=>app.evaluate(js(text=>[...document.querySelectorAll('.agent-panel-menu button')].find(e=>e.textContent.startsWith(text))?.textContent.trim(),kind)),'visible panel menu item '+kind,6000);const clicked=await shellClick('.agent-panel-menu button',label,{allowKeyboardAlternative:true});if(!clicked){const key={文件:'f',终端:'t',差异:'d'}[kind];await keypress(key,0,'Key'+key.toUpperCase());report.actions.push({stage,kind:'existing-menu-shortcut',key,reason:'native occlusion separately recorded',at:Date.now()});await persist();}}
   const native=await until(async()=>{const w=(await windows()).find(w=>w.children.some(c=>/\/out\/renderer\/index\.html/.test(c.url)));const j=w?.children.findIndex(v=>/\/out\/renderer\/index\.html/.test(v.url));return j>=0&&w.children.slice(j+1).every(v=>!v.url.startsWith(origin))?w:null;},'browser no longer covers '+kind);
   evidence.push({kind,native});
  }
  panelPage=await chooseTab(tPanel,panelPage);const priorBounds=panelPage.bounds;
  await shellClick('button[title="最大化面板"]');await app.waitFor('document.querySelector("[data-testid=agent-workspace-panel]")?.dataset.maximized==="true"');
  const large=await until(async()=>{const p=await awaitPage(tPanel,panelPage.url);return p.bounds.width>priorBounds.width?p:null},'actual maximized native viewport',5000);
  await shellClick('button[title="还原面板"]');await app.waitFor('document.querySelector("[data-testid=agent-workspace-panel]")?.dataset.maximized==="false"');
  const normal=await until(async()=>{const p=await awaitPage(tPanel,panelPage.url);return p.bounds.width<large.bounds.width?p:null},'actual restored native viewport',5000);assert.equal(large.wc,normal.wc);assert(large.bounds.width>normal.bounds.width,'maximized actual native viewport wider than restored');
  return {evidence,large,normal,coverage:'ordinary visible panel switch, no OS focus, HTML/MCP or prior visual comparison'};
 },true);
 if(scope==='full')await check('B04.1-last-ui-close-reopen-new-id',async()=>{
  await switchTask(tClose);const closePage=await newTab(tClose,url('I'));const before=await nativeState(closePage);
  await shellClick('button[aria-label="关闭网页 测试页面 I"]');
  await until(async()=>{const s=await snapshot(tClose);return s.tabs.length===0&&!s.activeId},'last tab removed from state');
  await until(async()=>!await observeMain((E,id)=>{const w=E.webContents.fromId(id);return Boolean(w&&!w.isDestroyed())},closePage.wc),'native last WC actually destroyed');
  closedIds.push(closePage.id);const replacement=await newTab(tClose,closePage.url);
  assert.notEqual(replacement.id,closePage.id);assert.notEqual(replacement.wc,closePage.wc);
  const s=await nativeState(replacement);assert.notEqual(s.page.marker,before.page.marker);
  return {before,replacement,s,coverage:'UI close and same-URL manual new; agent show timing covered separately'};
 },true);
 await check('B10.2-normal-shell-reload-keeps-live-page',()=>normalShellReload(tReload),true);
 }else{
  await check('B06.1-fast-and-delayed-user-approved-open',async()=>{
   const fast=await showAgent(t1,url('D'));const slow=await showAgent(t1,url('E'),{held:true});
   assert.notEqual(fast.native.id,slow.native.id);report.fastAndSlow={fast,slow};await persist();assert.equal(fast.final.row.summary.presentationState,'shown','fast explicit show must not self-supersede');assert.equal(slow.final.row.summary.presentationState,'shown','slow explicit show must record actual presentation acknowledgement');return {fast,slow,coverage:'ordinary new show with real isolated Claude MCP approval, fast and held navigation; no injected stale snapshot or Codex'};
  },true);
  await check('B05.2-current-url-reuse-and-explicit-new',async()=>{
   const existing=await snapshot(t1);if(!existing.tabs.some(t=>t.url===url('E')))await showAgent(t1,url('E'));const prior=await snapshot(t1),before=prior.tabs.find(t=>t.id===prior.activeId);assert(before?.url===url('E'));
   const visits=report.requests.filter(r=>r.path==='/E').length;const reused=await showAgent(t1,url('E'));assert.equal(reused.native.id,before.id);assert.equal(reused.final.row.summary.reused,true);assert.equal(report.requests.filter(r=>r.path==='/E').length,visits);
   const fresh=await showAgent(t1,url('E'),{input:{intent:'new'}});assert.notEqual(fresh.native.id,before.id);assert.equal(fresh.final.row.summary.reused,false);assert.equal(report.requests.filter(r=>r.path==='/E').length,visits+1);
   return {before,reused,fresh,coverage:'same task/default profile only; old frozen provider, different identity, request replay not covered'};
  },true);
  await check('B02.3-normal-navigation-return-native-rebuild',()=>normalRebuild(tRebuild),true);
  await check('B04.1-last-tab-closed-then-normal-agent-reopen',async()=>{
   const first=await showAgent(t2,url('C'));const oldState=await nativeState(first.native);
   await shellClick('button[aria-label="关闭网页 测试页面 C"]');await until(async()=>{const state=await snapshot(t2);return state.tabs.length===0&&!state.activeId},'empty browser after last UI close');
   await until(async()=>!await observeMain((E,id)=>{const w=E.webContents.fromId(id);return Boolean(w&&!w.isDestroyed())},first.native.wc),'closed native actually destroyed');
   const second=await showAgent(t2,url('C'),{held:true});assert.notEqual(second.native.id,first.native.id);assert.notEqual(second.native.wc,first.native.wc);const newState=await nativeState(second.native);assert.notEqual(newState.page.marker,oldState.page.marker);
   return {first,oldState,second,newState,coverage:'ordinary same-URL new show after close; delay covered; error/retry and both speeds after last-close missing'};
  },true);
  await check('B06.3-background-keeps-file-panel',async()=>{
   await switchTask(t2);await shellClick('.agent-panel-tabs [role="tab"]','文件');const before=await uiState();assert.equal(before.taskId,null);assert(before.selected.includes('文件'));
   let local;try{local=await beginAgent(t2,{url:url('F'),presentation:'background',intent:'reuse-or-new'});const final=await finishAgent(t2,local);assert.equal(final.ui.taskId,null);assert.deepEqual(final.ui.selected,before.selected);const tab=(await snapshot(t2)).tabs.find(t=>t.id===local.pageId);assert.equal(tab?.url,url('F'));
    await shellClick('[role="tab"][title='+JSON.stringify(url('F'))+']');const visible=await awaitPage(t2,url('F'));assert.equal(visible.id,local.pageId);return {before,final,visible,coverage:'one real approved background new page while file panel active; no direct tools or existing target'};
   }finally{local?.continuation.finish();}
  },true);
  await check('B06.2-newer-task-selection-over-held-show',async()=>{
   const releaseGate=hold('/G');let local;
   try{local=await beginAgent(t2,{url:url('G'),presentation:'show',intent:'reuse-or-new'});await until(()=>arrived.has('/G'),'held local page opening');await until(async()=>{const state=await uiState();return state.taskId===t2&&state.address===url('G')},'old show selected before new user intent');await switchTask(t1);const userChoice=await uiState();assert.notEqual(userChoice.taskId,t2);releaseGate();const final=await finishAgent(t2,local);assert.notEqual(final.ui.taskId,t2);return {userChoice,final,coverage:'one real normal delayed show then task switch, no released stale event injection or other variants'};
   }finally{releaseGate();local?.continuation.finish();}
  });
 }
 report.status=mode+'-subset-'+(report.checks.some(c=>c.status==='fail')||report.occlusion?.length?'failed':'passed');
}catch(error){report.status=mode+'-subset-failed';report.error=String(error.stack??error);if(app){try{report.visibleText=(await app.evaluate('document.body.innerText')).slice(0,4000);}catch{}}}
finally{
 scenario?.continuation?.finish();for(const {resolve} of gate.values())resolve();gate.clear();
 if(app){try{if(freshWs){report.cleanup=[];for(const id of [t1,t2,tReload].filter(Boolean)){const state=await agentSnapshot(id);const label=await app.evaluate(js(sel=>document.querySelector(sel)?.innerText??'',sidebar(id)));const active=state.turns.some(turn=>['dispatching','started','queued','accepted'].includes(turn.status))||/工作中|等待批准|等待处理|等待你处理/.test(label);try{if(active)await app.invoke('agentTasks.stop',id,true);report.cleanup.push({id,wasActive:active,action:active?'retire only active aborted fixture task; cleanup only':'already idle; no explicit stop'});}catch(error){report.cleanup.push({id,wasActive:active,error:String(error.message)});}}}report.windowsBeforeQuit=await windows();await observeMain(E=>{setTimeout(()=>E.app.quit(),50);return true});}catch(e){report.quitDispatch=String(e.message);}
 try{report.exit=await app.waitForExit(20000);}catch(e){report.exitError=String(e.message);await app.close();}
 report.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.log'),app.logs(),{mode:0o600});if(freshWs)freshWs.close();}
 server.closeAllConnections();await new Promise(ok=>server.close(ok));
 report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({root,status:report.status,error:report.error,checks:report.checks.map(c=>c.name+':'+c.status)}));
 if(report.status.endsWith('failed')||report.exitError)process.exitCode=1;
}
