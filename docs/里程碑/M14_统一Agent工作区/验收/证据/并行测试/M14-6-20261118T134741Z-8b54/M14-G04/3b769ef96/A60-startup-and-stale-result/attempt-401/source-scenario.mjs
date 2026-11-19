import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash,randomUUID } from 'node:crypto';
import { chmodSync,copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { openElectron,pause } from '../../g03/prep-fef791bc6/electron-harness.mjs';
import { redirectHome } from '../../g03/prep-fef791bc6/home-redirect-main.mjs';
import { isM14PreEntryRun } from '../../g03/prep-fef791bc6/electron-isolation-paths.mjs';
import { targetNotices } from './gate-lib.mjs';
import { createFlow,delivered,firstDone,models,nextDone,original,restart,rework,start } from './native-flow.mjs';

const base='/private/tmp/willyou-m14-stage6.WRvdST';
const [out,commit,asar]=process.argv.slice(2);
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
const result={caseId:'M14-A60',sourceCommit:commit,asar,layer:'A native App and real Codex with local scripted Responses',
  scenario:'strict stale child and legal rework to current run',actions:[],requests:[],passed:false};
for(const name of ['scenario.mjs','gate-lib.mjs','git-wrapper.mjs','native-flow.mjs']) copyFileSync(new URL(name,import.meta.url),join(out,'source-'+name));
let app,appTrusted=false,flow,parent,phase='isolated setup',listening=false,scope;
const control=join(root,'gate'),repo=join(root,'repo');
mkdirSync(control,{mode:0o700});mkdirSync(repo,{mode:0o700});
for(const name of ['gate-lib.mjs','git-wrapper.mjs']) copyFileSync(new URL(name,import.meta.url),join(control,name));
const gitWrapper=join(control,'git');
writeFileSync(gitWrapper,'#!/bin/sh\nexec '+JSON.stringify('/Users/liubu/.local/bin/node')+' '+JSON.stringify(join(control,'git-wrapper.mjs'))+' "$@"\n',{mode:0o700});
chmodSync(gitWrapper,0o700);
const git=(cwd,...args)=>execFileSync('/usr/bin/git',['-C',cwd,...args],{encoding:'utf8',env:{...process.env,...env}}).trim();
env.PATH=control+':'+process.env.PATH;
const gateFile=name=>{const path=join(control,name);return existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null;};
function release(){if(scope&&!existsSync(join(control,'release')))writeFileSync(join(control,'release'),scope.nonce,{flag:'wx',mode:0o600});}
const selected=selector=>'document.querySelector('+JSON.stringify(selector)+')';
const state=id=>app.invoke('agentTasks.snapshot',id);
const relations=id=>app.invoke('agentTasks.relations',id);
const nativeIdentity=pid=>JSON.parse(execFileSync(reader,[String(pid)],{encoding:'utf8',timeout:3000}));

function providerResponse(res,model,{answer,call}){
  res.writeHead(200,{'content-type':'text/event-stream'});
  const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
  const id='resp_'+randomUUID();
  const item=call?{id:'fc_'+randomUUID(),type:'function_call',call_id:call.callId,...(call.tool.namespace?{namespace:call.tool.namespace}:{}),
    name:call.tool.name,arguments:JSON.stringify(call.args),status:'completed'}:
    {id:'msg_'+randomUUID(),type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]};
  event('response.created',{response:{id,status:'in_progress',output:[]}});
  event('response.output_item.added',{output_index:0,item:{...item,status:'in_progress'}});
  if(!call)event('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:answer});
  event('response.output_item.done',{output_index:0,item});
  event('response.completed',{response:{id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});
  res.end();
}
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
function sql(query,args=[]){
  const db=join(data,'smartdd.db');assert.equal(realpathSync(db),db);
  const py='import sqlite3,json,pathlib,sys;c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro",uri=True);c.row_factory=sqlite3.Row;print(json.dumps([dict(r) for r in c.execute(sys.argv[2],json.loads(sys.argv[3]))]))';
  return JSON.parse(execFileSync('/usr/bin/python3',['-c',py,db,query,JSON.stringify(args)],{encoding:'utf8',timeout:10000}));
}


const server=createServer(async(req,res)=>{
  try{
    assert.equal(req.socket.remoteAddress,'127.0.0.1');
    const url=new URL(req.url,origin);
    assert.equal(url.origin,origin);
    if(req.method==='GET'&&['/models','/v1/models'].includes(url.pathname)){
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({data:Object.values(models).map(id=>({id}))}));
      return;
    }
    const protocol=url.pathname==='/v1/responses'?'codex':null;
    if(req.method!=='POST'||!protocol){res.statusCode=404;res.end();return;}
    const publicToken='magpie-'+protocol;
    assert([req.headers.authorization,req.headers['x-api-key']].some(key=>key===publicToken||key==='Bearer '+publicToken));
    let size=0;const chunks=[];
    for await(const bytes of req){size+=bytes.length;assert(size<2*1024*1024);chunks.push(bytes);}
    const payload=JSON.parse(Buffer.concat(chunks));
    assert(Object.values(models).includes(payload.model));
    const row={at:Date.now(),protocol,model:payload.model};
    result.requests.push(row);
    const action=await flow.next(protocol,payload);
    Object.assign(row,{type:action.type,tool:action.call?.tool.name??null,callId:action.call?.callId??null,answeredAt:Date.now()});
    if(!res.destroyed)providerResponse(res,payload.model,action);
  }catch(error){
    result.serverError=String(error.stack??error);
    if(!res.headersSent)res.statusCode=400;
    res.end();
  }
});

function asOf(parentId,childId){
  const attempts=sql(`SELECT a.attempt_id,a.ordinal,a.kind,a.notified_at,a.commit_range,a.child_turn_id,d.delivery_state,w.path
    FROM agent_delegations d JOIN agent_delegation_attempts a ON a.delegation_id=d.delegation_id
    JOIN agent_workspaces w ON w.child_task_id=d.child_task_id
    WHERE d.parent_task_id=? AND d.child_task_id=? ORDER BY a.ordinal`,[parentId,childId]);
  const notifications=sql(`SELECT payload_ref FROM agent_items WHERE task_id=? AND type='notification'
    AND json_extract(payload_ref,'$.sourceKind')='child_result' ORDER BY rowid`,[parentId]).map(row=>JSON.parse(row.payload_ref));
  const turns=sql("SELECT client_input_id,run_id,status FROM agent_turns WHERE task_id=? AND client_input_id LIKE 'result-%' ORDER BY accepted_at",[parentId]);
  return {attempts,notifications,turns};
}
const runRows=taskId=>sql('SELECT run_id,binding_id,generation,state,pid,process_started_at FROM capability_runs WHERE task_id=? ORDER BY started_at',[taskId]);
const hasText=(snap,text)=>snap.items.some(item=>item.type==='assistant_message'&&item.payload?.text===text);

async function setup(){
  git(repo,'init','-qb','main');
  writeFileSync(join(repo,'base.txt'),'A60 synthetic original source\n');
  git(repo,'add','base.txt');
  git(repo,'-c','user.name=Fixture','-c','user.email=a60@example.invalid','-c','commit.gpgsign=false','commit','-qm','baseline');
  const head=git(repo,'rev-parse','HEAD');
  result.repo={head,root:repo};
  assert.equal(git(repo,'remote'),'');
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3425,'127.0.0.1',()=>{listening=true;resolve()});});
  const boot={};
  app=await openElectron({executable,userData:data,env,inspectMain:true,
    startupMainHook:async info=>Object.assign(boot,await redirectHome({...info,home}))});
  const identity=await app.mainEvaluate('(() => {const E=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");return [E.app.isPackaged,E.app.getPath("userData"),E.app.getPath("home"),process.execPath,process.pid,process.env.PATH.split(":")[0]]})()');
  assert.deepEqual(identity,[true,data,home,executable,app.processId,control]);
  assert(boot.workerInspectorFlagRemoved);
  appTrusted=true;
  result.app={pid:app.processId,identity,boot,birth:nativeIdentity(app.processId)};
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await app.invoke('agents.refreshTools');
  const native=(await app.invoke('agents.tools')).find(tool=>tool.kind==='codex'&&tool.installed&&tool.version==='0.169.0');
  assert(native,'Actual Codex 0.169.0 required');
  const profiles={};
  for(const [role,model] of Object.entries(models)){
    const provider=await app.invoke('agents.saveProvider',{name:'A60 local '+role,preset:'magpie',
      endpoints:{responses:origin+'/v1'},models:[{id:model,name:model}]});
    const profile=await app.invoke('agents.save',{name:'A60 '+role+' Codex',toolId:native.id,source:'provider',
      providerId:provider.id,models:[model],defaultModel:model,isDefault:role==='parent'});
    profiles[role]=profile.id;
  }
  const project=await app.invoke('projects.create',{name:'A60 exact private Git',aliases:[],description:'',rulesPath:null},[{label:'work',path:repo}]);
  const parentTitle='A60 exact current parent';
  const created=await app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,cwd:repo,title:parentTitle,
    profileId:profiles.parent,model:models.parent,tier:'ask'});
  parent={taskId:created.taskId,title:parentTitle};
  flow=createFlow({targetId:profiles.child});
  await click('[data-testid="nav-settings"]');
  const toggle='[data-testid="m14-toggle"]';
  if(!await app.evaluate('Boolean('+selected(toggle)+')'))await click('.settings-nav button.nav-row','常规');
  if(!await app.evaluate(selected(toggle)+'?.innerText.includes("已开启")'))await click(toggle);
  await app.waitFor(selected(toggle)+'?.innerText.includes("已开启")',14000);
  await click('[data-testid="nav-home"]');
  await open(parent);
  await click('[data-testid="agent-delegation-toggle"]');
  await app.waitFor(selected('[data-testid="agent-delegation-toggle"]')+'?.getAttribute("aria-pressed")==="true"',12000);
  return {profiles,head};
}

