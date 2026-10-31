// T18 steps that never need DATA (unarmed sinks): cancel, attachment stability/replace/failures, sender switch, slot clearing.
import assert from 'node:assert/strict';
import {readFile,writeFile,rm,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {startT18MailSink} from './t18-mail-sink.mjs';

export async function runT18b(c){
 const {stop,stopped,resume,task,app,e,item,command,approved,sql,q,sha,sink,content,project,unwrap,click,source,note,restoreScope,root}=c;
 const t=e.t18b={};
 const rows=()=>sql('SELECT id,state,draft_id,draft_revision,connection_id FROM mail_send_intents');
 const execs=()=>sql('SELECT count(*) n FROM mail_send_executions')[0].n;
 const code=r=>r.value.error?.code??null;
 const noData=()=>{assert.equal(sink.state().counts.dataCommands,0);assert.equal(execs(),0);};
 // Step 2: review, close without sending, then cancel; nothing may be sent.
 await click('dialog button','审阅发送内容');await app.waitFor('document.querySelector("dialog")?.innerText.includes("本次发送内容")');
 const r1=rows();assert.equal(r1.length,1);const intentId=r1[0].id;assert.equal(r1[0].state,'awaiting-authorization');noData();
 await click('dialog button[aria-label="关闭弹窗"]');
 for(let n=0;n<100&&rows()[0].state!=='canceled';n++)await new Promise(r=>setTimeout(r,200));
 assert.equal(rows()[0].state,'canceled');noData();
 const again=await command(item,'t18b-cancel-again','smartdd_mail_send_get_v1',{intentId});assert.equal(again.value.intent?.state,'canceled');
 t.cancel={uiClosedReview:true,intentState:'canceled',agentSeesCanceled:true,executions:0,dataCommands:0};
 await note('T18 step2/3: closing the review in the real UI cancels the intent (Agent reads it as canceled); no execution and no DATA');
 await restoreScope();
 // Step 8: stable attachment copy, replacement revision, copy failure, missing reply source.
 const blobRoot=join(await app.mainEvaluate('globalThis.__ncHistoryProbe.service.blobs.root'),'blobs');
 const oldHash=c.T18_ATTACHMENT?sha(c.T18_ATTACHMENT):null;
 const draftId=e.target.id;let cur=e.target;
 const oldGet=await command(item,'t18b-get-r2','smartdd_mail_draft_get_v1',{draftId,revision:2});assert(!oldGet.value.error);
 const oldAttId=oldGet.value.draft.content.attachmentIds[0];
 const mailPath=join(source,'Mail/Inbox/1.mail'),original=await readFile(mailPath);
 try{
  const changed=Buffer.from('T18_CHANGED_ATTACHMENT_20261031\n'+'y'.repeat(1500)+'\n');
  const text=original.toString('utf8'),old=c.T18_ATTACHMENT.toString('base64').replace(/(.{76})/g,'$1\r\n');
  assert(text.includes(old.slice(0,70)),'original attachment encoded in source');
  await writeFile(mailPath,text.replace(old,changed.toString('base64').replace(/(.{76})/g,'$1\r\n')));
  const q2=await command(item,'t18b-query2','smartdd_mail_query_v1',{refresh:true,limit:10});assert.equal(q2.value.items?.length,1);
  const ref2=q2.value.items[0].reference,rd2=await command(item,'t18b-read2','smartdd_mail_read_v1',{reference:ref2});assert(!rd2.value.error,JSON.stringify(rd2.value));
  const att2=rd2.value.attachments[0];assert.equal(att2.contentHash,sha(changed));
  // the already saved stable copy is unaffected by the source change
  const oldRow=sql('SELECT content_hash FROM mail_attachment_objects WHERE content_hash='+q(oldHash))[0];assert(oldRow);assert.equal(sha(await readFile(join(blobRoot,oldHash))),oldHash);
  const still=await command(item,'t18b-get-r2b','smartdd_mail_draft_get_v1',{draftId,revision:2});assert.equal(still.value.draft.attachments[0].contentHash,oldHash);
  t.sourceChanged={savedCopyStillOldHash:true,newSourceHash:sha(changed)};
  // copy write failure: the stable store cannot write; no half-saved attachment, draft revision unchanged
  const before={objects:sql('SELECT count(*) n FROM mail_attachment_objects')[0].n,revision:sql('SELECT current_revision r FROM mail_drafts WHERE id='+q(draftId))[0].r};
  await chmod(blobRoot,0o500);
  let fail;try{fail=await approved(item,'t18b-import-fail','smartdd_mail_attach_import_v1',{source:{kind:'resource',resource:att2.resource,filename:'t18-changed.txt',contentType:'text/plain'}});}finally{await chmod(blobRoot,0o700);}
  assert(fail.value.error,'copy failure must not look saved: '+JSON.stringify(fail.value).slice(0,200));
  assert.equal(sql('SELECT count(*) n FROM mail_attachment_objects')[0].n,before.objects);assert.equal(sql('SELECT current_revision r FROM mail_drafts WHERE id='+q(draftId))[0].r,before.revision);
  t.copyFailure={code:code(fail),objectsUnchanged:true,draftRevisionUnchanged:before.revision};
  // active replacement forms a new revision, the old revision keeps the old attachment
  const ok=await approved(item,'t18b-import-ok','smartdd_mail_attach_import_v1',{source:{kind:'resource',resource:att2.resource,filename:'t18-changed.txt',contentType:'text/plain'}});assert(!ok.value.error,JSON.stringify(ok.value));
  const up=await command(item,'t18b-replace','smartdd_mail_draft_update_v1',{draftId,expectedRevision:before.revision,content:{...content,attachmentIds:[ok.value.attachment.id]}});assert(!up.value.error,JSON.stringify(up.value));
  cur=up.value.draft;assert.equal(cur.revision,before.revision+1);
  const r2=await command(item,'t18b-get-r2c','smartdd_mail_draft_get_v1',{draftId,revision:2}),r3=await command(item,'t18b-get-r3','smartdd_mail_draft_get_v1',{draftId,revision:cur.revision});
  assert.equal(r2.value.draft.attachments[0].contentHash,oldHash);assert.equal(r3.value.draft.attachments[0].contentHash,sha(changed));
  t.replace={newRevision:cur.revision,oldRevisionHash:oldHash,newRevisionHash:sha(changed)};
  // missing reply source: remove the source file; replying to the old reference must fail without a half draft
  await rm(mailPath);
  const drafts0=sql('SELECT count(*) n FROM mail_drafts')[0].n;
  const rp=await approved(item,'t18b-reply-missing','smartdd_mail_reply_create_v1',{reference:ref2,mode:'reply',senderConnectionId:content.senderConnectionId,text:'T18_MISSING_SOURCE'});
  assert(rp.value.error,'missing source must not fake a reply: '+JSON.stringify(rp.value).slice(0,200));assert.equal(sql('SELECT count(*) n FROM mail_drafts')[0].n,drafts0);
  t.missingReplySource={code:code(rp),draftsUnchanged:true};
 }finally{await writeFile(mailPath,original);}
 await note('T18 step8: saved copy stable after source change; write failure leaves no half attachment; replacement forms new revision; missing reply source refused');
 // Step 13: draft bound to SMTP A; project send slot switched to B.
 const sinkB=await startT18MailSink({root:join(root,'smtp-sink-b')});
 try{
  const tb=unwrap(await app.invoke('applications.testConnection',{name:'T18 SMTP B',expectedRevision:0,config:sinkB.config,secret:sinkB.getPrivateSecret()}));
  const smtpB=unwrap(await app.invoke('applications.saveConnection','mail',tb.operationId,tb.candidateHash,tb.compatibility?.planHash));
  const select=async(connections)=>{const cs=unwrap(await app.invoke('applications.projectSettings',project.id,'mail'));return app.invoke('applications.select',{projectId:project.id,appId:'mail',enabled:true,expectedRevision:cs.revision,connections});};
  const sw=await select({foxmail:e.foxmail.id,smtp:smtpB.id});t.switch={ok:sw.ok??null,raw:JSON.stringify(sw).slice(0,200)};console.log('T18BSWITCH '+t.switch.raw);
  const stale=await command(item,'t18b-prepare-old','smartdd_mail_send_prepare_v1',{draftId,expectedRevision:cur.revision,expectedContentHash:cur.contentHash});
  t.oldDraftAfterSwitch={code:code(stale),prepared:!stale.value.error};console.log('T18BSTALE '+JSON.stringify(t.oldDraftAfterSwitch)+JSON.stringify(stale.value).slice(0,300));
  assert(stale.value.error||rows().every(r=>r.connection_id!==smtpB.id),'old A-bound draft must not silently send through B');
  const upB=await command(item,'t18b-update-sender','smartdd_mail_draft_update_v1',{draftId,expectedRevision:cur.revision,content:{...content,attachmentIds:cur.content.attachmentIds,senderConnectionId:smtpB.id}});assert(!upB.value.error,JSON.stringify(upB.value));
  cur=upB.value.draft;const pb=await command(item,'t18b-prepare-b','smartdd_mail_send_prepare_v1',{draftId,expectedRevision:cur.revision,expectedContentHash:cur.contentHash});assert(!pb.value.error,JSON.stringify(pb.value));
  const nb=rows().find(r=>r.connection_id===smtpB.id);assert(nb);assert.equal(nb.draft_revision,cur.revision);
  t.explicitUpdate={revision:cur.revision,intentConnection:'B',intentState:nb.state};
  const cb=await command(item,'t18b-cancel-b','smartdd_mail_send_cancel_v1',{intentId:nb.id});assert(!cb.value.error);
  // Step 14: clear only one slot at a time.
  const probe=async(label)=>{const out={};
   const dl=await command(item,'t18b-list-'+label,'smartdd_mail_draft_list_v1',{});out.draftList=code(dl)??'ok';
   const qq=await command(item,'t18b-q-'+label,'smartdd_mail_query_v1',{refresh:false,limit:1});out.query=code(qq)??'ok';
   const pp=await command(item,'t18b-p-'+label,'smartdd_mail_send_prepare_v1',{draftId,expectedRevision:cur.revision,expectedContentHash:cur.contentHash});out.sendPrepare=code(pp)??'ok';
   if(!pp.value.error){const ni=rows().filter(r=>r.state==='awaiting-authorization').at(-1);if(ni)await command(item,'t18b-pc-'+label,'smartdd_mail_send_cancel_v1',{intentId:ni.id});}
   return out;};
  const cycle=async()=>{await stop(task);await stopped(item.binding);await resume(item);};assert((await select({foxmail:null,smtp:smtpB.id})).ok);await cycle();t.noReadSource=await probe('noread');console.log('T18BNOREAD '+JSON.stringify(t.noReadSource));
  assert((await select({foxmail:e.foxmail.id,smtp:null})).ok);await cycle();t.noSendSlot=await probe('nosend');console.log('T18BNOSEND '+JSON.stringify(t.noSendSlot));
  assert.equal(t.noReadSource.draftList,'ok');assert.equal(t.noSendSlot.draftList,'ok');assert.notEqual(t.noReadSource.query,'ok');assert.equal(t.noReadSource.sendPrepare,'ok');assert.equal(t.noSendSlot.query,'ok');assert.notEqual(t.noSendSlot.sendPrepare,'ok');
  assert.equal(sinkB.state().counts.dataCommands,0);
 }finally{await sinkB.close();}
 noData();
 await note('T18 step13/14: switching the send slot does not silently rewrite the draft; explicit sender update makes a new revision/intent; clearing one slot only disables its own capability');
 e.status='passed-t18b-nodata';
}
