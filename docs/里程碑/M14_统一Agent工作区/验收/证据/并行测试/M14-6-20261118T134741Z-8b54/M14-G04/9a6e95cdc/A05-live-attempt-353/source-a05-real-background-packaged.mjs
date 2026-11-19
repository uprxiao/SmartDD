import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { openElectron, pause } from './helpers/scripts/lib/electron-harness.mjs';
import { redirectHome } from './helpers/scripts/applications/fixtures/home-redirect-main.mjs';

const [output, scenario, commit, expectedHash, mode] = process.argv.slice(2);
assert.match(output,/^\/private\/tmp\/willyou-m14-stage6\.[A-Za-z0-9]{6}\/g04\/attempt-\d{3}$/);
assert(['stop','restart','background-only-stop'].includes(scenario));
assert(mode===undefined||mode==='preflight');
assert.match(commit,/^[a-f0-9]{40}$/);
assert.match(expectedHash,/^[a-f0-9]{64}$/);
const privateBase=dirname(output);
const bundle=join(dirname(privateBase),'package/mac-arm64/WillYou.app/Contents');
const executable=join(bundle,'MacOS','WillYou');
const kernelReader=join(bundle,'Resources','native','willyou-process-identity');
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
assert.equal(realpathSync(executable),executable);
assert.equal(realpathSync(kernelReader),kernelReader);
assert.equal(sha(join(bundle,'Resources','app.asar')),expectedHash);
const claude=process.env.M14_SMOKE_CLAUDE;
assert.match(claude??'',/^\/Users\/[^/]+\/\.local\/share\/claude\/versions\/2\.1\.326$/);
assert.equal(realpathSync(claude),claude);
for(const key of ['DEEPSEEK_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','OPENAI_API_KEY','CODEX_API_KEY','CLAUDE_CODE_OAUTH_TOKEN'])
  assert(!process.env[key],'No external model credential is allowed: '+key);
const upstreamSecret=process.env.M14_LIVE_DEEPSEEK_KEY;
delete process.env.M14_LIVE_DEEPSEEK_KEY;
assert(mode==='preflight'||upstreamSecret, 'Use only the authorized isolated DeepSeek credential');
function kernel(pid){
  assert(Number.isSafeInteger(pid)&&pid>1);
  const result=JSON.parse(execFileSync(kernelReader,[String(pid)],{encoding:'utf8',timeout:3000}));
  if(result.state==='running')assert(result.pid===pid&&typeof result.startedAt==='string');
  return result;
}
/** Read the detached launch group by the birth stamped by this exact packaged run. */
function launchGroup(identity){
  assert(Number.isSafeInteger(identity.pid)&&identity.pid>1);
  assert.match(identity.startedAt,/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/);
  const group=JSON.parse(execFileSync(kernelReader,['--owned-process-group',String(identity.pid),identity.startedAt],
    {encoding:'utf8',timeout:3000,maxBuffer:64*1024}));
  if(group.state==='unknown')return null;
  assert.equal(group.schema,5);
  assert.equal(group.rootPid,identity.pid);
  assert.equal(group.rootStartedAt,identity.startedAt);
  assert(Array.isArray(group.processes));
  assert.equal(group.state==='stopped',group.processes.length===0);
  return group;
}
function sameProcess(identity) {
  const current=kernel(identity.pid);
  if(current.state==='stopped')return false;
  if(current.state!=='running')return null;
  return current.startedAt===identity.startedAt;
}
const originalExited=identity=>sameProcess(identity)===false;
if(mode==='preflight'){
  assert.equal(kernel(process.pid).state,'running');
  console.log(JSON.stringify({scenario,commit,packageHash:expectedHash,kernelReader:sha(kernelReader),claude:sha(claude),preflight:true}));
  process.exit(0);
}

mkdirSync(output,{mode:0o700});
copyFileSync(new URL(import.meta.url),join(output,'source-a05-real-background-packaged.mjs'));
const root=realpathSync(mkdtempSync(join(output,'runtime-')));
const home=join(root,'home'),userData=join(root,'data'),cwd=join(root,'project');
for(const path of [home,userData,cwd])mkdirSync(path,{mode:0o700});
mkdirSync(join(home,'Library','Keychains'),{recursive:true,mode:0o700});
const env={HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),TMPDIR:root,
  ENABLE_TOOL_SEARCH:'false',DISABLE_AUTOUPDATER:'1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',
  GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
const identityReaderHash=sha(kernelReader);
const result={caseId:'M14-A05',sourceCommit:commit,asar:expectedHash,scenario,home,userData,scope:cwd,executable,identityReaderHash,
  layer:'R with signed local App and native Claude. DeepSeek official API via the private model relay, synthetic fixture only.',
  status:'failed',appRuns:[],actions:[],observations:[],requests:[],errors:[]};
