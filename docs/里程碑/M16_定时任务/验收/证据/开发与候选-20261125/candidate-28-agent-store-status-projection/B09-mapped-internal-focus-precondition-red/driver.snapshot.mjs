// M16 B09.2 B11-access-observe/control, mapped (user-confirmed) to the real M14 request card.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,realpath,writeFile,cp,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {openElectron,pause} from '../isolated-electron.mjs';
import {repo,support,specs,expectedArgs,digest,verifyPins,verifySideRoot,fullscreenVerdict} from '../guards.mjs';
import {focusPlan,geometryVerdict,recognizedFocused1440} from './geometry-contract.mjs';
import {startFixture,model,uuid,modes,routes,targetTitle,choices,modeNotes} from './model-fixture.mjs';
import {verifyNativeRunner,originalKeys} from './pins.mjs';
assert(process.cwd()===repo&&process.arch==='arm64'&&process.platform==='darwin');
assert(process.argv[2]==='--coordinator-authorized-b09-mapped-approval-1440-internal');
const pins=await verifyPins(process.argv.slice(3,10));
const cli=await verifyNativeRunner(process.argv.slice(10,12));
assert.equal(process.argv.slice(12).length,0,'Internal 1440 only; no fullscreen flag');
const nativeAFullscreen=false,nextSupport=join(support,'next-13'),mapped=join(support,'mapped-approvals-1440-internal');
assert.equal(await digest(join(nextSupport,'front-observer')),'8acf91ddb68478d69abaf14121ee42a5c29f7cf60ee317dfa6425c251a8f6b7f');
const root=await mkdtemp('/private/tmp/willyou-m16-b09-c28-mapped-approval-pair-');
let home,cliHome,userData,sideRoot,app,executable,stage='setup',fixtureProfileId=null,ownWindowTitle=null,rootIdentity=null,fullscreenDisplay=null,currentSize=null;
const useSide=async side=>{assert(['old-clean','new'].includes(side));const own=await mkdtemp('/private/tmp/willyou-m16-b09-c28-side-');sideRoot=own;home=join(own,'home');cliHome=join(own,'cli-home');userData=join(own,'data');for(const dir of [home,cliHome,userData,join(home,'.config'),join(cliHome,'.codex'),join(cliHome,'.claude'),join(own,'tmp')])await mkdir(dir,{recursive:true,mode:0o700});await verifySideRoot(own);return {side,own,home,cliHome,userData,initialDataEmpty:true};};
const report={schema:'M16-B09.2-M14-mapped-pending-browser-access-pair-A',root,pins,cli,mockKeychainFixture:true,actions:[],launches:[],sides:[],captures:[],originalRows:[],nativeAFullscreen,scope:'Original B11-observe/control, 8 original 1440-only theme/width/state keys, 16 old/new DPR2 actual sides; no 1920 or S. Genuine ordinary native runner requests, no grants, all exact owned local tasks and pages, UI denial after captures; no external resources or system/S claim.'};
const persist=()=>writeFile(join(root,'B09-mapped-approval-pair-result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
const progress=async x=>{await writeFile(join(root,'progress.json'),JSON.stringify(x,null,2)+'\n',{mode:0o600});await persist();console.log(JSON.stringify(x));};
for(const file of ['driver.mjs','model-fixture.mjs','pins.mjs','geometry-contract.mjs','callback-contract.mjs']){await cp(join(mapped,file),join(root,file.replace('.mjs','.snapshot.mjs')));}
report.driverSha=await digest(join(mapped,'driver.mjs'));report.modelFixtureSha=await digest(join(mapped,'model-fixture.mjs'));report.harnessSha=await digest(join(support,'isolated-electron.mjs'));report.frontObserverSha=await digest(join(nextSupport,'front-observer'));
await progress({stage:'starting',root});
const envAllow=new Set(['PATH','LANG','LC_ALL','USER','LOGNAME','SHELL']);for(const n of Object.keys(process.env))if(!envAllow.has(n))delete process.env[n];
const fixture=await startFixture(),origin=fixture.origin;report.fixture={origin,trace:fixture.trace,http:fixture.http,failures:fixture.failures};const targetUrl=origin+routes.target;
const js=(fn,...args)=>{const expr='('+fn.toString()+')(...'+JSON.stringify(args)+')';new Function('return '+expr);return expr;};
async function until(fn,label,ms=12000){const limit=Date.now()+ms;let last;while(Date.now()<limit){last=await fn();if(last)return last;await pause(60);}throw Error('Timeout: '+label+' last='+JSON.stringify(last));}
const snapshot=id=>app.invoke('browser.snapshot',{taskId:id});
const agentSnapshot=id=>app.invoke('agentTasks.snapshot',id);
const sidebar=id=>'[data-testid="sidebar-agent-task"][data-task-id="'+id+'"]';
const shellGuard=(fn,...args)=>js((pid,exe,data,homePath,source,args)=>{
 const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');
 if(process.pid!==pid||process.execPath!==exe||E.app.getPath('userData')!==data||process.env.HOME!==homePath||!E.app.commandLine.hasSwitch('use-mock-keychain'))throw Error('isolated candidate identity mismatch');
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

async function runApp(bundle,expected,label,nativePin){
 assert(!app);assert.equal(await digest(join(bundle,'Contents/Resources/app.asar')),expected);executable=join(bundle,'Contents/MacOS/WillYou');stage=label;
 app=await openElectron({userData,executable,cwd:sideRoot,env:{HOME:home,TMPDIR:join(sideRoot,'tmp'),SMARTDD_CLI_HOME:cliHome,CODEX_HOME:join(cliHome,'.codex'),CLAUDE_CONFIG_DIR:join(cliHome,'.claude'),XDG_CONFIG_HOME:join(home,'.config'),HTTP_PROXY:origin,HTTPS_PROXY:origin,ALL_PROXY:origin,NO_PROXY:'127.0.0.1,localhost',http_proxy:origin,https_proxy:origin,all_proxy:origin,no_proxy:'127.0.0.1,localhost'},inspectMain:true,mockKeychainFixture:true,candidatePin:expected,nativePin});
 const pid=await bind();const commandLine=await observeMain(E=>({mockSwitch:E.app.commandLine.hasSwitch("use-mock-keychain"),occurrences:process.argv.filter(x=>x==="--use-mock-keychain").length,cliHome:process.env.SMARTDD_CLI_HOME}));assert(commandLine.mockSwitch&&commandLine.occurrences===1&&commandLine.cliHome===cliHome);await until(async()=>{const actual=await windows();return actual.some(w=>w.visible&&!w.minimized&&w.children.some(c=>/\/out\/renderer\/index\.html/.test(c.url)))},'actual isolated visible trusted shell',15000);report.launches.push({label,pid,bundle,expected,nativePin,commandLine,userData,home,cliHome,exeSha:await digest(executable),startup:app.startupObservation,at:Date.now()});await persist();return pid;
}
async function quit(){const live=app;assert(live);let quitRequestError;try{await observeMain(E=>{setTimeout(()=>E.app.quit(),50);return true});}catch(e){quitRequestError=String(e);}try{const exit=await live.waitForExit(20000);if(quitRequestError)report.launches.at(-1).quitRequestError=quitRequestError;report.launches.at(-1).exit=exit;assert.equal(exit.code,0);assert.equal(exit.signal,null);const finalCounts=JSON.parse(execFileSync('python3',['-c','import sqlite3,json,sys\nc=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro&immutable=1",uri=True)\nprint(json.dumps({"secretCount":c.execute("select count(*) from app_secrets").fetchone()[0],"providerSecretCount":c.execute("select count(*) from ai_providers where secret_ref is not null").fetchone()[0]}))',join(userData,'smartdd.db')],{encoding:'utf8'}));report.launches.at(-1).finalCounts=finalCounts;assert.deepEqual(finalCounts,{secretCount:0,providerSecretCount:0});}catch(error){report.launches.at(-1).quitError=String(error.message);await live.close();throw error;}finally{await live.close();app=null;await persist();}}


async function actualGeometry(){return app.evaluate(`(()=>{const p=document.querySelector('${panelSelector}'),s=document.querySelector('[role=separator][aria-label="调整文件区域宽度"]'),v=document.querySelector('[data-testid=browser-viewport]'),a=document.querySelector('[aria-label="网页地址"]');const r=e=>e?{x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}:null;return {theme:document.documentElement.classList.contains('ydark')?'dark':'light',inner:[innerWidth,innerHeight],dpr:devicePixelRatio,panel:r(p),viewport:r(v),address:r(a),separator:s?{value:Number(s.getAttribute('aria-valuenow')),min:Number(s.getAttribute('aria-valuemin')),max:Number(s.getAttribute('aria-valuemax')),rect:r(s)}:null,fonts:document.fonts.status}})()`);}
async function nativeFullscreen(){return observeMain(E=>{
 const roots=E.BaseWindow.getAllWindows().filter(w=>!w.isDestroyed()).map(w=>({w,shells:[...new Map([w.webContents,...w.contentView.children.map(v=>v.webContents)].filter(v=>v&&!v.isDestroyed()&&v.getURL().startsWith('file:')&&v.getURL().includes('/out/renderer/index.html')).map(v=>[v.id,v])).values()]})).filter(x=>x.shells.length);
 if(roots.length!==1||roots[0].shells.length!==1)throw Error('Unique original trusted root/shell required');const {w,shells}=roots[0],c=shells[0],b=w.getBounds(),d=E.screen.getDisplayMatching(b),native={rootId:w.id,windowTitle:w.getTitle(),shellId:c.id,visible:w.isVisible(),minimized:w.isMinimized(),focused:w.isFocused(),fullScreen:w.isFullScreen(),bounds:b,contentBounds:w.getContentBounds(),displays:E.screen.getAllDisplays().map(x=>({id:x.id,bounds:x.bounds,workArea:x.workArea,scaleFactor:x.scaleFactor})),actualDisplay:{id:d.id,bounds:d.bounds,workArea:d.workArea,scaleFactor:d.scaleFactor},shellZoomFactor:c.getZoomFactor()};return native;
 });}
async function setOwnTitle(side){const current=await nativeFullscreen();rootIdentity={rootId:current.rootId,shellId:current.shellId};ownWindowTitle='WillYou · M16 B09 1440内屏统一网页审批 '+(side==='old-clean'?'旧版':'C28')+' '+root.split('-').at(-1);const actual=await observeMain((E,id,shellId,title)=>{const w=E.BaseWindow.fromId(id);if(!w||w.isDestroyed()||!(w.webContents?.id===shellId||w.contentView.children.some(v=>v.webContents?.id===shellId)))throw Error('Exact original test window required');w.setTitle(title);return w.getTitle();},rootIdentity.rootId,rootIdentity.shellId,ownWindowTitle);assert.equal(actual,ownWindowTitle);}
async function actualTheme(sideId,name){const cls=name==='dark'?'ydark':'ylight';if(await app.evaluate(js(c=>document.documentElement.classList.contains(c),cls)))return;await shellClick('[data-testid="nav-settings"]');await shellClick('button,a','外观');await shellClick('[aria-label="主题"]');await shellClick('[role="option"]',name==='dark'?'深色':'浅色');await app.waitFor(js(c=>document.documentElement.classList.contains(c),cls),10000);await shellClick('[data-testid="nav-home"]');const present=await app.evaluate(js(s=>!!document.querySelector(s),sidebar(sideId)));if(!present&&await app.evaluate('!!document.querySelector("button[title=\\"显示/隐藏侧边栏\\"]")'))await shellClick('button[title="显示/隐藏侧边栏"]');await switchTask(sideId);await openPanel();}

const keyboard=async(name,code,vk,modifiers=0)=>{for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:name,code,windowsVirtualKeyCode:vk,modifiers});};
async function actualKeyboardWidth(width){
 const selector='[role=separator][aria-label="调整文件区域宽度"]',address='[aria-label="网页地址"]';
 // The browser and directory-only panels use separate width preferences. Wait
 // for the actual browser geometry, not a width pre-set on the directory panel.
 let signature=null,since=0;const stable=async()=>{const q=await actualGeometry();if(!q.panel||!q.separator||!q.address||!q.viewport||q.fonts!=='loaded'){signature=null;return null;}const sig=JSON.stringify([q.panel,q.separator,q.address,q.viewport]);if(sig!==signature){signature=sig;since=Date.now();return null;}return Date.now()-since>=120?q:null;};
 let g=await until(stable,'actual stable browser pane before width input',5000);
 if(g.separator.max<width){await shellClick('button[title="显示/隐藏侧边栏"]');signature=null;g=await until(async()=>{const a=await stable();return a&&a.separator.max>=width?a:null;},'actual available browser right width after sidebar toggle',5000);}
 assert(width>=g.separator.min&&width<=g.separator.max,'requested original browser width unavailable');if(Math.abs(g.panel.width-width)<=1)return g;
 const read=()=>app.evaluate(js((s,p,a)=>{const se=[...document.querySelectorAll(s)],pa=[...document.querySelectorAll(p)],ad=[...document.querySelectorAll(a)];if(se.length!==1||pa.length!==1||ad.length!==1)return null;const e=se[0],v=pa[0],input=ad[0],active=document.activeElement,wr=v.getBoundingClientRect(),r=e.getBoundingClientRect();const f=[...document.querySelectorAll('*')].indexOf(active);return {width:wr.width,min:Number(e.getAttribute('aria-valuemin')),max:Number(e.getAttribute('aria-valuemax')),focused:active===e,addressFocused:active===input,docFocus:document.hasFocus(),addressValue:input.value,activeIndex:f,active:{tag:active?.tagName,role:active?.getAttribute('role'),label:active?.getAttribute('aria-label'),title:active?.getAttribute('title'),inPanel:!!active&&v.contains(active),tabIndex:active?.tabIndex},separatorRect:{x:r.x,y:r.y,width:r.width,height:r.height}};},selector,panelSelector,address));
 const before=await read(),ev={stage,requested:width,priorActualRect:g.separator.rect,before,focusPath:[],mode:'actual nearby address anchor + reverse Tab, no DOM.focus or arbitrary global Tab traversal'};report.widthFocusEvidence??=[];report.widthFocusEvidence.push(ev);await persist();
 try{
  assert.equal(focusPlan({browserAddress:!!g.address,browserViewport:!!g.viewport,actualSeparator:!!g.separator,existingBrowserWidth:g.panel.width,target:width,min:g.separator.min,max:g.separator.max}),'browser-address-reverse-tab');
  if(!before?.focused){
   // Pointer down on the real separator deliberately preventDefault()s; use
   // the actual shell address control as the adjacent ordinary keyboard anchor.
   await shellClick(address);let q=await until(async()=>{const x=await read();return x?.addressFocused&&x.docFocus?x:null;},'actual address input owns keyboard focus',3000);ev.focusPath.push({kind:'real-address-anchor',...q});await persist();
   assert.equal(q.addressValue,before.addressValue);
   for(let i=0;i<40&&!q.focused;i++){
    const prev=q;assert(prev.docFocus&&prev.activeIndex>=0,'Actual shell keyboard focus lost before reverse Tab');
    await keyboard('Tab','Tab',9,8);q=await until(async()=>{const x=await read();return x?.docFocus&&(x.focused||x.activeIndex!==prev.activeIndex)?x:null;},'actual focus transition for reverse Tab '+(i+1),2000);
    ev.focusPath.push({kind:'real-Shift-Tab',step:i+1,...q});await persist();
    assert.equal(q.addressValue,before.addressValue,'Address anchor traversal must not alter document URL');
    if(!q.focused&&!q.active.inPanel&&q.active.tag==='BODY')throw Error('Actual address anchor focus escaped shell without reaching separator');
   }
  }
  const first=await read();assert(first?.focused&&first.docFocus,'Actual real separator must own keyboard focus before any width key');ev.anchorReached=first;await persist();
  const apply=async(direction)=>{const current=await read();assert(current?.focused&&current.docFocus);const expected=direction==='ArrowRight'?Math.max(current.min,current.width-10):Math.min(current.max,current.width+10);await keyboard(direction,direction,direction==='ArrowRight'?39:37);return until(async()=>{const q=await read();return q?.focused&&q.docFocus&&Math.abs(q.width-expected)<=1?q:null;},'actual keyboard panel step '+direction,1800);};
  let cur=first;for(let i=0;i<100&&cur.width>cur.min+1;i++)cur=await apply('ArrowRight');assert(Math.abs(cur.width-cur.min)<=1);assert(Math.abs((width-cur.min)/10-Math.round((width-cur.min)/10))<.01);for(let i=0;i<Math.round((width-cur.min)/10);i++)cur=await apply('ArrowLeft');assert(Math.abs(cur.width-width)<=1);const actual=await actualGeometry();assert(Math.abs(actual.panel.width-width)<=1);ev.result=cur;report.actions.push({stage,kind:'real-keyboard-panel-width',requested:width,before:first,after:cur,at:Date.now(),anchor:'actual address + reverse Tab'});await persist();return actual;
 }catch(e){ev.error=String(e);ev.finalFocus=await read().catch(()=>null);await persist();throw e;}
}

const panelSelector='[data-testid="agent-workspace-panel"]';
const safeConfig='check_for_update_on_startup = false\ncli_auth_credentials_store = "file"\n[analytics]\nenabled = false\n';
const composer='.agent-composer textarea';
let currentSide=null,projectInfo=null,owned=null;
async function ownDb(sql,args=[]){
 const db=join(userData,'smartdd.db');assert.equal(await realpath(db),db);assert(db.startsWith(sideRoot+'/data/'));
 return JSON.parse(execFileSync('python3',['-c',`import sqlite3,json,sys
c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True)
c.row_factory=sqlite3.Row
print(json.dumps([dict(r) for r in c.execute(sys.argv[2],json.loads(sys.argv[3]))]))`,db,sql,JSON.stringify(args)],{encoding:'utf8'}));
}
async function binding(task){
 const rows=await ownDb('select binding_id,task_id,driver_id,profile_id,state_root,cwd_identity,native_id,native_confirmed_at from agent_bindings where task_id=? and native_id is not null order by created_at,rowid',[task]);
 assert(rows.length);const b=rows.at(-1);assert(b.native_confirmed_at&&b.native_id&&b.profile_id===fixtureProfileId&&b.task_id===task);assert.equal(b.cwd_identity,projectInfo.dir.path);assert(typeof b.state_root==='string'&&(b.state_root.startsWith(userData+'/')||b.state_root.startsWith(cliHome+'/')),'Native binding state root not private');return b;
}
async function assertOwnTask(task,title){
 const rows=await ownDb('select id,project_id,dir_id,cwd,title from tasks where id=?',[task]);assert.equal(rows.length,1);const row=rows[0];assert.equal(row.project_id,projectInfo.id);assert.equal(row.dir_id,projectInfo.dir.id);assert.equal(row.cwd,projectInfo.dir.path);assert.equal(row.title,title);return row;
}
async function switchTask(id){
 assert(uuid.test(id));const selector=sidebar(id);const visible=()=>app.evaluate(js(s=>{const e=document.querySelector(s),r=e?.getBoundingClientRect();return !!r?.width&&!!r.height;},selector));
 if(!await visible()&&await app.evaluate('!!document.querySelector("button[title=\\"显示/隐藏侧边栏\\"]")'))await shellClick('button[title="显示/隐藏侧边栏"]');
 await until(visible,'visible exact private task sidebar',18000);await shellClick(selector);await app.waitFor('!!document.querySelector(".agent-composer textarea")',10000);
}
async function frontObserver(fn){
 const samples=[],observer=spawn(join(nextSupport,'front-observer'),[String(app.processId),executable],{stdio:['ignore','pipe','pipe']});let err=null,partial='';
 observer.stdout.on('data',buf=>{partial+=buf.toString();let i;while((i=partial.indexOf('\n'))>=0){const line=partial.slice(0,i);partial=partial.slice(i+1);try{const x=JSON.parse(line);if(!Number.isFinite(x.at)||!['own','other'].includes(x.front)||(x.front==='own'&&x.pid!==app.processId))throw Error('invalid foreground sample');samples.push(x);}catch(e){err=String(e);}}});observer.on('error',e=>{err=String(e);});
 const stable=()=>{if(err||observer.exitCode!==null)throw Error(err??'Foreground probe stopped');const last=samples.at(-1);if(!last||last.front!=='own'||Date.now()-last.at>350)return null;let k=samples.length-1;while(k>0&&samples[k-1].front==='own'&&samples[k].at-samples[k-1].at<=400)k--;return last.at-samples[k].at>=3000?{from:samples[k].at,to:last.at,count:samples.length-k}:null;};
 try{return await fn(stable,samples);}finally{if(observer.exitCode===null&&observer.signalCode===null){const closed=new Promise(r=>observer.once('close',r));observer.kill('SIGTERM');await Promise.race([closed,pause(1000)]);}}
}
async function geometryFor(size){
 const n=await nativeFullscreen(),g=await actualGeometry();assert.equal(n.rootId,rootIdentity.rootId);assert.equal(n.shellId,rootIdentity.shellId);assert.equal(n.windowTitle,ownWindowTitle);
 return {native:n,actual:g,exact:geometryVerdict(n,g,size,fullscreenDisplay??report.displayId)};
}
async function prepare1440(side){
 const first=await geometryFor([1440,900]),eligible=first.native.displays.filter(d=>d.bounds.width===1512&&d.bounds.height===982&&d.scaleFactor===2&&d.workArea.width>=1440&&d.workArea.height>=900);assert(eligible.length,'Actual internal 1512x982 DPR2 display with 1440x900 workArea required');
 const locked=report.displayId??null;if(locked)assert(eligible.some(d=>d.id===locked),'Previously verified actual internal display disappeared');
 const commit=async(q,mode,extra={})=>{assert(recognizedFocused1440(q,locked),'Exact actual focused internal ordinary window required');const actualId=q.native.actualDisplay.id;assert(!report.displayId||report.displayId===actualId);report.displayId=actualId;fullscreenDisplay=actualId;const result={exact:true,first,ready:q,operatorMode:mode,...extra,displayId:actualId};await progress({stage:'actual-mapped-1440-observed',side,root,pid:app.processId,windowTitle:ownWindowTitle,displayId:actualId,mode});return result;};
 if(recognizedFocused1440(first,locked))return commit(first,'existing exact focused native window; read-only recognition',{nativeInput:false});
 return frontObserver(async(stable,frontSamples)=>{
  let stableReady=null;const observe=async()=>{const q=await geometryFor([1440,900]);if(recognizedFocused1440(q,locked)){const sig=JSON.stringify([q.native.rootId,q.native.actualDisplay.id,q.native.bounds,q.native.contentBounds,q.actual.inner]);if(stableReady?.sig!==sig){stableReady={sig,at:Date.now()};return null;}if(Date.now()-stableReady.at>=250)return {kind:'already-exact',q};return null;}stableReady=null;const guard=stable();return guard?{kind:'native-input-ready',guard}:null;};
  let choice;try{choice=await until(observe,'actual exact 1440 recognition or natural foreground 3s',8000);}catch{
   await progress({stage:'await-user-focus-mapped-1440',side,root,pid:app.processId,windowTitle:ownWindowTitle,rootIdentity,lockedDisplay:locked,eligibleDisplays:eligible,instruction:'仅操作此准确测试窗：若已使用系统窗口菜单/边缘调整到内屏真实1440×900且前台，驱动只读识别；否则仅保持此窗真实前台3秒，驱动正常原生窗口API设置精确尺寸。不调整日常窗或系统显示设置。',deadline:Date.now()+360000});
   choice=await until(observe,'exact focused manual geometry or user returned exact own foreground 3s',360000);
  }
  if(choice.kind==='already-exact')return commit(choice.q,'actual manually/CUA prepared geometry recognized; read-only',{nativeInput:false,frontSamples});
  const latest=await geometryFor([1440,900]);if(recognizedFocused1440(latest,locked))return commit(latest,'exact geometry appeared before native input; read-only',{nativeInput:false,frontSamples});
  const before=latest.native;assert(before.focused&&before.visible&&!before.minimized&&!before.fullScreen);const guard=stable();assert(guard,'Actual independent AppKit front insufficient for native input');const target=locked?eligible.find(d=>d.id===locked):eligible.find(d=>d.id===before.actualDisplay.id)??eligible[0];
  const sent=Date.now(),receipt=await observeMain((E,id,shellId,title,target)=>{const w=E.BaseWindow.fromId(id);if(!w||w.isDestroyed()||!w.isFocused()||w.isFullScreen()||w.getTitle()!==title||!(w.webContents?.id===shellId||w.contentView.children.some(v=>v.webContents?.id===shellId)))throw Error('Original owned focused root required');const d=E.screen.getAllDisplays().find(x=>x.id===target.id);if(!d||d.scaleFactor!==2||d.bounds.width!==1512||d.bounds.height!==982||d.workArea.width<1440||d.workArea.height<900)throw Error('actual display changed');const r=d.workArea;w.setBounds({x:r.x+Math.floor((r.width-1440)/2),y:r.y+Math.floor((r.height-900)/2),width:1440,height:900});return {nativeBounds:w.getBounds(),content:w.getContentBounds(),display:E.screen.getDisplayMatching(w.getBounds()).id};},rootIdentity.rootId,rootIdentity.shellId,ownWindowTitle,target);
  const ready=await until(async()=>{if(frontSamples.some(x=>x.at>=sent&&x.front!=='own'))throw Error('Actual AppKit foreground lost after native resize');const q=await geometryFor([1440,900]);if(!q.native.focused)throw Error('Original window lost focus after resize');return recognizedFocused1440(q,target.id)?q:null;},'actual 1440x900 native content on exact external DPR1',10000);
  return commit(ready,'native A geometry only, no physical S credit',{nativeInput:true,guard,before,receipt,frontSamples});
 });
}
async function requireGeometry(){const q=await geometryFor(currentSize);assert(q.exact&&q.native.actualDisplay.id===report.displayId,'Original actual size/display/zoom lost; do not substitute');return q;}
async function setFocusEmulation(enabled){const before=(await nativeFullscreen()).focused;await app.cdp('Emulation.setFocusEmulationEnabled',{enabled});const after=(await nativeFullscreen()).focused;assert(!(!before&&after),'Page focus emulation unexpectedly affected native focus');report.actions.push({stage,kind:'page-only-focus-emulation',enabled,nativeBefore:before,nativeAfter:after,at:Date.now()});}
async function captureShell(label){const before=await requireGeometry(),file=join(root,label+'-shell.png');await app.screenshot(file);const raw=await readFile(file);assert.equal(raw.subarray(1,4).toString(),'PNG');const size=[raw.readUInt32BE(16),raw.readUInt32BE(20)];assert.deepEqual(size,currentSize.map(n=>n*2));const after=await requireGeometry();return {file,sha:await digest(file),size,logicalSize:currentSize.slice(),dpr:2,nativeBefore:before.native,nativeAfter:after.native,boundary:'Actual trusted shell screenshot, separate native page not composited'};}
async function exactNativePage(page,label){
 const before=await requireGeometry();const ownership=await windows();const w=ownership.find(x=>x.id===rootIdentity.rootId),j=w.children.findIndex(c=>c.id===rootIdentity.shellId),matches=w.children.slice(j+1).filter(c=>c.id===page.wc&&c.url===page.url&&c.visible!==false&&c.bounds.width>0);assert.equal(matches.length,1);
 const v=await observeMain(async(E,id,url,origin)=>{const w=E.webContents.fromId(id);if(!w||w.isDestroyed()||w.getURL()!==url||!url.startsWith(origin+'/m16-approval/'))throw Error('Exact private owned visible native page required');const im=await w.capturePage(undefined,{stayHidden:false});return {size:im.getSize(),data:im.toPNG().toString('base64'),url:w.getURL(),title:w.getTitle(),zoom:w.getZoomFactor()};},page.wc,page.url,origin);
 const file=join(root,label+'-native-page.png');const raw=Buffer.from(v.data,'base64');await writeFile(file,raw,{mode:0o600});assert.equal(raw.subarray(1,4).toString(),'PNG');assert.equal(v.zoom,1);const after=await requireGeometry();const size=[raw.readUInt32BE(16),raw.readUInt32BE(20)],nativeImageSize=[v.size.width,v.size.height];assert.deepEqual(size,[matches[0].bounds.width*2,matches[0].bounds.height*2]);assert.deepEqual(nativeImageSize,size);return {file,sha:await digest(file),size,nativeImageSize,dpr:2,url:v.url,title:v.title,bounds:matches[0].bounds,ownership,beforeRoot:before.native.rootId,afterRoot:after.native.rootId,boundary:'Actual separate native WebContents image + observed placement, not OS-compositor capture'};
}
async function prepareProfile(){
 const [init]=await ownDb("select (select count(*) from app_secrets) secretCount,(select count(*) from ai_providers) providerCount,(select count(*) from tasks) taskCount");assert.deepEqual(init,{secretCount:0,providerCount:0,taskCount:0});
 const detected=await app.invoke('agents.customToolPath','codex',cli.path),tool=detected.tool;assert(tool.kind==='codex'&&tool.installed&&tool.version===cli.version);assert.equal(await realpath(tool.executable),cli.path);assert.equal(await digest(cli.path),cli.sha);
 const provider=await app.invoke('agents.saveProvider',{name:'M16 B09 local keyless fixture',preset:'magpie',endpoints:{responses:origin+'/v1',anthropic:origin+'/'},models:[{id:model,name:model,contextWindow:null,offline:false,availability:{codex:'available',claude:'untested',antigravity:'untested'}}]});
 const checked=await app.invoke('agents.checkProviderModel',provider.id,'codex',model);assert.equal(checked.models.find(m=>m.id===model)?.availability.codex,'available');assert(fixture.trace.some(x=>x.side===currentSide&&x.kind==='provider-check'));
 const profile=await app.invoke('agents.save',{name:'M16 B09 isolated native Codex',toolId:tool.id,source:'provider',providerId:provider.id,models:[model],defaultModel:model,isDefault:true});fixtureProfileId=profile.id;assert(uuid.test(fixtureProfileId));
 // Preserve the already tested C10/B11 private managed configuration. No trust,
 // permission or sandbox changes; update check/analytics disabled, file-only synthetic CLI home.
 const managed=join(userData,'agents','codex',createHash('sha256').update(profile.id).digest('hex').slice(0,32));await mkdir(managed,{recursive:true,mode:0o700});assert.equal(await realpath(managed),managed);
 const config=join(managed,'config.toml'),prior=await readFile(config,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;});assert(!prior.trim()||prior===safeConfig);if(prior!==safeConfig)await writeFile(config,safeConfig,{mode:0o600});
 return {initialCounts:init,provider:provider.id,profile:profile.id,tool:{version:tool.version,path:cli.path,sha:cli.sha},safeConfigSha:await digest(config)};
}
const titles={target:targetTitle,observe:'M16 合成观察申请',control:'M16 合成控制申请'};
async function prepareOwnedTasks(){
 const path=join(sideRoot,'project');await mkdir(path,{mode:0o700});assert.equal(await realpath(path),path);
 const project=await app.invoke('projects.create',{name:'M16 审批合成测试',aliases:[],description:'Only local immutable fixture',rulesPath:null},[{label:'fixture',path}]);const dir=(await app.invoke('projects.get',project.id)).dirs[0];assert.equal(dir.path,path);projectInfo={id:project.id,dir};
 const tasks={};for(const role of ['target','observe','control']){const t=await app.invoke('agentTasks.create',{projectId:project.id,dirId:dir.id,cwd:path,title:titles[role],profileId:fixtureProfileId,model,effort:'medium',tier:'ask',carryExtensions:false});assert(uuid.test(t.taskId));tasks[role]={role,task:t.taskId,title:titles[role],row:await assertOwnTask(t.taskId,titles[role])};}
 assert.equal(new Set(Object.values(tasks).map(x=>x.task)).size,3);
 await app.cdp('Page.reload');const ps='[data-testid=sidebar-project][data-project-id='+JSON.stringify(project.id)+']';await app.waitFor(js(s=>!!document.querySelector(s),ps),15000,{navigation:true});if(!await app.evaluate(js(s=>!!document.querySelector(s),sidebar(tasks.target.task))))await shellClick(ps+' [data-testid=sidebar-project-toggle]');
 return tasks;
}
async function sendPrompt(task,prompt){await switchTask(task);await field(composer,prompt);await shellClick('.agent-composer button[type="submit"]');}
async function warmTask(t){
 const marker=fixture.armWarm(t.role),failureBefore=fixture.failures.length;
 await sendPrompt(t.task,marker+' 这是仅本机合成测试的普通绑定。只回复此标记，不调用工具。');
 const result=await until(async()=>{const s=await agentSnapshot(t.task);if(fixture.failures.length>failureBefore)throw Error('Local native fixture refused a warm-up');if(['failed','stopped','limited','needs_attention'].includes(s.status)&&!s.run?.busy)throw Error('Actual native warm-up ended '+s.status);return s.status==='completed'&&!s.run?.busy&&!s.requests?.length&&s.items.some(i=>i.payload?.text===marker+'_ANSWER')?s:null;},'actual native warm-up completed '+t.role,90000);
 assert(result.turns.length);t.binding=await binding(t.task);t.warm={marker,actualStatus:result.status,actualTurn:result.turns.at(-1).turnId??result.turns.at(-1).turn_id,native:t.binding};
 await switchTask(t.task);await openPanel();assert.equal((await snapshot(t.task)).tabs.length,0);t.page=await newTab(t.task,origin+routes[t.role]);assert(uuid.test(t.page.id));assert(fixture.http.some(x=>x.side===currentSide&&x.route===t.role&&x.method==='GET'));await persist();return t;
}
async function noGrant(){const s=await app.invoke('browser.accessState');assert.deepEqual(s.grants,[]);assert.deepEqual(s.requests,[],'Expected durable host request, not separate ephemeral browser grant');return s;}
async function checkTarget(){const s=await snapshot(owned.target.task);assert.equal(s.projectId,projectInfo.id);assert.equal(s.tabs.length,1);const p=s.tabs[0];assert.equal(s.activeId,owned.target.page.id);assert.equal(p.id,owned.target.page.id);assert.equal(p.url,targetUrl);assert(!p.loading&&!p.failure);return {task:owned.target.task,id:p.id,url:p.url,title:p.title,profile:p.profileId};}
async function requestRecord(t,receipt){
 const rs=await ownDb('select request_id,task_id,class,kind,status,origin_json,payload_ref,operation_id,revision,decision_ref from agent_requests where request_id=?',[receipt.requestId]);assert.equal(rs.length,1);const r=rs[0],p=JSON.parse(r.payload_ref),o=JSON.parse(r.origin_json);assert.equal(r.task_id,t.task);assert.equal(r.class,'host_business');assert.equal(r.operation_id,receipt.operationId);assert.equal(p.businessKind,'browser_access');assert.equal(o.taskId,t.task);assert.equal(o.bindingId,t.binding.binding_id);assert(uuid.test(o.runId));
 const runs=await ownDb('select run_id,task_id,project_id,binding_id,generation from capability_runs where run_id=?',[o.runId]);assert.equal(runs.length,1);assert.equal(runs[0].task_id,t.task);assert.equal(runs[0].project_id,projectInfo.id);assert.equal(runs[0].binding_id,t.binding.binding_id);assert.equal(runs[0].generation,o.generation);
 return {row:r,payload:p,origin:o,actualRun:runs[0]};
}
async function pendingRequest(t,receipt){
 const s=await agentSnapshot(t.task),req=s.requests.find(r=>r.requestId===receipt.requestId);assert(req&&s.requests.length===1&&req.kind==='host_business'&&req.status==='pending'&&req.payload.phase==='waiting_user'&&!req.ownerTaskId);
 const rev=req.payload.review;assert.equal(rev.requester,t.task);assert.equal(rev.targetTaskId,owned.target.task);assert.equal(rev.mode,t.role);assert.deepEqual(rev.pages.map(p=>({id:p.id,url:p.url})),[{id:owned.target.page.id,url:targetUrl}]);assert.equal(req.targetTaskTitle,targetTitle);
 const record=await requestRecord(t,receipt);assert.equal(record.row.status,'pending');assert.equal(record.payload.phase,'waiting_user');assert.equal(record.row.decision_ref,null);assert(!record.payload.resultItemId);assert.deepEqual(record.payload.review,rev);assert.deepEqual(record.payload.options.map(x=>x.label),choices[t.role].slice(0,-1));
 assert.equal((await binding(t.task)).native_id,t.binding.native_id);await assertOwnTask(t.task,t.title);const target=await checkTarget();const grants=await noGrant();return {receipt,req,record,target,grants,status:s.status};
}
async function createActualRequest(t){
 fixture.registerRequester(t.role,t.task,projectInfo.id);const marker=fixture.armRequest(t.role,t.task),failureBefore=fixture.failures.length;
 await sendPrompt(t.task,marker+(t.role==='observe'?' 请仅向同一个项目的合成网页目标发起真实观察授权申请，不读取或操作网页。':' 请仅向同一个项目的合成网页目标发起真实控制授权申请，不读取或操作网页。'));
 const actual=await until(async()=>{if(fixture.failures.length>failureBefore)throw Error('Local Model rejected actual permission receipt');const receipt=fixture.receipt(t.role),s=await agentSnapshot(t.task);if(!receipt||s.run?.busy||!s.requests.some(r=>r.requestId===receipt.requestId))return null;return s.items.some(i=>i.payload?.text===marker+'_REQUESTED')?{receipt,status:s.status}:null;},'actual native MCP awaiting_user via ordinary bound turn '+t.role,90000);
 t.receipt=actual.receipt;t.pending=await pendingRequest(t,t.receipt);if(t.pending.record.origin.turnId)assert.notEqual(t.pending.record.origin.turnId,t.warm.actualTurn);await persist();
}

async function requestUi(){
 return app.evaluate(js(()=>{
  const cards=[...document.querySelectorAll('.agent-request[aria-label="待处理请求"]')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height);if(cards.length!==1)return null;
  const card=cards[0],review=card.querySelector('[aria-label="网页授权详情"]'),composer=document.querySelector('.agent-composer'),pane=document.querySelector('.bw-workspace'),viewport=document.querySelector('[data-testid="browser-viewport"]');if(!review||!composer||!pane||!viewport)return null;
  const metrics=e=>{if(!e)return null;const r=e.getBoundingClientRect(),c=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,font:c.font,fontSize:c.fontSize,lineHeight:c.lineHeight,padding:c.padding,margin:c.margin,color:c.color,background:c.backgroundColor,border:c.border,borderRadius:c.borderRadius,outline:c.outline,visible:r.width>0&&r.height>0&&c.visibility!=='hidden'&&c.display!=='none',scrollHeight:e.scrollHeight,clientHeight:e.clientHeight};};
 const options=[...card.querySelectorAll('button[role=option]')].map(e=>{const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {label:e.getAttribute('aria-label'),selected:e.getAttribute('aria-selected'),number:e.querySelector('kbd')?.innerText,description:e.querySelector('small')?.innerText,disabled:e.disabled,hit:e.contains(document.elementFromPoint(x,y)),metrics:metrics(e)};});
  return {card:metrics(card),head:metrics(card.querySelector('.agent-request-head')),review:metrics(review),options,list:metrics(card.querySelector('.agent-request-options')),reason:metrics(card.querySelector('.agent-request-reason')),footer:metrics(card.querySelector('.agent-request-foot')),confirm:metrics(card.querySelector('.agent-confirm-choice')),confirmDisabled:card.querySelector('.agent-confirm-choice')?.disabled,stop:metrics(card.querySelector('.agent-stop-run')),composer:metrics(composer),composerInput:metrics(composer.querySelector('textarea')),viewport:metrics(viewport),task:pane.dataset.browserTask,page:pane.dataset.browserPage??null,headText:card.querySelector('.agent-request-head')?.innerText,reviewText:review.innerText,urls:[...review.querySelectorAll('li')].map(e=>e.innerText),wholeText:card.innerText,visibleControls:options.every(x=>x.metrics.visible),hint:card.querySelector('.agent-request-hint')?.innerText};
 }));
}
function assertRequestUi(t,p,ui){
 assert(ui&&ui.task===t.task&&(!ui.page||ui.page===p.id));assert(ui.headText.includes('需要授权：访问任务')&&ui.headText.includes(targetTitle));assert.deepEqual(ui.urls,[targetUrl]);assert(ui.reviewText.includes('仅限同一项目')&&ui.reviewText.includes('授权绑定后仅在该次运行内有效')&&ui.reviewText.includes('请求会等你处理'));
 assert.deepEqual(ui.options.map(x=>x.label),choices[t.role]);assert.deepEqual(ui.options.map(x=>x.number),choices[t.role].map((_,i)=>String(i+1)));
 assert(ui.options.every(x=>!x.disabled&&x.selected==='false'&&x.metrics.visible&&x.hit));assert(ui.options.find(x=>x.label==='允许观察').description===modeNotes.observe);if(t.role==='control')assert.equal(ui.options.find(x=>x.label==='允许控制').description,modeNotes.control);
 assert.equal(ui.options.at(-1).description,'拒绝当前请求');assert(ui.confirmDisabled&&ui.hint.includes('数字键选择')&&ui.composerInput.visible&&ui.stop.visible&&ui.confirm.visible);
 for(const r of [ui.card,ui.head,ui.review,ui.list,ui.reason,ui.footer,ui.confirm,ui.stop,ui.composerInput,...ui.options.map(o=>o.metrics)])assert(r&&r.visible&&r.x>=-.5&&r.y>=-.5&&r.right<=currentSize[0]+.5&&r.bottom<=currentSize[1]+.5,'Mapped request card/controls outside actual shell');
 for(const r of [ui.head,ui.review,ui.list,ui.reason,ui.footer,ui.confirm,ui.stop,...ui.options.map(o=>o.metrics)])assert(r.x>=ui.card.x-.5&&r.y>=ui.card.y-.5&&r.right<=ui.card.right+.5&&r.bottom<=ui.card.bottom+.5,'Actual request controls clipped against approval card');
 assert(ui.card.bottom<=ui.composer.y+2,'Original approval is outside the current composer input area');assert(ui.card.right<=ui.viewport.x+1,'Approval card must remain outside visible native page');
}
async function stableRequest(t,p,theme,width){let sig=null,since=0;return until(async()=>{
 const g=await actualGeometry(),ui=await requestUi();if(!ui||!g.panel||g.theme!==theme||Math.abs(g.panel.width-width)>1||g.fonts!=='loaded'||!g.viewport)return null;
 const ws=await windows(),rw=ws.find(w=>w.id===rootIdentity.rootId),at=rw?.children.findIndex(c=>c.id===rootIdentity.shellId),view=at>=0?rw.children.slice(at+1).filter(c=>c.id===p.wc&&c.url===p.url&&c.visible!==false):[];
 if(view.length!==1||Math.abs(view[0].bounds.width-g.viewport.width)>6||Math.abs(view[0].bounds.height-g.viewport.height)>6)return null;
 const token=JSON.stringify([g,ui,view[0].bounds]);if(sig!==token){sig=token;since=Date.now();return null;}return Date.now()-since>=250?{geometry:g,ui,actualNative:view[0],ownership:ws}:null;
 },'actual stable mapped request, exact geometry and native page',12000);}
