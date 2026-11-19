import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {dirname,join} from 'node:path';
import {openElectron,pause} from './helpers/scripts/lib/electron-harness.mjs';
import {redirectHome} from './helpers/scripts/applications/fixtures/home-redirect-main.mjs';
import {targetHit} from './a60-prep/pointer-guard.mjs';
import {latestUserText,sendAssistant} from './a60-prep/provider-contract.mjs';
import {inventoryFiles,models,hashInventory,observeCatalog} from './a07-prep/personal-extensions-r2.mjs';

const [out,expectedHash,mode='both']=process.argv.slice(2);
assert.match(out,/^\/private\/tmp\/willyou-m14-stage6\.[A-Za-z0-9]{6}\/g04\/attempt-\d{3}$/);
assert(['both','claude','codex'].includes(mode));
const kinds=mode==='both'?['claude','codex']:[mode];
const packageRoot=out.slice(0,out.indexOf('/g04/'));
const executable=process.env.M14_ACCEPTANCE_APP;
const commit=process.env.M14_ACCEPTANCE_COMMIT;
assert.match(commit,/^[a-f0-9]{40}$/);
assert.equal(realpathSync(process.cwd()),join(packageRoot,'source'));
assert.equal(execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),commit);
assert.equal(executable,join(packageRoot,'package/mac-arm64/WillYou.app/Contents/MacOS/WillYou'));
assert.equal(executable,realpathSync(executable));
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const asar=sha(join(dirname(executable),'../Resources/app.asar'));
assert.equal(asar,expectedHash);
for(const name of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','CODEX_API_KEY','OPENAI_API_KEY','DEEPSEEK_API_KEY']){
  assert(!process.env[name],'Only public fixture auth is allowed');
}
mkdirSync(out,{mode:0o700});
const root=realpathSync(mkdtempSync(join(out,'runtime-')));
const home=join(root,'home'),data=join(root,'data'),cwd=join(root,'project');
for(const dir of [home,data,cwd])mkdirSync(dir,{mode:0o700});
mkdirSync(join(home,'Library','Keychains'),{recursive:true,mode:0o700});
const env={HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),
  XDG_CONFIG_HOME:join(home,'.config'),XDG_DATA_HOME:join(home,'.local/share'),XDG_CACHE_HOME:join(home,'.cache'),
  ENABLE_TOOL_SEARCH:'false',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
const loopback='http://127.0.0.1:3425';
const result={caseId:'M14-A07',scope:'Only managed-provider isolation followup. Subscription path remains pending true native sign-in',status:'failed',mode,
  commit,asar,executable,scopeRoot:root,port:3425,requests:[],actions:[],tasks:[],stages:[],startup:{},
  sourceHashes:Object.fromEntries(['a07-managed-isolation-packaged-r2.mjs','a07-prep/personal-extensions-r2.mjs',
    'a60-prep/provider-contract.mjs','a60-prep/pointer-guard.mjs','helpers/scripts/lib/electron-harness.mjs',
    'helpers/scripts/applications/fixtures/home-redirect-main.mjs'].map(file=>[file,sha(new URL(file,import.meta.url))]))};
const sent=new Map();
let app,project,phase='before startup',serving=false;
const q=JSON.stringify;
const server=createServer((req,res)=>{void handle(req,res).catch(error=>{
  result.providerFailure??=String(error.stack??error);
  if(!res.headersSent)res.writeHead(400,{'content-type':'application/json'});
  res.end(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'A07 local isolation fixture mismatch'}}));
});});

