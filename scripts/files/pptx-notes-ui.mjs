// W10: present/empty notes, actual permission, trusted edits and independent reopen.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
import {installFileMethodObserver,observeFileMethods,restoreFileMethodObserver} from '../lib/file-method-observer.mjs';
import {installOfficeNativeObserver,observeOfficeNative,restoreOfficeNativeObserver} from '../lib/office-native-observer.mjs';
const executable=process.env.WILLYOU_FILES_APP;assert(executable);
const scratch=await mkdtemp('/private/tmp/willyou-pptx-notes-A-'),root=join(scratch,'project');
const manifest=JSON.parse(execFileSync('python3',['scripts/files/pptx-notes-fixtures.py',root],{encoding:'utf8'}));
const sha=x=>createHash('sha256').update(x).digest('hex'),inspect=p=>JSON.parse(execFileSync('python3',['scripts/files/pptx-notes-fixtures.py','inspect',p],{encoding:'utf8'}));
await mkdir(join(scratch,'inputs'));for(const p of ['scripts/files/pptx-notes-ui.mjs','scripts/files/pptx-notes-fixtures.py','scripts/files/file-acceptance-ui.mjs','scripts/lib/electron-harness.mjs','scripts/lib/file-method-observer.mjs'])await writeFile(join(scratch,'inputs',p.replaceAll('/','__')),await readFile(p));
const r={at:new Date().toISOString(),caseId:'M9-T-W10',layer:'A',scratch,root,manifest,checks:[],status:'running',asarSha256:sha(await readFile(resolve(executable,'../../Resources/app.asar'))),boundary:'Normal packaged App (exact executable/ASAR identified) with isolated userData and own genuine PPTX. readonly is actual0444. Trusted UI slide navigation/edit/toggle/save/close/reopen; original native/PPTX replies unchanged. Independent Python ZIP/XML verifies saved notes and unchanged unrelated parts. Text CDP input is not systemIME. No daily data, model, clipboard, invented attachment host or private broker changes.'};
let app,observed=false,nativeObserved=false,stage='setup';
const selector='[aria-label=演讲者备注]',state=()=>app.evaluate(`(()=>{const e=document.querySelector('${selector}');return{present:!!e,value:e?.value,readonly:e?.readOnly,dirty:!!document.querySelector('.fw-tab.selected [aria-label=未保存]'),edit:document.querySelector('.fw-office-edit-toggle')?.textContent,disabled:document.querySelector('.fw-office-edit-toggle')?.disabled,alert:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent)}})()`);
async function phase(s){stage=s;console.log(JSON.stringify({stage:s,at:new Date().toISOString()}));await writeFile(join(scratch,'progress.json'),JSON.stringify({stage:s}));}
async function slide(n){
 await phase(stage.replace(/:slide-\d+$/,'')+':slide-'+n);
 await app.click('.fw-office-slide-rail button[aria-label='+JSON.stringify('幻灯片 '+n)+']');
 // Finishing notes can queue behind the document's original PDF/SVG render.
 // Cover those existing bounded operations instead of the generic 10s UI
 // default; no product renderer/transport deadline or result is changed.
 await app.waitFor(`document.querySelector('.fw-office-slide-rail button[aria-current=page]')?.getAttribute('aria-label')===${JSON.stringify('幻灯片 '+n)}`,60000);
}
async function enter(text,expected=text){await app.click(selector);for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'a',code:'KeyA',modifiers:4,commands:['selectAll']});await app.cdp('Input.insertText',{text});await app.waitFor(`document.querySelector('${selector}')?.value===${JSON.stringify(expected)}`);}
async function tryDisabledEdit(){
 const p=await app.evaluate("(async()=>{const e=document.querySelector('.fw-office-edit-toggle');if(!e?.matches(':disabled'))throw Error('Expected genuine disabled edit control');e.scrollIntoView({block:'nearest',inline:'nearest'});await new Promise(requestAnimationFrame);const b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;if(b.width<=0||b.height<=0||x<0||y<0||x>=innerWidth||y>=innerHeight||!e.contains(document.elementFromPoint(x,y)))throw Error('Disabled edit control is occluded');return{x,y}})()");
 // The shared click helper intentionally rejects disabled controls. Exercise
 // the browser's actual disabled-button hit target without enabling it.
 for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});
}
async function close(name){const s='[aria-label='+JSON.stringify('关闭 '+name)+']';await app.click(s);await app.waitFor('!document.querySelector('+JSON.stringify(s)+')',90000);}
try{
 app=await openFileAcceptanceApp({executable,projectPath:root,userData:join(scratch,'userdata'),name:'W10 PPTX notes A',inspectMain:true});r.pid=app.processId;
 if(process.env.WILLYOU_NOTES_NATIVE_STACK==='1'){await installOfficeNativeObserver(app,join(scratch,'native-stacks'));nativeObserved=true;r.nativeDiagnosticBoundary='Passive original IO plus exact live owned parent/vendor sampling after9s only; sampling overhead explicit,not pristine performance evidence.';}
 await app.click('[aria-label=文件全屏]');
 await installFileMethodObserver(app,['openPptx','editPptx','savePptx','closePptx','renderPptx','save']);observed=true;
 for(const theme of ['light','dark']){
  await app.invoke('appSettings.update','theme','y'+theme);
  for(const mode of ['readonly','editable']){
   const name=theme+'-'+mode+'.pptx',path=join(root,name),before=inspect(path),st=await stat(path),traceStart=(await observeFileMethods(app)).length;await phase(theme+':'+mode+':open');await app.open(name);
   await app.waitFor(`document.querySelector('${selector}')?.value==='SLIDE_ONE_NOTES'&&!!document.querySelector('.fw-office-pages canvas[data-rendered=true]')`,60000);
   const initial=await state();assert(initial.readonly&&!initial.dirty);assert.equal(initial.disabled,mode==='readonly');
   await enter('MUST_NOT_WRITE','SLIDE_ONE_NOTES');assert.equal((await state()).value,'SLIDE_ONE_NOTES');assert.equal(inspect(path).sha256,before.sha256);
   await slide(2);await app.waitFor(`!document.querySelector('${selector}')`);const empty=await state();await slide(1);await app.waitFor(`document.querySelector('${selector}')?.value==='SLIDE_ONE_NOTES'`);
   if(mode==='readonly'){
    await tryDisabledEdit();assert((await state()).readonly);assert(!((await observeFileMethods(app)).slice(traceStart).some(x=>x.method==='editPptx'&&x.delivered)));
    r.checks.push({theme,mode,initial,empty,unchanged:inspect(path),pass:true});await app.screenshot(join(scratch,theme+'-readonly.png'));await close(name);continue;
   }
   await phase(theme+':editable:pending-toggle');await app.click('.fw-office-edit-toggle');await app.waitFor(`document.querySelector('${selector}')?.readOnly===false`);
   const first='W10 '+theme+' existing 中文🙂\nsecond line',second='W10 '+theme+' created 空备注🙂';await enter(first);assert((await state()).dirty);assert.equal(inspect(path).sha256,before.sha256);
   // Finish editing commits the pending note to the draft, not to source bytes.
   await app.click('.fw-office-edit-toggle');await app.waitFor(`document.querySelector('${selector}')?.readOnly===true&&document.querySelector('${selector}')?.value===${JSON.stringify(first)}`);assert((await state()).dirty);assert.equal(inspect(path).sha256,before.sha256);
   await slide(2);await app.waitFor(`!document.querySelector('${selector}')`);await app.click('.fw-office-edit-toggle');await app.waitFor(`document.querySelector('${selector}')?.value===''&&document.querySelector('${selector}')?.readOnly===false`);await enter(second);
   await slide(1);await app.waitFor(`document.querySelector('${selector}')?.value===${JSON.stringify(first)}`);await slide(2);await app.waitFor(`document.querySelector('${selector}')?.value===${JSON.stringify(second)}`);
   await phase(theme+':editable:save');await app.key('s','KeyS',4);await app.waitFor("document.querySelector('.fw-footer [role=status]')?.textContent==='已保存'&&!document.querySelector('.fw-tab.selected [aria-label=未保存]')",90000);
   const after=inspect(path);assert.deepEqual(after.slideNotes,[first,second]);
   for(const part of before.names)if(!['ppt/notesSlides/notesSlide1.xml','ppt/slides/_rels/slide2.xml.rels','[Content_Types].xml'].includes(part))assert.equal(after.parts[part],before.parts[part],part);
   await close(name);
   await phase(theme+':editable:reopen');await app.open(name);await app.waitFor(`document.querySelector('${selector}')?.value===${JSON.stringify(first)}&&!!document.querySelector('.fw-office-pages canvas[data-rendered=true]')`,60000);assert((await state()).readonly);await slide(2);await app.waitFor(`document.querySelector('${selector}')?.readOnly===true&&document.querySelector('${selector}')?.value===${JSON.stringify(second)}`);assert(!(await state()).dirty);await app.screenshot(join(scratch,theme+'-reopened.png'));await close(name);
   r.checks.push({theme,mode,initial,empty,before,after,originalMode:st.mode,pendingPreservedAcrossModeAndSlide:true,reopenReadonlyBothNotes:true,pass:true});
  }
 }
 r.trace=await observeFileMethods(app);for(const x of r.trace.filter(x=>x.delivered)){assert.equal(x.before,x.after);assert.equal(x.input,x.inputAfter);}assert.equal(r.trace.filter(x=>x.method==='save').length,0);assert.equal(r.trace.filter(x=>x.method==='savePptx'&&x.delivered).length,2);
 for(const item of manifest.cases.filter(x=>x.mode==='readonly'))assert.equal(inspect(join(root,item.name)).sha256,item.sha256);
 r.restored=await restoreFileMethodObserver(app);observed=false;assert(Object.values(r.restored).every(Boolean));assert.deepEqual(app.rendererErrors,[]);
 if(nativeObserved){r.nativeTrace=await observeOfficeNative(app);r.nativeRestored=await restoreOfficeNativeObserver(app);nativeObserved=false;assert(r.nativeRestored.spawnRestored&&r.nativeRestored.streamsRestored.every(Boolean));}
 await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()");r.exit=await app.waitForExit(20000);assert.equal(r.exit.code,0);assert.equal(r.exit.signal,null);r.status='passed';
}catch(error){r.status='failed';r.failedStage=stage;r.error=String(error);r.stack=error.stack;process.exitCode=1;if(app)try{r.last=await state();r.trace=observed?await observeFileMethods(app):undefined;r.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(scratch,'failure.png'));}catch{}}
finally{if(app){if(nativeObserved){r.nativeTrace=await observeOfficeNative(app);r.nativeCleanupRestore=await restoreOfficeNativeObserver(app);}if(observed)r.cleanupRestore=await restoreFileMethodObserver(app);await writeFile(join(scratch,'electron.log'),app.logs());await app.close();}r.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,checks:r.checks.length,scratch,failedStage:r.failedStage,error:r.error}));}
