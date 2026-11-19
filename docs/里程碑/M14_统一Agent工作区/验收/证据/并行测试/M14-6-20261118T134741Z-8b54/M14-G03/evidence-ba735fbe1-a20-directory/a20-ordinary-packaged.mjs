import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { openElectron, pause } from '../../prep-fef791bc6/electron-harness.mjs';
import { redirectHome } from '../../prep-fef791bc6/home-redirect-main.mjs';
import { childDone, createNativeDelegationFlow, firstPrompt } from './native-delegation-flow.mjs';

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
  GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',
  ENABLE_TOOL_SEARCH:'false',NO_PROXY:'127.0.0.1,localhost',HTTP_PROXY:'http://127.0.0.1:1',
  HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',
};
const dbPath=join(userData,'smartdd.db');
const oldName='A20 isolated listed Codex', renamed='A20 isolated renamed Codex';
const parentModel='a20-local-parent', childModel='a20-local-child';
const hookResult={};
const result={bootstrap:hookResult,sourceCommit,asar,executable,scope:'A20 package, actual settings rename, normal native MCP calls and same receipt',
  observations:[],requests:[],actions:[],status:'failed'};
const port=3425;
let flow,app;
function record(label,data={}) {
  const row={label,at:new Date().toISOString(),...data};
  result.observations.push(row);
  console.log(JSON.stringify(row));
}
function writeEvents(res, kind, model, answer, call) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, value) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
  if (kind === 'claude') {
    event('message_start', { message: { id: 'm' + randomUUID(), type: 'message', role: 'assistant', model,
      content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    event('content_block_start', { index: 0, content_block: call
      ? { type: 'tool_use', id: call.id, name: call.tool.name, input: {} }
      : { type: 'text', text: '' } });
    event('content_block_delta', { index: 0, delta: call
      ? { type: 'input_json_delta', partial_json: JSON.stringify(call.args) }
      : { type: 'text_delta', text: answer } });
    event('content_block_stop', { index: 0 });
    event('message_delta', { delta: { stop_reason: call ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 1 } });
    event('message_stop', {});
  } else {
    const id = 'r' + randomUUID();
    const item = call ? { id: 'fc' + randomUUID(), type: 'function_call', call_id: 'call' + randomUUID(),
      name: call.tool.name, ...(call.tool.namespace ? { namespace: call.tool.namespace } : {}),
      arguments: JSON.stringify(call.args), status: 'completed' }
      : { id: 'm' + randomUUID(), type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: answer, annotations: [] }] };
    event('response.created', { response: { id, status: 'in_progress', output: [] } });
    event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress' } });
    if (!call) event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: answer });
    event('response.output_item.done', { output_index: 0, item });
    event('response.completed', { response: { id, status: 'completed', output: [item],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
  }
  res.end();
}
function readSqlite(dbPath,sql,params=[]) {
  const source=[
    'import json,pathlib,sqlite3,sys',
    'c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro",uri=True)',
    'c.row_factory=sqlite3.Row',
    'print(json.dumps([dict(r) for r in c.execute(sys.argv[2],json.loads(sys.argv[3]))],ensure_ascii=False))',
  ].join('\n');
  return JSON.parse(execFileSync('python3',['-c',source,dbPath,sql,JSON.stringify(params)],{encoding:'utf8',timeout:10000}));
}
const snapshot = taskId => app.invoke('agentTasks.snapshot', taskId);
const relations = taskId => app.invoke('agentTasks.relations', taskId);
const answerPresent = (snap, answer) => snap.items.some(i => i.type === 'assistant_message' && i.payload.text?.includes(answer));
async function until(fn, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (result.serverError) throw Error(result.serverError);
    if (await fn()) return;
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

const server = createServer(async(req,res)=>{
  try {
    if(req.method==='GET'&&req.url?.endsWith('/models')){
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({data:[{id:parentModel},{id:childModel}]}));
      return;
    }
    const kind=req.url?.includes('messages')?'claude':req.url?.includes('responses')?'codex':null;
    if(req.method!=='POST'||!kind){res.statusCode=404;res.end();return;}
    const parts=[];
    for await(const part of req) parts.push(part);
    const payload=JSON.parse(Buffer.concat(parts).toString('utf8'));
    const row={at:Date.now(),kind,model:payload.model};
    result.requests.push(row);
    if(payload.model===childModel&&kind==='codex'){
      row.childText=true;
      writeEvents(res,kind,childModel,childDone);
      return;
    }
    assert.equal(kind,'claude');
    assert.equal(payload.model,parentModel);
    assert(flow,'parent flow must be initialized before real native input');
    const action=await flow.next({tools:payload.tools??[],messages:payload.messages??[]});
    if(res.destroyed)return;
    if(action.tool) {
      row.issuedTool=action.tool.name;
      row.toolUseId=action.id;
      writeEvents(res,kind,parentModel,null,action);
    }else writeEvents(res,kind,parentModel,action.answer);
  }catch(error){
    result.serverError=String(error.stack??error);
    if(!res.headersSent)res.writeHead(500);
    res.end();
  }
});
const selector={
  settings:'[data-testid="nav-settings"]',agents:'[data-testid="agents-settings"]',
  toggle:'[data-testid="agent-delegation-toggle"]',renameInput:'.m13-dialog [data-step="3"] label.m13-field input',
};
const taskRow=id=>'[data-testid="sidebar-agent-task"][data-task-id="'+id+'"]';
const targetRow=id=>'[data-testid="agents-settings"] [data-agent="'+id+'"]';
async function navigateTask(id,title) {
  if(await app.evaluate('Boolean(document.querySelector(".app.settings-mode"))')) {
    await click('[data-testid="nav-home"]');
    await app.waitFor('!document.querySelector(".app.settings-mode")',10000);
  }
  await app.waitFor('Boolean('+selectorExpr(taskRow(id))+')',20000,{navigation:true});
  await click(taskRow(id));
  await app.waitFor('document.querySelector(".agent-task-head h1")?.textContent==='+JSON.stringify(title),10000);
}
async function renameFromSettings(targetId) {
  const pick=targetRow(targetId);
  await click(selector.settings);
  await click('.settings-nav button.nav-row','智能体');
  await app.waitFor('Boolean('+selectorExpr(selector.agents)+')&&Boolean('+selectorExpr(pick)+')',20000);
  await click(pick+' [aria-label='+JSON.stringify(oldName+' 更多操作')+']');
  await click('[role="menuitem"]','编辑');
  await app.waitFor('document.querySelector(".m13-dialog h2")?.textContent==="编辑智能体" && '+selectorExpr(selector.renameInput)+'?.value==='+JSON.stringify(oldName),15000);
  await click(selector.renameInput);
  const key={modifiers:4,key:'a',code:'KeyA',windowsVirtualKeyCode:65,nativeVirtualKeyCode:0};
  await app.cdp('Input.dispatchKeyEvent',{type:'rawKeyDown',...key,commands:['SelectAll']});
  await app.cdp('Input.dispatchKeyEvent',{type:'keyUp',...key});
  await app.waitFor('(() => { const field='+selectorExpr(selector.renameInput)+'; return !!field && document.activeElement===field && field.selectionStart===0 && field.selectionEnd===field.value.length; })()',5000);
  await app.cdp('Input.insertText',{text:renamed});
  await app.waitFor(selectorExpr(selector.renameInput)+'?.value==='+JSON.stringify(renamed),5000);
  await click('.m13-dialog .m13-dialog-foot button','保存');
  await app.waitFor('!document.querySelector(".m13-dialog") && '+selectorExpr(pick)+'?.innerText.includes('+JSON.stringify(renamed)+')',12000);
}
function readRows(taskId,projectId) {
  return {
    delegation:readSqlite(dbPath,"SELECT child_task_id,request_key,delivery_state, json_extract(target_json,'$.profile.revision') AS revision FROM agent_delegations WHERE parent_task_id=? ORDER BY rowid",[taskId]),
    projectTasks:readSqlite(dbPath,'SELECT t.id AS task_id,a.parent_task_id,t.title,t.dir_id,t.cwd FROM tasks t JOIN agent_tasks a ON a.task_id=t.id WHERE t.project_id=? ORDER BY a.rowid',[projectId]),
  };
}
let phase='normal test fixture setup';
try {
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
  const tools = await app.invoke('agents.tools');
  result.nativeTools = tools.filter(t => ['codex', 'claude'].includes(t.kind) && t.installed)
    .map(t => ({ kind: t.kind, version: t.version }));
  assert.equal(tools.find(item=>item.kind==='claude'&&item.installed)?.version,'2.1.326');
  assert.equal(tools.find(item=>item.kind==='codex'&&item.installed)?.version,'0.169.0');
  const provider=await app.invoke('agents.saveProvider',{name:'A20 local-only fixture model',preset:'magpie',
    endpoints:{responses:'http://127.0.0.1:3425/v1',anthropic:'http://127.0.0.1:3425/'},
    models:[parentModel,childModel].map(id=>({id,name:id}))});
  const parentConfig=await app.invoke('agents.save',{name:'A20 isolated Claude parent',
    toolId:tools.find(t=>t.kind==='claude'&&t.installed).id,source:'provider',providerId:provider.id,
    models:[parentModel],defaultModel:parentModel,isDefault:true});
  const childConfig=await app.invoke('agents.save',{name:oldName,
    toolId:tools.find(t=>t.kind==='codex'&&t.installed).id,source:'provider',providerId:provider.id,
    models:[childModel],defaultModel:childModel});
  const project=await app.invoke('projects.create',{name:'A20 isolated ordinary project',aliases:[],description:'',rulesPath:null},[{label:'registered-ordinary',path:cwd}]);
  const title='A20 ordinary parent after directory change';
  const task=await app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,cwd,title,
    profileId:parentConfig.id,model:parentModel,tier:'ask'});
  result.parentTaskId=task.taskId;
  assert.equal((await snapshot(task.taskId)).cwd,cwd);
  flow=createNativeDelegationFlow({targetId:childConfig.id,oldName,newName:renamed,childModel});
  result.flow={calls:flow.calls,observed:flow.observed};
  await click(selector.settings);
  if(!await app.evaluate('Boolean(document.querySelector("[data-testid=m14-toggle]"))')){
    await click('.settings-nav button.nav-row','常规');
  }
  const feature='[data-testid=m14-toggle]';
  await app.waitFor('Boolean('+selectorExpr(feature)+')',15000);
  if(!await app.evaluate(selectorExpr(feature)+'?.innerText.includes("已开启")')) await click(feature);
  await app.waitFor(selectorExpr(feature)+'?.innerText.includes("已开启")',12000);
  await navigateTask(task.taskId,title);
  await click(selector.toggle);
  await app.waitFor(selectorExpr(selector.toggle)+'?.getAttribute("aria-pressed")==="true"',10000);

  phase='initial actual native directory query';
  await click('.agent-task-view textarea');
  await app.cdp('Input.insertText',{text:firstPrompt+' Find the agreed target by querying the real native tool, then wait for the test setting change.'});
  await click('.agent-task-view button[type="submit"]');
  await until(()=>!!flow.observed.original,'first genuine wy_targets matching receipt');
  const before=readRows(task.taskId,project.id);
  assert.equal(before.projectTasks.length,1);
  assert.deepEqual(before.delegation,[]);
  const originalParent=(await snapshot(task.taskId)).run?.runId;
  assert(originalParent);
  assert((await snapshot(task.taskId)).run?.busy);
  result.originalRunId=originalParent;
  record('real native directory result captured without child creation');

  phase='settings rename only the existing target';
  const configsBefore=await app.invoke('agents.list');
  const initialTarget=configsBefore.find(item=>item.id===childConfig.id);
  assert.equal(initialTarget.name,oldName);
  await renameFromSettings(childConfig.id);
  const listedAfter=await app.invoke('agents.list');
  const currentTarget=listedAfter.find(item=>item.id===childConfig.id);
  const actualChanges=Object.keys(initialTarget).filter(key=>JSON.stringify(initialTarget[key])!==JSON.stringify(currentTarget[key]));
  assert.deepEqual(actualChanges,['name']);
  assert.equal(currentTarget.name,renamed);
  assert.deepEqual(listedAfter.find(item=>item.id===parentConfig.id),configsBefore.find(item=>item.id===parentConfig.id));
  result.settingsChange={actualChanges,originalName:oldName,currentName:renamed,profileId:childConfig.id};
  await app.screenshot(join(out,'10-a20-real-settings-rename.png'));
  await navigateTask(task.taskId,title);
  assert.equal((await snapshot(task.taskId)).run?.runId,originalParent);
  flow.release('renamed');

  phase='old revision normal delegation rejected without new task';
  await until(()=>!!flow.observed.staleRejected,'exact old native wy_delegate call rejected');
  const stale=readRows(task.taskId,project.id);
  assert.deepEqual(stale,before,'stale native call must leave no delegation or new project task');
  assert.equal((await relations(task.taskId)).childrenTotal,0);
  result.afterStale=stale;
  await app.screenshot(join(out,'20-a20-stale-revision-no-child.png'));
  record('old directory revision rejected without creating a child');
  flow.release('rejectionSeen');

  phase='new directory authority and repeat original accepted key';
  await until(()=>!!flow.observed.duplicated,'one refreshed native delegation and its exact repeat receipt');
  const queued=readRows(task.taskId,project.id);
  const requested=flow.calls.filter(r=>r.tool==='wy_delegate');
  assert.equal(requested.length,3);
  for(const evidence of requested)assert.equal(evidence.args.profileId,childConfig.id);
  assert.notEqual(requested[0].args.requestKey,requested[1].args.requestKey);
  assert.equal(requested[1].args.requestKey,requested[2].args.requestKey);
  const intentOnly=({requestKey,profileRevision,...others})=>others;
  assert.deepEqual(intentOnly(requested[0].args),intentOnly(requested[1].args));
  assert.equal(requested[0].args.profileRevision,flow.observed.original.target.revision);
  assert.equal(requested[1].args.profileRevision,flow.observed.refreshed.target.revision);
  assert.equal(requested[2].args.profileRevision,flow.observed.original.target.revision);
  assert.equal(queued.delegation.length,1);
  const [one]=queued.delegation;
  assert.equal(one.child_task_id,flow.observed.accepted.value.childTaskId);
  assert.equal(one.revision,flow.observed.refreshed.target.revision);
  assert.equal(one.request_key,requested[1].args.requestKey);
  assert.equal(one.delivery_state,'queued');
  assert.equal(queued.projectTasks.length,2);
  assert.equal((await relations(task.taskId)).childrenTotal,1);
  assert.equal((await snapshot(task.taskId)).run?.runId,originalParent);
  result.acceptedExactlyOne=queued;
  await app.screenshot(join(out,'30-a20-one-child-after-native-replay.png'));
  record('one previously accepted request key returned exactly the same native receipt');
  flow.release('duplicateSeen');

  phase='let the same accepted native child finish';
  const childTaskId=one.child_task_id;
  await until(async()=>{
    const state=await relations(task.taskId);
    return state.childrenTotal===1&&state.children[0]?.state==='delivered'&&
      answerPresent(await snapshot(childTaskId),childDone)&&!(await snapshot(task.taskId)).run?.busy;
  },'ordinary child actually ran once and real native text arrived',45000);
  const final=readRows(task.taskId,project.id);
  assert.equal(final.delegation.length,1);
  assert.equal(final.projectTasks.length,2);
  assert.equal(result.requests.filter(row=>row.childText).length,1);
  result.final=final;
  record('ordinary shared child completes through its real Codex native turn');
  assert.deepEqual(app.rendererErrors, []);
  result.status = 'passed';
} catch (error) {
  result.phase = phase;
  result.error = String(error.stack ?? error);
  if (error.electronStartupLogs) result.startupError = error.electronStartupLogs;
  if (app) try {
    result.visible = await app.evaluate('document.body.innerText.slice(0,12000)');
    await app.screenshot(join(out, '99-failure.png'));
  } catch { /* target already exited */ }
} finally {
  flow?.finishCleanup();
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
if (result.status !== 'passed' || result.exit?.code !== 0 || result.exit.signal || result.rendererErrors?.length) process.exitCode = 1;
