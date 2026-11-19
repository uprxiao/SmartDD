import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { openElectron, pause } from '../../prep-fef791bc6/electron-harness.mjs';
import { redirectHome } from '../../prep-fef791bc6/home-redirect-main.mjs';
import { isM14PreEntryRun } from '../../prep-fef791bc6/electron-isolation-paths.mjs';
import { targetHit } from '../a59-native-late/pointer-guard.mjs';
import { factNames, makeTurns, model, prepareRequest, sha, supportedPaths } from './contract.mjs';

const root = '/private/tmp/willyou-m14-stage6.WRvdST';
const source = join(root,'source');
const executable = join(root,'package/mac-arm64/WillYou.app/Contents/MacOS/WillYou');
const expectedCommit = '9a6e95cdc1003c93f04555b58cd60d8300d2a25c';
const expectedAsar = 'ca01a1cc01b5a3ec5641e726101b1e09762a184f98243db7f0618a74f8fb14c9';
const attempt = process.argv[2];
assert.match(attempt ?? '', /^attempt-\d{3}$/);
assert.equal(process.argv.length,3);
const output = join(root,'g03',attempt);
assert.equal(process.env.M14_A15_LIVE_AUTHORIZED,'1', 'Explicit coordinator egress authorization is required; preflight is separate');
assert.equal(realpathSync(process.cwd()), source);
assert.equal(realpathSync(executable), executable);
assert.equal(execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),expectedCommit);
const asarFile = join(dirname(executable),'../Resources/app.asar');
assert.equal(sha(readFileSync(asarFile)),expectedAsar);
const boundaryToken = process.env.M14_A15_TEST_DEEPSEEK_TOKEN;
delete process.env.M14_A15_TEST_DEEPSEEK_TOKEN;
assert(boundaryToken && /^[\x21-\x7E]+$/.test(boundaryToken), 'Missing dedicated test transport token');
const identityHelper = realpathSync(join(dirname(executable),'../Resources/native/willyou-process-identity'));
assert.equal(identityHelper,join(root,'package/mac-arm64/WillYou.app/Contents/Resources/native/willyou-process-identity'));
mkdirSync(output,{mode:0o700});
const runtime = realpathSync(mkdtempSync(join(output,'runtime-')));
const home = join(runtime,'home'), data = join(runtime,'data'), work = join(runtime,'work');
for(const dir of [home,data,work]) mkdirSync(dir,{mode:0o700});
assert(isM14PreEntryRun(executable,data,home));
assert.equal(realpathSync(output),output);
writeFileSync(join(work,'README.md'),'# M14-A15 synthetic fixture\n');
const env = { HOME:home, SMARTDD_USER_DATA:data, CODEX_HOME:join(home,'.codex'),
  CLAUDE_CONFIG_DIR:join(home,'.claude'), XDG_CONFIG_HOME:join(home,'.config'),
  XDG_DATA_HOME:join(home,'.local/share'), XDG_CACHE_HOME:join(home,'.cache'), TMPDIR:runtime,
  GIT_CONFIG_GLOBAL:'/dev/null', GIT_CONFIG_NOSYSTEM:'1', GIT_TERMINAL_PROMPT:'0',
  npm_config_offline:'true',npm_config_audit:'false',npm_config_fund:'false',
  HTTP_PROXY:undefined,HTTPS_PROXY:undefined,ALL_PROXY:undefined,
  http_proxy:undefined,https_proxy:undefined,all_proxy:undefined };
for (const name of Object.keys(process.env))
  if (/(?:KEY|TOKEN|SECRET|PASSWORD|CRED)|ANTHROPIC|OPENAI|DEEPSEEK|CODEX|CLAUDE/i.test(name) &&
    !Object.hasOwn(env,name)) env[name] = undefined;

const values=Object.fromEntries(Object.keys(factNames).map(key => [key, 'A15FACT_' + randomBytes(12).toString('hex')]));
const phases=makeTurns(randomBytes(6).toString('hex'),values);
const transfersSeen = new Set(), peers = new Set();
const capture = { caseId:'M14-A15', sourceCommit:expectedCommit, asar:expectedAsar, executable, home, data, work,
  scope:'Real packaged App, actual native clients, synthetic facts, approved real DeepSeek; isolated response transport with precise negative control',
  startedAt:new Date().toISOString(), status:'failed', port:3425, fixtureFacts:values,
  requests:[], actions:[], turns:[], checks:[], timeline:[], bindings:[] };
