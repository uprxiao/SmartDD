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
const scope = 'M14-A12-tiers';
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
copyFileSync(new URL(import.meta.url),join(attempt,'source-a12-tiers-packaged.mjs'));
const helperRoot=join(packageRoot,'g04','helpers');
const harnessPath=join(helperRoot,'scripts/lib/electron-harness.mjs');
const redirectPath=join(helperRoot,'scripts/applications/fixtures/home-redirect-main.mjs');
const scopePath=join(helperRoot,'scripts/lib/electron-isolation-paths.mjs');
const { openElectron, pause } = await import(pathToFileURL(harnessPath).href);
const { redirectHome } = await import(pathToFileURL(redirectPath).href);
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const result = {
  caseId:'M14-A12',sourceCommit: process.env.M14_ACCEPTANCE_COMMIT,scope,
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
let origin, app, profile, alternateProfile, claudeProfile, activeTaskId, delegation, launchEnv;
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
  const marker=/^A1[2]-[A-Z0-9-]+$/.test(latest) ? latest : null;
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


const tierSelect='select[aria-label="权限档位"]';
const tierLabel={ask:'请求批准',auto:'帮我批准',full:'完全访问'};
const tierState=`(()=>{const f=document.querySelector(${serializable(tierSelect)});return f?{active:document.activeElement===f,value:f.value,options:[...f.options].map(o=>o.value)}:null;})()`;
const confirmDialog='.m13-dialog'; // 378: the real dialog uses aria-labelledby, not aria-label
const requiredNote='插件的写操作也不再询问，发送邮件仍会每次询问';
async function focusTier(){
  await click(composer);
  for(let i=0;i<14;i++){const s=await app.evaluate(tierState);if(s?.active)return s;await key('Tab','Tab');}
  throw Error('Tab never reached the tier select');
}
async function typeTier(tier){
  const before=await focusTier();
  if(before.value===tier)return before;
  const prefix=Array.from(tierLabel[tier])[0];
  await app.cdp('Input.dispatchKeyEvent',{type:'rawKeyDown',key:prefix});
  await app.cdp('Input.dispatchKeyEvent',{type:'char',key:prefix,text:prefix,unmodifiedText:prefix});
  await app.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:prefix});
  return before;
}
// Passive Codex app-server observer: records tier parameters of every thread/turn request.
const codexObserver=`(()=>{const cp=process.getBuiltinModule('child_process');if(globalThis.__a12Obs)return true;const original=cp.spawn;const rows=[];
  cp.spawn=function(command,args,options,...rest){const child=Reflect.apply(original,this,[command,args,options,...rest]);
    if(Array.isArray(args)&&args[0]==='app-server'){rows.push({at:Date.now(),pid:child.pid,method:'spawn',permissionArgs:args.filter((a,i)=>/permission|sandbox/.test(a)||/permission|sandbox/.test(args[i+1]??'')&&a==='-c').slice(0,40)});const w=child.stdin.write;child.stdin.write=function(chunk,...a){try{for(const line of String(chunk).split('\\n')){if(!line.trim())continue;const r=JSON.parse(line);if(['thread/start','thread/resume','turn/start'].includes(r.method)){const p=r.params??{};const text=Array.isArray(p.input)?p.input.filter(x=>x.type==='text').map(x=>x.text).join('\\n'):'';rows.push({at:Date.now(),pid:child.pid,method:r.method,marker:(text.match(/A12-[A-Z0-9-]+/g)??[]).at(-1)??null,approvalPolicy:p.approvalPolicy??null,approvalsReviewer:p.approvalsReviewer??null,sandbox:p.sandboxPolicy?.type??p.sandbox??null,permissions:p.permissions??null,threadId:p.threadId??null});}}}catch{}return Reflect.apply(w,this,[chunk,...a]);};}
    return child;};globalThis.__a12Obs={rows,restore(){cp.spawn=original;return true;}};return true;})()`;
