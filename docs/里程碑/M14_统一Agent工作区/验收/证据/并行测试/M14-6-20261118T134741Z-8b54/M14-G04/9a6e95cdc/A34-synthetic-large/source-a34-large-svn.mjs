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
assert(['a34-large'].includes(scenario));
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
if(scenario==='reclaim'){
  assert(sourceAttempt?.startsWith(root+'/')&&sourceAttempt!==attempt);
  assert.match(sourceAttempt.slice(packageRoot.length),privateAttempt);
  assert.equal(realpathSync(sourceAttempt),sourceAttempt);
  const seed=JSON.parse(readFileSync(join(sourceAttempt,'result.json'),'utf8'));
  assert.deepEqual([seed.sourceCommit,seed.build.appAsarSha256,seed.scenario,seed.exit.code],
    [commit,expectedAsar,'reclaim-seed',0]);
  previous=seed.cases['A65-reclaim-seed'].reclaim;
  assert(previous&&previous.cwd.startsWith(sourceAttempt+'/')&&realpathSync(previous.cwd)===previous.cwd);
}else assert.equal(sourceAttempt,undefined);
mkdirSync(attempt,{mode:0o700});
copyFileSync(new URL(import.meta.url),join(attempt,'source-a34-large-svn.mjs'));
const stateRoot=sourceAttempt??attempt;
if(!sourceAttempt)for(const directory of ['home','data'])mkdirSync(join(stateRoot,directory));
const home=realpathSync(join(stateRoot,'home')),userData=realpathSync(join(stateRoot,'data'));
if(!sourceAttempt)mkdirSync(join(home,'Library','Keychains'),{recursive:true,mode:0o700});
const result={sourceCommit:commit,build:{executable,appAsarSha256:expectedAsar},scenario,sourceAttempt:sourceAttempt??null,
  layer:'A packaged native snapshot worker, exact non-sparse SVN fixture, real local Codex transport and CDP UI.',
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
function makeGitGate() {
  const realGit=realpathSync(execFileSync('/usr/bin/which',['git'],{encoding:'utf8'}).trim());
  const bin=join(attempt,'fixture-bin'), wrapper=join(bin,'git'), intended=join(attempt,'A65-cancel');
  for(const token of [realGit,gatePath,gateLog,userData,intended])assert.match(token,/^[a-zA-Z0-9._/\-]+$/);
  mkdirSync(bin);
  const body=`#!/bin/sh
if [ "$PWD" = "${intended}" ] && [ -f "${gatePath}" ]; then
  case "$GIT_INDEX_FILE" in
    "${userData}/agent-diffs/index-"*)
      for arg in "$@"; do
        if [ "$arg" = "--index-info" ]; then
          printf 'entered|%s|%s\\n' "$$" "$GIT_INDEX_FILE" >> "${gateLog}"
          trap 'printf "terminated|%s\\n" "$$" >> "${gateLog}"; exit 143' TERM INT
          while [ -f "${gatePath}" ]; do /bin/sleep .04; done
          break
        fi
      done
    ;;
  esac
fi
exec "${realGit}" "$@"
`;
  writeFileSync(wrapper,body);
  chmodSync(wrapper,0o700);
  execFileSync('/bin/sh',['-n',wrapper]);
  return {bin,wrapper,realGit};
}
function gitState(fixture){
  return {head:fixture.git('rev-parse','HEAD'),indexSha:sha(join(fixture.cwd,'.git/index'))};
}
function setDirtyIndex(fixture) {
  writeFileSync(fixture.file,'Private user staged text\n');
  fixture.git('add','a.txt');
  writeFileSync(fixture.file,'Private worktree text not yet staged\n');
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

async function captureFresh(fixture,marker,command) {
  const existing=new Set((await app.invoke('agentTasks.changes',fixture.taskId)).map(item=>item.turnId));
  const run={...fixture,config:{caseId:fixture.config.caseId+':'+marker,cwd:fixture.cwd,mark:'M14_A65_'+randomUUID(),answer:marker,command}};
  await sendTask(run);
  const id=await markerTurn(fixture.taskId,run.config.mark);
  assert(!existing.has(id));
  return until(async()=>{
    const row=await exactRecord(fixture.taskId,id);
    return row.status==='complete'&&!row.preparing && row.files.some(file=>file.path==='a.txt') && row;
  },'exact real change with marker '+marker,18000);
}
function checkNoTurnRef(fixture,turnId){
  assert.equal(fixture.git('for-each-ref','--format=%(refname)','refs/willyou/turns/'+turnId),'');
}
async function cancelCapture() {
  const id='A65-cancel', entry=result.cases[id];
  const fixture=await newFixture(id,{response:()=>id+'_MODEL_COMPLETED'});
  setDirtyIndex(fixture);
  const git=gitState(fixture),fileSha=sha(fixture.file);
  await openTask(fixture);
  await warmDiff(fixture);
  const helper=await until(async()=>{
    const rows=await app.invoke('agentTasks.changes',fixture.taskId);
    return rows.some(row=>!row.preparing);
  },'initial capture settled without gate');
  assert(helper);
  if(!await app.evaluate("Boolean(document.querySelector('.agent-right-panel'))")){
    await click('.agent-task-head button[title="打开右侧面板"]');
  }
  await openPanel('差异');
  await visible('.agent-diff-surface');
  const marker=fixture.config.mark;
  assert(!existsSync(gatePath));
  writeFileSync(gatePath,marker,{flag:'wx',mode:0o600});
  try{
    await sendRaw(marker+' Hold only the genuine snapshot subprocess.');
    const turnId=await markerTurn(fixture.taskId,marker);
    const active=await until(async()=>{
      if(!existsSync(gateLog))return null;
      const expected=readFileSync(gateLog,'utf8').split('\n').find(line=>line.includes('/index-'+turnId+'-'));
      if(!expected)return null;
      const current=await exactRecord(fixture.taskId,turnId);
      return current.preparing&&{worker:expected,turnId,current};
    },'real nominal 5.5 s snapshot subprocess paused on its private index');
    entry.captureInFlight=active;
    await app.waitFor(`document.querySelector(${serializable(diffSelect)})?.value===${serializable(turnId)}
      && [...document.querySelectorAll('.agent-diff-surface button')].some(b=>b.textContent==='取消快照'&&!b.disabled)`,7000);
    const button=views+' button';
    await app.mainEvaluate(`(() => {
      const E=${inspectElectron};
      if(E.app.getPath('userData')!==${serializable(userData)}||process.pid!==${app.processId}||globalThis.__m14A65Cancel)
        throw Error('Wrong private App');
      const handlers=E.ipcMain._invokeHandlers, channel='agentTasks.cancelDiff', original=handlers.get(channel), rows=[];
      if(typeof original!=='function')throw Error('Missing original diff cancel handler');
      handlers.set(channel,async function(e,...args){
        const current=args[0]===${serializable(fixture.taskId)}&&args[1]===${serializable(turnId)};
        if(!current)return original.call(this,e,...args);
        const observation={taskId:args[0],turnId:args[1],sender:e.sender.id,startedAt:Date.now()};
        rows.push(observation);
        const value=await original.call(this,e,...args);
        observation.receipt=value;observation.returnedAt=Date.now();
        return value;
      });
      globalThis.__m14A65Cancel={rows,restore(){handlers.set(channel,original);return rows;}};
      return true;
    })()`);
    cancelWatching=true;
    await click(button,'取消快照');
    await until(()=>readFileSync(gateLog,'utf8').includes('terminated|'),'native worker actually signaled the waiting Git subprocess');
    const cancelAck=await until(async()=>(await app.mainEvaluate("globalThis.__m14A65Cancel?.rows ?? []"))
      .find(row=>row.receipt?.canceled===true),'original cancel handler returned success');
    entry.cancelAck=cancelAck;
    entry.cancelTrace=await app.mainEvaluate(stopCancelTrace);cancelWatching=false;
    await until(async()=>{const current=await exactRecord(fixture.taskId,turnId);return !current.preparing&&current.status==='incomplete';},
      'worker stopped without producing a complete snapshot');
    await recordDone(fixture.taskId);
    const final=registeredRecord(fixture.taskId,turnId);
    assert.equal(final.status,'incomplete');
    assert.equal(final.before_ref,null);
    assert.equal(final.after_ref,null);
    assert.deepEqual(gitState(fixture),git);
    assert.equal(sha(fixture.file),fileSha);
    checkNoTurnRef(fixture,turnId);
    entry.cancelled={turnId,git,fileSha,final,gateLog:readFileSync(gateLog,'utf8'),
      panel:await app.evaluate("document.querySelector('.agent-diff-surface [role=status]')?.innerText")};
    await screenshot('A65-cancel-after');
    assert.match(final.incomplete_reason,/取消/, 'A snapshot actually canceled by the user should retain the cancel reason after worker exit');
    assert.match(entry.cancelled.panel,/取消/);
  }finally{if(existsSync(gatePath))unlinkSync(gatePath);}
  record(id,['Actual snapshot-cancel stopped the real private git process, preserved user HEAD/index/source and left incomplete cancellation state'],[]);
}

async function oversizeCapture() {
  const id='A65-oversize', entry=result.cases[id];
  const fixture=await newFixture(id,{response:()=>id+'_MODEL_CONTINUED'});
  setDirtyIndex(fixture);
  const git=gitState(fixture),source=sha(fixture.file);
  await openTask(fixture);
  await warmDiff(fixture);
  const dormant=join(fixture.cwd,'a65-logical-oversize.bin');
  entry.size=safeSparse(dormant,oversized);
  try{
    await sendTask(fixture);
    const turnId=await markerTurn(fixture.taskId,fixture.config.mark);
    await until(async()=>{const row=await exactRecord(fixture.taskId,turnId);return !row.preparing&&row.status==='incomplete';},
      'real 10 GiB logical size exceeded without reading physical data');
    const final=registeredRecord(fixture.taskId,turnId);
    assert.match(final.incomplete_reason,/文件数量或内容规模超过已验证范围.*10 GiB/);
    assert.equal(final.before_ref,null);
    assert.equal(final.after_ref,null);
    await openChange(turnId);
    await app.waitFor("document.querySelector('.agent-diff-surface [role=status]')?.innerText.includes('10 GiB')",10000);
    await screenshot('A65-real-capture-over-limit');
    checkNoTurnRef(fixture,turnId);
    assert.deepEqual(gitState(fixture),git);
    assert.equal(sha(fixture.file),source);
    entry.after={turnId,final,git,source};
  }finally{unlinkSync(dormant);}
  record(id,['Native capture took the unmodified 10 GiB file limit branch and actual selected turn showed explicit incomplete warning without publishing refs'],[]);
}

async function prepareReclaim() {
  const id='A65-reclaim-seed', entry=result.cases[id];
  const fixture=await newFixture(id,{vcs:'plain'});
  await openTask(fixture);
  await warmDiff(fixture);
  const protectedRow=await captureFresh(fixture,'A65_RECLAIM_PROTECTED',"printf '%s\\n' A65_RECLAIM_PROTECTED >> a.txt");
  const eligibleRow=await captureFresh(fixture,'A65_RECLAIM_ELIGIBLE',"printf '%s\\n' A65_RECLAIM_ELIGIBLE >> a.txt");
  const protectedRef=registeredRecord(fixture.taskId,protectedRow.turnId);
  const eligibleRef=registeredRecord(fixture.taskId,eligibleRow.turnId);
  const before=JSON.parse(protectedRef.before_ref), after=JSON.parse(eligibleRef.after_ref);
  const shadow=realpathSync(before.gitDir);
  assert(before.private&&after.private&&realpathSync(after.gitDir)===shadow);
  assert(shadow.startsWith(join(userData,'agent-diffs')+'/'));
  assert.match(shadow.slice(shadow.lastIndexOf('/')+1),/^[a-f0-9]{64}$/);
  entry.reclaim={taskId:fixture.taskId,projectId:fixture.project.id,cwd:fixture.cwd,protectedRef,eligibleRef,shadow};
  record(id,['Two real captured turns in a private shadow Git, session ready for same-data sparse threshold restart'],[]);
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
async function pressureReclaim() {
  const id='A65-reclaim',entry=result.cases[id];
  const {taskId,projectId,cwd,protectedRef,eligibleRef,shadow}=previous;
  const fixture={taskId,cwd,project:{id:projectId},config:{caseId:id,cwd,mark:'M14_A65_TRIGGER_'+randomUUID(),answer:'A65_TRIGGER_NATIVE_DONE'}};
  configurations.set(fixture.config.mark,fixture.config);
  const protectedRefs=[protectedRef.before_ref,protectedRef.after_ref].map(JSON.parse);
  const eligibleRefs=[eligibleRef.before_ref,eligibleRef.after_ref].map(JSON.parse);
  for(const ref of [...protectedRefs,...eligibleRefs]){
    assert.equal(ref.gitDir,shadow);assert.equal(ref.cwd,cwd);
    assert.equal(nativeRefExists(cwd,shadow,ref.ref),ref.commit);
  }
  assert(spaceMarker&&statSync(spaceMarker.file).size===spaceMarker.logicalBytes);
  await openTask(fixture);
  await observeLease(taskId,protectedRef.turn_id);
  await openChange(protectedRef.turn_id);
  await app.waitFor("document.querySelector('.agent-readonly-diff .cm-content')?.textContent.includes('A65_RECLAIM_PROTECTED')",12000);
  const hold=await until(async()=>(await app.mainEvaluate(leaseEvents)).find(row=>row.channel.endsWith('holdDiff')&&row.token),
    'old real UI selected historical snapshot and held original token');
  await sendRaw(fixture.config.mark+' Exercise production shadow quota threshold.');
  const newTurn=await markerTurn(taskId,fixture.config.mark);
  const reclaimed=await until(async()=>{
    const row=await exactRecord(taskId,eligibleRef.turn_id);
    return row.status==='none'&&row.reason==='快照已清理（空间回收）'&&row;
  },'production pressure transitions old registered snapshot to reclaimed',18000);
  const selectedBefore=await app.evaluate(`document.querySelector(${serializable(diffSelect)})?.value`);
  assert.equal(selectedBefore,protectedRef.turn_id);
  const actualLeaseTrace=await app.mainEvaluate(leaseEvents);
  assert(!actualLeaseTrace.some(row=>row.channel.endsWith('releaseDiff')&&row.input===hold.token),
    'Protected read lease still active when sibling snapshot reclaimed');
  assert.equal((await exactRecord(taskId,protectedRef.turn_id)).status,'complete');
  for(const ref of protectedRefs)assert.equal(nativeRefExists(cwd,shadow,ref.ref),ref.commit);
  for(const ref of eligibleRefs)assert.equal(nativeRefExists(cwd,shadow,ref.ref),null);
  const erased=registeredRecord(taskId,eligibleRef.turn_id);
  assert.equal(erased.before_ref,null);
  assert.equal(erased.after_ref,null);
  await openChange(eligibleRef.turn_id);
  await app.waitFor("document.querySelector('.agent-diff-surface [role=status]')?.innerText.includes('快照已清理（空间回收）')",10000);
  await screenshot('A65-actual-reclamation-notice');
  await recordDone(taskId);
  entry.pressure={spaceMarker,newTurn,protectedTurn:protectedRef.turn_id,reclaimed,hold,actualLeaseTrace,erased};
  entry.leaseTrace=await app.mainEvaluate(stopLease);restoreLease=false;
  record(id,['Original 1 GiB private shadow quota triggered actual Git ref cleanup and exact user-visible marker; existing actual view lease protected its snapshot'],[]);
}

async function keepUnregistered() {
  const id='A65-unregistered',entry=result.cases[id];
  const fixture=await newFixture(id);
  setDirtyIndex(fixture);
  const git=gitState(fixture);
  await openTask(fixture);
  await warmDiff(fixture);
  const valid=await captureFresh(fixture,'A65_ENTITY_NEEDS_GC',"printf '%s\\n' A65_ENTITY_NEEDS_GC >> a.txt");
  await waitProjectQuiescence(fixture);
  const hash=sha(fixture.file);
  const row=registeredRecord(fixture.taskId,valid.turnId);
  const registered=[row.before_ref,row.after_ref].map(JSON.parse);
  assert(registered.every(ref=>!ref.private && ref.cwd===fixture.cwd));
  const unknown='refs/willyou/turns/a65-unregistered-synthetic/before';
  const target=registered[0].commit;
  fixture.git('update-ref',unknown,target);
  assert.equal(fixture.git('rev-parse',unknown),target);
  const allSnapshots=privateRows('SELECT before_ref,after_ref FROM agent_turn_changes WHERE task_id=?',fixture.taskId)
    .flatMap(r=>[r.before_ref,r.after_ref].filter(Boolean)).map(JSON.parse);
  assert(!allSnapshots.some(ref=>ref.ref===unknown));
  entry.beforeDelete={projectId:fixture.project.id,taskId:fixture.taskId,git,sourceHash:hash,registered:allSnapshots.map(r=>r.ref),unknown,target};
  await openProjectDelete(fixture.project.id);
  await app.waitFor(`[...document.querySelectorAll(${serializable(modalButton())})]
    .some(button=>button.textContent.trim()==='删除项目'&&!button.disabled)`,12000);
  await screenshot('A65-actual-delete-project-confirmation');
  await click(modalButton(),'删除项目');
  await until(async()=>!(await app.invoke('agentTasks.list')).some(row=>row.taskId===fixture.taskId),'isolated task removed from product');
  await until(()=>allSnapshots.every(ref=>nativeRefExists(fixture.cwd,ref.gitDir,ref.ref)===null),'registered refs removed by actual project cleanup');
  const remaining=fixture.git('for-each-ref','--format=%(refname) %(objectname)','refs/willyou');
  assert.equal(remaining,unknown+' '+target);
  assert.deepEqual(gitState(fixture),git);
  assert.equal(sha(fixture.file),hash);
  entry.afterDelete={remaining:remaining,headAndIndex:gitState(fixture),sourceHash:sha(fixture.file)};
  record(id,['Actual Git project deletion removed registered snapshots while leaving an exact same-prefix unregistered ref, HEAD, user index and source bytes'],[]);
}

async function largeSvnCapture() {
  const info=JSON.parse(readFileSync(join(root,'a34-prep/fixture-10gib.json'),'utf8'));
  const cwd=realpathSync(info.privateCwd);
  assert(cwd===info.privateCwd&&cwd.startsWith(join(root,'a34-prep/svn-sample-'))&&cwd.endsWith('/wc'));
  assert.deepEqual([info.logicalBytes,info.files],[10*1024**3,20481]);
  assert(info.allocatedBytes>=info.logicalBytes&&existsSync(join(cwd,'.svn/wc.db')));
  assert(!existsSync(join(cwd,'.git'))&&sha(join(cwd,'.svn/wc.db'))===info.svnMetadataSha256);
  const id='A65-a34-large', entry=result.cases[id];
  const project=await app.invoke('projects.create',{name:'A34 isolated 10 GiB SVN',aliases:[],description:'',rulesPath:null},[{label:'SVN',path:cwd}]);
  const task=await app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,cwd,title:'A34 isolated 10 GiB SVN',
    profileId:profile.id,model:modelName,tier:'ask'});
  const fixture={cwd,taskId:task.taskId,config:{caseId:id,cwd,mark:'A34_SVN_FIRST_'+randomUUID(),answer:'A34_FIRST_ROUND_COMPLETE',command:''}};
  entry.fixture=info;
  await refreshFixtureUi();
  await openTask(fixture);
  const start=Date.now();
  await sendTask(fixture);
  const turnId=await markerTurn(task.taskId,fixture.config.mark);
  const seen=await until(async()=>{
    const row=await exactRecord(task.taskId,turnId);
    return row.preparing&&row;
  },'fresh shadow worker actually preparing',20000);
  entry.firstPreparing={elapsedMs:Date.now()-start,record:seen};
  await until(()=>app.evaluate("document.querySelector('.agent-task-view')?.innerText.includes('A34_FIRST_ROUND_COMPLETE')"),
    'conversation works while native worker prepares private baseline',25000);
  const continued=await exactRecord(task.taskId,turnId);
  entry.firstAnswer={at:Date.now()-start,preparing:continued.preparing};
  assert(continued.preparing,'The first conversation should continue before the 10 GiB background snapshot ends');
  await screenshot('01-conversation-while-svn-baseline-preparing');
  await until(async()=>(await exactRecord(task.taskId,turnId)).preparing===false,'private 10 GiB background snapshot finishes',132000);
  entry.firstAfter={elapsedMs:Date.now()-start,row:registeredRecord(task.taskId,turnId)};
  assert.equal(entry.firstAfter.row.status,'incomplete');
  assert.match(entry.firstAfter.row.incomplete_reason,/快照|差异/);

  const made='a34-added.txt', changed='versioned-seed.txt', removed='src/0000/file-00000.txt';
  const change={...fixture,config:{caseId:id+':increment',cwd,mark:'A34_SVN_INCREMENT_'+randomUUID(),answer:'A34_INCREMENT_DONE',
    command:"printf '%s\\n' A34_PRODUCTION_SVN_CHANGED >> versioned-seed.txt && /bin/rm src/0000/file-00000.txt && printf '%s\\n' added > a34-added.txt"}};
  const incrementalStarted=Date.now();
  await sendTask(change);
  const changedTurn=await markerTurn(task.taskId,change.config.mark);
  const done=await until(async()=>{
    const r=await exactRecord(task.taskId,changedTurn);
    return !r.preparing&&r;
  },'actual second SVN capture reaches a stable outcome',35000);
  entry.incremental={elapsedMs:Date.now()-incrementalStarted,record:done,registered:registeredRecord(task.taskId,changedTurn)};
  assert.equal(done.status,'complete',JSON.stringify(entry.incremental));
  assert.deepEqual(done.files.map(file=>file.path).sort(),[made,changed,removed].sort());
  assert(!existsSync(join(cwd,removed))&&existsSync(join(cwd,made))&&readFileSync(join(cwd,changed),'utf8').includes('A34_PRODUCTION_SVN_CHANGED'));
  const before=JSON.parse(entry.incremental.registered.before_ref),after=JSON.parse(entry.incremental.registered.after_ref);
  assert(before.private&&after.private&&before.gitDir===after.gitDir&&before.gitDir.startsWith(join(userData,'agent-diffs')+'/'));
  assert(after.privateBytes>0&&after.privateBytes<=1024**3);
  assert(!existsSync(join(cwd,'.git'))&&sha(join(cwd,'.svn/wc.db'))===info.svnMetadataSha256);
  entry.shadow={bytes:after.privateBytes,generations:[before.ref,after.ref],svnMetadataUnchanged:true};
  await openChange(changedTurn);
  await screenshot('02-increment-actual-large-svn');
  record(id,['Signed App kept conversation responsive during background preparation of non-sparse 10 GiB SVN; later real round captured exact three changes in private shadow storage'],[]);
}
const implementation={'a34-large':largeSvnCapture};
try{
  if(scenario==='reclaim'){
    assert(previous.shadow.startsWith(join(userData,'agent-diffs')+'/'));
    assert.equal(realpathSync(previous.shadow),previous.shadow);
    const name=join(previous.shadow,'a65-sparse-logical-pressure');
    spaceMarker=safeSparse(name,shadowThreshold);
    result.pressureFixture=spaceMarker;
  }
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(3425,'127.0.0.1',ok);});
  origin='http://127.0.0.1:3425';
  cleanup.loopbackPort=3425;
  const fixtureGit=scenario==='cancel'?makeGitGate():undefined;
  const installed=realpathSync(execFileSync('/usr/bin/which',['codex'],{encoding:'utf8'}).trim());
  const nativePath=[...(fixtureGit?[fixtureGit.bin]:[]),dirname(process.execPath),dirname(installed),...String(process.env.PATH).split(':')].join(':');
  if(fixtureGit)result.captureGate={path:fixtureGit.wrapper,sha256:sha(fixtureGit.wrapper),only:'isolated target directory, temp diff GIT_INDEX_FILE, --index-info'};
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
    const active=await app.invoke('agentTasks.snapshot',previous.taskId);
    assert(active.taskId===previous.taskId&&active.projectId===previous.projectId);
  }
  await runCase('A65-'+scenario,implementation[scenario]);
}catch(error){
  result.setupFailure=failText(error);
  if(app)await screenshot('setup-failed').catch(()=>{});
}finally{
  if(existsSync(gatePath))unlinkSync(gatePath);
  if(app){
    if(cancelWatching){
      try{result.unfinishedCancelTrace=await app.mainEvaluate(stopCancelTrace);}
      catch(error){cleanup.cancelObserverError=failText(error);}
    }
    if(restoreLease){
      try{result.unfinishedLeaseTrace=await app.mainEvaluate(stopLease);}
      catch(error){cleanup.leaseObserverError=failText(error);}
    }
    try{
      const active=(await app.invoke('agentTasks.list')).filter(task=>!task.parentTaskId);
      cleanup.beforeQuit=await Promise.all(active.map(async task=>{
        const s=await guardTask(task.taskId);
        return {taskId:task.taskId,runId:s.run?.runId,busy:s.run?.busy,status:s.status,
          openTurns:s.turns.filter(t=>['accepted','dispatching','started'].includes(t.status)).map(t=>t.turn_id)};
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
  result.cleanup=cleanup;
  result.finishedAt=new Date().toISOString();
  result.modelFailures=modelFailures;
  writeFileSync(join(attempt,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({scenario,exit:result.exit,cases:Object.fromEntries(
    Object.entries(result.cases).map(([id,row])=>[id,row.status])),result:join(attempt,'result.json')}));
}
if(result.setupFailure||result.exit?.code!==0||result.exit?.signal||result.rendererErrors?.length||
  modelFailures.length||Object.values(result.cases).some(entry=>entry.status!=='pass'))process.exitCode=1;
