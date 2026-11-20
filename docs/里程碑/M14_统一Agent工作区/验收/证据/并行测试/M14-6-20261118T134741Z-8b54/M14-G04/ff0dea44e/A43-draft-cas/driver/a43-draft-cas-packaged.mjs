import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openElectron, pause } from './helpers/scripts/lib/electron-harness.mjs';
import { redirectHome } from './helpers/scripts/applications/fixtures/home-redirect-main.mjs';

const [output, expectedCommit, expectedHash] = process.argv.slice(2);
assert.match(output, /^\/private\/tmp\/willyou-m14-stage6\.[A-Za-z0-9]{6}\/g04\/attempt-\d{3}$/);
assert.match(expectedCommit, /^[0-9a-f]{40}$/);
assert.match(expectedHash, /^[0-9a-f]{64}$/);
for (const key of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','CODEX_API_KEY','OPENAI_API_KEY','DEEPSEEK_API_KEY']) {
  assert(!process.env[key], 'Fixture must not inherit external credential ' + key);
}
const candidate = output.slice(0,output.indexOf('/g04/'));
const executable = join(candidate,'package/mac-arm64/WillYou.app/Contents/MacOS/WillYou');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(executable,realpathSync(executable));
assert.equal(sha(readFileSync(join(dirname(executable),'../Resources/app.asar'))),expectedHash);
mkdirSync(output);
copyFileSync(new URL(import.meta.url),join(output,'source-a43-draft-cas-packaged.mjs'));
const runtime = realpathSync(mkdtempSync(join(output, 'runtime-')));
const home = join(runtime, 'home');
const userData = join(runtime, 'data');
const projectPath = join(runtime,'project');
for (const path of [home,userData,projectPath]) mkdirSync(path);
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lJkAAAAASUVORK5CYII=';
const pngHash=sha(Buffer.from(png,'base64'));
const verifyEditorLease=process.env.M14_A43_REQUIRE_EDITOR_LEASE==='1';
const scope = 'Real packaged app. One authorized editor via CDP; competing writer via its unchanged production IPC and CAS. Two authorized production windows and first-send cases not covered.';
const result = {caseId:'M14-A43',commit:expectedCommit,asar:expectedHash,executable,scope,actions:[],scenarios:[],failures:[],
  driver:sha(readFileSync(new URL(import.meta.url))),verifyEditorLease,status:'failed'};
const composer = '.agent-task-view textarea';
const conflict = '.agent-draft-conflict';
let app, phase='start and verify private app';

const electron = "process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')";
const restoreLog = `(() => {
  const fixture=globalThis.__m14A43Trace;
  if (!fixture) return [];
  const values=fixture.restore();
  delete globalThis.__m14A43Trace;
  return values;
})()`;

const query = selector => `document.querySelector(${JSON.stringify(selector)})`;
const expressionFor = (selector, label) => label
  ? `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(label)})`
  : query(selector);
