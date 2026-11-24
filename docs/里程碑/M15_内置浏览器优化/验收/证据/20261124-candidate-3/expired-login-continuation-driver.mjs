// Pre-development measurement against an unchanged, pinned packaged WillYou.
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {cp} from 'node:fs/promises';
import {dirname} from 'node:path';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { arch, cpus, loadavg, release } from 'node:os';
import { openElectron, pause } from 'file:///Users/liubu/hx/4.uprxiao/SmartDD/scripts/lib/electron-harness.mjs';
import { startReportFixture, fixtureLogin } from './report-fixture-a11.mjs';

const [bundleArg, pin, cliArg, mode = 'a11'] = process.argv.slice(2);
assert.match(pin ?? '', /^[a-f0-9]{64}$/);
assert(['a11','a13','a14-pending'].includes(mode), 'Run one isolated case group');
const bundle = await realpath(bundleArg);
const cli = await realpath(cliArg);
assert(bundle.startsWith('/private/tmp/willyou-') && bundle.endsWith('/WillYou.app'));
const executable = join(bundle, 'Contents/MacOS/WillYou');
const asar = join(bundle, 'Contents/Resources/app.asar');
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');
assert.equal(await digest(asar), pin);
const root = await mkdtemp('/private/tmp/willyou-m15-candidate-e2e-');
const userData = join(root, 'data'), home = join(root, 'home'), cliHome = join(root, 'cli-home'), cwd = join(root, 'project');
for (const path of [userData, home, cliHome, cwd]) await mkdir(path, { mode: 0o700 });
const clock = () => performance.timeOrigin + performance.now();
const report = {
  appSha256: pin, appExecutableSha256: await digest(executable), claudeSha256: await digest(cli), claudeBuild: cli.split('/').at(-1),
  root, mode, host: { arch: arch(), kernel: release(), cpus: cpus().length, initialLoad: loadavg() },
  driverSha256: await digest(new URL(import.meta.url)), fixtureSha256: await digest(new URL('./report-fixture-a11.mjs', import.meta.url)),
  samples: [], model: [], failures: [], startedAt: new Date().toISOString(),
};
const persist = () => writeFile(join(root, 'result.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log('M15_CANDIDATE_ROOT=' + root);
await persist();
const fixture = await startReportFixture();
const scenarios = new Map();
const key = 'm15-local-model-fixture';
const model = 'claude-sonnet-5-5';
let sequence = 0;
let preparedLinks = [];
let activeAgentCase;
let app;
let stage = 'setup';
const taskIds = [];

const mockModel = createServer(async (request, response) => {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      assert(size < 4_000_000);
      chunks.push(chunk);
    }
    const pathname = new URL(request.url, base).pathname;
    if (pathname.endsWith('/count_tokens')) {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"input_tokens":40}');
      return;
    }
    assert.equal(pathname, '/v1/messages');
    assert.equal(request.headers['x-api-key'], key);
    const params = JSON.parse(Buffer.concat(chunks).toString());
    const id = 'msg_m15_' + ++sequence;
    const message = {
      id, type: 'message', role: 'assistant', model: params.model, content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 40, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    };
    if (!params.stream) {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        ...message, content: [{ type: 'text', text: 'M15 本地基线' }], stop_reason: 'end_turn',
      }));
      return;
    }
    assert.equal(params.model, model);
    const text = JSON.stringify(params.messages);
    const sample = activeAgentCase;
    const operation = sample?.operation ?? 'open';
    const tool = (params.tools ?? []).find(item => item.name.endsWith('browser_' + (operation==='open'?'tab_open':operation) + '_v2'));
    let block = null;
    let answer = 'M15 测试已收到回执';
    if (text.includes('WY_M15_LINKS')) {
      answer = preparedLinks.map(name => `[M15 ${name}](${scenarios.get(name).url('open')})`).join('\n\n');
    } else if (sample && !sample.dispatchedAt && (sample.resume
      ? text.includes('WillYou 宿主已核验本人登录及原业务页') && text.includes(sample.checkpoint)
      : text.includes('WY_M15_AGENT_' + sample.name))) {
      assert(tool, 'Browser create tool missing. Available browser/search names: ' + (params.tools ?? []).map(item => item.name).filter(name => /browser|toolsearch/i.test(name)).join(','));
      sample.dispatchedAt = clock();
      block = { name: tool.name, input: sample.input };
    }
    report.model.push({ id, scenario:sample?.name, tool: block?.name ?? null, approvalFollowup: text.includes('宿主业务结果通知') });
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'request-id': 'req_' + sequence });
    const send = (type, fields = {}) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
    send('message_start', { message });
    send('content_block_start', { index: 0, content_block: block ? { type: 'tool_use', id: 'tool_' + sequence, name: block.name, input: {} } : { type: 'text', text: '' } });
    send('content_block_delta', { index: 0, delta: block ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: answer } });
    send('content_block_stop', { index: 0 });
    send('message_delta', { delta: { stop_reason: block ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } });
    send('message_stop');
    response.end();
  } catch (error) {
    report.failures.push({ stage: 'local-model', error: error.message });
    if (!response.headersSent) response.writeHead(500);
    response.end('{}');
  }
});
const listening = once(mockModel, 'listening');
mockModel.listen(0, '127.0.0.1');
await listening;
const base = 'http://127.0.0.1:' + mockModel.address().port;
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const wrapper = join(root, 'claude-fixture');
const cliEnv = {
  HOME: cliHome, CLAUDE_CONFIG_DIR: join(cliHome, 'config'), PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: root,
  SHELL: '/bin/zsh', LANG: 'en_US.UTF-8', NO_PROXY: '127.0.0.1,localhost', ANTHROPIC_BASE_URL: base, ANTHROPIC_API_KEY: key,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
};
await writeFile(wrapper, `#!/bin/sh\nexec /usr/bin/env -i ${Object.entries(cliEnv).map(([k,v]) => quote(k + '=' + v)).join(' ')} ${quote(cli)} "$@"\n`, { mode: 0o700 });
const js = (fn, ...args) => '(' + fn.toString() + ')(...' + JSON.stringify(args) + ')';
async function until(check, name, timeout = 18000) {
  const deadline = performance.now() + timeout;
  do {
    const value = await check();
    if (value) return value;
    await pause(20);
  } while (performance.now() < deadline);
  throw Error('Timeout waiting for ' + name);
}

