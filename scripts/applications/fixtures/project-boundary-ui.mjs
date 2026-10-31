// SE: original UI boundary actions; explicit prerequisite changes are recorded separately.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {projectIntegrationState,initialIntegrationState} from '../../../prototypes/m6-codex/src/integration-model.mjs';
import {focusNewInstalledWindow} from './dmg-install-ui.mjs';
import {installAppFocusGuard} from '../../lib/app-focus-guard.mjs';
export async function checkProjectBoundaries({app,result,root,userData,layer,projectId,origin,click,key,choose,facts,state,sql}){
 const d=result.projectBoundaries={scopes:[],preconditions:[],boundary:'Unadded A/P original UI; A archive via original RPC prerequisite, P legacy duplicates via public synthetic seed; no secrets/auth/source/provider/Agent'};
 let focused=false;
 const get=()=>layer==='A'?facts():state(),card=id=>'.m10-project-application:has(.m10-appmark.'+id+')';
 async function reload(seed){
  let hook;if(seed){hook=await app.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(origin)})localStorage.setItem('willyou-m10-prototype-v2',${JSON.stringify(JSON.stringify(seed))});`});}
  const old=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor('performance.timeOrigin!=='+old+'&&!!document.querySelector('+JSON.stringify(layer==='A'?'[data-testid=nav-apps]':'.m10-sidebar')+')',15000,{navigation:true});
  if(seed)assert.deepEqual(await state(),projectIntegrationState(seed),'SE fixture must load before any tested input');
  if(hook)await app.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:hook.identifier});
  if(!focused){await focusNewInstalledWindow(app,userData,result);installAppFocusGuard(app,result);focused=true;}
  await app.evaluate('document.title='+JSON.stringify(layer+' · SE P04边界 · 隔离')+';true');
 }
 async function enter(id=projectId){if(layer==='A'&&!await app.evaluate('!!document.querySelector(".m10-sidebar")'))await click('[data-testid=nav-apps]');await click('.m10-sidebar button','项目选用');await app.waitFor('!!document.querySelector("[aria-label=当前应用项目]")');await choose(id??'');await app.waitFor(id?'document.querySelectorAll(".m10-project-application").length===2':'!!document.querySelector(".m10-empty")');}
 async function appearance(theme,size){if(layer==='P'&&await app.evaluate('document.documentElement.dataset.theme')!==theme)await click('[aria-label="切换'+(theme==='dark'?'深':'浅')+'色主题"]');const wh=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('SE own U');const w=E.BrowserWindow.getAllWindows()[0];${size==='regular'?'w.setContentSize(1400,900,false)':'w.setSize(...w.getMinimumSize(),false)'};return w.getContentSize()})()`);await app.waitFor('innerWidth==='+wh[0]+'&&innerHeight==='+wh[1]);return wh;}
 const checked=(context,name,extra={})=>{d.scopes.push({context,name,...extra,passed:true});result.checks.push({context,name,passed:true});console.log(JSON.stringify({root,layer,context,check:name}));};
 let other;
 if(layer==='A'){
  other=await app.invoke('projects.create',{name:'B SE unchanged',aliases:[],description:'SE private independent project prerequisite',rulesPath:null});
  const catalog=await app.invoke('applications.catalog');assert(catalog.ok);for(const a of catalog.value){const r=await app.invoke('applications.setAdded',a.appId,false,a.revision);assert(r.ok);}
  d.preconditions.push({kind:'original RPC setAdded(false),empty private connections',catalog:await app.invoke('applications.catalog'),otherId:other.id});
 }
 for(const theme of ['light','dark'])for(const size of ['regular','minimum']){
  const context=theme+'-'+size;
  if(layer==='A')await app.invoke('appSettings.update','theme','y'+theme);
  const unadded=projectIntegrationState(initialIntegrationState());unadded.installed=[];unadded.connections=[];unadded.bindings={ais:[],smartdd:[]};
  await reload(layer==='P'?unadded:undefined);await enter();const dimensions=await appearance(theme,size);
  await app.waitFor('[...document.querySelectorAll(".m10-project-application .m10-state")].every(e=>e.textContent==="尚未添加")');
  const before=await get();
  for(const id of ['zentao','mail']){
   const c=card(id),name=id==='mail'?'邮件':'禅道',controls=await app.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(c+' input[type=radio], '+c+' header [role=switch], '+c+' footer button:last-child')})).map(e=>({tag:e.tagName,label:e.getAttribute('aria-label')||e.textContent.trim(),disabled:e.disabled}))`);
   assert.equal(controls.length,id==='mail'?4:3);assert(controls.every(c=>c.disabled));
   for(const selector of [c+' header [role=switch]',c+' input[type=radio]',c+' footer button:last-child'])await click(selector,undefined,true);
   assert.deepEqual(await get(),before);assert.equal(await app.evaluate('document.querySelector(".m10-page-head h1").textContent'),'项目选用');
   await app.screenshot(join(root,context+'-unadded-'+id+'.png'));
   await click(c+' button','先添加'+name+'应用');await app.waitFor('document.querySelector(".m10-app-heading h1")?.textContent.startsWith('+JSON.stringify(name)+')&&!!document.querySelector(".m10-detail-grid")');assert.deepEqual(await get(),before);await enter();
   checked(context,'unadded '+id+' disables controls and explicitly opens detail without adding/enabling',{controls,dimensions});
  }
  if(layer==='A'){
   const bindings=sql('SELECT * FROM application_project_bindings ORDER BY project_id,app_id,slot'),settings=sql('SELECT * FROM application_project_settings ORDER BY project_id,app_id');
   d.phase=context+' archive prerequisite';const archived=await app.invoke('projects.setArchived',projectId,true);assert(archived.archivedAt!==null);d.preconditions.push({context,kind:'original RPC archive prerequisite',id:projectId});
   d.phase=context+' archived reload';await reload();d.phase=context+' explicit empty archived picker';await enter(null);await app.waitFor('!!document.querySelector(".m10-empty h3")&&document.querySelector(".m10-empty h3").textContent==="选择一个项目"&&!document.querySelector(".m10-project-apps")');
   assert.equal(await app.evaluate(`!![...document.querySelector('[aria-label="当前应用项目"]').options].find(o=>o.value===${JSON.stringify(projectId)})`),false);
   await app.screenshot(join(root,context+'-archived-project.png'));d.phase=context+' choose other';await choose(other.id);await app.waitFor('document.querySelectorAll(".m10-project-application").length===2');
   assert.deepEqual(sql('SELECT * FROM application_project_bindings ORDER BY project_id,app_id,slot'),bindings);assert.deepEqual(sql('SELECT * FROM application_project_settings ORDER BY project_id,app_id'),settings);
   d.phase=context+' unarchive prerequisite';await app.invoke('projects.setArchived',projectId,false);await reload();await enter();checked(context,'archived project excluded,explicit other project chosen,no application selection changes',{dimensions});
  }else{
   const legacy=projectIntegrationState(initialIntegrationState());legacy.installed=['zentao','mail'];legacy.connections=[];legacy.bindings={ais:[],smartdd:[]};legacy.projectApps.ais={zentao:true,mail:true};
   for(const [appId,kind]of[['zentao','zentao'],['mail','local'],['mail','smtp']])for(let i=1;i<=2;i++){const id=kind+'-se-'+i;legacy.connections.push({id,app:appId,kind,name:'SE '+kind+' '+i,account:'se-'+i+'@example.invalid',url:'https://se.example.invalid',path:'/private/tmp/se-nonexistent',host:'smtp.se.example.invalid',enabled:true,validation:'unverified',credentialPresent:false,revision:1});legacy.bindings.ais.push(id);}
   legacy.bindings.smartdd=['local-se-2','smtp-se-2','zentao-se-2'];
   await reload(legacy);await enter();await appearance(theme,size);await app.waitFor('document.querySelectorAll(".m10-project-application [role=alert]").length===3');const raw=await state(),b=[...raw.bindings.smartdd];
   assert.equal(await app.evaluate('document.querySelectorAll(".m10-project-application input[type=radio]:checked").length'),0);await app.screenshot(join(root,context+'-legacy-multiple.png'));
   for(const [kind,label]of[['local','本地读取来源'],['smtp','SMTP发件账号']]){
    const beforeSlot=await state(),own=beforeSlot.connections.filter(c=>c.app==='mail'&&c.kind===kind).map(c=>c.id),protectedIds=beforeSlot.bindings.ais.filter(id=>!own.includes(id));
    const radio=card('mail')+' input[aria-label='+JSON.stringify('为ais选用SE '+kind+' 2')+']';await click(radio);await app.waitFor('document.querySelector('+JSON.stringify(radio)+').checked');
    const after=await state();assert.deepEqual(after.bindings.ais.filter(id=>!own.includes(id)),protectedIds);assert.deepEqual(after.bindings.ais.filter(id=>own.includes(id)),[kind+'-se-2']);assert.deepEqual(after.bindings.smartdd,b);assert.deepEqual(after.connections,raw.connections);
    checked(context,'legacy '+kind+' explicitly repaired without choosing first or changing other slots/project');
   }
   const zen=card('zentao')+' input[aria-label="为ais选用SE zentao 2"]';await click(zen);await app.waitFor('!!document.querySelector("dialog[open]")');const held=await state();await key('Escape','Escape',27);await app.waitFor('!document.querySelector("dialog[open]")');assert.deepEqual(await state(),held);await click(zen);await app.waitFor('!!document.querySelector("dialog[open]")');const confirm=await app.evaluate('[...document.querySelectorAll("dialog footer button")].at(-1).textContent.trim()');await click('dialog footer button',confirm);await app.waitFor('!document.querySelector("dialog[open]")&&document.querySelector('+JSON.stringify(zen)+').checked');
   const repaired=await state();assert.deepEqual(repaired.bindings.ais.filter(id=>id.startsWith('zentao-')),['zentao-se-2']);assert.deepEqual(repaired.bindings.smartdd,b);assert.deepEqual(repaired.connections,raw.connections);assert.deepEqual(repaired.bindings.ais.filter(id=>!id.startsWith('zentao-')),held.bindings.ais.filter(id=>!id.startsWith('zentao-')));await reload();await enter();assert.deepEqual(await state(),repaired);await app.screenshot(join(root,context+'-legacy-repaired-reload.png'));checked(context,'legacy ZenTao cancel retains ambiguity,explicit confirm and reload preserve unique chosen source');
  }
 }
 if(layer==='A'){assert.equal(sql('SELECT count(*) n FROM app_secrets')[0].n,0);assert.equal(sql('SELECT count(*) n FROM tasks')[0].n,0);assert.equal(sql('SELECT count(*) n FROM application_connections')[0].n,0);}else assert(result.requests.every(r=>!r.url.startsWith('http')||new URL(r.url).origin===origin));
 assert.deepEqual(app.rendererErrors,[]);
}