async function captureApproval(t,theme,width){
 const size=currentSize.join('x'),key=theme+'-rw'+width+'-win'+size+'|B11-access-'+t.role,label=currentSide+'-'+key.replace('|','-');stage=label;await requireGeometry();await progress({stage:'capturing-mapped-approval',root,side:currentSide,size,theme,width,mode:t.role,requestId:t.receipt.requestId});
 await switchTask(t.task);await openPanel();let p=await awaitPage(t.task,t.page.url,t.page.id);await actualKeyboardWidth(width);p=await awaitPage(t.task,t.page.url,t.page.id);
 const pendingBefore=await pendingRequest(t,t.receipt),s=await stableRequest(t,p,theme,width);assertRequestUi(t,p,s.ui);
 // Neutral pointer in the actual uninteractive header; no selection/approval.
 const point={x:Math.round(s.ui.head.x+4),y:Math.round(s.ui.head.y+s.ui.head.height/2)},hit=await app.evaluate(js((x,y)=>{const e=document.elementFromPoint(x,y);return !!e?.closest('.agent-request-head')&&!e.closest('button,input,textarea');},point.x,point.y));if(hit)await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...point,button:'none'});
 const measured=await stableRequest(t,p,theme,width);assertRequestUi(t,p,measured.ui);
 const shell=await captureShell(label),native=await exactNativePage(p,label),pendingAfter=await pendingRequest(t,t.receipt),after=await stableRequest(t,p,theme,width);assertRequestUi(t,p,after.ui);assert.deepEqual(after.ui,measured.ui);assert.deepEqual(pendingBefore.req.payload.review,pendingAfter.req.payload.review);
 const row={side:currentSide,key,mode:t.role,size:currentSize,theme,width,label,requestId:t.receipt.requestId,target:pendingAfter.target,requestBefore:pendingBefore,requestAfter:pendingAfter,geometry:measured.geometry,approval:measured.ui,ownership:measured.ownership,native,shell,captured:true,passed:false,boundary:'One real host pending request stable across eight geometry variants. Raw actual request card in shell and own separate native page; no approval or target action.'};report.captures.push(row);await persist();
}
async function denyRequest(t){
 assert(t.receipt&&!t.denial);stage=currentSide+'-actual-denial-'+t.role;await switchTask(t.task);await openPanel();await awaitPage(t.task,t.page.url,t.page.id);const pending=await pendingRequest(t,t.receipt),before=await requestUi();assert(before&&before.task===t.task&&before.headText.includes(targetTitle)&&before.reviewText.includes(targetUrl));assert.deepEqual(before.options.map(x=>x.label),choices[t.role]);
 fixture.armDenial(t.role,t.receipt.requestId);
 // This is the only request decision exercised in the batch: exact actual UI refuse; never click an allow choice.
 await shellClick('.agent-request [role="option"][aria-label="拒绝"]');await until(()=>app.evaluate('document.querySelector(\'.agent-request [role="option"][aria-label="拒绝"]\')?.getAttribute("aria-selected")==="true"&&!document.querySelector(".agent-request .agent-confirm-choice")?.disabled'),'actual denial option selected',5000);await shellClick('.agent-request .agent-confirm-choice','确认');
 const denied=await until(async()=>{const s=await agentSnapshot(t.task),r=await requestRecord(t,t.receipt);if(r.row.status!=='retired'||s.requests.some(x=>x.requestId===t.receipt.requestId))return null;const notices=(await ownDb("select payload_ref from agent_items where task_id=? and type='system_notice'",[t.task])).map(x=>JSON.parse(x.payload_ref));const notice=notices.find(x=>x.code==='businessRequestRetired'&&x.detail==='用户拒绝');return notice?{r,notice,status:s.status}:null;},'actual request retired as user refusal with durable result',30000);
 assert.equal(denied.r.row.revision,pending.record.row.revision+1);assert.equal(denied.r.row.decision_ref,null);assert(!denied.r.payload.resultItemId);const grants=await noGrant();const target=await checkTarget();
 const settled=await until(async()=>{const s=await agentSnapshot(t.task);return !s.run?.busy&&!s.preparingTurnId&&!s.requests.length?s:null;},'actual private native requester settled after refusal',90000);
 t.denial={requestId:t.receipt.requestId,record:denied.r,systemNotice:denied.notice,noGrant:grants,target,actualTaskStatus:settled.status,uiDecision:'拒绝 → 确认',at:Date.now()};for(const c of report.captures.filter(c=>c.side===currentSide&&c.mode===t.role&&c.captured)){assert.equal(c.requestId,t.receipt.requestId);c.denial=t.denial;c.passed=true;}await persist();return t.denial;
}
async function captureSize(sideRow){
 const target=owned.observe.task;await setFocusEmulation(true);try{for(const theme of ['light','dark']){await actualTheme(target,theme);for(const width of [480,900])for(const mode of modes)await captureApproval(owned[mode],theme,width);}}finally{await setFocusEmulation(false);}sideRow.sizeCompletions??=[];sideRow.sizeCompletions.push({size:currentSize,captured:report.captures.filter(c=>c.side===currentSide&&c.size[0]===currentSize[0]).length});await persist();
}
async function setupTargetSnapshot(t,label){
 await switchTask(t.task);await openPanel();const p=await awaitPage(t.task,targetUrl,t.page.id);const view=await exactNativePage(p,label);const marker=await observeMain(async(E,id,url)=>{const w=E.webContents.fromId(id);if(!w||w.isDestroyed()||w.getURL()!==url)throw Error('wrong owned target');return await w.executeJavaScript('({url:location.href, title:document.title, marker:document.body.innerText.includes("M16_VISUAL_APPROVAL_OWNED_STATIC"), forms:document.forms.length,scripts:document.scripts.length})');},p.wc,targetUrl);assert(marker.marker&&marker.forms===0&&marker.scripts===0&&marker.url===targetUrl);return {view,marker,logical:await checkTarget()};
}
function updateRows(){report.originalRows=report.captures.filter(c=>c.passed).map(c=>({key:c.key,side:c.side,label:c.label,shell:c.shell.file,native:c.native.file,requestId:c.requestId,denial:c.denial.requestId}));assert.equal(new Set(report.originalRows.map(r=>r.side+'|'+r.key)).size,report.originalRows.length);assert(report.originalRows.every(r=>originalKeys().includes(r.key)));}
try{
 for(const spec of specs){
  currentSide=spec.side;currentSize=[1440,900];fullscreenDisplay=null;rootIdentity=null;owned=null;fixture.beginSide(currentSide);const isolated=await useSide(currentSide),sideRow={side:currentSide,isolated};report.sides.push(sideRow);await persist();
  await runApp(spec.bundle,spec.hash,currentSide+'-mapped-approvals',spec.native);await setOwnTitle(currentSide);sideRow.window1440=await prepare1440(currentSide);await persist();
  await setFocusEmulation(true);try{sideRow.profile=await prepareProfile();owned=await prepareOwnedTasks();sideRow.owned=owned;await warmTask(owned.target);fixture.registerTarget(owned.target.task,projectInfo.id,owned.target.page.id,targetUrl);sideRow.targetBefore=await setupTargetSnapshot(owned.target,currentSide+'-exact-target-before');for(const mode of modes){await warmTask(owned[mode]);await createActualRequest(owned[mode]);}await noGrant();assert.notEqual(owned.observe.receipt.requestId,owned.control.receipt.requestId);await persist();}finally{await setFocusEmulation(false);}
  await captureSize(sideRow);
  // Original 1920 keys intentionally remain unexecuted in this internal batch.
  await setFocusEmulation(true);try{for(const mode of modes)await denyRequest(owned[mode]);sideRow.targetAfter=await setupTargetSnapshot(owned.target,currentSide+'-exact-target-after');assert.deepEqual(sideRow.targetAfter.marker,sideRow.targetBefore.marker);assert.deepEqual(sideRow.targetAfter.logical,sideRow.targetBefore.logical);sideRow.finalGrantState=await noGrant();assert.equal(fixture.trace.filter(x=>x.side===currentSide&&x.kind==='native-permission-request-only').length,2);sideRow.actualAllRequestsDenied=true;}finally{await setFocusEmulation(false);}
  updateRows();await quit();await progress({stage:'side-normal-exit',root,side:currentSide,actualCaptured:report.captures.filter(c=>c.side===currentSide&&c.passed).length,exit:report.launches.at(-1).exit});
 }
 updateRows();assert(report.sides.every(s=>s.actualAllRequestsDenied));assert.equal(report.originalRows.length,16);assert.equal(report.fixture.trace.filter(x=>x.kind==='native-permission-request-only').length,4);assert.equal(report.fixture.failures.length,0);report.status='actual-mapped-approval-1440-internal-pair-recorded';
}catch(e){report.status='failed-or-partial';report.error=String(e.stack??e);report.startupDiagnostic=e.electronStartupDiagnostic??null;if(app){try{await setFocusEmulation(false);}catch{}try{await captureShell(stage+'-failed');}catch{}// Only positively identified pending own requests may be denied during cleanup. Unknown targets are never acted on.
  if(owned)for(const t of [owned.observe,owned.control])if(t?.receipt&&!t.denial){try{await denyRequest(t);}catch(err){report.cleanupErrors??=[];report.cleanupErrors.push({mode:t.role,reason:String(err.message),boundary:'No grant; normal private App close follows'});}}
  try{await quit();}catch(err){report.cleanupErrors??=[];report.cleanupErrors.push({reason:String(err.message)});}
 }}finally{updateRows();await fixture.close();report.finishedAt=new Date().toISOString();await verifyPins(expectedArgs);await verifyNativeRunner([cli.path,cli.sha]);await persist();console.log(JSON.stringify({root,status:report.status,error:report.error,actualRows:report.originalRows.length,resultFile:join(root,'B09-mapped-approval-pair-result.json')}));if(report.status!=='actual-mapped-approval-1440-internal-pair-recorded')process.exitCode=1;}
