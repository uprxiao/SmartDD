import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, closeSync, existsSync, copyFileSync, ftruncateSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [rawExecutable, attempt, expectedAsar, scenario, sourceAttempt] = process.argv.slice(2);
assert(['seed','pressure','disk','enterprise'].includes(scenario));
for (const key of ['DEEPSEEK_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','OPENAI_API_KEY','CODEX_API_KEY','CLAUDE_CODE_OAUTH_TOKEN'])
  assert(!process.env[key], 'No external credential for A65: '+key);
const executable=realpathSync(rawExecutable);
const packageRoot=/^(\/private\/tmp\/willyou-m14-stage6\.[A-Za-z0-9]{6})\/package\/mac-arm64\/WillYou\.app\/Contents\/MacOS\/WillYou$/.exec(executable)?.[1];
assert(packageRoot&&attempt.startsWith(packageRoot+'/g04/'));
const privateAttempt=/^\/g04\/attempt-\d{3}$/;
assert.match(attempt.slice(packageRoot.length),privateAttempt);
const root=join(packageRoot,'g04');
const {openElectron,pause}=await import(pathToFileURL(join(root,'helpers/scripts/lib/electron-harness.mjs')));
const {redirectHome}=await import(pathToFileURL(join(root,'helpers/scripts/applications/fixtures/home-redirect-main.mjs')));
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const archive=join(dirname(executable),'../Resources/app.asar');
assert.match(expectedAsar,/^[a-f0-9]{64}$/);
assert.equal(sha(archive),expectedAsar);
const commit=process.env.M14_ACCEPTANCE_COMMIT;
assert.match(commit,/^[a-f0-9]{40}$/);
let previous=null;
if(scenario==='pressure'){
  assert(sourceAttempt?.startsWith(root+'/')&&sourceAttempt!==attempt);
  assert.match(sourceAttempt.slice(packageRoot.length),privateAttempt);
  assert.equal(realpathSync(sourceAttempt),sourceAttempt);
  const seed=JSON.parse(readFileSync(join(sourceAttempt,'result.json'),'utf8'));
  assert.deepEqual([seed.sourceCommit,seed.build.appAsarSha256,seed.scenario,seed.exit.code],
    [commit,expectedAsar,'seed',0]);
  previous=seed.cases['A34-seed'].reclaim;
  assert(previous&&previous.cwd.startsWith(sourceAttempt+'/')&&realpathSync(previous.cwd)===previous.cwd);
}else assert.equal(sourceAttempt,undefined);
mkdirSync(attempt,{mode:0o700});
copyFileSync(new URL(import.meta.url),join(attempt,'source-a34-budget.mjs'));
const stateRoot=sourceAttempt??attempt;
if(!sourceAttempt)for(const directory of ['home','data'])mkdirSync(join(stateRoot,directory));
const home=realpathSync(join(stateRoot,'home')),userData=realpathSync(join(stateRoot,'data'));
if(!sourceAttempt)mkdirSync(join(home,'Library','Keychains'),{recursive:true,mode:0o700});
const result={sourceCommit:commit,build:{executable,appAsarSha256:expectedAsar},scenario,sourceAttempt:sourceAttempt??null,
  layer:'A: packaged App, real diff worker and private SVN shadow, native Codex with isolated local model, background CDP UI. Sparse logical pressure / disk image disclosed per case.',
  actions:[],model:[],page:[],cases:{},startedAt:new Date().toISOString()};
