import { build } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire, builtinModules } from 'node:module';
import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const [output] = process.argv.slice(2);
if (!output?.startsWith('/private/tmp/willyou-m12-s1-s3-')) throw Error('Explicit private S3 output required');
await mkdir(output,{recursive:false});
for(const [source,name] of [['scripts/browser/s3-command-integration.mjs','driver.source.mjs'],['scripts/browser/s1-service-host.ts','host.source.ts'],['scripts/browser/s3-fixtures.mjs','fixture.source.mjs'],['src/shared/browser-commands.generated.json','catalog.source.json']])await cp(source,join(output,name));
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
  const assert=(value,message)=>{if(!value)throw Error(message);};
  const success=async(args,input)=>{const r=await cli(args,input);assert(r.raw.code===0,'Command failed: '+args.slice(0,3).join(' ')+' '+JSON.stringify(r.parsed.error));return r.parsed.data;};
  const evaluate=async expression=>{new Function('return ('+expression+')');const r=await success(['browser','eval','--expression',expression]);return JSON.parse(r.value);};
  const state=()=>evaluate('window.s3State()');
  const catalog=JSON.parse(await readFile('src/shared/browser-commands.generated.json','utf8'));
  if(process.argv[3]!=='remaining'){
  result.stage='T030-discovery';result.discovery=await cli(['--list']);
  const listed=result.discovery.parsed.capabilities.filter(c=>c.command[0]==='browser');assert(listed.length===82,'Expected82browsercommands');
  result.parseOnly=[];
  function example(schema){if(schema.anyOf)return example(schema.anyOf[0]);if(schema.enum)return schema.enum[0];if(schema.type==='object')return{};if(schema.type==='array')return['/private/tmp/synthetic'];if(schema.type==='boolean')return true;if(schema.type==='integer'||schema.type==='number')return Math.max(schema.minimum??0,schema.exclusiveMinimum===undefined?0:schema.exclusiveMinimum+1);return 'x';}
  for(const c of catalog){const input=Object.fromEntries(Object.entries(c.input.properties).map(([key,schema])=>[key,example(schema)]));if('task' in input)input.task='foreign-task-not-authorized';if('page' in input)input.page='page-not-present';if('page' in input&&'index' in input)delete input.index;const argv=c.command.concat(Object.entries(input).flatMap(([key,value])=>['--'+key,typeof value==='string'?value:JSON.stringify(value)]));const r=await cli(argv);assert(r.parsed.error?.code!=='INVALID_RESPONSE','Invalid native response '+c.id);assert(!/unknown command|参数段|missing value/i.test(r.parsed.error?.message??''),'Native parse rejected generated usage '+c.id);result.parseOnly.push({id:c.id,args:argv,code:r.raw.code,error:r.parsed.error?.code??null});}
  result.openUrl=await cli(['browser','open-url','--url','x']);assert(result.openUrl.raw.code===2,'open-url must not exist');await persist();
  }
  const base=new URL(result.ready.url).origin,created=await success(['browser','tab','create','--url',base+'/s3-forms']);result.pageId=created.pageId;
  const snapshot=await success(['browser','snapshot']);result.initialSnapshot=snapshot;
  const ref=name=>{const value=snapshot.refs.find(r=>r.name===name)?.ref;assert(value,'Missing ref '+name);return value;};
  const field=ref('Input'),editor=ref('Editor'),check=ref('Check'),choice=ref('Choice'),action=ref('Action');
  const get=(what,element)=>success(['browser','get','--what',what,...(element?['--element',element]:[])]);
  if(process.argv[3]!=='remaining'){
  result.stage='T031-input';result.input=[];
  for(const value of ['123','true']){await success(['browser','fill','--element',field,'--value',value]);result.input.push({value,actual:await get('value',field)});}
  result.objectInput=await cli(['browser','fill','--element',field,'--value','{"a":1}']);
  result.positionInput=await cli(['browser','goto',base+'/s3-invalid']);
  await success(['browser','fill','--json',JSON.stringify({element:field,value:'123'})]);result.jsonInput=await get('value',field);
  }
  result.stage='T032-stdin';result.stdin=[];
  for(const input of ['abc\n','中文🙂\n','abc\n\n']){await success(['browser','fill','--element',ref('Multiline'),'--stdin','value'],input);result.stdin.push({input,actual:await get('value',ref('Multiline'))});}
  const invalidBytes=await call({command:'cli',args:['browser','fill','--element',field,'--stdin','value'],inputBase64:Buffer.from([255]).toString('base64')});result.invalidUtf8={raw:invalidBytes,parsed:JSON.parse(invalidBytes.stdout)};
  result.tooLarge=await cli(['browser','fill','--element',field,'--stdin','value'],'x'.repeat(262145));
  result.duplicateStdin=await cli(['browser','fill','--element',field,'--value','x','--stdin','value'],'abc');
  result.stage='T058-get-is';result.beforeRead=await state();result.gets={};for(const what of ['text','html','value','url','title','count','box'])result.gets[what]=await get(what,['url','title'].includes(what)?undefined:what==='text'||what==='html'?action:field);
  result.states={};for(const what of ['visible','enabled','checked'])result.states[what]=await success(['browser','is','--what',what,'--element',check]);result.afterRead=await state();
  result.stage='T063-forms';result.forms=[];
  for(const [args,property,expected] of [
    [['fill','--element',editor,'--value','editable'],'editor','editable'],
    [['fill','--element',field,'--value',''],'value',''],
    [['type','--input','abc'],'value','abc'],
    [['focus','--element',field],'value','abc'],
    [['inserttext','--text','中文'],'value','abc中文'],
    [['clear','--element',field],'value',''],
    [['fill','--element',field,'--value','replace-me'],'value','replace-me'],
    [['select-all','--element',field],'value','replace-me'],
    [['inserttext','--text','replacement'],'value','replacement'],
    [['select','--element',choice,'--value','B'],'choice','B'],
    [['check','--element',check],'checked',true],
    [['uncheck','--element',check],'checked',false],
  ]){const output=await success(['browser',...args]),actual=await state(),cliObserved=property==='checked'?await success(['browser','is','--what','checked','--element',check]):await get('value',property==='editor'?editor:property==='choice'?choice:field);result.forms.push({args,property,expected,actual,output,cliObserved});assert(actual[property]===expected&&cliObserved.result===expected,'Form mismatch '+args[0]);}
  for(const key of ['Enter','Escape','Tab'])await success(['browser','keypress','--key',key]);result.keys=await state();
  result.stage='T085-storage';result.storage=[];
  for(const kind of ['local','session']){await success(['browser','storage',kind,'set','--key','s3-key','--value','stored-中文']);const read=await success(['browser','storage',kind,'get','--key','s3-key']),actual=await state();await success(['browser','storage',kind,'clear']);const cleared=await state();result.storage.push({kind,read,actual,cleared});assert(actual[kind]==='stored-中文'&&cleared[kind]===null,'Storage mismatch '+kind);}
  result.stage='T085-source-boundary';
  for(const kind of ['local','session'])await success(['browser','storage',kind,'set','--key','s3-key','--value','origin-a']);
  result.sourceBefore=await state();const crossUrl=base.replace('127.0.0.1','localhost')+'/s3-scope',cross=await success(['browser','tab','create','--url',crossUrl]);
  result.crossStorage=[];for(const kind of ['local','session']){const read=await success(['browser','storage',kind,'get','--key','s3-key','--page',cross.pageId]);await success(['browser','storage',kind,'clear','--page',cross.pageId]);result.crossStorage.push({kind,read});}
  const crossState=await success(['browser','eval','--page',cross.pageId,'--expression','({local:localStorage.getItem("s3-key"),session:sessionStorage.getItem("s3-key")})']);result.sourceOther=JSON.parse(crossState.value);result.sourceAfter=await state();await success(['browser','tab','close','--page',cross.pageId]);
  result.stage='T066-wait';result.waits=[];
  for(const args of [['--selector','#field'],['--text','Action'],['--url',base+'/s3-forms'],['--load','networkidle'],['--selector','#hidden','--state','hidden'],['--selector','#field','--state','visible'],['--selector','#field','--text','Action']])result.waits.push(await success(['browser','wait',...args,'--timeout','3000']));
  result.combinedNegative=await cli(['browser','wait','--selector','#missing','--text','Action','--timeout','300']);
  result.readScript=await cli(['browser','wait','--fn','true']);result.waitFnBefore=await state();result.waitFn=await cli(['browser','wait','fn','--fn',"(document.getElementById('action').click(),false)",'--timeout','300']);result.waitFnAfter=await state();
  result.stage='T061-actions';result.actions=[];
  for(const args of [['click','--element',action],['dblclick','--element',action],['hover','--element',action],['drag','--from',ref('Drag source'),'--to',ref('Drop target')],['scrollintoview','--element',ref('Bottom')],['scroll','--direction','up','--amount','200'],['highlight','--selector',action]]){const output=await success(['browser',...args]);result.actions.push({args,output,state:await state()});}
  result.stage='T056-pdf';result.pdf=await success(['browser','pdf']);const pdf=await readFile(result.pdf.file.path);result.pdfObserved={bytes:pdf.length,sha256:createHash('sha256').update(pdf).digest('hex'),header:pdf.subarray(0,8).toString()};
  result.stage='T073-tabs';result.tabs=[];for(let i=0;i<2;i++)await success(['browser','tab','create','--url',base+'/s3-precondition-'+i]);result.tabs.push(await success(['browser','tab','list']));const second=await success(['browser','tab','create','--url',base+'/s3-second']);result.tabs.push(await success(['browser','tab','current']));result.tabs.push(await success(['browser','tab','show','--page',created.pageId]));await success(['browser','tab','switch','--page',created.pageId]);result.tabs.push(await success(['browser','tab','list']));await success(['browser','tab','close','--page',second.pageId]);result.tabs.push(await success(['browser','tab','list']));result.final=await state();
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
