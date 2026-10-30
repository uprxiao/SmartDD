// L17 independent actual-UI portions. The missing task-tab close UI is not
// substituted with archive/delete/internal store calls and remains untested.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {openTaskFileFixture} from '../lib/task-file-fixture.mjs';
import {installFileMethodObserver,observeFileMethods,restoreFileMethodObserver} from '../lib/file-method-observer.mjs';
import {pause} from '../lib/electron-harness.mjs';

const executable=process.env.WILLYOU_FILES_APP;assert(executable);
const scratch=await mkdtemp('/private/tmp/willyou-task-file-lifecycle-A-'),root=join(scratch,'project');await mkdir(root);
const sha=x=>createHash('sha256').update(x).digest('hex'),q=JSON.stringify;
for(const theme of ['light','dark'])for(const mode of ['save','stop'])await writeFile(join(root,`${theme}-${mode}.txt`),`ORIGINAL ${theme} ${mode}\n`);
const fingerprint=async name=>{const p=join(root,name),s=await stat(p,{bigint:true});return{sha256:sha(await readFile(p)),inode:String(s.ino),mtimeNs:String(s.mtimeNs)};};
const r={at:new Date().toISOString(),caseId:'M9-T-L17',layer:'A',scratch,root,executable,asarSha256:sha(await readFile(resolve(executable,'../../Resources/app.asar'))),status:'running',checks:[],boundary:'Normal original packagedApp/native services and input-only real PTYs. Task/profile creation are isolated setup RPCs; actual file edit/close/cancel/discard and task stop use UI. One independent external source write per theme creates an ordinary real conflict, no substituted RPC/business state. Read-only IPC/disk checks. Does not test or invent task-tab close UI, physical IME, clipboard, external models or normal App exit.'};
let fixture,app,observed=false,taskObserved=false,phase='setup';
const editor=()=>app.evaluate("document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString()");
const dirty=()=>app.evaluate("!!document.querySelector('.fw-tab.selected [aria-label=未保存]')");
async function mark(value){phase=value;const row={phase,pid:app?.processId,scratch,at:new Date().toISOString()};await writeFile(join(scratch,'progress.json'),JSON.stringify(row,null,2)+'\n');console.log(JSON.stringify(row));}
async function poll(fn,label,ms=12000){const end=Date.now()+ms;for(;;){const value=await fn();if(value)return value;assert(Date.now()<end,label);await pause(30);}}
async function edit(text){await app.click('.cm-content');for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'a',code:'KeyA',modifiers:4,commands:['selectAll']});await app.cdp('Input.insertText',{text});await app.waitFor(`document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString()===${q(text)}&&!!document.querySelector('.fw-tab.selected [aria-label=未保存]')`);}
const taskRows=()=>app.mainEvaluate('globalThis.__taskLifecycleObserver.rows');
async function restoreTask(){return app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),s=globalThis.__taskLifecycleObserver;e.ipcMain.removeHandler('tasks.kill');e.ipcMain.handle('tasks.kill',s.original);const restored=e.ipcMain._invokeHandlers.get('tasks.kill')===s.original;delete globalThis.__taskLifecycleObserver;return restored})()",{synchronous:true});}
try{
 fixture=await openTaskFileFixture({executable,scratch,root,name:'L17 task/file lifecycle A'});app=fixture.app;r.pid=app.processId;
 await fixture.show('T2');await fixture.show('T1');r.tasks=fixture.tasks;r.initialReceivers={};
 for(const label of ['T1','T2'])r.initialReceivers[label]=await poll(async()=>{try{return await fixture.receiver(label);}catch(e){if(e.code!=='ENOENT')throw e;}},'receiver ready');
 await installFileMethodObserver(app,['open','read','save','checkpoint','readDraft','resolveDraft','closeDocument']);observed=true;
 await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),original=e.ipcMain._invokeHandlers.get('tasks.kill');if(typeof original!=='function')throw Error('No own task kill handler');const s={original,rows:[]};globalThis.__taskLifecycleObserver=s;e.ipcMain.removeHandler('tasks.kill');e.ipcMain.handle('tasks.kill',async(event,...args)=>{const row={at:Date.now(),args,sender:event.sender.id};s.rows.push(row);try{const value=await original(event,...args);row.delivered=true;return value;}catch(error){row.error=String(error);throw error;}});return true})()",{synchronous:true});taskObserved=true;
 for(const [i,theme]of ['light','dark'].entries()){
  const label=i?'T2':'T1',task=await fixture.show(label),initialTask=await app.invoke('tasks.get',task.task.id);assert.equal(initialTask.ptyId,task.ptyId);assert(initialTask.ptyId);
  await app.invoke('appSettings.update','theme','y'+theme);await mark(theme+':dirty-file-close-running-pty');
  const name=theme+'-save.txt',local=`UI SAVE ${theme} 中文🙂\n`,before=await fingerprint(name),receiver=await fixture.receiver(label);
  await app.open(name);await app.waitFor("!!document.querySelector('.cm-content')");await edit(local);await app.click('[aria-label='+q('关闭 '+name)+']');await app.waitFor('!document.querySelector('+q('[aria-label='+q('关闭 '+name)+']')+')');
  assert.equal(await readFile(join(root,name),'utf8'),local);const currentTask=await app.invoke('tasks.get',task.task.id),afterReceiver=await fixture.control(label,theme+'-FILE-CLOSED');
  assert.equal(currentTask.ptyId,initialTask.ptyId);assert.equal(afterReceiver.pid,receiver.pid);assert.equal(afterReceiver.rawHex,'');assert.equal(afterReceiver.executedCommands,0);assert.deepEqual(await taskRows(),i?[r.stopRows[0]]:[]);
  r.checks.push({theme,scenario:'UI dirty file close flushes source; live PTY identity retained',name,before,after:await fingerprint(name),expectedHash:sha(Buffer.from(local)),ptyId:currentTask.ptyId,receiverBefore:receiver,receiverAfter:afterReceiver,pass:true});
  await mark(theme+':real-conflict-and-ui-stop');
  const stopName=theme+'-stop.txt',retained=`LOCAL UNSAVED ${theme} 中文🙂\n`,external=`EXTERNAL ${theme}\n`;
  await app.open(stopName);await app.waitFor("!!document.querySelector('.cm-content')");await edit(retained);
  // An independent writer acts on this owned fixture. It is neither the save
  // under acceptance nor a replacement for native watch/conflict handling.
  await writeFile(join(root,stopName),external);const externalFingerprint=await fingerprint(stopName);
  await app.waitFor("!!document.querySelector('.fw-conflict-strip')",15000);assert.equal(await editor(),retained);assert(await dirty());
  const calls=await poll(async()=>{const calls=await observeFileMethods(app);return calls.some(x=>x.method==='checkpoint'&&x.delivered&&x.output?.hash===sha(Buffer.from(retained)))?calls:null;},'real local checkpoint retained');
  const doc=calls.filter(x=>x.method==='open'&&x.delivered&&x.output?.name===stopName).at(-1)?.output;assert(doc);
  const cp=calls.filter(x=>x.method==='checkpoint'&&x.delivered&&x.output?.hash===sha(Buffer.from(retained))).at(-1).output;
  const draft=await app.invoke('files.readDraft',doc.ref,cp.draftId);assert.equal(Buffer.from(draft.base64,'base64').toString('utf8'),retained);
  const preStop=await fixture.receiver(label);await app.click('[data-testid=task-actions]');await app.click('[data-testid=task-kill]');
  const stopped=await poll(async()=>{const t=await app.invoke('tasks.get',task.task.id);return t.ptyId===null?t:null;},'actual task stopped');
  const menuStillOpen=await app.evaluate("!!document.querySelector('[role=menu]')");if(menuStillOpen){await app.key('Escape','Escape');}await app.waitFor("!document.querySelector('[role=menu]')");(r.stopMenuDismissals??=[]).push({theme,explicitEscape:menuStillOpen});
  assert.equal(await editor(),retained);assert(await dirty());assert(await app.evaluate("!!document.querySelector('.fw-conflict-strip')"));assert.deepEqual(await fingerprint(stopName),externalFingerprint);
  const draftAfterStop=await app.invoke('files.readDraft',doc.ref,cp.draftId);assert.equal(Buffer.from(draftAfterStop.base64,'base64').toString('utf8'),retained);
  const stopRows=await taskRows();assert.equal(stopRows.length,i+1);assert.deepEqual(stopRows.at(-1).args,[task.task.id]);assert(stopRows.at(-1).delivered);r.stopRows=stopRows;
  await app.screenshot(join(scratch,theme+'-stopped-with-draft.png'));
  r.checks.push({theme,scenario:'Actual UI stop retains local editor/dirty/private draft and independent disk version',name:stopName,preStop,stopped,local:retained,draftHash:draftAfterStop.hash,checkpoint:cp,externalFingerprint,after:await fingerprint(stopName),stop:stopRows.at(-1),pass:true});
  await mark(theme+':failed-close-cancel');await app.click('[aria-label='+q('关闭 '+stopName)+']');await app.waitFor("[...document.querySelectorAll('[role=dialog]')].some(e=>e.textContent.includes('文件尚未保存'))");
  await app.click('[role=dialog] button','继续查看');await app.waitFor("!document.querySelector('[role=dialog]')");assert.equal(await editor(),retained);assert(await dirty());assert.deepEqual(await fingerprint(stopName),externalFingerprint);
  await app.click('[aria-label='+q('关闭 '+stopName)+']');await app.waitFor("[...document.querySelectorAll('[role=dialog]')].some(e=>e.textContent.includes('文件尚未保存'))");await app.click('[role=dialog] button','放弃修改并关闭');await app.waitFor('!document.querySelector('+q('[aria-label='+q('关闭 '+stopName)+']')+')');assert.deepEqual(await fingerprint(stopName),externalFingerprint);
  r.checks.push({theme,scenario:'Failed file close offers real continue; explicit discard closes without overwriting external source',name:stopName,source:await fingerprint(stopName),pass:true});
 }
 r.rpc=await observeFileMethods(app);assert(r.rpc.every(x=>!x.delivered||x.before===x.after&&x.input===x.inputAfter));r.rpcRestored=await restoreFileMethodObserver(app);observed=false;assert(Object.values(r.rpcRestored).every(Boolean));r.taskObserverRestored=await restoreTask();taskObserved=false;assert(r.taskObserverRestored);assert.deepEqual(app.rendererErrors,[]);r.rendererErrors=[];r.status='independent-file-close-and-task-stop-passed;task-tab-close-not-tested';r.normalAppExitClaimed=false;
}catch(error){r.status='failed';r.failedPhase=phase;r.error=String(error);r.stack=error.stack;process.exitCode=1;if(app)try{r.rpc=observed?await observeFileMethods(app):undefined;r.taskRows=taskObserved?await taskRows():undefined;r.editor=await editor();r.dirty=await dirty();r.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(scratch,'failure.png'));}catch{}}
finally{if(app){if(observed)try{r.failedRpcRestore=await restoreFileMethodObserver(app);}catch{}if(taskObserved)try{r.failedTaskRestore=await restoreTask();}catch{}await writeFile(join(scratch,'electron.log'),app.logs());if(r.status==='failed')try{r.failedCleanupCrash=await app.crash();}catch{}await fixture.close();}r.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,checks:r.checks.length,scratch,error:r.error,phase:r.failedPhase}));}