const cleanup={isolationAttempt:attempt,activeStateRoot:stateRoot};
const configurations = new Map();
const modelName = 'm14-workspace-fixture';
const childModel='m14-archive-child-fixture';
let origin, app, profile, activeTaskId;
let modelFailures = [];
const server = createServer((req,res) => { void respond(req,res).catch(error=>{
  modelFailures.push(String(error.message??error)); res.destroy();
}); });
async function respond(req,res) {
  const endpoint=new URL(req.url,origin??'http://127.0.0.1');
  if(endpoint.pathname==='/page') {
    const already=String(req.headers.cookie??'').split('; ').includes('m14synthetic=1');
    result.page.push({query:endpoint.search,hasSyntheticLogin:already});
    res.writeHead(200,{'content-type':'text/html',...(!already?{'set-cookie':'m14synthetic=1; Path=/; SameSite=Lax'}:{})});
    res.end(`<!doctype html><meta charset="utf-8"><title>M14 ${already?'fixture logged in':'fixture sign-in seed'}</title><h1>Local fixture page</h1>`);
    return;
  }
  if(endpoint.pathname.endsWith('/models')){
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({data:[{id:modelName},{id:childModel}]}));
    return;
  }
  const anthropic=endpoint.pathname.endsWith('/messages');
  if(req.method!=='POST'||(!anthropic&&!endpoint.pathname.endsWith('/responses'))){res.writeHead(404);res.end();return;}
  const chunks=[];
  for await(const chunk of req) chunks.push(chunk);
  const body=JSON.parse(Buffer.concat(chunks).toString());
  const input=JSON.stringify(anthropic?body.messages:body.input);
  const matching=[...configurations.values()].filter(entry=>Boolean(entry.child)===(body.model===childModel));
  const messages=anthropic?body.messages:body.input;
  const latest=Array.isArray(messages)?messages.findLast(item=>item?.role==='user'):null;
  const marked=(source)=>matching.map(entry=>({entry,position:source.lastIndexOf(entry.mark)})).filter(row=>row.position>=0).sort((a,b)=>b.position-a.position)[0]?.entry;
  const wake=latest&&JSON.stringify(latest).includes('宿主子任务结果通知');
  const config=(wake?matching.findLast(entry=>entry.parent):latest?marked(JSON.stringify(latest)):undefined)??marked(input);
  assert(config, 'Fixture marker missing from native input');
  const tools=(body.tools??[]).flatMap(t=>t.type==='namespace'?(t.tools??[]).map(x=>({...x,namespace:t.name})):[t]);
  const matchedTool=config.toolMatch?tools.find(t=>config.toolMatch.test((t.namespace??'')+' '+t.name)):null;
  const tool=matchedTool??tools.find(t=>t.name==='exec_command');
  const invoke=!!(config.command||config.toolMatch)&&!config.commandEmitted;
  if(invoke){
    assert(matchedTool||config.command&&tool,'The real Codex tool catalog did not include '+config.toolMatch);
    config.commandEmitted=true;
  }
  if(config.receiptMarker&&input.includes(config.receiptMarker))config.receiptObserved=true;
  result.model.push({caseId:config.caseId,model:body.model,tool:tool?.name,invoke,receiptObserved:!!config.receiptObserved});
  for(const entry of body.input??[]) {
    if(entry.type!=='function_call_output'||entry.call_id!==config.callId)continue;
    config.toolReply=Array.isArray(entry.output)?entry.output.map(x=>x.text??'').join('\n'):String(entry.output??'');
    config.toolReply=config.toolReply.slice(0,3000);
  }
  const item=invoke
    ? {id:'fc'+randomUUID(),type:'function_call',call_id:'call'+randomUUID(),name:tool.name,
      ...(tool.namespace?{namespace:tool.namespace}:{}),
      arguments:JSON.stringify(matchedTool?config.toolArguments:{cmd:config.command,workdir:config.cwd,max_output_tokens:500,...(config.execArgs??{})}),status:'completed'}
    : {id:'m'+randomUUID(),type:'message',role:'assistant',status:'completed',
      content:[{type:'output_text',text:config.answer,annotations:[]}]};
  if(anthropic){
    const use=!!config.claudeBackground&&!config.claudeCommandSent;
    if(use)config.claudeCommandSent=true;
    res.writeHead(200,{'content-type':'text/event-stream'});
    const event=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
    event('message_start',{message:{id:'m'+randomUUID(),type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});
    event('content_block_start',{index:0,content_block:use?{type:'tool_use',id:'toolu_'+randomUUID(),name:'Bash',input:{}}:{type:'text',text:''}});
    event('content_block_delta',{index:0,delta:use?{type:'input_json_delta',partial_json:JSON.stringify(config.claudeBackground)}:{type:'text_delta',text:config.answer}});
    event('content_block_stop',{index:0});
    event('message_delta',{delta:{stop_reason:use?'tool_use':'end_turn'},usage:{output_tokens:1}});
    event('message_stop',{});
    res.end();return;
  }
  if(invoke)config.callId=item.call_id;
  if(config.gate&&!config.commandEmitted){config.started=true;await config.gate;if(res.destroyed)return;}
  emitCodex(res,config,item,invoke);
}
function emitCodex(res,config,item,invoke) {
  const id='r'+randomUUID();
  res.writeHead(200,{'content-type':'text/event-stream'});
  const emit=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
  emit('response.created',{response:{id,status:'in_progress',output:[]}});
  emit('response.output_item.added',{output_index:0,item:{...item,status:'in_progress'}});
  if(!invoke)emit('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:config.answer});
  emit('response.output_item.done',{output_index:0,item});
  emit('response.completed',{response:{id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});
  res.end();
}

const serializable=value=>JSON.stringify(value);
const model="document.querySelector('.fw-editor-host .cm-content')?.cmTile?.root?.view";
const failText=e=>String(e?.stack??e);
const visibleExpression=(selector)=>`[...document.querySelectorAll(${serializable(selector)})].some(e=>e.getBoundingClientRect().height>0&&e.getBoundingClientRect().width>0)`;
async function key(key,code,modifiers=0) {
  let special={Enter:[13,'\r'],Backquote:[192,'`']};
  const [windowsVirtualKeyCode,text]=special[code]??[/^Key[A-Z]$/.test(code)?code.charCodeAt(3):0,key.length===1?key:''];
  await app.cdp('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,windowsVirtualKeyCode,...(!modifiers&&text?{text}:{})});
  await app.cdp('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers,windowsVirtualKeyCode});
}
async function click(selector,label, options={}) {
  const point=await app.evaluate(`(()=> {
    const candidates=[...document.querySelectorAll(${serializable(selector)})].filter(e=>e.getBoundingClientRect().height>0&&
      ${label===undefined?'true':`e.textContent.trim()===${serializable(label)}`});
    if(candidates.length!==1)throw Error('Expected one control, found '+candidates.length+' for '+${serializable(selector)});
    const e=candidates[0];e.scrollIntoView({block:'nearest'});
    if(e.matches(':disabled,[aria-disabled="true"]'))throw Error('Control is disabled: '+${serializable(selector)});
    for(const box of e.getClientRects()){
      const left=Math.max(0,box.left),right=Math.min(innerWidth,box.right),top=Math.max(0,box.top),bottom=Math.min(innerHeight,box.bottom);
      if(right<=left||bottom<=top)continue;
      const x=(left+right)/2,y=(top+bottom)/2;
      if(e.contains(document.elementFromPoint(x,y)))return{x,y};
    }
    throw Error('Visible control has no unoccluded clickable rect: '+${serializable(selector)});
  })()`);
  for (const type of ['mouseMoved','mousePressed','mouseReleased']) {
    const button=options.button??'left';
    await app.cdp('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button,clickCount:1}), ...(options.modifiers?{modifiers:options.modifiers}:{})});
  }
  result.actions.push({at:new Date().toISOString(),selector,label,...options,...point});
}
async function until(probe,message,ms=20000) {
  const deadline=Date.now()+ms;
  while(Date.now()<deadline){const value=await probe();if(value)return value;await pause(100);}
  throw Error('Timed out: '+message);
}
async function visible(selector) {
  await app.waitFor(visibleExpression(selector),15000);
}
async function screenshot(name) {
  await app.evaluate('document.fonts.ready.then(()=>true)');
  await app.waitFor("!document.getAnimations().some(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity)",5000);
  await app.screenshot(join(attempt,name+'.png'));
}
function record(id,passed,missing) {
  Object.assign(result.cases[id],{passed,missing,status:missing.length?'partial':'pass'});
}
async function runCase(id,test) {
  result.cases[id]={status:'started',passed:[],missing:[]};
  try{await test();}
  catch(error){
    const entry=result.cases[id];
    entry.status='failed-or-blocked';
    entry.error=failText(error);
    entry.dom=await app.evaluate('document.body.innerText.slice(-9000)').catch(()=>null);
    await screenshot(id+'-failed').catch(()=>{});
    if(activeTaskId)await app.invoke('agentTasks.stop',activeTaskId,true).catch(()=>{});
  }
  writeFileSync(join(attempt,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
}
async function checkedStep(id, label, action) {
  await action();
  result.cases[id].passed.push(label);
}
function prepareRoot(id,vcs) {
  const cwd=join(attempt,id), file=join(cwd,'a.txt');
  mkdirSync(cwd);
  const git=(...args)=>execFileSync('git',args,{cwd,env:{...process.env,HOME:home,GIT_CONFIG_GLOBAL:'/dev/null',
    GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'},encoding:'utf8',timeout:10000}).trim();
  writeFileSync(file,'Initial private A48 source\n');
  if(vcs==='git'){
    git('init','-q','-b','main');
    git('config','user.name','WillYou fixture');
    git('config','user.email','fixture@example.invalid');
    git('config','commit.gpgsign','false');
    git('add','a.txt');git('commit','-qm','A65 fixture');
  }
  return {cwd,file,git};
}
async function newFixture(id,{response=()=>'',command=()=>'',vcs='git'}={}) {
  const disk=prepareRoot(id,vcs);
  const project=await app.invoke('projects.create',{name:id+' stage 6',aliases:[],description:'',rulesPath:null},[{label:'work',path:disk.cwd}]);
  const task=await app.invoke('agentTasks.create',{
    projectId:project?.id??null,dirId:project?.dirs[0].id??null,cwd:disk.cwd,title:id+' stage 6',
    profileId:profile.id,model:modelName,tier:'ask',
  });
  const config={caseId:id,cwd:disk.cwd,mark:'M14_'+id+'_'+randomUUID(),answer:response(disk),command:command(disk)};
  configurations.set(config.mark,config);
  // Fixture preparation called projects.create outside the UI; reload the
  // renderer so its project query reads that new isolated dataset.
  await refreshFixtureUi();
  return {...disk,project,taskId:task.taskId,config};
}
async function refreshFixtureUi() {
  const previousOrigin=await app.evaluate('performance.timeOrigin');
  await app.cdp('Page.reload');
  await app.waitFor(`performance.timeOrigin!==${previousOrigin}&&Boolean(window.electronAPI&&document.querySelector('[data-testid=nav-settings]'))`,15000,{navigation:true});
  await app.arm();
}
async function openTask(fixture) {
  const sel=`[data-testid="sidebar-agent-task"][data-task-id="${fixture.taskId}"]`;
  await visible(sel);
  await click(sel);
  await visible('.agent-task-view textarea');
  activeTaskId=fixture.taskId;
}
const answerSel='.agent-assistant:not(.streaming) .agent-md a[data-agent-link]';
async function openLink(label) { await click(answerSel,label); }
async function openPanel(label) {
  const tab=`.agent-panel-tabs button[role="tab"]`;
  const existing=await app.evaluate(`[...document.querySelectorAll(${serializable(tab)})].find(e=>e.textContent.trim()===${serializable(label)})?.getAttribute('aria-selected')??null`);
  if(existing==='false'){await click(tab,label);return;}
  if(existing==='true')return;
  await click('.agent-panel-add button[title="打开面板"]');
  await click('.agent-panel-menu button',label+({文件:'F',浏览器:'B',终端:'T',差异:'D'}[label]));
}
async function clickActualSend() {
  const selector='.agent-task-view button[type="submit"]';
  // The settled composer can briefly overlap an archive/recovery toast or a
  // side pane animation. Wait for the actual hit target before dispatching.
  await app.waitFor(`(()=>{const e=document.querySelector(${serializable(selector)});if(!e||e.disabled)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`,15000);
  await click(selector);
}
async function sendTask(fixture) {
  configurations.delete(fixture.config.mark);
  configurations.set(fixture.config.mark,fixture.config);
  await click('.agent-task-view textarea');
  await app.cdp('Input.insertText',{text:fixture.config.mark+' Reply exactly once according to the local fixture.'});
  await clickActualSend();
  await until(async()=>{
    const current=await app.invoke('agentTasks.snapshot',fixture.taskId);
    const error=current.items.find(i=>i.type==='error');
    if(error)throw Error(JSON.stringify(error.payload));
    const buttons=await app.evaluate("[...document.querySelectorAll('.agent-request-options button')].map(e=>e.textContent)");
    if(buttons.some(text=>text.includes('批准'))){
      await click('.agent-request-options button[aria-label*="批准"]:not([aria-label*="拒绝"])');
      await click('.agent-confirm-choice');
    }
    return current.items.some(item=>item.type==='assistant_message'&&item.payload.text?.includes(fixture.config.answer.split('\n')[0]))&&!current.turns.some(turn=>turn.status==='started'||turn.status==='dispatching');
  },'native terminal answer '+fixture.config.caseId,60000);
  await app.waitFor(`Array.from(document.querySelectorAll('.agent-assistant:not(.streaming) .agent-md')).some(message=>message.innerText.includes(${serializable(fixture.config.answer.split('\n')[0])}))`,15000);
}
async function warmDiff(fixture) {
  const warm={...fixture,config:{caseId:fixture.config.caseId+'-warm',cwd:fixture.cwd,mark:'M14_WARM_'+randomUUID(),answer:'WORKSPACE_DIFF_WARM'}};
  await sendTask(warm);
  return until(async()=>{
    const rows=await app.invoke('agentTasks.changes',fixture.taskId);
    return rows.find(r=>!r.preparing&&['complete','incomplete'].includes(r.status));
  },'initial serial snapshot preparation',40000);
}
function waitDocument(expected) {
  return app.waitFor(`${model}?.state.doc.toString()===${serializable(expected)}`,20000);
}
async function selectProfile(name) {
  await click('.agent-task-view .agent-model-pill');
  await click(`.agent-picker-rail button[aria-label="${name}"]`);
  await click(`.agent-model-row[aria-label="${modelName}"]`);
  await app.waitFor(`document.querySelector('.agent-task-view .agent-model-pill')?.textContent.includes(${serializable(name)})`,15000);
}

const selectors={ task:id=>`[data-testid="sidebar-agent-task"][data-task-id="${id}"]`, project:id=>`[data-testid="sidebar-project"][data-project-id="${id}"]`, archiveSettings:'[data-testid="archived-agent-tasks"]', deleteDialog:'.m14-project-delete-dialog', more:'.agent-task-head button[title="更多"]' };
const modalButton=()=>selectors.deleteDialog+' button';
const guardTask=async(taskId)=>app.invoke('agentTasks.snapshot',taskId);
const recordDone=async taskId=>until(async()=>{const snap=await guardTask(taskId);return !snap.run?.busy&&!snap.queued.length&&['completed','stopped'].includes(snap.status)&&snap;},'task and native turn drain');
const archivedPage=async()=>{await click('[data-testid="nav-settings"]');await click('.settings-nav button.nav-row','已归档任务');await visible(selectors.archiveSettings);};
const archiveTask=async()=>{await click(selectors.more);await click('[data-testid="agent-archive"]');};
const waitProjectQuiescence=async({project})=>until(async()=>{const p=await app.invoke('projects.deletePreview',project.id);return p.blockers.length===0&&p;},'native process and post-turn bookkeeping have settled',15000);
async function sendRaw(text) {
  await click('.agent-task-view textarea');
  await app.cdp('Input.insertText',{text});
  await clickActualSend();
}
function privateBindings(id) {
  return privateRows('SELECT binding_id,native_id,driver_id FROM agent_bindings WHERE task_id=? ORDER BY created_at',strictId(id));
}
function privateRows(query,id){
  const worker='import json,sqlite3,sys; c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True);c.row_factory=sqlite3.Row;print(json.dumps([dict(x) for x in c.execute(sys.argv[2],(sys.argv[3],))]))';
  return JSON.parse(execFileSync('/usr/bin/python3',['-c',worker,join(userData,'smartdd.db'),query,id],{encoding:'utf8'}));
}
function strictId(id){assert.match(id,/^[a-f0-9-]{36}$/);return id;}
async function openProjectDelete(projectId) {
  const prefix=selectors.project(projectId);
  await visible(prefix);
  await click(prefix+' [data-testid="sidebar-project-more"]');
  const item='[data-testid="sidebar-project-delete"]';
  await app.waitFor(`!!document.querySelector(${serializable(item+':not(:disabled)')})`,10000);
  await click(item);
  await visible(selectors.deleteDialog);
}

const oversized=10*1024**3+1;
const shadowThreshold=Math.ceil(.94*1024**3);
const diffSelect='.agent-diff-surface select[aria-label="差异回合"]';
const views='.agent-diff-surface [role="status"]';
const inspectElectron="process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')";
const gatePath=join(attempt,'a65-snapshot-gate');
const gateLog=join(attempt,'a65-snapshot-gate.log');
let spaceMarker,cancelWatching=false;
const stopCancelTrace=`(() => {const probe=globalThis.__m14A65Cancel;
  if(!probe)return [];delete globalThis.__m14A65Cancel;return probe.restore();})()`;
function safeSparse(file, logicalBytes) {
  assert(Number.isSafeInteger(logicalBytes)&&logicalBytes>0);
  assert(realpathSync(dirname(file)).startsWith(stateRoot+'/'),'Sparse fixture path is outside private state root');
  const fd=openSync(file,'wx',0o600);
  try {ftruncateSync(fd,logicalBytes);}finally{closeSync(fd);}
  const s=statSync(file),allocated=512*s.blocks;
  if(s.size!==logicalBytes||!Number.isFinite(allocated)||allocated>1024**2){
    unlinkSync(file);throw Error('Fixture filesystem did not create a sparse blob within 1 MiB physical bound');
  }
  return {file,logicalBytes:s.size,allocatedBytes:allocated};
}
async function exactRecord(taskId,turnId) {
  return app.invoke('agentTasks.changeTurn',taskId,turnId);
}
function registeredRecord(taskId,turnId) {
  const row=privateRows("SELECT turn_id,task_id,before_ref,after_ref,incomplete_reason,status FROM agent_turn_changes WHERE turn_id=?",strictId(turnId))[0];
  assert.equal(row?.task_id,taskId);
  return row;
}
const markerTurn=(taskId,text)=>until(async()=>{
  const found=privateRows("SELECT turn_id,input_ref FROM agent_turns WHERE task_id=? ORDER BY accepted_at DESC",strictId(taskId))
    .find(row=>JSON.parse(row.input_ref).text?.includes(text));
  return found?.turn_id;
},'actual user input assigned exact turn identity');
const changeCard=turnId=>`[data-turn-id="${turnId}"] .agent-change-card`;
async function openChange(turnId){
  const card=changeCard(turnId);
  await visible(card);
  await app.evaluate(`new Promise(resolve=>{const card=document.querySelector(${serializable(card)});
    card.scrollIntoView({block:'center',behavior:'instant'});
    window.__m14A65LastCardClick=null;
    card.addEventListener('click',event=>{window.__m14A65LastCardClick={trusted:event.isTrusted,x:event.clientX,y:event.clientY};},{once:true,capture:true});
    requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)));
  })`);
  await click(card+' .agent-change-head span');
  const observed=await app.evaluate('window.__m14A65LastCardClick');
  (result.cardClicks??=[]).push({turnId,observed});
  assert(observed?.trusted,'Trusted click reached the actual card for '+turnId);
  await app.waitFor(`document.querySelector(${serializable(diffSelect)})?.value===${serializable(turnId)}`,12000);
}

let restoreLease=false;
const leaseEvents="globalThis.__m14A65ReadLease?.rows ?? []";
const stopLease=`(() => {const live=globalThis.__m14A65ReadLease;if(!live)return [];
  delete globalThis.__m14A65ReadLease;return live.restore();})()`;
async function observeLease(taskId,turnId){
  await app.mainEvaluate(`(() => {
    const E=${inspectElectron};
    if(E.app.getPath('userData')!==${serializable(userData)}||process.pid!==${app.processId})
      throw Error('Wrong isolated App');
    const handlers=E.ipcMain._invokeHandlers;
    const entries=['agentTasks.holdDiff','agentTasks.releaseDiff'].map(name=>[name,handlers.get(name)]);
    if(entries.some(([,callback])=>typeof callback!=='function'))throw Error('Missing original lease handlers');
    const rows=[];
    for(const [channel,original] of entries) handlers.set(channel,async function(e,...args){
      const value=await original.call(this,e,...args);
      if(args[0]===${serializable(taskId)}&&(channel.endsWith('releaseDiff')||args[1]===${serializable(turnId)}))
        rows.push({channel,input:args[1],token:typeof value==='string'?value:null,at:Date.now(),sender:e.sender.id});
      return value;
    });
    globalThis.__m14A65ReadLease={rows,restore(){for(const [key,original] of entries)handlers.set(key,original);return rows;}};
    return true;
  })()`);
  restoreLease=true;
}
const nativeRefExists=(cwd,gitDir,ref)=>{
  assert(ref.startsWith('refs/willyou/'));
  try{
    const content=execFileSync('git',[`--git-dir=${gitDir}`,'rev-parse','--verify',ref],
      {cwd,env:{...process.env,HOME:home,GIT_CONFIG_GLOBAL:'/dev/null'},encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    assert.match(content,/^[a-f0-9]{40,64}$/);
    return content;
  }catch(error){if(error.status===128)return null;throw error;}
};
// ---------------- A34 large SVN and capture budget ----------------
import { writeSync, readdirSync, statfsSync, rmSync, truncateSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const GiB=1024**3, MiB=1024**2;
const svnBin=realpathSync(execFileSync('/usr/bin/which',['svn'],{encoding:'utf8'}).trim());
const svnadminBin=realpathSync(execFileSync('/usr/bin/which',['svnadmin'],{encoding:'utf8'}).trim());
const svnEnv={...process.env,HOME:home,LANG:'en_US.UTF-8'};
const svn=(cwd,...args)=>execFileSync(svnBin,['--non-interactive','--config-dir',join(home,'.subversion'),...args],{cwd,env:svnEnv,encoding:'utf8',timeout:60000}).trim();
const timing={};
function inState(path){const r=realpathSync(dirname(path));assert(r===stateRoot||r.startsWith(stateRoot+'/'),'fixture path outside private state root: '+path);}
function writeRandom(file,bytes){
  inState(file);
  const fd=openSync(file,'w',0o600);
  try{for(let left=bytes;left>0;){const n=Math.min(left,8*MiB);writeSync(fd,randomBytes(n));left-=n;}}finally{closeSync(fd);}
  return statSync(file).size;
}
function svnRoot(id,prepare){
  const repo=join(stateRoot,id+'-repo'),cwd=join(stateRoot,id);
  execFileSync(svnadminBin,['create',repo],{env:svnEnv});
  svn(stateRoot,'checkout','-q','file://'+repo,cwd);
  writeFileSync(join(cwd,'a.txt'),'A34 seed\n');
  svn(cwd,'add','-q','a.txt');svn(cwd,'commit','-q','-m','A34 seed');
  prepare?.(cwd);
  return realpathSync(cwd);
}
async function svnFixture(id,prepare){
  const cwd=svnRoot(id,prepare);
  const project=await app.invoke('projects.create',{name:id,aliases:[],description:'',rulesPath:null},[{label:'work',path:cwd}]);
  const task=await app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,cwd,title:id,profileId:profile.id,model:modelName,tier:'ask'});
  await refreshFixtureUi();
  return {id,cwd,project,taskId:task.taskId};
}
async function extraTask(fixture,title){
  const task=await app.invoke('agentTasks.create',{projectId:fixture.project.id,dirId:fixture.project.dirs[0].id,cwd:fixture.cwd,title,profileId:profile.id,model:modelName,tier:'ask'});
  await refreshFixtureUi();
  return task.taskId;
}
async function turn(taskId,cwd,label){
  const config={caseId:label,cwd,mark:'M14_A34_'+label+'_'+randomUUID(),answer:'A34_'+label+'_OK'};
  const t0=Date.now();
  await sendTask({taskId,config});
  const turnId=await markerTurn(taskId,config.mark);
  timing[label]={answerMs:Date.now()-t0};
  return turnId;
}
const settled=(taskId,turnId,label,ms=60000)=>until(async()=>{const r=await exactRecord(taskId,turnId);return !r.preparing&&['complete','incomplete','none'].includes(r.status)&&r;},'diff record settled '+label,ms);
const anyPreparing=async taskId=>(await app.invoke('agentTasks.changes',taskId)).some(r=>r.preparing);
function shadowBytes(dir){
  let total=0;
  for(const e of readdirSync(dir,{withFileTypes:true})){
    if(e.name.startsWith('.willyou-')||e.name.startsWith('tmp_obj_')||e.name.endsWith('.lock'))continue;
    const p=join(dir,e.name);
    if(e.isDirectory())total+=shadowBytes(p);else if(e.isFile())total+=statSync(p).size;
  }
  return total;
}
const diffsRoot=()=>join(userData,'agent-diffs');
function shadows(){try{return readdirSync(diffsRoot()).filter(n=>/^[a-f0-9]{64}$/.test(n)).map(n=>join(diffsRoot(),n));}catch{return [];}}
function turnRefs(turnId){
  strictId(turnId);
  return shadows().flatMap(dir=>execFileSync('git',['--git-dir='+dir,'for-each-ref','--format=%(refname)','refs/willyou/turns/'+turnId],{env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},encoding:'utf8'}).split('\n').filter(Boolean));
}
const cardText=turnId=>app.evaluate(`document.querySelector(${serializable(changeCard(turnId))})?.innerText??null`);
const answerShown=answer=>app.evaluate(`[...document.querySelectorAll('.agent-assistant:not(.streaming) .agent-md')].some(m=>m.innerText.includes(${serializable(answer)}))`);

async function seedScenario(){
  const id='A34-seed',entry=result.cases[id];
  // 1) Shadow history for the reclaim restart: one older active task, one newer task archived through the real UI.
  const R=await svnFixture('A34-R');
  await openTask(R);
  const warm=await turn(R.taskId,R.cwd,'R_WARM');
  await until(async()=>!(await anyPreparing(R.taskId)),'R first background snapshot finished',120000);
  entry.warm=await settled(R.taskId,warm,'R warm');
  const A=[];
  for(const k of [1,2,3]){
    const size=writeRandom(join(R.cwd,'big.bin'),32*MiB);
    const turnId=await turn(R.taskId,R.cwd,'R_A'+k);
    const row=await settled(R.taskId,turnId,'R_A'+k);
    assert.equal(row.status,'complete','A'+k+' complete');
    A.push({turnId,size,ref:registeredRecord(R.taskId,turnId)});
  }
  const B=await extraTask(R,'A34-R-B');
  await openTask({taskId:B});
  writeRandom(join(R.cwd,'big.bin'),32*MiB);
  const b1=await turn(B,R.cwd,'R_B1');
  const b1row=await settled(B,b1,'R_B1');assert.equal(b1row.status,'complete');
  const B1={turnId:b1,ref:registeredRecord(B,b1)};
  await recordDone(B);
  await archiveTask();
  await until(()=>privateRows('SELECT archived_at FROM agent_tasks WHERE task_id=?',B)[0]?.archived_at,'task B archived through the real menu');
  const refs=[...A.map(a=>a.ref),B1.ref].flatMap(r=>[r.before_ref,r.after_ref]).map(JSON.parse);
  const shadow=refs[0].gitDir;
  assert(refs.every(r=>r.private&&r.gitDir===shadow&&r.cwd===R.cwd),'all turns share one private SVN shadow');
  assert(shadow.startsWith(diffsRoot()+'/'));
  entry.reclaim={cwd:R.cwd,projectId:R.project.id,taskA:R.taskId,taskB:B,A,B1,shadow,shadowBytes:shadowBytes(shadow)};
  result.cases[id].passed.push('reclaim history: A1..A3 (active, oldest first) and B1 (newer, archived via UI) each pin a unique 32 MiB snapshot in one private SVN shadow');

  // 2) Over the validated scale (logical 10 GiB + 1 byte sparse file): incomplete, task continues.
  const O=await svnFixture('A34-oversize');
  await openTask(O);
  await turn(O.taskId,O.cwd,'O_WARM');
  await until(async()=>!(await anyPreparing(O.taskId)),'O first snapshot finished',120000);
  const o2=await turn(O.taskId,O.cwd,'O_NORMAL');
  assert.equal((await settled(O.taskId,o2,'O normal')).status,'complete');
  const sparse=safeSparse(join(O.cwd,'a34-logical-oversize.bin'),10*GiB+1);
  try{
    const o3=await turn(O.taskId,O.cwd,'O_OVER');
    const row=await settled(O.taskId,o3,'O over');
    assert.equal(row.status,'incomplete');assert.match(row.reason??'',/文件数量或内容规模超过已验证范围/);
    assert(await answerShown('A34_O_OVER_OK'),'task answered despite over-scale snapshot');
    assert.deepEqual(turnRefs(o3),[]);
    const card=await cardText(o3);assert.match(card??'',/超过已验证范围|不完整/);
    entry.oversize={sparse,turnId:o3,reason:row.reason,card};
    await screenshot('A34-oversize');
  }finally{unlinkSync(sparse.file);}
  result.cases[id].passed.push('over scale (10 GiB + 1 logical) on SVN: incomplete with reason, no refs, task answered');

  // 3) Background budget timeout: a 600 MiB incompressible change cannot be snapshotted inside the 5 s incremental budget.
  const T=await svnFixture('A34-timeout');
  await openTask(T);
  await turn(T.taskId,T.cwd,'T_WARM');
  await until(async()=>!(await anyPreparing(T.taskId)),'T first snapshot finished',120000);
  const t2=await turn(T.taskId,T.cwd,'T_NORMAL');
  assert.equal((await settled(T.taskId,t2,'T normal')).status,'complete');
  const big=join(T.cwd,'a34-slow.bin');writeRandom(big,600*MiB);
  try{
    const t3=await turn(T.taskId,T.cwd,'T_SLOW');
    const row=await settled(T.taskId,t3,'T slow',90000);
    assert.equal(row.status,'incomplete');assert.match(row.reason??'',/预算/);
    assert(await answerShown('A34_T_SLOW_OK'));
    assert.deepEqual(turnRefs(t3),[]);
    entry.timeout={turnId:t3,reason:row.reason,answerMs:timing.T_SLOW.answerMs,card:await cardText(t3)};
    await screenshot('A34-timeout');
  }finally{unlinkSync(big);}
  result.cases[id].passed.push('incremental snapshot over the 5 s background budget: incomplete with budget reason, no refs, task answered');

  // 4) First background snapshot is cancellable from the real panel, and the conversation is not blocked meanwhile.
  const C=await svnFixture('A34-cancel',cwd=>{
    const block=randomBytes(4096),file=Buffer.alloc(256*1024);for(let i=0;i<file.length;i+=4096)block.copy(file,i);
    for(let d=0;d<100;d++){const dir=join(cwd,'src','d'+d);mkdirSync(dir,{recursive:true});for(let f=0;f<200;f++)writeFileSync(join(dir,`f${f}.dat`),file);}
  });
  await openTask(C);
  const c1=await turn(C.taskId,C.cwd,'C_FIRST');
  const preparingWhileAnswered=await anyPreparing(C.taskId);
  assert(preparingWhileAnswered,'first snapshot still preparing when the answer arrived');
  await openChange(c1);
  const cancelBtn='.agent-diff-surface [role="status"] button';
  await app.waitFor(visibleExpression(cancelBtn),15000);
  const progressBefore=await app.evaluate("document.querySelector('.agent-diff-surface [role=status]')?.innerText");
  const clickAt=Date.now();
  await click(cancelBtn,'取消快照');
  const row=await until(async()=>{const r=await exactRecord(C.taskId,c1);return !r.preparing&&!(await anyPreparing(C.taskId))&&/取消/.test(r.reason??'')&&r;},'snapshot worker stopped after cancel',30000);
  const stoppedMs=Date.now()-clickAt;
  const db=registeredRecord(C.taskId,c1);
  assert.equal(db.before_ref,null);assert.equal(db.after_ref,null);assert.deepEqual(turnRefs(c1),[]);
  const panel=await app.evaluate("document.querySelector('.agent-diff-surface [role=status]')?.innerText");
  assert.match(panel??'',/取消/);
  entry.cancel={turnId:c1,files:20001,bytesPerFile:256*1024,preparingWhileAnswered,answerMs:timing.C_FIRST.answerMs,progressBefore,stoppedMs,reason:row.reason,panel};
  await screenshot('A34-cancel');
  result.cases[id].passed.push('first background snapshot of a 20,001-file / 5 GiB SVN tree: answer arrived while preparing, real 取消快照 stopped the worker, no refs, cancel reason kept');
  rmSync(join(C.cwd,'src'),{recursive:true,force:true});
  record(id,result.cases[id].passed,[]);
}

let holdTimer=null;const ipcLeases=new Map();
async function holdIpc(taskId,turnId){const token=await app.invoke('agentTasks.holdDiff',taskId,turnId);const old=ipcLeases.get(turnId);ipcLeases.set(turnId,{taskId,token});if(old)await app.invoke('agentTasks.releaseDiff',old.taskId,old.token).catch(()=>{});}
async function pressureScenario(){
  const id='A34-pressure',entry=result.cases[id];
  const {cwd,taskA,taskB,A,B1,shadow}=previous;
  const all=[...A,B1];
  for(const t of all)for(const r of [t.ref.before_ref,t.ref.after_ref].map(JSON.parse))assert.equal(nativeRefExists(cwd,shadow,r.ref),r.commit);
  entry.marker1=spaceMarker;
  await openTask({taskId:taskA});
  await observeLease(taskA,A[0].turnId);
  await openChange(A[0].turnId);
  const hold=await until(async()=>(await app.mainEvaluate(leaseEvents)).find(row=>row.channel.endsWith('holdDiff')&&row.token),'real panel holds a read lease on the oldest turn A1');
  writeFileSync(join(cwd,'big.bin'),'A34 trigger 1\n');
  const t1=await turn(taskA,cwd,'P_T1');
  const t1row=await settled(taskA,t1,'P_T1',60000);
  const state=()=>Object.fromEntries(all.map((t,i)=>[i<3?'A'+(i+1):'B1',registeredRecord(i<3?taskA:taskB,t.turnId)]));
  const s1=state();
  entry.afterFirst={t1:t1row,rows:Object.fromEntries(Object.entries(s1).map(([k,r])=>[k,{status:r.status,reason:r.incomplete_reason}])),shadowBytes:shadowBytes(shadow)};
  assert.equal(t1row.status,'complete','capture continues after reclaim');
  assert.equal(s1.B1.status,'none');assert.equal(s1.B1.incomplete_reason,'快照已清理（空间回收）');
  assert.equal(s1.A1.status,'complete','leased oldest turn kept');
  assert.equal(s1.A2.status,'none','next-oldest unleased turn reclaimed after the archived task');
  assert.equal(s1.A3.status,'complete','newest active turn kept once enough space was freed');
  for(const k of ['B1','A2'])assert.deepEqual(turnRefs(all[k==='B1'?3:1].turnId),[]);
  for(const k of [0,2])assert.equal(turnRefs(all[k].turnId).length,2);
  const trace=await app.mainEvaluate(leaseEvents);
  assert(!trace.some(r=>r.channel.endsWith('releaseDiff')&&r.input===hold.token),'A1 lease still held');
  const a2card=await cardText(A[1].turnId);assert.match(a2card??'',/快照已清理（空间回收）/);
  entry.afterFirst.a2card=a2card;
  await screenshot('A34-reclaim-order');
  result.cases[id].passed.push('at the 0.9 GiB threshold: archived task B1 reclaimed first, then oldest unleased A2; leased A1 and newer A3 kept; new turn captured complete; UI shows 快照已清理（空间回收）');

  // All remaining reclaimable snapshots held by read leases.
  await holdIpc(taskA,A[2].turnId);await holdIpc(taskA,t1);
  holdTimer=setInterval(()=>{for(const [turnId,{taskId}] of ipcLeases)void holdIpc(taskId,turnId).catch(()=>{});},20000);
  const nowBytes=shadowBytes(shadow),marker2=spaceMarker.logicalBytes+(GiB-nowBytes)+16*MiB;
  truncateSync(spaceMarker.file,marker2);spaceMarker.logicalBytes=marker2;
  assert(512*statSync(spaceMarker.file).blocks<=MiB,'marker stays sparse');
  entry.marker2={logicalBytes:marker2,shadowBytesBefore:nowBytes,shadowBytesAfter:shadowBytes(shadow)};
  writeFileSync(join(cwd,'big.bin'),'A34 trigger 2\n');
  const t2=await turn(taskA,cwd,'P_T2');
  const t2row=await settled(taskA,t2,'P_T2',60000);
  assert.equal(t2row.status,'incomplete');assert.match(t2row.reason??'',/影子库空间已满/);
  assert(await answerShown('A34_P_T2_OK'),'task answered while the shadow is full');
  const s2=state();
  assert.equal(s2.A1.status,'complete');assert.equal(s2.A3.status,'complete');
  assert.equal(registeredRecord(taskA,t1).status,'complete');
  assert.deepEqual(turnRefs(t2),[]);
  const t2card=await cardText(t2);assert.match(t2card??'',/影子库空间已满/);
  entry.allLeased={t2:t2row,t2card,kept:{A1:s2.A1.status,A3:s2.A3.status,T1:'complete'}};
  await screenshot('A34-shadow-full');
  clearInterval(holdTimer);holdTimer=null;
  for(const [,{taskId,token}] of ipcLeases)await app.invoke('agentTasks.releaseDiff',taskId,token).catch(()=>{});
  entry.leaseTrace=await app.mainEvaluate(stopLease);restoreLease=false;
  result.cases[id].passed.push('all reclaimable snapshots under read leases: new turn shows 影子库空间已满, no refs, leased turns kept, task answered');
  record(id,result.cases[id].passed,[]);
}

let diskImage=null;
async function diskScenario(){
  const id='A34-disk',entry=result.cases[id];
  const free=statfsSync(diffsRoot());entry.volume={freeBytes:free.bavail*free.bsize,blockSize:free.bsize};
  assert(free.bavail*free.bsize<2*GiB,'test volume below the 2 GiB reserve');
  const D=await svnFixture('A34-disk');
  await openTask(D);
  const d1=await turn(D.taskId,D.cwd,'D_FIRST');
  const r1=await settled(D.taskId,d1,'D first');
  const d2=await turn(D.taskId,D.cwd,'D_SECOND');
  const r2=await settled(D.taskId,d2,'D second');
  for(const r of [r1,r2]){assert.equal(r.status,'incomplete');assert.match(r.reason??'',/可用磁盘不足预留 2 GiB/);}
  assert(await answerShown('A34_D_SECOND_OK'));
  assert.deepEqual(shadows(),[],'no shadow written on the full volume');
  entry.result={r1:{status:r1.status,reason:r1.reason},r2:{status:r2.status,reason:r2.reason},card:await cardText(d2)};
  await screenshot('A34-disk-reserve');
  record(id,['storage volume below the 2 GiB reserve: both turns answered, diff incomplete with 可用磁盘不足预留 2 GiB, no shadow written'],[]);
}

let guardTimer=null,diskLow=null;
const gitFileHashes=P=>Object.fromEntries(['HEAD','index'].map(n=>{const f=join(P,'.git',n);return [n,existsSync(f)?sha(f).slice(0,16):null];}));
async function enterpriseScenario(){
  const id='A34-enterprise',entry=result.cases[id];
  const P=realpathSync(process.env.A34_ENTERPRISE_PATH);
  const project=await app.invoke('projects.create',{name:'A34 enterprise sample',aliases:[],description:'',rulesPath:null},[{label:'work',path:P}]);
  const task=await app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,cwd:P,title:'A34 enterprise sample',profileId:profile.id,model:modelName,tier:'ask'});
  await refreshFixtureUi();
  guardTimer=setInterval(()=>{const f=statfsSync('/System/Volumes/Data');const b=f.bavail*f.bsize;if(b<4*GiB&&!diskLow){diskLow=b;for(const t of entry.turns??[])void app.invoke('agentTasks.cancelDiff',task.taskId,t).catch(()=>{});}},1000);
  entry.turns=[];
  await openTask({taskId:task.taskId});
  const t0=Date.now();
  const e1=await turn(task.taskId,P,'E_FIRST');entry.turns.push(e1);
  entry.first={answerMs:timing.E_FIRST.answerMs,preparingAtAnswer:await anyPreparing(task.taskId)};
  const samples=[];
  await until(async()=>{if(diskLow)throw Error('disk guard tripped');const rows=await app.invoke('agentTasks.changes',task.taskId);const r=rows.find(x=>x.turnId===e1);if(r?.progress)samples.push({at:Date.now()-t0,...r.progress});return !rows.some(x=>x.preparing);},'enterprise first background snapshot ended',900000);
  entry.first.backgroundMs=Date.now()-t0;entry.first.progressTail=samples.slice(-3);entry.first.record=await exactRecord(task.taskId,e1);
  entry.first.shadowBytes=shadows().map(shadowBytes);
  const e2=await turn(task.taskId,P,'E_SECOND');entry.turns.push(e2);
  const t2=Date.now();
  await until(async()=>{if(diskLow)throw Error('disk guard tripped');return !(await anyPreparing(task.taskId));},'enterprise second snapshot ended',900000);
  entry.second={answerMs:timing.E_SECOND.answerMs,backgroundMs:Date.now()-t2,record:await exactRecord(task.taskId,e2),shadowBytes:shadows().map(shadowBytes)};
  entry.second.card=await cardText(e2);
  // D06-81: once the first background snapshot ends without a snapshot, the turn must show the real reason, not "still preparing".
  for(const [k,r] of [['first',entry.first.record],['second',entry.second.record]])if(r.status!=='complete')assert.doesNotMatch(r.reason??'',/仍在后台准备/,k+' still claims preparing after the background snapshot ended');
  entry.firstCard=await cardText(e1);
  await screenshot('A34-enterprise');
  record(id,['representative enterprise SVN working copy measured read-only (see first/second)'],[]);
}

const implementation={seed:seedScenario,pressure:pressureScenario,disk:diskScenario,enterprise:enterpriseScenario};
let enterpriseBefore=null;
try{
  if(scenario==='pressure'){
    assert(previous.shadow.startsWith(join(userData,'agent-diffs')+'/'));
    const before=shadowBytes(previous.shadow);
    spaceMarker=safeSparse(join(previous.shadow,'a34-sparse-pressure'),Math.ceil(.9*GiB)-before+48*MiB);
    result.pressureFixture={...spaceMarker,shadowBytesBefore:before,shadowBytesWithMarker:shadowBytes(previous.shadow)};
  }
  if(scenario==='disk'){
    const img=join(stateRoot,'a34-volume.dmg');inState(img);
    execFileSync('/usr/bin/hdiutil',['create','-size','3g','-fs','HFS+','-volname','A34TEST','-type','UDIF','-quiet',img]);
    mkdirSync(diffsRoot(),{mode:0o700});
    execFileSync('/usr/bin/hdiutil',['attach','-nobrowse','-noautoopen','-quiet','-mountpoint',diffsRoot(),img]);
    diskImage={img,mount:diffsRoot()};
    const f=statfsSync(diffsRoot()),filler=join(diffsRoot(),'filler.bin');
    const fill=f.bavail*f.bsize-Math.floor(1.2*GiB);
    const fd=openSync(filler,'wx',0o600);try{const z=Buffer.alloc(8*MiB);for(let left=fill;left>0;){const n=Math.min(left,z.length);writeSync(fd,z,0,n);left-=n;}}finally{closeSync(fd);}
    result.diskFixture={image:img,sizeGiB:3,fillerBytes:statSync(filler).size,freeAfterFill:statfsSync(diffsRoot()).bavail*statfsSync(diffsRoot()).bsize};
  }
  if(scenario==='enterprise'){
    const P=realpathSync(process.env.A34_ENTERPRISE_PATH);
    const marker=join(attempt,'enterprise-start-marker');writeFileSync(marker,'');
    enterpriseBefore={marker,svnStatusCount:execFileSync(svnBin,['status','-q'],{cwd:P,env:svnEnv,encoding:'utf8',maxBuffer:64*MiB}).split('\n').filter(Boolean).length,
      gitFiles:gitFileHashes(P),freeBytes:statfsSync('/System/Volumes/Data').bavail*statfsSync('/System/Volumes/Data').bsize};
    result.enterpriseBefore={svnStatusCount:enterpriseBefore.svnStatusCount,gitFiles:enterpriseBefore.gitFiles,freeBytes:enterpriseBefore.freeBytes};
  }
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(3425,'127.0.0.1',ok);});
  origin='http://127.0.0.1:3425';
  cleanup.loopbackPort=3425;
  const installed=realpathSync(execFileSync('/usr/bin/which',['codex'],{encoding:'utf8'}).trim());
  const nativePath=[dirname(process.execPath),dirname(installed),...String(process.env.PATH).split(':')].join(':');
  app=await openElectron({executable,userData,env:{HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),TMPDIR:attempt,
    PATH:nativePath,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'},
    inspectMain:true,startupMainHook:async info=>{const hook=await redirectHome({...info,home});assert.equal(hook.workerInspectorFlagRemoved,true);result.isolationHook=hook;}});
  cleanup.pid=app.processId;
  result.binding=await app.mainEvaluate(`(() => {const E=${inspectElectron};
    return {pid:process.pid,executable:process.execPath,home:process.env.HOME,electronHome:E.app.getPath('home'),
      userData:E.app.getPath('userData'),packaged:E.app.isPackaged};
  })()`);
  assert.deepEqual(result.binding,{pid:app.processId,executable,home,electronHome:home,userData,packaged:true});
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  if(!sourceAttempt){
    await app.invoke('agents.refreshTools');
    const native=(await app.invoke('agents.tools')).find(tool=>tool.kind==='codex'&&tool.installed);
    assert(native,'Private native Codex required');
    result.nativeCodex={kind:native.kind,version:native.version};
    const provider=await app.invoke('agents.saveProvider',{name:'A34 synthetic local',preset:'magpie',
      endpoints:{responses:origin+'/v1',anthropic:origin+'/'},models:[{id:modelName,name:modelName}]});
    profile=await app.invoke('agents.save',{name:'A34 synthetic local',toolId:native.id,source:'provider',providerId:provider.id,
      models:[modelName],defaultModel:modelName,isDefault:true});
    await click('[data-testid="nav-settings"]');
    await visible('[data-testid=m14-toggle]');
    const enabled=await app.evaluate("document.querySelector('[data-testid=m14-toggle]').textContent.includes('已开启')");
    if(!enabled)await click('[data-testid=m14-toggle]');
    await click('[data-testid=nav-home]');
    await visible('.agent-model-pill');
  }else{
    const active=await app.invoke('agentTasks.snapshot',previous.taskA);
    assert(active.taskId===previous.taskA&&active.projectId===previous.projectId);
  }
  await runCase('A34-'+scenario,implementation[scenario]);
}catch(error){
  result.setupFailure=failText(error);
  if(app)await screenshot('setup-failed').catch(()=>{});
}finally{
  if(holdTimer)clearInterval(holdTimer);
  if(guardTimer)clearInterval(guardTimer);
  if(diskLow)result.diskGuardTripped=diskLow;
  result.timing=timing;
  if(app){
    if(restoreLease){
      try{result.unfinishedLeaseTrace=await app.mainEvaluate(stopLease);}
      catch(error){cleanup.leaseObserverError=failText(error);}
    }
    try{
      const active=(await app.invoke('agentTasks.list')).filter(task=>!task.parentTaskId);
      cleanup.beforeQuit=await Promise.all(active.map(async task=>{
        const s=await guardTask(task.taskId);
        return {taskId:task.taskId,runId:s.run?.runId,busy:s.run?.busy,status:s.status};
      }));
      await app.mainEvaluate(`(() => {const E=${inspectElectron};
        if(E.app.getPath('userData')!==${serializable(userData)}||process.pid!==${app.processId})throw Error('Wrong private App');
        setTimeout(()=>E.app.quit(),50);return true;})()`);
    }catch(error){cleanup.quitError=failText(error);}
    try{result.exit=await app.waitForExit(25000);}
    catch(error){cleanup.exitError=failText(error);try{cleanup.forcedExit=await app.crash();}catch(fatal){cleanup.forceError=failText(fatal);}}
    result.rendererErrors=app.rendererErrors;
    writeFileSync(join(attempt,'app.log'),app.logs(),{mode:0o600});
  }
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  if(spaceMarker&&existsSync(spaceMarker.file)){unlinkSync(spaceMarker.file);cleanup.sparseMarkerRemoved=true;}
  if(diskImage){
    try{execFileSync('/usr/bin/hdiutil',['detach','-quiet',diskImage.mount]);cleanup.diskDetached=true;}catch(e){try{execFileSync('/usr/bin/hdiutil',['detach','-force','-quiet',diskImage.mount]);cleanup.diskDetached='forced';}catch(f){cleanup.diskDetachError=failText(f);}}
    if(cleanup.diskDetached){rmSync(diskImage.img,{force:true});cleanup.diskImageRemoved=true;}
  }
  if(enterpriseBefore){
    const P=realpathSync(process.env.A34_ENTERPRISE_PATH);
    const newer=execFileSync('/usr/bin/find',[P,'-newer',enterpriseBefore.marker],{encoding:'utf8',maxBuffer:256*MiB}).split('\n').filter(Boolean);
    result.enterpriseAfter={filesNewerThanStart:newer.length,
      svnStatusCount:execFileSync(svnBin,['status','-q'],{cwd:P,env:svnEnv,encoding:'utf8',maxBuffer:64*MiB}).split('\n').filter(Boolean).length,
      gitFilesUnchanged:JSON.stringify(gitFileHashes(P))===JSON.stringify(enterpriseBefore.gitFiles)};
    if(newer.length)result.enterpriseAfter.newerSampleCount=Math.min(newer.length,5);
  }
  result.cleanup=cleanup;
  result.finishedAt=new Date().toISOString();
  result.modelFailures=modelFailures;
  writeFileSync(join(attempt,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({scenario,exit:result.exit,cases:Object.fromEntries(
    Object.entries(result.cases).map(([id,row])=>[id,row.status])),result:join(attempt,'result.json')}));
}
if(result.setupFailure||result.exit?.code!==0||result.exit?.signal||result.rendererErrors?.length||
  modelFailures.length||Object.values(result.cases).some(entry=>entry.status!=='pass'))process.exitCode=1;
