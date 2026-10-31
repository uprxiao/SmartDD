// Acceptance-only observation/replay of this newly launched private App's own
// one-use tickets. Secrets remain in RAM or the explicitly recreated private
// ticket; result records contain hashes only. No authentication is replaced.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {connect} from 'node:net';
import {lstat,readFile,writeFile,unlink,mkdir,readdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function exchange(endpoint,ticket){
 return new Promise((resolve,reject)=>{
  const socket=connect(endpoint);let buffer='',done=false;
  const timer=setTimeout(()=>finish(Error('bootstrap replay deadline')),5000);
  function finish(error,value){if(done)return;done=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(value);}
  socket.once('error',error=>finish(error));
  socket.once('connect',()=>socket.write(JSON.stringify({schema:1,id:randomUUID(),method:'exchange',runId:ticket.runId,bridgeId:ticket.bridgeId,secret:ticket.secret})+'\n'));
  socket.on('data',bytes=>{buffer+=bytes;if(buffer.length>=4096){finish(Error('Oversized replay response'));return;}const end=buffer.indexOf('\n');if(end>=0)try{finish(null,JSON.parse(buffer.slice(0,end)));}catch(error){finish(error);}});
  socket.once('close',()=>{if(!done)finish(Error('bootstrap replay closed without response'));});
 });
}
export function bootstrapReplayFixture({root,userData,home,executable,bundleRoot,runtime,checked,result,poll}){
 const report={layer:'Actual packaged broker/runtime and real Codex context; replay clients are explicit unauthorized protocol negatives, not UI or native CLI children',phases:[],childPids:[]};result.bootstrapReplay=report;
 const sql=statement=>JSON.parse(execFileSync('/usr/bin/sqlite3',['-readonly','-json',join(userData,'smartdd.db'),statement],{encoding:'utf8'})||'[]');
 const secrets=new Set();let old,observerInstalled=false;
 async function stable(app,task){
  return poll(async()=>{
   const live=await app.invoke('tasks.get',task.id);if(!live.nativeSessionId)return null;
   const row=sql("SELECT snapshot_hash,snapshot_json FROM capability_session_snapshots WHERE task_id='"+task.id+"'")[0];
   if(!row||JSON.parse(row.snapshot_json).native.sessionId!==live.nativeSessionId)return null;
   const d=await app.invoke('applications.session',task.id);return d.ok&&d.value.snapshotHash===row.snapshot_hash?d.value:null;
  },15000);
 }
 async function restore(app){
  if(!observerInstalled)return null;
  const records=await app.mainEvaluate(`(()=>{const s=globalThis.__m10BootstrapReplayObserver;if(!s)return null;const fs=process.getBuiltinModule('fs');if(fs.writeFileSync!==s.wrapper)throw Error('bootstrap observer ownership changed');fs.writeFileSync=s.original;process.getBuiltinModule('module').syncBuiltinESMExports();delete globalThis.__m10BootstrapReplayObserver;return{records:s.records,restored:true};})()`);
  observerInstalled=false;return records;
 }
 async function install(app){
  assert(!observerInstalled);
  await app.mainEvaluate(`(()=>{if(globalThis.__m10BootstrapReplayObserver)throw Error('bootstrap observer already installed');const fs=process.getBuiltinModule('fs'),s={original:fs.writeFileSync,records:[]};s.wrapper=function(...args){const value=s.original.apply(this,args);try{if(typeof args[0]==='string'&&/^\\/(?:private\\/)?tmp\\/wy-\\d+-[A-Za-z0-9]+\\/[a-f0-9-]{36}\\.json$/.test(args[0])){const bytes=Buffer.isBuffer(args[1])?args[1].toString('utf8'):args[1];if(typeof bytes==='string'&&Buffer.byteLength(bytes)<=4096){const b=JSON.parse(bytes);if(b.schema===1&&typeof b.secret==='string'&&/^[a-f0-9]{64}$/.test(b.secret)&&typeof b.hostGeneration==='string')s.records.push({path:args[0],bytes,at:Date.now()});}}}catch{}return value;};fs.writeFileSync=s.wrapper;process.getBuiltinModule('module').syncBuiltinESMExports();globalThis.__m10BootstrapReplayObserver=s;return true;})()`);
  observerInstalled=true;
 }
 function runState(runId){return{
  runs:sql("SELECT * FROM capability_runs WHERE run_id='"+runId+"'"),
  processes:sql("SELECT * FROM capability_run_processes WHERE run_id='"+runId+"' ORDER BY process_id"),
  snapshots:sql('SELECT * FROM capability_session_snapshots ORDER BY task_id'),
  drafts:sql('SELECT * FROM mail_drafts ORDER BY id'),
  intents:sql('SELECT * FROM mail_send_intents ORDER BY id'),
 };}
 async function failedRuntime(path,label){
  const bin=join(root,'no-system-runtime');await mkdir(bin,{recursive:true});let failure;
  try{execFileSync(executable,[join(userData,'capabilities/runtime',runtime.hash,'mcp-bridge.cjs'),'--bootstrap',path],{env:{PATH:bin,HOME:home,ELECTRON_RUN_AS_NODE:'1',SMARTDD_USER_DATA:join(root,'unexpected-replay-gui')},encoding:'utf8',timeout:5000,maxBuffer:4096,stdio:['ignore','pipe','pipe']});}catch(error){failure=error;}
  assert(failure,'Replayed runtime must refuse');assert.equal(failure.status,1);assert.equal(failure.signal,null);assert.equal(String(failure.stdout),'');assert.equal(String(failure.stderr),'WillYou application bridge unavailable\n');
  assert(Number.isSafeInteger(failure.pid));report.childPids.push(failure.pid);
  return{label,pid:failure.pid,status:failure.status,signal:failure.signal,stdout:String(failure.stdout),stderr:String(failure.stderr),pathPolicy:'Empty PATH; exact packaged executable and fixed cached CJS, no alternate Node/Python'};
 }
 async function absent(path){try{await lstat(path);return false;}catch(error){assert.equal(error.code,'ENOENT');return true;}}
 async function phase(app,task,label){
  const captured=await restore(app);assert(captured?.restored,'Observer restored before replay');
  const diagnostic=await app.invoke('applications.session',task.id);assert(diagnostic.ok&&diagnostic.value.currentRun?.bridge.connected);
  const runId=diagnostic.value.currentRun.id,bridge=sql("SELECT process_id FROM capability_run_processes WHERE run_id='"+runId+"' AND kind='bridge' AND state='active'");assert.equal(bridge.length,1);
  const records=captured.records.filter(r=>{const b=JSON.parse(r.bytes);return b.runId===runId&&b.bridgeId===bridge[0].process_id;});assert.equal(records.length,1,'Observe exactly this run formal bridge ticket');
  const record=records[0],ticket=JSON.parse(record.bytes);assert(/^[a-f0-9]{64}$/.test(ticket.secret));assert.equal(record.path,join(dirname(ticket.endpoint),ticket.bridgeId+'.json'));assert(await absent(record.path),'Actual native bridge consumed its ticket');
  secrets.add(ticket.secret);
  const directory=await lstat(dirname(record.path));assert(directory.isDirectory()&&!directory.isSymbolicLink());assert.equal(directory.uid,process.getuid());assert.equal(directory.mode&0o777,0o700);
  assert(ticket.expiresAt-Date.now()>1000,'Replay fixture must run before original ticket expires');
  const source=await readFile(join(bundleRoot,runtime.path,runtime.bridgeEntry)),installed=await readFile(join(userData,'capabilities/runtime',runtime.hash,runtime.bridgeEntry));assert(source.equals(installed),'Cached bridge equals exact packaged immutable source');
  const before=runState(runId),denialsBefore=sql('SELECT audit_id FROM capability_broker_denials');
  const entry={label,runId,bridgeId:ticket.bridgeId,hostGeneration:ticket.hostGeneration,ticketSha256:sha(record.bytes),secretSha256:sha(ticket.secret),runtimeSha256:sha(installed),originalExpiry:ticket.expiresAt,replayStartedAt:new Date().toISOString(),wireResponses:[],runtime:[]};report.phases.push(entry);
  const reject=response=>{assert.equal(response.status,'error');assert.equal(response.error.code,'AUTH_REQUIRED');assert.equal(typeof response.auditId,'string');entry.wireResponses.push(response);};
  reject(await exchange(ticket.endpoint,ticket));
  entry.runtime.push(await failedRuntime(record.path,'missing consumed ticket'));
  let recreated;
  try{
   assert(ticket.expiresAt-Date.now()>500,'Same unexpired ticket is recreated without altering its content');
   await writeFile(record.path,record.bytes,{flag:'wx',mode:0o600});recreated=await lstat(record.path);entry.recreatedFile={dev:recreated.dev,ino:recreated.ino,mode:recreated.mode&0o777};assert.equal(entry.recreatedFile.mode,0o600);
   entry.runtime.push(await failedRuntime(record.path,'explicit recreated consumed ticket'));
   assert(await absent(record.path),'Recreated file consumed; broker still refuses its spent secret');
  }finally{
   if(recreated&&!await absent(record.path)){const current=await lstat(record.path);assert(current.isFile()&&!current.isSymbolicLink()&&current.dev===recreated.dev&&current.ino===recreated.ino,'Clean only this recreated ticket inode');await unlink(record.path);entry.recreatedCleanup=true;}
  }
  if(old){
   assert(ticket.hostGeneration!==old.hostGeneration&&sha(ticket.secret)!==sha(old.secret),'Restart gets new generation and ticket');
   reject(await exchange(ticket.endpoint,old));entry.previousHostTicketRejected=true;
  }
  const after=await app.invoke('applications.session',task.id);assert(after.ok&&after.value.currentRun.id===runId&&after.value.currentRun.bridge.connected);
  assert.deepEqual(runState(runId),before,'Replays do not change current runs, children, S, drafts or send intents');
  const beforeIds=new Set(denialsBefore.map(r=>r.audit_id)),newDenials=sql('SELECT * FROM capability_broker_denials ORDER BY observed_at,audit_id').filter(r=>!beforeIds.has(r.audit_id));
  assert.equal(newDenials.length,old?3:2);assert(newDenials.every(r=>r.method==='exchange'&&r.error_code==='AUTH_REQUIRED'&&r.run_id===null&&r.bridge_id===null));
  for(const response of entry.wireResponses)assert(newDenials.some(r=>r.audit_id===response.auditId));
  assert(!JSON.stringify(newDenials).includes(ticket.secret));entry.denials=newDenials;entry.originalBridgeRetained=true;entry.finishedAt=new Date().toISOString();
  old=ticket;
  checked('Actual '+label+' Codex bridge retains authority while spent bootstrap is refused over wire, missing-file and recreated-file runtime paths; no business replay');
  return entry;
 }
 return{install,phase,restore,stable,async finish(app){
  const leaked=bytes=>[...secrets].some(value=>bytes.includes(Buffer.from(value)));
  assert(!leaked(Buffer.from(app.logs())),'Ephemeral bootstrap secret absent from App log');
  const redaction={scope:'Private root regular files up to 1 MiB each; larger files and links explicitly excluded. Exact package/runtime hashes checked separately. Current owned process argv and App log checked.',files:[],excluded:[]};
  async function walk(directory){for(const item of await readdir(directory,{withFileTypes:true})){
   const path=join(directory,item.name),name=path.slice(root.length+1);
   if(item.isSymbolicLink()){redaction.excluded.push({path:name,reason:'symbolic link'});continue;}
   if(item.isDirectory()){await walk(path);continue;}
   if(!item.isFile()){redaction.excluded.push({path:name,reason:'not regular file'});continue;}
   let bytes;try{const info=await lstat(path);if(info.size>1024*1024){redaction.excluded.push({path:name,reason:'over 1 MiB',bytes:info.size});continue;}bytes=await readFile(path);}catch(error){if(error.code==='ENOENT'){redaction.excluded.push({path:name,reason:'transient file removed'});continue;}throw error;}
   assert(!leaked(bytes),'Ephemeral bootstrap secret absent from own artifact '+name);redaction.files.push({path:name,bytes:bytes.length,sha256:sha(bytes)});
  }}
  await walk(root);
  const pids=[app.processId,...sql("SELECT pid FROM capability_run_processes WHERE state='active' AND pid IS NOT NULL").map(r=>r.pid)];assert(pids.every(Number.isSafeInteger));
  const argv=execFileSync('/bin/ps',['-p',pids.join(','),'-o','pid=,command='],{encoding:'utf8',timeout:5000});assert(!leaked(Buffer.from(argv)),'Ephemeral bootstrap secret absent from current owned argv');
  redaction.ownedArgv={pids,sha256:sha(argv),bytes:Buffer.byteLength(argv)};report.redaction=redaction;
  old=undefined;secrets.clear();report.status='passed-packaged-protocol-partial';
 }};
}
