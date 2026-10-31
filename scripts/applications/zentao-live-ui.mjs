// T09/T10/T22 read-only acceptance against the approved biz13.0 site.
// The user or explicitly authorized operator enters the password in the original
// App form. This driver never reads/logs the secret field, auth body or token.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname,join} from 'node:path';
import {openElectron} from '../lib/electron-harness.mjs';
import {installAppFocusGuard,isAppFocusYield,waitForInitialAppFocus} from '../lib/app-focus-guard.mjs';
import {focusNewInstalledWindow} from './fixtures/dmg-install-ui.mjs';
import {zentaoPresentationPaintExpression} from './fixtures/zentao-presentation-paint.mjs';

const executable=process.env.WILLYOU_ACCEPTANCE_APP,pin=process.env.WILLYOU_ACCEPTANCE_ASAR_SHA;
assert(executable?.startsWith('/private/tmp/willyou-m10-')&&/^[a-f0-9]{64}$/.test(pin??''));
const diagnosticTimeoutMs=Number(process.env.WILLYOU_ZENTAO_DIAG_TIMEOUT_MS??0);
assert([0,120000].includes(diagnosticTimeoutMs),'Only the explicitly requested120s diagnostic is supported');
const expectedRouteMtu=Number(process.env.WILLYOU_ZENTAO_EXPECT_MTU??0);
assert([0,1200].includes(expectedRouteMtu));
const resumeRoot=process.env.WILLYOU_ZENTAO_RESUME_ROOT;
const previousApp=process.env.WILLYOU_ZENTAO_PREVIOUS_APP,previousPin=process.env.WILLYOU_ZENTAO_PREVIOUS_ASAR_SHA;
const singlePass=process.env.WILLYOU_ZENTAO_SINGLE_PASS==='1';
const systemWaitMs=Number(process.env.WILLYOU_ZENTAO_SYSTEM_WAIT_MS??25000);
assert([25000,180000].includes(systemWaitMs));
const detailIds=(process.env.WILLYOU_ZENTAO_DETAIL_IDS??'79064,79291,79967').split(',');
assert(detailIds.length>0&&detailIds.every(id=>['79064','79291','79967'].includes(id)));
const theme=process.env.WILLYOU_ZENTAO_THEME,bugOnly=process.env.WILLYOU_ZENTAO_BUG_ONLY==='1';
const stackSample=process.env.WILLYOU_ZENTAO_STACK_SAMPLE==='1';
const metadataFailures=Number(process.env.WILLYOU_ZENTAO_METADATA_FAILURES??0);assert([0,2].includes(metadataFailures));
const visualMatrix=process.env.WILLYOU_ZENTAO_VISUAL_MATRIX==='1';
assert(theme===undefined||['light','dark'].includes(theme));
let previous;
if(resumeRoot){
 assert(/^\/private\/tmp\/willyou-m10-zentao-live-[A-Za-z0-9]+$/.test(resumeRoot));
 previous=JSON.parse(await readFile(join(resumeRoot,'result.json'),'utf8'));
 assert.equal(previous.root,resumeRoot);
 assert.equal(previous.app,previousApp??executable);assert.equal(previous.asar,previousPin??pin);
 if(previousApp||previousPin){
  assert(previousApp?.startsWith('/private/tmp/willyou-m10-')&&/^[a-f0-9]{64}$/.test(previousPin??''));
  assert.equal(createHash('sha256').update(await readFile(join(dirname(dirname(previousApp)),'Resources/app.asar'))).digest('hex'),previousPin);
 }
 assert.equal(previous.status,'deferred-focus-loss');assert.equal(previous.sessions.at(-1)?.exit?.code,0);assert(previous.projectId&&previous.connection?.id);
 assert.equal(previous.userData,join(resumeRoot,'userdata'));
}
const baseUrl='http://192.168.106.185/biz/',account='lvhuixiao',connectionName='M10 禅道本人只读',projectName='M10 禅道只读验收';
const expectedBugIds=['79064','79291','79967'];
const root=await mkdtemp('/private/tmp/willyou-m10-zentao-live-'),userData=previous?.userData??join(root,'userdata'),home=join(resumeRoot??root,'home'),cwd=join(resumeRoot??root,'project');
if(!previous){await mkdir(home);await mkdir(cwd);}
const sha=b=>createHash('sha256').update(b).digest('hex'),unwrap=r=>{assert(r?.ok,'Original operation failed: '+r?.code);return r.value;};
const result={schema:'m10-zentao-live-ui-v1',root,userData,app:executable,startedAt:new Date().toISOString(),branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),system:process.platform,arch:process.arch,baseUrl,account,expectedBugIds,checks:[],inputs:[],sessions:[],status:'preparing',layer:'A original packaged UI/controller/provider and real biz13.0;private project setup via IPC is a prerequisite;no Agent/model/send/write actions;password only in user-operated native App form;private screenshots are not public evidence',isolation:{userData,privateAgentHome:home,systemHomeOnlyForNativeSafeStorage:true,noDailyCredentialsCopied:true}};
if(diagnosticTimeoutMs){result.diagnosticTimeoutMs=diagnosticTimeoutMs;result.layer='A original form interaction;I explicit120s temporary timeout diagnostic in owned packaged App;auth/identity only;not unmodified-product or full-case acceptance';}
result.driverSha256=sha(await readFile(new URL(import.meta.url)));
await writeFile(join(root,'driver-executed.mjs'),await readFile(new URL(import.meta.url)),{mode:0o600});
if(previous)result.resumeFrom={root:resumeRoot,status:previous.status,userData:previous.userData,normalExit:previous.sessions.at(-1).exit,priorConnectionId:previous.connection.id,previousApp:previous.app,previousAsar:previous.asar,newPackage:previous.app!==executable,secretCopied:false};
result.readPlan={singlePass,detailIds};
result.themePrerequisite=theme?{value:theme,setup:'Original appSettings RPC and reload;theme-control interaction is not claimed'}:null;result.bugOnly=bugOnly;
if(metadataFailures)result.failureInjection={scope:'Only first2language-metadata HTTP attempts in this owned App;real auth/object/resource traffic unchanged',count:metadataFailures};
result.systemObservationTimeoutMs=systemWaitMs;
let app,project,connection,stage='startup',sampleTimer;
let routeCheckedAt=0;
function verifyRoute(force=false){
 if(!expectedRouteMtu||!force&&Date.now()-routeCheckedAt<5000)return;
 const raw=execFileSync('/sbin/route',['-n','get','192.168.106.185'],{encoding:'utf8',timeout:5000}),iface=raw.match(/^\s*interface:\s*(\S+)/m),metrics=raw.match(/^\s*(recvpipe\s+sendpipe[^\n]*)\n([^\n]+)/m);assert(iface&&metrics,'The owned test route must remain inspectable');
 const values=Object.fromEntries(metrics[1].trim().split(/\s+/).map((key,i)=>[key,metrics[2].trim().split(/\s+/)[i]]));
 const state={at:new Date().toISOString(),configurationChanged:false,reader:'native route CLI;no Python process during GUI batch',before:{host:'192.168.106.185',interface:iface[1],mtu:Number(values.mtu)}};
 result.networkEnvironment??={expectedMtu:expectedRouteMtu,scope:'Pre-existing host route;driver never changes/restores system networking',samples:[]};result.networkEnvironment.samples.push(state);routeCheckedAt=Date.now();
 if(state.before.host!=='192.168.106.185'||state.before.interface!=='utun5'||state.before.mtu!==expectedRouteMtu)throw Object.assign(Error('The registered MTU1200 environment changed;stop this batch'),{code:'M10_MTU_PRECONDITION_LOST'});
}
const save=()=>writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
async function note(name,details={}){result.checks.push({name,stage,at:new Date().toISOString(),...details});await save();console.log(JSON.stringify({root,stage,check:name}));}
async function poll(fn,timeoutMs=30000){const end=Date.now()+timeoutMs;while(Date.now()<end){verifyRoute();const r=await fn();if(r)return r;await new Promise(r=>setTimeout(r,300));}throw Error('Bounded condition timed out at '+stage);}
const settle=()=>app.waitFor('document.getAnimations().every(a=>a.playState!=="running"||a.effect?.getTiming().iterations===Infinity)',systemWaitMs===180000?180000:8000);
async function key(key,code=key,vk=({Enter:13,Escape:27,Tab:9,End:35,Home:36,ArrowDown:40,a:65})[key],modifiers=0){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:vk,modifiers,...(key==='a'&&type==='keyDown'?{commands:['selectAll']}:{})});}
async function click(selector,text){verifyRoute();await settle();const point=await app.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width&&${text===undefined?'true':'e.textContent.trim().startsWith('+JSON.stringify(text)+')'});if(!e)throw Error('Missing control');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.disabled||!e.contains(document.elementFromPoint(x,y)))throw Error('Blocked control');return{x,y}})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});result.inputs.push({stage,selector,text});}
const selector=label=>'[aria-label='+JSON.stringify(label)+']';
async function fill(label,value){assert(label!=='认证凭据','The driver never types or reads passwords');await click('dialog '+selector(label));await key('a','KeyA',65,4);await app.cdp('Input.insertText',{text:value});assert.equal(await app.evaluate(`document.querySelector(${JSON.stringify('dialog '+selector(label))}).value`),value);}
async function chooseOption(label,expected){
 const s=selector(label),choice=await app.evaluate(`(()=>{const select=document.querySelector(${JSON.stringify(s)}),options=[...select.options],o=options.find(o=>o.value===${JSON.stringify(expected)});if(!o)return null;let prefix=o.textContent.trim();for(let n=1;n<=prefix.length;n++)if(options.filter(x=>x.textContent.trim().startsWith(prefix.slice(0,n))).length===1){prefix=prefix.slice(0,n);break;}return{prefix,current:select.value}})()`);assert(choice,'Original select must offer the expected option');
 // Match the existing P04 driver: native macOS popups are outside CDP, so
 // Tab to the closed control and use its original incremental key search.
 for(let n=0;n<80;n++){if(await app.evaluate(`document.activeElement?.matches(${JSON.stringify(s)})`))break;await key('Tab');}
 assert(await app.evaluate(`document.activeElement?.matches(${JSON.stringify(s)})`));
 if(choice.current!==expected)for(const ch of choice.prefix)await app.cdp('Input.dispatchKeyEvent',{type:'char',key:ch,text:ch});
 await app.waitFor(`document.querySelector(${JSON.stringify(s)}).value===${JSON.stringify(expected)}`,3000);await key('Tab');
}
async function installObserver(){
 await app.mainEvaluate(`(()=>{
  const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),crypto=process.getBuiltinModule('crypto');
  if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own isolated App required');
  const map=E.ipcMain._invokeHandlers,g={calls:[],forbidden:[],originals:[]},hash=v=>crypto.createHash('sha256').update(v).digest('hex');
  const ownWindow=E.BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()),focusRow=event=>({event,at:new Date().toISOString(),nativeFocused:ownWindow?.isFocused()??false});g.focusEvents=[focusRow('installed')];const onFocus=()=>g.focusEvents.push(focusRow('focus')),onBlur=()=>g.focusEvents.push(focusRow('blur'));ownWindow?.on('focus',onFocus);ownWindow?.on('blur',onBlur);
  const resource=r=>r?{id:r.id,revision:r.revision,size:r.size,mediaType:r.mediaType}:null;
  for(const name of ['tasks.create','tasks.open','applications.prepareSend','applications.reviewSend','applications.authorizeSend','applications.executeSend','applications.send','applications.replyDraft','applications.importAttachment','app.openExternal']){
   const fn=map.get(name);if(!fn)continue;g.originals.push([name,fn]);map.set(name,()=>{g.forbidden.push(name);throw Error('Read-only live acceptance forbids this action')});
  }
  for(const name of ['applications.testConnection','applications.saveConnection','applications.zentaoWork','applications.zentaoObject','applications.zentaoResource']){
   const fn=map.get(name);if(typeof fn!=='function')throw Error('Missing original read handler');g.originals.push([name,fn]);
   map.set(name,async function(event,...args){
    if(name==='applications.testConnection'){
     const c=args[0]?.config;if(c?.kind!=='zentao'||c.baseUrl!==${JSON.stringify(baseUrl)}||c.username!==${JSON.stringify(account)}||c.authMode!=='password')throw Error('Only the approved account and site may be tested');
    }
    const row={name,startedAt:new Date().toISOString()};g.calls.push(row);
    if(name==='applications.zentaoWork')row.request={kind:args[1]?.kind,limit:args[1]?.limit,hasCursor:!!args[1]?.cursor};
    if(name==='applications.zentaoObject')row.request={kind:args[1]?.kind,nativeId:args[1]?.reference?.nativeId};
    try{const r=await fn.call(this,event,...args);row.ok=r.ok;row.code=r.code??null;
     if(r.ok&&name==='applications.testConnection')row.candidateOperationId=r.value.operationId;
     if(r.ok&&name==='applications.zentaoWork'){const v=r.value;row.work={kind:v.kind,total:v.total,complete:v.complete,hasNext:!!v.nextCursor,problems:v.problems,presentationAvailable:v.presentation?.available===true,items:v.items.map(x=>({id:x.id,assignedTo:x.assignedTo,status:x.status,displayStatusSha256:hash(v.presentation?.choices.status?.[x.status]??x.status),titleSha256:hash(x.title),reference:x.reference}))};}
     if(r.ok&&name==='applications.zentaoObject'){
      const v=r.value,f=v.fields,p=v.presentation,displayExpectations={};
      for(const[key,name]of [['project','projectName'],['product','productName'],['module','moduleTitle']])if(typeof f[name]==='string'&&f[name].trim())displayExpectations[key]=hash(f[name]+(String(f[key])!=='0'?'（#'+f[key]+'）':''));
      for(const key of ['pri','severity','type','status'])if(p?.choices[key]&&Object.hasOwn(p.choices[key],String(f[key])))displayExpectations[key]=hash(p.choices[key][String(f[key])]||'—');
      if(Array.isArray(f.openedBuild)&&f.openedBuild.length&&f.openedBuild.every(x=>typeof x?.title==='string'))displayExpectations.openedBuild=hash(f.openedBuild.map(x=>x.title).join('、'));
      row.detail={kind:v.kind,id:v.id,complete:v.complete,missing:v.missing,fieldKeys:Object.keys(f),sourceFieldsSha256:hash(JSON.stringify(f)),presentationAvailable:p?.available===true,displayExpectations,titleSha256:hash(String(f.title??'')),reference:v.reference,body:resource(v.body),history:resource(v.history),attachments:v.attachments.map(x=>({filenameSha256:hash(x.filename),resource:resource(x.resource)}))};
     }
     if(r.ok&&name==='applications.zentaoResource'){const v=r.value;row.resource={encoding:v.encoding,length:v.length,nextOffset:v.nextOffset,bytesSha256:hash(Buffer.from(v.data,v.encoding==='base64'?'base64':'utf8'))};}
     return r;
    }finally{row.finishedAt=new Date().toISOString();}
   });
  }
  g.restore=()=>{ownWindow?.removeListener('focus',onFocus);ownWindow?.removeListener('blur',onBlur);for(const[n,f]of g.originals)map.set(n,f);return{calls:g.calls,forbidden:g.forbidden,focusEvents:g.focusEvents,restored:g.originals.every(([n,f])=>map.get(n)===f)};};globalThis.__m10LiveZen=g;
  if(${metadataFailures}>0){
   const methods=[],restore=g.restore;g.language={attempts:0,injected:0};
   for(const name of ['http','https']){const m=process.getBuiltinModule(name),original=m.request;methods.push([m,original]);m.request=function(...args){let url;try{url=new URL(String(args[0]))}catch{return original.apply(this,args);}if(url.origin==='http://192.168.106.185'&&url.pathname.endsWith('/langs')){g.language.attempts++;if(g.language.injected<${metadataFailures}){g.language.injected++;throw Error('Owned metadata-only recovery fixture');}}return original.apply(this,args);};}
   g.restore=()=>({...restore(),language:g.language,networkRestored:(()=>{for(const[m,fn]of methods)m.request=fn;return methods.every(([m,fn])=>m.request===fn)})()});
  }
  if(${diagnosticTimeoutMs}>0){
   const network=[],methods=[],originalTimer=globalThis.setTimeout,previousRestore=g.restore;
   g.timeoutDiagnostic={limitMs:${diagnosticTimeoutMs},changes:[],network,boundary:'Timing/status only;no headers,body,token or credential capture;original requests and auth unchanged'};
   for(const moduleName of ['http','https']){const m=process.getBuiltinModule(moduleName),original=m.request;methods.push([m,original]);m.request=function(...args){const request=original.apply(this,args);let url;try{url=new URL(String(args[0]))}catch{return request;}if(url.origin!=='http://192.168.106.185')return request;const start=Date.now(),row={path:url.pathname,method:args[1]?.method??'GET',startedAt:new Date().toISOString()};network.push(row);request.once('socket',socket=>{row.socketAssignedMs=Date.now()-start;if(!socket.connecting)row.connectedMs=Date.now()-start;else socket.once('connect',()=>row.connectedMs=Date.now()-start);});request.once('response',response=>{row.firstByteMs=Date.now()-start;row.status=response.statusCode;response.once('end',()=>row.responseEndMs=Date.now()-start);});request.once('error',error=>{row.errorCode=/^[A-Z_]+$/.test(error.code??'')?error.code:'OTHER'});request.once('close',()=>row.closedMs=Date.now()-start);return request;};}
   globalThis.setTimeout=function(fn,ms,...args){if(ms===8000||ms===10000){const stack=String(new Error().stack);if(stack.includes('app.asar/out/main/index.js')&&(ms===8000&&stack.includes('requestBytes')||ms===10000&&stack.includes('ApplicationConnectionService.verify'))){g.timeoutDiagnostic.changes.push({kind:ms===8000?'single-http':'connection-total',fromMs:ms,toMs:${diagnosticTimeoutMs},at:new Date().toISOString()});return originalTimer.call(this,fn,${diagnosticTimeoutMs},...args);}}return originalTimer.call(this,fn,ms,...args);};
   g.restore=()=>{globalThis.setTimeout=originalTimer;for(const[m,original]of methods)m.request=original;return{...previousRestore(),timeoutDiagnostic:g.timeoutDiagnostic,timerRestored:globalThis.setTimeout===originalTimer,networkRestored:methods.every(([m,original])=>m.request===original)}};
  }
  return true;
 })()`,{label:'live-zentao-read-observer'});
}
const observations=()=>app.mainEvaluate('({calls:globalThis.__m10LiveZen.calls,forbidden:globalThis.__m10LiveZen.forbidden})');
async function start(label){
 app=await openElectron({executable,userData,inspectMain:true,env:{HOME:homedir(),ZDOTDIR:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',NO_PROXY:'192.168.106.185,127.0.0.1,localhost'}});
 // Native keychain authorization can block Electron's main thread in a newly
 // signed build. This changes only bounded driver observation/input waits;
 // original provider/auth timers and safeStorage remain untouched.
 if(systemWaitMs!==25000){
  const cdp=app.cdp.bind(app),evaluate=app.evaluate.bind(app),main=app.mainEvaluate.bind(app);
  app.cdp=(method,params,ms)=>cdp(method,params,ms??systemWaitMs);
  app.evaluate=(expression,ms)=>evaluate(expression,ms??systemWaitMs);
  app.mainEvaluate=(expression,options={})=>main(expression,{timeoutMs:systemWaitMs,...options});
 }
 result.sessions.push({label,pid:app.processId});if(visualMatrix)await focusNewInstalledWindow(app,userData,result);installAppFocusGuard(app,result);
 if(stackSample){
  const pid=app.processId;sampleTimer=setTimeout(()=>{if(app?.processId!==pid)return;try{const command=execFileSync('/bin/ps',['-p',String(pid),'-o','comm='],{encoding:'utf8'}).trim();if(command!==executable)return;execFile('/usr/bin/sample',[String(pid),'1','1','-file',join(root,'owned-app-wait.sample')],{timeout:10000},error=>{result.stackSample={pid,at:new Date().toISOString(),completed:!error,scope:'One OS stack sample of this exact owned App;no network modification'};});}catch{result.stackSample={pid,completed:false,scope:'Original process ended before sample;no replacement inspected'};}},6000);
 }
 await app.evaluate(`document.title=${JSON.stringify(diagnosticTimeoutMs?'A · M10 禅道120秒诊断 · '+root.split('-').at(-1):'A · M10 禅道只读验收 · '+root.split('-').at(-1))};true`);await waitForInitialAppFocus(app,result,{userData,timeoutMs:systemWaitMs===180000?180000:30000});await installObserver();
}
async function quit(label){clearTimeout(sampleTimer);const observed=await app.mainEvaluate('globalThis.__m10LiveZen.restore()');assert(observed.restored);assert.deepEqual(observed.forbidden,[]);Object.assign(result.sessions.at(-1),{label,observed});assert.deepEqual(app.rendererErrors,[]);await writeFile(join(root,label+'.log'),app.logs(),{mode:0o600});await app.mainEvaluate("(()=>{setTimeout(()=>process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').app.quit(),30);return true})()");result.sessions.at(-1).exit=await app.waitForExit(15000);assert.equal(result.sessions.at(-1).exit.code,0);await app.close();app=undefined;}
async function goZen(){if(!await app.evaluate('!!document.querySelector(".m10-sidebar")'))await click('[data-testid=nav-apps]');await app.waitFor('!!document.querySelector(".m10-sidebar .installed")',systemWaitMs);await click('.m10-sidebar .installed','禅道');await app.waitFor('document.querySelector(".m10-app-heading")?.textContent.includes("禅道")',systemWaitMs);}
async function captureLists(label){
 await goZen();await app.waitFor('!!document.querySelector("[aria-label=我的禅道工作]")',systemWaitMs);
 for(const kind of bugOnly?['bug']:['bug','story']){
  const before=(await observations()).calls.length;
  if(kind==='story')await click('[role=tab]','研发需求');
  else if(await app.evaluate('document.querySelector("[aria-label=禅道对象类型] [aria-selected=true]")?.textContent!=="Bug"'))await click('[role=tab]','Bug');
  const row=await poll(async()=>{const calls=(await observations()).calls;return calls.filter(c=>c.name==='applications.zentaoWork'&&c.request.kind===kind&&c.finishedAt).at(-1);},45000);
  assert(row.ok,'Original current-source read failed: '+row.code);
  assert(row.work.items.every(x=>x.assignedTo===account),'No out-of-scope assignee');
  assert.equal(new Set(row.work.items.map(x=>x.id)).size,row.work.items.length);
  await app.waitFor('!document.querySelector("[aria-label=我的禅道工作] .m10-section-heading button").disabled',10000);
  await app.screenshot(join(root,label+'-'+kind+'-list.png'));
  result[label+'-'+kind]={...row.work,visibleCount:await app.evaluate('document.querySelectorAll(".m10-object-list>button").length')};
  assert.equal(result[label+'-'+kind].visibleCount,row.work.items.length);
  if(row.work.items.length){
   assert(row.work.presentationAvailable,'Current-instance field metadata must be available for this repair verification');
   const statuses=await app.evaluate('[...document.querySelectorAll(".m10-object-list>button .m10-pill")].map(e=>e.textContent)');
   assert.deepEqual(statuses.map(sha),row.work.items.map(x=>x.displayStatusSha256));
   result[label+'-'+kind].translatedStatusChecked=true;
  }
  if(kind==='bug')result[label+'-bug'].matchesUserScreenshot=JSON.stringify(row.work.items.map(x=>x.id).sort())===JSON.stringify(expectedBugIds);
  await note(label+' '+kind+' real list and visible rows checked',{count:row.work.items.length,total:row.work.total,complete:row.work.complete,hasNext:row.work.hasNext});
  if(kind==='story'&&!row.work.items.length){await app.waitFor('document.body.innerText.includes("当前没有指派给你的研发需求")');continue;}
  for(const item of row.work.items.filter(x=>kind!=='bug'||detailIds.includes(x.id)).slice(0,kind==='bug'?3:1)){
   const countBefore=(await observations()).calls.length;
   await click('.m10-object-list>button', '#'+item.id+' ·');
   const detail=await poll(async()=>{const calls=(await observations()).calls.slice(countBefore);return calls.find(c=>c.name==='applications.zentaoObject'&&c.request.nativeId===item.id&&c.finishedAt);},45000);
   assert(detail.ok,'Original current-source detail failed: '+detail.code);
   await app.waitFor('!!document.querySelector("dialog .m10-object-detail")',15000);
   await app.waitFor('![...document.querySelectorAll("dialog [role=status]")].some(e=>e.textContent.includes("正在读取原内容"))',30000);
   const facts=await app.evaluate(`(()=>{const d=document.querySelector('dialog'),pre=[...d.querySelectorAll('.m10-resource-view pre')];return{resourceSections:pre.length,nonemptySections:pre.filter(p=>p.textContent.trim().length>0).length,alerts:[...d.querySelectorAll('[role=alert]')].length,attachments:d.querySelectorAll('.m10-attachment').length,activeInside:d.contains(document.activeElement)}})()`);
   assert(detail.detail.presentationAvailable,'Repair verification requires real metadata, not raw fallback');
   const display=await app.evaluate(`(()=>{const d=document.querySelector('.m10-object-detail');return{hasObjectString:d.textContent.includes('[object Object]'),duplicateNameHelpers:['projectName','productName','moduleTitle'].some(k=>d.querySelector('[data-field="'+k+'"]')),fields:[...d.querySelectorAll('[data-field]')].map(e=>({key:e.dataset.field,text:e.querySelector('strong').textContent,contained:e.scrollWidth<=e.clientWidth+1}))}})()`);
   assert.equal(display.hasObjectString,false);assert.equal(display.duplicateNameHelpers,false);
   const hashes=Object.fromEntries(display.fields.map(f=>[f.key,sha(f.text)]));
   for(const[key,expected]of Object.entries(detail.detail.displayExpectations))assert.equal(hashes[key],expected,'Real field presentation mismatch: '+key);
   assert(display.fields.every(f=>f.contained),'Field contents must wrap within their own cell');
   facts.presentation={available:true,fieldsChecked:Object.keys(detail.detail.displayExpectations),fieldTextHashes:hashes,noObjectString:true,noDuplicateNameHelpers:true,cellsContained:true};
   if(visualMatrix){
    for(const size of ['normal','minimum']){
     const dims=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own App only');const w=E.BrowserWindow.getAllWindows()[0];if(${size==='minimum'})w.setSize(...w.getMinimumSize(),false);else w.setContentSize(1400,900,false);return w.getContentSize()})()`);
     await app.waitFor(`innerWidth===${dims[0]}&&innerHeight===${dims[1]}`,10000);await settle();
     const paint=await app.evaluate(zentaoPresentationPaintExpression);assert.equal(paint.dialogHorizontalOverflow,false);assert.equal(paint.hasObjectString,false);assert(paint.fields.every(f=>f.contained));
     (result.paintFrames??=[]).push({id:item.id,kind,size,...paint,fields:paint.fields.map(({text,...f})=>({...f,textSha256:sha(text)})),alerts:paint.alerts.map(sha)});
     await app.screenshot(join(root,label+'-'+kind+'-'+item.id+'-'+size+'-paint.png'));
     await note('Real '+kind+' detail '+size+' '+(theme??'original')+' native size: field fonts/colors/layout and wrapping observed');
    }
   }
   await app.screenshot(join(root,label+'-'+kind+'-'+item.id+'-detail.png'));
   result[label+'-'+kind+'-'+item.id]={detail:detail.detail,visible:facts};
   await click('dialog footer button','关闭');await app.waitFor('!document.querySelector("dialog")');
   await note(label+' '+kind+' #'+item.id+' original detail/body/history UI checked',{complete:detail.detail.complete,missing:detail.detail.missing,resourceSections:facts.resourceSections,attachments:facts.attachments});
  }
 }
}
async function captureMetadataRecovery(){
 await goZen();await app.waitFor('!!document.querySelector("[aria-label=我的禅道工作]")',systemWaitMs);
 const first=await poll(async()=>(await observations()).calls.find(c=>c.name==='applications.zentaoWork'&&c.finishedAt),45000);assert(first.ok&&!first.work.presentationAvailable&&first.work.items.length===3);
 await app.waitFor('document.body.innerText.includes("状态说明暂不可用")',15000);await note('Injected metadata failure keeps the complete real Bug list with explicit raw-value notice');
 let count=(await observations()).calls.length;await click('.m10-object-list>button','#79291 ·');
 const initial=await poll(async()=>(await observations()).calls.slice(count).find(c=>c.name==='applications.zentaoObject'&&c.finishedAt),45000);assert(initial.ok&&initial.detail.complete&&!initial.detail.presentationAvailable);
 await app.waitFor('document.querySelector("[data-field=type] strong")?.textContent==="codeerror"&&document.querySelector("dialog")?.textContent.includes("字段说明暂不可用")',15000);
 await app.waitFor('![...document.querySelectorAll("dialog [role=status]")].some(e=>e.textContent.includes("正在读取原内容"))',45000);await app.screenshot(join(root,'metadata-failure-private.png'));await note('Detail metadata failure preserves original source,version,names,body and history with retry');
 count=(await observations()).calls.length;await click('dialog button','重试字段说明');
 await app.waitFor('[...document.querySelectorAll("dialog button")].find(e=>e.textContent==="重试字段说明")?.disabled===true',5000);
 const recovered=await poll(async()=>(await observations()).calls.slice(count).find(c=>c.name==='applications.zentaoObject'&&c.finishedAt),45000);assert(recovered.ok&&recovered.detail.presentationAvailable);assert.deepEqual(recovered.detail.reference,initial.detail.reference);assert.equal(recovered.detail.sourceFieldsSha256,initial.detail.sourceFieldsSha256);assert.deepEqual(recovered.detail.body,initial.detail.body);assert.deepEqual(recovered.detail.history,initial.detail.history);
 const rows=await app.evaluate('Object.fromEntries([...document.querySelectorAll("dialog [data-field]")].map(e=>[e.dataset.field,e.querySelector("strong").textContent]))');for(const[key,digest]of Object.entries(recovered.detail.displayExpectations))assert.equal(sha(rows[key]),digest,key);
 await app.waitFor('![...document.querySelectorAll("dialog [role=alert]")].length',15000);await app.screenshot(join(root,'metadata-recovered-private.png'));await note('Original retry restores current-instance labels/enums with unchanged raw fields and resource revisions');
 await click('dialog footer button','关闭');await app.waitFor('!document.querySelector("dialog")');count=(await observations()).calls.length;
 await click('[aria-label=我的禅道工作] .m10-section-heading button','刷新列表');const refreshed=await poll(async()=>(await observations()).calls.slice(count).find(c=>c.name==='applications.zentaoWork'&&c.finishedAt),45000);assert(refreshed.ok&&refreshed.work.presentationAvailable);assert.deepEqual(refreshed.work.items.map(x=>x.id),first.work.items.map(x=>x.id));await app.waitFor('!document.body.innerText.includes("状态说明暂不可用")',15000);
 const language=await app.mainEvaluate('globalThis.__m10LiveZen.language');assert.deepEqual(language,{attempts:3,injected:2});await note('List refresh recovers labels from successful scoped metadata cache;exactly2injections and1real metadata request',{language});
 result.metadataRecovery={first,initial,recovered,refreshed,language};
}
try{
 verifyRoute(true);
 result.asar=sha(await readFile(join(dirname(dirname(executable)),'Resources/app.asar')));assert.equal(result.asar,pin);
 for(const name of Object.keys(process.env))if(!['PATH','TMPDIR','LANG','LC_ALL'].includes(name))delete process.env[name];
 await start('initial');
 if(theme){await app.invoke('appSettings.update','theme','y'+theme);const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${origin}&&!!document.querySelector('[data-testid=nav-apps]')`,15000,{navigation:true});await app.waitFor(`document.documentElement.classList.contains('ydark')===${theme==='dark'}`,10000);await app.evaluate(`document.title=${JSON.stringify('A · M10 禅道只读验收 · '+theme+' · '+root.split('-').at(-1))};true`);}
 if(previous){
  project={id:previous.projectId};result.projectId=project.id;
  connection=unwrap(await app.invoke('applications.connections','zentao')).find(c=>c.id===previous.connection.id);
  assert(connection?.hasSecret&&connection.authorization==='connected');assert.equal(connection.identityRevision,previous.connection.identityRevision);
  const selected=unwrap(await app.invoke('applications.projectSettings',project.id,'zentao'));assert(selected.enabled&&selected.connections.zentao===connection.id);
  await note('Normal reopen retains this exact isolated connection and explicit project selection;no re-entry or new save');
  await click('[data-testid=nav-apps]');await app.waitFor('!!document.querySelector(".m10-sidebar")');
 }else{
 project=await app.invoke('projects.create',{name:projectName,aliases:[],description:'Private real-ZenTao read-only acceptance prerequisite',rulesPath:null},[{label:'isolated',path:cwd}]);result.projectId=project.id;
 await click('[data-testid=nav-apps]');await app.waitFor('document.querySelectorAll(".m10-catalog-item").length===2');await click('.m10-catalog-open:has(.zentao)');await app.waitFor('!!document.querySelector(".m10-app-heading")');await click('.m10-app-heading button.primary','添加应用');await app.waitFor('document.querySelector(".m10-app-heading button.primary")?.textContent.includes("添加连接")');await click('.m10-app-heading button.primary','添加连接');await app.waitFor('!!document.querySelector("dialog input[aria-label=认证凭据]")');
 for(const[label,value]of [['连接名称',connectionName],['禅道服务地址',baseUrl],['禅道账号',account]])await fill(label,value);
 await chooseOption('禅道认证方式','password');await app.screenshot(join(root,'public-form-prefilled.png'));await click('dialog '+selector('认证凭据'));
 stage='waiting-form-password';result.status='waiting-form-password';await save();console.log(JSON.stringify({root,appPid:app.processId,status:result.status,action:diagnosticTimeoutMs?'Only in this isolated App: enter the authorized password and click 测试连接 once;do not save.':'Only in this isolated App: enter the authorized password,click 测试连接,then 保存连接.'}));
 }
 if(diagnosticTimeoutMs){
  stage='120s-authentication-diagnostic';
  const attempt=await poll(async()=>{const calls=(await observations()).calls;return calls.find(c=>c.name==='applications.testConnection'&&c.finishedAt);},300000);
  result.attempt={ok:attempt.ok,code:attempt.code,startedAt:attempt.startedAt,finishedAt:attempt.finishedAt,elapsedMs:Date.parse(attempt.finishedAt)-Date.parse(attempt.startedAt)};
  if(attempt.candidateOperationId){unwrap(await app.invoke('applications.discardConnectionTest','zentao',attempt.candidateOperationId));result.candidateCleanup='Original discard RPC for this one staged diagnostic candidate;test cleanup,not a UI-cancel acceptance result';}
  result.connectionCount=unwrap(await app.invoke('applications.connections','zentao')).length;assert.equal(result.connectionCount,0);
  await app.screenshot(join(root,'120s-authentication-outcome.png'));
  result.status=attempt.ok?'passed-120s-auth-diagnostic':attempt.code==='TIMEOUT'?'timeout-under-120s':'failed-120s-auth-diagnostic';
  await note('One120s original-form authentication diagnostic completed',{ok:attempt.ok,code:attempt.code,elapsedMs:result.attempt.elapsedMs});
 }else{
 connection??=await poll(async()=>{const rows=unwrap(await app.invoke('applications.connections','zentao'));return rows.find(c=>c.name===connectionName&&c.hasSecret&&c.authorization==='connected');},20*60*1000);
 assert.equal(connection.config.baseUrl,baseUrl);assert.equal(connection.config.username,account);result.connection={id:connection.id,identityRevision:connection.identityRevision,hasSecret:connection.hasSecret};stage='select-project';result.status='running';await note('User tested and saved the original authenticated connection; secret never read by driver');
 await click('.m10-sidebar button','项目选用');await app.waitFor('!!document.querySelector("[aria-label=当前应用项目]")');
 if(!await app.evaluate(`!![...document.querySelectorAll('[aria-label=当前应用项目] option')].find(e=>e.value===${JSON.stringify(project.id)})`)){const t=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${t}&&!!document.querySelector('[data-testid=nav-apps]')`,15000,{navigation:true});await app.evaluate("document.title='A · M10 禅道只读验收';true");await click('[data-testid=nav-apps]');await click('.m10-sidebar button','项目选用');}
 await chooseOption('当前应用项目',project.id);await app.waitFor('document.querySelectorAll(".m10-project-application").length===2');
 const toggle=selector('为'+projectName+'启用禅道');await app.waitFor(`!!document.querySelector(${JSON.stringify(toggle)})&&!document.querySelector(${JSON.stringify(toggle)}).disabled`);if(await app.evaluate(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-checked')!=='true'`))await click(toggle);
 const radio=selector('为'+projectName+'选用'+connectionName);await app.waitFor(`!!document.querySelector(${JSON.stringify(radio)})&&!document.querySelector(${JSON.stringify(radio)}).disabled`);await click(radio);await app.waitFor(`document.querySelector(${JSON.stringify(radio)}).checked&&!document.querySelector(${JSON.stringify(radio)}).disabled`,15000);
 const selected=unwrap(await app.invoke('applications.projectSettings',project.id,'zentao'));assert(selected.enabled&&selected.connections.zentao===connection.id);await note('Original project-selection UI explicitly enables only this project and saved connection');
 if(metadataFailures){stage='metadata-failure-recovery';await captureMetadataRecovery();await quit('metadata-recovery-normal-quit');result.status='passed-metadata-recovery-subset';}
 else{stage='initial-reads';await captureLists('initial');await quit('before-restart');
 if(!singlePass){stage='normal-restart';await start('restarted');await captureLists('restarted');await note('Normal same-userData restart preserves connection, project selection and real read-only access');}
 result.status='passed-live-readonly-subset';}
 }
}catch(error){result.status=error.code==='M10_MTU_PRECONDITION_LOST'?'blocked-network-environment':isAppFocusYield(error)?'deferred-focus-loss':'failed';result.stage=stage;result.error=String(error);process.exitCode=isAppFocusYield(error)?2:1;if(app)try{await app.screenshot(join(root,'failure.png'));}catch{}}
finally{if(app){try{await quit('final-normal-quit');}catch(error){result.cleanupError=String(error);await app.close();}}try{verifyRoute(true);}catch(error){result.networkAfterError=String(error);}result.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({root,status:result.status,checks:result.checks.length,stage,error:result.error}));}
