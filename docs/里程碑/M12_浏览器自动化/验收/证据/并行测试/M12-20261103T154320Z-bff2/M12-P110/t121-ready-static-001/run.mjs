// FUTURE real execution entry. This file was statically checked only by its author.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
import http from 'node:http';
import {ROOT,sha,save,verifyPin} from './io.mjs';
import {loadPermit,validateLease} from './approval.mjs';
import {readPrivateCredentialPackage,installPrivateCredentialSeed} from './credential-input.mjs';
import {resolveRealCli} from './real-cli-pin.mjs';
import {openElectron} from './driver-source/scripts/lib/electron-harness.mjs';
import {installAppFocusGuard,isAppFocusYield} from './driver-source/scripts/lib/app-focus-guard.mjs';
import {ui as makeUi} from './ui.mjs';
import {createHandler} from './fixtures.mjs';
import {readNativeJournal} from './native-journal.mjs';
import {demoAccounts} from './fixtures.mjs';
import {makePageReadBody} from './observations.mjs';
import {resourceRecorder} from './resources.mjs';
import {captureActualPlan} from './actual-plan.mjs';
import {readDeliveredSkill} from './skill-files-proof.mjs';
import {verifyPackageManifest} from './skill-delivery.mjs';
import {waitPassiveInitialFocus} from './initial-focus.mjs';
const flag=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
assert(process.argv.includes('--execute'),'Explicit --execute required');
assert.equal(process.env.WILLYOU_TEST_CACHE_DIR,ROOT+'/cache');
assert.equal(process.env.NODE_COMPILE_CACHE,ROOT+'/cache/node');
const authorizationPath=flag('--authorization'),leasePath=flag('--lease');assert(authorizationPath&&leasePath);
// THIS gate runs before any credential/profile/CLI identity/App/listener/OS operation.
const permit=await loadPermit({authorizationPath,leasePath});
const {config,payload,pin,lease}=permit;
await save('execution-pin-verification.json',await verifyPin(pin));
const credential=await readPrivateCredentialPackage(),cli=await resolveRealCli(credential.executable);
const expectedCli=JSON.parse(await readFile(ROOT+'/real-cli-expected.json'));for(const key of ['launcherSha256','nativeBinarySha256','nodeSha256'])assert.equal(cli[key],expectedCli[key],'Real CLI changed '+key);assert.equal(credential.sourceConfigSha256,expectedCli.sourceConfigSha256);
assert.equal(cli.version,'0.166.0');assert.equal(credential.provider,'openai');assert.equal(credential.model,'gpt-6.1-sol');
await save('execution-started.json',{at:new Date().toISOString(),driverPid:process.pid,scope:config.scope,payloadSha256:permit.payloadSha256,authorizationReference:permit.authorizationReference},{exclusive:true});
const runtime=ROOT+'/runtime-001',userData=runtime+'/userdata',stateRoot=runtime+'/codex';
const r={schema:'m12-t121-sop-runtime-v1',status:'running-unjudged',scope:config.scope,marker:config.marker,startedAt:new Date().toISOString(),driverPid:process.pid,userData,stateRoot,payloadSha256:permit.payloadSha256,authorizationReference:permit.authorizationReference,sourceManifestSha256:pin.sourceManifestSha256,asarSha256:pin.asarSha256,realCodex:{...cli,model:credential.model,provider:credential.provider,authenticatedCachePresent:true},cases:[],actions:[],fixtures:[],cleanupSteps:[],cleanupErrors:[],boundary:'Real packaged App, actual terminal UI launches real existing Codex under workspace-write/on-request. Only synthetic M10/F-SITE data; no synthetic model, no real ZenTao, no daily data. Root must authorize this exact new T121 prompt and synthetic Bug. Only T121 is proposed; T120/123/124/125 remain separate scopes.'};
let app,ui,interrupted,stage='prepare',persistChain=Promise.resolve(),currentKey;
const fixtures=[],tasks=[],pages=new Set(),resources=resourceRecorder({userData,driverPid:process.pid});r.resourceHistory=resources.history;
const persist=()=>{const value=JSON.parse(JSON.stringify({...r,stage}));persistChain=persistChain.catch(()=>{}).then(()=>save('live.json',value));return persistChain;};
const check=()=>{if(interrupted)throw Error(interrupted);validateLease(lease,{executable:pin.executable});};
const poll=async(fn,timeout=20000,{cleanup=false}={})=>{const until=Date.now()+timeout;do{if(!cleanup)check();const value=await fn();if(value)return value;await new Promise(ok=>setTimeout(ok,250));}while(Date.now()<until);throw Error('Bounded stage timeout '+stage);};
const own=(code,label)=>{assert(typeof label==='string'&&/^[a-z0-9-]{1,64}$/.test(label),'Fixed safe own inspection label required');const expression=`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)}||process.pid!==${app.processId}||process.execPath!==${JSON.stringify(pin.executable)})throw Error('Exact own PID/executable/userData required');${code}})()`;new Function(expression);return app.mainEvaluate(expression,{label});};
const unwrap=v=>{assert(v?.ok,JSON.stringify({code:v?.code}));return v.value;};
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{interrupted='OWN_G1_INTERRUPTED';r.interruption={at:new Date().toISOString(),signal};});
const watchdog=setTimeout(()=>{interrupted='OWN_G1_18MIN_WATCHDOG';},1080000);
async function startFixture(scenario,{alternative=false,token}){
 const origin=alternative?scenario.alternativeOrigin:scenario.siteOrigin,port=Number(new URL(origin).port),requests=[],sockets=new Set();
 const key=scenario.caseId+(alternative?'-alternative':'-primary'),logPath=runtime+'/'+key+'.requests.private.jsonl';
 await writeFile(logPath,'',{flag:'wx',mode:0o600});
 const handler=createHandler({scenario,hostOnlySyntheticToken:token,calculate:(x,n)=>x*n,onRecord:async record=>{const value={...record,fixtureArm:scenario.caseId,endpointRole:alternative?'alternative':'primary'};requests.push(value);await appendFile(logPath,JSON.stringify(value)+'\n',{mode:0o600});}});
 const server=http.createServer((req,res)=>{handler(req,res).catch(()=>{interrupted='OWN_G1_FIXTURE_HANDLER_FAILED';res.destroy();});});server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 // Fixed preselected random ports are part of reviewed payload. EADDRINUSE stops; no fallback.
 await new Promise((ok,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',ok);});
 resources.ports.add(port);const fixture={key,scenario,origin,port,server,sockets,requests,logPath,closed:false};fixtures.push(fixture);
 r.fixtures.push({key,scenarioKey:scenario.caseId,origin,port,logPath});return fixture;
}
async function activityAll(appId,projectId){const items=[],pages=[];let cursor=null;do{assert(pages.length<10,'Activity must be bounded and complete');const page=unwrap(await app.invoke('applications.activity',{appId,projectId,limit:100,...(cursor?{cursor}:{})}));assert(!page.recoveryIssue);pages.push({nextCursor:page.nextCursor,checkedAt:page.checkedAt,count:page.items.length});items.push(...page.items);cursor=page.nextCursor;}while(cursor);return {items,pages,complete:true};}
async function actualSkills(row,session){
 const plan=row.actualPlan;assert(Array.isArray(plan.skills)&&Array.isArray(plan.allowed),'Actual complete RunPlan required');
 const delivered=[];
 for(const expected of plan.skills){
  const application=session.applications.find(x=>x.appId===expected.appId),selected=application?.skills.find(x=>x.id===expected.skillId);assert(selected,'Actual fixed Skill projection required');
  const path=expected.nativeName===selected.name?selected.projectionPath:dirname(dirname(selected.projectionPath))+'/'+expected.nativeName+'/SKILL.md';assert(path.startsWith(runtime+'/'),'Only this runtime Skill');
  assert.equal(plan.applications.find(x=>x.appId===expected.appId)?.packageHash,application.packageHash);
  const packagePin=JSON.parse(await readFile(ROOT+'/skill-package-pins.json')).packages.find(x=>x.appId===expected.appId);assert(packagePin);
  assert(packagePin.path.startsWith(pin.app+'/Contents/Resources/capability-bundles/apps/'+expected.appId+'/'));
  const manifestBytes=await readFile(packagePin.path);assert.equal(sha(manifestBytes),packagePin.sha256);
  const packageManifest=verifyPackageManifest({bytes:manifestBytes,packageHash:application.packageHash,appId:expected.appId,expected,sourceHash:selected.sourceHash});
  const packageManifestSavedPath=runtime+'/'+row.key.replaceAll('.','-')+'-'+expected.appId+'-package-manifest.private.json';await writeFile(packageManifestSavedPath,manifestBytes,{mode:0o600});
  const proof=await readDeliveredSkill({directory:dirname(path),expected,packageHash:application.packageHash,storeId:row.planRecord.store.store_id,root:runtime});
  const bytes=proof.skillBytes,savedPath=runtime+'/'+row.key.replaceAll('.','-')+'-'+expected.appId+'-'+expected.skillId+'-SKILL.private.md';await writeFile(savedPath,bytes,{mode:0o600});
  delivered.push({...expected,path,savedPath,sha256:proof.skillFileSha256,skillFileSha256:proof.skillFileSha256,bytes:bytes.length,content:bytes.toString('utf8'),files:proof.files,bundleHash:proof.bundleHash,storeId:proof.storeId,packageManifestSavedPath,packageManifestFileSha256:sha(manifestBytes),appPackageHash:application.packageHash,actualPlanHash:plan.planHash,actualRunId:session.currentRun.id});
 }
 assert(delivered.some(x=>x.appId==='browser'&&x.skillId==='reproduce-bug'));
 assert(row.key==='T121');assert(delivered.some(x=>x.appId==='zentao'&&x.skillId==='bug-analysis'));
 row.deliveredSkills=delivered;return delivered;
}
try{
 stage='new-runtime';await mkdir(runtime,{mode:0o700});for(const path of ['userdata','home','tmp','projects'])await mkdir(runtime+'/'+path,{mode:0o700});
 for(const item of payload.cases){const projectDir=runtime+'/projects/'+item.key.replaceAll('.','-');await mkdir(projectDir,{mode:0o700});r.cases.push({key:item.key,projectDir,prompt:item.prompt,promptSha256:sha(Buffer.from(item.prompt)),scenario:item.scenario,actions:[]});}
 r.credentialReuse=await installPrivateCredentialSeed(credential,{stateRoot,project:r.cases[0].projectDir});
 for(const row of r.cases.slice(1))await appendFile(stateRoot+'/config.toml','\n[projects.'+JSON.stringify(row.projectDir)+']\ntrust_level="trusted"\n',{mode:0o600});
 r.testPolicy={args:[],sandbox:'workspace-write',approval:'on-request',provider:'openai',model:'gpt-6.1-sol'};
 const tokens=new Map();for(const row of r.cases.filter(x=>x.scenario)){const token=randomBytes(24).toString('hex');tokens.set(row.key,token);await startFixture(row.scenario,{token});if(row.scenario.alternativeOrigin)await startFixture(row.scenario,{token,alternative:true});}
 stage='open-own-packaged-app';app=await openElectron({executable:pin.executable,userData,cwd:runtime+'/projects',inspectMain:true,env:{HOME:runtime+'/home',ZDOTDIR:runtime+'/home',CODEX_HOME:stateRoot,TMPDIR:runtime+'/tmp',PATH:cli.testPath,WILLYOU_TEST_CACHE_DIR:ROOT+'/cache'}});resources.pids.add(app.processId);r.appPid=app.processId;
 r.exactAppIdentity=await own('return {pid:process.pid,executable:process.execPath,userData:E.app.getPath("userData")}',"readonly-exact-own-app-identity");
 r.syntheticSecretIsolation=await own("const names=['isEncryptionAvailable','encryptString','decryptString'],originals=names.map(name=>[name,E.safeStorage[name]]),counts={available:0,encrypt:0,decrypt:0},prefix=Buffer.from('G1-SYNTHETIC-CONNECTION-ONLY\\0');if(globalThis.__G1SyntheticSecrets)throw Error('Fresh isolation only');E.safeStorage.isEncryptionAvailable=()=>{counts.available++;return true};E.safeStorage.encryptString=value=>{if(typeof value!=='string')throw Error('Synthetic string required');counts.encrypt++;return Buffer.concat([prefix,Buffer.from(value,'utf8')])};E.safeStorage.decryptString=bytes=>{if(!Buffer.isBuffer(bytes)||!bytes.subarray(0,prefix.length).equals(prefix))throw Error('Refuse non-G1 synthetic ciphertext');counts.decrypt++;return bytes.subarray(prefix.length).toString('utf8')};globalThis.__G1SyntheticSecrets={snapshot:()=>({kind:'process-local-synthetic-connection-cipher',ownUserData:E.app.getPath('userData'),counts:{...counts},originalCipherFunctionsInvoked:0,boundary:'Only random synthetic M10 connection secrets in this new own userData; actual Codex auth seed remains isolated outside App secrets, no login Keychain encryption/decryption used by this backend'}),restore(){for(const[name,fn]of originals)E.safeStorage[name]=fn;const restored=originals.every(([name,fn])=>E.safeStorage[name]===fn),snapshot=this.snapshot();delete globalThis.__G1SyntheticSecrets;return{...snapshot,restored}}};return globalThis.__G1SyntheticSecrets.snapshot();","install-own-synthetic-m10-secret-isolation");
 stage='all-config-health-before-one-reload';
 for(const appId of ['browser','zentao']){let catalog=await poll(async()=>unwrap(await app.invoke('applications.catalog')).find(x=>x.appId===appId),30000);if(!catalog.added)unwrap(await app.invoke('applications.setAdded',appId,true,catalog.revision));}
 for(const row of r.cases){
  const name='[R] '+row.key+' '+config.marker.slice(-6);row.projectName=name;
  const project=await app.invoke('projects.create',{name,aliases:[],description:'Isolated synthetic M12 SOP G1 acceptance',rulesPath:null},[{label:'fixture',path:row.projectDir}]);row.projectId=project.id;
  const browser=unwrap(await app.invoke('applications.projectSettings',project.id,'browser'));if(!browser.enabled)unwrap(await app.invoke('applications.select',{projectId:project.id,appId:'browser',enabled:true,expectedRevision:browser.revision,connections:{}}));
  const zentao=unwrap(await app.invoke('applications.projectSettings',project.id,'zentao'));
  if(row.scenario){
   const tested=unwrap(await app.invoke('applications.testConnection',{expectedRevision:0,name:'Synthetic '+row.key,config:{kind:'zentao',baseUrl:row.scenario.siteOrigin+'/biz/',username:'tester',authMode:'token'},secret:tokens.get(row.key)}));
   const connection=unwrap(await app.invoke('applications.saveConnection','zentao',tested.operationId,tested.candidateHash));row.connectionId=connection.id;
   unwrap(await app.invoke('applications.select',{projectId:project.id,appId:'zentao',enabled:true,expectedRevision:zentao.revision,connections:{zentao:connection.id}}));
  }else if(zentao.enabled)unwrap(await app.invoke('applications.select',{projectId:project.id,appId:'zentao',enabled:false,expectedRevision:zentao.revision,connections:{}}));
  row.projectSelections={browser:unwrap(await app.invoke('applications.projectSettings',project.id,'browser')),zentao:unwrap(await app.invoke('applications.projectSettings',project.id,'zentao'))};
 }
 // No synthetic model endpoint: actual configured executable, existing authentication seed, standard policy.
 const profile=await app.invoke('aiProfiles.create',{name:'T121 actual Codex0.166',runner:'codex',executable:credential.executable,args:[],env:[{name:'HOME',value:runtime+'/home',secret:false},{name:'ZDOTDIR',value:runtime+'/home',secret:false},{name:'CODEX_HOME',value:stateRoot,secret:false},{name:'PATH',value:cli.testPath,secret:false}],color:null,isDefault:true});r.aiProfileId=profile.id;
 const health=await poll(async()=>{const p=await app.invoke('aiProfiles.get',profile.id);return p.checking?null:p;},60000);r.realProfileHealth={status:health.check?.status??null};assert.equal(health.check?.status,'ok','Real profile health not ready');
 stage='one-setup-reload';const timeOrigin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${timeOrigin}&&document.readyState==='complete'&&Boolean(document.querySelector('[data-testid=home-input]'))`,20000,{navigation:true});r.setupReload={before:timeOrigin,after:await app.evaluate('performance.timeOrigin'),count:1};
 await own('const w=E.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith("file:"));if(!w)throw Error("Own shell window missing");w.setTitle("[R] T121 SOP isolated");return {id:w.id,title:w.getTitle(),visible:w.isVisible()};',"set-own-g1-title");
 stage='await-passive-own-native-dom3s';r.initialFocus={status:'awaiting-native-dom-stable',appPid:app.processId,userData,guardNotInstalled:true,hookInvocations:0};await persist();console.log(JSON.stringify({stage,appPid:app.processId,userData,title:'[R] T121 SOP isolated'}));await waitPassiveInitialFocus({record:r.initialFocus,check,read:async()=>{const dom=await app.evaluate('({focused:document.hasFocus(),visibility:document.visibilityState})'),native=await own('return{pid:process.pid,executable:process.execPath,userData:E.app.getPath("userData"),focused:E.BaseWindow.getAllWindows().some(w=>!w.isDestroyed()&&w.isFocused())}','readonly-own-initial-native-focus');return{...dom,native:native.focused,owner:{pid:native.pid,executable:native.executable,userData:native.userData}}}});installAppFocusGuard(app,r,{allowOwnedViews:true});r.focusGuards.at(-1).installedAfterSetupReload=true;r.focusGuards.at(-1).installedAfterPassiveNativeDOM3s=true;r.initialFocus.guardNotInstalled=false;
 ui=makeUi(app,async action=>{const row={at:new Date().toISOString(),caseKey:currentKey,...action};r.actions.push(row);r.cases.find(x=>x.key===currentKey)?.actions.push(row);await persist();});
 for(const row of r.cases){
  check();currentKey=row.key;stage=row.key+'-real-ui-launch';
  if(await app.evaluate('!document.querySelector("[data-testid=home-input]")'))await ui.click('[data-testid=nav-new-task]');
  await ui.wait(()=>app.evaluate('Boolean(document.querySelector("[data-testid=home-input]"))'));
  await ui.choose('[data-testid=home-project]',row.projectName);await ui.choose('[data-testid=home-profile]','T121 actual Codex0.166');
  await ui.wait(()=>app.evaluate('document.querySelector("[data-testid=home-cwd]")?.title==='+JSON.stringify(row.projectDir)+'&&!document.querySelector("[data-testid=home-launch]")?.disabled'));
  await ui.insert('[data-testid=home-input]',row.prompt);row.launchedAt=new Date().toISOString();await ui.click('[data-testid=home-launch]');
  const task=await poll(async()=>{const list=await app.invoke('tasks.list',{includeArchived:true});return list.find(x=>x.projectId===row.projectId&&x.title.includes(config.marker));},45000);row.taskId=task.id;tasks.push({id:task.id,projectId:row.projectId,key:row.key});
  row.taskLaunched=await poll(async()=>{const t=await app.invoke('tasks.get',task.id);return t.ptyId?t:null;},30000);
  const session=await poll(async()=>{const x=unwrap(await app.invoke('applications.session',task.id));return x.currentRun?.runPlan?.verified===true&&x.currentRun.runPlan.cliVersion==='0.166.0'?x:null;},30000);row.initialSession=session;row.actualRunId=session.currentRun.id;const actualPlan=await captureActualPlan({own,userData,runId:row.actualRunId,taskId:row.taskId,projectId:row.projectId});row.actualPlan=actualPlan.plan;row.planBinding=actualPlan.binding;row.planRecord=actualPlan.record;
  assert.equal(session.projectId,row.projectId);assert.equal(session.taskId,row.taskId);assert.equal(session.currentRun.runPlan.cliVersion,'0.166.0');for(const planned of row.actualPlan.applications){assert.equal(planned.effectiveEntry,'cli');assert.equal(session.currentRun.runPlan.applications.find(x=>x.appId===planned.appId)?.effectiveEntry,'cli');}await actualSkills(row,session);await resources.capture(app,pages);await persist();
  stage=row.key+'-real-model-turn';
  await poll(async()=>{if(Date.now()-(row.lastResourceSampleMs??0)>5000){const workspace=await app.invoke('browser.snapshot',{taskId:row.taskId});for(const tab of workspace.tabs)pages.add(tab.id);row.workspaceSamples??=[];row.workspaceSamples.push({at:new Date().toISOString(),taskId:workspace.taskId,tabs:workspace.tabs.map(t=>({id:t.id,url:t.url,profileId:t.profileId}))});await resources.capture(app,pages);row.lastResourceSampleMs=Date.now();}let journals;try{journals=await readNativeJournal({stateRoot,expectedCwd:row.projectDir,after:row.launchedAt,marker:config.marker,targets:row.deliveredSkills,plan:row.actualPlan,stdinSecret:demoAccounts[row.scenario.account]})}catch(error){row.observerIssues??=[];row.observerIssues.push({at:new Date().toISOString(),kind:'unverified-observer-format',errorSha256:sha(Buffer.from(String(error)))});await persist();try{journals=await readNativeJournal({stateRoot,expectedCwd:row.projectDir,after:row.launchedAt,marker:config.marker,targets:[],plan:row.actualPlan})}catch{return false}}row.lastNativeSourceHashes=journals.map(x=>x.source);row.observerFormatStatus=journals.some(x=>x.unsupportedCarriers.length||x.unsupportedOutputs.length)?'unverified-format':'supported-format';if(journals.some(x=>x.forbiddenEscalations.length))throw Error('Actual model requested elevation');const complete=journals.flatMap(x=>x.completions).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).at(-1);if(!complete)return false;row.completedAt=complete.at;row.completionSource={source:complete.source,line:complete.line,messageSha256:complete.messageSha256};return true;},600000);
  row.taskFinal=await poll(async()=>{const task=await app.invoke('tasks.get',row.taskId);return task.nativeSessionId?task:null;},15000);
  row.finalSession=unwrap(await app.invoke('applications.session',row.taskId));assert.equal(row.finalSession.currentRun.id,row.actualRunId);
  row.activity={browser:await activityAll('browser',row.projectId),zentao:await activityAll('zentao',row.projectId)};
  row.browserObservation={at:new Date().toISOString(),workspace:await app.invoke('browser.snapshot',{taskId:row.taskId}),documents:await own(makePageReadBody({origin:row.scenario.siteOrigin}),'readonly-own-t121-page-result')};for(const tab of row.browserObservation.workspace.tabs)pages.add(tab.id);await resources.capture(app,pages);
  row.hostInvocations=await own(`const request=process.getBuiltinModule('module').createRequire(E.app.getAppPath()+'/package.json'),DB=request('better-sqlite3'),db=new DB(${JSON.stringify(userData+'/smartdd.db')},{readonly:true,fileMustExist:true});try{db.pragma('query_only=ON');return db.prepare('SELECT operation_id,request_id,run_id,task_id,project_id,app_id,package_hash,tool_name,state,effect_state,attempt_count,semantics,connection_id,contract_major,started_at,ended_at FROM application_invocations WHERE run_id=? AND task_id=? AND project_id=?').all(${JSON.stringify(row.actualRunId)},${JSON.stringify(row.taskId)},${JSON.stringify(row.projectId)})}finally{db.close()}`,'readonly-own-current-arm-invocations');row.nativeSourcesBeforeStop=row.lastNativeSourceHashes;row.nativeSnapshotsBeforeStop=[];for(const [index,source]of row.nativeSourcesBeforeStop.entries()){assert(source.path.startsWith(stateRoot+'/sessions/'));const current=await readFile(source.path),prefix=current.subarray(0,source.bytes);assert.equal(sha(prefix),source.sha256,'Original observed source prefix must remain intact');const path=runtime+'/'+row.key.replaceAll('.','-')+'-native-before-stop-'+index+'.private.jsonl';await writeFile(path,prefix,{flag:'wx',mode:0o600});row.nativeSnapshotsBeforeStop.push({path,sha256:sha(prefix),bytes:prefix.length,originalSource:source.path})}row.rawAndFullHostCapturedBeforeStopAt=new Date().toISOString();await save('raw.private.json',{...r,stage});
  for(const target of row.deliveredSkills)assert.equal(sha(await readFile(target.path)),target.sha256);
  row.endObservedAt=new Date().toISOString();row.status='executed-unjudged';await persist();
  // Actual assistant final turn captured. Stop only this own completed synthetic task; no user answer is faked.
  stage=row.key+'-stop-own-waiting-task';const owned=await app.invoke('tasks.get',row.taskId);assert.equal(owned.projectId,row.projectId);if(owned.ptyId)await app.invoke('tasks.kill',row.taskId);await poll(async()=>!(await app.invoke('tasks.get',row.taskId)).ptyId,15000);row.stoppedAt=new Date().toISOString();await persist();
 }
 r.status='executed-unjudged';
}catch(error){r.status=isAppFocusYield(error)?'deferred-focus-loss':interrupted?'interrupted':'failed-or-partial';const text=String(error.stack??error);r.failure={stage,type:error.name,privateErrorSha256:sha(Buffer.from(text))};await mkdir(runtime,{recursive:true,mode:0o700});await writeFile(runtime+'/failure.private.log',text,{mode:0o600});}
finally{
 clearTimeout(watchdog);
 const clean=async(label,fn)=>{const row={label,at:new Date().toISOString()};r.cleanupSteps.push(row);try{row.value=await fn();row.status='fulfilled';return row.value;}catch(error){const text=String(error.stack??error);row.status='failed';row.privateErrorSha256=sha(Buffer.from(text));r.cleanupErrors.push(row);await writeFile(runtime+'/cleanup-'+label+'.private.log',text,{mode:0o600});}};
 if(app){
  for(const task of tasks)await clean('readonly-final-page-inventory-'+task.key.toLowerCase(),async()=>{const w=await app.invoke('browser.snapshot',{taskId:task.id});for(const tab of w.tabs)pages.add(tab.id);return{taskId:w.taskId,pageIds:w.tabs.map(t=>t.id)};});
  await clean('exact-own-resource-inventory',()=>resources.capture(app,pages));
  for(const task of tasks)await clean('stop-own-'+task.key.replaceAll('.','-'),async()=>{const t=await app.invoke('tasks.get',task.id);assert.equal(t.projectId,task.projectId);if(t.ptyId)await app.invoke('tasks.kill',task.id);return poll(async()=>!(await app.invoke('tasks.get',task.id)).ptyId,15000,{cleanup:true});});
  r.syntheticSecretIsolationFinal=await clean('restore-own-synthetic-secret-isolation',()=>own('return globalThis.__G1SyntheticSecrets?.restore()??null','restore-own-synthetic-secret-isolation'));
  r.exactGatewayPaths=await clean('readonly-own-unix-paths',()=>own('return process._getActiveHandles().filter(h=>h?.constructor?.name==="Server"&&typeof h.address==="function"&&typeof h.address()==="string"&&["/private/tmp/wy-cli-","/tmp/wy-cli-","/private/tmp/wy-"+process.getuid()+"-","/tmp/wy-"+process.getuid()+"-"].some(prefix=>h.address().startsWith(prefix))).map(h=>h.address())','readonly-own-unix-paths'))??[];r.exactGatewayDirectories=[...new Set(r.exactGatewayPaths.map(path=>dirname(path)))];
  await clean('normal-own-app-quit',async()=>{await own('setTimeout(()=>E.app.quit(),100);return true',"normal-own-g1-app-quit");r.appExit=await app.waitForExit(45000);return r.appExit;});
  await clean('private-electron-log',()=>writeFile(runtime+'/electron.private.log',app.logs(),{mode:0o600}));await clean('close-own-harness',()=>app.close());r.observedProcess=await clean('passive-own-process-terminal',()=>app.observedProcess());app=undefined;
 }
 for(const fixture of fixtures)await clean('close-'+fixture.key.replaceAll('.','-'),async()=>{for(const socket of fixture.sockets)socket.destroy();await new Promise((ok,no)=>fixture.server.close(error=>error?no(error):ok()));fixture.closed=true;return {origin:fixture.origin,closed:true};});
 r.fixtureFinal=fixtures.map(x=>({key:x.key,port:x.port,origin:x.origin,logPath:x.logPath,requests:x.requests,closed:x.closed}));
 r.knownPids=[...resources.pids];r.knownPorts=[...resources.ports];r.finishedAt=new Date().toISOString();await persistChain.catch(()=>{});await save('raw.private.json',r);
 await save('runtime-001/cleanup.actual.json',{at:r.finishedAt,resourcesHeld:false,appExit:r.appExit??null,observedProcess:r.observedProcess??null,steps:r.cleanupSteps,errors:r.cleanupErrors,knownPids:r.knownPids,knownPorts:r.knownPorts,boundary:'Only exact own tasks/App/listeners; forced close, if any, is not normal-exit acceptance.'});
 console.log(JSON.stringify({status:r.status,cases:r.cases.map(x=>({key:x.key,status:x.status??'unexecuted'})),failure:r.failure??null,cleanupErrors:r.cleanupErrors.length,formalWholeCaseCount:0}));
}