async function handle(req,res){
  const path=new URL(req.url,loopback).pathname;
  if(path.endsWith('/models')){
    res.writeHead(200,{'content-type':'application/json'});
    return res.end(JSON.stringify({data:Object.values(models).map(id=>({id}))}));
  }
  const kind=path==='/v1/responses'?'codex':/^\/(?:v1\/)?messages$/.test(path)?'claude':null;
  if(req.method!=='POST'||!kind){res.writeHead(404);return res.end();}
  assert([req.headers['x-api-key'],req.headers.authorization]
    .some(value=>value==='magpie-'+kind||value==='Bearer magpie-'+kind));
  const bytes=[];
  for await(const chunk of req)bytes.push(chunk);
  const body=JSON.parse(Buffer.concat(bytes).toString());
  assert.equal(body.model,models[kind]);
  const marker=latestUserText(kind,body).trim().split(/\r?\n/).findLast(line=>/^A07_MANAGED_[A-Z]+_[12]$/.test(line.trim()))?.trim();
  const row=sent.get(marker);
  assert(row&&row.kind===kind,'The original, assigned managed fixture input must be the actual native latest text');
  const observed=observeCatalog(kind,body);
  result.requests.push({marker,kind,observed,at:Date.now(),model:body.model,runCausedByActualUserInput:true});
  row.observed=observed;
  sendAssistant(res,{kind,model:models[kind],text:marker+'_DONE'});
}

async function until(read,label,timeout=18000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    if(result.providerFailure)throw Error(result.providerFailure);
    const value=await read();
    if(value)return value;
    await pause(100);
  }
  throw Error('Timed out: '+label);
}

async function click(selector,text=null){
  const {x,y}=await until(async()=>{
    const probe=await app.evaluate('('+targetHit.toString()+')('+q(selector)+','+q(text)+')');
    return probe.reason==='ready'&&probe;
  },'foreground-free exact click '+selector,9000);
  for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});
  result.actions.push({selector,text,x,y,at:Date.now()});
}

async function selectProvider(name,kind){
  await click('.agent-model-pill');
  await click('.agent-picker-rail button[aria-label='+q(name)+']');
  await app.waitFor("document.querySelector('.agent-picker-head')?.textContent.includes('WillYou 托管供应商')",7000);
  const status=await app.evaluate(`(()=>{const picker=document.querySelector('.agent-picker');
    return {text:picker?.querySelector('.agent-extension-toggle')?.textContent,extensionSwitch:!!picker?.querySelector('.agent-extension-toggle input')};})()`);
  assert.match(status.text,/托管配置已隔离/);
  assert.equal(status.extensionSwitch,false);
  await click('.agent-model-row[aria-label='+q(models[kind])+']');
  await app.waitFor("document.querySelector('.agent-model-profile')?.textContent==="+q(name),7000);
  return status;
}

function runDatabase(taskId){
  const read=`import sqlite3,sys,json
c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True)
c.row_factory=sqlite3.Row
print(json.dumps([dict(r) for r in c.execute("SELECT r.run_id,r.binding_id,r.generation,r.state,r.pid,s.snapshot_json FROM capability_runs r LEFT JOIN agent_capability_sessions s ON s.capability_session_id=r.capability_session_id WHERE r.task_id=? ORDER BY r.started_at",(sys.argv[2],))]))
`;
  return JSON.parse(execFileSync('/usr/bin/python3',['-c',read,join(data,'smartdd.db'),taskId],{encoding:'utf8',timeout:4000}));
}

