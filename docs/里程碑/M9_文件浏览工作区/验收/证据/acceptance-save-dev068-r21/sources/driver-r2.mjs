// Actual packaged-App input, with independent bytes/durable-draft inspection.
// Creates only disposable fixtures and an input-only PTY; never uses clipboard.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmod,mkdir,mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import {arch,release} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
import {pause} from '../lib/electron-harness.mjs';

const executable=process.env.WILLYOU_FILES_APP;assert(executable,'Set WILLYOU_FILES_APP');
const scratch=await mkdtemp('/private/tmp/willyou-save-recovery-'),projectPath=join(scratch,'project'),userData=join(scratch,'userdata'),receiverRoot=join(scratch,'receiver');
await mkdir(projectPath);await mkdir(receiverRoot);
const sha=value=>createHash('sha256').update(value).digest('hex');
const encodingCases=['LF','CRLF','CR'].flatMap(label=>[false,true].map(bom=>({name:`eol-${label}${bom?'-bom':''}.txt`,eol:{LF:'\n',CRLF:'\r\n',CR:'\r'}[label],bom})));
const fixtures={'shortcut.txt':Buffer.from('Shortcut base\n'),'menu.md':Buffer.from('# Menu base\n'),'close.txt':Buffer.from('Close text base\n'),'close.md':Buffer.from('# Close Markdown base\n'),'failed-close.txt':Buffer.from('Failed close base\n'),'failed-mode.md':Buffer.from('# Failed mode base\n'),'history.txt':Buffer.from('History base\n'),'other.txt':Buffer.from('Other immutable history\n'),'utf16-le.txt':Buffer.concat([Buffer.from([255,254]),Buffer.from('中文 UTF16\r\n','utf16le')]),'utf16-be.txt':Buffer.from([254,255,0,65,0,13,0,10]),'gb18030.txt':Buffer.from([196,227,186,195,13,10])};
for(const row of encodingCases){row.original=`Original 中文🙂${row.eol}Tail${row.eol}`;fixtures[row.name]=Buffer.concat([row.bom?Buffer.from([239,187,191]):Buffer.alloc(0),Buffer.from(row.original)]);}
for(const[name,bytes]of Object.entries(fixtures))await writeFile(join(projectPath,name),bytes);
const disk=async name=>{const path=join(projectPath,name),s=await stat(path,{bigint:true}),bytes=await readFile(path);return{base64:bytes.toString('base64'),hash:sha(bytes),inode:String(s.ino),mtimeNs:String(s.mtimeNs),size:String(s.size)};};
const before=Object.fromEntries(await Promise.all(Object.keys(fixtures).map(async name=>[name,await disk(name)])));
const resources=resolve(dirname(executable),'../Resources');
const result={startedAt:new Date().toISOString(),app:executable,asarSha256:sha(await readFile(join(resources,'app.asar'))),brokerSha256:sha(await readFile(join(resources,'native/willyou-files'))),system:{platform:process.platform,arch:arch(),release:release()},scratch,projectPath,userData,before,status:'running',checks:[],layers:'A: actual renderer pointer/keyboard and real packaged save. I: public IPC setup/teardown and post-workflow draft reads. Independent filesystem bytes and own input-only PTY state are oracles. No model, clipboard, global OS focus or physical IME claim.'};
let app,task,stage='setup';const permissions=new Set();
try{
 app=await openFileAcceptanceApp({executable,projectPath,userData,name:'M9 save/recovery acceptance'});
 const{cdp,evaluate,invoke,waitFor,key,click,exists}=app;
 const profile=await invoke('aiProfiles.create',{name:'Save shortcut input-only receiver',runner:'claude',executable:'/usr/bin/python3',args:[resolve('scripts/files/context-receiver.py'),receiverRoot],env:[{name:'CLAUDE_CONFIG_DIR',value:join(scratch,'isolated-cli-state'),secret:false}],color:null,isDefault:true});
 const launched=await invoke('tasks.create',{projectId:app.project.id,dirId:null,aiProfileId:profile.id,firstMessage:''});task=launched.task;result.task={id:task.id,ptyId:launched.ptyId};
 await cdp('Page.reload');await waitFor(exists(`[data-task-id="${task.id}"]`));await click(`[data-task-id="${task.id}"]`);
 await waitFor(`${exists('[data-testid=task-terminal] .xterm-screen')}||${exists('[data-testid=task-resume]')}`);
 if(!await evaluate(exists('[data-testid=task-terminal] .xterm-screen')))await click('[data-testid=task-resume]');
 await waitFor(exists('[data-testid=task-terminal] .xterm-screen'));
 const receiver=async()=>JSON.parse(await readFile(join(receiverRoot,'state.json'),'utf8'));
 for(let i=0;i<100;i++){try{result.receiverBefore=await receiver();break;}catch{await pause(50);}}assert(result.receiverBefore);assert.equal(result.receiverBefore.bytes,0);
 if(!await evaluate(exists('[data-testid=file-workspace]')))await click('[data-testid=task-files]');
 const active=()=>evaluate("({name:document.querySelector('.fw-tab [role=tab][aria-selected=true]')?.getAttribute('title'),text:document.querySelector('.cm-content')?.textContent,footer:document.querySelector('.fw-footer')?.textContent,alerts:[...document.querySelectorAll('.fw-save-strip[role=alert]')].map(e=>e.textContent),editors:document.querySelectorAll('.cm-editor').length,focus:document.activeElement?.getAttribute('aria-label'),source:!!document.querySelector('[aria-label=查看文档]'),document:!!document.querySelector('[aria-label=查看源码]')})");
 const pin=async()=>{const p=await evaluate("(()=>{const r=document.querySelector('.fw-tab [role=tab][aria-selected=true]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:2,...p});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:2,...p});};
 const open=async name=>{await app.open(name);await waitFor(`document.querySelector('.cm-content')?.getAttribute('aria-label')===${JSON.stringify(name+' 内容')}`);await pin();};
 const end=async()=>{await click('.cm-content');await key('ArrowDown','ArrowDown',4);};
 const insert=async text=>{await cdp('Input.insertText',{text});};
 const dirty=()=>waitFor("document.querySelector('.fw-footer [role=status]')?.textContent==='有未保存修改'");
 const clean=()=>waitFor("document.querySelector('.fw-footer [role=status]')?.textContent==='已保存'");
 const save=async method=>{if(method==='shortcut')await key('s','KeyS',4);else{await click('[aria-label=文件菜单]');await click('[role=menuitem]','保存文件');}await clean();};
 const equalDisk=async(name,bytes)=>{const d=await disk(name);assert.equal(d.base64,bytes.toString('base64'),name+' exact saved bytes');return d;};

 for(const[name,method]of [['shortcut.txt','shortcut'],['menu.md','menu']]){
  stage='H03-'+name;await open(name);await end();const suffix='Saved 中文🙂';await insert(suffix);await dirty();const pending=await active();assert.equal((await disk(name)).base64,before[name].base64);await save(method);
  const written=await equalDisk(name,Buffer.concat([fixtures[name],Buffer.from(suffix)]));assert.equal((await receiver()).bytes,0);
  result.checks.push({caseId:'M9-T-H03',name,method,pending,written,clean:await active(),terminalBytes:0});
 }
 for(const row of encodingCases){
  stage='H31-'+row.name;await open(row.name);await end();await insert('Added 中文🙂');await key('Enter','Enter');await insert('Last');await dirty();await save('shortcut');
  const expected=Buffer.concat([row.bom?Buffer.from([239,187,191]):Buffer.alloc(0),Buffer.from(row.original+'Added 中文🙂'+row.eol+'Last')]);
  result.checks.push({caseId:'M9-T-H31',name:row.name,bom:row.bom,eol:row.eol,expectedBase64:expected.toString('base64'),written:await equalDisk(row.name,expected),ui:await active()});
 }
 for(const name of ['utf16-le.txt','utf16-be.txt','gb18030.txt']){
  stage='H31-'+name;await app.open(name);await waitFor("!document.querySelector('.cm-content')&&document.querySelector('.fw-body .fw-empty')");const text=await evaluate("document.querySelector('.fw-body .fw-empty').innerText");assert(/UTF-16|UTF-8|解码|外部/.test(text),text);
  await click('[aria-label=文件菜单]');assert(await evaluate("[...document.querySelectorAll('[role=menuitem]')].every(e=>e.textContent.trim()!=='保存文件'||e.getAttribute('aria-disabled')==='true')"));await key('Escape','Escape');
  assert.deepEqual(await disk(name),before[name]);result.checks.push({caseId:'M9-T-H31',name,unsupportedReason:text,noEditor:true,sourceUnchanged:true});
 }
 for(const name of ['close.txt','close.md']){
  stage='H25-'+name;await open(name);await end();await insert('Close writes complete 中文🙂');await dirty();const pending=await active();assert.equal((await disk(name)).base64,before[name].base64);await click(`[aria-label="关闭 ${name}"]`);await waitFor(`!document.querySelector(${JSON.stringify(`.fw-tab [role=tab][title=${JSON.stringify(join(projectPath,name))}]`)})`);assert(!await evaluate(exists('[role=dialog]')));
  result.checks.push({caseId:'M9-T-H25',name,pending,written:await equalDisk(name,Buffer.concat([fixtures[name],Buffer.from('Close writes complete 中文🙂')])),closedWithoutDiscardPrompt:true});
 }
 stage='H32-history';await open('history.txt');await end();const versions=['History base\n'];
 for(const text of ['Step one\n','Step two\n','Step three\n']){await insert(text);versions.push(versions.at(-1)+text);await dirty();await pause(550);}
 await save('shortcut');await equalDisk('history.txt',Buffer.from(versions[3]));
 const textIs=text=>waitFor(`document.querySelector('.cm-content')?.textContent===${JSON.stringify(text)}`);
 await click('[aria-label=撤销]');await textIs(versions[2]);await dirty();const undone=await active();await click('[aria-label=重做]');await textIs(versions[3]);await clean();
 await open('other.txt');await end();await insert('Other local edit');await dirty();await key('z','KeyZ',4);await textIs(fixtures['other.txt'].toString());assert(!(await active()).footer.includes('有未保存修改'));
 await click(`.fw-tab [role=tab][title=${JSON.stringify(join(projectPath,'history.txt'))}]`);await textIs(versions[3]);await click('[aria-label=撤销]');await textIs(versions[2]);await dirty();await click('[aria-label=撤销]');await textIs(versions[1]);await click('[aria-label=撤销]');await textIs(versions[0]);await dirty();for(const text of versions.slice(1)){await click('[aria-label=重做]');await textIs(text);}await clean();
 assert.deepEqual(await disk('other.txt'),before['other.txt']);await equalDisk('history.txt',Buffer.from(versions[3]));result.checks.push({caseId:'M9-T-H32',versions,undone,final:await active(),otherDiskUnchanged:true});
 await app.screenshot(join(scratch,'history-saved.png'));

 stage='H26-failed-close';await open('failed-close.txt');await end();await insert('Retained dirty 中文🙂');await dirty();await chmod(join(projectPath,'failed-close.txt'),0o444);permissions.add('failed-close.txt');
 await click('[aria-label="关闭 failed-close.txt"]');await waitFor(exists('[role=dialog]'));await click('[role=dialog] button','继续查看');await waitFor('!document.querySelector("[role=dialog]")');const failedClose=await active();assert.equal(failedClose.text,fixtures['failed-close.txt'].toString()+'Retained dirty 中文🙂');assert(failedClose.footer.includes('有未保存修改'));assert(failedClose.alerts.length>0,'Save error must remain visible');assert.equal((await disk('failed-close.txt')).base64,before['failed-close.txt'].base64);
 result.checks.push({caseId:'M9-T-H26',name:'failed-close.txt',ui:failedClose,sourceNotWritten:true});await app.screenshot(join(scratch,'failed-close-continued.png'));

 stage='H23-failed-mode';await open('failed-mode.md');await end();await insert('Retained mode 中文🙂');await dirty();const prior=await active();assert(prior.document);assert.equal(prior.focus,'failed-mode.md 内容');await chmod(join(projectPath,'failed-mode.md'),0o444);permissions.add('failed-mode.md');
 await click('[aria-label=查看源码]');await waitFor("document.querySelector('.fw-save-strip[role=alert]')");const failedMode=await active();assert.equal(failedMode.text,prior.text);assert(failedMode.document&&!failedMode.source);assert.equal(failedMode.editors,1);assert.equal(failedMode.focus,prior.focus,'Failed mode switch must retain editor focus');assert(failedMode.footer.includes('有未保存修改'));assert.equal((await disk('failed-mode.md')).base64,before['failed-mode.md'].base64);
 result.checks.push({caseId:'M9-T-H23',name:'failed-mode.md',prior,ui:failedMode,sourceNotWritten:true});await app.screenshot(join(scratch,'failed-mode-kept-focus.png'));

 // Do not renew the active root capability during the user workflow.
 stage='post-workflow-native-drafts';result.receiverAfter=await receiver();assert.equal(result.receiverAfter.bytes,0);assert(result.receiverAfter.heartbeat>result.receiverBefore.heartbeat);assert.equal((await invoke('tasks.get',task.id)).ptyId,launched.ptyId);
 const roots=await invoke('files.roots',{kind:'task',taskId:task.id});result.drafts=[];
 for(const name of ['shortcut.txt','menu.md','close.txt','close.md','history.txt','failed-close.txt','failed-mode.md']){
  const doc=await invoke('files.open',{lease:roots.roots[0].lease,generation:roots.roots[0].generation,relativePath:name});const drafts=await invoke('files.drafts',doc.ref);const rows=[];for(const draft of drafts){const data=await invoke('files.readDraft',doc.ref,draft.id);rows.push({draft,data});}await invoke('files.closeDocument',doc.ref);
  if(name.startsWith('failed-')){assert(rows.length>0,name+' must retain durable draft');assert(rows.some(row=>JSON.stringify(row).includes('base64')));}else assert.equal(rows.length,0,name+' must resolve saved draft');result.drafts.push({name,rows});
 }
 result.after=Object.fromEntries(await Promise.all(Object.keys(fixtures).map(async name=>[name,await disk(name)])));
 assert.deepEqual(app.rendererErrors,[]);result.status='passed';
}catch(error){result.status='failed';result.error=String(error);result.failedStage=stage;process.exitCode=1;if(app){try{await app.screenshot(join(scratch,'failure.png'));result.failureDom=await app.evaluate('document.body.innerText');result.failureFocus=await app.evaluate("({label:document.activeElement?.getAttribute('aria-label'),tag:document.activeElement?.tagName,className:document.activeElement?.className})");}catch{}}}
finally{
 for(const name of permissions)await chmod(join(projectPath,name),0o644);
 if(app){if(task)try{await app.invoke('tasks.kill',task.id);}catch{}await writeFile(join(scratch,'electron.log'),app.logs());await app.close();}
 result.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks.length,failedStage:result.failedStage,error:result.error,artifacts:scratch}));
}
