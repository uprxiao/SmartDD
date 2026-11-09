import { build } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire, builtinModules } from 'node:module';
import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const [output] = process.argv.slice(2);
if (!output?.startsWith('/private/tmp/willyou-m12-s1-')) throw Error('Explicit private S1 output required');
await mkdir(output,{recursive:false});
const require=createRequire(resolve('package.json')), result={at:new Date().toISOString(),steps:[]};
let host, exited, logs='', seq=0;
const persist=()=>writeFile(join(output,'live.json'),JSON.stringify(result,null,2));
const call=command=>new Promise((ok,no)=>{
  const id=++seq,timer=setTimeout(()=>{host.off('message',receive);no(Error('fixture command timeout: '+command.command));},110000);
  const receive=message=>{if(message.id!==id)return;clearTimeout(timer);host.off('message',receive);message.error?no(Error(message.error)):ok(message.value);};
  host.on('message',receive);host.send({...command,id});
});
const cli=async(args,input)=>{
  const started=performance.now(),raw=await call({command:'cli',args,input});
  const step={args,...(input===undefined?{}:{inputBytes:Buffer.byteLength(input)}),ms:Math.round(performance.now()-started),raw};
  result.steps.push(step);await persist();
  const parsed=JSON.parse(raw.stdout);step.parsed=parsed;await persist();return {raw,parsed};
};
try {
  await build({configFile:false,publicDir:false,cacheDir:join(output,'vite-cache'),logLevel:'error',ssr:{noExternal:true},resolve:{alias:{'@root':resolve('.'),'@shared':resolve('src/shared')}},build:{ssr:resolve('scripts/browser/s1-service-host.ts'),target:'node22',outDir:join(output,'build'),emptyOutDir:false,rollupOptions:{external:['electron','ws','better-sqlite3'],output:{format:'cjs',entryFileNames:'host.cjs',inlineDynamicImports:true}}}});
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
  result.hostPid=host.pid;host.stdout.on('data',bytes=>logs+=bytes);host.stderr.on('data',bytes=>logs+=bytes);
  exited=new Promise(ok=>host.once('exit',(code,signal)=>ok({code,signal})));
  result.ready=await new Promise((ok,no)=>{const timer=setTimeout(()=>no(Error('service host ready timeout')),30000);host.on('message',message=>{if(message.ready||message.fatal){clearTimeout(timer);message.fatal?no(Error(message.fatal)):ok(message);}});host.once('exit',()=>{clearTimeout(timer);no(Error('service host early exit'));});});await persist();
  const create=await cli(['browser','tab','create','--url',result.ready.url+'input']);if(create.raw.code!==0)throw Error('Page creation failed');
  const prepare=async({seed='',selection,max=false}={})=>{
    await call({command:'input-clear'});await cli(['browser','goto','--url',result.ready.url+'input'+(max?'?max=3000':'')]);
    const snap=await cli(['browser','snapshot']);const field=snap.parsed.data.refs.find(ref=>ref.role==='textbox'&&ref.name==='Input');if(!field?.available)throw Error('Input ref unavailable');
    const filled=await cli(['browser','fill','--element',field.ref,'--stdin','value'],seed);if(filled.raw.code!==0)throw Error('Input focus/seed failed');
    if(selection)await call({command:'input-select',selection});
    return call({command:'input-observe'});
  };
  result.cases=[];
  const runCase=async({name,command='type',input,setup={},fault})=>{
    const before=await prepare(setup);
    await call({command:'input-fault',mode:fault?.mode??'observe',threshold:fault?.threshold});
    const action=await cli(['browser',command,'--stdin',command==='type'?'input':'text'],input);
    const after=await call({command:'input-observe'});await call({command:'input-clear'});
    const diagnostics=await call({command:'input-diagnostics'}),requestId=action.parsed.operation?.requestId??action.parsed.requestId,receipt=diagnostics.operations.find(row=>row.request_id===requestId)??null;
    const queried=requestId?await cli(['browser','operation','get','--request',requestId]):null;
    result.cases.push({name,command,input:{points:Array.from(input).length,bytes:Buffer.byteLength(input),sha256:createHash('sha256').update(input).digest('hex')},setup,fault,before,action,after,diagnostic:diagnostics.faults.at(-1),receipt,queried});await persist();
  };
  const full='ABcd0123'.repeat(2048);
  await runCase({name:'type-16384',input:full});
  await runCase({name:'type-16385',input:full+'X'});
  await runCase({name:'type-Unicode-4096',input:'A中😀b'.repeat(1024)});
  const large='中😀abc'.repeat(6553)+'终abc';if(Buffer.byteLength(large)!==65536)throw Error('64KiB fixture calculation');
  await runCase({name:'inserttext-64KiB',command:'inserttext',input:large});
  const partial='abcdefghijklmnopqrstuvwxyz'.repeat(230)+'abcde';
  await runCase({name:'boundary',input:partial,fault:{mode:'boundary'}});
  await runCase({name:'middle-333',input:partial,fault:{mode:'middle',threshold:2333}});
  await runCase({name:'selection-middle-333',input:partial,setup:{seed:'O'.repeat(9000),selection:[1000,2000]},fault:{mode:'middle',threshold:2333}});
  await runCase({name:'maxlength-4000',input:'M'.repeat(4000),setup:{max:true}});
  await runCase({name:'maxlength-interrupted',input:'M'.repeat(4000),setup:{max:true},fault:{mode:'middle',threshold:3000}});
  result.diagnostics=await call({command:'input-diagnostics'});

} catch(error) { result.failure=String(error.stack??error); }
finally {
  if(host) {
    if(result.ready)try{result.cleanup=await call({command:'close'});}catch(error){result.cleanupError=String(error);host.kill('SIGTERM');}
    else host.kill('SIGTERM');
    const hardStop=setTimeout(()=>host.kill('SIGKILL'),5000);result.hostExit=await exited;clearTimeout(hardStop);
  }
  await writeFile(join(output,'host.log'),logs);await writeFile(join(output,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({failure:result.failure,steps:result.steps.map(step=>({command:step.args.slice(0,3),code:step.raw.code,error:step.parsed?.error?.code,ms:step.ms})),cleanup:result.cleanup,hostExit:result.hostExit}));
}
