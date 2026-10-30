import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { openElectron, pause } from '../lib/electron-harness.mjs';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { installFileRpcObserver, observeFileRpcs, restoreFileRpcObserver } from '../lib/file-rpc-observer.mjs';
import { installMarkdownLocalRpcObserver, observeMarkdownLocalRpcs, restoreMarkdownLocalRpcObserver } from '../lib/markdown-local-rpc-observer.mjs';
import { taskSource, taskLines, taskLinks, taskImage, taskPng } from '../../prototypes/m6-codex/tests/markdown-task-fixture.mjs';

const executable=process.env.WILLYOU_FILES_APP;assert(executable);
const prototype=process.env.WILLYOU_TASK_PROTOTYPE==='1',url=process.env.WILLYOU_TASK_PROTOTYPE_URL||'http://127.0.0.1:4176/tests/markdown-task-runtime.html';
const scratch=await mkdtemp('/private/tmp/willyou-markdown-task-'+(prototype?'prototype-':'app-')),root=join(scratch,'project');await mkdir(root);
const files={'light.md':taskSource,'dark.md':taskSource,'readonly.md':taskSource,'需求.md':'# 中文需求\r\n\r\n真实目标一\r\n','docs/需求 文档.md':'# 空格路径\r\n\r\n真实目标二\r\n',[taskImage]:Buffer.from(taskPng,'base64')};
for(const[name,text]of Object.entries(files)){await mkdir(dirname(join(root,name)),{recursive:true});await writeFile(join(root,name),text);}await chmod(join(root,'readonly.md'),0o444);
const sha=x=>createHash('sha256').update(x).digest('hex'),norm=x=>x.replace(/\r\n?/g,'\n'),view='document.querySelector(".fw-editor-host .cm-content")?.cmTile?.root?.view',pstate="JSON.parse(document.querySelector('[data-testid=task-state]').textContent)";
const r={at:new Date().toISOString(),executable,scratch,prototype,status:'running',checks:[],boundary:'Y07. P synthetic React/FileMarkdown data and host only, real browser input; A unchanged packaged App, actual files/native permissions/native saves/authenticated related IPC with exact original args. Read-only editor state observations, real pointer/menu actions. No editor/Store/source injection, clipboard, models, external launches or daily files.'};
let app,original,observed=false,stage='setup';
const poll=async(fn,label)=>{const end=Date.now()+15000;while(Date.now()<end){const x=await fn();if(x)return x;await pause(25);}throw Error('Timed out: '+label);};
async function click(selector,text,button='left'){
 await app.waitFor(`Boolean([...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>${text===undefined?'true':`e.textContent.trim()===${JSON.stringify(text)}`}))`);
 const p=await app.evaluate(`(async()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>${text===undefined?'true':`e.textContent.trim()===${JSON.stringify(text)}`});e.scrollIntoView({block:'nearest'});await new Promise(requestAnimationFrame);const b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('Pointer target occluded');return{x,y}})()`);
 for(const type of['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,button,clickCount:1,...p});
}
async function key(key,code,vk,modifiers=0,commands){for(const type of['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:vk,modifiers,...(type==='keyDown'&&commands?{commands}:{})});}
async function open(name){await app.open(name);await app.waitFor(`${view}?.state.doc.toString()===${JSON.stringify(norm(files[name]))}`);await click('[aria-label="筛选文件"]');await app.waitFor('document.querySelectorAll("input[data-md-task-line]").length===4');}
async function save(name,expected){await click('[aria-label="文件菜单"]');await click('[role=menuitem]','保存文件');await poll(async()=>Buffer.from(expected).equals(await readFile(join(root,name))),'exact native CRLF save');files[name]=expected;await app.waitFor('!document.querySelector(".fw-tab.selected .fw-dirty")');}
async function close(name){if(await app.evaluate(`Boolean(document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify('关闭 '+name.split('/').at(-1)))}+']'))`))await click('[aria-label='+JSON.stringify('关闭 '+name.split('/').at(-1))+']');}
const record=(theme,name,extra={})=>r.checks.push({caseId:'M9-T-Y07',theme,name,...extra,pass:true});
try{
 if(prototype){app=await openElectron({executable,userData:join(scratch,'userdata'),inspectMain:true});original=await app.evaluate('location.href');await app.cdp('Page.navigate',{url});await app.waitFor('Boolean(document.querySelector("[data-testid=task-reset]"))');}
 else{r.asarSha256=sha(await readFile(resolve(dirname(executable),'../Resources/app.asar')));app=await openFileAcceptanceApp({executable,projectPath:root,userData:join(scratch,'userdata'),name:'M9 Y07 task and authored paths',inspectMain:true});await installFileRpcObserver(app);await installMarkdownLocalRpcObserver(app);observed=true;}
 r.pid=app.processId;await app.cdp('Page.bringToFront');
 for(const theme of['light','dark']){
  stage=theme+':open';const name=theme+'.md';let current=taskSource;
  if(prototype){if(theme==='dark')await click('[data-testid=task-theme]');await click('[data-testid=task-reset]');await app.waitFor(`${pstate}.theme===${JSON.stringify(theme)}`);}
  else{await app.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});await app.waitFor(`document.documentElement.classList.contains(${JSON.stringify(theme==='dark'?'ydark':'ylight')})`);await open(name);}
  for(const line of taskLines)for(let turn=0;turn<2;turn++){
   stage=theme+':line-'+line+':'+turn;const before=current,parts=[...before.matchAll(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g)],at=parts[line].index+parts[line][0].indexOf('[')+1;
   current=before.slice(0,at)+(before[at]===' '?'x':' ')+before.slice(at+1);
   await click('input[data-md-task-line="'+line+'"]');
   if(prototype)await app.waitFor(`${pstate}.text===${JSON.stringify(current)}`);else{await app.waitFor(`${view}?.state.doc.toString()===${JSON.stringify(norm(current))}`);await save(name,current);}
   await app.waitFor(`document.querySelector('input[data-md-task-line="${line}"]')?.checked===${current[at]!==' '}`);
   assert.equal(Buffer.from(current).length,Buffer.from(before).length);const diffs=Buffer.from(current).map((v,i)=>v===Buffer.from(before)[i]?0:1).reduce((a,b)=>a+b,0);assert.equal(diffs,1);
   record(theme,'exact-task-marker-'+line+'-'+turn,{line,utf16Offset:at,changedUtf8Bytes:diffs,beforeSha256:sha(before),afterSha256:sha(current),nativeSave:!prototype});
  }
  if(!prototype){await app.waitFor("document.querySelector('img[data-md-src]')?.naturalWidth>0");const image=await app.evaluate("(()=>{const e=document.querySelector('img[data-md-src]');return{authored:e.dataset.mdSrc,absolute:e.dataset.filePath,width:e.naturalWidth}})()");assert.equal(image.authored,taskImage);assert.equal(image.absolute,join(root,taskImage));record(theme,'actual-unicode-space-image',{image});}
  else{stage=theme+':synthetic-image';await click('.fw-md-image',undefined,'right');await click('[role=menuitem]','在新标签打开图片');await app.waitFor(`${pstate}.links.includes(${JSON.stringify(taskImage)})`);assert.equal((await app.evaluate(pstate)).links.at(-1),taskImage);record(theme,'synthetic-image-original-local-path');}
  for(let i=0;i<taskLinks.length;i++){
   stage=theme+':link-'+i;
   if(!prototype){await open(name);await app.waitFor(`Boolean(document.querySelector('a[data-md-href='+${JSON.stringify(JSON.stringify(taskLinks[i]))}+']'))`);}
   const before=prototype?(await app.evaluate(pstate)).links.length:(await observeMarkdownLocalRpcs(app)).length;
   await click('a[data-md-href='+JSON.stringify(taskLinks[i])+']');
   if(prototype){await app.waitFor(`${pstate}.links.length>${before}`);assert.equal((await app.evaluate(pstate)).links.at(-1),taskLinks[i]);if(i===2)await app.waitFor('document.querySelector("[data-testid=task-message]").textContent.includes("文件不存在")');}
   else{const row=await poll(async()=>(await observeMarkdownLocalRpcs(app)).slice(before).find(x=>x.args[1]===taskLinks[i]&&x.returnedAt),'original local related result');assert.equal(row.before,row.after);if(i===2){assert(row.error);await app.waitFor('/不存在|找不到|No such file|ENOENT|无法读取|打开失败/i.test(document.body.innerText)');r.missingMessage=await app.evaluate('[...document.querySelectorAll("[role=alert],[role=status],.fw-save-strip")].map(e=>e.textContent)');}else{assert(!row.error);await app.waitFor(`${view}?.state.doc.toString()===${JSON.stringify(norm(files[taskLinks[i]]))}`);await close(taskLinks[i]);}}
   record(theme,'authored-local-link-'+i,{authored:taskLinks[i],realNativeTarget:!prototype&&i<2,missing:i===2});
  }
  if(!prototype)await close(name);
  stage=theme+':readonly';
  if(prototype)await click('[data-testid=task-readonly]');else await open('readonly.md');
  await app.waitFor('[...document.querySelectorAll("input[data-md-task-line]")].length===4&&[...document.querySelectorAll("input[data-md-task-line]")].every(e=>e.disabled)');
  const saves=prototype?null:(await observeFileRpcs(app)).rows.filter(x=>x.method==='save').length;
  for(const line of taskLines)await click('input[data-md-task-line="'+line+'"]');
  if(prototype)assert.equal((await app.evaluate(pstate)).text,current);else{assert(Buffer.from(taskSource).equals(await readFile(join(root,'readonly.md'))));assert.equal((await observeFileRpcs(app)).rows.filter(x=>x.method==='save').length,saves);assert.equal(await app.evaluate(`${view}.state.doc.toString()`),norm(taskSource));}
  record(theme,'readonly-native-disabled-and-unchanged',{actual0444:!prototype});await app.screenshot(join(scratch,theme+'-readonly.png'));if(!prototype)await close('readonly.md');
 }
 if(observed){r.rpc=await observeFileRpcs(app);r.related=await observeMarkdownLocalRpcs(app);for(const row of r.related)assert.equal(row.before,row.after);r.restored={...await restoreFileRpcObserver(app),...await restoreMarkdownLocalRpcObserver(app)};observed=false;assert(Object.values(r.restored).every(Boolean));assert.equal(r.rpc.rows.filter(x=>x.method==='save'&&x.delivered).length,16);await click('[data-testid=project-files]');await app.waitFor('!document.querySelector("[data-testid=file-workspace]")');}
 if(prototype){r.finalState=await app.evaluate(pstate);await app.cdp('Page.navigate',{url:original});await app.waitFor('Boolean(document.querySelector("[data-testid=nav-settings]"))');}
 r.files={};for(const[name,text]of Object.entries(files)){const actual=await readFile(join(root,name));assert(actual.equals(Buffer.from(text)));r.files[name]={sha256:sha(actual),bytes:actual.length};}assert.deepEqual(app.rendererErrors,[]);
 await writeFile(join(scratch,'electron.log'),app.logs());await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()");r.exit=await app.waitForExit(20000);assert.equal(r.exit.code,0);assert.equal(r.exit.signal,null);await app.close();app=null;r.status='passed';
}catch(error){r.status='failed';r.failedStage=stage;r.error=String(error);r.stack=error.stack;process.exitCode=1;if(app)try{r.dom=await app.evaluate('document.body.innerText.slice(0,6000)');r.current=await app.evaluate(prototype?pstate:`${view}?.state.doc.toString()`);await app.screenshot(join(scratch,'failure.png'));}catch{}}
finally{if(app){if(observed){r.rpc=await observeFileRpcs(app);r.related=await observeMarkdownLocalRpcs(app);r.restored={...await restoreFileRpcObserver(app),...await restoreMarkdownLocalRpcObserver(app)};}await writeFile(join(scratch,'failure-electron.log'),app.logs());await app.close();}await chmod(join(root,'readonly.md'),0o644);r.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,checks:r.checks.length,failedStage:r.failedStage,error:r.error,artifacts:scratch}));}
