import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, cp, readFile, writeFile, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { once } from 'node:events';
import { join } from 'node:path';
const sha = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = await mkdtemp('/private/tmp/willyou-m16-old-positive-');
const old = '/Applications/WillYou.app', clone = '/private/tmp/willyou-m16-old-state-yUD0pJ/WillYou.app', data=join(root,'data'), home=join(root,'home');
const expected='697bb2d273a743c22a2d2c2ebc3c509b0fcee3f9c4bbeeb34146c590b2d9afe2';
assert.equal(await sha(join(old,'Contents/Resources/app.asar')),expected);
// Reuse the exact immutable isolated old bundle after its prior owned process was collected.
assert.equal(await realpath(clone),clone);
assert.equal(await sha(join(clone,'Contents/Resources/app.asar')),expected);
const exe=join(clone,'Contents/MacOS/WillYou');assert.equal(await realpath(exe),exe);
assert.equal(await sha(exe),await sha(join(old,'Contents/MacOS/WillYou')));
// A new root imports only known synthetic business/profile data, never a host
// coordination lease/inode, runtime pid marker or active Chromium cache state.
// The unmodified old App initializes its own fresh gate on first launch.
const sealed='/private/tmp/willyou-m16-f36-migration-q727bg0j/sealed-old-source-copy';
const sourceGate=join(sealed,'.database-access.sqlite'), originalGateHash=await sha(sourceGate);
const allowed=['smartdd.db','Partitions','browser','agents','agent-diffs','app-data','backups','capabilities','file-recovery','imported-keys','plugin-data','plugins','m9-office-jobs','m9-tex-jobs'];
await mkdir(data,{mode:0o700});
for(const name of allowed)await cp(join(sealed,name),join(data,name),{recursive:true,errorOnExist:true,force:false,dereference:false});
assert.equal(await sha(sourceGate),originalGateHash);
await writeFile(join(root,'fresh-import.json'),JSON.stringify({sealed,data,allowed,originalGateHash,coordination:'the brand-new test root has never contained a coordination gate; old app creates its own'},null,2));
assert.equal(await sha(join(data,'smartdd.db')),'de2d935697e62ab8feb9abe2fbbc666013600447f2bcc5acd49777a3f48b2a2b');
await mkdir(join(home,'.config'),{recursive:true,mode:0o700});
const srv=createServer((req,res)=>{if(req.url==='/a42-browser')res.end('<title>A42 local-only startup fixture</title>'); else res.writeHead(404).end('local fixture only');});
srv.on('connect',(_r,socket)=>socket.destroy());srv.listen({host:'127.0.0.1',port:3425,exclusive:true});await once(srv,'listening');
const probe=netServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin='http://127.0.0.1:3425',env={...process.env,SMARTDD_USER_DATA:data,HOME:home,SMARTDD_CLI_HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),XDG_CONFIG_HOME:join(home,'.config'),HTTP_PROXY:origin,HTTPS_PROXY:origin,ALL_PROXY:origin,NO_PROXY:'localhost,127.0.0.1'};
for(const key of Object.keys(env))if(/^(ELECTRON_RUN_AS_NODE|ELECTRON_RENDERER_URL|ANTHROPIC_|OPENAI_|CLAUDECODE|CLAUDE_CODE_|GEMINI_API_KEY|DEEPSEEK_API_KEY|RJMODEL_API_KEY|OPENCODE_API_KEY|SSH_AUTH_SOCK)/.test(key))delete env[key];
const child=spawn(exe,['--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,'--inspect=127.0.0.1:0'],{cwd:'/Users/liubu/hx/4.uprxiao/SmartDD',env,stdio:['ignore','pipe','pipe']});
let logs='',exit=null,ws=null,counter=0,pending=new Map(),inspectorUrl=null,valid=false;
const report={scope:'Dedicated old immutable App clone + brand-new synthetic fixture root with allowlisted business/profile data import; original gate retained; actual old app initializes its own gate. Actual DevTools target list and read-only owned main-process native readiness; no login/keychain or daily data changes.',root,clone,exe,oldAsar:expected,data,home,pid:child.pid,port,states:[],targets:[],errors:[],cleanup:[]};
child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);child.on('exit',(code,signal)=>exit={code,signal});
await writeFile(join(root,'handoff.json'),JSON.stringify({root,clone,exe,pid:child.pid,data,home,port,deadlineMs:Date.now()+90000},null,2),{mode:0o600});console.log(JSON.stringify({root,clone,pid:child.pid,port}));
async function connectInspector(){const m=logs.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+)/);if(!m)return false;inspectorUrl=m[1];ws=new WebSocket(inspectorUrl);await new Promise((ok,no)=>{const t=setTimeout(()=>no(Error('own inspector open timeout')),3000);ws.addEventListener('open',()=>{clearTimeout(t);ok()},{once:true});ws.addEventListener('error',()=>{clearTimeout(t);no(Error('inspector open error'))},{once:true});});ws.addEventListener('message',evt=>{const msg=JSON.parse(evt.data),p=pending.get(msg.id);if(p){pending.delete(msg.id);clearTimeout(p.timer);if(msg.error)p.no(Error(msg.error.message));else p.ok(msg.result);}});return true;}
async function call(method,params={}){const id=++counter;return new Promise((ok,no)=>{const timer=setTimeout(()=>{pending.delete(id);no(Error('own inspector request timeout'))},5000);pending.set(id,{ok,no,timer});ws.send(JSON.stringify({id,method,params}));});}
const identityExpr=`(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');return {pid:process.pid,exe:process.execPath,data:E.app.getPath('userData'),ready:E.app.isReady(),windows:E.BrowserWindow.getAllWindows().map(w=>({id:w.id,visible:w.isVisible(),title:w.getTitle(),url:w.webContents.getURL()})),contents:E.webContents.getAllWebContents().map(w=>({id:w.id,url:w.getURL(),type:w.getType()}))}})()`;
try{
 for(let i=0;i<12&&!exit;i++){
  await wait(i===0?1000:2000);
  try{const response=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(1600)});const list=await response.json();report.targets.push({at:Date.now(),status:response.status,items:Array.isArray(list)?list.map(x=>({type:x.type,url:x.url,title:x.title})):[]});}catch(e){report.targets.push({at:Date.now(),error:e.name});}
  if(!ws){try{await connectInspector()}catch(e){report.errors.push({stage:'inspector open',error:e.message});}}
  if(ws?.readyState===1){try{const ret=await call('Runtime.evaluate',{expression:identityExpr,returnByValue:true});if(ret.exceptionDetails)throw Error(ret.exceptionDetails.text);const s=ret.result.value;assert.equal(s.pid,child.pid);assert.equal(s.exe,exe);assert.equal(s.data,data);valid=true;report.states.push({at:Date.now(),...s});if(s.contents.some(w=>/^file:/.test(w.url)&&/\/out\/renderer\/index\.html(?:[?#]|$)/.test(w.url))){report.status='trusted-renderer-ready';break;}}catch(e){report.errors.push({at:Date.now(),stage:'own main readiness',error:e.message});}}
  await writeFile(join(root,'progress.json'),JSON.stringify({states:report.states,targets:report.targets,errors:report.errors},null,2),{mode:0o600});
 }
 if(!report.status)report.status=exit?'own-process-terminal-before-trusted-renderer':'trusted-renderer-not-ready';
 if(!exit&&report.status!=='trusted-renderer-ready'){
  await writeFile(join(root,'native-observation-ready.json'),JSON.stringify({pid:child.pid,clone,exe,data,root,validMainIdentity:valid,status:report.status,deadlineMs:Date.now()+40000},null,2),{mode:0o600});
  // Allow only an external read-only native observation of this exact candidate.
  for(let i=0;i<20&&!exit;i++){try{report.nativeObservation=JSON.parse(await readFile(join(root,'native-observation.json'),'utf8'));break;}catch{}await wait(2000);}
 }
 if(!exit&&valid&&ws?.readyState===1){try{await call('Runtime.evaluate',{expression:"(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');setTimeout(()=>E.app.quit(),50);return true})()",returnByValue:true});report.cleanup.push('owned main normal quit requested');}catch(e){report.cleanup.push('normal quit request timed out');}}
 for(let i=0;i<50&&!exit;i++)await wait(100);
}finally{
 if(!exit){child.kill('SIGTERM');report.cleanup.push('owned isolated ChildProcess SIGTERM after bounded normal-quit wait');for(let i=0;i<30&&!exit;i++)await wait(100);}
 if(!exit){child.kill('SIGKILL');report.cleanup.push('owned isolated ChildProcess forced cleanup after bounded wait');for(let i=0;i<30&&!exit;i++)await wait(100);}
 ws?.close();srv.closeAllConnections();await new Promise(r=>srv.close(r));
 report.exit=exit;report.logs=logs;report.sameOldAsarAfter=await sha(join(clone,'Contents/Resources/app.asar'))===expected; report.sourceGateUnchanged=await sha(sourceGate)===originalGateHash;report.finishedAt=new Date().toISOString();
 await writeFile(join(root,'result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({root,status:report.status,exit,valid,states:report.states.length,targets:report.targets.length}));
}
