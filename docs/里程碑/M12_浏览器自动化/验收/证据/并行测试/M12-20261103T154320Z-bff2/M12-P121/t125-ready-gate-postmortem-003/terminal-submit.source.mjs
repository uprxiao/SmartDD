// Proposal only. Reuses the verified zentao-reference-native-ui xterm model reader,
// scoped to this exact current PTY. No ANSI parser and no App activity on import.
import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {resumeReadiness} from './resume-readiness.mjs';
export async function readExactTerminal(app,ptyId){
 const exact='[data-testid=task-terminal][data-pty="'+ptyId+'"]';
 return app.evaluate(`(()=>{const root=document.querySelector(${JSON.stringify(exact)}),active=document.activeElement;if(!root)return null;let node=root.querySelector('.xterm'),fiber;while(node&&!fiber){const key=Object.keys(node).find(k=>k.startsWith('__reactFiber$'));if(key)fiber=node[key];node=node.parentElement;}for(let f=fiber;f;f=f.return){let h=f.memoizedState;for(let n=0;h&&n<100;n++,h=h.next){const term=h.memoizedState?.current;if(term?.buffer?.active&&term.element&&root.contains(term.element)){const b=term.buffer.active,lines=[],visible=[];for(let i=b.baseY;i<Math.min(b.length,b.baseY+term.rows);i++)visible.push(b.getLine(i)?.translateToString(true)||'');for(let i=Math.max(0,b.length-500);i<b.length;i++)lines.push(b.getLine(i)?.translateToString(true)||'');return{ptyId:root.dataset.pty,currentScreen:visible.join('\\n'),viewportAtBottom:b.viewportY===b.baseY,baseY:b.baseY,viewportY:b.viewportY,cursorX:b.cursorX,cursorY:b.cursorY,bufferType:b.type,terminalRows:term.rows,screen:lines.join('\\n'),focused:document.hasFocus(),activeInExactTerminal:root.contains(active),activeClass:active?.className,valueLength:active?.value?.length??null,bracketedPasteMode:term.modes?.bracketedPasteMode??null};}}}return null;})()`);
}
export async function waitTerminalReady(app,ptyId,poll,resume){
 assert.equal(resume?.ptyId,ptyId);assert.equal(resume.stateRoot,'/private/tmp/willyou-m12-t120-t125-app022-retest-001/runtime-001/codex');assert(resume.nativePath.startsWith(resume.stateRoot+'/sessions/')&&resume.nativePath.endsWith('-'+resume.nativeId+'.jsonl'));assert.equal(await realpath(resume.nativePath),resume.nativePath);
 return poll(async()=>{const v=await readExactTerminal(app,ptyId),bytes=await readFile(resume.nativePath);assert(bytes.length<=8*1024*1024);const rows=bytes.toString('utf8').split('\n').filter(Boolean).map(JSON.parse),ready=resumeReadiness(v,resume,rows);return ready?{...v,resumeReady:ready}:null},15000);
}
export async function submitFollowup({app,text,taskId,ptyId,record,persist,poll,resume,now=()=>new Date().toISOString()}){
 assert(typeof text==='string'&&!/[\r\n]/.test(text));
 const task=await app.invoke('tasks.get',taskId);assert.equal(task.id,taskId);assert.equal(task.ptyId,ptyId);
 record.ready=await waitTerminalReady(app,ptyId,poll,resume);assert.equal(record.ready.valueLength,0);
 record.beforeInputFocus={documentFocused:record.ready.focused,activeInExactTerminal:record.ready.activeInExactTerminal,activeClass:record.ready.activeClass,valueLength:record.ready.valueLength};
 const beforeOutput=await app.output(ptyId);await app.checkInputFocus('LocalTerminal.BeforeInsert');await persist();
 await app.cdp('Input.insertText',{text});record.actions.push({kind:'terminal-insert-text',text,at:now(),ptyId});
 const samples=[];await poll(async()=>{const output=await app.output(ptyId),screen=await readExactTerminal(app,ptyId);samples.push({at:now(),output,screen});return output!==beforeOutput?true:null},1000).catch(error=>{if(!String(error.message).startsWith('Bounded stage timeout '))throw error;record.inputObservationWait={kind:'no-raw-change-observed-within-1s',errorType:error.name};});
 record.inputObservation={ptyId,insertDispatched:true,beforeOutput,samples,after:await readExactTerminal(app,ptyId),echoIsDiagnosticOnly:true};await persist();
 const current=await app.invoke('tasks.get',taskId);assert.equal(current.ptyId,ptyId);
 record.beforeEnterFocus=await readExactTerminal(app,ptyId);assert(record.beforeEnterFocus?.focused&&record.beforeEnterFocus.activeInExactTerminal&&record.beforeEnterFocus.activeClass?.includes('xterm-helper-textarea'));assert(record.beforeEnterFocus.viewportAtBottom&&!/^\s*Resuming session(?:…|\.{3})\s*$/m.test(record.beforeEnterFocus.currentScreen));
 await app.checkInputFocus('LocalTerminal.BeforeEnter');record.enterAt=now();
 for(const type of ['keyDown','keyUp']){const event={type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:36,...(type==='keyDown'?{text:'\r',unmodifiedText:'\r'}:{})};await app.cdp('Input.dispatchKeyEvent',event);record.actions.push({kind:'terminal-enter',event:{...event,text:event.text===undefined?undefined:[...event.text].map(x=>x.charCodeAt(0)),unmodifiedText:event.unmodifiedText===undefined?undefined:[...event.unmodifiedText].map(x=>x.charCodeAt(0))},at:now()});}
 await persist();
}
