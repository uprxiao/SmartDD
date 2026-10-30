// Y28: actual typed instruction -> real PTY CLI -> independent disk/watch UI.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,unlink,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {openTaskFileFixture} from '../lib/task-file-fixture.mjs';
import {installFileMethodObserver,observeFileMethods,restoreFileMethodObserver} from '../lib/file-method-observer.mjs';
import {pause} from '../lib/electron-harness.mjs';
const executable=process.env.WILLYOU_FILES_APP;assert(executable);
const scratch=await mkdtemp('/private/tmp/willyou-y28-terminal-A-'),root=join(scratch,'project');await mkdir(root);
const scenarios=['light','dark'].flatMap(theme=>['busy','stopped'].flatMap(phase=>['CLI','ordinary'].map(writer=>({theme,phase,writer,directory:[theme,phase,writer].join('-')}))));
for(const s of scenarios){await mkdir(join(root,s.directory));for(const name of ['opened.txt','unopened.txt','deleted.txt'])await writeFile(join(root,s.directory,name),'Original '+s.directory+'/'+name+' 中文🙂\n');}
const sentinel='Y28 unchanged sentinel 中文🙂\n';await writeFile(join(root,'sentinel.txt'),sentinel);
const sha=value=>createHash('sha256').update(value).digest('hex'),norm=value=>value.replace(/\r\n?/g,'\n');
const r={at:new Date().toISOString(),scratch,root,executable,caseId:'M9-T-Y28',layer:'A',status:'running',checks:[],boundary:'Unchanged real packaged App, own project/userData/PTYs. Explicit JSON instruction is typed through actual xterm, then a separate trusted Enter. Actual Python CLI executes cwd-scoped IO using its own OS permissions, no App files/save RPC and no model/Claude invocation. Busy means a live CLI doing the batch then sustained real output, not model computation. Ordinary Node writer is an independent external process. Real tree, clean activation, refresh, manual edit and ordinary conflict controls use trusted CDP input; model reads are read-only. No Store/editor/result injection, native focus/system clipboard/chooser or daily data.'};
let fixture,app,observed=false,stage='setup';const source=()=>app.evaluate('document.querySelector(".fw-editor-host .cm-content")?.cmTile?.root?.view?.state.doc.toString()');
const poll=async(fn,label,ms=15000)=>{const end=Date.now()+ms;for(;;){const value=await fn();if(value)return value;assert(Date.now()<end,label);await pause(30)}};
async function checkpoint(){await writeFile(join(scratch,'partial.json'),JSON.stringify(r,null,2)+'\n');}
async function content(text){await app.waitFor('document.querySelector(".fw-editor-host .cm-content")?.cmTile?.root?.view?.state.doc.toString()==='+JSON.stringify(norm(text)));}
const tab=relative=>'.fw-tab [role=tab][title='+JSON.stringify(join(root,relative))+']';
async function pin(){const point=await app.evaluate('(()=>{const e=document.querySelector(".fw-tab [role=tab][aria-selected=true]"),b=e.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2}})()');for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,button:'left',clickCount:2,...point});await app.waitFor('!document.querySelector(".fw-tab [role=tab][aria-selected=true]")?.closest(".fw-tab").classList.contains("preview")');}
async function refresh(){await app.click('[aria-label="文件菜单"]');await app.click('[role=menuitem]','刷新文件和目录');}
async function command(label,value){const id=randomUUID(),request={...value,id},task=fixture.tasks[label];await app.click(fixture.terminal(task)+' .xterm-screen');await app.waitFor('document.activeElement?.classList.contains("xterm-helper-textarea")');await app.cdp('Input.insertText',{text:JSON.stringify(request)});await app.key('Enter','Enter');const result=await poll(async()=>{const s=await fixture.receiver(label);return s.receipts.find(x=>x.id===id)?s:null},'Actual typed CLI instruction did not execute');assert(!result.error,result.error);return{request,state:result};}
async function stop(label){const task=fixture.tasks[label];await poll(async()=>!(await app.invoke('tasks.get',task.task.id)).ptyId,'Own CLI PTY did not finish');await app.waitFor('document.body.innerText.includes("[进程已退出")');const value=await fixture.receiver(label);assert.equal(value.normalExit,true);return value;}
async function clean(){assert.equal(await app.evaluate('Boolean(document.querySelector(".fw-conflict-strip"))'),false);assert.equal(await app.evaluate('Boolean(document.querySelector("[role=dialog]"))'),false);assert.notEqual(await app.evaluate('document.querySelector(".fw-footer [role=status]")?.textContent'),'有未保存修改');}
try{
 fixture=await openTaskFileFixture({executable,scratch,root,name:'A · Y28 independent CLI/disk',taskPrograms:{T1:{receiverScript:'scripts/files/terminal-disk-cli.py'},T2:{receiverScript:'scripts/files/terminal-disk-cli.py'}}});app=fixture.app;r.appPid=app.processId;
 r.asarSha256=sha(await readFile(resolve(executable,'../../Resources/app.asar')));r.brokerSha256=sha(await readFile(resolve(executable,'../../Resources/native/willyou-files')));
 await installFileMethodObserver(app,['open','read','refresh','save','checkpoint','watch','stopWatch']);observed=true;
 for(const label of ['T1','T2']){const initial=await poll(async()=>{try{const s=await fixture.receiver(label);return s.ready&&s.tty&&s.cwd===root?s:null}catch{return null}},'Real CLI did not start');assert.equal(initial.cwd,root);r[label]={pid:initial.pid,ptyId:fixture.tasks[label].ptyId};}
 await app.evaluate('(()=>{document.title="A · Y28 · isolated CLI and disk";return true})()');
 r.cliByTheme={};r.ptyExitEvents=[];
 for(const theme of ['light','dark']){
  if(theme==='dark'){for(const label of ['T1','T2']){const old=fixture.tasks[label],previous=await fixture.receiver(label);const current=await app.invoke('tasks.create',{projectId:app.project.id,dirId:app.project.dirs[0].id,aiProfileId:old.task.aiProfileId,firstMessage:''});fixture.tasks[label]=current;await poll(async()=>{const state=await fixture.receiver(label);return state.tty&&state.cwd===root&&state.pid!==previous.pid},'Fresh real CLI did not initialize');}await app.cdp('Page.reload');await app.waitFor(app.exists('[data-task-id='+JSON.stringify(fixture.tasks.T1.task.id)+']'));}
  await app.evaluate('(()=>{window.__y28Exited=[];window.electronAPI.eventOn("pty:exit",e=>window.__y28Exited.push(e));return true})()');
  await app.invoke('appSettings.update','theme','y'+theme);
  // Each theme uses fresh prepared tasks. Retained output is not a running PTY.
  for(const phase of ['busy','stopped']){
   const label=phase==='busy'?'T1':'T2';await fixture.show(label);const ready=await fixture.receiver(label);assert.equal(ready.cwd,root);
   for(const writer of ['CLI','ordinary']){
    const s=scenarios.find(s=>s.theme===theme&&s.phase===phase&&s.writer===writer),relative=s.directory+'/opened.txt';stage=s.directory;
    await app.open(relative);await content('Original '+relative+' 中文🙂\n');await pin();await app.open('sentinel.txt');await content(sentinel);
    const value='External '+s.directory+' 中文🙂\n';let receipt;
    if(writer==='CLI'){receipt=await command(label,{op:'batch',directory:s.directory,value,exitAfter:phase==='stopped'});if(phase==='stopped')receipt.stopped=await stop(label);}
    else{for(const name of ['opened.txt','unopened.txt','created.txt'])await writeFile(join(root,s.directory,name),value+name+'\n');await unlink(join(root,s.directory,'deleted.txt'));receipt={writerPid:process.pid,ordinaryExternal:true};}
    await app.open(s.directory+'/unopened.txt');await content(value+'unopened.txt\n');await clean();await app.click(tab(relative));await content(value+'opened.txt\n');await clean();
    await app.waitFor(app.exists(app.tree(s.directory+'/created.txt')));await app.waitFor('!'+app.exists(app.tree(s.directory+'/deleted.txt')));
    const beforeRefresh=await source();await refresh();await content(beforeRefresh);await clean();
    const files={};for(const name of ['opened.txt','unopened.txt','created.txt']){const bytes=await readFile(join(root,s.directory,name));assert.equal(bytes.toString(),value+name+'\n');files[name]=sha(bytes);}await assert.rejects(()=>stat(join(root,s.directory,'deleted.txt')));
    const taskState=await app.invoke('tasks.get',fixture.tasks[label].task.id),cli=await fixture.receiver(label);
    if(phase==='stopped')assert.equal(taskState.ptyId,null);else{assert.equal(taskState.ptyId,fixture.tasks[label].ptyId);assert(cli.outputTicks>0);}
    assert.equal((await observeFileMethods(app)).filter(x=>x.method==='save').length,0);
    r.checks.push({...s,receipt,files,treeWatchBeforeRefresh:true,unopenedAndReactivatedSourceExact:true,cliPid:cli.pid,ptyId:taskState.ptyId,outputTicks:cli.outputTicks,pass:true});await checkpoint();await app.screenshot(join(scratch,s.directory+'.png'));
    for(const path of [relative,s.directory+'/unopened.txt'])if(await app.evaluate(app.exists(tab(path))))await app.click('.fw-tab:has([role=tab][title='+JSON.stringify(join(root,path))+']) [aria-label^=关闭]');
    if(await app.evaluate('document.querySelector('+JSON.stringify(app.tree(s.directory))+')?.getAttribute("aria-expanded")==="true"'))await app.click(app.tree(s.directory));
   }
  }
  stage=theme+':manual-dirty-then-CLI';await fixture.show('T1');const relative=theme+'-busy-CLI/opened.txt';await app.open(relative);const before=await readFile(join(root,relative),'utf8');await content(before);await pin();
  const automatic=await app.evaluate('document.querySelector(".fw-footer input[type=checkbox]")?.checked');if(automatic)await app.click('.fw-footer input[type=checkbox]');
  const local='Local unsaved '+theme+' 手工🙂\n',disk='CLI after unsaved '+theme+' 外改🙂\n';await app.click('.fw-editor-host .cm-content');await app.key('a','KeyA',4);await app.cdp('Input.insertText',{text:local});await content(local);assert.equal(await readFile(join(root,relative),'utf8'),before);
  const receipt=await command('T1',{op:'write',path:relative,value:disk});await app.waitFor('Boolean(document.querySelector(".fw-conflict-strip"))');assert.equal(await source(),local);assert.equal(await readFile(join(root,relative),'utf8'),disk);await app.click('.fw-disk-preview summary');await app.waitFor('document.querySelector('+JSON.stringify('[aria-label="磁盘版本 内容"]')+')?.cmTile?.root?.view?.state.doc.toString()==='+JSON.stringify(disk));
  const buttons=await app.evaluate('[...document.querySelectorAll(".fw-conflict-strip button")].map(x=>x.textContent.trim())');for(const text of ['继续编辑','保留我的修改','使用磁盘版本'])assert(buttons.includes(text));assert.equal((await observeFileMethods(app)).filter(x=>x.method==='save').length,0);await app.screenshot(join(scratch,theme+'-ordinary-conflict.png'));
  await app.click('.fw-conflict-strip button','使用磁盘版本');await content(disk);await clean();assert.equal(await readFile(join(root,relative),'utf8'),disk);r.checks.push({theme,scenario:'manual-dirty-before-real-CLI-write',receipt,local,disk,ordinaryConflictButtons:buttons,localPreservedBeforeDecision:true,chosenDiskWithoutAppWrite:true,pass:true});await checkpoint();await app.click('.fw-tab:has([role=tab][title='+JSON.stringify(join(root,relative))+']) [aria-label^=关闭]');
  for(const label of ['T1','T2'])if((await app.invoke('tasks.get',fixture.tasks[label].task.id)).ptyId){await fixture.show(label);await command(label,{op:'exit'});await stop(label);}
  await poll(async()=>(await app.evaluate('window.__y28Exited')).length===2,'Actual PTY exit events missing');r.ptyExitEvents.push(...await app.evaluate('window.__y28Exited'));r.cliByTheme[theme]={T1:await fixture.receiver('T1'),T2:await fixture.receiver('T2')};
 }
 assert.equal(await readFile(join(root,'sentinel.txt'),'utf8'),sentinel);r.trace=await observeFileMethods(app);assert.equal(r.trace.filter(x=>x.method==='save').length,0);for(const x of r.trace.filter(x=>x.delivered)){assert.equal(x.before,x.after);assert.equal(x.input,x.inputAfter);}r.restored=await restoreFileMethodObserver(app);observed=false;assert(Object.values(r.restored).every(Boolean));assert.deepEqual(app.rendererErrors,[]);
 r.cliFinal={T1:await fixture.receiver('T1'),T2:await fixture.receiver('T2')};assert.equal(r.ptyExitEvents.length,4);assert(r.ptyExitEvents.every(x=>x.code===0));stage='normal-App-exit';await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),50);return true})()");r.exit=await app.waitForExit(180000);assert.equal(r.exit.code,0);assert.equal(r.exit.signal,null);r.status='passed';
}catch(error){r.status='failed';r.failedStage=stage;r.error=String(error);r.stack=error.stack;process.exitCode=1;if(app)try{r.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(scratch,'failure.png'))}catch{}}
finally{if(app){if(observed)try{r.trace=await observeFileMethods(app);r.restored=await restoreFileMethodObserver(app)}catch{}await writeFile(join(scratch,'electron.log'),app.logs());await fixture.close();}r.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,checks:r.checks.length,stage:r.failedStage,error:r.error,scratch}));}
