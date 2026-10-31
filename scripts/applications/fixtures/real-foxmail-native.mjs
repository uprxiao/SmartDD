// T13-T16 real-client comparison: the packaged App reads the user's REAL local Foxmail profile strictly read-only
// through actual Codex/MCP/Worker/native, and every result is compared with an independent reader of the same files.
// Evidence keeps only ids, counts and hashes: no subject, address or body text is written.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
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
