// M16 B08.2: actual C28 application-level permission, one physical user allow.
// No model turn, other permission, actual sensor read, keychain, or real site.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {mkdtemp,readFile,writeFile,realpath,lstat,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer as netServer} from 'node:net';
import {openElectron,pause} from './isolated-electron.mjs';
import {stableClickPoint} from './same-click-point.mjs';
import {repo,support,bundle,exe,pin,nativePin,cli,cliPin,digest,verifyPackage,makeRoot,assertOnlyDecision,assertOwnPrompt,permission} from './guards.mjs';
import {openFixture,fixtureTitle,model} from './fixture.mjs';

assert.equal(process.argv[2],'--coordinator-authorized-b08-permission-after-b11');
assert.equal(process.cwd(),repo);
const pins=await verifyPackage(process.argv.slice(3));
// Block inherited credential/configuration environments before child creation.
const keep=new Set(['PATH','TMPDIR','LANG','LC_ALL','USER','LOGNAME','SHELL']);
for(const key of Object.keys(process.env))if(!keep.has(key))delete process.env[key];
const iso=await makeRoot(),{root,home,cliHome,userData,project}=iso;
const evidence=await mkdtemp(join(support,'run-'));
assert.equal(await realpath(evidence),evidence);
const title='WillYou · M16 B08站点权限 '+root.split('-').at(-1);
const shellUrl=pathToFileURL(join(bundle,'Contents/Resources/app.asar/out/renderer/index.html')).href;
const promptDialog='[role="alertdialog"][aria-label="站点权限请求"]';
const profileDialog='[role="dialog"][aria-label="登录态管理"]';
const report={schema:'M16-B08.2-C28-real-application-permission-allow-revoke',status:'starting',pins,root,evidence,userData,title,
  startedAt:Date.now(),actions:[],checks:[],nativeReadiness:[],requests:{pages:[],ping:[],offscope:0},
  boundary:'Actual application-owned UI and browser requestPermission only. One physical user allow, no scripted allow. No IdleDetector.start, OS idle information, device permission, external site, credential, or actual keychain access. Fixed previously validated synthetic Chromium mock cookie-key storage only, not system security evidence. No agent/model turn; public synthetic loopback provider prerequisite ping only. All production authority handlers unchanged. Historical C19 denial/reask and C28 startup/hit-test guard reused.'};
let app,fixture,t,page,ownerId,shellId,stage='initial',front,frontRows=[],observerError,stoppingFront=false,normalExit=null,manualPending=false;
const js=(fn,...args)=>{const s='('+fn.toString()+')(...'+JSON.stringify(args)+')';new Function('return '+s);return s;};
async function save(){const p=join(evidence,'result.json'),temp=p+'.tmp';await writeFile(temp,JSON.stringify(report,null,2)+'\n',{mode:0o600});await rename(temp,p);}
async function progress(value){const p=join(evidence,'progress.json'),temp=p+'.tmp';const msg={stage,root,evidence,pid:app?.processId??null,windowTitle:title,...value};await writeFile(temp,JSON.stringify(msg,null,2)+'\n',{mode:0o600});await rename(temp,p);await save();console.log(JSON.stringify(msg));}
async function until(fn,label,timeout=15000,step=80){const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await pause(step);}throw Error('Timeout: '+label);}
async function shot(name){const path=join(evidence,name+'.png');await app.screenshot(path);return{name:path,sha:await digest(path)};}
async function check(name,value){report.checks.push({name,at:Date.now(),...value});await save();}
const snapshot=()=>app.invoke('browser.snapshot',{taskId:t.taskId});
const sidebar=id=>'[data-testid="sidebar-agent-task"][data-task-id='+JSON.stringify(id)+']';
const browserOwner=p=>({taskId:t.taskId,pageId:p.id});