const started=join(cwd,'started.pid'),finished=join(cwd,'finished.flag'),release=join(cwd,'cleanup.release');
const script=join(cwd,'only-this-fixture-background.sh');
writeFileSync(script,`#!/bin/bash
set -eu
printf '%s\\n' "$$" > started.pid
trap 'printf "signal\\n" > stopped.flag; exit 130' TERM INT HUP
for ((tick=0; tick<900; tick++)); do
  if [ -f cleanup.release ]; then printf "released by fixture cleanup\\n" > finished.flag; exit 0; fi
  /bin/sleep .2
done
printf "natural timeout\\n" > finished.flag
exit 81
`,{mode:0o600});
execFileSync('/bin/bash',['-n',script]);
const markers={
  first:'A05_FIRST_PERSISTED_ROUND',
  second:'A05_SECOND_PERSISTED_ROUND',
  background:'A05_BEGIN_NATIVE_BACKGROUND',
  foreground:'A05_STOP_ONLY_FOREGROUND_ROUND',
  resume:'A05_RESUME_EXACT_BINDING',
};
const model='deepseek-flash';
let toolUse=null;
const answer=name=>markers[name]+'_ANSWER';
const command='/bin/bash '+script;
const prompt={
  first:'Reply with exactly '+answer('first')+' and use no tools.',
  second:'Reply with exactly '+answer('second')+' and use no tools.',
  background:'Call the Bash tool once with command '+JSON.stringify(command)+' and run_in_background: true. The script is an isolated test fixture. Do not use any other tool and do not wait for the command to finish. Once the background launch receipt arrives, reply with exactly '+answer('background')+'.',
  foreground:'Reply with exactly '+answer('foreground')+' and use no tools.',
  resume:'Reply with exactly '+answer('resume')+' and use no tools.',
};
const input=Object.fromEntries(Object.keys(markers).map(k=>[k,markers[k]+' '+prompt[k]]));
const record=(name,data={})=>result.observations.push({name,at:new Date().toISOString(),...data});
let app,taskId,background,rootNative,wasForegroundRequested=false;
let phase='boot';
const held=new Set();
const select=value=>JSON.stringify(value);
const server=createServer((req,res)=>void respond(req,res).catch(error=>{
  result.errors.push(String(error.stack??error));
  if(!res.headersSent)res.writeHead(500);
  res.end();
}));
function checkedNativeTool(text) {
  const events=text.split(/\r?\n/).filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
  const tools=events.filter(e=>e.type==='content_block_start'&&e.content_block?.type==='tool_use');
  assert(tools.length<=1,'At most one declared fixture tool');
  if(!tools.length)return null;
  const frame=tools[0];
  const parts=events.filter(e=>e.index===frame.index&&e.type==='content_block_delta'&&e.delta?.type==='input_json_delta');
  const args=parts.length?JSON.parse(parts.map(e=>e.delta.partial_json).join('')):frame.content_block.input;
  assert(frame.content_block.name==='Bash'&&typeof frame.content_block.id==='string');
  assert(args?.command===command&&args.run_in_background===true,'Only the precise private script may execute in this fixture');
  return {id:frame.content_block.id,name:frame.content_block.name};
}
async function respond(req,res){
  const url=new URL(req.url,'http://127.0.0.1:3425');
  if(url.pathname.endsWith('/models')){
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({data:[{id:model}]}));
    return;
  }
  if(req.method!=='POST'||!['/v1/messages','/anthropic/v1/messages'].includes(url.pathname)){res.writeHead(404);res.end();return;}
  const chunks=[];
  let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;assert(bytes<=8*1024**2);chunks.push(chunk);}
  const raw=Buffer.concat(chunks);
  const body=JSON.parse(raw);
  assert.equal(body.model,model);
  const choosePrompt=()=> {
    for (const message of [...(body.messages??[])].reverse()) {
      if(message.role!=='user')continue;
      const text=typeof message.content==='string'?message.content:Array.isArray(message.content)?
        message.content.filter(block=>block.type==='text').map(block=>block.text).join('\n'):'';
      const marker=Object.entries(markers).find(([,value])=>text.includes(value));
      if(marker)return marker[0];
    }
    return null;
  };
  const marker=choosePrompt();
  assert(marker,'No isolated marker in provider messages');
  const receipts=(body.messages??[]).flatMap(row=>Array.isArray(row.content)?row.content:[]).filter(row=>row.type==='tool_result'&&row.tool_use_id===toolUse);
  const found=receipts.at(-1);
  const request={at:new Date().toISOString(),appPid:app?.processId??null,marker,toolUse,
    foundToolReceipt:found?{error:found.is_error===true,content:found.content}:null};
  result.requests.push(request);
  const controller=new AbortController();
  res.once('close',()=>{controller.abort();held.delete(res);request.closedAt=new Date().toISOString();});
  const headers={'content-type':'application/json',authorization:'Bearer '+upstreamSecret,
    'anthropic-version':req.headers['anthropic-version']??'2023-06-01'};
  if(req.headers['anthropic-beta'])headers['anthropic-beta']=req.headers['anthropic-beta'];
  const upstream=await fetch('https://api.deepseek.com/anthropic/v1/messages',{method:'POST',headers,body:raw,redirect:'error',
    signal:AbortSignal.any([controller.signal,AbortSignal.timeout(120000)])});
  request.upstreamStatus=upstream.status;
  assert.equal(upstream.status,200);
  const ct=upstream.headers.get('content-type')??'';
  assert(ct.includes('text/event-stream'));
  if(marker==='foreground'){
    const reader=upstream.body.getReader();
    let frames=Buffer.alloc(0), opening=null;
    while(!opening && frames.length<64*1024){
      const {value,done}=await reader.read();
      assert(!done&&value?.length,'a real upstream frame is available');
      frames=Buffer.concat([frames,Buffer.from(value)]);
      const found=frames.toString().match(/(?:^|\n)(event: message_start\r?\ndata: [^\r\n]+\r?\n\r?\n)/);
      if(found)opening=found[1];
    }
    assert(opening,'A real message_start must precede stream interruption');
    wasForegroundRequested=true;
    request.realFirstFrameBytes=Buffer.byteLength(opening);
    held.add(res);
    res.writeHead(upstream.status,{'content-type':ct});
    res.write(opening);
    return;
  }
  if(marker==='background'&&!found){
    assert.equal(toolUse,null,'Background tool is launched once');
    const rawResponse=Buffer.from(await upstream.arrayBuffer());
    const tool=checkedNativeTool(rawResponse.toString());
    assert(tool,'The real model did not ask to start the background tool');
    toolUse=tool.id;
    request.toolUse=toolUse;
    request.tool={name:tool.name,id:tool.id,command};
    request.responseHash=createHash('sha256').update(rawResponse).digest('hex');
    res.writeHead(200,{'content-type':ct});
    res.end(rawResponse);
    return;
  }
  if(marker==='background')assert(!found.is_error,'Real background invocation failed');
  const responseBytes=Buffer.from(await upstream.arrayBuffer());
  assert.equal(checkedNativeTool(responseBytes.toString()),null,'Unexpected tool in a read-only follow-up');
  res.writeHead(200,{'content-type':ct});
  res.end(responseBytes);
}
async function until(probe,label,ms=16000){
  const deadline=Date.now()+ms;
  do { if(result.errors.length)throw Error(result.errors.at(-1)); const value=await probe();if(value)return value;await pause(85); }
  while(Date.now()<deadline);
  throw Error('Timed out: '+label);
}
async function click(selector,label){
  const point=await until(()=>app.evaluate(`(() => {
    const e=[...document.querySelectorAll(${select(selector)})].filter(node=>node.getBoundingClientRect().height>0 &&
      (${select(label??null)}===null||node.innerText.trim()===${select(label??null)}));
    if(e.length!==1||e[0].disabled||e[0].ariaDisabled==='true')return null;
    const node=e[0];node.scrollIntoView({block:'nearest',inline:'nearest'});const b=node.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;
    return node.contains(document.elementFromPoint(x,y))?{x,y}:null;
  })()`),'original visible, unoccluded control '+selector+(label??''));
  for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
  result.actions.push({at:new Date().toISOString(),pid:app.processId,selector,label:label??null,...point});
}
async function send(marker){
  await click('.agent-composer textarea');
  await app.cdp('Input.insertText',{text:input[marker]});
  await click('.agent-composer button[type="submit"]');
}
async function enableWorkspaceIfNeeded() {
  const enabledExpression="localStorage.getItem('willyou-m14-agent-workspace')==='true'";
  if(await app.evaluate(enabledExpression))return false;
  await click('[data-testid="nav-settings"]');
  const toggle='[data-testid="m14-toggle"]';
  await app.waitFor(`Boolean(document.querySelector(${select(toggle)}))`,10000);
  await click(toggle);
  await app.waitFor(enabledExpression,10000);
  await click('[data-testid="nav-home"]');
  record('test instance work area turned on by real settings control',{pid:app.processId});
  return true;
}
async function boot(){
  const hook={};
  const current=await openElectron({executable,userData,env,inspectMain:true,startupMainHook:async info=>{
    Object.assign(hook,await redirectHome({...info,home}));
    assert.equal(hook.workerInspectorFlagRemoved,true);
  }});
  app=current;
  const identity=await current.mainEvaluate(`(() => {
    const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    return [E.app.isPackaged,E.app.getPath('home'),E.app.getPath('userData'),process.env.HOME,process.pid,process.execPath,process.env.M14_LIVE_DEEPSEEK_KEY===undefined];
  })()`);
  assert.deepEqual(identity,[true,home,userData,home,current.processId,executable,true]);
  result.appRuns.push({identity,hook});
  await current.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
}
const snapshot=()=>app.invoke('agentTasks.snapshot',taskId);
function db(sql,...args) {
  const source=join(userData,'smartdd.db');
  assert(realpathSync(source).startsWith(userData+'/'));
  const py='from pathlib import Path; import sqlite3,sys,json; c=sqlite3.connect(Path(sys.argv[1]).as_uri()+"?mode=ro",uri=True); c.row_factory=sqlite3.Row; print(json.dumps([dict(x) for x in c.execute(sys.argv[2],sys.argv[3:])]))';
  return JSON.parse(execFileSync('/usr/bin/python3',['-c',py,source,sql,...args],{encoding:'utf8',timeout:4000}));
}
const exactTurn=name=>db('SELECT * FROM agent_turns WHERE task_id=? AND source_kind=\'user\' ORDER BY rowid',taskId)
  .find(row=>JSON.parse(row.input_ref).text===input[name]);
