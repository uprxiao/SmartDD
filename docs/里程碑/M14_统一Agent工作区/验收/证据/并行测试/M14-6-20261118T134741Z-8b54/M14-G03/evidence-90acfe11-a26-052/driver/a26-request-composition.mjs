import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { openElectron, pause } from '../../prep-fef791bc6/electron-harness.mjs';
import { redirectHome } from '../../prep-fef791bc6/home-redirect-main.mjs';
import { answers, browserDone, browserLabel, browserPrompt, createRequestFlow,
  nativeAnswer, nativeQuestion, nativeType, question, rootDone, rootPrompt } from './request-flow.mjs';

const base='/private/tmp/willyou-m14-stage6.WRvdST';
const [out,sourceCommit]=process.argv.slice(2);
const executable=process.env.M14_ACCEPTANCE_APP;
const asar=process.env.M14_EXPECTED_ASAR_SHA256;
assert.match(out??'',/^\/private\/tmp\/willyou-m14-stage6\.WRvdST\/g03\/attempt-[0-9]+$/);
assert.match(sourceCommit??'',/^[0-9a-f]{40}$/);
assert.match(asar??'',/^[0-9a-f]{64}$/);
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
const models={ parent:'a26-compose-parent',browser:'a26-compose-browser',one:'a26-compose-one',two:'a26-compose-two' };
const siblings=[{id:'one',title:'A26 同文子任务一',model:models.one,marker:'A26_COMPOSED_SIBLING_ONE'},
  {id:'two',title:'A26 同文子任务二',model:models.two,marker:'A26_COMPOSED_SIBLING_TWO'}];
