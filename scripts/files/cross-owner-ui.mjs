import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
import {installFileRpcObserver,observeFileRpcs,restoreFileRpcObserver} from '../lib/file-rpc-observer.mjs';
import {installFileWatchObserver,observeFileWatches} from '../lib/file-watch-observer.mjs';
import {crossOwnerRequests} from './cross-owner-fixtures.mjs';
const executable=process.env.WILLYOU_FILES_APP;assert(executable);const scratch=await mkdtemp('/private/tmp/willyou-cross-owner-app-');
const sha=x=>createHash('sha256').update(x).digest('hex'),norm=x=>x.replace(/\r\n?/g,'\n'),roots=['A','B'].map(n=>join(scratch,'project-'+n)),bases=roots.map((_,i)=>'BASE OWNER '+i+' 中文🙂\r\n'),locals=bases.map((b,i)=>b+'PRIVATE OWNER '+i+' DRAFT 中文🙂');
for(let i=0;i<2;i++){await mkdir(roots[i]);await writeFile(join(roots[i],'value.txt'),bases[i]);}
const fp=async()=>Promise.all(roots.map(async root=>{const p=join(root,'value.txt'),s=await stat(p,{bigint:true});return{sha256:sha(await readFile(p)),inode:String(s.ino),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)};}));
const resources=resolve(dirname(executable),'../Resources'),r={at:new Date().toISOString(),executable,scratch,status:'running',checks:[],before:await fp(),pids:[],asarSha256:sha(await readFile(join(resources,'app.asar'))),brokerSha256:sha(await readFile(join(resources,'native/willyou-files'))),boundary:'A two normal packaged App processes/windows with separate isolated profiles and source projects. Both use unchanged trusted main-renderer admission and actual preload/IPC/native/recovery/watchers. Peer capabilities are deliberately copied as required security inputs, not pointer actions. Positive edits/save/navigation use actual pointer/keyboard serially. I separately proves two authenticated synthetic sender identities in the same main service and same canonical file; this A does not claim a shared main service. Observers delegate original APIs unchanged, no auth replacement, fabricated result, store/editor/DOM-value injection, clipboard/model/CLI/external App/daily credentials.'};
const apps=[],caps=[];let stage='setup';
const model=app=>app.evaluate("(()=>{const v=document.querySelector('.fw-editor-host .cm-content')?.cmTile?.root?.view;return{text:v?.state.doc.toString(),anchor:v?.state.selection.main.anchor,head:v?.state.selection.main.head,tab:document.querySelector('.fw-tab [role=tab][aria-selected=true]')?.title,footer:document.querySelector('.fw-footer [role=status]')?.textContent}})()");
async function poll(fn,label){const end=Date.now()+10000;while(Date.now()<end){const x=await fn();if(x)return x;await new Promise(done=>setTimeout(done,20));}throw Error('Timed out: '+label);}
async function restoreWatch(app){return app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),s=globalThis.__watchLifecycle;e.ipcMain.removeHandler('files.watch');e.ipcMain.handle('files.watch',s.watch);e.ipcMain.removeHandler('files.stopWatch');e.ipcMain.handle('files.stopWatch',s.stop);s.wc.send=s.send;s.mod.subscribe=s.subscribe;const out={watch:e.ipcMain._invokeHandlers.get('files.watch')===s.watch,stop:e.ipcMain._invokeHandlers.get('files.stopWatch')===s.stop,send:s.wc.send===s.send,subscribe:s.mod.subscribe===s.subscribe};delete globalThis.__watchLifecycle;return out})()");}
try{
 for(let i=0;i<2;i++){
  const app=await openFileAcceptanceApp({executable,projectPath:roots[i],userData:join(scratch,'userdata-'+i),name:'M9 owner '+i,inspectMain:true,prepare:async({app})=>{await installFileRpcObserver(app);await installFileWatchObserver(app,roots[i],false);}});apps.push(app);r.pids.push(app.processId);await app.cdp('Page.bringToFront');await app.open('value.txt');await app.waitFor("document.querySelector('.fw-editor-host .cm-content')?.cmTile?.root?.view?.state.doc.toString()==="+JSON.stringify(norm(bases[i])));
  await app.click('.fw-editor-host .cm-content');await app.key('ArrowDown','ArrowDown',4);await app.cdp('Input.insertText',{text:locals[i].slice(bases[i].length)});await app.waitFor("document.querySelector('.fw-editor-host .cm-content')?.cmTile?.root?.view?.state.doc.toString()==="+JSON.stringify(norm(locals[i])));
  const opened=(await observeFileRpcs(app)).rows.find(x=>x.method==='open'&&x.output?.name==='value.txt').output,checkpoint=await poll(async()=>{const s=await observeFileRpcs(app);return s.rows.findLast(x=>x.method==='checkpoint'&&x.delivered&&x.output?.hash===sha(locals[i]));},'own actual native checkpoint');
  const draft=await app.invoke('files.readDraft',opened.ref,checkpoint.output.draftId);assert.equal(Buffer.from(draft.base64,'base64').toString(),locals[i]);assert.equal(draft.baseHash,sha(bases[i]));
  const watch=await poll(async()=>{const s=await observeFileWatches(app);return s.native.some(n=>n.ready&&!n.stopped)&&s.updates.some(u=>u.value.coverage==='native'&&!u.value.resyncRequired)?s:null;},'actual original native watch');
  const id=watch.calls.findLast(x=>x.delivered&&x.result?.id)?.result.id;assert(id);caps.push({root:{lease:opened.ref.lease,generation:opened.ref.generation},ref:opened.ref,hash:opened.revision.hash,draftId:checkpoint.output.draftId,draftHash:checkpoint.output.hash,draftVersion:checkpoint.output.bufferVersion,watchId:id});
 }
 r.capabilities=caps;
 for(const theme of['light','dark']){
  for(const app of apps)await app.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
  for(let i=0;i<2;i++){
   stage=theme+':receiver-'+i;const app=apps[i],peer=caps[1-i],own=caps[i],before=await Promise.all(apps.map(model)),attempts=[];
   for(const[method,args]of crossOwnerRequests(peer,own.root)){
    let error;try{await app.invoke('files.'+method,...args);}catch(e){error=String(e);}assert(error?.includes('[UNTRUSTED]'),method+': '+error);assert(!error.includes('PRIVATE OWNER'));attempts.push({method,args,error});assert.deepEqual(await Promise.all(apps.map(model)),before);
   }
   // Cleanup IDs are idempotent in the other process's separate namespace.
   // Their no-op result cannot revoke the peer's real watcher/root.
   await app.invoke('files.stopWatch',peer.watchId);await app.invoke('files.releaseRoot',peer.root);
   const watch=await observeFileWatches(apps[1-i]);assert(watch.native.some(x=>x.ready&&!x.stopped));assert(watch.active.includes(peer.watchId));
   const draft=await apps[1-i].invoke('files.readDraft',peer.ref,peer.draftId);assert.equal(sha(Buffer.from(draft.base64,'base64')),peer.draftHash);assert.equal(draft.baseHash,peer.hash);
   assert.deepEqual(await fp(),r.before);r.checks.push({caseId:'M9-T-M02',theme,receiver:i,attempts,uiBefore:before,uiAfter:await Promise.all(apps.map(model)),peerNativeWatchStillActive:true,peerDraftHash:peer.draftHash,sourceFingerprintsUnchanged:true,pass:true});await app.cdp('Page.bringToFront');await app.screenshot(join(scratch,theme+'-receiver-'+i+'.png'));
  }
 }
 r.positiveSaves=[];for(let i=0;i<2;i++){
  stage='normal-save-'+i;const app=apps[i];await app.cdp('Page.bringToFront');await app.click('.fw-editor-host .cm-content');await app.key('s','KeyS',4);await app.waitFor("document.querySelector('.fw-footer [role=status]')?.textContent==='已保存'");assert.equal((await readFile(join(roots[i],'value.txt'))).toString(),locals[i]);r.positiveSaves.push({owner:i,hash:sha(locals[i]),nativeRawBytesExact:true});
 }
 r.after=await fp();r.rpc=[];r.watch=[];r.restored=[];r.exits=[];
 for(const app of apps){
  assert.deepEqual(app.rendererErrors,[]);assert.equal((await app.invoke('tasks.list')).length,0);await app.cdp('Page.bringToFront');await app.click('[data-testid=project-files]');await app.waitFor('!document.querySelector("[data-testid=file-workspace]")');await poll(async()=>{const w=await observeFileWatches(app);return w.native.every(n=>n.settled&&n.stopped);},'all own native watchers stopped');
  const rpc=await observeFileRpcs(app),watch=await observeFileWatches(app);for(const row of rpc.rows)if(row.delivered)assert.equal(row.before,row.after);for(const row of watch.updates)assert.equal(row.before,row.after);r.rpc.push(rpc);r.watch.push(watch);const restored={rpc:await restoreFileRpcObserver(app),watch:await restoreWatch(app)};assert(Object.values(restored.rpc).every(Boolean)&&Object.values(restored.watch).every(Boolean));r.restored.push(restored);await writeFile(join(scratch,'electron-'+r.restored.length+'.log'),app.logs());
  await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()");const exit=await app.waitForExit(20000);assert.equal(exit.code,0);assert.equal(exit.signal,null);r.exits.push(exit);await app.close();
 }
 apps.length=0;r.status='passed';
}catch(error){r.status='failed';r.error=String(error);r.stack=error.stack;r.failedStage=stage;process.exitCode=1;for(let i=0;i<apps.length;i++)try{r['ui'+i]=await model(apps[i]);await apps[i].screenshot(join(scratch,'failure-'+i+'.png'));}catch{}}
finally{for(let i=0;i<apps.length;i++){const app=apps[i];try{r['failureRpc'+i]=await observeFileRpcs(app);r['failureWatch'+i]=await observeFileWatches(app);r['failureRestored'+i]={rpc:await restoreFileRpcObserver(app),watch:await restoreWatch(app)};}catch{}await writeFile(join(scratch,'failure-electron-'+i+'.log'),app.logs());await app.close();}r.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,checks:r.checks.length,error:r.error,failedStage:r.failedStage,artifacts:scratch}));}