async function execute(profiles,head){
  phase='real first parent delegates a registered worktree and finishes';
  await send(start);
  const receipt=await until(()=>flow.state.firstReceipt&&flow.state.initialEntered&&flow.state.firstReceipt,'first native child accepted and request held');
  const parentId=parent.taskId,childId=receipt.childTaskId;
  result.family={parentId,childId,delegationId:receipt.delegationId};
  const first=await until(async()=>{
    const snap=await state(parentId);
    return !snap.run?.busy&&hasText(snap,firstDone)&&runRows(parentId).at(-1);
  },'original owner idle after real first parent response');
  assert.equal(receipt.baseCommit,head);
  const before=asOf(parentId,childId);
  assert.equal(before.attempts.length,1);
  const [firstAttempt]=before.attempts;
  assert.equal(firstAttempt.delivery_state,'running');
  assert.equal(firstAttempt.notified_at,null);
  const worktree=firstAttempt.path;
  assert(worktree.startsWith(join(home,'.willyou/worktrees')+'/')&&realpathSync(worktree)===worktree);
  assert.equal(git(worktree,'rev-parse','HEAD'),head);
  scope={nonce:randomUUID(),worktree,base:head,head};
  writeFileSync(join(control,'scope.json'),JSON.stringify(scope),{flag:'wx',mode:0o600});

  phase='hold the last real Git statistic after the original child completed';
  flow.state.childInitial.release();
  const gate=await until(()=>gateFile('ready.json'),'final readonly worktree Git subprocess gated');
  assert.deepEqual(gate.args,['diff','--stat',head,head]);
  assert.equal(gate.cwd,worktree);
  assert.equal(gate.status,0);
  assert.equal(gate.parentPid,app.processId);
  const birth=nativeIdentity(gate.pid);
  assert.equal(birth.state,'running');
  assert.ok(birth.startedAt);
  const beforeCancel=asOf(parentId,childId);
  assert.equal(beforeCancel.attempts[0].notified_at,null);
  assert.equal(beforeCancel.attempts[0].commit_range,null);
  assert.deepEqual(beforeCancel.notifications,[]);
  assert.equal(sql('SELECT status FROM agent_turns WHERE turn_id=?',[firstAttempt.child_turn_id])[0]?.status,'completed');
  assert.deepEqual(runRows(childId).filter(row=>row.state==='active'),[]);
  result.gate={...gate,birth,oldParentRun:first,oldChildRun:runRows(childId).at(-1),firstAttempt};

  phase='genuine parent relationship control cancels this old attempt during finalization';
  const lineage='.agent-lineage-toggle';
  if(!await app.evaluate('Boolean('+selected('.agent-lineage')+')'))await click(lineage);
  const cancel=`.agent-lineage .agent-child-card[data-child-id="${childId}"] button[aria-label^="停止子任务"]`;
  await click(cancel);
  await until(async()=> (await relations(parentId)).children.some(child=>child.childTaskId===childId&&child.state==='canceled'),'actual family cancellation');
  assert.equal(gateFile('forwarded.json'),null);

  phase='real Provider switch starts a different run and authenticates wy_send rework';
  await click('.agent-model-pill');
  await click('.agent-picker-rail button','A60 next Codex');
  await click('.agent-model-row',models.next);
  await until(async()=> (await state(parentId)).selection.profileId===profiles.next,'new parent Provider selected in UI');
  await send(restart);
  const current=await until(async()=>{
    const snap=await state(parentId);
    const live=runRows(parentId).at(-1);
    return flow.state.secondReceipt&&!snap.run?.busy&&hasText(snap,nextDone)&&live;
  },'completed caller in different actual parent run with genuine rework receipt');
  assert.notEqual(current.run_id,first.run_id);
  assert.notEqual(current.binding_id,first.binding_id);
  assert.equal(current.state,'active');
  const beforeRelease=asOf(parentId,childId);
  assert.equal(beforeRelease.attempts.length,2);
  assert.equal(beforeRelease.attempts[1].attempt_id,flow.state.secondReceipt.attemptId);
  assert.equal(beforeRelease.attempts[1].kind,'rework');
  assert.deepEqual(beforeRelease.notifications,[]);
  assert.deepEqual(beforeRelease.turns,[]);
  assert.equal(gateFile('forwarded.json'),null);
  assert.deepEqual(nativeIdentity(gate.pid),birth);
  result.beforeRelease={current,receipt:flow.state.secondReceipt,...beforeRelease};
  await app.screenshot(join(out,'01-current-run-before-old-release.png'));

  phase='release actual old completion and verify no stale route while new child request is held';
  release();
  const forwarded=await until(()=>gateFile('forwarded.json'),'Git returns the original result after approved test release');
  assert.equal(forwarded.released,true);
  assert.equal(forwarded.pid,gate.pid);
  const absent=await until(()=>{
    const now=asOf(parentId,childId);
    return now.attempts[0].commit_range&&flow.state.reworkEntered&&now;
  },'old finalize resumes and the current child reaches its real native input');
  assert.equal(absent.attempts[0].notified_at,null);
  assert.deepEqual(absent.notifications,[]);
  assert.deepEqual(absent.turns,[]);
  assert.deepEqual(flow.state.routes,[]);
  result.afterOld={forwarded,...absent,childRun:runRows(childId).at(-1)};

  phase='true rework produces one legal current-parent notification and actual next native answer';
  flow.state.childRework.release();
  const after=await until(async()=>{
    const snap=await state(parentId),now=asOf(parentId,childId);
    return !snap.run?.busy&&hasText(snap,delivered)&&now;
  },'real current native run receives exactly one child rework notification');
  assert.equal(runRows(parentId).at(-1).run_id,current.run_id);
  targetNotices(beforeRelease,after,flow.state.routes,current.run_id);
  const payload=after.notifications[0];
  assert.equal(payload.summary,rework);
  assert.ok(!payload.summary.includes(original));
  assert.equal(git(repo,'rev-parse','HEAD'),head);
  assert.equal(git(repo,'status','--porcelain'),'');
  result.after={...after,nativeRoutes:flow.state.routes,sourceHead:head};
  await app.screenshot(join(out,'02-only-current-native-child-result.png'));
}

