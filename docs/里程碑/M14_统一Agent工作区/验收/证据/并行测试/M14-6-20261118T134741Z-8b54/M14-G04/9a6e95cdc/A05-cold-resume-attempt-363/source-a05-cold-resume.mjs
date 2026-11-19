import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { openElectron, pause } from '../helpers/scripts/lib/electron-harness.mjs';
import { redirectHome } from '../helpers/scripts/applications/fixtures/home-redirect-main.mjs';
import { isM14PreEntryRun } from '../helpers/scripts/lib/electron-isolation-paths.mjs';
import { asar, bindingId, commit, evidencePath, executable, expectedAnswer, home, known, model,
  modelRequest, nativeHistory, nativeId, newPrompt, prior, providerOrigin, resumeFlag, sha,
  taskId, title, upstream, userData, verifySse, work } from './contract.mjs';
import { claudeHash, nativeHelper, readState, verifySource } from './source-proof.mjs';

const path=evidencePath(process.argv[2]);
assert.equal(process.argv.length,3);
assert.equal(process.env.M14_A05_COLD_RESUME_AUTHORIZED,'1','Missing explicit exact-target authorization');
const secret=process.env.M14_LIVE_DEEPSEEK_KEY;
delete process.env.M14_LIVE_DEEPSEEK_KEY;
assert(secret&&/^[\x21-\x7e]+$/.test(secret),'Missing authorized dedicated test credential');
assert(!existsSync(path));
assert(isM14PreEntryRun(executable,userData,home));
const before=verifySource();
assert.equal(realpathSync(before.provider.custom_path),before.provider.custom_path);
assert.equal(sha(readFileSync(before.provider.custom_path)),claudeHash,'Existing Claude executable changed');
const env={HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),
  TMPDIR:join(home,'..'),XDG_CONFIG_HOME:join(home,'.config'),XDG_CACHE_HOME:join(home,'.cache'),
  XDG_DATA_HOME:join(home,'.local/share'),GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',
  GIT_TERMINAL_PROMPT:'0',M14_LIVE_DEEPSEEK_KEY:undefined};
for(const key of Object.keys(process.env))
  if(/KEY|TOKEN|SECRET|PASSWORD|CRED|ANTHROPIC|OPENAI|DEEPSEEK|CLAUDE|CODEX|PROXY/i.test(key)&&!Object.hasOwn(env,key))env[key]=undefined;

// Recheck recorded original process births before touching the prior App data.
const old=[before.originalOwner,before.background,...before.originalProcesses].map(checkExited);
mkdirSync(path,{mode:0o700});
for(const name of ['a05-cold-resume.mjs','contract.mjs','source-proof.mjs'])copyFileSync(new URL(name,import.meta.url),join(path,'source-'+name));
const prompt=newPrompt(randomBytes(16).toString('hex'));
const result={caseId:'M14-A05',status:'failed',sourceCommit:commit,asar,priorAttempt:prior,path,home,userData,work,taskId,
  bindingId,nativeId,old,priorEvidence:{dbSha256:before.dbHash,sidecars:before.sidecars,savedHistory:before.savedHistory,
    runIds:before.state.runs.map(row=>row.run_id),turnIds:before.state.turns.map(row=>row.turn_id)},
  actions:[],requests:[],newMarker:prompt.marker,startedAt:new Date().toISOString()};
let app,listen=false,submission=false,postCount=0,success=false,phase='boot';
result.transportErrors=[];
const socketSet=new Set();
const server=createServer((req,res)=>void transport(req,res).catch(error=>{
  // Keep every relay error; 361 lost the first rejection because later CLI retries overwrote it.
  result.transportErrors.push({at:new Date().toISOString(),post:postCount,error:safeError(error)});
  result.transportError??=safeError(error);
  if(!res.headersSent)res.writeHead(422,{'content-type':'text/plain'});
  res.end('Isolated text-only A05 probe rejected the request or answer');
}));
server.on('connection',socket=>{
  socketSet.add(socket);
  socket.once('close',()=>socketSet.delete(socket));
});