const hookResult={};
const result={bootstrap:hookResult,sourceCommit,asar,executable,scope:'real packaged App, local-only Claude, literal private browser grant and project native subagent',
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
const staleError=/请求已结束|请求已更新|请求不存在|已结束的运行/;
const git=(...args)=>execFileSync('git',args,{cwd,env:{PATH:process.env.PATH,LANG:'en_US.UTF-8',...env},encoding:'utf8',timeout:10000}).trim();
let phase='isolated synthetic project';
try{
  const config=join(cwd,'.claude','agents');
  mkdirSync(config,{recursive:true,mode:0o700});
  writeFileSync(join(config,nativeType+'.md'),[
    '---','name: '+nativeType,'description: Ask one literal question in the isolated A26 fixture',
    'tools: AskUserQuestion','model: inherit','---','Ask only the provided synthetic question. Do not run commands or touch files.',
  ].join('\n')+'\n',{mode:0o600,flag:'wx'});
  writeFileSync(join(cwd,'README.md'),'M14 local A26 fixture.\n',{mode:0o600,flag:'wx'});
  git('init','-qb','main');
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
  const project=await app.invoke('projects.create',{name:'A26 private question composition',aliases:[],description:'',rulesPath:null},[{label:'isolated Git',path:cwd}]);
  const create=(title,model)=>app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,cwd,title,
    profileId:profile.id,model,tier:'ask'});
  const parentTitle='A26 主任务 · 统一请求';
  const targetTitle='A26 本机网页所属任务';
  const parent=await create(parentTitle,models.parent);
  const target=await create(targetTitle,models.browser);
  flow=createRequestFlow({profiles:{claude:profile.id},models,browserTaskId:target.taskId,origin,siblings});
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

  phase='genuine host siblings, business invocation and native project agent';
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
  const nodeRequest=()=>mainRequests().then(reqs=>reqs.find(r=>r.kind==='user_input'&&JSON.stringify(r.payload).includes(nativeQuestion)));
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
    if(!one||!two||!business||(!native&&!flow.records.native.agentReturned))return false;
    return {one,two,business,native};
  },'all genuinely available requests coexist at one point');
  const activeCount=composition.native?4:3;
  for(const [id,owner] of Object.entries(ownerIds)) {
    assert.equal(composition[id].origin.taskId,owner);
    assert.match(composition[id].origin.runId,/^[a-f0-9-]{36}$/);
    assert.match(composition[id].origin.bindingId,/^[a-f0-9-]{36}$/);
    assert(Number.isInteger(composition[id].origin.generation));
    assert(composition[id].origin.nativeRequest);
    assert.equal(composition[id].class,'native');
  }
  assert.equal(composition.business.origin.taskId,parent.taskId);
  assert.equal(composition.business.payload.review.targetTaskId,target.taskId);
  if(composition.native){
    assert(composition.native.origin.nodeId,'genuine native child request must bind its own node');
    assert.equal(composition.native.origin.taskId,parent.taskId);
    assert.equal(composition.native.origin.runId,composition.business.origin.runId);
  }
  const alive=Object.entries(composition).filter(([,v])=>v);
  assert.equal(new Set(alive.map(([,v])=>v.requestId)).size,activeCount);
  assert.notEqual(composition.one.origin.runId,composition.two.origin.runId);
  result.coexisting=Object.fromEntries(alive.map(([name,req])=>[name,compact(req)]));
  if(!composition.native){
    result.nativeBoundary={providerReached:!!flow.records.native.providerReached,
      availableTools:flow.records.native.toolNames??[],explicitlyUnavailable:!!flow.records.native.notExposed,
      agentReply:flow.records.native.agentReply};
  }
  await app.waitFor('document.querySelector(".agent-request-nav")?.innerText.includes("/'+activeCount+'")',12000);
  for(const [marker,file] of [[siblings[0].title,'sibling-one'],[siblings[1].title,'sibling-two'],['跨任务浏览器授权','business']]){
    await showCard(marker,activeCount);
    await app.screenshot(join(out,'10-coexisting-'+file+'.png'));
  }
  if(composition.native){
    await showCard(nativeQuestion,activeCount);
    await app.waitFor('document.querySelector(".agent-request-head")?.innerText.includes("来自执行器原生子 Agent")',5000);
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
  await showCard('跨任务浏览器授权',activeCount-2);
  await click('.agent-request button[aria-label="允许观察"]');
  await click('.agent-confirm-choice');
  const expectedRun=composition.business.origin.runId;
  result.actualGrant=await until(async()=>{
    const model=await app.invoke('browser.accessState');
    return model.grants.find(g=>g.requesterTaskId===parent.taskId&&g.targetTaskId===target.taskId);
  },'real observe grant bound to the correct run');
  assert.equal(result.actualGrant.mode,'observe');
  assert.equal(result.actualGrant.runId,expectedRun);
  if(composition.native){
    phase='reply only to the genuine native node still pending';
    assert.equal((await nodeRequest())?.requestId,composition.native.requestId);
    await showCard(nativeQuestion,1);
    await click('.agent-request .agent-form-q label',nativeAnswer);
    await click('.agent-request button','提交回答');
    await until(()=>flow.records.native.reply,'the specifically matched native node reply');
    assert.equal(flow.records.native.reply.isError,false);
    assert(flow.records.native.reply.text.includes(nativeAnswer));
    assert(!flow.records.native.reply.text.includes(answers[1]));
  }
  await until(()=>flow.records.native.agentReturned,'native Agent return receipt');
  flow.releaseParent();
  phase='settle original local task tree and preserve source isolation evidence';
  await until(async()=>{
    const snap=await snapshot(parent.taskId);
    return !snap.run?.busy&&answerPresent(snap,rootDone)&&(await relations(parent.taskId)).children.every(child=>child.state==='delivered');
  },'completed isolated parent and both child results',60000);
  assert.equal(git('rev-parse','HEAD'),head);
  assert.equal(git('status','--porcelain'),'');
  assert.deepEqual(app.rendererErrors,[]);
  result.split={siblingQuestionSource:true,siblingCanceled:true,remainingAnswered:true,oldResponseRejected:true,
    localBusinessSource:true,nativeChildQuestion:!!composition.native,fourTogether:!!composition.native};
  await app.screenshot(join(out,'30-composed-outcome.png'));
  result.status=composition.native?'passed':'partial';
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
