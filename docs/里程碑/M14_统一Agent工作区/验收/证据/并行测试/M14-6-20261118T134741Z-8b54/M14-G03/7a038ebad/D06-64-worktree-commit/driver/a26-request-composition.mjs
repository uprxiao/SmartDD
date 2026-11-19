import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { openElectron, pause } from '../../prep-fef791bc6/electron-harness.mjs';
import { redirectHome } from '../../prep-fef791bc6/home-redirect-main.mjs';
import { stageManagedAgent } from './managed-agent-fixture.mjs';
import { answers, browserDone, browserLabel, browserPrompt, createRequestFlow,
  nativeAnswer, nativeQuestion, nativeType, question, rootDone, rootPrompt, codexCommand, codexMarker, codexTitle } from './request-flow.mjs';

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
const models={ parent:'a26-compose-parent',browser:'a26-compose-browser',one:'a26-compose-one',two:'a26-compose-two',codex:'a26-compose-codex' };
const siblings=[{id:'one',title:'A26 同文子任务一',model:models.one,marker:'A26_COMPOSED_SIBLING_ONE'},
  {id:'two',title:'A26 同文子任务二',model:models.two,marker:'A26_COMPOSED_SIBLING_TWO'}];
const hookResult={};
const result={bootstrap:hookResult,sourceCommit,asar,executable,scope:'real packaged App, local-only Claude and Codex, literal private browser grant; fourth route is a host-delegated Codex child native command approval (user decision 2026-11-19)',
  observations:[],requests:[],actions:[],status:'failed'};
const port=3425;
const origin='http://127.0.0.1:'+port;
let flow,app;
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

