import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sha} from './io.mjs';
import {installF18Observers,readF18Observers,restoreF18Observers} from './observer.mjs';

export async function runWorkbookAcceptance({app,ui,own,result:r,oracle,runtime,persist,poll,screenshot,openFile,privateError,resources,changeStage}){
 const cell=(row,column)=>`.fw-office [role=gridcell][data-office-row="${row}"][data-office-column="${column}"]`;
 const wait=(body)=>app.waitFor(body,30000);
 const formula=()=>app.evaluate('({text:document.querySelector(\'.fw-office [aria-label="公式栏"]\')?.value,readOnly:document.querySelector(\'.fw-office [aria-label="公式栏"]\')?.readOnly,address:document.querySelector(\'.fw-office [aria-label="当前选区"]\')?.textContent})');
 const stage=async value=>{changeStage(value);await persist()};
 const keyed=key=>{const item=oracle.cases.find(x=>x.key===key);assert(item);return item};
 const snapshot=async()=>{const value=await readF18Observers(own);r.latestObserverSnapshot=value;await persist();return value};
 const sourceModel=async(item,c)=>{const value=await snapshot(),opened=value.rpc.rows.findLast(x=>x.method==='openOffice'&&x.delivered&&x.output?.hash===item.sha256);assert(opened,'Actual matching source openOffice receipt missing');assert.equal(opened.output.workbook.kind,item.kind);assert.equal(opened.output.workbook.sheets.length,3);c.officeId=opened.args[0].id;c.model=opened.output;c.modelSourceHash=opened.output.hash;c.modelReadiness={delivered:opened.delivered,inputHash:opened.inputHash,inputAfterHash:opened.inputAfterHash,before:opened.before,after:opened.after};await resources.capture(app,[]);return opened.output;};
 async function pinCurrentPreview(name){
  const selector='.fw-tab [role=tab][aria-selected=true]';await app.checkInputFocus('F18.actual-tab-doubleclick');
  const point=await poll(async()=>app.evaluate(`(()=>{const all=[...document.querySelectorAll(${JSON.stringify(selector)})],e=all.length===1?all[0]:null;if(!e||e.title!==${JSON.stringify(r.project+'/'+name)})return null;const b=e.getBoundingClientRect(),s=getComputedStyle(e),x=b.x+b.width/2,y=b.y+b.height/2;return b.width&&b.height&&s.visibility!=='hidden'&&Number(s.opacity)>0&&e.contains(document.elementFromPoint(x,y))?{x,y}:null})()`));
  await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...point,button:'none',buttons:0});
  for(const clickCount of[1,2]){await app.cdp('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount});await app.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount});}
  await wait('document.querySelector(\'.fw-tab [role=tab][aria-selected=true]\')?.closest(".fw-tab")?.classList.contains("preview")===false');
  const value={kind:'real-doubleclick-pin',name,point,clickCounts:[1,2]};r.actions.push(value);await persist();return value;
 }
 async function closeSource(c){
  await ui.click('[aria-label='+JSON.stringify('关闭 '+c.name)+']');
  await poll(async()=>{const v=await readF18Observers(own);return v.rpc.rows.some(x=>x.method==='closeOffice'&&x.args[0]===c.officeId&&x.delivered)});
  await wait('![...document.querySelectorAll(".fw-tab [role=tab]")].some(e=>e.title==='+JSON.stringify(r.project+'/'+c.name)+')');
  c.closedAndReleased=true;c.afterSourceSHA256=sha(await readFile(r.project+'/'+c.name));assert.equal(c.afterSourceSHA256,c.sourceHash);
 }
 let installed=false;r.themes=[];r.pendingCases={};
 try{
  await ui.click('[aria-label=文件全屏]');r.fileFullScreen=true;
  r.observerInstalled=await installF18Observers(own);installed=true;await persist();
  for(const theme of['light','dark']){
   await stage(theme+':theme');await app.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
   await wait('document.documentElement.classList.contains('+JSON.stringify(theme==='dark'?'ydark':'ylight')+')');
   r.themes.push({theme,actualClass:await app.evaluate('document.documentElement.className')});
   const xi=keyed(theme+'-xlsx'),mi=keyed(theme+'-xlsm');
   const x={key:xi.key,theme,name:xi.name,kind:xi.kind,sourceHash:xi.sha256};r.pendingCases[x.key]=x;
   await stage(x.key);await own('globalThis.__F18Observer.worker.phase('+JSON.stringify(x.key)+');return true;','set-owned-f18-observer-phase');
   await openFile(x.name);await wait('document.querySelector('+JSON.stringify(cell(0,0))+')?.textContent==="Label"');
   x.pinned=await pinCurrentPreview(x.name);
   x.noUnsupportedFallback=await app.evaluate('!document.querySelector(".fw-unsupported")');assert(x.noUnsupportedFallback);
   x.sheets=await app.evaluate('[...document.querySelectorAll(".fw-office-sheets button")].map(e=>e.textContent).filter(Boolean)');assert.deepEqual(x.sheets,['Data','Calc','Spare']);
   await wait('document.querySelector('+JSON.stringify(cell(4,0))+')?.getAttribute("aria-colspan")==="2"&&document.querySelector('+JSON.stringify(cell(4,0))+')?.textContent==="MERGED_PREVIEW_中文"');
   x.merge=await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(cell(4,0))}),b=e.getBoundingClientRect();return{text:e.textContent,colspan:e.getAttribute('aria-colspan'),rowspan:e.getAttribute('aria-rowspan'),width:b.width,height:b.height}})()`);
   await sourceModel(xi,x);await screenshot(theme+'-xlsx-merged.png');x.screenshot=theme+'-xlsx-merged.png';
   await ui.click('.fw-office-sheets button','Calc');await wait('document.querySelector('+JSON.stringify(cell(1,0))+')?.textContent==="B2"');
   await ui.click(cell(1,1));await wait('document.querySelector(\'.fw-office [aria-label="公式栏"]\')?.value==="=Data!$B$2+Data!B3"');
   x.equation=await formula();assert.equal(x.equation.address,'B2');
   for(const sheet of['Spare','Data']){await ui.click('.fw-office-sheets button',sheet);await wait('[...document.querySelectorAll(".fw-office-sheets button")].some(e=>e.textContent==='+JSON.stringify(sheet)+'&&e.getAttribute("aria-current")==="page")');}
   await wait('document.querySelector('+JSON.stringify(cell(0,0))+')?.textContent==="Label"');
   x.sheetSequence=['Calc','Spare','Data'];x.noDirty=await app.evaluate('!document.querySelector(".fw-dirty")');assert(x.noDirty);
   x.observedBeforeMacro=await snapshot();await persist();

   const m={key:mi.key,theme,name:mi.name,kind:mi.kind,sourceHash:mi.sha256};r.pendingCases[m.key]=m;
   await stage(m.key);await own('globalThis.__F18Observer.worker.phase('+JSON.stringify(m.key)+');return true;','set-owned-f18-observer-phase');
   await openFile(m.name);await wait('document.querySelector('+JSON.stringify(cell(0,0))+')?.textContent==="This is a macro workbook"');
   await wait('document.querySelector(".fw-office-header .fw-office-state")?.textContent==="只读"');
   m.state=await app.evaluate('document.querySelector(".fw-office-header .fw-office-state").textContent');
   m.macroNotice=await app.evaluate('[...document.querySelectorAll(".fw-office [role=status]")].map(e=>e.textContent)');assert(m.macroNotice.some(x=>x.includes('不执行宏')));
   m.fxDisabled=await app.evaluate('document.querySelector(\'.fw-office [aria-label="Insert function"]\').disabled');assert(m.fxDisabled);
   m.noSaveControl=await app.evaluate('!document.querySelector(\'[aria-label="保存工作簿"]\')');assert(m.noSaveControl);
   m.noUnsupportedFallback=await app.evaluate('!document.querySelector(".fw-unsupported")');assert(m.noUnsupportedFallback);
   await sourceModel(mi,m);
   m.twoOriginalTabsCoexist=await app.evaluate('[...document.querySelectorAll(".fw-tab [role=tab]")].filter(e=>'+JSON.stringify([r.project+'/'+x.name,r.project+'/'+m.name])+'.includes(e.title)).map(e=>e.title)');assert.equal(new Set(m.twoOriginalTabsCoexist).size,2);
   await ui.click(cell(0,0));await wait('document.querySelector(\'.fw-office [aria-label="公式栏"]\')?.value==="This is a macro workbook"');
   m.readonlyFormula=await formula();assert(m.readonlyFormula.readOnly);
   await ui.click('.fw-office [aria-label="公式栏"]');await app.cdp('Input.insertText',{text:'M9_MUST_NOT_WRITE'});
   await app.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');m.afterActualInput=await formula();assert.deepEqual(m.afterActualInput,m.readonlyFormula);
   for(const type of['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'F2',code:'F2',windowsVirtualKeyCode:113});
   m.noInlineEditor=await app.evaluate('!document.querySelector(".fw-office-cell input")');assert(m.noInlineEditor);
   r.actions.push({kind:'actual-readonly-macro-input-and-f2',key:m.key,insertedText:'M9_MUST_NOT_WRITE',keyDownUp:'F2',domMutation:false});
   for(const sheet of['Sheet2','Sheet3','Sheet1']){await ui.click('.fw-office-sheets button',sheet);await wait('[...document.querySelectorAll(".fw-office-sheets button")].some(e=>e.textContent==='+JSON.stringify(sheet)+'&&e.getAttribute("aria-current")==="page")');}
   m.sheetSequence=['Sheet2','Sheet3','Sheet1'];await wait('document.querySelector('+JSON.stringify(cell(0,0))+')?.textContent==="This is a macro workbook"');
   m.threeSheetsReachable=true;await screenshot(theme+'-xlsm-readonly.png');m.screenshot=theme+'-xlsm-readonly.png';m.observedBeforeClose=await snapshot();
   await closeSource(m);await wait('document.querySelector(".fw-tab [role=tab][aria-selected=true]")?.title==='+JSON.stringify(r.project+'/'+x.name));await closeSource(x);
   await wait('!document.querySelector(".fw-office")');
   const final=await snapshot();
   for(const c of[x,m]){c.observerSnapshot=structuredClone(final);c.finishedAt=new Date().toISOString();c.pass=true;r.checks.push(structuredClone(c));r.caseResults[c.key]='passed';delete r.pendingCases[c.key];await persist();}
   await resources.capture(app,[]);
  }
  const final=await poll(async()=>{const value=await readF18Observers(own);return value.worker.rows.length&&value.worker.rows.every(x=>x.exitedAt)?value:null},20000);
  r.rpc=final.rpc;r.workerTrace=final.worker;
  assert(!r.rpc.rows.some(x=>['saveOffice','editOffice','officeSheet'].includes(x.method)));
  assert(r.rpc.rows.every(x=>!x.delivered||(x.inputHash===x.inputAfterHash&&x.before===x.after)));
  assert(r.workerTrace.rows.every(x=>x.requests.every(y=>y.before===y.after)&&x.messages.every(y=>y.deliveredAt&&y.before===y.after)));
  r.observerRestored=await restoreF18Observers(own);installed=false;
  assert(r.observerRestored.constructorRestored&&r.observerRestored.globalDeleted);assert(Object.values(r.observerRestored.rpc).every(Boolean));
  r.caseResults.F18='passed';
 }finally{
  if(installed){
   try{r.failedObserverSnapshot=await readF18Observers(own);await persist()}catch(error){r.observerSnapshotFailure=await privateError('f18-failed-observer-read',error)}
   try{r.failedObserverRestored=await restoreF18Observers(own)}catch(error){r.observerCleanupError=await privateError('f18-observer-cleanup',error)}
  }
  await persist();
 }
}
