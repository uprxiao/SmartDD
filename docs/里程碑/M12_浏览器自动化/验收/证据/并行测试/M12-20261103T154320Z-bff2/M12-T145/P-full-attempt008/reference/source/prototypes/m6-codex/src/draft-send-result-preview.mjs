import {DEMO_MAIL_DRAFT} from './integration-model.mjs';
import {draftTargetFixture} from './mail-draft-target-fixtures.mjs';
// Existing synthetic operation identity only;no user addresses/body or authorizations are stored.
export function demoDraftSendResult(data,projectId,draft){
 if(!draft||draft.project!==projectId||!['success','failed','unknown'].includes(draft.status))return null;
 const record=(data.activity||[]).find(r=>r.app==='mail'&&r.category==='write'&&r.project===projectId&&r.draftId===draft.id&&r.revision===draft.revision&&r.status===draft.status&&/^[a-zA-Z0-9_-]{1,120}$/.test(r.id));if(!record)return null;
 const to=draftTargetFixture(draft.fixture)?.to??[DEMO_MAIL_DRAFT.to],state={success:'server-accepted',failed:'failed',unknown:'unknown'}[record.status];
 return{id:record.id,executionId:'demo-execution-'+record.id,messageId:'<demo-'+record.id+'@example.invalid>',state,updatedAt:record.at,accepted:record.status==='success'?to:[],rejected:record.status==='failed'?to:[],errorCode:record.status==='unknown'?'SEND_UNKNOWN':record.status==='failed'?'RECIPIENTS_REJECTED':null};
}
