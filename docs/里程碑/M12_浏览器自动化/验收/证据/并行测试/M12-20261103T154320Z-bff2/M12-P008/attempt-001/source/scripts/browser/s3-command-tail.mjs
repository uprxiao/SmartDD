import { build } from 'vite';
import { spawn,spawnSync } from 'node:child_process';
import { createRequire, builtinModules } from 'node:module';
import { mkdir, writeFile, readFile, cp,rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createServer as createHttpsServer} from 'node:https';
import {s3FixtureHtml} from './s3-fixtures.mjs';
const [output] = process.argv.slice(2);
if (!output?.startsWith('/private/tmp/willyou-m12-s1-')) throw Error('Explicit private browser output required');
await mkdir(output,{recursive:false});
for(const [source,name] of [['scripts/browser/s3-command-tail.mjs','driver.source.mjs'],['scripts/browser/s1-service-host.ts','host.source.ts'],['scripts/browser/s3-fixtures.mjs','fixture.source.mjs'],['src/shared/browser-commands.generated.json','catalog.source.json']])await cp(source,join(output,name));
const require=createRequire(resolve('package.json')), result={at:new Date().toISOString(),steps:[]};
let host, exited, tlsServer, logs='', seq=0;
const persist=()=>writeFile(join(output,'live.json'),JSON.stringify(result,null,2));
const call=command=>new Promise((ok,no)=>{
  if(!host?.connected||host.exitCode!==null||host.signalCode!==null){no(Error('Owned service host is already disconnected'));return;}
  const id=++seq;let settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);host.off('message',receive);host.off('exit',onExit);host.off('error',onError);error?no(error):ok(value);};
  const receive=message=>{if(message.id===id)finish(message.error?Error(message.error):null,message.value);};
  const onExit=(code,signal)=>finish(Error('Owned service host exited during '+command.command+': '+code+'/'+signal));
  const onError=error=>finish(error),timer=setTimeout(()=>finish(Error('fixture command timeout: '+command.command)),110000);
  host.on('message',receive);host.once('exit',onExit);host.once('error',onError);host.send({...command,id},error=>{if(error)finish(error);});
});
const cli=async(args,input)=>{
  const started=performance.now(),raw=await call({command:'cli',args,input});
  const step={args,...(input===undefined?{}:{inputBytes:Buffer.byteLength(input)}),ms:Math.round(performance.now()-started),raw};
  result.steps.push(step);await persist();
  const parsed=JSON.parse(raw.stdout);step.parsed=parsed;await persist();return {raw,parsed};
};
try {
  await build({configFile:false,publicDir:false,cacheDir:join(output,'vite-cache'),logLevel:'error',ssr:{noExternal:true},resolve:{alias:{'@root':resolve('.'),'@shared':resolve('src/shared'),'@main':resolve('src/main')}},build:{ssr:resolve('scripts/browser/s1-service-host.ts'),target:'node22',outDir:join(output,'build'),emptyOutDir:false,rollupOptions:{external:['electron','ws','better-sqlite3'],output:{format:'cjs',entryFileNames:'host.cjs',inlineDynamicImports:true}}}});
  for(const name of ['ws','better-sqlite3','bindings','file-uri-to-path']) {
    const parent=name==='bindings'?createRequire(require.resolve('better-sqlite3')):name==='file-uri-to-path'?createRequire(createRequire(require.resolve('better-sqlite3')).resolve('bindings')):require;
    await cp(dirname(parent.resolve(name+'/package.json')),join(output,'build/node_modules',name),{recursive:true});
  }
  const compiled=await readFile(join(output,'build/host.cjs'),'utf8'),allowed=new Set([...builtinModules,...builtinModules.map(name=>'node:'+name),'electron','ws','better-sqlite3']);
  for(const [,specifier] of compiled.matchAll(/^const [^\n]+?= require\("([^"]+)"\)/gm))if(!allowed.has(specifier))throw Error('Unexpected external dependency: '+specifier);
  const resources=join(output,'resources');
  for(const name of ['capability-bundles','agent-browser'])await cp(resolve('out',name),join(resources,name),{recursive:true});
  await mkdir(join(resources,'native'),{recursive:true});
  for(const name of ['willyou-app','willyou-process-identity'])await cp(resolve('out/native',name),join(resources,'native',name));
  result.baseline={hostSha256:createHash('sha256').update(compiled).digest('hex'),bundleIndex:JSON.parse(await readFile(join(resources,'capability-bundles/index.json'),'utf8')).indexHash};
  const env={PATH:process.env.PATH,HOME:join(output,'home'),TMPDIR:output,M12_RESOURCE_ROOT:resources};
  host=spawn(require('electron'),[join(output,'build/host.cjs'),'--user-data-dir='+join(output,'userData')],{env,stdio:['ignore','pipe','pipe','ipc']});
  result.hostPid=host.pid;host.on('error',error=>{result.hostErrors??=[];result.hostErrors.push(String(error));});host.on('message',message=>{if(message.fatal){result.hostFatals??=[];result.hostFatals.push(message.fatal);void persist();}});host.stdout.on('data',bytes=>logs+=bytes);host.stderr.on('data',bytes=>logs+=bytes);
  exited=new Promise(ok=>host.once('exit',(code,signal)=>ok({code,signal})));
  result.ready=await new Promise((ok,no)=>{const timer=setTimeout(()=>no(Error('service host ready timeout')),30000);host.on('message',message=>{if(message.ready||message.fatal){clearTimeout(timer);message.fatal?no(Error(message.fatal)):ok(message);}});host.once('exit',()=>{clearTimeout(timer);no(Error('service host early exit'));});});await persist();
  const selected=new Set((process.argv[3]??'close,wait,keys,actions,pdf,tabs').split(','));
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  const success=async(args,input)=>{const r=await cli(args,input);assert(r.raw.code===0,'Command failed '+args.slice(0,3).join(' ')+': '+JSON.stringify(r.parsed.error));return r.parsed.data;};
  const evaluate=async expression=>{new Function('return ('+expression+')');const value=await success(['browser','eval','--expression',expression]);return JSON.parse(value.value);};
  const state=()=>evaluate('window.s3State()'),base=new URL(result.ready.url).origin;
  const parent=await success(['browser','tab','create','--url',base+'/s3-tail']);result.pageId=parent.pageId;
  const snapshot=await success(['browser','snapshot']);result.initialSnapshot=snapshot;
  const ref=name=>{const value=snapshot.refs.find(r=>r.name===name)?.ref;assert(value,'Missing '+name);return value;};
  if(selected.has('prompt-probe')){
    result.stage='prompt-native-diagnostic';result.promptInfo=await call({command:'s3-prompt-probe-info',pageId:parent.pageId});
    const before=await call({command:'s3-dialog-state'}),pending=call({command:'s3-prompt-probe-open',pageId:parent.pageId}).then(value=>({value}),error=>({error:String(error)}));
    const until=Date.now()+3000;let observed;
    while(Date.now()<until){observed=await call({command:'s3-dialog-state'});if(observed.events.slice(before.events.length).some(event=>event.method==='Page.javascriptDialogOpening'))break;await new Promise(resolve=>setTimeout(resolve,20));}
    result.promptNativeEvents=observed.events.slice(before.events.length);
    if(result.promptNativeEvents.some(event=>event.method==='Page.javascriptDialogOpening'))result.promptNativeAccept=await cli(['browser','dialog','accept','--text','native-accepted']);
    result.promptNativeResult=await pending;await persist();
  }
  if(selected.has('close')){
    result.stage='close-regression';const child=await success(['browser','tab','create','--url',base.replace('127.0.0.1','localhost')+'/s3-close']);await success(['browser','snapshot','--page',child.pageId]);
    result.close=await cli(['browser','tab','close','--page',child.pageId]);assert(result.close.raw.code===0&&result.steps.at(-1).ms<5000,'queued close must complete');
    result.closeReceipt=await success(['browser','operation','get','--request',result.close.parsed.operation.requestId]);result.afterClose=await success(['browser','tab','list']);assert(!result.afterClose.tabs.some(tab=>tab.pageId===child.pageId),'closed page still listed');
  }
  if(selected.has('reads')){
    result.stage='T058-read-mutation-regression';await evaluate('window.s3StartReadWatch()');
    result.readQueries=[await success(['browser','get','--what','value','--element',ref('Input')]),await success(['browser','is','--what','checked','--element',ref('Check')])];
    result.readMutations=await evaluate('window.s3ReadMutations');await persist();assert(result.readMutations===0,'S3-READ-REF-MUTATION: read commands mutate observable DOM attributes');
    await evaluate('(window.s3ReadObserver.disconnect(),0)');
  }
  if(selected.has('wait')){
    result.stage='T066-waits';result.waits=[];
    for(const args of [['--selector','#field'],['--text','Action'],['--url',base+'/s3-tail'],['--load','networkidle'],['--selector','#hidden','--state','hidden'],['--selector','#field','--state','visible'],['--selector','#field','--text','Action']])result.waits.push(await success(['browser','wait',...args,'--timeout','3000']));
    result.combinedNegative=await cli(['browser','wait','--selector','#missing','--text','Action','--timeout','300']);result.readScript=await cli(['browser','wait','--fn','true']);
    result.waitFnBefore=await state();result.waitFn=await cli(['browser','wait','fn','--fn',"(document.getElementById('action').click(),false)",'--timeout','300']);result.waitFnAfter=await state();
    result.waitFnPositive=await success(['browser','wait','fn','--fn','true','--timeout','500']);result.waitFnReceipt=await success(['browser','operation','get','--request',result.waitFn.parsed.requestId]);result.waitDiagnostics=await call({command:'cancel-state'});
  }
  if(selected.has('keys')){
    result.stage='T063-key-supplement';const field=ref('Input'),check=ref('Check');await success(['browser','fill','--element',field,'--value','replacement']);await success(['browser','check','--element',check]);await success(['browser','uncheck','--element',check]);result.keyReads=[];
    for(const key of ['Enter','Escape','Tab']){await success(['browser','keypress','--key',key]);const read=await success(['browser','get','--what','value','--element',field]),actual=await state();result.keyReads.push({key,read,actual});assert(read.result==='replacement'&&actual.keys.includes(key),'key readback mismatch');}
  }
  if(selected.has('drag')){
    result.stage='T061-drag-diagnostic';await call({command:'identity-observe-guards',pageId:parent.pageId});
    await success(['browser','check','--element',ref('Check')]);await success(['browser','uncheck','--element',ref('Check')]);await success(['browser','keypress','--key','Tab']);await success(['browser','hover','--element',ref('Action')]);
    result.dragBefore=await state();result.drag=await cli(['browser','drag','--from',ref('Drag source'),'--to',ref('Drop target')]);result.dragAfter=await state();result.dragGuard=await call({command:'observe'});await persist();
  }
  if(selected.has('actions')){
    result.stage='T061-actions';result.actions=[];const action=ref('Action');
    for(const args of [['click','--element',action],['dblclick','--element',action],['hover','--element',action],['drag','--from',ref('Drag source'),'--to',ref('Drop target')],['scrollintoview','--element',ref('Bottom')],['scroll','--direction','up','--amount','200'],['highlight','--selector',action]]){const output=await success(['browser',...args]);result.actions.push({args,output,state:await state()});}
  }
  if(selected.has('pdf')){
    result.stage='T056-pdf';result.pdf=await success(['browser','pdf']);const bytes=await readFile(result.pdf.file.path);result.pdfObserved={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),header:bytes.subarray(0,8).toString()};await cp(result.pdf.file.path,join(output,'actual.pdf'));
  }
  if(selected.has('mouse')){
    result.stage='T062-mouse';result.mouse=[];
    await success(['browser','mouse','move','--x','350','--y','350']);
    for(const button of ['left','right','middle']){await success(['browser','mouse','down','--button',button]);await success(['browser','mouse','up','--button',button]);result.mouse.push({button,state:await state()});}
    await success(['browser','mouse','wheel','--dy','173','--dx','11']);
    result.mouseWheel=await state();
  }
  if(selected.has('capture')){
    result.stage='T070-capture';result.captureStart=await success(['browser','capture','start']);result.captureResponses=[];
    for(let i=0;i<5;i++)result.captureResponses.push(await evaluate('window.s3Fetch('+JSON.stringify('/s3-api/capture-'+i)+')'));
    result.captureStop=await success(['browser','capture','stop']);const bytes=await readFile(result.captureStop.file.path);await cp(result.captureStop.file.path,join(output,'actual.har'));
    result.captureObserved={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),har:JSON.parse(bytes)};
  }
  if(selected.has('intercept')){
    result.stage='T071-intercept';result.interceptEnable=await success(['browser','intercept','enable','--patterns','**/s3-api/keep-A*,**/s3-api/keep-B*']);
    result.interceptResponses=[];for(const path of ['/s3-api/keep-A','/s3-api/keep-B'])result.interceptResponses.push(await evaluate('window.s3Fetch('+JSON.stringify(path)+')'));
    result.interceptList=await success(['browser','intercept','list']);result.interceptDisable=await success(['browser','intercept','disable']);
    result.routeAbort=await success(['browser','exec','--command','network route **/s3-api/abort-me --abort']);result.abortedFetch=await evaluate('window.s3Fetch("/s3-api/abort-me")');
    result.serverRequests=await call({command:'s3-server-requests'});
  }
  if(selected.has('logs')){
    result.stage='T069-logs';result.producedLogs=await evaluate('(console.log("M12-T069-log-A"),console.warn("M12-T069-log-B"),42)');
    await evaluate('window.s3Fetch("/s3-api/log-network")');result.console=await success(['browser','console']);result.consoleLimit=await success(['browser','console','--limit','1']);result.network=await success(['browser','network']);
  }
  if(selected.has('dialog')){
    result.stage='T068-dialog';result.dialogs=[];
    for(const kind of ['alert','confirm','prompt'])for(const action of ['accept','dismiss']){
      const before=await call({command:'s3-dialog-state'}),expression='(setTimeout(()=>{window.s3DialogResult={kind:'+JSON.stringify(kind)+',value:window['+JSON.stringify(kind)+']("M12 test dialog","initial")}},100),"armed")';
      await success(['browser','eval','--expression',expression]);
      const until=Date.now()+3000;let observed;
      while(Date.now()<until){observed=await call({command:'s3-dialog-state'});if(observed.events.slice(before.events.length).some(event=>event.method==='Page.javascriptDialogOpening'))break;await new Promise(resolve=>setTimeout(resolve,20));}
      assert(observed?.events.slice(before.events.length).some(event=>event.method==='Page.javascriptDialogOpening'),'dialog did not actually open');
      const returned=await success(['browser','dialog',action,...(kind==='prompt'&&action==='accept'?['--text','accepted-中文']:[])]),actual=await evaluate('window.s3DialogResult');
      result.dialogs.push({kind,action,returned,actual,events:(await call({command:'s3-dialog-state'})).events.slice(before.events.length)});await persist();
    }
  }
  if(selected.has('navigation')){
    result.stage='T072-navigation';result.navigations=[];
    for(const path of ['/s3-nav-A','/s3-nav-B']){await success(['browser','goto','--url',base+path]);result.navigations.push({command:'goto',path,actual:await state(),cliUrl:await success(['browser','get','--what','url']),ui:await call({command:'s3-page-status',pageId:parent.pageId})});}
    for(const command of ['back','forward','reload']){const returned=await success(['browser',command]);result.navigations.push({command,returned,actual:await state(),cliUrl:await success(['browser','get','--what','url']),ui:await call({command:'s3-page-status',pageId:parent.pageId})});}
    result.navigationRequests=await call({command:'s3-server-requests'});
    result.delayedPrecondition=await call({command:'s3-load-delayed',pageId:parent.pageId});
    result.delayedBefore=await call({command:'s3-page-status',pageId:parent.pageId});result.delayedReload=await success(['browser','reload']);result.delayedAfter={url:await success(['browser','get','--what','url']),ui:await call({command:'s3-page-status',pageId:parent.pageId})};
    const file=join(output,'navigation fixture.html');await writeFile(file,'<!doctype html><title>M12 local fixture</title><p>Local test file</p>');result.fileNavigation=await success(['browser','goto','--url',pathToFileURL(file).href]);result.fileNavigationAfter={url:await success(['browser','get','--what','url']),ui:await call({command:'s3-page-status',pageId:parent.pageId})};
    result.invalidNavigation=await cli(['browser','goto','--url','mailto:invalid@example.test']);
    await success(['browser','goto','--url',base+'/s3-tail']);
  }
  if(selected.has('tabs')){
    result.stage='T073-tabs';result.tabs=[];for(let i=0;i<2;i++)await success(['browser','tab','create','--url',base+'/s3-precondition-'+i]);
    result.tabs.push(await success(['browser','tab','list','--show-profile','true']));const child=await success(['browser','tab','create','--url',base+'/s3-created']);result.createdTab=child;result.afterCreateWorkspace=await call({command:'s2-popup-state'});result.tabs.push(await success(['browser','tab','current']));result.tabs.push(await success(['browser','tab','show','--page',parent.pageId]));await success(['browser','tab','switch','--index','1']);result.tabs.push(await success(['browser','tab','list']));await success(['browser','tab','close','--page',child.pageId]);result.tabs.push(await success(['browser','tab','list']));result.workspace=await call({command:'s2-popup-state'});
  }
  if(selected.has('eval')){
    result.stage='T057-eval';result.evaluations=[];
    for(const expression of ['({number:7,text:"中文"})','23','"literal text"','undefined','Promise.resolve({promised:true})'])result.evaluations.push({expression,output:await success(['browser','eval','--stdin','expression'],expression)});
    result.evalError=await cli(['browser','eval','--expression','throw new Error("T057 synthetic throw")']);
    await call({command:'error-navigate-during-eval',pageId:parent.pageId});result.evalNavigation=await cli(['browser','eval','--expression','new Promise(resolve=>setTimeout(()=>resolve("late"),3000))']);
    await success(['browser','goto','--url',base+'/s3-tail']);
    result.loop=await call({command:'cli-begin',args:['browser','eval','--expression','window.s3LoopStarted=true;navigator.sendBeacon("/s3-api/loop-started","started");while(true){}']});
    const until=Date.now()+5000;while(Date.now()<until){result.loopDiagnostics=await call({command:'cancel-state'});result.loopServer=await call({command:'s3-server-requests'});if(result.loopDiagnostics.operations?.some(operation=>operation.command==='eval'&&operation.state==='running')&&result.loopServer.requests.some(request=>request.path==='/s3-api/loop-started'))break;await new Promise(resolve=>setTimeout(resolve,25));}
    result.loopCancel=await call({command:'cli-sigterm',pid:result.loop.pid});result.loopResult=await call({command:'cli-result',pid:result.loop.pid});result.loopResponsive=await success(['browser','eval','--expression','({responsive:true,started:window.s3LoopStarted===true})']);
  }
  if(selected.has('eval-navigation')){
    result.stage='T057-current-page-navigation';result.navigationEvalTarget=await success(['browser','tab','current']);const pageId=result.navigationEvalTarget.result.pageId;
    await call({command:'error-navigate-during-eval',pageId});result.currentPageEvalNavigation=await cli(['browser','eval','--page',pageId,'--expression','new Promise(resolve=>setTimeout(()=>resolve("late"),3000))']);
    result.currentPageAfterNavigation=await success(['browser','get','--page',pageId,'--what','url']);
  }
  if(selected.has('profile-cookies')){
    result.stage='S4-profiles-cookies';result.profiles={};
    const a=(await success(['browser','tab','profile','create','--label','Synthetic A'])).result.profile,b=(await success(['browser','tab','profile','create','--label','Synthetic B','--scope','imported'])).result.profile;
    result.profiles={a,b,list:await success(['browser','tab','profile','list'])};
    const pageA=await success(['browser','tab','create','--profile',a.id,'--url',base+'/s3-profile-A']),pageB=await success(['browser','tab','create','--profile',b.id,'--url',base+'/s3-profile-B']);result.profilePages={a:pageA,b:pageB};
    const onPage=(page,args,input)=>success(['browser',...args,'--page',page.pageId],input),pageEval=async(page,expression)=>JSON.parse((await onPage(page,['eval','--stdin','expression'],expression)).value);
    result.profileShows=[await onPage(pageA,['tab','profile','show']),await onPage(pageB,['tab','profile','show'])];
    result.profileSecurity=await pageEval(pageA,'({require:typeof require,process:typeof process,willyou:typeof window.willyou,electronAPI:typeof window.electronAPI})');
    result.beforeProfileRefusals=await success(['browser','tab','list']);result.profileRefusals=[await cli(['browser','tab','create','--profile','00000000-0000-4000-8000-000000000000']),await cli(['browser','tab','create','--partition','persist:unregistered-daily'])];result.afterProfileRefusals=await success(['browser','tab','list']);
    await onPage(pageA,['cookie','set','--name','isolation','--value','profile-A']);await onPage(pageA,['storage','local','set','--key','s3-key','--value','profile-A']);
    result.isolation={aCookies:await onPage(pageA,['cookie','get']),aLocal:await onPage(pageA,['storage','local','get','--key','s3-key']),bCookies:await onPage(pageB,['cookie','get']),bLocal:await onPage(pageB,['storage','local','get','--key','s3-key'])};
    result.cache={a:await pageEval(pageA,'fetch("/s4-api/cache").then(response=>response.json())'),aAgain:await pageEval(pageA,'fetch("/s4-api/cache").then(response=>response.json())'),b:await pageEval(pageB,'fetch("/s4-api/cache").then(response=>response.json())'),server:await call({command:'s3-server-requests'})};
    result.stage='S4-cookie-attributes';
    await writeFile(join(output,'tls.cnf'),'[req]\ndistinguished_name=dn\nx509_extensions=extensions\nprompt=no\n[dn]\nCN=127.0.0.1\n[extensions]\nsubjectAltName=IP:127.0.0.1\n');
    const certificateArgs=['req','-x509','-nodes','-newkey','rsa:2048','-days','1','-config',join(output,'tls.cnf'),'-keyout',join(output,'tls-key.pem'),'-out',join(output,'tls-cert.pem')];
    const generation=spawnSync('/usr/bin/openssl',certificateArgs,{encoding:'utf8'});await writeFile(join(output,'tls-generation.json'),JSON.stringify({command:['/usr/bin/openssl',...certificateArgs],status:generation.status,signal:generation.signal,stdout:generation.stdout,stderr:generation.stderr,...(generation.error?{error:String(generation.error)}:{})},null,2));assert(generation.status===0,'Synthetic TLS certificate preparation failed');
    result.tlsRequests=[];tlsServer=createHttpsServer({key:await readFile(join(output,'tls-key.pem')),cert:await readFile(join(output,'tls-cert.pem'))},(request,response)=>{
      result.tlsRequests.push({url:request.url,method:request.method,cookie:request.headers.cookie??null});
      if(request.url==='/form'){response.setHeader('content-type','text/html; charset=utf-8');response.end(s3FixtureHtml);}
      else if(request.url?.startsWith('/s4-api/cookie/')){response.setHeader('content-type','application/json');response.setHeader('cache-control','no-store');response.end(JSON.stringify({received:true,cookie:request.headers.cookie??null}));}else{response.writeHead(204).end();}
    });await new Promise((ok,no)=>{tlsServer.once('error',no);tlsServer.listen(0,'127.0.0.1',ok);});
    const tlsOrigin='https://127.0.0.1:'+tlsServer.address().port;result.tlsOrigin=tlsOrigin;result.tlsTrust=await call({command:'s4-trust-fixture',pageId:pageA.pageId,input:await readFile(join(output,'tls-cert.pem'),'utf8')});
    await onPage(pageA,['goto','--url',tlsOrigin+'/form']);
    const expires=Math.floor(Date.now()/1000)+3600;result.cookieExpected={name:'attributes',value:'synthetic-attributes',domain:'127.0.0.1',path:'/s4-api/cookie',secure:true,httpOnly:true,sameSite:'Strict',expires};
    result.cookieSet=await onPage(pageA,['cookie','set','--name','attributes','--value','synthetic-attributes','--domain','127.0.0.1','--path','/s4-api/cookie','--secure','true','--httpOnly','true','--sameSite','Strict','--expires',String(expires)]);
    result.cookieRead=await onPage(pageA,['cookie','get','--url',tlsOrigin+'/s4-api/cookie/inside']);result.cookieScript=(await pageEval(pageA,'({cookie:document.cookie})')).cookie;result.cookieRequest=await pageEval(pageA,'window.s3Fetch("/s4-api/cookie/inside")');
    result.cookieDelete=await onPage(pageA,['cookie','delete','--name','attributes','--domain','127.0.0.1']);result.cookieAfter=await onPage(pageA,['cookie','get','--url',tlsOrigin+'/s4-api/cookie/inside']);result.cookieRequestAfter=await pageEval(pageA,'window.s3Fetch("/s4-api/cookie/after")');result.tlsTrustObserved=await call({command:'s4-trust-status'});await persist();
  }

  result.stage='complete';await persist();
} catch(error) { result.failure=String(error.stack??error); }
finally {
  if(host) {
    if(result.ready&&host.connected&&host.exitCode===null&&host.signalCode===null)try{result.cleanup=await call({command:'close'});}catch(error){result.cleanupError=String(error);host.kill('SIGTERM');}
    else host.kill('SIGTERM');
    const hardStop=setTimeout(()=>host.kill('SIGKILL'),5000);result.hostExit=await exited;clearTimeout(hardStop);
  }
  if(tlsServer){tlsServer.closeAllConnections();await new Promise(ok=>tlsServer.close(ok));result.tlsServerClosed=true;}
  await rm(join(output,'tls-key.pem'),{force:true});result.syntheticTlsKeyRemoved=true;
  await writeFile(join(output,'host.log'),logs);await writeFile(join(output,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({failure:result.failure,steps:result.steps.map(step=>({command:step.args.slice(0,3),code:step.raw.code,error:step.parsed?.error?.code,ms:step.ms})),cleanup:result.cleanup,hostExit:result.hostExit}));
}
