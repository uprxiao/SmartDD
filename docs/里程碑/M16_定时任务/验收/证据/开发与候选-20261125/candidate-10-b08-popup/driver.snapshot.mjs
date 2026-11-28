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
assert(["b02","b08-normal"].includes(mode));assert(["full","skip-known-green"].includes(scope));
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
const page=(path,title,logged=false)=>'<!doctype html><meta charset="utf-8"><title>'+title+'</title><style>body{font:16px system-ui;background:#d9faf4;padding:20px}input{width:240px}button{margin:8px}#mark{background:#119b89;color:white;padding:16px}</style><h1 id="mark">'+title+'</h1><label>表单 <input id="form" aria-label="未提交表单"></label><p id="session">'+(logged?'SYNTHETIC_LOGIN_OK':'SYNTHETIC_LOGIN_NONE')+'</p><button id="login" type="button">合成登录</button><button id="advance" type="button">进入历史页</button><button id="back" type="button">返回</button><button id="async" type="button">异步操作</button><p id="counter">0</p><p id="response">idle</p><script>window.docMarker=crypto.randomUUID();window.ticks=0;document.querySelector("#login").onclick=async()=>{const r=await fetch("/fixture-login",{method:"POST"});if(r.ok)document.querySelector("#session").textContent="SYNTHETIC_LOGIN_OK";};setInterval(()=>{document.querySelector("#counter").textContent=String(++window.ticks)},100);document.querySelector("#advance").onclick=()=>{history.pushState({test:1},"",location.pathname+"?step=2");document.querySelector("#mark").textContent+=" • step 2";};document.querySelector("#back").onclick=()=>history.back();document.querySelector("#async").onclick=async()=>{document.querySelector("#response").textContent="pending";const r=await fetch("/async/"+encodeURIComponent(location.pathname));document.querySelector("#response").textContent=await r.text()};</script>';
const downloadBytes=name=>'M16 F36 normal local download '+name+'\n'+'0123456789'.repeat(32768);
const b08Page=(path,title,logged)=>page(path,title,logged)+`<hr><button id="popup" onclick="window.open('/popup','f36-login-child','width=500,height=350')">合成认证子窗</button><a id="ordinary-tab" href="/B" target="_blank">普通新标签</a><button id="confirm" onclick="setTimeout(()=>{document.querySelector('#response').textContent='F36 CONFIRM '+confirm('F36 ordinary confirmation')},100)">普通确认</button><a id="down-one" href="/download/one" download>下载一</a><a id="down-two" href="/download/two" download>下载二</a><a id="down-cancel" href="/download/cancel" download>取消下载</a><a id="down-fail" href="/download/fail" download>中断下载</a>`;
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
   const local=scenario,tools=(body.tools??[]).filter(t=>t.name.endsWith(local?.suffix??'browser_tab_open_v2'));
   const text=JSON.stringify(body.messages);
   let block=null;const answer='M16 fixture acknowledgement';
   if(local&&text.includes(local.marker)&&!local.dispatched){assert(tools.length===1,'Expected one registered own-page normal tool '+local.suffix);local.dispatched=true;local.dispatchedAt=Date.now();local.toolUseId='tool_'+modelSeq;block={name:tools[0].name,input:local.input};}
   else if(local?.dispatched){
    if(local.suffix){const prior=(body.messages??[]).flatMap(m=>Array.isArray(m.content)?m.content:[]).find(item=>item.type==='tool_result'&&item.tool_use_id===local.toolUseId);if(prior&&!local.receipt){const raw=JSON.stringify(prior.content??prior),texts=typeof prior.content==='string'?[prior.content]:Array.isArray(prior.content)?prior.content.filter(x=>x.type==='text'&&typeof x.text==='string').map(x=>x.text):[];let parsed=null;for(const value of texts){for(const candidate of [value,...value.split('\n').filter(line=>line.trim().startsWith('{'))]){try{const env=JSON.parse(candidate);if(env.schema==='willyou-app-result-v2'){parsed=env;break;}}catch{}}if(parsed)break;}
     local.receipt={name:local.suffix,status:parsed?.status??null,errorCode:parsed?.error?.code??null,error:parsed?.error?.message??null,data:parsed?.data??null,rawPreview:texts.map(t=>t.slice(0,1000)).join(' | ').slice(0,2000),sha256:createHash('sha256').update(raw).digest('hex'),isError:Boolean(prior.is_error),at:Date.now()};report.readReceipts??=[];report.readReceipts.push(local.receipt);await persist();}}
    await local.continuation.promise;
   }
   report.model.push({id,at:Date.now(),tool:block?.name??null,input:block?.input??null,contract:block?tools[0].input_schema??null:null});
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','request-id':'req_'+modelSeq});
   const send=(type,fields={})=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...fields})+'\n\n');
   send('message_start',{message:msg});send('content_block_start',{index:0,content_block:block?{type:'tool_use',id:'tool_'+modelSeq,name:block.name,input:{}}:{type:'text',text:''}});
   send('content_block_delta',{index:0,delta:block?{type:'input_json_delta',partial_json:JSON.stringify(block.input)}:{type:'text_delta',text:answer}});
   send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:block?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}});send('message_stop');res.end();return;
  }
  const u=new URL(req.url,'http://127.0.0.1');
  report.requests.push({at:Date.now(),path:u.pathname,search:u.search,syntheticLoggedIn:Boolean(req.headers.cookie?.includes('wy_fixture_auth=1'))});
  if(u.pathname.startsWith('/basic/')){const approved=u.pathname==='/basic/approved',expected='Basic '+Buffer.from(approved?'f36-local-user:f36-local-pass':'f36-local-user:separate-fixture-password').toString('base64');const authorized=req.headers.authorization===expected;report.requests.at(-1).authorized=authorized;if(!authorized){res.writeHead(401,{'WWW-Authenticate':'Basic realm="F36 synthetic '+(approved?'approved':'cancel')+'"','Content-Type':'text/plain'}).end('Synthetic login required');return;}res.writeHead(200,{'Content-Type':'text/html'}).end(page(u.pathname,'F36 Basic Auth OK',false));return;}
  if(u.pathname==='/popup'){res.writeHead(200,{'Content-Type':'text/html'}).end('<title>F36 synthetic auth child</title><button id="finish-popup" onclick="window.opener.document.querySelector(\'\#response\').textContent=\'F36 POPUP COMPLETE\';window.close()">完成合成登录</button>');return;}
  const dl=u.pathname.match(/^\/download\/(one|two|cancel|fail)$/);if(dl){const name=dl[1],bytes=downloadBytes(name);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="f36-'+name+'.txt"','Content-Length':Buffer.byteLength(bytes),'Cache-Control':'no-store'});res.write(bytes.slice(0,1024));if(name==='fail'){res.socket?.destroy();return;}if(gate.has(u.pathname))await gate.get(u.pathname).promise;if(!res.destroyed)res.end(bytes.slice(1024));return;}
  if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  if(u.pathname==='/fixture-login'&&req.method==='POST'){res.writeHead(200,{'Set-Cookie':'wy_fixture_auth=1; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax','Content-Type':'text/plain'}).end('synthetic fixture only');return;}
  if(u.pathname.startsWith('/async/')){arrived.add(u.pathname);if(gate.has(u.pathname))await gate.get(u.pathname).promise;res.writeHead(200,{'Content-Type':'text/plain'}).end('M16 ASYNC COMPLETE');return;}
  if(!/^\/(?:A|B|C|D|E|F|G|H|I)$/.test(u.pathname)){res.writeHead(404).end('missing synthetic route');return;}
  if(gate.has(u.pathname)){arrived.add(u.pathname);await gate.get(u.pathname).promise;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end((mode==='b08-normal'?b08Page:page)(u.pathname,'测试页面 '+u.pathname.slice(1),Boolean(req.headers.cookie?.includes('wy_fixture_auth=1'))));
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


function invocationRows(id,suffix){assert(/^[a-f0-9-]{36}$/.test(id));assert(/^browser_(?:nav_(?:snapshot|wait)|interact_get)_v2$/.test(suffix));const q="SELECT operation_id,request_id,tool_name,state,started_at,ended_at,error_code FROM application_invocations WHERE task_id='"+id+"' AND tool_name LIKE '%"+suffix+"' ORDER BY started_at,request_id";const out=execFileSync('/usr/bin/sqlite3',['-readonly','-json',join(userData,'smartdd.db'),q],{encoding:'utf8'}).trim();return out?JSON.parse(out):[];}
async function startRead(id,suffix,input){assert(/^browser_(?:nav_(?:snapshot|wait)|interact_get)_v2$/.test(suffix),'normal fixed read tool only');let resolve;const continuation={promise:new Promise(r=>{resolve=r}),finish:()=>resolve()};const local={suffix,marker:'WY_F36_READ_'+randomUUID(),input,dispatched:false,continuation,before:invocationRows(id,suffix)};scenario=local;
 try{await switchTask(id);await field('.agent-task-view textarea','请对当前任务自己的合成网页执行普通只读检查。'+local.marker);await shellClick('.agent-task-view button[type="submit"]');await until(()=>local.dispatched,'actual provider received normal read tool schema',25000);return local;}catch(error){continuation.finish();throw error;}}
async function endRead(id,local,expected='ok'){
 try{const value=await until(()=>local.receipt,'actual own-page tool result received by isolated model',30000);if(expected==='ok'){assert.equal(value.status,'ok');assert.equal(value.isError,false);}else{assert(value.status==='error'||value.isError,'normal stale read must be rejected');assert(value.errorCode==='BROWSER_STALE_REF'||value.rawPreview.includes('BROWSER_STALE_REF')||value.rawPreview.includes('页面引用已经失效'),'exact original stale-reference diagnosis');}return value;}
 finally{local.continuation.finish();await until(async()=>{const state=await agentSnapshot(id),label=await app.evaluate(js(sel=>document.querySelector(sel)?.innerText??'',sidebar(id)));return !state.turns.some(t=>['dispatching','started','queued'].includes(t.status))&&!/工作中|等待批准|等待处理|等待你处理/.test(label)},'normal read task complete',18000);scenario=null;}
}
async function readOnce(id,suffix,input,expected='ok'){const local=await startRead(id,suffix,input);return endRead(id,local,expected);}
function ownHeadingRef(receipt,name,pageId){assert.equal(receipt.data?.browserPageId,pageId);const refs=receipt.data?.refs??[];const match=refs.find(x=>x.role==='heading'&&x.name===name&&x.available);assert(match?.ref,'actual ordinary snapshot heading reference');return match.ref;}
async function actualPixels(p){return observeMain(async(E,id,expected)=>{const w=E.webContents.fromId(id);if(!w||w.isDestroyed()||w.getURL()!==expected||URL.parse(expected)?.hostname!=='127.0.0.1')throw Error('not the active own synthetic page');const image=await w.capturePage();const size=image.getSize(),png=image.toPNG(),pixels=image.toBitmap();const colors=[];for(let i=0;i<Math.min(pixels.length,50000);i+=400)colors.push(pixels.subarray(i,i+4).toString('hex'));return{size,bytes:png.length,distinctSamples:new Set(colors).size,empty:image.isEmpty()};},p.wc,p.url);}
async function setOwnWindowVisible(visible){const result=await observeMain((E,show)=>{const win=E.BaseWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.contentView.children.some(c=>/\/out\/renderer\/index\.html/.test(c.webContents?.getURL?.()??'')));if(!win)throw Error('own root missing');const before=win.isVisible();if(show)win.showInactive();else win.hide();return{id:win.id,before,after:win.isVisible(),action:show?'showInactive':'hide'};},visible);assert.equal(result.after,visible);report.visibilityTransitions??=[];report.visibilityTransitions.push(result);await persist();return result;}

try{
 await launch();
 stage='fixture-setup';
 const tool=await app.invoke('agents.customToolPath','claude',wrapper);
 assert(tool.tool.installed&&tool.tool.login==='api');
 const profile=await app.invoke('agents.save',{name:'F36 local synthetic',toolId:tool.tool.id,source:'login'});
 const project=await app.invoke('projects.create',{name:'F36 isolated project',aliases:[],description:'',rulesPath:null},[{label:'fixture',path:cwd}]);
 const {dirs}=await app.invoke('projects.get',project.id);
 const task=async title=>(await app.invoke('agentTasks.create',{projectId:project.id,dirId:dirs[0].id,cwd,title,profileId:profile.id,tier:'ask',model,carryExtensions:false})).taskId;
 t1=await task('F36 task one');t2=await task('F36 task two');tClose=['manual','b08-normal'].includes(mode)?await task('F36 close fixture'):null;tPanel=['manual','b08-normal'].includes(mode)?await task('F36 panel fixture'):null;tReload=['manual','reload'].includes(mode)?await task('F36 reload fixture'):null;tRebuild=['agent','rebuild','b02'].includes(mode)?await task('F36 native recovery fixture'):null;
 report.fixture={project:project.id,t1,t2,tClose,tPanel,tReload,tRebuild,profile:profile.id,origin};
 await app.cdp('Page.reload');
 await switchTask(t1);
 if(mode==='b08-normal'){
  await check('B08.1-real-named-popup-blank-tab-and-page-dialog',async()=>{
   await switchTask(t1);const source=await newTab(t1,url('A')),before=await nativeState(source);const n=(await snapshot(t1)).tabs.length;
   await pageClick(source,'#popup');const child=await until(async()=>{const wins=await windows();const w=wins.find(w=>w.children.some(c=>c.url===url('popup'))&&!w.children.some(c=>/\/out\/renderer\/index\.html/.test(c.url)));const child=w?.children.find(c=>c.url===url('popup')&&c.visible!==false);return child?{window:w.id,wc:child.id,url:child.url,root:w}:null},'real separate named authentication WebContents',15000);
   assert.equal((await snapshot(t1)).tabs.length,n,'named popup is not an ordinary workspace tab');
   const opener=await observeMain(async(E,id,expected)=>{const w=E.webContents.fromId(id);if(!w||w.isDestroyed()||w.getURL()!==expected)throw Error('not our popup');return w.executeJavaScript('({hasOpener:!!window.opener,sameOrigin:window.opener?.location.origin===location.origin})')},child.wc,child.url);assert.deepEqual(opener,{hasOpener:true,sameOrigin:true});
   await pageClick(child,'#finish-popup');await until(async()=>!await observeMain((E,id)=>{const w=E.webContents.fromId(id);return Boolean(w&&!w.isDestroyed())},child.wc),'original child native closed');const callback=await until(async()=>{const s=await nativeState(source);return s.page.response==='F36 POPUP COMPLETE'?s:null},'actual opener callback');assert.equal(callback.id,before.id);assert.equal(callback.page.marker,before.page.marker);
   await pageClick(source,'#ordinary-tab');const blankState=await until(async()=>{const s=await snapshot(t1);const p=s.tabs.find(t=>t.url===url('B'));return s.tabs.length===n+1&&p?{s,p}:null},'ordinary target blank becomes a real tab');const normal=await chooseTab(t1,blankState.p);assert.equal(normal.id,blankState.p.id);assert.notEqual(normal.wc,source.wc);await chooseTab(t1,source);report.popupBeforeModal={source,before,child,opener,callback,normal};await persist();
   await pageClick(source,'#confirm');const prompt=await until(async()=>{const s=await snapshot(t1);return s.javascriptDialog?.pageId===source.id?s.javascriptDialog:null},'actual Javascript confirm belongs to source page');await shellClick('[data-browser-panel="javascript-dialog"] button[type="submit"]');const yes=await until(async()=>{const s=await nativeState(source);return s.page.response==='F36 CONFIRM true'?s:null},'ordinary confirm callback');
   await pageClick(source,'#confirm');await until(async()=>Boolean((await snapshot(t1)).javascriptDialog),'second ordinary confirmation');await shellClick('[data-browser-panel="javascript-dialog"] button','取消');const no=await until(async()=>{const s=await nativeState(source);return s.page.response==='F36 CONFIRM false'?s:null},'normal cancel callback');assert.equal(no.id,before.id);assert.equal(no.page.marker,before.page.marker);
   return {source,before,child,opener,callback,normal,prompt,yes,no,boundary:'packaged A named synthetic child opener, ordinary new tab and real in-app JS dialog confirm/cancel; no S native system focus or file-picker claims'};
  },true);
  if(scope==='full')await check('B08.2-real-synthetic-http-basic-approved-and-cancel',async()=>{
   await switchTask(t2);const first=await newTab(t2,null);await field('[aria-label="网页地址"]',url('basic/approved'));await keypress('Enter');const auth=await until(async()=>{const value=(await snapshot(t2)).auth;return value?.pageId===first?value:null},'actual Basic auth prompt');
   await field('[aria-label="基本认证用户名"]','f36-local-user');await field('[aria-label="基本认证密码"]','f36-local-pass');await shellClick('[data-browser-panel="authentication"] button[type="submit"]');const success=await awaitPage(t2,url('basic/approved'),first);assert.equal((await nativeState(success)).page.title,'F36 Basic Auth OK');assert(report.requests.some(r=>r.path==='/basic/approved'&&r.authorized===true));
   const cancelId=await newTab(t2,null);await field('[aria-label="网页地址"]',url('basic/cancel'));await keypress('Enter');const cancelPrompt=await until(async()=>{const q=(await snapshot(t2)).auth;return q?.pageId===cancelId?q:null},'different synthetic Basic realm');await shellClick('[data-browser-panel="authentication"] button','取消');const cancelled=await until(async()=>{const s=await snapshot(t2);return s.authCancelled?.pageId===cancelId&&!s.auth?s.authCancelled:null},'real cancellation receipt');assert(!report.requests.some(r=>r.path==='/basic/cancel'&&r.authorized));
   return {auth,success,cancelPrompt,cancelled,boundary:'ordinary own synthetic Basic auth; no real user credentials, actual site or system permission/certificate claims'};
  },true);
  if(scope==='full')await check('B08.3-existing-own-page-read-helper-and-native-document',async()=>{
   await switchTask(tPanel);const p=await newTab(tPanel,url('H')),before=await nativeState(p);const receipt=await readOnce(tPanel,'browser_nav_snapshot_v2',{page:p.id});assert.equal(receipt.status,'ok');assert.equal(receipt.data.browserPageId,p.id);assert(ownHeadingRef(receipt,'测试页面 H',p.id));const after=await nativeState(p);assert.equal(after.id,before.id);assert.equal(after.page.marker,before.page.marker);return{p,before,receipt,after,boundary:'actual legal own-page read tool; other formal I/A matrix and S separate'};
  },true);
  await check('B08.4-native-downloads-same-task-two-source-owners',async()=>{
   const original=await observeMain(E=>E.app.getPath('downloads')),privateDir=join(home,'Downloads');await mkdir(privateDir,{mode:0o700});const dir=await observeMain((E,target,ownHome)=>{if(target!==ownHome+'/Downloads'||!ownHome.startsWith('/private/tmp/willyou-m16-f36-run-'))throw Error('private Downloads fixture guard');E.app.setPath('downloads',target);return E.app.getPath('downloads');},privateDir,home);report.downloadDestination=dir;report.downloadDestinationFixture={original,actual:dir,exactPrivateRoot:root,boundary:'test-only app path isolation before any download; actual ordinary product download flow unchanged; no default macOS path behavior or system Save As S claim'};await persist();assert.equal(dir,privateDir);
   await switchTask(tClose);const pa=await newTab(tClose,url('A')),pb=await newTab(tClose,url('B'));await chooseTab(tClose,pa);const releaseA=hold('/download/one'),releaseB=hold('/download/two');
   try{
    await pageClick(pa,'#down-one');const aProgress=await until(async()=>{const s=await snapshot(tClose);return s.downloads?.find(d=>d.pageId===pa.id&&d.name==='f36-one.txt'&&d.state==='progress')},'download one started from A');if(await app.evaluate('Boolean(document.querySelector(".bw-downloads"))'))await shellClick('button[aria-label="收起下载列表"]');await chooseTab(tClose,pb);await pageClick(pb,'#down-two');const bProgress=await until(async()=>{const s=await snapshot(tClose);return s.downloads?.find(d=>d.pageId===pb.id&&d.name==='f36-two.txt'&&d.state==='progress')},'download two started from B');assert.notEqual(aProgress.id,bProgress.id);releaseA();releaseB();
    const done=await until(async()=>{const s=await snapshot(tClose),xs=s.downloads?.filter(d=>[aProgress.id,bProgress.id].includes(d.id));return xs?.length===2&&xs.every(d=>d.state==='done')?xs:null},'both actual downloads finished');for(const d of done){assert.equal(d.taskId,tClose);assert(d.path&&d.path.startsWith(dir+'/'));assert.equal(await realpath(d.path),d.path);assert.equal(await readFile(d.path,'utf8'),d.name==='f36-one.txt'?downloadBytes('one'):downloadBytes('two'));}
    await app.waitFor('Boolean(document.querySelector(".bw-downloads .bw-download-done"))',8000);await app.screenshot(join(root,'B08-downloads-completed.png'));if(await app.evaluate('Boolean(document.querySelector(".bw-downloads"))'))await shellClick('button[aria-label="收起下载列表"]');
    const releaseCancel=hold('/download/cancel');let cancelled;try{await pageClick(pb,'#down-cancel');const pending=await until(async()=>{const s=await snapshot(tClose);return s.downloads?.find(d=>d.pageId===pb.id&&d.name==='f36-cancel.txt'&&d.state==='progress')},'real ordinary download pending');await shellClick('.bw-download-progress button','取消');cancelled=await until(async()=>{const s=await snapshot(tClose);return s.downloads?.find(d=>d.id===pending.id&&d.state==='cancelled')},'actual cancellation');assert.equal(cancelled.pageId,pb.id);}finally{releaseCancel();}
    if(await app.evaluate('Boolean(document.querySelector(".bw-downloads"))'))await shellClick('button[aria-label="收起下载列表"]');await pageClick(pb,'#down-fail');const failed=await until(async()=>{const s=await snapshot(tClose);return s.downloads?.find(d=>d.pageId===pb.id&&d.name==='f36-fail.txt'&&d.state==='failed')},'controlled synthetic stream interruption visible failure',20000);return{pa,pb,aProgress,bProgress,done,cancelled,failed,boundary:'actual normal downloads, two source pageIds, byte verification, cancellation and controlled local interruption; system Downloads exact path guard'};
   }finally{releaseA();releaseB();}
  },true);
 }else if(mode==='b02'){
  const continuity=await check('B02.1-real-multi-task-tab-document-session',async()=>{
   await switchTask(t1);a=await newTab(t1,url('A'));await pageClick(a,'#login');await until(async()=>{const s=await nativeState(a);return s.page.session==='SYNTHETIC_LOGIN_OK'&&s},'normal synthetic cookie login');await pageClick(a,'#form');await nativeInput(a,'Input.insertText',{text:'未提交 '+randomUUID()});await pageClick(a,'#advance');const before=await until(async()=>{const s=await nativeState(a);return s.url.endsWith('?step=2')&&s.page.form?.startsWith('未提交 ')?s:null},'actual page history and unsaved form');a.url=before.url;
   b=await newTab(t1,url('B'));await switchTask(t2);c=await newTab(t2,url('C'));await switchTask(t1);assert.equal((await snapshot(t1)).activeId,b.id);a=await chooseTab(t1,a);const after=await nativeState(a);
   for(const key of ['id'])assert.equal(after[key],before[key]);for(const key of ['marker','form','history','session'])assert.equal(after.page[key],before.page[key]);assert(after.page.ticks>=before.page.ticks);assert.equal(report.requests.filter(r=>r.path==='/A').length,1);
   await switchTask(t2);assert.equal((await snapshot(t2)).activeId,c.id);await switchTask(t1);assert.equal((await snapshot(t1)).activeId,a.id);return {a,b,c,before,after,visible:await windows(),coverage:'normal actual page session marker (synthetic cookie), document/form/history and per-task choice kept, no daily identity or credentials'};
  },true);
  if(continuity)await check('B02.2-actual-helper-wait-survives-panel-and-hide',async()=>{
   const before=await nativeState(a),holdPath='/async/'+encodeURIComponent('/A'),releaseGate=hold(holdPath);let local,hidden=false;
   try{await pageClick(a,'#async');await until(()=>arrived.has(holdPath),'actual local browser async started');local=await startRead(t1,'browser_nav_wait_v2',{page:a.id,text:'M16 ASYNC COMPLETE',timeout:30000});const active=await until(()=>invocationRows(t1,local.suffix).find(row=>!local.before.some(old=>old.operation_id===row.operation_id)&&row.state==='running'),'actual running product tool invocation',10000);
    await shellClick('button[title="收起右侧面板"]');await app.waitFor('!document.querySelector("[data-testid=agent-workspace-panel]")',8000);await openPanel();await chooseTab(t1,a);
    await shellClick('.agent-panel-tabs [role="tab"]','文件');await shellClick('[aria-label="打开面板"]');const term=await until(()=>app.evaluate('[...document.querySelectorAll(".agent-panel-menu button")].find(e=>e.textContent.trim().startsWith("终端"))?.textContent.trim()'),'actual terminal menu',5000);await shellClick('.agent-panel-menu button',term);await chooseTab(t1,a);
    const terminalClose='button[aria-label="关闭终端面板"]';if(await app.evaluate(js(s=>Boolean(document.querySelector(s)),terminalClose)))await shellClick(terminalClose);
    await setOwnWindowVisible(false);hidden=true;releaseGate();const result=await until(()=>local.receipt,'original actual helper wait settles while own window hidden',20000);assert.equal(result.status,'ok');assert.equal(result.isError,false);const hiddenState=await nativeState(a);assert.equal(hiddenState.page.response,'M16 ASYNC COMPLETE');
    await setOwnWindowVisible(true);hidden=false;const toolResult=await endRead(t1,local);const final=await awaitPage(t1,a.url,a.id),after=await nativeState(final),pixels=await actualPixels(final);assert.equal(after.id,before.id);for(const key of ['marker','history','form','session'])assert.equal(after.page[key],before.page[key]);assert(after.page.ticks>=before.page.ticks);assert(!pixels.empty&&pixels.bytes>1000&&pixels.distinctSamples>1);return {active,before,hiddenState,after,pixels,toolResult,transitions:report.visibilityTransitions,coverage:'actual fixed browser helper wait through collapse/file/terminal/drawer-hide and main BaseWindow.hide/showInactive; genuine synthetic response and actual native pixels captured after restore; no claim of OS physical focus or S'};
   }finally{releaseGate();if(hidden)await setOwnWindowVisible(true);local?.continuation.finish();}
  },true);
  await check('B02.3-real-navigation-native-loss-stale-ref',async()=>{
   await switchTask(tRebuild);const original=await newTab(tRebuild,url('H')),initial=await nativeState(original);const oldSnap=await readOnce(tRebuild,'browser_nav_snapshot_v2',{page:original.id}),oldRef=ownHeadingRef(oldSnap,'测试页面 H',original.id);
   const oldRead=await readOnce(tRebuild,'browser_interact_get_v2',{page:original.id,what:'text',element:oldRef});assert.equal(oldRead.status,'ok');
   await field('[aria-label="网页地址"]',url('I'));await keypress('Enter');const navigated=await awaitPage(tRebuild,url('I'),original.id),second=await nativeState(navigated);assert.equal(navigated.wc,original.wc);assert.notEqual(second.page.marker,initial.page.marker);
   const staleAfterGoto=await readOnce(tRebuild,'browser_interact_get_v2',{page:original.id,what:'text',element:oldRef},'stale');
   await useBrowserControl(['后退']);const returned=await awaitPage(tRebuild,url('H'),original.id),before=await nativeState(returned);assert.equal(returned.wc,original.wc);
   const nativeSnap=await readOnce(tRebuild,'browser_nav_snapshot_v2',{page:returned.id}),nativeRef=ownHeadingRef(nativeSnap,'测试页面 H',returned.id);
   const injection=await observeMain((E,id,expected)=>{const w=E.webContents.fromId(id);if(!w||w.isDestroyed()||w.getURL()!==expected||URL.parse(expected)?.hostname!=='127.0.0.1')throw Error('not our current user-owned synthetic page');w.close({waitForBeforeUnload:false});return{id};},returned.wc,returned.url);await until(async()=>!await observeMain((E,id)=>{const w=E.webContents.fromId(id);return Boolean(w&&!w.isDestroyed())},returned.wc),'actual original native closed');
   assert((await snapshot(tRebuild)).tabs.some(t=>t.id===returned.id));await useBrowserControl(['刷新网页']);const recovered=await awaitPage(tRebuild,url('H'),returned.id),after=await nativeState(recovered);assert.notEqual(recovered.wc,returned.wc);assert.notEqual(after.page.marker,before.page.marker);
   const staleAfterNative=await readOnce(tRebuild,'browser_interact_get_v2',{page:recovered.id,what:'text',element:nativeRef},'stale');const freshSnap=await readOnce(tRebuild,'browser_nav_snapshot_v2',{page:recovered.id}),freshRef=ownHeadingRef(freshSnap,'测试页面 H',recovered.id);assert.notEqual(freshRef,nativeRef);const freshRead=await readOnce(tRebuild,'browser_interact_get_v2',{page:recovered.id,what:'text',element:freshRef});
   if(continuity){await switchTask(t1);a=await chooseTab(t1,a);const anchor=await nativeState(a);assert.equal(anchor.page.session,'SYNTHETIC_LOGIN_OK');assert(anchor.page.form.startsWith('未提交 '));}
   return {original,initial,oldSnap,oldRead,navigated,second,staleAfterGoto,returned,before,nativeSnap,injection,recovered,after,staleAfterNative,freshSnap,freshRead,coverage:'legitimate own-page read reference before/after normal navigation and controlled real native instance loss. Old stale reads are denied; fresh ordinary read succeeds. No offensive use or other scope'};
  },true);
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
 if(app){try{if(['agent','fast','b02','b08-normal'].includes(mode)){report.cleanup=[];for(const id of [t1,t2,tPanel,tClose,tRebuild].filter(Boolean)){const state=await agentSnapshot(id);const label=await app.evaluate(js(sel=>document.querySelector(sel)?.innerText??'',sidebar(id)));const active=state.turns.some(turn=>['dispatching','started','queued','accepted'].includes(turn.status))||/工作中|等待批准|等待处理|等待你处理/.test(label);try{if(active)await app.invoke('agentTasks.stop',id,true);report.cleanup.push({id,wasActive:active,action:active?'retire only active aborted fixture task; cleanup only':'already idle; no explicit stop'});}catch(error){report.cleanup.push({id,wasActive:active,error:String(error.message)});}}}report.windowsBeforeQuit=await windows();await observeMain(E=>{setTimeout(()=>E.app.quit(),50);return true});}catch(e){report.quitDispatch=String(e.message);}
 try{report.exit=await app.waitForExit(20000);}catch(e){report.exitError=String(e.message);await app.close();}
 report.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.log'),app.logs(),{mode:0o600});}
 server.closeAllConnections();await new Promise(ok=>server.close(ok));
 report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({root,status:report.status,error:report.error,checks:report.checks.map(c=>c.name+':'+c.status)}));
 if(report.status.endsWith('failed')||report.exitError)process.exitCode=1;
}
