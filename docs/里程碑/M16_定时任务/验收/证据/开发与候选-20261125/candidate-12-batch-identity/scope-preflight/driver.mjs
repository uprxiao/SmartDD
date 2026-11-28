// M16 F36 candidate acceptance driver. Private local fixtures; no application source edits.
// Actual browser and shell actions use CDP Input. Read-only main inspector observes app identity/native view.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,realpath,writeFile,readdir,appendFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {join,dirname,resolve} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {arch,release} from 'node:os';
import {openElectron,pause} from '/Users/liubu/hx/4.uprxiao/SmartDD/scripts/lib/electron-harness.mjs';
const [bundleArg,pin,cliArg,mode="manual",scope="full"] = process.argv.slice(2);
assert(mode==="resource");const resourceEntry='cli';assert(["full","skip-known-green"].includes(scope));
assert(bundleArg && cliArg && /^[a-f0-9]{64}$/.test(pin ?? ''),'Run only explicitly allocated bundle, asar SHA256 and local Claude CLI');
const bundle=await realpath(bundleArg);
assert(bundle.startsWith('/private/tmp/willyou-')&&bundle.endsWith('/WillYou.app'),'B11 needs a dedicated private frozen package path to distinguish all App process identities; never daily install or shared release directory');
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
const report={pairedInitialB11Preflight:'/private/tmp/willyou-m16-f36-run-vFIe1F/result.json',schema:'M16-F36-candidate-a-v1',unit:'F36',mode,scope,sourceBaseline:'coordinator allocated candidate; working tree not inferred from later changes',layer:'Packaged business longevity diagnostic only + genuine A tool/page observations; synthetic model cannot certify real provider or S',pin,bundle,executableSha256:await digest(executable),cliSha256:await digest(cli),driverSha256:await digest(new URL(import.meta.url)),root,userData,host:{arch:arch(),release:release()},startedAt:new Date().toISOString(),actions:[],checks:[],requests:[],model:[]};
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
const model='m16-codex-one';
const key='m16-browser-local-fixture-no-live-secret';
const page=(path,title,logged=false)=>'<!doctype html><meta charset="utf-8"><title>'+title+'</title><h1>静态资源夹具 '+path+'</h1><p>静态空闲文档（没有 timer、animation、轮询）</p><input id="form" value="unchanged'+path+'"><script>window.docMarker=crypto.randomUUID()</script>';
// Response SSE fixture copied in shape from M16 scheduler's verified local Magpie probe; local own browser only.
function codexAnswer(res,model,answer){const id='resp_'+randomUUID(),common={id,object:'response',created_at:Math.floor(Date.now()/1000),model},part={type:'output_text',text:answer,annotations:[]},item={id:'msg_'+id,type:'message',role:'assistant',status:'completed',content:[part]};res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'close'});const event=(type,payload)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...payload})}\n\n`);event('response.created',{response:{...common,status:'in_progress',output:[]}});event('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});event('response.content_part.added',{item_id:item.id,output_index:0,content_index:0,part:{...part,text:''}});event('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:answer});event('response.output_text.done',{item_id:item.id,output_index:0,content_index:0,text:answer});event('response.content_part.done',{item_id:item.id,output_index:0,content_index:0,part});event('response.output_item.done',{output_index:0,item});event('response.completed',{response:{...common,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}});res.end();}
function codexTool(res,model,tool,id,args){const rid='resp_'+randomUUID(),call={type:'function_call',id:'fc_'+id,call_id:'call_'+id,name:tool.name,...(tool.namespace?{namespace:tool.namespace}:{}),arguments:JSON.stringify(args),status:'completed'},common={id:rid,object:'response',created_at:Math.floor(Date.now()/1000),model};res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});const event=(type,payload)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...payload})}\n\n`);event('response.created',{response:{...common,status:'in_progress',output:[]}});event('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',arguments:''}});event('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:call.arguments});event('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:call.arguments});event('response.output_item.done',{output_index:0,item:call});event('response.completed',{response:{...common,status:'completed',output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}});res.end();}
const server=createServer(async(req,res)=>{try{const u=new URL(req.url??'/',origin);if(u.origin!==origin){res.writeHead(403).end();return;}
 if(u.pathname.endsWith('/responses')){const chunks=[];let bytes=0;for await(const b of req){chunks.push(b);bytes+=b.length;assert(bytes<4_000_000)}const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));assert.equal(body.model,model);
  const tools=(body.tools??[]).flatMap(t=>t.type==='namespace'?(t.tools??[]).map(v=>({...v,namespace:t.name})):[t]);
  if(body.input==='Call the wy_ping tool exactly once.'&&tools.some(t=>t.name==='wy_ping')){report.providerPing=(report.providerPing??0)+1;const probe={type:'function_call',call_id:'call-probe',name:'wy_ping',arguments:'{}'},id='resp_'+randomUUID();res.writeHead(200,{'content-type':'text/event-stream'});const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);event('response.created',{response:{id,status:'in_progress'}});event('response.output_item.done',{item:probe});event('response.completed',{response:{id,status:'completed',output:[probe]}});res.end();return;}
  const local=scenario,history=JSON.stringify(body.input),tool=tools.find(t=>t.type==='function'&&(local?.cli?['exec_command','shell_command'].includes(t.name):t.name.endsWith('browser_tab_open_v2')));if(local&&history.includes(local.marker)&&!local.dispatched){if(!tool){report.actualAdvertisedLocalToolNames=tools.map(t=>({name:t.name,namespace:t.namespace}));await persist();throw Error('actual ordinary native command tool absent; not substituting');}let input=local.input;if(local.cli){const props=tool.parameters?.properties??{};const commandKey=props.cmd?'cmd':props.command?'command':null;assert(commandKey,'actual shell command contract unavailable');input={[commandKey]:local.command};if(props.workdir)input.workdir=cwd;if(props.yield_time_ms)input.yield_time_ms=1000;if(props.max_output_tokens)input.max_output_tokens=3000;assert((tool.parameters?.required??[]).every(k=>Object.hasOwn(input,k)),'unrecognized actual required argument; do not guess');}local.dispatched=true;local.dispatchedAt=Date.now();local.callId='call_'+randomUUID().replaceAll('-','');report.model.push({protocol:'responses',at:Date.now(),name:tool.name,namespace:tool.namespace,input,actualContract:tool.parameters??tool});await persist();codexTool(res,model,tool,local.callId.slice(5),input);return;}
  if(local?.dispatched){const receipt=(Array.isArray(body.input)?body.input:[]).find(x=>x.type==='function_call_output'&&x.call_id===local.callId);if(receipt){if(local.cli&&!local.receipt)local.receipt={output:receipt.output,at:Date.now()};report.model.push({protocol:'responses',actualToolReceipt:JSON.stringify(receipt.output).slice(0,3000),at:Date.now()});await persist();}await local.continuation.promise;}report.model.push({protocol:'responses',assistant:'normal synthetic completion',at:Date.now()});codexAnswer(res,model,'F36 actual synthetic Codex fixture acknowledgement');return;}
 report.requests.push({at:Date.now(),path:u.pathname,search:u.search});if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}if(!/^\/(?:A|B|C|D|E|F|G|H|I)$/.test(u.pathname)){res.writeHead(404).end('only own fixture');return;}if(gate.has(u.pathname)){arrived.add(u.pathname);await gate.get(u.pathname).promise;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(page(u.pathname,'测试页面 '+u.pathname.slice(1)));}catch(error){report.modelError=String(error.message);if(!res.headersSent)res.writeHead(500);res.end('{}');}});