for (const [name,file] of [
  ['entry',new URL(import.meta.url)],['contract',new URL('./contract.mjs',import.meta.url)],
  ['pointer',new URL('../a59-native-late/pointer-guard.mjs',import.meta.url)],
  ['harness',new URL('../../prep-fef791bc6/electron-harness.mjs',import.meta.url)],
  ['redirect',new URL('../../prep-fef791bc6/home-redirect-main.mjs',import.meta.url)],
  ['paths',new URL('../../prep-fef791bc6/electron-isolation-paths.mjs',import.meta.url)],
]) {
  const saved=join(output,'source-'+name+'.mjs');
  copyFileSync(file,saved);
  (capture.drivers ??= {})[name]=sha(readFileSync(saved));
}

let app, active, taskId, listening=false, beforeExitComplete=false;
let failingPhase='start isolated transport';
const fixtureResult = await execute();
process.exitCode = fixtureResult ? 0 : 2;

async function execute() {
  const server = createServer(handle);
  server.on('connection', socket => {
    peers.add(socket);
    socket.on('close',()=>peers.delete(socket));
  });
  try {
    await new Promise((resolve,reject) => {
      server.once('error',reject);
      server.listen(capture.port,'127.0.0.1',()=>{listening=true;resolve();});
    });
    capture.listenBound=server.address();
    failingPhase='launch isolated signed App';
    app=await openElectron({executable,env,userData:data,inspectMain:true,startupMainHook:async info=>{
      capture.redirect=await redirectHome({...info,home});
      assert(capture.redirect.workerInspectorFlagRemoved);
    }});
    capture.identity=await app.mainEvaluate('(() => { const { app }=process.getBuiltinModule("module").createRequire(process.execPath)("electron"); return [app.isPackaged,app.getPath("home"),app.getPath("userData"),process.execPath,process.pid]; })()');
    assert.deepEqual(capture.identity,[true,home,data,executable,app.processId]);
    capture.appBirth=readBirth(app.processId);
    await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await app.waitFor('!!document.querySelector("[data-testid=home-input]")',20000);

    failingPhase='provision fixture profiles and enable via settings';
    const profiles={};
    await app.invoke('agents.refreshTools');
    const tools=await app.invoke('agents.tools');
    const provider=await app.invoke('agents.saveProvider',{name:'A15 isolated DeepSeek transport',preset:'magpie',
      endpoints:{responses:'http://127.0.0.1:3425/v1',anthropic:'http://127.0.0.1:3425/'},models:[{id:model,name:model}]});
    capture.nativeTools=[];
    for(const kind of ['codex','claude']){
      const tool=tools.find(tool=>tool.kind===kind&&tool.installed);
      assert(tool,'Missing actual native CLI for '+kind);
      capture.nativeTools.push({kind,version:tool.version});
      profiles[kind]=await app.invoke('agents.save',{name:'A15 fixture '+kind,toolId:tool.id,source:'provider',
        providerId:provider.id,models:[model],defaultModel:model,isDefault:kind==='codex'});
    }
    await app.invoke('projects.create',{name:'A15 synthetic project',aliases:[],description:'fixture',rulesPath:null},[{label:'A15 fixture',path:work}]);
    await click('[data-testid="nav-settings"]');
    if (!await app.evaluate('!!document.querySelector("[data-testid=m14-toggle]")'))
      await click('.settings-nav button[aria-current="page"]');
    const enabled='document.querySelector("[data-testid=m14-toggle]")?.textContent.includes("已开启")';
    if(!await app.evaluate(enabled)) await click('[data-testid="m14-toggle"]');
    await app.waitFor(enabled,12000);
    await app.cdp('Page.reload');
    await app.waitFor('!!document.querySelector("[data-testid=home-input]") && !!document.querySelector(".agent-model-pill")',20000);
    assert.deepEqual(await app.invoke('agentTasks.list'),[]);
    await click('[data-testid="home-project"]');
    await click('[role="option"]','A15 synthetic project');
    await selectProfile('codex',false);
    await shot('00-fixture-home');
    const original=new Map();
    for(const [i,phase] of phases.entries()) {
      failingPhase=phase.name;
      if(i>0 && phase.actor!==phases[i-1].actor) await selectProfile(phase.actor,true);
      await type(i===0?'[data-testid="home-input"]':'.agent-task-view .agent-composer textarea',phase.instruction);
      active=phase;
      await click(i===0?'[data-testid="home-launch"]':'.agent-task-view .agent-composer button[type="submit"]');
      if(i===0) taskId=await until(async()=>{
        const rows=await app.invoke('agentTasks.list');
        assert(rows.length<=1,'More than one disposable task created');
        return rows[0]?.taskId;
      },'first durable task');
      assert.match(taskId,/^[a-f0-9-]{36}$/);
      capture.taskId=taskId;
      const expectedDriver=phase.actor==='codex'?'codex-app-server':'claude-sdk';
      const observed=await until(async()=>{
        const results=queryState();
        const current=results.turns.at(-1);
        if(results.turns.length!==i+1 || !current) return;
        assert(!['failed','interrupted','canceled','unknown'].includes(current.status),JSON.stringify(current));
        if(current.status==='completed') return results;
      },'exact new completed native '+phase.name,90000);
      const turn=observed.turns.at(-1);
      const requests=capture.requests.filter(r=>r.stage===phase.name);
      assert.equal(requests.length,1,'Expected one exact final reroutable request for fixture stage');
      const request=requests[0];
      assert.equal(request.upstreamStatus,200,'Genuine supplier success required');
      assert(turn.native_turn_id && turn.native_turn_id.length>0,'Completed native turn identity is missing');
      assert.equal(turn.driver_id,expectedDriver);
      assert(turn.generation>=1);
      assert(!observed.items.some(row=>row.turn_id===turn.turn_id&&['command_execution','tool_call','file_change'].includes(row.type)),
        'Synthetic memory fixture must not use side-effecting tools');
      assert(turn.run_id && turn.binding_id);
      const binding=observed.bindings.find(row=>row.binding_id===turn.binding_id);
      assert(binding?.native_id);
      assert.equal(binding.profile_id,profiles[phase.actor].id);
      if(original.has(phase.actor)) assert.deepEqual(binding,original.get(phase.actor),'Original persisted native binding must be reused');
      else original.set(phase.actor,binding);
      assert.equal(observed.bindings.length,original.size,'Unexpected native conversation created');
      const currentTransfer=observed.transfers.filter(row=>row.input_turn_id===turn.turn_id);
      assert.equal(currentTransfer.length,phase.transfer?1:0,'Wrong durable transfer count for exact current input turn');
      if(phase.transfer){
        const transfer=currentTransfer[0];
        assert.equal(transfer.kind,phase.transfer);
        assert.equal(transfer.target_binding_id,binding.binding_id);
        assert.equal(transfer.delivery_state,'accepted');
        assert.equal(transfer.transfer_id,request.newlyInjectedId);
        assert.equal(transfer.payload_hash,request.newHistoryCanonicalHash);
        const covered=JSON.parse(transfer.covered_ids_json).map(({itemId,revision})=>[itemId,revision]);
        assert.deepEqual(covered,request.sourceEntries.map(({itemId,revision})=>[itemId,revision]));
        const sourceUser=observed.items.find(row=>row.type==='user_message'&&row.idea===values[phase.newFact]);
        assert(sourceUser,'Expected historic synthetic fact must be visible in a prior user item');
        assert(covered.some(([id,revision])=>id===sourceUser.item_id&&revision===sourceUser.revision),'Historical fact source item must belong to the durable transfer coverage');
        if (phase.transfer==='incremental') {
          const oldCoverage=new Set(observed.transfers.filter(row=>row.target_binding_id===binding.binding_id&&row.transfer_id!==transfer.transfer_id)
            .flatMap(row=>JSON.parse(row.covered_ids_json).map(item=>item.itemId+'@'+item.revision)));
          const nativeTurnIds=new Set(observed.turns.slice(0,-1).filter(row=>row.binding_id===binding.binding_id).map(row=>row.turn_id));
          const coveredIds=new Set(covered.map(([id])=>id));
          assert(!covered.some(([id,revision])=>oldCoverage.has(id+'@'+revision)),'Incremental handoff resends previously accepted exact item revisions');
          assert(!observed.items.some(row=>coveredIds.has(row.item_id)&&nativeTurnIds.has(row.turn_id)),'Incremental handoff resends the target native history');
        }
        transfersSeen.add(transfer.transfer_id);
      }
      assert.equal(observed.transfers.length,transfersSeen.size,'Unexpected stale or pending transfer outside exact turn');
      assert.equal(observed.items.filter(item=>item.type==='assistant_message'&&item.turn_id===turn.turn_id).at(-1)?.answer?.trim(),phase.answer);
      const scope='.agent-turn[data-turn-id='+JSON.stringify(turn.turn_id)+']';
      await app.waitFor('Array.from(document.querySelectorAll('+JSON.stringify(scope+' .agent-assistant .agent-md')+')).at(-1)?.textContent.trim() === '+JSON.stringify(phase.answer),12000);
      const counts=await app.evaluate('(() => { const e=document.querySelector('+JSON.stringify(scope)+'); return { switchLines:[...document.querySelectorAll(".agent-task-view .agent-divider")].map(n=>n.textContent).filter(s=>s.includes("此处切换到")), handoffs:[...e.querySelectorAll("details.agent-notice summary")].map(n=>n.textContent).filter(s=>s.includes("已准备")) }; })()');
      const expectedSwitches=phases.slice(1,i+1).filter((row,index)=>row.actor!==phases[index].actor).map(row=>'此处切换到 A15 fixture '+row.actor);
      assert.deepEqual(counts.switchLines,expectedSwitches);
      assert.deepEqual(observed.items.filter(row=>row.type==='provider_switch').map(row=>'此处切换到 '+row.targetName),expectedSwitches);
      assert.deepEqual(counts.handoffs,phase.transfer?[phase.transfer==='full'?'已准备全量交接':'已准备增量交接']:[]);
      if(phase.transfer){
        await click(scope+' details.agent-notice > summary',counts.handoffs[0]);
        await app.waitFor('!!document.querySelector('+JSON.stringify(scope+' details.agent-notice[open] pre')+')?.textContent.includes("以下均为历史")',12000);
      }
      capture.timeline.push({name:phase.name,...counts});
      capture.turns.push({stage:phase.name, binding, turn, exactAnswer:phase.answer, transfer:currentTransfer[0]??null});
      await shot(String(i+1).padStart(2,'0')+'-'+phase.name);
      active=undefined;
    }
    capture.bindings=[...original];
    assert.notEqual(original.get('codex').native_id,original.get('claude').native_id);
    assert.deepEqual(app.rendererErrors,[]);
    assert(!capture.transportError);
    beforeExitComplete=true;
  } catch (error) {
    capture.failure={phase:failingPhase,error:String(error?.stack??error).replaceAll(boundaryToken,'[redacted]')};
    if(app) try{await shot('99-last-view');}catch{}
  } finally {
    active=undefined;
    if(app) await quitOwnApp();
    if(beforeExitComplete && capture.exit?.code===0 && !capture.cleanupError){
      try { recordExitedRuns(); } catch(error) { capture.exitEvidenceError=String(error); }
    }
    if(listening){
      server.closeAllConnections();
      await new Promise(resolve=>server.close(resolve));
    }
    await new Promise(setImmediate);
    capture.listenerClosed=!server.listening;
    capture.socketsRemaining=[...peers].filter(socket=>!socket.destroyed).length;
    if (beforeExitComplete && capture.exit?.code===0 && capture.exit?.signal===null &&
      capture.listenerClosed && capture.socketsRemaining===0 && !capture.cleanupError && !capture.transportError && !capture.exitEvidenceError) capture.status='passed';
    capture.finishedAt=new Date().toISOString();
    writeFileSync(join(output,'result.json'),JSON.stringify(capture,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify({status:capture.status,turns:capture.turns.length,scope:capture.failure?.phase,
      appPid:capture.appBirth?.pid??app?.processId,exit:capture.exit,listenerClosed:capture.listenerClosed}));
  }
  return capture.status==='passed';
}

async function handle(req,res) {
  try {
    assert.equal(req.socket.remoteAddress,'127.0.0.1');
    const parsed = new URL(req.url,'http://127.0.0.1:3425');
    assert.equal(parsed.origin,'http://127.0.0.1:3425');
    assert(!parsed.search || (parsed.pathname==='/v1/messages'&&parsed.search==='?beta=true'));
    const path=parsed.pathname;
    if(req.method==='GET'&&['/models','/v1/models'].includes(path)){
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({data:[{id:model}]}));
      return;
    }
    if(req.method!=='POST'||!Object.hasOwn(supportedPaths,path)){
      res.writeHead(404).end();
      return;
    }
    const endpoint=supportedPaths[path];
    const token='magpie-'+(endpoint.protocol==='anthropic'?'claude':'codex');
    assert([req.headers.authorization,req.headers['x-api-key']].some(key=>key===token||key==='Bearer '+token),
      'Expected only the exact disposable public provider identity');
    const chunks=[];
    let bytes=0;
    for await(const chunk of req){
      bytes+=chunk.length;
      assert(bytes<=768*1024,'Unexpected large provider payload');
      chunks.push(chunk);
    }
    const body=JSON.parse(Buffer.concat(chunks).toString());
    const {outbound,audit}=prepareRequest({body,protocol:endpoint.protocol,active,phases,values,previousIds:transfersSeen});
    capture.requests.push({...audit,path,receivedAt:new Date().toISOString(),upstreamStatus:null});
    const request=capture.requests.at(-1);
    const headers={'content-type':'application/json',authorization:'Bearer '+boundaryToken};
    if(endpoint.protocol==='anthropic'){
      headers['anthropic-version']=req.headers['anthropic-version']??'2023-06-01';
      if(req.headers['anthropic-beta'])headers['anthropic-beta']=req.headers['anthropic-beta'];
    }
    const response=await fetch(endpoint.upstream,{method:'POST',redirect:'error',headers,
      body:JSON.stringify(outbound),signal:AbortSignal.timeout(75000)});
    request.upstreamStatus=response.status;
    request.upstreamContentType=response.headers.get('content-type');
    res.writeHead(response.status, {'content-type':request.upstreamContentType??'application/json'});
    if(response.body) await pipeline(Readable.fromWeb(response.body),res);
    else res.end();
  } catch (error) {
    capture.transportError={name:error?.constructor?.name??'Error', message:String(error.message).replaceAll(boundaryToken,'[redacted]')};
    if(!res.headersSent)res.writeHead(500,{'content-type':'text/plain'});
    res.end('Isolated fixture refused provider request');
  }
}

