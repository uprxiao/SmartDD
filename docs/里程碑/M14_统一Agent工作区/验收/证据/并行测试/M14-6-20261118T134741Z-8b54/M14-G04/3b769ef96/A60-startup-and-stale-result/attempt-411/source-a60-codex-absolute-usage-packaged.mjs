import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash,randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openElectron, pause } from './helpers/scripts/lib/electron-harness.mjs';
import { redirectHome } from './helpers/scripts/applications/fixtures/home-redirect-main.mjs';
import { targetHit } from './a60-prep/pointer-guard.mjs';
import { withAbsoluteReset, monitorNativeRateLines, exactNativeReset } from './a60-prep/codex-absolute-reset.mjs';

const [out, scenarioId, expectedSha] = process.argv.slice(2);
const repo=process.cwd();
const {cases,warm,exercise,initialText,recovered,labels,latestUserText,isClaudeInTurnOutputResume,sendAssistant,limitHttp}=await import('./a60-prep/provider-contract.mjs');
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
const driverFiles=['a60-codex-absolute-usage-packaged.mjs','a60-prep/provider-contract.mjs','a60-prep/pointer-guard.mjs','a60-prep/codex-absolute-reset.mjs'];
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
const scenario=cases[scenarioId];
assert(scenario&&scenarioId==='codex-usage','This probe runs exact Codex usage only');
for (const key of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','CODEX_API_KEY','OPENAI_API_KEY','DEEPSEEK_API_KEY'])
  assert(!process.env[key],'Test instance cannot use external model credentials: '+key);
const hookResult={};
const result={caseId:'M14-A60',scope:'Exact packaged App, actual Claude/Codex, loopback provider responses only, no protocol substitution',bootstrap:hookResult,
  scenarioId,sourceCommit:process.env.M14_ACCEPTANCE_COMMIT,asar,executable,driverHashes,observations:[],actions:[],requests:[],revision:[],nativeReceipts:[],
  status:'failed',port:3425,nativeAccountEvents:[]};
let app,profileIds,aborting=false;
let requestedResetEpoch=null,explicitContinueAt=null;
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1:3425');
    if(url.pathname.endsWith('/models')){
      res.writeHead(200,{'content-type':'application/json'});
      return res.end(JSON.stringify({data:[{id:scenario.model}]}));
    }
    const kind=url.pathname.includes('/messages')?'claude':url.pathname.includes('/responses')?'codex':null;
    if(req.method!=='POST'||!kind){res.writeHead(404);return res.end();}
    const chunks=[];
    for await(const bytes of req)chunks.push(bytes);
    const body=JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(kind,scenario.kind);
    assert.equal(body.model,scenario.model);
    const key='magpie-'+kind;
    assert([req.headers.authorization,req.headers['x-api-key']].some(v=>v===key||v==='Bearer '+key),'Actual provider uses the private public fixture identity');
    const input=latestUserText(kind,body).trim();
    const nativeInTurn=kind==='claude'&&scenario.expected==='output'&&!explicitContinueAt
      &&result.requests.some(row=>row.lane==='exercise'&&row.reply?.kind==='assistant-output-limit')&&isClaudeInTurnOutputResume(body);
    const arrivedAt=Date.now(),lane=input.endsWith(warm)?'warm':input.endsWith(exercise)?'exercise'
      :input.endsWith('继续')?'continue':nativeInTurn?'native-output-resume':'unclassified';
    const observation={kind,model:body.model,lane,arrivedAt,path:url.pathname,bodyScope:'current-user-marker-only'};
    result.requests.push(observation);
    if(aborting)return res.end();
    if(lane==='warm')return sendAssistant(res,{kind,model:scenario.model,text:warm+'_DONE'});
    if(lane==='continue'){
      assert(explicitContinueAt&&arrivedAt>=explicitContinueAt,'A continue reached the actual provider before the UI action');
      observation.source='manual-continue';
      return sendAssistant(res,{kind,model:scenario.model,text:recovered});
    }
    assert(['exercise','native-output-resume'].includes(lane),'Unknown current user input; no fallback to historical markers');
    assert(!explicitContinueAt,'Old failing input must not be re-sent after manual continue');
    if(scenario.expected==='output'){
      observation.reply={kind:'assistant-output-limit',wire:kind==='claude'?'max_tokens':'response.incomplete:max_output_tokens'};
      return sendAssistant(res,{kind,model:scenario.model,text:initialText,outputLimited:true});
    }
    if(scenario.expected==='usage'&&requestedResetEpoch===null)requestedResetEpoch=Math.ceil(arrivedAt/1000)+22;
    const fault=withAbsoluteReset(limitHttp(kind,scenario.expected,requestedResetEpoch??0,arrivedAt),requestedResetEpoch);
    observation.reply=fault;
    res.writeHead(fault.status,fault.headers);
    return res.end(JSON.stringify(fault.body));
  }catch(error){
    result.serverError=String(error.stack??error);
    if(!res.headersSent)res.writeHead(500);
    res.end();
  }
});

