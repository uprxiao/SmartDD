// Coordinator-owned entry. Uses the preserved C12 dedicated application cohort.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,realpath} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const BASE=dirname(fileURLToPath(import.meta.url));
const bundle='/Users/liubu/hx/4.uprxiao/SmartDD/release/m16-qa-support/c28/build/mac-arm64/WillYou.app';
const pin='5d715b34f16a31a1edf95692501b58e19e70048bc0f131f4bb33ac1bbcb3ba9e';
const nativePin='5958e696d973ee8e304333442dc4c55d58402f22a8714af164c6b182fb3d3080';
const cli='/Users/liubu/.local/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex';
const cliPin='fc8d77cf7585aded2b9bc487dad29c4ee2f066123e4e76dd3b17653a8322ce42';
const python='/Library/Frameworks/Python.framework/Versions/3.11/bin/python3';
const node=await realpath(process.execPath),driver=join(BASE,'run.mjs');
const hash=async f=>createHash('sha256').update(await readFile(f)).digest('hex');
assert.deepEqual(await Promise.all([hash(join(bundle,'Contents/Resources/app.asar')),hash(join(bundle,'Contents/Resources/native/willyou-process-identity')),hash(cli)]),[pin,nativePin,cliPin]);
assert(process.argv.includes('--run-approved'));
const root=await mkdtemp(join(BASE,'cohort-')),payload=join(root,'payload'),home=join(root,'home'),tmp=join(root,'tmp');
const wrapper=join(root,'WillYou B11 Acceptance Runner.app'),exe=join(wrapper,'Contents/MacOS/WillYouB11AcceptanceRunner');
for(const p of [payload,home,tmp,dirname(exe)])await mkdir(p,{recursive:true,mode:0o700});
const write=async(f,v)=>writeFile(f,JSON.stringify(v,null,2)+'\n',{mode:0o600});
const read=async f=>readFile(f,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT'||e instanceof SyntaxError)return null;throw e;});
const wait=async(fn,ms,label)=>{const until=Date.now()+ms;do{const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,100));}while(Date.now()<until);throw Error('bounded wait '+label);};
const cleanEnv={PATH:dirname(node)+':/usr/bin:/bin:/usr/sbin:/sbin',HOME:home,TMPDIR:tmp,LANG:'en_US.UTF-8',PYTHONDONTWRITEBYTECODE:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:'/dev/null',GIT_TERMINAL_PROMPT:'0'};
execFileSync('/usr/bin/clang',['-framework','AppKit','-framework','Foundation','-O2',join(BASE,'wrapper-business-codex.m'),'-o',exe]);
const plist=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>WillYouB11AcceptanceRunner</string><key>CFBundleIdentifier</key><string>com.smartdd.test.b11.${randomUUID()}</string><key>CFBundleName</key><string>WillYou B11 Acceptance Runner</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/><key>CFBundleVersion</key><string>1</string></dict></plist>`;
await writeFile(join(wrapper,'Contents/Info.plist'),plist);
execFileSync('/usr/bin/codesign',['--force','--sign','-',wrapper],{stdio:'ignore'});
execFileSync('/usr/bin/codesign',['--verify','--strict',wrapper]);
const cfg={root,payload,bundle,pin,cli,cliPin,nativePin,node,driver,nonce:randomUUID(),driverEnvironment:{...cleanEnv,WILLYOU_B11_COHORT_ROOT:root}};
const configPath=join(root,'wrapper-config.private.json');
await write(configPath,cfg);
const files=['run.mjs','native-passive-poll.mjs','same-click-point.mjs','own_scope_native.py','closure_contract.py','coalition_accounting.py','cpu_collector.py','lease_probe.py','electron-harness.mjs','electron-isolation-paths.mjs','wrapper-business-codex.m','launch.mjs','cleanup.py'];
await write(join(root,'prepared.json'),{root,wrapper,exe,pin,nativePin,cliPin,driverSha:await hash(driver),wrapperSha:await hash(exe),sourcePins:Object.fromEntries(await Promise.all(files.map(async f=>[f,await hash(join(BASE,f))])))});
console.log(JSON.stringify({kind:'prepared',root}));
let started,runRoot,offset=0;
try{
 execFileSync('/usr/bin/open',['-n','-a',wrapper,'--args',configPath],{stdio:'ignore'});
 started=await wait(()=>read(join(root,'driver-started.json')),15000,'own runner started');
 assert(started.uid===process.getuid()&&Number.isSafeInteger(started.wrapperPid)&&Number.isSafeInteger(started.driverPid));
 const probe=JSON.parse(execFileSync(python,[join(BASE,'lease_probe.py'),String(started.wrapperPid),String(started.driverPid),String(process.pid),exe,node],{env:cleanEnv,encoding:'utf8'}));
 const lease={...probe,...started,pin,driverSha:await hash(driver)};
 await write(join(root,'expected-cohort.json'),lease);
 console.log(JSON.stringify({kind:'cohort-bound',root,resourceId:probe.resourceId,started}));
 let approved=false;
 const result=await wait(async()=>{
  const current=await readFile(join(root,'driver.stdout.log'),'utf8').catch(()=>''),newText=current.slice(offset);
  if(newText){process.stdout.write(newText);offset=current.length;const path=current.match(/^F36 evidence: (.+)$/m)?.[1];if(path){assert(path.startsWith(BASE+'/run-'));runRoot=path;}}
  if(runRoot&&!approved){
   const ready=await read(join(runRoot,'scope-preflight-ready.json'));
   if(ready){
    const report=await read(join(runRoot,'result.json'));
    if(report?.resource?.preflight?.probe?.currentNetLiveContractVerified===true&&report.resource.preflight.probe.held.closed&&report.resource.preflight.probe.afterProbe.closed&&ready.pin===pin&&ready.root===runRoot&&ready.resourceId===probe.resourceId){
     await write(join(runRoot,'continue-long.private.json'),{root:runRoot,pin,nonce:ready.nonce,action:'continue-1800s',scopeReview:'actual exact UID/CID graph and live detached-child increment/reap proof passed'});
     console.log(JSON.stringify({kind:'scope-preflight-accepted',runRoot}));approved=true;
    }
   }
  }
  return await read(join(root,'driver-exit.json'));
 },2400000,'actual run and normal exit');
 await write(join(root,'controller-result.json'),{started,result,runRoot,pin,cohort:probe});
 console.log(JSON.stringify({kind:'driver-exit',runRoot,result}));
 if(runRoot){
  const cleanup=JSON.parse(execFileSync(python,[join(BASE,'cleanup.py'),runRoot,root],{env:cleanEnv,encoding:'utf8'}));
  console.log(JSON.stringify({kind:'cleanup',...cleanup}));
 }
 assert.equal(result.terminationReason,1);assert.equal(result.terminationStatus,0);assert.equal(result.stopSent,false);
}catch(error){
 if(started&&!await read(join(root,'driver-exit.json')))await write(join(root,'stop-wrapper.private.json'),{nonce:cfg.nonce,reason:'owned controller failure'});
 await write(join(root,'controller-error.json'),{reason:String(error.stack??error),runRoot,started});
 throw error;
}
