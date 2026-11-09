import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
export async function runTexCases({app,ui,mode,oracle,project,ready,persist,screenshot,fingerprints,trace,resources,setStage}){
 for(const original of oracle.cases.filter(c=>mode.kind==='normal'||c.kind==='success')){
  const item={...original,path:project+'/'+original.name},c={file:item.name,kind:mode.kind==='normal'?item.kind:'provider-unavailable',startedAt:new Date().toISOString(),complete:false};mode.checks.push(c);setStage(mode.kind+':'+item.name+':open-source');await persist();
  await ui.insert('[aria-label="筛选文件"]',item.name);await ui.click('.fw-name-results [role=option][title='+JSON.stringify(item.path)+']');
  c.defaultSource=await ready.source(item,'default-source');await screenshot(mode,item.name+'-default-source.png');await persist();
  setStage(mode.kind+':'+item.name+':explicit-compile');c.beforeCompileTraceCount=(await trace()).length;await ui.click('[aria-label="编译并查看 PDF"]');await persist();
  if(mode.kind==='provider-unavailable'){
   const x=await ready.wait(item,'provider-unavailable',x=>x.tex.present&&x.tex.visible&&x.tex.alert&&!!x.tex.error&&!x.tex.pdf,20000);assert.match(x.tex.error,/ENOENT|引擎.*资源|离线.*编译器/);c.error=x.tex.error;c.providerUnavailableExplicit=true;c.noPDF=true;
  }else if(item.kind==='success'){
   const x=await ready.wait(item,'actual-pdf-success',x=>x.tex.present&&x.tex.visible&&!x.tex.error&&x.tex.pdf&&x.tex.pdfText?.includes('TEXF16SUCCESS')&&x.tex.canvas?.rendered==='true'&&x.tex.canvas.visible&&x.tex.canvas.width>0&&x.tex.canvas.height>0,65000);c.pdfText=x.tex.pdfText;c.canvas=x.tex.canvas;c.realPDFVisible=true;
  }else{
   const x=await ready.wait(item,'actual-compile-error',x=>x.tex.present&&x.tex.visible&&x.tex.alert&&!!x.tex.error&&!x.tex.pdf&&x.tex.retry,65000);assert.match(x.tex.error,item.kind==='failure'?/willyoumissingpackagef16/:/No pages of output\./);c.error=x.tex.error;c.noPDF=true;c.recompileVisible=true;c.noZeroExitClaimForNoPages=item.kind==='no-output';
  }
  c.compileTrace=(await trace()).slice(c.beforeCompileTraceCount);const calls=c.compileTrace.filter(x=>x.method==='compileTex');assert.equal(calls.length,1,'One actual explicit UI compile, no hidden retry');
  if(mode.kind==='normal'&&item.kind==='success'){assert(calls[0].delivered);assert.equal(calls[0].output.pages,1);assert(calls[0].output.bytes>0);c.realCompileReceipt=calls[0].output;}
  else{assert(!calls[0].delivered&&calls[0].error);c.failedCompileReceipt=true;}
  await screenshot(mode,item.name+'-compile-result.png');setStage(mode.kind+':'+item.name+':source-return');await ui.click('[aria-label="查看源码"]');c.returnedSource=await ready.source(item,'source-return');assert.deepEqual(c.returnedSource,c.defaultSource);await persist();
  await ui.click('.fw-tab:has([role=tab][aria-selected=true]) .fw-tab-close');await app.waitFor('!document.querySelector(".fw-tab [role=tab][aria-selected=true]")&&!document.querySelector(".fw-tex")&&!document.querySelector(".cm-content")',20000);
  c.after=await fingerprints();assert.deepEqual(c.after,mode.before);c.complete=true;c.finishedAt=new Date().toISOString();await resources.capture(app,[]);await persist();
 }
 if(mode.kind==='normal'){assert.equal(mode.checks.length,3);assert.notEqual(mode.checks[1].error,mode.checks[2].error);}
 else assert.equal(mode.checks.length,1);
}
