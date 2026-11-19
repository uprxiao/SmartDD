import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {dirname,join} from 'node:path';
import {openElectron,pause} from './helpers/scripts/lib/electron-harness.mjs';
import {redirectHome} from './helpers/scripts/applications/fixtures/home-redirect-main.mjs';
import {targetHit} from './a60-prep/pointer-guard.mjs';
import {readExactA40Database} from './a40-prep/observations.mjs';
import {attachModelObserver} from './a60-closure/model-effort-observer.mjs';
import {fixtures,modelProvider,modelA,modelB,nameB} from './a60-closure/model-effort-provider.mjs';

const [out,expectedHash,scenario='default']=process.argv.slice(2);
assert.match(out,/^\/private\/tmp\/willyou-m14-stage6\.[A-Za-z0-9]{6}\/g04\/attempt-\d{3}$/);
const homeRoot=out.slice(0,out.indexOf('/g04/'));
const executable=process.env.M14_ACCEPTANCE_APP;
const commit=process.env.M14_ACCEPTANCE_COMMIT;
assert.match(commit,/^[a-f0-9]{40}$/);
assert.equal(realpathSync(process.cwd()),join(homeRoot,'source'));
assert.equal(execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),commit);
assert.equal(executable,join(homeRoot,'package/mac-arm64/WillYou.app/Contents/MacOS/WillYou'));
assert.equal(realpathSync(executable),executable);
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const asar=sha(join(dirname(executable),'../Resources/app.asar'));
assert.equal(asar,expectedHash);
for(const key of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','CODEX_API_KEY','OPENAI_API_KEY','DEEPSEEK_API_KEY']){
  assert(!process.env[key],'No external provider variables are allowed');
}
mkdirSync(out,{mode:0o700});
const root=realpathSync(mkdtempSync(join(out,'runtime-')));
const home=join(root,'home'),userData=join(root,'data'),cwd=join(root,'project');
for(const dir of [home,userData,cwd])mkdirSync(dir,{mode:0o700});
mkdirSync(join(home,'Library','Keychains'),{recursive:true,mode:0o700});
const env={HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),
  XDG_CONFIG_HOME:join(home,'.config'),XDG_DATA_HOME:join(home,'.local/share'),XDG_CACHE_HOME:join(home,'.cache'),
  GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
assert(['default','effort'].includes(scenario));
const origin='http://127.0.0.1:3425',q=JSON.stringify;
const result={caseId:'M14-A60',scenario,layer:'A genuine Codex app-server and actual packaged UI, synthetic loopback responses',
  asar,commit,executable,startedAt:new Date().toISOString(),root,home,userData,cwd,port:3425,status:'failed',
  appRuns:[],actions:[],requests:[],turns:[],choices:[],phase:'prepare isolated fixture',
  inputHashes:Object.fromEntries(['a60-model-effort-packaged.mjs','a60-closure/model-effort-observer.mjs','a60-closure/model-effort-provider.mjs',
    'a60-prep/provider-contract.mjs','a60-prep/pointer-guard.mjs','a40-prep/observations.mjs','helpers/scripts/lib/electron-harness.mjs',
    'helpers/scripts/applications/fixtures/home-redirect-main.mjs'].map(file=>[file,sha(new URL(file,import.meta.url))]))};
const lanes=new Map();
const handle=modelProvider(lanes,result.requests);
let app=null,appRun=null,task=null,project,profile,codex,stateRoot,live=false;
const server=createServer((request,response)=>void handle(request,response).catch(error=>{
  result.providerFailure??=String(error.stack??error);
  if(!response.headersSent)response.writeHead(400,{'content-type':'application/json'});
  response.end(JSON.stringify({error:{type:'invalid_request_error',message:'A60 local model fixture rejected the original inputs'}}));
}));
const snapshot=taskId=>app.invoke('agentTasks.snapshot',taskId);
const selector='.agent-task-view .agent-model-pill';
const defaultLabel='默认（'+modelA+'）';
const coldEffort='A60_MODEL_COLD_BEFORE_EFFORT';

