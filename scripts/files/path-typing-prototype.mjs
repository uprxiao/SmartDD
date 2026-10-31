// Y34 P keyboard part. Shared components; no model/native/voice connection.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
import {dragElectronElement} from '../lib/electron-drag.mjs';
const scratch=await mkdtemp('/private/tmp/willyou-path-typing-P-'),root=join(scratch,'project');await mkdir(root);
const r={at:new Date().toISOString(),caseId:'M9-T-Y34',layer:'P keyboard partial',scratch,checks:[],status:'running',boundary:'Original shared FileWorkspace and TerminalPreview in a labelled synthetic host. Actual browser pointer drag payload and trusted keyboard inputs. Read-only terminal session snapshot, no editor/store/DOM value changes. No native IO,PTY,model,voice,system IME,clipboard or human Enter claim.'};
let app,entry,stage='setup',expected='';const files=['ordinary.txt','中文 空格🙂\'"();`$().txt'],target='.path-typing-harness .terminal-stage .xterm-screen',row=name=>'[role=treeitem][data-path='+JSON.stringify(name)+']';
const state=()=>app.evaluate('({snapshot:window.__pathTypingP.snapshot(),focus:!!document.activeElement?.closest(".terminal-stage"),active:document.querySelector(".fw-tab [aria-selected=true]")?.title})');
const exact=async()=>{await app.waitFor('window.__pathTypingP.snapshot()?.input==='+JSON.stringify(expected));const s=await state();assert(s.focus,'Prototype drop/typing must retain terminal focus');return s;};
async function double(selector){const point=await app.evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+'),b=e.getBoundingClientRect();return{x:b.x+Math.min(20,b.width/2),y:b.y+b.height/2}})()');for(const type of['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:2});}
try{
 app=await openFileAcceptanceApp({executable:process.env.WILLYOU_FILES_APP,projectPath:root,userData:join(scratch,'userdata'),name:'P · Y34 keyboard synthetic host',showFiles:false,inspectMain:true});r.appPid=app.processId;assert(process.env.WILLYOU_PATH_TYPING_P_BACKGROUND!=='1','Recorded background probe did not provide bounded layout input; use the isolated visible P lane.');entry=await app.evaluate('location.href');await app.cdp('Page.navigate',{url:'http://127.0.0.1:5179/tests/path-typing-runtime.html'});await app.waitFor(app.exists(row('ordinary.txt'))+'&&'+app.exists(target));
 for(const theme of ['light','dark']){
  if(theme==='dark')await app.click('[data-testid=typing-theme]');
  for(const source of ['tree','tab'])for(const name of files){
   stage=theme+':'+source+':'+name;const tab='.fw-tab:has([role=tab][title='+JSON.stringify('/synthetic/path-typing/'+name)+'])';
   if(source==='tab'){await app.click(row(name));await app.waitFor(app.exists(tab));await double(tab+' [role=tab]');await app.waitFor('!document.querySelector('+JSON.stringify(tab)+')?.classList.contains("preview")');}
   await app.click(target);const prefix=process.env.WILLYOU_PATH_TYPING_PREFIX_BOUNDARIES==='1'?['请阅读文件',' 接着阅读文件 ',' 保留两个空格  ','🙂请再核对'][r.checks.length%4]:(expected?' 接着阅读文件 ':'请阅读文件 ');await app.cdp('Input.insertText',{text:prefix});expected+=prefix;const before=await exact();
   const drag=await dragElectronElement(app,source==='tree'?row(name):tab,target);expected+='/synthetic/path-typing/'+name+' ';const afterDrop=await exact();
   await app.cdp('Input.insertText',{text:'请总结'});expected+='请总结';const afterText=await exact();
   for(const type of['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'j',code:'KeyJ',windowsVirtualKeyCode:74,...(type==='keyDown'?{text:'j',unmodifiedText:'j'}:{})});expected+='j';const afterKey=await exact();
   assert(!expected.includes('\n')&&!expected.includes('\r'));r.checks.push({theme,source,name,before,drag,afterDrop,afterText,afterKey,noEnter:true,pass:true});await writeFile(join(scratch,'partial.json'),JSON.stringify(r,null,2)+'\n');
  }
  await app.screenshot(join(scratch,theme+'-typing.png'));
 }
 assert.deepEqual(app.rendererErrors,[]);r.functionalStatus='passed';r.status='passed-keyboard-partial';r.normalExitAttempted=process.env.WILLYOU_PATH_TYPING_QUIT_PROBE==='1';if(r.normalExitAttempted){await app.cdp('Page.navigate',{url:entry});await app.waitFor(app.exists('[data-testid=nav-settings]'));await app.mainEvaluate('(()=>{const e=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");setTimeout(()=>e.app.quit(),30);return true})()');r.exit=await app.waitForExit(20000);assert.equal(r.exit.code,0);assert.equal(r.exit.signal,null);}else r.cleanupBoundary='P browser container is stopped by own harness cleanup; this is not product normal-exit acceptance. Earlier20s quit failures remain separate evidence.';
}catch(error){r.status='failed';r.stage=stage;r.error=String(error);r.stack=error.stack;process.exitCode=1;if(app)try{r.state=await state();await app.screenshot(join(scratch,'failure.png'));}catch{}}
finally{if(app){await writeFile(join(scratch,'electron.log'),app.logs());await app.close();try{r.containerExit=await app.waitForExit(3000);}catch(error){r.cleanupError=String(error);r.status='failed-cleanup';process.exitCode=1;}}r.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,checks:r.checks.length,stage:r.stage,error:r.error,scratch}));}
