import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
const executable=process.env.WILLYOU_FILES_APP,url=process.env.WILLYOU_IMAGE_OPEN_URL;assert(executable&&url);
const scratch=await mkdtemp('/private/tmp/willyou-image-open-P-'),root=join(scratch,'empty-project');await mkdir(root);
const sha=b=>createHash('sha256').update(b).digest('hex'),r={at:new Date().toISOString(),scratch,root,caseId:'M9-T-V02',layer:'P',asarSha256:sha(await readFile(resolve(executable,'../../Resources/app.asar'))),checks:[],status:'running',boundary:'Actual built shared prototype FileWorkspace/FileMarkdown;public original PNGdataURL and explicit synthetic resolver normal/null/error buttons. Trusted real UI menu/newtab/close. This is P,not FileService/native/asset-provider/App A or systemclipboard.'};
let app,entry,stage='setup';
const tabs=()=>app.evaluate('[...document.querySelectorAll(".fw-tab")].map(e=>({text:e.textContent.trim(),selected:e.classList.contains("selected")}))');
const menu=async()=>{const p=await app.evaluate(`(()=>{const e=document.querySelector('.fw-md-image');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('Image source occluded');return{x,y}})()`);for(const type of['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'right',clickCount:1})});await app.waitFor('!!document.querySelector(".fw-image-menu")');await app.click('.fw-image-menu [role=menuitem]','在新标签打开图片');};
try{
 app=await openFileAcceptanceApp({executable,projectPath:root,userData:join(scratch,'userdata'),name:'P V02 image resolver adapter',inspectMain:true});r.pid=app.processId;entry=await app.evaluate('location.href');await app.cdp('Page.navigate',{url});await app.waitFor('!!document.querySelector("[data-testid=image-resolver-normal]")');
 for(const theme of['light','dark']){
  if(theme==='dark')await app.click('[data-testid=image-open-theme]');await app.waitFor('document.documentElement.dataset.theme==='+JSON.stringify(theme));
  for(const mode of['normal','empty','error','recovered']){
   stage=theme+':'+mode;const setup=mode==='recovered'?'normal':mode;await app.click('[data-testid=image-resolver-'+setup+']');await app.waitFor('document.querySelector('+JSON.stringify('[data-testid=image-resolver-'+setup+']')+').getAttribute("aria-pressed")==="true"');
   await app.click('[role=treeitem][data-path="images.md"]');await app.waitFor('document.querySelector(".fw-md-image img")?.naturalWidth===1600');const before=await tabs();await menu();
   if(['empty','error'].includes(mode)){
    await app.waitFor('document.body.innerText.includes("无法打开图片")');const after=await tabs();assert.deepEqual(after,before);assert(!await app.evaluate('!!document.querySelector(".fw-ordinary-image")'));const notice=await app.evaluate('document.querySelector(".fw-toast")?.textContent||document.body.innerText');assert.match(notice,mode==='empty'?/图片来源为空/:/V02 synthetic asset resolver error/);r.checks.push({theme,mode,noFalseNewTab:true,notice});
   }else{
    await app.waitFor('document.querySelector(".fw-ordinary-image img")?.naturalWidth===1600');assert(await app.evaluate('[...document.querySelectorAll(".fw-save-strip")].some(e=>e.textContent.includes("本机附件为只读"))'));assert(!await app.evaluate('!!document.querySelector(".fw-editor textarea,.fw-codemirror")'));const src=await app.evaluate('document.querySelector(".fw-ordinary-image img").src');assert(src.startsWith('data:image/png;base64,'));r.checks.push({theme,mode,readonlyAttachment:true,decodedWidth:1600,hash:sha(Buffer.from(src.split(',')[1],'base64')),tabs:await tabs()});await app.click('[aria-label="关闭 picture.png"]');await app.waitFor('!document.querySelector(".fw-ordinary-image")');
   }
   await app.screenshot(join(scratch,theme+'-'+mode+'.png'));await writeFile(join(scratch,'progress.json'),JSON.stringify({...r,stage},null,2)+'\n');
  }
 }
 assert.deepEqual(app.rendererErrors,[]);await app.cdp('Page.navigate',{url:entry});await app.waitFor('!!document.querySelector("[data-testid=nav-settings]")');assert.deepEqual(await app.invoke('tasks.list'),[]);await writeFile(join(scratch,'electron.log'),app.logs());const ready={scratch,pid:r.pid,status:'awaiting-original-native-menu-quit',app:executable};await writeFile(join(scratch,'quit-ready.json'),JSON.stringify(ready)+'\n');console.log(JSON.stringify(ready));r.exit=await app.waitForExit(120000);assert.equal(r.exit.code,0);assert.equal(r.exit.signal,null);await app.close();app=null;r.status='passed';
}catch(error){r.status='failed';r.stage=stage;r.error=String(error);r.stack=error.stack;process.exitCode=1;if(app)try{r.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(scratch,'failure.png'));}catch{}}
finally{if(app){await writeFile(join(scratch,'failure-electron.log'),app.logs());await app.close();}r.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,checks:r.checks.length,scratch,error:r.error}));}