const server=createServer(async(req,res)=>{
  try{
    if(req.method==='GET'&&req.url==='/a26-page'){
      res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
      res.end('<!doctype html><title>A26 local fixture</title><p>A26 local page, no network resources.</p>');
      return;
    }
    if(req.method==='GET'&&req.url?.endsWith('/models')){
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({data:Object.values(models).map(id=>({id}))}));
      return;
    }
    if(req.method==='POST'&&req.url?.includes('responses')){await codexResponse(req,res);return;}
    if(req.method!=='POST'||!req.url?.includes('messages')){res.statusCode=404;res.end();return;}
    const parts=[];
    for await(const part of req)parts.push(part);
    const payload=JSON.parse(Buffer.concat(parts).toString('utf8'));
    const row={at:Date.now(),model:payload.model};
    result.requests.push(row);
    assert(flow,'initialize private agent flow before input');
    const action=await flow.next({model:payload.model,tools:payload.tools??[],messages:payload.messages??[]});
    if(res.destroyed)return;
    if(action.tool){row.tool=action.tool.name;row.toolUseId=action.id;}
    writeEvents(res,payload.model,action.answer??null,action.tool?action:null);
  }catch(error){
    result.serverError=String(error.stack??error);
    if(!res.headersSent)res.writeHead(500);
    res.end();
  }
});
// Fourth route: synthetic Responses stream for the Codex child only.
function writeResponses(res,model,answer,call){
  res.writeHead(200,{'content-type':'text/event-stream'});
  const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
  const id='r'+randomUUID();
  const item=call?{id:'fc'+randomUUID(),type:'function_call',call_id:call.callId,name:call.tool.name,
    ...(call.tool.namespace?{namespace:call.tool.namespace}:{}),arguments:JSON.stringify(call.args),status:'completed'}
    :{id:'m'+randomUUID(),type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]};
  event('response.created',{response:{id,status:'in_progress',output:[]}});
  event('response.output_item.added',{output_index:0,item:{...item,status:'in_progress'}});
  if(!call)event('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:answer});
  event('response.output_item.done',{output_index:0,item});
  event('response.completed',{response:{id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});
  res.end();
}
async function codexResponse(req,res){
  const parts=[];
  for await(const part of req)parts.push(part);
  const payload=JSON.parse(Buffer.concat(parts).toString('utf8'));
  assert.equal(payload.model,models.codex,'only the Codex child uses the Responses endpoint');
  const state=flow.records.codex;
  const input=JSON.stringify(payload.input);
  const row={at:Date.now(),model:payload.model,kind:'codex'};
  result.requests.push(row);
  if(!state.call){
    assert(input.includes(codexMarker),'real delegated Codex input marker expected');
    const tools=(payload.tools??[]).flatMap(t=>t.type==='namespace'?(t.tools??[]).map(x=>({...x,namespace:t.name})):[t]);
    const exec=tools.filter(t=>t.name==='exec_command');
    assert.equal(exec.length,1,'actual native exec_command tool');
    state.call={callId:'call_'+randomUUID(),tool:exec[0],args:{cmd:codexCommand,max_output_tokens:500,
      sandbox_permissions:'require_escalated',justification:'A26 isolated canary; needs explicit native approval'}};
    row.tool='exec_command';
    return writeResponses(res,payload.model,null,state.call);
  }
  const output=(payload.input??[]).find(x=>x.type==='function_call_output'&&x.call_id===state.call.callId);
  if(output&&!state.reply)state.reply={text:String(typeof output.output==='string'?output.output:JSON.stringify(output.output)).slice(0,1600)};
  return writeResponses(res,payload.model,codexMarker+'_DONE');
}
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
const panel='.agent-request';
const askHead='.agent-request .agent-request-head';
const browserCardMarker='需要授权：访问';
const observeControl='.agent-request button[aria-label="允许观察"]';
async function showCard(marker, count){
  await app.waitFor('Boolean('+selectorExpr(askHead)+')',12000);
  const nav=selectorExpr('.agent-request-nav');
  await app.waitFor(count>1
    ? nav+'?.innerText.includes('+JSON.stringify('/'+count)+')'
    : '!'+nav,12000);
  for(let step=0;step<count;step++){
    if(await app.evaluate(selectorExpr(panel)+'?.innerText.includes('+JSON.stringify(marker)+')'))return;
    await click('.agent-request-nav button:last-child');
  }
  throw Error('the actual unified request panel has no card '+marker);
}
function compact(req){
  return {requestId:req.requestId,kind:req.kind,requestClass:req.class,revision:req.revision,origin:req.origin,businessKind:req.payload?.businessKind};
}
function sql(query, parameters=[]) {
  const path=join(userData,'smartdd.db');
  assert.equal(realpathSync(path),path);
  const source='import json,pathlib,sqlite3,sys;c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro",uri=True);c.row_factory=sqlite3.Row;print(json.dumps([dict(r) for r in c.execute(sys.argv[2],json.loads(sys.argv[3]))]))';
  return JSON.parse(execFileSync('/usr/bin/python3',['-c',source,path,query,JSON.stringify(parameters)],{encoding:'utf8',timeout:10000}));
}
const staleError=/请求已结束|请求已更新|请求不存在|已结束的运行/;
const git=(...args)=>execFileSync('git',args,{cwd,env:{PATH:process.env.PATH,LANG:'en_US.UTF-8',...env},encoding:'utf8',timeout:10000}).trim();
let phase='isolated synthetic project';
try{
  writeFileSync(join(cwd,'README.md'),'M14 local A26 fixture.\n',{mode:0o600,flag:'wx'});
  git('init','-qb','main');
  const noGitIdentity = process.env.M14_GIT_IDENTITY === 'missing';
  if (!noGitIdentity) {
    git('config','--local','user.name','A26 Fixture');
    git('config','--local','user.email','a26-fixture@example.invalid');
    git('config','--local','commit.gpgsign','false');
  }
  git('add','.');
  git('-c','user.name=A26 Fixture','-c','user.email=a26-fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','synthetic A26 project');
  const head=git('rev-parse','HEAD');
  phase = 'native packaged startup';
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  app = await openElectron({ executable, userData, env, inspectMain: true, startupMainHook: async info => Object.assign(hookResult,await redirectHome({ ...info,home })) });
  result.pid = app.processId;
  const appIdentity = await app.mainEvaluate(`(() => {
    const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    return [E.app.isPackaged,E.app.getPath('userData'),E.app.getPath('home'),process.env.HOME,process.execPath,process.pid];
  })()`);
  assert.deepEqual(appIdentity, [true, userData, home, home, executable, app.processId]);
  result.identity = appIdentity;
  await app.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await app.invoke('agents.refreshTools');
  assert(process.env.M14_SMOKE_CLAUDE);
  {
    const custom = await app.invoke('agents.customToolPath','claude',process.env.M14_SMOKE_CLAUDE);
    assert(custom.tool?.installed && custom.tool.version === '2.1.326', 'Explicit verified Claude tool must be installed');
    assert.equal(custom.tool.customPath,process.env.M14_SMOKE_CLAUDE);
    result.explicitClaude = { version:custom.tool.version, path:custom.tool.customPath };
  }
  const tools=await app.invoke('agents.tools');
  const claude=tools.find(item=>item.kind==='claude'&&item.installed);
  assert.equal(claude?.version,'2.1.326');
  result.nativeTools=[{kind:claude.kind,version:claude.version}];
  const provider=await app.invoke('agents.saveProvider',{name:'A26 local synthetic only',preset:'magpie',
    endpoints:{responses:origin+'/v1',anthropic:origin+'/'},models:Object.values(models).map(id=>({id,name:id}))});
  const profile=await app.invoke('agents.save',{name:'A26 private Claude',toolId:claude.id,source:'provider',
    providerId:provider.id,models:Object.values(models),defaultModel:models.parent,isDefault:true});
  const codexTool=tools.find(item=>item.kind==='codex'&&item.installed);
  assert(codexTool,'Codex CLI installed');
  result.nativeTools.push({kind:codexTool.kind,version:codexTool.version});
  const codexProfile=await app.invoke('agents.save',{name:'A26 private Codex',toolId:codexTool.id,source:'provider',
    providerId:provider.id,models:[models.codex],defaultModel:models.codex,isDefault:false});
  result.managedAgent=stageManagedAgent(userData,profile.id,nativeType);
  assert(!existsSync(join(cwd,'.claude')));
  const project=await app.invoke('projects.create',{name:'A26 private question composition',aliases:[],description:'',rulesPath:null},[{label:'isolated Git',path:cwd}]);
  const create=(title,model)=>app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,cwd,title,
    profileId:profile.id,model,tier:'ask'});
  const parentTitle='A26 主任务 · 统一请求';
  const targetTitle='A26 本机网页所属任务';
  const parent=await create(parentTitle,models.parent);
  const target=await create(targetTitle,models.browser);
  flow=createRequestFlow({profiles:{claude:profile.id,codex:codexProfile.id},models,browserTaskId:target.taskId,origin,siblings});
  result.flow=flow.records;
  result.tasks={parent:parent.taskId,browserTarget:target.taskId};
  await click('[data-testid="nav-settings"]');
  const feature='[data-testid=m14-toggle]';
  if(!await app.evaluate('Boolean('+selectorExpr(feature)+')'))await click('.settings-nav button.nav-row','常规');
  await app.waitFor('Boolean('+selectorExpr(feature)+')',15000);
  if(!await app.evaluate(selectorExpr(feature)+'?.innerText.includes("已开启")'))await click(feature);
  await app.waitFor(selectorExpr(feature)+'?.innerText.includes("已开启")',12000);
  await click('[data-testid="nav-home"]');

  phase='local browser fixture through actual task link';
  await navigateTask(target.taskId,targetTitle);
  await send(browserPrompt);
  await until(async()=>answerPresent(await snapshot(target.taskId),browserDone),'actual private browser link');
  await click('.agent-assistant:not(.streaming) .agent-md a[data-agent-link]',browserLabel);
  result.browserTarget=await until(async()=>{
    const tabs=await app.invoke('browser.snapshot',{taskId:target.taskId});
    return tabs.tabs.find(t=>t.url===origin+'/a26-page'&&t.title==='A26 local fixture');
  },'actual browser target fully loaded');

  phase='genuine host siblings, business invocation and managed Claude native agent';
  await navigateTask(parent.taskId,parentTitle);
  await click('[data-testid="agent-delegation-toggle"]');
  await app.waitFor('document.querySelector("[data-testid=agent-delegation-toggle]")?.getAttribute("aria-pressed")==="true"',10000);
  await send(rootPrompt);
  const ownerIds={};
  await until(async()=>{
    for(const item of siblings){
      const owned=flow.records.host[item.id];
      if(!owned)return false;
      ownerIds[item.id]=owned.childTaskId;
    }
    return true;
  },'two actual host receipts');
  const mainRequests=()=>snapshot(parent.taskId).then(s=>s.requests);
  const siblingRequest=(id)=>snapshot(ownerIds[id]).then(s=>s.requests.find(r=>r.kind==='user_input'&&JSON.stringify(r.payload).includes(question)));
  const businessRequest=()=>mainRequests().then(reqs=>reqs.find(r=>r.class==='host_business'&&r.payload?.businessKind==='browser_access'));
  const nodeRequest=async()=>{
    const owner=flow.records.host.codex?.childTaskId;
    if(!owner)return undefined;
    ownerIds.codex=owner;
    return snapshot(owner).then(s=>s.requests.find(r=>r.kind==='command_approval'&&JSON.stringify(r.payload).includes(codexCommand)));
  };
  async function maybeApproveExactBrowserCli(){
    const plan=flow.records.businessPlan;
    if(plan?.transport!=='cli'||!plan.command||result.oneBrowserCommandApproval)return;
    const pending=(await mainRequests()).filter(req=>req.kind==='command_approval');
    if(!pending.length)return;
    assert.equal(pending.length,1);
    const [req]=pending;
    assert.equal(req.origin.taskId,parent.taskId);
    assert.equal(req.payload.tool,'Bash');
    assert.equal(req.payload.input.command,plan.command);
    for(let i=0;i<4&&!await app.evaluate(selectorExpr(panel)+'?.innerText.includes('+JSON.stringify(plan.command)+')');i++){
      await click('.agent-request-nav button:last-child');
    }
    await app.waitFor(selectorExpr(panel)+'?.innerText.includes('+JSON.stringify(plan.command)+')',5000);
    await app.screenshot(join(out,'08-local-browser-command-approval.png'));
    await click('.agent-request button[aria-label="批准"]');
    await click('.agent-confirm-choice');
    result.oneBrowserCommandApproval=compact(req);
  }
  const composition=await until(async()=>{
    await maybeApproveExactBrowserCli();
    const [one,two,business,native]=await Promise.all([siblingRequest('one'),siblingRequest('two'),businessRequest(),nodeRequest()]);
    if(!one||!two||!business||!native)return false;
    return {one,two,business,native};
  },'all genuinely available requests coexist at one point');
  const activeCount=4;
  for(const [id,owner] of Object.entries(ownerIds).filter(([id])=>id!=='codex')) {
    assert.equal(composition[id].origin.taskId,owner);
    assert.match(composition[id].origin.runId,/^[a-f0-9-]{36}$/);
    assert.match(composition[id].origin.bindingId,/^[a-f0-9-]{36}$/);
    assert(Number.isInteger(composition[id].origin.generation));
    assert(composition[id].origin.nativeRequest);
    assert.equal(composition[id].class,'native');
  }
  assert.equal(composition.business.origin.taskId,parent.taskId);
  assert.equal(composition.business.payload.review.targetTaskId,target.taskId);
  const parentBinding=sql('SELECT task_id,profile_id,state_root,native_id FROM agent_bindings WHERE binding_id=?',
    [composition.business.origin.bindingId])[0];
  assert.equal(parentBinding.task_id,parent.taskId);
  assert.equal(parentBinding.profile_id,profile.id);
  assert.equal(parentBinding.state_root,result.managedAgent.root);
  assert(parentBinding.native_id);
  assert.equal(createHash('sha256').update(readFileSync(result.managedAgent.file)).digest('hex'),result.managedAgent.sha256);
  result.managedAgent.productionBinding=parentBinding;
  if(composition.native){
    const source=composition.native.origin;
    assert(source.nativeRequest,'Codex child request must carry its own native request id');
    assert.equal(source.taskId,ownerIds.codex);
    assert.notEqual(source.runId,composition.business.origin.runId);
    assert.notEqual(source.runId,composition.one.origin.runId);
    assert.notEqual(source.runId,composition.two.origin.runId);
    assert.equal(composition.native.class,'native');
    assert.equal(composition.native.kind,'command_approval');
  }
  const alive=Object.entries(composition).filter(([,v])=>v);
  assert.equal(new Set(alive.map(([,v])=>v.requestId)).size,activeCount);
  assert.notEqual(composition.one.origin.runId,composition.two.origin.runId);
  result.coexisting=Object.fromEntries(alive.map(([name,req])=>[name,compact(req)]));
  result.coexistingLedger=sql('SELECT request_id,task_id,class,status,revision,origin_json FROM agent_requests WHERE request_id IN ('+
    alive.map(()=>'?').join(',')+') ORDER BY request_id',alive.map(([,request])=>request.requestId));
  assert.equal(result.coexistingLedger.length,activeCount);
  assert(result.coexistingLedger.every(row=>row.status==='pending'));
  for (const [,request] of alive) {
    const row=result.coexistingLedger.find(item=>item.request_id===request.requestId);
    assert.equal(row.task_id,request.origin.taskId);
    assert.deepEqual(JSON.parse(row.origin_json),request.origin);
    assert.equal(row.revision,request.revision);
  }
  if(!composition.native){
    result.nativeBoundary={providerReached:!!flow.records.native.providerReached,
      availableTools:flow.records.native.toolNames??[],explicitlyUnavailable:!!flow.records.native.notExposed,
      agentReply:flow.records.native.agentReply,originalQuestionReply:flow.records.native.reply??null};
  }
  await app.waitFor('document.querySelector(".agent-request-nav")?.innerText.includes("/'+activeCount+'")',12000);
  for(const [marker,file] of [[siblings[0].title,'sibling-one'],[siblings[1].title,'sibling-two'],[browserCardMarker,'business']]){
    await showCard(marker,activeCount);
    if(file==='business'){
      assert((await app.evaluate(selectorExpr(askHead)+'?.innerText'))?.startsWith(browserCardMarker));
      await app.waitFor('Boolean('+selectorExpr(observeControl)+')',5000);
    }
    await app.screenshot(join(out,'10-coexisting-'+file+'.png'));
  }
  if(composition.native){
    await showCard(codexTitle,activeCount);
    await app.waitFor(selectorExpr(panel)+'?.innerText.includes('+JSON.stringify(codexCommand)+')',5000);
    await app.screenshot(join(out,'10-coexisting-native.png'));
  }
  record('simultaneous actual requests observed',{count:activeCount,full:!!composition.native});

  phase='foreign sibling response is refused without affecting the UI';
  const foreignAnswer={behavior:'allow',updatedInput:{answers:{[question]:answers[0]}}};
  await assert.rejects(()=>app.invoke('agentTasks.respond',ownerIds.two,composition.one.requestId,composition.one.revision,foreignAnswer),/请求不存在/);
  assert.equal((await siblingRequest('one'))?.requestId,composition.one.requestId);
  assert.equal((await siblingRequest('two'))?.requestId,composition.two.requestId);

  phase='cancel one request from the real unified parent panel';
  await showCard(siblings[0].title,activeCount);
  await click('.agent-request button','不回答');
  await until(()=>flow.records.siblings.one.reply,'the original denied sibling callback');
  assert(flow.records.siblings.one.reply.isError||/未回答|没有回答|denied|declined|decline/i.test(flow.records.siblings.one.reply.text));
  await until(async()=>!(await siblingRequest('one')),'only canceled request retires');
  assert.equal((await siblingRequest('two'))?.requestId,composition.two.requestId);
  assert.equal((await businessRequest())?.requestId,composition.business.requestId);
  if(composition.native)assert.equal((await nodeRequest())?.requestId,composition.native.requestId);
  await assert.rejects(()=>app.invoke('agentTasks.respond',ownerIds.one,composition.one.requestId,composition.one.revision,foreignAnswer),staleError);
  assert.equal((await siblingRequest('two'))?.requestId,composition.two.requestId);
  result.rejectedNegative={foreignTask:true,oldSameOwner:true,unrelatedStillPending:true};
  await app.screenshot(join(out,'20-after-one-cancel.png'));

  phase='answer the untouched brother through the actual parent request panel';
  await showCard(siblings[1].title,activeCount-1);
  await click('.agent-request .agent-form-q label',answers[1]);
  await click('.agent-request button','提交回答');
  await until(()=>flow.records.siblings.two.reply,'the other original native sibling callback');
  assert.equal(flow.records.siblings.two.reply.isError,false);
  assert(flow.records.siblings.two.reply.text.includes(answers[1]));
  assert(!flow.records.siblings.two.reply.text.includes(answers[0]));
  assert(!flow.records.siblings.one.reply.text.includes(answers[1]));

  phase='approve only the independent local browser business request';
  await showCard(browserCardMarker,activeCount-2);
  await click(observeControl);
  await click('.agent-confirm-choice');
  const expectedRun=composition.business.origin.runId;
  result.actualGrant=await until(async()=>{
    const model=await app.invoke('browser.accessState');
    return model.grants.find(g=>g.requesterTaskId===parent.taskId&&g.targetTaskId===target.taskId);
  },'real observe grant bound to the correct run');
  assert.equal(result.actualGrant.mode,'observe');
  assert.equal(result.actualGrant.runId,expectedRun);
  if(composition.native){
    phase='approve only the Codex child native command still pending';
    assert.equal((await nodeRequest())?.requestId,composition.native.requestId);
    await showCard(codexTitle,1);
    await app.screenshot(join(out,'25-codex-command-last.png'));
    // Attempt 346: the command card uses choice options ("批准一次") plus a confirm button, not a single "批准" button.
    await click('.agent-request button[aria-label="批准一次"]');
    await app.waitFor(selectorExpr('.agent-request button[aria-label="批准一次"]')+'?.getAttribute("aria-selected")==="true"',5000);
    await click('.agent-confirm-choice');
    await until(()=>flow.records.codex.reply,'the Codex child receives its own command output');
    const codexWorkspace=(await relations(parent.taskId)).children.find(c=>c.childTaskId===ownerIds.codex)?.workspace?.path;
    assert(codexWorkspace&&existsSync(join(codexWorkspace,'a26-codex-canary.txt')),'command ran in the Codex child worktree');
    assert(!existsSync(join(cwd,'a26-codex-canary.txt')),'command did not touch the parent directory');
    result.codexApproval={workspace:codexWorkspace,reply:flow.records.codex.reply,request:compact(composition.native)};
  }
  await until(()=>flow.records.native.agentReturned,'native Agent return receipt');
  flow.releaseParent();
  phase='settle original local task tree and preserve source isolation evidence';
  await until(async()=>{
    const snap=await snapshot(parent.taskId);
    const tasks = await app.invoke('agentTasks.list');
    const finished = tasks.every(task=>!['working','waiting'].includes(task.status));
    const children = (await relations(parent.taskId)).children;
    return finished && !snap.run?.busy && answerPresent(snap,rootDone) && children.every(child=>
      child.state===(noGitIdentity && child.childTaskId===ownerIds.codex ? 'failed' : 'delivered'));

  },'completed isolated parent and all child results',45000);
  assert.equal(git('rev-parse','HEAD'),head);
  assert.equal(git('status','--porcelain'),'');
  const hostCommit = sql("SELECT state,json_extract(result_json,'$.head') AS head,json_extract(result_json,'$.error') AS error FROM agent_intents WHERE action='child_result_commit' AND task_id=?", [ownerIds.codex]);
  assert.equal(hostCommit.length,1,'one host commit intent for the approved child');
  const receipts = sql("SELECT a.notified_at,a.commit_range FROM agent_delegation_attempts a JOIN agent_delegations d ON a.delegation_id=d.delegation_id WHERE d.child_task_id=?", [ownerIds.codex]);
  assert.equal(receipts.length,1);
  assert(receipts[0].notified_at);
  if (noGitIdentity) {
    assert.equal(hostCommit[0].state,'needs_review');
    assert.match(hostCommit[0].error,/Author identity unknown|unable to auto-detect email address/);
    assert.equal(receipts[0].commit_range,null);
    const failure = sql("SELECT payload_ref FROM agent_items WHERE task_id=? AND type='notification' AND json_extract(payload_ref,'$.childTaskId')=?", [parent.taskId,ownerIds.codex]);
    assert.equal(failure.length,1);
    const notice = JSON.parse(failure[0].payload_ref);
    assert.equal(notice.status,'failed');
    assert.match(notice.summary,/工作副本收口失败/);
    assert(existsSync(join(result.codexApproval.workspace,'a26-codex-canary.txt')));
    result.d0664={mode:'missing identity',intent:hostCommit[0].state,childResultNotified:true,childChangesPreserved:true,sourceHeadUnchanged:true};
  } else {
    assert.equal(hostCommit[0].state,'done');
    const commit = hostCommit[0].head;
    const changes = git('show','--format=','--name-only',commit);
    assert(changes.split('\n').includes('a26-codex-canary.txt'));
    assert(JSON.parse(receipts[0].commit_range).commits.includes(commit));
    result.d0664={mode:'configured identity',hostCommit,childResultNotified:true,sourceHeadUnchanged:true};
  }
  assert.deepEqual(app.rendererErrors,[]);
  result.split={siblingQuestionSource:true,siblingCanceled:true,remainingAnswered:true,oldResponseRejected:true,
    localBusinessSource:true,codexChildCommandApproval:true,fourTogether:true};
  await app.screenshot(join(out,'30-composed-outcome.png'));
  result.status='passed';
} catch (error) {
  result.phase = phase;
  result.error = String(error.stack ?? error);
  if (error.electronStartupLogs) result.startupError = error.electronStartupLogs;
  if (app) try {
    result.visible = await app.evaluate('document.body.innerText.slice(0,12000)');
    await app.screenshot(join(out, '99-failure.png'));
  } catch { /* target already exited */ }
} finally {
  flow?.stop();
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
if (!['passed','partial'].includes(result.status) || result.exit?.code !== 0 || result.exit.signal || result.rendererErrors?.length || result.cleanupMadeIdle?.length) process.exitCode=1;
else if(result.status==='partial')process.exitCode=2;