const bindings=()=>db('SELECT binding_id,native_id,created_at FROM agent_bindings WHERE task_id=? ORDER BY created_at',taskId);
const runRow=id=>db('SELECT run_id,task_id,binding_id,generation,pid,process_started_at,state,error_code,ended_at FROM capability_runs WHERE task_id=? AND run_id=?',taskId,id)[0];
function readNode(runId){
  const rows=db("SELECT item_id,run_id,node_id,type,revision,terminal_state,created_at,payload_ref FROM agent_items WHERE task_id=? AND run_id=? AND type IN ('subagent_status','subagent_message') ORDER BY ordinal",taskId,runId);
  const parsed=rows.map(({payload_ref,...row})=>({...row,payload:JSON.parse(payload_ref)}));
  const nodes=parsed.filter(row=>row.type==='subagent_message'&&row.payload.subtype==='task_started'&&row.payload.tool_use_id===toolUse);
  if(!nodes.length)return null;
  assert.equal(nodes.length,1,'No duplicate original native start event');
  const started=nodes[0];
  const states=parsed.filter(row=>row.type==='subagent_status'&&row.node_id===started.node_id);
  if(states.length!==1)return null;
  return {id:started.node_id,nativeTaskId:started.payload.task_id,nativeRunId:started.payload.run_id??null,
    state:states[0],started,messages:parsed.filter(row=>row.node_id===started.node_id&&row.type==='subagent_message')};
}
async function complete(name){
  return until(async()=>{
    const state=await snapshot();const turn=exactTurn(name);
    const answered=state.items.some(item=>item.type==='assistant_message'&&item.payload.text?.includes(answer(name)));
    return turn?.status==='completed'&&answered&&!state.run?.busy&&{state,turn};
  },'native turn completes with its actual rendered message '+name,25000);
}
async function openTask() {
  await click(`[data-testid="sidebar-agent-task"][data-task-id="${taskId}"]`);
  await app.waitFor("document.querySelector('.agent-task-head h1')?.textContent==='A05 isolated native background'",12000);
}
async function screenshot(name) {
  await app.evaluate('document.fonts.ready.then(()=>true)');
  await app.screenshot(join(output,name+'.png'));
}
async function normalQuit() {
  const current=app,entry=result.appRuns.at(-1);
  if(!current)return;
  entry.rendererErrors=current.rendererErrors;
  try {
    await current.mainEvaluate(`(() => {
      const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
      if(E.app.getPath('userData')!==${select(userData)}||process.pid!==${current.processId})throw Error('Wrong isolated process');
      setTimeout(()=>E.app.quit(),50);return true;
    })()`);
  }catch(error){entry.exitRPC=String(error);}
  try {entry.exit=await current.waitForExit(24000);}
  catch(error){entry.normalExitError=String(error);entry.fallback=await current.crash();}
  entry.rendererErrors=current.rendererErrors;
  writeFileSync(join(output,'app-'+current.processId+'.log'),current.logs(),{mode:0o600});
  app=null;
  assert.deepEqual(entry.rendererErrors,[]);
  assert.equal(entry.exit?.code,0);
  assert.equal(entry.exit?.signal,null);
}
function verifySameNode(before,after){
  assert(after);
  assert.deepEqual([after.id,after.nativeTaskId,after.nativeRunId,after.state.item_id],
    [before.id,before.nativeTaskId,before.nativeRunId,before.state.item_id]);
}
async function bindOriginalStopObserver(){
  await app.mainEvaluate(`(() => {
    const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    if(E.app.getPath('userData')!==${select(userData)}||process.pid!==${app.processId})throw Error('Wrong private app');
    const handlers=E.ipcMain._invokeHandlers, id=${select(taskId)}, rows=[];
    const targets=[...handlers.keys()].filter(key=>key.startsWith('agentTasks.stop')||key==='agentTasks.forceStop');
    if(!targets.includes('agentTasks.stop')||!targets.includes('agentTasks.forceStop'))throw Error('Original stop handlers missing');
    for(const channel of targets){
      const original=handlers.get(channel);
      if(typeof original!=='function')throw Error('Original stop handler missing: '+channel);
      handlers.set(channel,async function(e,...args){
        if(args[0]!==id)return original.call(this,e,...args);
        const row={channel,args,sender:e.sender.id,enteredAt:Date.now()};rows.push(row);
        try {const value=await original.call(this,e,...args);row.receipt=value??null;return value;}
        catch(e){row.error=String(e);throw e;}
        finally{row.returnedAt=Date.now();}
      });
    }
    globalThis.__m14A05StopTrace=rows;
    return true;
  })()`);
}
const stopTrace=()=>app.mainEvaluate('globalThis.__m14A05StopTrace ?? []');
const stopButton='.agent-composer button.agent-stop-run[title="停止本轮"]';
const forceButton='.agent-stop-banner button';
const nativeAnswer=(state,name)=>state.items.some(item=>item.type==='assistant_message'&&item.payload.text?.includes(answer(name)));
let originalRun,originalBinding,node0;

