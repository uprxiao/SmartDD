// M16 F36 candidate acceptance driver. Private local fixtures; no application source edits.
// Actual browser and shell actions use CDP Input. Read-only main inspector observes app identity/native view.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,realpath,writeFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {join,dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {arch,release} from 'node:os';
import {openElectron,pause} from '/Users/liubu/hx/4.uprxiao/SmartDD/scripts/lib/electron-harness.mjs';
const [bundleArg,pin,cliArg,mode="manual",scope="full"] = process.argv.slice(2);
assert(mode==="b05-frozen-upgrade");assert(["full","skip-known-green"].includes(scope));
assert(bundleArg && cliArg && /^[a-f0-9]{64}$/.test(pin ?? ''),'Run only explicitly allocated bundle, asar SHA256 and local Claude CLI');
const bundle=await realpath(bundleArg);
assert(bundle==='/Users/liubu/hx/4.uprxiao/SmartDD/release/mac-arm64/WillYou.app'||bundle.startsWith('/private/tmp/willyou-')&&bundle.endsWith('/WillYou.app'),'Must use coordinator-allocated build, not installed app');
let executable=join(bundle,'Contents/MacOS/WillYou');const oldBundle='/private/tmp/willyou-m16-old-state-yUD0pJ/WillYou.app',oldPin='697bb2d273a743c22a2d2c2ebc3c509b0fcee3f9c4bbeeb34146c590b2d9afe2';
const asar=join(bundle,'Contents/Resources/app.asar');
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
assert.equal(await digest(asar),pin);
const cli=await realpath(cliArg);
assert.equal(await digest(join(oldBundle,'Contents/Resources/app.asar')),oldPin);const root=await mkdtemp('/private/tmp/willyou-m16-f36-b05-frozen-');
const userData=join(root,'data'),home=join(root,'home'),cliHome=join(root,'cli-home'),cwd=join(root,'project');
for(const path of [userData,home,cliHome,cwd])await mkdir(path,{mode:0o700});
await writeFile(join(cwd,'fixture.txt'),'M16 F36 isolated file control\n');
console.log('F36 evidence: '+root);
const report={schema:'M16-F36-candidate-a-v1',unit:'F36',mode,scope,sourceBaseline:'coordinator allocated candidate; working tree not inferred from later changes',layer:'Packaged A and read-only native observations; synthetic model cannot certify real provider or S',pin,bundle,executableSha256:await digest(executable),cliSha256:await digest(cli),driverSha256:await digest(new URL(import.meta.url)),root,userData,host:{arch:arch(),release:release()},startedAt:new Date().toISOString(),actions:[],checks:[],requests:[],model:[]};
const persist=()=>writeFile(join(root,'result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
let app,stage='setup',scenario=null,modelSeq=0;
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
   const local=scenario,tools=(body.tools??[]).filter(t=>t.name.endsWith(local?.suffix??'browser_tab_open_v2'));
   const text=JSON.stringify(body.messages);
   let block=null,blocks=null;const answer='M16 fixture acknowledgement';
   if(local&&text.includes(local.marker)&&!local.dispatched){assert(tools.length===1,'Expected one registered own-page normal tool '+local.suffix);local.dispatched=true;local.dispatchedAt=Date.now();local.toolUseId='tool_'+modelSeq;block={name:tools[0].name,input:local.input};if(local.batchInputs){blocks=local.batchInputs.map((input,i)=>({name:tools[0].name,input,id:'tool_'+modelSeq+'_'+i}));local.batchIds=blocks.map(b=>b.id);block=blocks[0];}}
   else if(local?.dispatched){
    if(local.batchIds){for(const token of local.batchIds){if(local.batchReceipts.some(r=>r.id===token))continue;const result=(body.messages??[]).flatMap(m=>Array.isArray(m.content)?m.content:[]).find(x=>x.type==='tool_result'&&x.tool_use_id===token);if(!result)continue;const texts=typeof result.content==='string'?[result.content]:(result.content??[]).filter(x=>x.type==='text').map(x=>x.text);let parsed=null;for(const value of texts){for(const candidate of [value,...value.split('\n').filter(line=>line.trim().startsWith('{'))]){try{const val=JSON.parse(candidate);if(val.schema==='willyou-app-result-v2')parsed=val;}catch{}}}local.batchReceipts.push({id:token,status:parsed?.status??null,isError:Boolean(result.is_error),data:parsed?.data??null,error:parsed?.error??null,sha256:createHash('sha256').update(JSON.stringify(result.content)).digest('hex')});}report.batchReceipts??=[];report.batchReceipts.push({marker:local.marker,result:local.batchReceipts});await persist();}
    else if(local.suffix){const prior=(body.messages??[]).flatMap(m=>Array.isArray(m.content)?m.content:[]).find(item=>item.type==='tool_result'&&item.tool_use_id===local.toolUseId);if(prior&&!local.receipt){const raw=JSON.stringify(prior.content??prior),texts=typeof prior.content==='string'?[prior.content]:Array.isArray(prior.content)?prior.content.filter(x=>x.type==='text'&&typeof x.text==='string').map(x=>x.text):[];let parsed=null,generic=null;for(const value of texts){for(const candidate of [value,...value.split('\n').filter(line=>line.trim().startsWith('{'))]){try{const env=JSON.parse(candidate);if(env.schema==='willyou-app-result-v2'){parsed=env;break;}if(env.error?.code)generic=env;}catch{}}if(parsed)break;}
     local.receipt={name:local.suffix,status:parsed?.status??(generic?'error':null),errorCode:parsed?.error?.code??generic?.error?.code??null,error:parsed?.error?.message??generic?.error?.message??null,data:parsed?.data??null,source:parsed?.source??null,operation:parsed?.operation??null,rawPreview:texts.map(t=>t.slice(0,1000)).join(' | ').slice(0,2000),sha256:createHash('sha256').update(raw).digest('hex'),isError:Boolean(prior.is_error),at:Date.now()};report.readReceipts??=[];report.readReceipts.push(local.receipt);await persist();}}
    await local.continuation.promise;
   }
   report.model.push({id,at:Date.now(),tool:block?.name??null,input:block?.input??null,contract:block?tools[0].input_schema??null:null});
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','request-id':'req_'+modelSeq});
   const send=(type,fields={})=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...fields})+'\n\n');
   send('message_start',{message:msg});if(blocks){for(let i=0;i<blocks.length;i++){const b=blocks[i];send('content_block_start',{index:i,content_block:{type:'tool_use',id:b.id,name:b.name,input:{}}});send('content_block_delta',{index:i,delta:{type:'input_json_delta',partial_json:JSON.stringify(b.input)}});send('content_block_stop',{index:i});}send('message_delta',{delta:{stop_reason:'tool_use',stop_sequence:null},usage:{output_tokens:20}});send('message_stop');res.end();return;}send('content_block_start',{index:0,content_block:block?{type:'tool_use',id:'tool_'+modelSeq,name:block.name,input:{}}:{type:'text',text:''}});
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


