import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { openElectron, pause } from '../../prep-fef791bc6/electron-harness.mjs';
import { capability, marker, manifest } from './plugin/build.mjs';
import { latestUserText } from '../a32-recheck/protocol.mjs';
import { redirectHome } from '../../prep-fef791bc6/home-redirect-main.mjs';

const [out, scenarioId, sourceCommit] = process.argv.slice(2);
assert.match(out??'',/^\/private\/tmp\/willyou-m14-stage6\.WRvdST\/g03\/attempt-[0-9]+$/);
const executable = process.env.M14_ACCEPTANCE_APP;
assert(executable?.startsWith('/private/tmp/willyou-m14-stage6.'), 'Explicit private package required');
assert(existsSync(executable), 'Package executable missing');
assert.match(sourceCommit ?? '', /^[a-f0-9]{40}$/);

mkdirSync(out);
const root = realpathSync(mkdtempSync(join(out, 'runtime-')));
const home = join(root, 'home');
const userData = join(root, 'data');
for (const dir of [home, userData]) mkdirSync(dir);
const env = { npm_config_cache: join(root, 'npm-cache'), npm_config_offline:'true', npm_config_audit:'false',
  npm_config_fund:'false', npm_config_update_notifier:'false', HOME: home, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
  XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'), XDG_CACHE_HOME: join(home, '.cache'),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };


assert.equal(scenarioId,'local-business');
const base='/private/tmp/willyou-m14-stage6.WRvdST';
assert.equal(process.cwd(),join(base,'source'));
assert.equal(executable,join(base,'package/mac-arm64/WillYou.app/Contents/MacOS/WillYou'));
const asarSha=process.env.M14_EXPECTED_ASAR_SHA256;
assert.match(asarSha??'',/^[0-9a-f]{64}$/);
assert.equal(realpathSync(executable),executable);
assert.equal(readFileSync(join(base,'source-commit.txt'),'utf8').trim(),sourceCommit);
assert.equal(createHash('sha256').update(readFileSync(join(dirname(dirname(executable)),'Resources/app.asar'))).digest('hex'),asarSha);
const claudePath=process.env.M14_SMOKE_CLAUDE;
assert.match(claudePath??'',/^\/Users\/[^/]+\/\.local\/share\/claude\/versions\/2\.1\.326$/);
assert.equal(realpathSync(claudePath),claudePath);
const seedConfig=join(base,'g03/prep-next/a27-unknown-recheck/plugin/seed.vitest.config.mts');
const hookResult={};
const result={bootstrap:hookResult,sourceCommit,asarSha,executable,scenarioId,scope:'Packaged native loopback Agent, no-secret installed plugin, actual one-time UI approval and exact child App crash. No SMTP or external models.',observations:[],requests:[],actions:[],status:'failed'};
Object.assign(env,{NO_PROXY:'127.0.0.1,localhost',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',ENABLE_TOOL_SEARCH:'false'});
const toolShort='smartdd_p'+createHash('sha256').update(capability).digest('hex').slice(0,16)+'_v1';
const model='a27-isolated-plugin-model';
const firstPrompt='A27_APP_TEST_ONE_PLUGIN_WRITE';
const safePrompt='A27_RESTART_SAFE_TEXT_ONLY';
let releaseOriginal;
const originalProviderGate=new Promise(resolve=>{releaseOriginal=resolve;});
let releaseInitial;
const firstRequestGate=new Promise(resolve=>{releaseInitial=resolve;});
let requestedWrites=0, heldNative=false, freshTextSent=false, initialWaiting=false;
let app, trustedApp=false;
const port=3425;
function record(label,data={}) {
  result.observations.push({label,at:new Date().toISOString(),...data});
  console.log(JSON.stringify({stage:label,at:new Date().toISOString()}));
}
function appValue(reply) {
  if(reply?.ok!==true) throw Error('Synthetic project setup failed: '+JSON.stringify(reply?.error??reply));
  return reply.value;
}
function readSqlite(dbPath,sql,params=[]) {
  const source=[
    'import json,pathlib,sqlite3,sys',
    'c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro",uri=True)',
    'c.row_factory=sqlite3.Row',
    'print(json.dumps([dict(r) for r in c.execute(sys.argv[2],json.loads(sys.argv[3]))],ensure_ascii=False))',
  ].join('\n');
  return JSON.parse(execFileSync('/usr/bin/python3',['-c',source,dbPath,sql,JSON.stringify(params)],{encoding:'utf8',timeout:10000}));
}
function writeEvents(res, kind, model, answer, call) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, value) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
  if (kind === 'claude') {
    event('message_start', { message: { id: 'm' + randomUUID(), type: 'message', role: 'assistant', model,
      content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    event('content_block_start', { index: 0, content_block: call
      ? { type: 'tool_use', id: 'toolu_' + randomUUID(), name: call.tool.name, input: {} }
      : { type: 'text', text: '' } });
    event('content_block_delta', { index: 0, delta: call
      ? { type: 'input_json_delta', partial_json: JSON.stringify(call.args) }
      : { type: 'text_delta', text: answer } });
    event('content_block_stop', { index: 0 });
    event('message_delta', { delta: { stop_reason: call ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 1 } });
    event('message_stop', {});
  } else {
    const id = 'r' + randomUUID();
    const item = call ? { id: 'fc' + randomUUID(), type: 'function_call', call_id: 'call' + randomUUID(),
      name: call.tool.name, ...(call.tool.namespace ? { namespace: call.tool.namespace } : {}),
      arguments: JSON.stringify(call.args), status: 'completed' }
      : { id: 'm' + randomUUID(), type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: answer, annotations: [] }] };
    event('response.created', { response: { id, status: 'in_progress', output: [] } });
    event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress' } });
    if (!call) event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: answer });
    event('response.output_item.done', { output_index: 0, item });
    event('response.completed', { response: { id, status: 'completed', output: [item],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
  }
  res.end();
}

const server=createServer(async(req,res)=>{
  try {
    if(req.method==='GET'&&req.url?.endsWith('/models')){
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({data:[{id:model}]}));
      return;
    }
    if(req.method!=='POST'||!req.url?.includes('messages')){res.statusCode=404;res.end();return;}
    let size=0;const chunks=[];
    for await(const chunk of req){size+=chunk.length;assert(size<4*1024*1024);chunks.push(chunk);}
    const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(payload.model,model);
    const input=JSON.stringify(payload.messages??[]);
    const safe=latestUserText('claude',payload).includes(safePrompt);
    const row={at:Date.now(),safe,explicit:freshTextSent};
    result.requests.push(row);
    if(row.safe){
      if(!freshTextSent)result.unexpectedAutomaticDispatch=true;
      writeEvents(res,'claude',model,freshTextSent?'A27_SAFE_TEXT_SUCCEEDED':'A27_UNEXPECTED_AUTOMATIC_INPUT');
      return;
    }
    if(!requestedWrites) {
      assert(input.includes(firstPrompt));
      initialWaiting=true;
      await firstRequestGate;
      if(res.destroyed)return;
      const tool=(payload.tools??[]).find(item=>item.name?.endsWith('__'+toolShort));
      assert(tool,'Actual package write capability missing from the native tool list');
      requestedWrites++;
      row.tool=tool.name;
      writeEvents(res,'claude',model,null,{tool,args:{marker}});
      return;
    }
    heldNative=true;
    row.heldOriginal=true;
    await originalProviderGate;
    if(!res.destroyed)writeEvents(res,'claude',model,'A27_ORIGINAL_FIXTURE_DONE_WITHOUT_REPLAY');
  }catch(error){
    result.serverError=String(error.stack??error);
    if(!res.headersSent)res.writeHead(500);
    res.end();
  }
});
const snapshot = taskId => app.invoke('agentTasks.snapshot', taskId);
const relations = taskId => app.invoke('agentTasks.relations', taskId);
const answerPresent = (snap, answer) => snap.items.some(i => i.type === 'assistant_message' && i.payload.text?.includes(answer));
async function until(fn, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (result.serverError) throw Error(result.serverError);
    if (await fn()) return;
    await pause(100);
  }
  throw Error('Timed out: ' + label);
}
const selectorExpr = selector => `document.querySelector(${JSON.stringify(selector)})`;
async function click(selector, text = null) {
  const query = text ? `[...document.querySelectorAll(${JSON.stringify(selector)})].filter(item => item.innerText.includes(${JSON.stringify(text)}))`
    : `[...document.querySelectorAll(${JSON.stringify(selector)})]`;
  const hit = `(() => {
    const nodes = ${query};
    const node = nodes.length === 1 && nodes[0];
    if (!node || node.disabled) return null;
    node.scrollIntoView({block:'nearest',inline:'nearest'});
    const rect=node.getBoundingClientRect(), x=rect.x+rect.width/2, y=rect.y+rect.height/2;
    return rect.width&&rect.height&&node.contains(document.elementFromPoint(x,y))?{x,y}:null;
  })()`;
  await app.waitFor('Boolean('+hit+')',10000);
  const point=await app.evaluate(hit);
  assert(point, 'Expected visible unique control: ' + selector + ' ' + (text ?? ''));
  await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  for (const type of ['mousePressed', 'mouseReleased']) {
    await app.cdp('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
  }
  result.actions.push({ selector, text, ...point });
}
async function openLineage() {
  await app.waitFor(`Boolean(${selectorExpr('.agent-lineage-toggle')})`, 10000);
  if (!await app.evaluate('Boolean(document.querySelector(".agent-lineage"))')) await click('.agent-lineage-toggle');
  await app.waitFor('Boolean(document.querySelector(".agent-lineage"))', 10000);
}
async function verifyExactApp(handle) {
  const identity=await handle.mainEvaluate(`(() => {
    const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    return [E.app.isPackaged,E.app.getPath('userData'),E.app.getPath('home'),process.env.HOME,process.execPath,process.pid];
  })()`);
  assert.deepEqual(identity, [true, userData, home, home, executable, handle.processId]);
  assert.equal(realpathSync(executable),executable);
  assert(realpathSync(userData).startsWith('/private/tmp/willyou-m14-stage6.WRvdST/g03/attempt-'));
  return identity;
}

const helper=join(dirname(dirname(executable)),'Resources/native/willyou-process-identity');
const dbPath=join(userData,'smartdd.db');
const effectDirectory=join(userData,'plugin-data',manifest.id);
const effectFile=join(effectDirectory,'effect.json');
const flushedFile=join(effectDirectory,'effect-flushed.json');
const attemptsFile=join(effectDirectory,'attempts.jsonl');
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const scopeState=(pid,birth)=>{
  if(!Number.isSafeInteger(pid)||pid<2||!/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/.test(birth??'')) return 'unknown';
  const info=JSON.parse(execFileSync(helper,[String(pid)],{encoding:'utf8',timeout:2000,stdio:['ignore','pipe','ignore']}));
  if(info.state!=='running')return info.state;
  return info.pid===pid&&info.startedAt===birth?'running':'stopped';
};
const fileEffect=()=>JSON.parse(readFileSync(effectFile,'utf8'));
const attempted=()=>readFileSync(attemptsFile,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
function ledgers(operationId,requestId,runId){
  const fetch=(q,...p)=>readSqlite(dbPath,q,p);
  return {
    requests:fetch("SELECT request_id,operation_id,task_id,status,revision,json_extract(payload_ref,'$.phase') phase,origin_json FROM agent_requests WHERE request_id=?",requestId),
    invocations:fetch('SELECT operation_id,run_id,task_id,project_id,app_id,package_hash,state,effect_state,attempt_count,ended_at,error_code FROM application_invocations WHERE operation_id=?',operationId),
    runs:fetch('SELECT run_id,owner_pid,owner_started_at,pid,process_started_at,state,revocation_state FROM capability_runs WHERE run_id=?',runId),
    processes:fetch('SELECT kind,pid,process_started_at,state FROM capability_run_processes WHERE run_id=?',runId),
    pluginLeases:fetch('SELECT lease_id,pid,host_pid,kind,process_started_at,state FROM plugin_runtime_leases WHERE app_id=? ORDER BY created_at',manifest.id),
  };
}
async function openTask(id,title){
  const row='[data-testid="sidebar-agent-task"][data-task-id="'+id+'"]';
  await app.waitFor('Boolean('+selectorExpr(row)+')',20000,{navigation:true});
  await click(row);
  await app.waitFor('document.querySelector(".agent-task-head h1")?.textContent === '+JSON.stringify(title),10000);
}
async function submit(text){
  await app.waitFor('Boolean(document.querySelector(".agent-task-view textarea"))',10000);
  await click('.agent-task-view textarea');
  await app.cdp('Input.insertText',{text});
  assert.equal(await app.evaluate('document.querySelector(".agent-task-view textarea").value'),text);
  await click('.agent-task-view button[type="submit"]');
}
let phase='fixture plugin install and validation';
try {
  const work=join(root,'work');
  mkdirSync(work);
  const seedContext=join(root,'seed-context.json');
  const seedLog=join(out,'seed.log');
  writeFileSync(seedContext,JSON.stringify({root,executable,asarSha,commit:sourceCommit}),{mode:0o600,flag:'wx'});
  record('install the credential-free fixture through the real private plugin host');
  let seedText;
  try{
    seedText=execFileSync(process.execPath,[join(base,'source/scripts/run-tests.mjs'),'--config',seedConfig],{
      cwd:join(base,'source'),timeout:45000,maxBuffer:256*1024,encoding:'utf8',
      env:{PATH:process.env.PATH,M14_A27_SEED_CONTEXT:seedContext,TMPDIR:join(root,'data')},
    });
  }catch(error){
    writeFileSync(seedLog,String(error.stdout??'')+'\n'+String(error.stderr??''),{mode:0o600});
    throw Error('Production plugin seed failed. See seed.log');
  }
  writeFileSync(seedLog,seedText,{mode:0o600});
  const seed=JSON.parse(readFileSync(join(root,'seed-witness.json'),'utf8'));
  assert.equal(seed.commit,sourceCommit);
  assert.equal(seed.asarSha,asarSha);
  assert.equal(seed.capability,capability);
  const target={appId:manifest.id,packageHash:seed.installed.hash};
  result.seed=seed;
  assert(!existsSync(effectFile)&&!existsSync(attemptsFile));
  phase = 'native packaged startup';
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  app = await openElectron({ executable, userData, env, inspectMain: true, startupMainHook: async info => Object.assign(hookResult,await redirectHome({ ...info,home })) });
  result.pid = app.processId;
  result.identity=await verifyExactApp(app);
  trustedApp=true;
  await app.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await app.invoke('agents.refreshTools');
  if (process.env.M14_SMOKE_CLAUDE) {
    const custom = await app.invoke('agents.customToolPath','claude',process.env.M14_SMOKE_CLAUDE);
    assert(custom.tool?.installed && custom.tool.version === '2.1.326', 'Explicit verified Claude tool must be installed');
    assert.equal(custom.tool.customPath,process.env.M14_SMOKE_CLAUDE);
    result.explicitClaude = { version:custom.tool.version, path:custom.tool.customPath };
  }

  record('validated isolated App main process',{pid:app.processId});
  const tools=await app.invoke('agents.tools');
  const claude=tools.find(item=>item.kind==='claude'&&item.installed);
  assert.equal(claude?.version,'2.1.326');
  const provider=await app.invoke('agents.saveProvider',{name:'A27 strictly isolated Claude fixture',preset:'magpie',
    endpoints:{responses:'http://127.0.0.1:3425/v1',anthropic:'http://127.0.0.1:3425/'},models:[{id:model,name:model}]});
  const profile=await app.invoke('agents.save',{name:'A27 isolated native profile',toolId:claude.id,source:'provider',
    providerId:provider.id,models:[model],defaultModel:model,isDefault:true});
  const project=await app.invoke('projects.create',{name:'M14 A27 no-credential local recovery',aliases:[],description:'',rulesPath:null},[{label:'workspace',path:work}]);
  const all=appValue(await app.invoke('applications.pluginCatalog'));
  const loaded=all.find(p=>p.appId===target.appId);
  assert(loaded&&loaded.hash===target.packageHash&&loaded.installed&&loaded.enabled);
  const selection=appValue(await app.invoke('applications.pluginProjectSettings',target,project.id));
  assert.equal(selection.connectionId,null);
  assert.equal(selection.defaultConnectionId,null);
  assert.equal(selection.enabled,1);
  const title='A27 exact local effect and restart';
  const task=await app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,cwd:work,
    title,profileId:profile.id,model,tier:'ask'});
  result.taskId=task.taskId;
  const toggle='[data-testid="m14-toggle"]';
  await click('[data-testid="nav-settings"]');
  if(!await app.evaluate('Boolean('+selectorExpr(toggle)+')'))await click('.settings-nav button.nav-row','常规');
  if(!await app.evaluate(selectorExpr(toggle)+'?.innerText.includes("已开启")'))await click(toggle);
  await app.waitFor(selectorExpr(toggle)+'?.innerText.includes("已开启")',10000);
  await click('[data-testid="nav-home"]');
  await openTask(task.taskId,title);

  phase='native plugin write request and actual review';
  await submit(firstPrompt+' Invoke only the fixed private plugin operation with its exact marker.');
  await until(()=>initialWaiting,'original native input arrived before creating its request');
  const safeInput=safePrompt+' Respond with plain text only. Do not use any tools.';
  await submit(safeInput);
  const savedInput=()=>readSqlite(dbPath,"SELECT turn_id,run_id,native_turn_id,status,started_at FROM agent_turns WHERE task_id=? AND json_extract(input_ref,'$.text')=?",[task.taskId,safeInput])[0];
  await until(()=>savedInput()?.status==='accepted','second actual input is persisted without reaching the original round');
  const queued=savedInput();
  const originalInput=()=>readSqlite(dbPath,
    "SELECT turn_id,run_id,native_turn_id,status,error_code FROM agent_turns WHERE task_id=? AND source_kind='user' ORDER BY accepted_at LIMIT 1",
    [task.taskId])[0];
  assert.equal(queued.run_id,null);
  assert(!result.requests.some(row=>row.safe));
  result.queuedBeforeCrash=queued;
  releaseInitial();
  let request;
  await until(async()=>{
    request=(await snapshot(task.taskId)).requests.find(item=>item.class==='host_business'&&item.payload.businessKind==='application_write');
    return !!request&&heldNative;
  },'real native MCP write creates one host approval');
  const pendingText=await app.evaluate('document.querySelector(".agent-task-view")?.innerText ?? ""');
  assert(pendingText.includes('写入 A27 私有合成效果'));
  assert.equal(requestedWrites,1);
  assert(!existsSync(effectFile)&&!existsSync(attemptsFile)&&!existsSync(flushedFile));
  assert.equal(readSqlite(dbPath,'SELECT count(*) n FROM application_invocations WHERE app_id=?',[manifest.id])[0].n,0);
  await app.screenshot(join(out,'100-local-effect-waiting-approval.png'));
  record('pending approval has no plugin effect');
  await click('.agent-request [role="option"][aria-label="批准"]');
  await click('.agent-request .agent-confirm-choice');
  phase='flushed effect without worker reply';
  let capture;
  await until(()=>{
    if(!existsSync(flushedFile))return false;
    try{capture=JSON.parse(readFileSync(flushedFile,'utf8'));return !!capture.operationId;}catch{return false;}
  },'the exact plugin recorded successful file+directory fsync while withholding result',12000);
  const business=fileEffect();
  assert.deepEqual(capture,{operationId:business.operationId,runId:business.runId});
  assert.equal(business.projectId,project.id);
  assert.equal(business.marker,marker);
  assert.deepEqual(attempted(),[business]);
  const before=ledgers(business.operationId,request.requestId,business.runId);
  assert.equal(before.requests.length,1);
  assert.equal(before.requests[0].operation_id,business.operationId);
  assert.equal(before.requests[0].task_id,task.taskId);
  assert.equal(before.requests[0].phase,'executing');
  assert.equal(before.requests[0].status,'pending');
  assert.equal(before.invocations.length,1);
  const invocation=before.invocations[0];
  assert.equal(invocation.state,'running');
  assert.equal(invocation.effect_state,'unknown');
  assert.equal(invocation.run_id,business.runId);
  assert.equal(invocation.package_hash,target.packageHash);
  assert.equal(invocation.attempt_count,1);
  const owner=before.runs[0],parentTurn=originalInput();
  assert(parentTurn.native_turn_id&&parentTurn.run_id===business.runId&&parentTurn.status==='started');
  assert.equal(owner.owner_pid,app.processId);
  assert.equal(scopeState(owner.owner_pid,owner.owner_started_at),'running');
  assert.equal(scopeState(owner.pid,owner.process_started_at),'running');
  const worker=before.pluginLeases.find(item=>item.pid===business.pid&&item.kind==='invocation'&&item.state==='running');
  assert(worker&&worker.host_pid===app.processId);
  assert.equal(scopeState(worker.pid,worker.process_started_at),'running');
  const oldBridge=before.processes.filter(item=>item.kind==='bridge'&&item.state==='running'&&item.pid&&item.process_started_at);
  assert(oldBridge.length>0,'at least one exact owned running bridge must be witnessed');
  assert(oldBridge.every(item=>scopeState(item.pid,item.process_started_at)==='running'));
  const effectHash=hash(effectFile),attemptHash=hash(attemptsFile);
  result.beforeCrash={before,business,effectHash,attemptHash,parentTurn};
  record('two ledgers confirm an original executing write and one durable private side effect');
  await app.mainEvaluate('(() => {const E=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");const w=E.BrowserWindow.getAllWindows()[0];w.webContents.session.flushStorageData();return true;})()');
  const original=app;
  result.faultIdentity=await verifyExactApp(original);
  result.preCrashRendererErrors=[...original.rendererErrors];
  assert.equal(result.faultIdentity[5],owner.owner_pid);
  result.crashed=await original.crash();
  app=undefined;
  trustedApp=false;
  assert.deepEqual(result.crashed,{pid:owner.owner_pid,code:null,signal:'SIGKILL'});
  assert.equal(scopeState(owner.owner_pid,owner.owner_started_at),'stopped');

  phase='actual host restart, two ledgers, old owners and original request';
  const reboot={};
  app=await openElectron({executable,userData,env,inspectMain:true,startupMainHook:async info=>Object.assign(reboot,await redirectHome({...info,home}))});
  result.restart={bootstrap:reboot,identity:await verifyExactApp(app)};
  trustedApp=true;
  assert.notEqual(app.processId,owner.owner_pid);
  assert(await app.evaluate('localStorage.getItem("willyou-m14-agent-workspace")==="true"'),'real settings change must survive restart');
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await openTask(task.taskId,title);
  await until(async()=>{
    const current=await snapshot(task.taskId);
    return current.items.some(item=>item.type==='notification'&&item.payload.requestId===request.requestId&&item.payload.status==='unknown');
  },'same original host business operation displays unknown');
  const issueText=await app.evaluate('document.querySelector(".agent-timeline")?.innerText ?? ""');
  assert(issueText.includes('结果未知')&&issueText.includes('不会自动重放'));
  await until(()=>[owner,worker,...oldBridge].every(identity=>scopeState(identity.pid,identity.process_started_at)==='stopped'),
    'actual old native run, bridge and sandboxed plugin identities no longer running',20000);
  const after=ledgers(business.operationId,request.requestId,business.runId);
  result.restart.after=after;
  result.restart.originalTurn=originalInput();
  assert.equal(result.restart.originalTurn.turn_id,parentTurn.turn_id);
  assert.equal(result.restart.originalTurn.status,'unknown');
  assert.equal(result.restart.originalTurn.error_code,'HOST_RESTARTED');
  assert.equal(after.requests.length,1);
  assert.equal(after.requests[0].operation_id,business.operationId);
  assert.equal(after.requests[0].phase,'unknown');
  assert.equal(after.requests[0].status,'resolved');
  assert.equal(after.invocations.length,1);
  assert.equal(after.invocations[0].effect_state,'unknown');
  assert.equal(after.invocations[0].attempt_count,1);
  assert(!['succeeded','failed'].includes(after.invocations[0].state),'ambiguous external result cannot become an ordinary success or failure');
  const activity=appValue(await app.invoke('applications.activityDetail','operation',business.operationId));
  assert.equal(activity.item.effectState,'unknown');
  result.restart.activity={state:activity.item.state,effectState:activity.item.effectState,attemptCount:activity.item.attemptCount};
  if(activity.item.state==='running')result.restart.activityStillRunningAfterAllOriginalOwnersStopped=true;
  let staleRejected;
  try {await app.invoke('agentTasks.respond',task.taskId,request.requestId,request.revision,{choice:'allow'});}
  catch(error){staleRejected=String(error);}
  assert(staleRejected,'Retired request cannot be approved again');
  result.restart.staleRejected=staleRejected;
  await app.screenshot(join(out,'101-local-effect-unknown-after-restart.png'));
  assert.equal(hash(effectFile),effectHash);
  assert.equal(hash(attemptsFile),attemptHash);
  assert.deepEqual(attempted(),[business]);
  assert.equal(requestedWrites,1);
  phase='bounded no-input restart observation and real queued send';
  const observedSince=Date.now();
  for(;Date.now()-observedSince<3500;await pause(100)){
    assert.deepEqual(savedInput(),queued);
    assert(!result.requests.some(row=>row.safe));
    assert.equal(hash(effectFile),effectHash);
    assert.equal(hash(attemptsFile),attemptHash);
  }
  result.restart.noAutomaticDispatchObservedMs=Date.now()-observedSince;
  freshTextSent=true;
  releaseOriginal();
  await click('.agent-queue-entry button[title="立即发送"]');
  await until(async()=>{
    const current=await snapshot(task.taskId);
    return !current.run?.busy && current.items.some(item=>item.type==='assistant_message'&&item.payload.text?.includes('A27_SAFE_TEXT_SUCCEEDED'));
  },'new explicitly requested renderer round succeeds without any plugin dispatch');
  assert.equal(hash(effectFile),effectHash);
  assert.equal(hash(attemptsFile),attemptHash);
  assert.equal(requestedWrites,1);
  const ran=savedInput();
  assert.equal(ran.turn_id,queued.turn_id);
  assert.equal(ran.status,'completed');
  assert(ran.native_turn_id&&ran.run_id&&ran.run_id!==business.runId);
  assert(!result.unexpectedAutomaticDispatch);
  assert.equal(result.requests.filter(row=>row.safe&&row.explicit).length,1);
  result.restart.executedQueuedOriginal=ran;
  assert.equal(readSqlite(dbPath,'SELECT count(*) n FROM application_invocations WHERE app_id=?',[manifest.id])[0].n,1);
  result.restart.final={effectHash,attemptHash,writeRequests:requestedWrites,attempted:attempted().length};
  record('one private effect persists without replay through a fresh real native task round');
  assert.deepEqual(result.preCrashRendererErrors, []);
  assert.deepEqual(app.rendererErrors, []);
  result.status = 'passed';
} catch (error) {
  result.phase = phase;
  result.error = String(error.stack ?? error);
  if (error.electronStartupLogs) result.startupError = error.electronStartupLogs;
  if (app&&trustedApp) try {
    result.visible = await app.evaluate('document.body.innerText.slice(0,12000)');
    await app.screenshot(join(out, '99-failure.png'));
  } catch { /* target already exited */ }
} finally {
  releaseInitial();
  releaseOriginal();
  if(app&&!trustedApp){
    try{result.unverifiedProcessCleanup=await app.crash();}catch(error){result.cleanupError=String(error);}
    app=undefined;
  }
  if (app) {
    try {
      const tasks = await app.invoke('agentTasks.list');
      result.beforeQuit = tasks.map(({ taskId, title, status, parentTaskId }) => ({ taskId, title, status, parentTaskId }));
      result.beforeQuitRuns = await Promise.all(tasks.map(async task => {
        const current = await snapshot(task.taskId);
        return [task.title,current.run?.runId ?? null,current.run?.busy ?? false];
      }));
      writeFileSync(join(out,'before-quit.json'),JSON.stringify({ at:new Date().toISOString(), pid:app.processId, tasks:result.beforeQuit, runs:result.beforeQuitRuns },null,2));
      const activeRoots = tasks.filter(t => (t.status === 'working' || t.status === 'waiting') && !t.parentTaskId);
      if (activeRoots.length) {
        result.cleanupMadeIdle=[];
        for (const task of activeRoots) {
          await app.invoke('agentTasks.stop',task.taskId,true);
          result.cleanupMadeIdle.push(task.title);
        }
        const untilIdle = Date.now()+15000;
        while (Date.now()<untilIdle) {
          const remaining=(await app.invoke('agentTasks.list')).filter(t=>t.status==='working'||t.status==='waiting');
          if (!remaining.length) break;
          await pause(100);
        }
        result.tasksAfterCleanup=(await app.invoke('agentTasks.list')).map(({title,status})=>({title,status}));
      }
    } catch(error) { result.quitProbeError = String(error); }
    try {
      result.closeEvents=[];
      app.onCDP('Runtime.consoleAPICalled', event=>{
        const message=event.args?.[0]?.value;
        if (typeof message==='string' && message.startsWith('G03_CLOSE_EVENT ')) result.closeEvents.push(message);
      });
      await app.evaluate(`window.electronAPI.eventOn('files:close-request',request=>console.info('G03_CLOSE_EVENT '+request.action));true`);
    } catch(error) { result.closeEventObserverError=String(error); }
    try {
      await app.mainEvaluate(`(() => { const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
        if (E.app.getPath('userData')!==${JSON.stringify(userData)}) throw Error('Wrong App');
        setTimeout(() => E.app.quit(),50); return true; })()`);
    } catch (error) { result.quitRpcError = String(error); }
    try { result.exit = await app.waitForExit(20000); } catch (error) {
      result.exitError = String(error);
      try { result.forcedExit = await app.crash(); } catch (forcedError) { result.forceError = String(forcedError); }
    }

    result.rendererErrors = app.rendererErrors;
    if (result.status === 'passed' && result.cleanupMadeIdle?.length) {
      result.status = 'partial';
      result.cleanupRequired = true;
    }
    writeFileSync(join(out, 'app.log'), app.logs(), { mode: 0o600 });
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
}
if (result.status !== 'passed' || result.exit?.code !== 0 || result.exit.signal || result.rendererErrors?.length) process.exitCode = 1;
