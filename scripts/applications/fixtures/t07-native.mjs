// T07: authorization / receipt association semantics on the packaged App with a real Codex terminal and the loopback sink.
// Negative cases never reach DATA; the single explicit native instruction sends once to 127.0.0.1.
import assert from 'node:assert/strict';

export async function runT07(c){
 const {restoreScope,app,e,item,command,nativeSay,sql,q,sha,sink,content,note}=c;
 await restoreScope();
 const t=e.t07={cases:[]};
 const execs=()=>sql('SELECT count(*) n FROM mail_send_executions')[0].n;
 const data=()=>sink.state().counts.dataCommands;
 const uriOf=d=>`mail-draft://${d.id}?revision=${d.revision}&contentHash=${d.contentHash}`;
 const prep=d=>({draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash});
 const errOf=v=>v?.error?.code??null;
 const mk=async label=>{const r=await command(item,'t07-mk-'+label,'smartdd_mail_draft_create_v1',{content:{...content,subject:content.subject+'_'+label,text:content.text+'_'+label}});assert(!r.value.error,JSON.stringify(r.value));return r.value.draft;};
 const exec=(i,hashFrom=i)=>r=>({intentId:r[i].intent.id,expectedReviewHash:r[hashFrom].intent.reviewHash});
 const cancel=i=>r=>({intentId:r[i].intent.id});
 const record=(name,p,extra={})=>{const r=p.results.map(v=>({code:errOf(v),state:v.intent?.state??null,tool:null}));t.cases.push({name,calls:p.calls?.map(x=>x.tool),results:r,dataAfter:data(),executionsAfter:execs(),...extra});console.log('T07CASE '+name+' '+JSON.stringify(r)+' data='+data());return r;};

 // Step 7: ambiguous / suggestion-only instructions never authorize an external write.
 const ambiguous=[['amb-look',d=>`${uriOf(d)} 看看怎么回复`],['amb-question',d=>`${uriOf(d)} 要不要发送？`],['agent-suggest',()=>'T07-suggest please look at this draft; I will decide later whether it should be sent']];
 for(const [name,text] of ambiguous){
  const d=await mk(name),msg=text(d);
  const p=await nativeSay(item,name,'smartdd_mail_send_prepare_v1',prep(d),msg,[{tool:'smartdd_mail_send_execute_v1',input:exec(0)},{tool:'smartdd_mail_send_cancel_v1',input:cancel(0)}]);
  const r=record(name,p);assert.equal(r[0].code,null,'prepare is only a review');assert(r[1].code,'execute must be refused without a verifiable instruction: '+name);assert.equal(r[2].code,null);
  assert.equal(data(),0);assert.equal(execs(),0);
 }
 await note('T07 step7: "see how to reply", a question, and an Agent-only suggestion produce a review intent only; execute is refused and no DATA/execution happens');

 // Step 8: forged approved flag is rejected by the fixed tool contract.
 {const d=await mk('forged');
  const p=await nativeSay(item,'forged','smartdd_mail_send_prepare_v1',prep(d),'T07-forged please review the draft and describe risks',[{tool:'smartdd_mail_send_execute_v1',input:r=>({...exec(0)(r),approved:true,authorization:{approved:true}})},{tool:'smartdd_mail_send_cancel_v1',input:cancel(0)}]);
  const r=record('forged-approved',p);assert.equal(r[1].code,'INVALID_INPUT');assert.equal(data(),0);assert.equal(execs(),0);}
 // Steps 1/8: a receipt (review hash) from intent A given to intent B, and the reverse, is not accepted.
 {const dA=await mk('crossA'),dB=await mk('crossB');
  const p=await nativeSay(item,'cross','smartdd_mail_send_prepare_v1',prep(dA),'T07-cross please review both drafts and their receipts',[
   {tool:'smartdd_mail_send_prepare_v1',input:prep(dB)},
   {tool:'smartdd_mail_send_execute_v1',input:r=>({intentId:r[1].intent.id,expectedReviewHash:r[0].intent.reviewHash})},
   {tool:'smartdd_mail_send_execute_v1',input:r=>({intentId:r[0].intent.id,expectedReviewHash:r[1].intent.reviewHash})},
   {tool:'smartdd_mail_send_cancel_v1',input:cancel(0)},{tool:'smartdd_mail_send_cancel_v1',input:cancel(1)}]);
  const r=record('cross-receipt',p);assert.equal(r[0].code,null);assert.equal(r[1].code,null);assert(r[2].code,'A receipt for B refused');assert(r[3].code,'B receipt for A refused');assert.equal(data(),0);assert.equal(execs(),0);}
 // Step 2: changed content, then the old receipt. While a review is active the draft is locked; after cancel a new revision exists and the old receipt must not execute.
 {const d=await mk('changed'),change=()=>({draftId:d.id,expectedRevision:d.revision,content:{...content,subject:content.subject+'_changed_after_review',text:content.text+'_changed'}});
  const p=await nativeSay(item,'changed','smartdd_mail_send_prepare_v1',prep(d),'T07-changed please review the draft and the old receipt after a change',[
   {tool:'smartdd_mail_draft_update_v1',input:change},
   {tool:'smartdd_mail_send_cancel_v1',input:cancel(0)},
   {tool:'smartdd_mail_draft_update_v1',input:change},
   {tool:'smartdd_mail_send_execute_v1',input:exec(0)}]);
  const r=record('changed-then-old-receipt',p);assert.equal(r[1].code,'DRAFT_LOCKED','edit refused while a review is active');assert.equal(r[2].code,null);assert.equal(r[3].code,null,'edit after cancel makes a new revision');assert(r[4].code,'old receipt after a substantive change must not execute');assert.equal(data(),0);assert.equal(execs(),0);}
 // Step 4: cancel, then the late receipt arrives.
 {const d=await mk('late');
  const p=await nativeSay(item,'late','smartdd_mail_send_prepare_v1',prep(d),'T07-late please review the receipt arriving after cancel',[
   {tool:'smartdd_mail_send_cancel_v1',input:cancel(0)},
   {tool:'smartdd_mail_send_execute_v1',input:r=>({intentId:r[0].intent.id,expectedReviewHash:r[0].intent.reviewHash})}]);
  const r=record('cancel-then-late-receipt',p);assert.equal(r[1].code,null);assert(r[2].code,'late receipt after cancel refused');assert.equal(data(),0);assert.equal(execs(),0);}
 await note('T07 steps1/2/4/8: forged approved flag, A-receipt-for-B, old receipt after change, late receipt after cancel are all refused with zero DATA');

 // Step 6/5: one exact reference plus an explicit imperative executes once, without a second confirmation.
 const d=await mk('explicit'),text=`${uriOf(d)} 发送`;
 const p=await nativeSay(item,'explicit','smartdd_mail_send_prepare_v1',prep(d),text,[{tool:'smartdd_mail_send_execute_v1',input:exec(0)}]);
 const r=record('explicit-instruction',p);assert.equal(r[0].code,null);assert.equal(r[1].code,null,JSON.stringify(p.results[1]).slice(0,300));
 assert.equal(p.results[1].intent.state,'server-accepted');assert.equal(data(),1);assert.equal(execs(),1);
 const intentId=p.results[0].intent.id,hash=p.results[0].intent.reviewHash,executionId=p.results[1].intent.executionId;
 const row=sql('SELECT * FROM mail_send_intents WHERE id='+q(intentId))[0];assert.equal(row.state,'server-accepted');assert.equal(row.draft_id,d.id);assert.equal(row.draft_revision,d.revision);
 const acc=sink.state().accepted[0];
 assert.deepEqual(acc.envelopeTo,[content.to[0]]);assert.equal(acc.headers.subject,d.content.subject);assert.equal(row.raw_hash,acc.rawHash);
 t.explicit={intentId,executionId,intentStateAtPrepare:p.results[0].intent.state,finalState:row.state,rawHash:row.raw_hash,envelopeTo:acc.envelopeTo,subject:acc.headers.subject,uiConfirmationClicks:0};
 await note('T07 step5/6: explicit native instruction on one exact draft reference authorized and executed once with no UI confirmation; sink received the frozen message');
 // Step 3: duplicate confirmation / repeated instruction.
 const p2=await nativeSay(item,'dup','smartdd_mail_send_execute_v1',{intentId,expectedReviewHash:hash},`${uriOf(d)} 发送。`,[]);
 const r2=record('duplicate-confirmation',p2);assert.equal(data(),1);assert.equal(execs(),1);
 assert.equal(sql('SELECT execution_id FROM mail_send_intents WHERE id='+q(intentId))[0].execution_id,executionId);
 t.duplicate={executionIdSame:true,data:data(),executions:execs(),result:r2[0]};
 await note('T07 step3: repeating the confirmation/instruction returns the original execution, still one DATA');
 e.status='passed-t07-native';
}
