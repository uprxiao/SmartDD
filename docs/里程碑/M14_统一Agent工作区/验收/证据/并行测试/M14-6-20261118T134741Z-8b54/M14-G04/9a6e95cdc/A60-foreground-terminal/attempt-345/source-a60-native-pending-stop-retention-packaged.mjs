import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash,randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openElectron, pause } from './helpers/scripts/lib/electron-harness.mjs';
import { redirectHome } from './helpers/scripts/applications/fixtures/home-redirect-main.mjs';
import { assertRetainedStoppedTool, assertStoppedToolUi } from './a60-closure/stopped-tool-proof.mjs';
import { targetHit } from './a60-prep/pointer-guard.mjs';

const [out, scenarioId, expectedSha] = process.argv.slice(2);
const repo=process.cwd();
const {model,warmInput,exerciseInput,nextInput,nextAnswer,canaryName,replayDecision,makeStopResponses,monitorNativeApprovalLines}
  =await import('./a60-closure/native-pending-stop-retention-provider.mjs');
assert.match(out,/^\/private\/tmp\/willyou-m14-stage6\.[A-Za-z0-9]{6}\/g04\/attempt-\d{3}$/);
const executable = process.env.M14_ACCEPTANCE_APP;
const packageRoot=out.slice(0,out.indexOf('/g04/'));
assert.equal(executable,join(packageRoot,'package/mac-arm64/WillYou.app/Contents/MacOS/WillYou'));
assert.equal(executable,realpathSync(executable));
const asar=createHash('sha256').update(readFileSync(join(dirname(executable),'../Resources/app.asar'))).digest('hex');
assert.equal(asar,expectedSha);
assert.equal(realpathSync(repo),join(packageRoot,'source'));
assert.equal(execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),process.env.M14_ACCEPTANCE_COMMIT);
assert.match(process.env.M14_ACCEPTANCE_COMMIT,/^[a-f0-9]{40}$/);
assert(existsSync(executable), 'Package executable missing');
mkdirSync(out);
const driverFiles=['a60-native-pending-stop-retention-packaged.mjs','a60-prep/provider-contract.mjs','a60-prep/pointer-guard.mjs',
  'a60-closure/native-pending-stop-retention-provider.mjs','a60-closure/stopped-tool-proof.mjs'];
for (const name of driverFiles) copyFileSync(new URL(name, import.meta.url), join(out, 'source-' + name.replaceAll('/','-')));
const driverHashes = Object.fromEntries(driverFiles.map(name => [name,
  createHash('sha256').update(readFileSync(join(out, 'source-' + name.replaceAll('/','-')))).digest('hex')]));
