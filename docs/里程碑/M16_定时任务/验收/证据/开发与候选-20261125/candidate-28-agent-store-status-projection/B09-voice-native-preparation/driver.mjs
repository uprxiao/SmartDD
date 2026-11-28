// B09.5 native keyboard/voice recorder subsection. Uses only an isolated packaged shell.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { openElectron, pause } from '../b09-recovery/isolated-electron.mjs';
import { repo, newBundle, newPin, newNative, expectedArgs, verifyPins, verifySideRoot, digest } from '../b09-recovery/guards.mjs';

assert.equal(process.cwd(), repo);
assert(process.platform === 'darwin' && process.arch === 'arm64');
assert.equal(process.argv.length, 3);
assert.equal(process.argv[2], '--coordinator-authorized-b09-voice-native');
const pins = await verifyPins(expectedArgs);
const observer = join(repo, 'release/m16-qa-support/b08-recovery/front-observer');
assert.equal(await realpath(observer), observer);
const observerSha = await digest(observer);
assert.equal(observerSha, 'b5c0805b46f25476bfacb665e884f67f3c993df16d68a03a26132f1ddab786fe');
const root = await mkdtemp('/private/tmp/willyou-m16-b09-c28-side-');
const home = join(root, 'home'), cliHome = join(root, 'cli-home'), userData = join(root, 'data');
for (const dir of [home, cliHome, userData, join(home, '.config'), join(cliHome, '.codex'), join(cliHome, '.claude')]) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}
await verifySideRoot(root);
const out = join(root, 'voice-evidence'); await mkdir(out, { mode: 0o700 });
const exe = join(newBundle, 'Contents/MacOS/WillYou');
const title = 'WillYou · M16 B09 语音快捷键测试 ' + root.split('-').at(-1);
const report = { schema: 'M16-B09.5-C28-native-voice-subsection', root, title, pins, observerSha,
  scope: 'Actual native keyboard and voice recorder self-contained subsection. No microphone, audio, external login, background page operation or global shortcut persistence.',
  steps: [], front: [], screenshots: [], status: 'preparing' };
