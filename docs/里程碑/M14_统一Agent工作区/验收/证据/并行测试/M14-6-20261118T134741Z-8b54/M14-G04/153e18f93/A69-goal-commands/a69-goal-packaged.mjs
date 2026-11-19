import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [rawExecutable, attempt, expectedHash] = process.argv.slice(2);
const scope = 'M14-A69-goal-and-commands';
assert(rawExecutable && attempt, 'Pass packaged executable and new attempt directory');
const executable = realpathSync(rawExecutable);
const packageRoot=/^(\/private\/tmp\/willyou-m14-stage6\.[A-Za-z0-9]{6})\/package\/mac-arm64\/WillYou\.app\/Contents\/MacOS\/WillYou$/.exec(executable)?.[1];
assert(packageRoot&&attempt.startsWith(packageRoot+'/g04/'),'Use the same private root for package and test attempt');
assert(/^\/g04\/attempt-\d{3}(?:\/[A-Za-z0-9_-]+)*$/.test(attempt.slice(packageRoot.length)));
const archive = join(dirname(executable), '../Resources/app.asar');
assert(statSync(archive).size > 0);
assert.match(expectedHash??'',/^[a-f0-9]{64}$/);
assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'),expectedHash);
for(const key of ['DEEPSEEK_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','OPENAI_API_KEY','CODEX_API_KEY','CLAUDE_CODE_OAUTH_TOKEN'])
  assert(!process.env[key],'No external model credential allowed: '+key);
mkdirSync(attempt, {mode:0o700});
copyFileSync(new URL(import.meta.url),join(attempt,'source-a69-goal-packaged.mjs'));
const helperRoot=join(packageRoot,'g04','helpers');
const harnessPath=join(helperRoot,'scripts/lib/electron-harness.mjs');
const redirectPath=join(helperRoot,'scripts/applications/fixtures/home-redirect-main.mjs');
const scopePath=join(helperRoot,'scripts/lib/electron-isolation-paths.mjs');
const { openElectron, pause } = await import(pathToFileURL(harnessPath).href);
const { redirectHome } = await import(pathToFileURL(redirectPath).href);
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const result = {
  caseId:'M14-A69',sourceCommit: process.env.M14_ACCEPTANCE_COMMIT,scope,
  helpers:Object.fromEntries([harnessPath,redirectPath,scopePath].map(file=>[file.slice(helperRoot.length+1),sha(file)])),
  build: {executable, appAsarSha256:sha(archive)},
  platform: process.platform, arch:process.arch,
  startedAt:new Date().toISOString(), layer:'A / installed Codex and Claude, private loopback',
  plan:'A1.13',
  cases: {}, actions: [], model: [],
};
assert(/^[a-f0-9]{40}$/.test(result.sourceCommit));
assert.equal(readFileSync(join(packageRoot,'source-commit.txt'),'utf8').trim(),result.sourceCommit);
const cleanup = { isolationAttempt: attempt };
for (const directory of ['home','data']) mkdirSync(join(attempt,directory));
const home=realpathSync(join(attempt,'home'));
const userData=realpathSync(join(attempt,'data'));
const modelName = 'm14-switch-model-one';
const secondModel = 'm14-switch-model-two';
const models = [modelName, secondModel];
const sharedGoal = 'A69-CODEX-GOAL';
const trace={codex:[],claude:[]};let codexGoalTurns=0;
let origin, app, profile, alternateProfile, claudeProfile, activeTaskId, delegation;
let modelFailures = [];
const server = createServer((req,res) => { void respond(req,res).catch(error=>{
  modelFailures.push(String(error.message??error));
  if(delegation) delegation.failure=String(error.message??error);
  res.destroy();
}); });
const { sendAssistant, latestUserText } = await import('../a60-prep/provider-contract.mjs');
async function respond(req,res) {
  const endpoint=new URL(req.url,origin??'http://127.0.0.1');
  if(endpoint.pathname.endsWith('/models')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:models.map(id=>({id}))}));return;}
  const kind = endpoint.pathname.endsWith('/responses') ? 'codex' : endpoint.pathname.endsWith('/messages') ? 'claude' : null;
  if(req.method!=='POST'||!kind){res.writeHead(404);res.end();return;}
  const chunks=[];for await(const chunk of req) chunks.push(chunk);
  const body=JSON.parse(Buffer.concat(chunks).toString());
  const user=latestUserText(kind,body).trim();
  const latest=user.split('\n').at(-1)?.trim() ?? '';
  const marker=/^A69-USER-[A-Z0-9-]+$/.test(latest) ? latest : null;
  let text;
  if(kind==='claude'&&latest==='/goal clear')text='Goal cleared';
  else if(kind==='claude'&&latest.startsWith('/goal '))text=latest.includes('UNKNOWN')?'I will keep that in mind.':'Goal set: '+latest.slice(6);
  else if(marker)text='REPLY-'+marker;
  else if(kind==='codex'){codexGoalTurns++;text='A69-GOAL-TURN-'+codexGoalTurns;await pause(400);}
  else text='A69-EXTRA-TURN';
  trace[kind].push({at:Date.now(),latest:latest.slice(0,80),slashLeak:/^\/(goal|init|review|compact)\b/.test(latest)&&!(kind==='claude'&&latest.startsWith('/goal')),text});
  sendAssistant(res,{kind,model:body.model,text});
}

