// B08.1 real native attachment Save As – isolated user-operated native sheets.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,writeFile,realpath,lstat,readdir,rename,access} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {openElectron,pause} from './isolated-electron.mjs';
import {repo,support,bundle,exe,pin,nativePin,filesPin,name,cases,digest,verifyPackage,verifyPath,canonicalSelection} from './guards.mjs';

assert(process.argv[2]==='--coordinator-authorized-user-native');
const pins=await verifyPackage(process.argv.slice(3,7));
const extraArgs=process.argv.slice(7);assert(extraArgs.length<=1);
const selectedCases=extraArgs.length?extraArgs[0].split('=')[1]?.split(','):cases;
assert(!extraArgs.length||extraArgs[0].startsWith('--cases='));assert(selectedCases?.length&&new Set(selectedCases).size===selectedCases.length&&selectedCases.every(c=>cases.includes(c)));
assert.deepEqual(selectedCases,cases.filter(c=>selectedCases.includes(c)),'Selected cases must follow original contract order');
assert.equal(process.cwd(),repo);
const root=await mkdtemp('/private/tmp/willyou-m16-b08-attachment-c28-');
const home=join(root,'home'),data=join(root,'data'),cli=join(root,'cli-home'),projectDir=join(root,'project');
for(const p of [home,data,projectDir,join(home,'.config'),join(cli,'.codex'),join(cli,'.claude'),...cases.map(c=>join(root,'artifacts',c))])await mkdir(p,{recursive:true,mode:0o700});
const plans=selectedCases.map((id,i)=>({id,i,cancel:id.startsWith('cancel'),background:id.endsWith('finder'),path:join(root,'artifacts',id,name),nonce:randomUUID(),gate:join(root,`release-${id}.json`)}));
for(const p of plans)await verifyPath(root,p.id,p.path);
const result={schema:'M16-B08.1-C28-real-native-attachment-recovery',pins,root,data,exe,startedAt:Date.now(),status:'starting',requestedCases:selectedCases,starts:[],actions:[],checks:[],nativeRows:[],boundary:'Isolated synthetic draft fixture through original blob/draft services; four genuine attachment Save clicks through renderer; real user native sheet operations; parent and original OS result observed. Finder cases delay delivery of already-completed original native result in isolated observer only; production focus/save logic and valid native result unchanged. No mail connection, send or personal credentials. Chromium mock keychain only for synthetic isolated startup.'};
const save=()=>writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
async function progress(value){await writeFile(join(root,'progress.json'),JSON.stringify(value,null,2)+'\n',{mode:0o600});await save();console.log(JSON.stringify(value));}
await progress({stage:'starting',root});
const kept=new Set(['PATH','TMPDIR','LANG','LC_ALL','USER','LOGNAME','SHELL']);
for(const k of Object.keys(process.env))if(!kept.has(k))delete process.env[k];
const env={HOME:home,ZDOTDIR:home,SMARTDD_CLI_HOME:cli,CODEX_HOME:join(cli,'.codex'),CLAUDE_CONFIG_DIR:join(cli,'.claude'),XDG_CONFIG_HOME:join(home,'.config'),HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost'};
const title=`WillYou · M16 B08附件另存 ${root.split('-').at(-1)}`;
const bytes=Buffer.from([0,1,2,255]),bytesHash=createHash('sha256').update(bytes).digest('hex');
const nativeFile=join(root,'native-dialog-observations.json');
let app,project,frontProcess,ownerId,shellId,frontRows=[],observerError,finished=false;
const js=(fn,...args)=>{
 const expression='('+fn.toString()+')(...'+JSON.stringify(args)+')';
 new Function('return '+expression);
 return expression;
};
const unwrap=x=>{assert(x?.ok,JSON.stringify(x));return x.value;};
const exists=p=>access(p).then(()=>true,()=>false);
async function until(fn,label,timeout=15000,step=120){const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await pause(step);}throw Error('Timeout: '+label);}
async function main(fn,...args){
 assert(app);
 const expression=js((pid,exe,data,home,cli,source,args)=>{
  const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');
  if(process.pid!==pid||process.execPath!==exe||E.app.getPath('userData')!==data||process.env.HOME!==home||process.env.SMARTDD_CLI_HOME!==cli||!E.app.commandLine.hasSwitch('use-mock-keychain'))throw Error('Wrong isolated app identity');
  return (0,eval)('('+source+')')(E,...args);
 },app.processId,exe,data,home,cli,fn.toString(),args);
 return app.mainEvaluate(expression,{label:'b08-attachment-isolated-observer',synchronous:true,timeoutMs:5000});
}
async function own(){return main((E,expectedOwner,expectedShell)=>{
 const roots=E.BaseWindow.getAllWindows().filter(w=>!w.isDestroyed());if(roots.length!==1)throw Error('original root not unique');const w=roots[0];
 const views=w.contentView.children.map(v=>v.webContents).filter(c=>c&&!c.isDestroyed()&&c.getURL().startsWith('file:')&&c.getURL().includes('/out/renderer/index.html'));
 if(views.length!==1)throw Error('original trusted shell not unique');const c=views[0];
 if(expectedOwner!==null&&(w.id!==expectedOwner||c.id!==expectedShell))throw Error('original root or shell changed');
 return {id:w.id,title:w.getTitle(),visible:w.isVisible(),focused:w.isFocused(),wcId:c.id,wcPid:c.getOSProcessId(),shellFocused:c.isFocused(),bounds:w.getBounds()};
 },ownerId??null,shellId??null);}
