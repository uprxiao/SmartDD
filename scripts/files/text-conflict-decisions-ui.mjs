// Real packaged UI, real private external writer and native CAS/drafts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { pause } from '../lib/electron-harness.mjs';
import { installFileRpcObserver, observeFileRpcs, restoreFileRpcObserver } from '../lib/file-rpc-observer.mjs';

const executable=process.env.WILLYOU_FILES_APP;assert(executable);
const scratch=await mkdtemp('/private/tmp/willyou-text-conflict-app-'),root=join(scratch,'project');await mkdir(root);
const sha=x=>createHash('sha256').update(x).digest('hex'),norm=x=>x.replace(/\r\n?/g,'\n');
const B='Base 中文🙂\r\nTail\r\n',L='Local 手工🙂\r\nTail\r\n',D='Disk 外改🙂\r\nTail\r\n',D2='Disk 第二次外改🙂\r\nTail\r\n';
const onlyEdit=process.env.WILLYOU_CONFLICT_ONLY_EDIT==='1';
const scenarios=onlyEdit?[{theme:'light',ext:'txt',action:'edit',race:false}]:['light','dark'].flatMap(theme=>['txt','md'].flatMap(ext=>['keep','disk','edit'].map(action=>({theme,ext,action,race:false})).concat(['keep','edit'].map(action=>({theme,ext,action,race:true})))));
for(const [i,s] of scenarios.entries()){s.name=`${i}-${s.theme}-${s.action}${s.race?'-race':''}.${s.ext}`;await writeFile(join(root,s.name),B);}
const resources=resolve(dirname(executable),'../Resources');
const r={at:new Date().toISOString(),executable,scratch,status:'running',checks:[],asarSha256:sha(await readFile(join(resources,'app.asar'))),boundary:'A: own packaged App/userData/project; actual mouse/keyboard conflict decisions, real external filesystem writes, actual native revision-checked saves and durable drafts. Original save invocation may be held unchanged before native IO to create a genuine competing writer. No synthetic success/error, Store/editor/DOM value injection, clipboard, model, external App/service or live Codex. Themes use prefers-color-scheme environment.'};
let app,observed=false,stage='setup';
const view='document.querySelector(".fw-editor-host .cm-content")?.cmTile?.root?.view';
const state=()=>app.evaluate(`(()=>{const v=${view};return{source:v?.state.doc.toString(),focus:v?.hasFocus,conflict:!!document.querySelector('.fw-conflict-strip'),footer:document.querySelector('.fw-footer [role=status]')?.textContent,alerts:[...document.querySelectorAll('.fw-save-strip[role=alert]')].map(e=>e.textContent),disk:document.querySelector('.fw-disk-preview pre')?.textContent}})()`);
async function input(text){await app.click('.fw-editor-host .cm-content');await app.key('a','KeyA',4);await app.cdp('Input.insertText',{text:norm(text)});await app.waitFor(`${view}?.state.doc.toString()===${JSON.stringify(norm(text))}`);}
async function pin(){const p=await app.evaluate("(()=>{const r=document.querySelector('.fw-tab [role=tab][aria-selected=true]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,button:'left',clickCount:2,...p});}
async function refresh(){await app.click('[aria-label=文件菜单]');await app.click('[role=menuitem]','刷新文件和目录');}
async function save(){await app.click('.fw-editor-host .cm-content');await app.key('s','KeyS',4);}
async function exact(name,text){const deadline=Date.now()+10000;while(!(await readFile(join(root,name))).equals(Buffer.from(text))){assert(Date.now()<deadline,'Exact native save did not settle');await pause(20);}await app.waitFor("document.querySelector('.fw-footer [role=status]')?.textContent==='已保存'");}
async function holdSave(){await app.mainEvaluate('(()=>{globalThis.__fileRpcObserver.holdSave=true;return true})()');}
async function releaseSave(){await app.mainEvaluate('(()=>{const s=globalThis.__fileRpcObserver.saves.find(x=>x.waiting);if(!s)throw Error("No original save waiting");s.release();return true})()');}
try{
 app=await openFileAcceptanceApp({executable,projectPath:root,userData:join(scratch,'userdata'),name:'M9 text conflict decisions',inspectMain:true});r.pid=app.processId;await installFileRpcObserver(app);observed=true;
 for(const s of scenarios){
  stage=s.name+':dirty-conflict';await app.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:s.theme}]});await app.open(s.name);await app.waitFor(`${view}?.state.doc.toString()===${JSON.stringify(norm(B))}`);await pin();await input(L);assert.equal((await readFile(join(root,s.name))).toString(),B);
  await writeFile(join(root,s.name),D);await refresh();await app.waitFor("Boolean(document.querySelector('.fw-conflict-strip'))");const before=await state();assert.equal(before.source,norm(L));assert.equal(before.footer,'有未保存修改');
  await app.click('.fw-disk-preview summary');await app.waitFor(`document.querySelector('[aria-label="磁盘版本 内容"]')?.cmTile?.root?.view?.state.doc.toString()===${JSON.stringify(norm(D))}`);
  stage=s.name+':'+s.action;if(s.race&&s.action==='keep')await holdSave();
  await app.click('.fw-conflict-strip button',{keep:'保留我的修改',disk:'使用磁盘版本',edit:'继续编辑'}[s.action]);
  let chosen,expected;
  if(s.action==='disk'){await app.waitFor(`!document.querySelector('.fw-conflict-strip')&&${view}?.state.doc.toString()===${JSON.stringify(norm(D))}`);assert.equal((await readFile(join(root,s.name))).toString(),D);chosen=await state();assert.notEqual(chosen.footer,'有未保存修改');expected=D;}
  else if(s.action==='edit'){
   await app.waitFor(`!document.querySelector('.fw-conflict-strip')&&${view}?.hasFocus`);chosen=await state();assert.equal(chosen.source,norm(L));assert.equal(chosen.footer,'有未保存修改');assert.equal((await readFile(join(root,s.name))).toString(),D);
   const original=(await observeFileRpcs(app)).rows.filter(row=>row.method==='open'&&row.output?.name===s.name).at(-1);assert(original);
   let draft;const deadline=Date.now()+2200;
   while(!draft){const rows=await app.invoke('files.drafts',original.output.ref);for(const row of rows){const data=await app.invoke('files.readDraft',original.output.ref,row.id);if(data.baseHash===sha(D)&&Buffer.from(data.base64,'base64').toString()===L)draft={row,data};}if(!draft){assert(Date.now()<deadline,'Rebased durable draft missing');await pause(20);}}
   assert.equal(draft.data.baseHash,sha(D));expected=L+'Continued 中文🙂\r\n';await input(expected);if(s.race)await holdSave();await save();chosen.rebasedDraft=draft;
  }else expected=L;
  if(s.race){
   const deadline=Date.now()+10000;while(!(await observeFileRpcs(app)).saves.some(x=>x.waiting)){assert(Date.now()<deadline,'Original native save not reached');await pause(20);}
   await writeFile(join(root,s.name),D2);await releaseSave();await app.waitFor("Boolean(document.querySelector('.fw-conflict-strip'))&&!document.querySelector('.fw-footer [role=status]')?.textContent.includes('正在保存')");const conflict=await state();assert.equal(conflict.source,norm(expected));assert.equal(conflict.footer,'有未保存修改');assert.equal((await readFile(join(root,s.name))).toString(),D2);
   await app.screenshot(join(scratch,s.name+'-competing-writer.png'));await app.click('.fw-conflict-strip button','保留我的修改');await exact(s.name,expected);chosen={...chosen,competingWriter:conflict};
  }else if(s.action!=='disk')await exact(s.name,expected);
  const final=await state();assert.equal(final.source,norm(expected));assert.equal(final.conflict,false);assert.notEqual(final.footer,'有未保存修改');
  const observedRows=(await observeFileRpcs(app)).rows,ref=observedRows.filter(row=>row.method==='open'&&row.output?.name===s.name).at(-1)?.output?.ref;
  const rows=observedRows.filter(row=>row.method==='save'&&row.args[0]?.ref.id===ref?.id);
  if(s.action==='disk')assert.equal(rows.length,0);else{assert.equal(rows[0].args[0].baseHash,sha(D));assert.equal(rows.at(-1).output.state,'saved');if(s.race){assert.equal(rows[0].output.state,'conflict');assert.equal(rows.at(-1).args[0].baseHash,sha(D2));}}
  r.checks.push({caseId:'M9-T-H18',...s,before,chosen,final,saveRows:rows,sourceExact:true,pass:true});await app.screenshot(join(scratch,s.name+'-resolved.png'));await app.click('[aria-label='+JSON.stringify('关闭 '+s.name)+']');
 }
 await app.click('[data-testid=project-files]');await app.waitFor('!document.querySelector("[data-testid=file-workspace]")');r.rpc=await observeFileRpcs(app);for(const row of r.rpc.rows)if(row.delivered)assert.equal(row.before,row.after);r.rpcRestored=await restoreFileRpcObserver(app);observed=false;assert(Object.values(r.rpcRestored).every(Boolean));assert.deepEqual(app.rendererErrors,[]);
 await writeFile(join(scratch,'electron.log'),app.logs());await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()");r.exit=await app.waitForExit(20000);assert.equal(r.exit.code,0);assert.equal(r.exit.signal,null);await app.close();app=null;r.status='passed';
}catch(error){r.status='failed';r.error=String(error);r.stack=error.stack;r.failedStage=stage;process.exitCode=1;if(app)try{r.state=await state();await app.screenshot(join(scratch,'failure.png'));}catch{}}
finally{if(app){if(observed){r.rpc=await observeFileRpcs(app);r.rpcRestored=await restoreFileRpcObserver(app);}await writeFile(join(scratch,'failure-electron.log'),app.logs());await app.close();}r.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,checks:r.checks.length,error:r.error,failedStage:r.failedStage,artifacts:scratch}));}
