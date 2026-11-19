import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { openElectron,pause } from '../../g03/prep-fef791bc6/electron-harness.mjs';
import { redirectHome } from '../../g03/prep-fef791bc6/home-redirect-main.mjs';
import { isM14PreEntryRun } from '../../g03/prep-fef791bc6/electron-isolation-paths.mjs';
import {bindOwnerObserver} from './native-observer.mjs';
import {canaryName,createProvider,draftBody,markers,model,subject} from './provider.mjs';
import {assertRetainedStoppedTool} from '../a60-closure/stopped-tool-proof.mjs';

const base='/private/tmp/willyou-m14-stage6.WRvdST';
const [out,commit,asar,mode]=process.argv.slice(2);
const bundle=join(base,'package/mac-arm64/WillYou.app/Contents'),executable=join(bundle,'MacOS/WillYou'),reader=join(bundle,'Resources/native/willyou-process-identity');
const digest=filename=>createHash('sha256').update(readFileSync(filename)).digest('hex');
assert.match(out??'',/^\/private\/tmp\/willyou-m14-stage6\.WRvdST\/g04\/attempt-[0-9]{3}$/);
assert.match(commit??'',/^[a-f0-9]{40}$/);
assert.match(asar??'',/^[a-f0-9]{64}$/);
assert.equal(realpathSync(process.cwd()),join(base,'source'));
assert.equal(execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),commit);
assert.equal(realpathSync(executable),executable);
assert.equal(digest(join(bundle,'Resources/app.asar')),asar);
for(const key of Object.keys(process.env))if(/^(ANTHROPIC|CLAUDE_CODE_OAUTH|OPENAI|DEEPSEEK|CODEX_API_KEY)/i.test(key))assert(!process.env[key]);
assert(['native-exit','failed-foreground','completed-foreground'].includes(mode));
mkdirSync(out,{mode:0o700});
const root=realpathSync(mkdtempSync(join(out,'runtime-'))),home=join(root,'home'),data=join(root,'data');
mkdirSync(home,{mode:0o700});mkdirSync(data,{mode:0o700});
assert(isM14PreEntryRun(executable,data,home));
const env={HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),TMPDIR:root,
  XDG_CONFIG_HOME:join(home,'.config'),XDG_DATA_HOME:join(home,'.local/share'),XDG_CACHE_HOME:join(home,'.cache'),
  GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',ENABLE_TOOL_SEARCH:'false',
  NO_PROXY:'127.0.0.1,localhost',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',
  COREPACK_ENABLE_NETWORK:'0',YARN_ENABLE_NETWORK:'0',npm_config_offline:'true',npm_config_update_notifier:'false'};
const origin='http://127.0.0.1:3425';
const result={caseId:'M14-A60',sourceCommit:commit,asar,mode,actions:[],requests:[],passed:false};
let app,task,owner,appTrusted=false,listening=false,phase='fixture setup';
const fixtureState={cwd:join(root,'fixture-project')};
const provider=createProvider(mode,result,fixtureState);
const server=createServer(provider.handle);
for(const file of ['scenario.mjs','native-observer.mjs','provider.mjs'])
  copyFileSync(new URL(file,import.meta.url),join(out,'source-'+file));
const selected=selector=>'document.querySelector('+JSON.stringify(selector)+')';
const state=id=>app.invoke('agentTasks.snapshot',id);
const nativeIdentity=pid=>JSON.parse(execFileSync(reader,[String(pid)],{encoding:'utf8',timeout:3000}));