try {
  const {profiles,head}=await setup();
  await execute(profiles,head);
  result.passed=true;
}catch(error){
  result.failure={phase,error:String(error.stack??error)};
  if(appTrusted)try{result.visible=await app.evaluate('document.body.innerText.slice(0,12000)');await app.screenshot(join(out,'99-failure.png'));}catch{}
}finally{
  release();
  flow?.close();
  if(app){
    try{
      const live=await app.invoke('agentTasks.list');
      result.beforeQuit=live.map(({taskId,status})=>({taskId,status}));
      if(appTrusted&&live.some(task=>task.status==='working'||task.status==='waiting')){
        result.cleanupMadeIdle=true;
        // Failure cleanup only. Business pass requires natural idle and raw exit.
        if(parent)await app.invoke('agentTasks.stop',parent.taskId,true);
      }
      await app.mainEvaluate('(() => {const E=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");if(process.pid!=='+app.processId+'||E.app.getPath("userData")!=='+JSON.stringify(data)+')throw Error("Wrong isolated app");setTimeout(()=>E.app.quit(),25);return true})()');
      result.exit=await app.waitForExit(24000);
    }catch(error){
      result.quitError=String(error);
      try{result.forced=await app.crash();}catch(e){result.cleanupError=String(e);}
    }
    result.rendererErrors=app.rendererErrors;
    writeFileSync(join(out,'app.log'),app.logs(),{mode:0o600});
    try{
      const observed=[result.app?.birth,result.gate?.birth];
      const rows=sql('SELECT pid,process_started_at FROM capability_run_processes WHERE pid IS NOT NULL AND run_id IN (SELECT run_id FROM capability_runs WHERE owner_pid=?)',[app.processId]);
      observed.push(...rows.map(row=>({pid:row.pid,startedAt:row.process_started_at})));
      result.exactProcessesAfter=observed.filter(Boolean).map(born=>({born,after:nativeIdentity(born.pid)}));
    }catch(error){result.cleanupProofError=String(error);}
  }
  if(listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  result.listenerClosed=!server.listening;
  result.flow=flow?.state&&{firstPhase:flow.state.firstPhase,nextPhase:flow.state.nextPhase,initialEntered:flow.state.initialEntered,reworkEntered:flow.state.reworkEntered,routes:flow.state.routes};
  result.passed=Boolean(result.passed&&result.exit?.code===0&&result.exit.signal===null&&!result.cleanupMadeIdle&&!result.rendererErrors?.length&&result.listenerClosed&&
    result.exactProcessesAfter?.length>=4&&result.exactProcessesAfter.every(({born,after})=>born.startedAt&&(after.state==='stopped'||after.state==='running'&&after.startedAt!==born.startedAt)));
  writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({out,passed:result.passed,phase,exit:result.exit,error:result.failure}));
}
if(!result.passed)process.exitCode=2;
