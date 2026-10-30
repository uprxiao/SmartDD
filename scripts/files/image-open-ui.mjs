// V02: real packaged local-image new-tab route, plus explicit null/error asset seams.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmod,mkdir,mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openTaskFileFixture} from '../lib/task-file-fixture.mjs';
import {pause} from '../lib/electron-harness.mjs';
import {installFileMethodObserver,observeFileMethods,restoreFileMethodObserver} from '../lib/file-method-observer.mjs';

const executable=process.env.WILLYOU_FILES_APP,source=process.env.WILLYOU_IMAGE_OPEN_SOURCE;assert(executable&&source);
const scratch=await mkdtemp('/private/tmp/willyou-image-open-A-'),root=join(scratch,'project');await mkdir(root);
await writeFile(join(root,'picture.png'),await readFile(source));await chmod(join(root,'picture.png'),0o444);
await writeFile(join(root,'images.md'),'# V02 original image\n\n![Original image](picture.png)\n');
const sha=b=>createHash('sha256').update(b).digest('hex');
const disk=async()=>Object.fromEntries(await Promise.all(['picture.png','images.md'].map(async name=>{const p=join(root,name),s=await stat(p,{bigint:true});return[name,{sha256:sha(await readFile(p)),inode:String(s.ino),mtimeNs:String(s.mtimeNs)}]})));
const r={at:new Date().toISOString(),scratch,root,caseId:'M9-T-V02',asarSha256:sha(await readFile(resolve(executable,'../../Resources/app.asar'))),driverSha256:sha(await readFile(fileURLToPath(import.meta.url))),before:await disk(),checks:[],status:'running',boundary:'Normal packaged Markdown/FileService/native image/readonly new-tab route;fresh project,two input-only PTYs,trusted pointer input. Fault cases ONLY wrap original related handler:after real successful resolution,close that real capability and return null or throw an explicitly recorded error at first validation or second new-tab resolution. Normal successes original untouched. No Store/DOM/editor/source replacement,clipboard/model/external resource or native-picker operation.'};
let app,fixture,observed=false,faultInstalled=false,stage='setup';
const tabs=()=>app.evaluate('[...document.querySelectorAll(".fw-tab")].map(e=>({name:e.querySelector(".fw-tab-name")?.textContent||e.getAttribute("aria-label")||e.textContent.trim(),selected:e.classList.contains("selected")}))');
const rightClick=async()=>{const p=await app.evaluate(`(()=>{const e=document.querySelector('img[data-md-src="picture.png"]');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('Image target occluded');return{x,y}})()`);for(const type of['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'right',clickCount:1})});await app.waitFor('!!document.querySelector(".fw-embedded-image-menu")');};
async function menuOpen(){await rightClick();await app.click('.fw-embedded-image-menu [role=menuitem]','在新标签打开图片');}
async function markdown(){await app.open('images.md');await app.waitFor('document.querySelector(\'img[data-md-src="picture.png"]\')?.naturalWidth===1600');}
async function arm(mode,nth){await app.mainEvaluate(`(()=>{globalThis.__v02Fault.arm={mode:${JSON.stringify(mode)},nth:${nth},count:0};return true})()`,{synchronous:true});}
async function restoreFault(){return app.mainEvaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),s=globalThis.__v02Fault;e.ipcMain.removeHandler('files.related');e.ipcMain.handle('files.related',s.original);const out={restored:e.ipcMain._invokeHandlers.get('files.related')===s.original,rows:s.rows,arm:s.arm};delete globalThis.__v02Fault;return out})()`,{synchronous:true});}
try{
 fixture=await openTaskFileFixture({executable,scratch,root,name:'V02 original image new tab'});app=fixture.app;r.pid=app.processId;
 await fixture.show('T2');await fixture.show('T1');
 const receiver=async label=>{const end=Date.now()+15000;for(;;){try{return await fixture.receiver(label)}catch(e){if(e.code!=='ENOENT')throw e;assert(Date.now()<end,'Own input receiver ready');await pause(30)}}};
 r.receiversBefore={T1:await receiver('T1'),T2:await receiver('T2')};
 await installFileMethodObserver(app,['open','read','related','chunk','closeDocument','save','saveCopy']);observed=true;
 await app.mainEvaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),s={original:e.ipcMain._invokeHandlers.get('files.related'),arm:null,rows:[]};globalThis.__v02Fault=s;e.ipcMain.removeHandler('files.related');e.ipcMain.handle('files.related',async(event,...args)=>{const value=await s.original(event,...args);if(args[1]==='picture.png'&&s.arm&&++s.arm.count===s.arm.nth){const arm=s.arm;s.arm=null;const row={at:Date.now(),mode:arm.mode,nth:arm.nth,originalRef:value.ref,originalHash:value.revision.hash,originalPath:value.absolutePath};s.rows.push(row);await e.ipcMain._invokeHandlers.get('files.closeDocument')(event,value.ref);row.originalCapabilityClosed=true;if(arm.mode==='empty'){row.sent='null';return null;}row.sent='Error: V02 injected asset resolution failure';throw Error('V02 injected asset resolution failure');}return value;});return true})()`,{synchronous:true});faultInstalled=true;
 for(const theme of['light','dark']){
  await app.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
  for(const scenario of[{mode:'normal',nth:0},{mode:'empty',nth:1},{mode:'error',nth:1},{mode:'empty',nth:2},{mode:'error',nth:2},{mode:'recovered',nth:0}]){
   stage=theme+':'+scenario.mode+':'+scenario.nth;await markdown();const beforeTabs=await tabs();
   if(scenario.nth)await arm(scenario.mode,scenario.nth);
   await menuOpen();
   if(scenario.nth){
    await app.waitFor('!!document.querySelector(".fw-image-notice")');const notice=await app.evaluate('document.querySelector(".fw-image-notice").textContent');
    if(scenario.mode==='empty')assert.match(notice,/无法.*打开图片|图片来源为空/,'Empty asset must have a meaningful open-failure notice');else assert.match(notice,/V02 injected asset resolution failure/);
    assert.deepEqual(await tabs(),beforeTabs);assert(!await app.evaluate('!!document.querySelector(".fw-ordinary-image")'));assert(await app.evaluate('document.activeElement?.matches(\'img[data-md-src="picture.png"]\')'));
    r.checks.push({theme,...scenario,notice,noNewTab:true,sourceFocusRestored:true});await app.screenshot(join(scratch,theme+'-'+scenario.mode+'-'+scenario.nth+'.png'));
   }else{
    await app.waitFor('document.querySelector(".fw-ordinary-image img")?.naturalWidth===1600');const rows=await observeFileMethods(app),opened=rows.filter(x=>x.method==='open'&&x.output?.relativePath==='picture.png').at(-1);assert(opened?.args[0].readOnly&&!opened.output.writable);
    assert(!await app.evaluate('!!document.querySelector(".fw-gallery,.fw-codemirror,.fw-office-structure-editor")'));
    const current=await tabs();assert.equal(current.length,beforeTabs.length+1);r.checks.push({theme,...scenario,readonlyOpen:opened,decodedWidth:1600,tabs:current});await app.screenshot(join(scratch,theme+'-'+scenario.mode+'.png'));await app.click('[aria-label="关闭 picture.png"]');
    await app.waitFor('!document.querySelector(".fw-ordinary-image")');
   }
   assert.deepEqual(await disk(),r.before);await writeFile(join(scratch,'progress.json'),JSON.stringify({...r,stage},null,2)+'\n');
  }
 }
 r.fault=await restoreFault();faultInstalled=false;assert(r.fault.restored&&r.fault.rows.length===8&&r.fault.rows.every(x=>x.originalCapabilityClosed&&x.originalHash===r.before['picture.png'].sha256));
 r.rpc=await observeFileMethods(app);assert(!r.rpc.some(x=>['save','saveCopy'].includes(x.method)));assert(r.rpc.every(x=>!x.delivered||x.before===x.after&&x.input===x.inputAfter));r.restored=await restoreFileMethodObserver(app);observed=false;assert(Object.values(r.restored).every(Boolean));
 r.receiversAfter={T1:await fixture.receiver('T1'),T2:await fixture.receiver('T2')};for(const label of['T1','T2']){assert.equal(r.receiversAfter[label].pid,r.receiversBefore[label].pid);assert.equal(r.receiversAfter[label].rawHex,'');assert.equal(r.receiversAfter[label].executedCommands,0);}
 await app.click('[aria-label="关闭 images.md"]');for(const task of Object.values(fixture.tasks))await app.invoke('tasks.kill',task.task.id);
 r.after=await disk();assert.deepEqual(r.after,r.before);assert.deepEqual(app.rendererErrors,[]);await writeFile(join(scratch,'electron.log'),app.logs());
 const ready={scratch,pid:r.pid,status:'awaiting-original-native-menu-quit',app:executable};await writeFile(join(scratch,'quit-ready.json'),JSON.stringify(ready)+'\n');console.log(JSON.stringify(ready));r.exit=await app.waitForExit(120000);assert.equal(r.exit.code,0);assert.equal(r.exit.signal,null);await app.close();app=null;fixture=null;r.status='passed';
}catch(error){r.status='failed';r.stage=stage;r.error=String(error);r.stack=error.stack;process.exitCode=1;if(app)try{r.dom=await app.evaluate('document.body.innerText');r.lastTabs=await tabs();await app.screenshot(join(scratch,'failure.png'));}catch{}}
finally{if(app){if(faultInstalled)try{r.failedFaultRestore=await restoreFault()}catch{}if(observed)try{r.failedRestore=await restoreFileMethodObserver(app)}catch{}await writeFile(join(scratch,'failure-electron.log'),app.logs());if(fixture)await fixture.close();else await app.close();}r.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,checks:r.checks.length,scratch,error:r.error}));}