try {
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(3425,'127.0.0.1',()=>{listen=true;resolve()});
  });
  const redirected={};
  app=await openElectron({executable,userData,env,inspectMain:true,startupMainHook:async info=>{
    Object.assign(redirected,await redirectHome({...info,home}));
    assert.equal(redirected.workerInspectorFlagRemoved,true);
  }});
  result.pid=app.processId;
  result.redirected=redirected;
  result.hostBirth=kernel(app.processId);
  assert.equal(result.hostBirth.state,'running');
  assert.notEqual(result.hostBirth.startedAt,before.originalOwner.birth);
  result.identity=await app.mainEvaluate('(() => { const E=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron"); return [E.app.isPackaged,E.app.getPath("home"),E.app.getPath("userData"),process.env.HOME,process.pid,process.execPath,["M14_LIVE_DEEPSEEK_KEY","DEEPSEEK_API_KEY","ANTHROPIC_API_KEY","OPENAI_API_KEY"].every(k=>process.env[k]===undefined)]; })()');
  assert.deepEqual(result.identity,[true,home,userData,home,app.processId,executable,true]);
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  phase='reopen exact original task in the new App';
  const projectTab='[data-testid="sidebar-agent-task"][data-task-id='+JSON.stringify(taskId)+']';
  await click(projectTab);
  await app.waitFor('document.querySelector(".agent-task-head h1")?.textContent === '+JSON.stringify(title),15000);
  const reopened=await app.invoke('agentTasks.snapshot',taskId);
  assert.equal(reopened.cwd,work);
  assert.equal(reopened.run,null,'The recovered task must be idle until an explicit new input');
  assert(known.every(value=>reopened.items.some(item=>item.type==='assistant_message'&&item.payload.text?.trim()===value)));
  const recovered=readState();
  for(const prop of ['bindings','runs','processes','turns','node','providers','transfers'])assert.deepEqual(recovered[prop],before.state[prop],prop);
  assert.equal(postCount,0,'There must be no implicit model replay on cold startup');
  result.reopened={run:null,originalTurns:recovered.turns.map(row=>[row.turn_id,row.status]),oldBackground:recovered.node};
  await app.screenshot(join(path,'01-reopened-same-task.png'));

  phase='submit one real text-only resume in the same task';
  const composer='.agent-task-view .agent-composer textarea';
  await click(composer);
  const target='document.querySelector('+JSON.stringify(composer)+')';
  assert(await app.evaluate('document.activeElement === '+target));
  await app.cdp('Input.insertText',{text:prompt.text});
  await app.waitFor(target+'?.value === '+JSON.stringify(prompt.text),8000);
  submission=true;
  await click('.agent-task-view .agent-composer button[type="submit"]');
  const finished=await until(async()=>{
    const current=await app.invoke('agentTasks.snapshot',taskId);
    const row=readState().turns.find(turn=>turn.input===prompt.text);
    if(row&&['failed','interrupted','unknown','canceled'].includes(row.status))throw Error('Unexpected native termination '+row.status);
    return row?.status==='completed'&&!current.run?.busy&&{row,current};
  },'genuine cold-resumed provider response',65000);
  assert.equal(result.requests.length,1);
  assert.equal(postCount,1);
  assert.equal(result.requests[0].upstreamStatus,200);
  assert.equal(result.requests[0].answer.text,expectedAnswer);
  assert.equal(result.requests[0].upstreamBytesUnchanged,true);
  const state=readState();
  const [newRun]=state.runs.filter(row=>!before.state.runs.some(old=>old.run_id===row.run_id));
  assert.equal(state.runs.length,4);
  assert(newRun&&newRun.run_id===finished.row.run_id);
  assert.equal(newRun.generation,4);
  assert(finished.row.native_turn_id?.startsWith(nativeId+':'));
  assert.equal(newRun.owner_pid,app.processId);
  assert.equal(newRun.owner_started_at,result.hostBirth.startedAt);
  assert.equal(newRun.binding_id,bindingId);
  assert.deepEqual(state.bindings,before.state.bindings);
  assert.deepEqual(state.turns.slice(0,-1),before.state.turns);
  assert.equal(state.turns.length,7);
  assert.equal(state.transfers,0);
  assert(!state.node.some(row=>!row.terminal_state||row.state==='running'));
  const scope='.agent-turn[data-turn-id='+JSON.stringify(finished.row.turn_id)+'] .agent-assistant .agent-md';
  await app.waitFor('Array.from(document.querySelectorAll('+JSON.stringify(scope)+')).at(-1)?.textContent.trim() === '+JSON.stringify(expectedAnswer),10000);
  result.resumed={turn:finished.row,newRun,ownerAtActualRequest:result.requests[0].nativeOwner,newBirth:{pid:newRun.pid,birth:newRun.process_started_at}};
  await app.screenshot(join(path,'02-cold-resumed-real-answer.png'));
  assert.deepEqual(app.rendererErrors,[]);
  success=true;
} catch (error) {
  result.failure={phase,error:safeError(error)};
  if(app)try{await app.screenshot(join(path,'99-failure.png'));}catch{}
} finally {
  if(app)await closeOwnApp();
  if(listen){
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
  result.port3425Released=!server.listening&&![...socketSet].some(socket=>!socket.destroyed);
  if(success&&!result.releaseError)try{
    assert.deepEqual(result.exit,{pid:result.pid,code:0,signal:null});
    const state=readState(true);
    const newRun=state.runs.find(row=>row.run_id===result.resumed.newRun.run_id);
    assert.equal(newRun.state,'stopped');
    assert.deepEqual(state.runs.filter(row=>row.generation<4),before.state.runs);
    const children=state.processes.filter(row=>row.run_id===newRun.run_id);
    assert(children.some(row=>row.kind==='cli'&&row.pid===newRun.pid));
    assert(children.some(row=>row.kind==='bridge'));
    assert(children.every(row=>row.state==='exited'));
    result.exited={run:newRun,pids:[{pid:result.pid,birth:result.hostBirth.startedAt},
      ...children.map(row=>({pid:row.pid,birth:row.process_started_at}))].map(checkExited)};
    const transcript=readFileSync(before.transcript);
    assert.equal(sha(transcript.subarray(0,before.savedHistory.bytes)),before.savedHistory.sha256);
    result.nativeTranscript=nativeHistory(transcript,prompt);
    assert(result.port3425Released&&postCount===1&&!result.transportError);
    result.status='passed';
  }catch(error){result.finalError=safeError(error);}
  writeFileSync(join(path,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({caseId:result.caseId,status:result.status,pid:result.pid,exit:result.exit,
    port3425Released:result.port3425Released,phase:result.failure?.phase,requests:result.requests.length}));
}
process.exitCode=result.status==='passed'?0:2;

async function transport(req,res) {
  assert.equal(req.socket.remoteAddress,'127.0.0.1');
  const url=new URL(req.url,providerOrigin);
  assert.equal(url.origin,providerOrigin);
  if(req.method==='GET'&&['/models','/v1/models'].includes(url.pathname)){
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({data:[{id:model}]}));
    return;
  }
  assert.equal(req.method,'POST');
  assert.equal(url.pathname,'/v1/messages');
  assert(!url.search||url.search==='?beta=true');
  postCount++;
  assert(submission&&postCount===1,'Refused native request outside the one actual new explicit input');
  assert([req.headers.authorization,req.headers['x-api-key']].some(key=>key==='magpie-claude'||key==='Bearer magpie-claude'));
  const chunks=[];
  let size=0;
  for await(const bytes of req){
    size+=bytes.length;
    assert(size<=1024*1024,'Unexpected native payload size');
    chunks.push(bytes);
  }
  const raw=Buffer.concat(chunks);
  const request=modelRequest(raw,prompt);
  const active=readState().runs.find(row=>row.generation===4);
  assert(active&&active.binding_id===bindingId&&active.owner_pid===app.processId&&active.state==='active');
  assert.equal(active.owner_started_at,result.hostBirth.startedAt);
  const original=kernel(active.pid);
  assert.equal(original.state,'running');
  assert.equal(original.startedAt,active.process_started_at);
  const flags=resumeFlag(execFileSync('/bin/ps',['-ww','-p',String(active.pid),'-o','command='],{encoding:'utf8',timeout:3000}));
  assert.deepEqual(flags,{sessionId:nativeId,generatedSessionOption:false},'Actual native Claude process did not use --resume for the original ID');
  assert.deepEqual(kernel(active.pid),original,'Native CLI process identity changed while reading its resume flag');
  Object.assign(request,{nativeOwner:{pid:active.pid,birth:active.process_started_at,...flags},upstreamAttempt:true});
  result.requests.push(request);
  const headers={'content-type':'application/json',authorization:'Bearer '+secret,
    'anthropic-version':req.headers['anthropic-version']??'2023-06-01'};
  if(req.headers['anthropic-beta'])headers['anthropic-beta']=req.headers['anthropic-beta'];
  const response=await fetch(upstream,{method:'POST',headers,body:raw,redirect:'error',signal:AbortSignal.timeout(48000)});
  request.upstreamStatus=response.status;
  assert.equal(response.status,200,'Upstream did not accept the actual resume request');
  assert(response.headers.get('content-type')?.includes('text/event-stream'));
  const responseChunks=[];
  let responseSize=0;
  for await(const bytes of response.body){
    responseSize+=bytes.length;
    assert(responseSize<=768*1024,'Unexpected provider response size');
    responseChunks.push(bytes);
  }
  const responseBytes=Buffer.concat(responseChunks);
  request.answer=verifySse(responseBytes);
  request.upstreamBytesUnchanged=true;
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.end(responseBytes);
}

function kernel(pid){
  assert(Number.isSafeInteger(pid)&&pid>1);
  return JSON.parse(execFileSync(nativeHelper,[String(pid)],{encoding:'utf8',timeout:3000}));
}
function checkExited({pid,birth}){
  assert.match(birth,/^darwin-proc-v1:\d+:\d+$/);
  const now=kernel(pid);
  assert(now.state==='stopped'||(now.state==='running'&&now.startedAt!==birth),
    'Recorded previous isolated process identity still alive '+pid);
  return {pid,birth,state:now.state,originalExited:true};
}
function safeError(error){return String(error?.message??error).replaceAll(secret,'[redacted]');}

async function until(probe,label,timeout=14000) {
  const end=Date.now()+timeout;
  do {
    if(result.transportError)throw Error(result.transportError);
    const found=await probe();
    if(found)return found;
    await pause(100);
  } while(Date.now()<end);
  throw Error('Timed out waiting for '+label);
}
async function click(selector){
  const point=await until(()=>app.evaluate('(() => {const items=[...document.querySelectorAll('+JSON.stringify(selector)+')].filter(e=>e.getBoundingClientRect().height>0); if(items.length!==1||items[0].matches(":disabled,[aria-disabled=true]"))return null; const e=items[0];e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null;})()'),'one visible click target '+selector);
  for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...point});
  result.actions.push({selector,...point,at:new Date().toISOString()});
}
async function closeOwnApp(){
  try{
    await app.mainEvaluate('(() => { const E=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");if(process.pid!=='+app.processId+'||E.app.getPath("userData")!=='+JSON.stringify(userData)+')throw Error("Wrong process");setTimeout(()=>E.app.quit(),50);return true;})()');
  }catch(error){result.quitRequestError=safeError(error);}
  try{
    result.exit=await app.waitForExit(25000);
    assert.deepEqual(result.exit,{pid:app.processId,code:0,signal:null});
    assert(!result.quitRequestError);
  }catch(error){
    result.releaseError=safeError(error);
    try{result.fallback=await app.crash();}catch(failure){result.fallbackError=safeError(failure);}
  }
  result.rendererErrors=app.rendererErrors;
}

