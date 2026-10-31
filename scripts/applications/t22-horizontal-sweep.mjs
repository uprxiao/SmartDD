// T22 V31-V35 horizontal sweep on the real packaged App (no credentials, no sends, no native pickers).
// Per route x theme x native window size: viewport overflow, off-screen / clipped controls, accessible names,
// Tab order with a visible focus indicator, font families, then dialog Esc / focus return.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {openElectron} from '../lib/electron-harness.mjs';

const executable=process.env.WILLYOU_ACCEPTANCE_APP;
assert(executable?.startsWith('/private/tmp/willyou-m10-'),'Set WILLYOU_ACCEPTANCE_APP to the private package');
const root=await mkdtemp('/private/tmp/willyou-m10-t22-sweep-'),userData=join(root,'userdata');await mkdir(join(root,'home'));
const result={schema:'m10-t22-horizontal-sweep-v1',startedAt:new Date().toISOString(),root,app:executable,layer:'A real packaged App; isolated userData; no credentials/sends/native pickers; automated structural audit, not a pixel comparison',rows:[],status:'running'};
const w=ms=>new Promise(r=>setTimeout(r,ms));
let app;
const save=()=>writeFile(join(root,'result.json'),JSON.stringify(result,null,2));

async function nativeSize(mode){return app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Only own window');const ws=E.BrowserWindow.getAllWindows();if(ws.length!==1)throw Error('Expected one own window');const win=ws[0],min=win.getMinimumSize();if(${JSON.stringify(mode)}==='minimum')win.setSize(min[0],min[1],false);else win.setContentSize(1400,900,false);return{mode:${JSON.stringify(mode)},minimum:min,content:win.getContentSize()};})()`,{label:'t22-size',timeoutMs:20000});}
async function click(selector,text){const p=await app.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>x.getBoundingClientRect().width&&${text===undefined?'true':'x.textContent.trim().startsWith('+JSON.stringify(text)+')'});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);assert(p,'target missing: '+selector+' '+(text??''));for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',clickCount:1});}
async function ensure(){if(!(await app.evaluate('!!document.querySelector(".m10-sidebar")'))){await click('[data-testid=nav-apps]');await app.waitFor('!!document.querySelector(".m10-sidebar")',10000);}await w(300);}
async function key(k,code,vk,mods=0){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:k,code,windowsVirtualKeyCode:vk,modifiers:mods});}