async function stopScenario(){
  await bindOriginalStopObserver();
  phase='stop a foreground turn without stopping existing native background';
  await send('foreground');
  const before=await until(async()=>{
    const current=await snapshot();const turn=exactTurn('foreground');
    const beforeRef=db('SELECT status,after_ref FROM agent_turn_changes WHERE turn_id=?',exactTurn('background').turn_id)[0]??null;
    return wasForegroundRequested&&turn?.status==='started'&&current.run?.busy&&{turn,run:current.run,backgroundTurnCapture:beforeRef};
  },'new foreground Claude turn reached real held local model',18000);
  assert.equal(before.run.runId,originalRun.run_id);
  assert(sameProcess(background)&&sameProcess(rootNative));
  const nativeWhileForeground=readNode(originalRun.run_id);
  verifySameNode(node0,nativeWhileForeground);
  record('new foreground reached native provider while original Bash remained live',
    {before,nativeWhileForeground,owner:kernel(rootNative.pid),background:kernel(background.pid)});
  await click(stopButton);
  const stopped=await until(async()=>{
    const turn=exactTurn('foreground'),state=await snapshot();
    return turn?.status==='interrupted'&&!state.run?.busy&&{turn,status:state.status,run:state.run,stopping:state.stopping};
  },'ordinary stop interrupts exact foreground turn');
  assert.equal(stopped.turn.native_turn_id,before.turn.native_turn_id);
  assert.equal(stopped.turn.error_code,null);
  const bgAfterFirst=readNode(originalRun.run_id);
  verifySameNode(node0,bgAfterFirst);
  const firstTrace=await stopTrace();
  record('exact ordinary foreground stop receipt and original background after stop',
    {before,stopped,background:kernel(background.pid),node:bgAfterFirst,trace:firstTrace});
  assert(firstTrace.length===1&&firstTrace[0].channel==='agentTasks.stop');
  assert.equal(bgAfterFirst.state.payload.state,'running','Stopping one normal foreground turn must keep the original background active');
  assert(sameProcess(background),'Foreground stop killed the original background process');
  assert(!existsSync(finished));
  await screenshot('02-foreground-stopped-background-still-running');

  phase='independent native background stop before the original owner is drained';
  const targetControl=await until(async()=>{
    const state=await snapshot();
    if(state.run?.busy || state.run?.runId!==originalRun.run_id)return null;
    const candidates=['[data-testid="agent-stop-background"]','button[title="停止后台工作"]','button[aria-label="停止后台工作"]',stopButton];
    return app.evaluate(`(${select(candidates)}).find(selector=>[...document.querySelectorAll(selector)]
      .some(node=>!node.disabled&&node.getBoundingClientRect().height>0))`);
  },'independent live background control is available without forcing owner exit',18000);
  assert(sameProcess(background)&&sameProcess(rootNative));
  await click(targetControl);
  const end=await until(async()=>{
    const node=readNode(originalRun.run_id);
    const run=runRow(originalRun.run_id);
    const state=await snapshot();
    const stoppedEvent=node?.messages.find(row=>row.payload.subtype==='task_notification'
      && row.payload.task_id===node0.nativeTaskId&&row.payload.status==='stopped');
    if(!stoppedEvent || node.state.payload.state!=='interrupted' || !originalExited(background))return null;
    return {node,stoppedEvent,run,taskStatus:state.status,retainedRun:state.run,
      foreground:exactTurn('foreground'),backgroundTurn:exactTurn('background')};
  },'native task_notification stopped the original background node and exact Bash exited',18000);
  verifySameNode(node0,end.node);
  assert.equal(end.node.state.payload.state,'interrupted');
  assert.equal(end.backgroundTurn.status,'completed');
  assert.equal(end.foreground.status,'interrupted');
  assert(!existsSync(release)&&!existsSync(finished));
  assert(!nativeAnswer(await snapshot(),'foreground'));
  const trace=await stopTrace();
  assert.equal(trace.length,2);
  assert(trace[1].channel.startsWith('agentTasks.stop')&&trace[1].channel!=='agentTasks.forceStop');
  assert(trace.every(row=>row.args[0]===taskId&&!row.error));
  assert(Date.parse(end.stoppedEvent.created_at)>=trace[1].enteredAt,
    'Native background stopped notification must follow the separate real UI click');
  record('background stops only after second explicit UI action with original node and PID',
    {secondAction:'explicit native background stop, no force stop',control:targetControl,end,
      nativeOwner:kernel(rootNative.pid),background:kernel(background.pid),trace});
  await screenshot('04-native-background-stopped');
  phase='original owner exits after native foreground and background drain';
  const originalDrain=await until(async()=>{
    const run=runRow(originalRun.run_id);
    const group=launchGroup(rootNative);
    const state=await snapshot();
    return run?.state==='stopped'&& !state.run&&originalExited(rootNative)&&group?.state==='stopped'
      && {run,group,owner:kernel(rootNative.pid)};
  },'existing coordination closes only after the original owner and group actually exit',18000);
  assert.deepEqual(bindings(),[originalBinding]);
  assert(Date.parse(originalDrain.run.ended_at)>=Date.parse(end.stoppedEvent.created_at));
  record('original owner drains only after native foreground and background stop',
    {backgroundStoppedEvent:end.stoppedEvent,originalDrain,binding:originalBinding});
  phase='ordinary next input after separate stops uses the original native binding';
  await send('resume');
  const resumed=await complete('resume');
  assert.notEqual(resumed.state.run.runId,originalRun.run_id);
  assert(resumed.state.run.generation>originalRun.generation);
  const newRun=runRow(resumed.state.run.runId);
  const newOwner=kernel(newRun.pid);
  assert.equal(newOwner.state,'running');
  assert.equal(newOwner.startedAt,newRun.process_started_at);
  assert.equal(newRun.binding_id,originalBinding.binding_id);
  assert.equal(resumed.turn.native_turn_id.split(':')[0],originalBinding.native_id);
  assert.deepEqual(bindings(),[originalBinding]);
  assert.equal(result.requests.filter(request=>request.marker==='resume').length,1);
  record('ordinary next input after separate stops recovers the same native binding with a new owner',
    {resumed:resumed.turn,newRun,newOwner,binding:originalBinding,originalDrain});
  await screenshot('05-continued-existing-native-binding-after-stop');
}

