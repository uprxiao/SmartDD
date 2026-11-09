// Original F26 full32 and F27 original5. Only currentviewer carrier/UI adapter changes.
import assert from'node:assert/strict';import{readdir,stat}from'node:fs/promises';
export async function runArchiveBinaryAcceptance({actual:app,ui,result,oracle,projectPath,fixtureRoot,fingerprints,persist,screenshot,openFile,changeStage}){
 const model="document.querySelector('.fw-content .cm-content')?.cmTile?.root?.view?.state.doc.toString()";
 for(const item of oracle.cases){changeStage('original-'+item.caseId+'-'+item.name);await openFile(item.name);const c={file:item.name,caseId:item.caseId,expectedKind:item.kind,expectedExtension:item.extension??null,openedBy:'real-ui-name-filter-option',sourceSHA256:item.sha256};result.currentCheck=c;await persist();
  c.activePath=await app.evaluate('document.querySelector(".fw-tab [role=tab][aria-selected=true]")?.title');assert.equal(c.activePath,projectPath+'/'+item.name);
  if(item.caseId==='M9-T-F26'){
   if(item.kind==='office'){
    const selector=item.extension==='docx'?'.fw-content > .fw-empty[role=alert],.fw-content .fw-office [role=alert]':item.extension==='pptx'?'.fw-content .fw-office-pages [role=alert]':'.fw-content .fw-office[aria-label="工作簿预览"] .fw-empty[role=alert]';
    await app.waitFor(`(()=>{const a=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0});return a.length===1&&a[0].textContent.trim().length>0})()`,20000);
    c.parser=await app.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0});return{text:e.textContent,carrier:e.closest('.fw-office-pages')?'office-pages':e.closest('.fw-office')?'workbook':'legacy-docx-alert',unsupported:Boolean(document.querySelector('.fw-content .fw-unsupported'))}})()`);assert(c.parser.text.trim());assert(!c.parser.text.includes('设置读取失败'));assert.equal(c.parser.unsupported,false);c.artifactPrecedesArchive=true;
   }else{
    const expected=item.kind==='archive'?'归档文件暂不提供内置预览':item.extension.toUpperCase();await app.waitFor(`document.querySelector('.fw-content .fw-unsupported')?.textContent.includes(${JSON.stringify(expected)})`,20000);c.message=await app.evaluate("document.querySelector('.fw-content .fw-unsupported').textContent");c.noEditorOrOffice=await app.evaluate("!document.querySelector('.fw-content .cm-editor,.fw-content .fw-office,.fw-content .fw-docx-with-context')");assert(c.noEditorOrOffice);
   }
   c.archiveExecutionMarker=await app.evaluate('window.__archiveExecuted??null');assert.equal(c.archiveExecutionMarker,null);
  }else{
   assert.equal(item.caseId,'M9-T-F27');
   if(item.kind==='image'){
    await app.waitFor("(()=>{const i=document.querySelector('.fw-content .fw-ordinary-image img');return !!i&&i.complete&&i.naturalWidth===2&&i.naturalHeight===2})()",20000);
    c.image=await app.evaluate("(()=>{const i=document.querySelector('.fw-content .fw-ordinary-image img'),r=i.getBoundingClientRect(),canvas=document.createElement('canvas');canvas.width=i.naturalWidth;canvas.height=i.naturalHeight;const x=canvas.getContext('2d');x.drawImage(i,0,0);return{width:i.naturalWidth,height:i.naturalHeight,visible:r.width>0&&r.height>0,rgba:[...x.getImageData(0,0,2,2).data]}})()");assert.equal(c.image.width,2);assert.equal(c.image.height,2);assert(c.image.visible);assert.deepEqual(c.image.rgba,item.expectedRGBA);c.noTextEditor=await app.evaluate("!document.querySelector('.fw-content .cm-editor')");assert(c.noTextEditor);
   }else if(item.kind==='text'){
    await app.waitFor('typeof '+model+'==="string"',15000);c.model=await app.evaluate(model);assert.equal(c.model,'x');c.actualTextModel=true;
   }else{
    await app.waitFor("Boolean(document.querySelector('.fw-content .fw-unsupported'))",15000);c.message=await app.evaluate("document.querySelector('.fw-content .fw-unsupported').textContent");assert(c.message.includes(item.kind==='binary'?'二进制':'媒体'));c.noEditorOrHex=await app.evaluate("!document.querySelector('.fw-content .cm-editor,.fw-content [contenteditable=true],.fw-content .hex-editor,.fw-content [data-testid=hex-editor]')");assert(c.noEditorOrHex);assert(!c.message.includes('HEX 编辑器'));await ui.click('[aria-label="文件菜单"]');await app.waitFor("[...document.querySelectorAll('[role=menu]')].some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&e.querySelector('[role=menuitem]')})",15000);c.fileMenu=await app.evaluate("[...document.querySelectorAll('[role=menu] [role=menuitem]')].map(e=>({text:e.textContent.trim(),disabled:Boolean(e.disabled)||e.getAttribute('aria-disabled')==='true'||e.hasAttribute('data-disabled')}))");c.noWritableSaveEntry=!c.fileMenu.some(e=>e.text==='保存文件'&&!e.disabled);c.noHexEntry=!c.fileMenu.some(e=>/十六进制|hex editor/i.test(e.text));assert(c.noWritableSaveEntry&&c.noHexEntry);await ui.press('Escape');await app.waitFor("!document.querySelector('[role=menu]')",15000);
   }
  }
  await screenshot(item.name+'.png');result.checks.push(c);delete result.currentCheck;await persist();
 }
 result.after=await fingerprints();assert.deepEqual(result.after,result.before);result.projectNamesAfter=(await readdir(projectPath)).sort();assert.deepEqual(result.projectNamesAfter,oracle.cases.map(x=>x.name).sort());try{await stat(fixtureRoot+'/outside-must-not-write.txt');result.outsideSentinelAbsent=false;throw Error('Archiveoutsidepathwaswritten')}catch(error){if(error.code!=='ENOENT')throw error;result.outsideSentinelAbsent=true;}assert.deepEqual(app.rendererErrors,[]);assert.equal((await app.invoke('tasks.list')).length,0);result.caseResults={F26:'passed',F27:'passed'};await persist();
}