let tHistory,tAdopt;
function diskWorkspace(task){assert(/^[a-f0-9-]{36}$/.test(task));const result=execFileSync('/usr/bin/sqlite3',['-readonly','-json',join(userData,'smartdd.db'),"SELECT value FROM app_settings WHERE key='browserWorkspace.v1:"+task+"'"],{encoding:'utf8'}).trim();return result?JSON.parse(JSON.parse(result)[0].value):{version:1,tabs:[],activeId:null,closed:[]};}
async function normalOpenCall(id,suffix,input,expected){assert(['browser_tab_open_v2','browser_tab_close_v2','browser_operation_get_v2','browser_nav_wait_v2'].includes(suffix),'only ordinary fixed own-page tool operations');let resolve;const continuation={promise:new Promise(r=>{resolve=r}),finish:()=>resolve()},local={suffix,input,marker:'WY_F36_CONTRACT_'+randomUUID(),dispatched:false,continuation};scenario=local;
 try{await switchTask(id);await field('.agent-task-view textarea','请执行单一普通合成测试步骤。'+local.marker);await shellClick('.agent-task-view button[type="submit"]');await until(()=>local.dispatched,'actual available normal own-page tool',20000);const value=await until(()=>local.receipt,'actual original normal tool receipt',25000);if(expected==='ok'){assert.equal(value.status,'ok');assert.equal(value.isError,false);}else assert(value.status==='error'||value.isError,'actual clearly failed normal invalid input');return value;}
 finally{continuation.finish();await until(async()=>{const state=await agentSnapshot(id),label=await app.evaluate(js(sel=>document.querySelector(sel)?.innerText??'',sidebar(id)));return !state.turns.some(t=>['dispatching','started','queued','accepted'].includes(t.status))&&!/工作中|等待批准|等待处理|等待你处理/.test(label)},'actual normal tool turn idle',18000);scenario=null;}
}