async function stopBackgroundOnly(){
  phase='explicit stop after its foreground completed, without a pending foreground turn';
  await bindOriginalStopObserver();
  const initial=await snapshot();
  assert(!initial.run.busy&&initial.run.runId===originalRun.run_id);
  assert(sameProcess(background)===true);
  await click(stopButton);
  const available=await until(async()=>{
    const node=readNode(originalRun.run_id);
    if(node?.state.payload.state!=='running'&&originalExited(background))return {kind:'native child terminal after normal stop'};
    const stopping=(await snapshot()).stopping;
    if(!stopping||stopping.runId!==originalRun.run_id)return null;
    const force=await app.evaluate(`[...document.querySelectorAll(${select(forceButton)})]
      .some(button=>button.innerText.trim()==='强制停止'&&!button.disabled)`);
    return force&&{kind:'explicit owner fallback',stopping,background:kernel(background.pid),native:kernel(rootNative.pid)};
  },'normal native node stop or a visible exact-owner fallback',15000);
  if(available.kind==='explicit owner fallback'){
    assert(sameProcess(background)===true&&sameProcess(rootNative)===true);
    await screenshot('02-background-still-running-with-force-control');
    await click(forceButton,'强制停止');
  }
  const terminal=await until(()=>{
    const node=readNode(originalRun.run_id);
    return node?.state.payload.state!=='running'&&originalExited(background)&&node;
  },'real original background gone and terminal receipt persisted');
  verifySameNode(node0,terminal);
  assert.equal(terminal.state.payload.state,'interrupted');
  assert(!existsSync(release)&&!existsSync(finished));
  const trace=await stopTrace();
  assert(trace[0]?.channel==='agentTasks.stop'&&trace[0].args[0]===taskId);
  if(available.kind==='explicit owner fallback'){
    assert(trace.length===2&&trace[1].channel==='agentTasks.forceStop'&&trace[1].args[1]===originalRun.run_id);
    assert(originalExited(rootNative));
  }else assert.equal(trace.length,1);
  record('explicit UI stop for the already background-only native work',
    {available,terminal,trace,owner:kernel(rootNative.pid),background:kernel(background.pid),foreground:exactTurn('background')});
  await screenshot('03-background-only-terminal');
}

