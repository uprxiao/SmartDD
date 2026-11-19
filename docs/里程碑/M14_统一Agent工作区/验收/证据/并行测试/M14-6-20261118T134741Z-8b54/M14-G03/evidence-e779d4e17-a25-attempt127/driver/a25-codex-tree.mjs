import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { openElectron, pause } from '../../prep-fef791bc6/electron-harness.mjs';
import { redirectHome } from '../../prep-fef791bc6/home-redirect-main.mjs';
import { prepareWorkspace } from '../a31-recheck/fixtures.mjs';
import { businessFixture, businessGate, seedBusiness } from '../a32-recheck/business/harness.mjs';
import { createSameTree, fixture } from './protocol.mjs';
import { verifyTree } from './tree-scenario.mjs';

const base='/private/tmp/willyou-m14-stage6.WRvdST';
const [out,commit,asar]=process.argv.slice(2);
const bundle=join(base,'package/mac-arm64/WillYou.app/Contents'), executable=process.env.M14_ACCEPTANCE_APP;
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
assert.match(out??'',/^\/private\/tmp\/willyou-m14-stage6\.WRvdST\/g03\/attempt-[0-9]+$/);
assert.match(commit??'',/^[0-9a-f]{40}$/);assert.match(asar??'',/^[0-9a-f]{64}$/);
assert.equal(process.cwd(),join(base,'source'));
assert.equal(executable,join(bundle,'MacOS/WillYou'));assert.equal(realpathSync(executable),executable);
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
const result={sourceCommit:commit,asar,candidate:executable,axis:'same-codex-tree',actions:[],requests:[],passed:false,
  layer:'A packaged UI with native transports and an isolated synthetic loopback provider'};
let app,appTrusted=false,phase='fixture and private app',workspace,cwd,parent,leaseGate,workflow;
const selected=selector=>'document.querySelector('+JSON.stringify(selector)+')';
const state=id=>app.invoke('agentTasks.snapshot',id);
const relations=id=>app.invoke('agentTasks.relations',id);
const modelIds=Object.values(fixture.models);
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
const server=createServer(async(req,res)=>{
  try{
    if(req.method==='GET'&&req.url?.endsWith('/models')){
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({data:modelIds.map(id=>({id}))}));
      return;
    }
    if(req.method!=='POST'||!req.url?.includes('/responses')){res.statusCode=404;res.end();return;}
    let size=0;const chunks=[];
    for await(const chunk of req){size+=chunk.length;assert(size<4*1024*1024);chunks.push(chunk);}
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const request={at:Date.now(),model:body.model,bytes:size};
    result.requests.push(request);
    assert(workflow,'provider used before fixture and product lanes were ready');
    const action=await workflow.next(body);
    Object.assign(request,{type:action.type,tool:action.call?.tool.name??null,callId:action.call?.callId??null,answeredAt:Date.now()});
    if(!res.destroyed)providerResponse(res,body.model,action);
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
function sql(query,args=[]){
  const db=join(data,'smartdd.db');assert.equal(realpathSync(db),db);
  const py='import sqlite3,json,pathlib,sys;c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro",uri=True);c.row_factory=sqlite3.Row;print(json.dumps([dict(r) for r in c.execute(sys.argv[2],json.loads(sys.argv[3]))]))';
  return JSON.parse(execFileSync('/usr/bin/python3',['-c',py,db,query,JSON.stringify(args)],{encoding:'utf8',timeout:10000}));
}

async function setup() {
  workspace=prepareWorkspace(root,home,{PATH:process.env.PATH,LANG:'en_US.UTF-8',...env},'plain');
  cwd=workspace.common;
  phase='install previously verified credential-free plugin fixture';
  result.seed=seedBusiness({out,root,executable,asar,commit});
  leaseGate=businessGate(data);
  assert(!leaseGate.read());
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(3425,'127.0.0.1',resolve);
  });
  phase='launch and verify the exact isolated application';
  const boot={};
  app=await openElectron({executable,userData:data,env,inspectMain:true,startupMainHook:async info=>Object.assign(boot,await redirectHome({...info,home}))});
  const identity=await app.mainEvaluate(`(() => {const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    return [E.app.isPackaged,E.app.getPath('userData'),E.app.getPath('home'),process.env.HOME,process.execPath,process.pid]})()`);
  assert.deepEqual(identity,[true,data,home,home,executable,app.processId]);
  appTrusted=true;
  result.app={pid:app.processId,boot,identity};
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await app.invoke('agents.refreshTools');
  const tools=await app.invoke('agents.tools');
  const codex=tools.find(x=>x.kind==='codex'&&x.installed&&x.version==='0.169.0');
  assert(codex,'the validated Codex app-server is required');
  const provider=await app.invoke('agents.saveProvider',{name:'A25 same-tree isolated loopback',preset:'magpie',
    endpoints:{responses:origin+'/v1'},models:modelIds.map(id=>({id,name:id}))});
  const codexParent=await app.invoke('agents.save',{name:'A25 Codex same-tree parent',toolId:codex.id,source:'provider',
    providerId:provider.id,models:[fixture.models.parent],defaultModel:fixture.models.parent,isDefault:true});
  const codexChild=await app.invoke('agents.save',{name:'A25 Codex independent read-only child',toolId:codex.id,source:'provider',
    providerId:provider.id,models:[fixture.models.child],defaultModel:fixture.models.child,isDefault:false});
  const project=await app.invoke('projects.create',{name:'A25 isolated same-tree project',aliases:[],description:'',rulesPath:null},
    [{label:'private',path:cwd}]);
  const made=await app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,cwd,title:fixture.title,
    profileId:codexParent.id,model:fixture.models.parent,tier:'ask'});
  parent={taskId:made.taskId,title:fixture.title};
  result.configuration={taskId:parent.taskId,parentProfileId:codexParent.id,childProfileId:codexChild.id,nativeVersion:codex.version};
  workflow=createSameTree(codexChild.id);
  const capability={appId:businessFixture.appId,packageHash:result.seed.installed.hash};
  const settings=await app.invoke('applications.pluginProjectSettings',capability,project.id);
  assert(settings.ok&&settings.value.enabled===1);
  assert.equal(settings.value.connectionId,null);
  assert.equal(settings.value.defaultConnectionId,null);
  await click('[data-testid="nav-settings"]');
  const toggle='[data-testid="m14-toggle"]';
  if(!await app.evaluate('Boolean('+selected(toggle)+')'))await click('.settings-nav button.nav-row','常规');
  if(!await app.evaluate(selected(toggle)+'?.innerText.includes("已开启")'))await click(toggle);
  await app.waitFor(selected(toggle)+'?.innerText.includes("已开启")',10000);
  await click('[data-testid="nav-home"]');
}

