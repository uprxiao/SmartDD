// T21 original UI transaction, isolated local source and native Save/Open.
// This is a partial case: no send history, external account or new native session.
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, dirname, resolve} from 'node:path';
import {openElectron} from '../lib/electron-harness.mjs';
import {installAppFocusGuard, isAppFocusYield} from '../lib/app-focus-guard.mjs';
import {compileApplicationFixture} from '../lib/compile-application-fixture.mjs';

const executable = process.env.WILLYOU_ACCEPTANCE_APP;
const pin = process.env.WILLYOU_ACCEPTANCE_ASAR_SHA;
assert(executable?.startsWith('/private/tmp/willyou-m10-') && pin);
const sha = value => createHash('sha256').update(value).digest('hex');
const asar = resolve(dirname(executable), '../Resources/app.asar');
assert.equal(sha(await readFile(asar)), pin);
const root = await mkdtemp('/private/tmp/willyou-m10-transfer-tw-');
const userData = join(root, 'userdata'), home = join(root, 'home'), codeDirectory = join(root, 'imported-code');
await mkdir(home, {mode: 0o700});
await mkdir(codeDirectory, {mode: 0o700});
const env = {HOME: home, ZDOTDIR: home, CODEX_HOME: join(home, '.codex'),
  CLAUDE_CONFIG_DIR: join(home, '.claude'), HTTP_PROXY: 'http://127.0.0.1:1',
  HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1,localhost'};
for (const key of Object.keys(process.env)) if (!['PATH','TMPDIR','LANG','LC_ALL'].includes(key)) delete process.env[key];
const password = randomBytes(24).toString('base64url');
const result = {root, userData, app: executable, asar: pin, startedAt: new Date().toISOString(),
  status: 'running', layer: 'A original packaged export/import UI/native panels; I own local source setup and decrypt assertions',
  isolation: {freshUserData: true, freshAgentRoots: true, freshHome: true,
    noDailyConfigOrCredentialsCopied: true, noAgentOrSmtp: true}, checks: [], actions: [], panels: [], appPids: [], network: []};
let app, stage = 'bootstrap';
const unwrap = value => {assert(value.ok, JSON.stringify(value)); return value.value;};
const sql = query => JSON.parse(execFileSync('/usr/bin/sqlite3', ['-readonly', '-json', join(userData, 'smartdd.db'), query], {encoding: 'utf8', timeout: 5000}) || '[]');
const snapshot = () => Object.fromEntries(['application_connections','application_project_settings','application_project_bindings',
  'app_secrets','mail_drafts','mail_draft_revisions','mail_attachment_objects','mail_send_intents','mail_send_executions',
  'mail_send_grants','capability_session_snapshots','capability_session_refs'].map(table => [table, sql('SELECT * FROM '+table+' ORDER BY rowid')]));
const note = name => {result.checks.push({name, at: new Date().toISOString()}); console.log(JSON.stringify({root, stage, check: name}));};
async function click(selector, text) {
  const find = `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height${text === undefined ? '' : '&&e.textContent.trim()==='+JSON.stringify(text)})`;
  await app.waitFor(`(()=>{const e=${find};return !!e&&!e.disabled})()`, 15000);
  await app.waitFor("document.getAnimations().every(a=>a.playState!=='running'||a.effect?.getTiming().iterations===Infinity)");
  const point = await app.evaluate(`(()=>{const e=${find};e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.disabled||!e.contains(document.elementFromPoint(x,y)))throw Error('Covered T21 control');return{x,y}})()`);
  for (const type of ['mouseMoved','mousePressed','mouseReleased']) await app.cdp('Input.dispatchMouseEvent', {type, ...point, ...(type === 'mouseMoved' ? {} : {button:'left',clickCount:1})});
  result.actions.push({selector, text, at: new Date().toISOString()});
}
async function fill(selector, value) {
  await click(selector);
  for (const type of ['keyDown','keyUp']) await app.cdp('Input.dispatchKeyEvent', {type,key:'a',code:'KeyA',modifiers:4,...(type==='keyDown'?{commands:['selectAll']}:{})});
  await app.cdp('Input.insertText', {text:value});
  assert.equal(await app.evaluate('document.querySelector('+JSON.stringify(selector)+').value'), value);
}
async function control(kind, path) {
  const sequence = result.panels.length, ack = join(root, 'native-'+sequence+'.json');
  const row = {kind,path,sequence,ack,pid:app.processId,app:executable,at:new Date().toISOString()}; result.panels.push(row);
  await writeFile(join(root,'progress.json'), JSON.stringify(row,null,2));
  console.log(JSON.stringify({root,stage,native:row}));
  const end = Date.now()+180000;
  while (Date.now()<end) {
    const value = await readFile(ack,'utf8').then(JSON.parse,()=>null);
    if (value) {assert(value.done===true,'Native control deferred'); row.receipt=value;return;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('Native UI control timed out; do not restart or replay');
}
try {
  app = await openElectron({executable,userData,env,inspectMain:true}); result.appPids.push(app.processId); installAppFocusGuard(app,result);
  await app.cdp('Network.enable'); app.onCDP('Network.requestWillBeSent',event=>result.network.push({url:event.request.url,method:event.request.method}));
  const forbidden=['tasks.create','tasks.open','applications.replyDraft','applications.importAttachment','applications.captureAttachment','applications.prepareSend','applications.reviewSend','applications.authorizeSend','applications.executeSend','app.openExternal'];
  await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own T21 only');const g={records:[],originals:[],forbidden:[]},map=E.ipcMain._invokeHandlers;for(const n of ['projectTransfer.describeExport','projectTransfer.export','projectTransfer.chooseImport','projectTransfer.unlock','projectTransfer.validateDraft','projectTransfer.pickDirectory','projectTransfer.commit','projectTransfer.dispose']){const f=map.get(n);assertFunction(f);g.originals.push([n,f]);map.set(n,async function(event,...args){const row={name:n,at:Date.now()};g.records.push(row);row.reply=await f.call(this,event,...args);row.returnedAt=Date.now();return row.reply;});}for(const n of ${JSON.stringify(forbidden)}){const f=map.get(n);if(f){g.originals.push([n,f]);map.set(n,()=>{g.forbidden.push(n);throw Error('T21 transaction-only forbidden action');});}}function assertFunction(f){if(typeof f!=='function')throw Error('Original transfer handler missing');}g.restore=()=>{for(const[n,f]of g.originals)map.set(n,f);};globalThis.__twTransfer=g;const w=E.BrowserWindow.getAllWindows();if(w.length!==1)throw Error('Own single window');w[0].setTitle('A · T21 TW · PID '+process.pid);w[0].show();E.app.focus({steal:false});w[0].focus();w[0].webContents.focus();return true})()`);
  const project = await app.invoke('projects.create',{name:'TW source project',aliases:[],description:'Own T21 local source',rulesPath:null});
  result.project=project;
  result.peer=await app.invoke('projects.create',{name:'TW unrelated target peer',aliases:[],description:'Must remain unchanged',rulesPath:null});
  const source=join(root,'synthetic-foxmail'); await mkdir(join(source,'Mail/Inbox'),{recursive:true});
  await writeFile(join(source,'Mail/Inbox/1.mail'),'From: sender@example.test\r\nTo: receiver@example.test\r\nSubject: TW source\r\nMessage-ID: <tw-1@example.test>\r\n\r\nTW_PRIVATE_MAIL_NOT_PORTABLE\r\n');
  execFileSync('/usr/bin/sqlite3',[join(source,'messages.db'),"CREATE TABLE mailinfo(mailid INTEGER PRIMARY KEY,subject TEXT,from_ TEXT,to_ TEXT,messageid TEXT,date INTEGER,mail_receivedate INTEGER,fileexist INTEGER,attachment INTEGER);INSERT INTO mailinfo VALUES(1,'TW source','sender@example.test','receiver@example.test','<tw-1@example.test>',0,0,1,0);"]);
  const catalog=unwrap(await app.invoke('applications.catalog')).find(item=>item.appId==='mail'); unwrap(await app.invoke('applications.setAdded','mail',true,catalog.revision));
  const tested=unwrap(await app.invoke('applications.testConnection',{name:'TW existing local source',expectedRevision:0,config:{kind:'foxmail',sourcePath:source,account:'receiver@example.test',queryDays:7}}));
  result.connection=unwrap(await app.invoke('applications.saveConnection','mail',tested.operationId,tested.candidateHash));
  unwrap(await app.invoke('applications.select',{projectId:project.id,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:result.connection.id,smtp:null}}));
  const before=snapshot(); result.beforeSummary=Object.fromEntries(Object.entries(before).map(([key,value])=>[key,value.length]));
  const peerBefore=await app.invoke('projects.get',result.peer.id);
  const origin=await app.evaluate('performance.timeOrigin'); await app.cdp('Page.reload');
  await app.waitFor('performance.timeOrigin!=='+origin+'&&!!document.querySelector("[data-testid=sidebar-project-more]")',15000,{navigation:true});
  await control('attach-before-dialog');
  await app.waitFor('document.hasFocus()&&document.visibilityState==="visible"',5000);
  stage='export';
  await click('[data-project-id="'+project.id+'"] [data-testid=sidebar-project-more]'); await click('[data-testid=sidebar-project-export]');
  await app.waitFor('document.querySelector(".m8-transfer")?.textContent.includes("应用配置、应用连接与凭据、邮件数据、草稿和发送记录不包含在项目文件中")');
  result.exportHint=await app.evaluate('document.querySelector(".m8-transfer").innerText');
  await fill('input[aria-label=设置导出口令]',password); await fill('input[aria-label=再次输入口令]',password);
  await app.screenshot(join(root,'export-review.png'));
  await click('.m8-transfer button','加密并导出');
  const exportPath=join(root,'tw-project.willyou'); await control('save',exportPath);
  await app.waitFor('!!document.querySelector(".transfer-success")||!!document.querySelector(".m8-transfer [role=alert]")',30000);
  const exported=await app.mainEvaluate('globalThis.__twTransfer.records.filter(r=>r.name==="projectTransfer.export").at(-1)'); result.exportReply=exported;
  if(!exported.reply.ok){result.status='blocked-original-export';result.error=exported.reply.code;throw Error('Original export prerequisite: '+exported.reply.code);}
  assert.equal(exported.reply.value.path,exportPath);
  const codecInfo=await compileApplicationFixture({entry:'scripts/applications/fixtures/transfer-fixture-codec.ts',output:join(root,'setup/codec.cjs')}); result.codec=codecInfo;
  const codec=createRequire(import.meta.url)(codecInfo.output),raw=await readFile(exportPath),payload=await codec.decryptProject(raw,password);
  assert.deepEqual(Object.keys(payload).sort(),['schemaVersion','exportedAt','producer','project','directories','databases','servers','capabilities','profiles','credentials'].sort());
  assert.equal(payload.schemaVersion,1); assert.equal(payload.project.name,project.name); assert.deepEqual(payload.credentials,{});
  for(const value of [result.connection.id,source,'TW_PRIVATE_MAIL_NOT_PORTABLE']) assert(!JSON.stringify(payload).includes(value));
  assert.deepEqual(snapshot(),before); result.artifact={path:exportPath,sha256:sha(raw),bytes:raw.length,keys:Object.keys(payload),credentialCount:0};
  await app.screenshot(join(root,'export-success.png')); note('Actual native Save exports authenticated strict v1 and excludes selected local M10 source without changing original state');
  await click('.m8-transfer button','完成'); await app.waitFor('!document.querySelector(".m8-transfer")');
  stage='import-existing'; await click('[data-testid=sidebar-new-project]'); await click('[role=menuitem]','导入项目');
  await click('.transfer-file-choice'); await control('open',exportPath);
  await app.waitFor('!!document.querySelector("input[aria-label=导入口令]")'); await fill('input[aria-label=导入口令]',password); await click('.m8-transfer button','解锁并预览');
  await app.waitFor('!!document.querySelector("input[aria-label=导入后的项目名称]")'); await app.screenshot(join(root,'import-review.png'));
  // Even an export without registered directories gets the original M8 required
  // main-directory mapping. Pick it through the native UI before committing.
  await click('button[aria-label="选择本机目录：主目录"]'); await control('directory',codeDirectory);
  await app.waitFor('document.querySelector('+JSON.stringify('input[aria-label="导入目录：主目录"]')+')?.value==='+JSON.stringify(codeDirectory));
  await click('.m8-transfer button','导入项目');
  await app.waitFor('document.querySelector(".transfer-success")?.textContent.includes("项目已导入")',30000);
  const committed=await app.mainEvaluate('globalThis.__twTransfer.records.filter(r=>r.name==="projectTransfer.commit").at(-1)'); assert(committed.reply.ok); result.imported=committed.reply.value;
  for(const appId of ['mail','zentao']) {const value=unwrap(await app.invoke('applications.projectSettings',result.imported.projectId,appId)); assert.equal(value.enabled,false);assert(Object.values(value.connections).every(v=>v===null));}
  // New project's default rows are allowed; every pre-existing M10 row remains exact.
  const after=snapshot(); for(const table of Object.keys(before)) assert.deepEqual(after[table].filter(row=>row.project_id!==result.imported.projectId),before[table]);
  assert.deepEqual(await app.invoke('projects.get',result.peer.id),peerBefore);
  await app.screenshot(join(root,'import-success.png')); note('Actual native Open/decrypt/commit creates an unselected new project and preserves existing source/peer/global data');
  stage='explicit-existing'; await click('.m8-transfer button','配置项目应用'); await app.waitFor('!!document.querySelector(".m10-project-apps")');
  const label='为'+result.imported.name+'启用邮件'; await click('button[role=switch][aria-label='+JSON.stringify(label)+']');
  await app.waitFor('document.querySelector('+JSON.stringify('button[role=switch][aria-label="'+label+'"]')+')?.getAttribute("aria-checked")==="true"');
  await click('input[aria-label='+JSON.stringify('为'+result.imported.name+'选用'+result.connection.name)+']');
  await app.waitFor('document.querySelector('+JSON.stringify('input[aria-label="为'+result.imported.name+'选用'+result.connection.name+'"]')+')?.checked===true');
  result.selected=unwrap(await app.invoke('applications.projectSettings',result.imported.projectId,'mail')); assert.equal(result.selected.connections.foxmail,result.connection.id);
  await app.screenshot(join(root,'explicit-existing.png')); note('Import-success P04 explicitly reuses existing valid local connection through actual switch/radio');
  result.status='passed-existing-target-ui-subset';
} catch(error) {
  if(result.status==='running')result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';
  result.stage=stage; result.error??=String(error); result.stack=String(error.stack);
  process.exitCode=2;
  if(app)try{result.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(root,'failure.png'));}catch{}
} finally {
  if(app){try{result.observed=await app.mainEvaluate('({records:globalThis.__twTransfer.records,forbidden:globalThis.__twTransfer.forbidden})');assert.deepEqual(result.observed.forbidden,[]);await app.mainEvaluate('globalThis.__twTransfer.restore();true');result.observerRestored=true;
    await writeFile(join(root,'app.log'),app.logs()); await app.mainEvaluate("(()=>{setTimeout(()=>process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').app.quit(),30);return true})()");result.exit=await app.waitForExit();
  }catch(error){result.cleanupError=String(error);}await app.close();}
  result.finishedAt=new Date().toISOString();assert.equal(sha(await readFile(asar)),pin);
  const serialized=JSON.stringify(result,null,2);assert(!serialized.includes(password));await writeFile(join(root,'result.json'),serialized);
  console.log(JSON.stringify({root,status:result.status,checks:result.checks.length,error:result.error}));
}
