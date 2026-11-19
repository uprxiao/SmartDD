import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { openElectron, pause } from '../../prep-fef791bc6/electron-harness.mjs';
import { redirectHome } from '../../prep-fef791bc6/home-redirect-main.mjs';
import { kindNames, prepareWorkspace } from '../a31-recheck/fixtures.mjs';
import { createWorkflow, files, marker, models } from './protocol.mjs';
import { businessFixture, businessGate, seedBusiness } from './business/harness.mjs';

const base='/private/tmp/willyou-m14-stage6.WRvdST';
const [out,commit,asar,kind,parentKind,axis='foreground']=process.argv.slice(2);
const bundle=join(base,'package/mac-arm64/WillYou.app/Contents'), executable=process.env.M14_ACCEPTANCE_APP;
const cli=process.env.M14_SMOKE_CLAUDE, reader=join(bundle,'Resources/native/willyou-process-identity');
const childKind=parentKind==='codex'?'claude':'codex',background=axis==='background',isBusiness=axis==='business';
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
assert.match(out??'',/^\/private\/tmp\/willyou-m14-stage6\.WRvdST\/g03\/attempt-[0-9]+$/);
assert.match(commit??'',/^[0-9a-f]{40}$/);assert.match(asar??'',/^[0-9a-f]{64}$/);
assert(kindNames.includes(kind)&&['codex','claude'].includes(parentKind)&&['foreground','background','business'].includes(axis));
assert(!(background||isBusiness)||parentKind==='claude');
assert.equal(executable,join(bundle,'MacOS/WillYou'));assert.equal(realpathSync(executable),executable);
assert.equal(realpathSync(reader),reader);
assert.match(cli??'',/^\/Users\/[^/]+\/\.local\/share\/claude\/versions\/2\.1\.326$/);
assert.equal(realpathSync(cli),cli);
assert.equal(readFileSync(join(base,'source-commit.txt'),'utf8').trim(),commit);
assert.equal(sha(join(bundle,'Resources/app.asar')),asar);
mkdirSync(out,{mode:0o700});
const root=realpathSync(mkdtempSync(join(out,'runtime-'))),home=join(root,'home'),data=join(root,'data');
mkdirSync(home,{mode:0o700});mkdirSync(data,{mode:0o700});
const env={HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),TMPDIR:root,
  XDG_CONFIG_HOME:join(home,'.config'),XDG_DATA_HOME:join(home,'.local/share'),XDG_CACHE_HOME:join(home,'.cache'),
  GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',ENABLE_TOOL_SEARCH:'false',
  NO_PROXY:'127.0.0.1,localhost',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1'};
const origin='http://127.0.0.1:3425';
const result={sourceCommit:commit,asar,candidate:executable,kind,parentKind,childKind,axis,actions:[],requests:[],approved:[],passed:false,
  layer:'A factual packaged UI/native, isolated provider synthesis'};
let app,appTrusted=false,phase='fixture and private app',flow,cwd,fixture,parent,leaseGate;
const selected=(selector)=>'document.querySelector('+JSON.stringify(selector)+')';
const state=id=>app.invoke('agentTasks.snapshot',id);
const relations=id=>app.invoke('agentTasks.relations',id);
const modelIds=Object.values(models).flatMap(Object.values);