const root = realpathSync(mkdtempSync(join(out, 'runtime-')));
const home = join(root, 'home');
const userData = join(root, 'data');
for (const dir of [home, userData]) mkdirSync(dir);
const env = { npm_config_cache: join(root, 'npm-cache'), npm_config_offline:'true', npm_config_audit:'false',
  npm_config_fund:'false', npm_config_update_notifier:'false', HOME: home, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
  XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'), XDG_CACHE_HOME: join(home, '.cache'),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
const scenario={kind:'codex',model};
assert.equal(scenarioId,'pending-native-stop');
for (const key of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','CODEX_API_KEY','OPENAI_API_KEY','DEEPSEEK_API_KEY'])
  assert(!process.env[key],'Test instance cannot use external model credentials: '+key);
const hookResult={};
const result={caseId:'M14-A60',scope:'Exact packaged App, actual Codex command approval, real UI Stop, one stale decision at each boundary',bootstrap:hookResult,
  scenarioId,sourceCommit:process.env.M14_ACCEPTANCE_COMMIT,asar,executable,driverHashes,observations:[],actions:[],requests:[],revision:[],nativeReceipts:[],
  status:'failed',port:3425,nativeApprovalFrames:[]};
let app,profileIds;
const state={cwd:null,toolCallId:null,readyAfterStop:false};
const server=createServer(makeStopResponses({state,record:result}));

const snapshot = taskId => app.invoke('agentTasks.snapshot', taskId);
const relations = taskId => app.invoke('agentTasks.relations', taskId);
async function readExactTool(taskId,snap,turnId,match) {
  const candidates=snap.items.filter(item=>item.turnId===turnId&&item.type==='command_execution');
  const item=candidates.find(match);
  if(!item)return null;
  const content=await app.invoke('agentTasks.itemBody',taskId,item.itemId,0,item.revision);
  assert.equal(content.revision,item.revision);
  assert(content.done && content.next===content.totalBytes && Buffer.byteLength(content.chunk)===content.totalBytes);
  return {itemId:item.itemId,turnId:item.turnId,type:item.type,revision:item.revision,
    terminal:item.terminal,body:content.chunk,bodySha256:createHash('sha256').update(content.chunk).digest('hex')};
}
const answerPresent = (snap, answer) => snap.items.some(i => i.type === 'assistant_message' && i.payload.text?.includes(answer));
async function until(fn, label, timeout = 26000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (result.serverError) throw Error(result.serverError);
    const value=await fn();
    if (value) return value;
    await pause(100);
  }
  throw Error('Timed out: ' + label);
}
const selectorExpr = selector => `document.querySelector(${JSON.stringify(selector)})`;
async function click(selector, text = null, button = 'left', beforeDispatch = null) {
  const expression = `(${targetHit.toString()})(${JSON.stringify(selector)},${JSON.stringify(text)})`;
  const startedAt = Date.now();
  const notReady = [];
  let ready = null;
  try {
    ready = await until(async () => {
      const probe = await app.evaluate(expression);
      if (probe.reason === 'ready') return probe;
      if (probe.reason !== notReady.at(-1)?.reason) notReady.push({ ...probe, at: Date.now() });
      return false;
    }, 'visible unique control ' + selector + (text ? ' ' + text : ''), 6000);
  } finally {
    if (notReady.length || !ready) {
      result.observations.push({ stage: 'background hit readiness', selector, text,
        startedAt, notReady, readyAt: ready ? Date.now() : null });
    }
  }
  const { x, y } = ready;
  beforeDispatch?.();
  const at = Date.now();
  for (const type of ['mousePressed', 'mouseReleased']) {
    await app.cdp('Input.dispatchMouseEvent', { type, x, y, button, clickCount: 1 });
  }
  result.actions.push({ selector, text, button, x, y, at });
}
const viewTitle = title => `document.querySelector('.agent-task-head h1')?.textContent === ${JSON.stringify(title)}`;
async function send(text, title) {
  const composer = '.agent-task-view .agent-composer textarea';
  const target = selectorExpr(composer);
  await app.waitFor(viewTitle(title), 10000);
  await click(composer);
  assert(await app.evaluate(`(${viewTitle(title)}) && document.activeElement === ${target}`),
    'The exact active task composer must own focus before text insertion');
  await app.cdp('Input.insertText', { text });
  await app.waitFor(`(${viewTitle(title)}) && ${target}?.value === ${JSON.stringify(text)}`, 7000);
  await click('.agent-task-view .agent-composer button[type="submit"]');
}

let phase = 'prepare isolated project';
try {
  const cwd = join(root, 'project');
  const vcs = (executable, args) => execFileSync(executable, args, {
    env: { ...process.env, ...env }, encoding:'utf8', stdio:['ignore','pipe','pipe'], timeout:10000,
  }).trim();

  mkdirSync(cwd);
  vcs('git',['-C',cwd,'init','-qb','main']);
  vcs('git',['-C',cwd,'-c','user.name=A60 synthetic','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-qm','A60 isolated test root']);
  state.cwd=cwd;
  const canary=join(cwd,canaryName);
  assert(!existsSync(canary));
  result.fixture={cwd,model,engine:'codex',canary};
  env.ENABLE_TOOL_SEARCH = 'false';
  phase = 'native packaged startup';
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(result.port),'127.0.0.1',()=>resolve(undefined)); });
  app = await openElectron({ executable, userData, env, inspectMain: true, startupMainHook: async info => {
    Object.assign(hookResult,await redirectHome({ ...info,home }));
    assert.equal(hookResult.workerInspectorFlagRemoved,true);
  } });
  result.pid = app.processId;
  const appIdentity = await app.mainEvaluate(`(() => {
    const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    return [E.app.isPackaged,E.app.getPath('userData'),E.app.getPath('home'),process.env.HOME,process.execPath,process.pid];
  })()`);
  assert.deepEqual(appIdentity, [true, userData, home, home, executable, app.processId]);
  result.identity = appIdentity;
  await app.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await app.invoke('agents.refreshTools');
  const claudeExecutable = process.env.M14_SMOKE_CLAUDE;
  if (scenario.kind==='claude') {
    assert(claudeExecutable,'Explicit native Claude path required');
    assert.match(claudeExecutable,/\/versions\/2\.1\.326$/);
    const custom = await app.invoke('agents.customToolPath', 'claude', claudeExecutable);
    assert(custom.tool?.installed && custom.tool.version === '2.1.326');
    assert.equal(custom.tool.customPath, claudeExecutable);
    result.explicitClaude = {version: custom.tool.version, path: claudeExecutable};
  }
  const tools = await app.invoke('agents.tools');
  result.nativeTools = tools.filter(t => ['codex', 'claude'].includes(t.kind) && t.installed)
    .map(t => ({ kind: t.kind, version: t.version }));
  const models = [scenario.model];
  const provider = await app.invoke('agents.saveProvider', { name: 'Synthetic loopback fixture', preset: 'magpie',
    endpoints: { responses: 'http://127.0.0.1:3425/v1', anthropic: 'http://127.0.0.1:3425/' },
    models: models.map(id => ({ id, name: id })) });
  const profiles = {};
  for (const kind of [scenario.kind]) {
    const tool = tools.find(t => t.kind === kind && t.installed);
    assert(tool, kind + ' CLI installed');
    profiles[kind] = await app.invoke('agents.save', { name: 'Fixture ' + kind, toolId: tool.id, source: 'provider',
      providerId: provider.id, models, defaultModel:scenario.model, isDefault:true });
  }
  profileIds = Object.fromEntries(Object.entries(profiles).map(([kind, profile]) => [kind, profile.id]));
  phase = 'fixture project and parent creation';
  const project = await app.invoke('projects.create', { name:'M14 A60 limit isolated', aliases: [], description: '', rulesPath: null },
    [{ label: 'work', path: cwd }]);
  const title='A60 isolated native request Stop';
  const task = await app.invoke('agentTasks.create', { projectId: project.id, dirId: project.dirs[0].id, cwd,
    title, profileId:profileIds[scenario.kind],model:scenario.model,tier:'ask' });
  await app.evaluate("localStorage.setItem('willyou-m14-agent-workspace','true');location.reload();true");
  const row = `[data-testid="sidebar-agent-task"][data-task-id="${task.taskId}"]`;
  await app.waitFor(`Boolean(${selectorExpr(row)})`, 20000, { navigation: true });
  await click(row);
  phase='warm up one exact isolated Codex run';
  await send(warmInput,title);
  const warmState=await until(async()=>{
    const snap=await snapshot(task.taskId),first=snap.turns.at(-1);
    return first?.status==='completed'&&!snap.run?.busy&&answerPresent(snap,warmInput+'_DONE')&&{turn:first,run:snap.run};
  },'first normal response from actual native Codex');
  result.warm=warmState;
  const completedControl=await readExactTool(task.taskId,await snapshot(task.taskId),warmState.turn.turn_id,
    item=>typeof item.payload.command==='string'&&item.payload.command.trim().split(/\s+/).at(-1)?.replace(/['"]/g,'')==='pwd');
  assert(completedControl);
  assert.equal(completedControl.terminal,'completed');
  assert.equal(JSON.parse(completedControl.body).status,'completed');
  assert(JSON.parse(completedControl.body).output.includes(state.cwd));
  result.completedToolControl={before:completedControl};
  result.nativeObserver=await app.mainEvaluate(`(() => {
    const load=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json'),E=load('electron');
    if (process.pid!==${app.processId}||!E.app.isPackaged||process.execPath!==${JSON.stringify(executable)}||
        E.app.getPath('home')!==${JSON.stringify(home)}||E.app.getPath('userData')!==${JSON.stringify(userData)})
      throw Error('Wrong own App for passive native approval observation');
    const matches=process._getActiveHandles().filter(child=>child.constructor?.name==='ChildProcess'&&
      child.exitCode===null&&Array.isArray(child.spawnargs)&&child.spawnargs[1]==='app-server'&&child.stdout);
    if(matches.length!==1)throw Error('Expected one exact original native Codex channel');
    const child=matches[0],rows=[];
    if(globalThis.__m14A60ApprovalTap)throw Error('Only one approval tap');
    const dispose=(${monitorNativeApprovalLines.toString()})(child.stdout,rows);
    globalThis.__m14A60ApprovalTap={rows,dispose};
    return {pid:child.pid,stdoutDataListeners:child.stdout.listenerCount('data')};
  })()`);
  phase='original Codex command reaches real native pending approval';
  await send(exerciseInput,title);
  const before=await until(async()=>{
    const snap=await snapshot(task.taskId),pending=snap.requests.find(row=>row.class==='native'&&row.kind==='command_approval');
    const turn=snap.turns.findLast(row=>row.source_kind==='user');
    if(!pending||turn?.status!=='started'||!snap.run?.busy)return false;
    const records=await app.mainEvaluate('globalThis.__m14A60ApprovalTap?.rows ?? []');
    const native=records.find(row=>row.method==='item/commandExecution/requestApproval'&&String(pending.origin.nativeRequest)===row.id);
    return native&&{turn,pending,run:snap.run,seq:snap.seq,native,requestCount:snap.requests.length};
  },'real native command approval is present while original turn is busy');
  assert.equal(before.requestCount,1);
  assert.notEqual(before.turn.turn_id,warmState.turn.turn_id);
  assert.equal(before.pending.origin.taskId,task.taskId);
  assert.equal(before.pending.origin.turnId,before.turn.turn_id);
  assert.equal(before.pending.origin.runId,before.turn.run_id);
  assert.equal(before.pending.origin.generation,before.run.generation);
  assert.equal(before.pending.payload.method,'item/commandExecution/requestApproval');
  assert.equal(before.native.turnId,before.turn.native_turn_id);
  assert.match(JSON.stringify(before.pending.payload),new RegExp(canaryName.replaceAll('.','\\.')));
  assert(!existsSync(canary));
  await app.waitFor("Boolean(document.querySelector('.agent-request .agent-stop-run'))",6000);
  const options=await app.evaluate("[...document.querySelectorAll('.agent-request-options button:not(:disabled)')].map(button=>button.getAttribute('aria-label'))");
  const decision=replayDecision(options,before.native.availableDecisions);
  result.original={...before,options,replayedDecision:decision};
  const itemForCanary=item=>typeof item.payload.command==='string'&&item.payload.command.includes(canaryName);
  const foregroundBefore=await readExactTool(task.taskId,await snapshot(task.taskId),before.turn.turn_id,itemForCanary);
  assert(foregroundBefore && foregroundBefore.terminal===null);
  result.foregroundOutcome={before:foregroundBefore};
  await app.screenshot(join(out,'01-actual-native-command-approval-pending.png'));
  phase='click true Stop without approving and observe original retirement';
  await click('.agent-request .agent-stop-run','停止');
  const stopped=await until(async()=>{
    const snap=await snapshot(task.taskId);
    const old=snap.turns.find(row=>row.turn_id===before.turn.turn_id);
    const records=await app.mainEvaluate('globalThis.__m14A60ApprovalTap?.rows ?? []');
    const native=records.find(row=>row.method==='turn/completed'&&row.turnId===before.native.turnId);
    if(!old||old.status!=='interrupted'||snap.run?.busy||snap.requests.length||!native)return false;
    return {turn:old,status:snap.status,run:snap.run,seq:snap.seq,native,requests:snap.requests};
  },'same original native turn interrupted and approval no longer pending');
  result.stopped=stopped;
  assert.equal(stopped.status,'stopped');
  assert.equal(stopped.native.threadId,before.native.threadId);
  assert.equal(stopped.native.status,'interrupted');
  const retirement=(await app.invoke('agentTasks.events',task.taskId,before.seq)).filter(row=>
    row.type==='request.retired'&&row.payload?.requestId===before.pending.requestId);
  assert.equal(retirement.length,1);
  assert.equal(retirement[0].payload.reason,'user-stop');
  result.retirement=retirement[0];
  await app.waitFor("!document.querySelector('.agent-request')&&document.querySelector('.agent-task-view')?.innerText.includes('已停止')",6000);
  assert(!existsSync(canary));
  phase='read original tool body and verify actual stopped work row';
  const foregroundAfter=await readExactTool(task.taskId,await snapshot(task.taskId),before.turn.turn_id,
    item=>item.itemId===foregroundBefore.itemId);
  result.foregroundOutcome.after=foregroundAfter;
  const visibleRow=`(() => {
    const marker=${JSON.stringify(canaryName)};
    const summaries=[...document.querySelectorAll('.agent-task-view .agent-work-row > summary')]
      .filter(node=>node.getBoundingClientRect().width>0 && node.innerText.includes(marker));
    const group=summaries[0]?.closest('.agent-work');
    return {heading:group?.querySelector('.agent-work-head')?.innerText??'',
      heads:[...document.querySelectorAll('.agent-task-view .agent-work-head')]
        .map(node=>({label:node.innerText,expanded:node.getAttribute('aria-expanded')})),
      rows:summaries.map(node=>({label:node.innerText,unconfirmed:node.parentElement.classList.contains('unconfirmed'),
        running:node.parentElement.classList.contains('running')}))};
  })()`;
  const present=await app.evaluate(visibleRow);
  if(!present.rows.length&&present.heads.some(row=>/你在.*秒后停止了/.test(row.label)&&row.expanded==='false'))
    await click('.agent-task-view .agent-work-head[aria-expanded="false"]','停止了');
  result.foregroundOutcome.ui=await until(async()=>{
    const value=await app.evaluate(visibleRow);
    return value.rows.length&&value;
  },'exact stopped command present in the actual visible work fold',8000);
  await app.screenshot(join(out,'02-original-request-retired-after-real-stop.png'));
  assertRetainedStoppedTool(foregroundBefore,foregroundAfter);
  assertStoppedToolUi(result.foregroundOutcome.ui,canaryName);
  const stale=async stage=>{
    const at=Date.now();
    try{
      await app.invoke('agentTasks.respond',task.taskId,before.pending.requestId,before.pending.revision,decision);
    }catch(error){
      assert.match(String(error),/请求已结束/);
      assert(!existsSync(canary));
      return {stage,at,actualError:String(error),requestId:before.pending.requestId,revision:before.pending.revision,decision};
    }
    assert.fail('Original request was accepted after real UI Stop');
  };
  phase='old renderer cannot replay its original valid command approval decision';
  result.staleBeforeHealthy=await stale('after Stop before any later user input');
  state.readyAfterStop=true;
  phase='actual next healthy user round neither repeats nor restores the old native request';
  await send(nextInput,title);
  const next=await until(async()=>{
    const snap=await snapshot(task.taskId),turn=snap.turns.findLast(row=>row.source_kind==='user');
    if(turn?.status!=='completed'||turn.turn_id===before.turn.turn_id||!turn.native_turn_id||snap.run?.busy||
       !answerPresent(snap,nextAnswer))return false;
    return {turn,status:snap.status,run:snap.run,requests:snap.requests,turns:snap.turns};
  },'new real native user turn completed normally');
  result.healthy=next;
  assert.notEqual(next.turn.native_turn_id,before.turn.native_turn_id);
  assert.notEqual(next.turn.client_input_id,before.turn.client_input_id);
  assert.equal(next.turns.length,3);
  assert.equal(next.turns.find(row=>row.turn_id===before.turn.turn_id).status,'interrupted');
  assert.deepEqual(next.requests,[]);
  result.staleAfterHealthy=await stale('after another actual completed native round');
  const finalSnapshot=await snapshot(task.taskId);
  result.foregroundOutcome.afterHealthy=await readExactTool(task.taskId,finalSnapshot,before.turn.turn_id,
    item=>item.itemId===foregroundBefore.itemId);
  result.completedToolControl.after=await readExactTool(task.taskId,finalSnapshot,warmState.turn.turn_id,
    item=>item.itemId===completedControl.itemId);
  assert.deepEqual(result.completedToolControl.after,completedControl);
  assert.deepEqual(result.foregroundOutcome.afterHealthy,foregroundAfter);
  assert.equal(result.requests.filter(row=>row.lane==='warm-native-control').length,1);
  assert.equal(result.requests.filter(row=>row.lane==='warm-control-result').length,1);
  assert(!existsSync(canary));
  assert.equal(result.requests.filter(row=>row.lane==='original-native-command').length,1);
  assert.equal(result.requests.filter(row=>row.lane==='healthy-after-stop').length,1);
  assert(!result.serverError);
  await app.screenshot(join(out,'03-next-original-task-healthy.png'));
  result.status='passed';
} catch (error) {
  result.phase = phase;
  result.error = String(error.stack ?? error);
  if (error.electronStartupLogs) result.startupError = error.electronStartupLogs;
  if (app) try {
    result.visible = await app.evaluate('document.body.innerText.slice(0,10000)');
    await app.screenshot(join(out,'99-failure.png'));
  } catch { /* app already gone */ }
} finally {
  if(app)try{
    result.nativeApprovalFrames=await app.mainEvaluate(`(() => {
      const tap=globalThis.__m14A60ApprovalTap;
      if(!tap)return [];
      tap.dispose();
      delete globalThis.__m14A60ApprovalTap;
      return tap.rows;
    })()`);
  }catch(error){result.tapRemoveError=String(error);}
  if (app) {
    if (result.status === 'failed') try {
      const active = (await app.invoke('agentTasks.list')).filter(task => !task.parentTaskId
        && ['working','waiting'].includes(task.status));
      result.stoppedBeforeQuit = [];
      for (const task of active) {
        await app.invoke('agentTasks.stop',task.taskId,true);
        result.stoppedBeforeQuit.push(task.taskId);
      }
      const cutoff = Date.now()+6000;
      while (active.length && Date.now()<cutoff) {
        const current = await Promise.all(active.map(task=>snapshot(task.taskId)));
        if (current.every(task=>!task.run?.busy)) break;
        await pause(100);
      }
    } catch (error) { result.cleanupError = String(error); }
    try {
      result.preQuit = {at:new Date().toISOString(),
        active:(await app.invoke('agentTasks.list')).filter(row=>['working','waiting'].includes(row.status))
          .map(({taskId,status})=>({taskId,status}))};
      result.quitPhase = join(out,'quit-phase.jsonl');
      await app.mainEvaluate(`(() => {
        const require=process.getBuiltinModule('module').createRequire(process.execPath);
        const {app,BrowserWindow,dialog}=require('electron'), fs=require('node:fs'), file=${JSON.stringify(result.quitPhase)};
        if(app.getPath('userData')!==${JSON.stringify(userData)}||process.pid!==${app.processId})throw Error('Wrong isolated App');
        const write=(event,data={})=>{try{fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),event,...data})+'\\n',{mode:0o600});}catch{}};
        const restore=[];
        for(const name of ['showMessageBoxSync','showMessageBox']){
          const original=dialog[name];
          const observer=function(...args){const options=args.at(-1);write('native-dialog',{kind:name,message:options?.message??null});
            return Reflect.apply(original,this,args);};
          dialog[name]=observer;
          if(dialog[name]===observer)restore.push(()=>{dialog[name]=original;});
        }
        const {ipcMain}=require('electron');
        const win=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.getURL().includes('/renderer/index.html'));
        const wc=win?.webContents;
        wc?.on('will-prevent-unload',()=>write('will-prevent-unload'));
        if(wc)try{
          const originalSend=wc.send;
          const observedSend=function(channel,...values){
            if(channel==='files:close-request'){
              const request=values[0]; write('real-file-close-request',{action:request?.action??null,id:request?.id??null,sender:wc.id});
            }
            return Reflect.apply(originalSend,this,[channel,...values]);
          };
          wc.send=observedSend;
          if(wc.send===observedSend)restore.push(()=>{wc.send=originalSend;});
          const channel='files.answerClose',original=ipcMain._invokeHandlers.get(channel);
          if(typeof original==='function'){
            const observed=async(event,reply,...rest)=>{
              if(event.sender===wc)write('real-file-close-answer',{id:reply?.id??null,ready:reply?.ready??null,sender:wc.id});
              try{
                const output=await original(event,reply,...rest);
                if(event.sender===wc)write('real-file-close-answer-accepted',{id:reply?.id??null});
                return output;
              }catch(error){
                if(event.sender===wc)write('real-file-close-answer-rejected',{id:reply?.id??null,error:String(error).slice(0,260)});
                throw error;
              }
            };
            ipcMain._invokeHandlers.set(channel,observed);
            restore.push(()=>{if(ipcMain._invokeHandlers.get(channel)===observed)ipcMain._invokeHandlers.set(channel,original);});
          }
          write('passive-file-close-observers',{sendHook:wc.send===observedSend,answerHook:typeof original==='function',sender:wc.id});
        }catch(error){write('passive-observer-unavailable',{error:String(error).slice(0,260)});}
        app.on('before-quit',event=>write('before-quit',{prevented:event.defaultPrevented}));
        app.once('will-quit',()=>{write('will-quit');for(const undo of restore)undo();});
        write('quit-request-armed');
        setTimeout(()=>{write('quit-called');app.quit();},50);
        return true;
      })()`);
    } catch (error) { result.quitRpcError=String(error); }
    try { result.exit=await app.waitForExit(22000); }
    catch (error) {
      result.exitError=String(error);
      result.duringQuit=await app.evaluate('document.body.innerText.slice(-7000)',2500).catch(()=>null);
      await app.screenshot(join(out,'98-quit-timeout.png')).catch(()=>{});
      try { result.forcedExit=await app.crash(); } catch(forcedError) { result.forceError=String(forcedError); }
    }
    result.rendererErrors=app.rendererErrors;
    writeFileSync(join(out,'app.log'),app.logs(),{mode:0o600});
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({caseId:result.caseId,scenarioId,status:result.status,pid:result.pid,port:result.port,
    phase:result.phase,exit:result.exit,path:join(out,'result.json')}));
}
if (result.status !== 'passed' || result.exit?.code !== 0 || result.exit?.signal || result.rendererErrors?.length
    || result.serverError) process.exitCode=1;
