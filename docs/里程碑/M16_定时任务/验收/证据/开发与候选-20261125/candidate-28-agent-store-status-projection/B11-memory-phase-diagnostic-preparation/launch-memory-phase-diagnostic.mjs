// Coordinator-owned memory diagnostic entry. Dry preflight never starts App/CLI or listeners.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,realpath} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {WATCHDOG_SECONDS} from './memory-phase-helpers.mjs';
const BASE=dirname(fileURLToPath(import.meta.url));
const bundle='/Users/liubu/hx/4.uprxiao/SmartDD/release/m16-qa-support/c28/build/mac-arm64/WillYou.app';
const pin='5d715b34f16a31a1edf95692501b58e19e70048bc0f131f4bb33ac1bbcb3ba9e';
const nativePin='5958e696d973ee8e304333442dc4c55d58402f22a8714af164c6b182fb3d3080';
const cli='/Users/liubu/hx/4.uprxiao/SmartDD/release/m16-qa-support/b11-recovery/verified-codex-0.169.0/package/vendor/aarch64-apple-darwin/bin/codex';
const cliPin='739cda86e15d30a6e2b40cf8dcbbfb988aaf48b305b27065573bb8e9fd41d002';
const python='/Library/Frameworks/Python.framework/Versions/3.11/bin/python3';
const node=await realpath(process.execPath),driver=join(BASE,'run-memory-phase-diagnostic.mjs');
const hash=async f=>createHash('sha256').update(await readFile(f)).digest('hex');
// The same real launcher prerequisites are checked for dry preflight and
// for actual execution. No CLI route, auth context, or PATH is installed here.
assert.equal(await realpath(bundle),bundle);
assert.equal(await realpath(cli),cli);
assert.deepEqual(await Promise.all([hash(join(bundle,'Contents/Resources/app.asar')),hash(join(bundle,'Contents/Resources/native/willyou-process-identity')),hash(cli)]),[pin,nativePin,cliPin]);
const recovered=JSON.parse(await readFile(join(BASE,'codex-0.169.0-cache-recovery.json'),'utf8'));
assert.equal(recovered.binary,cli);assert.equal(recovered.binarySha256,cliPin);assert.equal(recovered.historicalC27NativeSha256,cliPin);
const priorR6=JSON.parse(await readFile(join(BASE,'run-ITKAGr/result.json'),'utf8'));
assert.equal(priorR6.actualVerifiedSupportedTool.version,'0.169.0');
assert.equal(priorR6.actualVerifiedSupportedTool.sha,cliPin);
assert.equal(priorR6.pin,pin);assert.equal(priorR6.nativePin,nativePin);
assert.equal(priorR6.status,'diagnostic-complete-no-formal-evidence');
const preservedR6Version='codex-cli 0.169.0'; // prior actual R6 verified, not a fresh CLI call
const adapterPath=join(bundle,'Contents/Resources/capability-bundles/adapters/codex/1.6.0/28a60b2604ed0da0925e083fdc644c19ff8c221bb11c68e5876b59dfe8ca5b06');
const bundled=JSON.parse(await readFile(join(adapterPath,'bundle.json'),'utf8')),metadata=bundled.metadata;
assert.equal(metadata.agentId,'codex');assert.equal(metadata.version,'1.6.0');
assert(metadata.platforms.includes('darwin-arm64')&&metadata.cliVersions.includes('0.169.0'));
assert.equal(metadata.cliEntry,'supported');assert(metadata.levels['0.169.0'].includes('L0.cli'));
for(const file of bundled.files){assert.equal(await hash(join(adapterPath,file.path)),file.sha256,'frozen shipped adapter file pin');}
const cliAsset=join(bundle,'Contents/Resources/native/willyou-app');
const launchPreflight={bundle,pin,nativePin,cli,cliPin,preservedR6Version,adapterVersion:metadata.version,adapterBundleSha256:await hash(join(adapterPath,'bundle.json')),declaredLevels:metadata.levels['0.169.0'],cliAsset,cliAssetSha256:await hash(cliAsset),staticAdapterProof:true,scope:'normal shipped adapter still decides actual sandbox/CLI authorization during the assigned isolated run'};
if(process.argv.length===3&&process.argv[2]==='--preflight-only'){
 console.log(JSON.stringify({...launchPreflight,launched:false,cliExecuted:false,boundary:'static hash + preserved actual R6 version only; fresh actual native version checked only in coordinator-authorized execution'}));
 process.exit(0);
}
assert.deepEqual(process.argv.slice(2),['--memory-phase-approved']);
const freeze=JSON.parse(await readFile(join(BASE,'memory-phase-preflight.json'),'utf8'));
assert(freeze.staticOnly===true&&freeze.actualAppLaunched===false&&freeze.actualCliExecuted===false);
const expectedFiles=['run-memory-phase-diagnostic.mjs','memory-phase-helpers.mjs','own_scope_native_memory_diagnostic.py','native-passive-poll.mjs','same-click-point.mjs','scope_mismatch_diagnostics.py','closure_contract.py','coalition_accounting.py','cpu_collector.py','lease_probe.py','electron-harness.mjs','electron-isolation-paths.mjs','wrapper-memory-phase-diagnostic.m','launch-memory-phase-diagnostic.mjs','cleanup-scope-diagnostic.py','own_scope_native.py','memory-phase-preflight.py','memory-phase-replay.mjs'];
assert.deepEqual(Object.keys(freeze.sourcePins).sort(),[...expectedFiles].sort());
for(const f of expectedFiles)assert.equal(await hash(join(BASE,f)),freeze.sourcePins[f],'frozen diagnostic source '+f);
assert.deepEqual(freeze.launchPins,launchPreflight);