const codexRows=()=>app.mainEvaluate('globalThis.__a12Obs.rows',{label:'a12-read-codex-observer'});
async function claudeCliArgs(f){
  const db=join(userData,'smartdd.db');
  const rows=JSON.parse(execFileSync('/usr/bin/python3',['-c','import sqlite3,json,sys;c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True);print(json.dumps(c.execute("SELECT pid FROM capability_runs WHERE task_id=? ORDER BY generation DESC LIMIT 1",(sys.argv[2],)).fetchall()))',db,f.taskId],{encoding:'utf8'}));
  for(const [pid] of rows){try{const cmd=execFileSync('/bin/ps',['-ww','-p',String(pid),'-o','command='],{encoding:'utf8'}).trim();if(cmd)return {pid,mode:(cmd.match(/--permission-mode(?:=|\s+)(\S+)/)??[])[1]??null,resume:(cmd.match(/--resume(?:=|\s+)(\S+)/)??[])[1]??null};}catch{}}
  return null;
}
async function homeMenu(){
  await click('[data-testid="home-permission"]');
  await app.waitFor("document.querySelectorAll('[role=menuitemradio]').length>0",5000);
  const items=await app.evaluate("[...document.querySelectorAll('[role=menuitemradio]')].map(e=>e.querySelector('b')?.innerText.trim()??e.innerText.trim())");
  return items;
}
async function closeMenu(){await key('Escape','Escape');await app.waitFor("!document.querySelector('[role=menuitemradio]')",5000);}
// 379: the M14 home uses the shared model picker, not the older home-profile menu.
async function homeProfile(name){
  await visible('.agent-model-pill');await click('.agent-model-pill');
  await visible(profileButton(name));await click(profileButton(name));
  await visible(modelButton(modelName));await click(modelButton(modelName));
  await app.waitFor("!document.querySelector('.agent-picker')",6000);
  await app.waitFor(`document.querySelector('.agent-model-pill .agent-model-profile')?.textContent===${serializable(name)}`,6000);
}
async function caseA12(){
  const entry=result.cases[scope], ok=(label,cond,data)=>{(cond?entry.passed:entry.missing).push(data===undefined?label:{label,data});};
  await app.mainEvaluate(codexObserver,{label:'a12-attach-codex-observer'});
  // ---- 1. task page first full-access confirmation, cancelled ----
  const t1=await newFixture('a12-codex',profile);
  await openTask(t1);
  const s0=await app.evaluate(tierState);
  ok('Codex task tier list is ask/auto/full',JSON.stringify(s0.options)==='["ask","auto","full"]',s0.options);
  await send(t1,'A12-CODEX-ASK','REPLY-A12-CODEX-ASK');
  await typeTier('full');
  await visible(confirmDialog);
  const taskDialog=await app.evaluate(`document.querySelector(${serializable(confirmDialog)}).innerText`);
  await screenshot('01-task-first-full-confirm');
  await click(confirmDialog+' button','取消');
  await app.waitFor(`!document.querySelector(${serializable(confirmDialog)})`,5000);
  ok('task page first full access asks with the required text; cancel keeps the tier',taskDialog.includes(requiredNote)&&(await snapshot(t1)).selection.tier==='ask'&&(await app.evaluate(tierState)).value==='ask',taskDialog);
  // ---- 2. home: per-executor lists, cancel then confirm ----
  await click('[data-testid="nav-home"]');
  await visible('[data-testid="home-permission"]');
  await homeProfile('A12 Claude');
  const claudeHome=await homeMenu();await closeMenu();
  await homeProfile('A12 Codex');
  const codexHome=await homeMenu();
  ok('home lists three tiers for Codex and no 帮我批准 for Claude, no 自动接受编辑',codexHome.length===3&&codexHome.some(x=>x.includes('帮我批准'))&&!claudeHome.some(x=>x.includes('帮我批准'))&&![...codexHome,...claudeHome].some(x=>x.includes('自动接受')),{codexHome,claudeHome});
  await clickText('[role=menuitemradio]','完全访问');
  await visible(confirmDialog);
  const homeDialog=await app.evaluate(`document.querySelector(${serializable(confirmDialog)}).innerText`);
  await screenshot('02-home-first-full-confirm');
  await click(confirmDialog+' button','取消');
  await app.waitFor(`!document.querySelector(${serializable(confirmDialog)})`,5000);
  const afterCancel=await app.evaluate("document.querySelector('[data-testid=home-permission]').innerText");
  ok('home uses the same confirmation text; cancel keeps 请求批准',homeDialog===taskDialog&&/请求批准/.test(afterCancel),{homeDialog,afterCancel});
  await homeMenu();await clickText('[role=menuitemradio]','完全访问');
  await visible(confirmDialog);await click(confirmDialog+' button','继续使用完全访问');
  await app.waitFor("document.querySelector('[data-testid=home-permission]').innerText.includes('完全访问')",5000);
  // ---- 3. create from home with full access ----
  const before=new Set((await app.invoke('agentTasks.list')).map(t=>t.taskId));
  const homeInput='[data-testid="home-input"]';
  await click(homeInput);
  await app.cdp('Input.insertText',{text:'A12-HOME-FULL'});
  await key('Enter','Enter',4);
  const created=await until(async()=>(await app.invoke('agentTasks.list')).find(t=>!before.has(t.taskId)),'home creates a task',20000);
  const homeTask={taskId:created.taskId};
  const hs=await until(async()=>{const s=await snapshot(homeTask);return s.items.some(i=>i.type==='assistant_message'&&i.payload.text==='REPLY-A12-HOME-FULL')&&!s.run?.busy&&s;},'home task answered',30000);
  const homeTurn=(await codexRows()).filter(r=>r.method==='turn/start'&&r.marker==='A12-HOME-FULL').at(-1);
  ok('home-created task records full access and the native turn runs with never/dangerFullAccess',hs.selection.tier==='full'&&hs.selection.driverId==='codex-app-server'&&homeTurn?.approvalPolicy==='never'&&homeTurn?.sandbox==='dangerFullAccess',{tier:hs.selection.tier,homeTurn});
  await click('[data-testid="nav-home"]');
  await visible('[data-testid="home-permission"]');
  ok('home selector still shows the chosen tier after creation',(await app.evaluate("document.querySelector('[data-testid=home-permission]').innerText")).includes('完全访问'));
  // ---- 4/5. Codex per-tier native parameters; remembered confirmation ----
  await openTask(t1);
  await typeTier('auto');
  await until(async()=>(await snapshot(t1)).selection.tier==='auto','auto selected',8000);
  await send(t1,'A12-CODEX-AUTO','REPLY-A12-CODEX-AUTO');
  await typeTier('full');
  await pause(600);
  const noDialog=!(await app.evaluate(`Boolean(document.querySelector(${serializable(confirmDialog)}))`));
  await until(async()=>(await snapshot(t1)).selection.tier==='full','full selected without a second confirmation',8000);
  ok('task page full access is not reconfirmed after the shared confirmation',noDialog);
  await send(t1,'A12-CODEX-FULL','REPLY-A12-CODEX-FULL');
  const rows=await codexRows(), turn=m=>rows.filter(r=>r.method==='turn/start'&&r.marker===m).at(-1);
  entry.codexTurns={ask:turn('A12-CODEX-ASK'),auto:turn('A12-CODEX-AUTO'),full:turn('A12-CODEX-FULL')};
  const t=entry.codexTurns;
  // 380: ask/auto send the named host-CLI permission profile (D06-11) instead of sandboxPolicy; its definition comes from the app-server -c overrides.
  const spawnArgs=rows.filter(r=>r.method==='spawn').flatMap(r=>r.permissionArgs);
  entry.codexPermissionArgs=spawnArgs;
  const profileOk=name=>!!name&&spawnArgs.includes(`default_permissions="${name}"`)&&spawnArgs.includes(`permissions.${name}.extends=":workspace"`);
  ok('Codex ask = workspace-write (named profile) + on-request + reviewer user',t.ask?.approvalPolicy==='on-request'&&t.ask?.approvalsReviewer==='user'&&(t.ask?.sandbox==='workspaceWrite'||profileOk(t.ask?.permissions)),{turn:t.ask,spawnArgs});
  ok('Codex auto = workspace-write (named profile) + on-request + auto_review',t.auto?.approvalPolicy==='on-request'&&t.auto?.approvalsReviewer==='auto_review'&&(t.auto?.sandbox==='workspaceWrite'||profileOk(t.auto?.permissions)),t.auto);
  ok('Codex full = never + dangerFullAccess',t.full?.approvalPolicy==='never'&&t.full?.sandbox==='dangerFullAccess',t.full);
  ok('each turn sends the tier explicitly and the change applies from the next turn on the same thread',t.ask&&t.auto&&t.full&&new Set([t.ask.threadId,t.auto.threadId,t.full.threadId].filter(Boolean)).size<=1,t);
  // ---- 6. Claude ----
  const t2=await newFixture('a12-claude',claudeProfile);
  await openTask(t2);
  const c0=await app.evaluate(tierState);
  ok('Claude task tier list is ask/full only',JSON.stringify(c0.options)==='["ask","full"]',c0.options);
  await send(t2,'A12-CLAUDE-ASK','REPLY-A12-CLAUDE-ASK');
  const askCli=await claudeCliArgs(t2);
  await typeTier('full');
  await until(async()=>(await snapshot(t2)).selection.tier==='full','Claude full selected',8000);
  await send(t2,'A12-CLAUDE-FULL','REPLY-A12-CLAUDE-FULL');
  const fullCli=await claudeCliArgs(t2);
  entry.claudeCli={askCli,fullCli};
  ok('Claude ask runs with permission-mode default, full with bypassPermissions and resumes the same session',askCli?.mode==='default'&&fullCli?.mode==='bypassPermissions'&&!!fullCli?.resume,entry.claudeCli);
  // ---- 7. task-owned selection survives switching tasks ----
  await openTask(t1);
  await pick(t1,'A12 Codex',profile.id,secondModel);
  await openTask(t2);await openTask(t1);
  const back=await snapshot(t1), backClaude=await snapshot(t2);
  ok('task model and tier belong to the task across switching',back.selection.model===secondModel&&back.selection.tier==='full'&&backClaude.selection.tier==='full'&&(await app.evaluate(tierState)).value==='full',{t1:back.selection,t2:backClaude.selection});
  await screenshot('03-task-selection-retained');
  // ---- 8. restart the same isolated App, resume the Codex thread, change tier, next turn uses it ----
  entry.codexRows=await codexRows();
  const threadBefore=entry.codexTurns.full?.threadId;
  await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${serializable(userData)})throw Error('Own App only');setTimeout(()=>E.app.quit(),100);return true;})()`,{label:'a12-quit-before-restart'});
  entry.firstExit=await app.waitForExit(20000);
  ok('first App phase exits normally',entry.firstExit?.code===0&&!entry.firstExit?.signal,entry.firstExit);
  app=await openElectron({executable,userData,env:launchEnv,inspectMain:true,startupMainHook:async info=>{await redirectHome({...info,home});}});
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await app.mainEvaluate(codexObserver,{label:'a12-attach-codex-observer-after-restart'});
  await openTask(t1);
  ok('tier and model survive the restart',(await snapshot(t1)).selection.tier==='full'&&(await snapshot(t1)).selection.model===secondModel,(await snapshot(t1)).selection);
  await typeTier('ask');
  await until(async()=>(await snapshot(t1)).selection.tier==='ask','ask selected after restart',8000);
  await send(t1,'A12-CODEX-RESUMED-ASK','REPLY-A12-CODEX-RESUMED-ASK');
  const after=await codexRows();
  // 383: match the resumed turn of t1 itself; other tasks also resume their threads after restart.
  const resumedTurn=after.filter(r=>r.method==='turn/start'&&r.marker==='A12-CODEX-RESUMED-ASK').at(-1), resume=resumedTurn&&resumedTurn.threadId===threadBefore&&resumedTurn.pid!==entry.codexTurns.full?.pid?resumedTurn:null;
  entry.afterRestart={resume,resumedTurn};
  ok('after restart the same thread is resumed and the changed tier applies to the next turn',!!resume&&resume.threadId===threadBefore&&resumedTurn?.approvalPolicy==='on-request'&&resumedTurn?.approvalsReviewer==='user'&&!!resumedTurn?.permissions,entry.afterRestart);
  record(scope,entry.passed,entry.missing);
}
async function clickText(selector,text){
  const point=await app.evaluate(`(()=>{const e=[...document.querySelectorAll(${serializable(selector)})].filter(x=>x.innerText.includes(${serializable(text)})&&x.getBoundingClientRect().height>0);if(e.length!==1)return null;const r=e[0].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  assert(point,'unique '+selector+' '+text);
  for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});
  result.actions.push({selector,text,...point});
}
try{
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(3425,'127.0.0.1',()=>ok(undefined));});
  const listening=server.address();
  assert(listening && typeof listening!=='string' && listening.address==='127.0.0.1' && listening.port===3425);
  origin='http://127.0.0.1:'+listening.port;
  cleanup.loopbackPort=listening.port;
  const installation=realpathSync(execFileSync('/usr/bin/which',['codex'],{encoding:'utf8'}).trim());
  const nativePath=[dirname(process.execPath),dirname(installation),...String(process.env.PATH).split(':')].join(':');
  launchEnv={HOME:home,PATH:nativePath,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude')};
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
    const provider=await app.invoke('agents.saveProvider',{name:'A12 loopback '+name,preset:'magpie',
      endpoints:{responses:origin+'/v1',anthropic:origin+'/'},models:models.map(id=>({id,name:id}))});
    return app.invoke('agents.save',{name,toolId:tool.id,source:'provider',
      providerId:provider.id,models,defaultModel:modelName,isDefault});
  };
  profile=await settleProfile('A12 Codex',codex,true);
  claudeProfile=await settleProfile('A12 Claude',claude);
  result.engines.claudePath=claude.customPath??null;
  await click('[data-testid="nav-settings"]');
  await visible('[data-testid="m14-toggle"]');
  const flag=await app.evaluate("document.querySelector('[data-testid=m14-toggle]').textContent");
  if(!flag.includes('已开启')) await click('[data-testid="m14-toggle"]');
  await click('[data-testid="nav-home"]');
  await visible('.agent-model-pill');
  await runCase(scope,caseA12);
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
