import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openFileAcceptanceApp } from './file-acceptance-ui.mjs';
const prototype=process.env.WILLYOU_PDF_PROTOTYPE==='1',executable=process.env.WILLYOU_FILES_APP;assert(executable);
const scratch=await mkdtemp('/private/tmp/willyou-pdf-clamp-'),root=join(scratch,'project');await mkdir(root);await copyFile('prototypes/m6-codex/public/assets/m9-pdf/normal.pdf',join(root,'normal.pdf'));
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const r={at:new Date().toISOString(),scratch,root,asarSha256:await hash(resolve(executable,'../../Resources/app.asar')),before:await hash(join(root,'normal.pdf')),checks:[],apps:[],boundary:'A real packaged app/native PDF. Original workspace RPC prepares an explicitly out-of-range reading hint in a private project; subsequent cold restore and user scroll use original UI. No source bytes/provider/DOM/store replacement, model/PTY/clipboard/nativepicker/external app.'};let app;
const quit=async()=>{await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()");const exit=await app.waitForExit(20000);assert.deepEqual({code:exit.code,signal:exit.signal},{code:0,signal:null});r.apps.push(exit);await app.close();app=null;};
try{if(prototype){
 r.boundary='P original FilePdfPreview/real browser PDF.js over known synthetic normal.pdf. Existing isolated r34 harness forwards initialPage/initialZoom as fixture props only; no native file IO or product changes.';
 app=await openFileAcceptanceApp({executable,projectPath:root,userData:join(scratch,'userdata-P'),name:'M9 PDF initial P',inspectMain:true});const entry=await app.evaluate('location.href');await app.cdp('Page.navigate',{url:'http://127.0.0.1:5180/tests/r34-pdf-runtime.html'});await app.waitFor('!!window.r34?.show');
 for(const theme of ['light','dark']){await app.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};window.r34.show({kind:'pdf',source:'normal',initialPage:99,initialZoom:100});true`);
   await app.waitFor(`window.r34.state?.loadState==="ready"&&window.r34.state?.page===3&&document.querySelector('.fa-pdf-scroll article[data-page="3"] canvas')?.dataset.rendered==="true"`);
   const clamped=await app.evaluate('({state:window.r34.state,top:document.querySelector(".fa-pdf-scroll").scrollTop})');
   // Wait for initial placement to finish before supplying the next user input.
   await app.evaluate('(async()=>{let last=-1,stable=0;for(let i=0;i<300;i++){await new Promise(requestAnimationFrame);const top=document.querySelector(".fa-pdf-scroll").scrollTop;stable=top===last?stable+1:0;last=top;if(stable>=10)return true}throw Error("Initial P placement did not settle")})()');
   const point=await app.evaluate('(()=>{const r=document.querySelector(".fa-pdf-scroll").getBoundingClientRect();return{x:r.left+100,y:r.top+100}})()');await app.cdp('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:-10000});
   await app.waitFor('window.r34.state?.page===1&&document.querySelector(".fa-pdf-scroll").scrollTop===0');const afterScroll=await app.evaluate('({state:window.r34.state,top:document.querySelector(".fa-pdf-scroll").scrollTop})');
   r.checks.push({theme,preparedInitialPage:99,clamped,afterScroll,pass:true});await app.screenshot(join(scratch,'P-'+theme+'.png'));await app.evaluate('window.r34.show({kind:"none"});true');await app.waitFor('window.r34.snapshot().active===0');
 }r.runtime=await app.evaluate('window.r34.snapshot()');await app.cdp('Page.navigate',{url:entry});await app.waitFor(`!!document.querySelector('[data-testid="nav-settings"]')`);assert.deepEqual(app.rendererErrors,[]);await quit();
}else for(const theme of ['light','dark']){
 const userData=join(scratch,'userdata-'+theme);
 app=await openFileAcceptanceApp({executable,projectPath:root,userData,name:'M9 PDF clamp '+theme,inspectMain:true});
 await app.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
 await app.open('normal.pdf');await app.click('[aria-label="文件菜单"]');await app.click('.fw-file-menu [role=menuitem]','固定标签');
 await app.waitFor('!!document.querySelector(\'[aria-label="PDF 缩放"]\')');await app.click('[aria-label="PDF 缩放"]');await app.click('[role=menuitem]','100%');await app.click('[aria-label="第 2 页"]');
 const project=app.project,scope={kind:'project',projectId:project.id};
 await app.waitFor('window.electronAPI.invoke("files.workspaceSnapshot",'+JSON.stringify(scope)+').then(x=>x.state?.routes.some(r=>r.relativePath==="normal.pdf"&&r.pdf?.page===2&&r.pdf?.zoom===100))');
 const saved=await app.invoke('files.workspaceSnapshot',scope);assert.equal(saved.state.routes.length,1);await quit();
 let prepared;
 app=await openFileAcceptanceApp({executable,projectPath:root,userData,existingProject:project,inspectMain:true,prepare:async({app})=>{
   const snapshot=await app.invoke('files.workspaceSnapshot',scope),state=structuredClone(snapshot.state);assert(state);state.routes.forEach(route=>route.pdf={page:99,zoom:100});state.active.pdf={page:99,zoom:100};
   prepared=await app.invoke('files.saveWorkspace',scope,state,snapshot.revision,randomUUID());assert(prepared.accepted);assert.equal(prepared.state.routes[0].pdf.page,99);
 }});
 await app.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
 await app.waitFor('document.querySelector(\'[aria-label="PDF 页面缩略图"] [aria-current=page]\')?.getAttribute("aria-label")==="第 3 页"&&document.querySelector(\'.fw-pdf-scroll article[data-page="3"] canvas\')?.dataset.rendered==="true"');
 await app.waitFor('window.electronAPI.invoke("files.workspaceSnapshot",'+JSON.stringify(scope)+').then(x=>x.state?.routes[0]?.pdf?.page===3)');
 const clamped=await app.invoke('files.workspaceSnapshot',scope),beforeScroll=await app.evaluate('({top:document.querySelector(".fw-pdf-scroll").scrollTop,current:document.querySelector(\'[aria-current=page]\')?.getAttribute("aria-label")})');
 const point=await app.evaluate('(()=>{const r=document.querySelector(".fw-pdf-scroll").getBoundingClientRect();return{x:r.left+100,y:r.top+100}})()');
 await app.cdp('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:-10000});
 await app.waitFor('document.querySelector(".fw-pdf-scroll").scrollTop===0&&document.querySelector(\'[aria-label="PDF 页面缩略图"] [aria-current=page]\')?.getAttribute("aria-label")==="第 1 页"');
 const afterScroll=await app.evaluate('(async()=>{for(let i=0;i<20;i++)await new Promise(requestAnimationFrame);return{top:document.querySelector(".fw-pdf-scroll").scrollTop,current:document.querySelector(\'[aria-current=page]\')?.getAttribute("aria-label")}})()');assert.equal(afterScroll.top,0);assert.equal(afterScroll.current,'第 1 页');
 assert.deepEqual(app.rendererErrors,[]);assert.equal((await app.invoke('tasks.list')).length,0);
 await app.screenshot(join(scratch,theme+'.png'));r.checks.push({theme,saved,prepared,clamped,beforeScroll,afterScroll,pass:true});await quit();
}r.after=await hash(join(root,'normal.pdf'));assert.equal(r.before,r.after);r.status='passed';
}catch(e){r.status='failed';r.error=String(e);r.stack=e.stack;process.exitCode=1;if(app)try{r.dom=await app.evaluate('document.body.innerText');r.geometry=await app.evaluate(`(()=>{const n=document.querySelector('.fw-pdf-scroll');return n&&{top:n.scrollTop,height:n.clientHeight,total:n.scrollHeight,pages:[...n.querySelectorAll('article')].map(x=>({page:x.dataset.page,rect:x.getBoundingClientRect().toJSON(),rendered:x.querySelector('canvas')?.dataset.rendered}))}})()`);await app.screenshot(join(scratch,'failure.png'));}catch{}}
finally{if(app){await writeFile(join(scratch,'failure.log'),app.logs());await app.close();}r.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,checks:r.checks.length,error:r.error,artifacts:scratch}));}