async function main(fn,...args){
  assert(app);
  const s=js((pid,exe,data,home,cli,source,args)=>{
    const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');
    if(process.pid!==pid||process.execPath!==exe||E.app.getPath('userData')!==data||process.env.HOME!==home||process.env.SMARTDD_CLI_HOME!==cli||!E.app.commandLine.hasSwitch('use-mock-keychain'))throw Error('Wrong isolated App identity');
    return (0,eval)('('+source+')')(E,...args);
  },app.processId,exe,userData,home,cliHome,fn.toString(),args);
  return app.mainEvaluate(s,{label:'b08-permission-exact-own-observation',timeoutMs:5000});
}
async function windows(){
  return main((E,expected,expectedSite,ownId,ownShell,ownTitle)=>{
    const roots=E.BaseWindow.getAllWindows().filter(w=>!w.isDestroyed());
    if(roots.length!==1)throw Error('original isolated root must be unique');
    const w=roots[0],shell=u=>u===expected||u.startsWith(expected+'?')||u.startsWith(expected+'#');
    const children=w.contentView.children.filter(v=>v.webContents&&!v.webContents.isDestroyed()).map(v=>{
      const c=v.webContents,url=c.getURL();
      if(!shell(url)&&url!==expectedSite&&url!=='about:blank'&&url!=='')throw Error('Unexpected non-fixture native target');
      return{id:c.id,url,visible:v.getVisible?.()??null,bounds:v.getBounds(),pid:c.getOSProcessId()};
    });
    const trusted=children.filter(c=>shell(c.url));
    if(trusted.length!==1||ownId!==null&&(ownId!==w.id||ownShell!==trusted[0].id||w.getTitle()!==ownTitle))throw Error('Original trusted root, title or shell changed');
    return [{id:w.id,title:w.getTitle(),visible:w.isVisible(),minimized:w.isMinimized(),focused:w.isFocused(),bounds:w.getBounds(),children}];
  },shellUrl,fixture.site,ownerId??null,shellId??null,title);
}
async function own(){const [w]=await windows();assert(w.visible&&!w.minimized);return w;}
async function start(){
  const env={...iso.env,HTTP_PROXY:fixture.origin,HTTPS_PROXY:fixture.origin,ALL_PROXY:fixture.origin,NO_PROXY:'127.0.0.1,localhost',http_proxy:fixture.origin,https_proxy:fixture.origin,all_proxy:fixture.origin,no_proxy:'127.0.0.1,localhost'};
  app=await openElectron({executable:exe,userData,cwd:root,env,inspectMain:true,mockKeychainFixture:true,candidatePin:pin,nativePin});
  const w=await own();ownerId=w.id;shellId=w.children.find(c=>c.url.startsWith(shellUrl)).id;
  const named=await main((E,id,cid,title)=>{const w=E.BaseWindow.fromId(id),c=E.webContents.fromId(cid);if(!w||!c||!w.contentView.children.some(v=>v.webContents===c))throw Error('Wrong trusted owner');w.setTitle(title);return w.getTitle();},ownerId,shellId,title);
  assert.equal(named,title);report.start={pid:app.processId,own:await own(),startup:app.startupObservation};await save();
}
function startFront(){
  front=spawn(join(support,'front-observer'),[String(app.processId),exe],{stdio:['ignore','pipe','ignore']});
  let rest='';const log=join(evidence,'front-observations.jsonl');
  front.stdout.on('data',part=>{rest+=part.toString();let n;while((n=rest.indexOf('\n'))>=0){const line=rest.slice(0,n);rest=rest.slice(n+1);try{
    const r=JSON.parse(line);assert(Number.isFinite(r.at)&&['own','finder','other'].includes(r.front));assert(r.front==='own'?r.pid===app.processId:r.front==='other'?r.pid===0:r.pid>0);
    // Only the own PID or anonymized non-own foreground lane is retained.
    const row={at:r.at,front:r.front==='own'?'own':'other',pid:r.front==='own'?r.pid:0};frontRows.push(row);appendFileSync(log,JSON.stringify(row)+'\n',{mode:0o600});
  }catch(e){observerError=String(e.message);}}});
  front.on('error',e=>{observerError=String(e.message);});
  front.on('exit',()=>{if(!stoppingFront)observerError='Independent AppKit observer exited';});
}
function frontProof(at=Date.now(),ms=3000){
  if(observerError)throw Error(observerError);
  let j=frontRows.length-1;while(j>=0&&frontRows[j].at>at)j--;
  if(j<0||frontRows[j].front!=='own'||at-frontRows[j].at>500)return null;
  let i=j;while(i>0&&frontRows[i-1].front==='own'&&frontRows[i].at-frontRows[i-1].at<500)i--;
  if(frontRows[j].at-frontRows[i].at<ms)return null;
  return{pid:frontRows[j].pid,from:frontRows[i].at,to:frontRows[j].at,count:j-i+1,duration:frontRows[j].at-frontRows[i].at};
}
async function stopFront(){
  if(!front)return;const p=front;front=null;stoppingFront=true;
  if(p.exitCode===null&&p.signalCode===null){const stopped=new Promise(r=>p.once('close',r));p.kill('SIGTERM');await Promise.race([stopped,pause(3000)]);}
  assert(p.exitCode!==null||p.signalCode!==null,'Original observer not stopped');
  report.frontObserverExit={pid:p.pid,code:p.exitCode,signal:p.signalCode};
}
async function foreground(){
  await progress({stage:'await-own-front',instruction:'请选择标题完全匹配的本轮隔离 WillYou 窗口、在前台停留；暂不点击页面及权限按钮，等待“本人允许”提示。'});
  const proof=await until(()=>frontProof(),'three seconds exact AppKit foreground',240000,100);
  const w=await own();assert(w.focused);return proof;
}

