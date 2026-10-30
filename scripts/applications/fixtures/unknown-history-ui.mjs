// External A-layer operations for T62. Setup remains in native-unknown-history.
// Read-only RPC/SQLite assertions; all tested navigation, resume and creation use UI.
import assert from 'node:assert/strict';
import {join} from 'node:path';
export function unknownHistoryUI({app,result,root,poll,sql,checked,taskId,marker}){
 const visible=selector=>`[...document.querySelectorAll(${JSON.stringify(selector)})].some(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height)`;
 async function click(selector,text){
  const lookup=`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height&&${text===undefined?'true':`e.textContent.trim()===${JSON.stringify(text)}`})`;
  await app.waitFor(`(()=>{const e=${lookup};return !!e&&!e.matches(':disabled,[aria-disabled="true"],[data-disabled]')})()`,15000);
  await app.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const point=await app.evaluate(`(()=>{const e=${lookup};e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked');return{x,y};})()`);
  for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});
 }
 async function key(key,code,num){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:num,...(key==='Enter'?{nativeVirtualKeyCode:36,...(type==='keyDown'?{text:'\r',unmodifiedText:'\r'}:{})}:{})});}
 const task=()=>app.invoke('tasks.get',taskId);
 const records=()=>({tasks:sql('SELECT * FROM tasks'),snapshots:sql('SELECT * FROM capability_session_snapshots'),runs:sql('SELECT * FROM capability_runs')});
 async function dialog(){await click('[data-testid=task-applications]');await app.waitFor("document.querySelector('[data-testid=session-applications]')?.innerText.includes('历史能力未知，不自动补入当前应用')&&!!document.querySelector('[data-testid=session-applications] .m10-session-app')");}
 async function theme(next){const current=await app.evaluate("document.documentElement.classList.contains('ydark')");if(current!==(next==='dark')){await click('[data-testid=task-actions]');await click('[role=menuitem]','主题');await app.waitFor(`document.documentElement.classList.contains('ydark')===${next==='dark'}`);}}
 return {
  async inspect(){
   const before=records();await click('[data-testid=sidebar-task] .reference-task-label','Unknown native fixture');await app.waitFor("document.querySelector('[data-testid=task-header]')?.innerText.includes('Unknown native fixture')");
   for(const next of ['light','dark']){await theme(next);await dialog();const text=await app.evaluate("document.querySelector('[data-testid=session-applications]').innerText");for(const value of ['本会话未选用','当前项目已启用','当前没有可核实的应用运行证据'])assert(text.includes(value),value);assert.deepEqual(records(),before);assert.equal((await task()).ptyId,null);await app.screenshot(join(root,'unknown-view-'+next+'.png'));checked(next+' real historical navigation and application dialog remain read-only: unknown capability, enabled current Mail, no Task rewrite, snapshot, run or PTY');await click('dialog button','关闭');}
  },
  async resume(){await click('[data-testid=task-resume]');const value=await poll(async()=>{const v=await task();return v.ptyId?v:null;});await app.waitFor(visible(`[data-testid=task-terminal][data-pty="${value.ptyId}"] .xterm-screen`));return {task:value};},
  async submit(ptyId,text,done){await click(`[data-testid=task-terminal][data-pty="${ptyId}"] .xterm-screen`);await app.cdp('Input.insertText',{text});await poll(async()=>(await app.output(ptyId)).includes(text.split(':')[0]),10000);await new Promise(resolve=>setTimeout(resolve,400)); // Codex bracketed-paste submission boundary.
   await key('Enter','Enter',13);await poll(async()=>(await app.output(ptyId)).includes(done),60000);await app.screenshot(join(root,'unknown-resumed-native.png'));
   await dialog();const textNow=await app.evaluate("document.querySelector('[data-testid=session-applications]').innerText");assert(textNow.includes('历史能力未知')&&textNow.includes('本会话未选用'));await app.screenshot(join(root,'unknown-active-diagnostic.png'));await click('dialog button','关闭');checked('Actual terminal keyboard input resumes the same native history; its live application dialog still reports unknown selection');
  },
  async stop(){await click('[data-testid=task-actions]');await click('[data-testid=task-kill]');await poll(async()=>!(await task()).ptyId);},
  async fresh(prompt){const before=records();await dialog();await click('dialog button','使用当前版本新建会话');await app.waitFor(visible('dialog textarea'));await click('dialog textarea');await app.cdp('Input.insertText',{text:prompt});await click('dialog button','前往新会话输入框');await app.waitFor(`document.querySelector('[data-testid=home-input]')?.value===${JSON.stringify(prompt)}`);assert.deepEqual(records(),before);await app.screenshot(join(root,'fresh-composer-no-task.png'));checked('Unknown-history new-current-session entry carries only selected text to editable composer; no submission, Task, PTY or capability rewrite yet');await click('[data-testid=home-launch]');const value=await poll(async()=>{const tasks=await app.invoke('tasks.list',{includeArchived:true});return tasks.find(t=>t.id!==taskId);});return {task:value};},
  async freshDiagnostic(){await app.waitFor(visible('[data-testid=task-applications]'));await click('[data-testid=task-applications]');await app.waitFor("document.querySelector('[data-testid=session-applications]')?.innerText.includes('本会话 v1.0.4')");await app.screenshot(join(root,'fresh-fixed-current.png'));await click('dialog button','关闭');checked('Explicit real composer launch creates a separate current-version task, shown fixed in its actual application dialog');}
 };
}