function queryState(){
  const db=new DatabaseSync(join(data,'smartdd.db'),{readOnly:true});
  try {
    return {
      turns: db.prepare("SELECT t.turn_id,t.status,t.native_turn_id,t.run_id,r.binding_id,r.generation,b.driver_id FROM agent_turns t LEFT JOIN capability_runs r ON r.run_id=t.run_id LEFT JOIN agent_bindings b ON b.binding_id=r.binding_id WHERE t.task_id=? AND t.source_kind='user' ORDER BY t.accepted_at,t.rowid").all(taskId),
      bindings: db.prepare('SELECT native_id,binding_id,driver_id,profile_id FROM agent_bindings WHERE task_id=? ORDER BY driver_id').all(taskId),
      transfers: db.prepare("SELECT f.transfer_id,f.kind,f.delivery_state,f.target_binding_id,f.covered_ids_json,f.payload_hash,JSON_EXTRACT(i.payload_ref,'$.inputTurnId') input_turn_id FROM agent_transfers f JOIN agent_items i ON i.task_id=f.task_id AND i.native_key=('transfer:'||f.transfer_id) WHERE f.task_id=? ORDER BY f.created_at,f.rowid").all(taskId),
      items: db.prepare("SELECT item_id,turn_id,type,ordinal,revision,JSON_EXTRACT(payload_ref,'$.text') answer,JSON_EXTRACT(payload_ref,'$.toName') targetName FROM agent_items WHERE task_id=? ORDER BY ordinal").all(taskId).map(item=>{
        const idea=Object.values(values).find(value=>item.answer?.includes(' is '+value+'.'));
        return {...item,idea};
      }),
    };
  } finally { db.close(); }
}