async function readShellTarget(selector,label,owner=null,focusRequired=false,allowInspect=false,rowExpected=null){
  return app.evaluate(js((query,text,expected,requiresFocus,allowInspect,rowExpected,promptDialog)=>{
    const nodes=[...document.querySelectorAll(query)].filter(e=>{const r=e.getBoundingClientRect();return e.isConnected&&r.width>0&&r.height>0&&!e.matches(':disabled')&&(text===null||e.textContent.trim()===text);});
    if(nodes.length!==1)return null;const e=nodes[0],workspace=e.closest('.bw-workspace');
    const taskId=workspace?.dataset.browserTask??null,pageId=workspace?.dataset.browserPage??null;
    if(expected&&(taskId!==expected.taskId||pageId!==expected.pageId))return null;
    if(e.closest(promptDialog)&&!allowInspect)return null; // NEVER automated allow/deny.
    if(rowExpected){const li=e.closest('li');if(li?.querySelector('strong')?.textContent!==rowExpected.origin||li?.querySelector('small')?.textContent!==rowExpected.caption)return null;}
    if(requiresFocus&&document.activeElement!==e)return null;
    if(!requiresFocus&&!allowInspect)e.scrollIntoView({behavior:'instant',block:'nearest'});
    const r=e.getBoundingClientRect(),x=Math.floor(r.x+r.width/2),y=Math.floor(r.y+r.height/2);
    if(!e.isConnected||!e.contains(document.elementFromPoint(x,y)))return null;
    return{point:{x,y},semantic:JSON.stringify({query,text,taskId,pageId,tag:e.tagName,role:e.getAttribute('role'),title:e.getAttribute('title'),aria:e.getAttribute('aria-label'),type:e.getAttribute('type'),sidebarTask:e.closest('[data-task-id]')?.getAttribute('data-task-id')??null,rowExpected})};
  },selector,label,owner,focusRequired,allowInspect,rowExpected,promptDialog));
}
async function shellClick(selector,label=null,{owner=null,rowExpected=null,menuAlternative=false}={}){
  assert(!manualPending,'No automated input during personal consent');
  let proof;
  try{proof=await stableClickPoint({readTarget:()=>readShellTarget(selector,label,owner,false,false,rowExpected),readNative:windows,pause,hover:point=>app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...point})});}
  catch(e){report.hitFailure={stage,selector,label,reason:e.reason??'identity',evidence:e.evidence??null};await save();if(menuAlternative&&e.reason==='native-occlusion'&&e.evidence?.occlusion?.length)return false;throw e;}
  const point=proof.point,at=Date.now();
  for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
  report.actions.push({stage,kind:'actual-shell-click',selector,label,owner,point,at,semantic:proof.targetIdentity,shellIdentity:proof.shellIdentity,attempts:proof.attempts,retries:proof.retries});await save();return true;
}
async function assertFieldFocus(selector,owner){
  await stableClickPoint({readTarget:()=>readShellTarget(selector,null,owner,true),readNative:windows,pause});
}
async function keypress(key){
  assert(!manualPending&&['Enter','b'].includes(key));
  const code=key==='Enter'?'Enter':'KeyB',windowsVirtualKeyCode=key==='Enter'?13:66,text=key==='Enter'?'\r':'b';
  for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode,...(type==='keyDown'?{text}:{})});
}
async function field(selector,value,owner){
  await shellClick(selector,null,{owner});await assertFieldFocus(selector,owner);
  for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:4,...(type==='keyDown'?{commands:['selectAll']}:{})});
  await assertFieldFocus(selector,owner);await app.cdp('Input.insertText',{text:value});
  await app.waitFor(js((q,v,o)=>{const e=document.querySelector(q),w=e?.closest('.bw-workspace');return e?.value===v&&document.activeElement===e&&w?.dataset.browserTask===o.taskId&&w?.dataset.browserPage===o.pageId;},selector,value,owner),8000);
}
async function selectTask(){
  const projectSelector='[data-testid=sidebar-project][data-project-id='+JSON.stringify(t.projectId)+']';
  await app.waitFor(js(s=>!!document.querySelector(s),projectSelector),15000,{navigation:true});
  if(!await app.evaluate(js(s=>!!document.querySelector(s),sidebar(t.taskId))))await shellClick(projectSelector+' [data-testid=sidebar-project-toggle]');
  await app.waitFor(js(s=>!!document.querySelector(s),sidebar(t.taskId)),15000,{navigation:true});await shellClick(sidebar(t.taskId));await app.waitFor('!!document.querySelector(".agent-task-view textarea")',10000);
  if(!await app.evaluate('Boolean(document.querySelector("[data-testid=agent-workspace-panel]"))'))await shellClick('button[title="打开右侧面板"]');
  await app.waitFor('Boolean(document.querySelector("[data-testid=agent-workspace-panel]"))',5000);
}
async function awaitPage(id,expected,requiredWc=null){
  const tab=await until(async()=>{const s=await snapshot(),t=s.tabs.find(t=>t.id===s.activeId);return t?.id===id&&t.url===expected&&!t.loading&&!t.failure?t:null;},'actual selected fixture tab',20000);
  await app.waitFor(js((url,task,page)=>{const w=document.querySelector('.bw-workspace');return w?.dataset.browserTask===task&&w?.dataset.browserPage===page&&w.querySelector('[aria-label="网页地址"]')?.value===url&&w.getBoundingClientRect().width>0;},expected,t.taskId,id),10000);
  const native=await until(async()=>{const [w]=await windows(),si=w.children.findIndex(c=>c.id===shellId),front=w.children.slice(si+1).filter(c=>c.url===expected&&c.visible!==false&&c.bounds.width>0&&c.bounds.height>0);return front.length===1?front[0]:null;},'actual selected native fixture view',15000);
  if(requiredWc!==null)assert.equal(native.id,requiredWc);
  return{id,profile:tab.profileId,url:expected,wc:native.id,bounds:native.bounds};
}
async function newTab(){
  const before=await snapshot();assert.equal(before.tabs.length,0);assert(!before.permission);
  await shellClick('button[aria-label="打开面板"]');
  const clicked=await shellClick('.agent-panel-menu button[title="新建网页标签"]',null,{menuAlternative:true});
  if(!clicked){assert(await app.evaluate('document.querySelector("button[aria-label=\\"打开面板\\"]")?.getAttribute("aria-expanded")==="true"&&!!document.querySelector(".agent-panel-menu button[title=\\"新建网页标签\\"]")'));await keypress('b');report.actions.push({stage,kind:'existing B menu shortcut after recorded native overlap'});await save();}
  const created=await until(async()=>{const s=await snapshot();return s.tabs.length===1&&s.activeId?s:null;},'new real tab');
  const owner={taskId:t.taskId,pageId:created.activeId},q='[aria-label="网页地址"]';await field(q,fixture.site,owner);await assertFieldFocus(q,owner);await keypress('Enter');
  await until(async()=>{const s=await snapshot(),r=s.tabs.find(r=>r.id===s.activeId);return r?.id===created.activeId&&(r.pendingUrl===fixture.site||r.url===fixture.site);},'own URL submitted',5000);
  return await awaitPage(created.activeId,fixture.site);
}
async function profileState(p,decision){
  const rows=await app.invoke('browser.profileSiteStates',{taskId:t.taskId});
  const matched=rows.find(x=>x.profile.id===p.profile);
  assert(matched&&matched.profile.scope==='project'&&matched.profile.owner.kind==='project'&&matched.profile.owner.id===t.projectId);
  const mapped=rows.map(x=>({profileId:x.profile.id,state:x.state}));
  const choice=assertOnlyDecision(mapped,p.profile,fixture.origin,decision);
  return{choice,profileId:p.profile,owner:matched.profile.owner,states:mapped};
}
function dbState(mode,expectTask,expectProvider,decision=null,p=null){
  const out=JSON.parse(execFileSync('/usr/bin/python3',[join(support,'db-observe.py'),root,join(userData,'smartdd.db'),mode],{encoding:'utf8'}));
  assert.equal(out.secretCount,0);assert.equal(out.providerSecretCount,0);assert.equal(out.taskCount,expectTask);assert.equal(out.providerCount,expectProvider);assert.equal(out.agentTurns,0);
  assertOnlyDecision(out.states,p?.profile??null,fixture?.origin??null,decision);
  if(mode==='closed')assert.equal(out.quickCheck,'ok');
  return out;
}
async function nativeReadiness(p){
  return main(async(E,id,expected,rootId,shellId,expectedShell)=>{
    const w=E.webContents.fromId(id),roots=E.BaseWindow.getAllWindows().filter(r=>!r.isDestroyed());
    if(roots.length!==1||roots[0].id!==rootId)throw Error('Own root changed');
    const root=roots[0],children=root.contentView.children.map(v=>({id:v.webContents?.id??null,url:v.webContents&&!v.webContents.isDestroyed()?v.webContents.getURL():null,visible:v.getVisible?.()??null,bounds:v.getBounds()}));
    const wi=children.findIndex(v=>v.id===id),si=children.findIndex(v=>v.id===shellId&&v.url?.startsWith(expectedShell));
    if(si<0||children.some(v=>v.id!==shellId&&v.id!==id))throw Error('Unexpected native page in fixture root');
    const front=root.isVisible()&&!root.isMinimized()&&wi>si&&children[wi].visible!==false&&children.slice(wi+1).every(v=>v.visible===false)&&children[wi].bounds.width>0&&children[wi].bounds.height>0;
    if(!w||w.isDestroyed()||w.getURL()!==expected)return{id,alive:false,front,rootId,wi,si};
    const doc=await w.executeJavaScript('(()=>{const e=document.querySelector("#request");if(!e)return null;const r=e.getBoundingClientRect(),x=Math.floor(r.x+r.width/2),y=Math.floor(r.y+r.height/2);return {secure:isSecureContext,available:typeof IdleDetector!=="undefined"&&typeof IdleDetector.requestPermission==="function",timeOrigin:performance.timeOrigin,point:{x,y},buttonClear:r.width>0&&r.height>0&&e.contains(document.elementFromPoint(x,y)),result:document.querySelector("#result")?.textContent,title:document.title}})()');
    return{id,alive:true,url:w.getURL(),process:w.getOSProcessId(),debuggerAttached:w.debugger.isAttached(),doc,front,rootId,focused:root.isFocused(),wi,si,bounds:wi>=0?children[wi].bounds:null};
  },p.wc,p.url,ownerId,shellId,shellUrl);
}
async function stablePage(p,label,{same=null,afterReload=null,wantResult=null}={}){
  let previous=null;
  return until(async()=>{
    const logical=await snapshot(),selected=logical.tabs.find(x=>x.id===logical.activeId),native=await nativeReadiness(p);
    const shellClosed=await app.evaluate(js((d,b)=>!document.querySelector(d)&&!document.querySelector(b),profileDialog,promptDialog));
    const shape={label,at:Date.now(),selectedId:selected?.id??null,selectedUrl:selected?.url??null,profile:selected?.profileId??null,loading:selected?.loading??null,shellClosed,native};report.nativeReadiness.push(shape);
    if(native.doc){assert(native.doc.secure&&native.doc.available&&native.doc.title===fixtureTitle,'Chosen exact safe API is unsupported or fixture identity changed');}
    const valid=native.alive&&native.id===p.wc&&native.url===p.url&&native.debuggerAttached&&native.doc?.buttonClear&&native.front&&shellClosed&&selected?.id===p.id&&selected?.url===p.url&&selected?.profileId===p.profile&&!selected.loading&&!selected.failure&&(!same||native.process===same.process&&native.doc.timeOrigin===same.doc.timeOrigin)&&(!afterReload||native.doc.timeOrigin>afterReload.doc.timeOrigin&&report.requests.pages.length>afterReload.pageGets)&&(!wantResult||native.doc.result===wantResult);
    const sig=valid?JSON.stringify({id:native.id,process:native.process,url:native.url,time:native.doc.timeOrigin,point:native.doc.point,bounds:native.bounds,selected:selected.id,profile:selected.profileId}):null;
    const stable=sig&&sig===previous;previous=sig;return stable?native:null;
  },'actual same owner, native front and stable document '+label,15000,80);
}
async function pageRequestClick(p){
  assert(!manualPending);const proof=await stablePage(p,'before request input');const point=proof.doc.point;
  for(const type of ['mouseMoved','mousePressed','mouseReleased']){
    const v=await main(async(E,id,url,rootId,shellId,docTime,point,type)=>{
      const w=E.webContents.fromId(id),root=E.BaseWindow.fromId(rootId);if(!w||w.isDestroyed()||w.getURL()!==url||!root||!root.isVisible()||root.isMinimized()||!w.debugger.isAttached())throw Error('Wrong own native target');
      const views=root.contentView.children,wi=views.findIndex(v=>v.webContents?.id===id),si=views.findIndex(v=>v.webContents?.id===shellId);
      if(si<0||wi<=si||views[wi].getVisible?.()===false||views.slice(wi+1).some(v=>v.getVisible?.()!==false))throw Error('Fixture native target no longer front');
      const observed=await w.executeJavaScript('(()=>{const e=document.querySelector("#request");if(!e)return null;const r=e.getBoundingClientRect(),x=Math.floor(r.x+r.width/2),y=Math.floor(r.y+r.height/2);return {time:performance.timeOrigin,x,y,clear:r.width>0&&r.height>0&&e.contains(document.elementFromPoint(x,y))}})()');
      if(!observed?.clear||observed.time!==docTime||observed.x!==point.x||observed.y!==point.y)throw Error('Native button point/document changed');
      await w.debugger.sendCommand('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});return true;
    },p.wc,p.url,ownerId,shellId,proof.doc.timeOrigin,point,type);assert.equal(v,true);
  }
  report.actions.push({stage,kind:'actual-safe-fixture-request-click',pageId:p.id,wc:p.wc,point,timeOrigin:proof.doc.timeOrigin,at:Date.now()});await save();
}
async function prompt(p){
  const q=assertOwnPrompt(await until(async()=>{const s=await snapshot();return s.permission??null;},'actual site permission prompt',7000),p,fixture.origin);
  const visible=await app.evaluate(js((d,o,pm,owner)=>{const el=document.querySelector(d),r=el?.getBoundingClientRect(),w=el?.closest('.bw-workspace');return el&&r&&r.width&&r.height&&w?.dataset.browserTask===owner.taskId&&w?.dataset.browserPage===owner.pageId&&el.querySelector('strong')?.textContent===o&&el.innerText.includes(pm)&&el.innerText.includes('Agent 无法代你允许')?{text:el.innerText,rect:{x:r.x,y:r.y,width:r.width,height:r.height}}:null;},promptDialog,fixture.origin,permission,browserOwner(p)));
  assert(visible,'Actual app permission banner, not OS dialog');
  await check(stage+'-real-prompt',{q,visible,screenshot:await shot(stage+'-prompt')});return q;
}
async function observeUserClick(p){
  // Read-only capture listener in original trusted shell, scoped to this
  // exact synthetic banner. No property/store/input or decision is changed.
  return app.evaluate(js((d,o,pm,owner)=>{
    if(window.__b08OwnConsentObservation)throw Error('Consent observer already installed');
    const events=[],handler=e=>{
      const button=e.target instanceof Element?e.target.closest('button'):null,bar=button?.closest(d),w=bar?.closest('.bw-workspace');
      if(!bar||!w||w.dataset.browserTask!==owner.taskId||w.dataset.browserPage!==owner.pageId||bar.querySelector('strong')?.textContent!==o||!bar.innerText.includes(pm))return;
      const action=button.textContent.trim();if(action!=='允许'&&action!=='拒绝')return;
      events.push({action,at:Date.now(),trusted:e.isTrusted,clear:button.contains(document.elementFromPoint(e.clientX,e.clientY)),taskId:owner.taskId,pageId:owner.pageId});
    };
    window.addEventListener('click',handler,true);window.__b08OwnConsentObservation={events,remove(){window.removeEventListener('click',handler,true);delete window.__b08OwnConsentObservation;}};return true;
  },promptDialog,fixture.origin,permission,browserOwner(p)));
}
const clicks=()=>app.evaluate('window.__b08OwnConsentObservation?.events??null');
async function humanAllow(p,q){
  const proof=await stableClickPoint({readTarget:()=>readShellTarget(promptDialog+' button','允许',browserOwner(p),false,true),readNative:windows,pause}); // read only, no hover/input
  assert(frontProof()&&(await own()).focused);assert.deepEqual(await clicks(),[]);
  const before=assertOwnPrompt((await snapshot()).permission,p,fixture.origin);assert.equal(before.id,q.id);
  manualPending=true;const handoffAt=Date.now();
  await progress({stage:'personal-allow-now',origin:fixture.origin,permission,promptId:q.id,taskId:t.taskId,pageId:p.id,action:'本人只点一次真实“站点权限请求”中的「允许」',instruction:'请确认窗口标题、下方 localhost 地址与 idle-detection 完全匹配；只在应用自身横条点一次“允许”。请不要点击其他系统权限框，不退出或切换窗口；后续再次询问不要点，由测试关闭网页。'});
  const actual=await until(async()=>{
    const events=await clicks();assert(Array.isArray(events)&&events.length<=1,'Unexpected user decision count');
    if(observerError)throw Error(observerError);
    const w=await own();assert(w.focused&&frontProof(Date.now(),0),'Own foreground lost during personal decision');
    const s=await snapshot(),state=await nativeReadiness(p);
    if(!events.length){assert.equal(s.permission?.id,q.id,'Pending request changed before observed personal click');return null;}
    const e=events[0];assert(e.trusted&&e.clear&&e.at>=handoffAt&&e.action==='允许'&&e.taskId===t.taskId&&e.pageId===p.id,'Person-only exact allow required');
    const frontAt=frontProof(e.at);assert(frontAt,'Independent own foreground not proven at click');
    if(s.permission){assert.equal(s.permission.id,q.id);return null;}
    if(state.doc?.result==='granted:1')return {event:e,frontAt,state};
    if(state.doc?.result?.startsWith('denied')||state.doc?.result?.startsWith('error'))throw Error('Actual page did not receive granted');
    return null;
  },'person-only allow and real callback',300000,100);
  manualPending=false;assert.equal(await app.evaluate('window.__b08OwnConsentObservation.remove(); true'),true);
  const state=await profileState(p,'allow'),db=dbState('live',1,1,'allow',p);
  assert.equal(db.states.find(x=>x.profileId===p.profile).state.permissions[0].updatedAt,state.choice.updatedAt);
  await check('personal-allow-and-persisted-grant',{q,proof:{point:proof.point,semantic:proof.targetIdentity,shellIdentity:proof.shellIdentity},actual,state,db,screenshot:await shot('actual-user-allowed')});
  return state.choice;
}
async function refresh(p,identity,saved){
  const pageGets=report.requests.pages.length;await shellClick('.bw-workspace button[aria-label="刷新网页"]',null,{owner:browserOwner(p)});
  await awaitPage(p.id,p.url,p.wc);
  const reloaded=await stablePage(p,'normal refresh new document',{afterReload:{...identity,pageGets},wantResult:'initial'});
  assert.equal((await profileState(p,'allow')).choice.updatedAt,saved.updatedAt);
  await check('real-refresh-same-logical-page-profile-new-document',{before:identity,after:reloaded,pageGetsBefore:pageGets,pageGetsAfter:report.requests.pages.length});
  await pageRequestClick(p);
  const observed=[];let grantedAt=null;
  await until(async()=>{const s=await snapshot(),v=await nativeReadiness(p);assert(!s.permission,'Remembered allow must not ask again');assert.equal(v.doc?.timeOrigin,reloaded.doc.timeOrigin);observed.push({at:Date.now(),result:v.doc?.result,pending:false});
    if(v.doc?.result==='granted:1'){grantedAt??=Date.now();return Date.now()-grantedAt>=800;}if(v.doc?.result?.startsWith('denied')||v.doc?.result?.startsWith('error')||v.doc?.result?.startsWith('unsupported'))throw Error('Remembered allow not used');return false;
  },'real refreshed request granted without new prompt',7000);
  const state=await profileState(p,'allow');assert.equal(state.choice.updatedAt,saved.updatedAt,'No new stored consent');
  await check('remembered-allow-after-refresh-no-extra-decision',{observed,state,db:dbState('live',1,1,'allow',p)});return reloaded;
}
async function revoke(p){
  const owner=browserOwner(p);await shellClick('.bw-profile',null,{owner});await app.waitFor(js(q=>!!document.querySelector(q),profileDialog),10000);
  const row=await app.evaluate(js((d,o,caption)=>{const root=document.querySelector(d),uls=[...root?.querySelectorAll('.bw-profile-detail ul.bw-list')??[]],items=uls.flatMap((ul,u)=>[...ul.children].map((li,i)=>({li,u:u+1,i:i+1}))).filter(({li})=>li.querySelector('strong')?.textContent===o&&li.querySelector('small')?.textContent===caption&&[...li.querySelectorAll('button')].some(b=>b.textContent.trim()==='撤销'));
    return items.length===1?{u:items[0].u,i:items[0].i,text:items[0].li.innerText}:null;},profileDialog,fixture.origin,permission+' · 允许'));
  assert(row&&row.i>0&&row.u>0,'Unique exact current profile allow row');
  // The current profile is selected by the real profile UI. Exactly one
  // allowed row in the whole owned profile scope was separately verified.
  const target=await app.evaluate(js((d,u,i)=>{const root=document.querySelector(d),ul=root?.querySelectorAll('.bw-profile-detail ul.bw-list')[u-1],li=ul?.children[i-1];if(!ul||!li)return null;
    const all=[...root.querySelectorAll('.bw-profile-detail ul')];return{index:all.indexOf(ul)+1,matching:li.querySelector('strong')?.textContent};},profileDialog,row.u,row.i));assert(target&&target.matching===fixture.origin);
  const selector=profileDialog+' .bw-profile-detail > ul:nth-of-type('+target.index+') > li:nth-child('+row.i+') > button';
  const actualSelector=await app.evaluate(js((q,d,u,i)=>{const e=document.querySelector(q),root=document.querySelector(d),li=root?.querySelectorAll('.bw-profile-detail ul.bw-list')[u-1]?.children[i-1];return e&&li?.contains(e)?q:null;},selector,profileDialog,row.u,row.i));
  // C19's actual nth-of-type layout; a changed structure stops without input.
  assert.equal(actualSelector,selector);
  await shellClick(selector,'撤销',{owner,rowExpected:{origin:fixture.origin,caption:permission+' · 允许'}});
  const state=await until(async()=>{const rows=await app.invoke('browser.profileSiteStates',{taskId:t.taskId});if(rows.some(x=>x.state.permissions.length))return null;return await profileState(p,null);},'own actual permission row revoked',8000);
  const screenshot=await shot('actual-permission-revoked');await shellClick(profileDialog+' button','完成',{owner});await app.waitFor(js(d=>!document.querySelector(d),profileDialog),6000);
  await check('real-profile-revoke-exact-grant',{before:row,state,db:dbState('live',1,1,null,p),screenshot});
}
async function closePending(p,q,first){
  const s=await snapshot();assertOwnPrompt(s.permission,p,fixture.origin);assert.equal(s.permission.id,q.id);assert.notEqual(q.id,first.id);assert.equal(s.tabs.length,1);
  assert.equal((await profileState(p,null)).choice,null);assert.equal(s.activeId,p.id);
  const selector='div.agent-surface-tab:has(>button[role="tab"][aria-selected="true"][data-browser-url='+JSON.stringify(p.url)+']) > button[aria-label='+JSON.stringify('关闭网页 '+fixtureTitle)+']';
  await shellClick(selector);
  const retired=await until(async()=>{const s=await snapshot(),gone=await main((E,id)=>{const wc=E.webContents.fromId(id);return !wc||wc.isDestroyed();},p.wc);return s.tabs.length===0&&!s.permission&&gone?{activeId:s.activeId??null,prompt:s.permission??null,tabCount:s.tabs.length,nativeDestroyed:gone}:null;},'actual closed page cancels and invalidates pending request',10000);
  const state=await profileState(p,null);await check('real-close-cancels-new-request-no-persisted-authorization',{q,retired,state,db:dbState('live',1,1,null,p),screenshot:await shot('actual-request-cancelled')});
}
async function quit(){
  assert(app);const instance=app,pid=instance.processId;let requestError=null;
  try{await main(E=>{setTimeout(()=>E.app.quit(),50);return true;});}catch(e){requestError=String(e.message);}
  // Inspector closure is not mistaken for process failure. Observe original
  // ChildProcess independently for the original normal exit deadline first.
  try{normalExit=await instance.waitForExit(20000);report.exit={...normalExit,requestError};assert.equal(normalExit.pid,pid);assert.equal(normalExit.code,0);assert.equal(normalExit.signal,null);assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});}
  catch(e){report.exit={...report.exit,requestError,error:String(e.message),cleanupOnlyFallback:true};throw e;}
  finally{await stopFront().catch(e=>{report.cleanupObserverError=String(e.message);});await instance.close();app=null;await save();}
}
async function portFree(port){const s=netServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen({host:'127.0.0.1',port,exclusive:true},resolve);});await new Promise((resolve,reject)=>s.close(e=>e?reject(e):resolve()));}

