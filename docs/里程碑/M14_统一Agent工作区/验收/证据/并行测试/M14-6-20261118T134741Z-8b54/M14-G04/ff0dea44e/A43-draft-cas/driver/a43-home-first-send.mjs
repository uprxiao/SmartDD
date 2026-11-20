import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { openElectron, pause } from './helpers/scripts/lib/electron-harness.mjs';
import { redirectHome } from './helpers/scripts/applications/fixtures/home-redirect-main.mjs';

const [output, expectedCommit, expectedHash, scenario] = process.argv.slice(2);
assert.match(output, /^\/private\/tmp\/willyou-m14-stage6\.[A-Za-z0-9]{6}\/g04\/attempt-\d{3}$/);
assert.match(expectedCommit, /^[0-9a-f]{40}$/);
assert.match(expectedHash, /^[0-9a-f]{64}$/);
for (const key of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','CODEX_API_KEY','OPENAI_API_KEY','DEEPSEEK_API_KEY']) {
  assert(!process.env[key], 'Fixture must not inherit external credential ' + key);
}
assert(['retry','create-retry','late-edit','late-switch'].includes(scenario), 'Unknown A43 home scenario');
const candidate = output.slice(0,output.indexOf('/g04/'));
const executable = join(candidate,'package/mac-arm64/WillYou.app/Contents/MacOS/WillYou');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(executable,realpathSync(executable));
assert.equal(sha(readFileSync(join(dirname(executable),'../Resources/app.asar'))),expectedHash);
mkdirSync(output);
copyFileSync(new URL(import.meta.url),join(output,'source-a43-home-first-send.mjs'));
const runtime = realpathSync(mkdtempSync(join(output, 'runtime-')));
const home = join(runtime, 'home');
const userData = join(runtime, 'data');
const projectPath = join(runtime,'project');
for (const path of [home,userData,projectPath]) mkdirSync(path);
const result={caseId:'M14-A43',scenario,commit:expectedCommit,asar:expectedHash,executable,actions:[],responses:[],findings:[],
  scope:'True packaged home UI and native local Codex. One precise original IPC receipt gated or lost after original acceptance.',
  status:'failed'};