server.on('connect',(_req,socket)=>socket.destroy());
const origin='http://127.0.0.1:3425';const url=name=>origin+'/'+name;
await new Promise((ok,no)=>{server.once('error',no);server.listen({host:'127.0.0.1',port:3425,exclusive:true},ok)});

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
 const point=await until(getPoint,'own visible UI '+selector+':'+label,8000);assert.deepEqual(await getPoint(),point);
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
async function launch(){app=await openElectron({userData,executable,cwd:root,env:{HOME:home,SMARTDD_CLI_HOME:cliHome,NO_PROXY:'127.0.0.1,localhost'},inspectMain:true});await bind();}
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


const samplerRoot='/private/tmp/willyou-m16-f36-qa/stable-scope-c12';const python='/Library/Frameworks/Python.framework/Versions/3.11/bin/python3';
const samplerHashes={"resource-sampler-business.py": "aedc38c01ea0c099a45516b5d1994af812e98aefac44bc2424cd21bfaad00b23", "cpu-collector-business.py": "15cc62964821a8e331309a042e4a75d1309e56e52de3a5316d6cbd8533bf0f72", "cpu_collector.py": "1ec08fa17302134094e9d066d4741cf076fd98acba20fda2f28a9caa369b2ab3", "coalition_accounting.py": "c22abeab6feac356502ea68de4ac19552302ed4c820a90211c2216897fe9e449"};
let osSampler,cpuSampler,resourceCommandAnchor=0;const benchmarkTasks=[];let stoppingReason=null;
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
 assert(resourceEntry==='cli'&&/^[a-f0-9-]{36}$/.test(page.id));const command='willyou-app browser snapshot --page '+page.id;let finish;const local={cli:true,command,marker:'WY_F36_NATIVE_CLI_'+randomUUID(),dispatched:false,continuation:{promise:new Promise(r=>finish=r),finish:()=>finish()}};scenario=local;const requestedAt=Date.now();
 try{const state=await agentSnapshot(task);assert(Number.isSafeInteger(state.selectionRevision));const accepted=await app.invoke('agentTasks.submit',task,{clientInputId:randomUUID(),text:'请正常只读当前任务的静态网页，只执行公共CLI命令。'+local.marker,expectedSelectionRevision:state.selectionRevision});await until(()=>local.dispatched||report.modelError,'actual supported native shell tool called',30000);assert(local.dispatched,'actual CLI route absent; no substitute');const receipt=await until(()=>local.receipt,'actual native CLI receipt',30000);const raw=typeof receipt.output==='string'?receipt.output:JSON.stringify(receipt.output);let result=null;for(const line of raw.split('\n')){const at=line.indexOf('{');if(at<0)continue;try{const r=JSON.parse(line.slice(at));if(r.schema==='willyou-app-result-v2')result=r;}catch{}}assert.equal(result?.status,'ok');assert.equal(result?.data?.browserPageId,page.id);assert.equal(result?.data?.url,page.url);assert(result?.data?.snapshot?.includes('静态资源夹具'));assert.equal(result?.source?.appId,'browser');assert.equal(result?.operation?.origin,'cli');assert.equal(result?.operation?.effectState,'read-only');const record={task,pageId:page.id,round,accepted,receipt:{status:result.status,data:result.data,source:result.source,operation:result.operation,raw:raw.slice(0,5000)},requestedAt,elapsedMs:Date.now()-requestedAt};report.readReceipts??=[];report.readReceipts.push(record.receipt);finish();await until(async()=>{const v=await agentSnapshot(task);return !v.turns.some(t=>['dispatching','started','queued','accepted'].includes(t.status))},'actual native turn idle',25000);return record;}
 finally{finish();scenario=null;}
}
async function resourceObservation(pages,label,minute=null){
 guardResource();const metrics=await getMetrics();const helpers=await helperInventory(pages);const sample=await osSampler.invoke({appPid:app.processId,appBundle:bundle,electronMetricPids:metrics.map(p=>p.pid),helperPids:helpers.flatMap(h=>h.pids),knownRuntimeExecutables:[cli,'/Applications/Xcode.app/Contents/Developer/Library/Frameworks/Python3.framework/Versions/3.9/Resources/Python.app/Contents/MacOS/Python']});assert.equal(sample.kind,'actual-os-sample',sample.message);assert.equal(sample.readErrors.length,0,'all current known own process counters readable');assert.equal(sample.processes.some(p=>p.pid===app.processId),true);sample.label=label;sample.minute=minute;sample.elapsedSeconds=resourceCommandAnchor?Number(process.hrtime.bigint()-BigInt(resourceCommandAnchor))/1e9:null;sample.helpers=helpers;sample.electronMetrics=metrics;await appendFile(join(root,'resource-samples.jsonl'),JSON.stringify(sample)+'\n');return sample;
}
async function cpuObservation(sample,{init=false,final=false}={}){
 let args;if(init){assert(sample.helpers.every(h=>h.pids.length===1),'five actual helper daemons must be present before clock0');const anchors=new Map([[app.processId,{pid:app.processId,role:'app'}]]);for(const h of sample.helpers)anchors.set(h.pids[0],{pid:h.pids[0],role:'fixed-daemon'});for(const m of sample.electronMetrics)anchors.set(m.pid,{pid:m.pid,role:m.pid===app.processId?'app':'electron'});for(const p of sample.processes)if(!anchors.has(p.pid))anchors.set(p.pid,{pid:p.pid,role:'actual-fixed-runtime'});for(const [pid,a] of anchors){const own=sample.processes.find(p=>p.pid===pid);assert(own);a.createdAtEpochSeconds=own.createdAtEpochSeconds;a.expectedPath=own.executable;}args={type:'init',anchors:[...anchors.values()],helpers:sample.helpers,electronMetricPids:sample.electronMetrics.map(p=>p.pid)};}
 else args={type:'capture',helpers:sample.helpers,electronMetricPids:sample.electronMetrics.map(p=>p.pid),final};
 const r=await cpuSampler.invoke(args);await appendFile(join(root,'native-cpu-samples.jsonl'),JSON.stringify(r)+'\n');assert.equal(r.kind,init?'cpu-initialized':'cpu-upper-sample',r.error??'CPU collector actual response');if(!init)assert.equal(r.gaps.length,0,'native counters/anchor scope gap');return r;
}
async function parkedNative(pages){const views=await windows(),rootWindow=views.find(w=>w.children.some(c=>/\/out\/renderer\/index\.html/.test(c.url)));assert(rootWindow&&!rootWindow.visible);const shellAt=rootWindow.children.findIndex(c=>/\/out\/renderer\/index\.html/.test(c.url));const states=[];for(const p of pages){const at=rootWindow.children.findIndex(c=>c.id===p.wc);assert(at>=0&&at<shellAt&&rootWindow.children[at].visible===false,'actual parked same native view');const state=await nativeState(p);assert.equal(state.id,p.wc);assert.equal(state.page.marker,p.initial.page.marker);assert.equal(state.page.form,p.initial.page.form);const prefs=await app.mainEvaluate(shellGuard((E,id)=>{const w=E.webContents.fromId(id);if(!w||w.isDestroyed())throw Error('own actual parked page missing');const p=w.getLastWebPreferences();return {debuggerAttached:w.debugger.isAttached(),sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration,webSecurity:p.webSecurity,backgroundThrottling:w.getBackgroundThrottling(),lastWebPreferencesBackgroundThrottling:{present:Object.hasOwn(p,'backgroundThrottling'),value:p.backgroundThrottling??null}};},p.wc),{synchronous:true,label:'b11-actual-parked-preferences'});await appendFile(join(root,'native-parked-observations.jsonl'),JSON.stringify({task:p.task,pageId:p.id,state,prefs,bounds:rootWindow.children[at].bounds,at:Date.now()})+'\n');assert(prefs.debuggerAttached&&prefs.sandbox===true&&prefs.contextIsolation===true&&prefs.nodeIntegration===false&&prefs.webSecurity!==false&&prefs.backgroundThrottling===false);const rect=rootWindow.children[at].bounds;if(!p.parkedBounds)p.parkedBounds={width:rect.width,height:rect.height};assert.deepEqual({width:rect.width,height:rect.height},p.parkedBounds);states.push({...state,prefs,bounds:rect});}return states;}
async function longResource(project,dirs,profile){
 const dependencyFiles=[join(samplerRoot,'own_scope_native.py'),join(samplerRoot,'closure_contract.py'),'/private/tmp/willyou-m16-f36-qa/resource-sampler/cpu_collector.py','/private/tmp/willyou-m16-f36-qa/resource-sampler/coalition_accounting.py'];report.scopeSamplerFiles=Object.fromEntries(await Promise.all(dependencyFiles.map(async f=>[f,await digest(f)])));
 const pages=[],tasks=[];for(let i=0;i<5;i++){const task=(await app.invoke('agentTasks.create',{projectId:project.id,dirId:dirs[0].id,cwd,title:'F36 resource '+(i+1),profileId:profile.id,tier:'full',model,carryExtensions:false})).taskId;benchmarkTasks.push(task);tasks.push(task);}await app.cdp('Page.reload');for(let i=0;i<5;i++){const task=tasks[i];await switchTask(task);const page=await newTab(task,url('ABCDE'[i]));page.task=task;page.initial=await nativeState(page);pages.push(page);}
 await shellClick('.agent-panel-tabs [role="tab"]','文件');await setOwnWindowVisible(false);report.resourcePages=pages;report.benchmarkTasks=benchmarkTasks;report.resource={formalLongSeconds:1800,points:[0,5,10,15,20,25,30],warmup:[],rounds:[],status:'preflight',scope:'Actual original business/CLI and prospective strict current live scope endpoint closure; no pass solely from a successful probe, all original limits and independent CPU source closure remain required'};await persist();for(const p of pages){report.resource.warmup.push(await resourceRead(p.task,p,'warm'));await persist();}
 const cohortRoot=process.env.WILLYOU_B11_COHORT_ROOT;assert(cohortRoot?.startsWith('/private/tmp/willyou-m16-f36-cohort-'));const cohort=await until(async()=>{try{return JSON.parse(await readFile(join(cohortRoot,'expected-cohort.json'),'utf8'));}catch(e){if(e.code==='ENOENT'||e instanceof SyntaxError)return null;throw e;}},'actual external exact wrapper/driver cohort lease',20000);assert.equal(cohort.driverPid,process.pid);assert.equal(cohort.pin,pin);assert.equal(cohort.driverSha,report.driverSha256);assert(!cohort.externalResourceIds.includes(cohort.resourceId));assert.equal(cohort.externalResourceIds.length,1);report.resource.cohort=cohort;
 const metrics=await getMetrics(),helpers=await helperInventory(pages),warmPark=await parkedNative(pages);assert.equal(helpers.length,5);assert(helpers.every(h=>h.pids.length===1));const requiredAnchors=new Map();for(const m of metrics)requiredAnchors.set(m.pid,{pid:m.pid,role:'product',pathPrefix:bundle+'/Contents/'});requiredAnchors.set(app.processId,{pid:app.processId,role:'product',pathExact:executable});for(const h of helpers)requiredAnchors.set(h.pids[0],{pid:h.pids[0],role:'product',pathExact:join(bundle,'Contents/Resources/agent-browser/arm64/agent-browser')});for(const row of cohort.rows){if(row.pid!==cohort.wrapperPid&&row.pid!==cohort.driverPid)continue;const b=row.before;requiredAnchors.set(row.pid,{pid:row.pid,role:'instrument',birth:b.bsd.birthSec+':'+b.bsd.birthUsec,pathExact:b.path});}assert(requiredAnchors.has(cohort.wrapperPid)&&requiredAnchors.has(cohort.driverPid));report.resource.warmPark=warmPark;report.resource.preflight={requiredAnchors:[...requiredAnchors.values()],helpers};await persist();
 osSampler=await makeSampler('own_scope_native.py',['--serve']);const init=await osSampler.invoke({type:'init',cid:cohort.resourceId,outsideCid:cohort.externalResourceIds[0],bundle,cohortRoot,cli,node:await realpath(process.execPath),dbPath:join(userData,'smartdd.db'),taskIds:tasks,requiredAnchors:[...requiredAnchors.values()]});report.resource.preflight.init=init;await persist();assert.equal(init.kind,'scope-initialized','isolated scope init: '+(init.error??''));
 const scopeObservation=async(label,minute=null,instrumentExtra=[])=>{guardResource();const now=await osSampler.invoke({type:'capture',instrumentExtra});const elapsed=resourceCommandAnchor?Number(process.hrtime.bigint()-resourceCommandAnchor)/1e9:null;await appendFile(join(root,'scope-attempts.jsonl'),JSON.stringify({...now,label,minute,elapsedSeconds:elapsed})+'\n');assert.equal(now.kind,'scope-snapshot','actual scope sampler: '+(now.error??''));const attempts=now.attempts;assert(attempts.length>0);const last=attempts.at(-1);const out={label,minute,elapsedSeconds:elapsed,sequence:now.capture,closed:now.closedCandidate,rssTotalBytes:now.actualProductRssBytes,instrumentRssBytes:now.actualInstrumentRssBytes,netLive:now.actualFinalNetLive,firstCounter:attempts[0].counterBefore,lastCounter:last.counterAfter,finalIdentitySet:last.nodes.map(n=>n.pid+':'+n.birth).sort(),finalIdentityRoles:last.nodes.map(n=>({pid:n.pid,birth:n.birth,role:n.role,pathClass:n.pathClass})),attemptCount:attempts.length,verdicts:attempts.map(a=>a.candidateVerdict),scopeApproved:false};await appendFile(join(root,'scope-summary.jsonl'),JSON.stringify(out)+'\n');if(attempts.some(a=>a.candidateVerdict.state==='fatal'))throw Error('fatal retained native ownership/scope identity error; preserve raw, stop dependent work');return out;};
 const pre=await scopeObservation('preflight-baseline');report.resource.preflight.baseline=pre;await persist();if(!pre.closed){report.resource.status='preflight-incomplete-no-long-run';return {status:report.resource.status,reason:'actual initial live scope did not close; no formal or business rerun without coordinator decision',baseline:pre};}
 const child=spawn('/bin/sleep',['6'],{detached:true,stdio:'ignore',env:{PATH:'/usr/bin:/bin'}});await once(child,'spawn');const actualProbePid=child.pid;let held,probeExit;try{held=await scopeObservation('preflight-known-detached-child',null,[{pid:actualProbePid,role:'instrument',pathExact:'/bin/sleep'}]);}finally{probeExit=child.exitCode===null?await once(child,'exit'):[child.exitCode,child.signalCode];}const afterProbe=await scopeObservation('preflight-child-normal-exit');const original=new Set(pre.finalIdentitySet),heldSet=new Set(held.finalIdentitySet),afterSet=new Set(afterProbe.finalIdentitySet),heldExtra=held.finalIdentityRoles.filter(x=>x.pid===actualProbePid&&x.role==='instrument'),heldDiff=[...heldSet].filter(x=>!original.has(x));const proof=Boolean(held.closed&&afterProbe.closed&&probeExit[0]===0&&probeExit[1]===null&&held.netLive===pre.netLive+1&&afterProbe.netLive===pre.netLive&&heldExtra.length===1&&heldDiff.length===1&&heldDiff[0].startsWith(actualProbePid+':')&&[...original].every(x=>heldSet.has(x)&&afterSet.has(x))&&afterSet.size===original.size);report.resource.preflight.probe={actualProbePid,probeExit,held,afterProbe,currentNetLiveContractVerified:proof,boundary:'actual explicit own detached spawn/exec/setsid normal child in same group; complete graph adds one/removes one. Historical orphan/whole current production inheritance source proof independently reviewed.'};await persist();if(!proof){report.resource.status='preflight-incomplete-no-long-run';return {status:report.resource.status,reason:'actual current complete graph/live group count semantics not proved; no long run without coordinator decision'};}
 // Internal coordination gate only; no active measurement or user intervention.
 const nonce=randomUUID();report.resource.preflight.nonce=nonce;report.resource.status='preflight-closed-awaiting-coordinator';await writeFile(join(root,'scope-preflight-ready.json'),JSON.stringify({root,pin,nonce,resourceId:cohort.resourceId,netLive:afterProbe.netLive,scopeProof:'actual current stable full live graph, detached probe matched; no formal B11 yet'},null,2)+'\n');await persist();console.log(JSON.stringify({kind:'C12-scope-preflight-ready',root,pid:app.processId,netLive:afterProbe.netLive,nonce}));
 const approve=await until(async()=>{try{const v=JSON.parse(await readFile(join(root,'continue-long.private.json'),'utf8'));assert(v.root===root&&v.pin===pin&&v.nonce===nonce&&v.action==='continue-1800s','exact coordinator gate mismatch');return v;}catch(e){if(e.code==='ENOENT'||e instanceof SyntaxError)return null;throw e;}},'coordinator reviews exact native scope proof before full 1800s clock',180000);report.resource.preflight.coordinatorContinuation=approve;
 const baseline=await scopeObservation('measurement-baseline');assert(baseline.closed,'after coordinator review actual scope baseline remains complete');report.resource.baseline=baseline;resourceCommandAnchor=process.hrtime.bigint();report.resource.clock0=String(resourceCommandAnchor);report.resource.status='running';await persist();let nextRegular=5;let allClosed=true;
 for(const minute of [0,5,10,15,20,25,30]){
  const target=minute*60;while(Number(process.hrtime.bigint()-resourceCommandAnchor)/1e9<target){guardResource();const elapsed=Number(process.hrtime.bigint()-resourceCommandAnchor)/1e9;if(elapsed>=nextRegular){const idle=await scopeObservation('idle-observation');allClosed=allClosed&&idle.closed;nextRegular=Math.max(nextRegular+5,Math.floor(Number(process.hrtime.bigint()-resourceCommandAnchor)/1e9/5+1)*5);}else await pause(Math.min(1000,Math.max(40,(Math.min(target,nextRegular)-elapsed)*1000)));}
  const parked=await parkedNative(pages);const before=await scopeObservation('milestone-pre-command',minute);allClosed=allClosed&&before.closed;const commands=[];for(const p of pages)commands.push(await resourceRead(p.task,p,minute));const after=await scopeObservation('milestone-post-command',minute);allClosed=allClosed&&after.closed;const record={minute,parked,before,commands,after,activeElapsedSeconds:after.elapsedSeconds-before.elapsedSeconds};report.resource.rounds.push(record);await writeFile(join(root,'resource-minute-'+String(minute).padStart(2,'0')+'.json'),JSON.stringify(record,null,2));await persist();console.log(JSON.stringify({kind:'M16-C12-B11-checkpoint',minute,elapsedSeconds:after.elapsedSeconds,closed:before.closed,rssBytes:before.rssTotalBytes,commands:commands.length}));while(nextRegular<=Number(process.hrtime.bigint()-resourceCommandAnchor)/1e9)nextRegular+=5;
 }
 const ending=await scopeObservation('measurement-final');allClosed=allClosed&&ending.closed;const elapsed=Number(process.hrtime.bigint()-resourceCommandAnchor)/1e9;report.resource.final={elapsedSeconds:elapsed,native:await parkedNative(pages),ending};assert(elapsed>=1800);assert.equal(report.resource.rounds.flatMap(r=>r.commands).length,35);assert.equal(report.resource.warmup.length,5);const rss=report.resource.rounds.map(r=>r.before.rssTotalBytes);const idleMeasuredSeconds=elapsed-report.resource.rounds.reduce((n,r)=>n+r.activeElapsedSeconds,0);assert(idleMeasuredSeconds>0);const baselineCounter=baseline.firstCounter,endCounter=ending.lastCounter;assert.equal(baselineCounter.resourceId,endCounter.resourceId);const rawDelta=endCounter.cpu_time-baselineCounter.cpu_time;assert(Number.isSafeInteger(rawDelta)&&rawDelta>=0);const upperSeconds=rawDelta*init.abi.numer/init.abi.denom/1e9;report.resource.judgement={actualFullLiveSampleClosure:allClosed,allSevenRssKnown:rss.every(Number.isFinite),rawRss:rss,ratio30to10:rss.every(Number.isFinite)?rss[6]/rss[2]:null,last4NonMonotone:rss.every(Number.isFinite)?!rss.slice(3).every((x,i,a)=>i===0||x>a[i-1]):null,idleMeasuredSeconds,coalitionWholeConservativeUpper:{rawDelta,totalCpuSeconds:upperSeconds,oneCorePercent:100*upperSeconds/idleMeasuredSeconds,includesAllCommandAndInstrumentCosts:true,ownershipReviewRequired:true},actualCurrentLiveCountProbeVerified:proof,scope:'Full current native graph candidates/no claims for any incomplete timestamp; independent final ownership proof required. No formal performance auto-pass.'};report.resource.status='actual-full-duration-completed-scope-review';report.resource.businessComplete=true;report.resource.formalPerformancePassed=false;await persist();return report.resource.judgement;
}

