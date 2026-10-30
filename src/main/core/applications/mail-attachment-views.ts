import {ApplicationError} from '@shared/applications';
import {mailAttachmentTargetSchema,type MailAttachmentView} from '@shared/application-attachments';
import type {ApplicationExecutionContexts,ApplicationExecutionContext} from './execution-context';
import type {ApplicationDataResources} from './data-resources';
import type {MailDraftService} from './mail-draft-service';
import type {MailBlobStore} from './mail-blob-store';
import type {MailReadDataService} from './mail-read-data-service';
import {canonicalJson} from './manifest';
/** UI-only attachment identity checks. No import, filesystem path or new Agent grant. */
export class MailAttachmentViews {
 constructor(private readonly contexts:ApplicationExecutionContexts,private readonly resources:ApplicationDataResources,private readonly drafts:MailDraftService,private readonly blobs:MailBlobStore,private readonly mail:MailReadDataService){}
 async view(context:ApplicationExecutionContext,input:unknown):Promise<MailAttachmentView>{
  const target=mailAttachmentTargetSchema.parse(input);
  if(target.kind==='draft'){
   const actor=this.contexts.actor(context,'mail.draft'),draft=this.drafts.get(actor,target.draftId,target.revision),attachment=draft.attachments.find(a=>a.id===target.attachmentId);
   if(!attachment)throw new ApplicationError('NOT_FOUND','该草稿修订没有此附件');
   const bytes=this.blobs.read(actor,attachment.id),resource=await this.resources.register(context,{kind:'mail-blob-v1',objectId:attachment.id,objectRevision:attachment.contentHash,part:'attachment'},attachment.contentType,bytes);
   return{filename:attachment.filename,contentType:attachment.contentType,size:attachment.size,contentHash:attachment.contentHash,resource};
  }
  this.contexts.require(context,'mail.read');const read=await this.mail.read(context,target.source),attachment=read.attachments.find(a=>canonicalJson(a.resource)===canonicalJson(target.resource));
  if(!attachment)throw new ApplicationError('RESOURCE_STATE_CHANGED','该原邮件中没有所选附件修订');return{filename:attachment.filename,contentType:attachment.contentType,size:attachment.size,contentHash:attachment.contentHash,resource:attachment.resource};
 }
}
