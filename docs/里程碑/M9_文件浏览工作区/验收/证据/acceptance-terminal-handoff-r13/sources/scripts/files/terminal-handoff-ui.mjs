// E12/E16/D08 actual packaged-App acceptance. Only setup/teardown uses IPC.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { arch, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openElectron, pause } from '../lib/electron-harness.mjs';

const executable=process.env.WILLYOU_FILES_APP;assert(executable,'Set WILLYOU_FILES_APP');
const scratch=await mkdtemp('/private/tmp/willyou-terminal-handoff-ui-'),projectPath=join(scratch,'project'),receiverRoot=join(scratch,'receiver');await mkdir(projectPath);await mkdir(receiverRoot);
const selected='const greeting = "中文🙂 selected";',markdown='Selected 中文🙂 markdown';
const special='路径 中文 空格🙂\'"();`$().txt';
const files={'context.ts':`// first line\n${selected}\nexport { greeting };\n`,'notes.md':`# Notes\n${markdown}\nLast paragraph\n`,'A.txt':'A focus fixture','B.txt':'B focus fixture','C.txt':'C focus fixture',[special]:'Special path reference fixture'};
for(const[path,text]of Object.entries(files))await writeFile(join(projectPath,path),text);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fingerprints=async()=>Object.fromEntries(await Promise.all(Object.keys(files).map(async path=>{const file=join(projectPath,path),s=await stat(file,{bigint:true});return[path,{hash:sha(await readFile(file)),inode:String(s.ino),size:String(s.size),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)}];})));
const resources=resolve(dirname(executable),'../Resources'),before=await fingerprints();
const result={startedAt:new Date().toISOString(),app:resolve(executable),asarSha256:sha(await readFile(join(resources,'app.asar'))),brokerSha256:sha(await readFile(join(resources,'native/willyou-files'))),system:{platform:process.platform,arch:arch(),release:release()},scratch,projectPath,before,status:'running',checks:[],input:'Actual packaged renderer CDP pointer/keyboard input. Public IPC seeds/tears down an isolated project/task only; tested file/reference/dialog/terminal interactions use the real UI. Receiver is input-only, not a real model/CLI acceptance claim.'};
let app,task,stage='initial';
try{
 app=await openElectron({executable,userData:join(scratch,'userdata')});const{cdp,evaluate,invoke,waitFor}=app;
 const exists=selector=>`Boolean(document.querySelector(${JSON.stringify(selector)}))`;
 const tree=path=>`[role="treeitem"][title=${JSON.stringify(join(projectPath,path))}]`;
 const tab=path=>`.fw-tab [role="tab"][title=${JSON.stringify(join(projectPath,path))}]`;
 const key=async(key,code,modifiers=0)=>{await cdp('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});};
 const click=async(selector,text,button='left',double=false)=>{
  let point;const deadline=Date.now()+10000;
  while(!point){point=await evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>${text===undefined?'true':`e.textContent.trim()===${JSON.stringify(text)}`});if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);if(!point){assert(Date.now()<deadline,`Missing UI target ${selector} ${text??''}`);await pause(80);}}
  await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...point});for(const count of double?[1,2]:[1]){await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button,clickCount:count,...point});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button,clickCount:count,...point});if(double&&count===1)await pause(40);}
 };
 const fill=async(selector,text)=>{await click(selector);await key('a','KeyA',4);await cdp('Input.insertText',{text});};
 const choose=async text=>click('[role="menuitem"]',text);
 const selectLine=async expected=>{
  stage='select-second-line';
  await click('.cm-content');await key('ArrowUp','ArrowUp',4);await key('ArrowDown','ArrowDown');await key('ArrowLeft','ArrowLeft',4);await key('ArrowRight','ArrowRight',12);
  await waitFor(`window.getSelection()?.toString()===${JSON.stringify(expected)}`);
 };
 const selectionMenu=async expected=>{
  await selectLine(expected);const point=await evaluate("(()=>{const s=window.getSelection();if(!s?.rangeCount)return null;const r=s.getRangeAt(0).getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()");assert(point,'Selected source has no visible range');
  await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'right',clickCount:1,...point});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'right',clickCount:1,...point});await waitFor(exists('[role="menuitem"]'));
 };
 const editor=path=>`document.querySelector('.cm-content')?.getAttribute('aria-label')===${JSON.stringify(path+' 内容')}`;
 const openFile=async(path,source=false)=>{await click(tree(path));await waitFor(editor(path));if(source&&await evaluate(exists('[aria-label="查看源码"]'))){await click('[aria-label="查看源码"]');await waitFor(exists('[aria-label="查看文档"]'));}};
 const project=await invoke('projects.create',{name:'M9 terminal handoff acceptance',aliases:[],description:'Isolated file, selection and raw PTY tests',rulesPath:null},[{label:'Temporary handoff fixtures',path:projectPath}]);result.projectId=project.id;
 await cdp('Page.reload');await waitFor(exists(`[data-project-id="${project.id}"]`));await click(`[data-project-id="${project.id}"] [data-testid=sidebar-project-more]`);await click('[data-testid=sidebar-project-edit]');await waitFor(exists('[data-testid=project-files]'));await click('[data-testid=project-files]');
 stage='E12-no-terminal';
 for(const[path,text]of [['context.ts',selected],['notes.md',markdown]]){
  await openFile(path,path==='notes.md');await selectionMenu(text);await choose('让 CLI 修改所选代码…');await waitFor(exists('[role="dialog"]'));assert.equal(await evaluate("document.querySelector('.fw-ai-selection')?.textContent"),text);
  await fill('[aria-label="所选代码的 CLI 指令"]','Explain this selection without executing it.');assert(!await evaluate(exists('.fw-refs')));await click('[role="dialog"] button','取消');await waitFor('!document.querySelector("[role=dialog]")');assert(!await evaluate(exists('.fw-refs')));
  await selectionMenu(text);await choose('添加所选内容到终端引用');await waitFor(exists('.fw-refs'));await waitFor("document.querySelector('.fw-refs')?.textContent.includes('当前没有可用的任务终端')");
  assert(await evaluate("[...document.querySelectorAll('.fw-refs button')].find(e=>e.textContent==='插入到终端输入')?.disabled"));
  if(!await evaluate("document.querySelector('.fw-refs input[type=checkbox]')?.checked"))await click('.fw-refs input[type="checkbox"]');await click('.fw-refs summary');assert((await evaluate("document.querySelector('.fw-refs pre')?.textContent")).includes(text));
  await app.screenshot(join(scratch,`e12-${path==='notes.md'?'markdown':'code'}-no-terminal.png`));await click('.fw-refs button[aria-label^="移除引用"]');await waitFor('!document.querySelector(".fw-refs")');
  assert.equal((await invoke('tasks.list')).length,0);assert.deepEqual(await fingerprints(),before);result.checks.push({caseId:'M9-T-E12',path,selectedText:text,instructionCancelLeavesNoReference:true,noTerminalExplained:true,insertionDisabled:true,previewAndRemoveWithoutTaskOrDiskWrite:true});
 }
 stage='task-setup';
 const profile=await invoke('aiProfiles.create',{name:'Input-only acceptance receiver',runner:'claude',executable:'/usr/bin/python3',args:[resolve('scripts/files/context-receiver.py'),receiverRoot],env:[{name:'CLAUDE_CONFIG_DIR',value:join(scratch,'isolated-cli-state'),secret:false}],color:null,isDefault:true});
 const launched=await invoke('tasks.create',{projectId:project.id,dirId:null,aiProfileId:profile.id,firstMessage:''});task=launched.task;result.task={id:task.id,ptyId:launched.ptyId,receiver:'scripts/files/context-receiver.py'};
 await cdp('Page.reload');await waitFor(exists(`[data-task-id="${task.id}"]`));await click(`[data-task-id="${task.id}"]`);await waitFor(`${exists('[data-testid="task-terminal"] .xterm-screen')}||${exists('[data-testid="task-resume"]')}`);if(!await evaluate(exists('[data-testid="task-terminal"] .xterm-screen')))await click('[data-testid="task-resume"]');await waitFor(exists('[data-testid="task-terminal"] .xterm-screen'));
 if(!await evaluate(exists('[data-testid="file-workspace"]')))await click('[data-testid=task-files]');
 const state=async()=>JSON.parse(await readFile(join(receiverRoot,'state.json'),'utf8'));
 let ready;for(let i=0;i<50;i++){try{ready=await state();break;}catch{await pause(100);}}assert(ready,'Receiver did not initialize');assert.equal(ready.bytes,0);
 await click('[data-testid="task-terminal"] .xterm-screen');await cdp('Input.insertText',{text:'prefix '});
 const waitReceiver=async expected=>{for(let i=0;i<100;i++){const value=await state();if(value.rawHex===Buffer.from(expected).toString('hex'))return value;await pause(30);}throw new Error('Receiver bytes did not match expected input');};
 let expectedRaw='prefix ';await waitReceiver(expectedRaw);
 stage='E16-tree-reference-cancel';
 await click(tree('context.ts'),undefined,'right');await choose('添加到终端引用');await waitFor(exists('.fw-refs'));await click('.fw-refs summary');assert.equal(await evaluate("document.querySelector('.fw-refs pre')?.textContent"),'context.ts');await click('.fw-refs button','清空');await waitFor('!document.querySelector(".fw-refs")');assert.equal((await state()).rawHex,Buffer.from(expectedRaw).toString('hex'));
 result.checks.push({caseId:'M9-T-E16',branch:'tree reference preview and clear',receiverBytesUnchanged:true});
 stage='DEV050-instruction-insert';
 await openFile('context.ts');await selectionMenu(selected);await choose('让 CLI 修改所选代码…');await waitFor(exists('[role="dialog"]'));assert.equal(await evaluate("document.querySelector('.fw-ai-selection')?.textContent"),selected);
 stage='DEV050-instruction-confirm';await fill('[aria-label="所选代码的 CLI 指令"]','Explain this greeting.');await click('[role="dialog"] button','加入终端引用');await waitFor(exists('.fw-refs'));await waitFor('!document.querySelector("[role=dialog]")');
 if(!await evaluate("document.querySelector('.fw-refs input[type=checkbox]')?.checked"))await click('.fw-refs input[type="checkbox"]');await click('.fw-refs summary');const instructionPreview=`context.ts:L2\n> Explain this greeting.\n    ${selected}`;assert.equal(await evaluate("document.querySelector('.fw-refs pre')?.textContent"),instructionPreview);assert.equal((await state()).rawHex,Buffer.from(expectedRaw).toString('hex'));
 await app.screenshot(join(scratch,'dev050-instruction-preview.png'));await click('.fw-refs button','插入到终端输入');await waitFor("document.querySelector('.fw-save-strip')?.textContent.includes('已插入终端输入，尚未提交')");
 expectedRaw+=`\x1b[200~${instructionPreview.replace(/\n/g,'\r')}\x1b[201~`;let received=await waitReceiver(expectedRaw);assert.equal(received.unbracketedNewlines,0);assert.equal(received.executedCommands,0);assert(await evaluate("document.activeElement?.classList.contains('xterm-helper-textarea')"));
 result.checks.push({caseIds:['M9-T-E12','M9-T-E16'],defect:'M9-DEV-050',branch:'captured selection survives menu/dialog focus; explicit instruction handoff',preview:instructionPreview,receiver:received});
 for(const[path,text]of [['notes.md',markdown],[special,null]]){
  stage='E16-'+path;
  if(text){await openFile(path,true);await selectionMenu(text);await choose('添加所选内容到终端引用');}else{await click(tree(path),undefined,'right');await choose('添加到终端引用');}
  await waitFor(exists('.fw-refs'));if(!await evaluate("document.querySelector('.fw-refs input[type=checkbox]')?.checked"))await click('.fw-refs input[type=checkbox]');await click('.fw-refs summary');
  const preview=text?`${path}:L2\n    ${text}`:path;assert.equal(await evaluate("document.querySelector('.fw-refs pre')?.textContent"),preview);assert.equal((await state()).rawHex,Buffer.from(expectedRaw).toString('hex'));await click('.fw-refs button','插入到终端输入');await waitFor('!document.querySelector(".fw-refs")');expectedRaw+=`\x1b[200~${preview.replace(/\n/g,'\r')}\x1b[201~`;received=await waitReceiver(expectedRaw);assert.equal(received.unbracketedNewlines,0);result.checks.push({caseId:'M9-T-E16',branch:text?'Markdown selection handoff':'literal Unicode/metacharacter file reference',preview,receiver:received});
 }
 assert.equal((await invoke('tasks.list')).length,1);await app.screenshot(join(scratch,'e16-input-only-terminal.png'));assert.deepEqual(await fingerprints(),before);
 stage='D08-close-inactive';
 for(const path of ['A.txt','B.txt','C.txt']){await click(tree(path),undefined,'left',true);await waitFor(editor(path));}
 await click(tab('B.txt'));await waitFor(editor('B.txt'));await click('.cm-content');assert(await evaluate("Boolean(document.activeElement?.closest('.cm-editor'))"));const terminalBefore=await state();
 await click('[aria-label="关闭 C.txt"]');await waitFor(`!${exists(tab('C.txt'))}`);assert.equal(await evaluate(`document.querySelector(${JSON.stringify(tab('B.txt'))})?.getAttribute('aria-selected')`),'true');assert(await evaluate("document.activeElement?.getAttribute('aria-label')==='B.txt 内容'"));
 await cdp('Input.insertText',{text:'D08 focus proof'});await waitFor("document.querySelector('.cm-content')?.textContent.includes('D08 focus proof')");await key('z','KeyZ',4);await waitFor("document.querySelector('.cm-content')?.textContent==='B focus fixture'");
 await pause(150);const terminalAfter=await state();assert(terminalAfter.heartbeat>terminalBefore.heartbeat);assert.equal(terminalAfter.rawHex,terminalBefore.rawHex);assert.equal((await invoke('tasks.get',task.id)).ptyId,launched.ptyId);
 await app.screenshot(join(scratch,'d08-inactive-close-preserves-editor-focus.png'));result.checks.push({caseId:'M9-T-D08',active:'B.txt',closed:'C.txt',editorFocusPreserved:true,typingWithoutRefocusReachedB:true,undoRestoredOriginal:true,ptyIdUnchanged:true,heartbeatBefore:terminalBefore.heartbeat,heartbeatAfter:terminalAfter.heartbeat,terminalBytesUnchanged:true});
 await click('[data-testid="task-terminal"] .xterm-screen');await cdp('Input.insertText',{text:' still-alive'});expectedRaw+=' still-alive';received=await waitReceiver(expectedRaw);assert.equal(received.unbracketedNewlines,0);result.finalReceiver=received;
 result.after=await fingerprints();assert.deepEqual(result.after,before);assert.deepEqual(app.rendererErrors,[]);result.status='passed';
}catch(error){result.status='failed';result.error=String(error);result.failedStage=stage;process.exitCode=1;if(app){try{await app.screenshot(join(scratch,'failure.png'));result.failureDom=await app.evaluate('document.body.innerText');result.failureFocus=await app.evaluate("({selection:window.getSelection()?.toString(),activeTag:document.activeElement?.tagName,activeLabel:document.activeElement?.getAttribute('aria-label'),activeClass:document.activeElement?.className})");}catch{}}}
finally{if(app){if(task){try{await app.invoke('tasks.kill',task.id);}catch{}}await writeFile(join(scratch,'electron.log'),app.logs());await app.close();}result.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks.length,failedStage:result.failedStage,error:result.error,artifacts:scratch}));}
