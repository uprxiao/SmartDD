// T21 original UI transaction, isolated local source and native Save/Open.
// This is a partial case: no send history, external account or new native session.
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, dirname, resolve} from 'node:path';
import {openElectron} from '/Users/hx/hx/hxWork/SmartDD/scripts/lib/electron-harness.mjs';
import {installAppFocusGuard, isAppFocusYield} from '/Users/hx/hx/hxWork/SmartDD/scripts/lib/app-focus-guard.mjs';
import {compileApplicationFixture} from '/Users/hx/hx/hxWork/SmartDD/scripts/lib/compile-application-fixture.mjs';

const permissionRoot='/private/tmp/willyou-m10-ub-20261030';
const permission=JSON.parse(await readFile(join(permissionRoot,'keychain-approval.json'),'utf8'));
assert(permission.approved===true&&permission.scope==='UB_T21_APP_HOME_KEYCHAIN_ONLY_20261030'&&permission.source==='explicit-user-reply'&&permission.replyText==='允许本次受保护的钥匙串验证'&&permission.questionReference?.length>8,'Actual scoped user reply required');
const prior=JSON.parse(await readFile('/private/tmp/willyou-m10-transfer-ub-HuHJez/result.json','utf8'));assert(prior.status==='passed-existing-target-ui-subset'&&prior.exit?.code===0&&prior.artifact,'Only resume after the known directory-mapping fixture failure and confirmed original export/terminal exit');
const resumeAudit=JSON.parse(await readFile('/private/tmp/willyou-m10-ue-20261030/preflight.json','utf8'));assert(resumeAudit.previousPidAbsent&&resumeAudit.counts.projects===2&&resumeAudit.counts.project_import_receipts===0&&resumeAudit.counts.tasks===0,'Current verified stopped/non-committed target required');
await writeFile(join(permissionRoot,'keychain-execution-claim-8.json'),JSON.stringify({scope:permission.scope,questionReference:permission.questionReference,at:new Date().toISOString(),pid:process.pid})+'\n',{flag:'wx',mode:0o600});