const serializable=value=>JSON.stringify(value);
const failText=e=>String(e?.stack??e);
const visibleExpression=(selector)=>`[...document.querySelectorAll(${serializable(selector)})].some(e=>e.getBoundingClientRect().height>0&&e.getBoundingClientRect().width>0)`;
async function key(key,code,modifiers=0) {
  const special={Enter:[13,'\r'],Escape:[27,''],Backspace:[8,''],ArrowLeft:[37,'']};
  const [windowsVirtualKeyCode,text]=special[code]??[/^Key[A-Z]$/.test(code)?code.charCodeAt(3):0,key.length===1?key:''];
  await app.cdp('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,windowsVirtualKeyCode,...(!modifiers&&text?{text}:{})});
  await app.cdp('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers,windowsVirtualKeyCode});
}
async function click(selector,label) {
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
    await app.cdp('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});
  }
  result.actions.push({at:new Date().toISOString(),selector,label,...point});
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
function prepareRoot(id) {
  const cwd=join(attempt,id);
  mkdirSync(cwd);
  const file=join(cwd,'a.txt');
  const git=(...args)=>execFileSync('/usr/bin/git',args,{cwd,env:{...process.env,HOME:home,
    GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'},encoding:'utf8'}).trim();
  writeFileSync(file,'initial\nsecond line\n第三行\n');
  git('init','-q','-b','main');
  git('config','user.name','Synthetic acceptance');
  git('config','user.email','fixture@example.invalid');
  git('add','a.txt');
  git('-c','commit.gpgsign=false','commit','-qm','baseline');
  return {cwd,file};
}
async function newFixture(id, selected=profile) {
  const disk=prepareRoot(id);
  const project=await app.invoke('projects.create',{name:id+' stage 6',aliases:[],description:'',rulesPath:null},[{label:'work',path:disk.cwd}]);
  const task=await app.invoke('agentTasks.create',{
    projectId:project.id,dirId:project.dirs[0].id,cwd:disk.cwd,title:id+' stage 6',
    profileId:selected.id,model:modelName,tier:'ask',
  });
  await refreshFixtureUi();
  return {...disk,project,taskId:task.taskId};
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

const composer='.agent-task-view .agent-composer textarea';
const pill='.agent-task-view .agent-model-pill';
const goalRow='[data-testid="agent-goal"]';
const profileButton=name=>'.agent-picker-rail button[aria-label='+serializable(name)+']';
const modelButton=id=>'.agent-model-row[aria-label='+serializable(id)+']';
const snapshot=f=>app.invoke('agentTasks.snapshot',f.taskId);
const selected=async (f,profileId,model)=>until(async()=>{
  const s=await snapshot(f);
  return s.selection.profileId===profileId&&s.selection.model===model&&!s.switching&&s;
},'requested selection applied on the bound task',20000);
async function fillComposer(text){
  await visible(composer);await click(composer);
  await app.waitFor(`document.activeElement?.matches(${serializable(composer)})`,3000);
  await app.cdp('Input.insertText',{text});
  await app.waitFor(`document.querySelector(${serializable(composer)})?.value===${serializable(text)}`,3500);
}
async function send(f,text,reply){
  await fillComposer(text);
  return submitPrepared(f,reply);
}
async function submitPrepared(f,reply){
  // 375: the warning toast from the blocked /init and the open slash menu can cover the submit button.
  if(await app.evaluate("Boolean(document.querySelector('.agent-menu'))"))await key('Escape','Escape');
  await app.waitFor("!document.querySelector('.agent-menu')&&![...document.querySelectorAll('[data-sonner-toast]')].some(t=>t.getBoundingClientRect().height>0)",12000).catch(()=>{});
  await click('.agent-task-view .agent-composer button[type="submit"]');
  if(!reply)return;
  const s=await until(async()=>{
    const snap=await snapshot(f);
    const match=snap.items.find(item=>item.type==='assistant_message'&&item.payload.text===reply);
    return match&&!snap.run?.busy&&snap;
  },reply+' from an actual native turn',35000);
  await app.waitFor(`Array.from(document.querySelectorAll('.agent-assistant:not(.streaming) .agent-md')).some(e=>e.textContent.trim()===${serializable(reply)})`,8000);
  return s;
}
async function pick(f,name,profileId,model,alreadyOpen=false){
  if(!alreadyOpen){await visible(pill);await click(pill);}
  const rail=profileButton(name);
  await visible(rail);await click(rail);await visible(modelButton(model));await click(modelButton(model));
  await app.waitFor("!document.querySelector('.agent-picker')",6000);
  return selected(f,profileId,model);
}
async function checkLocked(){
  await visible(pill);await click(pill);await visible(profileButton('A14 Codex B'));
  const rail=await app.evaluate(`(()=>[...document.querySelectorAll('.agent-picker-rail button')].map(e=>({name:e.getAttribute('aria-label'),disabled:e.disabled,selected:e.getAttribute('aria-pressed')})))()`);
  assert.equal(rail.length,3);
  assert(rail.find(item=>item.name==='A14 Codex A'&&!item.disabled&&item.selected==='true'));
  assert(rail.find(item=>item.name==='A14 Codex B'&&item.disabled));
  assert(rail.find(item=>item.name==='A14 Claude C'&&item.disabled));
  await app.waitFor("document.querySelector('.agent-picker [role=note]')?.textContent.includes('清除目标后才能切换')",5000);
  return rail;
}
async function checkGoal(f,status){
  return until(async()=>{
    const s=await snapshot(f);
    return s.goal?.status===status&&s.goal.objective===sharedGoal&&s.goal;
  },'actual native goal state '+status,30000);
}
async function setGoal(f){await send(f,'/goal '+sharedGoal);return checkGoal(f,'active');}
async function goalButton(title){await visible(goalRow);await click(goalRow+' .agent-goal-actions button',title);}

const goalState=async f=>(await snapshot(f)).goal;
async function menuLabels(){
  await fillComposer('/');
  await app.waitFor("document.querySelectorAll('.agent-composer-menu [role=option], .agent-menu [role=option], .agent-composer-menu button').length>0",5000).catch(()=>{});
  const labels=await app.evaluate(`[...document.querySelectorAll('.agent-composer-menu [role=option], .agent-menu [role=option], .agent-composer-menu button')].map(e=>e.innerText.split('\\n')[0].trim())`);
  await key('Escape','Escape');
  await app.evaluate(`(()=>{const t=document.querySelector(${serializable(composer)});const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(t,'');t.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  return labels;
}
async function clearComposer(){
  // 374: Cmd+A via background CDP did not select the textarea text; clear through the native value setter instead.
  await app.evaluate(`(()=>{const t=document.querySelector(${serializable(composer)});const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(t,'');t.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await app.waitFor(`document.querySelector(${serializable(composer)})?.value===''`,3000);
}
async function caseA69(){
  const entry=result.cases[scope], ok=(label,cond,data)=>{(cond?entry.passed:entry.missing).push(data===undefined?label:{label,data});};
  // ---- Codex ----
  const cx=await newFixture('a69-codex',profile);
  await openTask(cx);
  await send(cx,'A69-USER-WARM','REPLY-A69-USER-WARM');
  const codexMenu=await menuLabels();
  entry.codexMenu=codexMenu;
  ok('Codex command menu lists /review and /goal, not /init',codexMenu.some(l=>l.startsWith('/review'))&&codexMenu.some(l=>l.startsWith('/goal'))&&!codexMenu.some(l=>l.startsWith('/init')),codexMenu);
  const before=trace.codex.length;
  await fillComposer('/init');
  await click('.agent-task-view .agent-composer button[type="submit"]');
  await app.waitFor("document.body.innerText.includes('没有公布 /init')",5000);
  await pause(1500);
  ok('Codex manual /init blocked: warning shown, nothing sent, input kept',trace.codex.length===before&&await app.evaluate(`document.querySelector(${serializable(composer)})?.value==='/init'`),{requests:trace.codex.length-before});
  await clearComposer();
  await screenshot('01-codex-unpublished-command-blocked');
  const turnsBefore=codexGoalTurns;
  await send(cx,'/goal '+sharedGoal);
  await checkGoal(cx,'active');
  ok('Codex /goal intercepted by the host (never sent as text)',!trace.codex.some(t=>t.latest.startsWith('/goal')),trace.codex.map(t=>t.latest));
  await until(()=>codexGoalTurns>=turnsBefore+2,'two automatic goal turns without user input',30000);
  ok('Codex goal opens consecutive turns automatically',codexGoalTurns>=turnsBefore+2,codexGoalTurns-turnsBefore);
  await visible(goalRow);
  const rowText=await app.evaluate(`document.querySelector(${serializable(goalRow)}).innerText`);
  entry.codexRowActive=rowText;
  ok('goal row shows status, duration and host turn count, no token',/进行中/.test(rowText)&&/\d+ 轮/.test(rowText)&&!/token/i.test(rowText),rowText);
  await screenshot('02-codex-goal-active');
  await goalButton('暂停');
  await checkGoal(cx,'paused');
  await until(async()=>!(await snapshot(cx)).run?.busy,'current turn ends after pause',20000);
  const pausedAt=codexGoalTurns;await pause(3000);
  ok('pause: no new turn after the current one ends',codexGoalTurns===pausedAt,{pausedAt,now:codexGoalTurns});
  await goalButton('继续');
  await checkGoal(cx,'active');
  await until(()=>codexGoalTurns>pausedAt,'resume opens a new turn immediately',10000);
  ok('resume opens a new turn immediately',codexGoalTurns>pausedAt);
  await until(async()=>(await snapshot(cx)).run?.busy,'a goal turn is running before stop',10000);
  await click('.agent-composer button.agent-stop-run');
  await until(async()=>{const s=await snapshot(cx);return !s.run?.busy&&s.goal?.status==='paused'&&s;},'stop pauses the goal and interrupts',20000);
  const stopRow=await app.evaluate(`document.querySelector(${serializable(goalRow)})?.innerText`);
  const stoppedAt=codexGoalTurns;await pause(3000);
  ok('stop = pause goal then interrupt; row shows paused, no further turns',/已暂停/.test(stopRow??'')&&!/进行中/.test(stopRow??'')&&codexGoalTurns===stoppedAt,{stopRow,stoppedAt,now:codexGoalTurns});
  await screenshot('03-codex-goal-stopped-paused');
  await goalButton('清除');
  await until(async()=>!(await goalState(cx))||(await goalState(cx))?.status==='cleared','goal cleared',15000);
  await app.waitFor(`!document.querySelector(${serializable(goalRow)})`,8000);
  ok('clear removes the goal row',true);
  // ---- Claude ----
  const cl=await newFixture('a69-claude',claudeProfile);
  await openTask(cl);
  await send(cl,'A69-USER-CLAUDE-WARM','REPLY-A69-USER-CLAUDE-WARM');
  const claudeMenu=await menuLabels();
  entry.claudeMenu=claudeMenu;
  ok('Claude command menu lists /init',claudeMenu.some(l=>l.startsWith('/init')),claudeMenu);
  await send(cl,'/goal A69-CLAUDE-GOAL');
  await until(async()=>(await goalState(cl))?.status==='active','Claude goal recognised from Goal set',20000);
  // 376: Claude CLI 2.1.326 handles /goal itself and replies 'Goal set: …'; it never reaches the model. Check the submitted text and the recognised native reply.
  const claudeItems=async()=>(await snapshot(cl)).items.map(i=>[i.type,i.payload?.text]);
  ok('Claude /goal is submitted as text to the CLI and recognised from its Goal set reply',(await claudeItems()).some(([t,x])=>t==='user_message'&&x==='/goal A69-CLAUDE-GOAL')&&(await claudeItems()).some(([t,x])=>t==='assistant_message'&&String(x).startsWith('Goal set: A69-CLAUDE-GOAL')),await claudeItems());
  await visible(goalRow);
  const buttons=await app.evaluate(`[...document.querySelectorAll(${serializable(goalRow+' .agent-goal-actions button')})].map(b=>b.innerText.trim())`);
  ok('Claude goal offers only clear',JSON.stringify(buttons)==='["清除"]',buttons);
  await screenshot('04-claude-goal-active');
  await goalButton('清除');
  await until(async()=>!(await goalState(cl))||(await goalState(cl))?.status==='cleared','Claude goal cleared',20000);
  await app.waitFor(`!document.querySelector(${serializable(goalRow)})`,8000);
  ok('Claude clear sends /goal clear and removes the row',(await claudeItems()).some(([t,x])=>t==='user_message'&&x==='/goal clear'),await claudeItems());
  entry.unknownBranch='Not reachable with Claude CLI 2.1.326: the CLI answers /goal locally in the recognised format; covered by service and renderer tests (D06-66).';
  entry.trace=trace;
  record(scope,entry.passed,entry.missing);
}
try{
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(3425,'127.0.0.1',()=>ok(undefined));});
  const listening=server.address();
  assert(listening && typeof listening!=='string' && listening.address==='127.0.0.1' && listening.port===3425);
  origin='http://127.0.0.1:'+listening.port;
  cleanup.loopbackPort=listening.port;
  const installation=realpathSync(execFileSync('/usr/bin/which',['codex'],{encoding:'utf8'}).trim());
  const nativePath=[dirname(process.execPath),dirname(installation),...String(process.env.PATH).split(':')].join(':');
  app=await openElectron({executable,userData,env:{HOME:home,PATH:nativePath,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude')},inspectMain:true,startupMainHook:async info=>{const hook=await redirectHome({...info,home});assert.equal(hook.workerInspectorFlagRemoved,true);result.isolationHook=hook;}});
  cleanup.pid=app.processId;
  writeFileSync(join(attempt,'in-flight.json'),JSON.stringify(cleanup,null,2)+'\n',{mode:0o600});
  const processBinding=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');return {pid:process.pid,executable:process.execPath,userData:E.app.getPath('userData'),home:process.env.HOME,electronHome:E.app.getPath('home'),packaged:E.app.isPackaged};})()`,{label:'g04-isolated-identity'});
  result.binding=processBinding;
  assert.deepEqual(processBinding,{pid:app.processId,executable,userData,home,electronHome:home,packaged:true});
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await app.invoke('agents.refreshTools');
  const tools=await app.invoke('agents.tools');
  const codex=tools.find(t=>t.kind==='codex'&&t.installed);
  const claude=tools.find(t=>t.kind==='claude'&&t.installed);
  assert(codex && claude);
  result.engines={codex:codex.version,claude:claude.version};
  const settleProfile=async (name,tool,isDefault=false) => {
    const provider=await app.invoke('agents.saveProvider',{name:'A69 loopback '+name,preset:'magpie',
      endpoints:{responses:origin+'/v1',anthropic:origin+'/'},models:models.map(id=>({id,name:id}))});
    return app.invoke('agents.save',{name,toolId:tool.id,source:'provider',
      providerId:provider.id,models,defaultModel:modelName,isDefault});
  };
  profile=await settleProfile('A69 Codex',codex,true);
  claudeProfile=await settleProfile('A69 Claude',claude);
  await click('[data-testid="nav-settings"]');
  await visible('[data-testid="m14-toggle"]');
  const flag=await app.evaluate("document.querySelector('[data-testid=m14-toggle]').textContent");
  if(!flag.includes('已开启')) await click('[data-testid="m14-toggle"]');
  await click('[data-testid="nav-home"]');
  await visible('.agent-model-pill');
  await runCase(scope,caseA69);
}catch(error){
  result.setupFailure=failText(error);
  if(app){
    result.setupDom=await app.evaluate('document.body.innerText.slice(-9000)').catch(()=>null);
    await screenshot('setup-failed').catch(()=>{});
  }
}finally{
  if(app){
    result.appLogs=app.logs();
    try{
      cleanup.preQuit={
        activeTasks:(await app.invoke('agentTasks.list')).filter(t=>t.status==='working'||t.status==='waiting').map(({taskId,status})=>({taskId,status})),
        visibleDirty:await app.evaluate("[...document.querySelectorAll('[aria-label=未保存],.fw-conflict-strip')].map(e=>e.closest('[title]')?.getAttribute('title')??e.textContent)"),
        body:await app.evaluate("document.body.innerText.slice(-3000)"),
      };
      cleanup.quittingPhase=join(attempt,'quit-phase.jsonl');
      await app.mainEvaluate(`(()=>{const require=process.getBuiltinModule('module').createRequire(process.execPath);
        const {app,BrowserWindow,dialog}=require('electron'), fs=require('node:fs'), file=${serializable(cleanup.quittingPhase)};
        const write=(event,data={})=>{try{fs.appendFileSync(file,JSON.stringify({at:Date.now(),event,...data})+'\\n',{mode:0o600});}catch{}};
        const restore=[];
        for(const name of ['showMessageBoxSync','showMessageBox']){
          const original=dialog[name];
          const observer=function(...args){const options=args.at(-1);write('native-dialog',{kind:name,message:options?.message??null});return Reflect.apply(original,this,args);};
          dialog[name]=observer;
          if(dialog[name]===observer)restore.push(()=>{dialog[name]=original;});
        }
        const originalWindow=BrowserWindow.getAllWindows()[0];
        originalWindow?.webContents.on('will-prevent-unload',()=>write('will-prevent-unload'));
        app.on('before-quit',e=>write('before-quit',{prevented:e.defaultPrevented}));app.once('will-quit',()=>{write('will-quit');for(const fn of restore)fn();});
        return true;})()`, {label:'g04-quit-passive-observer'});
    }catch(error){cleanup.preQuitObservationError=failText(error);}
    try{
      await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
        if(E.app.getPath('userData')!==${serializable(userData)}||process.pid!==${app.processId})throw Error('Only the current test App may quit');
        setTimeout(()=>E.app.quit(),250);return true;})()`,{label:'quit-g04-isolated-app'});
      cleanup.quitRequested=true;
    }catch(error){cleanup.quitRequestError=failText(error);}
    try{cleanup.exit=await app.waitForExit(20000);}
    catch(error){
      cleanup.exitError=failText(error);
      cleanup.duringQuit=await app.evaluate("document.body.innerText.slice(-3000)",2500).catch(()=>null);
      await app.cdp('Page.captureScreenshot',{format:'png'},2500)
        .then(image=>writeFileSync(join(attempt,'quit-timeout.png'),Buffer.from(image.data,'base64'),{mode:0o600})).catch(()=>{});
      try{cleanup.forced=await app.crash();}catch(forceError){cleanup.forceError=failText(forceError);}
    }
    result.rendererErrors=app.rendererErrors;
  }
  if(server.listening) {
    server.closeAllConnections();
    await new Promise(r=>server.close(r));
  }
  cleanup.listenerClosed=!server.listening;
  result.exit=cleanup.exit??null;
  result.modelFailures=modelFailures;
  result.finishedAt=new Date().toISOString();
  writeFileSync(join(attempt,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  writeFileSync(join(attempt,'cleanup.json'),JSON.stringify(cleanup,null,2)+'\n',{mode:0o600});
  const outputFiles=readdirSync(attempt).map(name=>join(attempt,name)).filter(path=>statSync(path).isFile());
  const manifest=Object.fromEntries(outputFiles.map(path=>[path.slice(attempt.length+1),sha(path)]));
  manifest.driver=sha(new URL(import.meta.url));
  writeFileSync(join(attempt,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  if(result.setupFailure||Object.values(result.cases).some(entry=>entry.status==='failed-or-blocked')
    ||modelFailures.length||result.rendererErrors?.length||cleanup.exit?.code!==0||cleanup.exit?.signal||cleanup.exitError)process.exitCode=1;
}

console.log(JSON.stringify({caseId:result.caseId,scope,status:result.cases[scope]?.status,exit:result.exit,file:join(attempt,'result.json')}));