async function until(fn,label,timeout=35000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    if(result.serverError)throw Error(result.serverError);
    const value=await fn();if(value)return value;
    await pause(95);
  }
  throw Error('Timed out: '+label);
}
async function click(selector,text=null){
  const list=`[...document.querySelectorAll(${JSON.stringify(selector)})]`;
  const wanted=text===null?list:`${list}.filter(node=>node.innerText.includes(${JSON.stringify(text)}))`;
  const hit=`(() => {const nodes=${wanted},node=nodes.length===1&&nodes[0];if(!node||node.disabled)return null;
    node.scrollIntoView({block:'nearest',inline:'nearest'});const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    return r.width&&r.height&&node.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`;
  await app.waitFor('Boolean('+hit+')',11000);
  const point=await app.evaluate(hit);assert(point);
  await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
  result.actions.push({selector,text,...point});
}
async function open(task){
  const row=`[data-testid="sidebar-agent-task"][data-task-id="${task.taskId}"]`;
  await app.waitFor('Boolean('+selected(row)+')',18000,{navigation:true});
  await click(row);
  await app.waitFor(selected('.agent-task-head h1')+'?.textContent==='+JSON.stringify(task.title),15000);
}
async function send(text){
  const editor='.agent-composer textarea';
  await click(editor);
  await app.cdp('Input.insertText',{text});
  assert.equal(await app.evaluate(selected(editor)+'?.value'),text);
  await click('.agent-composer button[type="submit"]');
}
function sql(query,args=[],cold=false){
  const db=join(data,'smartdd.db');assert.equal(realpathSync(db),db);
  if(cold)assert.equal(existsSync(db+'-wal'),false,'Cold sqlite cannot ignore committed WAL data');
  const py='import sqlite3,json,pathlib,sys;c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro"+("&immutable=1" if sys.argv[4]=="true" else ""),uri=True);c.row_factory=sqlite3.Row;print(json.dumps([dict(r) for r in c.execute(sys.argv[2],json.loads(sys.argv[3]))]))';
  return JSON.parse(execFileSync('/usr/bin/python3',['-c',py,db,query,JSON.stringify(args),String(cold)],{encoding:'utf8',timeout:10000}));
}


function run(runId){
  return sql('SELECT run_id,owner_pid,owner_started_at,pid,process_started_at,task_id,binding_id,generation,state,error_code,ended_at FROM capability_runs WHERE run_id=?',[runId])[0];
}
const tab=value=>JSON.stringify(value);
const observed=()=>app.mainEvaluate('globalThis.__a60ExactOwner?.snapshot()');
const findDraft=(snap,id)=>snap.requests.find(r=>r.class==='host_business'&&r.requestId===id);
const hasAnswer=(snap,text)=>snap.items.some(i=>i.type==='assistant_message'&&i.payload.text===text);
const originalTurn=snap=>snap.turns.findLast(row=>row.source_kind==='user');
const openStates=['accepted','dispatching','started'];

