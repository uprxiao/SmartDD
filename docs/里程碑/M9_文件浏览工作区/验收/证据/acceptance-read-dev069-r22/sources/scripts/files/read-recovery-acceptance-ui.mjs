// H01: actual packaged renderer input, real external disk writes/permission
// faults, independent source hashes and post-workflow native draft readback.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmod,mkdir,mkdtemp,open,readFile,rename,stat,unlink,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
import {pause} from '../lib/electron-harness.mjs';

const executable=process.env.WILLYOU_FILES_APP;assert(executable);
const scratch=await mkdtemp('/private/tmp/willyou-read-recovery-'),projectPath=join(scratch,'project'),userData=join(scratch,'userdata');await mkdir(projectPath);
const source={'clean.txt':'Initial A 中文🙂\n','other.txt':'Other immutable\n','dirty.txt':'Dirty disk base\n','open-button.txt':'Recovered button\n','open-activate.txt':'Recovered activation\n','open-refresh.txt':'Recovered refresh\n','open-tree.txt':'Recovered tree\n'};
for(const[name,text]of Object.entries(source))await writeFile(join(projectPath,name),text);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const disk=async name=>{const p=join(projectPath,name),s=await stat(p,{bigint:true}),bytes=await readFile(p);return{text:bytes.toString(),hash:sha(bytes),inode:String(s.ino),mtimeNs:String(s.mtimeNs)};};
const resources=resolve(dirname(executable),'../Resources'),result={caseId:'M9-T-H01',startedAt:new Date().toISOString(),app:executable,asarSha256:sha(await readFile(join(resources,'app.asar'))),brokerSha256:sha(await readFile(join(resources,'native/willyou-files'))),projectPath,scratch,status:'running',checks:[],watchFaults:[],boundary:'Actual packaged renderer pointer/keyboard, external Node writer and actual local filesystem faults. Normal watcher covers disk changes; only initial-open retries stop this private watcher via public IPC to distinguish explicit actions from automatic repair. Public IPC setup and post-workflow durable draft readbacks are I. Separate native I covers obsolete delivery. No CLI/model, old tasks, clipboard or physical OS focus.'};
let app,stage='setup';const permissionFiles=new Set(),held=[];
const writer=(name,text)=>execFileSync(process.execPath,['-e',"require('node:fs').writeFileSync(process.argv[1],process.argv[2])",join(projectPath,name),text],{timeout:5000,env:{PATH:'/usr/bin:/bin'}});
try{
 app=await openFileAcceptanceApp({executable,projectPath,userData,name:'M9 read recovery acceptance'});const{evaluate,cdp,click,waitFor,exists,key,invoke}=app;
 const tab=name=>`.fw-tab [role=tab][title=${JSON.stringify(join(projectPath,name))}]`;
 const observe=()=>evaluate("({source:document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString(),error:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent).join('|'),footer:document.querySelector('.fw-footer')?.textContent,active:document.querySelector('.fw-tab [role=tab][aria-selected=true]')?.getAttribute('title'),editors:document.querySelectorAll('.cm-editor').length})");
 const content=text=>waitFor(`document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString()===${JSON.stringify(text)}`);
 const pin=async()=>{const p=await evaluate("(()=>{const r=document.querySelector('.fw-tab [role=tab][aria-selected=true]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:2,...p});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:2,...p});};
 const openFile=async(name,text)=>{await app.open(name);if(text!==undefined)await content(text);await pin();};
 const refresh=async()=>{await click('[aria-label=文件菜单]');await click('[role=menuitem]','刷新文件和目录');};
 const error=pattern=>waitFor(`new RegExp(${JSON.stringify(pattern)}).test([...document.querySelectorAll('[role=alert]')].map(e=>e.textContent).join('|'))`);
 const errorsClear=()=>waitFor("[...document.querySelectorAll('[role=alert]')].every(e=>!e.textContent)");
 await evaluate("window.__readRecoveryWatches=[];window.electronAPI.eventOn('files:watch',x=>window.__readRecoveryWatches.push(x.id));true");
 stage='open-A';await openFile('clean.txt',source['clean.txt']);
 stage='close-external-reopen';await click('[aria-label="关闭 clean.txt"]');await waitFor(`!${exists(tab('clean.txt'))}`);writer('clean.txt','External B after close 中文🙂\n');await openFile('clean.txt','External B after close 中文🙂\n');
 result.checks.push({step:stage,ui:await observe(),disk:await disk('clean.txt')});
 stage='reactivate';await openFile('other.txt',source['other.txt']);writer('clean.txt','External C inactive 中文🙂\n');await click(tab('clean.txt'));await content('External C inactive 中文🙂\n');result.checks.push({step:stage,ui:await observe(),disk:await disk('clean.txt')});
 stage='explicit-refresh';writer('clean.txt','External D explicit 中文🙂\n');await refresh();await content('External D explicit 中文🙂\n');result.checks.push({step:stage,ui:await observe(),disk:await disk('clean.txt')});

 stage='permission-read-failure';const beforeFault=await disk('clean.txt');await chmod(join(projectPath,'clean.txt'),0);permissionFiles.add('clean.txt');await refresh();await error('PERMISSION|权限|Permission|denied');assert.equal((await observe()).source,beforeFault.text);await app.screenshot(join(scratch,'permission-failed.png'));
 await chmod(join(projectPath,'clean.txt'),0o644);writer('clean.txt','External E after permission 中文🙂\n');await refresh();await content('External E after permission 中文🙂\n');await errorsClear();result.checks.push({step:stage,beforeFault,recovered:await observe(),disk:await disk('clean.txt')});
 stage='missing-read-failure';const beforeMissing=await disk('clean.txt');held.push(await open(join(projectPath,'clean.txt'),'r'));const heldPath=join(scratch,'held-original.txt');await rename(join(projectPath,'clean.txt'),heldPath);await refresh();await error('MISSING|不存在|找不到|No such');assert.equal((await observe()).source,beforeMissing.text);await app.screenshot(join(scratch,'missing.png'));await rename(heldPath,join(projectPath,'clean.txt'));await refresh();await content(beforeMissing.text);await errorsClear();assert.equal((await disk('clean.txt')).inode,beforeMissing.inode);
 await unlink(join(projectPath,'clean.txt'));await refresh();await error('MISSING|不存在|找不到|No such');writer('clean.txt','External F restored new inode 中文🙂\n');await refresh();await error('另一文件');assert.equal((await observe()).source,beforeMissing.text);await click('[aria-label="关闭 clean.txt"]');await waitFor(`!${exists(tab('clean.txt'))}`);await openFile('clean.txt','External F restored new inode 中文🙂\n');await errorsClear();const restored=await disk('clean.txt');assert.notEqual(restored.inode,beforeMissing.inode);result.checks.push({step:stage,beforeMissing,restored,originalInodeRetry:true,newInodeRequiresExplicitCloseAndReopen:true,ui:await observe()});

 stage='dirty-unreadable-recovery';await openFile('dirty.txt',source['dirty.txt']);await click('.cm-content');await key('ArrowDown','ArrowDown',4);await cdp('Input.insertText',{text:'Retained manual draft 中文🙂'});const dirtyText=source['dirty.txt']+'Retained manual draft 中文🙂';await content(dirtyText);await waitFor("document.querySelector('.fw-footer [role=status]')?.textContent==='有未保存修改'");await chmod(join(projectPath,'dirty.txt'),0);permissionFiles.add('dirty.txt');await refresh();await error('PERMISSION|权限|Permission|denied');assert.equal((await observe()).source,dirtyText);await chmod(join(projectPath,'dirty.txt'),0o400);await refresh();await errorsClear();assert.equal((await observe()).source,dirtyText);assert((await observe()).footer.includes('有未保存修改'));await pause(650);assert.equal((await disk('dirty.txt')).text,source['dirty.txt']);result.checks.push({step:stage,ui:await observe(),disk:await disk('dirty.txt'),expectedDraft:dirtyText});await app.screenshot(join(scratch,'dirty-read-recovered.png'));

 for(const[name,trigger]of [['open-button.txt','button'],['open-activate.txt','activate'],['open-refresh.txt','refresh'],['open-tree.txt','tree']]){
  stage='initial-open-failure-'+trigger;await chmod(join(projectPath,name),0);permissionFiles.add(name);await app.open(name);await error('PERMISSION|权限|Permission|denied');assert.equal((await observe()).editors,0);await pin();
  const ids=await evaluate('[...new Set(window.__readRecoveryWatches)]');assert(ids.length,'Own watcher subscription must be observed');for(const id of ids)await invoke('files.stopWatch',id);await pause(300);await error('PERMISSION|权限|Permission|denied');
  if(trigger==='button'){await waitFor(exists('.fw-empty button'));await app.screenshot(join(scratch,'initial-open-error.png'));}
  result.watchFaults.push({trigger,stoppedOwnIds:ids});await chmod(join(projectPath,name),0o400);
  if(trigger==='button'){assert(await evaluate(exists('.fw-empty button')),'Failed open must offer retry in its placeholder');await app.screenshot(join(scratch,'initial-open-error.png'));await click('.fw-empty button','重试');}
  if(trigger==='activate'){await click(tab('other.txt'));await content(source['other.txt']);await click(tab(name));}
  if(trigger==='refresh')await refresh();
  if(trigger==='tree')await click(app.tree(name));
  await content(source[name]);await errorsClear();assert.equal((await observe()).editors,1);result.checks.push({step:stage,trigger,recovered:await observe(),disk:await disk(name)});
 }
 stage='native-draft-oracle';assert.equal((await invoke('tasks.list')).length,0);const roots=await invoke('files.roots',{kind:'project',projectId:app.project.id}),root=roots.roots[0];const doc=await invoke('files.open',{lease:root.lease,generation:root.generation,relativePath:'dirty.txt'}),drafts=await invoke('files.drafts',doc.ref);result.drafts=[];for(const d of drafts)result.drafts.push({metadata:d,content:await invoke('files.readDraft',doc.ref,d.id)});assert(result.drafts.some(d=>Buffer.from(d.content.base64,'base64').toString()===dirtyText));await invoke('files.closeDocument',doc.ref);assert.equal((await disk('dirty.txt')).text,source['dirty.txt']);assert.deepEqual(app.rendererErrors,[]);result.status='passed';
}catch(error){result.status='failed';result.error=String(error);result.failedStage=stage;process.exitCode=1;if(app)try{await app.screenshot(join(scratch,'failure.png'));result.failureDom=await app.evaluate('document.body.innerText');}catch{}}
finally{if(app){await writeFile(join(scratch,'electron.log'),app.logs());await app.close();}for(const name of permissionFiles)await chmod(join(projectPath,name),0o644);for(const fd of held)await fd.close();result.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks.length,failedStage:result.failedStage,error:result.error,artifacts:scratch}));}
