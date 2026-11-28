// Recovered C12 real-app workflow, scoped solely to B11.1 and the frozen C28 package.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,realpath,writeFile,readdir,appendFile,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {arch,release} from 'node:os';
import {openElectron,pause} from './electron-harness.mjs';
import {createNativeReceipt,acceptNativeEnvelope,exactNativeOutput,passivePollInput,readSnapshotReceipt} from './native-passive-poll.mjs';
import {stableClickPoint} from './same-click-point.mjs';
const BASE=dirname(fileURLToPath(import.meta.url));
const REPO='/Users/liubu/hx/4.uprxiao/SmartDD';
const bundleExact=join(REPO,'release/m16-qa-support/c28/build/mac-arm64/WillYou.app');
const codexExact='/Users/liubu/.local/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex';
const [bundleArg,pin,cliArg,nativePin,cliPin] = process.argv.slice(2);
const mode='resource',scope='full',resourceEntry='cli';
assert(bundleArg && cliArg && [pin,nativePin,cliPin].every(x=>/^[a-f0-9]{64}$/.test(x??'')));
const bundle=await realpath(bundleArg);
assert.equal(bundle,bundleExact);
const executable=join(bundle,'Contents/MacOS/WillYou');
const asar=join(bundle,'Contents/Resources/app.asar');
const native=join(bundle,'Contents/Resources/native/willyou-process-identity');
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
assert.equal(await digest(asar),pin);
assert.equal(await digest(native),nativePin);
const cli=await realpath(cliArg);
assert.equal(cli,codexExact);assert.equal(await digest(cli),cliPin);
const cohortRoot=process.env.WILLYOU_B11_COHORT_ROOT;
assert(cohortRoot?.startsWith(BASE+'/cohort-'),'exact own wrapper lease');
const lease=JSON.parse(await readFile(join(cohortRoot,'wrapper-config.private.json'),'utf8'));
assert.equal(lease.root,cohortRoot);assert.equal(lease.bundle,bundle);assert.equal(lease.pin,pin);assert.equal(lease.nativePin,nativePin);assert.equal(lease.cliPin,cliPin);
assert.equal(process.env.HOME,join(cohortRoot,'home'));assert(!Object.keys(process.env).some(k=>/(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH_SOCK)/i.test(k)));
const root=await mkdtemp(join(BASE,'run-')); // durable private evidence only
const privateRoot=await mkdtemp('/private/tmp/willyou-m16-b11-private-'); // independent of any enclosing Git checkout
const userData=join(privateRoot,'data'),home=join(privateRoot,'home'),cliHome=home,cwd=join(privateRoot,'project');
for(const p of [userData,home,cwd,join(home,'.codex')])await mkdir(p,{mode:0o700,recursive:true});
await writeFile(join(cwd,'fixture.txt'),'M16 F36 isolated file control\n',{mode:0o600});
const safeConfig='check_for_update_on_startup = false\ncli_auth_credentials_store = "file"\n[analytics]\nenabled = false\n';
await writeFile(join(home,'.codex','config.toml'),safeConfig,{mode:0o600});
console.log('F36 evidence: '+root);
const report={schema:'M16-B11-recovered',unit:'F36',mode,scope,sourceBaseline:'C28 coordinator exact private package; recovered C12 real workflow with C27 scope and idle window contract',layer:'A+I+S scoped actual operation using synthetic local model, no external provider',pin,nativePin,bundle,executableSha256:await digest(executable),cliSha256:cliPin,driverSha256:await digest(new URL(import.meta.url)),root,privateRoot,userData,home,host:{arch:arch(),release:release()},startedAt:new Date().toISOString(),actions:[],checks:[],requests:[],model:[]};
const persist=()=>writeFile(join(root,'result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
let app,stage='setup',scenario=null,modelSeq=0;
const gate=new Map(),arrived=new Set();
const model='m16-codex-one';
const key='m16-browser-local-fixture-no-live-secret';
const page=(path,title,logged=false)=>'<!doctype html><meta charset="utf-8"><title>'+title+'</title><h1>静态资源夹具 '+path+'</h1><p>静态空闲文档（没有 timer、animation、轮询）</p><input id="form" value="unchanged'+path+'"><script>window.docMarker=crypto.randomUUID()</script>';
// Response SSE fixture copied in shape from M16 scheduler's verified local Magpie probe; local own browser only.
function codexAnswer(res,model,answer){const id='resp_'+randomUUID(),common={id,object:'response',created_at:Math.floor(Date.now()/1000),model},part={type:'output_text',text:answer,annotations:[]},item={id:'msg_'+id,type:'message',role:'assistant',status:'completed',content:[part]};res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'close'});const event=(type,payload)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...payload})}\n\n`);event('response.created',{response:{...common,status:'in_progress',output:[]}});event('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});event('response.content_part.added',{item_id:item.id,output_index:0,content_index:0,part:{...part,text:''}});event('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:answer});event('response.output_text.done',{item_id:item.id,output_index:0,content_index:0,text:answer});event('response.content_part.done',{item_id:item.id,output_index:0,content_index:0,part});event('response.output_item.done',{output_index:0,item});event('response.completed',{response:{...common,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}});res.end();}
function codexTool(res,model,tool,id,args){const rid='resp_'+randomUUID(),call={type:'function_call',id:'fc_'+id,call_id:'call_'+id,name:tool.name,...(tool.namespace?{namespace:tool.namespace}:{}),arguments:JSON.stringify(args),status:'completed'},common={id:rid,object:'response',created_at:Math.floor(Date.now()/1000),model};res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});const event=(type,payload)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...payload})}\n\n`);event('response.created',{response:{...common,status:'in_progress',output:[]}});event('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',arguments:''}});event('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:call.arguments});event('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:call.arguments});event('response.output_item.done',{output_index:0,item:call});event('response.completed',{response:{...common,status:'completed',output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}});res.end();}
const server=createServer(async(req,res)=>{try{const u=new URL(req.url??'/',origin);if(u.origin!==origin){report.unexpectedExternalProxyAttempts=(report.unexpectedExternalProxyAttempts??0)+1;await persist();res.writeHead(403).end();return;}
 if(u.pathname.endsWith('/responses')){const chunks=[];let bytes=0;for await(const b of req){chunks.push(b);bytes+=b.length;assert(bytes<4_000_000)}const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));assert.equal(body.model,model);
  const tools=(body.tools??[]).flatMap(t=>t.type==='namespace'?(t.tools??[]).map(v=>({...v,namespace:t.name})):[t]);
  if(body.input==='Call the wy_ping tool exactly once.'&&tools.some(t=>t.name==='wy_ping')){report.providerPing=(report.providerPing??0)+1;const probe={type:'function_call',call_id:'call-probe',name:'wy_ping',arguments:'{}'},id='resp_'+randomUUID();res.writeHead(200,{'content-type':'text/event-stream'});const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);event('response.created',{response:{id,status:'in_progress'}});event('response.output_item.done',{item:probe});event('response.completed',{response:{id,status:'completed',output:[probe]}});res.end();return;}
  const local=scenario,history=JSON.stringify(body.input),tool=tools.find(t=>t.type==='function'&&(local?.cli?['exec_command','shell_command'].includes(t.name):t.name.endsWith('browser_tab_open_v2')));if(local&&history.includes(local.marker)&&!local.dispatched){if(!tool){report.actualAdvertisedLocalToolNames=tools.map(t=>({name:t.name,namespace:t.namespace}));await persist();throw Error('actual ordinary native command tool absent; not substituting');}let input=local.input;if(local.cli){const props=tool.parameters?.properties??{};const commandKey=props.cmd?'cmd':props.command?'command':null;assert(commandKey,'actual shell command contract unavailable');input={[commandKey]:local.command};if(props.workdir)input.workdir=cwd;if(props.yield_time_ms)input.yield_time_ms=10000;if(props.max_output_tokens)input.max_output_tokens=3000;assert((tool.parameters?.required??[]).every(k=>Object.hasOwn(input,k)),'unrecognized actual required argument; do not guess');}local.dispatched=true;local.dispatchedAt=Date.now();local.callId='call_'+randomUUID().replaceAll('-','');report.model.push({protocol:'responses',at:Date.now(),name:tool.name,namespace:tool.namespace,input,actualContract:tool.parameters??tool});await persist();codexTool(res,model,tool,local.callId.slice(5),input);return;}
  if(local?.dispatched){
   const raw=exactNativeOutput(body.input,local.callId);
   assert(local.cli&&local.nativeReceipt,'only the exact assigned local native command workflow');
   let next;
   try{next=acceptNativeEnvelope(local.nativeReceipt,raw);}
   catch(error){
    report.model.push({protocol:'responses',actualToolReceipt:JSON.stringify(raw).slice(0,3000),nativeReceiptError:String(error.message),at:Date.now()});
    await persist();throw error;
   }
   if(next.kind==='pending'){
    report.model.push({protocol:'responses',actualToolReceipt:JSON.stringify(raw).slice(0,3000),actualNativePending:{session:next.session,poll:next.poll},at:Date.now()});
    const pollTools=tools.filter(tool=>tool.type==='function'&&tool.name==='write_stdin');
    assert.equal(pollTools.length,1,'unique actual native write_stdin required for this running session');
    const pollTool=pollTools[0],input=passivePollInput(pollTool,next.session);
    local.callId='call_'+randomUUID().replaceAll('-','');
    report.model.push({protocol:'responses',at:Date.now(),name:pollTool.name,namespace:pollTool.namespace,input,actualContract:pollTool.parameters});
    await persist();
    codexTool(res,model,pollTool,local.callId.slice(5),input);
    return;
   }
   const {nativeTerminal,output}=next;
   local.receipt={output,nativeTerminal,at:Date.now()};
   report.model.push({protocol:'responses',actualToolReceipt:JSON.stringify(raw).slice(0,3000),actualNativeTerminal:{poll:nativeTerminal.poll,session:nativeTerminal.session,code:nativeTerminal.code},at:Date.now()});
   await persist();
   await local.continuation.promise;
  }
  report.model.push({protocol:'responses',assistant:'normal synthetic completion',at:Date.now()});
  codexAnswer(res,model,'F36 actual synthetic Codex fixture acknowledgement');return;}
 report.requests.push({at:Date.now(),path:u.pathname,search:u.search});if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}if(!/^\/(?:A|B|C|D|E|F|G|H|I)$/.test(u.pathname)){res.writeHead(404).end('only own fixture');return;}if(gate.has(u.pathname)){arrived.add(u.pathname);await gate.get(u.pathname).promise;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(page(u.pathname,'测试页面 '+u.pathname.slice(1)));}catch(error){report.modelError=String(error.message);if(!res.headersSent)res.writeHead(500);res.end('{}');}});
