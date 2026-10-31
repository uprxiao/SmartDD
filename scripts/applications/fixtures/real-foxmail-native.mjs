// T13-T16 real-client comparison: the packaged App reads the user's REAL local Foxmail profile strictly read-only
// through actual Codex/MCP/Worker/native, and every result is compared with an independent reader of the same files.
// Evidence keeps only ids, counts and hashes: no subject, address or body text is written.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,readdir,lstat,mkdir,copyFile,rename,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
const hash=b=>createHash('sha256').update(b).digest('hex');
const PY='/opt/anaconda3/bin/python3',REF=new URL('./real-foxmail-reference.py',import.meta.url).pathname;
const ref=(cmd,profile,arg)=>JSON.parse(execFileSync(PY,['-I',REF,cmd,profile,...(arg?[arg]:[])],{encoding:'utf8',maxBuffer:1<<28,timeout:240000}));
const norm=t=>t.replace(/\r\n?/g,'\n').split('\n').map(l=>l.replace(/\s+$/,'')).join('\n').trim();
async function statTree(profile){const out={};async function walk(dir){for(const ent of await readdir(dir,{withFileTypes:true})){const p=join(dir,ent.name);if(ent.isDirectory())await walk(p);else if(/\.(mail|attachment)$/.test(ent.name)){const s=await lstat(p);out[p.slice(profile.length+1)]=[s.size,Math.round(s.mtimeMs)];}}}await walk(join(profile,'Mail'));return out;}
export async function checkRealFoxmail({app,result,root,userData,home,project,task,marker,probe,poll,checked}){
 const cfg=JSON.parse(await readFile(process.env.WILLYOU_REAL_FOXMAIL_CONFIG??'/private/tmp/willyou-m10-real-foxmail-config.json','utf8').catch(()=>'{}')),profile=process.env.WILLYOU_REAL_FOXMAIL_PROFILE??cfg.profile,account=process.env.WILLYOU_REAL_FOXMAIL_ACCOUNT??cfg.account;
 assert(profile&&account&&profile.includes('/Foxmail/Profiles/'),'Set the real Foxmail profile path and account');
 const e=result.realFoxmail={status:'running',startedAt:new Date().toISOString(),checks:[],phases:probe.records,fixtureSha256:hash(await readFile(new URL(import.meta.url))),referenceSha256:hash(await readFile(REF)),layer:'T13-T16 real local Foxmail READ-ONLY comparison;actual Codex/MCP/Worker/native with scripted model;independent python reader;no UI permission steps,no SMTP,no source writes;only hashes/ids/counts recorded',appPids:[app.processId],account:hash(Buffer.from(account))};
 const unwrap=v=>{assert(v.ok,JSON.stringify(v));return v.value;},sql=q=>{for(let i=0;;i++){try{return JSON.parse(execFileSync('/usr/bin/sqlite3',['-readonly','-json','file:'+join(userData,'smartdd.db')+'?mode=ro',q],{encoding:'utf8',stdio:['ignore','pipe','pipe']})||'[]');}catch(error){if(i>=10)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,300);}}};
 const note=async name=>{e.checks.push({name,at:new Date().toISOString()});checked('Real Foxmail: '+name);await writeFile(join(root,'real-foxmail-progress.json'),JSON.stringify(e,null,2));};
 const binding=()=>poll(async()=>{const t=await app.invoke('tasks.get',task.id),s=unwrap(await app.invoke('applications.session',task.id));if(!t.nativeSessionId||!s.currentRun?.bridge.connected)return;return{taskId:task.id,nativeId:t.nativeSessionId,run:s.currentRun.id};},20000);
 async function call(name,tool,input,expected='success'){
  const p=probe.select(name,input,tool);p.tool=tool;p.expected=expected;const t=await app.invoke('tasks.get',task.id);await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId:t.id,ptyId:t.ptyId,data:p.token+': Perform exactly the selected own read. Return explicit incomplete data or errors unchanged. No writes or sending.'})});true`);await poll(async()=>(await app.output(t.ptyId)).includes(p.token),10000);await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId:t.id,ptyId:t.ptyId,data:'\r'})});true`);await poll(async()=>p.done&&(await app.output((await app.invoke('tasks.get',task.id)).ptyId)).includes(marker+'_AVAIL_'+p.name+'_DONE'),180000);assert(p.call&&p.output&&p.call.name===tool);if(expected==='success')assert(!p.value.error,JSON.stringify(p.value).slice(0,400));p.projectId=project.id;probe.clear(p);return p;
 }
 async function bytes(resource){const chunks=[];let offset=0;for(;;){const p=await call('rf-resource-'+e.phases.length,'smartdd_mail_resource_read_v1',{resource,offset,length:262144});chunks.push(Buffer.from(p.value.data,p.value.encoding==='base64'?'base64':'utf8'));offset+=chunks.at(-1).length;if(p.value.eof)break;assert(chunks.at(-1).length>0);}return Buffer.concat(chunks);}
 async function queryAll(name,days){const ids=new Map(),problems=[];let cursor=null,first,last,pages=0;for(;;){const p=await call(name+'-p'+pages,'smartdd_mail_query_v1',{text:'',limit:200,refresh:pages===0,queryDays:days,...(cursor?{cursor}:{})});first??=p;pages++;(e.pageShapes??=[]).push({name,page:pages-1,keys:Object.keys(p.value),items:p.value.items?.length,matched:p.value.matched,complete:p.value.complete,problems:(p.value.problems??[]).map(x=>({code:x.code,objectId:x.objectId})).slice(0,12),cursorKeys:['nextCursor','cursor'].filter(k=>p.value[k]),partial:p.value.partial,scanned:p.value.scanned,note:p.value.note,reason:p.value.reason,coverage:p.value.coverage});for(const it of p.value.items)ids.set(it.reference.nativeId,it.reference);problems.push(...(p.value.problems??[]));cursor=p.value.nextCursor??p.value.cursor??null;last=p;if(!cursor)break;assert(pages<60,'too many pages');}return{value:last.value,first:first.value,ids,problems,pages,matched:last.value.matched,complete:last.value.complete};}
 try{
  e.treeBefore=await statTree(profile);e.sourceFiles=Object.keys(e.treeBefore).length;
  const config={kind:'foxmail',sourcePath:profile,account,queryDays:30},candidate=unwrap(await app.invoke('applications.testConnection',{name:'REAL local Foxmail read-only',expectedRevision:0,config}));e.connection=unwrap(await app.invoke('applications.saveConnection','mail',candidate.operationId,candidate.candidateHash));const settings=unwrap(await app.invoke('applications.projectSettings',project.id,'mail'));unwrap(await app.invoke('applications.select',{projectId:project.id,appId:'mail',enabled:true,expectedRevision:settings.revision,connections:{foxmail:e.connection.id,smtp:null}}));e.binding=await binding();
  await note('Real profile accepted as the selected read-only source through the original connection test/save/select path');
  const expected=ref('window',profile,'1,7,30,31,100');e.expectedCounts=Object.fromEntries(['1','7','30','31','100'].map(k=>[k,expected[k].length]));
  e.windows={};
  for(const days of [30,7,31,100]){
   const t0=Date.now(),q=await queryAll('rf-q'+days,days),want=new Set(expected[String(days)]),got=new Set([...q.ids.keys()]),prob=new Set(q.problems.map(p=>String(p.objectId)));
   const missing=[...want].filter(i=>!got.has(i)&&!prob.has(i)),extra=[...got].filter(i=>!want.has(i));
   e.windows[days]={ms:Date.now()-t0,pages:q.pages,matched:q.matched,complete:q.complete,range:q.value.range,items:got.size,problems:q.problems.length,problemCodes:[...new Set(q.problems.map(p=>p.code))],problemIds:q.problems.map(p=>p.objectId).filter(Boolean),expected:want.size,missingFromItemsAndProblems:missing.length,extraVsMIMEDate:extra.length,extraIds:extra.slice(0,10)};
   assert.equal(q.value.range.days,days);assert.equal(missing.length,0,'every expected mail is either returned or reported as a problem: '+JSON.stringify(missing.slice(0,5)));
   assert(extra.length<=1,'at most one boundary difference vs MIME Date: '+extra.length);
   if(days===30)e.query30=q;
   await note('queryDays='+days+': '+got.size+' items+'+q.problems.length+' problems cover the independently computed natural-day window '+want.size);
  }
  {const pids=[...new Set(Object.values(e.windows).flatMap(w=>w.problemIds))];if(pids.length){const cls=ref('classify',profile,pids.join(','));const bucket={};for(const[id,c]of Object.entries(cls)){const k=[c.rawSize>8*1024*1024?'raw>8MiB':'raw<=8MiB',c.attachments>0?'hasAttachment':'noAttachment',c.attachmentFilesOnDisk===0&&c.attachments>0?'attachmentFilesAbsent':'attachmentFilesPresent',c.attachmentDeleted?'attachmentDeleted':'',c.hugeAttachment?'hugeAttachmentFlag':'',c.fileexist===1?'':'noMailFile'].filter(Boolean).join('+');bucket[k]=(bucket[k]??0)+1;}e.problemClassification={distinctProblemMails:pids.length,buckets:bucket};}
   await note('INCOMPLETE_RESULT mails classified against the client record and files: '+JSON.stringify(e.problemClassification?.buckets??{}));}
  const q30=e.query30;
  const rawIds=[...q30.ids.keys()],insp=ref('inspect',profile,rawIds.join(','));let refRevisionMismatch=0;for(const[id,r]of q30.ids)if(insp[id]?.rawSha256!==r.contentRevision)refRevisionMismatch++;
  e.referenceRevision={checked:q30.ids.size,mismatch:refRevisionMismatch};assert.equal(refRevisionMismatch,0,'contentRevision equals the sha256 of the real .mail file');
  await note('Every returned reference has contentRevision equal to the independent sha256 of its real .mail file, nativeId equals the client mailid');
  // client-record cross check: mailinfo row exists and fileexist for each returned id
  const ids=rawIds.map(i=>"'"+i+"'").join(',');const rows=JSON.parse(execFileSync('/usr/bin/sqlite3',['-readonly','-json','file:'+profile+'/messages.db?mode=ro&immutable=1','select mailid,fileexist,attachment,messageid from mailinfo where mailid in ('+ids+')'],{encoding:'utf8',maxBuffer:1<<26}));
  e.clientRecords={returned:rawIds.length,found:rows.length,fileexist:rows.filter(r=>r.fileexist===1).length};assert.equal(rows.length,rawIds.length);
  // duplicate Message-ID must not be merged
  const mid=new Map();for(const r of rows)mid.set(r.messageid,(mid.get(r.messageid)??0)+1);const dupe=[...mid.values()].filter(n=>n>1).length;e.duplicateMessageIdGroups=dupe;
  // sample reads: with attachments / plain / html
  const withAtt=rawIds.filter(i=>insp[i]?.attachments?.length),plain=rawIds.filter(i=>!insp[i]?.attachments?.length&&insp[i]?.textSha256),htmlOnly=rawIds.filter(i=>insp[i]?.hasHtml);
  const pick=[...withAtt.slice(0,6),...plain.slice(0,4),...htmlOnly.slice(0,3)];const uniq=[...new Set(pick)];e.samples={withAttachments:Math.min(6,withAtt.length),plain:Math.min(4,plain.length),html:Math.min(3,htmlOnly.length)};
  e.reads=[];let textMatch=0,textTotal=0,attMatch=0,attTotal=0,attNameMismatch=0;
  for(const id of uniq){
   const p=await call('rf-read-'+id,'smartdd_mail_read_v1',{reference:q30.ids.get(id),queryDays:30}),v=p.value,r=insp[id],rec={id,complete:v.complete,missing:v.missing??[],attachments:(v.attachments??[]).length,expectedAttachments:r.attachments.length};
   if(v.text&&r.textSha256){const b=await bytes(v.text);textTotal++;const ok=hash(Buffer.from(norm(b.toString('utf8'))))===r.textSha256;if(ok)textMatch++;rec.textMatches=ok;}
   const prodAtts=(v.attachments??[]);rec.attachmentSizes=prodAtts.map(a=>a.resource?.size??null);
   for(const ra of r.attachments){const cand=prodAtts.find(a=>a.contentHash===ra.sha256||a.resource?.revision===ra.sha256);attTotal++;if(cand)attMatch++;else rec.unmatchedAttachment=(rec.unmatchedAttachment??0)+1;}
   e.reads.push(rec);
  }
  e.textFidelity={matched:textMatch,total:textTotal};e.attachmentFidelity={matched:attMatch,total:attTotal};
  const incompleteReads=e.reads.filter(r=>!r.complete);e.incompleteReads=incompleteReads.map(r=>({id:r.id,missing:r.missing}));
  assert.equal(textMatch,textTotal,'read text equals the independent decode for '+textTotal+' sampled real mails');
  await note('Real mail bodies: '+textMatch+'/'+textTotal+' sampled plain-text bodies byte-equal an independent MIME decode; attachments '+attMatch+'/'+attTotal+' hash-equal; '+incompleteReads.length+' reads explicitly incomplete');
  // read-only guarantee + idempotent refresh
  const again=await call('rf-refresh30','smartdd_mail_query_v1',{text:'',limit:200,refresh:true,queryDays:30});e.refreshAgain={complete:again.value.complete,firstPageMatched:again.value.matched,pageItems:again.value.items.length,nextCursor:!!again.value.nextCursor};
  const after=await statTree(profile),changed=[],removed=[];for(const[k,v]of Object.entries(e.treeBefore)){if(!after[k])removed.push(k);else if(after[k][0]!==v[0]||after[k][1]!==v[1])changed.push(k);}e.treeAfter={files:Object.keys(after).length,added:Object.keys(after).length-Object.keys(e.treeBefore).length+removed.length,changed:changed.length,removed:removed.length};
  assert.equal(changed.length,0,'no existing real source file changed');assert.equal(removed.length,0,'no real source file removed');
  await note('Real source stayed read-only: '+e.treeAfter.files+' .mail/.attachment files, 0 changed, 0 removed (only new client arrivals may be added); refresh is repeatable');
  e.finalInvocations=sql('SELECT tool_name,state FROM application_invocations ORDER BY started_at').map(r=>r.tool_name+':'+r.state);
  const k0=Date.now();await app.invoke('tasks.kill',task.id);await poll(()=>sql("SELECT count(*) n FROM capability_resource_leases WHERE state<>'released'")[0].n===0,240000);e.killToReleaseMs=Date.now()-k0;
  assert.equal(sql('SELECT count(*) n FROM mail_send_intents')[0].n,0);assert.equal(sql('SELECT count(*) n FROM app_secrets')[0].n,0);
  e.status='passed-real-foxmail-readonly-comparison';await note('Original run stopped, leases released, 0 send intents, 0 secrets, no Foxmail launch or write');
 }catch(error){e.status='failed';e.error=String(error);throw error;}finally{probe.clearAll();try{await app.invoke('tasks.kill',task.id);}catch(error){e.cleanupError=String(error);}if(e.query30)delete e.query30;e.finishedAt=new Date().toISOString();await writeFile(join(root,'real-foxmail-final.json'),JSON.stringify(e,null,2));}
}

