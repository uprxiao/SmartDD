// PS: real native MCP pre/post controls. No copied credential or replacement peer.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
export async function makeZenTaoWireChecks(c){
 const {app,root,e,A2,B1,C,task,probe,poll,note,sql,quote}=c;
 const w=e.wire={status:'running',startedAt:new Date().toISOString(),checks:[],phases:[],fixtureSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),boundary:'Real original Codex MCP before/after original channel revocation,not copied-token new-socket replay;synthetic no-secret provider metadata and model'};
 const mail='smartdd_mail_draft_list_v1',zen='smartdd_zentao_work_list_v1',draft=e.frozen.mail_drafts[0];assert(draft);
 const saved=async()=>writeFile(join(root,'zentao-switch-wire-progress.json'),JSON.stringify(w,null,2)+'\n');
 const checked=async name=>{w.checks.push({name,at:new Date().toISOString()});await saved();await note(name);};
 async function request(item,name,tool,input){
  const p=probe.select('ps-'+name,input,tool);p.rawOutput=true;w.phases.push(p);const t=await app.invoke('tasks.get',item.task.id);assert(t.ptyId);p.target={taskId:t.id,ptyId:t.ptyId,nativeId:t.nativeSessionId};
  await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId:t.id,ptyId:t.ptyId,data:p.token+': Perform only the specified read-only application call once. No file changes,external requests,sending or retries.'})});true`);await poll(async()=>(await app.output(t.ptyId)).includes(p.token),10000);await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId:t.id,ptyId:t.ptyId,data:'\r'})});true`);
  await poll(async()=>p.done&&(await app.output(t.ptyId)).includes(p.doneToken),45000);assert.equal(typeof p.value,'string');probe.clear(p);await saved();return p;
 }
 const parse=p=>{const start=p.value.indexOf('{'),end=p.value.lastIndexOf('}');assert(start>=0&&end>=start,p.value);return p.parsed=JSON.parse(p.value.slice(start,end+1));};
 async function readMail(item,name){const p=await request(item,name,mail,{limit:50}),v=parse(p);assert(!v.error,p.value);const raw=JSON.stringify(v);assert(raw.includes(draft.id)&&raw.includes(draft.subject),p.value);p.expected='same-original-project-draft';return p;}
 async function deniedZen(item,name,code,input={kind:'bug',limit:1}){const p=await request(item,name,zen,input),v=parse(p);assert.equal(v.error?.code,code,p.value);assert(!JSON.stringify(v).includes(draft.subject));p.expected=code;return p;}
 const obj={
  async before(){w.initial={A2Mail:await readMail(A2,'initial-A2-mail'),A2Zen:await deniedZen(A2,'initial-A2-zen','AUTH_REQUIRED'),B1Zen:await deniedZen(B1,'initial-B1-zen','AUTH_REQUIRED')};await checked('PS original A2 nativeMCP reads same draft and ZenTao reaches missing-credential AUTH_REQUIRED;B1 originalMCP also reaches host,no provider request or secret');},
  async pending(){w.pending={A2Zen:await deniedZen(A2,'pending-A2-zen','RESOURCE_BUSY'),A2Mail:await readMail(A2,'pending-A2-mail'),B1Zen:await deniedZen(B1,'pending-B1-zen','AUTH_REQUIRED')};await checked('PS during original pending A2 real ZenTao call is RESOURCE_BUSY while same A2 Mailread and other-project nativeMCP remainallowed/reachable');},
  async stopped(){
   const run=A2.binding.run,before=sql(`SELECT * FROM application_invocations WHERE run_id=${quote(run)} ORDER BY started_at,operation_id`),p=await request(A2,'old-A2-channel',mail,{limit:50});const raw=p.value.replace(/^Wall time: [0-9.]+ seconds\s+Output:\s*/,'').trim();const closed='tool call error: tool call failed for `'+p.call.namespace.replace(/^mcp__/,'')+'/'+p.call.name+'`\n\nCaused by:\n    Transport closed';assert.equal(raw,closed,p.value);p.expected='exact-original-native-Transport-closed';p.transportClosed=true;w.oldChannel={phase:p,runId:run,beforeInvocations:before,afterInvocations:sql(`SELECT * FROM application_invocations WHERE run_id=${quote(run)} ORDER BY started_at,operation_id`)};assert.deepEqual(w.oldChannel.afterInvocations,before);w.unrelatedAfterStop={B1Zen:await deniedZen(B1,'stopped-B1-zen','AUTH_REQUIRED'),mailOnly:await readMail({task},'stopped-mail-only')};await checked('PS original still-live A2 Codex oldMCP returns exact Transport closed/no new invocation after stopping;B1 and same-project Mail-only original channels stillwork');
  },
  async resumed(){w.resumed={A2Mail:await readMail(A2,'resumed-A2-mail'),A2Zen:await deniedZen(A2,'resumed-A2-zen','AUTH_REQUIRED')};const d=await app.invoke('applications.session',A2.task.id);assert(d.ok&&d.value.currentRun?.bridge.connected);w.resumedRun=d.value.currentRun.id;assert.notEqual(w.resumedRun,w.oldChannel.runId);await checked('PS only explicit sameN/S resume establishes new real authenticatedMCP channel;it reads originaldraft and reaches originalC missing-credential rejection without old invocation replay');},
  async switched(){w.switched={oldC:await deniedZen(A2,'switched-old-C','SCOPE_DENIED',{kind:'bug',limit:1,connectionId:C}),current:await deniedZen(A2,'switched-current-D','AUTH_REQUIRED'),mail:await readMail(A2,'switched-mail')};w.status='passed-native-MCP-channel-and-current-source-subset';w.finishedAt=new Date().toISOString();await checked('PS after explicitD switch old native history rejects suppliedC before credentials;current selection reaches D missing-credential rejection and originaldraft staysreadable,not old object-reference/provider proof');await writeFile(join(root,'zentao-switch-wire-final.json'),JSON.stringify(w,null,2)+'\n');}
 };return obj;
}
