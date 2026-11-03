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
  const created=await cli(['browser','tab','create','--url',result.ready.url]);if(created.raw.code!==0)throw Error('Page creation failed');
  const page=created.parsed.data.pageId;result.page=page;result.identityCases=[];
  const snapshot=async(expectAvailable=true)=>{const response=await cli(['browser','snapshot','--page',page]);if(response.raw.code!==0)throw Error('Snapshot setup failed');const button=response.parsed.data.refs.find(item=>item.role==='button'&&item.name==='Action');if(!button||expectAvailable&&!button.available)throw Error('Expected available button missing');return {response,button};};
  const reset=()=>call({command:'reset'});
  const first=await snapshot();const action=await cli(['browser','click','--page',page,'--element',first.button.ref]),observed=await call({command:'observe'});
  result.normal={snapshot:first.response,action,observed};if(action.raw.code!==0||observed.hits.length!==1)throw Error('Normal reference control failed');
  for(const mode of ['replace','insert','reorder','rename']){
    await reset();if(mode==='reorder')await call({command:'identity-mutate',mode:'duplicate'});
    const before=await snapshot(),mutation=await call({command:'identity-mutate',mode});
    result.identityCases.push({name:mode,snapshot:before.response,mutation,action:await cli(['browser','click','--element',before.button.ref]),observed:await call({command:'observe'})});await persist();
  }
  await reset();let before=await snapshot();
  const navigation=await cli(['browser','goto','--url',result.ready.url+'?navigated=1']);
  result.identityCases.push({name:'navigation',snapshot:before.response,navigation,action:await cli(['browser','click','--element',before.button.ref]),observed:await call({command:'observe'})});
  await reset();before=await snapshot();const newer=await snapshot();
  result.identityCases.push({name:'old-generation',snapshot:before.response,newer:newer.response,action:await cli(['browser','click','--element',before.button.ref]),observed:await call({command:'observe'})});
  await reset();before=await snapshot();const other=await cli(['browser','tab','create','--url',result.ready.url]),otherPage=other.parsed.data.pageId,otherSnapshot=await cli(['browser','snapshot','--page',otherPage]);
  result.crossPage={a:before.response,b:otherSnapshot,otherPage,action:await cli(['browser','click','--page',otherPage,'--element',before.button.ref]),aObserved:await call({command:'observe'}),bObserved:await call({command:'observe',pageId:otherPage})};
  for(const mode of ['once','continuous','aba']){
    await reset();await call({command:'snapshot-race',mode});
    const value=await snapshot(false),action=await cli(['browser','click','--element',value.button.ref]);
    result.identityCases.push({name:'snapshot-'+mode,snapshot:value.response,action,observed:await call({command:'observe'})});
    await call({command:'identity-clear'});await persist();
  }
  result.snapshotRaces=await call({command:'identity-diagnostics'});
  await reset();before=await snapshot();await call({command:'replace-next-arm',mode:'button'});
  result.postArmClick={action:await cli(['browser','click','--element',before.button.ref]),observed:await call({command:'observe'})};
  await reset();before=await snapshot();await call({command:'replace-next-arm',mode:'new-button'});
  result.postArmNewButton={action:await cli(['browser','click','--element',before.button.ref]),observed:await call({command:'observe'})};
  await reset();before=await snapshot();let field=before.response.parsed.data.refs.find(item=>item.role==='textbox'&&item.name==='Input')?.ref;
  if(!field)throw Error('Field missing');await cli(['browser','fill','--element',field,'--value','preserve']);before=await snapshot();field=before.response.parsed.data.refs.find(item=>item.role==='textbox'&&item.name==='Input')?.ref;
  const beforeClone=await call({command:'observe'});await call({command:'replace-next-arm'});
  result.postArmFill={before:beforeClone,action:await cli(['browser','fill','--element',field,'--value','WRONG']),observed:await call({command:'observe'})};

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