const userInput=(taskId,text)=>sql("SELECT turn_id,run_id,native_turn_id,status FROM agent_turns WHERE task_id=? AND json_extract(input_ref,'$.text')=?",[taskId,text])[0];
const backgroundNode=(taskId,runId,nodeId)=>sql("SELECT run_id,node_id,json_extract(payload_ref,'$.state') AS state FROM agent_items WHERE task_id=? AND run_id=? AND node_id=? AND type='subagent_status'",[taskId,runId,nodeId])[0];
const requestRecord=id=>sql("SELECT request_id,operation_id,status,json_extract(payload_ref,'$.phase') phase FROM agent_requests WHERE request_id=?",[id])[0];
const approval='.agent-request-options button:is([aria-label="批准"],[aria-label*="批准一次"])';
async function approveExisting() {
  await click(approval);
  await click('.agent-request .agent-confirm-choice');
}
async function quit(){
  if(!app)return;
  if(!appTrusted){result.cleanup=await app.crash();return;}
  try{
    const tasks=await app.invoke('agentTasks.list');
    result.beforeQuit=tasks.map(({taskId,status})=>({taskId,status}));
    if(!result.passed)for(const t of tasks.filter(x=>!x.parentTaskId&&['working','waiting'].includes(x.status))){
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

try {
  await setup();
  await verifyTree({app,out,result,parent,s:workflow.state,open,send,click,state,relations,select:selected,until,sql,
    userInput,backgroundNode,requestRecord,approveExisting,leaseGate,stage:label=>{phase=label;}});
  workspace.assertSafe();
  result.passed=true;
} catch (error) {
  result.phase=phase;
  result.error=String(error.stack??error);
  if(error.electronStartupLogs) result.startupError=error.electronStartupLogs;
  if(appTrusted) try {
    result.visible=await app.evaluate('document.body.innerText.slice(0,6500)');
    await app.screenshot(join(out,'99-failure.png'));
  } catch {/* target already gone */}
} finally {
  if(leaseGate&&!result.businessReleaseAuthorized) try {
    const effect=leaseGate.read();
    if(effect) leaseGate.allow(effect.operationId);
  } catch (error) {result.leaseCleanupError=String(error);}
  if(workflow) {
    const {childGate,nativeGate,parentGate,...observed}=workflow.state;
    result.treeProtocol=observed;
    workflow.close();
  }
  await quit();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  result.passed=result.passed&&result.app?.exit?.code===0&&!result.app.exit.signal&&
    !result.serverError&&!result.rendererErrors.length;
  writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2),{mode:0o600});
}
if(!result.passed)process.exitCode=1;
