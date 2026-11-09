import { build } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire, builtinModules } from 'node:module';
import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const [output] = process.argv.slice(2);
if (!output?.startsWith('/private/tmp/willyou-m12-s1-s3-')) throw Error('Explicit private S3 output required');
await mkdir(output,{recursive:false});
for(const [source,name] of [['scripts/browser/s3-command-tail.mjs','driver.source.mjs'],['scripts/browser/s1-service-host.ts','host.source.ts'],['scripts/browser/s3-fixtures.mjs','fixture.source.mjs'],['src/shared/browser-commands.generated.json','catalog.source.json']])await cp(source,join(output,name));
const require=createRequire(resolve('package.json')), result={at:new Date().toISOString(),steps:[]};
let host, exited, logs='', seq=0;
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
  if(selected.has('tabs')){
    result.stage='T073-tabs';result.tabs=[];for(let i=0;i<2;i++)await success(['browser','tab','create','--url',base+'/s3-precondition-'+i]);
    result.tabs.push(await success(['browser','tab','list','--show-profile','true']));const child=await success(['browser','tab','create','--url',base+'/s3-created']);result.createdTab=child;result.tabs.push(await success(['browser','tab','current']));result.tabs.push(await success(['browser','tab','show','--page',parent.pageId]));await success(['browser','tab','switch','--index','1']);result.tabs.push(await success(['browser','tab','list']));await success(['browser','tab','close','--page',child.pageId]);result.tabs.push(await success(['browser','tab','list']));result.workspace=await call({command:'s2-popup-state'});
  }
  result.stage='complete';await persist();
} catch(error) { result.failure=String(error.stack??error); }
finally {
  if(host) {
    if(result.ready&&host.connected&&host.exitCode===null&&host.signalCode===null)try{result.cleanup=await call({command:'close'});}catch(error){result.cleanupError=String(error);host.kill('SIGTERM');}
    else host.kill('SIGTERM');
    const hardStop=setTimeout(()=>host.kill('SIGKILL'),5000);result.hostExit=await exited;clearTimeout(hardStop);
  }
  await writeFile(join(output,'host.log'),logs);await writeFile(join(output,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({failure:result.failure,steps:result.steps.map(step=>({command:step.args.slice(0,3),code:step.raw.code,error:step.parsed?.error?.code,ms:step.ms})),cleanup:result.cleanup,hostExit:result.hostExit}));
}
