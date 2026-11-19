import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { openElectron, pause } from '../../prep-fef791bc6/electron-harness.mjs';
import { redirectHome } from '../../prep-fef791bc6/home-redirect-main.mjs';
import { toolReceipt } from '../a20-packaged/native-delegation-flow.mjs';

const base='/private/tmp/willyou-m14-stage6.WRvdST';
const [out,sourceCommit]=process.argv.slice(2);
const executable=process.env.M14_ACCEPTANCE_APP;
const asar=process.env.M14_EXPECTED_ASAR_SHA256;
assert.match(out??'',/^\/private\/tmp\/willyou-m14-stage6\.WRvdST\/g03\/attempt-[0-9]+$/);
assert.match(sourceCommit??'',/^[0-9a-f]{40}$/);
assert.match(asar??'',/^[0-9a-f]{64}$/);
assert.equal(process.cwd(),join(base,'source'));
assert.equal(executable,join(base,'package/mac-arm64/WillYou.app/Contents/MacOS/WillYou'));
assert.equal(realpathSync(executable),executable);
assert.equal(readFileSync(join(base,'source-commit.txt'),'utf8').trim(),sourceCommit);
assert.equal(createHash('sha256').update(readFileSync(join(base,'package/mac-arm64/WillYou.app/Contents/Resources/app.asar'))).digest('hex'),asar);
mkdirSync(out,{mode:0o700});
const root=realpathSync(mkdtempSync(join(out,'runtime-')));
const home=join(root,'home'), userData=join(root,'data'), cwd=join(root,'work');
for(const dir of [home,userData,cwd])mkdirSync(dir,{mode:0o700});
assert(!existsSync(join(cwd,'.git'))&&!existsSync(join(cwd,'.svn')));
const env={
  HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),TMPDIR:root,
  XDG_CONFIG_HOME:join(home,'.config'),XDG_DATA_HOME:join(home,'.local/share'),XDG_CACHE_HOME:join(home,'.cache'),
  npm_config_cache:join(root,'npm-cache'),npm_config_offline:'true',npm_config_audit:'false',npm_config_fund:'false',
  npm_config_userconfig:join(root,'test-npm-empty-user'),npm_config_globalconfig:join(root,'test-npm-empty-global'),
  GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',
  ENABLE_TOOL_SEARCH:'false',NO_PROXY:'127.0.0.1,localhost',HTTP_PROXY:'http://127.0.0.1:1',
  HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',
};
const models={ parent:'a68-parent',w:'a68-writer',r:'a68-reviewer' };
const hookResult={};
const result={bootstrap:hookResult,sourceCommit,asar,executable,scope:'A23 boundaries on the A68 flow: real packaged App, real Claude and Codex CLIs through the actual MCP bridge, local synthetic model responses',
  observations:[],requests:[],actions:[],status:'failed'};
