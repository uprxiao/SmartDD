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
import { startReportFixture } from 'file:///Users/liubu/hx/4.uprxiao/SmartDD/scripts/browser/m15/report-fixture.mjs';

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
const clock = () => performance.timeOrigin + performance.now();
const report = {
  appSha256: pin, appExecutableSha256: await digest(executable), claudeSha256: await digest(cli), claudeBuild: cli.split('/').at(-1),
  root, mode, count, host: { arch: arch(), kernel: release(), cpus: cpus().length, initialLoad: loadavg() },
  driverSha256: await digest(new URL(import.meta.url)), fixtureSha256: await digest(new URL('file:///Users/liubu/hx/4.uprxiao/SmartDD/scripts/browser/m15/report-fixture.mjs', import.meta.url)),
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
  const {startComponentFixture}=await import(pathToFileURL(join(runtime,'smart-frame-fixture.mjs')));
  const {verifyBaseline}=await import(pathToFileURL(join(runtime,'workflow.mjs')));
  const frozenSources=[
    {name:'choice-pass',expected:'succeeded',frozen:'/private/tmp/willyou-r04-integration.7smZMdSy/task/baseline'},
    {name:'choice-fail',expected:'failed',frozen:'/private/var/folders/xy/r637tyl545g2yc51_mf33l3h0000gn/T/source-ui-components-demo-MgfsFX/bundle/baselines/f1165c30fce267516e929bc8869076d3f2288bca47c5d5a6e03948ad10224bee'},
  ];
  const tasks=await Promise.all(frozenSources.map(({name})=>createTask(name)));
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
  async function operateInner(action,href){
    return app.mainEvaluate(js(async function command(expectedPid,data,url,what){
      const electron=process.getBuiltinModule('module').createRequire(process.execPath)('electron');
      if(process.pid!==expectedPid||electron.app.getPath('userData')!==data)throw Error('Unexpected App');
      const window=electron.BrowserWindow.getAllWindows().find(win=>/\/out\/renderer\/index\.html(?:[?#]|$)/.test(win.webContents.getURL()));
      const matched=window?.contentView.children.filter(child=>child.webContents?.getURL()===url)??[];
      if(matched.length!==1)return null;
      const contents=matched[0].webContents;
      if(contents.isDestroyed()||!contents.debugger.isAttached())return null;
      if(what==='click-login'){
        const point=await contents.executeJavaScript(`(() => {
          const button=document.querySelector('#login button[type=submit]');
          if(!button)return null;
          const bounds=button.getBoundingClientRect();
          const x=bounds.x+bounds.width/2,y=bounds.y+bounds.height/2;
          return bounds.width&&document.elementFromPoint(x,y)===button?{x,y}:null;
        })()`);
        if(!point)return null;
        for(const type of ['mouseMoved','mousePressed','mouseReleased'])await contents.debugger.sendCommand('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...point});
        return contents.id;
      }
      const state=await contents.executeJavaScript(`({identity:document.querySelector("#identity")?.textContent,selection:document.querySelector("#catalog-choice")?.closest(".ant-select")?.innerText?.trim()})`);
      return{...state,webContentsId:contents.id};
    },app.processId,userData,href,action),{label:'m15-fixture-tab'});
  }
  for(const [index,config] of frozenSources.entries()){
    const taskId=tasks[index];
    stage='stage-frozen-'+config.name;
    const manifest=await verifyBaseline(config.frozen);
    const bundle=join(cwd,config.name);
    for(const leaf of ['manifest.json',...manifest.entries.map(entry=>entry.file),...manifest.sources.map(entry=>entry.snapshot)]){
      await mkdir(dirname(join(bundle,leaf)),{recursive:true,mode:0o700});
      await cp(join(config.frozen,leaf),join(bundle,leaf),{force:false,errorOnExist:true});
    }
    assert.equal((await verifyBaseline(bundle)).revision,manifest.revision);
    const component=await startComponentFixture('/private/tmp/source-ui-frontend-deps.JjoCr3',{entry:pathToFileURL(join(bundle,'app.mjs'))});
    componentFixtures.push(component);
    const address=new URL(component.url).href;
    const origin=new URL(address).origin;
    await switchTo(taskId);
    stage='open-'+config.name;
    const open=await doTool(taskId,'open-'+config.name,'open',{url:address,presentation:'show'});
    const {pageId}=open.payload.result.value.data;
    await visible(taskId,address);
    stage='login-fixture-'+config.name;
    const nativeId=await until(()=>operateInner('click-login',address),'visible and actionable fixture login button');
    const before=await until(async()=>{const p=await operateInner('read',address);return p?.identity==='fixture-user'?p:null;},'fixture login marker');
    assert.equal(before.webContentsId,nativeId);
    const executionId=randomUUID();
    await modelIdle(taskId);
    stage='script-'+config.name;
    await doTool(taskId,'script-'+config.name,'script_run',{executionId,pageId,bundle:config.name,origin,revision:manifest.revision,cases:['CATALOG-CHOICE'],timeout:16000});
    const execution=await until(async()=>{
      const status=await app.invoke('browser.scriptStatus',{taskId,executionId});
      return status.report?status:null;
    },'recorded run report');
    const after=await operateInner('read',address);
    const screen=execution.evidence.find(e=>e.path.endsWith('.png'));
    const browser=await browserSnapshot(taskId);
    report.samples.push({name:config.name,pageId,origin,baseline:manifest.revision,execution,before,after,activePage:browser.activeId});
    await persist();
    assert.equal(execution.phase,config.expected);
    assert.equal(execution.pageId,pageId);
    assert.equal(browser.activeId,pageId);
    assert.equal(after.webContentsId,nativeId);
    assert.equal(after.identity,'fixture-user');
    assert.equal(after.selection,'Option 1');
    assert(screen,'Missing same-page screenshot');
    const png=await readFile(screen.path);
    assert.equal(await digest(screen.path),screen.sha256);
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(await digest(execution.report.path),execution.report.sha256);
    await app.waitFor(`[...document.querySelectorAll('.agent-child-result summary')].some(node=>node.textContent.includes(${JSON.stringify(config.expected==='succeeded'?'测试通过':'测试失败')}))`,12000);
    await click('.agent-child-result summary',config.expected==='succeeded'?'执行浏览器测试 · 测试通过':'执行浏览器测试 · 测试失败');
    await app.waitFor("Array.from(document.querySelectorAll('.agent-child-result button')).some(node=>node.textContent==='查看报告' && node.getBoundingClientRect().width>0)");
    stage='open-evidence-'+config.name;
    const card='details.agent-child-result';
    const evidence='section[aria-label="浏览器测试证据"]';
    await click(card+' button','查看报告');
    await app.waitFor(`!!document.querySelector(${JSON.stringify(evidence+' pre')})`,8000);
    const preview=await app.evaluate(js(selector=>JSON.parse(document.querySelector(selector).textContent),evidence+' pre'));
    assert.equal(preview.executionId,executionId);
    assert.equal(preview.pageId,pageId);
    assert.equal(preview.revision,manifest.revision);
    assert.deepEqual(preview.cases,execution.cases);
    assert(preview.evidence.some(item=>item.sha256===screen.sha256&&item.path===screen.path));
    await app.screenshot(join(root,config.name+'-report-view.png'));
    await click(evidence+' button','关闭预览');
    await app.waitFor(`!document.querySelector(${JSON.stringify(evidence)})`,8000);
    await click(card+' button','查看截图');
    await app.waitFor(`Boolean(document.querySelector(${JSON.stringify(evidence+' img')})?.naturalWidth)`,8000);
    const image=await app.evaluate(js(selector=>{
      const img=document.querySelector(selector);
      return {width:img.naturalWidth,height:img.naturalHeight,src:img.src};
    },evidence+' img'));
    assert.deepEqual([image.width,image.height],[png.readUInt32BE(16),png.readUInt32BE(20)]);
    assert.equal(createHash('sha256').update(Buffer.from(image.src.split(',')[1],'base64')).digest('hex'),screen.sha256);
    await app.screenshot(join(root,config.name+'-screenshot-view.png'));
    await click(evidence+' button','关闭预览');
    await click('[data-testid=agent-workspace-panel-header] .agent-surface-tab button[role=tab]','文件');
    await until(async()=>!(await uiState()).taskId,'browser surface hidden by the file tab');
    await click(card+' button','查看网页标签');
    await visible(taskId,address);
    const reopened=await until(()=>operateInner('read',address),'remounted original native WebContents');
    assert.deepEqual(reopened,after);
    Object.assign(report.samples.at(-1),{previewVerified:true,reopened,pngDimensions:[image.width,image.height]});
    if(config.expected==='failed'){
      assert.deepEqual(preview.cases[0].unexecutedAssertions,['readback']);
      const stepText=await app.evaluate("document.querySelector('details.agent-child-result').textContent");
      assert(stepText.includes('readback · 未执行'));
      const assertion=execution.cases.flatMap(row=>row.assertions).find(row=>!row.passed);
      assert(assertion,'Failure must preserve original failed assertion');
      assert(assertion.expected.includes('Option 7'));
      assert(assertion.actual.includes('Option 1'));
    }
    await app.screenshot(join(root,config.name+'-task.png'));
    await modelIdle(taskId);
  }
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
