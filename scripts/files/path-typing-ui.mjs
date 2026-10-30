// Y34 independent keyboard part. Real voice/user Enter remain a separate gap.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {openTaskFileFixture} from '../lib/task-file-fixture.mjs';
import {dragElectronElement} from '../lib/electron-drag.mjs';
import {pause} from '../lib/electron-harness.mjs';
import {installPtyWriteObserver,observePtyWrites,restorePtyWriteObserver} from '../lib/pty-write-observer.mjs';
import {installTerminalRpcObserver,observeTerminalRpcs,restoreTerminalRpcObserver} from '../lib/terminal-rpc-observer.mjs';
const executable=process.env.WILLYOU_FILES_APP;assert(executable);
const scratch=await mkdtemp('/private/tmp/willyou-path-typing-A-'),root=join(scratch,'中文 空格🙂()');await mkdir(root);
const files={'ordinary.txt':'Ordinary source unchanged\n','中文 空格🙂\'"();`$().txt':'Unicode source unchanged\n'};
for(const [name,text]of Object.entries(files))await writeFile(join(root,name),text);
const sha=value=>createHash('sha256').update(value).digest('hex'),fingerprint=async()=>Object.fromEntries(await Promise.all(Object.keys(files).map(async name=>{const p=join(root,name),s=await stat(p,{bigint:true});return[name,{hash:sha(await readFile(p)),inode:String(s.ino),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)}];})));
const r={at:new Date().toISOString(),caseId:'M9-T-Y34',layer:'A keyboard partial',scratch,root,before:await fingerprint(),checks:[],status:'running',asarSha256:sha(await readFile(resolve(executable,'../../Resources/app.asar'))),boundary:'Normal packaged App/private root and userData. Real zsh -d in isolated HOME/ZDOTDIR; original node-pty spawn/write and authenticated file RPC only passively observed. Explicit Ctrl-X/Ctrl-T captures actual ZLE BUFFER/CURSOR plus completion sequence without accept/eval. Chinese strings use CDP text input,not system IME; ASCII j is a trusted browser key input. Original Chromium pointer drag payload,not physical OS drag. No Enter,voice/model,clipboard,Store/editor/DOM value mutation or daily data. Does not complete whole Y34.'};
let fixture,app,ptyInstalled=false,rpcInstalled=false,stage='setup',expected='',sequence=0;
const poll=async(fn,label)=>{const end=Date.now()+12000;for(;;){const value=await fn();if(value)return value;assert(Date.now()<end,label);await pause(20);}};
try{
 fixture=await openTaskFileFixture({executable,scratch,root,name:'A · Y34 real input preserved / keyboard',taskPrograms:{T1:{receiverScript:'scripts/files/path-typing-target.py'}},beforeTasks:async({app})=>{await installPtyWriteObserver(app);ptyInstalled=true;await installTerminalRpcObserver(app);rpcInstalled=true;}});
 app=fixture.app;r.appPid=app.processId;await fixture.show('T2');await fixture.show('T1');await app.cdp('Page.bringToFront');assert(await app.evaluate('document.hasFocus()'));
 const terminal=()=>fixture.terminal(fixture.tasks.T1),target=()=>terminal()+' .xterm-screen',trace=()=>observeTerminalRpcs(app),writes=()=>observePtyWrites(app);
 const own=async()=>{const meta=await readFile(join(scratch,'T1/target.json'),'utf8').then(JSON.parse).catch(()=>null);return meta?(await writes()).find(x=>x.pid===meta.pid):null;};
 await poll(async()=>{const row=await own();return row?.output.includes('CTX_ZSH_READY> ');},'Actual zsh prompt');
 r.ptyBefore=await own();if(r.ptyBefore.writes.length){r.uncontrolledInitialInput={writeCount:r.ptyBefore.writes.length,sha256:sha(Buffer.concat(r.ptyBefore.writes.map(x=>Buffer.from(x.hex,'hex'))))};throw Error('Fixture already contains uncontrolled input before acceptance; leave this run unaccepted.');}r.taskBefore=await app.invoke('tasks.get',fixture.tasks.T1.task.id);r.t2Before=await poll(()=>fixture.receiver('T2').catch(()=>null),'T2 receiver ready');
 const focused=async()=>{const value=await app.evaluate('document.activeElement?.matches(".xterm-helper-textarea")&&!!document.activeElement.closest('+JSON.stringify(terminal())+')');assert(value,'Drop must return input focus to this original task terminal');};
 const capture=async text=>{
  await focused();const prior=await own(),oldSequence=sequence;await app.key('x','KeyX',2);await app.key('t','KeyT',2);
  const result=await poll(async()=>{try{const seq=Number(await readFile(join(scratch,'T1/zle-sequence.txt'),'utf8'));if(seq<=oldSequence)return null;const buffer=await readFile(join(scratch,'T1/zle-buffer.txt'),'utf8'),cursor=Number(await readFile(join(scratch,'T1/zle-cursor.txt'),'utf8'));return buffer===text&&cursor===Array.from(text).length?{sequence:seq,buffer,cursor}:null;}catch{return null;}},'Actual ZLE buffer and cursor after '+stage);
  sequence=result.sequence;const after=await own();assert.equal(after.writes.length,prior.writes.length+2);assert.deepEqual(after.writes.slice(-2).map(x=>x.hex),['18','14']);return result;
 };
 const double=async selector=>{const point=await app.evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+'),b=e.getBoundingClientRect();return{x:b.x+Math.min(20,b.width/2),y:b.y+b.height/2}})()');for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:2});};
 for(const theme of ['light','dark']){
  await app.invoke('appSettings.update','theme','y'+theme);
  for(const source of ['tree','tab'])for(const name of Object.keys(files)){
   stage=theme+':'+source+':'+name;const tab='.fw-tab:has([role=tab][title='+JSON.stringify(join(root,name))+'])';
   if(source==='tab'){await app.open(name);await double(tab+' [role=tab]');await app.waitFor('!document.querySelector('+JSON.stringify(tab)+')?.classList.contains("preview")');}
   await app.click(target());const prefix=process.env.WILLYOU_PATH_TYPING_PREFIX_BOUNDARIES==='1'?['请阅读文件',' 接着阅读文件 ',' 保留两个空格  ','🙂请再核对'][r.checks.length%4]:(expected?' 接着阅读文件 ':'请阅读文件 ');await app.cdp('Input.insertText',{text:prefix});expected+=prefix;const before=await capture(expected),beforeRow=await own(),rpcBefore=(await trace()).rows.filter(x=>x.method==='terminalInsert').length;
   const drag=await dragElectronElement(app,source==='tree'?app.tree(name):tab,target());const completion=await poll(async()=>{const rows=(await trace()).rows.filter(x=>x.method==='terminalInsert');return rows.length===rpcBefore+1&&rows.at(-1).deliveredAt?rows.at(-1):null;},'Original exact path receipt');assert.equal(completion.output.state,'inserted');assert.equal(completion.output.characters,join(root,name).length+1);assert.equal(completion.before,completion.after);
   expected+=join(root,name)+' ';const afterDrop=await capture(expected),afterRow=await own();const pathWrite=afterRow.writes.slice(beforeRow.writes.length).filter(x=>!['18','14'].includes(x.hex));assert.equal(pathWrite.length,1);assert.equal(pathWrite[0].hex,Buffer.from(join(root,name)+' ').toString('hex'));
   // No extra click/focus call: following text and an actual printable key must
   // reach the terminal which the drop handler focused.
   await focused();await app.cdp('Input.insertText',{text:'请总结'});expected+='请总结';const afterText=await capture(expected);
   for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'j',code:'KeyJ',windowsVirtualKeyCode:74,...(type==='keyDown'?{text:'j',unmodifiedText:'j'}:{})});expected+='j';const afterKey=await capture(expected);
   const actual=await own();assert(!actual.exited);assert.equal(actual.pid,r.ptyBefore.pid);assert(actual.writes.every(x=>x.returned&&x.before===x.after&&!Buffer.from(x.hex,'hex').includes(13)&&!Buffer.from(x.hex,'hex').includes(10)));const task=await app.invoke('tasks.get',fixture.tasks.T1.task.id);assert.equal(task.ptyId,r.taskBefore.ptyId);const other=await fixture.receiver('T2');assert.equal(other.rawHex,r.t2Before.rawHex);assert.equal(other.executedCommands,0);
   r.checks.push({theme,source,name,before,drag,completion,afterDrop,afterText,afterKey,actualPathWrite:pathWrite[0],sameOriginalPTY:true,noAutomaticEnter:true,otherTaskUnchanged:true,pass:true});await writeFile(join(scratch,'partial.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({progress:stage,checks:r.checks.length}));
  }
  await app.screenshot(join(scratch,theme+'-typing.png'));
 }
 r.terminalRpcs=await trace();r.ptyFinal=await writes();r.after=await fingerprint();assert.deepEqual(r.after,r.before);r.expected=expected;r.rendererErrors=app.rendererErrors;assert.deepEqual(r.rendererErrors,[]);r.rpcRestored=await restoreTerminalRpcObserver(app);rpcInstalled=false;assert(Object.values(r.rpcRestored).every(Boolean));r.ptyRestored=await restorePtyWriteObserver(app);ptyInstalled=false;assert(r.ptyRestored.spawn&&r.ptyRestored.terminals.every(Boolean));
 for(const task of Object.values(fixture.tasks))await app.invoke('tasks.kill',task.task.id);await app.mainEvaluate('(()=>{const e=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");setTimeout(()=>e.app.quit(),30);return true})()');r.exit=await app.waitForExit(20000);assert.equal(r.exit.code,0);assert.equal(r.exit.signal,null);r.status='passed-keyboard-partial';
}catch(error){r.status='failed';r.stage=stage;r.error=String(error);r.stack=error.stack;process.exitCode=1;if(app)try{r.terminalRpcs=await observeTerminalRpcs(app);r.ptyFinal=await observePtyWrites(app);r.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(scratch,'failure.png'));}catch{}}
finally{if(app){if(rpcInstalled)try{r.cleanupRpc=await restoreTerminalRpcObserver(app);}catch{}if(ptyInstalled)try{r.cleanupPty=await restorePtyWriteObserver(app);}catch{}await writeFile(join(scratch,'electron.log'),app.logs());}if(fixture)await fixture.close();r.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,checks:r.checks.length,stage:r.stage,error:r.error,scratch}));}