function providerResponse(res,protocol,model,{answer,call}){
  res.writeHead(200,{'content-type':'text/event-stream'});
  const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
  if(protocol==='claude'){
    event('message_start',{message:{id:'msg_'+randomUUID(),type:'message',role:'assistant',model,content:[],stop_reason:null,
      usage:{input_tokens:1,output_tokens:0}}});
    event('content_block_start',{index:0,content_block:call?
      {type:'tool_use',id:call.callId,name:call.tool.name,input:{}}:{type:'text',text:''}});
    event('content_block_delta',{index:0,delta:call?{type:'input_json_delta',partial_json:JSON.stringify(call.args)}:{type:'text_delta',text:answer}});
    event('content_block_stop',{index:0});
    event('message_delta',{delta:{stop_reason:call?'tool_use':'end_turn'},usage:{output_tokens:1}});
    event('message_stop',{});
  }else{
    const id='resp_'+randomUUID();
    const item=call?{id:'fc_'+randomUUID(),type:'function_call',call_id:call.callId,...(call.tool.namespace?{namespace:call.tool.namespace}:{}),
      name:call.tool.name,arguments:JSON.stringify(call.args),status:'completed'}:
      {id:'msg_'+randomUUID(),type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]};
    event('response.created',{response:{id,status:'in_progress',output:[]}});
    event('response.output_item.added',{output_index:0,item:{...item,status:'in_progress'}});
    if(!call)event('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:answer});
    event('response.output_item.done',{output_index:0,item});
    event('response.completed',{response:{id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});
  }
  res.end();
}
const server=createServer(async(req,res)=>{
  try{
    if(req.method==='GET'&&req.url?.endsWith('/models')){
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({data:modelIds.map(id=>({id}))}));
      return;
    }
    const protocol=req.url?.includes('/messages')?'claude':req.url?.includes('/responses')?'codex':null;
    if(req.method!=='POST'||!protocol){res.statusCode=404;res.end();return;}
    let size=0;const chunks=[];
    for await(const chunk of req){size+=chunk.length;assert(size<4*1024*1024);chunks.push(chunk);}
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const request={at:Date.now(),protocol,model:body.model,bytes:size};
    result.requests.push(request);
    const action=await flow.next(protocol,body);
    Object.assign(request,{role:action.role,tool:action.name??null,callId:action.call?.callId??null,answeredAt:Date.now()});
    if(!res.destroyed)providerResponse(res,protocol,body.model,action);
  }catch(error){
    result.serverError=String(error.stack??error);
    if(!res.headersSent)res.statusCode=500;
    res.end();
  }
});

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
const approval='.agent-request-options button:is([aria-label="批准"],[aria-label*="批准一次"])';
async function approvalIfNeeded(task){
  const snap=await state(task.taskId);
  const own=snap.requests.find(r=>r.class==='native'&&!r.targetTaskTitle&&r.kind==='command_approval');
  if(!own||result.approved.some(r=>r.id===own.requestId))return;
  const request=JSON.stringify(own.payload);
  assert(request.includes(cwd)&&request.includes('a32-'),'approval belongs to the hard-coded private operation');
  if(!isBusiness){
    if(!await app.evaluate('Boolean('+selected(approval)+')'))return;
    await click(approval);
    await click('.agent-confirm-choice');
    result.approved.push({taskId:task.taskId,id:own.requestId,kind:own.kind});
    return;
  }
  const candidate=own.payload.input?.command??own.payload.params?.command;
  const command=Array.isArray(candidate)?candidate.join(' '):candidate;
  assert.equal(typeof command,'string','approval exposes the exact command');
  const visual=()=>app.evaluate(`(() => {
    const request=document.querySelector('.agent-request');
    return {command:request?.querySelector('.agent-request-detail')?.textContent.includes(${JSON.stringify(command)})??false,
      next:!!request?.querySelector('.agent-request-nav button:last-of-type'),
      approve:!!request?.querySelector(${JSON.stringify(approval)})};
  })()`);
  let current=await visual();
  if(!current.command&&current.next&&isBusiness){
    await click('.agent-request-nav button:last-of-type');
    current=await visual();
  }
  if(!current.command||!current.approve)return;
  await click(approval);
  await click('.agent-confirm-choice');
  result.approved.push({taskId:task.taskId,id:own.requestId,kind:own.kind});
}
function sql(query,args=[]){
  const db=join(data,'smartdd.db');assert.equal(realpathSync(db),db);
  const py='import sqlite3,json,pathlib,sys;c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro",uri=True);c.row_factory=sqlite3.Row;print(json.dumps([dict(r) for r in c.execute(sys.argv[2],json.loads(sys.argv[3]))]))';
  return JSON.parse(execFileSync('/usr/bin/python3',['-c',py,db,query,JSON.stringify(args)],{encoding:'utf8',timeout:10000}));
}
const queue=id=>sql('SELECT * FROM agent_directory_queue WHERE task_id=? ORDER BY rowid DESC LIMIT 1',[id])[0];
const run=id=>sql('SELECT run_id,generation,pid,binding_id,process_started_at,state,ended_at FROM capability_runs WHERE run_id=?',[id])[0];
const bind=id=>sql('SELECT binding_id,native_id FROM agent_bindings WHERE task_id=?',[id]);
const userInput=(id,text)=>sql("SELECT turn_id,status,run_id,native_turn_id,started_at FROM agent_turns WHERE task_id=? AND json_extract(input_ref,'$.text')=?",[id,text])[0];
const runsFor=id=>sql('SELECT run_id,pid FROM capability_runs WHERE task_id=?',[id]);
const terminal=r=>r?.ended_at&&['stopped','failed'].includes(r.state);
const localFile=name=>join(cwd,files[name]);
function publishMark(name){
  const path=localFile(name);
  if(!existsSync(path))writeFileSync(path,marker(name)+'\n',{mode:0o600,flag:'wx'});
}
function kernel(pid){
  assert(Number.isSafeInteger(pid)&&pid>1);
  const info=JSON.parse(execFileSync(reader,[String(pid)],{encoding:'utf8',timeout:3000}));
  if(info.state==='running')assert(info.pid===pid&&typeof info.startedAt==='string');
  return info;
}
function childState(view,id){return view.children.find(c=>c.childTaskId===id);}
function noChildRun(task){
  assert.deepEqual(runsFor(task.taskId),[]);
  assert(!result.requests.some(r=>r.model===task.model));
}
async function setup(){
  fixture=prepareWorkspace(root,home,{PATH:process.env.PATH,LANG:'en_US.UTF-8',...env},kind);
  cwd=fixture.common;
  result.workspace={cwd,root:fixture.canonical,revision:fixture.revision};
  if(isBusiness){
    phase='install exact no-connection local plugin through production fixture seed';
    result.business={seed:seedBusiness({out,root,executable,asar,commit})};
    leaseGate=businessGate(data);
    assert(!leaseGate.read());
  }
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3425,'127.0.0.1',resolve);});
  const boot={};
  app=await openElectron({executable,userData:data,env,inspectMain:true,startupMainHook:async info=>Object.assign(boot,await redirectHome({...info,home}))});
  const found=await app.mainEvaluate(`(() => {const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    return [E.app.isPackaged,E.app.getPath('userData'),E.app.getPath('home'),process.env.HOME,process.execPath,process.pid]})()`);
  assert.deepEqual(found,[true,data,home,home,executable,app.processId]);
  appTrusted=true;result.app={pid:app.processId,boot,identity:found};
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await app.invoke('agents.refreshTools');
  const custom=await app.invoke('agents.customToolPath','claude',cli);
  assert(custom.tool?.installed&&custom.tool.version==='2.1.326');
  const tools=await app.invoke('agents.tools');
  assert(tools.some(x=>x.kind==='codex'&&x.installed&&x.version==='0.169.0'));
  result.native=tools.filter(x=>['codex','claude'].includes(x.kind)&&x.installed).map(x=>[x.kind,x.version]);
  const provider=await app.invoke('agents.saveProvider',{name:'A32 isolated loopback',preset:'magpie',
    endpoints:{responses:origin+'/v1',anthropic:origin+'/'},models:modelIds.map(id=>({id,name:id}))});
  const profiles={};
  for(const kind of ['codex','claude']){
    const native=tools.find(x=>x.kind===kind&&x.installed);
    const profile=await app.invoke('agents.save',{name:'A32 '+kind,toolId:native.id,source:'provider',providerId:provider.id,
      models:Object.values(models[kind]),defaultModel:models[kind].parent,isDefault:parentKind===kind});
    profiles[kind]=profile.id;
  }
  flow=createWorkflow({parentKind,childKind,profiles,cwd,background,business:isBusiness?businessFixture:undefined});
  const project=await app.invoke('projects.create',{name:'A32 local '+kind,aliases:[],description:'',rulesPath:null},[{label:'private',path:cwd}]);
  const title='A32 '+kind+' '+parentKind+' writer parent';
  const created=await app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,cwd,title,profileId:profiles[parentKind],
    model:models[parentKind].parent,tier:'ask'});
  parent={taskId:created.taskId,title,projectId:project.id};
  if(isBusiness){
    const seed=result.business.seed,cap={appId:businessFixture.appId,packageHash:seed.installed.hash};
    const catalog=await app.invoke('applications.pluginCatalog');
    assert(catalog.ok&&catalog.value.some(p=>p.appId===cap.appId&&p.hash===cap.packageHash&&p.installed&&p.enabled));
    const projectSettings=await app.invoke('applications.pluginProjectSettings',cap,project.id);
    assert(projectSettings.ok&&projectSettings.value.enabled===1);
    assert.equal(projectSettings.value.connectionId,null);
    assert.equal(projectSettings.value.defaultConnectionId,null);
  }
  await click('[data-testid="nav-settings"]');
  const toggle='[data-testid="m14-toggle"]';
  if(!await app.evaluate('Boolean('+selected(toggle)+')'))await click('.settings-nav button.nav-row','常规');
  if(!await app.evaluate(selected(toggle)+'?.innerText.includes("已开启")'))await click(toggle);
  await app.waitFor(selected(toggle)+'?.innerText.includes("已开启")',10000);
  await click('[data-testid="nav-home"]');
  await open(parent);
  const delegate='[data-testid="agent-delegation-toggle"]';
  await click(delegate);
  await app.waitFor(selected(delegate)+'?.getAttribute("aria-pressed")==="true"',12000);
}
async function execute(){
  const s=flow.s;
  phase='accept two real child requests asynchronously during original parent round';
  await send(marker('start'));
  await until(()=>s.parentHeld&&s.receipts.writer&&s.receipts.cancel,'both real wire receipts observed');
  const initial=await state(parent.taskId);
  assert(initial.run?.busy);
  const parentRun=run(initial.run.runId),initialBindings=bind(parent.taskId);
  assert.equal(initialBindings.length,1);
  assert.equal(initialBindings[0].binding_id,parentRun.binding_id);
  assert(initialBindings[0].native_id);
  result.originalParent={run:parentRun,binding:initialBindings[0]};
  const child=role=>({taskId:s.receipts[role].childTaskId,title:'A32 '+role+' '+childKind,model:models[childKind][role]});
  const writer=child('writer'),cancel=child('cancel');
  assert.equal((await state(writer.taskId)).cwd,cwd);
  assert.equal((await state(cancel.taskId)).cwd,cwd);
  assert.equal(queue(writer.taskId).state,'queued');
  noChildRun(writer);noChildRun(cancel);
  result.receipts=s.receipts;

  phase='queue a real later parent input and cancel only the second waiting writer from the relation card';
  const after=marker('resume');
  await send(after);
  const queued=await until(()=>{const q=userInput(parent.taskId,after);return q?.status==='accepted'&&q;},'later parent input queued');
  assert.equal(queued.run_id,null);
  result.queuedUserTurn=queued;
  await click('.agent-lineage-toggle');
  const cancelSelector=`[data-child-id="${cancel.taskId}"] button[aria-label^="停止子任务"]`;
  await click(cancelSelector);
  await until(async()=>(await relations(parent.taskId)).children.some(c=>c.childTaskId===cancel.taskId&&c.state==='canceled'),'real UI cancellation persisted');
  assert.equal(queue(cancel.taskId).state,'canceled');
  assert((await state(parent.taskId)).run?.busy);
  assert.equal(queue(writer.taskId).state,'queued');
  result.canceled={child:cancel,queue:queue(cancel.taskId)};
  await app.screenshot(join(out,'10-queued-and-one-canceled.png'));
  s.parentGate.release();

  phase='hold the exact real native foreground tool, then let parent continue writing and end';
  await until(async()=>{await approvalIfNeeded(parent);return existsSync(localFile('foregroundStarted'));},'native parent command started');
  assert((await state(parent.taskId)).run?.busy);
  assert(!existsSync(localFile('parent')));
  noChildRun(writer);
  assert.equal(queue(writer.taskId).state,'queued');
  assert.equal(userInput(parent.taskId,after).status,'accepted');
  result.foregroundTool={parentStillBusy:true,writerNotDispatched:true,scope:parentRun.run_id};
  await app.screenshot(join(out,'15-native-parent-tool-holds-child.png'));
  publishMark('foregroundRelease');

  if(background){
    phase='original foreground ends but exact Claude background process still owns the boundary';
    const held=await until(async()=>{
      await approvalIfNeeded(parent);
      const turn=userInput(parent.taskId,marker('start')),snap=await state(parent.taskId);
      return existsSync(localFile('backgroundStarted'))&&turn?.status==='completed'&&!snap.run?.busy&&snap.run?.runId===parentRun.run_id&&{turn,snap};
    },'real Claude foreground complete while its original background Bash stays live');
    assert.equal(readFileSync(localFile('parent'),'utf8'),marker('parent_bytes')+'\n');
    assert.equal(queue(writer.taskId).state,'queued');
    noChildRun(writer);assert(!existsSync(localFile('backgroundDone')));
    const owned=kernel(parentRun.pid);
    const backgroundPid=kernel(Number(readFileSync(localFile('backgroundStarted'),'utf8').trim()));
    assert.equal(owned.state,'running');
    assert.equal(owned.startedAt,parentRun.process_started_at);
    assert.equal(backgroundPid.state,'running');
    assert.notEqual(backgroundPid.pid,owned.pid);
    result.background={foreground:held.turn,owned,backgroundPid,childStillQueued:true};
    await app.screenshot(join(out,'17-background-holds-queued-child.png'));
    publishMark('backgroundRelease');
    await until(()=>existsSync(localFile('backgroundDone')),'only the private background process completes');
    const continuation=await until(()=>s.backgroundNotice||s.childStarted,'original Claude background notice or lawful child startup');
    if(s.backgroundNotice){
      const original=run(parentRun.run_id),kernelOriginal=kernel(parentRun.pid);
      const alive=kernelOriginal.state==='running'&&kernelOriginal.startedAt===parentRun.process_started_at;
      if(alive){
        noChildRun(writer);
        assert.equal(queue(writer.taskId).state,'queued');
        assert.equal(userInput(parent.taskId,after).status,'accepted');
        assert.deepEqual(runsFor(parent.taskId).map(r=>r.run_id),[parentRun.run_id]);
      }else if(s.childStarted){
        assert(terminal(original),'actual child starts only after the original owner is terminal');
      }
      result.background.continuation={...continuation,originalHostRun:original,kernelOriginal,
        childHadStarted:!!s.childStarted,humanTurn:userInput(parent.taskId,after)};
    }
    s.backgroundNoticeGate.release();
  }

  phase='child takes the single shared write slot after original parent exits';
  await until(()=>s.childStarted,'child actual native model started',55000);
  assert(terminal(run(parentRun.run_id)));
  assert.equal(readFileSync(localFile('parent'),'utf8'),marker('parent_bytes')+'\n');
  const childGrant=queue(writer.taskId);
  assert.equal(childGrant.state,'active');assert(childGrant.run_id);
  assert.equal(childGrant.directory_identity,fixture.canonical.key);
  assert.equal(userInput(parent.taskId,after).status,'accepted');
  assert(!s.resumeStarted);
  const active=sql("SELECT task_id FROM agent_directory_queue WHERE directory_identity=? AND kind='write' AND state='active'",[fixture.canonical.key]);
  assert.deepEqual(active.map(x=>x.task_id),[writer.taskId]);
  await open(writer);
  await until(async()=>{await approvalIfNeeded(writer);return s.childHeld;},'child uses real tool to read parent file and write its own');
  assert.equal(readFileSync(localFile('child'),'utf8'),marker('child_bytes')+'\n');
  result.writer={child:writer,grant:childGrant,originalParentExit:run(parentRun.run_id),active,childTool:s.toolProof.child};
  await app.screenshot(join(out,'21-child-owns-directory.png'));
  await open(parent);
  await app.waitFor('Boolean(document.querySelector(".agent-waiting-children"))',12000);
  await app.screenshot(join(out,'22-parent-still-waits-for-child.png'));
  s.childGate.release();

  await verifyParentAfterChild({queued,after,writer,cancel,childGrant,parentRun,initialBindings});
}
async function verifyParentAfterChild({queued,after,writer,cancel,childGrant,parentRun,initialBindings}){
  const s=flow.s;
  phase='parent reacquires after child drain, resumes original session, and reads actual child bytes';
  const continued=await until(async()=>{
    await approvalIfNeeded(parent);
    const turn=userInput(parent.taskId,after),snap=await state(parent.taskId);
    return turn?.status==='completed'&&s.readCompleted&&snap.items.some(x=>x.type==='assistant_message'&&x.payload.text?.includes(marker('parent_resume_done')))&&{turn,snap};
  },'original native parent completes actual follow-up read',55000);
  assert.equal(queue(writer.taskId).state,'released');
  assert(terminal(run(childGrant.run_id)));
  assert.equal(continued.turn.turn_id,queued.turn_id);
  assert(continued.turn.native_turn_id);
  const resumed=run(continued.turn.run_id);
  assert.notEqual(resumed.run_id,parentRun.run_id);
  assert(resumed.generation>parentRun.generation);
  assert.equal(resumed.binding_id,parentRun.binding_id);
  assert.deepEqual(bind(parent.taskId),initialBindings);
  assert(s.toolProof.read.includes(marker('child_bytes')));
  noChildRun(cancel);
  assert(!s.unexpectedCanceledArrival);
  assert.equal(queue(cancel.taskId).state,'canceled');
  const delivered=await until(async()=>{
    const view=await relations(parent.taskId),snap=await state(parent.taskId);
    const status=childState(view,writer.taskId);
    const notice=snap.items.find(x=>x.type==='notification'&&x.payload.childTaskId===writer.taskId&&x.payload.status==='completed');
    return status?.state==='delivered'&&notice&&{status,notice:notice.payload};
  },'actual child-specific result accepted by original parent');
  assert.equal(delivered.status.workspaceMode,'shared');
  fixture.assertSafe();
  result.followUp={turn:continued.turn,resumed,binding:bind(parent.taskId)[0],result:delivered,
    childExit:run(childGrant.run_id),realOutput:s.toolProof.read};
  await app.screenshot(join(out,'30-parent-reads-child-file-after-resume.png'));
}
const businessRequest=id=>sql("SELECT request_id,status,operation_id,origin_json,updated_at,json_extract(payload_ref,'$.phase') AS phase FROM agent_requests WHERE request_id=?",[id])[0];
const invocation=id=>sql('SELECT operation_id,task_id,project_id,run_id,state,effect_state,attempt_count,ended_at FROM application_invocations WHERE operation_id=?',[id]);