async function exactItem(snap,turnId,marker,id){
  const choices=snap.items.filter(i=>i.turnId===turnId&&i.type==='command_execution'&&
    (id ? i.itemId===id : i.payload.command?.includes(marker)));
  if(!choices.length)return null;
  assert.equal(choices.length,1);
  const [item]=choices;
  const data=await app.invoke('agentTasks.itemBody',task.taskId,item.itemId,0,item.revision);
  assert(data.done&&data.revision===item.revision&&data.next===data.totalBytes&&Buffer.byteLength(data.chunk)===data.totalBytes);
  return {itemId:item.itemId,turnId,itemType:item.type,type:item.type,revision:item.revision,terminal:item.terminal,
    body:data.chunk,bodySha256:createHash('sha256').update(data.chunk).digest('hex')};
}
async function workVisibility(turnId,marker){
  const scope='.agent-task-view .agent-turn[data-turn-id='+tab(turnId)+']';
  const snapshot=()=>app.evaluate(`(() => {
    const turn=${selected(scope)};
    if(!turn)return null;
    const needle=${tab(marker)};
    const rows=[...turn.querySelectorAll('.agent-work-row > summary')]
      .filter(node=>node.getBoundingClientRect().width>0&&node.innerText.includes(needle))
      .map(node=>({text:node.innerText,unconfirmed:node.parentElement.classList.contains('unconfirmed'),running:node.parentElement.classList.contains('running')}));
    return {rows,head:!!turn.querySelector('.agent-work-head[aria-expanded="false"]'),
      foldedTools:!!turn.querySelector('.agent-work-group:not([open])')};
  })()`);
  let value=await until(snapshot,'exact terminal timeline group visible');
  if(!value.rows.length&&value.head){
    await click(scope+' .agent-work-head[aria-expanded="false"]');
    value=await snapshot();
  }
  if(!value.rows.length&&value.foldedTools){
    await click(scope+' .agent-work-group:not([open]) > summary');
  }
  value=await until(async()=>{const read=await snapshot();return read?.rows.length&&read;},'original terminal tool row visible',6500);
  const rows=value.rows.filter(row=>row.unconfirmed);
  assert.equal(rows.length,1);
  assert.equal(rows[0].running,false);
  assert.match(rows[0].text,/^未收到工具结果(?: · |$)/);
  return value;
}
async function configure(){
  mkdirSync(fixtureState.cwd,{mode:0o700});
  const cwd=fixtureState.cwd;
  execFileSync('/usr/bin/git',['-C',cwd,'init','-qb','main'],{env:{...process.env,...env}});
  execFileSync('/usr/bin/git',['-C',cwd,'-c','user.name=Fixture','-c','user.email=a60@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-qm','baseline'],{env:{...process.env,...env}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3425,'127.0.0.1',()=>{listening=true;resolve();});});
  const boot={};
  app=await openElectron({executable,userData:data,env,inspectMain:true,
    startupMainHook:async info=>Object.assign(boot,await redirectHome({...info,home}))});
  const identity=await app.mainEvaluate('(() => {const E=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");return [E.app.isPackaged,E.app.getPath("userData"),E.app.getPath("home"),process.execPath,process.pid]})()');
  assert.deepEqual(identity,[true,data,home,executable,app.processId]);
  assert(boot.workerInspectorFlagRemoved);
  owner=nativeIdentity(app.processId);
  assert(owner.state==='running'&&owner.startedAt);
  result.app={identity,owner,boot};
  appTrusted=true;
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await app.invoke('agents.refreshTools');
  const codex=(await app.invoke('agents.tools')).find(tool=>tool.kind==='codex'&&tool.installed&&tool.version==='0.169.0');
  assert(codex);
  const vendor=await app.invoke('agents.saveProvider',{name:'A60 synthetic loopback',preset:'magpie',
    endpoints:{responses:origin+'/v1'},models:[{id:model,name:model}]});
  const profile=await app.invoke('agents.save',{name:'A60 native excursion',toolId:codex.id,source:'provider',
    providerId:vendor.id,models:[model],defaultModel:model,isDefault:true});
  const project=await app.invoke('projects.create',{name:'A60 terminal isolated project',aliases:[],description:'',rulesPath:null},[{label:'work',path:cwd}]);
  const title='A60 terminal matrix '+mode;
  const created=await app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,cwd,title,
    profileId:profile.id,model,tier:'ask'});
  task={taskId:created.taskId,title,projectId:project.id};
  await click('[data-testid="nav-settings"]');
  const toggle='[data-testid="m14-toggle"]';
  if(!await app.evaluate('Boolean('+selected(toggle)+')'))await click('.settings-nav button.nav-row','常规');
  if(!await app.evaluate(selected(toggle)+'?.innerText.includes("已开启")'))await click(toggle);
  await app.waitFor(selected(toggle)+'?.innerText.includes("已开启")',14000);
  await click('[data-testid="nav-home"]');
  await open(task);
  const drafts=async()=>{
    const list=await app.invoke('applications.drafts',task.projectId);
    assert(list.ok);return list.value.items;
  };
  return {cwd,drafts};
}
async function bind(warmRun){
  const info=run(warmRun.runId);
  assert.equal(info?.state,'active');
  assert.equal(info.owner_pid,app.processId);
  assert.equal(info.owner_started_at,owner.startedAt);
  assert.equal(info.task_id,task.taskId);
  const before=nativeIdentity(info.pid);
  assert.equal(before.state,'running');
  assert.equal(before.startedAt,info.process_started_at);
  const tap=await app.mainEvaluate(`(() => {
    const load=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');
    const {app}=load('electron'),{execFileSync}=load('node:child_process'),{createHash}=load('node:crypto');
    if(!app.isPackaged||process.pid!==${app.processId}||process.execPath!==${tab(executable)}||
        app.getPath('home')!==${tab(home)}||app.getPath('userData')!==${tab(data)})throw Error('Unexpected host identity');
    const handles=process._getActiveHandles().filter(child=>child.constructor?.name==='ChildProcess'&&
      child.spawnargs?.[1]==='app-server'&&child.pid===${info.pid}&&child.stdout);
    if(handles.length!==1||globalThis.__a60ExactOwner)throw Error('Expected one bound native transport');
    const readIdentity=pid=>JSON.parse(execFileSync(${tab(reader)},[String(pid)],{encoding:'utf8',timeout:3000}));
    const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
    globalThis.__a60ExactOwner=(${bindOwnerObserver.toString()})(handles[0],{mode:${tab(mode)},exactPid:${info.pid},
      startedAt:${tab(before.startedAt)},readIdentity,hash});
    return globalThis.__a60ExactOwner.snapshot();
  })()`);
  assert.equal(tap.pid,info.pid);
  result.boundNative={row:info,kernel:before};
  return info;
}
async function verifyPendingUI(marker){
  const panel='.agent-request';
  let text=await app.evaluate(selected(panel)+'?.innerText ?? ""');
  for(let index=0;index<2&&!text.includes(marker);index++){
    await click(panel+' .agent-request-nav button','›');
    text=await app.evaluate(selected(panel)+'?.innerText ?? ""');
  }
  await app.waitFor('('+selected(panel)+'?.innerText ?? "").includes('+tab(marker)+')',6500);
  return app.evaluate(selected(panel)+'?.innerText ?? ""');
}
async function staleReject(pending){
  const options=await app.evaluate("[...document.querySelectorAll('.agent-request-options button:not(:disabled)')].map(button=>button.getAttribute('aria-label'))");
  const decision=options.includes('批准一次')?{decision:'accept'}:options.includes('拒绝')?{decision:'decline'}:null;
  assert(decision,'Must only replay a response the original native UI offered');
  return async phase=>{
    let error;
    try{await app.invoke('agentTasks.respond',task.taskId,pending.requestId,pending.revision,decision);}
    catch(caught){error=String(caught);}
    assert.match(error??'',/请求已结束/);
    return {phase,requestId:pending.requestId,revision:pending.revision,decision,error};
  };
}