server.on('connect',(_req,socket)=>{report.unexpectedExternalProxyAttempts=(report.unexpectedExternalProxyAttempts??0)+1;socket.destroy();});
const origin='http://127.0.0.1:3425';const url=name=>origin+'/'+name;
await new Promise((ok,no)=>{server.once('error',no);server.listen({host:'127.0.0.1',port:3425,exclusive:true},ok)});

const js=(fn,...args)=>'('+fn.toString()+')(...'+JSON.stringify(args)+')';
async function until(fn,label,ms=12000){const limit=Date.now()+ms;let last;while(Date.now()<limit){last=await fn();if(last)return last;await pause(60);}throw Error('Timeout: '+label+' last='+JSON.stringify(last));}
const snapshot=id=>app.invoke('browser.snapshot',{taskId:id});
const agentSnapshot=id=>app.invoke('agentTasks.snapshot',id);
const sidebar=id=>'[data-testid="sidebar-agent-task"][data-task-id="'+id+'"]';
const shellGuard=(fn,...args)=>js((pid,exe,data,homePath,source,args)=>{
 const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');
 if(process.pid!==pid||process.execPath!==exe||E.app.getPath('userData')!==data||process.env.HOME!==homePath||process.env.SMARTDD_CLI_HOME!==homePath)throw Error('isolated candidate identity mismatch');
 return (0,eval)('('+source+')')(E,...args);
},app.processId,executable,userData,home,fn.toString(),args);
const observeMain=(fn,...args)=>app.mainEvaluate(shellGuard(fn,...args),{label:'f36-candidate-observation'});
async function windows(){return observeMain(E=>E.BaseWindow.getAllWindows().filter(w=>!w.isDestroyed()).map(w=>({id:w.id,title:w.getTitle(),visible:w.isVisible(),minimized:w.isMinimized(),bounds:w.getBounds(),children:w.contentView.children.filter(v=>v.webContents&&!v.webContents.isDestroyed()).map(v=>({id:v.webContents.id,url:v.webContents.getURL(),visible:v.getVisible?.()??null,bounds:v.getBounds()}))})))}
async function bind(){report.pid=await observeMain(()=>process.pid);return report.pid;}
function readShellTarget(selector,label,owner,requireFocus=false){
 return app.evaluate(js((query,text,expected,focusRequired)=>{
  const nodes=[...document.querySelectorAll(query)].filter(e=>{const r=e.getBoundingClientRect();return e.isConnected&&r.width>0&&r.height>0&&!e.matches(':disabled')&&(text===null||e.textContent.trim()===text);});
  if(nodes.length!==1)return null;
  const e=nodes[0],workspace=e.closest('.bw-workspace');
  const taskId=workspace?.dataset.browserTask??null,pageId=workspace?.dataset.browserPage??null;
  if(expected&&(taskId!==expected.taskId||pageId!==expected.pageId))return null;
  if(focusRequired&&document.activeElement!==e)return null;
  if(!focusRequired)e.scrollIntoView({behavior:'instant',block:'nearest'});
  const r=e.getBoundingClientRect(),x=Math.floor(r.x+r.width/2),y=Math.floor(r.y+r.height/2);
  if(!e.isConnected||!e.contains(document.elementFromPoint(x,y)))return null;
  const semantic=JSON.stringify({query,text,tag:e.tagName,role:e.getAttribute('role'),title:e.getAttribute('title'),aria:e.getAttribute('aria-label'),type:e.getAttribute('type'),sidebarTask:e.closest('[data-task-id]')?.getAttribute('data-task-id')??null,taskId,pageId});
  return {point:{x,y},semantic};
 },selector,label,owner,requireFocus));
}
async function shellClick(selector,label=null,{allowKeyboardAlternative=false,owner=null}={}){
 const getTarget=()=>readShellTarget(selector,label,owner);
 let guarded;
 try{
  guarded=await stableClickPoint({
   readTarget:getTarget,readNative:windows,pause,
   hover:point=>app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...point}),
  });
 }catch(error){
  const evidence=error.evidence??null;
  report.clickPointGuardFailures??=[];report.clickPointGuardFailures.push({stage,selector,label,owner,reason:error.reason??'identity-or-observation-error',error:String(error.message),evidence,at:Date.now()});
  if(error.reason==='native-occlusion'){
   report.occlusion??=[];report.occlusion.push({stage,selector,label,point:evidence?.point,elapsedMs:evidence?.elapsedMs,occlusion:evidence?.occlusion,native:evidence?.native,at:Date.now()});
   await persist();
   try{await app.screenshot(join(root,'native-occlusion-'+report.occlusion.length+'.png'));}catch{}
   if(allowKeyboardAlternative&&evidence?.occlusion?.length)return false;
  }else await persist();
  throw error;
 }
 // stableClickPoint has just reconfirmed exactly this layout/hit/z-order
 // after hover. No rendering, persistence or other async step precedes press.
 const point=guarded.point,at=Date.now();
 for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
 report.clickPointGuards??=[];report.clickPointGuards.push({stage,selector,label,owner,point,semantic:guarded.targetIdentity,shellIdentity:guarded.shellIdentity,attempts:guarded.attempts,retries:guarded.retries,elapsedMs:guarded.elapsedMs,at});
 if(selector.includes('agent-panel-menu')){report.menuHitTests??=[];report.menuHitTests.push({stage,selector,label,point,elapsedMs:guarded.elapsedMs,native:guarded.native,at});}
 report.actions.push({stage,kind:'UI-click',selector,label,point,at:Date.now()});await persist();return true;
}
async function keypress(key,modifiers=0,code=key){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,modifiers,...(key==='Enter'?{windowsVirtualKeyCode:13,...(type==='keyDown'?{text:'\r'}:{})}:/^[bfdt]$/i.test(key)?{windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0),...(type==='keyDown'?{text:key}:{})}:{})});}
async function assertFieldFocus(selector,owner){
 const proof=await stableClickPoint({readTarget:()=>readShellTarget(selector,null,owner,true),readNative:windows,pause});
 report.fieldFocusGuards??=[];report.fieldFocusGuards.push({stage,selector,owner,point:proof.point,semantic:proof.targetIdentity,shellIdentity:proof.shellIdentity,attempts:proof.attempts,retries:proof.retries,at:Date.now()});
}
async function field(selector,text,owner=null){
 await shellClick(selector,null,{owner});
 await assertFieldFocus(selector,owner);
 for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:4,...(type==='keyDown'?{commands:['selectAll']}:{})});
 await assertFieldFocus(selector,owner);
 await app.cdp('Input.insertText',{text});
 await app.waitFor(js((s,t,expected)=>{const e=document.querySelector(s),w=e?.closest('.bw-workspace');return e?.value===t&&document.activeElement===e&&(!expected||(w?.dataset.browserTask===expected.taskId&&w?.dataset.browserPage===expected.pageId));},selector,text,owner),8000);
}
async function switchTask(id){await app.waitFor(js(s=>!!document.querySelector(s),sidebar(id)),15000,{navigation:true});await shellClick(sidebar(id));await app.waitFor('!!document.querySelector(".agent-task-view textarea")',10000);}
async function openPanel(){if(!await app.evaluate('Boolean(document.querySelector("[data-testid=agent-workspace-panel]"))'))await shellClick('button[title="打开右侧面板"]');await app.waitFor('Boolean(document.querySelector("[data-testid=agent-workspace-panel]"))',5000);}
async function newTab(id,expected){
 await openPanel();
 const n=(await snapshot(id)).tabs.length;
 await shellClick('button[aria-label="打开面板"]');const clicked=await shellClick('.agent-panel-menu button[title="新建网页标签"]',null,{allowKeyboardAlternative:true});
 if(!clicked){await keypress('b',0,'KeyB');report.actions.push({stage,kind:'existing-menu-shortcut',key:'B',reason:'native occlusion recorded as independent B09.4 failure',at:Date.now()});await persist();}
 const created=await until(async()=>{const s=await snapshot(id);return s.tabs.length===n+1&&s.activeId?s:null;},'new UI tab');
 if(expected){const owner={taskId:id,pageId:created.activeId},addressSelector='[aria-label="网页地址"]';await field(addressSelector,expected,owner);await assertFieldFocus(addressSelector,owner);await keypress('Enter');await until(async()=>{const s=await snapshot(id);const t=s.tabs.find(t=>t.id===s.activeId);return t?.id===created.activeId&&(t.pendingUrl===expected||t.url===expected)?t:null},'URL submitted',3000);return await awaitPage(id,expected,created.activeId);}
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
async function check(name,fn,keepIndependent=false){stage=name;try{const evidence=await fn();report.checks.push({name,status:'pass',evidence});await persist();return true;}catch(error){report.checks.push({name,status:'fail',error:String(error.stack??error)});try{await app.screenshot(join(root,name.replace(/[^a-z0-9]/gi,'-')+'.png'))}catch{}await persist();if(!keepIndependent)throw error;await bind();return false;}}
function hold(path){let resolve;const promise=new Promise(r=>{resolve=r});gate.set(path,{promise,resolve});return()=>{resolve();gate.delete(path);}}
async function launch(){app=await openElectron({userData,executable,cwd:privateRoot,env:{HOME:home,SMARTDD_CLI_HOME:cliHome,NO_PROXY:'127.0.0.1,localhost',HTTP_PROXY:origin,HTTPS_PROXY:origin,ALL_PROXY:origin,no_proxy:'127.0.0.1,localhost',http_proxy:origin,https_proxy:origin,all_proxy:origin},inspectMain:true});await bind();}
let t1,t2,tClose,tPanel,tReload,tRebuild,a,b,c,closedIds=[];
async function setOwnWindowVisible(visible){const result=await observeMain((E,show)=>{const win=E.BaseWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.contentView.children.some(c=>/\/out\/renderer\/index\.html/.test(c.webContents?.getURL?.()??'')));if(!win)throw Error('own root missing');const before=win.isVisible();if(show)win.showInactive();else win.hide();return{id:win.id,before,after:win.isVisible(),action:show?'showInactive':'hide'};},visible);assert.equal(result.after,visible);report.visibilityTransitions??=[];report.visibilityTransitions.push(result);await persist();return result;}
const samplerRoot=BASE,python='/Library/Frameworks/Python.framework/Versions/3.11/bin/python3';
let osSampler,resourceCommandAnchor=0;const benchmarkTasks=[];let stoppingReason=null;
process.on('SIGINT',()=>{stoppingReason='owned resource driver interrupted';});process.on('SIGTERM',()=>{stoppingReason='owned resource driver terminated';});
function guardResource(){if(stoppingReason)throw Error(stoppingReason);}
async function makeSampler(name,args=[]){
 const child=spawn(python,['-u',join(samplerRoot,name),...args],{cwd:samplerRoot,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:home,TMPDIR:root,PYTHONDONTWRITEBYTECODE:'1',LANG:'en_US.UTF-8'},stdio:['pipe','pipe','pipe']});await once(child,'spawn');const lines=createInterface({input:child.stdout});let seq=0;const requests=new Map();let stderr='';child.stderr.on('data',b=>stderr+=String(b));let stopped=false;
 lines.on('line',v=>{const response=JSON.parse(v);const cb=requests.get(response.requestId);if(cb){requests.delete(response.requestId);cb(response);}});
 const invoke=async input=>{guardResource();const requestId=++seq;return new Promise((ok,no)=>{const timer=setTimeout(()=>{requests.delete(requestId);no(Error(name+' bounded reader timeout'));},8000);requests.set(requestId,r=>{clearTimeout(timer);ok(r)});child.stdin.write(JSON.stringify({...input,requestId})+'\n');});};
 const close=async()=>{if(stopped)return;stopped=true;if(child.exitCode===null){child.stdin.write(JSON.stringify({type:'stop'})+'\n');child.stdin.end();const code=await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(()=>r(null),3000))]);if(code===null&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}lines.close();};return{invoke,close,pid:child.pid,stderr:()=>stderr};
}
async function helperInventory(pages){const all=[];for(const p of pages){const parent=join(userData,'browser/agent-browser-home',p.id);let names;try{names=await readdir(parent);}catch(e){if(e.code==='ENOENT'){all.push({pageId:p.id,pids:[],generations:[]});continue;}throw e;}const generations=[];for(const short of names){assert(/^k[0-9a-f]{32}$/.test(short),'expected own generation directory');const dir='/private/tmp/wy-ab-'+createHash('sha256').update(userData+p.id+short).digest('hex').slice(0,24);let socketNames;try{socketNames=await readdir(dir);}catch(e){if(e.code==='ENOENT')continue;throw e;}assert.equal(await realpath(dir),dir,'exact derived own socket directory, never elsewhere');const pids=[];for(const n of socketNames.filter(n=>n===('wy-'+short+'.pid'))){const pid=Number(await readFile(join(dir,n),'utf8'));assert(Number.isSafeInteger(pid)&&pid>1);pids.push(pid);}generations.push({short,dir,socketNames,pids});}all.push({pageId:p.id,pids:generations.flatMap(g=>g.pids),generations});}return all;}
async function getMetrics(){return app.mainEvaluate(shellGuard(E=>E.app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,name:p.name,creationTime:p.creationTime,cpu:p.cpu,memory:p.memory}))),{synchronous:true,label:'b11-synchronous-actual-metrics'});}
async function resourceRead(task,page,round){
 assert(resourceEntry==='cli'&&/^[a-f0-9-]{36}$/.test(page.id));
 const command='willyou-app browser snapshot --page '+page.id;
 let finish;
 const local={cli:true,command,marker:'WY_F36_NATIVE_CLI_'+randomUUID(),dispatched:false,nativeReceipt:createNativeReceipt(),continuation:{promise:new Promise(r=>finish=r),finish:()=>finish()}};
 scenario=local;const requestedAt=Date.now();
 try{
  const state=await agentSnapshot(task);
  assert(Number.isSafeInteger(state.selectionRevision));
  const accepted=await app.invoke('agentTasks.submit',task,{clientInputId:randomUUID(),text:'请正常只读当前任务的静态网页，只执行公共CLI命令。'+local.marker,expectedSelectionRevision:state.selectionRevision});
  await until(()=>local.dispatched||report.modelError,'actual supported native shell tool called',30000);
  assert(local.dispatched,'actual CLI route absent; no substitute');
  await until(()=>local.receipt||report.modelError,'actual native CLI terminal receipt',30000);
  assert(local.receipt,report.modelError??'actual native terminal receipt absent');
  const receipt=local.receipt,nativeTerminal=receipt.nativeTerminal;
  assert.equal(nativeTerminal.code,0);
  const result=readSnapshotReceipt(receipt.output,page);
  const raw=nativeTerminal.actualHistory.join('\n');
  const record={task,pageId:page.id,round,accepted,receipt:{status:result.status,data:result.data,source:result.source,operation:result.operation,raw:raw.slice(0,5000),nativeTerminal},requestedAt,elapsedMs:Date.now()-requestedAt};
  report.readReceipts??=[];report.readReceipts.push(record.receipt);
  finish();
  await until(async()=>{const v=await agentSnapshot(task);return !v.turns.some(t=>['dispatching','started','queued','accepted'].includes(t.status))},'actual native turn idle',25000);
  return record;
 }finally{finish();scenario=null;}
}
async function parkedNative(pages){const views=await windows(),rootWindow=views.find(w=>w.children.some(c=>/\/out\/renderer\/index\.html/.test(c.url)));assert(rootWindow&&!rootWindow.visible);const shellAt=rootWindow.children.findIndex(c=>/\/out\/renderer\/index\.html/.test(c.url));const states=[];for(const p of pages){const at=rootWindow.children.findIndex(c=>c.id===p.wc);assert(at>=0&&at<shellAt&&rootWindow.children[at].visible===false,'actual parked same native view');const state=await nativeState(p);assert.equal(state.id,p.wc);assert.equal(state.page.marker,p.initial.page.marker);assert.equal(state.page.form,p.initial.page.form);const prefs=await app.mainEvaluate(shellGuard((E,id)=>{const w=E.webContents.fromId(id);if(!w||w.isDestroyed())throw Error('own actual parked page missing');const p=w.getLastWebPreferences();return {debuggerAttached:w.debugger.isAttached(),sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration,webSecurity:p.webSecurity,backgroundThrottling:w.getBackgroundThrottling(),lastWebPreferencesBackgroundThrottling:{present:Object.hasOwn(p,'backgroundThrottling'),value:p.backgroundThrottling??null}};},p.wc),{synchronous:true,label:'b11-actual-parked-preferences'});await appendFile(join(root,'native-parked-observations.jsonl'),JSON.stringify({task:p.task,pageId:p.id,state,prefs,bounds:rootWindow.children[at].bounds,at:Date.now()})+'\n');assert(prefs.debuggerAttached&&prefs.sandbox===true&&prefs.contextIsolation===true&&prefs.nodeIntegration===false&&prefs.webSecurity!==false&&prefs.backgroundThrottling===false);const rect=rootWindow.children[at].bounds;if(!p.parkedBounds)p.parkedBounds={width:rect.width,height:rect.height};assert.deepEqual({width:rect.width,height:rect.height},p.parkedBounds);states.push({...state,prefs,bounds:rect});}return states;}
async function longResource(project,dirs,profile){
 const dependencyFiles=[join(samplerRoot,'own_scope_native.py'),join(samplerRoot,'closure_contract.py'),join(samplerRoot,'cpu_collector.py'),join(samplerRoot,'coalition_accounting.py')];report.scopeSamplerFiles=Object.fromEntries(await Promise.all(dependencyFiles.map(async f=>[f,await digest(f)])));
 const pages=[],tasks=[];for(let i=0;i<5;i++){const task=(await app.invoke('agentTasks.create',{projectId:project.id,dirId:dirs[0].id,cwd,title:'F36 resource '+(i+1),profileId:profile.id,tier:'full',model,carryExtensions:false})).taskId;benchmarkTasks.push(task);tasks.push(task);}await app.cdp('Page.reload');for(let i=0;i<5;i++){const task=tasks[i];await switchTask(task);const page=await newTab(task,url('ABCDE'[i]));page.task=task;page.initial=await nativeState(page);pages.push(page);}
 await shellClick('.agent-panel-tabs [role="tab"]','文件');await setOwnWindowVisible(false);report.resourcePages=pages;report.benchmarkTasks=benchmarkTasks;report.resource={formalLongSeconds:1800,points:[0,5,10,15,20,25,30],warmup:[],rounds:[],status:'preflight',scope:'Actual original business/CLI and prospective strict current live scope endpoint closure; no pass solely from a successful probe, all original limits and independent CPU source closure remain required'};await persist();for(const p of pages){report.resource.warmup.push(await resourceRead(p.task,p,'warm'));await persist();}
 const cohort=await until(async()=>{try{return JSON.parse(await readFile(join(cohortRoot,'expected-cohort.json'),'utf8'));}catch(e){if(e.code==='ENOENT'||e instanceof SyntaxError)return null;throw e;}},'actual external exact wrapper/driver cohort lease',20000);assert.equal(cohort.driverPid,process.pid);assert.equal(cohort.pin,pin);assert.equal(cohort.driverSha,report.driverSha256);assert(!cohort.externalResourceIds.includes(cohort.resourceId));assert.equal(cohort.externalResourceIds.length,1);report.resource.cohort=cohort;
 const metrics=await getMetrics(),helpers=await helperInventory(pages),warmPark=await parkedNative(pages);assert.equal(helpers.length,5);assert(helpers.every(h=>h.pids.length===1));const requiredAnchors=new Map();for(const m of metrics)requiredAnchors.set(m.pid,{pid:m.pid,role:'product',pathPrefix:bundle+'/Contents/'});requiredAnchors.set(app.processId,{pid:app.processId,role:'product',pathExact:executable});for(const h of helpers)requiredAnchors.set(h.pids[0],{pid:h.pids[0],role:'product',pathExact:join(bundle,'Contents/Resources/agent-browser/arm64/agent-browser')});for(const row of cohort.rows){if(row.pid!==cohort.wrapperPid&&row.pid!==cohort.driverPid)continue;const b=row.before;requiredAnchors.set(row.pid,{pid:row.pid,role:'instrument',birth:b.bsd.birthSec+':'+b.bsd.birthUsec,pathExact:b.path});}assert(requiredAnchors.has(cohort.wrapperPid)&&requiredAnchors.has(cohort.driverPid));report.resource.warmPark=warmPark;report.resource.preflight={requiredAnchors:[...requiredAnchors.values()],helpers};await persist();
 osSampler=await makeSampler('own_scope_native.py',['--serve']);const init=await osSampler.invoke({type:'init',cid:cohort.resourceId,outsideCid:cohort.externalResourceIds[0],bundle,cohortRoot,cli,node:await realpath(process.execPath),dbPath:join(userData,'smartdd.db'),appPid:app.processId,taskIds:tasks,requiredAnchors:[...requiredAnchors.values()]});report.resource.preflight.init=init;await persist();assert.equal(init.kind,'scope-initialized','isolated scope init: '+(init.error??''));
 const scopeObservation=async(label,minute=null,instrumentExtra=[])=>{guardResource();const now=await osSampler.invoke({type:'capture',instrumentExtra});const elapsed=resourceCommandAnchor?Number(process.hrtime.bigint()-resourceCommandAnchor)/1e9:null;await appendFile(join(root,'scope-attempts.jsonl'),JSON.stringify({...now,label,minute,elapsedSeconds:elapsed})+'\n');assert.equal(now.kind,'scope-snapshot','actual scope sampler: '+(now.error??''));const attempts=now.attempts;assert(attempts.length>0);const last=attempts.at(-1);const out={label,minute,elapsedSeconds:elapsed,sequence:now.capture,closed:now.closedCandidate,rssTotalBytes:now.actualProductRssBytes,instrumentRssBytes:now.actualInstrumentRssBytes,netLive:now.actualFinalNetLive,firstCounter:attempts[0].counterBefore,lastCounter:last.counterAfter,finalIdentitySet:last.nodes.map(n=>n.pid+':'+n.birth).sort(),finalIdentityRoles:last.nodes.map(n=>({pid:n.pid,birth:n.birth,role:n.role,pathClass:n.pathClass})),attemptCount:attempts.length,verdicts:attempts.map(a=>a.candidateVerdict),scopeApproved:false};await appendFile(join(root,'scope-summary.jsonl'),JSON.stringify(out)+'\n');if(attempts.some(a=>a.candidateVerdict.state==='fatal'))throw Error('fatal retained native ownership/scope identity error; preserve raw, stop dependent work');return out;};
 const pre=await scopeObservation('preflight-baseline');report.resource.preflight.baseline=pre;await persist();if(!pre.closed){report.resource.status='preflight-incomplete-no-long-run';return {status:report.resource.status,reason:'actual initial live scope did not close; no formal or business rerun without coordinator decision',baseline:pre};}
 const child=spawn('/bin/sleep',['6'],{detached:true,stdio:'ignore',env:{PATH:'/usr/bin:/bin'}});await once(child,'spawn');const actualProbePid=child.pid;let held,probeExit;try{held=await scopeObservation('preflight-known-detached-child',null,[{pid:actualProbePid,role:'instrument',pathExact:'/bin/sleep'}]);}finally{probeExit=child.exitCode===null?await once(child,'exit'):[child.exitCode,child.signalCode];}const afterProbe=await scopeObservation('preflight-child-normal-exit');const original=new Set(pre.finalIdentitySet),heldSet=new Set(held.finalIdentitySet),afterSet=new Set(afterProbe.finalIdentitySet),heldExtra=held.finalIdentityRoles.filter(x=>x.pid===actualProbePid&&x.role==='instrument'),heldDiff=[...heldSet].filter(x=>!original.has(x));const proof=Boolean(held.closed&&afterProbe.closed&&probeExit[0]===0&&probeExit[1]===null&&held.netLive===pre.netLive+1&&afterProbe.netLive===pre.netLive&&heldExtra.length===1&&heldDiff.length===1&&heldDiff[0].startsWith(actualProbePid+':')&&[...original].every(x=>heldSet.has(x)&&afterSet.has(x))&&afterSet.size===original.size);report.resource.preflight.probe={actualProbePid,probeExit,held,afterProbe,currentNetLiveContractVerified:proof,boundary:'actual explicit own detached spawn/exec/setsid normal child in same group; complete graph adds one/removes one. Historical orphan/whole current production inheritance source proof independently reviewed.'};await persist();if(!proof){report.resource.status='preflight-incomplete-no-long-run';return {status:report.resource.status,reason:'actual current complete graph/live group count semantics not proved; no long run without coordinator decision'};}
 // Internal coordination gate only; no active measurement or user intervention.
 const nonce=randomUUID();report.resource.preflight.nonce=nonce;report.resource.status='preflight-closed-awaiting-coordinator';await writeFile(join(root,'scope-preflight-ready.json'),JSON.stringify({root,pin,nonce,resourceId:cohort.resourceId,netLive:afterProbe.netLive,scopeProof:'actual current stable full live graph, detached probe matched; no formal B11 yet'},null,2)+'\n');await persist();console.log(JSON.stringify({kind:'C12-scope-preflight-ready',root,pid:app.processId,netLive:afterProbe.netLive,nonce}));
 const approve=await until(async()=>{try{const v=JSON.parse(await readFile(join(root,'continue-long.private.json'),'utf8'));assert(v.root===root&&v.pin===pin&&v.nonce===nonce&&v.action==='continue-1800s','exact coordinator gate mismatch');return v;}catch(e){if(e.code==='ENOENT'||e instanceof SyntaxError)return null;throw e;}},'coordinator reviews exact native scope proof before full 1800s clock',180000);report.resource.preflight.coordinatorContinuation=approve;
 const recordPorts=async()=>{
  const out=execFileSync('/usr/sbin/lsof',['-nP','-a','-p',String(app.processId),'-iTCP','-sTCP:LISTEN','-F','n'],{encoding:'utf8'});
  const current=out.split('\n').filter(line=>line.startsWith('n')).map(line=>line.slice(1));
  assert(current.every(n=>/^(?:127\.0\.0\.1|\[::1\]):[0-9]+$/.test(n)),'actual own app exposes only loopback listeners');
  const pins=new Set([3425,...(report.ports??[]),...current.map(n=>Number(n.split(':').at(-1)))]);
  report.ports=[...pins].sort((a,b)=>a-b);
  await writeFile(join(root,'active-endpoint-pins.json'),JSON.stringify({appPid:app.processId,driverPid:process.pid,ports:report.ports},null,2));
 };
 await recordPorts();
 const baseline=await scopeObservation('measurement-baseline');assert(baseline.closed,'after coordinator review actual scope baseline remains complete');report.resource.baseline=baseline;resourceCommandAnchor=process.hrtime.bigint();report.resource.clock0=String(resourceCommandAnchor);report.resource.status='running';await persist();let nextRegular=5;let allClosed=true;let idleCounterSamples=0;
 for(const minute of [0,5,10,15,20,25,30]){
  const target=minute*60;while(Number(process.hrtime.bigint()-resourceCommandAnchor)/1e9<target){guardResource();const elapsed=Number(process.hrtime.bigint()-resourceCommandAnchor)/1e9;if(elapsed>=nextRegular){const idle=await osSampler.invoke({type:'idle'});assert.equal(idle.kind,'actual-idle-cpu-counter',idle.error);await appendFile(join(root,'idle-cpu-samples.jsonl'),JSON.stringify({...idle,label:'idle-aggregate-cpu-only',elapsedSeconds:elapsed})+'\n');idleCounterSamples++;nextRegular=Math.max(nextRegular+5,Math.floor(Number(process.hrtime.bigint()-resourceCommandAnchor)/1e9/5+1)*5);}else await pause(Math.min(1000,Math.max(40,(Math.min(target,nextRegular)-elapsed)*1000)));}
  const parked=await parkedNative(pages);const actualCurrentMetrics=await getMetrics(),actualCurrentHelpers=await helperInventory(pages);assert(actualCurrentHelpers.every((h,i)=>h.pids.length===1&&h.pids[0]===helpers[i].pids[0]));await recordPorts();const before=await scopeObservation('milestone-pre-command',minute);allClosed=allClosed&&before.closed;const commands=[];for(const p of pages)commands.push(await resourceRead(p.task,p,minute));const after=await scopeObservation('milestone-post-command',minute);allClosed=allClosed&&after.closed;assert(actualCurrentMetrics.every(m=>before.finalIdentityRoles.some(n=>n.pid===m.pid&&n.role==='product')),'current actual Electron metrics must be covered');const record={minute,parked,before,commands,after,actualCurrentMetrics,actualCurrentHelpers,activeElapsedSeconds:after.elapsedSeconds-before.elapsedSeconds};report.resource.rounds.push(record);await writeFile(join(root,'resource-minute-'+String(minute).padStart(2,'0')+'.json'),JSON.stringify(record,null,2));await persist();console.log(JSON.stringify({kind:'M16-C12-B11-checkpoint',minute,elapsedSeconds:after.elapsedSeconds,closed:before.closed,rssBytes:before.rssTotalBytes,commands:commands.length}));while(nextRegular<=Number(process.hrtime.bigint()-resourceCommandAnchor)/1e9)nextRegular+=5;
 }
 const ending=await scopeObservation('measurement-final');allClosed=allClosed&&ending.closed;
 const elapsed=Number(process.hrtime.bigint()-resourceCommandAnchor)/1e9;
 const finalNative=await parkedNative(pages);
 report.resource.final={elapsedSeconds:elapsed,native:finalNative,ending};
 assert(elapsed>=1800);
 assert.equal(report.resource.rounds.flatMap(r=>r.commands).length,35);
 assert.equal(report.resource.warmup.length,5);
 assert.equal(new Set(pages.map(p=>p.task)).size,5);assert.equal(new Set(pages.map(p=>p.id)).size,5);assert.equal(new Set(pages.map(p=>p.wc)).size,5);
 assert(!report.unexpectedExternalProxyAttempts,'unexpected external proxy request blocked');
 const rss=report.resource.rounds.map(r=>r.before.rssTotalBytes);
 const allRssKnown=rss.every(Number.isFinite);
 const last4=rss.slice(3);
 const idleWindows=[];let totalCpu=0n,totalNs=0n;
 for(let i=1;i<report.resource.rounds.length;i++){
  const prev=report.resource.rounds[i-1],next=report.resource.rounds[i];
  // CPU is a conservative enclosing coalition upper bound. Time uses the
  // inner monotonic idle bracket. This excludes the actual command windows,
  // includes every member/transient and subtracts no instrumentation cost.
  const cpu=BigInt(next.before.lastCounter.cpu_time)-BigInt(prev.after.firstCounter.cpu_time);
  const ns=BigInt(next.before.firstCounter.startNs)-BigInt(prev.after.lastCounter.endNs);
  assert(cpu>=0n&&ns>0n);
  totalCpu+=cpu;totalNs+=ns;
  idleWindows.push({fromMinute:prev.minute,toMinute:next.minute,cpuRawGroupUpper:String(cpu),idleNsLower:String(ns)});
 }
 const cpuNumer=totalCpu*BigInt(init.abi.numer),timeDenom=totalNs*BigInt(init.abi.denom);
 const groupIdleUpper={cpuNumerRaw:String(cpuNumer),timeDenomRaw:String(timeDenom),percent:100*Number(cpuNumer)/Number(timeDenom),strictlyBelow5:100n*cpuNumer<5n*timeDenom};
 const ratio=allRssKnown?rss[6]/rss[2]:null;
 const ratioPass=allRssKnown&&ratio<=1.1;
 const nonMonotone=allRssKnown&&!last4.every((x,i,a)=>i===0||x>a[i-1]);
 const criteriaPass=allClosed&&proof&&ratioPass&&nonMonotone&&groupIdleUpper.strictlyBelow5;
 report.resource.judgement={actualFullLiveSampleClosure:allClosed,actualCurrentLiveCountProbeVerified:proof,rawRss:rss,ratio30to10:ratio,rss30Within110:ratioPass,last4NonMonotone:nonMonotone,last4RawBytes:last4,elapsedSeconds:elapsed,warmCount:5,formalCommandCount:35,actualPages:5,idleWindows,actualIdleCounterSamples:idleCounterSamples,groupIdleUpper,scopeApproved:false,formalCasePassCandidate:criteriaPass,officialCpuGate:'raw complete resource-group upper bound, no instrument subtraction'};
 report.resource.businessComplete=true;
 report.resource.status=criteriaPass?'formal-metrics-green-awaiting-independent-scope-and-cleanup':'formal-metrics-red-or-scope-incomplete';
 await persist();
 return report.resource.judgement;
}
try{
 await launch();
 stage='fixture-setup';
 assert.equal(await digest(cli),cliPin);const detected=await app.invoke('agents.customToolPath','codex',cli);const tool=detected.tool;assert(tool.installed&&tool.kind==='codex');assert.equal(tool.version,'0.171.0');report.actualVerifiedSupportedTool={toolId:tool.id,version:tool.version,sha:await digest(cli)};const provider=await app.invoke('agents.saveProvider',{name:'F36 isolated Codex synthetic Magpie',preset:'magpie',endpoints:{responses:origin+'/v1',anthropic:origin+'/'},models:[{id:model,name:model,contextWindow:null,offline:false,availability:{codex:'available',claude:'untested',antigravity:'untested'}}]});const checked=await app.invoke('agents.checkProviderModel',provider.id,'codex',model);assert.equal(checked.models.find(m=>m.id===model)?.availability.codex,'available');assert(report.providerPing>=1,'actual local provider ping');const profile=await app.invoke('agents.save',{name:'F36 isolated Codex',toolId:tool.id,source:'provider',providerId:provider.id,models:[model],defaultModel:model,isDefault:true});const managedRoot=join(userData,'agents','codex',createHash('sha256').update(profile.id).digest('hex').slice(0,32));await mkdir(managedRoot,{recursive:true,mode:0o700});const priorConfig=await readFile(join(managedRoot,'config.toml'),'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;});assert(!priorConfig.trim()||priorConfig===safeConfig,'unexpected non-fixture managed config');if(priorConfig!==safeConfig)await writeFile(join(managedRoot,'config.toml'),safeConfig,{mode:0o600});report.codexFixture={version:tool.version,provider:provider.id,profile:profile.id,model,actualPing:report.providerPing};await persist();
 const project=await app.invoke('projects.create',{name:'F36 isolated project',aliases:[],description:'',rulesPath:null},[{label:'fixture',path:cwd}]);
 const {dirs}=await app.invoke('projects.get',project.id);
 const task=async title=>(await app.invoke('agentTasks.create',{projectId:project.id,dirId:dirs[0].id,cwd,title,profileId:profile.id,tier:'ask',model,carryExtensions:false})).taskId;
 t1=await task('F36 task one');t2=await task('F36 task two');tClose=mode==='manual'?await task('F36 close fixture'):null;tPanel=mode==='manual'?await task('F36 panel fixture'):null;tReload=['manual','reload'].includes(mode)?await task('F36 reload fixture'):null;tRebuild=['agent','rebuild','b02'].includes(mode)?await task('F36 native recovery fixture'):null;
 report.fixture={project:project.id,t1,t2,tClose,tPanel,tReload,tRebuild,profile:profile.id,origin};
 await app.cdp('Page.reload');
 await switchTask(t1);
 if(mode==='resource'){
  await check('B11.1-C12-stable-own-scope-preflight-and-long-run',()=>longResource(project,dirs,profile));
 }
 report.status=report.resource.status;if(report.status!=='formal-metrics-green-awaiting-independent-scope-and-cleanup')for(const c of report.checks)c.status=report.resource.businessComplete?'metrics-red-or-scope-incomplete':'incomplete';
}catch(error){report.status=mode+'-subset-failed';report.error=String(error.stack??error);if(app){try{report.visibleText=(await app.evaluate('document.body.innerText')).slice(0,4000);}catch{}}}
finally{
 scenario?.continuation?.finish();for(const {resolve} of gate.values())resolve();gate.clear();
 for(const [name,sampler] of [['os',osSampler]])if(sampler){try{await sampler.close();}catch(e){report.samplerCleanup??=[];report.samplerCleanup.push({name,error:String(e.message)});}}
 if(app){try{if(mode==='resource'){report.cleanup=[];for(const id of [t1,t2,...benchmarkTasks].filter(Boolean)){const state=await agentSnapshot(id);const label=await app.evaluate(js(sel=>document.querySelector(sel)?.innerText??'',sidebar(id)));const active=state.turns.some(turn=>['dispatching','started','queued','accepted'].includes(turn.status))||/工作中|等待批准|等待处理|等待你处理/.test(label);try{if(active){await app.invoke('agentTasks.stop',id,true);report.cleanup.push({id,wasActive:true,action:'retire active aborted isolated test task only'});}else report.cleanup.push({id,wasActive:false,action:'already idle; normal quit preserves task, no explicit stop'});}catch(error){report.cleanup.push({id,wasActive:active,error:String(error.message)});}}}report.windowsBeforeQuit=await windows();await observeMain(E=>{setTimeout(()=>E.app.quit(),50);return true});}catch(e){report.quitDispatch=String(e.message);}
 try{report.exit=await app.waitForExit(20000);}catch(e){report.exitError=String(e.message);await app.close();}
 report.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.log'),app.logs(),{mode:0o600});}
 server.closeAllConnections();await new Promise(ok=>server.close(ok));
 report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({root,status:report.status,error:report.error,checks:report.checks.map(c=>c.name+':'+c.status)}));
 if(report.status.endsWith('failed')||report.exitError||report.exit?.code!==0)process.exitCode=1;
}