const port=3425;
const origin='http://127.0.0.1:'+port;
let app;
function record(label,data={}) {
  const row={label,at:new Date().toISOString(),...data};
  result.observations.push(row);
  console.log(JSON.stringify(row));
}
function writeEvents(res, model, answer, call) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
  event('message_start',{message:{id:'m'+randomUUID(),type:'message',role:'assistant',model,
    content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});
  event('content_block_start',{index:0,content_block:call
    ?{type:'tool_use',id:call.id,name:call.tool.name,input:{}}
    :{type:'text',text:''}});
  event('content_block_delta',{index:0,delta:call
    ?{type:'input_json_delta',partial_json:JSON.stringify(call.args)}
    :{type:'text_delta',text:answer}});
  event('content_block_stop',{index:0});
  event('message_delta',{delta:{stop_reason:call?'tool_use':'end_turn'},usage:{output_tokens:1}});
  event('message_stop',{});
  res.end();
}
const snapshot = taskId => app.invoke('agentTasks.snapshot', taskId);
const relations = taskId => app.invoke('agentTasks.relations', taskId);
const answerPresent = (snap, answer) => snap.items.some(i => i.type === 'assistant_message' && i.payload.text?.includes(answer));
async function until(fn, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (result.serverError) throw Error(result.serverError);
    const outcome=await fn();
    if(outcome)return outcome;
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
  for (const type of ['mousePressed', 'mouseReleased']) {
    await app.cdp('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
  }
  result.actions.push({ selector, text, ...point });
}


// ---- A68 synthetic models ----
const M={start:'A68_START',w1:'A68_W_ROUND1',w1done:'A68_W_R1_DONE',rework:'A68_REWORK_ROUND2',w2done:'A68_W_R2_DONE',
  review:'A68_INDEPENDENT_REVIEW',rdone:'A68_R_DONE',follow:'A68_RUNNING_FOLLOWUP',followDone:'A68_R_FOLLOW_DONE'};
const rec={parent:[],w:[],r:[],receipts:{}};
let profiles={},foreignTaskId,pending=null,queue=[],rGateOpen,rGate=new Promise(r=>{rGateOpen=r;});
const findTool=(tools,name)=>{const t=tools.filter(x=>x.name===name||x.name?.endsWith('__'+name));assert.equal(t.length,1,'tool '+name);return t[0];};
const userTexts=messages=>messages.filter(m=>m.role==='user').flatMap(m=>typeof m.content==='string'?[m.content]:(m.content??[]).filter(p=>p.type==='text').map(p=>p.text));
function parentPlan(input,tools){
  if(!rec.receipts.delegateW&&input.includes(M.start))return [
    ['targets',()=>[findTool(tools,'wy_targets'),{}]],
    ['delegateW',()=>{const t=rec.receipts.targets.value.targets.find(x=>x.profileId===profiles.claude);return [findTool(tools,'wy_delegate'),{requestKey:'a68-writer-1',profileId:t.profileId,profileRevision:t.revision,title:'A68 写入子任务',model:models.w,instructions:M.w1+' 写入子任务首轮。',access:'write'}];}],
    ['delegateTierHigh',()=>{const t=rec.receipts.targets.value.targets.find(x=>x.profileId===profiles.claude);return [findTool(tools,'wy_delegate'),{requestKey:'a68-high-tier',profileId:t.profileId,profileRevision:t.revision,title:'A68 越级档位',model:models.w,instructions:'should be refused',access:'write',tier:'full'}];}],
    // A23: a target that wy_targets never offered, and a delegation that carries its own directory.
    ['delegateUnknownTarget',()=>[findTool(tools,'wy_delegate'),{requestKey:'a23-unknown-target',profileId:'a23-not-an-offered-profile',profileRevision:'0'.repeat(64),title:'A23 越目标',instructions:'should be refused',access:'write'}]],
    ['delegateOwnDirectory',()=>{const t=rec.receipts.targets.value.targets.find(x=>x.profileId===profiles.claude);return [findTool(tools,'wy_delegate'),{requestKey:'a23-own-directory',profileId:t.profileId,profileRevision:t.revision,title:'A23 越目录',model:models.w,instructions:'should be refused',access:'write',cwd:'/private/tmp/a23-outside-project'}];}],
  ];
  const wId=rec.receipts.delegateW?.value?.childTaskId;
  // 372: the wake notice only carries a result reference; the body is fetched with wy_observe.
  if(wId&&!rec.receipts.rework&&input.includes(wId+'，attempt 1 状态 completed'))return [
    ['observeW1',()=>[findTool(tools,'wy_observe'),{childTaskId:wId}]],
    ['rework',()=>[findTool(tools,'wy_send'),{childTaskId:rec.receipts.delegateW.value.childTaskId,requestKey:'a68-rework-2',text:M.rework+' 请按意见重做。'}]],
    ['foreign',()=>[findTool(tools,'wy_send'),{childTaskId:foreignTaskId,requestKey:'a68-foreign-1',text:'not my child'}]],
    ['delegateR',()=>{const t=rec.receipts.targets.value.targets.find(x=>x.profileId===profiles.codex);return [findTool(tools,'wy_delegate'),{requestKey:'a68-reviewer-1',profileId:t.profileId,profileRevision:t.revision,title:'A68 独立只读复核',model:models.r,instructions:M.review+' 独立复核。',access:'read'}];}],
  ];
  if(rec.receipts.rework&&!rec.receipts.sendRunning&&input.includes(wId+'，attempt 2 状态 completed'))return [
    ['observeW2',()=>[findTool(tools,'wy_observe'),{childTaskId:wId}]],
    ['sendRunning',()=>[findTool(tools,'wy_send'),{childTaskId:rec.receipts.delegateR.value.childTaskId,requestKey:'a68-follow-up',text:M.follow+' 运行中追加。'}]],
  ];
  return [];
}
function claudeAction(model,tools,messages){
  const input=JSON.stringify(messages);
  if(model===models.w){
    const texts=userTexts(messages);
    rec.w.push({at:Date.now(),wyTools:tools.map(t=>t.name).filter(n=>/wy_/.test(n)),hasRework:input.includes(M.rework),historyHasRound1:input.includes(M.w1done)});
    if(texts.at(-1)?.includes(M.rework)||input.includes(M.rework))return {answer:M.w2done};
    return {answer:M.w1done};
  }
  assert.equal(model,models.parent);
  if(pending){
    const r=toolReceipt(messages,pending.id);
    rec.receipts[pending.label]={isError:r.isError,text:r.text.slice(0,1200),value:r.value};
    pending=null;
  }else{
    queue=parentPlan(input,tools).slice();
    rec.parent.push({at:Date.now(),newTurn:true,steps:queue.map(q=>q[0])});
  }
  const next=queue.shift();
  if(!next)return {answer:'A68_PARENT_TURN_DONE'};
  const [tool,args]=next[1]();
  pending={label:next[0],id:'toolu_'+randomUUID()};
  return {tool,args,id:pending.id};
}
function writeResponses(res,answer){
  res.writeHead(200,{'content-type':'text/event-stream'});
  const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
  const id='r'+randomUUID(), item={id:'m'+randomUUID(),type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]};
  event('response.created',{response:{id,status:'in_progress',output:[]}});
  event('response.output_item.added',{output_index:0,item:{...item,status:'in_progress'}});
  event('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:answer});
  event('response.output_item.done',{output_index:0,item});
  event('response.completed',{response:{id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});
  res.end();
}
const server=createServer(async(req,res)=>{
  try{
    if(req.method==='GET'&&req.url?.endsWith('/models')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:Object.values(models).map(id=>({id}))}));return;}
    const parts=[];for await(const p of req)parts.push(p);
    const payload=JSON.parse(Buffer.concat(parts).toString('utf8')||'{}');
    if(req.method==='POST'&&req.url?.includes('responses')){
      assert.equal(payload.model,models.r);
      const input=JSON.stringify(payload.input);
      const row={at:Date.now(),hasFollow:input.includes(M.follow),hasReview:input.includes(M.review),leaksWriterContext:input.includes(M.w1done)||input.includes(M.rework)};
      rec.r.push(row);
      if(!row.hasFollow){await rGate;return writeResponses(res,M.rdone);}
      return writeResponses(res,M.followDone);
    }
    if(req.method!=='POST'||!req.url?.includes('messages')){res.statusCode=404;res.end();return;}
    result.requests.push({at:Date.now(),model:payload.model});
    const action=claudeAction(payload.model,payload.tools??[],payload.messages??[]);
    writeEvents(res,payload.model,action.answer??null,action.tool?action:null);
  }catch(error){result.serverError=String(error.stack??error);if(!res.headersSent)res.writeHead(500);res.end();}
});
const taskRow=id=>'[data-testid="sidebar-agent-task"][data-task-id="'+id+'"]';
async function navigateTask(id,title){
  await app.waitFor('Boolean('+selectorExpr(taskRow(id))+')',20000,{navigation:true});
  await click(taskRow(id));
  await app.waitFor('document.querySelector(".agent-task-head h1")?.textContent==='+JSON.stringify(title),10000);
}
async function send(text){
  await click('.agent-task-view textarea');
  await app.cdp('Input.insertText',{text});
  await click('.agent-task-view button[type="submit"]');
}
function sql(query, parameters=[]) {
  const path=join(userData,'smartdd.db');
  assert.equal(realpathSync(path),path);
  const source='import json,pathlib,sqlite3,sys;c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro",uri=True);c.row_factory=sqlite3.Row;print(json.dumps([dict(r) for r in c.execute(sys.argv[2],json.loads(sys.argv[3]))]))';
  return JSON.parse(execFileSync('/usr/bin/python3',['-c',source,path,query,JSON.stringify(parameters)],{encoding:'utf8',timeout:10000}));
}
const git=(...args)=>execFileSync('git',args,{cwd,env:{PATH:process.env.PATH,LANG:'en_US.UTF-8',...env},encoding:'utf8',timeout:10000}).trim();