async function execute({cwd,drafts}){
  phase='real native healthy warmup and exact original ChildProcess';
  await send(markers.warm);
  const warm=await until(async()=>{const snap=await state(task.taskId);return !snap.run?.busy&&hasAnswer(snap,markers.warm+'_DONE')&&snap;},'warm actual native loopback round');
  const old=await bind(warm.run);
  assert.deepEqual(await drafts(),[]);
  await send(markers.exercise);
  phase='actual draft MCP awaiting_user on the original turn';
  const pre=await until(async()=>{
    const snap=await state(task.taskId),receipt=fixtureState.receipt;
    const draft=receipt&&findDraft(snap,receipt.requestId),turn=originalTurn(snap);
    return draft&&turn?.status==='started'&&snap.run?.busy&&{draft,turn,seq:snap.seq};
  },'real native MCP receipt matches preserved pending host request');
  assert.equal(pre.draft.payload.phase,'waiting_user');
  assert.equal(pre.draft.payload.businessKind,'application_write');
  assert.equal(pre.draft.payload.review.input.content.text,draftBody);
  assert.equal(pre.draft.origin.runId,old.run_id);
  assert.equal(pre.draft.origin.bindingId,old.binding_id);
  assert.equal(pre.turn.run_id,old.run_id);
  assert.equal(pre.draft.origin.generation,old.generation);
  result.original=pre;
  const isExit=mode==='native-exit';
  if(!isExit){
    const target={itemId:fixtureState.commandCall,turnId:pre.turn.native_turn_id};
    assert.equal(await app.mainEvaluate('globalThis.__a60ExactOwner.arm('+tab(target)+')'),true);
  }
  provider.commandGate.release();
  phase='same original run has one real foreground tool still in host timeline';
  const commandMarker=isExit?canaryName:'pwd';
  const inFlight=await until(async()=>{
    const snap=await state(task.taskId),tap=await observed();
    const tool=await exactItem(snap,pre.turn.turn_id,commandMarker);
    if(!tool||tool.terminal!==null||!tap||!findDraft(snap,pre.draft.requestId))return false;
    if(isExit){
      const pending=snap.requests.find(r=>r.class==='native'&&r.kind==='command_approval'&&r.origin.turnId===pre.turn.turn_id);
      if(!pending)return false;
      const frame=tap.frames.find(r=>r.method==='item/commandExecution/requestApproval'&&r.id===String(pending.origin.nativeRequest));
      if(!frame)return false;
      return {tool,pending,frame,count:snap.requests.length};
    }
    const held=tap.frames.find(r=>r.method==='fixture/hold-original-item');
    return held&&tap.held&&result.requests.some(row=>row.lane==='actual-read-command-result')&&{tool,held};
  },'real foreground body and required original binding/retained RPC frame');
  assert.equal(JSON.parse(inFlight.tool.body).status,'running');
  result.inFlight=inFlight;
  let replay;
  if(isExit){
    assert.equal(inFlight.count,2);
    assert.deepEqual([inFlight.pending.origin.taskId,inFlight.pending.origin.runId,inFlight.pending.origin.generation],
      [task.taskId,old.run_id,old.generation]);
    assert.equal(inFlight.frame.turnId,pre.turn.native_turn_id);
    result.beforePanel=await verifyPendingUI(canaryName);
    replay=await staleReject(inFlight.pending);
  } else {
    assert.equal(inFlight.held.itemId,fixtureState.commandCall);
    assert.equal(inFlight.held.turnId,pre.turn.native_turn_id);
    assert.equal(JSON.parse(inFlight.tool.body).cwd,cwd);
  }
  await app.screenshot(join(out,'01-before-terminal.png'));
  phase='real native regular terminal or targeted native process exit';
  if(isExit){
    assert.deepEqual(nativeIdentity(app.processId),owner);
    assert.equal(nativeIdentity(old.pid).startedAt,old.process_started_at);
    const original=await state(task.taskId);
    assert.equal(originalTurn(original).status,'started');
    assert(original.requests.some(row=>row.requestId===inFlight.pending.requestId&&row.revision===inFlight.pending.revision));
    const signal=await app.mainEvaluate('globalThis.__a60ExactOwner.signal()');
    result.signaled=signal;
    assert.deepEqual(signal,{pid:old.pid,startedAt:old.process_started_at,signal:'SIGKILL',at:signal.at,sent:true});
  } else provider.finishGate.release();
  const terminal=await until(async()=>{
    const snap=await state(task.taskId),tap=await observed();
    const turn=snap.turns.find(t=>t.turn_id===pre.turn.turn_id);
    const tool=await exactItem(snap,pre.turn.turn_id,commandMarker,inFlight.tool.itemId);
    if(!turn||openStates.includes(turn.status)||snap.run?.busy||tool?.terminal!=='unconfirmed'||!tap)return false;
    const exited=isExit?run(old.run_id):null;
    if(isExit&&(!tap.exit||!exited?.ended_at))return false;
    return {turn,tool,tap,exited,draft:findDraft(snap,pre.draft.requestId),requestIds:snap.requests.map(r=>r.requestId)};
  },'real terminal with tool sealed and durable host request preserved');
  result.terminal=terminal;
  assert.deepEqual(nativeIdentity(app.processId),owner,'App must remain alive with the original identity');
  assert.equal(terminal.turn.native_turn_id,pre.turn.native_turn_id);
  assert(!existsSync(join(cwd,canaryName)));
  assertRetainedStoppedTool(inFlight.tool,terminal.tool);
  for(const key of ['requestId','revision','origin','status'])assert.deepEqual(terminal.draft?.[key],pre.draft[key]);
  assert.deepEqual(terminal.draft.payload.review,pre.draft.payload.review);
  assert.deepEqual(terminal.requestIds,[pre.draft.requestId]);
  const events=await app.invoke('agentTasks.events',task.taskId,pre.seq);
  assert(!events.some(row=>row.type==='task.user_stopped'));
  if(isExit){
    assert.deepEqual(terminal.tap.exit,{code:null,signal:'SIGKILL',at:terminal.tap.exit.at});
    assert.ok(terminal.tap.exit.at>=result.signaled.at);
    assert.equal(terminal.exited.state,'failed');
    assert.equal(terminal.exited.error_code,'EXIT_SIGKILL');
    const kernel=nativeIdentity(old.pid);
    assert(kernel.state==='stopped'||kernel.state==='running'&&kernel.startedAt!==old.process_started_at);
    assert.equal(terminal.turn.status,'failed');
    assert.match(terminal.turn.error_code,/app-server 退出/);
    assert(!terminal.tap.frames.some(row=>row.method==='turn/completed'&&row.turnId===pre.turn.native_turn_id));
    const request=sql('SELECT status FROM agent_requests WHERE request_id=?',[inFlight.pending.requestId])[0];
    assert.equal(request?.status,'retired');
    result.originalRequestAfterExit=request;
    result.staleBeforeNew=await replay('before actual owner successor');
  } else {
    const native=terminal.tap.frames.find(row=>row.method==='turn/completed'&&row.turnId===pre.turn.native_turn_id);
    assert(native&&terminal.tap.held,'Exact native terminal produced normally before single tool-line release');
    assert.equal(terminal.turn.status,mode==='failed-foreground'?'failed':'completed');
    assert.equal(native.status,terminal.turn.status);
    if(mode==='failed-foreground'){
      const failures=result.requests.filter(row=>row.lane==='non-retryable-provider-failure');
      assert.equal(failures.length,1);
      assert.equal(failures[0].status,400);
      assert.match(native.error??'',/400|A60_LOCAL_NONRETRYABLE/);
    }
    assert(!terminal.tap.frames.some(row=>row.method==='item/commandExecution/requestApproval'&&row.turnId===pre.turn.native_turn_id),
      'Ordinary terminal path must not be mistaken for still-pending native approval');
  }
  result.terminal.ui=await workVisibility(pre.turn.turn_id,commandMarker);
  await app.screenshot(join(out,'02-terminal-original-tool-retained.png'));
  if(!isExit){
    const release=await app.mainEvaluate('globalThis.__a60ExactOwner.release("after-unconfirmed-proof")');
    assert.equal(release.sha,inFlight.held.sha);
    assert.equal(release.bytes,inFlight.held.bytes);
    result.releasedExactNativeFrame=release;
  }
  assert.deepEqual(await drafts(),[]);
  phase='same host request publicly approved, single real draft and result notification';
  await click('.agent-request-options button[aria-label="批准"]');
  fixtureState.approvedAt=Date.now();
  await click('.agent-confirm-choice');
  const outcome=await until(async()=>{
    const snap=await state(task.taskId),listing=await drafts();
    const notice=snap.items.find(item=>item.type==='notification'&&item.payload.status==='finished');
    const followup=snap.turns.findLast(t=>t.source_kind==='notification');
    return notice&&followup?.status==='completed'&&hasAnswer(snap,markers.result)&&!snap.run?.busy&&listing.length===1&&
      {notice,followup,draft:listing[0],requests:snap.requests};
  },'one local unsent draft and successful original notification on actual native');
  assert.deepEqual(outcome.requests,[]);
  assert.equal(outcome.draft.subject,subject);
  const mutations=sql('SELECT operation_id,draft_id FROM mail_draft_mutations WHERE project_id=?',[task.projectId]);
  assert.deepEqual(mutations,[{operation_id:fixtureState.receipt.operationId,draft_id:outcome.draft.id}]);
  const stored=sql("SELECT json_extract(content_json,'$.text') AS text FROM mail_draft_revisions WHERE draft_id=?",[outcome.draft.id]);
  assert.deepEqual(stored,[{text:draftBody}]);
  const sends=Object.fromEntries(['mail_send_intents','mail_send_grants','mail_send_executions']
    .map(table=>[table,sql('SELECT COUNT(*) AS total FROM '+table)[0].total]));
  assert.deepEqual(sends,{mail_send_intents:0,mail_send_grants:0,mail_send_executions:0});
  assert.equal(result.requests.filter(row=>row.lane==='draft-tool').length,1);
  const realResults=result.requests.filter(row=>row.lane==='actual-host-result');
  assert.equal(realResults.length,1);
  assert.equal(realResults[0].itemId,outcome.notice.itemId);
  const successor=run(outcome.followup.run_id);
  assert.equal(successor.binding_id,old.binding_id);
  assert.equal(successor.owner_pid,app.processId);
  if(isExit){
    assert.notEqual(successor.run_id,old.run_id);
    assert.ok(successor.generation>old.generation);
    result.staleAfterNew=await replay('after actual successor notification');
  }
  assert(!existsSync(join(cwd,canaryName)));
  result.approved={...outcome,successor,mutations,stored,sends};
  await app.screenshot(join(out,'03-same-host-request-one-local-effect.png'));
}

