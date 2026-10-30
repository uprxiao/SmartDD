import {createRequire} from 'node:module';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const {chromium}=createRequire('/private/tmp/m9-qa/package.json')('playwright-core');
const root=process.cwd(),out=path.join(root,'docs/里程碑/M9_文件浏览工作区/验收/证据/r34-markdown-worker');fs.mkdirSync(out,{recursive:true});
const budget=JSON.parse(fs.readFileSync(path.join(root,'prototypes/m6-codex/tests/r34-markdown-worker/budget.json')));
const checks=[],workers=[],external=[],errors=[];
const check=(id,title,ok,detail={})=>{checks.push({id,title,status:ok?'passed':'failed',detail});console.log(id,ok?'PASS':'FAIL',title);};
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1280,height:960}}),page=await context.newPage();
page.on('worker',w=>{const record={url:w.url(),closed:false,createdAt:Date.now()};workers.push(record);w.on('close',()=>{record.closed=true;record.closedAt=Date.now();});});
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:4176/'))external.push(r.url());});
await context.route(/^https?:\/\/(?!127\.0\.0\.1:4176)/,r=>r.abort());
const waitClosed=async record=>{const deadline=Date.now()+1000;while(!record.closed&&Date.now()<deadline)await page.waitForTimeout(10);};
let fixtures,measurements=[],baselineHeap,finalHeap;
try{
 await page.goto('http://127.0.0.1:4176/tests/r34-markdown-worker/harness.html');await page.waitForFunction(()=>window.r34MarkdownWorker);
 fixtures=await page.evaluate(s=>r34MarkdownWorker.prepare(s),budget.fixtureBytes);
 const readyMs=await page.evaluate(()=>r34MarkdownWorker.warm());
 check('MW01','real native module Worker loads current parser and fixed fixtures',readyMs<budget.workerReadyMsMax&&workers.length===1&&fixtures.every((x,i)=>x.bytes===budget.fixtureBytes[i]),{readyMs,fixtures});
 const semantic=await page.evaluate(async()=>{const a=r34MarkdownWorker;const sync=await a.sync(a.semanticFixture),worker=await a.parse(a.semanticFixture),window=await a.window(0,30);return{sameIndex:sync.indexHash===worker.indexHash,sameSource:sync.sourceHash===worker.sourceHash,sameWindow:JSON.stringify(sync.items)===JSON.stringify(window.items),workerBlocks:worker.blocks};});
 check('MW02','Worker and synchronous parser preserve exact CRLF/Unicode ranges and viewport output',semantic.sameIndex&&semantic.sameSource&&semantic.sameWindow,semantic);
 const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('HeapProfiler.collectGarbage');
 const heap=async()=>(await cdp.send('Performance.getMetrics')).metrics.find(x=>x.name==='JSHeapUsedSize').value;baselineHeap=await heap();
 for(const bytes of budget.fixtureBytes){
   const result=await page.evaluate(async bytes=>{const a=r34MarkdownWorker;longTasks=[];await new Promise(r=>setTimeout(r,100));longTasks=[];const started=performance.now(),ticks=Number(document.querySelector('#ticks').textContent);const result=await a.parse(a.fixtures[bytes]);const elapsedMs=performance.now()-started,ticksDuringParse=Number(document.querySelector('#ticks').textContent)-ticks;await new Promise(r=>setTimeout(r,100));const tasks=[...longTasks];return{bytes,status:result.status,parseMs:result.parseMs,elapsedMs,blocks:result.blocks,indexHash:result.indexHash,indexBytes:result.index?.byteLength,mainLongTasks:tasks,ticksDuringParse};},bytes);
   measurements.push(result);
 }
 check('MW03','up to 10MiB parses within frozen budget without blocking main thread',measurements.every(x=>x.status==='completed'&&x.parseMs<budget.parseMsMax&&Math.max(0,...x.mainLongTasks)<budget.mainLongTaskMsMax),{measurements,budget});
 const window=await page.evaluate(async()=>{longTasks=[];const a=r34MarkdownWorker,reply=await a.window(500,60),start=performance.now(),nodes=a.mount(reply.items);await new Promise(r=>setTimeout(r,100));return{nodes,mountMs:performance.now()-start-100,longTasks:[...longTasks]};});
 check('MW04','bounded viewport materializes at most 60 real rendered blocks',window.nodes===60&&Math.max(0,...window.longTasks)<budget.mainLongTaskMsMax,window);
 for(const bytes of [2097152,10485760]){
   const sync=await page.evaluate(async bytes=>{longTasks=[];await new Promise(r=>setTimeout(r,100));longTasks=[];const a=r34MarkdownWorker,result=await a.sync(a.fixtures[bytes]);await new Promise(r=>setTimeout(r,100));return{bytes,parseMs:result.parseMs,indexHash:result.indexHash,mainLongTasks:[...longTasks]};},bytes);
   check('MW05-'+bytes,'synchronous baseline is semantically identical; blocking cost recorded',sync.indexHash===measurements.find(x=>x.bytes===bytes).indexHash,sync);
 }
 const cancelWorker=workers.at(-1);
 const cancel=await page.evaluate(async()=>{const a=r34MarkdownWorker;let cancelAt,cancelAtEpoch;a.startedCallback=()=>{a.startedCallback=null;setTimeout(()=>{cancelAt=performance.now();cancelAtEpoch=Date.now();a.cancel();},15);};const result=await a.parse(a.fixtures[10485760]);return{status:result.status,ms:performance.now()-cancelAt,cancelAtEpoch,snapshot:a.snapshot()};});
 await waitClosed(cancelWorker);cancel.nativeCloseMs=cancelWorker.closedAt-cancel.cancelAtEpoch;
 check('MW06','cancel terminates a real in-flight synchronous parser Worker',cancel.status==='cancelled'&&cancel.ms<budget.cancelMsMax&&cancel.snapshot.active===0&&cancelWorker.closed&&cancel.nativeCloseMs<budget.cancelMsMax,cancel);
 const timeout=await page.evaluate(async ms=>{const a=r34MarkdownWorker;await a.warm();const start=performance.now(),startEpoch=Date.now(),r=await a.parse(a.fixtures[10485760],{timeoutMs:ms});return{status:r.status,elapsedMs:performance.now()-start,startEpoch,snapshot:a.snapshot()};},budget.timeoutInjectedMs);
 const timeoutWorker=workers.at(-1);await waitClosed(timeoutWorker);timeout.nativeCloseMs=timeoutWorker.closedAt-timeout.startEpoch;
 check('MW07','deadline terminates in-flight Worker and releases host index',timeout.status==='timeout'&&timeout.elapsedMs<budget.timeoutReleaseMsMax&&timeout.snapshot.active===0&&timeout.snapshot.indexBytes===0&&timeoutWorker.closed&&timeout.nativeCloseMs<budget.timeoutReleaseMsMax,timeout);
 const late=await page.evaluate(async()=>{const a=r34MarkdownWorker;await a.warm();const before=a.stats.ignored;const old=a.parse(a.semanticFixture,{delayResultMs:250});await new Promise(r=>setTimeout(r,50));a.invalidateDelayed();const next=await a.parse('# New revision\n\nchanged');const previous=await old;await new Promise(r=>setTimeout(r,300));const win=await a.window(0,30);return{previous:previous.status,next:next.status,ignored:a.stats.ignored-before,window:win.items};});
 check('MW08','actual delayed old Worker reply is ignored after revision changes',late.previous==='superseded'&&late.next==='completed'&&late.ignored===1&&late.window.some(x=>x.html?.includes('New revision')),late);
 const unmountWorker=workers.at(-1);
 const unmount=await page.evaluate(async()=>{const a=r34MarkdownWorker;let at,atEpoch;a.startedCallback=()=>{a.startedCallback=null;setTimeout(()=>{at=performance.now();atEpoch=Date.now();a.unmount();},15);};const result=await a.parse(a.fixtures[10485760]);return{status:result.status,ms:performance.now()-at,atEpoch,children:document.querySelector('#preview').children.length,snapshot:a.snapshot()};});
 await waitClosed(unmountWorker);unmount.nativeCloseMs=unmountWorker.closedAt-unmount.atEpoch;
 check('MW09','unmount during parse removes Worker, pending job and viewport nodes',unmount.status==='cancelled'&&unmount.ms<budget.cancelMsMax&&unmount.children===0&&!unmount.snapshot.pending&&unmount.snapshot.active===0&&unmountWorker.closed&&unmount.nativeCloseMs<budget.cancelMsMax,unmount);
 const bootCancel=await page.evaluate(async()=>{const a=r34MarkdownWorker;const p=a.parse(a.semanticFixture);a.unmount();const result=await p;return{status:result.status,snapshot:a.snapshot()};});
 check('MW10','unmount during module bootstrap also settles request and releases Worker',bootCancel.status==='cancelled'&&bootCancel.snapshot.active===0,bootCancel);
 await page.waitForTimeout(200);await cdp.send('HeapProfiler.collectGarbage');finalHeap=await heap();
 check('MW11','all owned workers close, no external requests and bounded main page heap',workers.every(x=>x.closed)&&external.length===0&&errors.length===0&&finalHeap-baselineHeap<budget.postGcMainHeapGrowthBytesMax,{workers,external,errors,baselineHeap,finalHeap,delta:finalHeap-baselineHeap});
}catch(e){check('FATAL','probe completed',false,{error:e.stack});}
finally{
 const sourcePaths=['src/file-markdown-model.mjs','src/file-markdown-source.mjs','src/file-highlight.mjs',...fs.readdirSync(path.join(root,'prototypes/m6-codex/tests/r34-markdown-worker')).map(x=>'tests/r34-markdown-worker/'+x)];
 const sources=sourcePaths.map(p=>{const file=path.join(root,'prototypes/m6-codex',p);return{path:'prototypes/m6-codex/'+p,bytes:fs.statSync(file).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};});
 const report={ranAt:new Date().toISOString(),scope:'isolated synthetic Chromium parser feasibility; actual current Markdown parser; not complete editor or packaged App',browser:await browser.version(),budget,fixtures,checks,measurements,sources,summary:checks.reduce((a,c)=>(a[c.status]=(a[c.status]||0)+1,a),{})};
 fs.writeFileSync(path.join(out,'r34-markdown-worker-report.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report.summary));if(checks.some(x=>x.status==='failed'))process.exitCode=1;
}
