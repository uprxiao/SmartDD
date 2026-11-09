// Private adaptation of the source025 M9 file-acceptance driver. No business RPC replaces accepted UI.
import assert from 'node:assert/strict';
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {openElectron,pause} from './lib/electron-harness.mjs';
import {installAppFocusGuard} from './lib/app-focus-guard.mjs';
import {waitPassiveInitialFocus} from './lib/initial-focus.mjs';
import {waitStableGeometry} from './lib/geometry.mjs';
export const ROOT='/private/tmp/willyou-m12-t130-app021-tabs-001';
export function selectorExpression(selector,text,index=0){return `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>${text===undefined?'true':`e.textContent.trim()===${JSON.stringify(text)}`})[${index}];if(!e)return{available:false,reason:'missing'};e.scrollIntoView({behavior:'instant',block:'nearest',inline:'nearest'});const b=e.getBoundingClientRect();let left=Math.max(0,b.left),right=Math.min(innerWidth,b.right),top=Math.max(0,b.top),bottom=Math.min(innerHeight,b.bottom);for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),r=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(s.overflowX)){left=Math.max(left,r.left+p.clientLeft);right=Math.min(right,r.left+p.clientLeft+p.clientWidth)}if(/auto|scroll|hidden|clip/.test(s.overflowY)){top=Math.max(top,r.top+p.clientTop);bottom=Math.min(bottom,r.top+p.clientTop+p.clientHeight)}}const x=(left+right)/2,y=(top+bottom)/2;let activeAnimations=0;for(let a=e;a&&a!==document.body;a=a.parentElement)activeAnimations+=a.getAnimations({subtree:false}).filter(v=>v.playState==='running'||v.playState==='pending').length;return{available:right>left&&bottom>top&&!e.matches(':disabled')&&e.contains(document.elementFromPoint(x,y)),activeAnimations,x,y}})()`;}
export function ownExpression({pid,executable,userData},code){return `(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),fs=process.getBuiltinModule('fs');if(process.pid!==${pid}||fs.realpathSync(process.execPath)!==fs.realpathSync(${JSON.stringify(executable)})||fs.realpathSync(E.app.getPath('userData'))!==fs.realpathSync(${JSON.stringify(userData)}))throw Error('Exact private App identity required');${code}})()`;}
export function lifecycleCode(path){return `const fs=process.getBuiltinModule('fs'),p=${JSON.stringify(path)};for(const event of ['before-quit','will-quit','quit'])E.app.on(event,(...args)=>fs.appendFileSync(p,JSON.stringify({event,pid:process.pid,atMs:Date.now(),exitCode:event==='quit'?args[1]:null})+String.fromCharCode(10),{mode:0o600}));process.once('exit',code=>fs.appendFileSync(p,JSON.stringify({event:'process-exit',pid:process.pid,atMs:Date.now(),code})+String.fromCharCode(10),{mode:0o600}));return true`;};
export async function openFileAcceptanceApp({executable,projectPath,userData,name,prepare,record:r}){
 assert(r&&r.scratch===ROOT+'/runtime-001');assert.equal(userData,r.scratch+'/userdata');
 const app=await openElectron({executable,userData,cwd:r.scratch,inspectMain:true,env:{HOME:r.scratch+'/home',ZDOTDIR:r.scratch+'/home',CODEX_HOME:r.scratch+'/codex',TMPDIR:r.scratch+'/tmp',PATH:'/usr/bin:/bin:/usr/sbin:/sbin',WILLYOU_TEST_CACHE_DIR:ROOT+'/cache',NODE_COMPILE_CACHE:ROOT+'/cache/node'}});
 const lowClose=app.close.bind(app),scope={pid:app.processId,executable,userData};r.appPid=app.processId;r.actions=[];r.geometryWaits=[];r.resources=[];r.knownPids=[app.processId];r.knownPorts=[];r.exactSockets=[];r.cleanupEvents=[];
 const persist=()=>writeFile(ROOT+'/live.json',JSON.stringify({...r,liveAt:new Date().toISOString()},null,2)+'\n');
 const own=async(code)=>{const expression=ownExpression(scope,code);new Function(expression);return app.mainEvaluate(expression,{label:'T130-exact-private-App-read'});};
 const collect=async(label)=>{
  const lines=execFileSync('/bin/ps',['-axo','pid=,ppid=,comm='],{encoding:'utf8'}).split('\n');const rows=lines.map(line=>{const m=line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);return m?{pid:+m[1],ppid:+m[2],comm:m[3]}:null}).filter(Boolean),ids=new Set([app.processId]);let more=true;while(more){more=false;for(const row of rows)if(ids.has(row.ppid)&&!ids.has(row.pid)){ids.add(row.pid);more=true;}}
  for(const id of ids)if(!r.knownPids.includes(id))r.knownPids.push(id);
  let listeners='';try{listeners=execFileSync('/usr/sbin/lsof',['-nP','-a','-p',[...ids].join(','),'-iTCP','-sTCP:LISTEN'],{encoding:'utf8'})}catch(error){if(error.status!==1)throw error;listeners=String(error.stdout??'');}
  for(const line of listeners.split('\n')){const m=line.match(/:(\d+) \(LISTEN\)$/);if(m&&!r.knownPorts.includes(+m[1]))r.knownPorts.push(+m[1]);}
  const native=await own('return{metrics:E.app.getAppMetrics().map(m=>({pid:m.pid,type:m.type})),addresses:process._getActiveHandles().filter(h=>h?.constructor?.name==="Server"&&typeof h.address==="function").map(h=>h.address()).filter(Boolean)}');
  for(const m of native.metrics)if(!r.knownPids.includes(m.pid))r.knownPids.push(m.pid);
  for(const address of native.addresses){if(typeof address==='string'&&!r.exactSockets.includes(address))r.exactSockets.push(address);if(typeof address==='object'&&Number.isInteger(address.port)&&!r.knownPorts.includes(address.port))r.knownPorts.push(address.port);}
  r.resources.push({label,atMs:Date.now(),processes:rows.filter(x=>ids.has(x.pid)),listeners,native});await persist();
 };
 let closed=false;
 app.close=async()=>{
  if(closed)return;closed=true;
  try{
   await collect('before-normal-quit');r.quitRequestedAtMs=Date.now();await own('setTimeout(()=>E.app.quit(),30);return true');
   try{r.normalExit=await app.waitForExit(20000)}catch(error){r.quit20s={atMs:Date.now(),error:String(error)};await persist();r.normalExit=await app.waitForExit(25000);}
   assert.equal(r.normalExit.code,0);assert.equal(r.normalExit.signal,null);
  }catch(error){r.cleanupEvents.push({kind:'normal-quit-failed',error:String(error),atMs:Date.now()});throw error;}
  finally{
   await writeFile(ROOT+'/electron.log',app.logs());await lowClose();
   try{await app.waitForExit(5000)}catch(error){r.cleanupEvents.push({kind:'final-exit-unresolved',error:String(error),atMs:Date.now()});}
   r.harnessProcessReceipt=app.observedProcess();
   try{r.lifecycle=(await readFile(ROOT+'/lifecycle.jsonl','utf8')).split('\n').filter(Boolean).map(JSON.parse)}catch(error){r.cleanupEvents.push({kind:'lifecycle-read-failed',error:String(error)});}
   await persist();
  }
 };
 try{
  r.ownIdentity=await own('return{pid:process.pid,exe:process.execPath,userData:E.app.getPath("userData"),ready:E.app.isReady()}');assert(r.ownIdentity.ready);
  await own(lifecycleCode(ROOT+'/lifecycle.jsonl'));
  const project=await app.invoke('projects.create',{name,aliases:[],description:'Isolated T130 source025 regression; synthetic files only',rulesPath:null},[{label:'Synthetic file tabs',path:projectPath}]);r.projectId=project.id;
  if(prepare)await prepare({app,project});
  const oldOrigin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${oldOrigin}&&document.readyState==='complete'&&!!document.querySelector(${JSON.stringify('[data-project-id="'+project.id+'"]')})`,20000,{navigation:true});r.setupReload={before:oldOrigin,after:await app.evaluate('performance.timeOrigin'),atMs:Date.now()};
  await own('const ws=E.BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()&&w.webContents.getURL().startsWith("file:"));if(ws.length!==1)throw Error("Unique private file window required");ws[0].setTitle("[A] T130 App021 file tabs");return true');
  r.initialFocus={status:'awaiting-native-dom-stable',appPid:app.processId,userData,executable,title:'[A] T130 App021 file tabs'};
  console.log(JSON.stringify({stage:'awaiting-user-initial-focus',root:ROOT,appPid:app.processId,driverPid:process.pid,userData,title:r.initialFocus.title}));await collect('setup-before-focus');
  await waitPassiveInitialFocus({record:r.initialFocus,read:async()=>{const dom=await app.evaluate('({focused:document.hasFocus(),visibility:document.visibilityState})'),native=await own('const ws=E.BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()&&w.webContents.getURL().startsWith("file:"));return{native:ws.length===1&&ws[0].isFocused()&&ws[0].isVisible(),windowId:ws[0]?.id,pid:process.pid,userData:E.app.getPath("userData"),executable:process.execPath}');return{...dom,...native};}});
  assert(!app.checkInputFocus);installAppFocusGuard(app,r,{allowOwnedViews:false});r.guardInstalledAtMs=Date.now();await persist();
  const exists=selector=>`Boolean(document.querySelector(${JSON.stringify(selector)}))`;
  const key=async(key,code,modifiers=0)=>{const virtual={Enter:13,Space:32,Tab:9,Escape:27}[code]??(/^Key[A-Z]$/.test(code)?code.charCodeAt(3):undefined),text=code==='Enter'?'\r':code==='Space'?' ':undefined;for(const type of['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,modifiers,...(virtual?{windowsVirtualKeyCode:virtual}:{}),...(text?{text,unmodifiedText:text}:{})});r.actions.push({kind:'key',key,code,modifiers,atMs:Date.now()});};
  const click=async(selector,text,index=0)=>{
   await app.checkInputFocus('T130-click');await app.evaluate('document.fonts.ready.then(()=>true)');const expression=selectorExpression(selector,text,index);new Function(expression);const row={selector,text,index,startedAtMs:Date.now(),samples:[]};r.geometryWaits.push(row);
   const read=()=>app.evaluate(expression),frame=()=>app.evaluate('new Promise(r=>requestAnimationFrame(r))');const point=await waitStableGeometry({read,frame,focus:()=>app.checkInputFocus('T130-stable-geometry'),samples:row.samples});await frame();const final=await read();assert(final.available&&final.activeAnimations===0);assert.deepEqual({x:final.x,y:final.y},point);
   for(const type of['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});r.actions.push({kind:'click',selector,text,index,point,atMs:Date.now()});await persist();
  };
  const tree=relative=>`[role="treeitem"]:is([data-file-path=${JSON.stringify(join(projectPath,relative))}],[title=${JSON.stringify(join(projectPath,relative))}])`;
  await click(`[data-project-id="${project.id}"] [data-testid=sidebar-project-more]`);await click('[data-testid=sidebar-project-edit]');await app.waitFor(exists('[data-testid=project-files]'));if(!await app.evaluate("document.querySelector('[data-testid=project-files]')?.getAttribute('aria-pressed')==='true'"))await click('[data-testid=project-files]');
  await collect('file-workspace-ready');Object.assign(app,{exists,key,click,tree,project});return app;
 }catch(error){await app.close().catch(closeError=>r.cleanupEvents.push({kind:'setup-cleanup-failed',error:String(closeError)}));throw error;}
}
