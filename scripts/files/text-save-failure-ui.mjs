// H09 actual packaged UI with explicit, genuine native/OS fault environment.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSaveFailureFixture } from './text-save-failure-fixture.mjs';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { pause } from '../lib/electron-harness.mjs';
import { installFileRpcObserver, observeFileRpcs, restoreFileRpcObserver } from '../lib/file-rpc-observer.mjs';
const sourceApp=process.env.WILLYOU_SAVE_FAILURE_APP;assert(sourceApp);
const sourceResources=join(sourceApp,'Contents/Resources'),sha=x=>createHash('sha256').update(x).digest('hex'),norm=x=>x.replace(/\r\n?/g,'\n');
const sourceHashes={asarSha256:sha(await readFile(join(sourceResources,'app.asar'))),brokerSha256:sha(await readFile(join(sourceResources,'native/willyou-files')))};
const environment=await createSaveFailureFixture(join(sourceResources,'native/willyou-files')),scratch=environment.base,root=environment.project;
const B='Base 中文🙂\r\n',L='Local '+'中文🙂'.repeat(2048)+'\r\n';
const scenarios=['light','dark'].flatMap(theme=>['permission','disk-full','generic'].map(mode=>({theme,mode,name:theme+'-'+mode+'.txt'})));
for(const s of scenarios)await writeFile(join(root,s.name),B);
const r={at:new Date().toISOString(),sourceApp,scratch,status:'running',checks:[],sourceHashes,boundary:'A actual packaged renderer/CM/main service and byte-identical original native broker, in a private APFS-cloned App with explicitly substituted transparent native relay. Own64MiB APFS image only: chmod parent0500, real ENOSPC filler/capacity rejection, genuine native EFBIG via4096-byte RLIMIT_FSIZE on save. Original request/frame bytes forwarded; no fabricated result/error or Store/editor/DOM value injection. userData/drafts off full volume. No whole-host disk-full, clipboard, model, external App/service, live Codex or physical IME claim.'};
let app,observed=false,stage='clone';const view='document.querySelector(".cm-content")?.cmTile?.root?.view';
const state=()=>app.evaluate(`(()=>{const v=${view};return{source:v?.state.doc.toString(),focused:v?.hasFocus,footer:document.querySelector('.fw-footer [role=status]')?.textContent,alerts:[...document.querySelectorAll('.fw-save-strip[role=alert]')].map(x=>x.textContent),conflict:!!document.querySelector('.fw-conflict-strip')}})()`);
const disk=async name=>{const path=join(root,name),s=await stat(path,{bigint:true}),bytes=await readFile(path);return{hash:sha(bytes),inode:String(s.ino),mtimeNs:String(s.mtimeNs),bytes:bytes.toString('base64')};};
async function input(text){await app.click('.cm-content');await app.key('a','KeyA',4);await app.cdp('Input.insertText',{text:norm(text)});await app.waitFor(`${view}?.state.doc.toString()===${JSON.stringify(norm(text))}`);}
async function save(){await app.click('.cm-content');await app.key('s','KeyS',4);}
async function pin(){const p=await app.evaluate("(()=>{const r=document.querySelector('.fw-tab [role=tab][aria-selected=true]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,button:'left',clickCount:2,...p});}
try{
 const copy=await environment.cloneApp(sourceApp),executable=join(copy,'Contents/MacOS/WillYou');r.privateApp=copy;r.asarSha256=sha(await readFile(join(copy,'Contents/Resources/app.asar')));assert.equal(r.asarSha256,sourceHashes.asarSha256);
 app=await openFileAcceptanceApp({executable,projectPath:root,userData:join(scratch,'userdata'),name:'M9 real save failure/retry',inspectMain:true});r.pid=app.processId;await installFileRpcObserver(app);observed=true;
 for(const s of scenarios){
  stage=s.name+':open-edit';await environment.clear();await app.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:s.theme}]});await app.open(s.name);await app.waitFor(`${view}?.state.doc.toString()===${JSON.stringify(norm(B))}`);await pin();const before=await disk(s.name);await input(L);
  stage=s.name+':native-failure';const fault=await environment.activate(s.mode);await save();await app.waitFor("Boolean(document.querySelector('.fw-save-strip[role=alert]'))&&document.querySelector('.fw-footer [role=status]')?.textContent==='有未保存修改'");const failed=await state();assert.equal(failed.source,norm(L));assert.equal(failed.conflict,false);assert.match(failed.alerts.join('\n'),s.mode==='permission'?/denied|permission/i:s.mode==='disk-full'?/space/i:/File too large/i);assert.deepEqual(await disk(s.name),before);
  const opened=(await observeFileRpcs(app)).rows.filter(x=>x.method==='open'&&x.output?.name===s.name).at(-1);assert(opened);const drafts=await app.invoke('files.drafts',opened.output.ref),contents=[];
  for(const d of drafts)contents.push({draft:d,data:await app.invoke('files.readDraft',opened.output.ref,d.id)});
  assert(contents.some(x=>x.data.baseHash===sha(B)&&Buffer.from(x.data.base64,'base64').toString()===L));await app.screenshot(join(scratch,s.name+'-failure.png'));
  stage=s.name+':edit-clears-old-error';const next=L+'Edited retry 中文🙂\r\n';await input(next);await app.waitFor("!document.querySelector('.fw-save-strip[role=alert]')");const edited=await state();assert.equal(edited.footer,'有未保存修改');assert.deepEqual(await disk(s.name),before);
  stage=s.name+':actual-retry';await environment.clear();await save();const end=Date.now()+10000;while((await readFile(join(root,s.name))).toString()!==next){assert(Date.now()<end,'Native retry exact bytes missing');await pause(20);}await app.waitFor("document.querySelector('.fw-footer [role=status]')?.textContent==='已保存'");const final=await state();assert.equal(final.source,norm(next));assert.equal(final.alerts.length,0);assert.equal(final.conflict,false);assert.deepEqual(await app.invoke('files.drafts',opened.output.ref),[]);
  const rows=(await observeFileRpcs(app)).rows.filter(x=>x.method==='save'&&x.args[0]?.ref.id===opened.output.ref.id);assert.equal(rows.length,2);assert.equal(rows[0].output.state,'failed');assert.equal(rows[1].output.state,'saved');assert.equal(rows[0].args[0].baseHash,sha(B));assert.equal(rows[1].args[0].baseHash,sha(B));
  const relay=(await environment.observations()).filter(x=>x.operation==='save'&&x.relativePath===s.name);assert.equal(relay.length,2);assert(relay[0].frames.some(x=>x.nativeReceipt?.state==='failed'));if(s.mode==='generic')assert.equal(relay[0].saveFsizeLimit,4096);
  r.checks.push({caseId:'M9-T-H09',...s,fault,before,failed,retainedDrafts:contents,edited,final,after:await disk(s.name),saveRows:rows,nativeRelay:relay,pass:true});await app.screenshot(join(scratch,s.name+'-retry.png'));await app.click('[aria-label='+JSON.stringify('关闭 '+s.name)+']');
 }
 await app.click('[data-testid=project-files]');await app.waitFor('!document.querySelector("[data-testid=file-workspace]")');r.rpc=await observeFileRpcs(app);for(const row of r.rpc.rows)if(row.delivered)assert.equal(row.before,row.after);r.rpcRestored=await restoreFileRpcObserver(app);observed=false;assert(Object.values(r.rpcRestored).every(Boolean));assert.deepEqual(app.rendererErrors,[]);await writeFile(join(scratch,'electron.log'),app.logs());
 await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()");r.exit=await app.waitForExit(20000);assert.equal(r.exit.code,0);assert.equal(r.exit.signal,null);await app.close();app=null;r.status='passed';
}catch(error){r.status='failed';r.error=String(error);r.stack=error.stack;r.failedStage=stage;process.exitCode=1;if(app)try{r.state=await state();await app.screenshot(join(scratch,'failure.png'));}catch{}}
finally{
 if(app){if(observed){r.rpc=await observeFileRpcs(app);r.rpcRestored=await restoreFileRpcObserver(app);}await writeFile(join(scratch,'failure-electron.log'),app.logs());await app.close();}
 await environment.clear();r.nativeRelay=await environment.observations();await environment.close();r.environment=environment.evidence;
 assert.equal(sha(await readFile(join(sourceResources,'app.asar'))),sourceHashes.asarSha256);assert.equal(sha(await readFile(join(sourceResources,'native/willyou-files'))),sourceHashes.brokerSha256);
 r.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,checks:r.checks.length,error:r.error,failedStage:r.failedStage,artifacts:scratch}));
}