try{
  const fixture=await configure();
  await execute(fixture);
  result.passed=true;
}catch(error){
  result.failure={phase,error:String(error.stack??error)};
  if(appTrusted)try{result.visible=await app.evaluate('document.body.innerText.slice(0,12000)');await app.screenshot(join(out,'99-failure.png'));}catch{}
}finally{
  fixtureState.closing=true;provider.commandGate.release();provider.finishGate.release();
  if(appTrusted)try{
    result.finalNativeFrames=await app.mainEvaluate(`(() => {
      const current=globalThis.__a60ExactOwner;
      if(!current)return null;
      const state=current.snapshot();current.dispose();delete globalThis.__a60ExactOwner;return state;
    })()`);
  }catch(error){result.observerRestoreFailure=String(error);}
  if(app&&!appTrusted){
    try{result.unverifiedOwnLaunchExit=await app.crash();}catch(error){result.cleanupError=String(error);}
  }
  if(appTrusted){
    try{
      const active=(await app.invoke('agentTasks.list')).filter(row=>['working','waiting'].includes(row.status));
      if(active.length){
        result.cleanupStop=active.map(row=>row.taskId);
        for(const row of active)await app.invoke('agentTasks.stop',row.taskId,true);
        await until(async()=>!(await app.invoke('agentTasks.list')).some(row=>['working','waiting'].includes(row.status)),'exact isolated App is ready to exit',12000);
      }
      await app.mainEvaluate(`(() => {const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
        if(process.pid!==${app.processId}||E.app.getPath('userData')!==${tab(data)}||process.execPath!==${tab(executable)})throw Error('Wrong isolated App');
        setTimeout(()=>E.app.quit(),50);return true;
      })()`);
      result.exit=await app.waitForExit(24000);
    }catch(error){result.quitError=String(error);try{result.forced=await app.crash();}catch(e){result.cleanupError=String(e);}}
    result.rendererErrors=app.rendererErrors;
    writeFileSync(join(out,'app.log'),app.logs(),{mode:0o600});
    try{
      const db=join(data,'smartdd.db'),liveMode=result.exit?.code!==0||result.exit.signal!==null||existsSync(db+'-wal');
      const rows=existsSync(db)?sql('SELECT pid,process_started_at FROM capability_run_processes WHERE pid IS NOT NULL AND run_id IN (SELECT run_id FROM capability_runs WHERE owner_pid=?)',[app.processId],!liveMode):[];
      const seen=[owner,...rows.map(row=>({pid:row.pid,startedAt:row.process_started_at}))].filter(Boolean);
      result.exactProcessesAfter=[...new Map(seen.map(row=>[row.pid+'/'+row.startedAt,row])).values()].map(born=>({born,after:nativeIdentity(born.pid)}));
    }catch(error){result.processProofError=String(error);}
  }
  if(listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  result.listenerClosed=!server.listening;
  result.passed=Boolean(result.passed&&result.exit?.code===0&&result.exit.signal===null&&!result.cleanupStop&&!result.rendererErrors?.length&&
    !result.observerRestoreFailure&&result.listenerClosed&&result.exactProcessesAfter?.length>=3&&
    result.exactProcessesAfter.every(({born,after})=>born.startedAt&&(after.state==='stopped'||after.state==='running'&&after.startedAt!==born.startedAt)));
  writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({out,passed:result.passed,phase,exit:result.exit,error:result.failure}));
}
if(!result.passed)process.exitCode=2;
