import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { openElectron, pause } from '../lib/electron-harness.mjs';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
import { mathSelectionFixtures } from './markdown-math-selection-fixtures.mjs';
import { installFileRpcObserver, observeFileRpcs, restoreFileRpcObserver } from '../lib/file-rpc-observer.mjs';
import { installMarkdownWorkerObserver, observeMarkdownWorkers, restoreMarkdownWorkerObserver } from '../lib/markdown-worker-observer.mjs';
const executable = process.env.WILLYOU_FILES_APP; assert(executable);
const prototype = process.env.WILLYOU_MATH_SELECTION_PROTOTYPE === '1';
const scratch = await mkdtemp('/private/tmp/willyou-math-selection-' + (prototype ? 'prototype-' : 'app-'));
const root = join(scratch, 'project'); await mkdir(root);
const norm = value => value.replace(/\r\n?/g, '\n'), sha = value => createHash('sha256').update(value).digest('hex');
const expected = {};
for (const theme of ['light', 'dark']) for (const fixture of mathSelectionFixtures) { const name = theme + '-' + fixture.name + '.md'; expected[name] = fixture.source; await writeFile(join(root, name), fixture.source); }
const r = { at: new Date().toISOString(), executable, scratch, prototype, status: 'running', checks: [], boundary: prototype ? 'P synthetic React StrictMode host with the actual shared CM/source/decorations/Workers; real mouse/keyboard and raw-source callbacks. No filesystem/IPC/native-file authority or physical IME/reference-pixel claim.' : 'A actual packaged App, real native file service and mathematical Worker/KaTeX; mouse/keyboard only writes. Read-only CM and DOM metadata observation. System theme emulation through Chromium prefers-color-scheme, no DOM/Store/editor value injection, clipboard, models, external apps or Codex.' };
let app, original, stage = 'setup', observed = false;
const view = 'document.querySelector(".cm-content")?.cmTile?.root?.view';
const protoLog = "JSON.parse(document.querySelector('[data-testid=selection-log]').textContent)";
const state = () => app.evaluate(`(()=>{const v=${view};return v?{anchor:v.state.selection.main.anchor,head:v.state.selection.main.head,source:v.state.doc.toString(),focused:v.hasFocus}:null})()`);
async function key(key, modifiers = 0) { const vk = {ArrowLeft:37,ArrowRight:39,Escape:27}[key]; for(const type of ['keyDown','keyUp']) await app.cdp('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:vk,modifiers}); }
async function point(selector) { return app.evaluate(`(async()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing pointer target');e.scrollIntoView({block:'nearest',inline:'nearest'});await new Promise(requestAnimationFrame);const candidates=[...e.querySelectorAll('.katex-html .mord,.katex-html .mop,.katex-html'),e];for(const n of candidates)for(const r of n.getClientRects())for(const factor of [.5,.25,.75]){const x=r.x+r.width*factor,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(r.width>0&&r.height>0&&e.contains(hit))return{x,y}}throw Error('Actual pointer target is not hit-testable')})()`); }
async function pointer(selector, modifiers = 0, downCheck) { const p=await point(selector);await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await app.cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,modifiers,...p});if(downCheck)await downCheck();await app.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,modifiers,...p});await pause(30); }
const formula = code => '[data-md-math-code=' + JSON.stringify(code) + ']';
async function siblings(fixture) { for(const code of fixture.siblings) await app.waitFor(`Boolean(document.querySelector(${JSON.stringify(formula(code))})?.matches('[data-md-math-state=ready]'))`,20000);await app.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); }
async function pollDisk(name) { const end=Date.now()+10000;while(Date.now()<end){if((await readFile(join(root,name))).equals(Buffer.from(expected[name])))return;await pause(30);}throw Error('Exact native saved bytes did not settle'); }
try {
  if(prototype){app=await openElectron({executable,userData:join(scratch,'userdata'),inspectMain:true});original=await app.evaluate('location.href');await app.cdp('Page.navigate',{url:'http://127.0.0.1:5188/tests/math-selection-runtime.html'});await app.waitFor("Boolean(document.querySelector('[data-testid=selection-paragraph]'))");}
  else {app=await openFileAcceptanceApp({executable,projectPath:root,userData:join(scratch,'userdata'),name:'M9 mathematical source selection',inspectMain:true});r.asarSha256=sha(await readFile(resolve(dirname(executable),'../Resources/app.asar')));await installFileRpcObserver(app);await installMarkdownWorkerObserver(app);observed=true;}
  r.pid=app.processId;await app.cdp('Page.bringToFront');
  for(const theme of ['light','dark']) {
    if(prototype){if(theme==='dark')await pointer('[data-testid=selection-theme]');await app.waitFor(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`);}
    else {await app.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});await app.waitFor(`document.documentElement.classList.contains(${JSON.stringify(theme==='dark'?'ydark':'ylight')})`);}
    for(const fixture of mathSelectionFixtures) {
      stage=theme+':'+fixture.name;console.log('Math selection',stage);
      const name=theme+'-'+fixture.name+'.md';
      if(prototype)await pointer('[data-testid=selection-'+fixture.name+']');else {await app.open(name);await app.waitFor(`${view}?.state.doc.toString()===${JSON.stringify(norm(fixture.source))}`);}
      const selector='[data-md-math-from="'+fixture.source.indexOf(fixture.marker)+'"]';await app.waitFor(`document.querySelectorAll('[data-md-math-state=ready]').length===${fixture.siblings.length+1}`,20000);
      const bounds=await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return{from:Number(e.dataset.mdMathFrom),to:Number(e.dataset.mdMathTo),contentEnd:Number(e.dataset.mdMathContentEnd)}})()`);
      assert.equal(fixture.source.slice(bounds.contentEnd,bounds.contentEnd+fixture.marker.length),fixture.marker);
      const from=norm(fixture.source.slice(0,bounds.from)).length,to=norm(fixture.source.slice(0,bounds.to)).length,end=norm(fixture.source.slice(0,bounds.contentEnd)).length;
      let down;
      await pointer(selector,0,async()=>{await app.waitFor(`${view}?.hasFocus`);down=await state();assert.equal(down.head,end);assert.equal(down.anchor,end);assert(down.focused);});
      await siblings(fixture);assert.equal(await app.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),false);
      if(fixture.siblings.includes('b_1')) {
        const next=await app.evaluate(`Number(document.querySelector(${JSON.stringify(formula('b_1'))}).dataset.mdMathContentEnd)`);
        await pointer(formula('b_1'),8,async()=>{const current=await state();assert.equal(current.anchor,end);assert.equal(current.head,norm(fixture.source.slice(0,next)).length);});
        assert.equal(await app.evaluate(`Boolean(document.querySelector(${JSON.stringify(formula('b_1'))}))`),false);await key('ArrowLeft');await siblings(fixture);assert.equal((await state()).head,end);
      }
      for(let i=from;i<end;i++)await key('ArrowLeft');
      assert.equal((await state()).head,from);await siblings(fixture);
      for(let i=from;i<to;i++)await key('ArrowRight',8);
      const selected=await state();assert.equal(selected.anchor,from);assert.equal(selected.head,to);assert.equal(selected.source.slice(from,to),norm(fixture.source.slice(bounds.from,bounds.to)));await siblings(fixture);
      if(fixture.name==='paragraph'||fixture.name==='quote-block')await app.screenshot(join(scratch,theme+'-'+fixture.name+'-source-selection.png'));
      const replacement=fixture.marker+fixture.after+fixture.marker;
      await app.cdp('Input.insertText',{text:replacement});expected[name]=fixture.source.slice(0,bounds.from)+replacement+fixture.source.slice(bounds.to);
      await app.waitFor(prototype?`${protoLog}.text===${JSON.stringify(expected[name])}`:`${view}?.state.doc.toString()===${JSON.stringify(norm(expected[name]))}`);
      await siblings(fixture);
      await pointer(prototype?'[data-testid=selection-blur]':'[aria-label="筛选文件"]');
      await app.waitFor(`Boolean(document.querySelector(${JSON.stringify(formula(fixture.after))})?.matches('[data-md-math-state=ready]'))`,20000);await siblings(fixture);
      if(!prototype){assert.equal((await state()).focused,false);await pointer(formula(fixture.after));for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'s',code:'KeyS',windowsVirtualKeyCode:83,modifiers:4});await pollDisk(name);await pointer('[aria-label="筛选文件"]');await app.waitFor(`Boolean(document.querySelector(${JSON.stringify(formula(fixture.after))})?.matches('[data-md-math-state=ready]'))`);}
      r.checks.push({caseId:'M9-T-X07',theme,fixture:fixture.name,bounds,mousedownBeforeRelease:down,sourceEndpointsAndWholeRange:true,actualKeyboardReplace:true,blurRendersNewFormula:true,siblingsKept:fixture.siblings,mixedEolSourceExact:true,nativeSave:!prototype,crossFormulaShiftClick:fixture.siblings.includes('b_1'),pass:true});
      await app.screenshot(join(scratch,theme+'-'+fixture.name+'.png'));
      if(!prototype)await app.click('[aria-label='+JSON.stringify('关闭 '+name)+']');
    }
  }
  r.fonts=await app.evaluate("(async()=>{await document.fonts.ready;return [...document.fonts].filter(face=>face.family.includes('KaTeX')).map(face=>({family:face.family,status:face.status}))})()");assert(r.fonts.some(face=>face.status==='loaded'));assert(!r.fonts.some(face=>face.status==='error'));
  if(!prototype){
    const name='light-paragraph.md';await app.open(name);await app.waitFor(`${view}?.state.doc.toString()===${JSON.stringify(norm(expected[name]))}`);await app.waitFor(`Boolean(document.querySelector(${JSON.stringify(formula('u+v'))})?.matches('[data-md-math-state=ready]'))`);r.reopenedExactSavedSource=true;await app.click('[aria-label='+JSON.stringify('关闭 '+name)+']');
    await app.click('[data-testid=project-files]');await app.waitFor('!document.querySelector("[data-testid=file-workspace]")');
    r.workers=await observeMarkdownWorkers(app);for(const row of r.workers.rows){for(const input of row.inputs)assert.equal(input.before,input.after);for(const msg of row.messages)if(msg.deliveredAt)assert(msg.trusted&&msg.before===msg.after);assert(row.terminated>0);}
    r.rpc=await observeFileRpcs(app);r.savedNames=Object.keys(expected);assert.equal(r.rpc.rows.filter(row=>row.method==='save').length,16);for(const row of r.rpc.rows)if(row.delivered)assert.equal(row.before,row.after);
    r.workerRestored=await restoreMarkdownWorkerObserver(app);r.rpcRestored=await restoreFileRpcObserver(app);observed=false;assert(Object.values(r.workerRestored).every(Boolean));assert(Object.values(r.rpcRestored).every(Boolean));
    r.files={};for(const[name,text]of Object.entries(expected)){const bytes=await readFile(join(root,name));assert(bytes.equals(Buffer.from(text)));r.files[name]={expected:sha(text),actual:sha(bytes)};}
  }else {await app.cdp('Page.navigate',{url:original});await app.waitFor("Boolean(document.querySelector('[data-testid=nav-settings]'))");}
  assert.deepEqual(app.rendererErrors,[]);await writeFile(join(scratch,'electron.log'),app.logs());
  await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()");r.exit=await app.waitForExit(20000);assert.equal(r.exit.code,0);assert.equal(r.exit.signal,null);await app.close();app=null;r.status='passed';
} catch(error) {r.status='failed';r.error=String(error);r.stack=error.stack;r.failedStage=stage;process.exitCode=1;if(app)try{r.state=await state();r.dom=await app.evaluate('document.body.innerText.slice(0,6000)');await app.screenshot(join(scratch,'failure.png'));}catch{}}
finally {if(app){if(observed){r.workers=await observeMarkdownWorkers(app);r.rpc=await observeFileRpcs(app);r.workerRestored=await restoreMarkdownWorkerObserver(app);r.rpcRestored=await restoreFileRpcObserver(app);}await writeFile(join(scratch,'failure-electron.log'),app.logs());await app.close();}r.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,checks:r.checks.length,error:r.error,failedStage:r.failedStage,artifacts:scratch}));}
