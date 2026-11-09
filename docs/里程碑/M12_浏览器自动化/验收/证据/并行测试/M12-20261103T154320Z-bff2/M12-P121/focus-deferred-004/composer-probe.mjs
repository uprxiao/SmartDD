// Optional local input check only. Importing this module does not operate an App.
// Reuses zentao-reference-native-ui's actual input/buffer readback and existing
// ui.prepareTerminalLine Ctrl-U event shape. No PTY wrapper or RPC write path.
import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {readExactTerminal} from './terminal-submit.mjs';
import {explainResumeReadiness} from './resume-readiness.mjs';

export async function probeComposerOnce({app,taskId,ptyId,resume,record,persist,poll,mode}){
 assert.equal(mode,'local-character-probe-only');assert.equal(resume.ptyId,ptyId);
 assert.equal(resume.stateRoot,'/private/tmp/willyou-m12-t120-t125-app022-retest-001/runtime-001/codex');
 assert(resume.nativePath.startsWith(resume.stateRoot+'/sessions/')&&resume.nativePath.endsWith('-'+resume.nativeId+'.jsonl'));assert.equal(await realpath(resume.nativePath),resume.nativePath);
 assert(!record.startedAt,'One probe only');Object.assign(record,{startedAt:new Date().toISOString(),actions:[],samples:[],businessSubmitted:false,doesNotAuthorizeSOP:true});await persist();
 const nativeRows=async()=>{const b=await readFile(resume.nativePath);assert(b.length<=8*1024*1024);return b.toString('utf8').split('\n').filter(Boolean).map(JSON.parse);};
 const userCarriers=rows=>rows.filter(r=>r.type==='response_item'&&r.payload?.type==='message'&&r.payload.role==='user'||r.type==='event_msg'&&r.payload?.type==='user_message').length;
 const identity=async()=>{const t=await app.invoke('tasks.get',taskId),s=await app.invoke('applications.session',taskId);assert.equal(t.ptyId,ptyId);assert.equal(t.nativeSessionId,resume.nativeId);assert.equal(t.cwd,resume.cwd);assert(s.ok&&s.value.currentRun?.id===resume.runId);};
 const capture=async phase=>{await identity();const terminal=await readExactTerminal(app,ptyId),rows=await nativeRows(),decision=explainResumeReadiness(terminal,resume,rows);record.samples.push({at:new Date().toISOString(),phase,terminal,decision,userCarriers:userCarriers(rows)});await persist();return{terminal,decision,rows};};
 const first=await capture('before');
 // A separate diagnostic action: preserve the full original decision, and do
 // not treat a successful probe as relaxing the original readiness/SOP gate.
 for(const [key,passed]of Object.entries(first.decision.predicates))if(!['exactPlaceholderLine','noVisibleResumeLine'].includes(key))assert(passed,'Probe prerequisite failed: '+key);
 const baseline=first.terminal;assert(baseline.terminalVisible&&baseline.activeCursor?.inViewport);assert.equal(baseline.valueLength,0);assert(/^\s*›\s*$/.test(baseline.activeCursor.before),'Do not overwrite a pending composer');assert(['','Ask Codex to do anything'].includes(baseline.activeCursor.after),'Unknown composer content must be reviewed, not cleared');
 await app.checkInputFocus('T125.LocalComposerProbeInsert');await app.cdp('Input.insertText',{text:'x'});record.actions.push({kind:'single-character',text:'x',at:new Date().toISOString()});await persist();
 const echoed=await poll(async()=>{const value=await capture('after-x');assert(value.terminal?.ptyId===ptyId&&value.terminal.activeInExactTerminal&&value.terminal.focused);return value.terminal.activeCursor?.before===baseline.activeCursor.before+'x'&&value.terminal.cursorX===baseline.cursorX+1?value:null;},2000);
 record.actualComposerEcho=echoed.terminal.activeCursor;assert.equal(userCarriers(echoed.rows),userCarriers(first.rows),'No Native user message may be created');
 await identity();await app.checkInputFocus('T125.LocalComposerProbeClear');
 for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'u',code:'KeyU',windowsVirtualKeyCode:85,modifiers:2,...(type==='keyDown'?{text:'\u0015',unmodifiedText:'u'}:{})});record.actions.push({kind:'clear-observed-single-character',key:'Ctrl+U',at:new Date().toISOString()});await persist();
 const cleared=await poll(async()=>{const value=await capture('after-clear');return value.terminal.activeCursor?.before===baseline.activeCursor.before&&value.terminal.cursorX===baseline.cursorX?value:null;},2000);
 assert.equal(userCarriers(cleared.rows),userCarriers(first.rows));Object.assign(record,{finishedAt:new Date().toISOString(),typedAndCleared:true,NativeUserCarriersUnchanged:true,enterEventsDispatched:0});await persist();return record;
}