try{
 await launch();
 stage='fixture-setup';
 assert(cli.startsWith('/private/tmp/willyou-m16-verified-codex-')&&await digest(cli)==='739cda86e15d30a6e2b40cf8dcbbfb988aaf48b305b27065573bb8e9fd41d002');const detected=await app.invoke('agents.customToolPath','codex',cli);const tool=detected.tool;assert(tool.installed&&tool.kind==='codex');report.actualVerifiedSupportedTool={toolId:tool.id,version:tool.version,sha:await digest(cli)};const provider=await app.invoke('agents.saveProvider',{name:'F36 isolated Codex synthetic Magpie',preset:'magpie',endpoints:{responses:origin+'/v1',anthropic:origin+'/'},models:[{id:model,name:model,contextWindow:null,offline:false,availability:{codex:'available',claude:'untested',antigravity:'untested'}}]});const checked=await app.invoke('agents.checkProviderModel',provider.id,'codex',model);assert.equal(checked.models.find(m=>m.id===model)?.availability.codex,'available');assert(report.providerPing>=1,'actual local provider ping');const profile=await app.invoke('agents.save',{name:'F36 isolated Codex',toolId:tool.id,source:'provider',providerId:provider.id,models:[model],defaultModel:model,isDefault:true});report.codexFixture={version:tool.version,provider:provider.id,profile:profile.id,model,actualPing:report.providerPing};await persist();
 const project=await app.invoke('projects.create',{name:'F36 isolated project',aliases:[],description:'',rulesPath:null},[{label:'fixture',path:cwd}]);
 const {dirs}=await app.invoke('projects.get',project.id);
 const task=async title=>(await app.invoke('agentTasks.create',{projectId:project.id,dirId:dirs[0].id,cwd,title,profileId:profile.id,tier:'ask',model,carryExtensions:false})).taskId;
 t1=await task('F36 task one');t2=await task('F36 task two');tClose=mode==='manual'?await task('F36 close fixture'):null;tPanel=mode==='manual'?await task('F36 panel fixture'):null;tReload=['manual','reload'].includes(mode)?await task('F36 reload fixture'):null;tRebuild=['agent','rebuild','b02'].includes(mode)?await task('F36 native recovery fixture'):null;
 report.fixture={project:project.id,t1,t2,tClose,tPanel,tReload,tRebuild,profile:profile.id,origin};
 await app.cdp('Page.reload');
 await switchTask(t1);
 if(mode==='resource'){
  await check('B11.1-C12-stable-own-scope-preflight-and-long-run',()=>longResource(project,dirs,profile));
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
 report.status=report.resource?.status==='preflight-incomplete-no-long-run'?'C12-scope-preflight-incomplete-no-long-run':(mode==='resource'?'C12-stable-scope-review-no-auto-pass':mode)+'-subset-'+(report.checks.some(c=>c.status==='fail')||report.occlusion?.length?'failed':'passed');if(report.resource?.status==='preflight-incomplete-no-long-run')for(const c of report.checks)if(c.name.includes('C12-stable-own-scope'))c.status='incomplete';
}catch(error){report.status=mode+'-subset-failed';report.error=String(error.stack??error);if(app){try{report.visibleText=(await app.evaluate('document.body.innerText')).slice(0,4000);}catch{}}}
finally{
 scenario?.continuation?.finish();for(const {resolve} of gate.values())resolve();gate.clear();
 for(const [name,sampler] of [['os',osSampler],['cpu',cpuSampler]])if(sampler){try{await sampler.close();}catch(e){report.samplerCleanup??=[];report.samplerCleanup.push({name,error:String(e.message)});}}
 if(app){try{if(['agent','fast','b02','resource'].includes(mode)){report.cleanup=[];for(const id of [t1,t2,tRebuild,...benchmarkTasks].filter(Boolean)){const state=await agentSnapshot(id);const label=await app.evaluate(js(sel=>document.querySelector(sel)?.innerText??'',sidebar(id)));const active=state.turns.some(turn=>['dispatching','started','queued','accepted'].includes(turn.status))||/工作中|等待批准|等待处理|等待你处理/.test(label);try{if(active){await app.invoke('agentTasks.stop',id,true);report.cleanup.push({id,wasActive:true,action:'retire active aborted isolated test task only'});}else report.cleanup.push({id,wasActive:false,action:'already idle; normal quit preserves task, no explicit stop'});}catch(error){report.cleanup.push({id,wasActive:active,error:String(error.message)});}}}report.windowsBeforeQuit=await windows();await observeMain(E=>{setTimeout(()=>E.app.quit(),50);return true});}catch(e){report.quitDispatch=String(e.message);}
 try{report.exit=await app.waitForExit(20000);}catch(e){report.exitError=String(e.message);await app.close();}
 report.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.log'),app.logs(),{mode:0o600});}
 server.closeAllConnections();await new Promise(ok=>server.close(ok));
 report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({root,status:report.status,error:report.error,checks:report.checks.map(c=>c.name+':'+c.status)}));
 if(report.status.endsWith('failed')||report.exitError)process.exitCode=1;
}
