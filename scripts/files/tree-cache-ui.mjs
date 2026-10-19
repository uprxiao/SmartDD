// B19: actual packaged tree/menu input with real files and an isolated PTY.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,stat,unlink,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
import {pause} from '../lib/electron-harness.mjs';

const executable=process.env.WILLYOU_FILES_APP;assert(executable,'Set WILLYOU_FILES_APP to the packaged executable');
const scratch=await mkdtemp('/private/tmp/willyou-tree-cache-app-'),projectPath=join(scratch,'project'),userData=join(scratch,'userdata'),receiverPath=join(scratch,'receiver');
await mkdir(projectPath);await mkdir(join(projectPath,'cache'));await mkdir(receiverPath);
const sentinel=join(projectPath,'stable.txt');await writeFile(sentinel,'B19 unchanged sentinel 中文🙂\n');
let current='original.txt';await writeFile(join(projectPath,'cache',current),'Initial external fixture\n');
const sha=x=>createHash('sha256').update(x).digest('hex'),fingerprint=async p=>{const bytes=await readFile(p),s=await stat(p,{bigint:true});return{sha256:sha(bytes),inode:String(s.ino),mtimeNs:String(s.mtimeNs)}};
const resources=resolve(dirname(executable),'../Resources'),r={at:new Date().toISOString(),caseId:'M9-T-B19',executable,scratch,userData,asarSha256:sha(await readFile(join(resources,'app.asar'))),brokerSha256:sha(await readFile(join(resources,'native/willyou-files'))),before:await fingerprint(sentinel),checks:[],status:'running',boundary:'A: unchanged packaged App, native filesystem and actual tree/menu/task-stop pointer input. I: synthetic project/profile/task setup and read-only IPC/task/receiver observations. Each explicit-stale phase pauses only watch IDs observed in this own userData through original public stopWatch; no results, IPC handler or App source replacement. Running task is the existing input-only Python CLI receiver with advancing heartbeat; no model call, submitted input or claim of a specific third-party model/TUI busy indicator. Exact native query counts belong to separate integration evidence.'};
let app,task,stage='setup';const pausedScopes=new Map();
const poll=async(fn,label)=>{const until=Date.now()+10000;while(Date.now()<until){const x=await fn();if(x)return x;await pause(35)}throw Error('Timed out: '+label)};
try{
 app=await openFileAcceptanceApp({executable,projectPath,userData,name:'B19 directory cache and terminal independence'});
 const {click,waitFor,evaluate,exists,tree,invoke}=app;
 const ready=()=>waitFor("!document.querySelector('.fw-tree-status.loading')&&Boolean(document.querySelector('[role=treeitem]'))");
 const present=p=>exists(tree('cache/'+p));
 const refresh=async()=>{await click('[aria-label=文件菜单]');await click('[role=menuitem]','刷新文件和目录');await waitFor('!document.querySelector(".fw-file-menu")');await ready()};
 const receiver=async()=>JSON.parse(await readFile(join(receiverPath,'state.json'),'utf8'));
 const observe=()=>evaluate("({root:document.querySelector('.fw-root-trigger')?.title,rows:[...document.querySelectorAll('[role=treeitem]')].map(e=>({title:e.title,expanded:e.getAttribute('aria-expanded')})),errors:[...document.querySelectorAll('[role=alert]')].map(e=>e.innerText),hasTerminal:!!document.querySelector('[data-testid=task-terminal] .xterm-screen'),resume:!!document.querySelector('[data-testid=task-resume]')})");
 const expanded=()=>evaluate(`document.querySelector(${JSON.stringify(tree('cache'))})?.getAttribute('aria-expanded')==='true'`);
 const ensureExpanded=async()=>{await ready();if(!await expanded())await click(tree('cache'));await waitFor(present(current));await ready()};
 await waitFor(exists(tree('cache')));assert.equal((await invoke('tasks.list')).length,0);
 stage='no-terminal-cache';await ensureExpanded();const start=performance.now();await click(tree('cache'));await waitFor(`!${present(current)}`);await click(tree('cache'));await waitFor(present(current));const immediateMs=performance.now()-start;assert(immediateMs<5000);
 await click(tree('cache'));await waitFor(`!${present(current)}`);const lateStart=performance.now();await pause(5100);await click(tree('cache'));await waitFor(present(current));const afterFiveMs=performance.now()-lateStart;assert(afterFiveMs>=5000);r.checks.push({scenario:'normal App collapse/reopen before and after five seconds',immediateMs,afterFiveMs,view:await observe(),normalLiveWatch:true});
 async function staleAndRefresh(label){
  await ensureExpanded();const scopeKey=task?task.task.id:'project';let ids=pausedScopes.get(scopeKey);
  if(!ids){
   await evaluate("window.__cacheWatches=[];window.__cacheUnsubscribe?.();window.__cacheUnsubscribe=window.electronAPI.eventOn('files:watch',x=>window.__cacheWatches.push(x));true");
   const probe=join(projectPath,'own-watch-probe-'+label+'.txt');await writeFile(probe,'Observe own subscription only\n');await waitFor('window.__cacheWatches.some(x=>x.coverage===\'native\'&&x.changed)');
   ids=await evaluate('[...new Set(window.__cacheWatches.map(x=>x.id))]');assert(ids.length>0);for(const id of ids)await invoke('files.stopWatch',id);pausedScopes.set(scopeKey,ids);await unlink(probe);await refresh();
  }
  const previous=current,next=label+'.txt';await writeFile(join(projectPath,'cache',next),'Explicit new '+label+'\n');await unlink(join(projectPath,'cache',previous));
  await waitFor(present(previous));assert(!await evaluate(present(next)));const stale=await observe();
  const beforeTask=task?await invoke('tasks.get',task.task.id):null,beforeReceiver=task?await receiver():null;
  await refresh();await waitFor(present(next));await waitFor(`!${present(previous)}`);current=next;
  const refreshed=await observe(),afterTask=task?await invoke('tasks.get',task.task.id):null,afterReceiver=task?await receiver():null;
  assert.deepEqual(await fingerprint(sentinel),r.before);if(task){assert.equal(afterTask.ptyId,beforeTask.ptyId);assert.equal(afterReceiver.bytes,0);assert.equal(afterReceiver.executedCommands,0)}
  r.checks.push({scenario:'explicit refresh / '+label,ownObservedWatchIdsPaused:ids,stale,refreshed,beforeTask,afterTask,beforeReceiver,afterReceiver});await app.screenshot(join(scratch,label+'.png'));
 }
 stage='no-terminal-refresh';await staleAndRefresh('no-terminal');assert.equal((await invoke('tasks.list')).length,0);
 stage='setup-own-running-task';const profile=await invoke('aiProfiles.create',{name:'B19 isolated input-only CLI',runner:'claude',executable:'/usr/bin/python3',args:[resolve('scripts/files/context-receiver.py'),receiverPath],env:[{name:'CLAUDE_CONFIG_DIR',value:join(scratch,'isolated-cli'),secret:false}],color:null,isDefault:false});
 task=await invoke('tasks.create',{projectId:app.project.id,dirId:app.project.dirs[0].id,aiProfileId:profile.id,firstMessage:''});await poll(async()=>{try{return await receiver()}catch{return null}},'receiver startup');
 await waitFor(exists(`[data-task-id="${task.task.id}"]`));await click(`[data-task-id="${task.task.id}"]`);await waitFor(`${exists('[data-testid=task-terminal] .xterm-screen')}||${exists('[data-testid=task-resume]')}`);
 if(await evaluate(exists('[data-testid=task-resume]')))await click('[data-testid=task-resume]');await waitFor(exists('[data-testid=task-terminal] .xterm-screen'));
 if(!await evaluate(exists('[data-testid=file-workspace]')))await click('[data-testid=task-files]');await waitFor(exists('[data-testid=file-workspace]'));await ensureExpanded();
 stage='running-task-refresh';const receiverStart=await receiver(),liveBefore=await invoke('tasks.get',task.task.id);assert(liveBefore.ptyId);await staleAndRefresh('running');
 const advancing=await poll(async()=>{const x=await receiver();return x.heartbeat>receiverStart.heartbeat?x:null},'receiver remained active during file refresh');assert.equal(advancing.pid,receiverStart.pid);assert.equal(advancing.cwd,projectPath);r.receiverAdvanced={before:receiverStart,after:advancing};
 stage='stop-task-through-UI';await click('[data-testid=task-actions]');await click('[data-testid=task-kill]');const stopped=await poll(async()=>{const x=await invoke('tasks.get',task.task.id);return x.ptyId===null?x:null},'actual task stop');r.stoppedTask=stopped;
 // The current terminal keeps its final exited transcript. The header menu
 // and persisted PTY state, rather than the detached-view resume panel, own
 // this transition's readiness.
 await waitFor("document.querySelector('[data-testid=runtime-running]')?.textContent.includes('0 个运行中')");await click('[data-testid=task-actions]');await waitFor(exists('[data-testid=task-header-resume]'));await app.key('Escape','Escape');
 stage='stopped-task-refresh';await staleAndRefresh('stopped');assert.equal((await invoke('tasks.get',task.task.id)).ptyId,null);assert.equal((await receiver()).bytes,0);
 r.finalView=await observe();r.finalTask=await invoke('tasks.get',task.task.id);r.after=await fingerprint(sentinel);assert.deepEqual(r.after,r.before);assert.deepEqual(app.rendererErrors,[]);r.status='passed';
}catch(error){r.status='failed';r.failedStage=stage;r.error=String(error);process.exitCode=1;if(app)try{r.failureDom=await app.evaluate('document.body.innerText');await app.screenshot(join(scratch,'failure.png'))}catch{}}
finally{if(app){if(task)try{await app.invoke('tasks.kill',task.task.id)}catch{}await writeFile(join(scratch,'electron.log'),app.logs());await app.close()}r.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,checks:r.checks.length,failedStage:r.failedStage,error:r.error,artifacts:scratch}))}