// Static audit evaluated in the page.
const AUDIT=`(()=>{
 const vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0';};
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
const FOCUS=`(()=>{const e=document.activeElement;if(!e||e===document.body)return{body:true};const s=getComputedStyle(e);const ring=(s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0)||(s.boxShadow&&s.boxShadow!=='none')||(()=>{const p=e.closest('label,.m10-search,[class*=field],[class*=input]');if(!p)return false;const ps=getComputedStyle(p);return (ps.outlineStyle!=='none'&&parseFloat(ps.outlineWidth)>0)||(ps.boxShadow&&ps.boxShadow!=='none')||ps.borderColor!==s.borderColor;})();const r=e.getBoundingClientRect();return{tag:e.tagName,name:(e.getAttribute('aria-label')||e.textContent||e.placeholder||'').trim().slice(0,30),ring:!!ring,inView:r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1,id:e.tagName+'|'+(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,30)+'|'+Math.round(r.x)+','+Math.round(r.y)};})()`;

async function tabSweep(max=80){
 await app.evaluate('document.activeElement&&document.activeElement.blur&&document.activeElement.blur();window.scrollTo(0,0);true');
 const seen=[],issues=[];let first=null;
 for(let i=0;i<max;i++){
  await key('Tab','Tab',9);await w(40);
  const f=await app.evaluate(FOCUS);
  if(f.body){issues.push({step:i,problem:'focus fell to body'});if(i>0)break;else continue;}
  if(first===null)first=f.id;else if(f.id===first)break;
  seen.push(f.name);if(!f.ring)issues.push({step:i,problem:'no visible focus indicator',name:f.name,tag:f.tag});if(!f.inView)issues.push({step:i,problem:'focused control outside viewport',name:f.name});
 }
 return{stops:seen.length,issues};
}
async function row(route,theme,size,prepare){
 const label=`${route}|${theme}|${size}`;
 try{
  await prepare();await w(500);
  const audit=await app.evaluate(AUDIT),tabs=await tabSweep();
  await app.screenshot(join(root,`${route}-${theme}-${size}.png`)).catch(()=>{});
  const problems=[];
  if(audit.docOverflowX)problems.push('document overflows horizontally');
  if(audit.offscreen.length)problems.push('controls off-screen: '+audit.offscreen.join(' / '));
  if(audit.noName.length)problems.push('controls without accessible name: '+audit.noName.length);
  if(audit.clipped.length)problems.push('clipped text without ellipsis: '+audit.clipped.join(' / '));
  for(const t of tabs.issues)problems.push('tab: '+t.problem+(t.name?' ('+t.name+')':''));
  result.rows.push({label,...audit,tab:tabs,problems});console.log((problems.length?'ISSUE ':'OK    ')+label+' controls='+audit.controls+' tabs='+tabs.stops+(problems.length?' :: '+problems.join('; ').slice(0,300):''));
 }catch(error){result.rows.push({label,error:String(error).slice(0,300),problems:['sweep error']});console.log('ERROR '+label+' '+String(error).slice(0,200));}
 await save();
}
async function dialogEsc(route,theme,size,opener){
 const label=`dialog:${route}|${theme}|${size}`;
 try{
  await opener();await app.waitFor('!!document.querySelector("dialog[open]")',8000);await w(400);
  const audit=await app.evaluate(AUDIT),tabs=await tabSweep(40);
  await key('Escape','Escape',27);await w(400);
  const closed=await app.evaluate('!document.querySelector("dialog[open]")'),back=await app.evaluate(FOCUS);
  const problems=[];if(!closed)problems.push('Esc did not close the dialog');if(back.body)problems.push('focus not returned after Esc');
  if(audit.offscreen.length)problems.push('controls off-screen: '+audit.offscreen.join(' / '));if(audit.noName.length)problems.push('controls without accessible name: '+audit.noName.length);
  for(const t of tabs.issues)problems.push('tab: '+t.problem+(t.name?' ('+t.name+')':''));
  result.rows.push({label,...audit,tab:tabs,closedByEsc:closed,focusAfter:back,problems});console.log((problems.length?'ISSUE ':'OK    ')+label+' controls='+audit.controls+' tabs='+tabs.stops+(problems.length?' :: '+problems.join('; ').slice(0,300):''));
 }catch(error){result.rows.push({label,error:String(error).slice(0,300),problems:['sweep error']});console.log('ERROR '+label+' '+String(error).slice(0,200));try{await key('Escape','Escape',27);}catch{}}
 await save();
}
try{
 app=await openElectron({executable,userData,inspectMain:true,env:{HOME:join(root,'home'),ZDOTDIR:join(root,'home')}});result.appPid=app.processId;
 const cat=await app.invoke('applications.catalog'),items=(cat.value??cat);
 for(const id of ['mail','zentao']){const it=items.find(x=>x.appId===id);const r=await app.invoke('applications.setAdded',id,true,it.revision);assert(r.ok,'setAdded '+id);}
 const nav=text=>async()=>{await ensure();await click('.m10-sidebar button',text);await w(700);};
 const routes=[
  ['catalog',async()=>{await ensure();await click('.m10-sidebar > button','应用');await w(500);}],
  ['mail-detail',async()=>{await ensure();await click('.m10-sidebar button','邮件');await w(700);}],
  ['zentao-detail',async()=>{await ensure();await click('.m10-sidebar button','禅道');await w(700);}],
  ['projects',async()=>{await ensure();await click('.m10-sidebar button','项目选用');await w(700);}],
  ['activity',async()=>{await ensure();await click('.m10-sidebar button','调用记录');await w(700);}],
 ];
 for(const theme of ['light','dark']){
  await app.invoke('appSettings.update','theme','y'+theme);
  const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${origin}&&!!document.querySelector('[data-testid=nav-apps]')`,20000);
  for(const size of ['1400x900','minimum']){
   result.window=await nativeSize(size==='minimum'?'minimum':'content');await w(600);
   for(const [name,go] of routes)await row(name,theme,size,go);
   // dialogs reachable without credentials
   await routes[0][1]();await dialogEsc('catalog-future-dialog',theme,size,async()=>{await click('.m10-later button','了解扩展方式');});
   await routes[1][1]();await dialogEsc('mail-local-source-form',theme,size,async()=>{await click('button','添加连接');await w(300);await click('[role=menuitem]','本地读取来源');});
   await routes[1][1]();await dialogEsc('mail-smtp-form',theme,size,async()=>{await click('button','添加连接');await w(300);await click('[role=menuitem]','SMTP');});
   await routes[2][1]();await dialogEsc('zentao-connection-form',theme,size,async()=>{await click('button','添加连接');await w(300);const m=await app.evaluate('[...document.querySelectorAll("[role=menuitem]")].map(e=>e.textContent.trim())');await click('[role=menuitem]',m[0]);});
   await routes[0][1]();
  }
 }
 const bad=result.rows.filter(r=>r.problems.length);result.summary={rows:result.rows.length,withProblems:bad.length,problemKinds:[...new Set(bad.flatMap(r=>r.problems.map(p=>p.replace(/\(.*\)|:.*$/,'').trim())))]};
 result.status=bad.length?'completed-with-findings':'passed-sweep';
}catch(error){result.status='failed';result.error=String(error);console.log('FAILED '+String(error));process.exitCode=1;}
finally{result.finishedAt=new Date().toISOString();await save();console.log('RESULT '+result.status+' '+JSON.stringify(result.summary??{})+' '+join(root,'result.json'));try{process.kill(result.appPid,'SIGTERM');}catch{}}