async function until(read,label,timeout=16000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    if(result.providerFailure)throw Error(result.providerFailure);
    const value=await read();
    if(value)return value;
    await pause(80);
  }
  throw Error('Timed out: '+label);
}
async function click(selector,text=null){
  const expression='('+targetHit.toString()+')('+q(selector)+','+q(text)+')';
  let last;
  let ready;
  try{
    ready=await until(async()=>{last=await app.evaluate(expression);return last?.reason==='ready'&&last;},'real control '+selector,7000);
  }catch(error){throw Error(String(error.message)+' '+q(last));}
  const {x,y}=ready;
  for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});
  result.actions.push({at:Date.now(),pid:app.processId,selector,text,x,y});
}
function ownedMain(code){
  return `(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');
    if(process.pid!==${app.processId}||!E.app.isPackaged||process.execPath!==${q(executable)}||
      E.app.getPath('home')!==${q(home)}||E.app.getPath('userData')!==${q(userData)})
      throw Error('Unexpected App for A60');${code}})()`;
}
async function startApp(stage){
  const entry={stage,startedAt:Date.now()};
  appRun=entry;
  result.appRuns.push(appRun);
  app=await openElectron({executable,userData,env,inspectMain:true,startupMainHook:async info=>{
    const hook=await redirectHome({...info,home});
    assert.equal(hook.workerInspectorFlagRemoved,true);
    appRun.hook=hook;
  }});
  appRun.pid=app.processId;
  appRun.identity=await app.mainEvaluate(ownedMain('return {pid:process.pid,home:process.env.HOME,userData:E.app.getPath("userData"),executable:process.execPath};'));
  assert.deepEqual(appRun.identity,{pid:app.processId,home,userData,executable});
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  return {app,appRun};
}
function rows(taskId,phase='active'){
  const queries={processes:'SELECT p.run_id,p.kind,p.pid,p.process_started_at,p.state FROM capability_run_processes p JOIN capability_runs r ON r.run_id=p.run_id WHERE r.task_id=? ORDER BY p.rowid',binding:'SELECT binding_id,native_id,state_root FROM agent_bindings WHERE task_id=?',
    run:'SELECT run_id,binding_id,generation,pid,state FROM capability_runs WHERE task_id=? ORDER BY generation',
    turns:'SELECT turn_id,run_id,native_turn_id,status,source_kind FROM agent_turns WHERE task_id=? ORDER BY accepted_at'};
  return readExactA40Database(join(userData,'smartdd.db'),taskId,queries,phase);
}
async function typeInto(selector,text){
  await click(selector);
  assert(await app.evaluate('document.activeElement===document.querySelector('+q(selector)+')'));
  await app.cdp('Input.insertText',{text});
  await app.waitFor('document.querySelector('+q(selector)+')?.value==='+q(text),7000);
}
async function tapNative(delayedMarker=null){
  const expected={cwd,stateRoot,codex,delayedMarker,holdMs:4200};
  appRun.observe=await app.mainEvaluate(ownedMain(`
    if(globalThis.__a60ModelObserver)throw Error('Observer already attached');
    const modules={childProcess:process.getBuiltinModule('child_process'),fs:process.getBuiltinModule('fs'),createHash:process.getBuiltinModule('crypto').createHash};
    globalThis.__a60ModelObserver=(${attachModelObserver.toString()})(modules,${q(expected)});
    return true;`));
}
const native=()=>app.mainEvaluate(ownedMain('return globalThis.__a60ModelObserver.snapshot();'));
async function quitApp(){
  assert(app);
  if(appRun.observe){
    appRun.nativeBeforeQuit=await native();
    appRun.restoreObserver=await app.mainEvaluate(ownedMain('const observer=globalThis.__a60ModelObserver;delete globalThis.__a60ModelObserver;return observer.restore();'));
    assert(appRun.restoreObserver);
  }
  await app.mainEvaluate(ownedMain('setTimeout(()=>E.app.quit(),70);return true;'));
  appRun.exit=await app.waitForExit(23000);
  appRun.rendererErrors=app.rendererErrors;
  writeFileSync(join(out,'app-'+app.processId+'.log'),app.logs(),{mode:0o600});
  app=null;
  assert.equal(appRun.exit?.code,0);
  assert.equal(appRun.exit?.signal,null);
  assert.deepEqual(appRun.rendererErrors,[]);
}
const option=label=>'.agent-picker .agent-model-row[aria-label='+q(label)+']';
async function openPicker(){
  await click(selector);
  await app.waitFor('Boolean(document.querySelector(".agent-picker"))',6500);
}
async function closePicker(){
  await app.cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await app.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await app.waitFor('!document.querySelector(".agent-picker")',6500);
}
async function selectModel(label, expected){
  await openPicker();
  const alternatives=expected===modelB?[label,modelB]:[label];
  const actualLabel=await until(async()=>{
    for(const value of alternatives)if(await app.evaluate('Boolean(document.querySelector('+q(option(value))+'))'))return value;
    return false;
  },'visible actual model option '+label);
  await click(option(actualLabel));
  await app.waitFor('!document.querySelector(".agent-picker")',6500);
  const displayed=await until(async()=>{
    const snap=await snapshot(task.taskId);
    const pill=await app.evaluate("document.querySelector('.agent-model-pill small')?.innerText?.trim()");
    return (snap.selection.model??null)===expected && pill===(expected??'默认')
      &&{at:Date.now(),label,actualLabel,model:snap.selection.model??null,pill};
  },'real model selection and pill match '+label);
  result.choices.push(displayed);
}
async function requireEffortCatalog(){
  return await until(async()=>{
    const snap=await snapshot(task.taskId);
    const item=snap.run?.models?.find(entry=>entry.id===modelA && entry.efforts.includes('high'));
    return item??false;
  },'real native model/list publishes default A high effort');
}
async function openTraits(){
  await openPicker();
  const traits=await app.evaluate(`(() => {
    const panel=document.querySelector('.agent-picker-traits');
    return panel&&{text:panel.innerText,buttons:[...panel.querySelectorAll('button')].map(b=>({
      label:b.innerText.trim(),selected:!!b.querySelector('svg')
    }))};
  })()`);
  assert(traits);
  return traits;
}
async function captureSkipReason(){
  const locator=`(() => {
    const matches=[...document.querySelectorAll('details.agent-system-notice')].filter(row=>
      row.querySelector('pre')?.textContent?.includes('未应用推理强度 high：执行器未公布该模型的此选项。'));
    if(matches.length!==1)return null;
    const row=matches[0], target=row.querySelector('summary');
    if(row.open)return {open:true,text:row.querySelector('pre').innerText};
    const rect=target.getBoundingClientRect(), x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    return {open:false,x,y,visible:rect.width>0&&rect.height>0&&target.contains(document.elementFromPoint(x,y))};
  })()`;
  const candidate=await until(async()=>{
    const state=await app.evaluate(locator);
    return (state?.open||state?.visible)&&state;
  },'visible exact host setting skipped notice',8000);
  if(!candidate.open){
    for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,x:candidate.x,y:candidate.y,button:'left',clickCount:1});
    result.actions.push({at:Date.now(),selector:'details.agent-system-notice > summary matched on exact setting skip',x:candidate.x,y:candidate.y});
  }
  return await until(async()=>{
    const state=await app.evaluate(locator);
    return state?.open&&state.text;
  },'real visible expanded reason',6000);
}
async function send(marker,model,{homeInput=false,expectEffort}={}){
  assert(!lanes.has(marker));
  lanes.set(marker,{model});
  if(homeInput){
    await click('.app-rail .rail-home');
    await click('[data-testid="sidebar-project"][data-project-id='+q(project.id)+'] .reference-project-name');
    await app.waitFor("document.querySelector('[data-testid=home-cwd]')?.title==="+q(cwd),8000);
    await app.waitFor("document.querySelector('.agent-model-profile')?.textContent==="+q(profile.name),8000);
    await typeInto('[data-testid="home-input"]',marker);
    await click('[data-testid="home-launch"]');
    task=await until(async()=>(await app.invoke('agentTasks.list')).find(row=>row.title===marker&&row.projectId===project.id),
      'task created by normal home input');
    result.taskId=task.taskId;
    assert.equal(task.selection.profileId,profile.id);
  }else{
    await typeInto('.agent-task-view .agent-composer textarea',marker);
    await click('.agent-task-view .agent-composer button[type="submit"]');
  }
  const completed=await until(async()=>{
    const snap=await snapshot(task.taskId);
    const turn=snap.turns.at(-1);
    if(turn?.status==='failed'){
      result.actualError=snap.items.filter(item=>item.type==='error').at(-1);
      throw Error(q(result.actualError?.payload??turn.error_code));
    }
    if(turn?.status!=='completed'||snap.run?.busy||!snap.run?.runId||!snap.items.some(item=>
      item.turnId===turn.turn_id&&item.type==='assistant_message'&&item.payload.text?.includes(marker+'_DONE')))return false;
    const current=(await native()).filter(row=>row.pid&&!row.exit);
    assert.equal(current.length,1);
    const {pid,rows:frames}=current[0];
    const found=frames.filter(row=>row.direction==='in'&&row.method==='turn/start'&&row.marker===marker);
    if(!found.length)return false;
    assert.equal(found.length,1);
    assert.equal(found[0].model,model);
    assert(found[0].modelPresent,'Default sentinel must be resolved before the real native call');
    assert.equal(found[0].clientInputId,turn.client_input_id);
    if(expectEffort!==undefined) {
      assert.equal(found[0].effort,expectEffort);
      assert.equal(found[0].effortPresent,expectEffort!==null);
    }
    const receipt=frames.find(row=>row.direction==='out'&&row.method==='turn/completed'&&row.turnId===turn.native_turn_id);
    if(!receipt)return false;
    assert.equal(receipt.status,'completed');
    assert.equal(found[0].threadId,receipt.nativeThreadId);
    const provider=result.requests.filter(row=>row.marker===marker);
    assert.equal(provider.length,1);
    assert.equal(provider[0].model,model);
    return {marker,turn,runId:snap.run.runId,generation:snap.run.generation,nativePid:pid,selection:snap.selection,
      wire:found[0],receipt,provider:provider[0],settingSkip:snap.items.find(item=>item.turnId===turn.turn_id&&
        item.type==='system_notice'&&item.payload.code==='settingSkipped')??null};
  },'completed App + native + actual isolated provider model result '+marker,22000);
  assert.equal(completed.turn.run_id,completed.runId);
  result.turns.push(completed);
  return completed;
}