const uiState = () => app.evaluate(`(() => {
  const w = document.querySelector('.bw-workspace');
  const address = w?.querySelector('input[aria-label="网页地址"]');
  const visible = Boolean(w?.isConnected && w.getBoundingClientRect().width > 0 && address?.getBoundingClientRect().width > 0);
  return { taskId: visible ? w.dataset.browserTask : null, address: visible ? address.value : null, loading: visible && !!w.querySelector('.bw-progress[role=status]') };
})()`);
async function click(selector, label = null) {
  const point = await until(()=>app.evaluate(js(function locate(query, text) {
    const candidates = [...document.querySelectorAll(query)].filter(node => {
      if (node.disabled || text !== null && node.textContent.trim() !== text) return false;
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (candidates.length !== 1) return null;
    const node = candidates[0];
    node.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    const rect = node.getBoundingClientRect();
    const x = Math.floor(rect.x + rect.width / 2), y = Math.floor(rect.y + rect.height / 2);
    return node.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
  }, selector, label)), 'actionable control '+selector, 6000);
  assert(point, 'Expected one visible clickable target ' + selector);
  await app.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  const releasedAt = clock();
  await app.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  return releasedAt;
}
const sidebar = id => `[data-testid="sidebar-agent-task"][data-task-id="${id}"]`;
const taskSnapshot = id => app.invoke('agentTasks.snapshot', id);
const browserSnapshot = id => app.invoke('browser.snapshot', { taskId: id });

async function switchTo(id) {
  await app.waitFor(js(query => !!document.querySelector(query), sidebar(id)), 16000, { navigation: true });
  await click(sidebar(id));
  await app.waitFor('!!document.querySelector(".agent-task-view textarea")', 10000);
}
async function send(text) {
  await click('.agent-task-view textarea');
  await app.cdp('Input.insertText', { text });
  assert.equal(await app.evaluate('document.querySelector(".agent-task-view textarea").value'), text);
  await app.waitFor('!!document.querySelector(".agent-task-view button[type=submit]:enabled")', 5000);
  return click('.agent-task-view button[type=submit]');
}
async function pendingBrowserWrite(taskId) {
  return until(async () => {
    const state = await taskSnapshot(taskId);
    return state.requests?.find(item => item.payload?.businessKind === 'browser_write' && item.status === 'pending');
  }, 'durable product browser approval', 28000);
}
async function approveBrowserWrite() {
  await app.waitFor('!!document.querySelector(".agent-request-options button")', 10000);
  const options = await app.evaluate('[...document.querySelectorAll(".agent-request-options button")].map(node => node.textContent.trim())');
  const allow = options.find(text => /批准|允许/.test(text));
  assert(allow);
  await click('.agent-request-options button', allow);
  await app.waitFor('!!document.querySelector(".agent-confirm-choice:enabled")', 6000);
  return click('.agent-confirm-choice');
}
async function modelIdle(taskId) {
  await until(async () => !(await taskSnapshot(taskId)).turns.some(turn => ['dispatching','started'].includes(turn.status)), 'fixture model to finish after result');
}
async function visible(id, url) {
  return until(async () => {
    const now = await uiState();
    return now.taskId === id && now.address === url ? { ...now, at: clock() } : null;
  }, 'the selected target in the actual right pane');
}
const browserTab=async(taskId,pageId)=>(await browserSnapshot(taskId)).tabs.find(tab=>tab.id===pageId);
const continuations=async taskId=>(await taskSnapshot(taskId)).turns
  .filter(row=>String(row.client_input_id??row.clientInputId??'').startsWith('browser-login-'));
const requestPanel='.agent-request[aria-label="待处理请求"]';
const loginRequest=async taskId=>(await taskSnapshot(taskId)).requests?.find(row=>row.payload?.businessKind==='browser_login');
const loginRequestMeta=row=>({requestId:row.requestId,revision:row.revision,status:row.status,phase:row.payload.phase,pageId:row.payload.review.pageId});
const oldPid=[];

async function launchBoundApp(){
  app=await openElectron({userData,executable,cwd:root,
    env:{HOME:home,SMARTDD_CLI_HOME:cliHome,PATH:dirname(process.execPath)+':/usr/bin:/bin'},inspectMain:true});
  const binding=await app.mainEvaluate(js(function verify(pid,expectedExecutable,data,expectedHome){
    const e=process.getBuiltinModule('module').createRequire(process.execPath)('electron');
    if(process.pid!==pid||process.execPath!==expectedExecutable||e.app.getPath('userData')!==data||process.env.HOME!==expectedHome)
      throw Error('Isolated app binding changed');
    const win=e.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html'));
    return {pid,bounds:win?.getBounds(),visible:win?.isVisible(),displays:e.screen.getAllDisplays().map(d=>({bounds:d.bounds,scaleFactor:d.scaleFactor}))};
  },app.processId,executable,userData,home),{label:'bind-isolated-login-candidate'});
  report.processes??=[];
  report.processes.push(binding);
  await persist();
}
async function quitBoundApp(label){
  if(!app)return;
  const exiting=app;
  await exiting.mainEvaluate(js(function quit(pid,data){
    const e=process.getBuiltinModule('module').createRequire(process.execPath)('electron');
    if(process.pid!==pid||e.app.getPath('userData')!==data)throw Error('Wrong app in quit hook');
    setTimeout(()=>e.app.quit(),40);
    return true;
  },exiting.processId,userData),{label:'quit-exact-isolated-app'});
  const exit=await exiting.waitForExit(18000);
  assert.deepEqual({code:exit.code,signal:exit.signal},{code:0,signal:null});
  oldPid.push(exit.pid);
  report.exits??=[];
  report.exits.push({label,...exit});
  await writeFile(join(root,'electron-'+exit.pid+'.log'),exiting.logs(),{mode:0o600});
  await exiting.close();
  app=undefined;
  await persist();
}

async function requestStep(task,operation,name,input,{approve=false}={}){
  activeAgentCase={name,operation,input};
  await send('只执行此场景的一个预定操作 WY_M15_AGENT_'+name);
  if(!approve)return activeAgentCase;
  const request=await pendingBrowserWrite(task);
  await approveBrowserWrite();
  const item=await until(async()=>(await taskSnapshot(task)).items.find(row=>row.type==='notification'&&
    row.payload?.requestId===request.requestId&&['finished','failed','unknown'].includes(row.payload.status)),name+' approval result',20000);
  assert.equal(item.payload.status,'finished',JSON.stringify(item.payload));
  await modelIdle(task);
  return item.payload.result;
}
async function fixtureNative(url,{id=null,read=null,inputs=[]}={}){
  return app.mainEvaluate(js(async function native(expectedPid,data,origin,url,expectedId,selector,actions){
    const electron=process.getBuiltinModule('module').createRequire(process.execPath)('electron');
    if(process.pid!==expectedPid||electron.app.getPath('userData')!==data||new URL(url).origin!==origin)
      throw Error('Unexpected app or outside fixture origin');
    const window=electron.BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('/out/renderer/index.html'));
    const views=window?.contentView.children.filter(child=>child.webContents?.getURL()===url)??[];
    if(views.length!==1||!views[0].webContents.debugger.isAttached()||views[0].webContents.isLoading())return null;
    const contents=views[0].webContents,bounds=views[0].getBounds();
    if(bounds.width<20||bounds.height<20||expectedId!==null&&contents.id!==expectedId)throw Error('Fixture WebContents identity changed');
    const expression=(fn,...args)=>'('+fn.toString()+')(...'+JSON.stringify(args)+')';
    const owned=()=>{if(contents.isDestroyed()||contents.getURL()!==url)throw Error('Fixture native target changed');};
    for(const action of actions){
      owned();
      if(action.click){
        const point=await contents.executeJavaScript(expression(query=>{
          const matches=[...document.querySelectorAll(query)].filter(node=>!node.disabled&&
            node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0);
          if(matches.length!==1)return null;
          const b=matches[0].getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;
          return matches[0].contains(document.elementFromPoint(x,y))?{x,y}:null;
        },action.click));
        if(!point)throw Error('Site control unavailable: '+action.click);
        for(const type of ['mouseMoved','mousePressed','mouseReleased'])
          await contents.debugger.sendCommand('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...point});
      }else if(action.key){
        if(!['Tab','End'].includes(action.key))throw Error('Unexpected fixture key');
        for(const type of ['keyDown','keyUp'])await contents.debugger.sendCommand('Input.dispatchKeyEvent',{
          type,key:action.key,code:action.key,windowsVirtualKeyCode:action.key==='Tab'?9:35,
        });
      }else if(action.insert!==undefined){
        if(typeof action.insert!=='string'||action.insert.length>80)throw Error('Unexpected synthetic input');
        await contents.debugger.sendCommand('Input.insertText',{text:action.insert});
      }
    }
    const dataRow=selector?await contents.executeJavaScript(expression(query=>{
      const node=document.querySelector(query);
      return node?{text:node.textContent.trim(),value:node instanceof HTMLSelectElement?node.value:null,focus:document.activeElement===node}:null;
    },selector)):null;
    return {id:contents.id,url,marker:dataRow};
  },app.processId,userData,fixture.origin,url,id,read,inputs),{label:'login-followup-exact-fixture-webcontents'});
}
const waitNative=(url,selector,id=null)=>until(async()=>{
  const row=await fixtureNative(url,{id,read:selector});
  return row?.marker?row:null;
},'fixture marker '+selector,16000);
async function loginForm(url,id){
  const result=await fixtureNative(url,{id,inputs:[
    {click:'input[name="account"]'},{insert:fixtureLogin.account},{click:'input[name="password"]'},{insert:fixtureLogin.password},{click:'form button'},
  ]});
  assert.equal(result?.id,id);
}
async function choose(label){
  await click(requestPanel+' .agent-request-options button[aria-label="'+label+'"]');
  await app.waitFor('!!document.querySelector(".agent-confirm-choice:enabled")',6000);
  return click(requestPanel+' .agent-confirm-choice');
}
async function createLoginWait(task,site,pageId,name){
  const checkpoint='pending-step-'+name;
  await requestStep(task,'login_wait','login-wait-'+name,{pageId,origin:fixture.origin,readySelector:'#business-ready',checkpoint});
  const wait=await until(()=>loginRequest(task),'original login request '+name,20000);
  assert.equal(wait.payload.review.pageId,pageId);
  assert.equal(wait.payload.review.checkpoint,checkpoint);
  assert.equal(wait.status,'pending');
  assert.equal(wait.payload.phase,'waiting_user');
  return {wait,checkpoint};
}
async function runNextAfterLogin(task,site,expected,checkpoint){
  activeAgentCase={name:'resume-'+checkpoint,operation:'nav_goto',resume:true,checkpoint,input:{page:expected.pageId,url:site.url('receipt')}};
  const confirmedAt=await choose('已登录，继续');
  const original=await until(()=>{const sample=activeAgentCase;return sample.dispatchedAt?sample:null},'continuation emits exactly one next tool');
  const request=await pendingBrowserWrite(task);
  assert.equal(site.counters.receiptReads,0,'Do not read next step before its approval');
  await approveBrowserWrite();
  const outcome=await until(async()=>(await taskSnapshot(task)).items.find(row=>row.type==='notification'&&
    row.payload?.requestId===request.requestId&&row.payload.status==='finished'),'approved continuation tool result',20000);
  assert(outcome);
  const row=await waitNative(site.url('receipt'),expected.marker,expected.nativeId);
  const tab=await browserTab(task,expected.pageId);
  assert.equal(tab.profileId,expected.profileId);
  assert.equal(site.counters.receiptReads,1);
  await until(async()=>(await continuations(task)).some(row=>row.status==='completed'&&row.run_id&&row.native_turn_id),'new native execution for the first unfinished step',28000);
  const resumed=await continuations(task);
  assert.equal(resumed.length,1);
  assert.equal(report.model.filter(call=>call.scenario===original.name&&call.tool).length,1);
  return {confirmedAt,resumed,read:row,nextToolReceiptId:request.requestId,tabId:tab.id,profileId:tab.profileId};
}
function captureSite(site){return {counters:{...site.counters},visits:structuredClone(site.visits),records:structuredClone(site.records)};}

try{
  stage='launch';
  await launchBoundApp();
  stage='isolated-fixture-setup';
  const tool=await app.invoke('agents.customToolPath','claude',wrapper);
  assert(tool.tool.installed&&tool.tool.login==='api');
  const profile=await app.invoke('agents.save',{name:'M15 本地登录夹具模型',toolId:tool.tool.id,source:'login'});
  const project=await app.invoke('projects.create',{name:'M15 登录续接验收',aliases:[],description:'',rulesPath:null},[{label:'fixture',path:cwd}]);
  const {dirs}=await app.invoke('projects.get',project.id);
  const createTask=async name=>{
    const {taskId}=await app.invoke('agentTasks.create',{
      projectId:project.id,dirId:dirs[0].id,cwd,title:'M15 '+name,profileId:profile.id,tier:'ask',model,carryExtensions:false,
    });
    taskIds.push(taskId);
    return taskId;
  };
  const names=mode==='a13'?['deny','stop','close','profile']:[mode];
  const tasks=new Map();
  for(const name of names)tasks.set(name,await createTask(name));
  const timeOrigin=await app.evaluate('performance.timeOrigin');
  await app.cdp('Page.reload');
  await app.waitFor(`performance.timeOrigin!==${timeOrigin} && !!document.querySelector('[data-testid=sidebar-agent-task]')`,16000,{navigation:true});
  for(const name of names){
    const task=tasks.get(name),site=fixture.create(name==='a14-pending'?'restart-pending':name);
    stage=name+'-open-original';
    await switchTo(task);
    const opened=await requestStep(task,'open','open-'+name,{url:site.url('desk'),intent:'new',presentation:'show'},{approve:true});
    const pageId=opened.value?.data?.pageId;
    assert(pageId,'Expected the finished browser tab.open receipt');
    const original=await browserTab(task,pageId);
    assert(original?.profileId);
    await visible(task,site.url('login'));
    const first=await waitNative(site.url('login'),'form button');
    if(mode==='a11'){
      stage='a11-original-progress';
      site.controls.defaultReportMonth='11';
      await loginForm(site.url('login'),first.id);
      await waitNative(site.url('desk'),'#business-ready',first.id);
      assert.equal(site.counters.logins,1);
      await fixtureNative(site.url('desk'),{id:first.id,inputs:[{click:'a[href="report"]'}]});
      await waitNative(site.url('report'),'select[name="month"]',first.id);
      assert.equal((await fixtureNative(site.url('report'),{id:first.id,read:'select[name="month"]'}))?.marker?.value,'11');
      await fixtureNative(site.url('report'),{id:first.id,inputs:[{click:'form button'}]});
      const known=await until(async()=>{
        const row=await fixtureNative(site.url('report'),{id:first.id,read:'[role="status"]'});
        return row?.marker?.text.includes('a11-1')?row:null;
      },'first original business write visible');
      assert.equal(site.counters.writes,1);
      stage='a11-agent-sees-expired-session';
      site.expire();
      await requestStep(task,'nav_goto','reach-after-expiry',{page:pageId,url:site.url('desk')},{approve:true});
      await waitNative(site.url('login'),'form button',first.id);
      const {wait,checkpoint}=await createLoginWait(task,site,pageId,name);
      assert.equal((await continuations(task)).length,0);
      assert.equal(site.counters.receiptReads,0);
      await app.screenshot(join(root,'a11-waiting-card.png'));
      stage='a11-relogin-same-tab';
      await loginForm(site.url('login'),first.id);
      await waitNative(site.url('desk'),'#business-ready',first.id);
      assert.equal(site.counters.logins,2);
      stage='a11-resume-unfinished-read';
      const next=await runNextAfterLogin(task,site,{pageId,profileId:original.profileId,nativeId:first.id,marker:'[data-record="a11-1"]'},checkpoint);
      assert.equal(site.counters.writes,1);
      assert.equal(site.records[0].id,'a11-1');
      assert.equal(site.records[0].month,'11');
      await app.screenshot(join(root,'a11-resumed-original-record.png'));
      report.samples.push({case:'A11',task,pageId,profileId:original.profileId,nativeId:first.id,initialWrite:known,
        waitingRequest:loginRequestMeta(wait),next,...captureSite(site)});
    }else if(mode==='a13'){
      stage='a13-wait-'+name;
      const {wait,checkpoint}=await createLoginWait(task,site,pageId,name);
      activeAgentCase={name:'unexpected-'+name,operation:'nav_goto',resume:true,checkpoint,input:{page:pageId,url:site.url('receipt')}};
      await app.screenshot(join(root,'a13-'+name+'-before.png'));
      stage='a13-retire-'+name;
      if(name==='deny')await choose('拒绝');
      if(name==='stop')await click(requestPanel+' button.agent-stop-run','停止');
      if(name==='close'){
        await click('.agent-business-status button','查看网页标签');
        await visible(task,site.url('login'));
        await click('.agent-surface-tab.on button[aria-label^="关闭网页 "]');
        await until(async()=>!(await browserTab(task,pageId)),'the original tab is closed');
      }
      if(name==='profile'){
        await click('.agent-business-status button','查看网页标签');
        await visible(task,site.url('login'));
        await click('button.bw-profile');
        const dialog='[data-browser-panel="profiles"]';
        await click(dialog+' button.bw-add');
        await click(dialog+' .bw-profile-detail button','用于当前页面');
        await until(async()=>{const tab=await browserTab(task,pageId);return tab?.profileId!==original.profileId&&tab?.profileId;},'the original tab now uses another identity');
        await click(dialog+' .bw-dialog-actions button','完成');
      }
      const ended=await until(async()=>!(await loginRequest(task))?await taskSnapshot(task):null,'waiting card retired');
      assert.equal((await continuations(task)).length,0);
      // Negative transport test only. The retirement action above was actual
      // UI input; the old UI no longer provides a live button to send this.
      const stale=await app.invoke('agentTasks.respond',task,wait.requestId,wait.revision,{choice:'allow'})
        .then(result=>({accepted:true,result}),error=>({accepted:false,error:String(error.message??error).slice(0,450)}));
      assert.equal(stale.accepted,false);
      assert.equal(activeAgentCase.dispatchedAt,undefined);
      assert.equal((await continuations(task)).length,0);
      assert.equal(site.counters.logins,0);
      assert.equal(site.counters.writes,0);
      assert.equal(site.counters.receiptReads,0);
      assert.equal(await app.evaluate('Boolean(document.querySelector(\x27.agent-request-options button[aria-label="已登录，继续"]\x27))'),false);
      await app.screenshot(join(root,'a13-'+name+'-after.png'));
      report.samples.push({case:'A13',name,task,pageId,startingProfileId:original.profileId,
        finalProfileId:(await browserTab(task,pageId))?.profileId??null,oldRequest:loginRequestMeta(wait),
        stale,taskStatus:ended.status,continuations:0,...captureSite(site)});
    }else{
      stage='a14-wait-and-restart';
      const {wait,checkpoint}=await createLoginWait(task,site,pageId,name);
      activeAgentCase={name:'unexpected-'+name,operation:'nav_goto',resume:true,checkpoint,input:{page:pageId,url:site.url('receipt')}};
      const before=loginRequestMeta(wait);
      assert.equal((await continuations(task)).length,0);
      await app.screenshot(join(root,'a14-pending-before.png'));
      await quitBoundApp('pending-real-app-restart');
      await launchBoundApp();
      assert.notEqual(app.processId,oldPid.at(-1));
      await switchTo(task);
      const recovered=await until(()=>loginRequest(task),'the original waiting request after app restart',20000);
      assert.deepEqual(loginRequestMeta(recovered),before);
      await click('.agent-business-status button','查看网页标签');
      await visible(task,site.url('login'));
      const restored=await waitNative(site.url('login'),'form button');
      const restoredTab=await browserTab(task,pageId);
      assert.equal(restoredTab.profileId,original.profileId);
      assert.equal((await continuations(task)).length,0);
      assert.equal(site.counters.writes,0);
      assert.equal(site.counters.logins,0);
      assert.equal(activeAgentCase.dispatchedAt,undefined);
      await app.screenshot(join(root,'a14-pending-after.png'));
      report.samples.push({case:'A14',scenario:'pending only',task,pageId,profileId:original.profileId,
        oldNativeId:first.id,restoredNativeId:restored.id,requestBefore:before,requestAfter:loginRequestMeta(recovered),
        continuations:0,...captureSite(site)});
    }
    await persist();
  }
  assert.deepEqual(fixture.errors,[]);
  assert.deepEqual(report.failures,[]);
  report.status='passed';
}catch(error){
  report.status='failed';
  report.failures.push({stage,error:String(error.stack??error)});
  if(app){
    try{await app.screenshot(join(root,'failed.png'));
      await writeFile(join(root,'failed.txt'),await app.evaluate('document.body.innerText'),{mode:0o600});}
    catch{/* Keep the original diagnostics. */}
  }
}finally{
  if(app)try{await quitBoundApp('final-cleanup');}catch(error){
    report.failures.push({stage:'normal-exit',error:String(error)});
    report.status='failed';
    await app?.close();
  }
  await fixture.close();
  const modelClosed=once(mockModel,'close');mockModel.close();mockModel.closeAllConnections();await modelClosed;
  report.finishedAt=new Date().toISOString();
  report.sameAsarAfterRun=pin===await digest(asar);
  if(!report.sameAsarAfterRun)report.status='failed';
  await persist();
  console.log(JSON.stringify({status:report.status,mode,stage,samples:report.samples.length,root}));
  process.exitCode=report.status==='passed'?0:1;
}