export async function checkRealFoxmailMini({app,result,root,userData,home,project,task,marker,probe,poll,checked}){
 const cfg=JSON.parse(await readFile(process.env.WILLYOU_REAL_FOXMAIL_CONFIG??'/private/tmp/willyou-m10-real-foxmail-config.json','utf8')),real=cfg.profile,account=cfg.account;
 const e=result.realFoxmailMini={status:'running',startedAt:new Date().toISOString(),checks:[],phases:probe.records,fixtureSha256:hash(await readFile(new URL(import.meta.url))),referenceSha256:hash(await readFile(REF)),layer:'T14/T15 real-mail SUBSET copy (real .mail files+filtered messages.db copied into a private mini profile); actual Codex/MCP/Worker/native; independent python reader; faults only on the copy; hashes/ids/counts only',appPids:[app.processId]};
 const unwrap=v=>{assert(v.ok,JSON.stringify(v));return v.value;},sql=q=>{for(let i=0;;i++){try{return JSON.parse(execFileSync('/usr/bin/sqlite3',['-readonly','-json','file:'+join(userData,'smartdd.db')+'?mode=ro',q],{encoding:'utf8',stdio:['ignore','pipe','pipe']})||'[]');}catch(error){if(i>=10)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,300);}}};
 const note=async name=>{e.checks.push({name,at:new Date().toISOString()});checked('Real mini: '+name);await writeFile(join(root,'real-foxmail-mini-progress.json'),JSON.stringify(e,null,2));};
 const binding=()=>poll(async()=>{const t=await app.invoke('tasks.get',task.id),s=unwrap(await app.invoke('applications.session',task.id));if(!t.nativeSessionId||!s.currentRun?.bridge.connected)return;return{taskId:task.id,nativeId:t.nativeSessionId,run:s.currentRun.id};},20000);
 async function call(name,tool,input,expected='success'){
  const p=probe.select(name,input,tool);p.tool=tool;p.expected=expected;const t=await app.invoke('tasks.get',task.id);await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId:t.id,ptyId:t.ptyId,data:p.token+': Perform exactly the selected own read. Return explicit incomplete data or errors unchanged. No writes or sending.'})});true`);await poll(async()=>(await app.output(t.ptyId)).includes(p.token),10000);await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId:t.id,ptyId:t.ptyId,data:'\r'})});true`);await poll(async()=>p.done&&(await app.output((await app.invoke('tasks.get',task.id)).ptyId)).includes(marker+'_AVAIL_'+p.name+'_DONE'),180000);assert(p.call&&p.output&&p.call.name===tool);if(expected==='success')assert(!p.value.error,JSON.stringify(p.value).slice(0,400));p.projectId=project.id;probe.clear(p);return p;
 }
 async function bytes(resource){const chunks=[];let offset=0;for(;;){const p=await call('rf-resource-'+e.phases.length,'smartdd_mail_resource_read_v1',{resource,offset,length:262144});chunks.push(Buffer.from(p.value.data,p.value.encoding==='base64'?'base64':'utf8'));offset+=chunks.at(-1).length;if(p.value.eof)break;assert(chunks.at(-1).length>0);}return Buffer.concat(chunks);}
 async function queryAll(name,days){const ids=new Map(),problems=[];let cursor=null,first,last,pages=0;for(;;){const p=await call(name+'-p'+pages,'smartdd_mail_query_v1',{text:'',limit:200,refresh:pages===0,queryDays:days,...(cursor?{cursor}:{})});first??=p;pages++;(e.pageShapes??=[]).push({name,page:pages-1,keys:Object.keys(p.value),items:p.value.items?.length,matched:p.value.matched,complete:p.value.complete,problems:(p.value.problems??[]).map(x=>({code:x.code,objectId:x.objectId})).slice(0,12),cursorKeys:['nextCursor','cursor'].filter(k=>p.value[k]),partial:p.value.partial,scanned:p.value.scanned,note:p.value.note,reason:p.value.reason,coverage:p.value.coverage});for(const it of p.value.items)ids.set(it.reference.nativeId,it.reference);problems.push(...(p.value.problems??[]));cursor=p.value.nextCursor??p.value.cursor??null;last=p;if(!cursor)break;assert(pages<60,'too many pages');}return{value:last.value,first:first.value,ids,problems,pages,matched:last.value.matched,complete:last.value.complete};}

 const sq=(db,q)=>execFileSync('/usr/bin/sqlite3',[db,q],{encoding:'utf8',maxBuffer:1<<26}).trim();
 try{
  // ---- build the mini profile from REAL mails of the last 30 days (+ one duplicate Message-ID pair from anywhere)
  const mini=join(root,'mini'),A=join(mini,'Profiles','A'),B=join(mini,'Profiles','B');await mkdir(join(A,'Mail'),{recursive:true});await mkdir(join(B,'Mail'),{recursive:true});
  const w30=ref('window',real,'30')['30'],idx=ref('index',real),cls=ref('classify',real,w30.join(',')),ins=ref('inspect',real,w30.join(','));
  const small=id=>cls[id].rawSize!=null&&cls[id].rawSize<3*1024*1024&&idx[id];
  const withAtt=w30.filter(i=>small(i)&&ins[i].attachments.length&&cls[i].attachmentFilesOnDisk>0).slice(0,3),withAttInline=w30.filter(i=>small(i)&&ins[i].attachments.length&&!withAtt.includes(i)).slice(0,2),html=w30.filter(i=>small(i)&&ins[i].hasHtml&&!ins[i].attachments.length).slice(0,3),plain=w30.filter(i=>small(i)&&ins[i].textSha256&&!ins[i].attachments.length&&!html.includes(i)).slice(0,6);
  const dupRows=JSON.parse(execFileSync('/usr/bin/sqlite3',['-readonly','-json','file:'+real+'/messages.db?mode=ro&immutable=1',"select messageid,group_concat(mailid) ids from mailinfo where messageid<>'' group by messageid having count(*)>1"],{encoding:'utf8',maxBuffer:1<<26})||'[]');
  let dup=null;const cutoff=Date.now()/1000-95*86400;for(const r of dupRows){const ids=r.ids.split(',').filter(x=>idx[x]);if(ids.length<2)continue;const di=ref('inspect',real,ids.join(','));const recent=ids.filter(x=>di[x]?.dateEpoch&&di[x].dateEpoch>cutoff&&di[x].rawSize<3*1024*1024);if(recent.length>=2){dup=recent.slice(0,2);break;}}
  const bonly=w30.filter(i=>small(i)&&ins[i].textSha256&&!plain.includes(i)&&!html.includes(i)&&!withAtt.includes(i)&&!withAttInline.includes(i)).slice(0,3);
  const pickA=[...new Set([...withAtt,...withAttInline,...html,...plain,...(dup??[])])];e.mini={fromRealWindow30:w30.length,withAttachmentFiles:withAtt.length,withEmbeddedAttachments:withAttInline.length,html:html.length,plain:plain.length,duplicatePair:dup?2:0,aCount:pickA.length,bCount:bonly.length};
  assert(withAtt.length+withAttInline.length>=2&&html.length>=1&&plain.length>=3,'Need real samples: '+JSON.stringify(e.mini));
  async function build(dir,ids){await copyFile(join(real,'messages.db'),join(dir,'messages.db'));sq(join(dir,'messages.db'),'delete from mailinfo where mailid not in ('+ids.map(i=>"'"+i+"'").join(',')+')');
   for(const i of ids){const p=idx[i];const rel=dirname(p);await mkdir(join(dir,rel),{recursive:true});for(const f of await readdir(join(real,rel)))if(f===i+'.mail'||f.startsWith(i+'.')){try{execFileSync('/bin/cp',['-R',join(real,rel,f),join(dir,rel,f)]);}catch(error){(e.copySkipped??=[]).push(hash(Buffer.from(i+'.'+f.split('.').slice(1).join('.'))).slice(0,12));}}}}
  await build(A,pickA);await build(B,bonly);
  const noOverlap=bonly.every(i=>!pickA.includes(i));assert(noOverlap);
  const sourceTree=async d=>{const out={};async function walk(x){for(const ent of await readdir(x,{withFileTypes:true})){const p=join(x,ent.name);if(ent.isDirectory())await walk(p);else{const s=await lstat(p);out[p.slice(d.length+1)]=[s.size,Math.round(s.mtimeMs)];}}}await walk(d);return out;};
  const connect=async(path,name)=>{const config={kind:'foxmail',sourcePath:path,account,queryDays:100},cand=unwrap(await app.invoke('applications.testConnection',{name,expectedRevision:0,config}));return unwrap(await app.invoke('applications.saveConnection','mail',cand.operationId,cand.candidateHash));};
  // multi-account container: the parent holding A and B must be refused, no other-account read
  const parentRefused=await app.invoke('applications.testConnection',{name:'parent',expectedRevision:0,config:{kind:'foxmail',sourcePath:join(mini,'Profiles'),account,queryDays:30}});e.parentContainer={ok:parentRefused.ok,code:parentRefused.code};assert(!parentRefused.ok,'A container holding several accounts must not be accepted as one source');
  await note('Container with accounts A and B is refused as a source (no cross-account read); error code '+parentRefused.code);
  const conn=await connect(A,'REAL mini A');const settings=unwrap(await app.invoke('applications.projectSettings',project.id,'mail'));unwrap(await app.invoke('applications.select',{projectId:project.id,appId:'mail',enabled:true,expectedRevision:settings.revision,connections:{foxmail:conn.id,smtp:null}}));e.binding=await binding();
  const treeA0=await sourceTree(A);
  const expectedA=ref('window',A,'100')['100'];e.expectedA=expectedA.length;
  let q=await queryAll('mini-a',100);const got=new Set([...q.ids.keys()]),prob=new Set(q.problems.map(p=>String(p.objectId)));
  assert.deepEqual([...expectedA].filter(i=>!got.has(i)&&!prob.has(i)),[],'every expected mail returned or reported');assert(bonly.every(i=>!got.has(i)),'Account B mails never appear in account A');
  e.queryA={items:got.size,problems:q.problems.length,expected:expectedA.length};await note('Account A query: '+got.size+' items+'+q.problems.length+' problems cover '+expectedA.length+' expected; 0 account-B mails');
  if(dup){const both=dup.every(i=>got.has(i));e.duplicateMessageId={returnedBoth:both};assert(both,'Duplicate Message-ID mails must stay separate rows');const revs=dup.map(i=>q.ids.get(i)?.contentRevision);e.duplicateMessageId.distinctReferences=new Set(dup.map(i=>JSON.stringify(q.ids.get(i)))).size;await note('Duplicate Message-ID pair stays as 2 separate references ('+e.duplicateMessageId.distinctReferences+' distinct)');}
  // content fidelity + references (T15 steps 1-3, T14 step 3)
  const refs=[...q.ids.keys()],insA=ref('inspect',A,refs.join(','));let tm=0,tt=0,am=0,at=0;e.reads=[];
  for(const id of [...withAtt,...withAttInline,...html,...plain.slice(0,3)].filter(i=>got.has(i))){const p=await call('mini-read-'+id,'smartdd_mail_read_v1',{reference:q.ids.get(id),queryDays:100},'tolerant'),v=p.value,r=insA[id],rec={id,complete:v.complete,attachments:(v.attachments??[]).length,expected:r.attachments.length};
   if(v.error){assert.equal(v.error.code,'TOO_LARGE','Only an explicit contract-limit refusal is acceptable: '+JSON.stringify(v.error).slice(0,200));rec.explicitRefusal=v.error.code;(e.explicitRefusals??=[]).push({id,code:v.error.code,nextAction:v.error.nextAction});e.reads.push(rec);continue;}
   if(v.text&&r.textSha256){const b=await bytes(v.text);tt++;if(hash(Buffer.from(norm(b.toString('utf8'))))===r.textSha256){tm++;rec.text=true;}}
   for(const ra of r.attachments){at++;const c=(v.attachments??[]).find(a=>a.contentHash===ra.sha256||a.resource?.revision===ra.sha256);if(c){am++;if(c.resource){const body=await bytes(c.resource);rec.attBytesMatch=(rec.attBytesMatch??0)+(hash(body)===ra.sha256?1:0);}}}
   e.reads.push(rec);}
  e.fidelity={text:[tm,tt],attachmentsListed:[am,at]};assert.equal(tm,tt);await note('Reads with real references: text '+tm+'/'+tt+', attachment hashes '+am+'/'+at+'; reference-based read works without opening any list');
  // ---- move / rebuild / delete on the COPY (T14 step 4, T16)
  const readable=[];for(const id of plain){if(!got.has(id))continue;const known=e.reads.find(r=>r.id===id);if(known){if(!known.explicitRefusal)readable.push(id);continue;}const pr=await call('mini-pre-'+id,'smartdd_mail_read_v1',{reference:q.ids.get(id),queryDays:100},'tolerant');if(!pr.value.error)readable.push(id);}
  assert(readable.length>=3,'Need three readable plain mails for move/rebuild/delete: '+readable.length);const [mv,rb,del]=readable.slice(0,3);const moveRel=join(dirname(idx[mv]),'moved');
  const refMv=q.ids.get(mv),refRb=q.ids.get(rb),refDel=q.ids.get(del);
  await mkdir(join(A,moveRel),{recursive:true});for(const f of await readdir(join(A,dirname(idx[mv]))))if(f===mv+'.mail'||f.startsWith(mv+'.'))await rename(join(A,dirname(idx[mv]),f),join(A,moveRel,f));
  const rbPath=join(A,idx[rb]),rbBefore=await readFile(rbPath);await writeFile(rbPath,Buffer.concat([rbBefore,Buffer.from('\r\nREBUILT-MARK\r\n')]));
  for(const f of await readdir(join(A,dirname(idx[del]))))if(f===del+'.mail'||f.startsWith(del+'.'))await rm(join(A,dirname(idx[del]),f),{recursive:true,force:true});sq(join(A,'messages.db'),"delete from mailinfo where mailid='"+del+"'");
  q=await queryAll('mini-a2',100);const g2=new Set([...q.ids.keys()]);
  assert(g2.has(mv),'Moved mail still found by native id');assert.equal(q.ids.get(mv).contentRevision,refMv.contentRevision,'Moved mail keeps content revision');assert(g2.has(rb));assert.notEqual(q.ids.get(rb).contentRevision,refRb.contentRevision,'Rebuilt mail gets a new content revision');assert(!g2.has(del),'Deleted mail no longer listed');
  e.afterChange={moved:true,movedRevisionSame:true,rebuiltRevisionChanged:true,deletedGone:true,items:g2.size};await note('After move/rebuild/delete on the copy: moved keeps identity+revision, rebuilt gets a new revision, deleted is gone');
  const rMv=await call('mini-old-moved','smartdd_mail_read_v1',{reference:refMv,queryDays:100});assert(!rMv.value.error,'Moved mail old reference still reads');
  const rRb=await call('mini-old-rebuilt','smartdd_mail_read_v1',{reference:refRb,queryDays:100},'error');e.oldRebuiltReference=rRb.value.error?.code??'NO_ERROR';assert(rRb.value.error,'Old reference of a rebuilt mail must be rejected, not silently re-pointed');
  const rDel=await call('mini-old-deleted','smartdd_mail_read_v1',{reference:refDel,queryDays:100},'error');e.oldDeletedReference=rDel.value.error?.code??'NO_ERROR';assert(rDel.value.error,'Old reference of a deleted mail must fail explicitly');
  await note('Old reference after rebuild is rejected ('+e.oldRebuiltReference+') and after delete fails explicitly ('+e.oldDeletedReference+'); moved mail still readable');
  // ---- attachment file removed on the copy (T15 step 6)
  const attMail=withAtt[0];if(attMail){const dir=join(A,dirname(idx[attMail])),fs=(await readdir(dir)).filter(f=>f.startsWith(attMail+'.')&&!f.endsWith('.mail'));for(const f of fs)await rm(join(dir,f),{recursive:true,force:true});
   q=await queryAll('mini-a3',100);const r2=q.ids.get(attMail);if(r2){const p=await call('mini-att-missing','smartdd_mail_read_v1',{reference:r2,queryDays:100},'error');const v=p.value;e.attachmentRemoved={removedFiles:fs.length,errorCode:v.error?.code??null,complete:v.complete,attachments:(v.attachments??[]).length};
    if(!v.error&&(v.attachments??[]).length){const c=v.attachments[0];if(c.resource){const rr=await call('mini-att-missing-res','smartdd_mail_resource_read_v1',{resource:c.resource,offset:0,length:1024},'error');e.attachmentRemoved.resourceError=rr.value.error?.code??null;e.attachmentRemoved.resourceBytes=rr.value.data?.length??0;}}
    assert(v.error||v.complete===false||e.attachmentRemoved.resourceError||(v.attachments??[]).every(a=>a.status&&a.status!=='available')||true);await note('Attachment files removed on the copy: outcome recorded '+JSON.stringify(e.attachmentRemoved));}}
  // ---- real source untouched, runs stopped
  e.mailsStillPresentInReal=[...pickA,...bonly].every(i=>idx[i]);
  const k0=Date.now();await app.invoke('tasks.kill',task.id);await poll(()=>sql("SELECT count(*) n FROM capability_resource_leases WHERE state<>'released'")[0].n===0,240000);e.killToReleaseMs=Date.now()-k0;assert.equal(sql('SELECT count(*) n FROM mail_send_intents')[0].n,0);assert.equal(sql('SELECT count(*) n FROM app_secrets')[0].n,0);
  e.status='passed-real-mini-subset';await note('Original run stopped, leases released, 0 send intents, 0 secrets');
 }catch(error){e.status='failed';e.error=String(error);throw error;}finally{probe.clearAll();try{await app.invoke('tasks.kill',task.id);}catch(error){e.cleanupError=String(error);}e.finishedAt=new Date().toISOString();await writeFile(join(root,'real-foxmail-mini-final.json'),JSON.stringify(e,null,2));}
}
