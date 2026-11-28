// Offline only: no listener, App, model, actual native UI or credential access.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,rm,lstat,realpath,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {repo,support,exe,manifest,digest,verifyPackage,expectedArgs,makeRoot,isolation,verifyFreshLaunch,assertOnlyDecision,assertOwnPrompt,permission} from './guards.mjs';
import {html} from './fixture.mjs';
const pins=await verifyPackage(expectedArgs);
const negatives=[],positive=[];
async function reject(name,fn){await assert.rejects(async()=>fn());negatives.push(name);}
await reject('wrong bundle',()=>verifyPackage(['/private/tmp/willyou-m16-c27-build.M1DDawVE/standard/mac-arm64/WillYou.app',...expectedArgs.slice(1)]));
await reject('wrong native hash',()=>verifyPackage(expectedArgs.map((a,i)=>i===2?'0'.repeat(64):a)));
const iso=await makeRoot(),opts={userData:iso.userData,cwd:iso.root,executable:exe,env:iso.env,inspectMain:true,mockKeychainFixture:true};
try{
  assert.equal((await verifyFreshLaunch(opts)).root,iso.root);positive.push('actual pre-spawn fresh path guard');
  await reject('old attachment root',()=>{const old=iso.root.replace('permission','attachment'),x=isolation(old);return verifyFreshLaunch({...opts,userData:x.userData,cwd:old,env:x.env});});
  await reject('old candidate root',()=>{const old=iso.root.replace('-c28-','-c19-'),x=isolation(old);return verifyFreshLaunch({...opts,userData:x.userData,cwd:old,env:x.env});});
  await reject('escape',()=>verifyFreshLaunch({...opts,userData:'/private/tmp/data'}));
  await reject('alias instead of canonical root',()=>verifyFreshLaunch({...opts,userData:iso.userData.replace('/private/tmp/','/tmp/')}));
  await reject('arbitrary work dir',()=>verifyFreshLaunch({...opts,cwd:repo}));
  await reject('wrong HOME',()=>verifyFreshLaunch({...opts,env:{...opts.env,HOME:'/private/tmp'}}));
  await reject('wrong CLI home',()=>verifyFreshLaunch({...opts,env:{...opts.env,CODEX_HOME:iso.home}}));
  await reject('no explicit mock fixture',()=>verifyFreshLaunch({...opts,mockKeychainFixture:false}));
  await reject('pre-entry hook',()=>verifyFreshLaunch({...opts,startupMainHook:()=>{}}));
  await reject('restored old database',()=>verifyFreshLaunch({...opts,resume:{dbSha:'x'}}));
  await rm(iso.env.CLAUDE_CONFIG_DIR,{recursive:true});await symlink(iso.env.CODEX_HOME,iso.env.CLAUDE_CONFIG_DIR);
  await reject('symlink private subdir',()=>verifyFreshLaunch(opts));await rm(iso.env.CLAUDE_CONFIG_DIR);await import('node:fs/promises').then(({mkdir})=>mkdir(iso.env.CLAUDE_CONFIG_DIR,{mode:0o700}));
  const db=join(iso.userData,'smartdd.db'),observer=join(support,'db-observe.py'),profile='project-synthetic',origin='http://127.0.0.1:3425';
  execFileSync('/usr/bin/python3',['-c',`import sqlite3,sys
db=sqlite3.connect(sys.argv[1])
db.executescript("create table app_secrets(id text);create table ai_providers(secret_ref text);create table tasks(id text);create table agent_turns(id text);create table app_settings(key text primary key,value text);")
db.close()`,db]);
  await reject('not fresh database',()=>verifyFreshLaunch(opts));
  const readDb=mode=>JSON.parse(execFileSync('/usr/bin/python3',[observer,iso.root,db,mode],{encoding:'utf8'}));
  let x=readDb('closed');assert.equal(x.quickCheck,'ok');assert.equal(x.secretCount,0);assertOnlyDecision(x.states,profile,origin,null);
  const store=state=>execFileSync('/usr/bin/python3',['-c',`import sqlite3,sys
db=sqlite3.connect(sys.argv[1])
db.execute("insert into app_settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value",(sys.argv[2],sys.argv[3]))
db.commit();db.close()`,db,'browserProfileState.v1:'+profile,JSON.stringify(state)]);
  const allow={schemaVersion:1,certificates:[],permissions:[{origin,permission,decision:'allow',updatedAt:123}]};
  const empty={schemaVersion:1,certificates:[],permissions:[]};
  store(allow);x=readDb('live');assert.equal(assertOnlyDecision(x.states,profile,origin,'allow').updatedAt,123);positive.push('actual read-only observer synthetic SQLite allowed row');
  await reject('extra/foreign permission',()=>assertOnlyDecision([...x.states,{profileId:'foreign',state:allow}],profile,origin,'allow'));
  await reject('same permission wrong profile',()=>assertOnlyDecision(x.states,'wrong',origin,'allow'));
  await reject('same permission wrong origin',()=>assertOnlyDecision(x.states,profile,'http://127.0.0.1:3426','allow'));
  await reject('certificate exception present',()=>assertOnlyDecision([{profileId:profile,state:{...allow,certificates:[{host:'fixture.test'}]}}],profile,origin,'allow'));
  store(empty);x=readDb('closed');assert.equal(x.quickCheck,'ok');assertOnlyDecision(x.states,profile,origin,null);positive.push('actual read-only observer synthetic SQLite revoked closed DB');
  await writeFile(db+'-wal','fixture',{flag:'wx',mode:0o600});await reject('closed DB still has WAL',()=>readDb('closed'));await rm(db+'-wal');
  await reject('database observer rejects old root',()=>execFileSync('/usr/bin/python3',[observer,iso.root.replace('permission','attachment'),db,'closed'],{stdio:'ignore'}));
}finally{await rm(iso.root,{recursive:true,force:true});}