async function executeBusiness(){
  const s=flow.s, ledger=result.business;
  phase='real native MCP request and exact one-time host approval';
  await send(marker('start'));
  const request=await until(async()=>{
    const request=(await state(parent.taskId)).requests.find(r=>r.class==='host_business'&&r.payload.businessKind==='application_write');
    return s.businessReceipt&&request;
  },'isolated plugin one-time choice from actual native tool call');
  assert.equal(typeof request.requestId,'string');
  const operation=businessRequest(request.requestId);
  assert(operation?.operation_id);
  assert.deepEqual(invocation(operation.operation_id),[]);
  assert(!leaseGate.read());
  assert((await app.evaluate('document.querySelector(".agent-task-view")?.innerText')).includes('写入 A32 私有合成效果'));
  await click('.agent-request [role="option"][aria-label="批准"]');
  await click('.agent-request .agent-confirm-choice');
  const held=await until(()=>{
    const effect=leaseGate.read(),r=businessRequest(request.requestId),rows=invocation(operation.operation_id);
    return effect&&r?.phase==='executing'&&rows.length===1&&rows[0].state==='running'&&{effect,request:r,invocation:rows[0]};
  },'real plugin executing, receipt privately held',18000);
  assert.equal(held.effect.operationId,operation.operation_id);
  assert.equal(held.effect.projectId,parent.projectId);
  assert.equal(held.effect.runId,held.invocation.run_id);
  assert.equal(held.invocation.task_id,parent.taskId);
  const ownerAtApproval=run(held.effect.runId);
  const ownerBirth=kernel(ownerAtApproval.pid),workerBirth=kernel(held.effect.pid);
  assert.equal(ownerAtApproval.state,'active');
  assert.equal(ownerBirth.state,'running');
  assert.equal(ownerBirth.startedAt,ownerAtApproval.process_started_at);
  assert.equal(workerBirth.state,'running');
  assert.notEqual(workerBirth.pid,ownerBirth.pid);
  assert(!s.receipts.writer,'business must start before a dependent writer enters the same FIFO');
  ledger.start={...held,ownerAtApproval,ownerBirth,workerBirth,childNotAcceptedYet:true};
  s.businessGate.release();

  phase='business running, actual shared receipts and per-child cancellation';
  await until(()=>s.parentHeld&&s.receipts.writer&&s.receipts.cancel,'both real queued receipts after business already started');
  const parentRun=run(held.effect.runId),initialBindings=bind(parent.taskId);
  assert.equal(initialBindings.length,1);
  assert.equal(initialBindings[0].binding_id,parentRun.binding_id);
  assert(initialBindings[0].native_id);
  assert.equal((await state(parent.taskId)).run?.runId,parentRun.run_id);
  result.originalParent={run:parentRun,binding:initialBindings[0]};
  result.receipts=s.receipts;
  const child=role=>({taskId:s.receipts[role].childTaskId,title:'A32 '+role+' '+childKind,model:models[childKind][role]});
  const writer=child('writer'),cancel=child('cancel');
  for(const candidate of [writer,cancel]){
    assert.equal((await state(candidate.taskId)).cwd,cwd);
    assert.equal(queue(candidate.taskId).state,'queued');
    noChildRun(candidate);
  }
  await click('.agent-lineage-toggle');
  const cancelSelector=`[data-child-id="${cancel.taskId}"] button[aria-label^="停止子任务"]`;
  await click(cancelSelector);
  await until(async()=>childState(await relations(parent.taskId),cancel.taskId)?.state==='canceled','only the queued second writer is canceled');
  assert.equal(queue(cancel.taskId).state,'canceled');
  assert.equal(queue(writer.taskId).state,'queued');
  assert.equal(invocation(operation.operation_id)[0].state,'running');
  result.canceled={child:cancel,queue:queue(cancel.taskId)};
  await app.screenshot(join(out,'10-queued-and-one-canceled.png'));
  s.parentGate.release();

  phase='held foreground native tool and in-flight business both keep child unwritten';
  await until(async()=>{await approvalIfNeeded(parent);return existsSync(localFile('foregroundStarted'));},'real parent Bash started while business is still executing');
  assert((await state(parent.taskId)).run?.busy);
  assert.equal(invocation(operation.operation_id)[0].state,'running');
  assert(!existsSync(localFile('parent')));
  noChildRun(writer);
  assert.equal(queue(writer.taskId).state,'queued');
  result.foregroundTool={parentStillBusy:true,writerNotDispatched:true,scope:parentRun.run_id,businessAlsoExecuting:true};
  await app.screenshot(join(out,'15-native-parent-tool-holds-child.png'));
  publishMark('foregroundRelease');

  phase='foreground ends while its real approved business is still executing and child stays queued';
  const waiting=await until(async()=>{
    const turn=userInput(parent.taskId,marker('start')),current=await state(parent.taskId);
    return s.receipts.writer&&turn?.status==='completed'&&!current.run?.busy&&{turn,current};
  },'original foreground completed while separately-approved operation is running',16000);
  assert.equal(waiting.turn.run_id,held.effect.runId);
  assert.equal(waiting.current.run?.runId,held.effect.runId);
  assert.equal(businessRequest(request.requestId).phase,'executing');
  assert.equal(invocation(operation.operation_id)[0].state,'running');
  assert.equal(readFileSync(localFile('parent'),'utf8'),marker('parent_bytes')+'\n');
  assert(s.toolProof.parent?.includes(marker('parent_wrote')));
  assert.equal((await state(writer.taskId)).cwd,cwd);
  noChildRun(writer);
  assert.equal(queue(writer.taskId).state,'queued');
  const ownerWhileHeld=kernel(ownerAtApproval.pid),workerWhileHeld=kernel(held.effect.pid);
  assert.equal(ownerWhileHeld.state,'running');
  assert.equal(ownerWhileHeld.startedAt,ownerBirth.startedAt);
  assert.equal(workerWhileHeld.state,'running');
  assert.equal(workerWhileHeld.startedAt,workerBirth.startedAt);
  assert(!terminal(run(held.effect.runId)));
  ledger.boundary={parent:waiting.turn,business:businessRequest(request.requestId),queue:queue(writer.taskId),
    ownerWhileHeld,workerWhileHeld,allChildRuns:[]};
  await app.screenshot(join(out,'40-ongoing-business-holds-writing-child.png'));

  phase='acknowledged plugin makes one terminal effect and only then lets the original writer start';
  leaseGate.allow(operation.operation_id);
  ledger.releaseAuthorized=true;
  await until(()=>s.childStarted,'child starts after original plugin settles',45000);
  assert(terminal(run(held.effect.runId)));
  assert.equal(businessRequest(request.requestId).phase,'finished');
  assert.equal(businessRequest(request.requestId).status,'resolved');
  const completed=invocation(operation.operation_id);
  assert.equal(completed.length,1);
  assert(completed[0].ended_at&&completed[0].state!=='running');
  assert.equal(leaseGate.read().sha256,held.effect.sha256);
  const grant=queue(writer.taskId);
  assert.equal(grant.state,'active');
  assert.notEqual(grant.run_id,held.effect.runId);
  const ordered=sql(`SELECT rowid AS ordinal,event_type,task_id,created_at,payload FROM agent_events
    WHERE (event_type='request.resolved' AND json_extract(payload,'$.requestId')=?)
      OR (event_type='directory.acquired' AND json_extract(payload,'$.queueId')=?)
    ORDER BY rowid`,[request.requestId,grant.queue_id]);
  assert.deepEqual(ordered.map(x=>[x.event_type,x.task_id]),[
    ['request.resolved',parent.taskId],['directory.acquired',writer.taskId],
  ]);
  ledger.fullyBeforeChild={settled:businessRequest(request.requestId),effect:completed[0],grant,ordered,originalOwnerExit:run(held.effect.runId)};
  const active=sql("SELECT task_id FROM agent_directory_queue WHERE directory_identity=? AND kind='write' AND state='active'",[fixture.canonical.key]);
  assert.deepEqual(active.map(x=>x.task_id),[writer.taskId]);
  await open(writer);
  await until(async()=>{await approvalIfNeeded(writer);return s.childHeld;},'actual delegated writer finished after business drain');
  assert.equal(readFileSync(localFile('child'),'utf8'),marker('child_bytes')+'\n');
  result.writer={child:writer,grant,originalParentExit:run(parentRun.run_id),active,childTool:s.toolProof.child};
  await app.screenshot(join(out,'41-real-business-receipt-then-child.png'));
  await open(parent);
  await app.waitFor('Boolean(document.querySelector(".agent-waiting-children"))',12000);
  const after=marker('resume');
  await send(after);
  const queued=await until(()=>{const turn=userInput(parent.taskId,after);return turn?.status==='accepted'&&turn;},
    'human follow-up remains queued while the actual child owns the directory');
  assert.equal(queued.run_id,null);
  assert(!s.resumeStarted);
  assert.equal(queue(writer.taskId).state,'active');
  result.queuedUserTurn=queued;
  await app.screenshot(join(out,'22-parent-still-waits-for-child.png'));
  s.childGate.release();
  await verifyParentAfterChild({queued,after,writer,cancel,childGrant:grant,parentRun,initialBindings});
  assert.equal(invocation(operation.operation_id).length,1);
}