async function click(selector, label) {
  const element = expressionFor(selector,label);
  const locate = `(() => {
    const element=${element};
    if (!element || element.disabled) return null;
    element.scrollIntoView({block:'nearest',inline:'nearest'});
    const box=element.getBoundingClientRect();
    const x=box.x+box.width/2,y=box.y+box.height/2;
    return box.width>0 && box.height>0 && element.contains(document.elementFromPoint(x,y))?{x,y}:null;
  })()`;
  await app.waitFor(`Boolean(${locate})`,10000);
  const point=await app.evaluate(locate);
  assert(point, 'Lost expected control before input: ' + (label??selector));
  for (const type of ['mousePressed','mouseReleased']) {
    await app.cdp('Input.dispatchMouseEvent',{type, ...point,button:'left',clickCount:1});
  }
  result.actions.push({type:'click',selector,label,...point});
}
async function replaceText(text) {
  await click(composer);
  assert(await app.evaluate(`document.activeElement === ${query(composer)}`));
  await app.cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:4,windowsVirtualKeyCode:65,commands:['selectAll']});
  await app.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:4,windowsVirtualKeyCode:65});
  assert(await app.evaluate(`(() => {
    const field=${query(composer)};
    return field.selectionStart===0 && field.selectionEnd===field.value.length;
  })()`), 'Expected targeted Select All to select this editor only');
  await app.cdp('Input.insertText',{text});
  await app.waitFor(`${query(composer)}?.value===${JSON.stringify(text)}`,10000);
  result.actions.push({type:'insertText',text});
}
async function state(taskId) {
  const page = await app.invoke('agentTasks.draftBody',taskId,0);
  assert(page.done && Number.isSafeInteger(page.revision) && page.next===page.totalBytes, 'Small fixture should fit in one page');
  return {revision:page.revision,draft:JSON.parse(page.chunk)};
}
async function setCompeting(taskId, revision, text, attachments) {
  const receipt = await app.invoke('agentTasks.saveDraft',taskId,{text,attachments},revision);
  assert.deepEqual(receipt,{ok:true,revision:revision+1});
  assert.deepEqual(await state(taskId),{revision:revision+1,draft:{text,attachments}});
  return revision+1;
}
async function openTask(taskId, title, hydratedText) {
  const row = '[data-testid="sidebar-agent-task"][data-task-id="'+taskId+'"]';
  await click(row);
  await app.waitFor(`document.querySelector('.agent-task-head h1')?.textContent===${JSON.stringify(title)}
    && ${query(composer)}?.value===${JSON.stringify(hydratedText)}`,12000);
}
async function readEditor() {
  return app.evaluate(`(() => ({
    text:document.querySelector('.agent-task-view textarea')?.value,
    chips:[...document.querySelectorAll('.agent-chips .agent-chip-name')].map(v=>v.innerText),
    conflict:Boolean(document.querySelector('.agent-draft-conflict')),
    confirm:[...document.querySelectorAll('dialog,[role="dialog"]')].some(d=>d.innerText.includes('用另一份草稿'))
  }))()`);
}
function measureAttachment(attachment) {
  assert(attachment.storedPath.startsWith(join(userData,'agent-attachments')+'/'));
  return {path:attachment.storedPath,exists:existsSync(attachment.storedPath),
    hash:existsSync(attachment.storedPath)?sha(readFileSync(attachment.storedPath)):null};
}
async function openConfirm() {
  await click(conflict+' button','用另一份');
  await app.waitFor(`Boolean(${expressionFor('button','确认替换')})`,10000);
}
async function composeConflict(row, name) {
  await openTask(row.task.taskId,row.title,row.seed);
  const a = await readEditor();
  assert(a.chips.includes(row.local.name) && !a.conflict);
  let localAttachmentLease;
  if(verifyEditorLease){
    const deadline=Date.now()+6000;
    while(!localAttachmentLease&&Date.now()<deadline){
      localAttachmentLease=await app.mainEvaluate(`globalThis.__m14A43Trace.records.find(item=>
        item.channel==='agentTasks.holdDraftAttachments' && item.taskId===${JSON.stringify(row.task.taskId)}
        && item.paths.includes(${JSON.stringify(row.local.storedPath)}) && item.ok && item.endedAt)`);
      if(!localAttachmentLease)await pause(60);
    }
    assert(localAttachmentLease,'Owning live editor must actually acquire the original attachment lease');
  }
  const revision = await setCompeting(row.task.taskId, row.seedRevision,
    'A43_另一份旧 ' + name,[row.remote]);
  const localVersion='A43_现在输入的草稿 ' + name;
  await replaceText(localVersion);
  await app.waitFor(`Boolean(${query(conflict)})`,10000);
  const denied = await readEditor();
  assert.equal(denied.text,localVersion);
  assert(denied.chips.includes(row.local.name));
  const frozen = await state(row.task.taskId);
  assert.equal(frozen.revision,revision);
  assert(!frozen.draft.attachments.some(a=>a.id===row.local.id));
  const attachment = measureAttachment(row.local);
  if (attachment.hash !== pngHash) result.failures.push({case:'attachment-on-conflict',
    taskId:row.task.taskId,details:'Competing CAS removed the bytes of an attachment still in the local editor',attachment,editor:denied});
  return {revision,localVersion,attachment,denied,frozen,localAttachmentLease};
}
function checkLocalText(editor, text, localAttachment) {
  assert.equal(editor.text,text);
  assert(editor.chips.includes(localAttachment.name));
  assert(editor.conflict);
}
async function seed(profile, project, name) {
  const title='A43 '+name;
  const task=await app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,
    title,profileId:profile.id,model:'m14-fixture-a43',tier:'ask'});
  const local=await app.invoke('agentTasks.prepareAttachment',task.taskId,null,{name:'a43-local-'+name+'.png',mime:'image/png',dataBase64:png});
  const remote=await app.invoke('agentTasks.prepareAttachment',task.taskId,null,{name:'a43-remote-'+name+'.png',mime:'image/png',dataBase64:png});
  assert.equal(measureAttachment(local).hash,pngHash);
  assert.equal(measureAttachment(remote).hash,pngHash);
  const seed='A43_两端初始稿 '+name;
  const seedRevision=await setCompeting(task.taskId,0,seed,[local]);
  return {task,title,local,remote,seed,seedRevision};
}

