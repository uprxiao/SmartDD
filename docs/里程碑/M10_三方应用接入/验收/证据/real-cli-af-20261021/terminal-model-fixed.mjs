import{readFile}from'node:fs/promises';
import{createHash}from'node:crypto';
const path='/private/tmp/m10-legacy-recovery-r-20261021/work-r4/node_modules/@xterm/xterm/lib/xterm.js';
export async function attachTerminalModel(app,task,record){
 const bytes=await readFile(path);record.terminalModel={implementation:'@xterm/xterm 6.0.0 browser parser, same dependency as App',source:path,sha256:createHash('sha256').update(bytes).digest('hex'),geometry:'120 columns /35 rows matches owned native PTY',boundary:'Unopened parser buffer; no visible terminal or GUI-input acceptance. Only native terminal-protocol replies use the trusted owned PTY channel.'};
 await app.evaluate(bytes.toString('utf8')+'\ntrue');
 await app.evaluate(`(()=>{const target=${JSON.stringify({taskId:task.id,ptyId:task.ptyId})};const term=new Terminal({cols:120,rows:35,scrollback:1000,allowProposedApi:true});const state={target,term,replies:[]};window.__afTerminal=state;term.onData(data=>{state.replies.push({at:new Date().toISOString(),data});window.electronAPI.eventSend('pty:input',{...target,data});});window.electronAPI.eventOn('pty:data',e=>{if(e.ptyId===target.ptyId)term.write(e.data);});const initial=window.__m5.output[target.ptyId]||'';term.write(initial);return true;})()`);
}
export async function terminalScreen(app){return app.evaluate(`(()=>{const t=window.__afTerminal?.term;if(!t)return'';const b=t.buffer.active;return Array.from({length:t.rows},(_,i)=>b.getLine(b.viewportY+i)?.translateToString(true)??'').join(String.fromCharCode(10));})()`);}
export async function terminalReplies(app){return app.evaluate(`window.__afTerminal?.replies??[]`);}
