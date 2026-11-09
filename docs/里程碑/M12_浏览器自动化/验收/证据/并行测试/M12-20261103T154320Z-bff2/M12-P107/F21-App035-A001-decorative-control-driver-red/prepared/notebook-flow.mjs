import assert from'node:assert/strict';
import{access,readFile}from'node:fs/promises';
import{notebookReadinessExpression}from'./notebook-readiness.mjs';
import{observeOriginalNotebookFrame}from'./notebook-frame-observer.mjs';

export async function runNotebookCases({app,ui,mode,oracle,project,ready,persist,screenshot,fingerprints,trace,resources,setStage,requests,canary,poll}){
 const notebookClick=async(selector,text)=>{for(let i=0;i<20;i++){const d=await app.evaluate(`(()=>{const p=document.querySelector('.fa-notebook-scroll'),xs=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>${text===undefined?'true':'e.textContent.trim()==='+JSON.stringify(text)}),e=xs.length===1?xs[0]:null,r=e?.getBoundingClientRect(),b=p?.getBoundingClientRect();return{count:xs.length,target:r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right}:null,scroll:b?{x:b.x+b.width/2,y:Math.min(innerHeight-50,b.y+b.height/2),top:b.top,bottom:Math.min(innerHeight,b.bottom)}:null}})()`);mode.actions.push({kind:'notebook-control-viewport',selector,text,descriptor:d});await persist();if(d.count!==1||!d.target||!d.scroll)break;if(d.target.top>=d.scroll.top&&d.target.bottom<=d.scroll.bottom)break;const delta=d.target.top<d.scroll.top?d.target.top-d.scroll.top-50:d.target.bottom-d.scroll.bottom+50;await app.cdp('Input.dispatchMouseEvent',{type:'mouseWheel',x:d.scroll.x,y:d.scroll.y,deltaX:0,deltaY:delta});await app.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))');}await ui.click(selector,text);};
 for(const theme of oracle.themes){
  setStage(theme+':original-follow-system-theme');await app.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});await app.waitFor('document.documentElement.classList.contains('+JSON.stringify(theme==='dark'?'ydark':'ylight')+')',15000);mode.themes??=[];mode.themes.push({theme,actualClass:await app.evaluate('document.documentElement.className'),mechanism:'Original F20 media preference precondition, App theme follows system; no DOM/style writes'});await persist();
  for(const original of oracle.cases){
   const item={...original,path:project+'/'+original.name},c={file:item.name,kind:item.kind,theme,startedAt:new Date().toISOString(),complete:false};mode.checks.push(c);setStage(theme+':'+item.name+':real-open');await persist();
   const start=(await trace()).length;await ui.insert('[aria-label="筛选文件"]',item.name);await ui.click('.fw-name-results [role=option][title='+JSON.stringify(item.path)+']');
   const initial=await ready.wait(item,'default-complete-notebook',x=>!x.loading&&(item.kind==='error'?!!x.alert:!x.alert&&(item.kind==='empty'?x.text.includes(item.markers[0]):x.cellCount>0)),20000);c.defaultNotebook=initial;assert.equal(initial.cmCount,0,'Notebook is original readonly artifact, no raw JSON editor');
   if(item.kind==='error'){for(const marker of item.markers)assert(initial.alert.includes(marker));assert(initial.retry);c.actualError=initial.alert;c.retryEntryVisible=true;}
   else{
    if(item.kind==='outputs'){
     const paths=await app.evaluate(`(()=>{const root=document.querySelector('.fa-notebook');return[...root.querySelectorAll('.fa-raw-output>summary')].map(e=>{const parts=[];for(let p=e;p&&p!==root;p=p.parentElement)parts.unshift(p.tagName.toLowerCase()+':nth-child('+([...p.parentElement.children].indexOf(p)+1)+')');return'.fa-notebook '+parts.join('>')})})()`);
     for(const path of paths)await notebookClick(path);
    }
    if(item.kind!=='html'){c.visibleContent=await ready.wait(item,'original-markers-complete',x=>item.markers.every(m=>x.text.includes(m)),15000);}
    if(item.kind==='unknown'){assert.equal(c.visibleContent.outputCount,0);assert(!c.visibleContent.text.includes('MUST_NOT_FAKE'));c.sourceCellRetainedWithoutFabricatedOutput=true;}
    if(item.kind==='html'){
     c.html=await ready.wait(item,'html-frame-ready',x=>!!x.frame?.visible&&x.frame.sandbox==='',20000);assert.equal(c.html.parentSentinel,null);c.frameProof=await observeOriginalNotebookFrame(app,poll);await persist();await notebookClick('.fa-notebook-raw','Raw output');const attack=JSON.parse(await readFile(item.path,'utf8')).cells[0].outputs[0].data['text/html'];c.rawHTML=await ready.wait(item,'raw-html-actual',x=>x.text.includes(attack),15000);assert.equal(c.rawHTML.parentSentinel,null);assert.deepEqual(requests,[]);c.opaqueSandboxActual=true;c.noTrapRequestsAtCompletion=true;
    }
    if(item.name==='cell-code.ipynb'){
     assert(initial.run?.visible);assert.equal(initial.run.title,'Running is disabled in read-only preview');assert.equal(initial.run.tabIndex,-1);assert.equal(initial.run.buttonAncestor,false);await notebookClick('.fw-notebook-run');for(const [key,code]of[['Enter','Enter'],[' ','Space']])for(const type of['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code});
     c.afterRunInput=await app.evaluate(notebookReadinessExpression);assert.equal((await app.invoke('tasks.list')).length,0);await assert.rejects(access(canary),e=>e.code==='ENOENT');c.actualClickAndKeysNoKernelCanary=true;
    }
   }
   const rows=(await trace()).slice(start),chunks=rows.filter(x=>x.method==='chunk'&&x.delivered);assert(chunks.length>=1,'Actual bounded native chunk must be saved');const expected=await readFile(item.path);c.actualInputRead=chunks.map(x=>({offset:x.args[1],size:x.args[2],revisionHash:x.args[3],base64:x.output,delivered:x.delivered,sourceBefore:x.before,sourceAfter:x.after,input:x.input,inputAfter:x.inputAfter}));assert(chunks.some(x=>x.args[1]===0&&x.args[2]===expected.length&&x.args[3]===mode.before[item.name].sha256&&Buffer.from(x.output,'base64').equals(expected)),'Actual revision-bound complete input chunk must match the original generator output');assert(!rows.some(x=>x.method==='save'||x.method==='checkpoint'));c.noSaveOrCheckpoint=true;c.after=await fingerprints();assert.deepEqual(c.after,mode.before);assert.deepEqual(requests,[]);await assert.rejects(access(canary),e=>e.code==='ENOENT');
   await screenshot(mode,theme+'-'+item.name+'.png');setStage(theme+':'+item.name+':close');await ui.click('.fw-tab-close');await app.waitFor('!document.querySelector(".fa-notebook")&&!document.querySelector(".fw-tab")',15000);c.actualCloseNoNotebook=true;c.complete=true;c.finishedAt=new Date().toISOString();await resources.capture(app,[]);await persist();
  }
 }
}