function recordExitedRuns(){
  const db=new DatabaseSync(join(data,'smartdd.db'),{readOnly:true});
  try {
    const rows = db.prepare("SELECT run_id,binding_id,generation,owner_pid,owner_started_at,state FROM capability_runs WHERE task_id=? AND binding_id IS NOT NULL ORDER BY started_at").all(taskId);
    const processRows=db.prepare('SELECT kind,pid,process_started_at,state FROM capability_run_processes WHERE run_id=? ORDER BY kind');
    assert(rows.length>=2,'Native ownership for both sides is required');
    capture.exitedRuns=rows.map(run=>{
      assert.equal(run.owner_pid,app.processId);
      assert.equal(run.state,'stopped');
      const records=processRows.all(run.run_id);
      assert(records.some(row=>row.kind==='cli'),'Native CLI process birth is missing');
      return {...run,processes:records.map(row=>{
        assert(row.pid&&row.process_started_at&&row.state==='exited');
        const observed=readBirth(row.pid);
        assert(observed.state==='stopped'||(observed.state==='running'&&observed.startedAt!==row.process_started_at));
        return {...row,observed};
      })};
    });
  } finally { db.close(); }
}

async function click(selector,label=null){
  const expression='('+targetHit.toString()+')('+JSON.stringify(selector)+','+JSON.stringify(label)+')';
  const point=await until(async()=>{
    const hit=await app.evaluate(expression);
    return hit.reason==='ready'&&hit;
  },'unique unobstructed control '+selector+' '+String(label),12000);
  for(const type of ['mousePressed','mouseReleased'])
    await app.cdp('Input.dispatchMouseEvent',{type,x:point.x,y:point.y,button:'left',clickCount:1});
  capture.actions.push({selector,label,x:point.x,y:point.y});
}

