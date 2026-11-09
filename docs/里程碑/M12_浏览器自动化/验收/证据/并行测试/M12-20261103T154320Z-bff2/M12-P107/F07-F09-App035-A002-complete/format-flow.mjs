import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import{formatReadinessExpression}from'./format-readiness.mjs';
export async function runFormatCases({app,ui,mode,oracle,project,ready,persist,screenshot,fingerprints,trace,resources,setStage,poll}){
 mode.actualTheme=await app.evaluate('document.documentElement.className');
 for(const original of oracle.cases){
  const item={...original,path:project+'/'+original.name},c={case:item.case,file:item.name,kind:item.kind,startedAt:new Date().toISOString(),complete:false};mode.checks.push(c);setStage(item.name+':real-open');await persist();const start=(await trace()).length;
  await ui.insert('[aria-label="筛选文件"]',item.name);
  await poll(async()=>{const d=await app.evaluate(`(()=>{const e=document.querySelector('.fw-name-results');return{busy:e?.getAttribute('aria-busy'),paths:[...(e?.querySelectorAll('[role=option]')??[])].map(x=>x.title)}})()`);mode.actions.push({kind:'name-search-complete',file:item.name,descriptor:d});await persist();return d.busy==='false'&&d.paths.filter(p=>p===item.path).length===1?d:null;},15000);
  // search-panel.tsx60 keeps an exact absolute title; tree rows instead use data-file-path.
  await ui.click('.fw-name-results [role=option][title='+JSON.stringify(item.path)+']');
  if(item.kind==='markdown'){
   c.initial=await ready.wait(item,'markdown-default');
   // Restore the exact original static-viewers-ui.mjs real editor click; rich paragraph DOM is virtual.
   c.beforeEditorClick=await app.evaluate(formatReadinessExpression);await persist();
   await ui.click('.cm-content');c.afterEditorClick=await app.evaluate(formatReadinessExpression);await persist();
   for(const type of['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40,modifiers:4});
   c.afterMetaArrowDown=await app.evaluate(formatReadinessExpression);await persist();
   c.rich=await ready.wait(item,'markdown-rich');setStage(item.name+':source-roundtrip');await persist();await ui.click('[aria-label="查看源码"]');c.source=await ready.wait(item,'source');assert.equal(c.source.editor.model,item.normalized);await ui.click('[aria-label="查看文档"]');c.returned=await ready.wait(item,'markdown-rich');c.sourceRoundTripExact=true;
  }else if(item.kind==='binary'){
   c.initial=await ready.wait(item,'binary');assert.equal(c.initial.cmCount,0);c.binaryNeverText=true;
  }else{
   c.initial=await ready.wait(item,item.kind==='grammar'?'grammar':'text');assert.equal(c.initial.editor.model,item.normalized);c.exactCompleteModel=true;if(item.kind==='grammar')c.syntax={language:item.language,evidence:'Actual corresponding basename full model + native text identity + live Worker token colors; exact frozen filename→mapping→worker source pinned',tokens:c.initial.editor.tokens,baseColor:c.initial.editor.color};
  }
  const rows=(await trace()).slice(start),bytes=await readFile(item.path),opens=rows.filter(x=>x.method==='open'&&x.delivered&&x.output?.absolutePath===item.path);assert(opens.length>0,'Actual UI must reach original files.open');
  for(const x of opens){assert.equal(x.output.revision.hash,item.sha256);assert.equal(x.output.content.kind,item.kind==='binary'?'binary':'text');assert.equal(x.output.revision.size,item.bytes);}
  c.nativeOpen=opens.map(x=>({at:x.at,document:x.output,input:x.input,inputAfter:x.inputAfter,sourceBefore:x.before,sourceAfter:x.after}));
  if(item.kind!=='binary'){
   const reads=rows.filter(x=>x.method==='read'&&x.delivered&&x.output?.document?.absolutePath===item.path);assert(reads.some(x=>x.output.document.revision.hash===item.sha256&&Buffer.from(x.output.base64,'base64').equals(bytes)),'Complete actual native text bytes, not virtualized DOM');c.nativeRead=reads.map(x=>({at:x.at,document:x.output.document,base64:x.output.base64,input:x.input,inputAfter:x.inputAfter,sourceBefore:x.before,sourceAfter:x.after}));
  }else{assert(!rows.some(x=>x.method==='read'));c.noNativeTextRead=true;}
  assert(!rows.some(x=>x.method==='save'||x.method==='checkpoint'));c.noSaveOrCheckpoint=true;c.after=await fingerprints();assert.deepEqual(c.after,mode.before);await screenshot(mode,item.case+'-'+item.name+'.png');setStage(item.name+':close');await persist();await ui.click('.fw-tab-close');await app.waitFor('!document.querySelector(".cm-content")&&!document.querySelector(".fw-tab")&&!document.querySelector(".fw-unsupported")',15000);c.actualClosed=true;c.complete=true;c.finishedAt=new Date().toISOString();await resources.capture(app,[]);await persist();
 }
}
