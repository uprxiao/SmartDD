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
assert(mode==="joint-resume");assert(["full","skip-known-green"].includes(scope));
assert(bundleArg && cliArg && /^[a-f0-9]{64}$/.test(pin ?? ''),'Run only explicitly allocated bundle, asar SHA256 and local Claude CLI');
const bundle=await realpath(bundleArg);
assert(bundle==='/Users/liubu/hx/4.uprxiao/SmartDD/release/mac-arm64/WillYou.app'||bundle.startsWith('/private/tmp/willyou-')&&bundle.endsWith('/WillYou.app'),'Must use coordinator-allocated build, not installed app');
const executable=join(bundle,'Contents/MacOS/WillYou');
const asar=join(bundle,'Contents/Resources/app.asar');
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
assert.equal(await digest(asar),pin);
const cli=await realpath(cliArg);
const root='/private/tmp/willyou-m16-f36-run-UVmpiS';const prior=JSON.parse(await readFile(join(root,'result.json'),'utf8')),sealed=JSON.parse(await readFile('/private/tmp/willyou-m16-f36-qa/joint-c09-first-sealed/manifest.json','utf8'));assert.equal(prior.pin,pin);assert.equal(prior.exit.code,0);assert.equal(prior.exit.signal,null);assert.equal(prior.jointRuns.length,4);assert.equal(await digest(join(root,'result.json')),sealed.priorResultSha);assert.equal(await digest(join(root,'data/smartdd.db')),sealed.priorDataSha);assert.equal(await digest(join(root,'claude-fixture')),sealed.priorWrapperSha);
const userData=join(root,'data'),home=join(root,'home'),cliHome=join(root,'cli-home'),cwd=join(root,'project');
assert.equal(prior.userData,userData);
console.log('F36 same fixture resumed evidence: '+root+'/resume-result.json');
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
const persist=()=>writeFile(join(root,'resume-result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
report.pairedC07LocatorFailure='/private/tmp/willyou-m16-f36-run-sPCtuH/result.json';report.pairedC07ActualRed='/private/tmp/willyou-m16-f36-qa/B12-C07-provider-red.json';report.pairedC08ApprovedBusiness='/private/tmp/willyou-m16-f36-run-TMqzBe/result.json';
report.priorFixtureResult=sealed;report.jointRuns=[...prior.jointRuns];report.jointAttempt=[...prior.jointAttempt];let app,stage='setup',scenario=null,modelSeq=1000;
const gate=new Map(),arrived=new Set();
const model='claude-sonnet-5-5';
const key='m16-browser-local-fixture-no-live-secret';
const page=(path,title,logged=false)=>'<!doctype html><meta charset="utf-8"><title>'+title+'</title><style>body{font:16px system-ui;background:#d9faf4;padding:20px}input{width:240px}button{margin:8px}#mark{background:#119b89;color:white;padding:16px}</style><h1 id="mark">'+title+'</h1><label>表单 <input id="form" aria-label="未提交表单"></label><p id="session">'+(logged?'SYNTHETIC_LOGIN_OK':'SYNTHETIC_LOGIN_NONE')+'</p><button id="login" type="button">合成登录</button><button id="advance" type="button">进入历史页</button><button id="back" type="button">返回</button><button id="async" type="button">异步操作</button><p id="counter">0</p><p id="response">idle</p><script>window.docMarker=crypto.randomUUID();window.ticks=0;document.querySelector("#login").onclick=async()=>{const r=await fetch("/fixture-login",{method:"POST"});if(r.ok)document.querySelector("#session").textContent="SYNTHETIC_LOGIN_OK";};setInterval(()=>{document.querySelector("#counter").textContent=String(++window.ticks)},100);document.querySelector("#advance").onclick=()=>{history.pushState({test:1},"",location.pathname+"?step=2");document.querySelector("#mark").textContent+=" • step 2";};document.querySelector("#back").onclick=()=>history.back();document.querySelector("#async").onclick=async()=>{document.querySelector("#response").textContent="pending";const r=await fetch("/async/"+encodeURIComponent(location.pathname));document.querySelector("#response").textContent=await r.text()};</script>';
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
   if(scenario&&text.includes(scenario.marker)&&!scenario.dispatched){assert(tools.length===1,'Expected one normal browser open tool');scenario.dispatched=true;scenario.dispatchedAt=Date.now();scenario.openToolUseId='tool_'+modelSeq;block={name:tools[0].name,input:scenario.input};}
   else if(scenario?.dispatched){
     const local=scenario;const openReply=(body.messages??[]).flatMap(m=>Array.isArray(m.content)?m.content:[]).find(item=>item.type==='tool_result'&&item.tool_use_id===local.openToolUseId);
     if(openReply&&!local.originalOpenResponse){const raw=JSON.stringify(openReply.content??openReply),texts=typeof openReply.content==='string'?[openReply.content]:Array.isArray(openReply.content)?openReply.content.filter(x=>x.type==='text'&&typeof x.text==='string').map(x=>x.text):[];local.originalOpenResponse={isError:Boolean(openReply.is_error),sha256:createHash('sha256').update(raw).digest('hex'),preview:texts.map(t=>t.slice(0,800)).join(' | ').slice(0,1200),at:Date.now()};report.originalOpenResponses??=[];report.originalOpenResponses.push({marker:local.marker,...local.originalOpenResponse});await persist();}
     await local.continuation.promise;
     if(local.awaitRead){const prior=(body.messages??[]).flatMap(m=>Array.isArray(m.content)?m.content:[]).find(item=>item.type==='tool_result'&&item.tool_use_id===local.awaitRead.id);if(prior){
       const raw=JSON.stringify(prior.content??prior);const texts=typeof prior.content==='string'?[prior.content]:Array.isArray(prior.content)?prior.content.filter(x=>x.type==='text'&&typeof x.text==='string').map(x=>x.text):[];let parsed=null;
       for(const value of texts){for(const candidate of [value,...value.split('\n').filter(line=>line.trim().startsWith('{'))]){try{const env=JSON.parse(candidate);if(env.schema==='willyou-app-result-v2'){parsed=env;break;}}catch{}}if(parsed)break;}
       const result={name:local.awaitRead.name,isError:Boolean(prior.is_error),statusOk:Boolean(parsed&&parsed.status==='ok'&&!prior.is_error),schema:parsed?.schema??null,resultStatus:parsed?.status??null,sha256:createHash('sha256').update(raw).digest('hex'),containsLoginTrue:raw.includes('SYNTHETIC_LOGIN_OK'),containsLoginNone:raw.includes('SYNTHETIC_LOGIN_NONE'),containsOwnPage:raw.includes(local.pageId??'not-a-real-id'),uuidValues:[...new Set(raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)??[])],receiptPreview:texts.map(t=>t.slice(0,500)).join(' | ').slice(0,1300)};
       local.readResults??=[];local.readResults.push(result);local.awaitRead=null;
     }}
     if(local.readQueue?.length&&!local.awaitRead){const spec=local.readQueue.shift();const matched=(body.tools??[]).filter(t=>t.name.endsWith(spec.suffix));assert.equal(matched.length,1,'One actual own-scope normal read tool '+spec.suffix);block={name:matched[0].name,input:spec.input};local.awaitRead={id:'tool_'+modelSeq,name:spec.suffix};}
   }
   report.model.push({id,at:Date.now(),tool:block?.name??null,input:block?.input??null,contract:block?(body.tools??[]).find(t=>t.name===block.name)?.input_schema??null:null});
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','request-id':'req_'+modelSeq});
   const send=(type,fields={})=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...fields})+'\n\n');
   send('message_start',{message:msg});send('content_block_start',{index:0,content_block:block?{type:'tool_use',id:'tool_'+modelSeq,name:block.name,input:{}}:{type:'text',text:''}});
   send('content_block_delta',{index:0,delta:block?{type:'input_json_delta',partial_json:JSON.stringify(block.input)}:{type:'text_delta',text:answer}});
   send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:block?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}});send('message_stop');res.end();return;
  }
  const u=new URL(req.url,'http://127.0.0.1');
  report.requests.push({at:Date.now(),path:u.pathname,search:u.search,syntheticLoggedIn:Boolean(req.headers.cookie?.includes('wy_fixture_auth=1'))});
  if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  if(u.pathname==='/fixture-login'&&req.method==='POST'){res.writeHead(200,{'Set-Cookie':'wy_fixture_auth=1; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax','Content-Type':'text/plain'}).end('synthetic fixture only');return;}
  if(u.pathname.startsWith('/async/')){arrived.add(u.pathname);if(gate.has(u.pathname))await gate.get(u.pathname).promise;res.writeHead(200,{'Content-Type':'text/plain'}).end('M16 ASYNC COMPLETE');return;}
  if(!/^\/(?:A|B|C|D|E|F|G|H|I|S)$/.test(u.pathname)){res.writeHead(404).end('missing synthetic route');return;}
  if(gate.has(u.pathname)){arrived.add(u.pathname);await gate.get(u.pathname).promise;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(page(u.pathname,'测试页面 '+u.pathname.slice(1),Boolean(req.headers.cookie?.includes('wy_fixture_auth=1'))));
 }catch(error){report.modelError=String(error.message);if(!res.headersSent)res.writeHead(500);res.end('{}');}
});
await new Promise((ok,no)=>{server.once('error',no);server.listen({host:'127.0.0.1',port:Number(new URL(prior.fixture.origin).port),exclusive:true},ok)});
const origin='http://127.0.0.1:'+server.address().port;
const url=name=>origin+'/'+name;
const wrapper=join(root,'claude-fixture');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const cliEnv={HOME:cliHome,CLAUDE_CONFIG_DIR:join(cliHome,'config'),PATH:'/usr/bin:/bin:/usr/sbin:/sbin',TMPDIR:root,SHELL:'/bin/zsh',LANG:'en_US.UTF-8',NO_PROXY:'127.0.0.1,localhost',ANTHROPIC_BASE_URL:origin,ANTHROPIC_API_KEY:key,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'};
assert.equal(await digest(wrapper),sealed.priorWrapperSha);assert.equal(origin,prior.fixture.origin);
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
async function windows(){return observeMain(E=>E.BaseWindow.getAllWindows().filter(w=>!w.isDestroyed()).map(w=>({id:w.id,title:w.getTitle(),visible:w.isVisible(),minimized:w.isMinimized(),bounds:w.getBounds(),children:w.contentView.children.filter(v=>v.webContents&&!v.webContents.isDestroyed()).map(v=>({id:v.webContents.id,url:v.webContents.getURL(),visible:v.getVisible?.()??null,bounds:v.getBounds()}))})))}
async function bind(){report.pid=await observeMain(()=>process.pid);return report.pid;}
async function shellClick(selector,label=null,{allowKeyboardAlternative=false}={}){
 const getPoint=()=>app.evaluate(js((query,text)=>{
  const nodes=[...document.querySelectorAll(query)].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.matches(':disabled')&&(text===null||e.textContent.trim()===text);});
  if(nodes.length!==1)return null;
  const e=nodes[0];e.scrollIntoView({behavior:'instant',block:'nearest'});const r=e.getBoundingClientRect(),x=Math.floor(r.x+r.width/2),y=Math.floor(r.y+r.height/2);
  return e.contains(document.elementFromPoint(x,y))?{x,y}:null;
 },selector,label));
 let prev=null;const point=await until(async()=>{const x=await getPoint();if(!x){prev=null;return null;}if(prev?.x===x.x&&prev?.y===x.y)return x;prev=x;return null;},'own visible stable UI '+selector+':'+label,8000);assert.deepEqual(await getPoint(),point);
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
async function check(name,fn,keepIndependent=false){stage=name;try{const evidence=await fn();report.checks.push({name,status:'pass',evidence});await persist();return true;}catch(error){report.checks.push({name,status:'fail',error:String(error.stack??error)});try{await app.screenshot(join(root,'resume-'+name.replace(/[^a-z0-9]/gi,'-')+'.png'))}catch{}await persist();if(!keepIndependent)throw error;await bind();return false;}}
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
 }finally{local.continuation.finish();await until(async()=>{const state=await agentSnapshot(id),label=await app.evaluate(js(sel=>document.querySelector(sel)?.innerText??'',sidebar(id)));return !state.turns.some(turn=>['dispatching','started','queued'].includes(turn.status))&&!/工作中|等待批准|等待处理|等待你处理/.test(label)},'synthetic model and actual task UI idle',18000);scenario=null;}
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


