import { build } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire, builtinModules } from 'node:module';
import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
const [output] = process.argv.slice(2);
if (!output?.startsWith('/private/tmp/willyou-m12-s1-')) throw Error('Explicit private S1 output required');
await mkdir(output,{recursive:true});
const require=createRequire(resolve('package.json'));
await build({configFile:false,publicDir:false,cacheDir:join(output,'vite-cache'),logLevel:'error',ssr:{noExternal:true},resolve:{alias:{'@shared':resolve('src/shared')}},build:{ssr:resolve('scripts/browser/s1-proxy-host.ts'),target:'node22',outDir:join(output,'build'),emptyOutDir:false,rollupOptions:{external:['electron','ws'],output:{format:'cjs',entryFileNames:'host.cjs',inlineDynamicImports:true}}}});
await cp(dirname(require.resolve('ws/package.json')),join(output,'build/node_modules/ws'),{recursive:true});
const compiled = await readFile(join(output,'build/host.cjs'),'utf8');
const builtin = new Set([...builtinModules,...builtinModules.map(m=>'node:'+m),'electron','ws']);
for(const [,specifier] of compiled.matchAll(/^const [^\n]+?= require\("([^"]+)"\)/gm))
  if(!builtin.has(specifier)) throw Error('Unbundled required fixture dependency: '+specifier);
const fixtureRequire=createRequire(join(output,'build/host.cjs'));
if(!fixtureRequire.resolve('ws').startsWith(join(output,'build/node_modules/ws/')))throw Error('ws not frozen in fixture');
const env={PATH:process.env.PATH,HOME:join(output,'home'),TMPDIR:output,M12_HELPER_ROOT:resolve('out/agent-browser')};
const result={at:new Date().toISOString(),steps:[],stages:[]};
const host=spawn(require('electron'),[join(output,'build/host.cjs'),'--user-data-dir='+join(output,'userData')],{env,stdio:['ignore','pipe','pipe','ipc']});
result.hostPid=host.pid;
host.on('message',message=>{if(message.stage){result.stages.push(message);void writeFile(join(output,'live.json'),JSON.stringify(result,null,2));}});
let logs='',seq=0; host.stdout.on('data',b=>logs+=b);host.stderr.on('data',b=>logs+=b);
const exited=new Promise(r=>host.once('exit',(code,signal)=>r({code,signal})));
const call=command=>new Promise((ok,no)=>{const id=++seq,t=setTimeout(()=>{host.off('message',on);no(Error('fixture command timeout'))},25000);const on=m=>{if(m.id!==id)return;clearTimeout(t);host.off('message',on);m.error?no(Error(m.error)):ok(m.value)};host.on('message',on);host.send({...command,id})});
try {
  result.ready=await new Promise((ok,no)=>{const t=setTimeout(()=>no(Error('fixture ready timeout')),20000);host.on('message',m=>{if(m.ready||m.fatal){clearTimeout(t);m.fatal?no(Error(m.fatal)):ok(m)}});host.once('exit',()=>{clearTimeout(t);no(Error('fixture early exit'))})});
  const direct = new WebSocket(result.ready.endpoint);
  await new Promise((ok,no)=>{direct.addEventListener('open',ok,{once:true});direct.addEventListener('error',no,{once:true})});
  result.direct = await new Promise((ok,no)=>{const timer=setTimeout(()=>no(Error('direct CDP timeout')),3000);direct.addEventListener('message',({data})=>{clearTimeout(timer);ok(JSON.parse(data))},{once:true});direct.send(JSON.stringify({id:1,method:'Browser.getVersion'}))});direct.close();
  for(const args of [['tab','list'],['snapshot'],['click','#action'],['fill','#field','S1-through-per-page-proxy']]) {
    const at=performance.now(),value=await call({command:'helper',args});result.steps.push({args,value,ms:Math.round(performance.now()-at)});
  }
  result.observed=await call({command:'observe'});
}catch(error){result.failure=String(error.stack??error)}finally{
  if(result.ready)try{result.cleanup=await call({command:'close'})}catch(error){result.cleanupError=String(error);host.kill('SIGTERM')}
  else host.kill('SIGTERM');
  const hardStop=setTimeout(()=>host.kill('SIGKILL'),5000);
  result.hostExit=await exited;clearTimeout(hardStop);await writeFile(join(output,'host.log'),logs);await writeFile(join(output,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({failure:result.failure,steps:result.steps.map(s=>({args:s.args,ms:s.ms})),observed:result.observed,hostExit:result.hostExit}));
}
