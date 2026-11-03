// S2 representative real packaged UI preflight. Project/task/profile creation is
// fixture setup; browser/file operations below use actual UI input.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,dirname,resolve} from 'node:path';
import {openElectron} from '../lib/electron-harness.mjs';
import {focusNewInstalledWindow} from '../applications/fixtures/dmg-install-ui.mjs';
import {installAppFocusGuard,isAppFocusYield} from '../lib/app-focus-guard.mjs';
import {press} from '../files/keyboard-ax-lib.mjs';
import {browserPageUI} from './page-ui.mjs';
const [root,executable,expectedAsar]=process.argv.slice(2);
const scrollRepro=process.argv[5]==='scroll-repro',scrollOnly=scrollRepro||process.argv[5]==='scroll-only';
assert(root?.startsWith('/private/tmp/willyou-m12-s2-')&&executable?.startsWith('/private/tmp/willyou-m12-s2-'));await access(executable);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');assert.equal(sha(await readFile(join(resolve(dirname(executable),'../Resources'),'app.asar'))),expectedAsar);
await mkdir(root,{recursive:false});const userData=join(root,'userdata'),cwd=join(root,'project'),home=join(root,'home'),state=join(root,'codex'),command=join(root,'fixture-agent'),pidFile=join(root,'terminal-pids.txt');
for(const path of [cwd,home,state,join(cwd,'.git')])await mkdir(path,{recursive:true});
const fixtureText='# M12 file fixture\n\n'+Array.from({length:800},(_,i)=>`fixture-line-${i}\n`).join('');await writeFile(join(cwd,'fixture.txt'),fixtureText);
await writeFile(command,'#!/usr/bin/python3\nimport os,sys,re\nif "--version" in sys.argv:\n print("codex-cli 99.0.0")\nelif "exec" in sys.argv:\n match=re.search(r"SMARTDD-OK-[0-9a-f]{8}"," ".join(sys.argv))\n if not match:sys.exit(70)\n print(match.group())\nelif sys.argv[1:2]==["--m12-ui-fixture"]:\n with open('+JSON.stringify(pidFile)+',"a") as f:f.write(str(os.getpid())+"\\n")\n print("M12 UI terminal precondition: sleep 600",flush=True)\n os.execv("/bin/sleep",["sleep","600"])\nelse:sys.exit(70)\n',{mode:0o700});
const result={schema:'m12-s2-navigation-ui-v1',startedAt:new Date().toISOString(),root,userData,asarSha256:expectedAsar,scrollOnly,formal:scrollRepro||process.argv[5]==='formal',layer:'A real packaged UI; controlled private sleep process is not a real Agent R',checks:[],observations:{},actions:[],requests:[],fileSwitches:[],taskSwitches:[]};
const sockets=new Set(),server=createServer((req,res)=>{
 result.requests.push({url:req.url,method:req.method,cacheControl:req.headers['cache-control']??null,at:Date.now()});
 const u=new URL(req.url,'http://fixture');
 if(u.pathname==='/redirect'){res.writeHead(301,{location:'/a?redirected'});res.end();return;}
 if(u.pathname==='/file-redirect'){res.writeHead(302,{location:'file:///etc/hosts'});res.end();return;}
 if(u.pathname==='/icon.png'){res.setHeader('content-type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));return;}
 res.setHeader('content-type','text/html; charset=utf-8');
 const html='<!doctype html><title>'+ (u.pathname==='/b'?'Page B':'Page A')+'</title><h1>M12 local fixture</h1><input aria-label="fixture form"><p>Find needle needle</p><button id="title" onclick="document.title=\'Changed title\';const l=document.createElement(\'link\');l.rel=\'icon\';l.href=\'/icon.png\';document.head.append(l)">Change title</button><a id="external" href="willyoutest://x">External protocol</a><a id="javascript" href="javascript:document.body.dataset.javascript=1">Javascript link</a><a id="data" href="data:text/html,forbidden">Data link</a><a id="file" href="file:///etc/hosts">Forbidden file</a>'+(u.pathname==='/file-script'?'<script>location.href="file:///etc/hosts"</script>':'');
 if(u.pathname==='/slow'){setTimeout(()=>{if(!res.destroyed)res.end(html);},5000).unref();return;}res.end(html);
});server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise(r=>server.listen(0,'127.0.0.1',r));const site='http://127.0.0.1:'+server.address().port;
let app,t1,t2,stage='fixtures';
const persist=()=>writeFile(join(root,'live.json'),JSON.stringify({...result,stage,pid:app?.processId},null,2)+'\n');
const poll=async(fn,timeout=15000)=>{const end=Date.now()+timeout;let value;do{value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,80));}while(Date.now()<end);throw Error('Timeout at '+stage);};
async function click(selector,text){
 const geometry=()=>app.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().height&&${text===undefined?'true':`e.textContent.trim()===${JSON.stringify(text)}`});if(!e)throw Error('Control missing');e.scrollIntoView({behavior:'instant',block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked');return{x,y}})()`);
 const p=await geometry();await app.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.deepEqual(await geometry(),p);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});result.actions.push({stage,kind:'click',selector,text});await persist();
}
const snapshot=id=>app.invoke('browser.snapshot',{taskId:id});
const model="document.querySelector('.fw-editor-host .cm-content')?.cmTile?.root?.view";
const fileState=()=>app.evaluate(`(()=>{const v=${model};return v?{text:v.state.doc.toString(),top:v.scrollDOM.scrollTop}:null})()`);
const pidIdentity=pid=>execFileSync('/bin/ps',['-p',String(pid),'-o','pid=,lstart=,comm='],{encoding:'utf8'}).trim();
async function taskObservation(taskId,round){return{round,taskId,browser:await snapshot(taskId),ui:await app.evaluate("({address:document.querySelector('[aria-label=网页地址]')?.value,selectedTask:document.querySelector('[data-testid=sidebar-task][aria-current=page]')?.dataset.taskId,selectedTabs:[...document.querySelectorAll('.fw-tabs [aria-selected=true]')].map(e=>e.textContent)})")};}
async function task(id){await click('[data-testid="sidebar-task"][data-task-id="'+id+'"]');await app.waitFor("!!document.querySelector('[data-testid=task-new-browser]')",10000);if(await app.evaluate("!!document.querySelector('[data-testid=task-resume]')")){await click('[data-testid=task-resume]');await app.waitFor("[...document.querySelectorAll('.xterm-screen')].some(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0)",10000);}}
async function newTab(id){const count=(await snapshot(id)).tabs.length;await click('[data-testid=task-new-browser]');const state=await poll(async()=>{const s=await snapshot(id);return s.tabs.length===count+1&&s.activeId?s:null;});await app.waitFor("!!document.querySelector('[aria-label=网页地址]')",10000);return state;}
async function address(id,url){await click('[aria-label="网页地址"]');for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:4,...(type==='keyDown'?{commands:['selectAll']}:{})});await app.cdp('Input.insertText',{text:url});await press(app,'Enter');result.actions.push({stage,kind:'address',value:url});await persist();return poll(async()=>{const s=await snapshot(id),tab=s.tabs.find(t=>t.id===s.activeId);return tab?.url===url&&!tab.loading?s:null;});}
async function nativeViews(){return app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own App only');return E.webContents.getAllWebContents().map(w=>({id:w.id,url:w.getURL(),type:w.getType()}))})()`);}
try{
 app=await openElectron({executable,userData,cwd,env:{HOME:home,CODEX_HOME:state},inspectMain:true});result.appPid=app.processId;await persist();
 const project=await app.invoke('projects.create',{name:'M12 S2 isolated',aliases:[],description:'Synthetic fixture',rulesPath:null},[{label:'fixture',path:cwd}]);result.projectId=project.id;
 const profile=await app.invoke('aiProfiles.create',{name:'S2 controlled terminal only',runner:'codex',executable:command,args:['--m12-ui-fixture'],env:[{name:'HOME',value:home,secret:false},{name:'CODEX_HOME',value:state,secret:false}],color:null,isDefault:true});
 await poll(async()=>!(await app.invoke('aiProfiles.get',profile.id)).checking,45000);
 t1=await app.invoke('tasks.create',{projectId:project.id,dirId:null,aiProfileId:profile.id,firstMessage:'M12 S2 T1'});t2=await app.invoke('tasks.create',{projectId:project.id,dirId:null,aiProfileId:profile.id,firstMessage:'M12 S2 T2'});result.taskIds=[t1.task.id,t2.task.id];result.initialPty=t1.ptyId;result.initialPids=await poll(async()=>{try{const ids=(await readFile(pidFile,'utf8')).trim().split('\n').map(Number);return ids.length>=2?ids:null;}catch{return null;}});await persist();
 await app.invoke('tasks.rename',t1.task.id,'M12 S2 T1');await app.invoke('tasks.rename',t2.task.id,'M12 S2 T2');
 stage='setup-reload';const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${origin}&&document.readyState==='complete'&&!!document.querySelector('[data-testid=nav-settings]')`,20000,{navigation:true});await focusNewInstalledWindow(app,userData,result);installAppFocusGuard(app,result,{allowOwnedViews:true});
 result.initialPidIdentities=result.initialPids.map(pid=>({pid,identity:pidIdentity(pid)}));
 if(!await app.evaluate(`!!document.querySelector('[data-testid="sidebar-task"][data-task-id="${t1.task.id}"]')`))await click('[data-testid="sidebar-project-toggle"]');await task(t1.task.id);await newTab(t1.task.id);
 const current=async()=>{const s=await snapshot(t1.task.id);return s.tabs.find(t=>t.id===s.activeId);};
 async function submit(value){await click('[aria-label="网页地址"]');const selected=await app.evaluate("(()=>{const e=document.querySelector('[aria-label=网页地址]');return{value:e.value,start:e.selectionStart,end:e.selectionEnd}})()");await app.cdp('Input.insertText',{text:value});await press(app,'Enter');result.actions.push({stage,kind:'address',value,selected});await persist();}
 async function settled(url){return poll(async()=>{const t=await current();return t?.url===url&&!t.loading&&!t.failure?t:null;},15000);}
 async function navigate(url){await submit(url);return settled(url);}
 async function observe(name,extra={}){result.observations[name]={at:Date.now(),tab:await current(),ui:await app.evaluate("({address:document.querySelector('[aria-label=网页地址]')?.value,notice:document.querySelector('.bw-banner')?.textContent,stop:!!document.querySelector('[aria-label=停止加载]')})"),...extra};await persist();}
 stage='history';await navigate(site+'/a');await navigate(site+'/b');await click('[aria-label="后退"]');await settled(site+'/a');await observe('back');await click('[aria-label="前进"]');await settled(site+'/b');await observe('forward');
 stage='stop-load';await submit(site+'/slow');await app.waitFor("!!document.querySelector('[aria-label=停止加载]')",5000);await observe('loading');await click('[aria-label="停止加载"]');await poll(async()=>!(await current()).loading,5000);await observe('stopped');
 stage='hard-reload';await navigate(site+'/a');result.hardReloadRequestOffset=result.requests.length;await click('[aria-label="浏览器菜单"]');await click('.bw-menu-row button','强制刷新');await poll(async()=>result.requests.slice(result.hardReloadRequestOffset).some(r=>r.url==='/a'),10000);await poll(async()=>!(await current()).loading);await observe('hardReload');
 stage='redirect-title-icon';await submit(site+'/redirect');await settled(site+'/a?redirected');await observe('redirect');let page=await browserPageUI(app,site+'/a?redirected',userData);await page.click('#title');await poll(async()=>{const t=await current();return t.title==='Changed title'&&t.favicon?.startsWith('data:image/')?t:null;});await observe('titleIcon');await page.screenshot(join(root,'native-title.png'));
 stage='external-protocol';await page.click('#external');await app.waitFor("document.querySelector('.bw-banner')?.textContent.includes('是否用外部应用打开')",5000);await observe('externalPrompt');await click('.bw-banner button','取消');await app.waitFor("!document.querySelector('.bw-banner')",5000);await observe('externalCancelled');
 stage='javascript-link';await page.click('#javascript');await page.waitFor("document.body.dataset.javascript==='1'");await observe('javascript',{page:await page.evaluate("({url:location.href,executed:document.body.dataset.javascript})")});
 stage='data-link';await page.click('#data');await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await observe('data',{page:await page.evaluate("({url:location.href,executed:document.body.dataset.javascript})")});
 stage='local-file-policy';const local=join(root,'local.html');await writeFile(local,'<!doctype html><title>Local fixture</title><p id="local">Local HTML works</p>');await submit(local);await settled('file://'+local);page=await browserPageUI(app,'file://'+local,userData);await observe('localFile',{page:await page.evaluate("({url:location.href,text:document.querySelector('#local')?.textContent})")});await navigate(site+'/file-script');page=await browserPageUI(app,site+'/file-script',userData);await page.waitFor("document.readyState==='complete'");await observe('fileScript',{page:await page.evaluate("location.href")});await navigate(site+'/a');await submit(site+'/file-redirect');await poll(async()=>!(await current()).loading);await observe('fileRedirect');
 stage='failed-url-rollback';const unused=createServer();await new Promise(r=>unused.listen(0,'127.0.0.1',r));const closedPort=unused.address().port;await new Promise(r=>unused.close(r));result.failedTarget='http://127.0.0.1:'+closedPort+'/';await submit(result.failedTarget);await app.waitFor("!!document.querySelector('.bw-failure')",15000);await observe('failed',{failureText:await app.evaluate("document.querySelector('.bw-failure')?.textContent")});await app.screenshot(join(root,'load-failure.png'));
 stage='local-recovery';const recovery=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<title>Recovered</title><h1>service started</h1>');});await new Promise(r=>recovery.listen(closedPort,'127.0.0.1',r));try{await settled(result.failedTarget);await observe('recovered');}finally{recovery.closeAllConnections();await new Promise(r=>recovery.close(r));}
 await app.screenshot(join(root,'navigation.png'));result.status='passed';
}catch(error){result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error.stack??error);if(app)try{result.failureDOM=await app.evaluate('document.body.innerText');await app.screenshot(join(root,'failure.png'));}catch{}}
finally{
 if(app){for(const item of [t1,t2])if(item)try{await app.invoke('tasks.kill',item.task.id);}catch{}await writeFile(join(root,'electron.log'),app.logs());await app.close();result.appClosed=true;}
 for(const socket of sockets)socket.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));result.fixtureServerClosed=true;result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,stage,error:result.error,root}));
}