try {
  app=await openElectron({executable,userData,env:{HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),TMPDIR:runtime},
    inspectMain:true,startupMainHook:info=>redirectHome({...info,home})});
  result.identity = await app.mainEvaluate(`(() => {
    const {app}=${electron};
    return [app.isPackaged,process.pid,process.execPath,app.getPath('home'),process.env.HOME,app.getPath('userData')];
  })()`);
  assert.deepEqual(result.identity,[true,app.processId,executable,home,home,userData]);
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  if (process.env.M14_A43_SECOND_WINDOW_NEGATIVE === '1') {
    phase='negative second window diagnostic';
    result.negativeWindow=await app.mainEvaluate(`(async () => {
      const {app,BrowserWindow}=${electron};
      const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');
      const {join}=require('node:path');
      const {pathToFileURL}=require('node:url');
      const {existsSync}=require('node:fs');
      if(!app.isPackaged||app.getPath('userData')!==${JSON.stringify(userData)}||process.pid!==${app.processId})
        throw Error('Wrong private App');
      const expectedURL=pathToFileURL(join(app.getAppPath(),'out/renderer/index.html')).href;
      const expectedPreload=join(app.getAppPath(),'out/preload/index.js');
      const primary=BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().split('#')[0]===expectedURL);
      if(primary.length!==1||!existsSync(expectedPreload)) throw Error('Original packaged main page/preload mismatch');
      const primaryPreload=primary[0].webContents.getLastWebPreferences?.()?.preload;
      if(primaryPreload!==undefined && primaryPreload!==expectedPreload) throw Error('Main preload path differs from packaged entry');
      const diagnostic=new BrowserWindow({show:false,focusable:false,skipTaskbar:true,webPreferences:{
        preload:expectedPreload,sandbox:false,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,
      }});
      try {
        await diagnostic.loadURL(expectedURL);
        const diagnosticResult=await diagnostic.webContents.executeJavaScript(
          "(async()=>{if(!window.electronAPI)return {preload:false};try{await window.electronAPI.invoke('agentTasks.list');return {preload:true,denied:false};}catch(e){return {preload:true,denied:/TERMINAL_SENDER_DENIED/.test(e.message)};}})()",false);
        return {primaryContents:primary[0].webContents.id,diagnosticContents:diagnostic.webContents.id,
          samePackagedURL:diagnostic.webContents.getURL()===expectedURL,
          configuredPreload:expectedPreload,primaryPreloadApi:primaryPreload??null,
          samePreload:(diagnostic.webContents.getLastWebPreferences?.()?.preload??expectedPreload)===expectedPreload,...diagnosticResult};
      }finally{diagnostic.destroy();}
    })()`);
    assert(result.negativeWindow.primaryContents!==result.negativeWindow.diagnosticContents);
    assert(result.negativeWindow.samePackagedURL && result.negativeWindow.samePreload
      && result.negativeWindow.preload && result.negativeWindow.denied,
      'Same-preload second window must not acquire original working window authority');
    assert(Array.isArray(await app.invoke('agentTasks.list')),'Primary window must remain trusted');
  }
  phase='prepare isolated A43 fixture';
  await app.invoke('agents.refreshTools');
  const tool=(await app.invoke('agents.tools')).find(t=>t.kind==='codex'&&t.installed);
  assert(tool);
  const provider=await app.invoke('agents.saveProvider',{name:'A43 local no-inference',preset:'magpie',
    endpoints:{responses:'http://127.0.0.1:3425/v1',anthropic:'http://127.0.0.1:3425/'},
    models:[{id:'m14-fixture-a43',name:'m14-fixture-a43'}]});
  const profile=await app.invoke('agents.save',{name:'A43 local no-inference',toolId:tool.id,source:'provider',
    providerId:provider.id,models:['m14-fixture-a43'],defaultModel:'m14-fixture-a43',isDefault:true});
  const project=await app.invoke('projects.create',{name:'M14 A43 isolated',aliases:[],description:'',rulesPath:null},
    [{label:'fixture',path:projectPath}]);
  const keep=await seed(profile,project,'keep');
  const adopt=await seed(profile,project,'adopt');
  await app.evaluate("localStorage.setItem('willyou-m14-agent-workspace','true');location.reload();true");
  await app.waitFor(`Boolean(${query('[data-testid="sidebar-agent-task"][data-task-id="'+keep.task.taskId+'"]')})`,20000,{navigation:true});

  // Observe calls only. Both writes still go through their real, scoped original IPC handlers.
  phase='arm original handler observation';
  await app.mainEvaluate(`(() => {
    const E=${electron};
    if(E.app.getPath('userData')!==${JSON.stringify(userData)}||process.pid!==${app.processId}||globalThis.__m14A43Trace)
      throw Error('Wrong private App');
    const ids=new Set(${JSON.stringify([keep.task.taskId,adopt.task.taskId])});
    const handlers=E.ipcMain._invokeHandlers, channels=['agentTasks.saveDraft','agentTasks.draftBody'];
    if(${verifyEditorLease})channels.push('agentTasks.holdDraftAttachments');
    const originals=channels.map(channel=>[channel,handlers.get(channel)]);
    if(originals.some(([,fn])=>typeof fn!=='function')) throw Error('Expected original handlers');
    const records=[];
    for (const [channel,original] of originals) handlers.set(channel,async function(event,...args) {
      if(!ids.has(args[0]))return original.call(this,event,...args);
      const row={channel,taskId:args[0],source:channel.endsWith('saveDraft')?args[1].text:'read',
        expectedRevision:args[2],startedAt:Date.now(),sender:event.sender.id};
      if(channel.endsWith('holdDraftAttachments')){
        row.editorId=args[1];row.paths=args[2];delete row.expectedRevision;
      }
      records.push(row);
      try {const value=await original.call(this,event,...args);row.ok=value?.ok??true;row.revision=value?.revision;return value;}
      catch(e){row.error=e.message;throw e;}
      finally{row.endedAt=Date.now();}
    });
    globalThis.__m14A43Trace={records,restore(){for(const [channel,original] of originals)handlers.set(channel,original);return records;}};
    return true;
  })()`);

  phase='same old revision, continue editing, choose keep current twice';
  const kept=await composeConflict(keep,'keep');
  const following='A43_冲突以后继续编辑';
  await replaceText(following);
  await pause(560); // Deliberately cross the production 400 ms draft debounce.
  checkLocalText(await readEditor(),following,keep.local);
  assert.deepEqual(await state(keep.task.taskId),kept.frozen);
  const advanced=await setCompeting(keep.task.taskId,kept.revision,'A43_另一份再次修改 keep',[keep.remote]);
  await click(conflict+' button','保留当前');
  const staleClickDeadline=Date.now()+10000;
  let staleKeep;
  while (!staleKeep && Date.now()<staleClickDeadline) {
    staleKeep=await app.mainEvaluate(`globalThis.__m14A43Trace.records.find(row=>row.channel==='agentTasks.saveDraft'
      && row.source===${JSON.stringify(following)} && row.expectedRevision===${kept.revision}
      && row.ok===false && row.revision===${advanced} && row.endedAt)`);
    if (!staleKeep) await pause(50);
  }
  assert(staleKeep, 'First Keep click must lose CAS against newer competing revision');
  await app.waitFor(`Boolean(${query(conflict)} && !(${expressionFor(conflict+' button','保留当前')})?.disabled)`,10000);
  checkLocalText(await readEditor(),following,keep.local);
  assert.equal((await state(keep.task.taskId)).revision,advanced);
  const keepRetryBytes=measureAttachment(keep.local);
  if(verifyEditorLease)assert.equal(keepRetryBytes.hash,pngHash);
  await click(conflict+' button','保留当前');
  await app.waitFor(`!${query(conflict)}`,10000);
  const saved=await state(keep.task.taskId);
  assert.equal(saved.revision,advanced+1);
  assert.equal(saved.draft.text,following);
  assert.equal(saved.draft.attachments[0].id,keep.local.id);
  const keepBytesAfter=measureAttachment(keep.local);
  if(verifyEditorLease)assert.equal(keepBytesAfter.hash,pngHash);
  result.scenarios.push({name:'keep',kept,staleKeep,keepRetryBytes,serverAfterKeep:saved,localBytes:keepBytesAfter});
  await app.screenshot(join(output,'01-keep.png'));

  phase='adopt other cancellation, competing write during confirmation, then successful retry';
  const pending=await composeConflict(adopt,'adopt');
  await openConfirm();
  await click('.m13-dialog button','取消');
  await app.waitFor(`!${expressionFor('button','确认替换')}`,10000);
  const afterCancel=await readEditor();
  const afterCancelBytes=measureAttachment(adopt.local);
  if(verifyEditorLease)assert.equal(afterCancelBytes.hash,pngHash);
  checkLocalText(afterCancel,pending.localVersion,adopt.local);
  assert.deepEqual(await state(adopt.task.taskId),pending.frozen);
  await openConfirm();
  const other='A43_确认窗口期间另一份已修改';
  const refreshed=await setCompeting(adopt.task.taskId,pending.revision,other,[adopt.remote]);
  await click('.m13-dialog button','确认替换');
  await app.waitFor(`!${expressionFor('button','确认替换')} && Boolean(${query(conflict)})`,10000);
  const afterStale=await readEditor();
  checkLocalText(afterStale,pending.localVersion,adopt.local);
  const afterStaleBytes=measureAttachment(adopt.local);
  if(verifyEditorLease)assert.equal(afterStaleBytes.hash,pngHash);
  result.scenarios.push({name:'adopt-stale',pending,afterCancel,afterCancelBytes,afterStale,refreshed,localBytes:afterStaleBytes});
  await app.screenshot(join(output,'02-adopt-stale.png'));
  await openConfirm();
  await click('.m13-dialog button','确认替换');
  await app.waitFor(`!${query(conflict)} && ${query(composer)}?.value===${JSON.stringify(other)}`,10000);
  const accepted=await readEditor();
  assert(accepted.chips.includes(adopt.remote.name) && !accepted.chips.includes(adopt.local.name));
  assert.equal(measureAttachment(adopt.remote).hash,pngHash);
  assert.equal((await state(adopt.task.taskId)).revision,refreshed);
  result.scenarios.push({name:'adopt-confirm',accepted,remoteBytes:measureAttachment(adopt.remote)});
  await app.screenshot(join(output,'03-adopt-confirmed.png'));
  result.ipc = await app.mainEvaluate(restoreLog);
  assert.equal(new Set(result.ipc.map(row=>row.sender)).size,1,'One authorized editor sender only');
  for (const entry of [keep,adopt]) {
    const sameOldRevision = result.ipc.filter(row=>row.channel==='agentTasks.saveDraft'&&row.taskId===entry.task.taskId&&row.expectedRevision===entry.seedRevision);
    assert.equal(sameOldRevision.length,2);
    assert.equal(sameOldRevision.filter(row=>row.ok).length,1);
    assert.equal(sameOldRevision.filter(row=>!row.ok).length,1);
  }
  assert.deepEqual(app.rendererErrors,[]);
  result.status=result.failures.length ? 'failed-assertions' : 'passed-subset';
} catch(error) {
  result.phase=phase;
  result.error=String(error.stack??error);
  if(error.electronStartupLogs)result.startupLogs=error.electronStartupLogs;
  if(app)try{
    result.visible=await app.evaluate('document.body.innerText.slice(0,8000)');
    await app.screenshot(join(output,'99-failure.png'));
  }catch{ /* Target already exited. */ }
} finally {
  if(app){
    if(!result.ipc)try{result.ipc=await app.mainEvaluate(restoreLog);}catch(error){result.traceRestoreError=String(error);}
    try {
      await app.mainEvaluate(`(() => {
        const {app}=${electron};
        if(app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Wrong private App');
        setTimeout(()=>app.quit(),50);
        return true;
      })()`);
    }catch(error){result.quitError=String(error);}
    try {result.exit=await app.waitForExit(20000);}
    catch(error){result.exitError=String(error);try{result.forcedExit=await app.crash();}catch(ex){result.forceError=String(ex);}}
    result.rendererErrors=app.rendererErrors;
    writeFileSync(join(output,'app.log'),app.logs(),{mode:0o600});
  }
  writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({caseId:result.caseId,status:result.status,phase:result.phase,
    exit:result.exit,result:join(output,'result.json')}));
}
if(result.status!=='passed-subset'||result.exit?.code!==0||result.exit?.signal||result.rendererErrors.length)process.exitCode=1;
