// T60 step7/9: actual project form Save pauses at the real old host SQLite write.
// Only this private process is instrumented; both pinned App ASARs stay unchanged.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {openElectron,pause} from '../lib/electron-harness.mjs';
import {installAppFocusGuard,isAppFocusYield} from '../lib/app-focus-guard.mjs';
const old=process.env.WILLYOU_OLD_APP,current=process.env.WILLYOU_ACCEPTANCE_APP,oldPin=process.env.WILLYOU_OLD_ASAR_SHA,currentPin=process.env.WILLYOU_ACCEPTANCE_ASAR_SHA;
assert(old&&current&&oldPin&&currentPin,'Pin both private App executables and ASARs');
for(const executable of [old,current])assert(executable.startsWith('/private/tmp/willyou-m10-')&&executable.endsWith('/Contents/MacOS/WillYou'));
const root=await mkdtemp('/private/tmp/willyou-m10-ui-upgrade-'),home=join(root,'home'),userData=join(root,'userdata'),cwd=join(root,'project');
await mkdir(home);await mkdir(cwd);const hash=b=>createHash('sha256').update(b).digest('hex');
for(const name of Object.keys(process.env))if(!['PATH','TMPDIR','LANG','LC_ALL'].includes(name))delete process.env[name];
const result={root,startedAt:new Date().toISOString(),driverSha256:hash(await readFile(new URL(import.meta.url))),layer:'A: actual project form input and Save; I: current packaged diagnostic startup competing with private old-host SQL breakpoint; no account/credential/model/SMTP',checks:[],packages:[]};
let app,inspector,project,paused=false,stage='pin';let seq=0;const pending=new Map();
const sql=q=>JSON.parse(execFileSync('/usr/bin/sqlite3',['-readonly','-json',join(userData,'smartdd.db'),q],{encoding:'utf8'})||'[]');
const snapshot=()=>({projects:sql('SELECT * FROM projects ORDER BY id'),dirs:sql('SELECT * FROM project_dirs ORDER BY id'),defaults:sql('SELECT * FROM capability_active_packages ORDER BY app_id'),migrations:sql('SELECT * FROM __drizzle_migrations ORDER BY id'),operations:sql('SELECT * FROM capability_resource_operations ORDER BY operation_id')});
const check=name=>result.checks.push({name,passed:true,at:new Date().toISOString()});
async function until(work,label,timeout=15000){const end=Date.now()+timeout;do{if(await work())return;await pause(50);}while(Date.now()<end);throw Error('Timeout '+label);}
async function click(selector,{text,right=false}={}){
 const point=await app.evaluate(`(()=>{const element=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>getComputedStyle(e).visibility==='visible'&&e.getBoundingClientRect().width&&e.getBoundingClientRect().height&&${text===undefined?'true':`e.textContent.trim()===${JSON.stringify(text)}`});if(!element)throw Error('Control missing: '+${JSON.stringify(selector)});element.scrollIntoView({block:'nearest'});const r=element.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(element.matches(':disabled')||!element.contains(document.elementFromPoint(x,y)))throw Error('Control blocked: '+${JSON.stringify(selector)});return{x,y};})()`);
 for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:right?'right':'left',clickCount:1})});
}
async function editName(name){
 await click(`[data-testid=sidebar-project][data-project-id="${project.id}"]`,{right:true});await app.waitFor('!!document.querySelector("[data-testid=sidebar-project-edit]")');await click('[data-testid=sidebar-project-edit]');
 await app.waitFor('!!document.querySelector(".project-actions")');
 const label=await app.evaluate(`Array.from(document.querySelectorAll('.project-actions button')).find(e=>/编辑|Edit/.test(e.textContent))?.textContent.trim()`);assert(label,'Project edit action missing');await click('.project-actions button',{text:label});
 await app.waitFor('!!document.querySelector("#project-name")');await click('#project-name');
 for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:4,...(type==='keyDown'?{commands:['selectAll']}:{})});
 await app.cdp('Input.insertText',{text:name});assert.equal(await app.evaluate('document.querySelector("#project-name").value'),name);
 const submit=await app.evaluate(`Array.from(document.querySelectorAll('[role=dialog] button')).find(e=>/^(保存|Save)$/.test(e.textContent.trim()))?.textContent.trim()`);assert(submit,'Project save action missing');await app.screenshot(join(root,stage+'-form-before-save.png'));await click('[role=dialog] button',{text:submit});
}
async function connectInspector(){
 const url=/Debugger listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/.exec(app.logs())?.[1];assert(url);inspector=new WebSocket(url);
 await new Promise((resolve,reject)=>{inspector.addEventListener('open',resolve,{once:true});inspector.addEventListener('error',reject,{once:true});});
 inspector.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.method==='Debugger.paused'){paused=true;result.pausedReason=m.params.reason;}if(m.id&&pending.has(m.id)){const item=pending.get(m.id);pending.delete(m.id);m.error?item.reject(Error(m.error.message)):item.resolve(m.result);}});
 await rpc('Runtime.enable');await rpc('Debugger.enable');
}
async function rpc(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},10000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});inspector.send(JSON.stringify({id,method,params}));});}
async function quit(label){await writeFile(join(root,label+'.log'),app.logs());await app.mainEvaluate("(()=>{setTimeout(()=>process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').app.quit(),30);return true})()");const exit=await app.waitForExit();assert.equal(exit.code,0);result.exits??=[];result.exits.push(exit);await app.close();app=undefined;}
async function start(executable){app=await openElectron({executable,userData,cwd,env:{HOME:home},inspectMain:true});installAppFocusGuard(app,result);await app.evaluate("document.title='A · M10 T60 · 独立数据：项目保存与升级竞争';true");}
try{
 for(const [executable,pin] of [[old,oldPin],[current,currentPin]]){const asar=join(resolve(dirname(executable),'../Resources'),'app.asar');assert.equal(hash(await readFile(asar)),pin);result.packages.push({executable,asar:pin});}
 await start(old);stage='prerequisite';project=await app.invoke('projects.create',{name:'T60 原项目',aliases:['private-upgrade-fixture'],description:'UI write competition',rulesPath:null},[{label:'private',path:cwd}]);result.projectId=project.id;
 await app.cdp('Page.reload');await app.waitFor(`!!document.querySelector('[data-testid=sidebar-project][data-project-id="${project.id}"]')`);result.before=snapshot();
 stage='arm-private-breakpoint';await connectInspector();
 const asar=join(resolve(dirname(old),'../Resources'),'app.asar');
 const injection=`(()=>{const req=process.getBuiltinModule('module').createRequire(${JSON.stringify(join(asar,'package.json'))}),Database=req('better-sqlite3'),original=Database.prototype.prepare;globalThis.__m10UiWriteGate={original,hit:false};Database.prototype.prepare=function(sql){const stmt=original.call(this,sql);if(/^update\\s+"?projects"?\\s+set\\s+/i.test(sql)){const run=stmt.run;stmt.run=function(...args){if(!globalThis.__m10UiWriteGate.hit&&JSON.stringify(args).includes(${JSON.stringify(project.id)})){globalThis.__m10UiWriteGate.hit=true;debugger;}return run.apply(this,args);};}return stmt;};return true})()`;
 const armed=await rpc('Runtime.evaluate',{expression:injection,returnByValue:true});assert(!armed.exceptionDetails,JSON.stringify(armed.exceptionDetails));assert.equal(armed.result.value,true);
 stage='actual-old-ui-save';let editFailure;const pendingEdit=editName('T60 UI保存后保留').catch(error=>{editFailure=error;});await until(()=>{if(editFailure)throw editFailure;return paused;},'real project SQLite update breakpoint');result.atCheckpoint=snapshot();assert.deepEqual(result.atCheckpoint,result.before);check('Actual old App project form Save reached its own real SQLite update; committed business/default/migration/operation rows still unchanged');
 stage='competing-new-host';let failure;
 try{await promisify(execFile)(current,[],{env:{...process.env,HOME:home,SMARTDD_USER_DATA:userData,SMARTDD_PROBE:'1'},timeout:15000,maxBuffer:1024*1024});}catch(error){failure=error;}
 assert.equal(failure?.code,1);assert.match(failure.stderr,/其他进程仍打开此数据库|仍有宿主使用数据库/);await writeFile(join(root,'competing-new-rejection.log'),failure.stderr);assert.deepEqual(snapshot(),result.before);check('Current real packaged startup rejected migration while the actual old UI write was paused; no backup/upgrade/default or business changes');
 stage='release-old-ui-save';await rpc('Debugger.resume');paused=false;await pendingEdit;if(editFailure)throw editFailure;await app.waitFor('!document.querySelector("#project-name")');await until(()=>sql(`SELECT name FROM projects WHERE id='${project.id}'`)[0]?.name==='T60 UI保存后保留','actual UI save commit');
 const restored=await rpc('Runtime.evaluate',{expression:'(()=>{const req=process.getBuiltinModule("module").createRequire('+JSON.stringify(join(asar,'package.json'))+');req("better-sqlite3").prototype.prepare=globalThis.__m10UiWriteGate.original;delete globalThis.__m10UiWriteGate;return true})()',returnByValue:true});assert(!restored.exceptionDetails);await rpc('Debugger.disable');inspector.close();inspector=undefined;
 result.afterOldSave=snapshot();assert.deepEqual(result.afterOldSave.defaults,result.before.defaults);assert.deepEqual(result.afterOldSave.migrations,result.before.migrations);assert.deepEqual(result.afterOldSave.operations,result.before.operations);check('Resuming the original UI operation committed the requested name once; original host remained usable after rejected upgrade');await app.screenshot(join(root,'old-ui-save-complete.png'));await quit('old-normal-exit');
 stage='upgrade-after-ui-settles';await start(current);result.afterUpgrade=snapshot();assert.deepEqual(result.afterUpgrade.projects,result.afterOldSave.projects);assert.deepEqual(result.afterUpgrade.dirs,result.afterOldSave.dirs);assert.equal(result.afterUpgrade.migrations.length,29);assert.equal(result.before.migrations.length,27);for(const row of result.afterUpgrade.defaults)assert.equal(row.activation_generation,result.before.defaults.find(v=>v.app_id===row.app_id).activation_generation+1);check('After actual old UI work completed and host exited, current host upgraded once while retaining the exact committed project/directory rows');
 stage='actual-current-ui-save';await editName('T60 新版UI写入保留');await app.waitFor('!document.querySelector("#project-name")');await until(()=>sql(`SELECT name FROM projects WHERE id='${project.id}'`)[0]?.name==='T60 新版UI写入保留','current UI save');result.afterNewSave=snapshot();await app.screenshot(join(root,'new-ui-save.png'));check('Current upgraded App completed a second real project form Save');await quit('new-normal-exit');
 stage='restart-current';await start(current);assert.deepEqual(snapshot(),result.afterNewSave);check('Current host restart retained the post-upgrade UI write and exact activation/default/migration rows without replay');await quit('new-restart-exit');
 for(const {executable,asar:pin}of result.packages)assert.equal(hash(await readFile(join(resolve(dirname(executable),'../Resources'),'app.asar'))),pin);
 result.status='passed-partial';result.remaining=['T60 actual index and TaskService preparation competition plus original ten-step coverage audit','Fault gate was a private main-process SQL debugger breakpoint; this is not an uninstrumented timing race or native error-dialog visual acceptance'];
}catch(error){result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=isAppFocusYield(error)?2:1;}
finally{
 if(inspector){if(paused)try{await rpc('Debugger.resume');}catch{}inspector.close();}
 if(app){result.rendererErrors=app.rendererErrors;await writeFile(join(root,'final-app.log'),app.logs());try{result.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(root,'final-state.png'));}catch{}await app.close();}
 result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,stage,checks:result.checks.length,error:result.error,result:join(root,'result.json')}));
}