try{
  const git=args=>execFileSync('/usr/bin/git',['-C',cwd,...args],{env:{...process.env,...env},encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']});
  git(['init','-qb','main']);
  git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-qm','A60 synthetic project']);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3425,'127.0.0.1',()=>{live=true;resolve();});});
  result.phase='start first private App';
  ({app,appRun}=await startApp('create'));
  await app.invoke('agents.refreshTools');
  const tool=(await app.invoke('agents.tools')).find(entry=>entry.kind==='codex'&&entry.installed);
  assert(tool,'Actual native Codex required');
  codex=realpathSync(tool.executable);
  result.codex={path:codex,version:tool.version};
  const provider=await app.invoke('agents.saveProvider',{name:'A60 local public fixture',preset:'magpie',
    endpoints:{responses:origin+'/v1',anthropic:origin+'/'},models:fixtures});
  profile=await app.invoke('agents.save',{name:'A60 local Codex',toolId:tool.id,source:'provider',providerId:provider.id,
    models:[modelA,modelB],defaultModel:modelA,isDefault:true});
  project=await app.invoke('projects.create',{name:'A60 isolated model project',aliases:[],description:'',rulesPath:null},[{label:'work',path:cwd}]);
  stateRoot=join(userData,'agents','codex',createHash('sha256').update(profile.id).digest('hex').slice(0,32));
  mkdirSync(stateRoot,{recursive:true,mode:0o700});
  assert.equal(realpathSync(stateRoot),stateRoot);
  await tapNative();
  await click('[data-testid="nav-settings"]');
  if(!await app.evaluate("document.querySelector('[data-testid=m14-toggle]')?.textContent.includes('已开启')"))await click('[data-testid="m14-toggle"]');
  await click('.app-rail .rail-home');
  const oldOrigin=await app.evaluate('performance.timeOrigin');
  await app.cdp('Page.reload');
  await app.waitFor(`performance.timeOrigin!==${oldOrigin}&&Boolean(document.querySelector('[data-testid=nav-settings]'))`,15000,{navigation:true});
  await app.arm();

  result.phase='actual native default A then explicit B and back to default A';
  const warm=await send('A60_MODEL_WARM_DEFAULT',modelA,{homeInput:true});
  await selectModel(nameB,modelB);
  const explicit=await send('A60_MODEL_PICKED_B',modelB);
  await app.screenshot(join(out,'01-true-explicit-b.png'));
  await selectModel(defaultLabel,null);
  const back=await send('A60_MODEL_RETURNED_DEFAULT',modelA);
  await app.screenshot(join(out,'02-true-return-to-default-a.png'));
  assert.equal(back.selection.model??null,null);
  assert.equal(back.runId,warm.runId);
  assert.equal(explicit.runId,warm.runId);
  assert.equal(back.wire.threadId,explicit.wire.threadId);
  assert.equal(back.wire.threadId,warm.wire.threadId);

  if(scenario==='default'){
    await selectModel(nameB,modelB);
    const last=await send('A60_MODEL_RETAIN_B_BEFORE_QUIT',modelB);
    assert.equal(last.runId,warm.runId);
  }else{
    await requireEffortCatalog();
    const beforeHigh=await openTraits();
    assert(beforeHigh.buttons.some(b=>b.label==='high'));
    await click('.agent-picker-traits button','high');
    await until(async()=>(await snapshot(task.taskId)).selection.effort==='high','UI high effort persisted');
    await closePicker();
    await send('A60_MODEL_FIRST_HIGH',modelA,{expectEffort:'high'});
  }
  await quitApp();
  result.afterFirstExit=rows(task.taskId,'closed');
  assert.equal(result.afterFirstExit.binding.length,1);
  assert.equal(result.afterFirstExit.binding[0].native_id,warm.wire.threadId);

  result.phase='cold packaged App restores previous data and native binding';
  ({app,appRun}=await startApp('resume'));
  await tapNative(scenario==='effort'?coldEffort:null);
  await click('[data-testid="sidebar-agent-task"][data-task-id='+q(task.taskId)+']');
  const restored=await snapshot(task.taskId);
  assert.equal(restored.run,null);
  if(scenario==='default'){
    assert.equal(restored.selection.model,modelB);
    await selectModel(defaultLabel,null);
  }else{
    assert.equal(restored.selection.effort,'high');
    result.traitsBefore=await openTraits();
    assert.match(result.traitsBefore.text,/执行器尚未公布可用选项/);
    assert.equal(result.traitsBefore.buttons.length,0);
    await app.screenshot(join(out,'03-cold-unannounced.png'));
    await closePicker();
  }
  const resumed=await send(scenario==='effort'?coldEffort:'A60_MODEL_COLD_RETURNED_DEFAULT',modelA,
    scenario==='effort'?{expectEffort:null}:{});
  assert.equal(resumed.wire.threadId,warm.wire.threadId);
  assert.notEqual(resumed.nativePid,warm.nativePid);
  assert.notEqual(resumed.runId,warm.runId);
  const owners=await native();
  assert.equal(owners.length,1);
  const open=owners[0].rows.filter(row=>row.method==='thread/resume');
  assert.equal(open.length,2);
  assert(open.some(row=>row.direction==='in'&&row.threadId===warm.wire.threadId));
  assert(open.some(row=>row.direction==='out'&&row.nativeThreadId===warm.wire.threadId));
  assert.equal(resumed.selection.model??null,null);

  if(scenario==='effort'){
    result.phase='true resumed turn skips unpublished effort and real model/list subsequently enables it';
    assert.match(resumed.settingSkip?.payload?.detail??'',/未应用推理强度 high/);
    const held=owners[0].rows.find(row=>row.method==='catalog-held'),release=owners[0].rows.find(row=>row.method==='catalog-release');
    assert(held&&release&&held.id===release.id&&held.sha===release.sha);
    assert.equal(release.reason,'first-resumed-turn-forwarded');
    assert(owners[0].rows.indexOf(held)<owners[0].rows.findIndex(row=>row.marker===coldEffort));
    assert(owners[0].rows.findIndex(row=>row.marker===coldEffort)<owners[0].rows.indexOf(release));
    result.catalogGate={held,release};
    result.visibleSkipReason=await captureSkipReason();
    assert.match(result.visibleSkipReason,/未应用推理强度 high/);
    await requireEffortCatalog();
    // 360 opened the menu as soon as the host snapshot had the catalog, before the renderer's debounced reload.
    // Wait (bounded) for the open menu itself to show the published option, and keep every sample.
    result.traitsSamples=[];
    result.traitsAfter=await openTraits();
    const traitsStart=Date.now();
    while(!result.traitsAfter.buttons.some(b=>b.label==='high'&&b.selected)&&Date.now()-traitsStart<5000){
      await pause(200);
      result.traitsAfter=await app.evaluate(`(() => { const panel=document.querySelector('.agent-picker-traits'); return panel&&{text:panel.innerText,buttons:[...panel.querySelectorAll('button')].map(b=>({label:b.innerText.trim(),selected:!!b.querySelector('svg')}))}; })()`);
      result.traitsSamples.push({ms:Date.now()-traitsStart,buttons:result.traitsAfter?.buttons?.length??null});
    }
    result.traitsVisibleAfterMs=Date.now()-traitsStart;
    assert(result.traitsAfter.buttons.some(b=>b.label==='high'&&b.selected),'Open menu did not show the published effort within 5 s');
    await app.screenshot(join(out,'04-native-announced-and-visible-skip.png'));
    await closePicker();
    const applied=await send('A60_MODEL_COLD_AFTER_EFFORT',modelA,{expectEffort:'high'});
    assert.equal(applied.runId,resumed.runId);
    assert.equal(applied.wire.threadId,resumed.wire.threadId);
    assert.equal(applied.settingSkip,null);
  }else await app.screenshot(join(out,'03-cold-retained-thread-default-a.png'));
  await quitApp();
  result.afterSecondExit=rows(task.taskId,'closed');
  const {binding,run,turns,processes}=result.afterSecondExit;
  assert.equal(binding.length,1);
  assert.equal(binding[0].native_id,warm.wire.threadId);
  assert.equal(run.length,2);
  assert(run.every(row=>row.state==='stopped'&&row.binding_id===binding[0].binding_id));
  assert.equal(run[1].generation,run[0].generation+1);
  assert.deepEqual(turns.map(row=>row.turn_id),result.turns.map(row=>row.turn.turn_id));
  assert(turns.every(row=>row.status==='completed'));
  assert.equal(result.requests.length,turns.length);
  assert(processes.every(row=>row.state==='exited'&&row.pid&&row.process_started_at));
  assert(run.every(row=>processes.some(p=>p.run_id===row.run_id&&p.kind==='bridge')&&
    processes.some(p=>p.run_id===row.run_id&&p.kind==='cli'&&p.pid===row.pid)));
  result.releaseIds={appPids:result.appRuns.map(row=>row.pid),nativeAndBridge:processes,providerPort:3425};
  result.status='pass';
}catch(error){
  result.error=String(error.stack??error);
  if(app){
    result.dom=await app.evaluate('document.body.innerText.slice(-8500)').catch(()=>null);
    await app.screenshot(join(out,'failure.png')).catch(()=>{});
    if(appRun?.observe)appRun.partialNative=await native().catch(()=>null);
  }
}finally{
  if(app){
    if(task&&(await snapshot(task.taskId).catch(()=>null))?.run?.busy){
      result.failureCleanupStop=task.taskId;
      await app.invoke('agentTasks.stop',task.taskId,true).catch(()=>{});
      await until(async()=>!(await snapshot(task.taskId)).run?.busy,'failure cleanup stopped original run',7000).catch(()=>{});
    }
    try{await quitApp();}
    catch(error){
      result.cleanupError=String(error);
      if(app)try{appRun.forcedExit=await app.crash();}catch{}
    }
  }
  if(live){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  result.end=new Date().toISOString();
  writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2),{mode:0o600});
  console.log(JSON.stringify({status:result.status,phase:result.phase,appRuns:result.appRuns.map(({pid,exit})=>({pid,exit})),out}));
}
if(result.status!=='pass'||result.appRuns.some(run=>run.exit?.code!==0||run.exit.signal))process.exitCode=1;