async function restartScenario(){
  phase='controlled App termination with live native background';
  const original=app;
  const entry=result.appRuns.at(-1);
  const beforeState=await snapshot();
  assert.equal(beforeState.run.runId,originalRun.run_id);
  assert(!beforeState.run.busy && sameProcess(background) && sameProcess(rootNative));
  const verified=await original.mainEvaluate(`(() => {
    const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    return E.app.getPath('userData')===${select(userData)} && process.pid===${original.processId};
  })()`);
  assert(verified);
  const beforeCrashGroup=await until(()=>{
    const group=launchGroup(rootNative);
    return group?.state==='running'&&group.processes.some(p=>p.pid===rootNative.pid&&p.startedAt===rootNative.startedAt)&&group;
  },'original detached launch group birth is readable before deliberate host exit',3500);
  result.armedCrash={host:original.processId,nativePid:rootNative.pid,backgroundPid:background.pid,
    runId:originalRun.run_id,nodeId:node0.id,originalBinding,beforeCrashGroup};
  writeFileSync(join(output,'before-intentional-crash.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  entry.rendererErrors=original.rendererErrors;
  entry.intentionalCrash=await original.crash();
  assert.deepEqual(entry.intentionalCrash,{pid:original.processId,code:null,signal:'SIGKILL'});
  writeFileSync(join(output,'app-'+original.processId+'.log'),original.logs(),{mode:0o600});
  app=null;
  record('only first isolated host deliberately killed',{exit:entry.intentionalCrash,
    originalOwnerImmediatelyAfter:kernel(rootNative.pid),originalBackgroundImmediatelyAfter:kernel(background.pid),
    originalGroupImmediatelyAfter:launchGroup(rootNative)});
  const beforeRestartRequests=result.requests.length;
  phase='cold restart same userData and reopen original task';
  await boot();
  assert.notEqual(app.processId,entry.intentionalCrash.pid);
  result.workspaceNeededReenable=await enableWorkspaceIfNeeded();
  await openTask();
  const previousLedger=await until(()=>{
    const run=runRow(originalRun.run_id);
    return ['orphaned','stopped','failed'].includes(run?.state)&&run;
  },'previous saved run leaves active state after cold restart');
  assert.equal(previousLedger.pid,rootNative.pid);
  assert.equal(previousLedger.process_started_at,rootNative.startedAt);
  assert.equal(previousLedger.binding_id,originalBinding.binding_id);
  const drained=await until(()=>{
    const group=launchGroup(rootNative);
    return originalExited(rootNative)&&originalExited(background)&&group?.state==='stopped'&&group;
  },'old native owner, background and proved original detached group are gone',15000)
    .catch(error=>{record('native drain failure',{message:error.message,owner:kernel(rootNative.pid),
      background:kernel(background.pid),group:launchGroup(rootNative)});return null;});
  const readRecovery=()=>{
    const run=runRow(originalRun.run_id),node=readNode(originalRun.run_id);
    const ownedProcesses=db('SELECT kind,state,pid,process_started_at,ended_at FROM capability_run_processes WHERE run_id=? ORDER BY kind',originalRun.run_id);
    const activities=db('SELECT state,ended_at FROM capability_run_activities WHERE run_id=? ORDER BY rowid',originalRun.run_id);
    return {run,node,ownedProcesses,activities};
  };
  const recovered=await until(()=>{
    const recovery=readRecovery();
    const cli=recovery.ownedProcesses.find(row=>row.kind==='cli'&&row.pid===rootNative.pid
      &&row.process_started_at===rootNative.startedAt);
    return ['stopped','failed'].includes(recovery.run?.state)&&recovery.node?.state.payload.state==='interrupted'
      && recovery.node.state.terminal_state && cli?.state==='exited' && cli.ended_at
      && recovery.ownedProcesses.every(row=>['exited','canceled'].includes(row.state))
      && !recovery.activities.some(row=>row.state==='active')&&recovery;
  },'same historic node and previous registered run/CLI settle after proved group exit',13000)
    .catch(error=>{record('old recovery ledger still pending', {detail:error.message, ...readRecovery()});return null;});
  const reopened=await snapshot();
  const nodeBeforeInput=readNode(originalRun.run_id);
  verifySameNode(node0,nodeBeforeInput);
  const originalTurns=['first','second','background'].map(name=>exactTurn(name));
  assert(originalTurns.every(turn=>turn.status==='completed'));
  assert.equal(reopened.run,null);
  assert.equal(result.requests.length,beforeRestartRequests,'No native inference before real user action after restart');
  assert.deepEqual(bindings(),[originalBinding]);
  for(const name of ['first','second','background'])assert(nativeAnswer(reopened,name));
  record('same private App data: old run fact, stable node, retained history, no replay before user input',
    {previousLedger,drained,recovered,nodeBeforeInput,beforeRestartRequests,status:reopened.status,originalTurns,pid:app.processId,
      oldOwner:kernel(rootNative.pid),oldBackground:kernel(background.pid),oldLedgerBeforeContinue:readRecovery()});
  await screenshot('02-cold-reopened-task');
  phase='explicitly continue original native binding after isolated restart';
  if(!drained)throw Error('Old native background is still alive after verified same-data restart');
  await send('resume');
  const resumed=await complete('resume');
  assert.notEqual(resumed.state.run.runId,originalRun.run_id);
  assert(resumed.state.run.generation>originalRun.generation);
  const opened=runRow(resumed.state.run.runId);
  assert.equal(opened.binding_id,originalBinding.binding_id);
  assert.deepEqual(bindings(),[originalBinding]);
  assert.equal(resumed.turn.native_turn_id.split(':')[0],originalBinding.native_id);
  assert.equal(result.requests.filter(row=>row.marker==='background'&&!row.foundToolReceipt).length,1);
  const nodeAfterInput=readNode(originalRun.run_id);
  verifySameNode(node0,nodeAfterInput);
  record('historic node and actual native binding after explicit continuation',
    {resumed:resumed.turn,opened,nodeAfterInput,receiptCount:result.requests.length});
  await screenshot('03-continued-same-native-binding');
  assert(recovered,'The previous run/CLI and native node must be settled independently before explicit continuation');
  for(const oldNode of [nodeBeforeInput,nodeAfterInput]){
    assert.equal(oldNode.state.payload.state,'interrupted','Historical background node must be explicitly interrupted after original launch group exit');
    assert(oldNode.state.terminal_state,'Historical background node must have a durable terminal marker');
    assert(oldNode.state.revision>node0.state.revision);
  }
}

try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3425,'127.0.0.1',resolve);});
  await boot();
  phase='validated local provider, native Claude and prepared isolated task';
  const custom=await app.invoke('agents.customToolPath','claude',claude);
  assert(custom.tool?.installed&&custom.tool.version==='2.1.326'&&custom.tool.customPath===claude);
  result.claudeTool={version:custom.tool.version,sha256:sha(claude)};
  const provider=await app.invoke('agents.saveProvider',{name:'A05 loopback only',preset:'magpie',
    endpoints:{responses:'http://127.0.0.1:3425/v1',anthropic:'http://127.0.0.1:3425/'},models:[{id:model,name:model}]});
  const profile=await app.invoke('agents.save',{name:'A05 loopback native Claude',toolId:custom.tool.id,source:'provider',providerId:provider.id,
    models:[model],defaultModel:model,isDefault:true});
  const project=await app.invoke('projects.create',{name:'A05 isolated project',aliases:[],description:'',rulesPath:null},[{label:'workspace',path:cwd}]);
  const task=await app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,
    title:'A05 isolated native background',profileId:profile.id,model,tier:'ask'});
  taskId=task.taskId;
  result.ids={projectId:project.id,taskId};
  await enableWorkspaceIfNeeded();
  const start=await app.evaluate('performance.timeOrigin');
  await app.cdp('Page.reload');
  await app.waitFor(`performance.timeOrigin!==${start}&&!!window.electronAPI`,15000,{navigation:true});
  await app.arm();
  await openTask();
  phase='two foreground turns with identical real native binding';
  await send('first');
  const first=await complete('first');
  await send('second');
  const second=await complete('second');
  assert.equal(first.state.run.runId,second.state.run.runId);
  assert.notEqual(first.turn.native_turn_id,second.turn.native_turn_id);
  originalRun=runRow(second.state.run.runId);
  const bindingList=bindings();
  assert.equal(bindingList.length,1);
  [originalBinding]=bindingList;
  assert.equal(originalRun.binding_id,originalBinding.binding_id);
  assert(originalBinding.native_id);
  assert([first.turn,second.turn].every(turn=>turn.native_turn_id.split(':')[0]===originalBinding.native_id));
  record('two explicitly sent complete native turns share one binding', {first:first.turn,second:second.turn,originalBinding,originalRun});

  phase='Bash background remains same identity after foreground completion';
  await send('background');
  const approval='.agent-request-options button[aria-label*="批准"]:not([aria-label*="拒绝"])';
  const backgroundStarted=await until(async()=>{
    const snap=await snapshot();
    if(snap.requests.length&&await app.evaluate(`Boolean(document.querySelector(${select(approval)}))`)){
      const panel=await app.evaluate('document.querySelector(".agent-request")?.innerText??""');
      assert(snap.requests.length===1&&toolUse&&panel.includes(script),'Approval must describe the one validated private script');
      await click(approval);
      await click('.agent-confirm-choice');
    }
    const turn=exactTurn('background');
    const node=readNode(originalRun.run_id);
    return existsSync(started)&&turn?.status==='completed'&&nativeAnswer(snap,'background')&&node?.state.payload.state==='running'
      && !snap.run?.busy && {snap,turn,node};
  },'real Claude task_started and continuing process after original foreground has completed',26000);
  assert.equal(backgroundStarted.snap.run.runId,originalRun.run_id);
  assert.equal(backgroundStarted.snap.status,'working');
  assert.equal(backgroundStarted.node.started.payload.is_backgrounded??true,true);
  assert(result.requests.some(row=>row.marker==='background'&&row.foundToolReceipt&&!row.foundToolReceipt.error));
  rootNative=kernel(originalRun.pid);
  assert.equal(rootNative.state,'running');
  assert.equal(rootNative.startedAt,originalRun.process_started_at);
  background=kernel(Number(readFileSync(started,'utf8')));
  assert.equal(background.state,'running');
  assert.notEqual(background.pid,rootNative.pid);
  assert(!existsSync(finished)&&!existsSync(release));
  node0=backgroundStarted.node;
  assert(node0.nativeTaskId&&node0.id===toolUse);
  record('native Bash stays alive after actual foreground ends', {
    foreground:backgroundStarted.turn,taskStatus:backgroundStarted.snap.status,rootNative,background,node:node0,
  });
  await screenshot('01-native-background-after-foreground');
  if(scenario==='stop')await stopScenario();
  else if(scenario==='background-only-stop')await stopBackgroundOnly();
  else await restartScenario();
  assert.deepEqual(result.errors,[]);
  result.status='pass';
}catch(error){
  result.phase=phase;
  result.failure=String(error.stack??error);
  if(app){
    try {result.visible=await app.evaluate('document.body.innerText.slice(-10000)');await screenshot('99-failure');}catch{}
    try {if(scenario!=='restart')result.unfinishedStopTrace=await stopTrace();}catch{}
  }
}finally{
  if(result.status!=='pass'&&held.size){
    result.cleanupClosedHeldResponses=held.size;
    for(const res of held)res.destroy();
  }
  if(existsSync(started)){
    const pid=Number(readFileSync(started,'utf8'));
    if(!background&&Number.isSafeInteger(pid)&&pid>1){try{const current=kernel(pid);if(current.state==='running')background=current;}catch{}}
    if(background&&sameProcess(background)){
      result.cleanupGate={pid:background.pid,before:kernel(background.pid)};
      writeFileSync(release,'Release only the independently owned isolated test file',{mode:0o600});
      try{await until(()=>originalExited(background),'cleanup of exact owned background process',6000);}
      catch(error){result.cleanupGate.error=String(error);}
    }
  }
  if(app){try{await normalQuit();}catch(error){result.exitError=String(error);result.status='failed';}}
  for(const res of held)res.destroy();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  if(rootNative)result.oldOwnerAfterCleanup=kernel(rootNative.pid);
  if(background)result.backgroundAfterCleanup=kernel(background.pid);
  writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({caseId:result.caseId,scenario,status:result.status,phase:result.phase,
    exits:result.appRuns.map(run=>run.exit??run.intentionalCrash),path:join(output,'result.json')}));
}
if(result.status!=='pass')process.exitCode=1;