const executable = process.env.WILLYOU_ACCEPTANCE_APP;
const pin = process.env.WILLYOU_ACCEPTANCE_ASAR_SHA;
assert(executable?.startsWith('/private/tmp/willyou-m10-') && pin);
const sha = value => createHash('sha256').update(value).digest('hex');
const asar = resolve(dirname(executable), '../Resources/app.asar');
assert.equal(sha(await readFile(asar)), pin);
const root='/private/tmp/willyou-m10-transfer-ub-noconn-Eo45SD';
const previousTarget=JSON.parse(await readFile(join(root,'result.json'),'utf8')),outcome=JSON.parse(await readFile(join(permissionRoot,'no-connection-first-outcome.json'),'utf8'));assert(previousTarget.status==='failed'&&previousTarget.error.includes('Input.dispatchMouseEvent timed out')&&outcome.newImportedProjectAbsent&&outcome.importReceiptsAbsent,'Verified prior non-commit required');
const userData = join(root, 'userdata'), home = join(root, 'home'), codeDirectory = join(root, 'imported-code');
await mkdir(home, {mode: 0o700,recursive:true});
await mkdir(codeDirectory, {mode: 0o700,recursive:true});
const env = {HOME: '/Users/hx', ZDOTDIR: home, CODEX_HOME: join(home, '.codex'),
  CLAUDE_CONFIG_DIR: join(home, '.claude'), HTTP_PROXY: 'http://127.0.0.1:1',
  HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1,localhost'};
for (const key of Object.keys(process.env)) if (!['PATH','TMPDIR','LANG','LC_ALL'].includes(key)) delete process.env[key];
const sourceRoot='/private/tmp/willyou-m10-transfer-ub-HuHJez';
const password=JSON.parse(await readFile(join(sourceRoot,'.transfer-fixture-secret.json'),'utf8')).password;
// Private generated fixture secret only; never included in result/archive.
assert.equal(JSON.parse(await readFile(join(root,'.transfer-fixture-secret.json'),'utf8')).password,password,'Retain the original owned fixture secret unchanged');
const result = {root, userData, app: executable, asar: pin, startedAt: new Date().toISOString(),
  status: 'running', layer: 'A original packaged export/import UI/native panels; I own local source setup and decrypt assertions',
  isolation: {freshUserData: false, continuedVerifiedTarget: true, isolatedAgentRoots: true, freshAppHome: false, systemHomeOnlyForNativeKeychain: true,
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
  const sequence = result.panels.length, ack = join(root, 'native-r4-'+sequence+'.json');
  const row = {kind,path,sequence,ack,pid:app.processId,app:executable,at:new Date().toISOString()}; result.panels.push(row);
  await writeFile(join(root,'progress-r4.json'), JSON.stringify(row,null,2));
  console.log(JSON.stringify({root,stage,native:row}));
  const end = Date.now()+600000;
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
  const forbidden=['aiProfiles.importZshrc','aiProfiles.create','tasks.create','tasks.open','applications.replyDraft','applications.importAttachment','applications.captureAttachment','applications.prepareSend','applications.reviewSend','applications.authorizeSend','applications.executeSend','app.openExternal'];
  await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own T21 only');const g={records:[],originals:[],forbidden:[]},map=E.ipcMain._invokeHandlers;for(const n of ['projectTransfer.describeExport','projectTransfer.export','projectTransfer.chooseImport','projectTransfer.unlock','projectTransfer.validateDraft','projectTransfer.pickDirectory','projectTransfer.commit','projectTransfer.dispose']){const f=map.get(n);assertFunction(f);g.originals.push([n,f]);map.set(n,async function(event,...args){const row={name:n,at:Date.now()};g.records.push(row);row.reply=await f.call(this,event,...args);row.returnedAt=Date.now();return row.reply;});}for(const n of ${JSON.stringify(forbidden)}){const f=map.get(n);if(f){g.originals.push([n,f]);map.set(n,()=>{g.forbidden.push(n);throw Error('T21 transaction-only forbidden action');});}}function assertFunction(f){if(typeof f!=='function')throw Error('Original transfer handler missing');}g.restore=()=>{for(const[n,f]of g.originals)map.set(n,f);};globalThis.__twTransfer=g;const w=E.BrowserWindow.getAllWindows();if(w.length!==1)throw Error('Own single window');w[0].setTitle('A · T21 UE no-connection · PID '+process.pid);w[0].show();E.app.focus({steal:false});w[0].focus();w[0].webContents.focus();return true})()`);
  const project=previousTarget.project;result.project=project;result.peer=previousTarget.peer;const source=join(root,'synthetic-foxmail');assert.equal(sql('SELECT count(*) n FROM projects')[0].n,2);assert.equal(sql('SELECT count(*) n FROM project_import_receipts')[0].n,0);assert.equal(sql('SELECT count(*) n FROM tasks')[0].n,0);
  const before=snapshot(); result.beforeSummary=Object.fromEntries(Object.entries(before).map(([key,value])=>[key,value.length]));
  const peerBefore=await app.invoke('projects.get',result.peer.id);
  const origin=await app.evaluate('performance.timeOrigin'); await app.cdp('Page.reload');
  await app.waitFor('performance.timeOrigin!=='+origin+'&&!!document.querySelector("[data-testid=sidebar-project-more]")',15000,{navigation:true});
  await control('attach-before-dialog');
  await app.waitFor('document.hasFocus()&&document.visibilityState==="visible"',5000);
  const exportPath=join(sourceRoot,'tw-project.willyou'),original=JSON.parse(await readFile(join(sourceRoot,'result.json'),'utf8'));assert.equal(sha(await readFile(exportPath)),original.artifact.sha256);result.artifact={...original.artifact,sourceResultSha256:sha(await readFile(join(sourceRoot,'result.json')))};assert.equal(before.application_connections.length,0);
  stage='import-no-connection'; await click('[data-testid=sidebar-new-project]'); await click('[role=menuitem]','导入项目');
  await click('.transfer-file-choice'); await control('open',exportPath);
  await app.waitFor('!!document.querySelector("input[aria-label=导入口令]")'); await fill('input[aria-label=导入口令]',password); await click('.m8-transfer button','解锁并预览');
  await app.waitFor('!!document.querySelector("input[aria-label=导入后的项目名称]")'); await app.screenshot(join(root,'import-review-r4.png'));
  await click('button[aria-label="选择本机目录：主目录"]'); await control('directory',codeDirectory);
  await app.waitFor('document.querySelector('+JSON.stringify('input[aria-label="导入目录：主目录"]')+')?.value==='+JSON.stringify(codeDirectory));
  await control('commit-import-actual-ui',codeDirectory);
  await app.waitFor('document.querySelector(".transfer-success")?.textContent.includes("项目已导入")',30000);
  const committed=await app.mainEvaluate('globalThis.__twTransfer.records.filter(r=>r.name==="projectTransfer.commit").at(-1)'); assert(committed.reply.ok); result.imported=committed.reply.value;
  for(const appId of ['mail','zentao']) {const value=unwrap(await app.invoke('applications.projectSettings',result.imported.projectId,appId)); assert.equal(value.enabled,false);assert(Object.values(value.connections).every(v=>v===null));}
  // New project's default rows are allowed; every pre-existing M10 row remains exact.
  const after=snapshot(); for(const table of Object.keys(before)) assert.deepEqual(after[table].filter(row=>row.project_id!==result.imported.projectId),before[table]);
  assert.deepEqual(await app.invoke('projects.get',result.peer.id),peerBefore);
  await app.screenshot(join(root,'import-success-r4.png')); note('Actual native Open/decrypt/commit creates an unselected new project and preserves existing source/peer/global data');
  stage='explicit-new'; await click('.m8-transfer button','配置项目应用'); await app.waitFor('!!document.querySelector(".m10-project-apps")');
  const label='为'+result.imported.name+'启用邮件';await click('button[role=switch][aria-label='+JSON.stringify(label)+']');
  await app.waitFor('document.querySelector('+JSON.stringify('button[role=switch][aria-label="'+label+'"]')+')?.getAttribute("aria-checked")==="true"');
  const empty=unwrap(await app.invoke('applications.projectSettings',result.imported.projectId,'mail'));assert.equal(empty.connections.foxmail,null);assert.equal(empty.connections.smtp,null);
  await control('create-and-select-new-local-connection',source);
  const rows=sql("SELECT id,name,config_json FROM application_connections");assert.equal(rows.length,1);const connection=rows[0],config=JSON.parse(connection.config_json);assert.equal(config.kind,'foxmail');assert.equal(config.sourcePath,source);assert.equal(config.account,'receiver@example.test');
  result.connection={id:connection.id,name:connection.name,config};result.selected=unwrap(await app.invoke('applications.projectSettings',result.imported.projectId,'mail'));assert.equal(result.selected.connections.foxmail,connection.id);assert.equal(result.selected.connections.smtp,null);assert.equal(result.selected.enabled,true);
  assert.deepEqual(await app.invoke('projects.get',result.peer.id),peerBefore);for(const table of Object.keys(before)){const after=snapshot()[table];for(const row of before[table])assert(after.some(v=>JSON.stringify(v)===JSON.stringify(row)),'Original target row changed: '+table);}
  await app.screenshot(join(root,'explicit-new-connection-r4.png'));note('Target without applicable connection imports through original UI,remains unbound,then UI creates/tests/saves a new local connection and explicitly selects it;original target peer/data retained');
  result.status='passed-no-connection-target-ui-subset';
} catch(error) {
  if(result.status==='running')result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';
  result.stage=stage; result.error??=String(error); result.stack=String(error.stack);
  process.exitCode=2;
  if(app)try{result.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(root,'failure-r4.png'));}catch{}
} finally {
  if(app){try{result.observed=await app.mainEvaluate('({records:globalThis.__twTransfer.records,forbidden:globalThis.__twTransfer.forbidden})');assert.deepEqual(result.observed.forbidden,[]);await app.mainEvaluate('globalThis.__twTransfer.restore();true');result.observerRestored=true;
    await writeFile(join(root,'app-r4.log'),app.logs()); await app.mainEvaluate("(()=>{setTimeout(()=>process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').app.quit(),30);return true})()");result.exit=await app.waitForExit();
  }catch(error){result.cleanupError=String(error);}await app.close();}
  result.finishedAt=new Date().toISOString();assert.equal(sha(await readFile(asar)),pin);
  const serialized=JSON.stringify(result,null,2);assert(!serialized.includes(password));await writeFile(join(root,'result-r4.json'),serialized);
  console.log(JSON.stringify({root,status:result.status,checks:result.checks.length,error:result.error}));
}
