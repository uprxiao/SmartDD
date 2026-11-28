// M16 B11.3 same-logical-page resource handoff. Private isolated normal business; optional bounded native-close gate only by coordinator authorization.
// Actual browser and shell actions use CDP Input. Read-only main inspector observes app identity/native view.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,realpath,writeFile,readdir,appendFile,lstat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {join,dirname,resolve} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {arch,release} from 'node:os';
import {openElectron,pause} from '/Users/liubu/hx/4.uprxiao/SmartDD/scripts/lib/electron-harness.mjs';
const [bundleArg,pin,cliArg,mode="b11-owner-handoff",scope="native-gate-only"] = process.argv.slice(2);assert.equal(mode,"b11-owner-handoff");assert.equal(scope,"native-gate-only");
assert(bundleArg && cliArg && /^[a-f0-9]{64}$/.test(pin ?? ''),'Run only explicitly allocated bundle, asar SHA256 and local Claude CLI');
const bundle=await realpath(bundleArg);
assert(bundle==='/Users/liubu/hx/4.uprxiao/SmartDD/release/mac-arm64/WillYou.app'||bundle.startsWith('/private/tmp/willyou-')&&bundle.endsWith('/WillYou.app'),'Explicit frozen release/private copy only, never installed daily app');
const executable=join(bundle,'Contents/MacOS/WillYou');
const asar=join(bundle,'Contents/Resources/app.asar');
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
assert.equal(await digest(asar),pin);
const cli=await realpath(cliArg);
const root=await mkdtemp('/private/tmp/willyou-m16-f36-owner-close-gate-');
const userData=join(root,'data'),home=join(root,'home'),cliHome=join(root,'cli-home'),cwd=join(root,'project');
for(const path of [userData,home,cliHome,cwd])await mkdir(path,{mode:0o700});
await writeFile(join(cwd,'fixture.txt'),'M16 F36 isolated file control\n');
console.log('F36 evidence: '+root);
const report={schema:'M16-F36-B11.3-owner-handoff-a',unit:'F36',mode,scope,sourceBaseline:'coordinator allocated candidate; working tree not inferred from later changes',layer:'Packaged A and read-only native observations; synthetic model cannot certify real provider or S',pin,bundle,executableSha256:await digest(executable),cliSha256:await digest(cli),driverSha256:await digest(new URL(import.meta.url)),root,userData,host:{arch:arch(),release:release()},startedAt:new Date().toISOString(),actions:[],checks:[],requests:[],model:[]};
const persist=()=>writeFile(join(root,'result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
let app,stage='setup',scenario=null,modelSeq=0;
const gate=new Map(),arrived=new Set();
const model='claude-sonnet-5-5';
const key='m16-browser-local-fixture-no-live-secret';
const page=(path,title,logged=false)=>'<!doctype html><meta charset="utf-8"><title>'+title+'</title><h1>静态资源夹具 '+path+'</h1><p id="session">'+(logged?'SYNTHETIC_LOGIN_OK':'SYNTHETIC_LOGIN_NONE')+'</p><input id="form" value="unchanged'+path+'"><button id="async">等待本地合成消息</button><p id="response">idle</p><script>window.docMarker=crypto.randomUUID();document.querySelector("#async").onclick=async()=>{document.querySelector("#response").textContent="pending";const r=await fetch("/async/"+encodeURIComponent(location.pathname));document.querySelector("#response").textContent=await r.text()};</script>';
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
  if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  if(u.pathname==='/fixture-login'&&req.method==='POST'){res.writeHead(200,{'Set-Cookie':'wy_fixture_auth=1; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax','Content-Type':'text/plain'}).end('synthetic fixture only');return;}
  if(u.pathname.startsWith('/async/')){arrived.add(u.pathname);if(gate.has(u.pathname))await gate.get(u.pathname).promise;res.writeHead(200,{'Content-Type':'text/plain'}).end('M16 ASYNC COMPLETE');return;}
  if(!/^\/(?:A|B|C|D|E|F|G|H|I)$/.test(u.pathname)){res.writeHead(404).end('missing synthetic route');return;}
  if(gate.has(u.pathname)){arrived.add(u.pathname);await gate.get(u.pathname).promise;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(page(u.pathname,'测试页面 '+u.pathname.slice(1),Boolean(req.headers.cookie?.includes('wy_fixture_auth=1'))));
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
function hold(path){let resolve;const promise=new Promise(r=>{resolve=r});gate.set(path,{promise,resolve});return()=>{resolve();gate.delete(path);}}
async function launch(){app=await openElectron({userData,executable,cwd:root,env:{HOME:home,SMARTDD_CLI_HOME:cliHome,CLAUDE_CONFIG_DIR:join(cliHome,'config'),NO_PROXY:'127.0.0.1,localhost'},inspectMain:true});await bind();}
function invocationRows(id,suffix){assert(/^[a-f0-9-]{36}$/.test(id));assert(/^browser_(?:nav_(?:snapshot|wait)|interact_get)_v2$/.test(suffix));const q="SELECT operation_id,request_id,tool_name,state,started_at,ended_at,error_code FROM application_invocations WHERE task_id='"+id+"' AND tool_name LIKE '%"+suffix+"' ORDER BY started_at,request_id";const out=execFileSync('/usr/bin/sqlite3',['-readonly','-json',join(userData,'smartdd.db'),q],{encoding:'utf8'}).trim();return out?JSON.parse(out):[];}
async function startRead(id,suffix,input){assert(/^browser_(?:nav_(?:snapshot|wait)|interact_get)_v2$/.test(suffix),'normal fixed read tool only');let resolve;const continuation={promise:new Promise(r=>{resolve=r}),finish:()=>resolve()};const local={suffix,marker:'WY_F36_READ_'+randomUUID(),input,dispatched:false,continuation,before:invocationRows(id,suffix)};scenario=local;
 try{await switchTask(id);await field('.agent-task-view textarea','请对当前任务自己的合成网页执行普通只读检查。'+local.marker);await shellClick('.agent-task-view button[type="submit"]');await until(()=>local.dispatched,'actual provider received normal read tool schema',25000);return local;}catch(error){continuation.finish();throw error;}}
async function endRead(id,local,expected='ok'){
 try{const value=await until(()=>local.receipt,'actual own-page tool result received by isolated model',30000);if(expected==='ok'){assert.equal(value.status,'ok');assert.equal(value.isError,false);}else{assert(value.status==='error'||value.isError,'normal stale read must be rejected');assert(value.errorCode==='BROWSER_STALE_REF'||value.rawPreview.includes('BROWSER_STALE_REF')||value.rawPreview.includes('页面引用已经失效'),'exact original stale-reference diagnosis');}return value;}
 finally{local.continuation.finish();await until(async()=>{const state=await agentSnapshot(id),label=await app.evaluate(js(sel=>document.querySelector(sel)?.innerText??'',sidebar(id)));return !state.turns.some(t=>['dispatching','started','queued'].includes(t.status))&&!/工作中|等待批准|等待处理|等待你处理/.test(label)},'normal read task complete',18000);scenario=null;}
}
async function readOnce(id,suffix,input,expected='ok'){const local=await startRead(id,suffix,input);return endRead(id,local,expected);}
async function exactGenerationResources(page){
 const parent=join(userData,'browser/agent-browser-home',page.id);let shorts;try{shorts=await readdir(parent);}catch(error){if(error.code==='ENOENT')shorts=[];else throw error;}
 const out=[];for(const short of shorts){assert(/^k[0-9a-f]{32}$/.test(short),'own generation name');const homePath=join(parent,short),socketPath='/private/tmp/wy-ab-'+createHash('sha256').update(userData+page.id+short).digest('hex').slice(0,24);assert.equal(await realpath(homePath),homePath);let files=[];try{assert.equal(await realpath(socketPath),socketPath);files=await readdir(socketPath);}catch(error){if(error.code!=='ENOENT')throw error;}
 const pidName='wy-'+short+'.pid';let identity=null;if(files.includes(pidName)){const pid=Number(await readFile(join(socketPath,pidName),'utf8'));assert(Number.isSafeInteger(pid)&&pid>1);identity=readExactPid(pid);}
 out.push({short,homePath,homeFiles:await readdir(homePath),socketPath,socketFiles:files,identity});}
 return {pageId:page.id,resources:out};
}
function readExactPid(pid){try{const s=execFileSync('/bin/ps',['-p',String(pid),'-o','pid=,ppid=,lstart=,comm='],{encoding:'utf8'}).trim();return s?{pid,row:s}:null}catch(error){if(error.status===1)return null;throw error;}}
async function existsExact(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
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
let t1,t2,anchor,target,local,releaseFixture,releaseCloseGate,liveResources=[];
async function oldResourcesGone(before){return until(async()=>{const observations=await Promise.all(before.resources.map(async r=>({short:r.short,homeExists:await existsExact(r.homePath),socketExists:await existsExact(r.socketPath),oldIdentityGone:!r.identity||readExactPid(r.identity.pid)?.row!==r.identity.row})));return observations.every(x=>!x.homeExists&&!x.socketExists&&x.oldIdentityGone)?observations:null},'old exact owner resources naturally retired',20000);}
function liveOnly(inventory){assert.equal(inventory.resources.length,1,'exactly one current helper generation');const resource=inventory.resources[0];assert(resource.identity&&resource.homeFiles.length&&resource.socketFiles.includes('wy-'+resource.short+'.pid'));return resource;}
async function commandAndOwner(task,page){const result=await readOnce(task,'browser_nav_snapshot_v2',{page:page.id});assert.equal(result.data?.browserPageId,page.id);assert.equal(result.data?.url,page.url);assert(result.data?.snapshot?.includes('静态资源夹具'));const inventory=await exactGenerationResources(page),generation=liveOnly(inventory);return {result,inventory,generation};}
async function alive(page){return observeMain((E,id)=>{const w=E.webContents.fromId(id);return Boolean(w&&!w.isDestroyed())},page.wc);}
async function bindProfileAfterUi(task,page,profileRow){await app.waitFor(js(q=>Array.from(document.querySelectorAll(q+' button')).some(x=>x.textContent.trim()==='完成'&&!x.disabled),dlg),25000);await until(async()=>{const s=await snapshot(task);return s.tabs.find(t=>t.id===page.id)?.profileId===profileRow.id},'same persisted logical page switched to chosen profile',25000);await done();const next=await awaitPage(task,page.url,page.id);assert.equal(next.profile,profileRow.id);assert.notEqual(next.wc,page.wc);await retired(page);return next;}
async function openApply(profileRow){await openProfiles();await profilePick(profileRow);await actionButton('用于当前页面');}
async function pendingApplyUI(task,page,oldProfile){return until(async()=>{const s=await snapshot(task),busy=await app.evaluate(js(q=>Array.from(document.querySelectorAll(q+' button')).some(x=>x.textContent.trim()==='完成'&&x.disabled),dlg));return busy&&s.tabs.find(t=>t.id===page.id)?.profileId===oldProfile&&await alive(page)?{at:Date.now(),busy,profile:oldProfile,oldWc:page.wc}:null},'UI pending legitimate profile switch still old logical owner',6000);}
try{
 await launch();await persist();stage='fixture';const tool=await app.invoke('agents.customToolPath','claude',wrapper);assert(tool.tool.installed&&tool.tool.login==='api');const profile=await app.invoke('agents.save',{name:'B11.3 synthetic native Claude',toolId:tool.tool.id,source:'login'});const project=await app.invoke('projects.create',{name:'B11.3 isolated resource test project',aliases:[],description:'',rulesPath:null},[{label:'fixture',path:cwd}]);const {dirs}=await app.invoke('projects.get',project.id);
 const makeTask=async title=>(await app.invoke('agentTasks.create',{projectId:project.id,dirId:dirs[0].id,cwd,title,profileId:profile.id,tier:'ask',model,carryExtensions:false})).taskId;t1=await makeTask('B11.3 same-page transition');t2=await makeTask('B11.3 independent anchor');report.fixture={t1,t2,project:project.id,origin};await app.cdp('Page.reload');
 stage='existing-actual-helper-owners';await switchTask(t2);anchor=await newTab(t2,url('H'));const anchorBefore=await nativeState(anchor),anchorOwner=await commandAndOwner(t2,anchor);liveResources.push(anchorOwner.inventory);await switchTask(t1);target=await newTab(t1,url('A'));const targetBefore=await nativeState(target),oldOwner=await commandAndOwner(t1,target);liveResources.push(oldOwner.inventory);
 const rows=await profileRows(t1),source=rows.find(x=>x.id===target.profile);assert(source);await openProfiles();const createText=await app.evaluate(js(q=>document.querySelector(q+' .bw-add')?.textContent.trim(),dlg));assert(createText);const alternate=await newProfileAction(t1,rows,()=>true,createText);await done();const sameBefore=await awaitPage(t1,target.url,target.id);assert.equal(sameBefore.wc,target.wc);assert.equal(sameBefore.profile,target.profile);report.baseline={anchor,anchorBefore,anchorOwner,target,targetBefore,oldOwner,source,alternate};await persist();
 const priorOwner=oldOwner;
 // Optional production-lifecycle diagnostic, separate from ordinary user case. Only exact own native final close delay, under original 5s deadline.
 {
  stage='bounded-native-close-settlement';const oldTarget=target,oldBefore=priorOwner.inventory;
  const install=await observeMain((E,id,expected)=>{const w=E.webContents.fromId(id);if(!w||w.isDestroyed()||w.getURL()!==expected||URL.parse(expected)?.hostname!=='127.0.0.1')throw Error('not exact own synthetic native target');const key=Symbol.for('willyou.qa.b11.same-generation-close.'+id);if(globalThis[key])throw Error('one owned gate only');const prior=Object.getOwnPropertyDescriptor(w,'close'),method=w.close;if(typeof method!=='function')throw Error('native close not holdable');const state={calls:0,calledAt:null,releasedAt:null,auto:false,released:false,options:null,installAt:Date.now()};let timer;
   function release(auto){if(state.released)return {...state};state.released=true;state.releasedAt=Date.now();state.auto=auto;clearTimeout(timer);if(prior)Object.defineProperty(w,'close',prior);else delete w.close;if(state.calls&&!w.isDestroyed())method.call(w,state.options);return {...state};}
   Object.defineProperty(w,'close',{configurable:true,writable:true,value:function(options){state.calls++;if(state.calls!==1)throw Error('unexpected repeated exact native close');state.calledAt=Date.now();state.options=options;timer=setTimeout(()=>release(true),3500);}});globalThis[key]={state,release};return {installed:true,wc:id,installAt:state.installAt,autoReleaseMs:3500,boundary:'only final native close delayed for own fixture WC; no change to identity/ownership/product data/authorization'};},oldTarget.wc,oldTarget.url);
  const getGate=()=>observeMain((E,id)=>{const g=globalThis[Symbol.for('willyou.qa.b11.same-generation-close.'+id)];return g?{...g.state}:null},oldTarget.wc);
  releaseCloseGate=()=>observeMain((E,id)=>{const k=Symbol.for('willyou.qa.b11.same-generation-close.'+id),g=globalThis[k];if(!g)return null;const r=g.release(false);delete globalThis[k];return r},oldTarget.wc);
  report.nativeGate={install};await persist();await openApply(alternate);
  const gate=await until(async()=>{const x=await getGate();return x?.calls===1&&!x.released&&await alive(oldTarget)?x:null},'old native final close in bounded real gate',3500);const waiting=await pendingApplyUI(t1,oldTarget,source.id);const current=await exactGenerationResources(oldTarget);assert(!current.resources.length,'old physical helper cleanup finished, no new same-page generation published before final WC settlement');assert((await exactGenerationResources(anchor)).resources[0].identity.row===anchorOwner.generation.identity.row);const checkpoint=Date.now();const release=await releaseCloseGate();releaseCloseGate=null;assert(release.released&&!release.auto&&checkpoint<=release.releasedAt&&gate.calledAt<checkpoint);const replacement=await bindProfileAfterUi(t1,oldTarget,alternate);const newOwner=await commandAndOwner(t1,replacement);liveResources.push(newOwner.inventory);const oldGone=await oldResourcesGone(oldBefore);assert.notEqual(newOwner.generation.short,priorOwner.generation.short);report.nativeGate={install,gate,waiting,current,checkpoint,release,replacement,newOwner,oldGone};await record('controlled-bounded-final-native-close-serial-same-id-new-owner',{oldTarget,replacement,checkpoint,release,newOwner:newOwner.generation,oldGone});target=replacement;
 }
 stage='adjacent-real-command-and-normal-quit';await switchTask(t2);const anchorAgain=await sameNative(t2,anchor,anchorBefore);const afterAnchor=await commandAndOwner(t2,anchor);assert.equal(afterAnchor.generation.short,anchorOwner.generation.short);assert.equal(afterAnchor.generation.identity.row,anchorOwner.generation.identity.row);const afterTarget=await exactGenerationResources(target);const currentGeneration=liveOnly(afterTarget);assert.equal(currentGeneration.short,report.nativeGate.newOwner.generation.short);await record('adjacent-owner-and-new-owner-remain-live-after-old-cleanup',{anchorAgain,afterAnchor,currentGeneration});
 report.windowsBeforeQuit=await windows();await observeMain(E=>{setTimeout(()=>E.app.quit(),50);return true});report.exit=await app.waitForExit(20000);assert.equal(report.exit.code,0);assert.equal(report.exit.signal,null);await writeFile(join(root,'electron.log'),app.logs(),{mode:0o600});app=null;const retiredAll=[];for(const inv of [anchorOwner.inventory,afterTarget])retiredAll.push({pageId:inv.pageId,resources:await oldResourcesGone(inv)});await record('actual-normal-exit-terminal-helper-resources',{retiredAll,exit:report.exit});report.status='B11.3-native-close-gate-actual-subset-pass';
}catch(error){report.status='failed-or-incomplete';report.error=String(error.stack??error);if(app){try{await app.screenshot(join(root,'failed-ui.png'));}catch{} }}
finally{if(releaseFixture)releaseFixture();if(releaseCloseGate)try{await releaseCloseGate()}catch{}local?.continuation.finish();for(const {resolve} of gate.values())resolve();gate.clear();if(app){try{for(const t of [t1,t2].filter(Boolean)){const snap=await agentSnapshot(t);if(snap.turns.some(turn=>['dispatching','started','queued','accepted'].includes(turn.status)))await app.invoke('agentTasks.stop',t,true);}await observeMain(E=>{setTimeout(()=>E.app.quit(),50);return true});report.exit=await app.waitForExit(20000);}catch(error){report.exitError=String(error.message);await app.close();}await writeFile(join(root,'electron.log'),app.logs(),{mode:0o600});}server.closeAllConnections();await new Promise(ok=>server.close(ok));report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({root,status:report.status,checks:report.checks.map(c=>c.name+':'+c.status),error:report.error}));if(report.status!=='B11.3-native-close-gate-actual-subset-pass')process.exitCode=1;}