async function scheduleField(label,inner='input,select,textarea,button'){
 const selector=await until(()=>app.evaluate(js((label,inner)=>{const candidates=[...document.querySelectorAll('.schedule-form label')].filter(e=>[...e.childNodes].filter(x=>x.nodeType===3).map(x=>x.textContent).join('').trim()===label);if(candidates.length!==1)return null;let e=candidates[0].querySelector(inner);if(!e)return null;const parts=[];while(e&&!e.matches('.schedule-form')){const i=[...e.parentElement.children].indexOf(e)+1;parts.unshift(e.tagName.toLowerCase()+':nth-child('+i+')');e=e.parentElement;}return e?'.schedule-form > '+parts.join(' > '):null;},label,inner)),'one actual schedule field '+label,6000);return selector;
}
async function scheduleSelect(label,value){const selector=await scheduleField(label,'select');const data=await app.evaluate(js(s=>{const e=document.querySelector(s);return {value:e.value,options:[...e.options].map(o=>({value:o.value,label:o.textContent.trim()}))}},selector));if(data.value===value)return;const option=data.options.find(o=>o.value===value);assert(option,'known valid select option '+label+' '+value);
 await shellClick(await scheduleField('计划名称','input'));for(let i=0;i<40;i++){if(await app.evaluate(js(s=>document.activeElement===document.querySelector(s),selector)))break;for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:48});}
 assert(await app.evaluate(js(s=>document.activeElement===document.querySelector(s),selector)), 'actual select focus');let prefix=option.label;for(let n=1;n<=option.label.length;n++)if(data.options.filter(o=>o.label.startsWith(option.label.slice(0,n))).length===1){prefix=option.label.slice(0,n);break}
 for(const ch of Array.from(prefix))await app.cdp('Input.dispatchKeyEvent',{type:'char',key:ch,text:ch});await until(()=>app.evaluate(js((s,v)=>document.querySelector(s)?.value===v,selector,value)),'actual selected '+label,4000);
 for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:48});
}
async function scheduleNav(){if(!await app.evaluate('Boolean(document.querySelector(".scheduled-sidebar"))'))await shellClick('[aria-label="定时任务"],[title="定时任务"]');await app.waitFor('Boolean(document.querySelector(".scheduled-sidebar"))',8000);}
async function planForm(title,marker,{destination='new',projectId=null}={}){
 await scheduleNav();await shellClick('.scheduled-sidebar .nav-row','新建计划');await app.waitFor('Boolean(document.querySelector(".schedule-form"))',8000);await field(await scheduleField('计划名称','input'),title);await field(await scheduleField('提示词','textarea'),'打开并读取我们自己的合成登录页面和截图。'+marker);if(projectId){await scheduleSelect('项目',projectId);const priorDir='17010801-1a7f-4540-80d7-53ab5abe12dd';await scheduleSelect('项目目录',priorDir);}if(destination!=='new')await scheduleSelect('任务去向',destination);
 await shellClick('.schedule-form .schedule-primary');const p=await until(async()=>!(await app.evaluate('Boolean(document.querySelector(".schedule-form"))'))&&(await app.invoke('schedule.list')).find(p=>p.config.title===title),'real schedule saved',8000);assert.equal(p.config.destination,destination);assert.equal(p.config.projectId,projectId);return p;
}
async function openPlan(p){await scheduleNav();if(!await app.evaluate(js(title=>document.querySelector('.schedule-heading h1')?.innerText===title&&[...document.querySelectorAll('.schedule-heading button')].some(b=>b.textContent.trim()==='立即运行'),p.config.title))){const full=await until(()=>app.evaluate(js(title=>[...document.querySelectorAll('button.schedule-side-entry')].find(e=>e.querySelector('span')?.firstChild?.textContent?.trim()===title)?.textContent.trim(),p.config.title)),'actual schedule button full visible label',8000);await shellClick('button.schedule-side-entry',full);}await app.waitFor(js(title=>document.querySelector('.schedule-heading h1')?.innerText===title&&[...document.querySelectorAll('.schedule-heading button')].some(b=>b.textContent.trim()==='立即运行'),p.config.title),8000);}
async function triggerPlan(p){await openPlan(p);const n=(await app.invoke('schedule.get',p.id)).history.length;await shellClick('.schedule-heading button','立即运行');return until(async()=>{const d=await app.invoke('schedule.get',p.id);return d.history.length>n?d.history[0]:null},'actual schedule occurrence',10000);}
async function goOccurrenceTask(p,r){
 const current=await until(async()=>{const d=await app.invoke('schedule.get',p.id);return d.history.find(v=>v.id===r.id&&v.taskId)},'actual occurrence owns task',20000);
 await openPlan(p);const data=await app.invoke('schedule.get',p.id),index=data.history.findIndex(x=>x.id===r.id);assert(index>=0);await shellClick('table tbody tr:nth-child('+(index+1)+') button');await shellClick('button','查看完整任务');await app.waitFor('Boolean(document.querySelector(".agent-task-view textarea"))',10000);return current;
}
function taskRow(id){assert(/^[a-z0-9-]{36}$/i.test(id));const raw=execFileSync('/usr/bin/sqlite3',['-readonly','-json',join(userData,'smartdd.db'),"SELECT id,project_id,dir_id,cwd,title FROM tasks WHERE id='"+id+"'"],{encoding:'utf8'});const rows=JSON.parse(raw);assert.equal(rows.length,1);return rows[0];}
async function scheduleOpenRun(p,marker,expectedTask=null){
 let release;const promise=new Promise(ok=>{release=ok});const local={marker,input:{url:url('S'),intent:'reuse-or-new',presentation:'show'},dispatched:false,continuation:{promise,finish:release},readResults:[]};scenario=local;
 try{
  const r=await triggerPlan(p);const occurrence=await goOccurrenceTask(p,r);const id=occurrence.taskId;if(expectedTask)assert.equal(id,expectedTask);const task=taskRow(id);local.before=operationRows(id);local.beforeBrowser=await snapshot(id);local.beforeUi=await uiState();report.jointAttempt??=[];report.jointAttempt.push({marker,plan:p.id,occurrence,task});await persist();
  const request=await until(async()=>{const state=await agentSnapshot(id);const req=state.requests?.find(row=>row.payload?.businessKind==='browser_write'&&row.status==='pending');if(req)return req;if(local.originalOpenResponse?.isError)throw Error('actual ordinary browser tool rejected before approval: '+local.originalOpenResponse.preview);const failed=state.items?.find(x=>x.type==='tool_call'&&x.payload?.status==='failed'&&/browser_tab_open_v2/.test(x.payload?.name??''));if(failed)throw Error('actual ordinary browser tool failed before approval: '+JSON.stringify(failed.payload).slice(0,1600));return null},'own scheduled browser write approval',30000);local.request=request;local.requestOriginal=request.payload?.data?.requestId;
  const allow=await until(async()=>{const choices=await app.evaluate('[...document.querySelectorAll(".agent-request-options button")].filter(node=>!node.disabled&&node.getBoundingClientRect().width>0).map(node=>node.textContent.trim())');return choices.find(text=>/批准|允许/.test(text))},'actual scheduled approval choice mounted',8000);await shellClick('.agent-request-options button',allow);await shellClick('.agent-confirm-choice:enabled');local.approvedAt=Date.now();
  local.read=()=>operationRows(id).find(row=>!local.before.some(old=>old.request_id===row.request_id)&&(!local.requestOriginal||row.request_id===local.requestOriginal));local.accepted=await until(()=>local.read(),'actual original schedule browser operation',25000);local.pageId=local.accepted.page_id;
  const ready=await until(()=>{const r=local.read();return r?.summary?.phase==='ready'&&r.state==='succeeded'?r:null},'actual scheduled open durable ready receipt',20000);
  assert.equal(ready.page_id,local.pageId);assert.notEqual(ready.summary.presentationState,'shown','system scheduled origin must not automatically steal user view');const beforeReveal=await snapshot(id),beforeRevealUi=await uiState();assert.equal(beforeReveal.activeId,local.beforeBrowser.activeId,'system origin preserved previous actual active tab');assert(beforeReveal.tabs.some(t=>t.id===local.pageId&&t.url===url('S')&&!t.loading&&!t.failure));if(beforeReveal.activeId===null)assert.notEqual(beforeRevealUi.taskId,id,'no browser activation without explicit user action');else if(beforeRevealUi.taskId===id){assert.equal(beforeRevealUi.address,beforeReveal.tabs.find(t=>t.id===beforeReveal.activeId)?.url,'existing prior selected page only');}
  const card=await until(()=>app.evaluate(js(u=>{const matches=[...document.querySelectorAll('.agent-child-result')].filter(c=>c.querySelector('small')?.textContent.trim()===u&&[...c.querySelectorAll('button')].some(b=>b.textContent.trim()==='查看网页标签'));const button=matches.at(-1)?.querySelector('button');if(!button)return null;const parts=[];let e=button;while(e&&!e.matches('.agent-task-view')){const siblings=[...e.parentElement.children];parts.unshift(e.tagName.toLowerCase()+':nth-child('+(siblings.indexOf(e)+1)+')');e=e.parentElement;}return e?'.agent-task-view > '+parts.join(' > '):null},url('S'))),'actual latest matching original host browser result card',10000);await shellClick(card,'查看网页标签');
  const shown=await until(async()=>{const state=await uiState();const snap=await snapshot(id);return state.taskId===id&&state.address===url('S')&&snap.activeId===local.pageId?state:null},'manual user reveal selected original scheduled native browser',12000);const page=await awaitPage(id,url('S'),local.pageId);const state=await nativeState(page);report.jointAttemptsReady??=[];report.jointAttemptsReady.push({marker,id,ready,beforeReveal,beforeRevealUi,card,shown,page,state});await persist();
  local.readQueue=[{suffix:'browser_tab_list_v2',input:{}},{suffix:'browser_nav_snapshot_v2',input:{page:local.pageId}},{suffix:'browser_nav_screenshot_v2',input:{page:local.pageId,format:'png'}}];const final=await finishAgent(id,local);const terminal=await until(async()=>{const d=await app.invoke('schedule.get',p.id);const v=d.history.find(x=>x.id===r.id);return v?.status==='completed'?v:null},'actual scheduled execution completed',30000);
  const evidence={plan:p.id,occurrence:terminal,task,page,state,shown,ready,beforeReveal,beforeRevealUi,final,readResults:local.readResults??[],scope:(await snapshot(id)),modelEvidence:report.model.filter(m=>m.tool&&m.input?.page===page.id)};report.jointRuns??=[];report.jointRuns.push(evidence);await persist();return evidence;
 }finally{release();}
}
async function editDestination(p,value){await openPlan(p);await shellClick('.schedule-heading button','编辑');await app.waitFor('Boolean(document.querySelector(".schedule-form"))',8000);await scheduleSelect('任务去向',value);await shellClick('.schedule-form .schedule-primary');const q=await until(async()=>{const d=await app.invoke('schedule.get',p.id);return d.plan.config.destination===value&&!await app.evaluate('Boolean(document.querySelector(".schedule-form"))')?d.plan:null},'actual saved destination edit',8000);return q;}
async function finishAndRestart(){await observeMain(E=>{setTimeout(()=>E.app.quit(),50);return true});const exit=await app.waitForExit(20000);assert.equal(exit.code,0);assert.equal(exit.signal,null);report.restart={exit,at:Date.now()};app=null;await launch();report.restart.newPid=report.pid;await persist();}

