import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { openElectron, pause } from '../../prep-fef791bc6/electron-harness.mjs';
import { redirectHome } from '../../prep-fef791bc6/home-redirect-main.mjs';

const base='/private/tmp/willyou-m14-stage6.WRvdST';
const [out,sourceCommit]=process.argv.slice(2);
const executable=process.env.M14_ACCEPTANCE_APP;
const asar=process.env.M14_EXPECTED_ASAR_SHA256;
assert.match(out??'',/^\/private\/tmp\/willyou-m14-stage6\.WRvdST\/g03\/attempt-[0-9]+$/);
assert.match(sourceCommit??'',/^[0-9a-f]{40}$/);
assert.match(asar??'',/^[0-9a-f]{64}$/);
assert.equal(process.cwd(),join(base,'source'));
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
  npm_config_userconfig:join(root,'test-npm-empty-user'),npm_config_globalconfig:join(root,'test-npm-empty-global'),
  GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',
  ENABLE_TOOL_SEARCH:'false',NO_PROXY:'127.0.0.1,localhost',HTTP_PROXY:'http://127.0.0.1:1',
  HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',
};
const model='a11-codex-form';
const hookResult={};
const result={bootstrap:hookResult,sourceCommit,asar,executable,scope:'A11: real packaged App and Codex app-server; loopback Responses fixture; background CDP',
  observations:[],requests:[],actions:[],status:'failed'};
const port=3425;
const origin='http://127.0.0.1:'+port;
let app;
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