const c19=join(repo,'docs/里程碑/M16_定时任务/验收/证据/开发与候选-20261125/candidate-19-task-orphans/B08-same-document-reask');
const archived=JSON.parse(await readFile(join(c19,'archive-sha256.json'),'utf8'));
for(const name of ['driver.snapshot.mjs','B08-reask-result.json','B08-C19-reask-actual-evidence-index.json'])assert.equal(await digest(join(c19,name)),archived[name]);
const oldDriver=await readFile(join(c19,'driver.snapshot.mjs'),'utf8');
const literal=oldDriver.match(/^const html=(.+);$/m)[1];
assert.equal(new Function('return '+literal)(),html);
const body=html.match(/<script>(.+)<\/script>/)[1];new Function(body);
assert.equal((body.match(/IdleDetector\.requestPermission\(\)/g)||[]).length,1);
assert(!/\.start\(|userState|screenState|geolocation|getUserMedia|clipboard|Notification|fetch\(|XMLHttpRequest|WebSocket/i.test(body));
positive.push('exact C19 actual HTML and syntax, requestPermission only');
const actual=JSON.parse(await readFile(join(c19,'B08-reask-result.json'),'utf8'));
assert.equal(actual.status,'actual-same-document-denial-revoke-reask-pass');
const promptChecks=actual.checks.filter(c=>c.kind==='actual-application-prompt');
assert.equal(promptChecks.length,2);assert.notEqual(promptChecks[0].prompt.id,promptChecks[1].prompt.id);
for(const {prompt} of promptChecks)assertOwnPrompt(prompt,actual.initial.a,'http://127.0.0.1:3425');
await reject('actual C19 prompt with foreign page',()=>assertOwnPrompt(promptChecks[0].prompt,{...actual.initial.a,id:'other'},'http://127.0.0.1:3425'));
await reject('actual C19 prompt with extra permission',()=>assertOwnPrompt({...promptChecks[0].prompt,permissions:[permission,'other']},actual.initial.a,'http://127.0.0.1:3425'));
positive.push('retained real C19 two distinct prompts and old same-document evidence');

const m=JSON.parse(await readFile(manifest,'utf8')),hash=b=>createHash('sha256').update(b).digest('hex');
const sourceFiles=['src/main/core/browser/permissions.ts','src/main/core/browser/site-state.ts','src/main/core/browser/controller.ts','src/main/core/browser/service.ts','src/main/core/browser/workspace.ts','src/renderer/features/browser/permission-bar.tsx','src/renderer/features/browser/profile-site-states.tsx','src/renderer/features/browser/workspace.tsx','src/renderer/features/agent-tasks/workspace-panels.tsx','src/shared/ai-provider-presets.ts','src/main/core/agent/agent-task-service.ts','src/main/db/schema.ts'];
const sourceHashes={};
for(const f of sourceFiles){
  const h=await digest(join(repo,f)),expected=m.files[f]??hash(execFileSync('git',['show',m.base+':'+f],{cwd:repo,maxBuffer:5*1024*1024}));
  assert.equal(h,expected,'C28 frozen source must still match '+f);sourceHashes[f]=h;
}
const source=async f=>readFile(join(repo,f),'utf8');
const ui=await source('src/renderer/features/browser/workspace.tsx');
assert(ui.includes('data-browser-task={taskId}')&&ui.includes('data-browser-page={tabId}')&&ui.includes('aria-label="网页地址"')&&ui.includes("'刷新网页'")&&ui.includes("'关闭网页 ' + title"));
const perm=await source('src/renderer/features/browser/permission-bar.tsx');
assert(perm.includes('aria-label="站点权限请求"')&&perm.includes('Agent 无法代你允许')&&perm.includes('>允许</button>'));
const states=await source('src/renderer/features/browser/profile-site-states.tsx');
assert(states.includes('useState(currentProfile)')&&states.includes('aria-label="登录态管理"')&&states.includes('className="bw-profile-detail"')&&states.includes('rpc.browser.revokePermission')&&states.includes('>撤销</button>'));
assert((await source('src/shared/ai-provider-presets.ts')).includes("magpie: { claude: 'http://127.0.0.1:3425/', codex: 'http://127.0.0.1:3425/v1' }"));
const harness=await readFile(join(support,'isolated-electron.mjs'),'utf8');
assert(harness.indexOf('await verifyFreshLaunch(')>0&&harness.indexOf('await verifyFreshLaunch(')<harness.indexOf('const child = spawn('));
assert.equal(await digest(join(support,'front-observer')),await digest(join(repo,'release/m16-qa-support/b08-recovery/front-observer')));
assert.equal(await digest(join(support,'same-click-point.mjs')),await digest(join(repo,'release/m16-qa-support/b11-recovery/same-click-point.mjs')));
const driver=await readFile(join(support,'driver.mjs'),'utf8');
assert(driver.includes('No automated input during personal consent')&&driver.includes('if(e.closest(promptDialog)&&!allowInspect)return null')&&!driver.includes("app.invoke('browser.respondPermission")&&!driver.includes("app.invoke('browser.revokePermission"));
positive.push('frozen C28 source selectors, exact app pre-spawn path guard, provenance', 'no automated consent route or direct grant/revoke RPC');
const files=['driver.mjs','isolated-electron.mjs','guards.mjs','fixture.mjs','db-observe.py','same-click-point.mjs','front-observer','front-observer.m','preflight.mjs'];
for(const f of files.filter(f=>f.endsWith('.mjs')))execFileSync(process.execPath,['--check',join(support,f)]);
const cdp=JSON.parse(execFileSync(process.execPath,[join(repo,'scripts/lib/check-cdp-expressions.mjs'),join(support,'driver.mjs'),join(support,'isolated-electron.mjs')],{encoding:'utf8'}));
const report={schema:'B08-C28-site-permission-static-preflight',pins,sourceHashes,priorC19:archived,positive,negative:negatives,cdp,files:Object.fromEntries(await Promise.all(files.map(async f=>[f,await digest(join(support,f))]))),actualAppLaunch:false,actualNativeInput:false,modelLaunch:false,listenerStarted:false,actualUserDecision:false};
console.log(JSON.stringify(report,null,2));
