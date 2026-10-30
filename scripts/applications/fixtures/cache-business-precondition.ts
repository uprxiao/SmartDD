// Closed-App synthetic historical prerequisites only. No SMTP, grant, native
// user approval or attachment-import endpoint is executed by this helper.
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {ResourceStore} from '../../../src/main/core/applications/resource-store';
import {MailBlobStore} from '../../../src/main/core/applications/mail-blob-store';
import {MailDraftService} from '../../../src/main/core/applications/mail-draft-service';
import {MacProcessIdentityReader} from '../../../src/main/core/applications/process-identity';
import {canonicalJson,digest} from '../../../src/main/core/applications/manifest';
import {prepareSmtpMessage} from '../../../src/main/core/applications/providers/smtp';
import {smtpConfigSchema,verifiedConnectionIdentitySchema} from '../../../src/shared/application-connections';
import type {MailSendReview,MailSendResult} from '../../../src/shared/mail-execution';

async function main(){
 const userData=realpathSync(process.argv[2]),projectId=process.argv[3],helper=process.argv[4];
 if(!/^\/private\/tmp\/willyou-m10-mail-index-app-[a-zA-Z0-9]+\/business-retention\/userdata$/.test(userData)||!helper.startsWith('/private/tmp/willyou-m10-'))throw Error('Only this fresh closed-App fixture root is allowed');
 const require=createRequire(join(process.cwd(),'package.json')),Database=require('better-sqlite3'),db=new Database(join(userData,'smartdd.db'));db.pragma('foreign_keys=ON');
 try{
  if(!db.prepare('SELECT 1 FROM projects WHERE id=?').get(projectId)||db.prepare('SELECT 1 FROM mail_drafts').get()||db.prepare('SELECT 1 FROM mail_send_intents').get()||db.prepare('SELECT 1 FROM app_secrets').get())throw Error('Fresh private business baseline required');
  const store=new ResourceStore(db,userData,undefined,{processes:new MacProcessIdentityReader(helper)}),actor={projectId,taskId:null},policy={requireDrafts:(input:{projectId:string})=>{if(input.projectId!==projectId)throw Error('Fixture project only');}},blobs=new MailBlobStore(store,join(userData,'app-data/mail'),policy),drafts=new MailDraftService(store,blobs,policy);
  const root=join(userData,'..'),seed=join(root,'seed-attachment.bin'),saved=join(root,'user-saved-canary.bin'),bytes=Buffer.alloc(8193,0x5a);Buffer.from('NI synthetic stable attachment 中文\n').copy(bytes);writeFileSync(seed,bytes,{flag:'wx',mode:0o600});writeFileSync(saved,Buffer.from('NI user saved file must remain outside cache\n'),{flag:'wx',mode:0o600});
  const attachment=await blobs.save(actor,{operationId:randomUUID(),filename:'retained 中文.bin',contentType:'application/octet-stream'},readFileSync(seed));
  const smtp=smtpConfigSchema.parse({kind:'smtp',host:'127.0.0.1',port:1,username:'ni-synthetic@example.test',fromAddress:'sender@example.test',authMode:'password',mode:'plain'}),identity=verifiedConnectionIdentitySchema.parse({providerId:'smtp',serviceId:'smtp://127.0.0.1:1',accountId:smtp.username,contractMajor:1}),connectionId=randomUUID(),stamp='2020-01-02T03:04:05.000Z';
  function insert(table:string,row:Record<string,unknown>){const keys=Object.keys(row);db.prepare('INSERT INTO '+table+'('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>row[k]));}
  // This is a disconnected historical connection, never selected for sending.
  insert('application_connections',{id:connectionId,app_id:'mail',provider_id:'smtp',name:'NI synthetic disconnected historical sender',config_schema_version:1,config_json:canonicalJson(smtp),revision:1,config_revision:1,identity_revision:1,verified_identity_json:canonicalJson(identity),identity_hash:digest(canonicalJson(identity)),secret_ref:null,secret_revision:0,policy_revision:1,enabled:0,auth_state:'disconnected',health:'unverified',health_code:null,health_message:null,tested_at:null,cleanup_pending:0,created_at:stamp,updated_at:stamp});
  const content=(label:string)=>({mode:'new' as const,sourceMessageRef:null,senderConnectionId:connectionId,to:['recipient@example.test'],cc:[],bcc:[],subject:'NI retained '+label,text:'NI original body '+label,html:null,inReplyTo:null,references:[],attachmentIds:[attachment.id]});
  const first=await drafts.create(actor,{operationId:randomUUID(),content:content('open-rev1')}),current=await drafts.update(actor,{operationId:randomUUID(),draftId:first.id,expectedRevision:1,content:content('open-rev2')}),histories=[];
  const binding=(db.prepare("SELECT binding_revision FROM application_project_settings WHERE project_id=? AND app_id='mail'").get(projectId) as {binding_revision:number}).binding_revision;
  for(const state of ['server-accepted','unknown'] as const){
   const draft=await drafts.create(actor,{operationId:randomUUID(),content:content(state)}),intentId=randomUUID(),executionId=randomUUID(),rawWriteId=randomUUID(),messageId='<ni-'+intentId+'@example.test>',frozen=await prepareSmtpMessage(smtp,{to:draft.content.to,cc:[],bcc:[],subject:draft.content.subject,text:draft.content.text,messageId,date:stamp,attachments:[{filename:attachment.filename,contentType:attachment.contentType,content:bytes}]}),raw=await blobs.saveMessage(actor,rawWriteId,frozen.raw),review:MailSendReview={schema:'willyou-mail-send-v1',intentId,projectId,sourceTaskId:null,sourceRunId:null,draftId:draft.id,draftRevision:1,draftContentHash:draft.contentHash,connectionId,identityRevision:1,configRevision:1,policyRevision:1,bindingRevision:binding,identityHash:digest(canonicalJson(identity)),smtpConfigHash:digest(canonicalJson(smtp)),fromAddress:smtp.fromAddress,content:draft.content,attachments:[attachment],rawHash:frozen.rawHash,frozenHash:frozen.contentHash,messageId,priorUnknownExecutionIds:[]},reviewHash=digest(canonicalJson(review)),result:MailSendResult={state,complete:state==='server-accepted',accepted:state==='server-accepted'?draft.content.to:[],rejected:[],errorCode:state==='unknown'?'SEND_UNKNOWN':null,smtpCode:state==='server-accepted'?250:null,messageId};
   // Explicit terminal test history. No approval/grant or submission is forged
   // into an active workflow; actual-send acceptance is outside this experiment.
   insert('mail_send_intents',{id:intentId,project_id:projectId,source_task_id:null,source_run_id:null,operation_id:randomUUID(),request_hash:digest('NI historical '+intentId),draft_id:draft.id,draft_revision:1,draft_content_hash:draft.contentHash,connection_id:connectionId,identity_revision:1,config_revision:1,policy_revision:1,binding_revision:binding,identity_json:canonicalJson(identity),smtp_config_json:canonicalJson(smtp),raw_write_id:rawWriteId,raw_object_id:raw.id,raw_hash:frozen.rawHash,frozen_hash:frozen.contentHash,envelope_json:canonicalJson(frozen.envelope),message_id:messageId,review_json:canonicalJson(review),review_hash:reviewHash,state,grant_id:null,execution_id:executionId,cancel_requested_at:null,owner_instance_id:randomUUID(),owner_pid:process.pid,owner_started_at:stamp,error_code:result.errorCode,created_at:stamp,updated_at:stamp});
   insert('mail_send_executions',{id:executionId,intent_id:intentId,project_id:projectId,draft_id:draft.id,draft_revision:1,review_hash:reviewHash,state,result_json:canonicalJson(result),secret_revision:0,owner_instance_id:randomUUID(),started_at:stamp,ended_at:stamp});
   db.prepare('UPDATE mail_drafts SET state=?,last_execution_id=? WHERE id=?').run(state==='server-accepted'?'sent':'unknown',executionId,draft.id);histories.push({draft:drafts.get(actor,draft.id),intentId,executionId,result,review,raw:{...raw,path:join(blobs.root,'blobs',raw.contentHash)}});
  }
  const packageHash=(db.prepare("SELECT package_hash FROM capability_active_packages WHERE app_id='mail'").get() as {package_hash:string}).package_hash,resourceId=randomUUID(),resource={id:resourceId,revision:attachment.contentHash,mediaType:attachment.contentType,size:attachment.size};
  insert('application_data_resources',{resource_id:resourceId,project_id:projectId,app_id:'mail',backing_kind:'mail-blob-v1',object_id:attachment.id,object_revision:attachment.contentHash,part:'attachment',data_contract_major:1,permission:'mail.draft',content_hash:attachment.contentHash,byte_size:attachment.size,media_type:attachment.contentType,minted_package_hash:packageHash,minted_operation_id:randomUUID(),created_at:stamp});
  if(db.pragma('foreign_key_check').length||db.prepare('SELECT 1 FROM mail_send_grants').get())throw Error('Synthetic history must be relationally valid without authorization grants');
  db.pragma('wal_checkpoint(TRUNCATE)');console.log(JSON.stringify({processId:process.pid,layer:'Closed-App synthetic preconditions only;real blob/draft/MIME serializers,explicit terminal history SQL,no SMTP/approval/import acceptance',projectId,attachment:{...attachment,path:join(blobs.root,'blobs',attachment.contentHash),resource},seed,saved,openDraft:{first,current},histories,packageHash}));
 }finally{db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