let phase='isolated synthetic project';
try{
  writeFileSync(join(cwd,'README.md'),'M14 local A68 fixture.\n',{mode:0o600,flag:'wx'});
  git('init','-qb','main');git('add','.');
  git('-c','user.name=A68 Fixture','-c','user.email=a68-fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','synthetic A68 project');
  const head=git('rev-parse','HEAD');
  phase='native packaged startup';
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  app=await openElectron({executable,userData,env,inspectMain:true,startupMainHook:async info=>Object.assign(hookResult,await redirectHome({...info,home}))});
  result.pid=app.processId;
  result.identity=await app.mainEvaluate(`(() => {const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');return [E.app.isPackaged,E.app.getPath('userData'),E.app.getPath('home'),process.execPath,process.pid];})()`);
  assert.deepEqual(result.identity,[true,userData,home,executable,app.processId]);
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await app.invoke('agents.refreshTools');
  const custom=await app.invoke('agents.customToolPath','claude',process.env.M14_SMOKE_CLAUDE);
  assert(custom.tool?.installed&&custom.tool.version==='2.1.326');
  const tools=await app.invoke('agents.tools');
  const claude=tools.find(t=>t.kind==='claude'&&t.installed), codex=tools.find(t=>t.kind==='codex'&&t.installed);
  assert(claude&&codex);
  result.nativeTools=[{kind:'claude',version:claude.version},{kind:'codex',version:codex.version}];
  const provider=await app.invoke('agents.saveProvider',{name:'A68 local synthetic only',preset:'magpie',endpoints:{responses:origin+'/v1',anthropic:origin+'/'},models:Object.values(models).map(id=>({id,name:id}))});
  const pc=await app.invoke('agents.save',{name:'A68 Claude',toolId:claude.id,source:'provider',providerId:provider.id,models:[models.parent,models.w],defaultModel:models.parent,isDefault:true});
  const px=await app.invoke('agents.save',{name:'A68 Codex',toolId:codex.id,source:'provider',providerId:provider.id,models:[models.r],defaultModel:models.r,isDefault:false});
  profiles={claude:pc.id,codex:px.id};
  const project=await app.invoke('projects.create',{name:'A68 rework',aliases:[],description:'',rulesPath:null},[{label:'isolated Git',path:cwd}]);
  const create=(title,model,profileId)=>app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,cwd,title,profileId,model,tier:'ask'});
  const parentTitle='A68 主任务';
  const parent=await create(parentTitle,models.parent,pc.id);
  const foreign=await create('A68 不相关任务',models.parent,pc.id);
  foreignTaskId=foreign.taskId;
  result.tasks={parent:parent.taskId,foreign:foreign.taskId};
  await click('[data-testid="nav-settings"]');
  const feature='[data-testid=m14-toggle]';
  if(!await app.evaluate('Boolean('+selectorExpr(feature)+')'))await click('.settings-nav button.nav-row','常规');
  await app.waitFor('Boolean('+selectorExpr(feature)+')',15000);
  if(!await app.evaluate(selectorExpr(feature)+'?.innerText.includes("已开启")'))await click(feature);
  await app.waitFor(selectorExpr(feature)+'?.innerText.includes("已开启")',12000);
  await click('[data-testid="nav-home"]');
  phase='real UI input to the parent with delegation enabled';
  await navigateTask(parent.taskId,parentTitle);
  await click('[data-testid="agent-delegation-toggle"]');
  await app.waitFor('document.querySelector("[data-testid=agent-delegation-toggle]")?.getAttribute("aria-pressed")==="true"',10000);
  await send(M.start);
  phase='writer round 1, rework, foreign and tier refusals, independent reviewer';
  await until(()=>rec.receipts.delegateR&&rec.receipts.foreign&&rec.receipts.rework,'parent reworks writer, tries foreign send and delegates reviewer',120000);
  phase='writer round 2 in the original session while the reviewer is still running';
  await until(()=>rec.receipts.sendRunning,'parent sends to the running reviewer',120000);
  const rTask=rec.receipts.delegateR.value.childTaskId, wTask=rec.receipts.delegateW.value.childTaskId;
  const midR=(await relations(parent.taskId)).children.find(c=>c.childTaskId===rTask);
  result.reviewerWhenSent={state:midR?.state,access:midR?.access,workspaceMode:midR?.workspaceMode};
  await app.screenshot(join(out,'10-reviewer-running-followup-queued.png'));
  rGateOpen();
  phase='reviewer finishes and then handles the queued follow-up';
  await until(async()=>{const s=await snapshot(parent.taskId);return !s.run?.busy&&(await relations(parent.taskId)).children.every(c=>c.state==='delivered')&&rec.r.some(r=>r.hasFollow);},'all settled',120000);
  await pause(1500);
  const family=await relations(parent.taskId);
  result.family=family.children.map(c=>({title:c.title,state:c.state,access:c.access,workspaceMode:c.workspaceMode,attempts:c.attempts}));
  const bind=id=>sql('SELECT binding_id,native_id FROM agent_bindings WHERE task_id=?',[id]);
  const turns=id=>sql("SELECT status,native_turn_id,json_extract(input_ref,'$.text') AS text,source_kind FROM agent_turns WHERE task_id=? ORDER BY rowid",[id]);
  result.writer={bindings:bind(wTask),turns:turns(wTask).map(t=>({status:t.status,source:t.source_kind,native:t.native_turn_id,hasRework:(t.text??'').includes(M.rework)})),requests:rec.w,cwd:(await snapshot(wTask)).cwd};
  result.reviewer={bindings:bind(rTask),turns:turns(rTask).map(t=>({status:t.status,source:t.source_kind,hasFollow:(t.text??'').includes(M.follow)})),requests:rec.r};
  result.receipts=Object.fromEntries(Object.entries(rec.receipts).map(([k,v])=>[k,{isError:v.isError,text:v.text}]));
  result.parentTurns=rec.parent;
  const checks=result.checks=[];
  const check=(label,ok,data)=>{checks.push({label,ok:!!ok,data});assert(ok,label+' '+JSON.stringify(data??''));};
  check('tier above parent refused by the delegate contract',rec.receipts.delegateTierHigh.isError,rec.receipts.delegateTierHigh.text);
  check('A23 delegation to a target not offered by wy_targets is refused',rec.receipts.delegateUnknownTarget?.isError,rec.receipts.delegateUnknownTarget?.text);
  check('A23 delegation carrying its own directory is refused',rec.receipts.delegateOwnDirectory?.isError,rec.receipts.delegateOwnDirectory?.text);
  check('A23 refused delegations created no child task',family.children.length===2,result.family);
  check('send to a task that is not my child refused',rec.receipts.foreign.isError,rec.receipts.foreign.text);
  check('rework of the completed writer accepted as a new attempt',!rec.receipts.rework.isError&&rec.receipts.rework.value?.attemptId,rec.receipts.rework.value);
  check('writer keeps one native binding across both rounds',result.writer.bindings.length===1&&result.writer.bindings[0].native_id,result.writer.bindings);
  check('writer round 2 request carries round-1 context',rec.w.some(r=>r.hasRework&&r.historyHasRound1),rec.w);
  check('writer works in the original shared directory',result.writer.cwd===cwd,result.writer.cwd);
  check('child has no delegation tool',rec.w.every(r=>!r.wyTools.some(n=>/wy_delegate$/.test(n))),rec.w.map(r=>r.wyTools));
  check('writer delegation shows two attempts',family.children.find(c=>c.childTaskId===wTask)?.attempts===2,result.family);
  check('reviewer is a new read-only child',midR?.access==='read'&&rTask!==wTask&&result.reviewer.bindings.length===1&&result.reviewer.bindings[0].native_id!==result.writer.bindings[0].native_id,{midR:result.reviewerWhenSent});
  check('reviewer does not inherit writer context',rec.r.every(r=>!r.leaksWriterContext),rec.r);
  check('send to the running reviewer queued',!rec.receipts.sendRunning.isError&&rec.receipts.sendRunning.value?.queued===true&&result.reviewerWhenSent.state==='running',{receipt:rec.receipts.sendRunning.value,state:result.reviewerWhenSent.state});
  check('queued follow-up ran after the reviewer finished its first turn',rec.r.findIndex(r=>r.hasFollow)>rec.r.findIndex(r=>!r.hasFollow),rec.r);
  check('parent fetched round-1 result through wy_observe',(rec.receipts.observeW1?.text??'').includes(M.w1done),rec.receipts.observeW1?.text?.slice(0,300));
  check('parent fetched round-2 result through wy_observe',(rec.receipts.observeW2?.text??'').includes(M.w2done),rec.receipts.observeW2?.text?.slice(0,300));
  check('parent notified again after the rework',rec.parent.filter(p=>p.newTurn).length>=3,rec.parent);
  check('host did not commit in shared mode',git('rev-parse','HEAD')===head,null);
  await navigateTask(parent.taskId,parentTitle);
  await app.screenshot(join(out,'20-final-parent.png'));
  assert.deepEqual(app.rendererErrors,[]);
  result.status='passed';
}catch(error){
  result.phase=phase;result.error=String(error.stack??error);
  if(app)try{await app.screenshot(join(out,'99-failure.png'));}catch{}
}finally{
  rGateOpen?.();
  if(app){
    try{const tasks=await app.invoke('agentTasks.list');result.beforeQuit=tasks.map(({title,status})=>({title,status}));
      for(const t of tasks.filter(t=>(t.status==='working'||t.status==='waiting')&&!t.parentTaskId)){await app.invoke('agentTasks.stop',t.taskId,true);(result.cleanupMadeIdle??=[]).push(t.title);}}catch(e){result.quitProbeError=String(e);}
    try{await app.mainEvaluate(`(() => {const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Wrong App');setTimeout(()=>E.app.quit(),50);return true;})()`);}catch(e){result.quitRpcError=String(e);}
    try{result.exit=await app.waitForExit(20000);}catch(e){result.exitError=String(e);try{result.forcedExit=await app.crash();}catch{}}
    result.rendererErrors=app.rendererErrors;
    writeFileSync(join(out,'app.log'),app.logs(),{mode:0o600});
  }
  server.closeAllConnections();await new Promise(r=>server.close(r));
  result.rec={parent:rec.parent,w:rec.w,r:rec.r,receipts:Object.fromEntries(Object.entries(rec.receipts).map(([k,v])=>[k,{isError:v.isError,text:v.text}]))};
  writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));
}
if(result.status!=='passed'||result.exit?.code!==0||result.cleanupMadeIdle?.length)process.exitCode=1;