try{
 await launch();
 stage='resume-sealed-fixture';const project={id:prior.fixture.project};t1=prior.fixture.t1;t2=prior.fixture.t2;report.fixture=prior.fixture;
 if(mode==='joint-resume'){
  await check('A44-B12.4-real-scheduled-own-scope-identity',async()=>{
   const initialProjects=execFileSync('/usr/bin/sqlite3',['-readonly','-json',join(userData,'smartdd.db'),'SELECT count(*) AS n FROM projects'],{encoding:'utf8'});const [c1,again,restart,c2]=prior.jointRuns;assert(c1.task.id===again.task.id&&c1.task.id===restart.task.id&&c1.task.id!==c2.task.id);assert(again.state.page.session==='SYNTHETIC_LOGIN_OK'&&restart.state.page.session==='SYNTHETIC_LOGIN_OK'&&c2.state.page.session==='SYNTHETIC_LOGIN_NONE');const logged={page:{session:'SYNTHETIC_LOGIN_OK'},evidence:'prior actual C09 first four normal occurrences and actual normal cold restart; sealed entire original data'};report.resumedPrior={c1,again,restart,c2,oldCode0:prior.exit};await persist();
   const projectMarker='WY_F36_JOINT_PROJECT_'+randomUUID();const p=await planForm('F36 own project schedule',projectMarker,{projectId:project.id});const j=await scheduleOpenRun(p,projectMarker);assert.equal(j.task.project_id,project.id);assert.notEqual(j.page.profile,c1.page.profile);assert.notEqual(j.page.profile,c2.page.profile);assert.equal(j.state.page.session,'SYNTHETIC_LOGIN_NONE');assert(!j.scope.tabs.some(t=>t.id===c1.page.id||t.id===c2.page.id));const jList=j.readResults.find(r=>r.name==='browser_tab_list_v2');assert(jList?.statusOk&&jList.uuidValues.includes(j.page.id)&&!jList.uuidValues.includes(c1.page.id)&&!jList.uuidValues.includes(c2.page.id),'J actual normal tool list does not inherit other task pages');
   assert.equal(execFileSync('/usr/bin/sqlite3',['-readonly','-json',join(userData,'smartdd.db'),'SELECT count(*) AS n FROM projects'],{encoding:'utf8'}),initialProjects);
   const readCoverage=[c1,again,restart,c2,j].map(r=>({id:r.task.id,reads:r.readResults.map(v=>({name:v.name,statusOk:v.statusOk,isError:v.isError,loginTrue:v.containsLoginTrue,loginNone:v.containsLoginNone}))}));report.jointReading=readCoverage;await persist();assert(readCoverage.every(r=>r.reads.length===3&&r.reads.every(v=>v.statusOk&&!v.isError)),'actual own-scope normal read/list/screenshot completion receipts required');
   return {c1:{...c1,logged},again,restart,c2,j,readCoverage,coverage:'manual actual schedule triggers, legitimate own task approvals/local synthetic cookie persisted on reuse and restart, C2/J own browser identity and page isolation, no real person login/system focus/cross-task grant requests'};
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
 if(app){try{if(['agent','fast','joint-resume'].includes(mode)){report.cleanup=[];for(const id of [...new Set([t1,t2,tRebuild,...(report.jointRuns??[]).map(r=>r.task.id),...(report.jointAttempt??[]).map(r=>r.task?.id)].filter(Boolean))]){const state=await agentSnapshot(id);const label=await app.evaluate(js(sel=>document.querySelector(sel)?.innerText??'',sidebar(id)));const active=state.turns.some(turn=>['dispatching','started','queued'].includes(turn.status))||/工作中|等待批准|等待处理|等待你处理/.test(label);try{await app.invoke('agentTasks.stop',id,true);report.cleanup.push({id,wasActive:active,action:'retire isolated test task execution after all assertions; cleanup only, not acceptance evidence'});}catch(error){report.cleanup.push({id,wasActive:active,error:String(error.message)});}}}report.windowsBeforeQuit=await windows();await observeMain(E=>{setTimeout(()=>E.app.quit(),50);return true});}catch(e){report.quitDispatch=String(e.message);}
 try{report.exit=await app.waitForExit(20000);}catch(e){report.exitError=String(e.message);await app.close();}
 report.rendererErrors=app.rendererErrors;await writeFile(join(root,'resume-electron.log'),app.logs(),{mode:0o600});}
 server.closeAllConnections();await new Promise(ok=>server.close(ok));
 report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({root,status:report.status,error:report.error,checks:report.checks.map(c=>c.name+':'+c.status)}));
 if(report.status.endsWith('failed')||report.exitError)process.exitCode=1;
}
