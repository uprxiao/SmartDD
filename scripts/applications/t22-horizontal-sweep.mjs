// T22 V31-V35 horizontal sweep on the real packaged App (no credentials, no sends, no native pickers).
// Per route x theme x native window size: viewport overflow, off-screen / clipped controls, accessible names,
// Tab order with a visible focus indicator, font families, then dialog Esc / focus return.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {join,dirname,resolve,extname,sep} from 'node:path';
import {openElectron} from '../lib/electron-harness.mjs';
import {installAppFocusGuard,isAppFocusYield,waitForInitialAppFocus} from '../lib/app-focus-guard.mjs';
import {capturePrototypeCarrier,restorePrototypeCarrier} from './fixtures/prototype-carrier.mjs';

const executable=process.env.WILLYOU_ACCEPTANCE_APP;
assert(executable?.startsWith('/private/tmp/willyou-m10-'),'Set WILLYOU_ACCEPTANCE_APP to the private package');
const expectedAsar=process.env.WILLYOU_ACCEPTANCE_ASAR_SHA;
assert(/^[a-f0-9]{64}$/.test(expectedAsar??''),'Pin the actual package hash before acceptance');
const layer=process.env.M10_LAYER??'A';assert(['A','P'].includes(layer));
const root=await mkdtemp('/private/tmp/willyou-m10-t22-sweep-'),userData=join(root,'userdata');await mkdir(join(root,'home'));
const result={schema:'m10-t22-horizontal-sweep-v3',startedAt:new Date().toISOString(),root,userData,app:executable,system:process.platform,arch:process.arch,branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),layer:layer==='A'?'A real packaged App; isolated userData/HOME; catalog add and theme are prerequisites; no credentials/sends/native pickers; structural findings need visual triage and are not a complete T22 or pixel comparison':'P shared synthetic prototype in a private browser carrier;demo controls/data remain separate;no live credentials/services;structural audit is not product business or pixel-parity acceptance',rows:[],inputs:[],status:'running'};
let app,server,carrier,prototypeOrigin;
const save=()=>writeFile(join(root,'result.json'),JSON.stringify(result,null,2));
const settle=()=>app.waitFor('document.getAnimations().every(a=>a.playState!=="running"||a.effect?.getTiming().iterations===Infinity)',8000);