async function startOwnOpenInputs(id,address,n){assert([1,2].includes(n));let resolve;const continuation={promise:new Promise(r=>{resolve=r}),finish:()=>resolve()},input={url:address,intent:'reuse-or-new',presentation:'background'},local={suffix:'browser_tab_open_v2',marker:'WY_F36_BATCH_'+randomUUID(),input,batchInputs:Array.from({length:n},()=>({...input})),batchReceipts:[],dispatched:false,continuation,before:operationRows(id)};scenario=local;
 try{await switchTask(id);await field('.agent-task-view textarea','请正常打开本任务自己的合成网页。'+local.marker);await shellClick('.agent-task-view button[type="submit"]');await until(()=>local.dispatched,'actual normal model dispatch',20000);return local;}catch(e){continuation.finish();throw e;}}
const beginBatchOpen=(id,address)=>startOwnOpenInputs(id,address,2),beginNewSingleOpen=(id,address)=>startOwnOpenInputs(id,address,1);
async function endBatchOpen(id,local){try{return await until(()=>local.batchReceipts.length===local.batchInputs.length?local.batchReceipts:null,'all actual normal tool receipts',30000);}finally{local.continuation.finish();await until(async()=>{const state=await agentSnapshot(id);return !state.turns.some(t=>['accepted','dispatching','started','queued'].includes(t.status))},'actual model batch idle',18000);scenario=null;}}