const testText='A43_FIRST_REQUEST_'+scenario;
const latest='A43_LATE_EDIT_SHOULD_REMAIN';
const afterSwitch='A43_SWITCHED_OTHER_TASK_DRAFT';
const model='m14-fixture-a43-home';
const homeComposer='[data-testid="home-input"]';
const taskComposer='.agent-task-view textarea';
const chooseProject='[data-testid="home-project"]';
const launch='[data-testid="home-launch"]';
const electron="process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')";
let app, phase='start and verify isolated App';
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
async function replaceText(text, selector) {
  await click(selector);
  assert(await app.evaluate(`document.activeElement === ${query(selector)}`));
  for (const type of ['keyDown','keyUp']) {
    await app.cdp('Input.dispatchKeyEvent',{type,key:'a',code:'KeyA',modifiers:4,windowsVirtualKeyCode:65});
  }
  await app.cdp('Input.insertText',{text});
  await app.waitFor(`${query(selector)}?.value===${JSON.stringify(text)}`,10000);
  result.actions.push({type:'insertText',text});
}
async function waitUntil(read, accept, message, timeout=15000) {
  const deadline=Date.now()+timeout;
  while (Date.now()<deadline) {
    if (result.serverError) throw Error(result.serverError);
    const value=await read();
    if (accept(value)) return value;
    await pause(70);
  }
  throw Error('Timed out: '+message);
}
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://127.0.0.1:3425').pathname;
    if(path.endsWith('/models')){
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:model}]}));return;
    }
    assert(req.method==='POST'&&path.endsWith('/responses'));
    const chunks=[];
    for await(const chunk of req) chunks.push(chunk);
    const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(payload.model,model);
    assert(JSON.stringify(payload.input).includes(testText),'Unexpected native input in private A43 fixture');
    const id='r'+randomUUID();
    result.responses.push({at:new Date().toISOString(),id,model:payload.model,marker:testText});
    const item={id:'m'+randomUUID(),type:'message',role:'assistant',status:'completed',
      content:[{type:'output_text',text:'A43_ONCE_RESULT',annotations:[]}]};
    res.writeHead(200,{'content-type':'text/event-stream'});
    const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
    event('response.created',{response:{id,status:'in_progress',output:[]}});
    event('response.output_item.added',{output_index:0,item:{...item,status:'in_progress'}});
    event('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:'A43_ONCE_RESULT'});
    event('response.output_item.done',{output_index:0,item});
    event('response.completed',{response:{id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});
    res.end();
  }catch(error){
    result.serverError=String(error.stack??error);
    if(!res.headersSent)res.writeHead(500);
    res.end();
  }
});
const traceExpr = "globalThis.__m14A43Home?.rows ?? []";
const creationExpr = "globalThis.__m14A43Home?.creates ?? []";
const releaseExpr = "globalThis.__m14A43Home?.release() ?? false";
const restoreExpr=`(() => {
  const trace=globalThis.__m14A43Home;
  if(!trace)return {submits:[],creates:[]};
  trace.restore();
  delete globalThis.__m14A43Home;
  return {submits:trace.rows,creates:trace.creates};
})()`;
const matchingTasks=async()=>(await app.invoke('agentTasks.list')).filter(task=>task.title===testText);
const taskRow=id=>'[data-testid="sidebar-agent-task"][data-task-id="'+id+'"]';
const readEditor=selector=>app.evaluate(`${query(selector)}?.value`);
const exactTitle=title=>`document.querySelector('.agent-task-head h1')?.textContent===${JSON.stringify(title)}`;
async function waitHomeReady(project){
  await app.waitFor(`Boolean(${query(chooseProject)})`,10000);
  if((await app.evaluate(`${query(chooseProject)}?.innerText`))?.trim()!==project.name){
    await click(chooseProject);
    await click('[role="option"]',project.name);
  }
  await app.waitFor(`document.querySelector('[data-testid=home-cwd]')?.title===${JSON.stringify(projectPath)}
    && ${query(launch)}?.type==='submit' && !${query(launch)}?.disabled`,10000);
}
try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3425,'127.0.0.1',resolve);});
  app=await openElectron({executable,userData,env:{HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),TMPDIR:runtime},
    inspectMain:true,startupMainHook:info=>redirectHome({...info,home})});
  result.identity=await app.mainEvaluate(`(() => {const {app}=${electron};
    return [app.isPackaged,process.pid,process.execPath,app.getPath('home'),process.env.HOME,app.getPath('userData')];})()`);
  assert.deepEqual(result.identity,[true,app.processId,executable,home,home,userData]);
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  phase='seed project, profile and independent switching task';
  await app.invoke('agents.refreshTools');
  const tool=(await app.invoke('agents.tools')).find(t=>t.kind==='codex'&&t.installed);
  assert(tool);
  const provider=await app.invoke('agents.saveProvider',{name:'A43 native local',preset:'magpie',
    endpoints:{responses:'http://127.0.0.1:3425/v1',anthropic:'http://127.0.0.1:3425/'},models:[{id:model,name:model}]});
  const profile=await app.invoke('agents.save',{name:'A43 native local',toolId:tool.id,source:'provider',
    providerId:provider.id,models:[model],defaultModel:model,isDefault:true});
  const project=await app.invoke('projects.create',{name:'M14 A43 isolated home',aliases:[],description:'',rulesPath:null},
    [{label:'fixture',path:projectPath}]);
  let other;
  const otherTitle='A43 other independent task';
  if(scenario==='late-switch'){
    other=await app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,title:otherTitle,profileId:profile.id,tier:'ask',model});
  }
  await app.evaluate("localStorage.setItem('willyou-m14-agent-workspace','true');location.reload();true");
  await app.waitFor(`Boolean(${query(chooseProject)})`,20000,{navigation:true});
  await waitHomeReady(project);
  phase='install exact transport receipt observation';
  await app.mainEvaluate(`(() => {
    const E=${electron};
    if(E.app.getPath('userData')!==${JSON.stringify(userData)}||process.pid!==${app.processId}||globalThis.__m14A43Home)
      throw Error('Wrong private App');
    const handlers=E.ipcMain._invokeHandlers;
    const submitChannel='agentTasks.submit',originalSubmit=handlers.get(submitChannel);
    const createChannel='agentTasks.create',originalCreate=handlers.get(createChannel);
    if(typeof originalSubmit!=='function'||typeof originalCreate!=='function')throw Error('Missing an original production handler');
    const rows=[],creates=[];
    let releaseFirst,releaseCount=0;
    const hold=new Promise(resolve=>{releaseFirst=resolve;});
    const release=()=>{releaseCount++;releaseFirst();return true;};
    const marker=${JSON.stringify(testText)}, mode=${JSON.stringify(scenario)};
    handlers.set(createChannel,async function(event,...args){
      if(args[0]?.title!==marker)return originalCreate.call(this,event,...args);
      const row={requestedTaskId:args[0].clientTaskId??null,startedAt:Date.now()};
      creates.push(row);
      const first=creates.length===1;
      const value=await originalCreate.call(this,event,...args);
      row.receipt=value;
      row.committedAt=Date.now();
      if(first&&mode==='create-retry'){
        row.transportError=true;
        throw Error('A43_FIXTURE_CREATE_REPLY_LOST_AFTER_ORIGINAL_COMMIT');
      }
      row.deliveredAt=Date.now();
      return value;
    });
    handlers.set(submitChannel,async function(event,...args){
      if(args[1]?.text!==marker)return originalSubmit.call(this,event,...args);
      const row={taskId:args[0],clientInputId:args[1].clientInputId,startedAt:Date.now()};
      rows.push(row);
      const first=rows.length===1;
      const value=await originalSubmit.call(this,event,...args);
      row.receipt=value;row.acceptedAt=Date.now();
      if(first&&mode==='retry'){
        row.transportError=true;
        throw Error('A43_FIXTURE_REPLY_LOST_AFTER_ORIGINAL_ACCEPT');
      }
      if(first&&(mode==='late-edit'||mode==='late-switch'))await hold;
      row.deliveredAt=Date.now();row.releaseCount=releaseCount;
      return value;
    });
    globalThis.__m14A43Home={rows,creates,release,restore(){
      handlers.set(submitChannel,originalSubmit);
      handlers.set(createChannel,originalCreate);
      release();
    }};
    return true;
  })()`);
  phase='actual home interaction and first production acceptance';
  assert.equal((await matchingTasks()).length,0);
  await replaceText(testText,homeComposer);
  await click(launch);
  let first;
  if(scenario==='create-retry'){
    phase='first production create committed before losing only its reply';
    const creation=await waitUntil(()=>app.mainEvaluate(creationExpr),rows=>Boolean(rows[0]?.committedAt),'original create committed');
    const firstTaskId=creation[0].receipt.taskId;
    assert(firstTaskId && creation[0].transportError);
    await app.waitFor("document.querySelector('[data-testid=home-error]')?.textContent.includes('A43_FIXTURE_CREATE_REPLY_LOST_AFTER_ORIGINAL_COMMIT')",10000);
    assert.equal(await readEditor(homeComposer),testText);
    const alreadyStored=await matchingTasks();
    assert.deepEqual(alreadyStored.map(task=>task.taskId),[firstTaskId],
      'First drawer identifies one task through unchanged persisted production list before retry');
    const beforeRetry=await app.mainEvaluate(traceExpr);
    assert.equal(beforeRetry.length,0,'During the lost create acknowledgement no initial input was submitted');
    assert.equal(result.responses.length,0,'During the lost create acknowledgement no model request was made');
    result.preRetry={firstTaskId,firstCreate:creation[0],taskIds:alreadyStored.map(t=>t.taskId),
      submitCalls:beforeRetry.length,nativeRequests:result.responses.length};
    phase='real retry of lost create reply opens original task and submits once';
    await click(launch);
    first=await waitUntil(()=>app.mainEvaluate(traceExpr),rows=>Boolean(rows[0]?.acceptedAt),'first input accepted after create retry');
    await app.waitFor(exactTitle(testText),12000);
    const created=await matchingTasks();
    const allCreates=await app.mainEvaluate(creationExpr);
    const allSubmits=await app.mainEvaluate(traceExpr);
    const attemptTaskIds=allCreates.map(row=>row.receipt.taskId);
    if(created.length!==1||created[0]?.taskId!==firstTaskId||attemptTaskIds.some(id=>id!==firstTaskId)
      ||allSubmits.length!==1||allSubmits[0].taskId!==firstTaskId){
      result.findings.push({case:'lost create reply produced a different task or multiple inputs',
        originalTaskId:firstTaskId,actualTaskIds:created.map(task=>task.taskId),creates:allCreates,submits:allSubmits});
    }
    await app.screenshot(join(output,'a43-home-after-create-retry.png'));
  }else{
    first=await waitUntil(()=>app.mainEvaluate(traceExpr),rows=>Boolean(rows[0]?.acceptedAt),'original first input accepted');
  }
  assert(first[0].receipt.turnId);
  assert.equal(first[0].receipt.duplicate,false);
  if(scenario==='retry'){
    await app.waitFor("document.querySelector('[data-testid=home-error]')?.textContent.includes('A43_FIXTURE_REPLY_LOST_AFTER_ORIGINAL_ACCEPT')",10000);
    assert.equal(await readEditor(homeComposer),testText);
    await click(launch);
    phase='observe true retry and native single-message effect';
    await waitUntil(async()=>({
      rows:await app.mainEvaluate(traceExpr),
      navigated:await app.evaluate(exactTitle(testText)),
    }), value=>Boolean(value.rows[1]?.deliveredAt || value.navigated),'second real launch attempt or receipt recovery');
    const tasks=await matchingTasks();
    for(const task of tasks){
      await waitUntil(()=>app.invoke('agentTasks.snapshot',task.taskId),
        snap=>snap.status==='completed'&&snap.items.some(item=>item.type==='assistant_message'&&item.payload.text==='A43_ONCE_RESULT'),
        'matched task '+task.taskId+' completed original native message',25000);
    }
    const receipts=await app.mainEvaluate(traceExpr);
    if(tasks.length!==1||new Set(receipts.map(row=>row.taskId)).size!==1||new Set(receipts.map(row=>row.clientInputId)).size!==1||result.responses.length!==1)
      result.findings.push({case:'first send retry duplicate',matchedTasks:tasks.map(t=>t.taskId),receipts,nativeRequests:result.responses.length});
    await app.screenshot(join(output,'a43-home-after-retry.png'));
  }else if(scenario==='late-edit'){
    assert.equal(first[0].deliveredAt,undefined);
    await click(homeComposer);
    assert(await app.evaluate(`document.activeElement===${query(homeComposer)}`));
    await app.cdp('Input.insertText',{text:'\n'+latest});
    await app.waitFor(`${query(homeComposer)}?.value.includes(${JSON.stringify(latest)})`,10000);
    result.editorBeforeAck=await readEditor(homeComposer);
    assert(result.editorBeforeAck.includes(latest));
    result.actions.push({type:'insertTextWhileAckHeld',text:latest,editorValue:result.editorBeforeAck});
    await app.screenshot(join(output,'a43-home-new-text-before-ack.png'));
    await app.mainEvaluate(releaseExpr);
    await waitUntil(()=>app.mainEvaluate(traceExpr),rows=>Boolean(rows[0]?.deliveredAt),'deliver first native ACK');
    await app.waitFor(`(${exactTitle(testText)}) || (${query(launch)}?.type==='submit')`,12000);
    if (!(await app.evaluate(exactTitle(testText)))) {
      await click(taskRow(first[0].taskId));
      await app.waitFor(exactTitle(testText),10000);
    }
    await click('[data-testid=nav-home]');
    await waitHomeReady(project);
    const current=await readEditor(homeComposer);
    if(!current?.includes(latest))result.findings.push({case:'first send late ACK erased latest home text',expectedLatest:latest,editorBeforeAck:result.editorBeforeAck,observed:current});
    await app.screenshot(join(output,'a43-home-new-text-after-ack.png'));
  }else if(scenario==='late-switch'){
    assert.equal(first[0].deliveredAt,undefined);
    await click(taskRow(other.taskId));
    await app.waitFor(exactTitle(otherTitle),10000);
    await replaceText(afterSwitch,taskComposer);
    const otherStored=async()=>await app.invoke('agentTasks.draftBody',other.taskId,0);
    await waitUntil(otherStored,page=>JSON.parse(page.chunk)?.text===afterSwitch,'other draft durably stored');
    await app.mainEvaluate(releaseExpr);
    await waitUntil(()=>app.mainEvaluate(traceExpr),rows=>Boolean(rows[0]?.deliveredAt),'deliver old home launch ACK while another task was edited');
    await app.screenshot(join(output,'a43-other-task-after-ack.png'));
    if((await app.evaluate("document.querySelector('.agent-task-head h1')?.textContent"))!==otherTitle){
      result.navigatedAfterAck=true;
      await click(taskRow(other.taskId));
      await app.waitFor(exactTitle(otherTitle),10000);
    }
    const current=await readEditor(taskComposer);
    const durable=JSON.parse((await otherStored()).chunk)?.text;
    if(current!==afterSwitch||durable!==afterSwitch)result.findings.push({case:'first send late ACK overwrote another task draft',expected:afterSwitch,observed:current,durable});
  }
  const rows=await app.mainEvaluate(traceExpr);
  for(const id of new Set(rows.map(row=>row.taskId))){
    await waitUntil(()=>app.invoke('agentTasks.snapshot',id),snap=>snap.items.some(item=>item.type==='assistant_message'&&item.payload.text==='A43_ONCE_RESULT')&&snap.status==='completed',
      'native replies have completed',25000);
  }
  if(scenario==='create-retry' && result.responses.length!==1) {
    result.findings.push({case:'lost create reply repeated native inference',expected:1,observed:result.responses.length});
  }
  assert.deepEqual(app.rendererErrors,[]);
  result.status=result.findings.length?'failed-assertions':'passed-subset';
}catch(error){
  result.phase=phase;result.error=String(error.stack??error);
  if(error.electronStartupLogs)result.startupLogs=error.electronStartupLogs;
  if(app)try{
    result.visible=await app.evaluate('document.body.innerText.slice(0,8000)');
    await app.screenshot(join(output,'99-failure.png'));
  }catch { /* Bound target exited. */ }
}finally{
  if(app){
    try{
      const captured=await app.mainEvaluate(restoreExpr);
      result.ipc=captured.submits;
      result.creations=captured.creates;
    }catch(error){result.traceRestoreError=String(error);}
    try{
      await app.mainEvaluate(`(() => {
        const {app}=${electron};
        if(app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Wrong private App');
        setTimeout(()=>app.quit(),50);return true;
      })()`);
    }catch(error){result.quitError=String(error);}
    try{result.exit=await app.waitForExit(22000);}
    catch(error){result.exitError=String(error);try{result.forcedExit=await app.crash();}catch(ex){result.forceError=String(ex);}}
    result.rendererErrors=app.rendererErrors;
    writeFileSync(join(output,'app.log'),app.logs(),{mode:0o600});
  }
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({caseId:result.caseId,scenario,status:result.status,phase:result.phase,exit:result.exit,output}));
}
if(result.status!=='passed-subset'||result.exit?.code!==0||result.exit?.signal||result.rendererErrors.length)process.exitCode=1;