const root=await mkdtemp(join(BASE,'cohort-')),payload=join(root,'payload'),home=join(root,'home'),tmp=join(root,'tmp');
const wrapper=join(root,'WillYou B11 Memory Phase Diagnostic Runner.app'),exe=join(wrapper,'Contents/MacOS/WillYouB11AcceptanceRunner');
for(const p of [payload,home,tmp,dirname(exe)])await mkdir(p,{recursive:true,mode:0o700});
const write=async(f,v)=>writeFile(f,JSON.stringify(v,null,2)+'\n',{mode:0o600});
// Fresh independently isolated version probe only after explicit coordinator authorization.
const nativeVersion=execFileSync(cli,['--version'],{env:{HOME:home,CODEX_HOME:home,PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8'},encoding:'utf8',timeout:10000}).trim();
assert.equal(nativeVersion,preservedR6Version);

const read=async f=>readFile(f,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT'||e instanceof SyntaxError)return null;throw e;});
const wait=async(fn,ms,label)=>{const until=Date.now()+ms;do{const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,100));}while(Date.now()<until);throw Error('bounded wait '+label);};
const cleanEnv={PATH:dirname(node)+':/usr/bin:/bin:/usr/sbin:/sbin',HOME:home,TMPDIR:tmp,LANG:'en_US.UTF-8',PYTHONDONTWRITEBYTECODE:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:'/dev/null',GIT_TERMINAL_PROMPT:'0'};
execFileSync('/usr/bin/clang',['-framework','AppKit','-framework','Foundation','-O2',join(BASE,'wrapper-memory-phase-diagnostic.m'),'-o',exe]);
const plist=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>WillYouB11AcceptanceRunner</string><key>CFBundleIdentifier</key><string>com.smartdd.test.b11.${randomUUID()}</string><key>CFBundleName</key><string>WillYou B11 Acceptance Runner</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/><key>CFBundleVersion</key><string>1</string></dict></plist>`;
await writeFile(join(wrapper,'Contents/Info.plist'),plist);
execFileSync('/usr/bin/codesign',['--force','--sign','-',wrapper],{stdio:'ignore'});
execFileSync('/usr/bin/codesign',['--verify','--strict',wrapper]);
const cfg={root,payload,bundle,pin,cli,cliPin,nativePin,node,driver,diagnosticOnly:true,diagnosticKind:'memory-phase-v1',nonce:randomUUID(),driverEnvironment:{...cleanEnv,WILLYOU_B11_COHORT_ROOT:root}};
const configPath=join(root,'wrapper-config.private.json');
await write(configPath,cfg);
const files=expectedFiles;
await write(join(root,'prepared.json'),{root,wrapper,exe,pin,nativePin,cliPin,launchPreflight:{...launchPreflight,nativeVersion},driverSha:await hash(driver),wrapperSha:await hash(exe),sourcePins:Object.fromEntries(await Promise.all(files.map(async f=>[f,await hash(join(BASE,f))])))});
console.log(JSON.stringify({kind:'prepared',root}));
let started,runRoot,offset=0,cleanupCompleted=false;
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
   const ready=await read(join(runRoot,'memory-phase-preflight-ready.json'));
   if(ready){
    const report=await read(join(runRoot,'result.json'));
    if(report?.resource?.preflight?.probe?.currentNetLiveContractVerified===true&&report.resource.preflight.probe.held.closed&&report.resource.preflight.probe.afterProbe.closed&&ready.pin===pin&&ready.root===runRoot&&ready.resourceId===probe.resourceId){
     await write(join(runRoot,'continue-memory-phase.private.json'),{root:runRoot,pin,nonce:ready.nonce,action:'continue-memory-phase-two-rounds',scopeReview:'actual exact UID/CID graph and detached-child increment/reap proof; two ordinary rounds and timed natural 300s idle diagnostic only, no B11 acceptance'});
     console.log(JSON.stringify({kind:'memory-phase-only-preflight-accepted',runRoot}));approved=true;
    }
   }
  }
  return await read(join(root,'driver-exit.json'));
 },WATCHDOG_SECONDS*1000,'bounded memory-phase diagnostic and normal exit');
 await write(join(root,'controller-result.json'),{started,result,runRoot,pin,cohort:probe});
 console.log(JSON.stringify({kind:'driver-exit',runRoot,result}));
 if(runRoot){
  const cleanup=JSON.parse(execFileSync(python,[join(BASE,'cleanup-scope-diagnostic.py'),runRoot,root],{env:cleanEnv,encoding:'utf8'}));
  console.log(JSON.stringify({kind:'cleanup',...cleanup}));cleanupCompleted=true;
 }
 assert.equal(result.terminationReason,1);assert.equal(result.terminationStatus,0);assert.equal(result.stopSent,false);
}catch(error){
 if(started&&!await read(join(root,'driver-exit.json')))await write(join(root,'stop-wrapper.private.json'),{nonce:cfg.nonce,reason:'owned controller failure'});
 const recovery={};if(started){try{recovery.driverExit=await wait(()=>read(join(root,'driver-exit.json')),120000,'owned wrapper termination after controller failure');}catch(e){recovery.driverExitError=String(e.message);}}
 if(runRoot&&!cleanupCompleted&&recovery.driverExit){try{recovery.cleanup=JSON.parse(execFileSync(python,[join(BASE,'cleanup-scope-diagnostic.py'),runRoot,root],{env:cleanEnv,encoding:'utf8',timeout:45000}));}catch(e){recovery.cleanupError=String(e.message);}}
 await write(join(root,'controller-error.json'),{reason:String(error.stack??error),runRoot,started,recovery});
 throw error;
}
