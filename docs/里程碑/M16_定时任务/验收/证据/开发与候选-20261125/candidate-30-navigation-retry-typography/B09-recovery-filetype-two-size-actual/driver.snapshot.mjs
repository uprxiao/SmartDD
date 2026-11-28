// Actual ordinary recovery UI from a deterministic filesystem-type fault in a
// freshly created PRIVATE empty profile. No source import, key provider, hook,
// decryption or actual credential path is used. Original lost-ACK business fault
// is NOT claimed; this is a candidate equivalent host visual state only.
import assert from 'node:assert/strict';import {createHash,randomUUID} from 'node:crypto';import {mkdir,mkdtemp,readFile,realpath,writeFile,cp,lstat,readdir,rmdir} from 'node:fs/promises';import {join} from 'node:path';import {execFileSync} from 'node:child_process';import {createServer} from 'node:http';import {once} from 'node:events';import {openElectron,pause} from './isolated-electron.mjs';import {repo,support,specs,expectedArgs,digest,verifyPins,verifySideRoot,fullscreenVerdict} from '../guards-c30-final.mjs';import {verifyNativeRunner,cliPath,cliSha} from '../c30-mapped-approvals-1920/pins.mjs';import {focusPlan,geometryVerdict,recognizedBackground1440,chooseBackgroundTarget} from '../mapped-approvals-1440-cli-background-a/geometry-contract.mjs';import {fixture as makePage} from './page-fixture.mjs';import {verifyFiletypeContract} from './fault-contract.mjs';
import {verifyResumePrior,retainFailure} from './prior-contract.mjs';import {exactBlockedOriginal,chooseReveal,originalUiIdentity,urlSelector,blankCloseSelector,selectedBlankCloseSelector} from './reveal-contract.mjs';
assert(process.cwd()===repo&&process.argv[2]==='--coordinator-authorized-b09-c30-recovery-filetype-resume-v2');
assert.equal(process.argv.length,15);const scope=process.argv[12];assert.equal(scope,'--scope=all','Retained original eight tasks and fault directories require exact all scope');const verifiedPrior=await verifyResumePrior(process.argv.slice(13,15));
const selectedSizes=[[1440,900],[1920,1080]].filter(s=>scope==='--scope=all'||scope==='--scope='+s[0]),expectedPairKeys=selectedSizes.length*4*3;
const pins=await verifyPins(process.argv.slice(3,10)),cli=await verifyNativeRunner(process.argv.slice(10,12));const ownSupport=join(support,'c30-recovery-filetype-resume-v2');
const preflight=JSON.parse(await readFile(join(ownSupport,'preflight.json'),'utf8'));assert.equal(preflight.actualApp,false);assert.equal(preflight.keys.length,24);assert.equal(preflight.retainedOriginalFaults,8);assert.equal(preflight.actualPriorBlockedUIReplayed,true);assert.equal(preflight.retainedActualAuxiliaries,1);
for(const [file,sha] of Object.entries(preflight.files))assert.equal(await digest(join(ownSupport,file)),sha,'Frozen private file '+file);
for(const [file,sha] of Object.entries(preflight.supportFiles))assert.equal(await digest(join(support,file)),sha,'Frozen shared support '+file);
const filetypeContract=await verifyFiletypeContract(),root=await mkdtemp('/private/tmp/willyou-m16-b09-c30-filetype-recovery-pair-');
const retained=await retainFailure(verifiedPrior,root);
let home,cliHome,userData,sideRoot,app,executable,stage='setup',fixtureProfileId,ownWindowTitle,rootIdentity,fullscreenDisplay,currentSize=selectedSizes[0],currentSide;
const uuid=/^[0-9a-f-]{36}$/i,model='m16-codex-one';
const useSide=async side=>{assert(['old-clean','new'].includes(side));const own=await mkdtemp('/private/tmp/willyou-m16-b09-c30-final-side-');sideRoot=own;home=join(own,'home');cliHome=join(own,'cli-home');userData=join(own,'data');for(const dir of [home,cliHome,userData,join(home,'.config'),join(cliHome,'.codex'),join(cliHome,'.claude'),join(own,'tmp')])await mkdir(dir,{recursive:true,mode:0o700});await verifySideRoot(own);return {side,own,home,cliHome,userData,initialDataEmpty:true};};
const report={schema:'M16-B09-C30-filetype-recovery-actual-A-candidate',root,pins,cli,filetypeContract,selectedSizes,expectedPairKeys,displayBySize:structuredClone(verifiedPrior.previous.displayBySize),retainedPrior:{...retained,priorActualCaptures:0,priorOldNormalExits:verifiedPrior.previous.launches.map(x=>x.exit)},scope:'Candidate visual keys on real 1440/DPR2 and/or 1920/DPR1 pair. Actual filesystem type fault at recovery journal; NOT historical lost-ACK business fault. No source or key access.',actions:[],launches:structuredClone(verifiedPrior.previous.launches),sides:[],captures:[],requests:structuredClone(verifiedPrior.previous.requests),originalRows:[]};const persist=()=>writeFile(join(root,'result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});const progress=async x=>{await writeFile(join(root,'progress.json'),JSON.stringify(x,null,2)+'\n',{mode:0o600});await persist();console.log(JSON.stringify(x));};await progress({stage:'starting',root,scope,expectedPairs:expectedPairKeys});for(const f of ['driver.mjs','isolated-electron.mjs','page-fixture.mjs','fault-contract.mjs','callback-contract.mjs','preflight.mjs','preflight.json','reference-map.json','reveal-contract.mjs','prior-contract.mjs'])await cp(join(ownSupport,f),join(root,f.replace('.mjs','.snapshot.mjs')));
const allow=new Set(['PATH','LANG','LC_ALL','USER','LOGNAME','SHELL']);for(const n of Object.keys(process.env))if(!allow.has(n))delete process.env[n];const server=createServer(async(req,res)=>{if(req.method!=='POST'||req.url!=='/v1/responses'){res.writeHead(403).end();return;}let n=0;const chunks=[];for await(const c of req){n+=c.length;if(n>100000){res.writeHead(413).end();return;}chunks.push(c);}const q=JSON.parse(Buffer.concat(chunks).toString());if(q.model!==model||q.input!=='Call the wy_ping tool exactly once.'||!(q.tools??[]).some(t=>t.name==='wy_ping')){res.writeHead(400).end('{}');return;}const id='resp_'+randomUUID(),item={type:'function_call',call_id:'call-probe',name:'wy_ping',arguments:'{}'};res.writeHead(200,{'content-type':'text/event-stream'});const ev=(t,v)=>res.write('event: '+t+'\ndata: '+JSON.stringify({type:t,...v})+'\n\n');ev('response.created',{response:{id,status:'in_progress'}});ev('response.output_item.done',{item});ev('response.completed',{response:{id,status:'completed',output:[item]}});res.end();report.requests.push({side:currentSide,kind:'synthetic-provider-probe'});});server.on('connect',(_r,s)=>s.destroy());server.listen({host:'127.0.0.1',port:3425,exclusive:true});try{await once(server,'listening');}catch(e){report.status='fixture-port-unavailable-no-app-started';report.error=String(e.message);await persist();throw e;}const origin='http://127.0.0.1:'+server.address().port;assert.equal(origin,'http://127.0.0.1:3425','Canonical own keyless provider; no fallback dynamic provider or secret');
const local=makePage();try{local.server.listen({host:'127.0.0.1',port:verifiedPrior.port,exclusive:true});await once(local.server,'listening');}catch(e){report.status='fixture-original-page-port-unavailable-no-app-started';report.error=String(e.message);await persist();server.closeAllConnections();await new Promise(r=>server.close(r));throw e;}const pageOrigin='http://127.0.0.1:'+local.server.address().port;assert.equal(pageOrigin,verifiedPrior.manifest.actualPageOrigin);report.fixtureOrigins={provider:origin,page:pageOrigin};
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

async function runApp(bundle,expected,label,nativePin,resume=null){
 assert(!app);assert.equal(await digest(join(bundle,'Contents/Resources/app.asar')),expected);executable=join(bundle,'Contents/MacOS/WillYou');stage=label;
 app=await openElectron({userData,executable,cwd:sideRoot,env:{HOME:home,TMPDIR:join(sideRoot,'tmp'),SMARTDD_CLI_HOME:cliHome,CODEX_HOME:join(cliHome,'.codex'),CLAUDE_CONFIG_DIR:join(cliHome,'.claude'),XDG_CONFIG_HOME:join(home,'.config'),HTTP_PROXY:origin,HTTPS_PROXY:origin,ALL_PROXY:origin,NO_PROXY:'127.0.0.1,localhost',http_proxy:origin,https_proxy:origin,all_proxy:origin,no_proxy:'127.0.0.1,localhost'},inspectMain:true,mockKeychainFixture:true,candidatePin:expected,nativePin,resume});
 const pid=await bind();const commandLine=await observeMain(E=>({mockSwitch:E.app.commandLine.hasSwitch("use-mock-keychain"),occurrences:process.argv.filter(x=>x==="--use-mock-keychain").length,cliHome:process.env.SMARTDD_CLI_HOME}));assert(commandLine.mockSwitch&&commandLine.occurrences===1&&commandLine.cliHome===cliHome);await until(async()=>{const actual=await windows();return actual.some(w=>w.visible&&!w.minimized&&w.children.some(c=>/\/out\/renderer\/index\.html/.test(c.url)))},'actual isolated visible trusted shell',15000);report.launches.push({label,pid,bundle,expected,nativePin,commandLine,userData,home,cliHome,exeSha:await digest(executable),startup:app.startupObservation,at:Date.now()});await persist();return pid;
}
async function quit(){const live=app;assert(live);let quitRequestError;try{await observeMain(E=>{setTimeout(()=>E.app.quit(),50);return true});}catch(e){quitRequestError=String(e);}try{const exit=await live.waitForExit(20000);if(quitRequestError)report.launches.at(-1).quitRequestError=quitRequestError;report.launches.at(-1).exit=exit;assert.equal(exit.code,0);assert.equal(exit.signal,null);const finalCounts=JSON.parse(execFileSync('python3',['-c','import sqlite3,json,sys\nc=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro&immutable=1",uri=True)\nprint(json.dumps({"secretCount":c.execute("select count(*) from app_secrets").fetchone()[0],"providerSecretCount":c.execute("select count(*) from ai_providers where secret_ref is not null").fetchone()[0]}))',join(userData,'smartdd.db')],{encoding:'utf8'}));report.launches.at(-1).finalCounts=finalCounts;assert.deepEqual(finalCounts,{secretCount:0,providerSecretCount:0});assert(!(await readdir(userData)).includes('smartdd.db-wal'));report.launches.at(-1).dbSha=await digest(join(userData,'smartdd.db'));return {pid:exit.pid,dbSha:report.launches.at(-1).dbSha};}catch(error){report.launches.at(-1).quitError=String(error.message);await live.close();throw error;}finally{await live.close();app=null;await persist();}}


async function actualGeometry(){return app.evaluate(`(()=>{const p=document.querySelector('${panelSelector}'),s=document.querySelector('[role=separator][aria-label="调整文件区域宽度"]'),v=document.querySelector('[data-testid=browser-viewport]'),a=document.querySelector('[aria-label="网页地址"]');const r=e=>e?{x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}:null;return {theme:document.documentElement.classList.contains('ydark')?'dark':'light',inner:[innerWidth,innerHeight],dpr:devicePixelRatio,panel:r(p),viewport:r(v),address:r(a),separator:s?{value:Number(s.getAttribute('aria-valuenow')),min:Number(s.getAttribute('aria-valuemin')),max:Number(s.getAttribute('aria-valuemax')),rect:r(s)}:null,fonts:document.fonts.status}})()`);}
async function nativeFullscreen(){return observeMain(E=>{
 const roots=E.BaseWindow.getAllWindows().filter(w=>!w.isDestroyed()).map(w=>({w,shells:[...new Map([w.webContents,...w.contentView.children.map(v=>v.webContents)].filter(v=>v&&!v.isDestroyed()&&v.getURL().startsWith('file:')&&v.getURL().includes('/out/renderer/index.html')).map(v=>[v.id,v])).values()]})).filter(x=>x.shells.length);
 if(roots.length!==1||roots[0].shells.length!==1)throw Error('Unique original trusted root/shell required');const {w,shells}=roots[0],c=shells[0],b=w.getBounds(),d=E.screen.getDisplayMatching(b),native={rootId:w.id,windowTitle:w.getTitle(),shellId:c.id,visible:w.isVisible(),minimized:w.isMinimized(),focused:w.isFocused(),fullScreen:w.isFullScreen(),bounds:b,contentBounds:w.getContentBounds(),displays:E.screen.getAllDisplays().map(x=>({id:x.id,bounds:x.bounds,workArea:x.workArea,scaleFactor:x.scaleFactor})),actualDisplay:{id:d.id,bounds:d.bounds,workArea:d.workArea,scaleFactor:d.scaleFactor},shellZoomFactor:c.getZoomFactor()};return native;
 });}
async function setOwnTitle(side){const current=await nativeFullscreen();rootIdentity={rootId:current.rootId,shellId:current.shellId};ownWindowTitle='WillYou · M16 B09 '+currentSize[0]+' 原恢复文件类型 '+(side==='old-clean'?'旧版':'C30')+' '+root.split('-').at(-1);const actual=await observeMain((E,id,shellId,title)=>{const w=E.BaseWindow.fromId(id);if(!w||w.isDestroyed()||!(w.webContents?.id===shellId||w.contentView.children.some(v=>v.webContents?.id===shellId)))throw Error('Exact original test window required');w.setTitle(title);return w.getTitle();},rootIdentity.rootId,rootIdentity.shellId,ownWindowTitle);assert.equal(actual,ownWindowTitle);}
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
async function geometryFor(size){
 const n=await nativeFullscreen(),g=await actualGeometry();assert.equal(n.rootId,rootIdentity.rootId);assert.equal(n.shellId,rootIdentity.shellId);assert.equal(n.windowTitle,ownWindowTitle);
 const exact=size[0]===1440?geometryVerdict(n,g,size,fullscreenDisplay??report.displayId):size[0]===1920&&fullscreenVerdict(n,g);return {native:n,actual:g,exact};
}
// A-only fixture: a real normal Electron resize, never OS input, show, focus,
// or a synthetic viewport override. Serialized independently by shellGuard.
function resizeOwnedRoot1440(E,id,shellId,title,target){
 const roots=E.BaseWindow.getAllWindows().filter(w=>!w.isDestroyed()).map(w=>({w,shells:[...new Map([w.webContents,...w.contentView.children.map(v=>v.webContents)].filter(v=>v&&!v.isDestroyed()&&v.getURL().startsWith('file:')&&v.getURL().includes('/out/renderer/index.html')).map(v=>[v.id,v])).values()]})).filter(x=>x.shells.length);
 if(roots.length!==1||roots[0].shells.length!==1||roots[0].w.id!==id||roots[0].shells[0].id!==shellId)throw Error('Exact unique original root/shell required for background A fixture');
 const w=E.BaseWindow.fromId(id),c=roots[0].shells[0];if(!w||w!==roots[0].w||w.isDestroyed()||!w.isVisible()||w.isMinimized()||w.isFullScreen()||w.getTitle()!==title||c.getZoomFactor()!==1)throw Error('Original visible ordinary isolated root required');
 const d=E.screen.getAllDisplays().find(x=>x.id===target.id);if(!d||d.scaleFactor!==2||d.bounds.width!==1512||d.bounds.height!==982||d.workArea.width<1440||d.workArea.height<900||JSON.stringify(d.workArea)!==JSON.stringify(target.workArea))throw Error('Actual target display/workArea changed');
 const beforeFocus=w.isFocused(),beforeBounds=w.getBounds(),r=d.workArea,requested={x:r.x+Math.floor((r.width-1440)/2),y:r.y+Math.floor((r.height-900)/2),width:1440,height:900};
 w.setBounds(requested);
 const afterFocus=w.isFocused();if(!beforeFocus&&afterFocus)throw Error('Background A resize unexpectedly activated root; stop');
 return {beforeFocus,afterFocus,beforeBounds,requested,nativeBounds:w.getBounds(),content:w.getContentBounds(),display:E.screen.getDisplayMatching(w.getBounds()).id,activationRequested:false,systemInput:false};
}
async function prepare1440(side){
 const first=await geometryFor([1440,900]),locked=report.displayId??null;const target=chooseBackgroundTarget(first.native,locked);assert(target,'Actual eligible internal 1512x982 DPR2 display and 1440x900 workArea required');
 const commit=async(q,mode,extra={})=>{assert(recognizedBackground1440(q,target.id),'Exact actual visible ordinary internal 1440 window required');const actualId=q.native.actualDisplay.id;assert(!report.displayId||report.displayId===actualId);report.displayId=actualId;fullscreenDisplay=actualId;const result={exact:true,first,ready:q,operatorMode:mode,backgroundAOnly:true,systemInput:false,...extra,displayId:actualId};await progress({stage:'actual-recovery-1440-background-a-observed',side,root,pid:app.processId,windowTitle:ownWindowTitle,displayId:actualId,mode,nativeFocused:q.native.focused});return result;};
 let stable=null;const stableExact=async()=>{const q=await geometryFor([1440,900]);if(!recognizedBackground1440(q,target.id)){stable=null;return null;}const sig=JSON.stringify([q.native.rootId,q.native.shellId,q.native.actualDisplay.id,q.native.bounds,q.native.contentBounds,q.actual.inner,q.actual.dpr,q.native.shellZoomFactor]);if(stable?.sig!==sig){stable={sig,at:Date.now()};return null;}return Date.now()-stable.at>=250?q:null;};
 if(recognizedBackground1440(first,target.id))return commit(await until(stableExact,'actual already-exact background A geometry stability',3500),'existing exact actual ordinary window; read-only recognition',{nativeWindowBoundsSet:false});
 await progress({stage:'prepare-owned-1440-background-a-bounds',side,root,pid:app.processId,windowTitle:ownWindowTitle,rootIdentity,first,target,authorization:'A fixture window geometry only; no native system input or activation'});
 const receipt=await observeMain(resizeOwnedRoot1440,rootIdentity.rootId,rootIdentity.shellId,ownWindowTitle,target);
 report.actions.push({stage,kind:'background-A-exact-own-window-setBounds',receipt,at:Date.now()});await persist();
 const ready=await until(stableExact,'actual 1440x900 root/content/CSS internal DPR2 and stable native display',10000);
 return commit(ready,'normal exact own window bounds for A visual fixture only',{nativeWindowBoundsSet:true,receipt});
}
async function fullscreenObservation(){return geometryFor([1920,1080]);}
async function waitForUserFullscreen(side){
 await setOwnTitle(side);const first=await fullscreenObservation();
 const external=first.native.displays.filter(d=>d.bounds.width===1920&&d.bounds.height===1080&&d.scaleFactor===1&&(!report.displayId||d.id===report.displayId));assert(external.length,'No actual 1920x1080 DPR1 display available');
 const hand={stage:'await-user-real-fullscreen',side,root,pid:app.processId,exe:executable,windowTitle:ownWindowTitle,rootIdentity,externalDisplays:external,first,deadline:Date.now()+360000,instruction:'仅将此准确的隔离 WillYou 测试窗移到1920×1080外屏并点击绿色系统全屏，完成后暂留前台。'};
 await progress(hand);let stable=null;try{const ready=await until(async()=>{const q=await fullscreenObservation();if(!q.exact||!q.native.focused){stable=null;return null;}const id=q.native.actualDisplay.id;if(stable?.id!==id)stable={id,start:Date.now()};return Date.now()-stable.start>=500?q:null;},'actual native UI fullscreen 1920x1080 external DPR1',360000);fullscreenDisplay=ready.native.actualDisplay.id;assert(!report.displayId||report.displayId===fullscreenDisplay,'Old/new must use exact same physical display');report.displayId=fullscreenDisplay;await progress({stage:'user-real-fullscreen-observed',side,root,pid:app.processId,windowTitle:ownWindowTitle,observed:ready});return {exact:true,first,ready,physicalHandoff:hand,operatorMode:'normal actual native UI geometry, A only; no S credit'};}catch(error){const last=await fullscreenObservation();return {exact:false,first,last,physicalHandoff:hand,error:String(error)};}
}
async function requireGeometry(){const q=await geometryFor(currentSize);assert(q.exact&&q.native.actualDisplay.id===report.displayId,'Original actual size/display/zoom lost; do not substitute');return q;}
async function setFocusEmulation(enabled){const before=(await nativeFullscreen()).focused;await app.cdp('Emulation.setFocusEmulationEnabled',{enabled});const after=(await nativeFullscreen()).focused;assert(!(!before&&after),'Page focus emulation unexpectedly affected native focus');report.actions.push({stage,kind:'page-only-focus-emulation',enabled,nativeBefore:before,nativeAfter:after,at:Date.now()});}
async function captureShell(label){const before=await requireGeometry(),file=join(root,label+'-shell.png');await app.screenshot(file);const raw=await readFile(file);assert.equal(raw.subarray(1,4).toString(),'PNG');const size=[raw.readUInt32BE(16),raw.readUInt32BE(20)];const dpr=currentSize[0]===1440?2:1;assert.deepEqual(size,currentSize.map(n=>n*dpr));const after=await requireGeometry();return {file,sha:await digest(file),size,logicalSize:currentSize.slice(),dpr,nativeBefore:before.native,nativeAfter:after.native,boundary:'Actual trusted shell screenshot, separate native page not composited'};}
async function switchTask(id){
 assert(uuid.test(id));const selector=sidebar(id);const visible=()=>app.evaluate(js(s=>{const e=document.querySelector(s),r=e?.getBoundingClientRect();return !!r?.width&&!!r.height;},selector));
 if(!await visible()&&await app.evaluate('!!document.querySelector("button[title=\\"显示/隐藏侧边栏\\"]")'))await shellClick('button[title="显示/隐藏侧边栏"]');
 await until(visible,'visible exact private task sidebar',18000);await shellClick(selector);await app.waitFor('!!document.querySelector(".agent-composer textarea")',10000);
}
function readTaskSidebarBinding(taskSelector,toggleSelector){const rows=[...document.querySelectorAll(taskSelector)],toggles=[...document.querySelectorAll(toggleSelector)],row=rows.length===1?rows[0]:null,toggle=toggles.length===1?toggles[0]:null;const visible=e=>{if(!e||e.closest('[hidden]')||e.matches(':disabled'))return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};const controlId=toggle?.getAttribute('aria-controls'),group=controlId?document.getElementById(controlId):null;return {sidebarCollapsed:!!document.querySelector('.app.codex-frame.sidebar-collapsed'),projectVisible:visible(toggle),expanded:toggle?.getAttribute('aria-expanded')??null,taskVisible:visible(row),taskOwned:!!group&&!!row&&group.contains(row),current:row?.getAttribute('aria-current')??null};}
async function selectTask(task){const query=sidebar(task.taskId),project='[data-testid=sidebar-project][data-project-id='+JSON.stringify(task.projectId)+']',toggle=project+' [data-testid=sidebar-project-toggle]',read=()=>app.evaluate(js(readTaskSidebarBinding,query,toggle));const first=await read();if(first.sidebarCollapsed)await shellClick('button[title="显示/隐藏侧边栏"]');const state=await until(async()=>{const s=await read();return s.projectVisible&&['true','false'].includes(s.expanded)?s:null;},'actual private project visible',10000);if(state.expanded==='false')await shellClick(toggle+'[aria-expanded="false"]');await until(async()=>{const s=await read();return s.projectVisible&&s.expanded==='true'&&s.taskVisible&&s.taskOwned?s:null;},'actual own task hydrated',15000);await switchTask(task.taskId);await app.waitFor(js(s=>document.querySelector(s)?.getAttribute('aria-current')==='page',query),10000);}
async function prepareProfile(){const detected=await app.invoke('agents.customToolPath','codex',cli.path),tool=detected.tool;assert(tool.kind==='codex'&&tool.installed&&tool.version===cli.version&&await realpath(tool.executable)===cli.path&&await digest(cli.path)===cli.sha);const p=await app.invoke('agents.saveProvider',{name:'M16 recovery local keyless probe',preset:'magpie',endpoints:{responses:origin+'/v1',anthropic:origin+'/'},models:[{id:model,name:model,contextWindow:null,offline:false,availability:{codex:'available',claude:'untested',antigravity:'untested'}}]});const checked=await app.invoke('agents.checkProviderModel',p.id,'codex',model);assert.equal(checked.models.find(x=>x.id===model)?.availability.codex,'available');assert(report.requests.some(x=>x.side===currentSide&&x.kind==='synthetic-provider-probe'),'Actual canonical local model probe must be observed');const a=await app.invoke('agents.save',{name:'M16 own recovery fixture',toolId:tool.id,source:'provider',providerId:p.id,models:[model],defaultModel:model,isDefault:true});fixtureProfileId=a.id;return {provider:p.id,agentProfile:a.id};}
async function createTask(side,theme,width,size){const key=theme+'-rw'+width+'-win'+size.join('x'),dir=join(sideRoot,'project-'+key);await mkdir(dir,{mode:0o700});assert.equal(await realpath(dir),dir);const p=await app.invoke('projects.create',{name:'M16 本机恢复 '+key,aliases:[],description:'Own empty profile only',rulesPath:null},[{label:'fixture',path:dir}]);const row=(await app.invoke('projects.get',p.id)).dirs[0];assert.equal(row.path,dir);const t=await app.invoke('agentTasks.create',{projectId:p.id,dirId:row.id,cwd:dir,title:'检查多平台安装包',profileId:fixtureProfileId,model,effort:'medium',tier:'ask',carryExtensions:false});return {side,key,theme,width,size:size.slice(),taskId:t.taskId,projectId:p.id,dir,url:pageOrigin+'/page?combo='+key};}
const profiles=task=>app.invoke('browser.profileSiteStates',{taskId:task.taskId});async function ownProfile(task){const records=await profiles(task);assert.equal(records.length,1);const q=records[0];assert(q.profile.scope==='project'&&q.profile.owner.id===task.projectId&&q.profile.source===null&&q.profile.id===task.page.profile);assert.deepEqual(q.state.permissions,[]);assert.deepEqual(q.state.certificates,[]);return q;}
async function bootstrapTask(task){await selectTask(task);const page=await newTab(task.taskId,task.url);task.page=page;const record=await ownProfile(task);assert.equal(record.importState,'ready');assert(/^project-[0-9a-f]{10,40}$/.test(record.profile.id));const observed=await observeMain(async(E,id,url,storage)=>{const w=E.webContents.fromId(id);if(!w||w.isDestroyed()||w.getURL()!==url||!url.startsWith('http://127.0.0.1:')||!w.session.storagePath?.startsWith(storage+'/Partitions/wy-browser-'))throw Error('Exact own local bootstrap page required');return {title:w.getTitle(),marker:await w.executeJavaScript('document.body.innerText.includes("无真实账号或Cookie")'),url:w.getURL()};},page.wc,page.url,userData);assert(observed.marker);task.bootstrap={record,observed};await persist();}
async function setFaults(tasks){const d=join(userData,'browser','import-journal');assert.equal(await realpath(d),d);assert.deepEqual(await readdir(d),[]);for(const t of tasks){const p=join(d,t.page.profile+'.bin');await mkdir(p,{mode:0o700});const z=await lstat(p);assert(z.isDirectory()&&!z.isSymbolicLink()&&await realpath(p)===p&&!(await readdir(p)).length);t.fault={path:p,ino:z.ino,mode:z.mode,type:'empty-directory-invalid-journal-filetype',released:false};}await persist();}
async function releaseFault(task){const p=task.fault.path,z=await lstat(p);assert.equal(p,join(userData,'browser','import-journal',task.page.profile+'.bin'));assert.equal(await realpath(p),p);assert(z.isDirectory()&&!z.isSymbolicLink()&&z.ino===task.fault.ino&&!(await readdir(p)).length);await rmdir(p);task.fault.released=true;await persist();}
const modal='[data-browser-panel=profiles]',menu='.bw-menu[role=menu]';async function actualBlocked(task){const s=await snapshot(task.taskId),t=s.tabs.find(t=>t.id===task.page.id),p=await ownProfile(task);assert(t&&s.activeId===t.id&&t.profileId===task.page.profile&&t.importState==='needs-attention'&&p.importState==='needs-attention'&&!s.permission&&!s.auth&&!s.external);const ns=await windows(),w=ns.find(v=>v.id===rootIdentity.rootId),j=w.children.findIndex(v=>v.id===rootIdentity.shellId);assert(j>=0&&w.visible&&!w.minimized);const front=w.children.slice(j+1).filter(v=>v.visible!==false&&v.bounds.width>0);assert.equal(front.length,0,'Recovery-blocked page must not cover trusted shell');return {snapshot:s,profile:p,native:ns};}
function measurePanel(q){const all=[...document.querySelectorAll(q)].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;});if(all.length!==1)return null;const e=all[0],rect=n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,fontSize:s.fontSize,lineHeight:s.lineHeight,background:s.backgroundColor,color:s.color,border:s.border,borderRadius:s.borderRadius,padding:s.padding};};return {rect:rect(e),text:e.innerText,overflow:e.scrollWidth>e.clientWidth+2,buttons:[...e.querySelectorAll('button')].map(b=>({text:b.textContent.trim(),disabled:b.disabled,rect:rect(b)}))};}
async function take(task,state,selector,predicate){stage=task.side+'-'+task.key+'-'+state;const want=async()=>{const ui=await app.evaluate(js(measurePanel,selector));if(!ui||ui.overflow||!predicate(ui))return null;const g=await actualGeometry();if(g.theme!==task.theme||g.dpr!==(currentSize[0]===1440?2:1)||g.inner.join('x')!==currentSize.join('x')||Math.abs(g.panel.width-task.width)>1)return null;return {ui,g};};const before=await until(want,'exact actual target UI '+state,12000),block=await actualBlocked(task),shell=await captureShell(stage),after=await until(want,'same actual target UI after capture',4000);assert.equal(after.ui.text,before.ui.text);const row={side:task.side,key:task.key+'|'+state,state,theme:task.theme,width:task.width,size:task.size,shell,geometry:before.g,ui:before.ui,blocked:block,after,captured:true,passed:false,boundary:'Actual filesystem fault state; no old lost-ACK reproduction or visual verdict'};report.captures.push(row);await persist();return row;}
// Old reference never restored the renderer's panel selection or browser-tab
// strip after cold start. Use its ordinary product UI to expose the original
// logical page. It may create exactly one temporary blank of OUR blocked
// profile; select the original page, close only that auxiliary blank, and
// reassert exact original identity before any captured state. C30 has the real
// restoreBrowser path, so it must expose an existing tab without a new one.
function readRecoverySurface(taskId,pageId,url,legacy){
 const visible=e=>{if(!e||e.closest('[hidden]'))return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
 const task=[...document.querySelectorAll('[data-testid=sidebar-agent-task]')].filter(e=>e.getAttribute('data-task-id')===taskId);
 const tabs=[...document.querySelectorAll('button[role=tab]')],matches=(e,u)=>e.getAttribute('title')===u||e.getAttribute('data-browser-url')===u,original=tabs.filter(e=>matches(e,url)),blanks=tabs.filter(e=>matches(e,'about:blank'));
 const w=[...document.querySelectorAll('.bw-workspace')].filter(e=>e.dataset.browserTask===taskId&&visible(e)&&(legacy?e.getAttribute('data-browser-page')===null:e.dataset.browserPage===pageId));
 const pane=w.length===1?w[0]:null,b=pane?.querySelector('.bw-attention-banner'),selected=original.length===1&&original[0].getAttribute('aria-selected')==='true',addressMatches=pane?.querySelector('[aria-label="网页地址"]')?.value===url;
 return {currentTask:task.length===1&&task[0].getAttribute('aria-current')==='page',originalTabCount:original.length,originalSelected:selected,originalWorkspace:!!pane&&selected&&addressMatches,pageAttribute:pane?.getAttribute('data-browser-page')??null,banner:visible(b)&&b.textContent.includes('当前登录态需要处理')&&b.textContent.includes('BROWSER_UNAVAILABLE'),addressMatches,blankCount:blanks.length,selectedBlankCount:blanks.filter(e=>e.getAttribute('aria-selected')==='true').length,fileVisible:[...document.querySelectorAll('.agent-file-surface')].some(visible)};
}
async function revealBlockedBrowser(task){
 const isLegacy=task.side==='old-clean',retained=task.retainedAuxiliaryIds??[];assert(isLegacy||retained.length===0);assert(retained.length<=1);
 const entry={stage,key:task.key,side:task.side,task:task.taskId,originalPage:task.page.id,originalProfile:task.page.profile,retainedAuxiliaryIds:retained.slice(),auxiliaryActions:[]};report.revealEvidence??=[];report.revealEvidence.push(entry);
 const read=async()=>{const x=await app.evaluate(js(readRecoverySurface,task.taskId,task.page.id,task.url,isLegacy));entry.lastUi=x;return x;};
 const initial=await snapshot(task.taskId);exactBlockedOriginal(initial,task,{auxiliaryIds:retained});let remaining=retained.slice();
 try{
  let ui=await until(async()=>{const x=await read();return x.currentTask?x:null;},'actual current exact own task before browser reveal',5000);entry.initialUi=ui;entry.initial=initial;
  let plan=chooseReveal(ui,isLegacy);entry.plan=plan;await persist();
  if(plan==='wait-existing-restored-tab'){
   ui=await until(async()=>{const x=await read();return x.currentTask&&(x.originalTabCount===1||x.originalWorkspace&&x.banner)?x:null;},'actual existing restored original browser tab, no new C30 tab',10000);
   plan=chooseReveal(ui,false);assert(['already-real-browser-visible','click-exact-original-tab'].includes(plan));entry.restoredUi=ui;entry.finalPlan=plan;
  }
  if(plan==='legacy-open-and-close-auxiliary-blank'){
   assert(isLegacy&&ui.fileVisible&&ui.originalTabCount===0);
   const fresh=await newTab(task.taskId);assert(uuid.test(fresh)&&fresh!==task.page.id&&!remaining.includes(fresh));
   const created=await snapshot(task.taskId);exactBlockedOriginal(created,task,{auxiliaryIds:[...remaining,fresh],activeId:fresh});
   const newBlank={id:fresh,kind:'newly-created-normal-ui-blank',created};entry.auxiliaryActions.push(newBlank);await persist();
   // A retained auxiliary blank can have the same URL/label. The new blank
   // is unambiguously active: exact snapshot ID and unique selected tab.
   const selected=await until(async()=>{const x=await read();return x.currentTask&&x.blankCount===remaining.length+1&&x.selectedBlankCount===1&&x.originalTabCount===1?x:null;},'actual uniquely selected just-created auxiliary tab',10000);newBlank.selectedUi=selected;
   exactBlockedOriginal(await snapshot(task.taskId),task,{auxiliaryIds:[...remaining,fresh],activeId:fresh});
   await shellClick(selectedBlankCloseSelector);
   const closed=await until(async()=>{const q=await snapshot(task.taskId);return q.tabs.length===remaining.length+1&&!q.tabs.some(x=>x.id===fresh)?q:null;},'actual newly-created selected blank closed, all original/retained identities preserved',10000);
   exactBlockedOriginal(closed,task,{auxiliaryIds:remaining,activeId:closed.activeId});newBlank.closed=true;newBlank.afterClose=closed;await persist();
  }
  const live=await snapshot(task.taskId);exactBlockedOriginal(live,task,{auxiliaryIds:remaining,activeId:live.activeId});
  ui=await read();
  if(live.activeId!==task.page.id||!originalUiIdentity(ui,task,isLegacy)){
   await until(async()=>{const x=await read();return x.currentTask&&x.originalTabCount===1?x:null;},'actual unique URL-labelled original browser tab',10000);
   await shellClick(urlSelector(task.url));
   const selected=await until(async()=>{const q=await snapshot(task.taskId);return q.activeId===task.page.id?q:null;},'actual original logical tab selection',10000);
   exactBlockedOriginal(selected,task,{auxiliaryIds:remaining});
  }
  const before=await until(async()=>{const x=await read();return originalUiIdentity(x,task,isLegacy)?x:null;},'actual original blocked browser selected URL and matching pane',12000);entry.originalBeforeTemporaryClose=before;
  exactBlockedOriginal(await snapshot(task.taskId),task,{auxiliaryIds:remaining});
  if(remaining.length){
   assert(isLegacy&&remaining.length===1&&before.blankCount===1&&before.selectedBlankCount===0);
   const retainedBlank={id:remaining[0],kind:'exact retained previous real auxiliary blank',originalUi:before};entry.auxiliaryActions.push(retainedBlank);await persist();
   await shellClick(blankCloseSelector);
   const closed=await until(async()=>{const q=await snapshot(task.taskId);return q.tabs.length===1&&q.activeId===task.page.id?q:null;},'actual retained prior blank closed and original remains',10000);
   exactBlockedOriginal(closed,task);retainedBlank.closed=true;retainedBlank.afterClose=closed;remaining=[];await persist();
  }
  const final=await until(async()=>{const x=await read();return originalUiIdentity(x,task,isLegacy)&&x.blankCount===0?x:null;},'actual exact original blocked browser DOM banner, selected URL and address',12000);
  const finalState=await snapshot(task.taskId);exactBlockedOriginal(finalState,task);entry.finalUi=final;entry.final=finalState;entry.complete=true;await persist();await actualBlocked(task);return true;
 }catch(e){entry.error=String(e.message??e);try{entry.lastUi=await read();entry.lastSnapshot=await snapshot(task.taskId);}catch{}await persist();throw e;}
}
async function testTask(task){assert.deepEqual(task.size,currentSize);stage=task.side+'-'+task.key;await selectTask(task);await actualTheme(task.taskId,task.theme);await selectTask(task);await openPanel();await until(async()=>{const s=await snapshot(task.taskId);return s.activeId===task.page.id&&s.tabs.some(t=>t.id===task.page.id&&t.importState==='needs-attention')?s:null;},'actual startup blocked original private profile',25000);await revealBlockedBrowser(task);await actualKeyboardWidth(task.width);await actualBlocked(task);await shellClick('button[aria-label="浏览器菜单"]');const disabled=await take(task,'B13-import-recovery-disabled',menu,x=>x.buttons.some(b=>b.text==='导入 Chrome／Edge 登录态'&&b.disabled)&&x.buttons.some(b=>b.text==='登录态管理'&&!b.disabled));await shellClick(menu+' [role=menuitem]','登录态管理');const fail=await take(task,'B12-recovery-failed',modal,x=>x.text.includes('需要处理：上次导入的恢复没有完成')&&x.text.includes('BROWSER_UNAVAILABLE')&&x.buttons.some(b=>b.text==='清空该登录态'&&!b.disabled)&&x.buttons.some(b=>b.text==='导入 Chrome／Edge 登录态'&&b.disabled));await shellClick(modal+' button','清空该登录态');const confirm=await take(task,'B12-recovery-clear-confirm',modal,x=>x.text.includes('将清空此登录态的全部 Cookie、存储与缓存，需要重新登录')&&x.buttons.some(b=>b.text==='确认清空'&&!b.disabled)&&x.buttons.some(b=>b.text==='取消'&&!b.disabled));await releaseFault(task);await shellClick(modal+' button','确认清空');await until(async()=>{const p=await ownProfile(task);return p.importState==='ready'?p:null;},'actual normal real UI clear completes empty owned profile',20000);await shellClick(modal+' .bw-dialog-actions button','完成');await app.waitFor('!document.querySelector(".bw-attention-banner")&&!document.querySelector(".bw-scrim")',12000);const ready=await awaitPage(task.taskId,task.url,task.page.id);assert.equal(ready.profile,task.page.profile);const after=await ownProfile(task);assert.equal(after.importState,'ready');const files=await readdir(join(userData,'browser','import-journal'));assert(!files.includes(task.page.profile+'.bin')&&!files.includes(task.page.profile+'.bin.clear'));for(const r of [disabled,fail,confirm]){r.passed=true;r.actualRecovery={cleared:true,profile:after,page:ready,artifactReleased:task.fault.released,noJournal:true};}await persist();}
try{
 for(const spec of specs){
  currentSide=spec.side;fullscreenDisplay=null;report.displayId=null;rootIdentity=null;currentSize=selectedSizes[0];
  let row,resume;
  if(spec.side==='old-clean'){
   // Resume the exact normal closed private state from the first actual run:
   // every original logical page and marker still matches its saved SHA/inode.
   const again=await verifyResumePrior(process.argv.slice(13,15));assert.deepEqual(again.resume,verifiedPrior.resume);
   row=structuredClone(again.side);row.priorFailedWindows=row.windows;row.windows={};row.resumedExactFaultState=true;for(const t of row.tasks){const q=again.manifest.savedLogicalTabs.find(x=>x.taskId===t.taskId);assert(q);t.retainedAuxiliaryIds=q.retainedAuxiliaryIds.slice();}
   sideRoot=row.isolated.own;home=row.isolated.home;cliHome=row.isolated.cliHome;userData=row.isolated.userData;fixtureProfileId=row.agent.agentProfile;
   resume=again.resume;report.sides.push(row);await progress({stage:'verified-retained-old-fault-state',side:spec.side,root,savedTabs:row.tasks.length,previousNormalExit:again.manifest.priorLastNormalExit,dbSha:resume.dbSha});
  }else{
   const isolated=await useSide(spec.side);row={side:spec.side,isolated,tasks:[],windows:{}};report.sides.push(row);
   await runApp(spec.bundle,spec.hash,spec.side+'-bootstrap-no-fault',spec.native);await setOwnTitle(spec.side);await setFocusEmulation(true);
   try{
    row.agent=await prepareProfile();
    for(const size of selectedSizes)for(const theme of ['light','dark'])for(const width of [480,900])row.tasks.push(await createTask(spec.side,theme,width,size));
    await app.cdp('Page.reload');await app.waitFor('!!document.querySelector("[data-testid=nav-home]")',18000,{navigation:true});
    for(const t of row.tasks){await progress({stage:'bootstrap-own-empty-recovery-profile',side:spec.side,root,key:t.key,pid:app.processId});await bootstrapTask(t);}
   }finally{await setFocusEmulation(false);}
   assert.equal(row.tasks.length,selectedSizes.length*4);assert.equal(new Set(row.tasks.map(t=>t.page.profile)).size,row.tasks.length);
   assert(row.tasks.every(t=>t.bootstrap.record.importState==='ready'&&t.bootstrap.record.profile.source===null&&t.bootstrap.observed.marker));
   resume=await quit();row.bootstrapExit=resume;await setFaults(row.tasks);
  }
  await runApp(spec.bundle,spec.hash,spec.side+'-actual-filetype-recovery',spec.native,resume);
  for(const size of selectedSizes){
   currentSize=size;fullscreenDisplay=null;report.displayId=report.displayBySize[size[0]]??null;
   await setOwnTitle(spec.side);
   const win=size[0]===1440?await prepare1440(spec.side):await waitForUserFullscreen(spec.side);
   row.windows[size[0]]=win;assert(win.exact,'Exact real size and matching physical display required');report.displayBySize[size[0]]=report.displayId;
   await setFocusEmulation(true);
   try{for(const t of row.tasks.filter(t=>t.size[0]===size[0]))await testTask(t);}finally{await setFocusEmulation(false);}
   await progress({stage:'size-complete',side:spec.side,size,root,captures:report.captures.filter(r=>r.side===spec.side&&r.passed&&r.size[0]===size[0]).length});
  }
  assert.deepEqual(await readdir(join(userData,'browser','import-journal')),[]);row.normalExit=await quit();
  await progress({stage:'side-complete',side:spec.side,root,captures:report.captures.filter(r=>r.side===spec.side&&r.passed).length});
 }
 assert.equal(report.captures.filter(x=>x.passed).length,2*expectedPairKeys);
 report.status='actual-filetype-recovery-pairs-recorded-pending-original-target-adjudication';
}catch(e){
 report.status='failed-or-partial';report.error=String(e.stack??e);
 if(app){try{await app.screenshot(join(root,'failed-shell.png'));}catch{}try{await quit();}catch(q){report.quitError=String(q);}}
}finally{
 report.originalRows=report.captures.filter(c=>c.passed).map(c=>({key:c.key,side:c.side,shell:c.shell.file,scope:'candidate recovery visual only'}));
 assert.equal(new Set(report.originalRows.map(r=>r.side+'|'+r.key)).size,report.originalRows.length);
 report.fixtureRequests=local.requests;await local.close();server.closeAllConnections();await new Promise(r=>server.close(r));
 await verifyPins(expectedArgs);await verifyNativeRunner([cli.path,cli.sha]);report.finishedAt=new Date().toISOString();await persist();
 console.log(JSON.stringify({root,status:report.status,rows:report.originalRows.length,error:report.error}));if(!report.status.startsWith('actual-filetype'))process.exitCode=1;
}