async function nativeSize(mode){return app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Only own window');const ws=E.BrowserWindow.getAllWindows();if(ws.length!==1)throw Error('Expected one own window');const win=ws[0],min=win.getMinimumSize();if(${JSON.stringify(mode)}==='minimum')win.setSize(min[0],min[1],false);else win.setContentSize(1400,900,false);return{mode:${JSON.stringify(mode)},minimum:min,content:win.getContentSize()};})()`,{label:'t22-size',timeoutMs:20000});}
async function click(selector,text){await settle();const p=await app.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>x.getBoundingClientRect().width&&${text===undefined?'true':'x.textContent.trim().startsWith('+JSON.stringify(text)+')'});if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.disabled||!e.contains(document.elementFromPoint(x,y)))throw Error('Blocked control');return{x,y}})()`);assert(p,'target missing: '+selector+' '+(text??''));for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});result.inputs.push({selector,text,at:new Date().toISOString()});}
async function ensure(){if(!(await app.evaluate('!!document.querySelector(".m10-sidebar")'))){assert.equal(layer,'A');await click('[data-testid=nav-apps]');await app.waitFor('!!document.querySelector(".m10-sidebar")',10000);}await settle();}
async function key(k,code,vk,mods=0){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:k,code,windowsVirtualKeyCode:vk,modifiers:mods});}

// Static audit evaluated in the page.
const AUDIT=`(()=>{
 const vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);if(!(r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0'))return false;for(let p=e.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open&&!p.querySelector(':scope>summary')?.contains(e))return false;return true;};
 const scope=document.querySelector('dialog[open]')||document.body;
 const all=[...scope.querySelectorAll('*')].filter(vis);
 const ctl=all.filter(e=>e.matches('button,input,select,textarea,a[href],[role=button],[role=menuitem],[role=tab],[tabindex]:not([tabindex="-1"])'));
 const inScroll=e=>{for(let p=e.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p);if(/(auto|scroll)/.test(s.overflowX+s.overflowY)&&(p.scrollHeight>p.clientHeight||p.scrollWidth>p.clientWidth))return true;}return false;};
 const offscreen=ctl.filter(e=>{const r=e.getBoundingClientRect();return (r.left<-1||r.right>innerWidth+1)||((r.top<-1||r.bottom>innerHeight+1)&&!inScroll(e));}).map(e=>(e.getAttribute('aria-label')||e.textContent.trim()||e.tagName).slice(0,40));
 const noName=ctl.filter(e=>{const n=(e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')||e.getAttribute('title')||e.textContent||'').trim();const labelled=e.labels&&e.labels.length;return !n&&!labelled&&!e.placeholder;}).map(e=>e.outerHTML.slice(0,90));
 const clipped=all.filter(e=>{const s=getComputedStyle(e);if(!/^(hidden|clip)$/.test(s.overflowX))return false;if(e.scrollWidth<=e.clientWidth+1)return false;return s.textOverflow!=='ellipsis'&&!/(-webkit-line-clamp|mask)/.test(e.style.cssText+s.webkitLineClamp+s.maskImage)&&!e.closest('[class*=fade],[class*=scroll]');}).map(e=>(e.className||e.tagName).toString().slice(0,50));
 const families=[...new Set(all.filter(e=>e.childNodes.length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>getComputedStyle(e).fontFamily.split(',')[0].replace(/["']/g,'').trim()))];
 const sizes=[...new Set(all.filter(e=>[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>getComputedStyle(e).fontSize))].sort();
 return{viewport:[innerWidth,innerHeight],docOverflowX:document.documentElement.scrollWidth>innerWidth+1,controls:ctl.length,offscreen,noName,clipped:[...new Set(clipped)],families,sizes};
})()`;
const FOCUS=`(()=>{const e=document.activeElement;if(!e||e===document.body)return{body:true};const s=getComputedStyle(e),baseline=globalThis.__m10SweepPaint;const borderChange=n=>{const a=baseline?.get(n),b=getComputedStyle(n);return !!a&&parseFloat(b.borderTopWidth)>0&&b.borderTopStyle!=='none'&&b.borderTopColor!=='rgba(0, 0, 0, 0)'&&b.borderTopColor!==a.border;};const changed=borderChange(e);const ring=(s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0)||(s.boxShadow&&s.boxShadow!=='none')||(e.matches(':focus-visible')&&changed)||(()=>{const p=e.closest('label,.m10-search,[class*=field],[class*=input]');if(!p)return false;const ps=getComputedStyle(p);return (ps.outlineStyle!=='none'&&parseFloat(ps.outlineWidth)>0)||(ps.boxShadow&&ps.boxShadow!=='none')||borderChange(p);})();const r=e.getBoundingClientRect();return{tag:e.tagName,name:(e.getAttribute('aria-label')||e.textContent||e.placeholder||'').trim().slice(0,30),ring:!!ring,borderChanged:changed,focusVisible:e.matches(':focus-visible'),inView:r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1,id:String(globalThis.__m10SweepElementIds?.get(e)??e.tagName+'|'+(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,30))};})()`;

async function tabSweep(max=80,label=''){
 await app.evaluate('document.activeElement&&document.activeElement.blur&&document.activeElement.blur();window.scrollTo(0,0);true');
 await app.evaluate(`(()=>{globalThis.__m10SweepPaint=new WeakMap();globalThis.__m10SweepElementIds=new WeakMap();[...document.querySelectorAll('*')].forEach((e,i)=>{globalThis.__m10SweepPaint.set(e,{border:getComputedStyle(e).borderTopColor});globalThis.__m10SweepElementIds.set(e,i);});return true})()`);
 const seen=[],issues=[];let first=null;
 for(let i=0;i<max;i++){
  await key('Tab','Tab',9);await settle();
  const f=await app.evaluate(FOCUS);
  if(f.body){issues.push({step:i,problem:'focus fell to body'});if(i>0)break;else continue;}
  if(first===null)first=f.id;else if(f.id===first)break;
  seen.push(f);if(f.name==='M10演示场景'&&label.startsWith('catalog|'))await app.screenshot(join(root,label.replaceAll('|','-')+'-scene-focus.png'));if(!f.ring)issues.push({step:i,problem:'no visible focus indicator',name:f.name,tag:f.tag});if(!f.inView)issues.push({step:i,problem:'focused control outside viewport',name:f.name});
 }
 return{stops:seen.length,issues,controls:seen};
}
async function row(route,theme,size,prepare){
 const label=`${route}|${theme}|${size}`;
 try{
  await prepare();await settle();
  await app.screenshot(join(root,`${route}-${theme}-${size}-initial.png`));
  const audit=await app.evaluate(AUDIT),tabs=await tabSweep(80,label);
  await app.screenshot(join(root,`${route}-${theme}-${size}.png`));
  const problems=[];
  if(audit.docOverflowX)problems.push('document overflows horizontally');
  if(audit.offscreen.length)problems.push('controls off-screen: '+audit.offscreen.join(' / '));
  if(audit.noName.length)problems.push('controls without accessible name: '+audit.noName.length);
  if(audit.clipped.length)problems.push('clipped text without ellipsis: '+audit.clipped.join(' / '));
  for(const t of tabs.issues)problems.push('tab: '+t.problem+(t.name?' ('+t.name+')':''));
  result.rows.push({label,...audit,tab:tabs,problems});console.log((problems.length?'ISSUE ':'OK    ')+label+' controls='+audit.controls+' tabs='+tabs.stops+(problems.length?' :: '+problems.join('; ').slice(0,300):''));
 }catch(error){if(isAppFocusYield(error))throw error;result.rows.push({label,error:String(error).slice(0,300),problems:['sweep error']});console.log('ERROR '+label+' '+String(error).slice(0,200));}
 await save();
}
async function dialogEsc(route,theme,size,opener){
 const label=`dialog:${route}|${theme}|${size}`;
 try{
  await opener();await app.waitFor('!!document.querySelector("dialog[open]")',8000);await settle();
  await app.screenshot(join(root,`${route}-${theme}-${size}-open.png`));
  const audit=await app.evaluate(AUDIT),tabs=await tabSweep(40,label);
  await app.screenshot(join(root,`${route}-${theme}-${size}-tab.png`));
  await key('Escape','Escape',27);await app.waitFor('!document.querySelector("dialog[open]")',8000);await settle();
  const closed=await app.evaluate('!document.querySelector("dialog[open]")'),back=await app.evaluate(FOCUS);
  const problems=[];if(!closed)problems.push('Esc did not close the dialog');if(back.body)problems.push('focus not returned after Esc');
  if(audit.offscreen.length)problems.push('controls off-screen: '+audit.offscreen.join(' / '));if(audit.noName.length)problems.push('controls without accessible name: '+audit.noName.length);
  for(const t of tabs.issues)problems.push('tab: '+t.problem+(t.name?' ('+t.name+')':''));
  result.rows.push({label,...audit,tab:tabs,closedByEsc:closed,focusAfter:back,problems});console.log((problems.length?'ISSUE ':'OK    ')+label+' controls='+audit.controls+' tabs='+tabs.stops+(problems.length?' :: '+problems.join('; ').slice(0,300):''));
 }catch(error){if(isAppFocusYield(error))throw error;result.rows.push({label,error:String(error).slice(0,300),problems:['sweep error']});console.log('ERROR '+label+' '+String(error).slice(0,200));try{await key('Escape','Escape',27);await app.waitFor('!document.querySelector("dialog[open]")',8000);}catch{}}
 await save();
}
try{
 result.asar=createHash('sha256').update(await readFile(join(dirname(dirname(executable)),'Resources/app.asar'))).digest('hex');assert.equal(result.asar,expectedAsar);
 for(const name of Object.keys(process.env))if(!['PATH','TMPDIR','LANG','LC_ALL'].includes(name))delete process.env[name];
 app=await openElectron({executable,userData,inspectMain:true,env:{HOME:join(root,'home'),ZDOTDIR:join(root,'home'),CODEX_HOME:join(root,'home/.codex'),CLAUDE_CONFIG_DIR:join(root,'home/.claude'),HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost'}});result.appPid=app.processId;
 installAppFocusGuard(app,result);await app.evaluate(`document.title=${JSON.stringify(layer+' · M10 T22 · 隔离 UI 扫描')};true`);await waitForInitialAppFocus(app,result,{userData,timeoutMs:30000});
 if(layer==='P'){
  const staticRoot=resolve('prototypes/m6-codex/dist/client');result.prototypeIndexSha256=createHash('sha256').update(await readFile(join(staticRoot,'index.html'))).digest('hex');
  server=createServer(async(req,res)=>{try{if(req.method!=='GET'){res.writeHead(405);res.end();return;}const path=resolve(staticRoot,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(path!==staticRoot&&!path.startsWith(staticRoot+sep)){res.writeHead(403);res.end();return;}const file=path===staticRoot?join(staticRoot,'index.html'):path,bytes=await readFile(file),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};res.writeHead(200,{'content-type':mime[extname(file)]??'application/octet-stream'});res.end(bytes);}catch{if(!res.headersSent)res.writeHead(404);res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));prototypeOrigin='http://127.0.0.1:'+server.address().port;carrier=await capturePrototypeCarrier({app,userData});await app.cdp('Page.navigate',{url:prototypeOrigin+'/?preview=m10#apps'});await app.waitFor('!!document.querySelector(".m10-previewbar")',15000,{navigation:true});
 }else{
  const cat=await app.invoke('applications.catalog'),items=(cat.value??cat);
  for(const id of ['mail','zentao']){const it=items.find(x=>x.appId===id);const r=await app.invoke('applications.setAdded',id,true,it.revision);assert(r.ok,'setAdded '+id);}
 }
 const go=async(text,ready)=>{await ensure();await click('.m10-sidebar button',text);await app.waitFor(ready,12000);await settle();};
 const routes=[
  ['catalog',()=>go('应用','document.querySelectorAll(".m10-catalog-item").length===2')],
  ['mail-detail',()=>go('邮件','document.querySelector(".m10-app-heading")?.textContent.includes("邮件")')],
  ['zentao-detail',()=>go('禅道','document.querySelector(".m10-app-heading")?.textContent.includes("禅道")')],
  ['projects',()=>go('项目选用','!!document.querySelector(".m10-page-head")&&document.querySelector(".m10-page-head").textContent.includes("项目选用")')],
  ['activity',()=>go('调用记录','!!document.querySelector(".m10-page-head")&&document.querySelector(".m10-page-head").textContent.includes("调用记录")')],
 ];
 for(const theme of ['light','dark']){
  if(layer==='A'){
   await app.invoke('appSettings.update','theme','y'+theme);
   const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${origin}&&!!document.querySelector('[data-testid=nav-apps]')`,20000,{navigation:true});await app.waitFor(`document.documentElement.classList.contains('ydark')===${theme==='dark'}`,10000);
  }else if(await app.evaluate(`document.documentElement.dataset.theme!==${JSON.stringify(theme)}`)){await click('[aria-label='+JSON.stringify(theme==='dark'?'切换深色主题':'切换浅色主题')+']');await app.waitFor(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`);}
  await app.evaluate(`document.title=${JSON.stringify(layer+' · M10 T22 · 隔离 UI 扫描')};true`);
  for(const size of ['1400x900','minimum']){
   result.window=await nativeSize(size==='minimum'?'minimum':'content');await app.waitFor(`innerWidth===${result.window.content[0]}&&innerHeight===${result.window.content[1]}`,8000);await settle();
   for(const [name,go] of routes)await row(name,theme,size,go);
   // dialogs reachable without credentials
   await routes[0][1]();await dialogEsc('catalog-future-dialog',theme,size,async()=>{await click('.m10-later button','了解扩展方式');});
   await routes[1][1]();await dialogEsc('mail-local-source-form',theme,size,async()=>{await click('.m10-app-heading button.primary','添加连接');await app.waitFor('!!document.querySelector("[role=menuitem]")');await click('[role=menuitem]','本地读取来源');});
   await routes[1][1]();await dialogEsc('mail-smtp-form',theme,size,async()=>{await click('.m10-app-heading button.primary','添加连接');await app.waitFor('!!document.querySelector("[role=menuitem]")');await click('[role=menuitem]','SMTP');});
   await routes[2][1]();await dialogEsc('zentao-connection-form',theme,size,()=>click('.m10-app-heading button.primary','添加连接'));
   await routes[0][1]();
  }
 }
 const bad=result.rows.filter(r=>r.problems.length);result.summary={rows:result.rows.length,withProblems:bad.length,problemKinds:[...new Set(bad.flatMap(r=>r.problems.map(p=>p.replace(/\(.*\)|:.*$/,'').trim())))]};
 result.status=bad.length?'completed-with-findings':'passed-sweep';
}catch(error){result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.error=String(error);console.log('FAILED '+String(error));process.exitCode=isAppFocusYield(error)?2:1;}
finally{if(app){try{if(carrier)result.carrierCleanup=await restorePrototypeCarrier({app,carrier,prototypeOrigin});await writeFile(join(root,'app.log'),app.logs());await app.mainEvaluate("(()=>{setTimeout(()=>process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').app.quit(),30);return true})()");result.quitExit=await app.waitForExit(15000);assert.equal(result.quitExit.code,0);}catch(error){result.cleanupError=String(error);if(result.status==='passed-sweep')result.status='cleanup-failed';}await app.close();result.rendererErrors=app.rendererErrors;}if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}result.finishedAt=new Date().toISOString();await save();console.log('RESULT '+result.status+' '+JSON.stringify(result.summary??{})+' '+join(root,'result.json'));}