const snapshot = taskId => app.invoke('agentTasks.snapshot', taskId);
const relations = taskId => app.invoke('agentTasks.relations', taskId);
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
  result.fixture={cwd,model:scenario.model,engine:scenario.kind,expected:scenario.expected};
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
  const title='A60 isolated '+scenarioId;
  const task = await app.invoke('agentTasks.create', { projectId: project.id, dirId: project.dirs[0].id, cwd,
    title, profileId:profileIds[scenario.kind],model:scenario.model,tier:'ask' });
  await app.evaluate("localStorage.setItem('willyou-m14-agent-workspace','true');location.reload();true");
  const row = `[data-testid="sidebar-agent-task"][data-task-id="${task.taskId}"]`;
  await app.waitFor(`Boolean(${selectorExpr(row)})`, 20000, { navigation: true });
  await click(row);
  phase='warm up the actual installed native executor';
  await send(warm,title);
  await until(async()=>{
    const row=await snapshot(task.taskId);
    return !row.run?.busy&&answerPresent(row,warm+'_DONE');
  },'normal native warmup completed with loopback provider');
  const warmState=await snapshot(task.taskId);
  assert.equal(warmState.selection.tier,'ask');
  result.warm={run:warmState.run,turnId:warmState.turns.at(-1)?.turn_id};
  result.nativeRateObserver=await app.mainEvaluate(`(() => {
    const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    if(process.pid!==${app.processId}||!E.app.isPackaged||E.app.getPath('userData')!==${JSON.stringify(userData)}||E.app.getPath('home')!==${JSON.stringify(home)})
      throw Error('Native rate observer requires this exact isolated App');
    const candidates=process._getActiveHandles().filter(child=>child.constructor?.name==='ChildProcess'
      &&child.exitCode===null&&Array.isArray(child.spawnargs)&&child.spawnargs[1]==='app-server'&&child.stdout);
    if(candidates.length!==1)return {armed:false,reason:'one exact active native channel was not found',candidatePids:candidates.map(c=>c.pid)};
    const child=candidates[0],events=[];
    if(globalThis.__m14A60NativeRate)throw Error('Native rate observer already armed');
    const dispose=(${monitorNativeRateLines.toString()})(child.stdout,events);
    globalThis.__m14A60NativeRate={events,dispose};
    return {armed:true,pid:child.pid,stdoutDataListeners:child.stdout.listenerCount('data')};
  })()`);
  phase='actual native executor receives local provider limit';
  await send(exercise,title);
  const terminal=await until(async()=>{
    const state=await snapshot(task.taskId),turn=state.turns.filter(turn=>turn.source_kind==='user').at(-1);
    if(!turn||turn.turn_id===result.warm.turnId||!turn.native_turn_id||!['completed','failed','interrupted','unknown'].includes(turn.status)||state.run?.busy)return false;
    return {at:Date.now(),turn,status:state.status,run:state.run,turns:state.turns.map(row=>({id:row.turn_id,status:row.status,source:row.source_kind})),
      pending:state.requests.length,items:state.items.filter(item=>item.turnId===turn.turn_id).map(({itemId,type,payload,terminalState})=>({itemId,type,payload,terminalState})),
      originalRequests:result.requests.filter(row=>row.lane==='exercise').length,
      nativeInTurnOutputResumes:result.requests.filter(row=>row.lane==='native-output-resume').length};
  },'actual terminal from native provider response (native retries are counted separately)',100000);
  result.terminal=terminal;
  assert(!result.serverError);
  assert(terminal.originalRequests>0);
  await app.screenshot(join(out,'01-actual-native-terminal.png'));
  result.terminalUi=await app.evaluate(`(() => ({
    cards:[...document.querySelectorAll('.agent-limit-card')].map(node=>({text:node.innerText,buttons:[...node.querySelectorAll('button')].map(button=>button.innerText.trim())})),
    taskText:document.querySelector('.agent-task-view')?.innerText.slice(-14000),
  }))()`);
  const limits=terminal.items.filter(item=>item.type==='error'&&item.payload?.limited);
  result.nativeProjection=limits.map(item=>({kind:item.payload.limited.kind,resetAt:item.payload.limited.resetAt??null,code:item.payload.code,itemId:item.itemId}));
  assert.equal(terminal.status,'limited','Native status was not projected to limited');
  const selected=limits.find(item=>item.payload.limited.kind===scenario.expected);
  assert(selected,'Actual engine did not expose the expected distinct limit class');
  assert.equal(terminal.pending,0);
  const header=labels[scenario.expected];
  await app.waitFor(`[...document.querySelectorAll('.agent-limit-card')].some(node=>node.querySelector('b')?.innerText===${JSON.stringify(header)})`,10000);
  const card=await app.evaluate(`(() => {
    const rows=[...document.querySelectorAll('.agent-limit-card')].filter(node=>node.querySelector('b')?.innerText===${JSON.stringify(header)});
    return rows.length===1?{text:rows[0].innerText,buttons:[...rows[0].querySelectorAll('button')].map(b=>b.innerText.trim())}:null;
  })()`);
  assert(card,'No corresponding actual panel');
  assert.deepEqual(card.buttons,['继续'],'The only card action is explicit manual continue');
  result.card=card;
  if(scenario.expected==='output'){
    assert(!selected.payload.limited.resetAt);
    assert(!card.text.includes('可在'));
    assert(await app.evaluate(`document.querySelector('.agent-task-view').innerText.includes(${JSON.stringify(initialText)})`));
  }
  const resetAt=selected.payload.limited.resetAt??null;
  if(resetAt)assert(card.text.includes(resetAt),'Available actual reset time appears in the card');
  phase='watch bounded terminal idle and optionally cross native reset timestamp';
  const stoppedRequests=result.requests.length;
  const bound=resetAt?Date.parse(resetAt):null;
  const cross=Number.isFinite(bound)&&bound>=Date.now()&&bound-Date.now()<28000;
  const providerResetEpoch=Number(requestedResetEpoch);
  assert(Number.isSafeInteger(providerResetEpoch)&&providerResetEpoch>0);
  const providerBoundary=providerResetEpoch*1000;
  assert(providerBoundary>Date.now()&&providerBoundary-Date.now()<28000,'Provider absolute reset must be near future');
  const watchUntil=Math.max(providerBoundary+2000,cross?bound+2000:0);
  result.resumeWatch={requestedProviderReset:requestedResetEpoch,displayed:resetAt,crossedActualDisplayedReset:false,
    crossedFixtureAbsoluteReset:false,startedAt:Date.now()};
  while(Date.now()<watchUntil){
    const current=await snapshot(task.taskId);
    assert.equal(result.requests.length,stoppedRequests,'Unexpected native request after actual terminal, before any user action');
    assert.deepEqual(current.turns.map(row=>({id:row.turn_id,status:row.status,source:row.source_kind})),terminal.turns,'Unexpected new host turn before manual action');
    await pause(100);
  }
  result.resumeWatch.finishedAt=Date.now();
  result.nativeAccountEvents=await app.mainEvaluate('globalThis.__m14A60NativeRate?.events ?? []');
  const typedReset=exactNativeReset(result.nativeAccountEvents,providerResetEpoch);
  result.nativeStructuredReset=typedReset;
  result.resumeWatch.crossedFixtureAbsoluteReset=result.resumeWatch.finishedAt>=providerBoundary+2000;
  assert(result.resumeWatch.crossedFixtureAbsoluteReset,'Quiet watch must cross planned absolute reset');
  result.resumeWatch.crossedActualDisplayedReset=Boolean(typedReset&&cross&&bound===providerBoundary&&result.resumeWatch.finishedAt>=bound+2000);
  if(!typedReset)result.partial='Confirmed quiet watch across fixture reset; native structured reset notification missing in passive stdout capture';
  else if(!result.resumeWatch.crossedActualDisplayedReset)
    result.partial='Actual native stdout published exact structured reset, but host/renderer did not expose it';
  phase='real Continue action submits one new turn and recovers';
  const resumeButton='.agent-limit-card button.agent-inline-action';
  await app.waitFor(`Boolean(${selectorExpr(resumeButton)})`,10000);
  await click(resumeButton,'继续','left',()=>{explicitContinueAt=Date.now();});
  const resumed=await until(async()=>{
    const value=await snapshot(task.taskId);
    const newTurn=value.turns.filter(turn=>turn.source_kind==='user').at(-1);
    if(!newTurn||newTurn.turn_id===terminal.turn.turn_id||newTurn.status!=='completed'||value.run?.busy||!answerPresent(value,recovered))return false;
    return {newTurn,status:value.status,run:value.run,pending:value.requests.length};
  },'true inline click recovers a new actual native turn');
  assert.equal(result.requests.filter(row=>row.lane==='continue').length,1);
  assert.notEqual(resumed.newTurn.client_input_id,terminal.turn.client_input_id);
  assert.equal(resumed.pending,0);
  result.handRecovery={clickedAt:explicitContinueAt,resumed};
  result.nativeAccountEvents=await app.mainEvaluate('globalThis.__m14A60NativeRate?.events ?? []');
  assert(Number(explicitContinueAt)>=providerBoundary+2000);
  await app.screenshot(join(out,'02-explicit-new-turn-recovered.png'));
  result.boundary={noOutsideCalls:true,onlySyntheticProviderResponse:true,noInjectedNativeEvent:true,nativeRetriesBeforeTerminal:terminal.originalRequests-1};
  result.status=result.partial?'partial':'passed';
} catch (error) {
  result.phase = phase;
  result.error = String(error.stack ?? error);
  if (error.electronStartupLogs) result.startupError = error.electronStartupLogs;
  if (app) try {
    result.visible = await app.evaluate('document.body.innerText.slice(0,10000)');
    await app.screenshot(join(out,'99-failure.png'));
  } catch { /* app already gone */ }
} finally {
  aborting=result.status!=='passed';
  if (app) {
    try {
      result.nativeAccountEvents=await app.mainEvaluate(`(() => {
        const fixture=globalThis.__m14A60NativeRate;
        if(!fixture)return [];
        fixture.dispose();
        delete globalThis.__m14A60NativeRate;
        return fixture.events;
      })()`);
    } catch(error) {
      result.nativeRateObserverCleanup=String(error);
    }
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
