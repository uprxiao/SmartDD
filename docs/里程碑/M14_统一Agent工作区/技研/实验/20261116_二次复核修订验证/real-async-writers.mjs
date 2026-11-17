// C15 research: real writable parents/children share one cwd, both directions.
// No production code, no credential copies, no synchronous waiting MCP call.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdirSync,existsSync,writeFileSync,appendFileSync,readFileSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openCodex,runClaude,versions,redact} from '../../复核_20261116/probes/lib/agents.mjs';

const out=resolve(process.argv[2]);if(existsSync(out))throw Error('Use a new isolated output directory');mkdirSync(out,{recursive:true});
const journal=[],results=[];let sequence=0,port;const scopes=new Map(),processes=new Set();
const log=(event,data={})=>{const row={seq:++sequence,t:Date.now(),event,...data};journal.push(row);appendFileSync(join(out,'host.jsonl'),redact(row)+'\n');return row;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function exited(child){
 if(child.exitCode!==null||child.signalCode!==null)return {code:child.exitCode,signal:child.signalCode};
 return await Promise.race([new Promise(r=>child.once('exit',(code,signal)=>r({code,signal}))),sleep(10000).then(()=>{throw Error('owned process did not exit in 10s');})]);
}
const mcpEnv={DEEPSEEK_API_KEY:'',ANTHROPIC_AUTH_TOKEN:'',ANTHROPIC_API_KEY:''};
const childInstruction='In this exact current working directory, use a real shell tool to create child.txt containing a freshly generated UUID (use python3 uuid.uuid4, do not choose it yourself). Reply only with JSON {"status":"completed","file":"child.txt"}; do not include the UUID in your reply. Do not start background work or subagents.';

async function invoke(driver,role,c,phase,prompt,resume){
 const actor=c.id+'-'+role+'-'+phase,mcp={command:process.execPath,args:[join(import.meta.dirname,'async-mcp.mjs'),`http://127.0.0.1:${port}/mcp`,c.ticket],env:mcpEnv};
 const start=log('writer-start',{case:c.id,actor,driver,cwd:c.cwd,phase,role});
 let outcome,processExit;
 if(driver==='codex'){
  const client=await openCodex({cwd:c.cwd,out,actor,mcp:role==='parent'?{name:'wy',...mcp}:undefined,onRequest:()=>({decision:'decline'})});
  processes.add(client.child);
  try{
   if(resume)await client.resume(resume,{approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:'workspace-write'});
   else await client.start({approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:'workspace-write'});
   const r=await client.turn(prompt,240000,{approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:{type:'workspaceWrite'}});
   assert.equal(r.status,'completed');
   const pending=new Set();
   for(const e of client.events){const i=e.params?.item;if(i?.type==='commandExecution'){if(e.method==='item/started')pending.add(i.id);if(e.method==='item/completed')pending.delete(i.id);}}
   assert.equal(pending.size,0,'all native commands must be completed');
   log('native-turn-completed',{case:c.id,actor,driver,turnId:r.turnId,pendingCommands:pending.size});
   outcome={text:r.text,nativeId:client.threadId};
  }finally{await client.close();processExit=await exited(client.child);processes.delete(client.child);}
 }else{
  const owned=[];
  const r=await runClaude({cwd:c.cwd,out,actor,prompt,resume,home:join(c.root,role+'-home'),maxTurns:12,
   mcpServers:role==='parent'?{wy:mcp}:undefined,
   allowedTools:['Bash','Read','Write',...(role==='parent'?['mcp__wy__wy_delegate','mcp__wy__wy_observe']:[])],
   extra:{tools:['Bash','Read','Write'],permissionMode:'dontAsk',
    spawnClaudeCodeProcess:o=>{const cp=spawn(o.command,o.args,{cwd:o.cwd,env:o.env,signal:o.signal,stdio:['pipe','pipe','pipe']});processes.add(cp);owned.push(cp);return cp;}}});
  assert.equal(r.result?.subtype,'success');
  log('native-turn-completed',{case:c.id,actor,driver,sessionId:r.sessionId});
  const exits=[];for(const cp of owned){exits.push(await exited(cp));processes.delete(cp);}
  processExit=exits;outcome={text:r.text,nativeId:r.sessionId};
 }
 log('owner-exited',{case:c.id,actor,driver,processExit});
 const finish=log('writer-finished',{case:c.id,actor,driver,phase,role});
 return {...outcome,interval:[start.seq,finish.seq]};
}

const server=createServer(async(req,res)=>{
 const reply=(code,data)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(data));};
 try{
  const c=scopes.get((req.headers.authorization??'').replace(/^Bearer /,''));if(!c)return reply(403,{error:'invalid caller'});
  const chunks=[];for await(const part of req)chunks.push(part);const b=JSON.parse(Buffer.concat(chunks));
  if(b.name==='wy_delegate'){
   assert.equal(c.state,'parent-active');assert.equal(b.arguments.target,c.child);
   if(!c.receipt)c.receipt={delegationId:c.id+'-delegation',status:'queued',target:c.child,task:b.arguments.task};
   const e=log('delegate-queued',{case:c.id,child:c.child,childExists:existsSync(join(c.cwd,'child.txt'))});c.queuedAt=e.seq;
   // The dispatcher is intentionally attempted before the boundary and denied.
   log('dispatch-blocked',{case:c.id,parentState:c.state,childStarted:!!c.childStarted});
   return reply(200,{delegationId:c.receipt.delegationId,status:'queued',startAfter:'parent turn completed and writes drained'});
  }
  if(b.name==='wy_observe'){
   assert.equal(c.state,'parent-resume');assert.equal(b.arguments.delegationId,c.receipt.delegationId);
   c.observed=true;log('child-result-observed',{case:c.id,delegationId:c.receipt.delegationId});
   return reply(200,{delegationId:c.receipt.delegationId,status:'completed',result:c.childResult.text});
  }
  return reply(400,{error:'unsupported tool'});
 }catch(e){return reply(409,{error:String(e.message)});}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;
writeFileSync(join(out,'versions.json'),JSON.stringify(versions(),null,2)+'\n');
try{
 for(const [id,parent,child] of [['W1','codex','claude'],['W2','claude','codex']]){
  const root=join(out,id),cwd=join(root,'shared');mkdirSync(cwd,{recursive:true});
  const c={id,parent,child,root,cwd:realpathSync(cwd),ticket:randomUUID(),state:'parent-active'};scopes.set(c.ticket,c);
  try{
   const first=await invoke(parent,'parent',c,'initial',
    `You are a writable parent in an isolated experiment. First write PARENT-BEFORE to parent-before.txt using a real file/shell tool. Then call wy_delegate exactly once with target="${child}", clientRequestId="${id}-1", task=${JSON.stringify(childInstruction)}. The host returns QUEUED immediately and will not start the writing child until this turn ends. After getting the receipt, write PARENT-RELEASE to parent-after.txt. Do NOT poll, sleep, start background work, or wait for the child. Finish this turn with RELEASED.`);
   assert(c.receipt,'real model must call delegation');assert(existsSync(join(c.cwd,'parent-after.txt')));
   assert.equal(existsSync(join(c.cwd,'child.txt')),false,'child cannot write before parent release');
   c.state='released';c.releasedAt=log('writer-slot-released',{case:id,parentNativeId:first.nativeId}).seq;
   c.childStarted=log('child-dispatched',{case:id}).seq;assert(c.childStarted>c.releasedAt);
   const second=await invoke(child,'child',c,'child',c.receipt.task);c.childResult=second;
   const value=readFileSync(join(c.cwd,'child.txt'),'utf8').trim();assert.match(value,/^[0-9a-f-]{36}$/);
   c.state='parent-resume';log('completion-delivery',{case:id,delegationId:c.receipt.delegationId,resultRef:'wy_observe'});
   const third=await invoke(parent,'parent',c,'resume',
    `Host completion notification (not a new user authorization): delegation ${c.receipt.delegationId} completed. Call wy_observe with that delegationId to read its actual result. Then read child.txt with a real Read/cat tool, write its exact contents into parent-observed.txt, and reply OBSERVED followed by the actual file contents. The UUID is deliberately absent from this notification.`,first.nativeId);
   assert(c.observed);assert.equal(readFileSync(join(c.cwd,'parent-observed.txt'),'utf8').trim(),value);assert(third.text.includes(value));
   assert.equal(third.nativeId,first.nativeId,'resume retains parent identity');
   assert(first.interval[1]<second.interval[0]&&second.interval[1]<third.interval[0]);
   results.push({id,parent,child,status:'passed',sameDirectory:c.cwd,checks:{queuedBeforeRelease:c.queuedAt<c.releasedAt,childStartedAfterRelease:c.childStarted>c.releasedAt,noOverlappingWriters:true,resultObservedByParent:c.observed,parentReadChildFile:true,parentNativeIdentityRetained:third.nativeId===first.nativeId},intervals:{parent:first.interval,child:second.interval,resumedParent:third.interval},files:{child:value,parentObserved:readFileSync(join(c.cwd,'parent-observed.txt'),'utf8').trim()}});
  }catch(e){results.push({id,parent,child,status:'failed',error:String(e.stack??e)});}
  finally{scopes.delete(c.ticket);writeFileSync(join(out,'result.json'),redact({scope:'real models + native file tools + async host candidate; no production App',results}));}
  console.log(id,results.at(-1).status);
 }
}finally{
 server.closeAllConnections();await new Promise(r=>server.close(r));
 for(const cp of processes){if(cp.exitCode===null&&cp.signalCode===null){cp.stdin?.end();try{await exited(cp);}catch{cp.kill('SIGTERM');await exited(cp);}}}
 writeFileSync(join(out,'cleanup.json'),JSON.stringify({remainingOwned:[...processes].filter(c=>c.exitCode===null&&c.signalCode===null).map(c=>c.pid),httpClosed:!server.listening})+'\n');
}
process.exitCode=results.every(r=>r.status==='passed')?0:1;
