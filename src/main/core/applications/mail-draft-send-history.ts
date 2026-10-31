import {ApplicationError} from '@shared/applications';
import type {ApplicationActivityDetail} from '@shared/application-activity';
import type {MailDraftDataView} from '@shared/application-data';
import type {ResourceStore} from './resource-store';
import type {ApplicationActivityService} from './activity-service';
import {draftContentHash} from './mail-draft-service';
type Link={executionId:string;intentId:string;projectId:string;draftId:string;revision:number;reviewHash:string;intentProject:string;intentDraft:string;intentRevision:number;intentExecution:string|null;intentReviewHash:string|null;contentHash:string;executionState:string;intentState:string};
/** Trusted UI enrichment only;the immutable v1 draft Data API is unchanged. */
export function readDraftSendHistory(store:ResourceStore,activity:ApplicationActivityService,projectId:string,draft:Pick<MailDraftDataView,'id'|'revision'|'contentHash'|'lastExecutionId'>):ApplicationActivityDetail|null{
 if(!draft.lastExecutionId)return null;
 const bad=()=>new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原发送执行与草稿修订不符或记录损坏，未替换为其他结果');
 const select=`SELECT e.id AS executionId,e.intent_id AS intentId,e.project_id AS projectId,e.draft_id AS draftId,e.draft_revision AS revision,e.review_hash AS reviewHash,i.project_id AS intentProject,i.draft_id AS intentDraft,i.draft_revision AS intentRevision,i.execution_id AS intentExecution,i.review_hash AS intentReviewHash,i.draft_content_hash AS contentHash,e.state AS executionState,i.state AS intentState FROM mail_send_executions e LEFT JOIN mail_send_intents i ON i.id=e.intent_id`;
 const valid=(link:Link|undefined):link is Link=>!!link&&link.projectId===projectId&&link.intentProject===projectId&&link.draftId===draft.id&&link.intentDraft===draft.id&&link.revision===link.intentRevision&&link.intentExecution===link.executionId&&link.reviewHash===link.intentReviewHash&&link.executionState===link.intentState;
 let link=store.sqlite.prepare(select+' WHERE e.id=?').get(draft.lastExecutionId) as Link|undefined;
 if(!valid(link))throw bad();
 // The pointer tracks the latest execution. Historical views resolve their own unique revision.
 if(link.revision!==draft.revision){
  link=store.sqlite.prepare(select+' WHERE e.draft_id=? AND e.draft_revision=?').get(draft.id,draft.revision) as Link|undefined;
  if(!link){if(store.sqlite.prepare('SELECT 1 FROM mail_send_intents WHERE draft_id=? AND draft_revision=? AND execution_id IS NOT NULL LIMIT 1').get(draft.id,draft.revision))throw bad();return null;}
  if(!valid(link))throw bad();
 }
 if(link.contentHash!==draft.contentHash)throw bad();
 const record=activity.detail('send',link.intentId),send=record.send,item=record.item;
 if(item.projectId!==projectId||item.send?.draftId!==draft.id||item.send.draftRevision!==draft.revision||item.send.executionId!==link.executionId||!send?.content||send.draftRevision!==draft.revision||draftContentHash(send.content,send.attachments)!==draft.contentHash||send.result&&send.result.messageId!==send.messageId)throw bad();
 return record;
}
