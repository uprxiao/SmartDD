// Real packaged UI acceptance for P02. Only setup uses a host-side private
// PackageRegistry fixture; inspections/confirmation/cleanup run through actual UI.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {release} from 'node:os';
import {openElectron} from '../lib/electron-harness.mjs';
import {installAppFocusGuard,isAppFocusYield} from '../lib/app-focus-guard.mjs';
import {compileApplicationFixture} from '../lib/compile-application-fixture.mjs';
const executable=process.env.WILLYOU_ACCEPTANCE_APP;assert(executable);
const wholeT71=process.env.WILLYOU_T71_COMPLETE_UI==='1';
const retentionMatrix=process.env.WILLYOU_VERSION_RETENTION_MATRIX==='1';
const scratch=await mkdtemp('/private/tmp/willyou-m10-versions-ui-'),userData=join(scratch,'userdata');
const home=join(scratch,'home');await mkdir(home);const privateEnv={HOME:home,ZDOTDIR:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude')};
const sha=b=>createHash('sha256').update(b).digest('hex');
const result={schema:'m10-version-partial-packaged-ui-v1',startedAt:new Date().toISOString(),branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),layer:'A: actual packaged App; private old-version precondition, no account/provider/Agent',app:resolve(executable),asarSha256:sha(await readFile(resolve(dirname(executable),'../Resources/app.asar'))),system:{platform:process.platform,arch:process.arch,release:release()},scratch,userData,checks:[],status:'running'};
let app,stage='bootstrap';
result.retentionMatrix=retentionMatrix;result.home=home;result.isolation='Fresh explicit userData and HOME; no CLI/provider/account/secret operation';
assert(process.env.WILLYOU_ACCEPTANCE_ASAR_SHA,'Pin the actual ASAR before acceptance');assert.equal(result.asarSha256,process.env.WILLYOU_ACCEPTANCE_ASAR_SHA);
async function start(){const value=await openElectron({executable,userData,env:privateEnv});installAppFocusGuard(value,result);return value;}
async function fixture(mode){const setup=execFileSync(executable,[join(scratch,'setup/prepare.cjs'),userData,mode??'',result.projectId??'',home],{env:{...process.env,...privateEnv,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:resolve('node_modules')},encoding:'utf8',timeout:20000});return JSON.parse(setup.trim().split('\n').at(-1));}
const checked=(name,detail={})=>{result.checks.push({name,passed:true,at:new Date().toISOString(),...detail});};
async function point(selector,text){return app.evaluate(`(()=>{const e=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(x=>${text===undefined?'true':`x.textContent.trim()===${JSON.stringify(text)}`}&&x.getBoundingClientRect().width&&x.getBoundingClientRect().height);if(!e)throw Error('Control missing');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked');return{x,y};})()`);}
async function click(selector,text){result.lastAction={selector,text};await app.waitFor("document.getAnimations().every(a=>a.playState!=='running'||a.effect?.getTiming().iterations===Infinity)");await point(selector,text);await app.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const p=await point(selector,text);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});}
const wait=text=>app.waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`,20000);
const versions=async()=>{const value=await app.invoke('applications.versions','zentao');assert(value.ok,value.message);return value.value;};
async function detail(){await app.evaluate(`document.title='A · M10 · isolated version acceptance';true`);await click('[data-testid=nav-apps]');await wait('连接应用，让 WillYou');await click('.m10-catalog-open');await wait('版本与占用');await app.waitFor(`document.querySelector('.m10-versions')?.innerText.includes('完整性已核对')===true`,20000);}
async function setTheme(theme){await app.invoke('appSettings.update','theme',theme);const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${origin}&&document.readyState==='complete'&&!!document.querySelector('[data-testid=nav-apps]')`,20000);(result.themeSetups??=[]).push({method:'App settings RPC plus real navigation; theme switching itself is not a tested UI action',theme});}
async function inspectT71Themes(phase){
 if(!wholeT71)return;
 result.completeT71Inventories??=[];
 for(const theme of ['ydark','ylight']){
  await setTheme(theme);await detail();const value=await versions();
  const state={phase,theme,inventory:value,referenceDialogs:[]};result.completeT71Inventories.push(state);
  assert(value.items.find(i=>i.packageHash===result.setup.currentHash)?.defaultForNewSessions);
  for(const item of result.setup.retained??[]){const row=value.items.find(i=>i.packageHash===item.packageHash);assert(row&&row.activeRunCount===0&&!row.canCleanup);if(phase!=='unknown')assert.equal(row.sessionRefCount+row.tombstoneRefCount,1);}
  if(phase==='before-cleanup'){
   for(const item of [{version:'0.9.0',deleted:null},...(result.setup.retained??[])]){
    const trigger='.m10-versions button';await click(trigger,'查看引用 v'+item.version);await wait('版本 v'+item.version+' 的引用');await wait(item.deleted===null?'没有已确认的会话引用':item.deleted?'删除后保留':'会话保留');
    const view=await app.evaluate(`(()=>{const d=document.querySelector('dialog'),r=d.getBoundingClientRect();return{text:d.innerText,scrollWidth:d.scrollWidth,clientWidth:d.clientWidth,insideWindow:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}})()`);assert(view.insideWindow&&view.scrollWidth<=view.clientWidth+1);state.referenceDialogs.push({version:item.version,...view});await app.screenshot(join(scratch,'pv-'+phase+'-'+theme+'-refs-'+item.version+'.png'));
    for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:53});await app.waitFor('!document.querySelector("dialog")');assert.equal(await app.evaluate(`document.activeElement?.textContent.trim()===${JSON.stringify('查看引用 v'+item.version)}`),true);
   }
  }
  if(phase==='after-cleanup')assert.equal(value.items.find(i=>i.packageHash===result.setup.oldHash).state,'removed');
  if(phase==='unknown')assert(value.items.every(i=>!i.canCleanup));
  state.text=await app.evaluate('document.querySelector(".m10-versions").innerText');await app.screenshot(join(scratch,'pv-'+phase+'-'+theme+'.png'));checked('T71 '+phase+' '+theme+' five-category inventory,default/history/tombstone/removed-or-unused/unknown rules;reference Escape returns exact original action');
 }
}
try{
 app=await start();await app.evaluate(`document.title='A · M10 · isolated version acceptance';true`);await app.waitFor(`!!document.querySelector('[data-testid=nav-apps]')`);assert((await versions()).items.some(v=>v.defaultForNewSessions));if(retentionMatrix){const p=await app.invoke('projects.create',{name:'Synthetic version retention UI',aliases:[],description:'No real CLI history',rulesPath:null});result.projectId=p.id;}await writeFile(join(scratch,'bootstrap-electron.log'),app.logs());assert.deepEqual(app.rendererErrors,[]);await app.close();app=null;
 const setupDir=join(scratch,'setup');
 result.setupLoader=await compileApplicationFixture({entry:'scripts/applications/fixtures/version-precondition.ts',output:join(setupDir,'prepare.cjs')});
 result.setup=await fixture(retentionMatrix?'retention-matrix':undefined);
 app=await start();await app.evaluate(`document.title='A · M10 · isolated version acceptance';true`);await app.waitFor(`!!document.querySelector('[data-testid=nav-apps]')`);await app.evaluate(`document.title='A · M10 · isolated version acceptance';true`);stage='inventory';await setTheme('ydark');await detail();
 const before=await versions();assert.equal(before.items.length,retentionMatrix?4:2);result.inventoryBefore=before;const old=before.items.find(i=>i.packageHash===result.setup.oldHash),current=before.items.find(i=>i.packageHash===result.setup.currentHash);assert(old?.canCleanup);assert(current?.defaultForNewSessions&&!current.canCleanup);assert.equal(await app.evaluate(`Array.from(document.querySelectorAll('.m10-versions button')).some(b=>b.innerText===${JSON.stringify('清理版本 v'+current.version)})`),false);await app.screenshot(join(scratch,'versions-dark.png'));checked('P02 actual UI shows old/default versions, verified bytes and no default cleanup');
 if(retentionMatrix){
  stage='retained-history';result.retainedPackagesBefore={};
  for(const item of result.setup.retained){
   const usage=before.items.find(v=>v.packageHash===item.packageHash);assert(usage&&!usage.canCleanup&&usage.activeRunCount===0);assert.equal(usage.sessionRefCount,item.deleted?0:1);assert.equal(usage.tombstoneRefCount,item.deleted?1:0);assert(usage.retentionReasons.includes(item.deleted?'已删除任务保留的原生历史引用':'历史会话引用'));assert(!usage.retentionReasons.includes('历史资源保留原因待核查'));
   const selector='.m10-version-row';assert(await app.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.querySelector('strong')?.textContent.startsWith(${JSON.stringify('v'+item.version)}))?.textContent.includes('0 个运行占用')`));assert.equal(await app.evaluate(`Array.from(document.querySelectorAll('.m10-versions button')).some(b=>b.innerText===${JSON.stringify('清理版本 v'+item.version)})`),false);
   await click('.m10-versions button','查看引用 v'+item.version);await wait('版本 v'+item.version+' 的引用');await wait(item.deleted?'删除后保留':'会话保留');assert.equal(await app.evaluate("Array.from(document.querySelectorAll('dialog button')).filter(b=>b.textContent==='打开原任务').length"),item.deleted?0:1);await app.screenshot(join(scratch,'retained-'+item.version+'.png'));await click('dialog button','关闭');
   const manifest=JSON.parse(await readFile(join(userData,'capabilities',item.relativePath,'manifest.json'),'utf8'));result.retainedPackagesBefore[item.packageHash]=Object.fromEntries(await Promise.all(manifest.files.map(async f=>[f.path,sha(await readFile(join(userData,'capabilities',item.relativePath,f.path)))])));
   checked(item.deleted?'P02 deleted-task tombstone retains one original package reference with zero running tasks and no cleanup action':'P02 retained original session keeps its package with zero running tasks and an explicit retention reason');
  }
 }
 await inspectT71Themes('before-cleanup');
 stage='references';await click('.m10-versions button','查看引用 v0.9.0');await wait('版本 v0.9.0 的引用');await wait('没有已确认的会话引用');await click('dialog button','关闭');checked('P02 actual UI opens original version reference inspection without creating a task');
 stage='cancel';await click('.m10-versions button','清理版本 v0.9.0');await wait('清理版本 v0.9.0');assert(existsSync(join(userData,'capabilities',result.setup.oldRelativePath)));await click('dialog button','取消');assert((await versions()).items.find(i=>i.packageHash===old.packageHash).canCleanup);assert(existsSync(join(userData,'capabilities',result.setup.oldRelativePath)));checked('P02 cancel leaves the original package and registry ready');
 stage='light';await setTheme('ylight');await detail();await app.screenshot(join(scratch,'versions-light.png'));checked('P02 light-theme version inventory renders actual same package data',{themePrecondition:'settings RPC, not theme interaction acceptance'});
 stage='cleanup';await click('.m10-versions button','清理版本 v0.9.0');await wait('清理版本 v0.9.0');await click('dialog button','确认清理版本');await wait('已清理版本文件');await wait('文件已清理');const after=await versions();assert.equal(after.items.find(i=>i.packageHash===old.packageHash).state,'removed');assert(after.items.find(i=>i.packageHash===current.packageHash).defaultForNewSessions);assert(!existsSync(join(userData,'capabilities',result.setup.oldRelativePath)));assert.equal(await app.evaluate(`Array.from(document.querySelectorAll('.m10-versions button')).some(b=>b.innerText==='清理版本 v0.9.0')`),false);await app.screenshot(join(scratch,'versions-cleaned.png'));checked('P02 confirmed actual UI cleanup removes only old source bytes and retains permanent identity/default');
 await inspectT71Themes('after-cleanup');
 assert.deepEqual(app.rendererErrors,[]);await writeFile(join(scratch,'first-electron.log'),app.logs());await app.close();app=null;stage='restart';app=await start();await app.evaluate(`document.title='A · M10 · isolated version acceptance';true`);await app.waitFor(`!!document.querySelector('[data-testid=nav-apps]')`);await detail();await wait('文件已清理');const reopened=await versions();assert.equal(reopened.items.find(i=>i.packageHash===old.packageHash).state,'removed');assert(reopened.items.find(i=>i.packageHash===current.packageHash).defaultForNewSessions);assert.deepEqual(app.rendererErrors,[]);await app.screenshot(join(scratch,'versions-restarted.png'));checked('P02 same isolated userData retains cleaned identity and unchanged default after test relaunch');
 if(retentionMatrix){
  for(const item of result.setup.retained){const usage=reopened.items.find(v=>v.packageHash===item.packageHash);assert(usage&&!usage.canCleanup&&usage.activeRunCount===0);for(const [file,hash] of Object.entries(result.retainedPackagesBefore[item.packageHash]))assert.equal(sha(await readFile(join(userData,'capabilities',item.relativePath,file))),hash);}
  checked('P02 cleanup and App restart preserve both complete retained package payloads and original references without manufacturing a running lease');await writeFile(join(scratch,'before-hold.log'),app.logs());await app.close();app=null;
  stage='unverified-history';result.holdSetup=await fixture('hold-only');app=await start();await detail();await wait('历史资源保留原因待核查');const held=await versions();result.inventoryHeld=held;assert(held.items.every(i=>!i.canCleanup));assert(held.items.filter(i=>i.state!=='removed').every(i=>i.retentionReasons.includes('历史资源保留原因待核查')));assert.equal(await app.evaluate("Array.from(document.querySelectorAll('.m10-versions button')).filter(b=>b.textContent.startsWith('清理版本 v')).length"),0);await app.screenshot(join(scratch,'versions-unverified.png'));const tasks=await app.invoke('tasks.list',{includeArchived:true});assert(tasks.every(t=>!t.ptyId));checked('P02 unknown history keeps all original versions, displays the pending reason and exposes no ordinary cleanup action; no Agent starts');
 }
 await inspectT71Themes('unknown');
 result.status='passed-partial';
}catch(error){result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=isAppFocusYield(error)?2:1;if(app)try{result.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(scratch,'failure.png'));}catch{}}
finally{if(app){result.rendererErrors=app.rendererErrors;await writeFile(join(scratch,'last-electron.log'),app.logs());await app.close();}result.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks.length,failedStage:result.failedStage,error:result.error,artifacts:scratch}));}