async function start(resume=null){
 ownerId=undefined;shellId=undefined;
 app=await openElectron({executable:exe,userData:data,env,inspectMain:true,mockKeychainFixture:true,candidatePin:pin,nativePin,resume});
 const state=await own();ownerId=state.id;shellId=state.wcId;
 const named=await main((E,id,wcId,title)=>{const w=E.BaseWindow.fromId(id);const c=E.webContents.fromId(wcId);if(!w||!c||!w.contentView.children.some(v=>v.webContents===c))throw Error('wrong owner');w.setTitle(title);return w.getTitle();},ownerId,shellId,title);
 assert.equal(named,title);
 result.starts.push({pid:app.processId,resume:!!resume,root:await own(),startup:app.startupObservation});await save();
}
async function normalQuit(){
 const pid=app.processId;let quitRequestError;
 try{await main(E=>{setTimeout(()=>E.app.quit(),50);return true;});}catch(e){quitRequestError=String(e);}
 // The inspector may close before Node returns the normal-quit response.
 const exit=await app.waitForExit(20000);if(quitRequestError)result.quitRequestError=quitRequestError;
 await app.close();app=undefined;
 assert.equal(exit.pid,pid);assert.equal(exit.code,0);assert.equal(exit.signal,null);assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 const db=join(data,'smartdd.db');assert.equal(await realpath(db),db);assert(!await exists(db+'-wal'),'Original clean SQLite close required');
 return {pid,exit,dbSha:await digest(db),noWAL:true,pidGone:true};
}
function observeFront(){
 frontProcess=spawn(join(support,'front-observer'),[String(app.processId),exe],{stdio:['ignore','pipe','pipe']});let rest='';
 const log=join(root,'front-observations.jsonl');
 frontProcess.stdout.on('data',part=>{rest+=part.toString();let n;while((n=rest.indexOf('\n'))>=0){const line=rest.slice(0,n);rest=rest.slice(n+1);try{const row=JSON.parse(line);assert(Number.isFinite(row.at)&&['own','finder','other'].includes(row.front));assert(row.front==='own'?row.pid===app.processId:row.front==='other'?row.pid===0:row.pid>0);frontRows.push(row);appendFileSync(log,JSON.stringify(row)+'\n',{mode:0o600});}catch(e){observerError=String(e);}}});
 frontProcess.on('error',e=>{observerError=String(e);});frontProcess.on('exit',()=>{if(!finished)observerError='Independent AppKit observer exited';});
}
async function stopFront(){if(!frontProcess)return;const p=frontProcess;frontProcess=undefined;if(p.exitCode!==null||p.signalCode!==null)return;const stopped=new Promise(r=>p.once('close',r));p.kill('SIGTERM');await Promise.race([stopped,pause(3000)]);}
function continuousFront(mode,ms,after=0){
 if(observerError)throw Error(observerError);const last=frontRows.at(-1);if(!last||last.front!==mode||Date.now()-last.at>500)return null;
 let first=frontRows.length-1;while(first>0&&frontRows[first-1].front===mode&&frontRows[first-1].at>=after&&frontRows[first].at-frontRows[first-1].at<500)first--;
 const rows=frontRows.slice(first);if(rows[0].at<after||last.at-rows[0].at<ms)return null;
 return {mode,from:rows[0].at,to:last.at,count:rows.length,duration:last.at-rows[0].at,pid:last.pid};
}
async function foreground(label){
 await progress({stage:'await-own-front',root,pid:app.processId,windowTitle:title,case:label,instruction:'请将标题完全匹配的本轮隔离 WillYou 窗口置于前台，停留等待系统保存框。'});
 const stable=await until(()=>continuousFront('own',3000),'actual own AppKit foreground '+label,240000);
 const state=await own();assert(state.focused&&state.visible&&state.title===title);return {stable,state};
}
async function click(selector,text=null,nativePlan=null){
 const o=await own();assert(o.visible&&o.title===title);if(nativePlan){assert(o.focused&&continuousFront('own',1000));}
 await app.waitFor('document.getAnimations().every(a=>a.playState!=="running"||a.effect?.getTiming().iterations===Infinity)',5000);
 const point=await until(()=>app.evaluate(js((q,t)=>{const list=[...document.querySelectorAll(q)].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.matches(':disabled')&&(t===null||e.textContent.trim()===t)});if(list.length!==1)return null;const e=list[0];e.scrollIntoView({block:'nearest',behavior:'instant'});const r=e.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);return e.contains(document.elementFromPoint(x,y))?{x,y}:null;},selector,text)),'visible unobstructed real control '+selector+' '+(text??''));
 const action={selector,text,point,at:Date.now(),ownerId,shellId};
 for(const type of ['mouseMoved','mousePressed','mouseReleased']){
  const sending=app.cdp('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});
  if(nativePlan&&type==='mouseReleased'){
   // The genuine OS sheet can temporarily withhold the CDP response. Send once; the independently observed original invocation is the authoritative receipt.
   action.nativeCase=nativePlan.id;action.releaseResponse={status:'pending'};
   sending.then(()=>{action.releaseResponse={status:'response',at:Date.now()};},e=>{action.releaseResponse={status:'unavailable',at:Date.now(),error:String(e)};});
  }else await sending;
 }
 result.actions.push(action);await save();
}
async function selectProject(){
 await click('[data-testid=nav-apps]');
 await click('.m10-sidebar .installed:has(span[title="邮件"])');
 await click('.m10-sidebar .m13-nav-child','草稿');
 const picker='select[aria-label="草稿项目"]';
 const options=await until(()=>app.evaluate(js((q,id)=>{const e=document.querySelector(q);if(!e||e.tagName!=='SELECT'||![...e.options].some(o=>o.value===id))return null;return{value:e.value,options:[...e.options].map(o=>o.value)};},picker,project.id)),'actual synthetic draft project options');
 if(options.value!==project.id){
  assert.equal(options.options.at(-1),project.id,'fresh isolated project must be final option');
  await click(picker);
  for(const [key,code,windowsVirtualKeyCode] of [['End','End',35],['Enter','Enter',13]])for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode});
  result.actions.push({kind:'real-HTML-select-keyboard',selector:picker,expectedProject:project.id,at:Date.now()});
 }
 await app.waitFor(js((q,id)=>document.querySelector(q)?.value===id,picker,project.id),10000);
 await click('.m10-draft-row strong','M16 B08 synthetic attachment');
 await app.waitFor('!!document.querySelector("dialog .m10-save-controls")&&document.querySelector("dialog").textContent.includes("M16-B08-binary.bin")&&document.querySelector("dialog .m10-resource-view pre")?.textContent==="M16 B08 synthetic body"&&Array.from(document.querySelectorAll("dialog .m10-save-controls>button")).some(b=>b.textContent==="保存附件"&&!b.disabled)',20000);
 const state=await app.evaluate('({body:document.querySelector("dialog .m10-resource-view pre")?.textContent,project:document.querySelector("dialog .m10-modal-copy")?.textContent})');
 assert(state.project.includes(project.id));assert.equal(state.body,'M16 B08 synthetic body');
 await app.screenshot(join(root,'attachment-draft-ready.png'));result.draftUiReady={ownerId,shellId,projectId:project.id,filename:name,actualControl:true};await save();
}
async function installNativeObserver(){
 return main((E,id,shellId,title,plans,file,root,expectedName)=>{
  const fs=process.getBuiltinModule('fs'),P=process.getBuiltinModule('path');
  const owner=E.BaseWindow.fromId(id),shell=E.webContents.fromId(shellId);
  if(!owner||!shell||!owner.contentView.children.some(v=>v.webContents===shell)||owner.getTitle()!==title||!shell.getURL().includes('/out/renderer/index.html'))throw Error('Trusted shell owner must be original');
  const old=E.dialog.showSaveDialog,oldFocus=shell.focus;const rows=[],focusCalls=[],nativeFocusEvents=[];let active=null;
  const snapshot=()=>({id:owner.id,title:owner.getTitle(),visible:owner.isVisible(),focused:owner.isFocused(),shellId:shell.id,shellFocused:shell.isFocused()});
  const flush=()=>{const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify({rows,focusCalls,nativeFocusEvents}),{mode:0o600});fs.renameSync(temp,file);};
  const focused=()=>{nativeFocusEvents.push({at:Date.now(),case:active?.id??null,kind:'owner-focus',state:snapshot()});flush();};
  const blurred=()=>{nativeFocusEvents.push({at:Date.now(),case:active?.id??null,kind:'owner-blur',state:snapshot()});flush();};
  owner.on('focus',focused);owner.on('blur',blurred);
  shell.focus=function(...args){const event={at:Date.now(),case:active?.id??null,before:snapshot(),after:null};focusCalls.push(event);try{return oldFocus.apply(this,args);}finally{event.after=snapshot();flush();}};
  E.dialog.showSaveDialog=async function(...args){
    const plan=plans[rows.length];if(!plan||args.length!==2||args[0]!==owner||owner.isDestroyed()||shell.isDestroyed()||owner.getTitle()!==title)throw Error('Unexpected native Save owner');
    const opts=args[1];if(opts.title!=='保存附件'||opts.buttonLabel!=='保存附件'||P.basename(opts.defaultPath)!==expectedName)throw Error('Not original attachment Save control');
    if(!owner.isFocused())throw Error('Original owner must be foreground when opening the native panel');
    const dir=P.dirname(plan.path),canonical=fs.realpathSync.native(dir);if(canonical!==dir||dir!==P.join(root,'artifacts',plan.id)||fs.readdirSync(dir).length)throw Error('private target not fresh');
    active=plan;const row={id:plan.id,kind:'save',at:Date.now(),ownerAtInvocation:snapshot(),title:opts.title,defaultFileName:P.basename(opts.defaultPath),controlledFinderDelivery:plan.background};rows.push(row);flush();
    try{
      const returned=await old.apply(this,args);const rawAt=Date.now();const returnedPath=returned.filePath?P.join(fs.realpathSync.native(P.dirname(returned.filePath)),P.basename(returned.filePath)):null;
      row.originalNativeReturn={canceled:returned.canceled,pathMatches:returnedPath===plan.path,emptyCanceledSelection:!returned.filePath,at:rawAt,owner:snapshot(),...(returnedPath===plan.path?{rawPath:returned.filePath,canonicalPath:returnedPath}:{}),...((returned.canceled&&!returned.filePath)||returnedPath===plan.path?{rawReturn:returned}:{selectionOutsidePrivateScope:true})};flush();
      if(returned.canceled!==plan.cancel||(!returned.canceled&&returnedPath!==plan.path))throw Error('Native action or path outside declared private case; write refused');
      if(!returned.canceled){if(fs.realpathSync.native(dir)!==dir||fs.existsSync(plan.path)||fs.readdirSync(dir).length)throw Error('private output changed before save');}
      if(plan.background){
       const end=Date.now()+240000;
       for(;;){if(fs.existsSync(plan.gate)){const gate=JSON.parse(fs.readFileSync(plan.gate,'utf8'));if(gate.nonce!==plan.nonce||gate.id!==plan.id||gate.front!=='finder')throw Error('Wrong observed Finder release identity');if(owner.isDestroyed()||shell.isDestroyed()||owner.isFocused())throw Error('Finder release requires original owner actually unfocused');row.gate={finderObservation:gate.frontProof,receivedAt:Date.now()};break;}if(Date.now()>=end)throw Error('Timed out waiting for independent Finder handoff');await new Promise(r=>setTimeout(r,120));}
      }
      row.delivery={at:Date.now(),owner:snapshot(),originalReturnUnchanged:true};flush();return returned;
    }catch(e){row.error=String(e.message);row.errorAt=Date.now();flush();throw e;}
  };
  globalThis.__b08OwnObserver={restore(){E.dialog.showSaveDialog=old;shell.focus=oldFocus;owner.off('focus',focused);owner.off('blur',blurred);},finishCase(){active=null;return true;}};flush();return true;
 },ownerId,shellId,title,plans,nativeFile,root,name);
}
async function raw(){return JSON.parse(await readFile(nativeFile,'utf8'));}
async function checkCase(plan){
 const pre=await verifyPath(root,plan.id,plan.path),focusBefore=await foreground(plan.id);
 const clickedAfter=Date.now();await click('dialog .m10-save-controls>button','保存附件',plan);
 const opened=await until(async()=>{const x=(await raw()).rows[plan.i];if(x?.error)throw Error(x.error);return x;},'original native dialog invocation');
 assert.equal(opened.id,plan.id);assert(opened.at>=clickedAfter&&opened.ownerAtInvocation.id===ownerId&&opened.ownerAtInvocation.shellId===shellId&&opened.ownerAtInvocation.title===title&&opened.ownerAtInvocation.focused&&opened.ownerAtInvocation.visible);assert.equal(opened.defaultFileName,name);
 const hand={stage:'native-user-action',root,pid:app.processId,windowTitle:title,ownerId,shellId,case:plan.id,sequence:plan.i+1,dialogTitle:'保存附件',nativeExpected:plan.cancel?'取消':'保存附件',directory:pre.dir,filename:name,expectedPath:plan.path,thenFinder:plan.background,instruction:plan.cancel?'在本轮“保存附件”的真实 macOS 系统框点击取消。':`本轮“保存附件”真实 macOS 系统框中按 ⌘⇧G，进入 ${pre.dir}，保留 ${name} 文件名，点击保存附件。如有覆盖提示或路径不符，请取消。`};
 hand.instruction+=plan.background?' 随即切换 Finder 并停留，等待下一步提示。':' 保持本轮 WillYou 前台，等待下一步提示。';await progress(hand);
 const settled=await until(async()=>{const x=(await raw()).rows[plan.i];if(x?.error)throw Error(x.error);return x?.originalNativeReturn?x:null;},'actual native OS return '+plan.id,300000);
 assert.equal(settled.originalNativeReturn.canceled,plan.cancel);assert(plan.cancel?settled.originalNativeReturn.emptyCanceledSelection:settled.originalNativeReturn.pathMatches);
 if(plan.background){
  await progress({...hand,stage:'await-finder',instruction:'原生系统框已真正返回。请切换 Finder 并保持前台，等待本轮实际结果。'});
  const frontProof=await until(()=>continuousFront('finder',1200,settled.originalNativeReturn.at),'actual Finder front after real native callback',220000);
  const state=await own();assert.equal(state.focused,false);assert.equal(state.id,ownerId);assert.equal(state.wcId,shellId);
  const release={id:plan.id,nonce:plan.nonce,front:'finder',frontProof,ownerStateBeforeRelease:state,at:Date.now()};
  const temp=plan.gate+'.tmp';await writeFile(temp,JSON.stringify(release),{mode:0o600,flag:'wx'});await rename(temp,plan.gate);
 }
 const delivered=await until(async()=>{const x=(await raw()).rows[plan.i];if(x?.error)throw Error(x.error);return x?.delivery?x:null;},'actual native result delivered to original business controller',15000);
 assert.equal(delivered.delivery.owner.id,ownerId);assert.equal(delivered.delivery.owner.shellId,shellId);assert.equal(delivered.delivery.owner.focused,!plan.background);assert(delivered.delivery.originalReturnUnchanged);
 const status=plan.cancel?'已取消 · 已取消附件保存':'已保存 · 附件已保存';
 await until(()=>app.evaluate(js(text=>{const controls=document.querySelector('dialog .m10-save-controls');return controls&&[...controls.querySelectorAll(':scope>button')].some(b=>b.textContent==='保存附件'&&!b.disabled)&&controls.querySelector('[role=status]')?.textContent?.includes(text)&&!controls.querySelector('[role=alert]');},status)),'actual UI terminal receipt '+plan.id,30000);
 const final=await own();assert.equal(final.id,ownerId);assert.equal(final.wcId,shellId);assert.equal(final.focused,!plan.background);assert(final.visible);
 let actualArtifact=null;const dir=dirname(plan.path),list=await readdir(dir);
 if(plan.cancel){assert.deepEqual(list,[]);assert(!await exists(plan.path));}
 else{assert.deepEqual(list,[name]);const st=await lstat(plan.path);assert(st.isFile()&&!st.isSymbolicLink()&&st.size===bytes.length);assert.equal(await realpath(plan.path),plan.path);assert.deepEqual(await readFile(plan.path),bytes);actualArtifact={path:plan.path,bytes:st.size,sha:await digest(plan.path)};}
 const history=unwrap(await app.invoke('applications.attachmentSaveHistory',project.id));
 assert.equal(history.length,plans.slice(0,plan.i+1).filter(p=>!p.cancel).length);assert(history.every(r=>r.state==='saved'&&!r.cleanupPending&&r.size===bytes.length&&r.contentHash===bytesHash));
 if(!plan.cancel){const record=history.find(r=>r.path===plan.path);assert(record&&record.filename===name);}
 await app.screenshot(join(root,plan.id+'.png'));
 const postFront=await until(()=>continuousFront(plan.background?'finder':'own',1200,delivered.delivery.at),'post-delivery real native foreground '+plan.id,8000);
 if(plan.background){const timeline=frontRows.filter(r=>r.at>=delivered.gate.finderObservation.from&&r.at<=postFront.to);assert(timeline.length>=10&&timeline.every(r=>r.front==='finder'),'Finder must stay front throughout callback and actual UI/file settlement');}
 else{const timeline=frontRows.filter(r=>r.at>=delivered.originalNativeReturn.at&&r.at<=postFront.to);assert(timeline.length>=5&&timeline.every(r=>r.front==='own'));}
 const observed=await raw(),calls=observed.focusCalls.filter(x=>x.case===plan.id&&x.at>=delivered.delivery.at);assert.equal(calls.length,plan.background?0:1,'Actual product shell focus call count');
 if(!plan.background){assert(calls[0].before.focused&&calls[0].after.shellFocused);assert(final.shellFocused);assert(await app.evaluate('document.hasFocus()'));}
 else assert.equal(await app.evaluate('document.hasFocus()'),false);
 result.checks.push({id:plan.id,passed:true,focusBefore,opened,settled:delivered,focusCalls:calls,final,postFront,actualArtifact,historyCount:history.length,actualUiReceipt:status,nativeOperator:'physical-user-handoff',controlledFinderDelivery:plan.background});
 result.nativeRows=observed.rows;await main(()=>globalThis.__b08OwnObserver.finishCase());await progress({stage:'case-passed',root,case:plan.id,completed:result.checks.length,total:plans.length});
}
try{
 await start();
 project=await app.invoke('projects.create',{name:'M16 B08 isolated attachments',aliases:[],description:'synthetic only',rulesPath:null},[{label:'fixture source',path:projectDir}]);assert(project?.id);
 let mail=unwrap(await app.invoke('applications.catalog')).find(x=>x.appId==='mail');assert(mail);
 if(!mail.added){unwrap(await app.invoke('applications.setAdded','mail',true,mail.revision));mail=unwrap(await app.invoke('applications.catalog')).find(x=>x.appId==='mail');}
 if(!mail.enabled)unwrap(await app.invoke('applications.setEnabled','mail',true,mail.revision));
 const selection=unwrap(await app.invoke('applications.projectSettings',project.id,'mail'));
 if(!selection.enabled)unwrap(await app.invoke('applications.select',{projectId:project.id,appId:'mail',enabled:true,expectedRevision:selection.revision,connections:{foxmail:null,smtp:null}}));
 const current=unwrap(await app.invoke('applications.projectSettings',project.id,'mail'));assert(current.enabled);assert(Object.values(current.connections).every(v=>v===null));
 result.project={id:project.id,selection:current};result.bootstrap=await normalQuit();await save();
 const devInterpreter=await realpath(join(repo,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'));assert(/^\/Users\/liubu\/hx\/4\.uprxiao\/SmartDD\/node_modules\/\.pnpm\/electron@42\.11\.14\/node_modules\/electron\/dist\/Electron\.app\/Contents\/MacOS\/Electron$/.test(devInterpreter));
 const helper=join(support,'fixture.cjs');result.fixtureSha=await digest(helper);
 const fixture=JSON.parse(execFileSync(devInterpreter,[helper,data,project.id,String(result.bootstrap.pid),result.bootstrap.dbSha,nativePin],{env:{...env,PATH:process.env.PATH,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:join(repo,'node_modules')},encoding:'utf8',timeout:30000,maxBuffer:100000}).trim().split('\n').at(-1));assert.equal(fixture.projectId,project.id);assert.equal(fixture.hash,bytesHash);assert.equal(fixture.bytes,bytes.length);assert.throws(()=>process.kill(fixture.pid,0),{code:'ESRCH'});result.fixture=fixture;
 assert(!await exists(join(data,'smartdd.db-wal')));result.seedDbSha=await digest(join(data,'smartdd.db'));
 // Preserve the exact private bootstrap-generated CLI directories; resume with empty new private scope.
 result.bootstrapCliPreserved={codex:await readdir(join(cli,'.codex')),claude:await readdir(join(cli,'.claude'))};await rename(cli,join(root,'cli-bootstrap-retained'));await mkdir(join(cli,'.codex'),{recursive:true,mode:0o700});await mkdir(join(cli,'.claude'),{recursive:true,mode:0o700});await save();
 await start({dbSha:result.seedDbSha,bootstrapPid:result.bootstrap.pid});observeFront();await foreground('draft-navigation');await selectProject();await installNativeObserver();
 for(const plan of plans)await checkCase(plan);
 result.nativeObserver=await raw();assert.equal(result.nativeObserver.rows.length,plans.length);assert.deepEqual(app.rendererErrors,[]);await main(()=>{globalThis.__b08OwnObserver.restore();return true;});
 finished=true;await stopFront();
 result.final=await normalQuit();const db=join(data,'smartdd.db');
 result.persistedCounts=JSON.parse(execFileSync('/usr/bin/sqlite3',['-readonly','-json',db,"SELECT (SELECT count(*) FROM app_secrets) AS secrets,(SELECT count(*) FROM mail_send_intents) AS sends,(SELECT count(*) FROM mail_drafts) AS drafts,(SELECT count(*) FROM mail_attachment_objects) AS attachments"],{encoding:'utf8',timeout:5000}))[0];assert.deepEqual(result.persistedCounts,{secrets:0,sends:0,drafts:1,attachments:1});
 result.integrity=execFileSync('/usr/bin/sqlite3',['-readonly',db,'PRAGMA integrity_check;'],{encoding:'utf8',timeout:5000}).trim();assert.equal(result.integrity,'ok');await verifyPackage([bundle,pin,nativePin,filesPin]);
 result.status=plans.length===4?'four-actual-native-attachment-subcases-pass':'selected-actual-native-attachment-subcases-pass';
}catch(error){result.status='failed-or-blocked';result.error=String(error.stack??error);result.startupDiagnostic=error.electronStartupDiagnostic??null;if(app){try{const rows=await raw();result.nativeObserver=rows;if(rows.rows.every(x=>x.delivery||x.error))await app.screenshot(join(root,'failure.png'));}catch{}}process.exitCode=1;}
finally{
 finished=true;await stopFront();
 if(app){try{result.failureCleanup=await normalQuit();}catch(e){result.cleanupError=String(e);await app?.close().catch(()=>{});}}
 result.finishedAt=Date.now();await progress({stage:'finished',root,status:result.status,checks:result.checks.map(x=>x.id),error:result.error,resultFile:join(root,'result.json')});
}