async function launch(kind,stage,profile){
  await click('.app-rail .rail-home');
  await click('[data-testid="sidebar-project"][data-project-id="'+project.id+'"] .reference-project-name');
  await app.waitFor("document.querySelector('[data-testid=home-cwd]')?.title==="+q(cwd),9000);
  const toggle=await selectProvider(profile.name,kind);
  const marker='A07_MANAGED_'+kind.toUpperCase()+'_'+stage;
  const row={kind,stage,marker,profileId:profile.id,toggle,expectedAppSource:'provider',observed:null};
  sent.set(marker,row);
  result.tasks.push(row);
  await click('[data-testid="home-input"]');
  await app.cdp('Input.insertText',{text:marker});
  await app.waitFor("document.querySelector('[data-testid=home-input]')?.value==="+q(marker),6000);
  await click('[data-testid="home-launch"]');
  const task=await until(async()=>(await app.invoke('agentTasks.list')).find(task=>task.title===marker&&task.projectId===project.id),'real home creation');
  row.taskId=task.taskId;
  assert.equal(task.selection.profileId,profile.id);
  assert.equal(task.selection.tier,'ask');
  const snap=await until(async()=>{
    const s=await app.invoke('agentTasks.snapshot',task.taskId);
    return s.turns?.at(-1)?.status==='completed'&&!s.run?.busy&&s.items.some(i=>i.type==='assistant_message'&&i.payload.text?.includes(marker+'_DONE'))&&s;
  },'native response from '+kind,26000);
  const native=runDatabase(task.taskId).find(run=>run.run_id===snap.turns.at(-1).run_id);
  assert(native?.binding_id&&Number.isInteger(native.pid));
  const selected=JSON.parse(native.snapshot_json).snapshot?.native;
  assert(selected?.stateRoot?.startsWith(join(data,'agents',kind)+ '/'),JSON.stringify({kind,nativeRoot:selected?.stateRoot}));
  assert(!selected.stateRoot.startsWith(home+'/'));
  row.native={runId:native.run_id,bindingId:native.binding_id,generation:native.generation,pid:native.pid,nativeRoot:selected.stateRoot};
  assert(row.observed?.hostTool,'WillYou managed business tool remains available');
  // Record any actual scope leak before proceeding to the other engine.
  if(row.observed.personal.length)row.failure='Personal extension advertised in managed native payload';
  await app.screenshot(join(out,marker+'.png'));
  return row;
}

