// T21 non-examined source preparation only. The terminal send history is synthetic;
// no SMTP transport, authorization grant, Task or Agent is created or invoked.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import type Database from 'better-sqlite3';
import {ResourceStore} from '../../../src/main/core/applications/resource-store';
import {MailBlobStore} from '../../../src/main/core/applications/mail-blob-store';
import {MailDraftService} from '../../../src/main/core/applications/mail-draft-service';
import {ApplicationActivityService} from '../../../src/main/core/applications/activity-service';
import {readDraftSendHistory} from '../../../src/main/core/applications/mail-draft-send-history';
import {canonicalJson,digest} from '../../../src/main/core/applications/manifest';
export async function seedTransferNonportableHistory(sqlite:Database.Database,userData:string,projectId:string,smtpId?:string){
 assert(sqlite.prepare('SELECT 1 FROM projects WHERE id=?').get(projectId));
 const store=new ResourceStore(sqlite,userData),actor={projectId,taskId:null},policy={requireDrafts:(a:{projectId:string})=>assert(a.projectId===projectId)},blobs=new MailBlobStore(store,join(userData,'app-data/mail'),policy),drafts=new MailDraftService(store,blobs,policy),at=new Date().toISOString();
 const put=(table:string,row:Record<string,unknown>)=>{const keys=Object.keys(row);sqlite.prepare('INSERT INTO '+table+'('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>row[k]));};
 if(!smtpId){smtpId=randomUUID();put('application_connections',{id:smtpId,app_id:'mail',provider_id:'smtp',name:'UH synthetic historical identity',config_schema_version:1,config_json:canonicalJson({kind:'smtp',host:'history.example.test',port:587,username:'',fromAddress:'history@example.test',authMode:'none',mode:'starttls'}),revision:1,config_revision:1,identity_revision:1,verified_identity_json:canonicalJson({providerId:'smtp',serviceId:'UH-synthetic-archive-only',accountId:'history@example.test',contractMajor:1}),identity_hash:digest('UH_ARCHIVE_IDENTITY'),secret_ref:null,secret_revision:0,policy_revision:1,enabled:0,auth_state:'disconnected',health:'unverified',cleanup_pending:0,created_at:at,updated_at:at});}
 const marker='UH_NONPORTABLE_'+randomUUID(),bytes=Buffer.from(marker+'_ATTACHMENT'),attachment=await blobs.save(actor,{operationId:randomUUID(),filename:'UH-history.txt',contentType:'text/plain'},bytes),draft=await drafts.create(actor,{operationId:randomUUID(),content:{mode:'new',sourceMessageRef:null,senderConnectionId:smtpId,to:['archive@example.test'],cc:[],bcc:[],subject:marker+'_SUBJECT',text:marker+'_BODY',html:null,inReplyTo:null,references:[],attachmentIds:[attachment.id]}});
 const intentId=randomUUID(),executionId=randomUUID(),messageId='<'+intentId+'@example.test>',review={schema:'willyou-mail-send-v1',intentId,projectId,sourceTaskId:null,sourceRunId:null,draftId:draft.id,draftRevision:1,draftContentHash:draft.contentHash,connectionId:smtpId,identityRevision:1,configRevision:1,policyRevision:1,bindingRevision:1,identityHash:digest('UH_ARCHIVE_IDENTITY'),smtpConfigHash:digest('UH_ARCHIVE_SMTP'),fromAddress:'history@example.test',content:draft.content,attachments:draft.attachments,rawHash:digest('UH_ARCHIVE_RAW'),frozenHash:digest('UH_ARCHIVE_FROZEN'),messageId,priorUnknownExecutionIds:[]},reviewHash=digest(canonicalJson(review)),result={state:'server-accepted',complete:true,accepted:draft.content.to,rejected:[],errorCode:null,smtpCode:250,messageId};
 sqlite.transaction(()=>{
 put('mail_send_intents',{id:intentId,project_id:projectId,operation_id:randomUUID(),request_hash:digest(marker),draft_id:draft.id,draft_revision:1,draft_content_hash:draft.contentHash,connection_id:smtpId,identity_revision:1,config_revision:1,policy_revision:1,binding_revision:1,identity_json:'{}',smtp_config_json:'{}',raw_write_id:randomUUID(),message_id:messageId,review_json:canonicalJson(review),review_hash:reviewHash,state:'server-accepted',execution_id:executionId,error_code:null,owner_instance_id:randomUUID(),owner_pid:process.pid,owner_started_at:at,created_at:at,updated_at:at});
 put('mail_send_executions',{id:executionId,intent_id:intentId,project_id:projectId,draft_id:draft.id,draft_revision:1,review_hash:reviewHash,state:'server-accepted',result_json:canonicalJson(result),secret_revision:0,owner_instance_id:randomUUID(),started_at:at,ended_at:at});
 sqlite.prepare("UPDATE mail_drafts SET state='sent',last_execution_id=? WHERE id=?").run(executionId,draft.id);
 }).immediate();
 const saved=drafts.get(actor,draft.id),history=readDraftSendHistory(store,new ApplicationActivityService(store),projectId,saved);assert.equal(history?.item.id,intentId);assert.equal(history?.send?.result?.state,'server-accepted');assert(blobs.read(actor,attachment.id).equals(bytes));
 return{scope:'T21 synthetic source-only historical rows;no actual SMTP/Task/grant',marker,attachmentId:attachment.id,attachmentHash:attachment.contentHash,attachmentBytes:bytes.length,blobPath:join(blobs.root,'blobs',attachment.contentHash),draftId:draft.id,intentId,executionId,smtpId,historyReadable:true,smtpInvoked:false,newTasks:0};
}