function writeResponses(res,model,answer,call){
  res.writeHead(200,{'content-type':'text/event-stream'});
  const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
  const id='r'+randomUUID();
  const item=call?{id:'fc'+randomUUID(),type:'function_call',call_id:call.callId,name:call.tool.name,
    ...(call.tool.namespace?{namespace:call.tool.namespace}:{}),arguments:JSON.stringify(call.args),status:'completed'}
    :{id:'m'+randomUUID(),type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]};
  event('response.created',{response:{id,status:'in_progress',output:[]}});
  event('response.output_item.added',{output_index:0,item:{...item,status:'in_progress'}});
  if(!call)event('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:answer});
  event('response.output_item.done',{output_index:0,item});
  event('response.completed',{response:{id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});
  res.end();
}
const secret = 'M14_SYNTHETIC_SECRET_' + randomUUID();
const userMarker = 'A11_CODEX_FORM_TRIGGER';
const done = 'A11_CODEX_FORM_COMPLETED';
const calls = { requests: 0, offered: false, submitted: false };
const callId = 'call_' + randomUUID();
const choice = '选择甲';
const publicAnswer = '允许留存的普通回答';
const questions = [
  { id: 'choice', header: '选择', question: '请选择一个选项', options: [
    { label: choice, description: '首个普通选项' },
    { label: '选择乙', description: '第二个普通选项' },
  ] },
  { id: 'public', header: '说明', question: '请填写普通文本', isOther: true, options: [
    { label: '普通选项甲', description: '保留手工填答入口' }, { label: '普通选项乙', description: '备用项' },
  ] },
  { id: 'private', header: '保密', question: '请填写合成保密值', isOther: true, isSecret: true, options: [
    { label: '保密选项甲', description: '保留手工填答入口' }, { label: '保密选项乙', description: '备用项' },
  ] },
];
let phase = 'isolated startup';
let task;
const check = (label, ok) => {
  result.observations.push({ label, ok: Boolean(ok) });
  assert(ok, label);
};
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: model }] }));
      return;
    }
    if (req.method !== 'POST' || !req.url?.includes('responses')) {
      res.writeHead(404);
      res.end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const message = JSON.parse(Buffer.concat(chunks).toString());
    assert(message.model === model, 'Loopback model mismatch');
    calls.requests++;
    const output = message.input?.find(item => item.type === 'function_call_output' && item.call_id === callId);
    if (output) {
      let body;
      try { body = typeof output.output === 'string' ? JSON.parse(output.output) : output.output; }
      catch { throw Error('Native tool did not return a response object'); }
      const values = body.answers;
      calls.submitted = values?.choice?.answers?.[0] === choice &&
        values?.public?.answers?.[0] === publicAnswer && values?.private?.answers?.[0] === secret;
      assert(calls.submitted, 'Exact answers were not returned to the loopback model');
      writeResponses(res, model, done);
      return;
    }
    if (!calls.offered) {
      assert(JSON.stringify(message.input).includes(userMarker), 'The UI turn did not reach the native adapter');
      const tool = message.tools?.find(item => item.name === 'request_user_input');
      result.offerDiagnostic = { present: !!tool, class: tool?.type, allowsSecret: JSON.stringify(tool ?? {}).includes('isSecret') };
      assert(tool, 'Codex did not advertise native request_user_input in the isolated task');
      calls.offered = true;
      writeResponses(res, model, null, { tool, callId, args: { questions } });
      return;
    }
    throw Error('Unexpected Responses continuation');
  } catch (error) {
    result.serverError = error.message;
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
const typed = async (selector, value) => {
  await click(selector);
  await app.cdp('Input.insertText', { text: value });
};
function searchPersistence(dir, base = dir) {
  const leaks = [];
  let files = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = searchPersistence(path, base);
      files += nested.files;
      leaks.push(...nested.leaks);
    } else if (entry.isFile()) {
      files++;
      if (readFileSync(path).includes(Buffer.from(secret))) leaks.push(path.slice(base.length + 1));
    }
  }
  return { files, leaks };
}

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  app = await openElectron({ executable, userData, env, inspectMain: true,
    startupMainHook: async info => Object.assign(hookResult, await redirectHome({ ...info, home })) });
  const identity = await app.mainEvaluate(`(() => {
    const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    return [E.app.isPackaged,E.app.getPath('userData'),E.app.getPath('home'),process.env.HOME,process.execPath,process.pid];
  })()`);
  assert.deepEqual(identity, [true, userData, home, home, executable, app.processId]);
  result.pid = app.processId;
  await app.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await app.invoke('agents.refreshTools');
  const codex = (await app.invoke('agents.tools')).find(tool => tool.kind === 'codex' && tool.installed);
  assert(codex, 'Native Codex is required');
  result.codexVersion = codex.version;
  const provider = await app.invoke('agents.saveProvider', {
    name: 'A11 loopback only', preset: 'magpie',
    endpoints: { responses: origin + '/v1', anthropic: origin + '/' },
    models: [{ id: model, name: model }],
  });
  const profile = await app.invoke('agents.save', {
    name: 'A11 Native Codex', toolId: codex.id, source: 'provider',
    providerId: provider.id, models: [model], defaultModel: model, isDefault: true,
  });
  const state = join(userData, 'agents', 'codex', createHash('sha256').update(profile.id).digest('hex').slice(0, 32));
  mkdirSync(state, { recursive: true, mode: 0o700 });
  writeFileSync(join(state, 'config.toml'), '[features]\ndefault_mode_request_user_input = true\n', { mode: 0o600, flag: 'wx' });
  const project = await app.invoke('projects.create', {
    name: 'A11 isolated Codex form', aliases: [], description: '', rulesPath: null,
  }, [{ label: 'Isolated plain directory', path: cwd }]);
  const title = 'A11 Codex 原生多字段提问';
  task = await app.invoke('agentTasks.create', {
    projectId: project.id, dirId: project.dirs[0].id, cwd, title, profileId: profile.id, model, tier: 'ask',
  });
  check('root task', !task.parentTaskId);
  await click('[data-testid="nav-settings"]');
  const feature = '[data-testid="m14-toggle"]';
  await app.waitFor('Boolean('+selectorExpr(feature)+')', 15000);
  if (!await app.evaluate(selectorExpr(feature)+'?.innerText.includes("已开启")')) await click(feature);
  await app.waitFor(selectorExpr(feature)+'?.innerText.includes("已开启")', 12000);
  await click('[data-testid="nav-home"]');
  await click('[data-testid="sidebar-agent-task"][data-task-id="'+task.taskId+'"]');
  await app.waitFor('document.querySelector(".agent-task-head h1")?.textContent==='+JSON.stringify(title), 12000);
  phase = 'submit through the task composer';
  await typed('.agent-task-view textarea', userMarker);
  await click('.agent-task-view button[type="submit"]');
  await app.waitFor('document.querySelector(".agent-form")?.querySelectorAll("fieldset").length===3', 30000);
  const snapshot = await app.invoke('agentTasks.snapshot', task.taskId);
  const request = snapshot.requests.find(item => item.kind === 'user_input');
  check('native Codex request is bound to the root task', request?.payload?.method === 'item/tool/requestUserInput');
  result.nativeQuestions = request.payload.params.questions.map(({ id, isOther, isSecret }) => ({ id, isOther, isSecret }));
  check('native request carries isSecret', request.payload.params.questions.some(question => question.id === 'private' && question.isSecret === true));
  const form = '.agent-form';
  const submit = form+' button.primary';
  check('submission waits for all three fields', await app.evaluate(selectorExpr(submit)+'?.disabled===true'));
  check('password field is masked', await app.evaluate(selectorExpr(form+' fieldset[data-question="2"] input.agent-form-other')+'?.type==="password"'));
  await app.screenshot(join(out, '01-native-multifield.png'));
  phase = 'answer all fields with CDP input';
  await click(form+' fieldset[data-question="0"] label', choice);
  await typed(form+' fieldset[data-question="1"] input.agent-form-other', publicAnswer);
  await typed(form+' fieldset[data-question="2"] input[type="password"]', secret);
  await app.screenshot(join(out, '02-masked-filled.png'));
  await click(submit);
  await app.waitFor('document.querySelector(".agent-task-view")?.innerText.includes('+JSON.stringify(done)+') && !document.querySelector(".agent-form")', 20000);
  check('native receives all three expected answers in order', calls.submitted);
  check('the plaintext never appears in rendered text', await app.evaluate('!document.body.innerText.includes('+JSON.stringify(secret)+')'));
  await app.screenshot(join(out, '03-native-completed.png'));
  check('no renderer errors', app.rendererErrors.length === 0);
  result.status = 'passed';
} catch (error) {
  result.phase = phase;
  result.error = String(error.stack ?? error).replaceAll(secret, '[redacted]');
  if (app) try { await app.screenshot(join(out, '99-failure.png')); } catch {}
} finally {
  if (app) {
    if (task && result.status !== 'passed') {
      try { await app.invoke('agentTasks.stop', task.taskId, true); } catch {}
    }
    try {
      await app.mainEvaluate(`(() => {
        const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
        if(E.app.getPath('userData')!==${JSON.stringify(userData)}) throw Error('Wrong App');
        setTimeout(()=>E.app.quit(),50);
        return true;
      })()`);
      result.exit = await app.waitForExit(20000);
    } catch (error) {
      result.exitError = String(error).replaceAll(secret, '[redacted]');
      try { result.forcedExit = await app.crash(); } catch {}
    }
    const logs = app.logs();
    result.logPlaintext = logs.includes(secret) || JSON.stringify(app.rendererErrors).includes(secret);
    writeFileSync(join(out, 'app.log'), logs.replaceAll(secret, '[redacted]'), { mode: 0o600 });
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  result.calls = calls;
  result.persistence = { data: searchPersistence(userData), home: searchPersistence(home) };
  const codexTranscript = /^agents\/codex\/[0-9a-f]{32}\/sessions\/.+\/rollout-.+\.jsonl$/;
  result.hostPlaintext = result.logPlaintext || result.persistence.data.leaks.some(path => !codexTranscript.test(path)) ||
    result.persistence.home.leaks.length > 0;
  result.nativeTranscriptPlaintext = result.persistence.data.leaks.some(path => codexTranscript.test(path));
  if (result.hostPlaintext) result.status = 'failed';
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
}
if(result.status!=='passed'||result.exit?.code!==0)process.exitCode=1;
