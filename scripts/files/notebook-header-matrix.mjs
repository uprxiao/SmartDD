import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { notebookHeaderFixtures } from './notebook-header-fixtures.mjs';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { pause } from '../lib/electron-harness.mjs';
import { installFileMethodObserver, observeFileMethods, restoreFileMethodObserver } from '../lib/file-method-observer.mjs';

const executable=process.env.WILLYOU_FILES_APP, prototype=process.env.WILLYOU_NOTEBOOK_HEADER_P==='1';
assert(executable);
const scratch=await mkdtemp('/private/tmp/willyou-notebook-header-'+(prototype?'P-':'A-'));
const projectPath=join(scratch,'project'); await mkdir(projectPath);
const fixtures=notebookHeaderFixtures(), names=Object.keys(fixtures), sha=b=>createHash('sha256').update(b).digest('hex');
for(const [name,source] of Object.entries(fixtures)) await writeFile(join(projectPath,name),source);
const fingerprint=async()=>Object.fromEntries(await Promise.all(names.map(async name=>{const p=join(projectPath,name),s=await stat(p,{bigint:true});return[name,{sha256:sha(await readFile(p)),inode:String(s.ino),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)}]})));
const r={at:new Date().toISOString(),scratch,prototype,projectPath,before:await fingerprint(),checks:[],status:'running',asarSha256:sha(await readFile(resolve(executable,'../../Resources/app.asar'))),boundary:prototype?'Built original FileNotebookPreview; actual UI select/theme and Chromium anchor download of public CRLF fixtures, not native I/A.':'Original packaged App/Notebook/native save dialog; trusted CDP and native CUA selection, passive original RPC observation; no code execution or picker override.'};
let app,observed=false,entry,stage='setup';
const saveProgress=()=>writeFile(join(scratch,'progress.json'),JSON.stringify({...r,stage},null,2)+'\n');
try {
  app=await openFileAcceptanceApp({executable,projectPath,userData:join(scratch,'userdata'),name:'M9 T32 Notebook header '+(prototype?'P':'A'),inspectMain:true});r.pid=app.processId;entry=await app.evaluate('location.href');
  if(prototype){assert(process.env.WILLYOU_NOTEBOOK_HEADER_URL);await app.cdp('Page.navigate',{url:process.env.WILLYOU_NOTEBOOK_HEADER_URL});await app.waitFor('!!document.querySelector(".fa-notebook")');}
  else{await installFileMethodObserver(app,['open','read','closeDocument','saveCopy']);observed=true;}
  for(const theme of ['light','dark']){
    if(prototype){if(theme==='dark')await app.click('[data-testid=notebook-header-theme]');assert.equal(await app.evaluate('document.documentElement.dataset.theme'),theme);await mkdir(join(scratch,theme));await app.cdp('Page.setDownloadBehavior',{behavior:'allow',downloadPath:join(scratch,theme)});}
    else await app.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
    for(const [index,name]of names.entries()){
      stage=theme+':'+name;
      if(prototype){await app.click('[data-testid="notebook-header-file-'+index+'"]');}
      else await app.open(name);
      const title=JSON.parse(fixtures[name]).metadata.title??name.replace(/\.ipynb$/i,'');
      await app.waitFor(`document.querySelector('.fa-notebook .fw-artifact-tools strong')?.textContent===${JSON.stringify(title)}&&document.querySelectorAll('.fa-notebook-cell').length===4`);
      const header=await app.evaluate(`(()=>{const root=document.querySelector('.fa-notebook');return{title:root.querySelector('.fw-artifact-tools strong').textContent,count:root.querySelector('.fw-artifact-tools small').textContent,actions:[...root.querySelectorAll('.fw-artifact-tools button')].map(e=>({label:e.ariaLabel,disabled:e.disabled})),cells:[...root.querySelectorAll('.fa-notebook-cell>summary')].map(e=>({title:e.querySelector('span[title]').title,ordinal:e.querySelector('small').textContent,run:e.querySelector('.fa-notebook-execution small')?.textContent??null,interactive:!!e.querySelector('button,a,[role=button]')}))}})()`);
      assert.equal(header.title,title);assert.equal(header.count,'4 个单元');
      assert.deepEqual(header.cells.map(x=>x.title),['代码标题 中文🙂','说明标题','Markdown 标题','Raw cell 4']);
      assert.deepEqual(header.cells.map(x=>x.ordinal),['Cell 1 of 4','Cell 2 of 4','Cell 3 of 4','Cell 4 of 4']);
      assert.deepEqual(header.cells.map(x=>x.run),['Run 0','Run 7',null,null]);assert(header.cells.every(x=>!x.interactive));
      assert.equal(header.actions.length,1);assert(!header.actions[0].disabled);assert(header.actions[0].label.startsWith('下载 Notebook'));
      r.checks.push({theme,file:name,scenario:'metadata title/fallback,count,cell ordinal,readonly Run0/7 and sole header download',header});
      await app.screenshot(join(scratch,theme+'-'+name+'.png'));
      if(prototype){
        await app.click('[aria-label="下载 Notebook 示例"]');const p=join(scratch,theme,name),end=Date.now()+10000;
        for(;;){try{assert.equal(sha(await readFile(p)),r.before[name].sha256);break;}catch(error){if(error.code!=='ENOENT')throw error;}assert(Date.now()<end,'P download did not finish');await pause(50);}
        r.checks.push({theme,file:name,scenario:'actual P anchor download preserves exact CRLF bytes',path:p,sha256:sha(await readFile(p))});
      }
    }
    if(!prototype){
      stage=theme+':native-save';const before=(await observeFileMethods(app)).length;
      const ready={at:new Date().toISOString(),scratch,pid:r.pid,theme,status:'awaiting-original-native-save',source:join(projectPath,names[1]),destination:join(projectPath,'filename-fallback 副本.ipynb'),app:executable};
      await app.click('[aria-label="下载 Notebook"]');await saveProgress();await writeFile(join(scratch,'ready.json'),JSON.stringify(ready,null,2)+'\n');console.log(JSON.stringify(ready));
      const end=Date.now()+120000;let saved;
      for(;;){saved=(await observeFileMethods(app)).slice(before).find(x=>x.method==='saveCopy'&&x.delivered);if(saved)break;assert(Date.now()<end,'Native Notebook save not selected within this batch');await pause(100);}
      assert.equal(saved.output.state,'saved');assert.equal(saved.output.path,ready.destination);assert.equal(sha(await readFile(saved.output.path)),r.before[names[1]].sha256);
      r.checks.push({theme,scenario:'original native save dialog selected by CUA, exact original Notebook bytes',output:saved.output});
      await rename(saved.output.path,join(projectPath,theme+'-filename-fallback-copy.ipynb'));
      await app.waitFor('!document.querySelector(".fa-notebook [role=alert]")');await saveProgress();
    }
  }
  r.after=await fingerprint();assert.deepEqual(r.after,r.before);assert.deepEqual(app.rendererErrors,[]);r.rendererErrors=[];
  if(prototype){await app.cdp('Page.navigate',{url:entry});await app.waitFor('!!document.querySelector("[data-testid=nav-settings]")');}
  else {
    // Explicit UI close verifies the completed read-only preview releases its
    // document before the separate normal-App-exit observation.
    await app.click('[aria-label="关闭 filename-fallback.ipynb"]');await app.waitFor('!document.querySelector(".fa-notebook")');
    r.rpc=await observeFileMethods(app);assert(r.rpc.every(x=>!x.delivered||x.before===x.after&&x.input===x.inputAfter));r.restored=await restoreFileMethodObserver(app);observed=false;assert(Object.values(r.restored).every(Boolean));
    const path=join(scratch,'native-lifecycle.jsonl');
    await app.mainEvaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),fs=process.getBuiltinModule('fs'),p=${JSON.stringify(path)};for(const name of['before-quit','will-quit','quit','window-all-closed'])e.app.on(name,(_,code)=>{fs.appendFileSync(p,JSON.stringify({name,at:Date.now(),pid:process.pid,code:code??null,windows:e.BrowserWindow.getAllWindows().map(w=>({id:w.id,visible:w.isVisible()}))})+'\\n')});return true})()`);
  }
  assert.deepEqual(await app.invoke('tasks.list'),[]);await writeFile(join(scratch,'electron.log'),app.logs());
  if(process.env.WILLYOU_NOTEBOOK_NATIVE_QUIT==='1'){
    stage='awaiting-original-native-menu-quit';await saveProgress();const ready={at:new Date().toISOString(),scratch,pid:r.pid,status:stage,app:executable};await writeFile(join(scratch,'quit-ready.json'),JSON.stringify(ready,null,2)+'\n');console.log(JSON.stringify(ready));
  }else await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()");
  r.exit=await app.waitForExit(process.env.WILLYOU_NOTEBOOK_NATIVE_QUIT==='1'?120000:20000);assert.equal(r.exit.code,0);assert.equal(r.exit.signal,null);await app.close();app=null;r.status='passed';
} catch(error){r.status='failed';r.error=String(error);r.stack=error.stack;r.stage=stage;process.exitCode=1;if(app)try{r.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(scratch,'failure.png'));}catch{}}
finally{if(app){if(observed)try{r.failedRestore=await restoreFileMethodObserver(app);}catch{}await writeFile(join(scratch,'failure-electron.log'),app.logs());await app.close();}r.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,checks:r.checks.length,scratch,error:r.error}));}