try{
  const git=args=>execFileSync('/usr/bin/git',['-C',cwd,...args],{env:{...process.env,...env},encoding:'utf8',timeout:10000});
  git(['init','-qb','main']);
  git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-qm','A07 isolated project']);
  let inventory=inventoryFiles(home,1,realpathSync(process.execPath));
  phase='isolated signed App and renderer';
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3425,'127.0.0.1',()=>{serving=true;resolve();});});
  app=await openElectron({executable,userData:data,env,inspectMain:true,startupMainHook:async info=>{
    const hook=await redirectHome({...info,home});
    assert.equal(hook.workerInspectorFlagRemoved,true);
    result.startup.hook=hook;
  }});
  result.pid=app.processId;
  result.startup.app=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');
    return [process.pid,process.execPath,E.app.isPackaged,E.app.getPath('home'),E.app.getPath('userData'),process.env.HOME];})()`);
  assert.deepEqual(result.startup.app,[app.processId,executable,true,home,data,home]);
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await app.invoke('agents.refreshTools');
  if(kinds.includes('claude')){
    const path=process.env.M14_SMOKE_CLAUDE;
    assert.match(path,/\/versions\/2\.1\.326$/);
    const custom=await app.invoke('agents.customToolPath','claude',path);
    assert.equal(custom.tool?.version,'2.1.326');
    assert.equal(custom.tool?.customPath,path);
  }
  const available=await app.invoke('agents.tools');
  result.startup.native=available.filter(tool=>kinds.includes(tool.kind)).map(({kind,version,login,executable})=>({kind,version,login,executable}));
  const provider=await app.invoke('agents.saveProvider',{name:'A07 local managed fixture',preset:'magpie',
    endpoints:{responses:loopback+'/v1',anthropic:loopback+'/'},models:Object.values(models).map(id=>({id,name:id}))});
  const profiles={};
  for(const kind of kinds){
    const tool=available.find(tool=>tool.kind===kind&&tool.installed);
    assert(tool,'Actual native '+kind+' CLI must be installed');
    profiles[kind]=await app.invoke('agents.save',{name:'A07 managed '+kind,toolId:tool.id,source:'provider',providerId:provider.id,
      models:[models[kind]],defaultModel:models[kind],isDefault:kind===kinds[0]});
  }
  project=await app.invoke('projects.create',{name:'M14-A07 independent synthetic project',aliases:[],description:'',rulesPath:null},[{label:'work',path:cwd}]);
  await click('[data-testid="nav-settings"]');
  if(!await app.evaluate("document.querySelector('[data-testid=m14-toggle]')?.textContent.includes('已开启')"))await click('[data-testid="m14-toggle"]');
  await click('.app-rail .rail-home');
  const oldOrigin=await app.evaluate('performance.timeOrigin');
  await app.cdp('Page.reload');
  await app.waitFor('performance.timeOrigin!=='+oldOrigin+"&&Boolean(document.querySelector('[data-testid=nav-settings]'))",15000,{navigation:true});
  await app.arm();
  for(const stage of [1,2]){
    if(stage===2)inventory=inventoryFiles(home,2,realpathSync(process.execPath));
    phase='managed launches while personal configuration is revision '+stage;
    const observations=[];
    for(const kind of kinds)observations.push(await launch(kind,stage,profiles[kind]));
    const after=hashInventory(inventory.paths);
    const observationsRecord={stage,sourceBefore:inventory.hashes,sourceAfter:after,marker:inventory.mcp,
      hookExecuted:existsSync(inventory.hookHit),mcpStarted:existsSync(inventory.mcpHit),runs:observations.map(item=>item.native)};
    result.stages.push(observationsRecord);
    assert.deepEqual(after,inventory.hashes,'Only the test may mutate its source fixtures');
  }
  assert(!result.tasks.some(row=>row.failure),'One or more native managed launches exposed personal configuration');
  assert(result.stages.every(row=>!row.hookExecuted&&!row.mcpStarted),'Actual personal hook or MCP process ran');
  for(const kind of kinds){
    const pair=result.tasks.filter(task=>task.kind===kind);
    assert.equal(pair.length,2);
    assert.notEqual(pair[0].native.runId,pair[1].native.runId);
    assert.notEqual(pair[0].native.bindingId,pair[1].native.bindingId);
  }
  result.status='passed-managed-subset';
}catch(error){
  result.phase=phase;
  result.error=String(error.stack??error);
  if(app){
    result.dom=await app.evaluate('document.body.innerText.slice(-9000)').catch(()=>null);
    await app.screenshot(join(out,'failure.png')).catch(()=>{});
  }
}finally{
  if(app){
    const shutdown=await app.invoke('agentTasks.list').catch(()=>[]);
    const active=shutdown.filter(row=>['working','waiting'].includes(row.status));
    result.cleanupActive=active.map(row=>({taskId:row.taskId,status:row.status}));
    for(const task of active){
      if(result.tasks.some(row=>row.taskId===task.taskId||row.marker===task.title))await app.invoke('agentTasks.stop',task.taskId,true).catch(()=>{});
    }
    if(active.length)await until(async()=>!(await app.invoke('agentTasks.list')).some(row=>['working','waiting'].includes(row.status)),'only isolated work settled',6500).catch(()=>{});
    try{
      await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');
        if(process.pid!==${app.processId}||E.app.getPath('userData')!==${q(data)}||E.app.getPath('home')!==${q(home)})throw Error('Unexpected owner');
        setTimeout(()=>E.app.quit(),60);return true;})()`);
      result.exit=await app.waitForExit(22000);
    }catch(error){
      result.quitError=String(error);
      try{result.forcedExit=await app.crash();}catch(forceError){result.forceError=String(forceError);}
    }
    result.rendererErrors=app.rendererErrors;
    writeFileSync(join(out,'app.log'),app.logs(),{mode:0o600});
  }
  if(serving){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2),{mode:0o600});
  console.log(JSON.stringify({status:result.status,exit:result.exit,pid:result.pid,out}));
}
if(result.status!=='passed-managed-subset'||result.exit?.code!==0||result.exit.signal||result.rendererErrors?.length)process.exitCode=1;