async function type(selector,value){
  await click(selector);
  const target='document.querySelector('+JSON.stringify(selector)+')';
  assert(await app.evaluate('document.activeElement === '+target));
  await app.cdp('Input.insertText',{text:value});
  await app.waitFor(target+'?.value === '+JSON.stringify(value),8000);
}

async function selectProfile(actor,activeTask){
  const pill=(activeTask?'.agent-task-view ':'')+'.agent-model-pill';
  await click(pill);
  await click('.agent-picker-rail button[aria-label='+JSON.stringify('A15 fixture '+actor)+']');
  await click('.agent-model-row[aria-label='+JSON.stringify(model)+']');
  await app.waitFor('document.querySelector('+JSON.stringify(pill)+')?.textContent.includes('+JSON.stringify('A15 fixture '+actor)+')',14000);
}

function readBirth(pid){
  return JSON.parse(execFileSync(identityHelper,[String(pid)],{encoding:'utf8',timeout:3000}));
}

async function quitOwnApp(){
  let attempted=false;
  try {
    capture.beforeExitTasks=await app.invoke('agentTasks.list').catch(()=>[]);
    await app.mainEvaluate('(() => { const {app}=process.getBuiltinModule("module").createRequire(process.execPath)("electron"); if(process.pid!=='+app.processId+' || app.getPath("userData")!=='+JSON.stringify(data)+')throw Error("Refusing foreign App");setTimeout(()=>app.quit(),100);return true;})()');
    attempted=true;
  } catch(error){
    capture.quitRequestError=String(error);
  }
  try {
    capture.exit=await app.waitForExit(26000);
    assert.deepEqual([capture.exit.code,capture.exit.signal],[0,null]);
    assert(attempted,'Normal quit request was not confirmed');
    capture.rendererErrors=app.rendererErrors;
  } catch(error){
    capture.cleanupError=String(error);
    try{capture.fallback=await app.crash();}catch(fallbackError){capture.fallbackError=String(fallbackError);}
  }
}

async function until(probe,description,timeout=20000){
  const deadline=Date.now()+timeout;
  do{
    if(capture.transportError)throw Error(capture.transportError.message);
    const value=await probe();
    if(value)return value;
    await pause(100);
  }while(Date.now()<deadline);
  throw Error('Timed out waiting for '+description);
}

async function shot(name){
  const {data:image}=await app.cdp('Page.captureScreenshot',{format:'png'});
  writeFileSync(join(output,name+'.png'),Buffer.from(image,'base64'),{mode:0o600});
}