const persist = async () => writeFile(join(out, 'result.json'), JSON.stringify(report, null, 2)+'\n', { mode: 0o600 });
const progress = async (stage, detail = {}) => {
  const row={stage, root, out, title, at:Date.now(), ...detail};
  await writeFile(join(out, 'progress.json'), JSON.stringify(row,null,2)+'\n', {mode:0o600});
  report.steps.push(row); await persist(); console.log(JSON.stringify(row));
};
const envAllowed = new Set(['PATH','TMPDIR','LANG','LC_ALL','USER','LOGNAME','SHELL']);
for (const key of Object.keys(process.env)) if (!envAllowed.has(key)) delete process.env[key];
const server=createServer((_req,res)=>res.writeHead(403).end());
await new Promise((resolve,reject)=>{server.once('error',reject); server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;
let app, frontProcess, rootId, shellId, frontEver = false;
const js = (fn, ...args) => { const src='('+fn.toString()+')(...'+JSON.stringify(args)+')'; new Function('return '+src); return src; };
async function until(fn, label, timeoutMs=10000) {
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){const v=await fn();if(v)return v;await pause(100);}
  throw Error('Timeout: '+label);
}
function main(fn,...args){
  return app.mainEvaluate(js((pid,path,data,ownHome,ownCli,source,args)=>{
    const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');
    if(process.pid!==pid||process.execPath!==path||E.app.getPath('userData')!==data||process.env.HOME!==ownHome||process.env.SMARTDD_CLI_HOME!==ownCli||!E.app.commandLine.hasSwitch('use-mock-keychain'))throw Error('isolated candidate mismatch');
    return (0,eval)('('+source+')')(E,...args);
  },app.processId,exe,userData,home,cliHome,fn.toString(),args),{label:'B09.5 own native observation'});
}
async function windowState(){
  const s=await main(E=>{
    const ws=E.BaseWindow.getAllWindows().filter(w=>!w.isDestroyed());
    if(ws.length!==1)throw Error('unique owned BaseWindow required');
    const w=ws[0];const views=w.contentView.children.filter(v=>v.webContents&&!v.webContents.isDestroyed()).map(v=>({id:v.webContents.id, trusted:v.webContents.getURL().startsWith('file:')&&v.webContents.getURL().includes('/out/renderer/index.html'),visible:v.getVisible?.()!==false,bounds:v.getBounds(),focused:v.webContents.isFocused()}));
    const shells=views.filter(v=>v.trusted);if(shells.length!==1)throw Error('unique owned trusted shell required');
    return {rootId:w.id,shellId:shells[0].id,visible:w.isVisible(),minimized:w.isMinimized(),focused:w.isFocused(),shellFocused:shells[0].focused,title:w.getTitle(),views};
  });
  if(rootId!==undefined) assert(s.rootId===rootId&&s.shellId===shellId,'root/shell changed');
  return s;
}
function launchObserver(){
  frontProcess=spawn(observer,[String(app.processId),exe],{stdio:['ignore','pipe','ignore']});let rest='';
  frontProcess.stdout.on('data',b=>{rest+=b.toString('utf8');let ix;while((ix=rest.indexOf('\n'))>=0){const line=rest.slice(0,ix);rest=rest.slice(ix+1);try{const v=JSON.parse(line);if(v.front==='own'&&v.pid===app.processId)frontEver=true;report.front.push({at:v.at,own:v.front==='own'&&v.pid===app.processId});}catch{}}});
}
function recentOwn(ms=3000){
  const now=Date.now(), recent=report.front.filter(s=>s.at>=now-ms-150);
  return recent.length>=Math.floor(ms/150)&&recent.at(-1).at>=now-350&&recent[0].at<=now-ms+350&&recent.every(s=>s.own);
}
async function requireFront(){
  assert(frontEver&&recentOwn(500),'actual isolated App is no longer foreground');
  const s=await windowState(); assert(s.visible&&!s.minimized&&s.focused&&s.shellFocused&&s.title===title,'native owner/shell lost focus');
  return s;
}
async function state(){return app.evaluate(`(()=>{const e=document.querySelector('[data-voice-shortcut-recording]'),b=document.querySelector('.voice-key-editor button');return {exists:!!e,busy:e?.dataset.voiceShortcutRecording==='true',focus:document.activeElement===e,documentFocus:document.hasFocus(),value:e?.value??null,button:b?.textContent.trim()??null,hint:document.querySelector('#voice-record-hint')?.textContent.trim()??null,sidebarCollapsed:document.querySelector('.app')?.classList.contains('sidebar-collapsed')??null}})()`);}
async function click(selector,text=null,front=false){
  const point=()=>app.evaluate(js((q,label)=>{const els=[...document.querySelectorAll(q)].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.matches(':disabled')&&(label===null||e.textContent.trim()===label);});if(els.length!==1)return null;const e=els[0];e.scrollIntoView({behavior:'instant',block:'nearest'});const r=e.getBoundingClientRect(),x=Math.floor(r.x+r.width/2),y=Math.floor(r.y+r.height/2);return e.contains(document.elementFromPoint(x,y))?{x,y}:null;},selector,text));
  const at=await until(point,'unique laid-out '+selector+':'+text); await pause(100); assert.deepEqual(await point(),at);
  const s=front?await requireFront():await windowState();assert(s.visible&&!s.minimized&&s.title===title);
  const si=s.views.findIndex(v=>v.id===shellId);assert(si>=0);
  assert(!s.views.slice(si+1).some(v=>v.visible&&at.x>=v.bounds.x&&at.x<v.bounds.x+v.bounds.width&&at.y>=v.bounds.y&&at.y<v.bounds.y+v.bounds.height),'native occlusion');
  assert.deepEqual(await point(),at);for(const type of ['mouseMoved','mousePressed','mouseReleased']) await app.cdp('Input.dispatchMouseEvent',{type,...at,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});
  report.steps.push({kind:'private-real-UI-click',selector,text,at:Date.now(),point:at});
}
async function shot(label){const file=join(out,label+'.png');await app.screenshot(file);report.screenshots.push({label,file,sha:await digest(file)});await persist();}
async function focusedUntil(fn,label,timeout){return until(async()=>{await requireFront();return fn();},label,timeout);}
async function prepareRecording(label){
  const before=await state(); assert(before.exists&&!before.busy&&before.button==='录制');await requireFront();
  const clickedAt=Date.now();await click('.voice-key-editor button','录制',true);
  const busy=await focusedUntil(async()=>{const s=await state();return s.busy&&s.focus&&s.documentFocus&&s.button==='取消'&&s.hint?.includes('Esc')?s:null;},'actual recording input active',8000);
  await shot(label+'-recording');return {before,busy,clickedAt};
}
async function persistedVoice(){
  const value=await app.invoke('voice.inspect');const s=value.settings;
  return {enabled:s.enabled,globalEnabled:s.globalEnabled,globalShortcut:s.globalShortcut,shortcutOverride:s.shortcutOverride??null};
}
async function normalExit(){
  if(!app)return;const live=app;let requestError=null;
  try{await main(E=>{setTimeout(()=>E.app.quit(),50);return true;});}catch(e){requestError=String(e);}
  try{report.exit=await live.waitForExit(15000);assert.equal(report.exit.code,0);assert.equal(report.exit.signal,null);if(requestError)report.quitRequestError=requestError;}
  finally{await live.close();app=null;}
}
try{
  await progress('starting');
  app=await openElectron({userData,executable:exe,cwd:root,env:{HOME:home,SMARTDD_CLI_HOME:cliHome,CODEX_HOME:join(cliHome,'.codex'),CLAUDE_CONFIG_DIR:join(cliHome,'.claude'),XDG_CONFIG_HOME:join(home,'.config'),HTTP_PROXY:origin,HTTPS_PROXY:origin,ALL_PROXY:origin,NO_PROXY:'127.0.0.1,localhost'},inspectMain:true,mockKeychainFixture:true,candidatePin:newPin,nativePin:newNative});
  report.pid=app.processId;report.baselinePersisted=await persistedVoice();assert(!report.baselinePersisted.globalEnabled,'fixture expected default global disabled');
  const ws=await windowState();rootId=ws.rootId;shellId=ws.shellId;
  const named=await main((E,id,trustedId,label)=>{const w=E.BaseWindow.fromId(id);if(!w||w.isDestroyed()||!w.contentView.children.some(v=>v.webContents?.id===trustedId))throw Error('root/shell disappeared');w.setTitle(label);return w.getTitle();},rootId,shellId,title);assert.equal(named,title);
  launchObserver();
  await click('[data-testid=nav-settings]'); await click('.settings-nav button','语音输入');
  await until(async()=> (await state()).exists,'actual voice settings visible');
  const toggle=await app.evaluate(`document.querySelector('button[aria-label="启用全局唤起"]')?.getAttribute('aria-checked')`);assert.equal(toggle,'false');
  await click('button[aria-label="启用全局唤起"]');
  const ready=await until(async()=>{const s=await state();return s.exists&&s.button==='录制'&&s.value===report.baselinePersisted.globalShortcut?s:null;},'unsaved draft enabled');
  await shot('ready');await progress('await-native-front',{pid:app.processId,ready,deadline:Date.now()+240000});
  await until(async()=>{if(!recentOwn())return null;const s=await windowState();return s.focused&&s.shellFocused&&s.visible&&!s.minimized?s:null;},'user exact foreground 3 seconds',240000);
  const a=await prepareRecording('capture'); await progress('await-native-capture',{instruction:'按一次 ⌘B，等按钮恢复为录制，保持测试窗前台。'});
  const captured=await focusedUntil(async()=>{const s=await state();return !s.busy?s:null;},'native recording completed',55000);
  assert.equal(captured.value,'Command+B');assert.equal(captured.sidebarCollapsed,a.before.sidebarCollapsed,'menu accelerator escaped while recording');
  report.capture={before:a,captured}; await shot('capture-completed');await progress('await-native-menu-after-capture',{instruction:'等录制结束2秒，按第二次 ⌘B，保持前台。'});
  const afterCaptureMenu=await focusedUntil(async()=>{const s=await state();return s.sidebarCollapsed!==captured.sidebarCollapsed?s:null;},'native menu restored after capture',45000);
  report.capture.menuRestored=afterCaptureMenu;await shot('capture-menu-restored');
  const b=await prepareRecording('cancel');await progress('await-native-cancel',{instruction:'看到正在录制后按 Esc；待按钮恢复为录制2秒，再按一次 ⌘B。'});
  const canceled=await focusedUntil(async()=>{const s=await state();return !s.busy?s:null;},'native Escape cancels recorder',55000);
  assert.equal(canceled.value,b.before.value);assert.equal(canceled.sidebarCollapsed,b.before.sidebarCollapsed);
  report.cancel={before:b,canceled};await shot('cancel-completed');await progress('await-native-menu-after-cancel');
  const afterCancelMenu=await focusedUntil(async()=>{const s=await state();return s.sidebarCollapsed!==canceled.sidebarCollapsed?s:null;},'native menu restored after Escape',45000);
  report.cancel.menuRestored=afterCancelMenu;await shot('cancel-menu-restored');
  const c=await prepareRecording('timeout');await progress('await-real-60s-timeout',{instruction:'保持测试窗前台，至少60秒，请勿点击、按键或切换。出现录制已超时后再按一次 ⌘B。',startedAt:c.clickedAt});
  const timedOut=await focusedUntil(async()=>{const s=await state();return !s.busy?s:null;},'actual recording timeout',70000);
  const elapsed=Date.now()-c.clickedAt;assert(elapsed>=59500&&elapsed<=70000);assert(timedOut.hint.includes('录制已超时'));assert.equal(timedOut.value,c.before.value);assert.equal(timedOut.sidebarCollapsed,c.before.sidebarCollapsed);
  report.timeout={before:c,timedOut,elapsedMs:elapsed};await shot('timeout-completed');await progress('await-native-menu-after-timeout');
  const afterTimeoutMenu=await focusedUntil(async()=>{const s=await state();return s.sidebarCollapsed!==timedOut.sidebarCollapsed?s:null;},'native menu restored after timeout',45000);
  report.timeout.menuRestored=afterTimeoutMenu;await shot('timeout-menu-restored');
  await click('.voice-save button','撤销更改',true);await until(async()=>{const s=await state();return !s.busy&&s.value===report.baselinePersisted.globalShortcut?s:null;},'real discard draft');
  report.finalPersisted=await persistedVoice();assert.deepEqual(report.finalPersisted,report.baselinePersisted);await shot('draft-reverted');report.status='native-voice-subsection-pass';
}catch(e){report.status='native-voice-subsection-incomplete-or-failed';report.error=String(e.stack??e);if(app)try{await shot('failure');}catch{}}
finally{
  if(frontProcess){
    const exited=new Promise(resolve=>frontProcess.once('exit',(code,signal)=>resolve({code,signal})));
    if(frontProcess.exitCode===null&&frontProcess.signalCode===null)frontProcess.kill('SIGTERM');
    report.observerExit=frontProcess.exitCode!==null||frontProcess.signalCode!==null?{code:frontProcess.exitCode,signal:frontProcess.signalCode}:await Promise.race([exited,pause(2000).then(()=>({timeout:true}))]);
  }
  if(app)try{await normalExit();}catch(e){report.cleanupError=String(e);report.status='native-voice-subsection-incomplete-or-failed';}
  await new Promise(resolve=>server.close(resolve));await progress('finished',{status:report.status});
}
if(report.status!=='native-voice-subsection-pass')process.exitCode=1;