await progress({stage:'starting',instruction:'独立合成环境准备，等待实际本人提示；仅协调者在B11释放后执行。'});
try{
  fixture=await openFixture(report.requests);report.fixture={origin:fixture.origin,site:fixture.site};await save();
  stage='native-startup';await start();
  await check('fresh-isolated-startup-no-secrets',{db:dbState('live',0,0),startupScreenshot:await shot('fresh-real-startup')});
  stage='synthetic-task-prerequisite';
  const detected=await app.invoke('agents.customToolPath','codex',cli),tool=detected.tool;
  assert(tool.installed&&tool.kind==='codex'&&tool.version==='0.169.0');
  const provider=await app.invoke('agents.saveProvider',{name:'M16 B08 own synthetic keyless',preset:'magpie',endpoints:{responses:fixture.origin+'/v1',anthropic:fixture.origin+'/'},models:[{id:model,name:model,contextWindow:null,offline:false}]});
  const checked=await app.invoke('agents.checkProviderModel',provider.id,'codex',model);
  assert.equal(checked.models.find(m=>m.id===model)?.availability.codex,'available');assert(report.requests.ping.length>=1);
  const profile=await app.invoke('agents.save',{name:'M16 B08 own synthetic Codex',toolId:tool.id,source:'provider',providerId:provider.id,models:[model],defaultModel:model,isDefault:true});
  const p=await app.invoke('projects.create',{name:'M16 B08 site permission synthetic',aliases:[],description:'Only synthetic idle-detection permission fixture',rulesPath:null},[{label:'fixture',path:project}]);
  const dirs=(await app.invoke('projects.get',p.id)).dirs;assert.equal(dirs.length,1);
  const task=await app.invoke('agentTasks.create',{projectId:p.id,dirId:dirs[0].id,cwd:project,title:'M16 B08 site permission',profileId:profile.id,model,tier:'ask',carryExtensions:false});
  t={taskId:task.taskId,projectId:p.id};report.task={...t,enginePrerequisite:{id:tool.id,version:tool.version,sha:cliPin,provider:provider.id,profile:profile.id,noNativeModelTurn:true}};
  await app.cdp('Page.reload');await selectTask();page=await newTab();report.page=page;
  await check('fresh-real-project-profile-no-permission',{state:await profileState(page,null),db:dbState('live',1,1,null,page)});
  assert.equal(report.requests.offscope,0,'Unexpected traffic before personal handoff');
  stage='person-initial-allow';startFront();const before=await foreground();
  const original=await stablePage(page,'original document',{wantResult:'initial'});assert(await observeUserClick(page));
  assert(frontProof()&&(await own()).focused);await pageRequestClick(page);const first=await prompt(page);
  report.beforePersonalFront=before;const saved=await humanAllow(page,first);
  stage='real-refresh-remembered-allow';await progress({stage:'automatic-continuation',instruction:'本人允许已收到；请勿再点任何按钮、不要切换窗口。刷新、撤销及再询问由测试通过真实界面操作。'});
  const allowed=await stablePage(page,'after personal allow',{same:original,wantResult:'granted:1'}),refreshed=await refresh(page,allowed,saved);
  stage='real-revoke';const beforeRevoke=await stablePage(page,'before revoke',{same:refreshed,wantResult:'granted:1'});await revoke(page);
  stage='real-reask-and-cancel';const same=await stablePage(page,'after dialog closed before request',{same:beforeRevoke,wantResult:'granted:1'});await check('same-document-native-front-restored-after-revocation',{before:beforeRevoke,after:same});
  await pageRequestClick(page);const second=await prompt(page);assert.notEqual(second.id,first.id);await closePending(page,second,first);
  assert.equal(report.requests.offscope,0,'No offscope request allowed');
  stage='normal-exit';await quit();
  const db=dbState('closed',1,1,null,page);await check('normal-own-exit-closed-db-no-extra-permission-or-secret',{exit:normalExit,db});
  const fixturePort=fixture.port;await fixture.close();fixture=null;await portFree(fixturePort);await portFree(report.start.startup.cdpPort);
  report.cleanup={normalExit:true,fixturePortFree:true,cdpPortFree:true,originalObserverStopped:!!report.frontObserverExit,privateDataPreservedForEvidence:true};assert(!report.cleanupObserverError);
  report.status='actual-personal-application-allow-refresh-revoke-reask-cancel-pass';
}catch(error){
  report.status='failed-or-incomplete';report.failedStage=stage;report.error=String(error.stack??error);manualPending=false;
  if(error.electronStartupProcess)report.startupDiagnostic={process:error.electronStartupProcess,startup:error.electronStartupObservation??null};
  if(app){
    try{await own();report.failureScreenshot=await shot('failed-stage');}catch{}
    try{await quit();}catch(e){report.cleanupError=String(e.message);}
  }
  // Do not turn a failed case into new business input or mutate data to make
  // it appear revoked. Any synthetic residual remains in this isolated root.
  if(normalExit?.code===0&&page)try{const x=JSON.parse(execFileSync('/usr/bin/python3',[join(support,'db-observe.py'),root,join(userData,'smartdd.db'),'closed'],{encoding:'utf8'}));report.failedClosedDb=x;}catch{}
}finally{
  if(front)try{await stopFront();}catch(e){report.cleanupObserverError=String(e.message);}
  if(fixture)try{await fixture.close();}catch(e){report.fixtureCleanupError=String(e.message);}
  report.finishedAt=Date.now();stage='finished';await progress({stage:'finished',status:report.status,error:report.error??null,checks:report.checks.length,instruction:'本轮独立应用已按记录退出或清理；此结果仅 B08.2 合成站点应用层许可，不代表实际系统许可或真实站点登录。'});
  if(report.status!=='actual-personal-application-allow-refresh-revoke-reask-cancel-pass')process.exitCode=1;
}
