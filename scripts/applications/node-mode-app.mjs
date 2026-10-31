// T56 disabled-RunAsNode private-copy control. Never mutates the pinned source
// App or uses a system Node/Python as the business bridge runtime.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,readFile,writeFile,access,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {openElectron} from '../lib/electron-harness.mjs';
const require=createRequire(import.meta.url);
const {getCurrentFuseWire,flipFuses,FuseVersion,FuseV1Options}=require('../../node_modules/.pnpm/@electron+fuses@1.8.0/node_modules/@electron/fuses/dist/index.js');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const source=process.env.WILLYOU_ACCEPTANCE_APP_ROOT,pin=process.env.WILLYOU_ACCEPTANCE_ASAR_SHA;
assert(source?.startsWith('/private/tmp/willyou-m10-')&&source.endsWith('.app')&&/^[a-f0-9]{64}$/.test(pin),'Pin a private source App');
const root=await mkdtemp('/private/tmp/willyou-m10-node-mode-'),home=join(root,'home'),bin=join(root,'no-system-runtime'),copy=join(root,'WillYou-node-mode-off.app');
for(const path of [home,bin])await mkdir(path,{recursive:true});
const originalExe=join(source,'Contents/MacOS/WillYou'),negativeExe=join(copy,'Contents/MacOS/WillYou'),resources=join(source,'Contents/Resources');
const index=JSON.parse(await readFile(join(resources,'capability-bundles/index.json'),'utf8')),runtime=index.runtimes[0];
const sourceBridge=join(resources,'capability-bundles',runtime.path,runtime.bridgeEntry),negativeBridge=join(copy,'Contents/Resources/capability-bundles',runtime.path,runtime.bridgeEntry),missing=join(root,'never-issued-bootstrap.json');
const result={schema:'m10-disabled-node-mode-v1',startedAt:new Date().toISOString(),root,source,copy,sourceAsar:pin,branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),checks:[],pids:[],status:'running',layer:'Private packaged fuse negative and normal host startup; no UI/business/actual Agent claim'};
// Keep the standard harness's credential filtering and also avoid inheriting
// unrelated provider credentials into this private negative App.
for(const key of Object.keys(process.env))if(!['PATH','TMPDIR','LANG','LC_ALL'].includes(key))delete process.env[key];
let app;
const check=name=>result.checks.push({name,at:new Date().toISOString(),passed:true});
const exists=async path=>{try{await access(path);return true;}catch(error){assert.equal(error.code,'ENOENT');return false;}};
const environment=data=>({PATH:bin,HOME:home,ZDOTDIR:home,SMARTDD_USER_DATA:data,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost',ELECTRON_RUN_AS_NODE:'1'});
async function refused(executable,bridge,data,expected){
 let failure;try{execFileSync(executable,[bridge,'--bootstrap',missing],{env:environment(data),encoding:'utf8',timeout:5000,maxBuffer:8192,stdio:['ignore','pipe','pipe']});}catch(error){failure=error;}
 assert(failure,'Expected bounded refusal');if(Number.isSafeInteger(failure.pid))result.pids.push(failure.pid);
 const outcome={pid:failure.pid,status:failure.status,signal:failure.signal,stdout:String(failure.stdout),stderr:String(failure.stderr),userDataExists:await exists(data)};
 assert.equal(outcome.status,1);assert.equal(outcome.signal,null);assert.equal(outcome.stdout,'');assert.equal(outcome.stderr,expected);assert.equal(outcome.userDataExists,false);return outcome;
}
async function close(){if(app){await writeFile(join(root,'app.log'),app.logs());await app.close();result.closed=await app.waitForExit(5000);app=undefined;}}
try{
 assert.equal(sha(await readFile(join(resources,'app.asar'))),pin);
 const framework=await realpath(join(source,'Contents/Frameworks/Electron Framework.framework/Electron Framework'));
 result.originalFrameworkSha256=sha(await readFile(framework));result.originalWire=await getCurrentFuseWire(source);assert.equal(result.originalWire[FuseV1Options.RunAsNode],49);
 execFileSync('/bin/cp',['-cR',source,copy],{stdio:'pipe',timeout:30000});
 result.sentinels=await flipFuses(copy,{version:FuseVersion.V1,[FuseV1Options.RunAsNode]:false,resetAdHocDarwinSignature:true});
 result.negativeWire=await getCurrentFuseWire(copy);assert.equal(result.negativeWire[0],48);
 for(const key of Object.keys(result.originalWire))if(key!=='0')assert.equal(result.negativeWire[key],result.originalWire[key]);
 assert.equal(sha(await readFile(join(copy,'Contents/Resources/app.asar'))),pin);assert((await readFile(sourceBridge)).equals(await readFile(negativeBridge)));
 result.negativeFrameworkSha256=sha(await readFile(await realpath(join(copy,'Contents/Frameworks/Electron Framework.framework/Electron Framework'))));assert.notEqual(result.negativeFrameworkSha256,result.originalFrameworkSha256);
 execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',copy],{stdio:'pipe',timeout:30000});check('Private APFS copy changes only requested fuse state; ASAR/runtime remain exact and ad-hoc signature verifies');
 result.positive=await refused(originalExe,sourceBridge,join(root,'positive-node-userdata'),'WillYou application bridge unavailable\n');check('Enabled source executes CJS and refuses missing ticket without opening GUI/data or using system runtime');
 const data=join(root,'negative-userdata');let startup;
 try{app=await openElectron({executable:negativeExe,userData:data,env:environment(data),inspectMain:true,nodeModeNegative:true,nodeModeArguments:[negativeBridge,'--bootstrap',missing]});}
 catch(error){startup={error:String(error),process:error.electronStartupProcess,logs:error.electronStartupLogs??''};if(startup.process?.pid)result.pids.push(startup.process.pid);}
 if(app){
  result.pids.push(app.processId);await app.evaluate("document.title='A · M10 T56 · Node mode OFF · private data';true");
  result.unexpectedNormalApp=await app.mainEvaluate("({type:process.type,nodeModeIntent:process.env.ELECTRON_RUN_AS_NODE,explicitUserData:process.env.SMARTDD_USER_DATA,argv:process.argv})");
  result.unexpectedNormalApp.catalog=await app.invoke('applications.catalog');result.unexpectedNormalApp.databaseExists=await exists(join(data,'smartdd.db'));
  await app.screenshot(join(root,'unexpected-normal-app.png'));await close();result.failureKind='product';throw Error('NODE_MODE_FELL_BACK_TO_APP: disabled embedded runtime opened normal WillYou instead of refusing before data/UI');
 }
 result.negativeStartup=startup;assert.equal(startup?.process?.code,1);assert.match(startup.logs,/WillYou application bridge unavailable: HOST_INCOMPATIBLE/);assert.equal(await exists(data),false);check('Disabled fuse rejects explicit Node-mode intent before normal App/data initialization');
 result.directNegative=await refused(negativeExe,negativeBridge,join(root,'direct-negative-userdata'),'WillYou application bridge unavailable: HOST_INCOMPATIBLE\n');check('Exact bridge argv without CDP flags fails clearly with empty stdout/PATH and no runtime fallback');
 const normalData=join(root,'normal-userdata');app=await openElectron({executable:negativeExe,userData:normalData,env:{HOME:home,ZDOTDIR:home,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost'},inspectMain:true});result.pids.push(app.processId);
 await app.evaluate("document.title='A · M10 T56 · Normal host · private data';true");
 result.normal=await app.mainEvaluate("({type:process.type,nodeModeIntent:process.env.ELECTRON_RUN_AS_NODE??null,explicitUserData:process.env.SMARTDD_USER_DATA})");assert.equal(result.normal.type,'browser');assert.equal(result.normal.nodeModeIntent,null);assert.equal(result.normal.explicitUserData,normalData);
 const catalog=await app.invoke('applications.catalog');assert(catalog.ok&&catalog.value.length===2);result.normal.catalog=catalog;await app.screenshot(join(root,'normal-host.png'));await close();check('Same disabled-fuse copy still opens normal host when Node intent is absent');
 result.status='passed-packaged-negative-partial';
}catch(error){result.status='failed';result.error=String(error);result.stack=error.stack;process.exitCode=1;}
finally{
 await close();result.originalWireAfter=await getCurrentFuseWire(source);assert.deepEqual(result.originalWireAfter,result.originalWire);assert.equal(sha(await readFile(join(resources,'app.asar'))),pin);assert.equal(sha(await readFile(await realpath(join(source,'Contents/Frameworks/Electron Framework.framework/Electron Framework')))),result.originalFrameworkSha256);
 result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');await writeFile('/private/tmp/willyou-m10-node-mode-latest-result.txt',join(root,'result.json')+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks.length,error:result.error,result:join(root,'result.json')}));
}
