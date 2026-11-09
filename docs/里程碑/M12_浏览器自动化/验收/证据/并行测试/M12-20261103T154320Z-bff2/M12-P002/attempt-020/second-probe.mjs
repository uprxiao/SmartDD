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

  const previous=JSON.parse(await readFile(join(dirname(output),'first/result.json'),'utf8'));result.previous={pageId:previous.pageId,ref:previous.savedRef,hostPid:previous.hostPid,runId:previous.ready.runId};
  const created=await cli(['browser','tab','create','--url',result.ready.url]);if(created.raw.code!==0)throw Error('Create failed');result.pageId=created.parsed.data.pageId;
  const decode=ref=>/^(@k[0-9a-z]+)s(\d+)e(\d+)$/.exec(ref);const old=decode(previous.savedRef);if(!old)throw Error('Ref shape changed');
  for(let i=0;i<24;i++){const s=await cli(['browser','snapshot']);if(s.raw.code!==0)throw Error('Snapshot failed');result.freshRef=s.parsed.data.refs.find(r=>r.role==='button'&&r.name==='Action').ref;const fresh=decode(result.freshRef);if(!fresh)throw Error('Ref shape changed');if(fresh[1]!==old[1]||Number(fresh[2])>=Number(old[2]))break;}
  result.oldClick=await cli(['browser','click','--element',previous.savedRef]);result.afterOld=await call({command:'observe'});
  result.freshClick=await cli(['browser','click','--element',result.freshRef]);result.afterFresh=await call({command:'observe'});result.phase='second';

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