const OLD_HASH='91c887767cea1b032dc09d5a976509aabc2df70480a25505314ab24f9d70187c',NEW_HASH='a86b61ac4544f5898b08c60108c078e6eeb2eadd8e97da979c3d59b8543fc5ba';
const OLD_SCHEMA='581314d3f0a087bdf57d227a32f1c7c49051d4cbb16540390a9ac1425af2539a',NEW_SCHEMA='bebd0c3414a5815f79262cbf60a73a9c63b888829f277f35f0c3048d8f6970cd';
const schemaRelative='schemas/capabilities/smartdd_browser_tab_open_v2.input.json';
const oldSource=join(oldBundle,'Contents/Resources/capability-bundles/apps/browser/0.1.4',OLD_HASH,schemaRelative),newSource=join(bundle,'Contents/Resources/capability-bundles/apps/browser/0.1.5',NEW_HASH,schemaRelative);assert.equal(await digest(oldSource),OLD_SCHEMA);assert.equal(await digest(newSource),NEW_SCHEMA);report.packageSchemas={old:{hash:OLD_HASH,sha256:OLD_SCHEMA,hasOneOf:Boolean(JSON.parse(await readFile(oldSource,'utf8')).oneOf)},current:{hash:NEW_HASH,sha256:NEW_SCHEMA,hasOneOf:Boolean(JSON.parse(await readFile(newSource,'utf8')).oneOf)}};assert(!report.packageSchemas.old.hasOneOf&&report.packageSchemas.current.hasOneOf);report.launches=[];report.actualCalls=[];report.oldPin=oldPin;
function SQL(query){return execFileSync('/usr/bin/sqlite3',['-readonly','-json',join(userData,'smartdd.db'),query],{encoding:'utf8'}).trim();}
function safeRows(query){const text=SQL(query);return text?JSON.parse(text):[];}
function frozenEvidence(task){assert(/^[a-f0-9-]{36}$/.test(task));const matches=safeRows("SELECT b.binding_id,b.native_id,b.native_confirmed_at,s.capability_session_id,s.revision,s.content_hash,s.snapshot_json FROM agent_bindings b JOIN agent_capability_sessions s ON s.binding_id=b.binding_id WHERE b.task_id='"+task+"' ORDER BY s.revision");const frozen=matches.map(row=>{const x=JSON.parse(row.snapshot_json),pkg=x.snapshot?.packages?.find(p=>p.appId==='browser');return{bindingId:row.binding_id,nativeIdHash:row.native_id?createHash('sha256').update(row.native_id).digest('hex'):null,nativeConfirmedAt:row.native_confirmed_at,sessionId:row.capability_session_id,revision:row.revision,contentHash:row.content_hash,snapshotBytesSha:createHash('sha256').update(row.snapshot_json).digest('hex'),kind:x.kind,browserPackageHash:pkg?.packageHash??null};});const runs=safeRows("SELECT run_id,capability_session_id,binding_id,binding_mode,state,generation FROM capability_runs WHERE task_id='"+task+"' ORDER BY generation");return{frozen,runs};}
async function retainedBrowserSchemas(){const rows=safeRows("SELECT package_hash,version,relative_path FROM capability_packages WHERE app_id='browser' ORDER BY version");const active=safeRows("SELECT package_hash FROM capability_active_packages WHERE app_id='browser'");const packages=[];for(const row of rows){const loc=await realpath(join(userData,'capabilities',row.relative_path,schemaRelative));assert(loc.startsWith(join(userData,'capabilities')+'/'));const contract=JSON.parse(await readFile(loc,'utf8'));packages.push({hash:row.package_hash,version:row.version,schemaSha:await digest(loc),oneOf:Boolean(contract.oneOf),relativePath:row.relative_path});}return{packages,active:active[0]?.package_hash};}
async function runSelected(selected,expected,label){assert(!app);assert.equal(await digest(join(selected,'Contents/Resources/app.asar')),expected);executable=join(selected,'Contents/MacOS/WillYou');stage=label;app=await openElectron({userData,executable,cwd:root,env:{HOME:home,SMARTDD_CLI_HOME:cliHome,CODEX_HOME:join(cliHome,'.codex'),CLAUDE_CONFIG_DIR:join(cliHome,'config'),XDG_CONFIG_HOME:join(home,'.config'),HTTP_PROXY:origin,HTTPS_PROXY:origin,ALL_PROXY:origin,NO_PROXY:'127.0.0.1,localhost'},inspectMain:true});const pid=await bind();report.launches.push({label,pid,bundle:selected,expected,exeSha:await digest(executable)});await persist();await until(async()=>{const actual=await windows();return actual.some(w=>w.visible&&!w.minimized&&w.children.some(c=>/\/out\/renderer\/index\.html/.test(c.url)))},'actual isolated trusted native root ready',15000);}
async function quitSelected(){const live=app,launch=report.launches.at(-1);assert(live);await observeMain(E=>{setTimeout(()=>E.app.quit(),50);return true});try{launch.exit=await live.waitForExit(20000);assert.equal(launch.exit.code,0);assert.equal(launch.exit.signal,null);}catch(e){launch.quitError=String(e.message);await live.close();throw e;}finally{await writeFile(join(root,launch.label+'-electron.log'),live.logs(),{mode:0o600});app=null;await persist();}}
async function actualCall(task,label,suffix,input,status='ok'){stage=label;const start=report.model.length;const result=await normalOpenCall(task,suffix,input,status);const contract=report.model.slice(start).find(m=>m.tool?.endsWith(suffix))?.contract;assert(contract,'actual provider advertised tool input contract not merely static schema');const proof={label,task,suffix,input,result,advertised:contract,advertisedSha:createHash('sha256').update(JSON.stringify(contract)).digest('hex'),oneOf:Boolean(contract.oneOf),frozen:frozenEvidence(task),at:Date.now()};report.actualCalls.push(proof);await persist();return proof;}
function taskLedgerHasPackage(record,hash){return record.frozen.some(x=>x.kind==='application'&&x.browserPackageHash===hash||x.browserPackageHash===hash);}
function exactOldFrozenUnchanged(before,after){const old=before.frozen.filter(x=>x.browserPackageHash===OLD_HASH);assert(old.length>0,'actual old frozen session needed');for(const x of old){const y=after.frozen.find(a=>a.sessionId===x.sessionId);assert(y&&y.contentHash===x.contentHash&&y.snapshotBytesSha===x.snapshotBytesSha&&y.browserPackageHash===x.browserPackageHash,'old frozen record must not be rewritten');}return old;}
try{
 await runSelected(oldBundle,oldPin,'old-native-fresh-root');
 const tool=await app.invoke('agents.customToolPath','claude',wrapper);assert(tool.tool.installed&&tool.tool.login==='api');const profile=await app.invoke('agents.save',{name:'B05 private local synthetic Claude',toolId:tool.tool.id,source:'login'});const project=await app.invoke('projects.create',{name:'B05 fresh isolated project',aliases:[],description:'',rulesPath:null},[{label:'fixture',path:cwd}]);const {dirs}=await app.invoke('projects.get',project.id);const createTask=async title=>(await app.invoke('agentTasks.create',{projectId:project.id,dirId:dirs[0].id,cwd,title,profileId:profile.id,tier:'full',model,carryExtensions:false})).taskId;
 t1=await createTask('B05 old actual frozen native task');report.fixture={project:project.id,t1,profile:profile.id,origin};await app.cdp('Page.reload');await switchTask(t1);const seeded=await actualCall(t1,'old-first-actual-valid','browser_tab_open_v2',{url:url('A'),intent:'reuse-or-new',presentation:'show'});assert(!seeded.oneOf,'old actual model advertised legacy schema lacking oneOf');assert(seeded.result.data.pageId&&seeded.result.operation?.requestId);const pageId=seeded.result.data.pageId,originalRequest=seeded.result.operation.requestId;const oldPage=await awaitPage(t1,url('A'),pageId);const oldDoc=await nativeState(oldPage);assert.equal(oldPage.profile,(await snapshot(t1)).tabs.find(t=>t.id===pageId).profileId);const originalReceipt=await actualCall(t1,'old-original-receipt','browser_operation_get_v2',{request:originalRequest});assert(JSON.stringify(originalReceipt.result.data).includes(pageId));const oldFrozen=frozenEvidence(t1);assert(taskLedgerHasPackage(oldFrozen,OLD_HASH));const oldBinding=oldFrozen.frozen.find(x=>x.browserPackageHash===OLD_HASH&&x.nativeIdHash);assert(oldBinding,'actual old native binding confirmed');const oldPackages=await retainedBrowserSchemas();assert.equal(oldPackages.active,OLD_HASH);assert(oldPackages.packages.some(x=>x.hash===OLD_HASH&&x.schemaSha===OLD_SCHEMA&&!x.oneOf));report.oldBaseline={oldFrozen,oldBinding,oldPackages,seeded,originalReceipt,oldPage,oldDoc};await app.screenshot(join(root,'B05-old-actual-page.png'));await persist();
 await quitSelected();report.oldDbSha=await digest(join(userData,'smartdd.db'));await cp(userData,join(root,'sealed-old-archive-only'),{recursive:true,errorOnExist:true,force:false,dereference:false});report.archiveBoundary='copy for private archive only; concurrent coordination gate never moved/deleted/reused, candidate uses same original fresh root';await persist();
 await runSelected(bundle,pin,'C12-upgrade-same-original-root');const beforeResume=frozenEvidence(t1);exactOldFrozenUnchanged(oldFrozen,beforeResume);const afterPackages=await retainedBrowserSchemas();assert(afterPackages.packages.some(x=>x.hash===OLD_HASH&&x.schemaSha===OLD_SCHEMA&&!x.oneOf));assert(afterPackages.packages.some(x=>x.hash===NEW_HASH&&x.schemaSha===NEW_SCHEMA&&x.oneOf));report.upgradeBeforeResume={beforeResume,afterPackages};await persist();
 await switchTask(t1);const resumed=await actualCall(t1,'C12-resume-old-native-valid','browser_tab_open_v2',{pageId,presentation:'show'});assert.equal(resumed.result.data.pageId,pageId);const resumedPage=await awaitPage(t1,url('A'),pageId);assert.equal(resumedPage.profile,oldPage.profile);const resumedDoc=await nativeState(resumedPage);const resumeRecord=frozenEvidence(t1);const unchangedOld=exactOldFrozenUnchanged(oldFrozen,resumeRecord);const actualResumedRun=resumeRecord.runs.at(-1),actualResumedSession=resumeRecord.frozen.find(s=>s.sessionId===actualResumedRun.capability_session_id);assert(actualResumedSession);const exactNativeResumed=actualResumedSession.nativeIdHash===oldBinding.nativeIdHash&&actualResumedSession.bindingId===oldBinding.bindingId;
 report.resumeBoundary={oldImmutable:unchangedOld,actualResumedRun,actualResumedSession,exactNativeResumed,actualOldSchemaStillUsed:actualResumedSession.browserPackageHash===OLD_HASH&&!resumed.oneOf,activePackage:afterPackages.active};await persist();
 const beforeInvalid=await snapshot(t1),beforeHits=report.requests.filter(r=>r.path==='/A'||r.path==='/B').length;const missing=await actualCall(t1,'C12-resumed-old-missing-target','browser_tab_open_v2',{},'error'),both=await actualCall(t1,'C12-resumed-old-conflicting-target','browser_tab_open_v2',{url:url('B'),pageId},'error');assert.equal(missing.result.errorCode,'INVALID_INPUT');assert.equal(both.result.errorCode,'INVALID_INPUT');assert.deepEqual((await snapshot(t1)).tabs.map(t=>[t.id,t.url,t.profileId]),beforeInvalid.tabs.map(t=>[t.id,t.url,t.profileId]));assert.equal(report.requests.filter(r=>r.path==='/A'||r.path==='/B').length,beforeHits);assert.equal((await nativeState(resumedPage)).page.marker,resumedDoc.page.marker);
 const queried=await actualCall(t1,'C12-resumed-inherited-old-receipt','browser_operation_get_v2',{request:originalRequest});assert(JSON.stringify(queried.result.data).includes(pageId));const correction=await actualCall(t1,'C12-resumed-valid-correction','browser_tab_open_v2',{url:url('B'),intent:'new',presentation:'show'});const correctedPage=await awaitPage(t1,url('B'),correction.result.data.pageId);assert.notEqual(correctedPage.id,pageId);await chooseTab(t1,resumedPage);const retainedA=await nativeState(resumedPage);assert.equal(retainedA.page.marker,resumedDoc.page.marker);report.oldResumedCalls={resumed,resumedPage,resumedDoc,missing,both,queried,correction,correctedPage,retainedA,ledger:frozenEvidence(t1)};exactOldFrozenUnchanged(oldFrozen,report.oldResumedCalls.ledger);await app.screenshot(join(root,'B05-C12-resumed-old-native.png'));await persist();
 t2=await createTask('B05 new current native task');report.fixture.t2=t2;await app.cdp('Page.reload');await switchTask(t2);const newValid=await actualCall(t2,'C12-new-valid','browser_tab_open_v2',{url:url('A'),presentation:'show'});const newPage=await awaitPage(t2,url('A'),newValid.result.data.pageId);assert.notEqual(newPage.id,pageId);const newNative=await nativeState(newPage),newBefore=await snapshot(t2),hits=report.requests.filter(r=>r.path==='/A'||r.path==='/C').length;const newMissing=await actualCall(t2,'C12-new-missing-target','browser_tab_open_v2',{},'error'),newBoth=await actualCall(t2,'C12-new-conflicting-target','browser_tab_open_v2',{url:url('C'),pageId:newPage.id},'error');assert.equal(newMissing.result.errorCode,'INVALID_INPUT');assert.equal(newBoth.result.errorCode,'INVALID_INPUT');assert.deepEqual((await snapshot(t2)).tabs.map(t=>[t.id,t.url,t.profileId]),newBefore.tabs.map(t=>[t.id,t.url,t.profileId]));assert.equal(report.requests.filter(r=>r.path==='/A'||r.path==='/C').length,hits);const newCorrection=await actualCall(t2,'C12-new-valid-correction','browser_tab_open_v2',{url:url('C'),intent:'new',presentation:'show'});const newCorrected=await awaitPage(t2,url('C'),newCorrection.result.data.pageId);assert.notEqual(newCorrected.id,newPage.id);const newLedger=frozenEvidence(t2);assert(taskLedgerHasPackage(newLedger,NEW_HASH));assert(newValid.oneOf||/exactly one|只能|互斥/i.test(newValid.advertised.description??''));report.newSession={newValid,newPage,newNative,newMissing,newBoth,newCorrection,newCorrected,newLedger};await app.screenshot(join(root,'B05-C12-new-current.png'));await persist();
 // Actual provider and old frozen record are independently observed. Do not count
 // retained archival old snapshot as an executed old contract if actual resumed run changed.
 report.checks.push({name:'B05.4-real-old-native-session-upgrade-and-new-schema',status:report.resumeBoundary.exactNativeResumed&&report.resumeBoundary.actualOldSchemaStillUsed?'pass':'partial',evidence:report.resumeBoundary,reason:report.resumeBoundary.actualOldSchemaStillUsed?'actual old frozen run contract used':'old immutable frozen history retained, but currently executing run contract is independently reported; no claim old contract executed'});report.status='actual-workflow-complete-'+(report.checks[0].status==='pass'?'full-B05.4-A':'partial-B05.4-A');await persist();await quitSelected();

 }catch(error){report.status='B05-frozen-workflow-failed';report.error=String(error.stack??error);if(app){try{await app.screenshot(join(root,'failed-ui.png'));}catch{}try{await app.waitFor('Boolean(document.body)',5000);report.visibleText=(await app.evaluate('document.body.innerText')).slice(0,2200);}catch{}}}
finally{
 scenario?.continuation?.finish();for(const {resolve} of gate.values())resolve();gate.clear();
 if(app){try{for(const id of [t1,t2].filter(Boolean)){const state=await agentSnapshot(id);if(state.turns.some(turn=>['dispatching','started','queued','accepted'].includes(turn.status)))await app.invoke('agentTasks.stop',id,true);}await quitSelected();}catch(e){report.cleanupError=String(e.message);if(app){await app.close();app=null;}}}
 server.closeAllConnections();await new Promise(ok=>server.close(ok));report.finishedAt=new Date().toISOString();report.noGateMovement=true;await persist();console.log(JSON.stringify({root,status:report.status,checks:report.checks.map(c=>c.name+':'+c.status),error:report.error}));if(report.status.endsWith('failed')||report.cleanupError)process.exitCode=1;
}