async function quit(){
  if(!app)return;
  if(!appTrusted){result.cleanup=await app.crash();return;}
  try{
    const tasks=await app.invoke('agentTasks.list');
    result.beforeQuit=tasks.map(({taskId,status})=>({taskId,status}));
    if(!result.passed)for(const t of tasks.filter(x=>['working','waiting'].includes(x.status))){
      await app.invoke('agentTasks.stop',t.taskId,true);
      (result.cleanupStopped??=[]).push(t.taskId);
    }
    await app.mainEvaluate(`(() => {const {app}=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
      if(app.getPath('userData')!==${JSON.stringify(data)}||process.pid!==${app.processId})throw Error('Wrong App');
      setTimeout(()=>app.quit(),50);return true})()`);
  }catch(error){result.quitCall=String(error);}
  try{result.app.exit=await app.waitForExit(20000);}
  catch(error){result.quitError=String(error);result.cleanup=await app.crash();}
  result.rendererErrors=app.rendererErrors;
  writeFileSync(join(out,'electron.log'),app.logs(),{mode:0o600});
}
try{
  await setup();
  if(isBusiness)await executeBusiness();
  else await execute();
  result.passed=true;
}catch(error){
  result.phase=phase;result.error=String(error.stack??error);
  if(error.electronStartupLogs)result.startup={logs:error.electronStartupLogs,targets:error.electronStartupTargets,process:error.electronStartupProcess};
  if(appTrusted)try{
    result.visible=await app.evaluate('document.body.innerText.slice(0,6500)');
    await app.screenshot(join(out,'99-failure.png'));
  }catch{/* the private view can have closed */}
}finally{
  if(cwd){publishMark('foregroundRelease');if(background)publishMark('backgroundRelease');}
  if(isBusiness&&leaseGate&&!result.business?.releaseAuthorized){
    try{const active=leaseGate.read();if(active)leaseGate.allow(active.operationId);}
    catch(error){result.pluginCleanupError=String(error);}
  }
  if(flow){result.nativeProof=flow.s.toolProof;result.nativeActions=flow.s.events;}
  flow?.close();
  await quit();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  result.passed=result.passed&&result.app?.exit?.code===0&&!result.app.exit.signal&&!result.serverError&&!result.rendererErrors.length;
  writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2),{mode:0o600});
}
if(!result.passed)process.exitCode=1;
