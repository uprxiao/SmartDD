import { build } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire, builtinModules } from 'node:module';
import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const [output] = process.argv.slice(2);
if (!output?.startsWith('/private/tmp/willyou-m12-s1-')) throw Error('Explicit private S1 output required');
await mkdir(output,{recursive:false});await writeFile(join(output,'driver.source.mjs'),await readFile(new URL(import.meta.url)));await writeFile(join(output,'host.source.ts'),await readFile('scripts/browser/s1-service-host.ts'));
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

  const base=result.ready.url.replace(/\/$/,''),poll=async fn=>{const end=Date.now()+15000;do{const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,60));}while(Date.now()<end);throw Error('Popup condition timeout');};
  async function snapshotRef(page,name){const s=await cli(['browser','snapshot','--page',page]);if(s.raw.code!==0)throw Error('Popup snapshot failed');const ref=s.parsed.data.refs.find(r=>r.name===name)?.ref;if(!ref)throw Error('Missing '+name);return ref;}
  const created=await cli(['browser','tab','create','--url',base+'/s2-popups']);if(created.raw.code!==0)throw Error('Opener setup failed');const parent=created.parsed.data.pageId;result.parent=parent;result.before=await call({command:'s2-popup-state',pageId:parent});
  const ordinaryRef=await snapshotRef(parent,'Ordinary tab');result.ordinaryClick=await cli(['browser','click','--page',parent,'--element',ordinaryRef]);result.ordinary=await poll(async()=>{const x=await call({command:'s2-popup-state',pageId:parent});return x.pages.some(p=>p.pageId!==parent&&p.kind==='tab')?x:null;});const ordinary=result.ordinary.pages.find(p=>p.pageId!==parent);await call({command:'s2-close-page',pageId:ordinary.pageId});
  const oauthRef=await snapshotRef(parent,'OAuth login');result.oauthClick=await cli(['browser','click','--page',parent,'--element',oauthRef]);const opened=await poll(async()=>{const x=await cli(['browser','tab','list']);return x.parsed.data.tabs.some(p=>p.kind==='popup'&&p.openerPageId===parent)?x:null;});result.oauthListed=opened;const child=opened.parsed.data.tabs.find(p=>p.kind==='popup'&&p.openerPageId===parent);result.oauthChild=child;const account=await snapshotRef(child.pageId,'Account');result.fill=await cli(['browser','fill','--page',child.pageId,'--element',account,'--value','m12-account@example.test']);const authorize=await snapshotRef(child.pageId,'Authorize');result.authorize=await cli(['browser','click','--page',child.pageId,'--element',authorize]);result.callback=await poll(async()=>{const x=await call({command:'s2-popup-state',pageId:parent});return x.opener?.result==='m12-account@example.test'&&!x.pages.some(p=>p.pageId===child.pageId)?x:null;});
  const namedRef=await snapshotRef(parent,'Named popup');result.namedClick=await cli(['browser','click','--page',parent,'--element',namedRef]);result.named=await poll(async()=>{const x=await call({command:'s2-popup-state',pageId:parent});return x.pages.some(p=>p.kind==='popup')?x:null;});await call({command:'s2-close-page',pageId:parent});result.afterParentClose=await call({command:'s2-popup-state'});
  const next=await cli(['browser','tab','create','--url',base+'/s2-popups']);if(next.raw.code!==0)throw Error('Burst opener setup failed');const burstParent=next.parsed.data.pageId;result.burstParent=burstParent;result.burst=await cli(['browser','eval','--page',burstParent,'--expression','window.s2Burst()']);const burst=JSON.parse(result.burst.parsed.data.value);result.burstObserved=await poll(async()=>{const x=await call({command:'s2-popup-state',pageId:burstParent});return x.pages.length===burst.opened+1&&x.workspace.notice?x:null;});await call({command:'s2-close-page',pageId:burstParent});result.ordinaryAfterParentClose=await call({command:'s2-popup-state'});result.finalClose=await call({command:'s2-close-all-pages'});

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
