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
import { fixtureLogin, startReportFixture } from 'file:///private/tmp/willyou-m15-packaged-driver.8dyvjYGO/report-fixture-download-scope.mjs';

const [bundleArg, pin, cliArg, mode = 'both', countArg = '5'] = process.argv.slice(2);
assert.match(pin ?? '', /^[a-f0-9]{64}$/);
assert(['manual', 'agent', 'both'].includes(mode));
const count = Number(countArg);
assert(Number.isInteger(count) && count >= 1 && count <= 20);
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
const testDownloads=join(root,'isolated-downloads');
await mkdir(testDownloads,{mode:0o700});
const clock = () => performance.timeOrigin + performance.now();
const report = {
  appSha256: pin, appExecutableSha256: await digest(executable), claudeSha256: await digest(cli), claudeBuild: cli.split('/').at(-1),
  root, mode, count, host: { arch: arch(), kernel: release(), cpus: cpus().length, initialLoad: loadavg() },
  driverSha256: await digest(new URL(import.meta.url)), fixtureSha256: await digest(new URL('file:///private/tmp/willyou-m15-packaged-driver.8dyvjYGO/report-fixture-download-scope.mjs', import.meta.url)),
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
let unblockDownload=()=>{};
const taskIds = [];
const componentFixtures=[];

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
    } else if (sample && text.includes('WY_M15_AGENT_' + sample.name) && !sample.dispatchedAt) {
      assert(tool, 'Browser create tool missing. Available browser/search names: ' + (params.tools ?? []).map(item => item.name).filter(name => /browser|toolsearch/i.test(name)).join(','));
      sample.dispatchedAt = clock();
      block = { name: tool.name, input: sample.input };
    }
    report.model.push({ id, tool: block?.name ?? null, approvalFollowup: text.includes('宿主业务结果通知') });
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
  }, selector, label)),'one visible clickable target ' + selector + ' ' + label,5000);
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
async function nativeReady(id, url) {
  return until(async () => {
    const state = await browserSnapshot(id);
    const tab = state.tabs.find(item => item.id === state.activeId);
    if (tab?.url !== url || tab.loading || tab.failure) return null;
    const view = await app.mainEvaluate(js(async function attached(pid, expectedURL) {
      if (process.pid !== pid) throw Error('App process changed');
      const electron = process.getBuiltinModule('module').createRequire(process.execPath)('electron');
      const window = electron.BrowserWindow.getAllWindows().find(win => /\/out\/renderer\/index\.html(?:[?#]|$)/.test(win.webContents.getURL()));
      const view = window?.contentView.children.find(child => {
        const contents = child.webContents;
        return contents && !contents.isDestroyed() && contents.getURL() === expectedURL;
      });
      if (!view || view.webContents.isLoading()) return null;
      const bounds = view.getBounds();
      if (bounds.width <= 50 || bounds.height <= 50) return null;
      const marker = await view.webContents.executeJavaScript('Boolean(document.querySelector("#fixture-ready") && document.querySelector("#available") && !document.querySelector("#available").disabled)');
      return marker ? { id: view.webContents.id, width: bounds.width, height: bounds.height } : null;
    }, app.processId, url), { label: 'measure-attached-native-page' });
    return view ? { tabId: tab.id, at: clock(), view } : null;
  }, 'the attached native view with a readable marker');
}
function scheduledReply(site) {
  let release;
  site.controls.openGate = new Promise(resolveGate => { release = resolveGate; });
  return release;
}

try {
  stage = 'isolated-launch';
  app = await openElectron({ userData, executable, cwd: root, env: { HOME: home, SMARTDD_CLI_HOME: cliHome, PATH: dirname(process.execPath)+':/usr/bin:/bin' }, inspectMain: true });
  report.pid = await app.mainEvaluate(js(function bind(pid, program, data, homeDir) {
    const e = process.getBuiltinModule('module').createRequire(process.execPath)('electron');
    if (process.pid !== pid || process.execPath !== program || e.app.getPath('userData') !== data || process.env.HOME !== homeDir) throw Error('Isolation mismatch');
    return pid;
  }, app.processId, executable, userData, home), { label: 'bind-isolated-m15-app' });
  report.display = await app.mainEvaluate(`(() => {
    const e = process.getBuiltinModule('module').createRequire(process.execPath)('electron');
    const w = e.BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/renderer/index.html'));
    return { bounds: w?.getBounds(), visible: w?.isVisible(), displays: e.screen.getAllDisplays().map(d => ({ bounds: d.bounds, scaleFactor: d.scaleFactor })) };
  })()`, { label: 'observe-m15-isolated-display' });
  await app.mainEvaluate(js((pid,data,downloads)=>{
    const e=process.getBuiltinModule('module').createRequire(process.execPath)('electron');
    if(process.pid!==pid||e.app.getPath('userData')!==data||!downloads.startsWith('/private/tmp/willyou-m15-candidate-e2e-'))throw Error('Unexpected download test App');
    e.app.setPath('downloads',downloads);
    return e.app.getPath('downloads');
  },app.processId,userData,testDownloads),{label:'m15-isolate-download-directory'});
  stage = 'fixture-project-and-tasks';
  const tool = await app.invoke('agents.customToolPath', 'claude', wrapper);
  assert(tool.tool.installed && tool.tool.login === 'api');
  const profile = await app.invoke('agents.save', { name: 'M15 本地模型夹具', toolId: tool.tool.id, source: 'login' });
  const project = await app.invoke('projects.create', { name: 'M15 隔离基线', aliases: [], description: '', rulesPath: null }, [{ label: 'fixture', path: cwd }]);
  const { dirs } = await app.invoke('projects.get', project.id);
  const createTask = async title => {
    const { taskId } = await app.invoke('agentTasks.create', {
      projectId: project.id, dirId: dirs[0].id, cwd, title, profileId: profile.id, tier: 'ask', model, carryExtensions: false,
    });
    taskIds.push(taskId);
    return taskId;
  };

  const runtime='/Users/liubu/.codex/skills/source-driven-ui-test/scripts';
  const {verifyBaseline}=await import(pathToFileURL(join(runtime,'workflow.mjs')));
  const taskId=await createTask('M15 A22 同页报表');
  const baseline='/private/tmp/willyou-r04-integration.7smZMdSy/task/baseline';
  const sourceManifest=await verifyBaseline(baseline);
  const bundleName='report-replay';
  const work=join(cwd,bundleName);
  await mkdir(join(work,'runtime'),{recursive:true,mode:0o700});
  const runtimeEntries=sourceManifest.entries.filter(entry=>entry.file.startsWith('runtime/'));
  for(const entry of runtimeEntries)await cp(join(baseline,entry.file),join(work,entry.file));
  const suiteSource=new URL('./report-same-tab-suite-download-scope.mjs',import.meta.url);
  await cp(suiteSource,join(work,'suite.mjs'));
  const caseId='REPORT-REPLAY';
  const writeJson=(name,value)=>writeFile(join(work,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
  const assertIds=['globalDownloadDenied','outputPathDenied','month','matchesReceipt'];
  await writeJson('cases.json',{cases:[{id:caseId,page:{key:'report'},expected:{globalDownloadDenied:true,outputPathDenied:true,month:'11',matchesReceipt:true},
    assertions:assertIds.map(id=>({id,expectedRef:'/'+id})),criteria:assertIds.map(id=>({id,assertionIds:[id]}))}]});
  await writeJson('script-map.json',{suiteFile:'suite.mjs',suiteSha256:await digest(join(work,'suite.mjs')),
    casesSha256:await digest(join(work,'cases.json')),cases:[{id:caseId,handler:'createReport',status:'implemented',operations:[]}]});
  const entries=[...runtimeEntries];
  for(const file of ['cases.json','script-map.json','suite.mjs'])entries.push({file,sha256:await digest(join(work,file))});
  entries.sort((a,b)=>a.file.localeCompare(b.file));
  const sources=[];
  const revision=createHash('sha256').update(JSON.stringify({entries,sources})).digest('hex');
  await writeJson('manifest.json',{schema:'source-ui-baseline-v2',revision,entries,sources});
  assert.equal((await verifyBaseline(work)).revision,revision);
  const rendererOrigin=await app.evaluate('performance.timeOrigin');
  await app.cdp('Page.reload');
  await app.waitFor(`performance.timeOrigin!==${rendererOrigin} && !!document.querySelector('[data-testid=sidebar-agent-task]')`,16000,{navigation:true});
  async function doTool(taskId,name,operation,input){
    activeAgentCase={name,operation,input};
    await send('执行样例步骤 WY_M15_AGENT_'+name);
    const request=await pendingBrowserWrite(taskId);
    await approveBrowserWrite();
    return until(async()=>(await taskSnapshot(taskId)).items.find(item=>item.type==='notification'&&item.payload?.requestId===request.requestId&&item.payload.status==='finished'),'original '+operation+' receipt',28000);
  }
  async function nativeRead(href,act=false){
    return app.mainEvaluate(js(async function run(expectedPid,data,url,shouldLogin,credentials){
      const electron=process.getBuiltinModule('module').createRequire(process.execPath)('electron');
      if(process.pid!==expectedPid||electron.app.getPath('userData')!==data||!url.startsWith('http://127.0.0.1:'))throw Error('Unexpected App or site');
      const window=electron.BrowserWindow.getAllWindows().find(win=>/\/out\/renderer\/index\.html(?:[?#]|$)/.test(win.webContents.getURL()));
      const match=window?.contentView.children.filter(child=>child.webContents?.getURL()===url)??[];
      if(match.length!==1||!match[0].webContents.debugger.isAttached())return null;
      const contents=match[0].webContents;
      if(!shouldLogin){
        return {id:contents.id,ready:await contents.executeJavaScript('Boolean(document.querySelector("#business-ready"))')};
      }
      async function clickOwned(selector){
        const point=await contents.executeJavaScript('('+((selector)=>{
          const node=document.querySelector(selector);
          if(!node)return null;
          const rect=node.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
          return rect.width&&node.contains(document.elementFromPoint(x,y))?{x,y}:null;
        }).toString()+')('+JSON.stringify(selector)+')');
        if(!point)throw Error('Fixture login element is unavailable');
        for(const type of ['mouseMoved','mousePressed','mouseReleased'])await contents.debugger.sendCommand('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...point});
      }
      await clickOwned('input[name="account"]');
      await contents.debugger.sendCommand('Input.insertText',{text:credentials.account});
      await clickOwned('input[name="password"]');
      await contents.debugger.sendCommand('Input.insertText',{text:credentials.password});
      await clickOwned('form button');
      return {id:contents.id};
    },app.processId,userData,href,act,act?fixtureLogin:null),{label:'m15-login-fixture'});
  }
  const site=fixture.create('report-replay');
  const companion=fixture.create('companion');
  const desk=site.url('desk'),login=site.url('login'),reportPage=site.url('report'),different=companion.url('other-download');
  await switchTo(taskId);
  stage='companion-open';
  const companionOpen=await doTool(taskId,'open-companion','open',{url:different,presentation:'show'});
  const companionId=companionOpen.payload.result.value.data.pageId;
  await visible(taskId,different);
  await modelIdle(taskId);
  stage='report-open';
  const open=await doTool(taskId,'open-report','open',{url:desk,presentation:'show'});
  const {pageId}=open.payload.result.value.data;
  await visible(taskId,login);
  const native=await until(()=>nativeRead(login),'attached login page');
  assert.equal((await nativeRead(login,true)).id,native.id);
  await visible(taskId,desk);
  await until(async()=>{const state=await nativeRead(desk);return state?.ready&&state.id===native.id;},'authenticated workbench');
  const originalTabs=(await browserSnapshot(taskId)).tabs;
  const originalProfile=originalTabs.find(t=>t.id===pageId).profileId;
  assert.equal(originalTabs.find(t=>t.id===companionId).profileId,originalProfile);
  site.controls.downloadGate=new Promise(resolve=>{unblockDownload=resolve;});
  const executionId=randomUUID();
  await modelIdle(taskId);
  stage='primary-download-waiting';
  await doTool(taskId,'report-download','script_run',{executionId,pageId,bundle:bundleName,origin:fixture.origin,revision,cases:[caseId],timeout:26000});
  const queued=await until(()=>site.visits.find(v=>v.route==='csv'&&v.method==='GET'&&!v.finishedAt),'original site download request held before response',12000);
  stage='companion-download-during-primary';
  await click('[data-testid="agent-workspace-panel-header"] [role="tab"][title='+JSON.stringify(different)+']');
  await visible(taskId,different);
  const companionNative=await until(()=>app.mainEvaluate(js(async(pid,data,address)=>{
    const e=process.getBuiltinModule('module').createRequire(process.execPath)('electron');
    if(process.pid!==pid||e.app.getPath('userData')!==data)throw Error('Unexpected App');
    const window=e.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/out/renderer/index.html'));
    const view=window?.contentView.children.find(child=>child.webContents?.getURL()===address);
    if(!view||!view.webContents.debugger.isAttached()||view.getBounds().width<80)return null;
    const contents=view.webContents;
    const point=await contents.executeJavaScript(`(()=>{const a=document.querySelector('#different-file');if(!a)return null;const rect=a.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;return a.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`);
    if(!point)return null;
    for(const type of ['mouseMoved','mousePressed','mouseReleased'])await contents.debugger.sendCommand('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...point});
    return contents.id;
  },app.processId,userData,different),{label:'m15-companion-download-input'}),'visible companion download target');
  assert.notEqual(companionNative,native.id);
  const externalDownload=await until(async()=>(await browserSnapshot(taskId)).downloads.find(row=>row.pageId===companionId&&row.state==='done'),'separate default browser download');
  assert.equal(externalDownload.path,join(testDownloads,'companion.csv'));
  assert.equal(await readFile(externalDownload.path,'utf8'),'id,month\ncompanion,10\n');
  assert.equal(companion.counters.downloads,1);
  assert.equal(queued.finishedAt,undefined);
  unblockDownload();
  const execution=await until(async()=>{
    const value=await app.invoke('browser.scriptStatus',{taskId,executionId});
    return value.report?value:null;
  },'completed original script download',16000);
  report.samples.push({execution,nativeId:native.id,companionNative,companionId,externalDownload,site:site.counters,primaryTraffic:site.visits});
  await persist();
  assert.equal(execution.phase,'succeeded',JSON.stringify(execution));
  assert.equal(execution.pageId,pageId);
  assert.equal(execution.profileId,originalProfile);
  assert.equal((await browserSnapshot(taskId)).activeId,companionId);
  assert.equal(site.counters.writes,1);
  assert.equal(site.counters.downloads,1);
  const artifact=execution.evidence.find(row=>row.filename==='report-replay-1.csv');
  assert(artifact,'Missing original downloadable evidence');
  assert.match(artifact.downloadId,/^[0-9a-f-]{36}$/);
  const realDownload=(await browserSnapshot(taskId)).downloads.find(row=>row.id===artifact.downloadId);
  assert.equal(realDownload.pageId,pageId);
  assert.equal(realDownload.destination,'explicit');
  assert.equal(realDownload.path,artifact.path);
  assert.equal(realDownload.name,artifact.filename);
  assert.equal(await digest(realDownload.path),artifact.sha256);
  assert.notEqual(artifact.downloadId,externalDownload.id);
  assert.equal(await digest(artifact.path),artifact.sha256);
  assert.equal(await readFile(artifact.path,'utf8'),'id,month\nreport-replay-1,11\n');
  Object.assign(report.samples[0],{artifact,realDownload,originalProfile});
  await persist();
  stage='download-evidence-restart';
  await modelIdle(taskId);
  const priorPid=app.processId;
  await app.mainEvaluate(`(() => {const e=process.getBuiltinModule('module').createRequire(process.execPath)('electron');setTimeout(()=>e.app.quit(),40);return true;})()`,{label:'quit-isolated-m15-download-restart'});
  const firstExit=await app.waitForExit(18000);
  assert.equal(firstExit.code,0);
  assert.equal(firstExit.signal,null);
  await app.close();
  app=undefined;
  app=await openElectron({userData,executable,cwd:root,env:{HOME:home,SMARTDD_CLI_HOME:cliHome,PATH:dirname(process.execPath)+':/usr/bin:/bin'},inspectMain:true});
  assert.notEqual(app.processId,priorPid);
  const restored=await app.invoke('browser.scriptStatus',{taskId,executionId});
  assert.deepEqual(restored,execution);
  await switchTo(taskId);
  await click('details.agent-child-result summary','执行浏览器测试 · 测试通过');
  await click('details.agent-child-result button','查看报告');
  await app.waitFor('!!document.querySelector("section[aria-label=浏览器测试证据] pre")',10000);
  const afterRestart=await app.evaluate('JSON.parse(document.querySelector("section[aria-label=浏览器测试证据] pre").textContent)');
  assert.equal(afterRestart.executionId,executionId);
  assert(afterRestart.evidence.some(row=>row.downloadId===artifact.downloadId&&row.sha256===artifact.sha256));
  assert.equal(await digest(artifact.path),artifact.sha256);
  await app.screenshot(join(root,'download-report-after-restart.png'));
  Object.assign(report.samples[0],{firstExit,priorPid,restartedPid:app.processId,restored,reportPreviewVerified:true});
  assert.deepEqual(fixture.errors, []);
  assert.deepEqual(report.failures, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failures.push({ stage, error: String(error.stack ?? error) });
  if (app) {
    try {
      await writeFile(join(root, 'failed-ui.txt'), await app.evaluate('document.body.innerText'), { mode: 0o600 });
      await app.screenshot(join(root, 'failed-ui.png'));
    } catch { /* The original failure remains the result. */ }
  }
} finally {
  unblockDownload();
  if (app) {
    try {
      for (const id of taskIds) await app.invoke('agentTasks.stop', id, true);
      await app.mainEvaluate(`(() => {
        const e = process.getBuiltinModule('module').createRequire(process.execPath)('electron');
        setTimeout(() => e.app.quit(), 40);
        return true;
      })()`, { label: 'quit-isolated-m15-baseline' });
      report.exit = await app.waitForExit(18000);
      assert.equal(report.exit.code, 0);
      assert.equal(report.exit.signal, null);
    } catch (error) {
      report.failures.push({ stage: 'normal-exit', error: String(error) });
      report.status = 'failed';
    }
    await writeFile(join(root, 'electron.log'), app.logs(), { mode: 0o600 });
    await app.close();
  }
  for(const component of componentFixtures)await component.close();
  await fixture.close();
  const modelClosed = once(mockModel, 'close');
  mockModel.close();
  mockModel.closeAllConnections();
  await modelClosed;
  report.finalLoad = loadavg();
  report.finishedAt = new Date().toISOString();
  report.sameAsarAfterRun = pin === await digest(asar);
  if (!report.sameAsarAfterRun) report.status = 'failed';
  await persist();
  console.log(JSON.stringify({ status: report.status, samples: report.samples.length, lastStage: stage, failures: report.failures.map(f => f.stage) }));
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
