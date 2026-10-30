// T58 steps6-10: actual host IPC/PTY/Codex/MCP, no UI claim or cipher replacement.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,readdir,chmod,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parse as parseToml} from 'smol-toml';

export async function checkConnectionLifecycle({app,result,root,userData,state,project,profile,task,marker,probe,poll,checked}){
 const unwrap=r=>{assert(r.ok,JSON.stringify(r));return r.value;},sha=b=>createHash('sha256').update(b).digest('hex');
 const sql=q=>JSON.parse(execFileSync('/usr/bin/sqlite3',['-readonly','-json',join(userData,'smartdd.db'),q],{encoding:'utf8'})||'[]');
 const source=join(root,'lifecycle-mail'),subject='LQ_PRIVATE_MAIL_'+root.split('-').at(-1),originalMode=0o700;
 const life={layer:'Packaged host service -> actual Codex -> real MCP/Worker/native source; synthetic provider; no GUI, SMTP, secrets or real client/sample',source,subject,phases:probe.records,checks:[],taskIds:[task.id],permissionFaults:[],status:'running'};result.connectionLifecycle=life;
 let other,permissionDenied=false;
 const check=(name,details={})=>{life.checks.push({name,at:new Date().toISOString(),...details});checked('T58 mail lifecycle: '+name,details);};
 const session=async target=>unwrap(await app.invoke('applications.session',target.id));
 const con=async()=>unwrap(await app.invoke('applications.connections','mail')).find(c=>c.id===life.connectionId);
 const selection=async()=>unwrap(await app.invoke('applications.projectSettings',project.id,'mail'));
 const secretsEmpty=()=>{assert.deepEqual(sql('SELECT count(*) n FROM app_secrets'),[{n:0}]);assert.deepEqual(sql('SELECT count(*) n FROM application_connections WHERE secret_ref IS NOT NULL'),[{n:0}]);assert.deepEqual(sql('SELECT count(*) n FROM mail_send_intents'),[{n:0}]);};
 async function sourceTree(path){const out={};for(const e of await readdir(path,{withFileTypes:true})){const p=join(path,e.name);assert(!e.isSymbolicLink());if(e.isDirectory()){for(const[n,h]of Object.entries(await sourceTree(p)))out[e.name+'/'+n]=h;}else{assert(e.isFile());out[e.name]=sha(await readFile(p));}}return out;}
 const draftRows=()=>sql('SELECT * FROM mail_drafts ORDER BY id');
 async function fixed(target,expected){
  const current=await session(target),live=await app.invoke('tasks.get',target.id);assert(current.currentRun);assert.equal(current.snapshotHash,expected.snapshotHash);assert.equal(live.nativeSessionId,expected.nativeSessionId);assert.equal(current.currentRun.id,expected.runId);assert.equal(live.ptyId,expected.ptyId);assert.deepEqual(current.applications.map(a=>[a.appId,a.packageHash]),expected.packages);secretsEmpty();assert.deepEqual(draftRows(),life.originalDrafts);return current;
 }
 async function binding(target){
  const t=await poll(async()=>{const t=await app.invoke('tasks.get',target.id);return t.nativeSessionId?t:null;},15000);
  // Native ID publication and S binding are separate host commits. The baseline
  // starts after the actual ID is in S, never from an earlier pending identity.
  const d=await poll(async()=>{const row=sql("SELECT snapshot_hash,snapshot_json FROM capability_session_snapshots WHERE task_id='"+target.id+"'")[0];if(!row||JSON.parse(row.snapshot_json).native.sessionId!==t.nativeSessionId)return null;const d=await session(target);return d.snapshotHash===row.snapshot_hash?d:null;},15000);
  return{snapshotHash:d.snapshotHash,nativeSessionId:t.nativeSessionId,runId:d.currentRun.id,ptyId:t.ptyId,packages:d.applications.map(a=>[a.appId,a.packageHash])};
 }
 function validate(phase,expected){
  if(expected==='success'){assert.equal(phase.value.error,undefined,JSON.stringify(phase.value));assert.equal(phase.value.complete,true,JSON.stringify(phase.value));assert.equal(phase.value.matched,1);assert.equal(phase.value.items.length,1);assert.equal(phase.value.items[0].subject,subject);assert.equal(phase.value.items[0].reference.connectionId,life.connectionId);}
  else{assert.equal(phase.value.error?.code,expected,JSON.stringify(phase.value));assert(!JSON.stringify(phase.value).includes(subject));assert.equal(phase.value.items,undefined);}
 }
 async function finish(phase,target,expected,fixedState){
  await poll(async()=>phase.done&&(await app.output((await app.invoke('tasks.get',target.id)).ptyId)).includes(marker+'_AVAIL_'+phase.name+'_DONE'),30000);
  validate(phase,expected);if(fixedState)await fixed(target,fixedState);phase.expected=expected;phase.taskId=target.id;phase.actualSession=await session(target);check(phase.name+' returns '+expected+' and ordinary native response completes',{taskId:target.id,runId:phase.actualSession.currentRun.id});probe.clear();return phase;
 }
 async function query(name,target,expected,fixedState){
  const phase=probe.select('lq-'+name),live=await app.invoke('tasks.get',target.id),prompt=marker+'_LQ_'+name+': Query the selected private mailbox once; no writes or sending.';
  await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId:live.id,ptyId:live.ptyId,data:prompt})});true`);
  await poll(async()=>(await app.output(live.ptyId)).includes(marker+'_LQ_'+name),10000);
  await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId:live.id,ptyId:live.ptyId,data:'\r'})});true`);
  return finish(phase,target,expected,fixedState);
 }
 async function stop(target){await app.invoke('tasks.kill',target.id);await poll(async()=>{const d=await session(target);return !d.currentRun&&d.recentRuns.every(r=>['stopped','failed'].includes(r.state));},30000);}
 async function enable(enabled){const c=await con();return unwrap(await app.invoke('applications.setConnectionEnabled',c.id,enabled,c.revision));}
 async function fault(on){await chmod(source,on?0:originalMode);permissionDenied=on;assert.equal((await stat(source)).mode&0o777,on?0:originalMode);life.permissionFaults.push({at:new Date().toISOString(),mode:on?'000':'700',scope:'Only private lifecycle-mail source directory'});}
 try{
  await mkdir(join(source,'Mail/Inbox'),{recursive:true,mode:originalMode});await chmod(source,originalMode);
  const raw='Date: '+new Date().toUTCString()+'\r\nFrom: sender@example.test\r\nTo: receiver@example.test\r\nSubject: '+subject+'\r\nMessage-ID: <lq-private@example.test>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPRIVATE LQ READ ONLY BODY\r\n';
  await writeFile(join(source,'Mail/Inbox/1.mail'),raw);execFileSync('/usr/bin/sqlite3',[join(source,'messages.db'),"CREATE TABLE mailinfo(mailid INTEGER PRIMARY KEY,subject TEXT,from_ TEXT,to_ TEXT,messageid TEXT,date INTEGER,mail_receivedate INTEGER,fileexist INTEGER,attachment INTEGER);INSERT INTO mailinfo VALUES(1,'private','sender@example.test','receiver@example.test','<lq-private@example.test>',0,0,1,0);"]);
  const config={kind:'foxmail',sourcePath:source,account:'receiver@example.test',queryDays:30},tested=unwrap(await app.invoke('applications.testConnection',{name:'LQ private local source',expectedRevision:0,config}));
  const connection=unwrap(await app.invoke('applications.saveConnection','mail',tested.operationId,tested.candidateHash));life.connectionId=connection.id;life.originalConnection=connection;
  const selected=await selection();unwrap(await app.invoke('applications.select',{projectId:project.id,appId:'mail',enabled:true,expectedRevision:selected.revision,connections:{foxmail:connection.id,smtp:null}}));
  life.originalDrafts=draftRows();life.originalSource=await sourceTree(source);life.originalBinding=await binding(task);const originalProfile=await readFile(join(state,'m10-native.config.toml'),'utf8');
  check('Real Foxmail verification/save and explicit selection need no secret; existing fixed session retained');
  await query('initial-complete-source',task,'success',life.originalBinding);
  await fault(true);await query('original-unreadable',task,'SOURCE_UNAVAILABLE',life.originalBinding);
  const first=probe.select('lq-new-unreadable');const opened=await app.invoke('tasks.create',{projectId:project.id,dirId:null,aiProfileId:profile.id,firstMessage:marker+'_LQ_NEW_UNREADABLE: Query private local mail once, then a short response. No writes or send.',cols:100,rows:30});other=opened.task;life.taskIds.push(other.id);await finish(first,other,'SOURCE_UNAVAILABLE');life.otherOriginal=await binding(other);assert.notEqual(life.otherOriginal.nativeSessionId,life.originalBinding.nativeSessionId);await fixed(task,life.originalBinding);
  await stop(other);const oldOther=life.otherOriginal;await app.invoke('tasks.open',{taskId:other.id,cols:100,rows:30});
  await poll(async()=>{const d=await session(other);return d.currentRun?.bridge.connected;},45000);life.otherResumed=await binding(other);assert.equal(life.otherResumed.nativeSessionId,oldOther.nativeSessionId);assert.equal(life.otherResumed.snapshotHash,oldOther.snapshotHash);assert.notEqual(life.otherResumed.runId,oldOther.runId);assert.deepEqual(life.otherResumed.packages,oldOther.packages);
  await query('resumed-unreadable',other,'SOURCE_UNAVAILABLE',life.otherResumed);await fixed(task,life.originalBinding);check('New/resumed Agent works despite unreadable source; resume keeps same native ID/fixed bytes and creates only a new run');
  await fault(false);await query('same-resumed-run-source-recovered',other,'success',life.otherResumed);await query('original-run-source-recovered',task,'success',life.originalBinding);
  await enable(false);await fault(true);await fault(false);await query('disabled-after-source-recovery',task,'AUTH_REQUIRED',life.originalBinding);assert.equal((await con()).enabled,false);
  await enable(true);await query('explicit-connection-reenabled',task,'success',life.originalBinding);
  const beforeDisconnect=await con();unwrap(await app.invoke('applications.disconnect',connection.id,beforeDisconnect.revision));assert.equal((await con()).authorization,'disconnected');await query('connection-disconnected',task,'AUTH_REQUIRED',life.originalBinding);
  life.otherBeforeRevokedResume=life.otherResumed;await stop(other);await app.invoke('tasks.open',{taskId:other.id,cols:100,rows:30});
  await poll(async()=>{const d=await session(other);return d.currentRun?.bridge.connected;},45000);life.otherRevokedResumed=await binding(other);
  assert.equal(life.otherRevokedResumed.nativeSessionId,life.otherBeforeRevokedResume.nativeSessionId);assert.equal(life.otherRevokedResumed.snapshotHash,life.otherBeforeRevokedResume.snapshotHash);assert.deepEqual(life.otherRevokedResumed.packages,life.otherBeforeRevokedResume.packages);assert.notEqual(life.otherRevokedResumed.runId,life.otherBeforeRevokedResume.runId);life.otherResumed=life.otherRevokedResumed;
  await query('resumed-after-disconnect',other,'AUTH_REQUIRED',life.otherResumed);await fixed(task,life.originalBinding);check('Native resume rechecks a disconnected connection without granting old authorization or changing fixed identity/packages');
  const disconnected=await con(),candidate=unwrap(await app.invoke('applications.testConnection',{id:connection.id,expectedRevision:disconnected.revision,name:connection.name,config}));const reconnected=unwrap(await app.invoke('applications.saveConnection','mail',candidate.operationId,candidate.candidateHash));assert.equal(reconnected.id,connection.id);assert.equal(reconnected.identityRevision,connection.identityRevision);assert.deepEqual(reconnected.identity,connection.identity);life.reconnected=reconnected;
  await query('same-identity-reconnected',task,'success',life.originalBinding);
  let catalog=unwrap(await app.invoke('applications.catalog')).find(a=>a.appId==='mail');unwrap(await app.invoke('applications.setAdded','mail',false,catalog.revision));await query('application-removed',task,'SCOPE_DENIED',life.originalBinding);
  catalog=unwrap(await app.invoke('applications.catalog')).find(a=>a.appId==='mail');unwrap(await app.invoke('applications.setAdded','mail',true,catalog.revision));assert.equal((await selection()).enabled,false);await query('readded-project-still-disabled',task,'SCOPE_DENIED',life.originalBinding);
  const disabledProject=await selection();unwrap(await app.invoke('applications.select',{projectId:project.id,appId:'mail',enabled:true,expectedRevision:disabledProject.revision,connections:{foxmail:connection.id,smtp:null}}));await query('explicit-project-reauthorization',task,'success',life.originalBinding);await query('other-original-run-after-reauthorization',other,'success',life.otherResumed);
  assert.deepEqual(await sourceTree(source),life.originalSource);const afterProfile=await readFile(join(state,'m10-native.config.toml'),'utf8'),business=s=>{const x=parseToml(s);delete x.tui;return x;};assert.deepEqual(business(afterProfile),business(originalProfile));life.nativeTuiMutation={beforeSha256:sha(originalProfile),afterSha256:sha(afterProfile),beforeTui:parseToml(originalProfile).tui,afterTui:parseToml(afterProfile).tui,businessFieldsPreserved:true,actor:'Actual Codex TUI'};
  await fixed(task,life.originalBinding);await fixed(other,life.otherResumed);check('Final source bytes, original draft, fixed identities/packages and profile business fields retained; no secret or send intent');life.finalConnection=await con();life.finalSelection=await selection();life.status='passed-service-cli-partial';
 }catch(error){life.status='failed';life.error=String(error);throw error;}finally{
  probe.clear();if(permissionDenied){await fault(false);life.faultRestoredInFinally=true;}life.finalSourceMode=(await stat(source)).mode&0o777;
  if(other){await stop(other);life.otherTaskStopped=true;}life.finishedAt=new Date().toISOString();
 }
}
